// 深挖 35c4 路由与 CA 证据：raw_api_data 全量 + twitter_info 全量 + token_create meta + GMGN/AVE 缓存痕迹
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0x35c4680cf97ccc6d6d85dd0e5ed9d4faa8907777';

(async () => {
  const db = dbManager.getClient();
  const { data, error } = await db
    .from('token_narrative')
    .select('*')
    .eq('token_address', ADDR)
    .single();
  if (error) throw error;

  console.log('=== 行级字段 ===');
  console.log('token_symbol:', data.token_symbol, '| analyzed_at:', data.analyzed_at, '| is_valid:', data.is_valid);

  const rad = data.raw_api_data || {};
  console.log('\n=== raw_api_data 全键 ===');
  for (const [k, v] of Object.entries(rad)) {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    console.log(`  ${k}: ${(s || '').slice(0, 400)}`);
  }

  console.log('\n=== twitter_info 全键 ===');
  const ti = data.twitter_info || {};
  for (const [k, v] of Object.entries(ti)) {
    if (k === 'tweets') { console.log(`  tweets: ${Array.isArray(v) ? v.length : typeof v} 条`); continue; }
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    console.log(`  ${k}: ${(s || '').slice(0, 300)}`);
  }

  console.log('\n=== pre_check_result 全量 ===');
  console.log(JSON.stringify(data.pre_check_result, null, 1)?.slice(0, 1500));
  console.log('\n=== prestage_result ===');
  console.log(JSON.stringify(data.prestage_result, null, 1)?.slice(0, 1500));

  console.log('\n=== final_result.details.jev（C250 审计细节） ===');
  const j = data.final_result?.details?.jev || {};
  console.log('shellCorpusStale:', JSON.stringify(j.shellCorpusStale, null, 1));

  // wss_events token_create meta（social 原始来源）
  const { data: ev, error: e2 } = await db
    .from('wss_events')
    .select('kind,block_number,payload,created_at')
    .eq('token_address', ADDR)
    .order('id', { ascending: true })
    .limit(5);
  if (e2) console.log('events error:', e2.message);
  else {
    console.log('\n=== wss_events 行数:', ev.length);
    for (const e of ev) {
      console.log(`kind=${e.kind} block=${e.block_number} created=${e.created_at}`);
      const p = e.payload || {};
      for (const [k, v] of Object.entries(p)) {
        const s = typeof v === 'string' ? v : JSON.stringify(v);
        if (['twitter','twitterUrl','website','name','symbol','description','creator','social','socials','meta','uri'].some(x => k.toLowerCase().includes(x)))
          console.log(`   ${k}: ${(s || '').slice(0, 400)}`);
      }
    }
  }

  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
