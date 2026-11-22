#!/usr/bin/env node
// JG-24 v3：ZKind 锚时刻持仓结构重放——等额捆绑钱包合并成实体后的 HHI 变化
// 口径：净持仓=Σ买−Σ卖（sender||trader）；实体合并三口径对比：
//   a) 同块买入钱包合并  b) 同块等额买入（金额±2%容差）合并  c) 不合并（对照组）
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const COLL = 'a8414632-7c24-4762-9253-c49bb0f53105';
const TOKEN = '0xa79e736482f55c89e42000151e04af630f2b7777';
const ANCHOR = Date.parse('2026-10-04T12:15:20Z');

(async () => {
  const sb = dbManager.getClient();
  const { data: ticks, error } = await sb.from('case_ticks')
    .select('trade_type,bnb_amount,block_number,block_time,sender_address,trader_address')
    .eq('collection_id', COLL).eq('token_address', TOKEN)
    .order('block_time', { ascending: true }).limit(2000);
  if (error) throw new Error(error.message);
  console.log(`ticks=${ticks.length} 锚=12:15:20Z`);

  // 锚前逐行：净持仓 + 每钱包的买入块记录
  const net = new Map();          // wallet -> 净持仓 BNB 计
  const buyBlocks = new Map();    // wallet -> [{blk, amt}]
  for (const t of ticks) {
    const ts = Date.parse(t.block_time);
    if (ts > ANCHOR) break;
    const w = (t.sender_address || t.trader_address || '').toLowerCase();
    if (!w) continue;
    const amt = Number(t.bnb_amount || 0);
    if (t.trade_type === 'buy') {
      net.set(w, (net.get(w) || 0) + amt);
      if (!buyBlocks.has(w)) buyBlocks.set(w, []);
      buyBlocks.get(w).push({ blk: t.block_number, amt });
    } else net.set(w, (net.get(w) || 0) - amt);
  }
  const pos = [...net.entries()].filter(([, v]) => v > 0.015);
  const sumPos = pos.reduce((s, [, v]) => s + v, 0);
  console.log(`锚时刻正净持仓(>0.015) ${pos.length} 钱包 Σ=${sumPos.toFixed(3)}B`);
  for (const [w, v] of pos.sort((a, b) => b[1] - a[1])) {
    const bb = buyBlocks.get(w) || [];
    console.log(`  ${w} 净+${v.toFixed(4)}B (${(v / sumPos * 100).toFixed(1)}%) 买入块: ${bb.map(x => `blk${String(x.blk).slice(-4)}@${x.amt.toFixed(3)}`).join(', ') || '(无买入=开盘前筹码)'}`);
  }
  // HHI 三口径
  const hhi = (entities) => { let h = 0; for (const v of entities) h += Math.pow(v / sumPos, 2); return h; };
  const solo = pos.map(([, v]) => v);
  console.log(`\nHHI 不合并 = ${hhi(solo).toFixed(4)}（FP22 线 0.10，CD 口径实测 0.099）`);
  // a) 同块买入钱包合并（钱包的所有买入块集合为键，块集合完全相同才合并——保守；再试宽松：首买块相同即合并）
  const byFirstBlk = new Map();
  for (const [w, v] of pos) {
    const bb = (buyBlocks.get(w) || []).sort((x, y) => x.blk - y.blk);
    const key = bb.length ? 'fb' + bb[0].blk : 'nobuy';
    if (!byFirstBlk.has(key)) byFirstBlk.set(key, []);
    byFirstBlk.get(key).push([w, v]);
  }
  const entA = [...byFirstBlk.values()].map(ws => ws.reduce((s, [, v]) => s + v, 0)).filter(v => v > 0.015);
  console.log(`HHI a)按首买块合并 = ${hhi(entA).toFixed(4)}（实体数=${entA.length}）`);
  // b) 同块等额（首买块相同 ∧ 金额±2% 相近链式合并）
  const byFirstBlkAmt = [...byFirstBlk.entries()].map(([k, ws]) => {
    // 块内按金额聚类（链式 ±2%）
    const items = ws.map(([w, v]) => ({ w, v, amt: (buyBlocks.get(w) || []).reduce((s, x) => s + x.amt, 0) })).sort((x, y) => x.amt - y.amt);
    const clusters = [];
    for (const it of items) {
      const last = clusters[clusters.length - 1];
      if (last && Math.abs(it.amt - last.refAmt) / last.refAmt <= 0.02) { last.sum += it.v; last.n++; last.refAmt = it.amt; }
      else clusters.push({ sum: it.v, n: 1, refAmt: it.amt });
    }
    return clusters;
  }).flat();
  const entB = byFirstBlkAmt.map(c => c.sum).filter(v => v > 0.015);
  console.log(`HHI b)首买块+等额(±2%)合并 = ${hhi(entB).toFixed(4)}（实体数=${entB.length}）`);
  // 实体明细（b 口径）
  const detail = [];
  for (const [k, ws] of byFirstBlk) {
    const items = ws.map(([w, v]) => ({ w, v, amt: (buyBlocks.get(w) || []).reduce((s, x) => s + x.amt, 0) })).sort((x, y) => x.amt - y.amt);
    const clusters = [];
    for (const it of items) {
      const last = clusters[clusters.length - 1];
      if (last && Math.abs(it.amt - last.refAmt) / last.refAmt <= 0.02) { last.sum += it.v; last.n++; last.ws.push(it.w.slice(0, 8)); last.refAmt = it.amt; }
      else clusters.push({ sum: it.v, n: 1, refAmt: it.amt, ws: [it.w.slice(0, 8)] });
    }
    for (const c of clusters) if (c.sum > 0.015) detail.push({ blk: k, n: c.n, sum: c.sum, share: (c.sum / sumPos * 100).toFixed(1) + '%', ws: c.ws });
  }
  detail.sort((a, b) => b.sum - a.sum);
  console.log('--- b 口径实体明细（>0.015B） ---');
  for (const d of detail.slice(0, 12)) console.log(`  ${d.blk} ${d.n}钱包合并 净+${d.sum.toFixed(4)}B (${d.share}) [${d.ws.join(',')}${d.n > 1 ? ' ←合并' : ''}]`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
