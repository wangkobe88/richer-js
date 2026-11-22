#!/usr/bin/env node
// 一次性（本地小结果）：T205 四臂对拍结果对照。四臂实验 signals/trades 汇总 +
// GWC 案票核对 + 拦截分布 diff。只读。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const ARMS = [
  { key: 'ctrl', name: 'bt-v170-t205-ctrl' },
  { key: 'stage', name: 'bt-v171-t205-stage' },
  { key: 'volleg', name: 'bt-v172-t205-volleg' },
  { key: 'both', name: 'bt-v173-t205-both' },
];
const GWC = '0xb71209cbe0ba47afdbc0201f2d2647e9919b7777';

(async () => {
  const sb = dbManager.getClient();
  const { data: exps } = await sb.from('experiments').select('id,experiment_name').in('experiment_name', ARMS.map(a => a.name));
  const idOf = Object.fromEntries((exps || []).map(e => [e.experiment_name, e.id]));
  const summary = {};
  for (const arm of ARMS) {
    const id = idOf[arm.name];
    if (!id) { console.log(`${arm.key}: 实验不存在！`); continue; }
    const { data: trs } = await sb.from('trades').select('trade_direction, input_amount, output_amount, trade_status, token_address').eq('experiment_id', id);
    const buys = (trs || []).filter(t => t.trade_direction === 'buy' && t.trade_status === 'success');
    const sells = (trs || []).filter(t => t.trade_direction === 'sell' && t.trade_status === 'success');
    let invested = 0, returned = 0;
    for (const t of buys) invested += Number(t.input_amount) || 0;
    for (const t of sells) returned += Number(t.output_amount) || 0;
    // token 级去重成交票
    const { data: sigs } = await sb.from('strategy_signals').select('token_address, signal_type, metadata, executed').eq('experiment_id', id);
    const buySigs = (sigs || []).filter(s => s.signal_type === 'BUY');
    const blocked = {};
    for (const s of buySigs) {
      const r = (s.metadata || {}).execution_reason || '(无拒因-未执行?)';
      if (!s.executed) blocked[r] = (blocked[r] || 0) + 1;
    }
    const tokensTraded = new Set(buys.map(t => t.token_address).filter(Boolean)).size;
    summary[arm.key] = { id, invested, returned, net: returned - invested, buyN: buys.length, sellN: sells.length, tokensTraded, sigN: buySigs.length, blocked };
    console.log(`\n[${arm.key}] ${arm.name}: 买 ${buys.length} 笔/${invested.toFixed(3)}B → 卖 ${sells.length} 笔/${returned.toFixed(3)}B = 净 ${ (returned - invested).toFixed(4) }B | 信号 ${buySigs.length} | 成交票 ${tokensTraded}`);
    const top = Object.entries(blocked).sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log('  拦截 top10:', top.map(([k, v]) => `${k}=${v}`).join(' '));
  }
  // 臂间 diff
  const keys = Object.keys(summary);
  if (keys.length === 4) {
    console.log('\n=== 净额对照 ===');
    for (const k of keys) console.log(`  ${k.padEnd(7)} ${summary[k].net.toFixed(4)}B  (买${summary[k].buyN}/卖${summary[k].sellN})`);
    console.log(`  stage−ctrl = ${(summary.stage.net - summary.ctrl.net).toFixed(4)}`);
    console.log(`  volleg−ctrl = ${(summary.volleg.net - summary.ctrl.net).toFixed(4)}`);
    console.log(`  both−ctrl  = ${(summary.both.net - summary.ctrl.net).toFixed(4)}`);
  }
  // GWC 案票四臂状态
  console.log(`\n=== GWC 0xb712…7777 案票 ===`);
  for (const arm of ARMS) {
    const id = idOf[arm.name];
    if (!id) continue;
    const { data: gs } = await sb.from('strategy_signals').select('created_at, executed, metadata').eq('experiment_id', id).eq('token_address', GWC);
    const { data: gt } = await sb.from('trades').select('trade_direction, input_amount, output_amount, trade_status, created_at').eq('experiment_id', id).eq('token_address', GWC);
    for (const s of gs || []) {
      const m = s.metadata || {};
      console.log(`  [${arm.key}] ${new Date(s.created_at).toISOString().slice(11, 19)} executed=${s.executed} reason=${m.execution_reason || '-'} arms=${JSON.stringify(m.factorCheck?.arms || [])} stageCold=${m.actFrontGate?.stageCold ?? m.factorCheck?.activity?.trace?.stageCold ?? '-'}`);
    }
    for (const t of gt || []) console.log(`  [${arm.key}] 成交 ${t.trade_direction} ${Number(t.trade_direction === 'buy' ? t.input_amount : t.output_amount)} @ ${new Date(t.created_at).toISOString().slice(11, 19)} ${t.trade_status}`);
    if (!gs?.length && !gt?.length) console.log(`  [${arm.key}] 零信号零成交`);
  }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
