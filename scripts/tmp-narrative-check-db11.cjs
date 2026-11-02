// 单票叙事结果排查：token_narrative + narrative_analysis_rounds + signals 单条读取
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0xdb1160d96885993a69bd9cb149ebff4d4a437777';

(async () => {
  const db = dbManager.getClient();

  const { data: tn, error: e1 } = await db
    .from('token_narrative')
    .select('id,token_address,token_symbol,analyzed_at,is_valid,prompt_version,pre_check_result,prestage_result,final_result,event_score_result,relation_result')
    .eq('token_address', ADDR);
  if (e1) throw e1;
  console.log('=== token_narrative 行数:', tn.length);
  for (const row of tn) {
    console.log('symbol:', row.token_symbol, '| analyzed_at:', row.analyzed_at, '| is_valid:', row.is_valid, '| prompt_version:', row.prompt_version);
    const pcr = row.pre_check_result;
    console.log('--- pre_check_result.pass:', pcr?.pass, '| reason:', pcr?.reason);
    if (pcr?.details) console.log('    pcr.details.ruleName:', pcr.details.ruleName, '| details keys:', Object.keys(pcr.details).join(','));
    const fin = row.final_result;
    if (fin) {
      console.log('--- final.rating:', fin.rating, '| reason:', (fin.reason || '').slice(0, 300));
      console.log('    final keys:', Object.keys(fin).join(','));
      if (fin.details) {
        const d = fin.details;
        console.log('    blockReason:', d.blockReason, '| score:', d.eventCompositeScore, d.relevanceScore, d.qualityScore);
        if (d.jev) console.log('    jev audit keys:', Object.keys(d.jev).join(','));
      }
    } else {
      console.log('--- final_result: NULL');
    }
    const esr = row.event_score_result;
    if (esr) console.log('--- event_score keys:', Object.keys(esr).join(','), JSON.stringify(esr).slice(0, 400));
    if (row.prestage_result) console.log('--- prestage:', JSON.stringify(row.prestage_result).slice(0, 300));
  }

  const { data: rounds, error: e2 } = await db
    .from('narrative_analysis_rounds')
    .select('*')
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true });
  if (e2) console.log('rounds error:', e2.message);
  else {
    console.log('\n=== narrative_analysis_rounds 行数:', rounds.length);
    for (const r of rounds) {
      console.log(`round: exp=${r.experiment_id} reason=${r.reason} rating=${r.rating} created=${r.created_at}`);
      if (r.details) console.log('   details:', JSON.stringify(r.details).slice(0, 300));
    }
  }

  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
