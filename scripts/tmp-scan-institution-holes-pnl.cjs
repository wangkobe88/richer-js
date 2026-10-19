#!/usr/bin/env node
// ============================================================================
// C110 结构扫描③（C2b 裁定依据）：institution_routine 空洞 high/mid 票盈亏复查
//
// 背景：institution_routine scope={C,D}，argmax∧category∉{C,D} 的 86 行空洞中
// 18 行评级 high/mid（A 类 41 行为主体，与 C56 平台官方豁免/superIP 通道的
// 已裁定放行面重叠）。用户裁定「先拉 18 票盈亏再定」是否扩全域。
//
// 输出：18 票逐票——现行评级、argmax 概率、分析时 reason（豁免标记可见）、
// 逐实验 BNB 盈亏（Σ卖得 BNB − Σ买入 BNB，仅 success 成交；未平仓风险单列）。
//
// 用法（182 上跑；本地 VPN 直连 Supabase 必超时，勿本地跑）：
//   node scripts/tmp-scan-institution-holes-pnl.cjs
// ============================================================================
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require(path.join(__dirname, '../src/services/dbManager.js'));

const asObj = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return null;
};
const r4 = (v) => (v == null ? null : Math.round(v * 10000) / 10000);

async function main() {
  const db = dbManager.getClient();
  const { resolveFinalRating } = await import('../src/narrative/utils/rating-utils.mjs');

  const COLS = [
    'token_address', 'token_symbol', 'stage1_raw_output',
    'stage1_result', 'stage2_result', 'stage3_result', 'stage_final_result',
    'analyzed_at',
  ].join(',');
  const PAGE = 1000;

  const tickets = [];
  let cursor = null;
  while (true) {
    let q = db.from('token_narrative').select(COLS).order('token_address').limit(PAGE);
    if (cursor) q = q.gt('token_address', cursor);
    const { data: page, error } = await q;
    if (error) throw error;
    if (!page || page.length === 0) break;
    cursor = page[page.length - 1].token_address;
    for (const row of page) {
      const answers = asObj(row.stage1_raw_output)?.answers;
      const choice = answers?.block_reason?.choice;
      const cat = answers?.event_category?.choice;
      if (choice !== 'institution_routine' || !cat || ['C', 'D'].includes(cat)) continue;
      const rating = resolveFinalRating(row);
      if (rating !== 'high' && rating !== 'mid') continue;
      const s2 = asObj(row.stage2_result);
      const s3 = asObj(row.stage3_result);
      tickets.push({
        addr: row.token_address, symbol: row.token_symbol, cat, rating,
        p: answers.block_reason.probabilities?.[choice] ?? null,
        noneP: answers.block_reason.probabilities?.none ?? null,
        reason: (s3?.reason || s2?.reason || '').slice(0, 160),
        analyzed_at: row.analyzed_at,
      });
    }
    if (page.length < PAGE) break;
  }

  // 逐票全量成交（批 ≤50 红线）：BNB 计价腿
  const byExp = new Map(); // addr -> Map(exp -> {buyBnb, sellBnb, buys, sells})
  for (let i = 0; i < tickets.length; i += 50) {
    const batch = tickets.slice(i, i + 50).map(t => t.addr);
    const { data: trades, error } = await db.from('trades')
      .select('token_address,experiment_id,trade_direction,success,input_currency,output_currency,input_amount,output_amount,is_virtual_trade')
      .in('token_address', batch);
    if (error) throw error;
    for (const t of trades || []) {
      if (!t.success) continue;
      const m = byExp.get(t.token_address) || new Map();
      const e = m.get(t.experiment_id) || { buyBnb: 0, sellBnb: 0, buys: 0, sells: 0 };
      if (t.trade_direction === 'buy' && t.input_currency === 'BNB') { e.buyBnb += Number(t.input_amount) || 0; e.buys++; }
      if (t.trade_direction === 'sell' && t.output_currency === 'BNB') { e.sellBnb += Number(t.output_amount) || 0; e.sells++; }
      m.set(t.experiment_id, e);
      byExp.set(t.token_address, m);
    }
  }

  console.log(`\n===== institution_routine 空洞 high/mid 票盈亏（${tickets.length} 票）=====`);
  let traded = 0, pnlSum = 0;
  for (const t of tickets) {
    const m = byExp.get(t.addr);
    const legs = m ? [...m.entries()] : [];
    if (!legs.length) {
      console.log(`\n${t.symbol} ${t.addr} cat=${t.cat} rating=${t.rating} p=${t.p} none=${t.noneP}`);
      console.log(`  无成交（未被买入）｜分析 reason: ${t.reason}`);
      continue;
    }
    traded++;
    console.log(`\n${t.symbol} ${t.addr} cat=${t.cat} rating=${t.rating} p=${t.p} none=${t.noneP}`);
    console.log(`  分析 reason: ${t.reason}`);
    for (const [exp, e] of legs) {
      const pnl = e.sellBnb - e.buyBnb;
      if (e.sells > 0) pnlSum += pnl;
      const open = e.buys > 0 && e.sells === 0 ? '【未平仓】' : '';
      console.log(`  exp=${exp.slice(0, 8)} 买${e.buys}腿=${r4(e.buyBnb)} 卖${e.sells}腿=${r4(e.sellBnb)} → PnL ${r4(pnl)} BNB ${open}`);
    }
  }
  console.log(`\n小计：有成交 ${traded}/${tickets.length}；已平仓票 PnL 合计 ${r4(pnlSum)} BNB（不含未平仓浮亏面）`);
  process.exit(0);
}

main().catch(err => { console.error('扫描异常:', err); process.exit(1); });
