// 一次性：查实验 19ef6433 基本信息 + trades/signals 计数（单行/计数级，轻量）
const { dbManager } = require('../src/services/dbManager.js');
(async () => {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments')
    .select('*')
    .eq('id', '19ef6433-0c92-47ff-a6fd-9f6bea745b8d').limit(1);
  if (error) throw new Error(error.message);
  if (!data || !data[0]) { console.log('EXPERIMENT MISSING'); process.exit(0); }
  const e = data[0];
  console.log('keys:', Object.keys(e).join(','));
  console.log('name:', e.title || e.experiment_name || e.name, '| status:', e.status, '| type:', e.type, '| platform:', e.platform);
  console.log('started:', e.started_at, '| stopped:', e.stopped_at);
  const cfg = e.config || {};
  console.log('backtest:', JSON.stringify(cfg.backtest || null));
  console.log('factorCheck:', JSON.stringify((cfg.fourmemeWs || {}).buyPointCheck || null));
  const t = await c.from('trades').select('id', { count: 'exact', head: true }).eq('experiment_id', e.id);
  console.log('trades count:', t.count);
  const s = await c.from('strategy_signals').select('id', { count: 'exact', head: true }).eq('experiment_id', e.id);
  console.log('signals count:', s.count);
  process.exit(0);
})().catch((e2) => { console.error('ERR', e2.message); process.exit(1); });
