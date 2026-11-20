require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const { data: exps } = await sb.from('experiments')
    .select('id, name, status, config->backtest').limit(2000).order('id', { ascending: false });
  const hits = (exps || []).filter(e => /^bt-v(162|158|150|145)$/.test(e.name || ''));
  for (const e of hits) console.log(e.name, e.id, e.status, JSON.stringify({ src: (e.config && e.config.backtest && (e.config.backtest.sourceExperimentId || e.config.backtest.startTime)) }));
  const t = await sb.from('trades').select('*').limit(1);
  console.log('trades cols:', t.data && Object.keys(t.data[0]).join(','));
  const s = await sb.from('strategy_signals').select('*').limit(1);
  console.log('signal cols:', s.data && Object.keys(s.data[0]).join(','));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
