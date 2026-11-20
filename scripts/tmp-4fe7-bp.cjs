require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const EXP = 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f';
const TOK = '0x4fe71b03ed8be235fb2b7671f8b84caecad57777';
const SIG = '6096cd38-f0c7-474c-b40f-993951183015';

async function main() {
  const sb = dbManager.getClient();
  const { data } = await sb.from('strategy_signals')
    .select('metadata').eq('id', SIG).single();
  const bp = data.metadata.buyPoint;
  console.log('BP dimensions:', JSON.stringify(bp.dimensions, null, 1).slice(0, 2000));
  console.log('BP assessment:', JSON.stringify(bp.assessment).slice(0, 500));
  const anc = bp.anchors || {};
  // 尾窗/活跃度相关锚
  const keys = Object.keys(anc);
  console.log('anchor keys:', keys.join(','));
  const pick = {};
  for (const k of keys) {
    if (/tail|pre|act|span|tick|idle|gap|trade|volume|win|seg|dump|phase|open|famous/i.test(k)) pick[k] = anc[k];
  }
  console.log('picked anchors:', JSON.stringify(pick, null, 1).slice(0, 3000));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
