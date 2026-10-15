#!/usr/bin/env node
/** 临时诊断 4：同名票区分 + 当前实验持仓全貌 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const EXP_ID = '203570e3-6117-4841-bc50-936461e78a8a';

async function main() {
  const db = dbManager.getClient();

  // 「中国龙」/「龙」全部行的地址区分
  const tr = await db.from('trades').select('token_symbol,token_address,trade_direction,trade_status,executed_at,input_amount,output_amount,signal_id').eq('experiment_id', EXP_ID).gte('executed_at', '2026-10-15T11:39:00Z').order('executed_at').limit(40);
  console.log('=== 11:39 后全部 trades（带地址） ===');
  for (const t of tr.data || []) {
    console.log(t.executed_at, t.trade_direction.padEnd(4), t.trade_status.padEnd(8), t.token_symbol.padEnd(6), t.token_address,
      'in=', t.input_amount, 'out=', t.output_amount, (t.signal_id || '').slice(0, 8));
  }

  // experiment_tokens 持仓状态
  const et = await db.from('experiment_tokens').select('*').eq('experiment_id', EXP_ID).gte('updated_at', '2026-10-15T11:30:00Z').limit(30);
  console.log('\n=== experiment_tokens（11:30 后更新的） ===');
  if (et.error) console.log('err:', et.error.message);
  for (const t of et.data || []) console.log(JSON.stringify({ addr: t.token_address, symbol: t.token_symbol, status: t.status, bought: t.bought_at, sold: t.sold_at, amount: t.token_amount, cost: t.cost_bnb, updated: t.updated_at }));

  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
