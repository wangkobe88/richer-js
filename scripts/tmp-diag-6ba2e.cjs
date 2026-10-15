#!/usr/bin/env node
/** 临时诊断:0x6ba2…7777 第六段——原始形状 dump */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const ADDR = '0x6ba259ea425b06ca7a032bec2c86f017ffbd7777';
const EXP = '203570e3-6117-4841-bc50-936461e78a8a';

async function main() {
  const db = dbManager.getClient();

  const exp = await db.from('experiments').select('*').eq('id', EXP).limit(1);
  const e = exp.data && exp.data[0];
  console.log('exp columns:', Object.keys(e).join(','));
  const cfg = e.config;
  console.log('config keys:', Object.keys(cfg).join(','));
  // 找策略数组
  for (const [k, v] of Object.entries(cfg)) {
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
      console.log(`\n=== config.${k} (${v.length} 项) ===`);
      for (const leg of v) {
        console.log(JSON.stringify(leg, null, 1).slice(0, 1500));
        console.log('---');
      }
    }
  }

  const sg = await db.from('strategy_signals').select('*').eq('token_address', ADDR).limit(10);
  console.log('\nsignal columns:', sg.data && sg.data[0] && Object.keys(sg.data[0]).join(','));
  for (const s of sg.data || []) {
    const { metadata, ...rest } = s;
    console.log('\nSIGNAL:', JSON.stringify(rest, (k, v) => typeof v === 'string' && v.length > 80 ? v.slice(0, 80) + '…' : v));
    if (metadata) {
      const md = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
      console.log('  metadata keys:', Object.keys(md).join(','));
      for (const skip of ['factors', 'trendFactors']) if (md[skip]) delete md[skip];
      if (md.factorResults) { console.log('  factorResults(裁剪):', JSON.stringify(md.factorResults).slice(0, 300)); delete md.factorResults; }
      console.log('  metadata:', JSON.stringify(md).slice(0, 1200));
    }
  }

  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
