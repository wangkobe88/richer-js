#!/usr/bin/env node
// ============================================================================
// 一次性（182 跑）：0x28ad2c7d bt-s02 综=? 四个信号时刻（14:21/15:41/15:55/15:58）
// 完整 metadata dump + trades 查证（是否有成交）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const BT2 = '19ab9c37-771c-483e-93ad-7137550c44d9';
const TOKEN = '0x28ad2c7d08d83a85467bd4afcfd673dfce564444';
const WANT = ['07:14:21', '07:15:41', '07:15:55', '07:15:58'];

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();

  const { data: sigs, error } = await db.from('strategy_signals')
    .select('id,created_at,metadata')
    .eq('experiment_id', BT2).eq('signal_type', 'BUY').eq('token_address', TOKEN)
    .order('created_at');
  if (error) throw new Error(error.message);
  const seen = new Set();
  for (const s of sigs) {
    const t = s.created_at.slice(11, 19);
    if (!WANT.includes(t)) continue;
    const leg = ((s.metadata || {}).signalGate || {}).legId;
    const key = t + leg;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`\n===== ${t} ${leg} =====`);
    console.log(JSON.stringify(s.metadata).slice(0, 2600));
  }

  const { data: trades, error: e2 } = await db.from('trades')
    .select('*')
    .eq('experiment_id', BT2).eq('token_address', TOKEN);
  if (e2) throw new Error(e2.message);
  console.log(`\n\ntrades 行数=${(trades || []).length}`);
  for (const t of trades || []) {
    console.log(`${(t.trade_time || t.created_at || '').slice(11, 19)} ${t.trade_direction} bnb=${t.bnb_amount} price=${t.price_bnb} meta=${JSON.stringify(t.metadata || {}).slice(0, 200)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
