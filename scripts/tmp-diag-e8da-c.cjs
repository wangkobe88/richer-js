#!/usr/bin/env node
/** 临时诊断 C:0xe8da…7777 实验 config + ticks 首尾(修正列名) */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const ADDR = '0xe8da305a2ea91281592e5a8e4565ad9aaa3c7777';

async function main() {
  const db = dbManager.getClient();

  // 1. 完整 experiment_id
  const nr = await db.from('narrative_analysis_rounds').select('experiment_id').eq('token_address', ADDR).limit(1);
  const expId = nr.data?.[0]?.experiment_id;
  console.log('full experiment_id:', expId);

  if (expId) {
    const exp = await db.from('experiments').select('id,name,status,mode,platform,started_at,updated_at,config').eq('id', expId).limit(1);
    const e = exp.data?.[0];
    if (!e) { console.log('experiment row not found!'); }
    else {
      const { config, ...rest } = e;
      console.log('=== experiment ===\n', JSON.stringify(rest));
      const legs = config?.strategiesConfig?.legs || [];
      console.log('legs:', legs.length);
      for (const l of legs) {
        console.log('--- leg side=' + l.side + ' name=' + (l.name || l.strategyName || '?') + ' enabled=' + l.enabled);
        for (const k of ['condition', 'narrativeTriggerCondition', 'narrativeCallCondition', 'gmgnCheckCondition', 'preBuyCheckCondition']) {
          if (l[k]) console.log('  ' + k + ':\n    ' + l[k]);
        }
      }
    }
  }

  // 2. wss_events 修正列
  const ev = await db.from('wss_events').select('kind,platform,block_time,payload').eq('token_address', ADDR).limit(10);
  console.log('\n=== wss_events ===', (ev.data || []).length);
  for (const e of ev.data || []) console.log(JSON.stringify({ kind: e.kind, platform: e.platform, block_time: e.block_time, payload: JSON.stringify(e.payload).slice(0, 300) }));

  // 3. ticks 首尾(正确列)
  const first = await db.from('wss_price_ticks').select('id,block_time,block_number,bnb_amount,price_usd,trade_type').eq('token_address', ADDR)
    .order('id', { ascending: true }).limit(2);
  const last = await db.from('wss_price_ticks').select('id,block_time,block_number,bnb_amount,price_usd,trade_type').eq('token_address', ADDR)
    .order('id', { ascending: false }).limit(2);
  console.log('\nfirst ticks:', JSON.stringify(first.data));
  console.log('last ticks:', JSON.stringify(last.data));

  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
