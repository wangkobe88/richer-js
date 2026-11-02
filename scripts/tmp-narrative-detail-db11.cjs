// 深挖单票：empty_content 门命中细节 + 语料形状
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0xdb1160d96885993a69bd9cb149ebff4d4a437777';

(async () => {
  const db = dbManager.getClient();
  const { data, error } = await db
    .from('token_narrative')
    .select('final_result,event_score_result,pre_check_result,classified_urls,twitter_info,raw_api_data')
    .eq('token_address', ADDR)
    .single();
  if (error) throw error;

  const esr = data.event_score_result;
  console.log('=== event_score jev 细节 ===');
  const j = esr?.details?.jev || {};
  console.log('blockChoice:', j.blockChoice);
  console.log('probabilities:', JSON.stringify(j.probabilities, null, 1));
  console.log('audit 全键:', JSON.stringify(Object.fromEntries(Object.entries(j).filter(([k]) => !['probabilities','blockChoice'].includes(k))), null, 1));

  const fd = data.final_result?.details;
  console.log('\n=== final.details 关键审计 ===');
  if (fd) {
    console.log('blockReason:', fd.blockReason);
    console.log('details.jev 审计键:', JSON.stringify(fd.jev || null, null, 1));
  }

  console.log('\n=== twitter_info（语料形状） ===');
  const ti = data.twitter_info;
  if (ti) {
    console.log('handle:', ti.handle ?? ti.screen_name, '| 粉丝:', ti.followers_count, '| name:', ti.name);
    const tw = ti.tweets || [];
    console.log('推文数:', tw.length);
    for (const t of tw.slice(0, 3)) {
      console.log('--- created:', t.created_at, '| 赞:', t.favorite_count, '转:', t.retweet_count);
      console.log((t.full_text || t.text || '').slice(0, 400));
      if (t.image_analysis) console.log('  [image_analysis 存在]:', JSON.stringify(t.image_analysis).slice(0, 300));
      if (Array.isArray(t.entities?.media) && t.entities.media.length) console.log('  [media 在场]', t.entities.media.length, '张');
    }
  } else {
    console.log('twitter_info: NULL');
  }

  console.log('\n=== classified_urls ===');
  console.log(JSON.stringify(data.classified_urls, null, 1)?.slice(0, 800));

  const rad = data.raw_api_data || {};
  console.log('\n=== raw_api_data 锚 ===');
  console.log('created_at:', rad.created_at, '| name:', rad.name, '| symbol:', rad.symbol);
  console.log('raw keys:', Object.keys(rad).join(','));

  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
