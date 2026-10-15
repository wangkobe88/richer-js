#!/usr/bin/env node
/** 手工清仓:中国龙 0x6ba2…7777(v17 实验,重启后卖腿停摆,用户指令全清) */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

async function main() {
  const db = dbManager.getClient();
  const { data, error } = await db.from('manual_trade_requests')
    .insert({
      experiment_id: '203570e3-6117-4841-bc50-936461e78a8a',
      token_address: '0x6ba259ea425b06ca7a032bec2c86f017ffbd7777',
      direction: 'sell',
      amount_bnb: null,
      sell_pct: 1,
      status: 'pending',
    })
    .select('id, status, requested_at')
    .single();
  if (error) throw error;
  console.log('✅ 手工卖单已落:', JSON.stringify(data));
  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
