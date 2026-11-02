const path = require('path');
const { dbManager } = require(path.join(__dirname, '../src/services/dbManager'));
const TOK = '0xe8e0c8737701105824403a5aaccd0030018a7777';
async function main() {
  const client = dbManager.getClient();
  const d = await client.from('cheat_detection')
    .select('analyzed_at, answers_raw')
    .eq('token_address', TOK).order('analyzed_at').limit(1);
  const raw = d.data[0].answers_raw || {};
  console.log('answers_raw 键:', Object.keys(raw).join(','));
  const ans = raw.answers || raw;
  const arr = Array.isArray(ans) ? ans : Object.entries(ans);
  for (const a of arr) {
    const s = JSON.stringify(a);
    if (/insider|coordinated|equal_amount|sell_disp|creator/.test(s)) console.log(s.slice(0, 500));
  }
  process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
