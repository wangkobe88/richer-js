#!/usr/bin/env node
// 一次性：拉 bt-v164 引用的策略包 definition，打印全部买腿条件。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const PACK_ID = '479f3109-41ac-4424-bb2b-5309c47ee88a';

(async () => {
  const sb = dbManager.getClient();
  const { data: pack, error } = await sb.from('strategy_library')
    .select('id, name, version, definition, created_at')
    .eq('id', PACK_ID).single();
  if (error) throw new Error(error.message);
  console.log(`包: ${pack.name} v${pack.version} (${pack.id}) created ${pack.created_at}`);
  const def = pack.definition;
  console.log(`modules: ${JSON.stringify(def.modules)}`);
  console.log(`\n=== 买腿 ${def.buyLegs.length} 条 ===`);
  for (const [i, leg] of def.buyLegs.entries()) {
    console.log(`\n--- [${i}] id=${leg.id} name=${leg.name} priority=${leg.priority} enabled=${leg.enabled} maxTriggers=${leg.signalGate?.maxTriggers} cards=${leg.cards}`);
    console.log(`  condition: ${leg.condition}`);
    if (leg.factorParams && Object.keys(leg.factorParams).length) console.log(`  factorParams: ${JSON.stringify(leg.factorParams)}`);
    if (leg.signalGate && Object.keys(leg.signalGate).length > 1) console.log(`  signalGate: ${JSON.stringify(leg.signalGate)}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
