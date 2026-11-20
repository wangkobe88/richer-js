require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const EXPS = [
  ['bt-v162', 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f', ['calico','FROGE','MOLLY','FLOW','nissan']],
  ['bt-v150', '8ebaccce-62c6-4209-a2a0-40f361c49bf9', ['BI','岳不群','OOC','ZEC']],
];
async function main() {
  const sb = dbManager.getClient();
  for (const [name, exp, syms] of EXPS) {
    for (const s of syms) {
      const { data } = await sb.from('trades').select('token_address,token_symbol')
        .eq('experiment_id', exp).eq('token_symbol', s).limit(1);
      if (data?.[0]) console.log(`${name} ${s} ${data[0].token_address} http://localhost:3010/experiment/${exp}/signals#token=${data[0].token_address}`);
      else console.log(`${name} ${s} MISS`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
