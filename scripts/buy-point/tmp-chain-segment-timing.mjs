// 门链子段精确计时（182 跑）：真实 cache ticks + 真服务 + 逐步 hrtime
// 目标：找出 v137 每链 2.4s 中 Jev(0.42s) 之外多出的 ~1.8s 在哪
import { createRequire } from 'module';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const ROOT = '/home/ubuntu/richer-js';
const require_ = createRequire(ROOT + '/src/services/dbManager.js');
const { CheatCheckService } = require_(ROOT + '/src/market-analysis/CheatCheckService.js');
const { BuyPointCheckService } = require_(ROOT + '/src/market-analysis/BuyPointCheckService.js');
const { memPullTicksFromIndex } = require_(ROOT + '/src/trading-engine/implementations/BacktestEngine.js');
const { buildSnapshotFromRows } = require_(ROOT + '/src/market-analysis/cheat-snapshot.js');
const { buildCheatState } = require_(ROOT + '/src/market-analysis/cheat-state-builder.js');
const { buildBuyPointSnapshot } = require_(ROOT + '/src/market-analysis/buy-point-snapshot.js');

// 装载真实 ticks
const dir = ROOT + '/data/tick-cache/backtest/win-20261102t060000000z_20261103t145959000z/';
const rows = [];
for (const f of ['fourmeme.jsonl.gz', 'flap.jsonl.gz']) {
  const raw = gunzipSync(readFileSync(dir + f)).toString('utf8').trim().split('\n');
  for (const line of raw) rows.push(JSON.parse(line));
}
rows.sort((a, b) => (a.block_time < b.block_time ? -1 : a.block_time > b.block_time ? 1 : 0));

// 建 per-token 索引（同引擎）
const idx = new Map();
for (const t of rows) {
  const a = String(t.token_address || '').toLowerCase();
  if (!a) continue;
  let arr = idx.get(a); if (!arr) { arr = []; idx.set(a, arr); }
  arr.push(t);
}

// 选代表性 token：多种行数档
const candidates = [];
for (const [k, v] of idx) {
  if (v.length >= 200 && v.length <= 400) candidates.push({ addr: k, n: v.length, tier: '200-400' });
  if (v.length >= 800 && v.length <= 1200) candidates.push({ addr: k, n: v.length, tier: '800-1200' });
  if (v.length >= 2500) candidates.push({ addr: k, n: v.length, tier: '2500+' });
}
// 每档取第一个
const picks = [];
for (const tier of ['200-400', '800-1200', '2500+']) {
  const c = candidates.find(x => x.tier === tier);
  if (c) picks.push(c);
}

console.log('=== 门链子段计时（真实数据+真服务）===');
console.log('tokens:', picks.map(p => `${p.tier}(${p.n}行)`).join(' '));

const deps = { pullTicks: (t, a) => memPullTicksFromIndex(idx, t, a) };
const noopLogger = { info() {}, warn() {}, error() {} };
const cheatSvc = new CheatCheckService({ enabled: true, persist: false, settleDelayMs: 0, gate: { awaitMs: 60000 } }, noopLogger, deps);
const bpSvc = new BuyPointCheckService({ enabled: true, factorCheck: { enabled: true }, persist: false, settleDelayMs: 0 }, noopLogger, deps);

for (const p of picks) {
  const tokenRows = idx.get(p.addr);
  // 锚=倒数第 100 行时刻（模拟中期信号）
  const anchorRow = tokenRows[Math.max(0, tokenRows.length - 100)];
  const anchorMs = Date.parse(anchorRow.block_time);
  const meta = { address: p.addr, symbol: 'TEST', platform: tokenRows[0].platform || 'fourmeme', createdAtMs: Date.parse(tokenRows[0].block_time), totalSupply: 1e9 };

  // ── 子段 1：pullTicks ──
  let t0 = process.hrtime.bigint();
  const pull = await deps.pullTicks(p.addr, anchorMs);
  let t1 = process.hrtime.bigint();
  const pullMs = Number(t1 - t0) / 1e6;

  // ── 子段 2：cheat 快照 ──
  t0 = process.hrtime.bigint();
  const cheatSnap = buildSnapshotFromRows(pull.rows, { ...meta, quoteToken: pull.quoteToken }, { capped: pull.capped, anchorTickCount: pull.anchorTickCount });
  t1 = process.hrtime.bigint();
  const cheatSnapMs = Number(t1 - t0) / 1e6;

  // ── 子段 3：cheat 状态文本 ──
  t0 = process.hrtime.bigint();
  const { state: cheatState } = buildCheatState(cheatSnap, { questionsVersion: 'D3.71' });
  t1 = process.hrtime.bigint();
  const cheatStateMs = Number(t1 - t0) / 1e6;

  // ── 子段 4：BP 快照 ──
  t0 = process.hrtime.bigint();
  const bpSnap = buildBuyPointSnapshot(pull.rows, meta, { capped: pull.capped, anchorTickCount: pull.anchorTickCount, signalInfo: null });
  t1 = process.hrtime.bigint();
  const bpSnapMs = Number(t1 - t0) / 1e6;

  // ── 子段 5：完整 evaluateFactorPreBuy（FP4 门）──
  t0 = process.hrtime.bigint();
  const fp4 = await bpSvc.evaluateFactorPreBuy(p.addr, meta, { signalId: 'test' }, { anchorMs });
  t1 = process.hrtime.bigint();
  const fp4Ms = Number(t1 - t0) / 1e6;

  // ── 子段 6：完整 cheat 链（含 Jev）──
  t0 = process.hrtime.bigint();
  const cheatResult = await cheatSvc.gateBuyPoint(p.addr, meta, { signalId: 'test', experimentId: 'bench' }, { awaitMs: 60000, anchorMs });
  t1 = process.hrtime.bigint();
  const cheatChainMs = Number(t1 - t0) / 1e6;

  const pullN = pull.rows.length;
  const stateLen = cheatState ? cheatState.length : 0;
  console.log(`\n${p.tier} (${p.n}行, 锚窗${pullN}行):`);
  console.log(`  pullTicks:     ${pullMs.toFixed(1)}ms`);
  console.log(`  cheat快照:      ${cheatSnapMs.toFixed(1)}ms`);
  console.log(`  cheat状态文本:  ${cheatStateMs.toFixed(1)}ms (${(stateLen/1000).toFixed(0)}k chars)`);
  console.log(`  BP快照:        ${bpSnapMs.toFixed(1)}ms`);
  console.log(`  FP4 全评估:    ${fp4Ms.toFixed(1)}ms → ${fp4.status}/${fp4.pass}`);
  console.log(`  cheat 全链:    ${cheatChainMs.toFixed(1)}ms (含 Jev) → ${cheatResult.grade}`);
  console.log(`  合计(不含Jev): ${(pullMs + cheatSnapMs + cheatStateMs + bpSnapMs + fp4Ms).toFixed(0)}ms`);
  console.log(`  Jev 推算:      ${(cheatChainMs - pullMs - cheatSnapMs - cheatStateMs).toFixed(0)}ms`);
}
process.exit(0);
