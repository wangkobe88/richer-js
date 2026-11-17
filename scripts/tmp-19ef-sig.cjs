// bt-v134 (19ef6433) signals 拒因归因（修正列名）
const { dbManager } = require('../src/services/dbManager.js');
const EXP = '19ef6433-0c92-47ff-a6fd-9f6bea745b8d';
async function main() {
  const c = await dbManager.getClient();
  // 先探一行看列
  const { data: probe, error: pe } = await c.from('strategy_signals')
    .select('*').eq('experiment_id', EXP).limit(1);
  if (pe) throw new Error(pe.message);
  if (!probe || !probe[0]) { console.log('NO SIGNALS'); process.exit(0); }
  console.log('signal columns:', Object.keys(probe[0]).join(','));
  const md = probe[0].metadata || {};
  console.log('sample metadata keys:', Object.keys(md).join(','));
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
