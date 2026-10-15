#!/usr/bin/env node
/** 临时诊断:0x6ba2…7777 第七段——strategiesConfig 完整腿定义 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const EXP = '203570e3-6117-4841-bc50-936461e78a8a';

async function main() {
  const db = dbManager.getClient();
  const exp = await db.from('experiments').select('config,trading_mode,experiment_name').eq('id', EXP).limit(1);
  const e = exp.data[0];
  console.log('实验名:', e.experiment_name, '| mode:', e.trading_mode);
  const sc = e.config.strategiesConfig;
  console.log('strategiesConfig keys:', Object.keys(sc).join(','));
  const dumpLeg = (leg, i) => {
    console.log(`\n[${i}] name=${leg.name} side=${leg.side} cards=${JSON.stringify(leg.cards)} bypass=${leg.bypass} cd=${leg.cooldownSec} maxExec=${leg.maxExecutions}`);
    console.log('    condition:', leg.condition);
  };
  if (Array.isArray(sc.buyStrategies)) { console.log('\n== buyStrategies =='); sc.buyStrategies.forEach(dumpLeg); }
  if (Array.isArray(sc.sellStrategies)) { console.log('\n== sellStrategies =='); sc.sellStrategies.forEach(dumpLeg); }
  if (sc.libraryRefs) console.log('\nlibraryRefs:', JSON.stringify(sc.libraryRefs));
  const fws = e.config.fourmemeWs || {};
  console.log('\nfourmemeWs keys:', Object.keys(fws).join(','));

  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
