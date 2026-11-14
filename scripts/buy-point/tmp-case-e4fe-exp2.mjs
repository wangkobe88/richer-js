import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const { data: exp, error } = await c.from('experiments')
  .select('config')
  .eq('id','5390bbfa-0c86-48a2-b9e1-94537c54ac17').single();
if (error) throw new Error(error.message);
const cfg = exp.config;
console.log('== backtest ==');
console.log(JSON.stringify(cfg.backtest, null, 1).slice(0, 800));
const legs = cfg.strategiesConfig?.strategies || [];
console.log('== 买腿 ==');
for (const l of legs) {
  if ((l.side || 'buy') !== 'buy') continue;
  console.log('---', l.name, '| priority=', l.priority, '| signalGate=', JSON.stringify(l.signalGate ?? null), '| buyPhase=', l.buyPhase ?? null);
  console.log('    cond=', l.condition);
}
process.exit(0);
