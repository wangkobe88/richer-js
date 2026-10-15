#!/usr/bin/env node
/** 临时诊断:0x6ba2…7777 第五段——列名修正后拿实验 config + 卖腿定义 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const ADDR = '0x6ba259ea425b06ca7a032bec2c86f017ffbd7777';
const EXP = '203570e3-6117-4841-bc50-936461e78a8a';

async function main() {
  const db = dbManager.getClient();

  for (const tbl of ['experiments', 'strategy_signals']) {
    const cols = await db.from('information_schema.columns').select('column_name').eq('table_name', tbl);
    console.log(`${tbl} columns:`, (cols.data || []).map(c => c.column_name).join(','));
  }

  const exp = await db.from('experiments').select('*').eq('id', EXP).limit(1);
  const e = exp.data && exp.data[0];
  if (!e) { console.log('exp not found'); }
  else {
    console.log('\n=== 实验 ===', e.id, e.status, e.mode || e.experiment_type || '', e.platform || '');
    const cfg = e.config || e.configuration || {};
    const legs = (cfg.strategies || cfg.legs || []);
    console.log('legs 数:', Array.isArray(legs) ? legs.length : typeof legs);
    for (const l of (Array.isArray(legs) ? legs : [])) {
      console.log(`\n--- leg: ${l.name || l.legName || '?'} side=${l.side || l.direction} bypass=${l.bypass} maxExec=${l.maxExecutions}`);
      console.log('    condition:', l.condition);
    }
    const pm = cfg.positionManagement || {};
    console.log('\npositionManagement:', JSON.stringify(pm));
    const sl = cfg.stopLoss || pm.stopLoss;
    if (sl) console.log('stopLoss:', JSON.stringify(sl));
  }

  // 卖出 signal 的完整 metadata(哪条腿触发)
  const sg = await db.from('strategy_signals').select('*').eq('token_address', ADDR).limit(10);
  console.log('\n=== signals ===', (sg.data || []).length);
  for (const s of sg.data || []) {
    const md = s.metadata || {};
    console.log(JSON.stringify({
      id: s.id.slice(0, 8), direction: s.direction || s.side || s.trade_direction, status: s.status,
      created_at: s.created_at, legName: md.legName || md.leg, reason: md.reason, sellReason: md.sellReason,
      profitPercent: md.profitPercent || (md.factors && md.factors.trendFactors && md.factors.trendFactors.profitPercent),
    }));
  }

  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
