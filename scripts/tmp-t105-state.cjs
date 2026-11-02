const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const c = dbManager.getClient();
  const { data: one } = await c.from('experiments').select('*').order('created_at', { ascending: false }).limit(1);
  console.log('COLS:', one && one[0] ? Object.keys(one[0]).join(',') : 'none');
  const { data: exps, error: e2 } = await c.from('experiments').select('*')
    .order('created_at', { ascending: false }).limit(6);
  if (e2) { console.error('exp err:', e2.message); process.exit(1); }
  for (const e of exps) {
    const legs = (e.config?.strategiesConfig?.strategies) || [];
    const buyLegs = legs.filter(l => l.action === 'buy')
      .map(l => `${l.name}(refs=${(l.libraryRefs || []).map(r => r.name + ':v' + r.version + ' ' + r.id.slice(0, 6)).join('|') || '无'})`);
    console.log('EXP', e.title || e.experiment_name || e.id.slice(0, 8), '|', e.status, '|', e.created_at, '|', e.id.slice(0, 8), '| buys:', buyLegs.join(' ; '));
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
