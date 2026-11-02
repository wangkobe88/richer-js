const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const EXP = 'c53a703a-5b9a-4c03-a874-64e3f65fd6f8';
const TOKEN = '0x5ca91444c8ab56f50a4117232c06ed4eff7d7777';
(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();
  // 1) BUY 信号 metadata（因子快照）
  const { data: sigs } = await client.from('strategy_signals')
    .select('created_at,signal_type,reason,metadata').eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at');
  const buy = (sigs || []).find(s => s.signal_type === 'BUY');
  if (buy) {
    const fr = buy.metadata?.factorResults || buy.metadata?.factors || {};
    const keys = ['tokenAgeSec','tradeCount','marketCap','currentPriceBnb','narrativeRating','buyVolumeBnb','holdersExDust','holderCount',
      'tradesNetBuyRatioLongWin','tradesNetBuyRatioShortWin','top1HolderCircPct','top2HolderCircPct','holderTrendSlope',
      'drawdownFromHighest','crashSpeedPctPerSec','maxCopyWalletHolderCircPct','famousCopyWalletCircPct','peakProfitPct'];
    console.log('BUY signal', buy.created_at);
    for (const k of keys) if (fr[k] !== undefined) console.log('  ', k, '=', fr[k]);
    console.log('  metadata keys:', Object.keys(buy.metadata || {}).join(','));
  }
  // 2) token 创建时间
  const { data: ev, error: eEv } = await client.from('wss_events')
    .select('kind,block_time,payload').eq('token_address', TOKEN).order('block_time').limit(10);
  if (eEv) console.error('events err:', eEv.message);
  for (const e of (ev || [])) console.log('EVENT', e.kind, e.block_time);
  const createdStr = (ev || []).find(e => e.kind === 'token_create')?.block_time;
  const createdMs = createdStr ? Date.parse(createdStr) : null;
  console.log('created_at:', createdStr);
  // 3) 全程 ticks（本票生命周期短，小结果）
  const { data: ticks, error: e5 } = await client.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,price_bnb,price_outlier').eq('token_address', TOKEN)
    .order('block_time', { ascending: true }).limit(20000);
  if (e5) { console.error('ticks err:', e5.message); process.exit(1); }
  console.log('total ticks:', (ticks || []).length);
  const lastSellMs = Date.parse('2026-10-29T12:09:50.046Z');
  // 重建：可靠价链 running max + 回撤 + mcap（supply 从 BUY 快照 marketCap/currentPriceBnb 反推）
  let sup = null;
  if (buy) {
    const fr2 = buy.metadata?.factorResults || buy.metadata?.factors || {};
    if (fr2.marketCap && fr2.currentPriceBnb) sup = fr2.marketCap / fr2.currentPriceBnb;
  }
  console.log('supply(由快照反推):', sup);
  let max = 0, maxT = null;
  const rows = [];
  for (const t of (ticks || [])) {
    if (t.price_outlier) continue;
    const px = t.price_bnb;
    const ms = Date.parse(t.block_time);
    if (px > max) { max = px; maxT = t.block_time; }
    rows.push({ ms, t: t.block_time, px, max, dd: (px / max - 1) * 100, mcap: sup ? px * sup : null, age: createdMs ? (ms - createdMs) / 1000 : null });
  }
  console.log('all-time high:', max.toExponential(4), 'at', maxT);
  // 最后卖出后每 30s 采样的形状
  console.log('\n最后卖出(12:09:50)后 60s 间隔采样:');
  let cursor = lastSellMs;
  const seen = new Set();
  for (const r of rows) {
    if (r.ms < lastSellMs) continue;
    const bucket = Math.floor((r.ms - lastSellMs) / 60000);
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    console.log(' ', r.t, 'px:', r.px.toExponential(3), 'dd%:', r.dd.toFixed(1), 'mcap:', r.mcap ? r.mcap.toFixed(2) : '-', 'age:', r.age !== null ? r.age.toFixed(0) : '-');
  }
  // 再买窗命中检查：卖出后是否存在 dd ∈ (-70,-50)
  const win = rows.filter(r => r.ms >= lastSellMs && r.dd <= -50 && r.dd > -70);
  console.log('\n卖出后 dd∈(-70,-50) tick 数:', win.length, win.length ? '首末: ' + win[0].t + ' ~ ' + win[win.length - 1].t : '');
  // 卖出后全期最低点与最深回撤
  let low = Infinity, lowR = null;
  for (const r of rows) if (r.ms >= lastSellMs && r.px < low) { low = r.px; lowR = r; }
  console.log('卖出后最低价:', low.toExponential(4), 'at', lowR ? lowR.t : '-', '当时 dd%:', lowR ? lowR.dd.toFixed(1) : '-');
  // P2 early 窗：age<600 且 mcap∈(6.0,6.7) 是否存在
  const p2 = rows.filter(r => r.age !== null && r.age < 600 && r.mcap && r.mcap > 6.0 && r.mcap < 6.7);
  console.log('P2 early 窗(age<600 ∧ mcap 6.0-6.7) tick 数:', p2.length, p2.length ? '末例 ' + p2[p2.length - 1].t + ' age=' + p2[p2.length - 1].age.toFixed(0) : '');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
