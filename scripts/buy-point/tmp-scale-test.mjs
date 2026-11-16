// 真实规模：从窗口 cache 装载 239k ticks 建索引 → 50 次 evaluateFactorPreBuy 计时
import { createRequire } from 'module';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const require_ = createRequire('/home/ubuntu/richer-js/src/services/dbManager.js');
const { BuyPointCheckService } = require_('/home/ubuntu/richer-js/src/market-analysis/BuyPointCheckService.js');
const { memPullTicksFromIndex } = require_('/home/ubuntu/richer-js/src/trading-engine/implementations/BacktestEngine.js');

const dir = '/home/ubuntu/richer-js/data/tick-cache/backtest/win-20261102t060000000z_20261103t145959000z/';
const rows = [];
for (const f of ['fourmeme.jsonl.gz', 'flap.jsonl.gz']) {
  const raw = gunzipSync(readFileSync(dir + f)).toString('utf8').trim().split('\n');
  for (const line of raw) rows.push(JSON.parse(line));
}
rows.sort((a, b) => (a.block_time < b.block_time ? -1 : a.block_time > b.block_time ? 1 : 0));
console.log('总行', rows.length);
const idx = new Map();
for (const t of rows) {
  const a = String(t.token_address || '').toLowerCase();
  if (!a) continue;
  let arr = idx.get(a); if (!arr) { arr = []; idx.set(a, arr); }
  arr.push(t);
}
// 挑一个多行的 token
let best = null, bestN = 0;
for (const [k, v] of idx) if (v.length > bestN) { best = k; bestN = v.length; }
console.log('最大 token', best, bestN, '行');
const deps = { pullTicks: (t, a) => memPullTicksFromIndex(idx, t, a) };
const svc = new BuyPointCheckService({ enabled: true, factorCheck: { enabled: true }, persist: false, settleDelayMs: 0 }, { info(){}, warn(){}, error(){} }, deps);
const meta = { address: best, symbol: 'X', platform: 'fourmeme', createdAtMs: Date.parse(rows[0].block_time), totalSupply: 1e9 };
const anchorMs = Date.parse(idx.get(best)[idx.get(best).length - 1].block_time);
// 预热 2 次（JIT + createMeta 缓存）
await svc.evaluateFactorPreBuy(best, meta, { signalId: 'x' }, { anchorMs });
await svc.evaluateFactorPreBuy(best, meta, { signalId: 'x' }, { anchorMs });
const t0 = Date.now();
for (let i = 0; i < 50; i++) await svc.evaluateFactorPreBuy(best, meta, { signalId: 'x' }, { anchorMs });
console.log('50 次 evaluateFactorPreBuy:', Date.now() - t0, 'ms →', (Date.now() - t0) / 50, 'ms/次');
