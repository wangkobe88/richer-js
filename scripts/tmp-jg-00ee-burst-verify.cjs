#!/usr/bin/env node
/**
 * 一次性脚本（本地小结果读取）：核验 0x00ee…7777 「被 burst 提前卖出误伤」
 * 用户观点 2026-11-21：该票被 T189 burst 承接冷盘机制提前卖出，错过大涨幅。
 * 验证链：①集合在位状态（JG-10 曾移除）②bt-v164 信号（找 burstCooldown 卖信号）
 * ③bt-v164 成交（买卖价/时刻）④wss_price_ticks 卖后价格路径（量化误伤）。
 * 只读，不写入。用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const COL = 'a8414632-7c24-4762-9253-c49bb0f53105';
const ADDR = '0x00ee613ddfef429b892aa122c8a4fde764f47777';
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400'; // bt-v164（第二批金狗筛选源）
const FLOOR = 5.546e-9; // flap 地板常量

const iso = ts => new Date(ts).toISOString().slice(16 - 11, 19).replace('T', ' ');

(async () => {
  const sb = dbManager.getClient();

  // 1. 集合在位状态（JG-10 2026-11-21 移除，预期不在）
  const { data: member } = await sb.from('case_collection_tokens')
    .select('token_address, platform, sync_state, note, token_meta, tick_count')
    .eq('collection_id', COL).eq('token_address', ADDR).maybeSingle();
  console.log(member
    ? `①集合在位: ${(member.token_meta || {}).symbol || '?'} platform=${member.platform} sync_state=${member.sync_state} ticks=${member.tick_count} note=${member.note || '(空)'}`
    : '①集合不在位（与 JG-10 移除记载一致）');

  // 2. 全实验成交对照（哪些实验参与过这票）
  const { data: allTrades, error: atErr } = await sb.from('trades')
    .select('id, experiment_id, trade_direction, trade_status, success, input_amount, output_amount, unit_price, created_at, metadata')
    .eq('token_address', ADDR).limit(100);
  if (atErr) throw new Error(atErr.message);
  const expIds = [...new Set((allTrades || []).map(t => t.experiment_id))];
  const expNames = {};
  if (expIds.length) {
    const { data: exps } = await sb.from('experiments').select('id, name').in('id', expIds);
    for (const e of (exps || [])) expNames[e.id] = e.name;
  }
  console.log(`\n②全实验成交 ${allTrades.length} 笔:`);
  for (const t of allTrades) {
    console.log(`  ${expNames[t.experiment_id] || t.experiment_id.slice(0, 8)} ${t.trade_direction} unit=${Number(t.unit_price).toExponential(3)} in=${Number(t.input_amount).toFixed(3)} out=${Number(t.output_amount).toExponential(3)} ${t.trade_status}/${t.success} @${new Date(t.created_at).toISOString().slice(5, 19)}${t.metadata && (t.metadata.reason || t.metadata.closeReason) ? ' reason=' + (t.metadata.reason || t.metadata.closeReason) : ''}`);
  }

  // 3. bt-v164 信号全列（找 burstCooldown 卖信号）
  const { data: sigs, error: sErr } = await sb.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP).eq('token_address', ADDR)
    .order('created_at', { ascending: true }).limit(50);
  if (sErr) throw new Error(sErr.message);
  console.log(`\n③bt-v164 信号 ${sigs.length} 条:`);
  for (const s of sigs) {
    const m = s.metadata || {};
    const extra = [];
    if (m.burstCooldownInfo) extra.push(`burstCooldown=${JSON.stringify(m.burstCooldownInfo)}`);
    if (m.burstCooldownArm) extra.push(`arm=${JSON.stringify(m.burstCooldownArm)}`);
    if (m.stallClose) extra.push(`stallClose=${JSON.stringify(m.stallClose)}`);
    console.log(`  ${new Date(s.created_at).toISOString().slice(5, 19)} ${s.signal_type} leg=${s.leg_id || '-'} ${(s.status !== undefined ? s.status : '')} ${s.reason || ''} ${extra.join(' ')}`);
  }

  // 4. ticks 价格路径（wss_price_ticks 全局行，token 单票 ~1k）
  const rows = []; let cursor = 0;
  for (;;) {
    const { data: page, error: pErr } = await sb.from('wss_price_ticks')
      .select('id, trade_type, bnb_amount, price_bnb, price_outlier, block_time')
      .eq('token_address', ADDR)
      .gt('id', cursor).order('id', { ascending: true }).limit(1000);
    if (pErr) throw new Error(pErr.message);
    if (!page.length) break;
    rows.push(...page);
    if (page.length < 1000) break;
    cursor = page[page.length - 1].id;
  }
  const ticks = rows.map(r => ({
    ts: new Date(r.block_time).getTime(), side: r.trade_type,
    bnb: Number(r.bnb_amount || 0), px: Number(r.price_bnb || 0), out: !!r.price_outlier,
  })).sort((a, b) => a.ts - b.ts || 0);
  const pr = ticks.filter(t => !t.out && t.px > 0); // 可靠价
  console.log(`\n④ticks ${ticks.length} 行（可靠价 ${pr.length}）窗 ${new Date(ticks[0].ts).toISOString().slice(5, 19)} → ${new Date(ticks[ticks.length - 1].ts).toISOString().slice(5, 19)}`);
  let athPx = 0, tAth = null;
  for (const t of pr) if (t.px > athPx) { athPx = t.px; tAth = t.ts; }
  const vsFloor = px => ((px - FLOOR) / FLOOR * 100);
  console.log(`  ATH ${athPx.toExponential(3)}（+${vsFloor(athPx).toFixed(0)}% vs flap 地板）@ ${new Date(tAth).toISOString().slice(5, 19)}`);

  // 5. bt-v164 成交时序与卖后路径（若有成交）
  const myTrades = (allTrades || []).filter(t => t.experiment_id === EXP)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  if (!myTrades.length) { console.log('\n⑤bt-v164 无成交——「被 burst 卖出」不成立，须另找实验'); return; }
  const pxAt = ts => { let best = null; for (const t of pr) { if (t.ts <= ts) best = t; else break; } return best ? best.px : null; };
  console.log(`\n⑤bt-v164 成交时序:`);
  let sellTs = null, sellPx = null, buyPx = null;
  for (const t of myTrades) {
    const ts = new Date(t.created_at).getTime();
    const mkt = pxAt(ts);
    const dir = String(t.trade_direction || '').toLowerCase();
    if (dir === 'buy') buyPx = Number(t.unit_price);
    else { sellTs = ts; sellPx = Number(t.unit_price); }
    console.log(`  ${new Date(ts).toISOString().slice(5, 19)} ${t.trade_direction} 成交价=${Number(t.unit_price).toExponential(3)}（vs 地板 +${vsFloor(Number(t.unit_price)).toFixed(1)}%）当时市场价=${mkt ? mkt.toExponential(3) : '?'} ${t.trade_status}/${t.success}`);
  }
  if (sellPx && sellTs) {
    const after = pr.filter(t => t.ts > sellTs);
    let peak = 0, tPeak = null;
    for (const t of after) if (t.px > peak) { peak = t.px; tPeak = t.ts; }
    console.log(`\n卖后路径: 卖出 ${new Date(sellTs).toISOString().slice(5, 19)} @${sellPx.toExponential(3)}（+${vsFloor(sellPx).toFixed(1)}%）`);
    if (peak > 0) {
      console.log(`  卖后峰 ${peak.toExponential(3)}（+${vsFloor(peak).toFixed(0)}%）@ ${new Date(tPeak).toISOString().slice(5, 19)}（卖后 ${((tPeak - sellTs) / 1000).toFixed(0)}s）`);
      console.log(`  卖后峰/卖价 = ×${(peak / sellPx).toFixed(2)}；买价→卖价 ×${buyPx ? (sellPx / buyPx).toFixed(2) : '?'}；买价→卖后峰 ×${buyPx ? (peak / buyPx).toFixed(2) : '?'}`);
    } else console.log('  卖后无可靠价行（卖出即窗末）');
    const last = pr[pr.length - 1];
    console.log(`  窗末价 ${last.px.toExponential(3)}（+${vsFloor(last.px).toFixed(0)}%）@ ${new Date(last.ts).toISOString().slice(5, 19)}`);
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
