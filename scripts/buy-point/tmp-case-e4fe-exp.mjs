import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const { data: exp, error } = await c.from('experiments')
  .select('*')
  .eq('id','5390bbfa-0c86-48a2-b9e1-94537c54ac17').single();
if (error) throw new Error(error.message);
const cols = Object.keys(exp);
console.log('cols:', cols.join(','));
for (const k of ['name','title','experiment_name','status','created_at','updated_at','started_at','stopped_at']) {
  if (exp[k] !== undefined) console.log(k, '=', exp[k]);
}
const cfg = exp.config || {};
console.log('config keys:', Object.keys(cfg).join(','));
process.exit(0);
