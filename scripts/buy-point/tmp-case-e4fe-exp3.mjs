import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const { data: exp, error } = await c.from('experiments')
  .select('config')
  .eq('id','5390bbfa-0c86-48a2-b9e1-94537c54ac17').single();
if (error) throw new Error(error.message);
const sc = exp.config.strategiesConfig;
console.log('strategiesConfig keys:', Object.keys(sc).join(','));
const arr = sc.strategies ?? sc.legs ?? [];
console.log('strategies len=', arr.length);
for (const l of arr) {
  const side = l.side ?? l.type ?? '?';
  console.log('---', l.name ?? l.id, '| side=', side, '| priority=', l.priority, '| signalGate=', JSON.stringify(l.signalGate ?? null), '| buyPhase=', l.buyPhase ?? null);
  if ((l.side ?? 'buy') === 'buy' || l.type === 'buy') console.log('    cond=', l.condition);
}
process.exit(0);
