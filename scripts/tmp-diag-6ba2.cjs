#!/usr/bin/env node
/** 临时诊断:0x6ba2…7777 为何不触发 -35 清仓(第二段:实验状态/trade 列/signals) */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const ADDR = '0x6ba259ea425b06ca7a032bec2c86f017ffbd7777';

async function main() {
  const db = dbManager.getClient();

  // 1. 实验 203570e3 完整行
  const exp = await db.from('experiments').select('id,name,status,mode,platform,updated_at,started_at').ilike('id', '203570e3%').limit(3);
  console.log('=== experiments ===');
  for (const e of exp.data || []) console.log(JSON.stringify(e));

  // 2. trades 完整行(去掉 metadata 打全列)
  const tr = await db.from('trades').select('*').eq('token_address', ADDR).order('executed_at').limit(3);
  console.log('\n=== trades 全列 ===');
  if (tr.data && tr.data[0]) console.log('columns:', Object.keys(tr.data[0]).join(','));
  for (const t of tr.data || []) {
    const { metadata, ...rest } = t;
    console.log(JSON.stringify(rest));
    if (metadata) console.log('  signalId:', metadata.signalId, '| factors:', JSON.stringify(metadata.factors || null));
  }

  // 3. signals 按地址精确查(前脚本 order 空可能是大小写/形状)
  const sg = await db.from('strategy_signals').select('id,experiment_id,side,status,created_at,price,token_address').eq('token_address', ADDR).limit(10);
  console.log('\n=== signals(eq) ===', (sg.data || []).length);
  for (const s of sg.data || []) console.log(JSON.stringify({ ...s, id: s.id.slice(0, 8), experiment_id: (s.experiment_id || '').slice(0, 8), token_address: s.token_address.slice(0, 10) }));

  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
