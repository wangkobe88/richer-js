// 实证语料：external_resource_cache 按 url 模式查推文抓取缓存
const { dbManager } = require('../src/services/dbManager.js');

(async () => {
  const db = dbManager.getClient();
  const pats = ['%cbca7142%', '%2115731940309659667%', '%2113475181188612363%', '%lifan690%', '%zelopus%'];
  const or = pats.map((p) => `url.ilike.${p}`).join(',');
  const { data: rows, error } = await db.from('external_resource_cache')
    .select('url,resource_type,status,cached_at,expires_at,content,metadata')
    .or(or)
    .order('cached_at', { ascending: false }).limit(20);
  if (error) throw error;
  console.log('命中', rows.length, '行');
  for (const r of rows) {
    console.log('\n=== url:', r.url.slice(0, 150));
    console.log('    type:', r.resource_type, '| status:', r.status, '| cached:', r.cached_at);
    const c = r.content;
    if (c) {
      const s = typeof c === 'string' ? c : JSON.stringify(c);
      console.log('    content:', s.slice(0, 800));
    }
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
