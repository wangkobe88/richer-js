#!/usr/bin/env node
/** 临时诊断:0x6ba2…7777 第四段——experiments 全表/按实验查 signals/bnbUsd/买入时刻价 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const ADDR = '0x6ba259ea425b06ca7a032bec2c86f017ffbd7777';
const EXP = '203570e3-6117-4841-bc50-936461e78a8a';

async function main() {
  const db = dbManager.getClient();

  const all = await db.from('experiments').select('id,name,status,mode,platform').limit(30);
  console.log('=== experiments 全表 ===');
  for (const e of all.data || []) console.log(e.id.slice(0, 8), '|', e.name, '|', e.status, '|', e.mode, '|', e.platform);
  console.log('count:', (all.data || []).length, 'err:', all.error && all.error.message);

  const sg = await db.from('strategy_signals').select('id,side,status,created_at,price').eq('experiment_id', EXP).limit(20);
  console.log('\n=== signals by exp ===', (sg.data || []).length, 'err:', sg.error && sg.error.message);
  for (const s of sg.data || []) console.log(s.id.slice(0, 8), s.side, s.status, s.created_at, s.price);

  // trades metadata 里的 bnbUsd + 买入时刻 tick 价
  const tr = await db.from('trades').select('metadata,executed_at,trade_direction,unit_price').eq('token_address', ADDR).order('executed_at').limit(2);
  for (const t of tr.data || []) {
    console.log('\ntrade', t.trade_direction, t.executed_at, 'unit_price=', t.unit_price, 'bnbUsd=', t.metadata && t.metadata.bnbUsd, 'method=', t.metadata && t.metadata.method);
  }

  // 买入 fire 前后 30s 的非离群 tick 价(fire≈11:40:35 created_at)
  const tk = await db.from('wss_price_ticks').select('block_time,price_bnb,price_outlier,trade_type')
    .eq('token_address', ADDR).gte('block_time', '2026-10-15T11:40:25').lte('block_time', '2026-10-15T11:40:50')
    .order('id', { ascending: true }).limit(60);
  console.log('\n=== 买入窗口 ticks ===');
  for (const t of tk.data || []) if (!t.price_outlier) console.log(t.block_time, t.price_bnb.toExponential(4), t.trade_type);

  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
