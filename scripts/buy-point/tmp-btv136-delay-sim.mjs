// T151 推迟臂分析模拟（182 跑，零 DB 依赖除 trades 对账）：
// 对 D2≥1B 且 v136 有入场的票，FA 逐 tick 重放，完整评 P1（v25 门串），
// 预测「无推迟臂」（≈v136）与「有推迟臂」（≈v138）的首火时刻/价格对比
import { createRequire } from 'module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const config = require_('../../config/default.json');
const FA = require_('../../src/services/FourMemeFactorAggregator.js');
const { ConditionEvaluator } = require_('../../src/strategies/ConditionEvaluator.js');

const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades.json'), 'utf8'));
const c = await dbManager.getClient();
const trades = [];
let from = 0;
while (true) {
  const q = await c.from('trades').select('token_address,trade_direction,input_amount,output_amount,created_at').eq('experiment_id', '54c045ff-ab63-4bad-b71e-08b2e224c266').order('id', { ascending: true }).range(from, from + 999);
  if (!q.data.length) break;
  trades.push(...q.data); from += q.data.length;
  if (q.data.length < 1000) break;
}
const pnl = {}; const firstBuyTs = {};
for (const t of trades) {
  const e = pnl[t.token_address] = pnl[t.token_address] || { buy: 0, sell: 0 };
  if (t.trade_direction === 'buy') { e.buy += t.input_amount; if (!firstBuyTs[t.token_address]) firstBuyTs[t.token_address] = t.created_at; } else e.sell += t.output_amount;
}
for (const e of Object.values(pnl)) e.pnl = +(e.sell - e.buy).toFixed(4);

const P1_BASE = 'tradeCount >= 6 AND buyVolumeBnb >= 1 AND holdersExDust >= 4 AND currentVsLaunchPct <= 28.5 AND actTotalBnb >= 0.1 AND tokenAgeSec >= 15';
const CLUSTER = '((launchBundleClusterSize < 3 AND launchFirstBlockWallets < 2 AND launchFirstWaveWallets < 3) OR (tokenAgeSec > 60 AND sinceFirstTradeSec > 45) OR launchMinVsFloorPct < 0)';
const NO_DELAY = `${P1_BASE} AND ${CLUSTER}`;
const WITH_DELAY = `${NO_DELAY} AND (launchBigBuyBnb < 1 OR sinceFirstTradeSec > 60)`;

const ev = new ConditionEvaluator();
const pxOf = r => (r.price_usd != null && r.price_usd > 0 ? r.price_usd : r.price_bnb);
const out = [];
for (const p of doc.points) {
  const e = pnl[p.tokenAddress];
  if (!e || !firstBuyTs[p.tokenAddress]) continue; // 只看 v136 有入场的
  const raw = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades-ticks', p.ticksFile), 'utf8')).rows || [];
  raw.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index) || (a.id - b.id));
  if (raw.length < 10) continue;
  const ticks = raw.map(r => ({ ...r, timestamp: new Date(r.block_time).getTime() }));
  const fa = new FA(config, { info() {}, warn() {}, error() {} });
  fa.registerToken(p.tokenAddress, { createdAtMs: ticks[0].timestamp, totalSupply: 1e9, symbol: p.tokenSymbol, creatorAddress: null, platform: ticks[0].platform });
  let fireNo = null, fireWith = null;
  const bigBuy = (() => { // D2 快算（决定是否在受影响 cohort）
    const t0 = ticks[0].timestamp; const cum = new Map();
    for (const r of ticks) { if (r.timestamp - t0 > 60000) break; if (r.trade_type !== 'buy') continue; const w = (r.sender_address || r.trader_address || '').toLowerCase(); if (w) cum.set(w, (cum.get(w) || 0) + r.bnb_amount); }
    let s = 0; for (const v of cum.values()) if (v >= 0.2) s += v; return s;
  })();
  let lastPx = null;
  for (let i = 0; i < ticks.length; i++) {
    const t = ticks[i];
    fa.processTick(t, { emitFactors: false });
    if (pxOf(t)) lastPx = pxOf(t);
    // 每 tick 评一次（per-tick 语义）
    if (!fireNo || !fireWith) {
      const f = fa.buildFactorMap(p.tokenAddress, t.timestamp);
      if (!fireNo && ev.evaluate(NO_DELAY, f)) fireNo = { ts: t.timestamp, px: lastPx };
      if (!fireWith && ev.evaluate(WITH_DELAY, f)) fireWith = { ts: t.timestamp, px: lastPx };
    }
    if (fireNo && fireWith) break;
    if (t.timestamp - ticks[0].timestamp > 900000) break; // 15min 上限
  }
  const t0 = ticks[0].timestamp;
  // 前向收益（从各入场点）：+5min max / +15min last（相对入场价）
  const fwd = (fromTs, fromPx) => {
    if (fromTs == null || !fromPx) return null;
    let mx = 0, last = null;
    for (const t of ticks) {
      if (t.timestamp <= fromTs) continue;
      const px = pxOf(t); if (!px) continue;
      const r = (px / fromPx - 1) * 100;
      if (t.timestamp - fromTs <= 300000) { if (r > mx) mx = r; }
      if (t.timestamp - fromTs <= 900000) { last = r; } else break;
    }
    return { mx: +mx.toFixed(1), last: last == null ? null : +last.toFixed(1) };
  };
  out.push({
    id: p.pointId, sym: p.tokenSymbol, bigBuy: +bigBuy.toFixed(2), pnl: e.pnl,
    actualAge: Math.round((new Date(firstBuyTs[p.tokenAddress]).getTime() - t0) / 1000),
    simNoAge: fireNo ? Math.round((fireNo.ts - t0) / 1000) : null,
    simWithAge: fireWith ? Math.round((fireWith.ts - t0) / 1000) : null,
    pxNo: fireNo?.px ?? null, pxWith: fireWith?.px ?? null, firstPx: pxOf(ticks[0]),
    fwdNo: fwd(fireNo?.ts, fireNo?.px), fwdWith: fwd(fireWith?.ts, fireWith?.px),
  });
}
const affected = out.filter(r => r.bigBuy >= 1);
console.log('=== 位移票前向收益框架（涨起前=延迟点 fwd 优于原点 / 规避=未火）===');
const shifted = affected.filter(r => r.simNoAge != null && r.simWithAge != null && r.simWithAge > r.simNoAge && r.fwdNo && r.fwdWith);
const neverF = affected.filter(r => r.simNoAge != null && r.simWithAge == null);
let better = 0, worse = 0;
for (const r of shifted) {
  const dLast = (r.fwdWith.last ?? -99) - (r.fwdNo.last ?? -99);
  if (dLast >= 0 || (r.fwdWith.mx - r.fwdNo.mx) >= 10) better++; else worse++;
}
console.log('位移 ' + shifted.length + ' 张: 前向更优(涨起前/跌幅收窄) ' + better + ' | 更差 ' + worse);
for (const r of shifted.sort((a, b) => (((a.fwdWith.last ?? 0) - (a.fwdNo?.last ?? 0)) - ((b.fwdWith.last ?? 0) - (b.fwdNo?.last ?? 0))))) {
  const d = +(((r.fwdWith.last ?? 0) - (r.fwdNo?.last ?? 0))).toFixed(1);
  console.log(`  ${r.id} ${String(r.sym).slice(0,8).padEnd(8)} 原@+${r.simNoAge}s max${r.fwdNo.mx}/last${r.fwdNo.last}% → 延@+${r.simWithAge}s max${r.fwdWith.mx}/last${r.fwdWith.last}% | Δlast=${d >= 0 ? '+' : ''}${d}pp | pnl=${r.pnl}`);
}
const avoided = neverF.reduce((s2, r) => s2 + (r.pnl < 0 ? -r.pnl : 0), 0);
console.log('规避 ' + neverF.length + ' 张（15min 内未再火）: 亏损票 Σpnl=' + neverF.reduce((s2, r) => s2 + r.pnl, 0).toFixed(3) + ' → 全规避价值 +' + avoided.toFixed(3));
for (const r of neverF) console.log(`  ${r.id} ${String(r.sym).slice(0,8).padEnd(8)} 原@+${r.simNoAge}s pnl=${r.pnl}`);
console.log('=== 受影响 cohort（D2≥1B 且 v136 有入场，' + affected.length + ' 张）完整 P1 模拟 ===');
let noMatch = 0, withShift = 0, withNever = 0, shiftLater = 0, shiftEarlier = 0;
const lines = [];
for (const r of affected.sort((a, b) => a.bigBuy - b.bigBuy)) {
  const simOk = r.simNoAge != null && Math.abs(r.simNoAge - r.actualAge) <= 25;
  if (!simOk) noMatch++;
  if (r.simNoAge != null && r.simWithAge != null) {
    if (r.simWithAge > r.simNoAge) { withShift++; shiftLater++; }
    else if (r.simWithAge < r.simNoAge) { withShift++; shiftEarlier++; }
  } else if (r.simNoAge != null && r.simWithAge == null) withNever++;
  lines.push(`  ${r.id} ${String(r.sym).slice(0,8).padEnd(8)} D2=${r.bigBuy}B | 实际v136@+${r.actualAge}s | 模拟无臂@+${r.simNoAge ?? '未火'}s${simOk ? '' : '(≠实际)'} | 有臂@+${r.simWithAge ?? '15min内未火'}s | 价 ${r.pxNo && r.pxWith ? ((r.pxWith / r.pxNo).toFixed(2) + 'x') : '-'} | pnl=${r.pnl}`);
}
for (const l of lines) console.log(l);
console.log(`\n汇总: 模拟≠实际(±25s) ${noMatch} 张 | 入场位移 ${withShift}（推后 ${shiftLater} / 提前 ${shiftEarlier}——提前=无臂首火点本身>60 后被臂外因素改）| 有臂后 15min 内不再触发 ${withNever} 张`);
