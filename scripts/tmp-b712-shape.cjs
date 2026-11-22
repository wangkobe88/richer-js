#!/usr/bin/env node
/**
 * 一次性（本地小结果）：0xb712…7777（GWC）bt-v164 案形状核验——用户两观点：
 * ①活跃度拦截主要该管「火过一段时间后 low=流动性失去」，前期不重要；
 * ②tail_dip_knife 在交易量极少时没道理（不是从高点下来的）。
 * 只读：平台/集合在位/tick 全路径（何时火/ATH 量级/锚前 60s 明细/锚后前向收益）。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const ADDR = '0xb71209cbe0ba47afdbc0201f2d2647e9919b7777';
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400'; // bt-v164
const ANCHOR = new Date('2026-10-03T23:54:36Z').getTime();
const FLAP_FLOOR = 5.546e-9;
const FOUR_FLOOR = 4496173469e-18;

(async () => {
  const sb = dbManager.getClient();

  // 0. 平台/计价 + 集合在位
  const { data: evs } = await sb.from('wss_events').select('kind, platform, block_time, payload')
    .eq('token_address', ADDR).limit(5);
  let platform = null;
  for (const e of (evs || [])) {
    platform = platform || e.platform;
    const p = e.payload || {};
    console.log(`[event] ${e.kind} platform=${e.platform} @ ${e.block_time} symbol=${p.symbol || ''} quote=${p.quoteToken || '-'}`);
  }
  const { data: member } = await sb.from('case_collection_tokens')
    .select('token_address, platform, sync_state, note, token_meta, tick_count')
    .eq('collection_id', 'a8414632-7c24-4762-9253-c49bb0f53105').eq('token_address', ADDR).maybeSingle();
  console.log('金狗集合在位:', member ? `${(member.token_meta || {}).symbol} sync=${member.sync_state} note=${member.note || '(空)'}` : '不在');

  // 1. 全量 ticks（单 token 分页）
  const rows = []; let cur = 0;
  for (;;) {
    const { data: page } = await sb.from('wss_price_ticks')
      .select('id, trade_type, bnb_amount, price_bnb, price_outlier, block_time, sender_address')
      .eq('token_address', ADDR).gt('id', cur).order('id', { ascending: true }).limit(1000);
    if (!page.length) break;
    rows.push(...page); if (page.length < 1000) break; cur = page[page.length - 1].id;
  }
  const ticks = rows.map(r => ({
    ts: new Date(r.block_time).getTime(), side: String(r.trade_type).toLowerCase(),
    bnb: Number(r.bnb_amount || 0), px: Number(r.price_bnb || 0), out: !!r.price_outlier,
    snd: r.sender_address,
  })).sort((a, b) => a.ts - b.ts);
  const pr = ticks.filter(t => !t.out && t.px > 0);
  const t0 = ticks[0].ts;
  console.log(`\nticks ${ticks.length} 行（可靠价 ${pr.length}）窗 +0s → +${((ticks[ticks.length - 1].ts - t0) / 1000).toFixed(0)}s`);

  const firstPx = pr[0].px;
  const floor = platform === 'fourmeme' ? FOUR_FLOOR : FLAP_FLOOR;
  const launch = firstPx > floor ? firstPx : floor;
  const curVs = px => (px - launch) / launch * 100;
  let athPx = 0, tAth = null, athIdx = -1;
  pr.forEach((t, i) => { if (t.px > athPx) { athPx = t.px; tAth = t.ts; athIdx = i; } });
  console.log(`launch=${launch.toExponential(3)}（${platform}，首可靠价 ${firstPx.toExponential(3)}）`);
  console.log(`ATH +${curVs(athPx).toFixed(1)}% @ +${((tAth - t0) / 1000).toFixed(0)}s；锚=${new Date(ANCHOR).toISOString().slice(5, 19)}（+${((ANCHOR - t0) / 1000).toFixed(0)}s）锚价 +${curVs(pr.filter(t => t.ts <= ANCHOR).slice(-1)[0].px).toFixed(1)}%`);

  // 2. 分段画像：60s 窗买/卖量+笔数+末价（非重叠，全史压缩）
  console.log(`\n②60s 窗画像（非空窗）：`);
  const winN = Math.ceil((ticks[ticks.length - 1].ts - t0) / 60000);
  let hotSeen = false;
  for (let i = 0; i < winN; i++) {
    const a = t0 + i * 60000, b = a + 60000;
    const seg = ticks.filter(t => t.ts >= a && t.ts < b);
    if (!seg.length) continue;
    const buys = seg.filter(t => t.side === 'buy');
    const sells = seg.filter(t => t.side === 'sell');
    const pxEnd = [...seg].reverse().find(t => !t.out && t.px > 0);
    const buyBnb = buys.reduce((s, t) => s + t.bnb, 0);
    if (buyBnb + sells.reduce((s, t) => s + t.bnb, 0) >= 1) hotSeen = true;
    const tag = (a >= ANCHOR) ? '→锚后' : '';
    console.log(`  +${String(i).padStart(4)}min 买${String(buys.length).padStart(3)}/${buyBnb.toFixed(2)}B 卖${String(sells.length).padStart(3)}/${sells.reduce((s, t) => s + t.bnb, 0).toFixed(2)}B 价+${pxEnd ? curVs(pxEnd.px).toFixed(0) : '?'}%${tag}${hotSeen ? '' : ''}`);
  }

  // 3. 锚前 120s 明细（逐笔）
  console.log(`\n③锚前 120s 逐笔：`);
  for (const t of ticks.filter(t => t.ts > ANCHOR - 120000 && t.ts <= ANCHOR + 1000)) {
    console.log(`  ${new Date(t.ts).toISOString().slice(11, 19)} ${t.side.toUpperCase()} ${t.bnb.toFixed(4)}B px=${t.px.toExponential(3)}(+${curVs(t.px).toFixed(1)}%)${t.out ? ' OUT' : ''}`);
  }

  // 4. ATH 前后明细（怎么涨上去的）
  console.log(`\n④ATH 前后 120s 逐笔（ATH @ +${((tAth - t0) / 1000).toFixed(0)}s）：`);
  for (const t of ticks.filter(t => t.ts > tAth - 120000 && t.ts < tAth + 60000)) {
    console.log(`  ${new Date(t.ts).toISOString().slice(11, 19)} ${t.side.toUpperCase()} ${t.bnb.toFixed(4)}B px=${t.px.toExponential(3)}(+${curVs(t.px).toFixed(1)}%)`);
  }

  // 5. 锚后前向收益（若买入 0.2B 会怎样——max/末价）
  const post = ticks.filter(t => t.ts > ANCHOR);
  const postPr = pr.filter(t => t.ts > ANCHOR);
  if (postPr.length) {
    const anchorPx = pr.filter(t => t.ts <= ANCHOR).slice(-1)[0].px;
    let mx = 0, tMx = null;
    for (const t of postPr) if (t.px > mx) { mx = t.px; tMx = t.ts; }
    const last = postPr[postPr.length - 1];
    console.log(`\n⑤锚后：max +${((mx - anchorPx) / anchorPx * 100).toFixed(1)}% @ +${((tMx - ANCHOR) / 1000).toFixed(0)}s；末价 +${((last.px - anchorPx) / anchorPx * 100).toFixed(1)}%（+${((last.ts - ANCHOR) / 60000).toFixed(1)}min）；锚后笔数 ${post.length}`);
    // 30s/2min/5min 分段量
    for (const [lb, w] of [['30s', 30000], ['2min', 120000], ['5min', 300000], ['30min', 1800000]]) {
      const seg = post.filter(t => t.ts <= ANCHOR + w);
      const b = seg.filter(t => t.side === 'buy'), s = seg.filter(t => t.side === 'sell');
      console.log(`  锚后${lb}: 买${b.length}/${b.reduce((x, t) => x + t.bnb, 0).toFixed(2)}B 卖${s.length}/${s.reduce((x, t) => x + t.bnb, 0).toFixed(2)}B`);
    }
  }

  // 6. 全史总量（FP34 豁免腿量级带 [3,8] 用）
  const allB = ticks.filter(t => t.side === 'buy').reduce((s, t) => s + t.bnb, 0);
  const allS = ticks.filter(t => t.side === 'sell').reduce((s, t) => s + t.bnb, 0);
  console.log(`\n⑥全史: ${ticks.length} 笔 买${allB.toFixed(2)}B 卖${allS.toFixed(2)}B；锚前 ${ticks.filter(t => t.ts <= ANCHOR).length} 笔`);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
