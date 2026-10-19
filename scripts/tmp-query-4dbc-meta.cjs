// 一次性查询：0x4dbc…7777 raw_api_data.meta + token_create 事件（单票小结果）
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0x4dbcb10e68626b6f663bd596905d41cdc6b07777';

async function main() {
  const client = await dbManager.getClient();

  const { data: tn, error: e1 } = await client
    .from('token_narrative')
    .select('raw_api_data,extracted_info,twitter_info,token_symbol')
    .eq('token_address', ADDR)
    .maybeSingle();
  if (e1) throw e1;
  const raw = tn?.raw_api_data || {};
  console.log('=== raw_api_data 标量键 ===');
  for (const k of ['name', 'symbol', 'short_name', 'platform', 'chain', 'created_at', 'meta', 'twitter_url', 'website_url', 'twitterUrl', 'webUrl', 'description', 'introduction']) {
    if (raw[k] !== undefined) console.log(`${k} = ${JSON.stringify(raw[k])?.slice(0, 300)}`);
  }
  console.log('\n=== raw_api_data 顶层 keys ===');
  console.log(Object.keys(raw).join(', '));
  console.log('\n=== extracted_info ===');
  console.log(JSON.stringify(tn?.extracted_info, null, 2)?.slice(0, 1500));
  console.log('\n=== twitter_info ===');
  console.log(JSON.stringify(tn?.twitter_info, null, 2)?.slice(0, 800));

  console.log(`source = ${JSON.stringify(raw.source)} creator = ${JSON.stringify(raw.creator)} eventTs = ${JSON.stringify(raw.eventTs)}`);

  // token_create 事件（platform + meta）
  const { data: ev, error: e2 } = await client
    .from('wss_events')
    .select('*')
    .eq('token_address', ADDR)
    .eq('kind', 'token_create')
    .limit(2);
  if (e2) throw e2;
  console.log(`\n=== token_create 事件: ${ev?.length ?? 0} 行 ===`);
  for (const e of ev || []) {
    const p = e.payload || {};
    console.log('  行列 keys: ' + Object.keys(e).join(', '));
    console.log(`  platform=${e.platform ?? p.platform ?? '?'} payload.source=${p.source ?? '?'}`);
    for (const k of ['name', 'symbol', 'meta', 'metaUri', 'tokenUri', 'twitterUrl', 'webUrl', 'twitter_url', 'website']) {
      if (p[k] !== undefined) console.log(`  payload.${k} = ${JSON.stringify(p[k])?.slice(0, 300)}`);
    }
  }

  // 直抓 meta JSON（单条小读取，8s 超时）
  const META = raw.meta;
  if (typeof META === 'string' && META.startsWith('http')) {
    console.log('\n=== 直抓 meta JSON ===');
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 8000);
      const res = await fetch(META, { signal: ac.signal });
      clearTimeout(t);
      console.log(`HTTP ${res.status}`);
      const text = await res.text();
      console.log(text.slice(0, 2000));
    } catch (err) {
      console.log(`抓取失败: ${err.message}`);
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
