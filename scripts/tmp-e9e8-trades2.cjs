const { dbManager } = require('../src/services/dbManager');
const EXP = '2bdf98ab-d85f-40fa-84b5-d79099e1006c';
const TOKEN = '0xe9e82d1fa74283991dec5543453373ec836b7777';
async function main() {
  const sb = dbManager.getClient();
  const { data: ts } = await sb.from('trades').select('*').eq('experiment_id', EXP).eq('token_address', TOKEN).order('executed_at');
  for (const t of ts || []) {
    const pick = {};
    for (const k of Object.keys(t)) {
      const v = t[k];
      if (v !== null && v !== undefined && typeof v !== 'object') pick[k] = v;
    }
    console.log(JSON.stringify(pick));
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
