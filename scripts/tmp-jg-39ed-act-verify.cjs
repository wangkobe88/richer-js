#!/usr/bin/env node
/**
 * 一次性脚本（本地小结果读取）：核验 0x39ed…7777（铁匠）用户观点
 * 「活跃度变高后，价格已经脱离买入范围」——验证：活跃度放量时刻的价格 vs 统一位置门上限。
 * ①集合在位+现有 note ②bt-v164 信号/成交 ③价格路径 × 活跃度时序（10s 窗买量/笔数 vs curVs）。
 * 只读，不写入。用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const COL = 'a8414632-7c24-4762-9253-c49bb0f53105';
const ADDR = '0x39ed13ccb5e067b7fce459548501cf2659287777';
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400'; // bt-v164
const FLAP_FLOOR = 5.546e-9;
const FOUR_FLOOR = 4496173469e-18;
const CEIL_PCT = 28.5; // 统一位置门上限 curVs ≤ +28.5%

(async () => {
  const sb = dbManager.getClient();

  // 1. 集合在位 + 现有备注
  const { data: member } = await sb.from('case_collection_tokens')
    .select('token_address, platform, sync_state, note, token_meta, tick_count')
    .eq('collection_id', COL).eq('token_address', ADDR).maybeSingle();
  if (!member) { console.log('①集合不在位！（用户说在——须先核查）'); }
  else {
    const meta = member.token_meta || {};
    console.log(`①集合在位: ${meta.symbol || '?'} / ${meta.name || '?'} platform=${member.platform} sync_state=${member.sync_state} ticks=${member.tick_count}`);
    console.log(`  现有 note: ${member.note || '(空)'}`);
  }

  // 2. 平台与计价（token_create/quote）
  const { data: evs } = await sb.from('wss_events').select('kind, platform, block_time, payload')
    .eq('token_address', ADDR).limit(5);
  let platform = member ? member.platform : null;
  for (const e of (evs || [])) {
    platform = platform || e.platform;
    const p = e.payload || {};
    console.log(`[event] ${e.kind} platform=${e.platform} @ ${e.block_time} symbol=${p.symbol || ''} quoteToken=${p.quoteToken || '-'}`);
  }

  // 3. bt-v164 信号/成交
  const { data: sigs } = await sb.from('strategy_signals').select('*')
    .eq('experiment_id', EXP).eq('token_address', ADDR).limit(50);
  console.log(`\n②bt-v164 信号 ${sigs.length} 条:`);
  for (const s of sigs) {
    const m = s.metadata || {};
    const gbits = [m.factorCheck?.rule, m.cheatCheck?.grade, m.cheatCheck?.activityLevel, m.buyPoint?.status, m.buyPoint?.bucket].filter(Boolean).join('/');
    console.log(`  ${new Date(s.created_at).toISOString().slice(5, 19)} ${s.signal_type} ${s.reason || ''} ${gbits}`);
  }
  const { data: trs } = await sb.from('trades')
    .select('id, trade_direction, unit_price, trade_status, created_at')
    .eq('experiment_id', EXP).eq('token_address', ADDR).limit(20);
  console.log(`bt-v164 成交 ${trs.length} 笔${trs.length ? ': ' + trs.map(t => `${t.trade_direction}@${new Date(t.created_at).toISOString().slice(11, 19)}`).join(' ') : '（未参与）'}`);

  // 4. ticks 价格路径 × 活跃度（10s 窗）
  const rows = []; let cur = 0;
  for (;;) {
    const { data: page } = await sb.from('wss_price_ticks')
      .select('id, trade_type, bnb_amount, price_bnb, price_outlier, block_time')
      .eq('token_address', ADDR).gt('id', cur).order('id', { ascending: true }).limit(1000);
    if (!page.length) break;
    rows.push(...page); if (page.length < 1000) break; cur = page[page.length - 1].id;
  }
  const ticks = rows.map(r => ({
    ts: new Date(r.block_time).getTime(), side: String(r.trade_type).toLowerCase(),
    bnb: Number(r.bnb_amount || 0), px: Number(r.price_bnb || 0), out: !!r.price_outlier,
  })).sort((a, b) => a.ts - b.ts);
  const pr = ticks.filter(t => !t.out && t.px > 0);
  console.log(`\n③ticks ${ticks.length} 行（可靠价 ${pr.length}）窗 ${new Date(ticks[0].ts).toISOString().slice(5, 19)} → ${new Date(ticks[ticks.length - 1].ts).toISOString().slice(5, 19)}`);

  // launch 锚：FA 口径=地板常量与首可靠价兜底（quote 盘用 FLAP_FLOOR）
  const firstPx = pr[0].px;
  const floor = platform === 'fourmeme' ? FOUR_FLOOR : FLAP_FLOOR;
  const launch = firstPx > floor ? firstPx : floor; // 首可靠价高于常量地板时以首可靠价为 launch（低开票）
  const curVs = px => (px - launch) / launch * 100;
  let athPx = 0, tAth = null;
  for (const t of pr) if (t.px > athPx) { athPx = t.px; tAth = t.ts; }
  console.log(`  launch 锚=${launch.toExponential(3)}（platform=${platform || '?'}，首可靠价 ${firstPx.toExponential(3)}）`);
  console.log(`  ATH ${athPx.toExponential(3)}（+${curVs(athPx).toFixed(0)}% vs launch）@ ${new Date(tAth).toISOString().slice(5, 19)}`);

  // 价格越 +28.5% 上限的时刻（买入域封顶）
  let tCeil = null;
  for (const t of pr) if (curVs(t.px) > CEIL_PCT) { tCeil = t.ts; break; }
  console.log(`  价格越 +${CEIL_PCT}% 买入域上限时刻: ${tCeil ? new Date(tCeil).toISOString().slice(5, 19) : '窗内未越（?）'}`);

  // 活跃度时序：非重叠 10s 窗（买量/笔数/新钱包），前 40 窗 + 放量窗
  const t0 = ticks[0].ts;
  const winN = Math.ceil((ticks[ticks.length - 1].ts - t0) / 10000);
  const wins = [];
  for (let i = 0; i < winN; i++) {
    const a = t0 + i * 10000, b = a + 10000;
    const seg = ticks.filter(t => t.ts >= a && t.ts < b);
    if (!seg.length) continue;
    const buys = seg.filter(t => t.side === 'buy');
    const pxEnd = [...seg].reverse().find(t => !t.out && t.px > 0);
    wins.push({ i, a, nBuy: buys.length, buyBnb: buys.reduce((s, t) => s + t.bnb, 0), n: seg.length, pxEnd: pxEnd ? pxEnd.px : null });
  }
  console.log(`\n④活跃度时序（非重叠 10s 窗，前 40 个非空窗 + 首个买量 ≥0.1B 窗）:`);
  const firstActive = wins.find(w => w.buyBnb >= 0.1);
  const show = new Set(wins.slice(0, 40));
  if (firstActive) show.add(firstActive);
  for (const w of wins) {
    if (!show.has(w)) continue;
    const vs = w.pxEnd ? curVs(w.pxEnd).toFixed(1) : '?';
    const mark = (firstActive && w === firstActive) ? '  ← 首个买量≥0.1B 窗' : '';
    console.log(`  +${String(Math.round((w.a - t0) / 1000)).padStart(5)}s 买${String(w.nBuy).padStart(3)}笔/${w.buyBnb.toFixed(3)}B 全${String(w.n).padStart(3)}笔 价+${vs}%${mark}`);
  }
  if (firstActive && tCeil) {
    console.log(`\n⑤判定: 首个活跃窗 @ +${((firstActive.a - t0) / 1000).toFixed(0)}s（买 ${firstActive.nBuy} 笔/${firstActive.buyBnb.toFixed(2)}B）当时价 +${firstActive.pxEnd ? curVs(firstActive.pxEnd).toFixed(1) : '?'}%；价格越限 @ +${((tCeil - t0) / 1000).toFixed(0)}s`);
    console.log(`   活跃窗价已越 +${CEIL_PCT}%=${firstActive.pxEnd ? curVs(firstActive.pxEnd) > CEIL_PCT : '?'}；越限早于/晚于首个活跃窗: ${tCeil <= firstActive.a ? '越限在前' : `${((tCeil - firstActive.a) / 1000).toFixed(0)}s 在后`}`);
  }
  // 越限前的活跃度总量（买入域窗口内有多少量——够不够触发任何腿）
  if (tCeil) {
    const pre = ticks.filter(t => t.ts < tCeil);
    const preBuys = pre.filter(t => t.side === 'buy');
    console.log(`  越限前累计: ${pre.length} 笔（买 ${preBuys.length} 笔 ${preBuys.reduce((s, t) => s + t.bnb, 0).toFixed(3)}B）；越限前最长 10s 买量窗=${Math.max(0, ...wins.filter(w => w.a < tCeil).map(w => w.buyBnb)).toFixed(3)}B`);
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
