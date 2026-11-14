import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const { data: exp, error } = await c.from('experiments')
  .select('config')
  .eq('id','5390bbfa-0c86-48a2-b9e1-94537c54ac17').single();
if (error) throw new Error(error.message);
const fw = exp.config.fourmemeWs || {};
console.log('fourmemeWs keys:', Object.keys(fw).join(','));
for (const k of ['buySignalCooldownMs','buySignalCooldownTicks','buySignalMaxPerToken','faPreFilter','signalDebounceMs','signalDebounceMaxWaitMs']) {
  if (fw[k] !== undefined) console.log(' ', k, '=', fw[k]);
}
console.log('cheatCheck=', JSON.stringify(fw.cheatCheck && { enabled: fw.cheatCheck.enabled, gate: fw.cheatCheck.gate }));
console.log('buyPointCheck=', JSON.stringify(fw.buyPointCheck && { enabled: fw.buyPointCheck.enabled }));
console.log('factorParams=', JSON.stringify(fw.factorParams ?? null));
process.exit(0);
