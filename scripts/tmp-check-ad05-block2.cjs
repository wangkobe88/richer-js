const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const TOKEN = '0xad05bf6f03a098ae823383fd2e479a4fd3b57777';
const EXP = '0e7c7e09-5b3c-4e14-b039-fce040199f83';
(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();

  const { data: sigs, error: e3 } = await client.from('strategy_signals')
    .select('*').eq('experiment_id', EXP).eq('token_address', TOKEN);
  console.log('=== strategy_signals ===', (sigs || []).length, 'rows,', e3 ? 'err: ' + e3.message : 'ok');
  for (const s of (sigs || [])) console.log(JSON.stringify({ ...s, metadata: undefined }).slice(0, 400));

  const { data: exp, error: e4 } = await client.from('experiments')
    .select('id,experiment_name,status,config').eq('id', EXP).single();
  if (e4) console.error('exp err:', e4.message);
  const legs = exp && exp.config && (exp.config.strategies || exp.config.strategiesConfig || {});
  const arr = (legs.strategies || legs.legs || []);
  console.log('=== exp ===', exp && exp.experiment_name, exp && exp.status, '| legs:', Array.isArray(arr) ? arr.length : typeof arr);
  for (const leg of (Array.isArray(arr) ? arr : [])) {
    if (leg && (leg.side === 'buy' || leg.type === 'buy' || (leg.condition && /narrativeRating/.test(leg.condition)))) {
      console.log('--- BUY LEG:', leg.name, '| buyPhase:', leg.buyPhase);
      console.log('trigger:', leg.narrativeTriggerCondition);
      console.log('condition:', leg.condition);
      console.log('gmgn:', leg.gmgnCheckCondition);
    }
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
