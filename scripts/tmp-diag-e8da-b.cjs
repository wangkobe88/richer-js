#!/usr/bin/env node
/** 临时诊断 B:0xe8da…7777 实验 v28 状态/config + ticks 覆盖 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const ADDR = '0xe8da305a2ea91281592e5a8e4565ad9aaa3c7777';

async function main() {
  const db = dbManager.getClient();

  // 1. v28 实验行
  const exp = await db.from('experiments').select('id,name,status,mode,platform,started_at,updated_at,config')
    .ilike('id', 'a97e4f25%').limit(2);
  console.log('=== experiment a97e4f25 ===');
  for (const e of exp.data || []) {
    const { config, ...rest } = e;
    console.log(JSON.stringify(rest));
    if (config) {
      const legs = config.strategiesConfig?.legs || [];
      console.log('legs:', legs.length);
      for (const l of legs) {
        console.log('--- leg side=' + l.side + ' name=' + (l.name || l.strategyName || '?'));
        for (const k of ['condition', 'narrativeTriggerCondition', 'narrativeCallCondition', 'gmgnCheckCondition', 'preBuyCheckCondition']) {
          if (l[k]) console.log('  ' + k + ': ' + l[k]);
        }
      }
    }
  }

  // 2. wss_events ilike(大小写)
  const ev = await db.from('wss_events').select('kind,created_at')
    .ilike('token_address', ADDR).limit(10);
  console.log('\n=== wss_events(ilike) ===', (ev.data || []).length);
  for (const e of ev.data || []) console.log(JSON.stringify(e));

  // 3. ticks 计数 + 首尾时间(小结果)
  const tc = await db.from('wss_price_ticks').select('id', { count: 'exact', head: true }).eq('token_address', ADDR);
  console.log('\n=== ticks count ===', tc.count);
  const first = await db.from('wss_price_ticks').select('block_time,price_bnb,market_cap,holders').eq('token_address', ADDR)
    .order('block_time', { ascending: true }).limit(1);
  const last = await db.from('wss_price_ticks').select('block_time,price_bnb,market_cap,holders').eq('token_address', ADDR)
    .order('block_time', { ascending: false }).limit(1);
  console.log('first tick:', JSON.stringify(first.data?.[0] || null));
  console.log('last tick:', JSON.stringify(last.data?.[0] || null));

  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
