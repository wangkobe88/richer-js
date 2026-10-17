#!/usr/bin/env node
/** HUDIE 0x80b7…7777 现状核查：卖腿信号 + 最新 ticks（单票小结果,本地 OK） */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const TOKEN = '0x80b7d7c79716ebacf23d49b00ac8bd9fa9b17777';
const EXP = '43381df7-9bc4-4937-9f88-2bb3dbca372c';

async function main() {
  const db = dbManager.getClient();

  const { data: sigs, error: e2 } = await db.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(50);
  if (e2) throw e2;
  console.log('=== signals ===', (sigs || []).length);
  for (const s of sigs || []) {
    console.log(`#${s.id.slice(0, 8)} side=${s.side} status=${s.status} ${s.created_at}`);
    const md = s.metadata || {};
    for (const k of ['executionReason', 'stopLossType', 'sellEvaluation', 'factors_marketCap', 'debounceState']) {
      if (md[k] !== undefined) console.log(' ', k, '=', JSON.stringify(md[k]).slice(0, 300));
    }
    const fr = md.factorResults;
    if (fr && fr.marketCap !== undefined) console.log('  marketCap=', fr.marketCap, 'profitPercent=', fr.profitPercent);
  }

  const { data: ticks, error: e3 } = await db.from('wss_price_ticks')
    .select('block_time, price_bnb, bnb_amount, trade_type')
    .eq('token_address', TOKEN)
    .order('block_time', { ascending: false }).limit(8);
  if (e3) throw e3;
  console.log('\n=== last ticks ===');
  for (const t of ticks || []) console.log(t.block_time, t.trade_type, 'bnb=', Number(t.bnb_amount || 0).toFixed(4), 'price=', t.price_bnb);

  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
