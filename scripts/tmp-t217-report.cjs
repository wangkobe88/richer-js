#!/usr/bin/env node
/** bt-v217 独舞对拍结果：逐票信号×门链×成交×盈亏 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const EXP = '0129ab22-a197-47d5-83bb-fd7344b85fd8';
(async () => {
  const db = dbManager.getClient();
  const sig = await db.from('strategy_signals').select('token_address, created_at, reason, status, metadata')
    .eq('experiment_id', EXP).order('created_at', { ascending: true }).limit(100);
  if (sig.error) throw new Error(sig.error.message);
  console.log('信号行', sig.data.length, '行');
  for (const s of sig.data) {
    const md = s.metadata || {};
    const g = md.signalGate || {};
    const fc = md.factorCheck || {};
    const af = md.actFrontGate || md.actFront || null;
    const ch = md.cheatCheck || null;
    const bp = md.buyPoint || null;
    const parts = [];
    if (g.legId) parts.push(`leg=${g.legId}`);
    if (fc.status) parts.push(`FP=${fc.status}${fc.reason ? '/' + fc.reason : ''}`);
    if (af) parts.push(`AF1=${af.status || af.path || '?'}`);
    if (ch && ch.status) parts.push(`CD=${ch.status}${ch.grade ? '/' + ch.grade : ''}`);
    if (bp && bp.status) parts.push(`BP=${bp.status}${bp.assessment ? '/' + bp.assessment.bucket : ''}`);
    console.log(`- ${(md.tokenSymbol || s.token_address.slice(0, 8))} @${s.created_at.slice(5, 19)} ${s.reason} [${parts.join(' | ')}]`);
  }
  const tr = await db.from('trades').select('token_address, side, total_bnb, price_bnb, metadata, created_at')
    .eq('experiment_id', EXP).order('created_at', { ascending: true }).limit(100);
  if (tr.error) throw new Error(tr.error.message);
  console.log('\n成交', tr.data.length, '笔');
  const byTok = new Map();
  for (const t of tr.data) {
    const sym = (t.metadata && t.metadata.tokenSymbol) || t.token_address.slice(0, 8);
    if (!byTok.has(t.token_address)) byTok.set(t.token_address, { sym, rows: [] });
    byTok.get(t.token_address).rows.push(t);
  }
  let grand = 0;
  for (const [addr, o] of byTok) {
    let buy = 0, sell = 0, qty = 0;
    for (const t of o.rows) {
      if (t.side === 'buy') { buy += Number(t.total_bnb); qty += Number(t.metadata && t.metadata.quantity || 0); }
      else sell += Number(t.total_bnb);
    }
    const pnl = sell - buy;
    grand += pnl;
    console.log(`  ${o.sym.padEnd(10)} 买${buy.toFixed(4)} 卖${sell.toFixed(4)} → ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} BNB`);
  }
  console.log(`\n总净额: ${grand >= 0 ? '+' : ''}${grand.toFixed(4)} BNB`);
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
