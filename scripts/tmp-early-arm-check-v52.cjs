#!/usr/bin/env node
// 单票早期臂（buy_1_ buy-early-narrative）可触发性重放：逐 tick 评 v52 早期臂全部子句 +
// marketCap 轨迹（窗 6.0-6.7 BNB），对照主臂全真点。用法：node scripts/tmp-early-arm-check-v52.cjs <token>
require('/home/ubuntu/richer-js/node_modules/dotenv').config({ path: '/home/ubuntu/richer-js/config/.env' });
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');
const { ConditionEvaluator } = require('/home/ubuntu/richer-js/src/strategies/ConditionEvaluator');
const Mod = require('/home/ubuntu/richer-js/src/services/FourMemeFactorAggregator');
const FA = Mod.default || Mod;

const TOKEN = process.argv[2];
const EXP = 'bc77ac6c-f455-492a-9895-34e32581d57d';
const MIN_TICK_BNB = 0.001;
const ev = new ConditionEvaluator();
const c = dbManager.getClient();

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
  if (n.type === 'IS_NULL') return `${n.operand} IS NULL`;
  if (n.type === 'IS_NOT_NULL') return `${n.operand} IS NOT NULL`;
  if (n.type === 'COMPARISON') return `${n.left} ${n.operator} ${n.rightString ? `'${n.right}'` : n.right}`;
  return '?';
}

(async () => {
  await Promise.all([FA.loadSybilClusters(), FA.loadCopyWalletRoster(), FA.loadFamousCopyWallets()]);
  // [1] 实验 config 早期臂（idx=1）
  const { data: exp, error: e0 } = await c.from('experiments').select('config').eq('id', EXP).single();
  if (e0) throw new Error('exp: ' + e0.message);
  const leg = exp.config.strategiesConfig.buyStrategies[1];
  console.log(`[leg1] ${leg.name || ''} condition:\n  ${leg.condition}\n`);
  const clauses = splitConjuncts(ev.parseCondition(leg.condition));

  // [2] token_create 锚 + fire 信号锚
  const { data: evRows, error: e1 } = await c.from('wss_events')
    .select('token_address,platform,payload,block_time').eq('kind', 'token_create').eq('token_address', TOKEN).limit(5);
  if (e1) throw new Error('anchor: ' + e1.message);
  const a = evRows[0];
  const anchorMs = Number(a.payload && a.payload.blockTimeMs) || Date.parse(a.block_time);
  const supply = Number(a.payload && a.payload.totalSupply) || (a.platform === 'fourmeme' ? 0 : 1e9); // flap/gang payload 无 totalSupply 恒 1e9（v47 工具同款回退）
  console.log(`[anchor] platform=${a.platform} create=${new Date(anchorMs).toISOString()} supply=${supply}`);
  const { data: sigs, error: e2 } = await c.from('strategy_signals')
    .select('created_at,metadata').eq('experiment_id', EXP).eq('token_address', TOKEN)
    .eq('signal_type', 'BUY').order('created_at').limit(50);
  if (e2) throw new Error('signals: ' + e2.message);
  const fireTs = sigs.length ? Date.parse(sigs[sigs.length - 1].created_at) : null;
  console.log(`[fire] ${sigs.length} BUY signals, last=${fireTs ? new Date(fireTs).toISOString() : '-'} leg=${sigs.length && sigs[sigs.length - 1].metadata && sigs[sigs.length - 1].metadata.strategyId}`);

  // [3] rating 就绪时刻（narrative_analysis_rounds）
  const { data: rounds, error: e3 } = await c.from('narrative_analysis_rounds')
    .select('round_no,completed_at,rating').eq('experiment_id', EXP).eq('token_address', TOKEN).order('started_at');
  if (e3) throw new Error('rounds: ' + e3.message);
  const ratingReadyMs = rounds.length ? Date.parse(rounds[0].completed_at) : null;
  const rating = rounds.length ? rounds[0].rating : null;
  console.log(`[rating] round1 completed=${ratingReadyMs ? new Date(ratingReadyMs).toISOString() : '-'} rating=${rating}`);

  // [4] ticks
  const winEnd = (fireTs || anchorMs + 600000) + 120000;
  const rows = [];
  let anchorId = 0;
  for (let p = 0; p < 80; p++) {
    const { data, error } = await c.from('wss_price_ticks')
      .select('id,block_time,block_number,log_index,trade_type,trader_address,sender_address,token_amount,bnb_amount,price_bnb,price_usd')
      .eq('token_address', TOKEN)
      .gte('block_time', new Date(anchorMs - 60000).toISOString()).lte('block_time', new Date(winEnd).toISOString())
      .gt('id', anchorId).limit(4000);
    if (error) throw new Error('ticks: ' + error.message);
    rows.push(...data);
    if (data.length < 4000) break;
    anchorId = data[data.length - 1].id;
  }
  rows.sort((x, y) => x.block_number - y.block_number || x.log_index - y.log_index);
  console.log(`[ticks] ${rows.length}`);

  // [5] 重放：逐 tick 评早期臂子句 + 关键因子轨迹
  const fa = new FA({});
  fa.registerToken(TOKEN, { createdAtMs: anchorMs, totalSupply: supply, platform: a.platform });
  let inWindowTicks = 0, allTrueTs = null, lastPrice = 0;
  const track = [];
  for (const t of rows) {
    const ts = Date.parse(t.block_time);
    if (Number(t.bnb_amount) < MIN_TICK_BNB) continue;
    fa.processTick({ token_address: TOKEN, platform: a.platform, timestamp: ts, block_number: t.block_number, log_index: t.log_index,
      trader_address: t.trader_address, sender_address: t.sender_address, trade_type: t.trade_type,
      token_amount: Number(t.token_amount), bnb_amount: Number(t.bnb_amount || 0),
      price_bnb: Number(t.price_bnb || 0), price_usd: Number(t.price_usd || 0) }, { emitFactors: false });
    const f = fa.buildFactorMap(TOKEN, ts) || {};
    if (f.currentPriceBnb > 0) lastPrice = f.currentPriceBnb;
    const f2 = { ...f, narrativeRating: (ratingReadyMs && ts >= ratingReadyMs) ? rating : null };
    const falses = [];
    let all = true;
    for (const ast of clauses) { const v = !!ev.evaluate(ast, f2); if (!v) { all = false; falses.push(labelOf(ast)); } }
    const inWin = f.marketCap > 6.0 && f.marketCap < 6.7;
    if (inWin) inWindowTicks++;
    if (all && !allTrueTs) allTrueTs = ts;
    track.push({ ts, mc: f.marketCap, top2: f.top2HolderCircPct, top1: f.top1HolderCircPct, bvb: f.buyVolumeBnb, h: f.holders,
      nbs: f.tradesNetBuyRatioShortWin, nbl: f.tradesNetBuyRatioLongWin, inWin, all, falses });
  }
  // 市值窗进出时刻
  let enterWin = null, exitWin = null;
  for (let i = 1; i < track.length; i++) {
    if (track[i].inWin && !track[i - 1].inWin && !enterWin) enterWin = track[i].ts;
    if (!track[i].inWin && track[i - 1].inWin) exitWin = track[i].ts;
  }
  console.log(`\n[mcap窗] 首进=${enterWin ? new Date(enterWin).toISOString() : '从未'} 末出=${exitWin ? new Date(exitWin).toISOString() : '-'} 窗内tick数=${inWindowTicks}`);
  console.log(`[早期臂全真] ${allTrueTs ? new Date(allTrueTs).toISOString() : '重放窗内从未全真'}`);
  console.log(`[对照] 主臂全真=01:17:29 fire=${fireTs ? new Date(fireTs).toISOString() : '-'}\n`);
  // 采样输出：市值首次越过 4.7 / 6.0 / 6.7 的时刻 + 窗内每 tick 因子快照（≤40 行）+ 尾部 10 tick
  const firstGt = (v) => { const r = track.find(t => t.mc > v); return r ? new Date(r.ts).toISOString() + ' mc=' + r.mc.toFixed(2) : '从未'; };
  console.log(`[mcap轨迹] >4.7: ${firstGt(4.7)} | >6.0: ${firstGt(6.0)} | >6.7: ${firstGt(6.7)}`);
  console.log('[窗内tick明细] (ts | mc top2 top1 bvb holders nbs/nbl | 假子句)');
  for (const t of track.filter(t => t.inWin).slice(0, 40)) {
    console.log(`  ${new Date(t.ts).toISOString().slice(11, 19)} | ${t.mc.toFixed(2)} ${t.top2?.toFixed(1)} ${t.top1?.toFixed(1)} ${t.bvb?.toFixed(2)} ${t.h} ${t.nbs}/${t.nbl} | ${t.falses.length ? t.falses.join(' ; ').slice(0, 160) : 'ALL-TRUE'}`);
  }
  console.log('[尾部12tick]');
  for (const t of track.slice(-12)) {
    console.log(`  ${new Date(t.ts).toISOString().slice(11, 19)} | ${t.mc.toFixed(2)} win=${t.inWin ? 'Y' : 'n'} | ${t.falses.length ? t.falses.join(' ; ').slice(0, 160) : 'ALL-TRUE'}`);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
