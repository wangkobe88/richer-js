require('dotenv').config({ path: './config/.env' });
const { dbManager } = require('./src/services/dbManager');
(async () => {
  const db = dbManager.getClient();
  const { data, error } = await db
    .from('strategy_signals')
    .select('*')
    .eq('id', '2f785e36-0874-4ae3-ae00-de97e8f3f9b7')
    .limit(1);
  if (error) { console.log('ERR', error.message); process.exit(1); }
  const s = data && data[0];
  if (!s) { console.log('(not found)'); process.exit(0); }
  const fs = require('fs');
  fs.writeFileSync('tmp-diag-c01c-signal1.json', JSON.stringify(s, null, 2));
  const md = s.metadata || {};
  console.log('created_at:', s.created_at, 'type:', s.signal_type, 'action:', s.action);
  console.log('metadata keys:', Object.keys(md).join(','));
  // 打印结构骨架
  const summarize = (o, depth, prefix) => {
    for (const k of Object.keys(o || {})) {
      const v = o[k];
      const t = Array.isArray(v) ? 'array(' + v.length + ')' : (v && typeof v === 'object' ? 'object(' + Object.keys(v).length + ')' : typeof v);
      console.log(prefix + k + ': ' + t);
      if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) summarize(v, depth + 1, prefix + '  ');
    }
  };
  summarize(md, 0, '');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
