import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const { data: exp, error } = await c.from('experiments')
  .select('config')
  .eq('id','5390bbfa-0c86-48a2-b9e1-94537c54ac17').single();
if (error) throw new Error(error.message);
const sc = exp.config.strategiesConfig;
for (const l of sc.buyStrategies || []) {
  console.log('---', l.name, '| priority=', l.priority, '| signalGate=', JSON.stringify(l.signalGate ?? null), '| buyPhase=', l.buyPhase ?? null);
  console.log('    cond=', l.condition);
}
process.exit(0);
