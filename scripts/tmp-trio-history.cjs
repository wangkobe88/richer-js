#!/usr/bin/env node
/**
 * 临时脚本：验证「0.15 簇推过人气门」是否在历史盘复现
 * 对 trio 买过的 4 张 token：链上逐笔累计买量/买家数，找 buyVolume>=1.25 ∧ holders>=10 首次满足点，
 * 并标注 trio 买入；对照我方 strategy_signals / trades 结果。
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env') });
const { dbManager } = require('../src/services/dbManager');
const TOKENS = [
  ['乌龟', '0xb2782a4a27b1fc104c377a06e3cf455ca0fe7777'],
  ['CZCOIN', '0x39b417598c348990948738891911fbe3563f7777'],
  ['태리', '0x83a5b763c89ebd6a4693fc57482fc84851507777'],
  ['金龙', '0x68a7ec75306c4793656e53b8eed4124e05357777'],
  ['0x3ff3', '0x3ff3c81f46eb96a96809bda22badbe3e42e27777'],
];
const TRIO = new Set([
  '0xba4bf95d5473beac646e14d79d7a71b769e40f4a',
  '0x880fb55b8caa2e39acb83b0ff02a2d6e7199d9d1',
  '0xcf293752a12eabfa948fd5a2a1b5857be895fd74',
]);
const TARGET = '0x68c49e3ace53f23c0086471a126202cbfd939924';
const PAGE = 1000;
const db = dbManager.getClient();
const ws = r => (r.sender_address || r.trader_address || '').toLowerCase();

async function fetchTok(tok, loIso, hiIso) {
  const out = [];
  let bt = null, id = 0;
  for (;;) {
    let q = db.from('wss_price_ticks')
      .select('id,trade_type,trader_address,sender_address,bnb_amount,token_amount,block_number,log_index,block_time')
      .eq('token_address', tok).gte('block_time', loIso).lte('block_time', hiIso);
    if (bt) q = q.or(`block_time.gt.${bt},and(block_time.eq.${bt},id.gt.${id})`);
    const { data, error } = await q.order('block_time', { ascending: true }).order('id', { ascending: true }).limit(PAGE);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < PAGE || out.length > 30000) break;
    bt = data[data.length - 1].block_time; id = data[data.length - 1].id;
  }
  out.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
  return out;
}

(async () => {
  for (const [name, tok] of TOKENS) {
    const ev = await db.from('wss_events').select('payload,block_time,platform').eq('kind', 'token_create').eq('token_address', tok).limit(1);
    const p = ev.data?.[0]?.payload || {};
    const created = ev.data?.[0]?.block_time;
    if (!created) { console.log(`\n=== ${name} ${tok}: 无创建事件（跳过）`); continue; }
    const t0 = new Date(created).getTime();
    const rows = await fetchTok(tok, created, new Date(t0 + 10 * 60000).toISOString());
    console.log(`\n=== ${name} ${tok}  platform=${ev.data[0].platform} 创建=${created} creator=${p.creator}`);

    let cum = 0; const buyers = new Set(); let gate = null, trioSeen = [];
    let seq = 0;
    for (const r of rows) {
      const bnb = Number(r.bnb_amount) || 0;
      if (bnb < 0.001) continue;               // 尘 tick 不进因子域
      if (r.trade_type !== 'buy') continue;
      seq++;
      cum += bnb; buyers.add(ws(r));
      const w = ws(r);
      const isTrio = TRIO.has(w);
      if (isTrio) trioSeen.push({ seq, dt: ((new Date(r.block_time) - t0) / 1000).toFixed(0), bnb, blk: r.block_number, w });
      if (!gate && cum >= 1.25 && buyers.size >= 10) gate = { seq, cum, buyers: buyers.size, dt: ((new Date(r.block_time) - t0) / 1000).toFixed(1), by: w, bnb };
      if (WATCH(w)) continue;
    }
    function WATCH(w) { return false; }
    console.log(`  10min 买 ${seq} 笔 / ${cum.toFixed(3)} BNB / ${buyers.size} 买家`);
    console.log(`  首次门槛满足: ${gate ? `seq#${gate.seq} +${gate.dt}s cum=${gate.cum.toFixed(3)} buyers=${gate.buyers} 本笔=${gate.by.slice(0, 10)}… ${gate.bnb.toFixed(3)}` : '未满足'}`);
    console.log(`  trio 买入: ${trioSeen.length} 笔 ` + trioSeen.map(x => `+${x.dt}s ${x.bnb.toFixed(3)}(${x.w.slice(0, 6)}…,blk${x.blk})`).join(' '));
    if (gate && trioSeen.length) {
      const trioBnb = trioSeen.reduce((a, x) => a + x.bnb, 0);
      const trioBefore = trioSeen.filter(x => x.seq <= gate.seq).reduce((a, x) => a + x.bnb, 0);
      console.log(`  trio 合计=${trioBnb.toFixed(3)}BNB，门点前已计入=${trioBefore.toFixed(3)}BNB → 无 trio 时门点累计=${(gate.cum - trioBefore).toFixed(3)}BNB`);
    }
    // 我方信号/成交
    const sig = await db.from('strategy_signals').select('signal_type,created_at,metadata').eq('token_address', tok).order('created_at', { ascending: true }).limit(5);
    const tr = await db.from('trades').select('trade_direction,input_amount,output_amount,created_at,executed_at').eq('token_address', tok).order('created_at', { ascending: true }).limit(10);
    console.log(`  我方 signals: ${(sig.data || []).length}` + (sig.data || []).map(s => ` [${s.signal_type} ${s.created_at.slice(11, 19)} ${s.metadata?.execution_status || ''}]`).join(''));
    for (const x of tr.data || []) console.log(`  我方 trade: ${x.created_at.slice(11, 19)} ${x.trade_direction} in=${x.input_amount} out=${x.output_amount} exec=${x.executed_at?.slice(11, 19)}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
