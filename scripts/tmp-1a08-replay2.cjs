#!/usr/bin/env node
// 一次性（v2）：0x1a08 票按回测引擎真形重放——fire=advance(下一 tick 时刻)+状态截至
// 上一笔（debounce 200ms/1s maxWait，秒粒度下每个秒边界即一次 fire）。逐 fire 评
// 14 腿条件，枚举全部 fire 点的腿真假与阻断因子。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');

const PACK_ID = '479f3109-41ac-4424-bb2b-5309c47ee88a';
const TOKEN = '0x1a0810861af30ed2b85ec2c195f36fb58fc97777';
const TICK_COLS = ['token_address', 'trade_type', 'trader_address', 'sender_address', 'price_bnb', 'price_usd', 'bnb_amount', 'token_amount', 'block_number', 'block_time', 'tx_hash', 'log_index', 'price_outlier', 'platform', 'quote_token'];

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const iso = ts => new Date(ts).toISOString().slice(11, 19);

(async () => {
  const sb = dbManager.getClient();

  const { data: pack, error: e0 } = await sb.from('strategy_library').select('definition').eq('id', PACK_ID).single();
  if (e0) throw new Error(e0.message);
  const legs = pack.definition.buyLegs.map((l, i) => ({ idx: i, id: `buy_0_${i + 1}`, condition: l.condition }));

  const { data: ev } = await sb.from('wss_events')
    .select('kind, platform, block_time, payload')
    .eq('token_address', TOKEN).eq('kind', 'token_create').limit(1);
  const created = ev && ev[0] ? new Date(ev[0].block_time || ev[0].created_at).getTime() : null;
  const platform = ev && ev[0] ? ev[0].platform : 'flap';

  const { data: rows, error: e3 } = await sb.from('wss_price_ticks')
    .select(TICK_COLS.join(','))
    .eq('token_address', TOKEN)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(1000);
  if (e3) throw new Error(e3.message);

  const ticks = rows.map(r => ({
    token_address: r.token_address,
    trade_type: r.trade_type,
    trader_address: r.trader_address,
    sender_address: r.sender_address || null,
    price_bnb: Number(r.price_bnb),
    price_usd: r.price_usd === null ? null : Number(r.price_usd),
    bnb_amount: Number(r.bnb_amount || 0),
    token_amount: Number(r.token_amount || 0),
    block_number: r.block_number,
    timestamp: new Date(r.block_time).getTime(),
    tx_hash: r.tx_hash,
    log_index: r.log_index,
    price_outlier: r.price_outlier || false,
    platform: r.platform || platform,
    quote_token: r.quote_token || null,
  })).sort((a, b) => a.block_number - a.block_number || a.log_index - b.log_index);

  const fa = new FourMemeFactorAggregator({ fourmemeWs: {}, maintainClassifierTracks: false, maintainTpaTracks: false }, logger);
  fa.registerToken(TOKEN, { createdAtMs: created, platform, name: 'REPLAY', symbol: 'RPL' });
  const ce = new ConditionEvaluator();

  // ── 引擎真形重放：按秒分组；每个新秒 T 先 fire（asOf=T，状态截至 <T 的全部
  //    ticks——advance 在 processTick 之前；秒粒度下 T-lastTouch≥1s>200ms 恒 fire），
  //    再喂 T 秒全部 ticks，再 touch ──
  const byTs = new Map();
  for (const t of ticks) {
    if (!byTs.has(t.timestamp)) byTs.set(t.timestamp, []);
    byTs.get(t.timestamp).push(t);
  }
  const tsList = [...byTs.keys()].sort((a, b) => a - b);

  const fires = [];
  for (let i = 0; i < tsList.length; i++) {
    const T = tsList[i];
    // fire：状态截至 <T
    const f = fa.buildFactorMap(TOKEN, T);
    if (f) {
      const legTrue = legs.map(l => ce.evaluate(l.condition, f) ? 1 : 0);
      fires.push({ fireTs: T, f, legTrue, anyTrue: legTrue.some(x => x) });
    }
    // 喂 T 秒 ticks
    for (const t of byTs.get(T)) fa.processTick(t, { emitFactors: false });
  }
  // 尾部 advance(lastTickTs + 10min)
  const tailTs = tsList[tsList.length - 1] + 10 * 60 * 1000;
  const fTail = fa.buildFactorMap(TOKEN, tailTs);
  if (fTail) {
    const legTrue = legs.map(l => ce.evaluate(l.condition, fTail) ? 1 : 0);
    fires.push({ fireTs: tailTs, f: fTail, legTrue, anyTrue: legTrue.some(x => x) });
  }

  // ── 输出 ──
  console.log(`fire 总数 ${fires.length}（每秒边界一次+尾部）`);
  const trueFires = fires.filter(x => x.anyTrue);
  console.log(`\n===== 腿条件为真的 fire（引擎真形）共 ${trueFires.length} 次 =====`);
  for (const r of trueFires) {
    const tl = r.legTrue.map((v, i) => v ? legs[i].id.replace('buy_0_', 'L') : null).filter(Boolean);
    console.log(`fire@${iso(r.fireTs)} true=[${tl.join(',')}] curVs=${r.f.currentVsLaunchPct?.toFixed(1)} hExD=${r.f.holdersExDust} actTot=${r.f.actTotalBnb?.toFixed(3)} tCnt=${r.f.tradeCount} buyVol=${r.f.buyVolumeBnb?.toFixed(2)} px=${r.f.currentPrice?.toExponential(3)}`);
  }

  // 关键窗口的逐 fire 关键因子（L1=buy_0_1 阻断定位）
  console.log('\n===== 关键窗口逐 fire 关键因子 =====');
  const winFires = fires.filter(r => {
    const s = iso(r.fireTs);
    return (s >= '14:05:50' && s <= '14:06:00') || (s >= '14:07:03' && s <= '14:07:12') || (s >= '14:09:35' && s <= '14:10:00') || (s >= '14:18:18' && s <= '14:18:26');
  });
  for (const r of winFires) {
    const reasons = [];
    if (!(r.f.tradeCount >= 6)) reasons.push('tradeCount');
    if (!(r.f.buyVolumeBnb >= 1)) reasons.push('buyVolumeBnb');
    if (!((r.f.holdersExDust ?? -1) >= 4)) reasons.push(`hExD=${r.f.holdersExDust}<4`);
    if (!((r.f.currentVsLaunchPct ?? 1e9) <= 28.5)) reasons.push(`curVs=${r.f.currentVsLaunchPct?.toFixed(1)}>28.5`);
    if (!((r.f.actTotalBnb ?? -1) >= 0.1)) reasons.push(`actTot=${r.f.actTotalBnb?.toFixed(3)}<0.1`);
    console.log(`fire@${iso(r.fireTs)} px=${r.f.currentPrice?.toExponential(3)} curVs=${r.f.currentVsLaunchPct?.toFixed(1)} hExD=${r.f.holdersExDust} holders=${r.f.holders} top1Circ=${r.f.top1HolderCircPct?.toFixed(1)}% top2Circ=${r.f.top2HolderCircPct?.toFixed(1)}% buyWallets=${r.f.buyWallets} actTot=${r.f.actTotalBnb?.toFixed(3)} tCnt=${r.f.tradeCount} buyVol=${r.f.buyVolumeBnb?.toFixed(2)} → ${reasons.length ? '阻断: ' + reasons.join(',') : 'L1 全过'}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
