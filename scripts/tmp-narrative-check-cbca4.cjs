// 精确 snowflake 换算 + 实际语料实证（external_resource_cache）
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0xcbca7142035dea46ac43f02b398724b27c1f7777';
const snowflake = (id) => new Date(Number(BigInt(id) >> 22n) + 1288834974657).toISOString();
const tokenCreate = new Date(1793264789 * 1000).toISOString();

console.log('token 创建(eventTs):', tokenCreate, '→ 北京', new Date((1793264789 + 8 * 3600) * 1000).toISOString().replace('Z', '+08'));
for (const [who, id] of [['zelopus', '2113475181188612363'], ['lifan690', '2115731940309659667']]) {
  const t = snowflake(id);
  const lag = (1793264789000 - (Number(BigInt(id) >> 22n) + 1288834974657)) / 1000;
  console.log(`${who} 推文: ${t} → 北京 ${new Date(Number(BigInt(id) >> 22n) + 1288834974657 + 8 * 3600 * 1000).toISOString().replace('Z', '+08')} | lag = ${lag.toFixed(0)}s (${(lag / 3600).toFixed(2)}h)`);
}

(async () => {
  const db = dbManager.getClient();
  // 语料抓取缓存实证：twitter 相关 key
  const { data: cache, error } = await db.from('external_resource_cache')
    .select('cache_key,created_at,expires_at')
    .or(`cache_key.ilike.%cbca7142%,cache_key.ilike.%2115731940309659667%,cache_key.ilike.%2113475181188612363%,cache_key.ilike.%lifan690%,cache_key.ilike.%zelopus%`)
    .order('created_at', { ascending: false }).limit(30);
  if (error) console.log('cache error:', error.message);
  else {
    console.log('\n=== external_resource_cache 命中', cache.length, '行:');
    for (const c of cache) console.log(' ', c.cache_key.slice(0, 120), '| created:', c.created_at);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
