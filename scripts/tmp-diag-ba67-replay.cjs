#!/usr/bin/env node
/** 临时验证:0xba67 真实 DB 行重放 D3.75 段前背景两键 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const { buildSnapshotFromRows } = require('../src/market-analysis/cheat-snapshot');

const ADDR = '0xba67f3e17ebfc3e51645bb95122a747e9adf7777';
const ANCHOR = '2026-11-02T12:06:16';

async function main() {
  const db = dbManager.getClient();
  const tk = await db.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,trader_address,sender_address,price_outlier')
    .eq('token_address', ADDR).lte('block_time', ANCHOR).order('id', { ascending: true }).limit(2000);
  const rows = (tk.data || []).map(r => ({
    block_time: r.block_time, block_number: r.block_number, log_index: r.log_index,
    trade_type: r.trade_type, bnb_amount: Number(r.bnb_amount), price_bnb: r.price_bnb === null ? null : Number(r.price_bnb),
    price_outlier: r.price_outlier, trader_address: r.trader_address, sender_address: r.sender_address, token_amount: null, quote_token: null,
  }));
  console.log('rows=', rows.length);
  const snap = buildSnapshotFromRows(rows, { address: ADDR, platform: 'fourmeme' });
  const d = snap.derived;
  console.log('nearPre10GapSec=', d.nearPre10GapSec, 'nearPre10Wallets=', d.nearPre10Wallets);
  console.log('对照: maxGapSec=', d.maxGapSec, 'idlePct=', d.idlePct, 'actWeighted=', d.actWeightedThroughputBnbPerMin,
    'nearTail10BnbPerMin=', d.nearTail10BnbPerMin, 'nearTail5BuyN=', d.nearTail5BuyN);
  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
