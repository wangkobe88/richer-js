// 深挖 58e4 票：叙事本体（语料/state）+ bluechip_event_identity 条件题是否在场
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0x58e40949656a84189d47f52a0c0b53f895de7777';

(async () => {
  const db = dbManager.getClient();
  const { data, error } = await db
    .from('token_narrative')
    .select('final_result,event_score_result,pre_check_result,classified_urls,twitter_info,raw_api_data,jev_prompt')
    .eq('token_address', ADDR)
    .single();
  if (error) throw error;

  // 1. twitter_info 完整形状
  console.log('=== twitter_info keys:', data.twitter_info ? Object.keys(data.twitter_info).join(',') : 'NULL');
  console.log(JSON.stringify(data.twitter_info, null, 1)?.slice(0, 3000));

  // 2. Jev 档案完整审计（relPositive/rel 段）
  const j = data.event_score_result?.details?.jev || {};
  const audit = Object.fromEntries(Object.entries(j).filter(([k]) => k !== 'probabilities'));
  console.log('\n=== event_score jev audit 全量 ===');
  console.log(JSON.stringify(audit, null, 1));

  // 3. bluechip_event_identity 在不在 probabilities（C242 条件题）
  console.log('\n=== probabilities keys:', Object.keys(j.probabilities || {}).join(','));
  console.log('bluechip_event_identity:', JSON.stringify(j.probabilities?.bluechip_event_identity));

  // 4. relation_result（关联层）
  if (data.relation_result) {
    console.log('\n=== relation_result ===');
    console.log(JSON.stringify(data.relation_result).slice(0, 1200));
  }

  // 5. raw_api_data 语料关键段
  const rad = data.raw_api_data || {};
  console.log('\n=== raw_api_data keys:', Object.keys(rad).join(','));
  for (const k of ['name','symbol','description','website','twitter_url','created_at','twitter','socials']) {
    if (rad[k] != null) console.log(`  ${k}:`, JSON.stringify(rad[k]).slice(0, 300));
  }
  if (rad.search_evidence) console.log('  search_evidence:', JSON.stringify(rad.search_evidence).slice(0, 500));

  // 6. jev_prompt state 里主语料段（看叙事讲的是什么）
  const st = data.jev_prompt?.state || '';
  if (st) {
    console.log('\n=== jev state 长度:', st.length);
    // 抓 [KNOWLEDGE_BASE] 段与主推段附近文本
    const kbIdx = st.indexOf('[KNOWLEDGE_BASE]');
    if (kbIdx >= 0) console.log('--- [KNOWLEDGE_BASE] 段:\n', st.slice(kbIdx, kbIdx + 1500));
    const twIdx = st.indexOf('[TWITTER]');
    if (twIdx >= 0) console.log('\n--- [TWITTER] 段:\n', st.slice(twIdx, twIdx + 2500));
  }

  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
