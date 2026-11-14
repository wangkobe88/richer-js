#!/usr/bin/env node
// P3 摸底（182 跑，只读）：CD400 落地后 sbw=1 靶面残余
// 对 btv109 全部 sbw=1 票：①生产豁免路径/全窗锚/出口波/pnl（sweep ⑤ 复用）
// ②CD400 六键 hit（buildSnapshotFromRows 真算）→ 已被 dump_no_absorption denied 接住的票
// ③出口流向：最后 ≥50s 静默段出口→锚整窗 买/卖/净/卖占比（T045 立法方向候选腿）
// ④锚前 60s 整窗流向对照（不依赖静默段）
// 验收问题：真 burst 亏票（T100/T082/T054/T036）CD400 接住几个；T093/T064/T065 赢家是否安全
import { dbManager } from '../../src/services/dbManager.js';
import fs from 'node:fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { buildSnapshotFromRows } = require('../../src/market-analysis/cheat-snapshot.js');

const EXP = '029bd863-55e5-4319-91d5-10803a6a9a82';
const TICKS = 'scripts/buy-point/sets/btv109-trades-ticks';
const SET = 'scripts/buy-point/sets/btv109-trades.json';

const set = JSON.parse(fs.readFileSync(SET, 'utf8'));
const c = await dbManager.getClient();
const sigs = []; let from = 0;
while (true) {
  const { data, error } = await c.from('strategy_signals')
    .select('id,token_address,action,executed,reason,metadata,created_at')
    .eq('experiment_id', EXP).order('id', { ascending: true }).range(from, from + 999);
  if (error) throw new Error(error.message);
  sigs.push(...data); if (data.length < 1000) break; from += 1000;
}
const buySig = new Map();
for (const s of sigs) {
  if (s.action !== 'buy') continue;
  if (!buySig.has(s.token_address) || s.executed) buySig.set(s.token_address, s);
}

const ts = (iso) => Date.parse(iso) / 1000;
const fmt = (v, d = 2) => (v == null ? '?' : Number(v).toFixed(d));
const recs = [];
let nSbw = 0;

for (const p of set.points) {
  const addr = p.tokenAddress;
  let rows;
  try { rows = JSON.parse(fs.readFileSync(`${TICKS}/${addr}.json`, 'utf8')).rows; } catch { continue; }
  const sig = buySig.get(addr);
  const cc = sig?.metadata?.cheatCheck || {};
  if (cc.levels?.stallBurstWave !== 1) continue;
  nSbw++;
  const pid = p.pointId.slice(3), sym = String(p.tokenSymbol ?? '-').slice(0, 8);
  const pnl = p.trade?.episode?.pnlBnb ?? null;
  const ex = cc.exempt?.code || '原生';
  const act = cc.levels?.activityLevel || '?';
  const anchorBurst = cc.anchors?.burstWaveBuyBnb ?? null;
  const gapSec = cc.anchors?.burstMaxGapSec ?? null;

  const anchor = p.anchorTimeIso || rows[rows.length - 1].block_time;
  const aTs = ts(anchor);
  const pre = rows.filter((r) => ts(r.block_time) <= aTs);

  // CD400 六键（真算）
  const meta = { address: addr, symbol: p.tokenSymbol ?? '?', name: p.tokenSymbol ?? '?', createdAt: rows[0].block_time, platform: 'fourmeme', totalSupply: 1e9 };
  let d = {};
  try { d = buildSnapshotFromRows(pre, meta).derived; } catch { /* fail-open 照列 */ }
  const cd400hit = d.nearDumpQualBlocks != null && d.nearDumpQualBlocks >= 1 && d.nearDumpMinAbsorbBnb != null && d.nearDumpMinAbsorbBnb < 0.05;

  // 出口段：最后 ≥50s 静默段出口 ex0 = 段后首 tick
  const segs = [];
  for (let i = 1; i < pre.length; i++) {
    if (ts(pre[i].block_time) - ts(pre[i - 1].block_time) >= 50) segs.push(ts(pre[i].block_time));
  }
  const ex0 = segs.length ? segs[segs.length - 1] : null;
  // 出口整窗（ex0→锚）流向 + 出口后 60s 内最密 5s 波
  let exitWin = null, exitWave = 0;
  if (ex0 != null) {
    const w = pre.filter((r) => ts(r.block_time) >= ex0);
    const buy = w.filter((r) => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
    const sell = w.filter((r) => r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0);
    const span = aTs - ex0;
    exitWin = { buy, sell, net: buy - sell, sellPct: buy + sell > 0 ? (sell / (buy + sell)) * 100 : null, span };
    for (let s0 = ex0; s0 < Math.min(ex0 + 55, aTs + 5); s0 += 1) {
      const b = w.filter((r) => ts(r.block_time) >= s0 && ts(r.block_time) < s0 + 5 && r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
      if (b > exitWave) exitWave = b;
    }
  }
  // 锚前 60s 整窗流向对照
  const pre60 = pre.filter((r) => aTs - ts(r.block_time) < 60);
  const p60buy = pre60.filter((r) => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
  const p60sell = pre60.filter((r) => r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0);

  const ratio = anchorBurst && exitWave > 0 ? +(exitWave / anchorBurst).toFixed(2) : (exitWave === 0 ? 0 : null);
  recs.push({ pid, sym, pnl, ex, act, anchorBurst, exitWave, ratio, gapSec, cd400hit, qual: d.nearDumpQualBlocks, minAbs: d.nearDumpMinAbsorbBnb, exitWin, p60buy, p60sell });
}

// 按 ratio 排序输出
recs.sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1));
console.log(`sbw=1 共 ${nSbw} 票（CD400 已上线口径逐票判定）\n`);
console.log('pid    sym      pnl      豁免          act    全窗锚  出口波  ratio gap  CD400  出口整窗(买/卖/净/卖%跨s)          锚前60s(买/卖)');
for (const r of recs) {
  const ew = r.exitWin ? `${fmt(r.exitWin.buy)}/${fmt(r.exitWin.sell)}/${fmt(r.exitWin.net)}/${fmt(r.exitWin.sellPct, 0)}%${Math.round(r.exitWin.span)}s` : '无静默段';
  console.log(`${r.pid.padEnd(6)} ${r.sym.padEnd(8)} ${(r.pnl == null ? '?' : r.pnl.toFixed(4)).padEnd(8)} ${r.ex.padEnd(12)} ${String(r.act).padEnd(6)} ${String(r.anchorBurst).padEnd(6)} ${fmt(r.exitWave, 3).padEnd(6)} ${String(r.ratio).padEnd(5)} ${String(r.gapSec).padEnd(4)} ${r.cd400hit ? 'HIT' : '-'}   ${ew.padEnd(38)} ${fmt(r.p60buy)}/${fmt(r.p60sell)}`);
}

// 汇总
const grps = {
  真burst亏: recs.filter((r) => (r.ratio ?? 0) >= 0.5 && (r.pnl ?? 0) < -0.001),
  真burst盈: recs.filter((r) => (r.ratio ?? 0) >= 0.5 && (r.pnl ?? 0) > 0.001),
  虚高盈: recs.filter((r) => (r.ratio ?? 9) <= 0.3 && (r.pnl ?? 0) > 0.001),
  虚高亏: recs.filter((r) => (r.ratio ?? 9) <= 0.3 && (r.pnl ?? 0) < -0.001),
  中间带: recs.filter((r) => (r.ratio ?? -1) > 0.3 && (r.ratio ?? -1) < 0.5),
};
const sum = (l) => l.reduce((a, x) => a + (x.pnl || 0), 0);
for (const [k, l] of Object.entries(grps)) {
  const hitN = l.filter((x) => x.cd400hit).length;
  console.log(`\n[${k}] ${l.length}票 pnlΣ=${fmt(sum(l))} CD400接住=${hitN}票(${l.filter(x=>x.cd400hit).map(x=>x.pid).join(',')})`);
  for (const x of l) console.log(`   ${x.pid} ${x.sym} pnl=${fmt(x.pnl, 4)} ${x.ex} act=${x.act} CD400=${x.cd400hit ? 'HIT' : '-'} 出口卖%=${x.exitWin ? fmt(x.exitWin.sellPct, 0) : '-'} 锚前60卖=${fmt(x.p60sell)}`);
}
process.exit(0);
