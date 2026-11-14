const { dbManager } = require('../src/services/dbManager.js');
const V114 = '685c9518-27eb-4be1-ac4c-764dc488a5f6';
const V115 = '34e78e97-2b1f-4e3d-8272-b0cdd6b641ca';
async function main() {
  const c = await dbManager.getClient();
  for (const [expId, tag] of [[V114, 'v114'], [V115, 'v115']]) {
    const { data, error } = await c.from('strategy_signals').select('metadata,signal_type,token_address,created_at')
      .eq('experiment_id', expId).eq('signal_type', 'SELL');
    if (error) throw new Error(error.message);
    const dist = new Map(), whyDist = new Map();
    for (const s of data) {
      const m = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : (s.metadata || {});
      const sid = m.strategyId || '?';
      dist.set(sid, (dist.get(sid) || 0) + 1);
    }
    console.log(`== ${tag} SELL 信号 strategyId 分布（n=${data.length}）==`);
    for (const [sid, n] of [...dist.entries()].sort((x, y) => y[1] - x[1])) console.log(`  ${sid}: ${n}`);
    console.log('');
  }
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
