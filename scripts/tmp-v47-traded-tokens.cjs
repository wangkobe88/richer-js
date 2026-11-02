const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');
const db = dbManager.getClient();

const EXP = '0b08a8d8-da10-4ffc-a8c9-eafab92d6144';

(async () => {
  const { data: exp } = await db.from('experiments').select('experiment_name,created_at,config').eq('id', EXP).single();
  console.log(`exp=${exp.experiment_name} created=${exp.created_at}`);
  const legs = exp.config.strategiesConfig.buyStrategies || [];
  legs.forEach((s, i) => {
    console.log(`\n===== 买腿[${i}] desc=${s.description}`);
    console.log('  trigger :', s.narrativeTriggerCondition);
    console.log('  cond    :', s.condition);
  });

  const q = db.from('trades')
    .select('id,token_address,token_symbol,trade_direction,input_amount,output_amount,created_at,executed_at,success,price_bnb,metadata')
    .eq('experiment_id', EXP).order('created_at');
  const { data: trades, error: te } = await q;
  if (te) { console.error('trades err:', te.message); }
  console.log(`\ntrades=${trades ? trades.length : 'null'}`);
  for (const t of trades) {
    console.log(`${t.created_at.slice(5, 19)} ${t.trade_direction.padEnd(4)} ${String(t.token_symbol).padEnd(10)} in=${t.input_amount} out=${t.output_amount} ok=${t.success} meta=${JSON.stringify(t.metadata || {}).slice(0, 200)}`);
  }

  const { count: sigCount } = await db.from('strategy_signals')
    .select('id', { count: 'exact', head: true }).eq('experiment_id', EXP);
  console.log(`\nsignals(total)=${sigCount}`);
  const { data: sigs } = await db.from('strategy_signals')
    .select('id,signal_type,token_address,action,created_at,metadata')
    .eq('experiment_id', EXP).order('created_at').limit(200);
  for (const s of sigs) {
    const md = s.metadata || {};
    const legDesc = md.strategyName || md.strategy || md.legDescription || md.strategyDescription || '';
    console.log(`${s.created_at.slice(5, 19)} ${s.signal_type.padEnd(7)} ${(s.token_address || '').slice(0, 10)} leg=${legDesc} mdKeys=${Object.keys(md).join(',')}`);
  }
  dbManager.destroy?.();
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
