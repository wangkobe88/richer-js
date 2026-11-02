#!/usr/bin/env node
// 7d92 P1·首买腿（buy-v2 v51）逐 tick 重放：各 AND 子句首真时刻 → 找拖慢因子
// ticks 从 /tmp/7d92-ticks.json 读（已拉好），零 DB 零网络
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');
const Mod = require('../src/services/FourMemeFactorAggregator');
const FA = Mod.default || Mod;

const TOKEN = '0x7d922dbfd42e8443c29ba16c8293b4c4ea227777';
const MIN_TICK_BNB = 0.001;
const CREATE_MS = Date.parse('2026-10-29T09:18:15.906Z'); // 入池时刻（block 130447841）
const RATING_READY_MS = Date.parse('2026-10-29T09:18:25.793Z'); // R1 析毕 rating=3
const FIRE_MS = Date.parse('2026-10-29T09:18:53.142Z'); // P1·首买 fire

const CONDITION = "(tokenAgeSec < 90 OR tradeCount >= 25) AND marketCap > 4.7 AND marketCap < 27 AND (narrativeRating == 2 OR narrativeRating == 3) AND holderTrendSlope > 0 AND top2HolderCircPct < 55 AND top1HolderCircPct < 35 AND maxCopyWalletHolderCircPct < 20 AND famousCopyWalletCircPct < 15 AND (buyVolumeBnb >= 1.25 AND holdersExDust >= 10) AND (tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40) AND drawdownFromHighest > -70 AND crashSpeedPctPerSec > -10";

function splitConjuncts(ast) {
  const out = [];
  (function walk(n) {
    if (n && n.type === 'AND') { walk(n.left); walk(n.right); }
    else out.push(n);
  })(ast);
  return out;
}
function labelOf(n) {
  if (!n || typeof n !== 'object') return '?';
  if (n.type === 'AND') return `(${labelOf(n.left)} AND ${labelOf(n.right)})`;
  if (n.type === 'OR') return `(${labelOf(n.left)} OR ${labelOf(n.right)})`;
  if (n.type === 'COMPARISON') return `${n.left} ${n.operator} ${n.right}`;
  return n.type;
}
const t0 = (ms) => ms == null ? '  从未  ' : `+${((ms - CREATE_MS) / 1000).toFixed(1)}s`;

(async () => {
  await Promise.all([FA.loadSybilClusters(), FA.loadCopyWalletRoster(), FA.loadFamousCopyWallets()]);
  const ev = new ConditionEvaluator();
  const clauses = splitConjuncts(ev.parseCondition(CONDITION));

  const rows = require('/tmp/7d92-ticks.json');
  rows.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
  console.log(`ticks=${rows.length} 窗口 ${rows[0].block_time} → ${rows[rows.length - 1].block_time}`);

  const fa = new FA({});
  fa.registerToken(TOKEN, { createdAtMs: CREATE_MS, totalSupply: 1e9, platform: 'flap' });

  const firstTrue = clauses.map(() => null);
  let allTrueTs = null;
  const track = [];
  let dusted = 0;
  for (const t of rows) {
    const ts = Date.parse(t.block_time);
    if (Number(t.bnb_amount) < MIN_TICK_BNB) continue;
    dusted++;
    fa.processTick({ token_address: TOKEN, platform: 'flap', timestamp: ts, block_number: t.block_number, log_index: t.log_index,
      trader_address: t.trader_address, sender_address: t.sender_address, trade_type: t.trade_type,
      token_amount: Number(t.token_amount), bnb_amount: Number(t.bnb_amount || 0),
      price_bnb: Number(t.price_bnb || 0), price_usd: Number(t.price_usd || 0) }, { emitFactors: false });
    const f = fa.buildFactorMap(TOKEN, ts) || {};
    const f2 = { ...f, narrativeRating: (ts >= RATING_READY_MS) ? 3 : null };
    let all = true;
    const falses = [];
    clauses.forEach((ast, i) => {
      const v = !!ev.evaluate(ast, f2);
      if (v && !firstTrue[i]) firstTrue[i] = ts;
      if (!v) { all = false; falses.push(labelOf(ast)); }
    });
    if (all && !allTrueTs) allTrueTs = ts;
    track.push({ ts, mc: f.marketCap, bvb: f.buyVolumeBnb, hexd: f.holdersExDust, h: f.holders, slope: f.holderTrendSlope,
      nbs: f.tradesNetBuyRatioShortWin, nbl: f.tradesNetBuyRatioLongWin, t1: f.top1HolderCircPct, t2: f.top2HolderCircPct,
      dd: f.drawdownFromHighest, px: f.currentPriceBnb, all, falses, crash: f.crashSpeedPctPerSec });
  }

  console.log(`\n入计 tick 数=${dusted}（尘 tick 剔除后）`);
  console.log('\n=== 各子句首真时刻（T0=入池 09:18:15.9）===');
  clauses.forEach((ast, i) => console.log(`  ${firstTrue[i] ? '✅' : '❌'} ${t0(firstTrue[i])}  ${labelOf(ast)}`));
  console.log(`\n全条件首真=${allTrueTs ? t0(allTrueTs) + `（${new Date(allTrueTs).toISOString()}）` : '窗内从未'}`);
  console.log(`rating 到位=${t0(RATING_READY_MS)}（叙事分析 9.7s）| 实际 fire=${t0(FIRE_MS)}`);

  console.log('\n=== 关键因子轨迹（每 tick）===');
  console.log('时刻(+s) | mcap  bvb   ExDust h  slope nbs/nbl  t1/t2  dd%  crash  px(1e-9) all | 假子句');
  for (const r of track) {
    console.log(`  +${((r.ts - CREATE_MS) / 1000).toFixed(0).padStart(3)}s | ${r.mc?.toFixed(2)} ${r.bvb?.toFixed(2)} ${r.hexd ?? '-'} ${r.h ?? '-'} ${r.slope?.toFixed(3) ?? '-'} ${r.nbs ?? '-'}/${r.nbl ?? '-'} ${r.t1?.toFixed(0) ?? '-'}/${r.t2?.toFixed(0) ?? '-'} ${r.dd?.toFixed(0) ?? '-'} ${r.crash?.toFixed(1) ?? '-'} ${r.px ? (r.px * 1e9).toFixed(2) : '-'} ${r.all ? '✅FIRE' : ''}${r.falses.length ? ' | ' + r.falses.join(' ; ') : ''}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
