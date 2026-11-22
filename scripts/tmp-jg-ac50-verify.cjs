#!/usr/bin/env node
// 一次性（本地小结果）：核验 0xac50…7777 用户观点「沉寂后超大 burst，超出我们的购买价格」
// 口径：case_ticks 链上真序；quiet=无 ≥0.05B 足额成交的最长段；burst=quiet 后首笔 ≥0.1B 买起的波；
// 购买价格域=统一位置门 +28.5% 上限（flap 地板 5.546e-9）+ bt-v164 信号/门链/成交对照。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const COL = 'a8414632-7c24-4762-9253-c49bb0f53105';
const ADDR = '0xac5055c15c1b4d166e60fefcdcbaf631a7d87777';
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400'; // bt-v164（第二批金狗筛选源）
const FLOOR = 5.546e-9; // flap 地板常量
const CEIL = FLOOR * 1.285; // 统一位置门上限（curVs ≤ +28.5%）
const SUB = 0.05, IGN = 0.1;

const iso = ts => new Date(ts).toISOString().slice(5, 19).replace('T', ' ');

(async () => {
  const sb = dbManager.getClient();
  const { data: member } = await sb.from('case_collection_tokens')
    .select('token_address, platform, sync_state, note, token_meta, tick_count')
    .eq('collection_id', COL).eq('token_address', ADDR).maybeSingle();
  if (!member) { console.error('不在集合'); process.exit(1); }
  const meta = member.token_meta || {};
  console.log(`成员: ${meta.symbol || '?'} platform=${member.platform} ticks=${member.tick_count} note=${member.note}`);

  // ticks 装载（链上真序）
  const rows = []; let cursor = 0;
  for (;;) {
    const { data: page } = await sb.from('case_ticks')
      .select('id, trade_type, bnb_amount, token_amount, price_bnb, price_outlier, block_number, log_index, block_time, sender_address, trader_address')
      .eq('collection_id', COL).eq('token_address', ADDR)
      .gt('id', cursor).order('id', { ascending: true }).limit(1000);
    rows.push(...page);
    if (page.length < 1000) break;
    cursor = page[page.length - 1].id;
  }
  const ticks = rows.map(r => ({
    ts: new Date(r.block_time).getTime(), side: r.trade_type,
    bnb: Number(r.bnb_amount || 0), tok: Number(r.token_amount || 0),
    px: Number(r.price_bnb || 0), out: !!r.price_outlier,
    w: ((r.sender_address || r.trader_address) || '?').toLowerCase(),
  })).sort((a, b) => a.ts - b.ts);
  console.log(`ticks ${ticks.length}，窗 ${iso(ticks[0].ts)} → ${iso(ticks[ticks.length - 1].ts)}`);

  // 可靠价路径
  const pr = ticks.filter(t => !t.out && t.px > 0);
  let athPx = 0, tAth = null;
  for (const t of pr) if (t.px > athPx) { athPx = t.px; tAth = t.ts; }
  const floorVs = px => (px - FLOOR) / FLOOR * 100;
  console.log(`ATH ${athPx.toExponential(3)}（+${floorVs(athPx).toFixed(0)}% vs 地板）@ ${iso(tAth)}`);

  // 最长 quiet 段（无 ≥SUB 足额成交；连续微尘/零成交都算静默）
  const substantial = ticks.filter(t => t.bnb >= SUB);
  let qBest = null;
  for (let i = 1; i < substantial.length; i++) {
    const gap = substantial[i].ts - substantial[i - 1].ts;
    if (!qBest || gap > qBest.gap) qBest = { gap, from: substantial[i - 1], to: substantial[i] };
  }
  console.log(`\n最长静默段: ${(qBest.gap / 1000).toFixed(0)}s  ${iso(qBest.from.ts)} → ${iso(qBest.to.ts)}（后首笔足额=${qBest.to.side} ${qBest.to.bnb.toFixed(2)}B @ ${qBest.to.px.toExponential(2)}）`);

  // burst 波：quiet 出口起（用户口径=沉寂后的 burst），聚合到波歇（≥30s 无 ≥SUB）或 120s 封顶
  const bStart = qBest.to.ts;
  let bEnd = bStart;
  for (const t of substantial) { if (t.ts <= bStart) continue; if (t.ts - bEnd <= 30000) bEnd = Math.max(bEnd, t.ts); }
  const bTicks = ticks.filter(t => t.ts >= bStart && t.ts <= bEnd);
  const buys = bTicks.filter(t => t.side === 'buy'), sells = bTicks.filter(t => t.side === 'sell');
  const buyBnb = buys.reduce((s, t) => s + t.bnb, 0), sellBnb = sells.reduce((s, t) => s + t.bnb, 0);
  const wallets = new Set(buys.map(t => t.w));
  const pxEq = t => (t.out || !t.px ? null : t.px);
  let p0 = null; for (let i = ticks.length - 1; i >= 0; i--) { const p = pxEq(ticks[i]); if (ticks[i].ts < bStart && p) { p0 = p; break; } }
  if (p0 == null) p0 = qBest.from && pxEq(qBest.from) || pr[0].px; // 波前全无可靠价：回落 quiet 段前足额行/窗内首可靠价
  let p1 = null; for (const t of ticks) { const p = pxEq(t); if (t.ts > bEnd && p) { p1 = p; break; } }
  const p1s = p1 == null ? '（窗末=波末，无波后价）' : `（+${floorVs(p1).toFixed(1)}%）`;
  const pPeakIn = Math.max(...bTicks.filter(t => !t.out && t.px > 0).map(t => t.px));
  console.log(`burst 波: ${iso(bStart)} → ${iso(bEnd)}（${((bEnd - bStart) / 1000).toFixed(0)}s）`);
  console.log(`  买 ${buys.length} 笔 ${buyBnb.toFixed(2)}B（${wallets.size} 钱包）｜卖 ${sells.length} 笔 ${sellBnb.toFixed(2)}B｜净 +${(buyBnb - sellBnb).toFixed(2)}B`);
  console.log(`  价: 波前 ${p0.toExponential(2)}（+${floorVs(p0).toFixed(1)}% vs 地板）→ 波内峰 ${pPeakIn.toExponential(2)}（+${floorVs(pPeakIn).toFixed(1)}%）→ 波后 ${p1 == null ? p1s : p1.toExponential(2) + p1s}`);
  console.log(`  波内涨幅 ×${(pPeakIn / p0).toFixed(2)}；波前在位置门内=${p0 <= CEIL ? '是' : '否'}，波后峰在门内=${pPeakIn <= CEIL ? '是' : '否（已越 +28.5% 上限）'}`);

  // 波内价格越上门限的时刻（从波前价起）
  let tCross = null;
  for (const t of bTicks) { const p = pxEq(t); if (p && p > CEIL) { tCross = t.ts; break; } }
  if (tCross) console.log(`  越过位置门上限(+28.5%)时刻: ${iso(tCross)}（burst 开始后 ${((tCross - bStart) / 1000).toFixed(1)}s）`);

  // bt-v164 信号对照
  const { data: sigs } = await sb.from('strategy_signals')
    .select('id, created_at, signal_type, action, status, token_address, leg_id, reason, metadata')
    .eq('experiment_id', EXP).eq('token_address', ADDR)
    .order('created_at', { ascending: true }).limit(50);
  console.log(`\nbt-v164 信号 ${sigs ? sigs.length : 0} 条:`);
  const pxAt = ts => { let best = null; for (const t of pr) { if (t.ts <= ts) best = t; else break; } return best ? best.px : null; };
  for (const s of (sigs || [])) {
    const m = s.metadata || {};
    const gate = m.signalGate || m.factorCheck || m.cheatCheck || m.buyPoint || {};
    const gbits = [m.factorCheck?.rule, m.cheatCheck?.grade, m.cheatCheck?.activityLevel, m.buyPoint?.bucket, m.buyPoint?.status].filter(Boolean).join('/');
    console.log(`  ${new Date(s.created_at).toISOString().slice(5, 19)} ${s.signal_type} leg=${s.leg_id || '-'} ${s.status} ${s.reason || ''} ${gbits} 信号价=${pxAt(new Date(s.created_at).getTime())?.toExponential(2) || '?'}`);
  }
  // 成交
  const { data: trs } = await sb.from('trades')
    .select('id, trade_type, price_bnb, bnb_amount, token_amount, status, created_at')
    .eq('experiment_id', EXP).eq('token_address', ADDR).limit(20);
  console.log(`bt-v164 成交 ${trs ? trs.length : 0} 笔:`, trs && trs.length ? trs.map(t => `${t.trade_type}@${Number(t.price_bnb).toExponential(2)}(${t.status})`).join(' ') : '（未参与）');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
