// 整行全量 dump：定位 bluechip_event_identity / none 桶真值
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0x58e40949656a84189d47f52a0c0b53f895de7777';

(async () => {
  const db = dbManager.getClient();
  const { data, error } = await db
    .from('token_narrative')
    .select('*')
    .eq('token_address', ADDR)
    .single();
  if (error) throw error;

  const full = JSON.stringify(data);
  console.log('行总长度:', full.length);
  for (const needle of ['bluechip_event_identity', 'new_event', 'same_event', 'none', 'Giggle']) {
    let idx = -1, count = 0;
    const hits = [];
    while ((idx = full.indexOf(needle, idx + 1)) !== -1 && hits.length < 8) { hits.push(idx); count++; }
    console.log(`\n[${needle}] 出现次数(截 8): ${count}`);
    for (const h of hits) console.log('  …', full.slice(Math.max(0, h - 120), h + 200).replace(/\n/g, ' '));
  }

  // bsc_meme_user_event_impact 题完整 probabilities（C242 腿② noneProb）
  const esr = data.event_score_result;
  const j = esr?.details?.jev;
  console.log('\n=== event_score_result.details.jev.probabilities 完整 ===');
  console.log(JSON.stringify(j?.probabilities, null, 1));
  console.log('\n=== event_score_result keys:', esr ? Object.keys(esr).join(',') : 'NULL');

  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
