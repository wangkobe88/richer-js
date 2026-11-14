const path = require('path'); require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');
const db = dbManager.getClient();
(async () => {
  const { data: exps } = await db.from('experiments')
    .select('id,experiment_name,status,config,created_at')
    .in('id', ['a5b43ad1-0000-0000-0000-000000000000'.slice(0,0) || '7a8ac18a', 'a5b43ad1', 'd8d3f246'].length ? ['7a8ac18a-0000-0000-0000-000000000000','a5b43ad1-0000-0000-0000-000000000000','d8d3f246-0000-0000-0000-000000000000'] : [])
    .limit(3).then(r => r).catch(async () => ({}));
  // 上面的 id 是截断的，直接用 ilike 拿完整行
  const { data: rows } = await db.from('experiments')
    .select('id,experiment_name,status,config')
    .ilike('experiment_name', '%bt-v8%').limit(6);
  for (const r of rows || []) {
    const bt = r.config?.backtest || {};
    console.log(`${r.experiment_name} (${r.id})`);
    console.log(`  ${r.status} | ${bt.startTime} → ${bt.endTime} | src=${bt.sourceExperimentId ?? '-'} | tokenAddr=${JSON.stringify(bt.tokenAddresses ?? null)} | maxTickRows=${bt.maxTickRows ?? '?'} | 帽=${r.config?.fourmemeWs?.buySignalMaxPerToken} | 买腿=${r.config?.strategiesConfig?.buyStrategies?.length}`);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
