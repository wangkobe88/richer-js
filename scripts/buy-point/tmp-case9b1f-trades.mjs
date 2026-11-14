import { dbManager } from '../../src/services/dbManager.js';
const EXP = '5390bbfa-0c86-48a2-b9e1-94537c54ac17';
const TOKEN = '0x9b1fb6a662e2b1e5a521ea1dd5147f13184b7777';
const c = await dbManager.getClient();
const all = []; let from = 0;
while (true) {
  const { data, error } = await c.from('trades').select('*').eq('experiment_id', EXP)
    .order('id', { ascending: true }).range(from, from + 999);
  if (error) throw new Error(error.message);
  all.push(...data); if (data.length < 1000) break; from += 1000;
}
console.log('total trades in exp:', all.length);
const rows = all.filter(t => (t.token_address || '').toLowerCase() === TOKEN);
console.log('rows for token:', rows.length);
for (const t of rows) {
  const keep = {};
  for (const k of Object.keys(t)) if (t[k] !== null && k !== 'metadata' && k !== 'id') keep[k] = t[k];
  console.log(JSON.stringify(keep));
}
await dbManager.destroy?.();
