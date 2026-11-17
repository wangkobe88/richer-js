// duanju buyPoint 完整 answers/state 渲染取证（182 跑）：act 题答案+burst 行是否在场
const { dbManager } = require('../src/services/dbManager.js');

async function main() {
  const c = await dbManager.getClient();
  const { data: exps } = await c.from('experiments').select('id').limit(500);
  const id = exps.find((e) => e.id.startsWith('4af09d63')).id;
  const { data: sig } = await c.from('strategy_signals')
    .select('created_at,metadata')
    .eq('experiment_id', id).eq('signal_type', 'BUY')
    .ilike('token_address', '0x65aebe91%')
    .order('created_at', { ascending: true }).limit(1);
  const bp = sig[0].metadata.buyPoint;
  console.log('buyPoint 顶层键:', Object.keys(bp).join(','));
  for (const k of Object.keys(bp)) {
    if (k === 'anchors') continue;
    console.log(`\n[${k}]`, JSON.stringify(bp[k]).slice(0, 2000));
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
