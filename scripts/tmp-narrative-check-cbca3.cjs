// 第三刀：event_score_result.parsed_output.jev 的 override 审计键 + timingPenalty 消费点
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0xcbca7142035dea46ac43f02b398724b27c1f7777';

(async () => {
  const db = dbManager.getClient();
  const { data: tn, error } = await db.from('token_narrative')
    .select('event_score_result,prestage_result')
    .eq('token_address', ADDR);
  if (error) throw error;
  const esr = tn[0].event_score_result || {};
  const j = esr?.details?.jev || {};
  console.log('=== override 审计键:');
  for (const k of ['staleSourceOverride', 'staleParentOverride', 'staleRelParentOverride', 'issuerTimingExempt', 'tweetType', 'categoryForced', 'timingPenalty', 'scoringResult', 'recognizedEntitySlogan', 'nameEntityAcceptance', 'nameEntityTypeUnfitMass']) {
    console.log(k, '=', JSON.stringify(j[k] ?? esr?.details?.[k] ?? esr?.[k]));
  }
  console.log('\n=== parsed_output keys:', esr?.parsed_output ? Object.keys(esr.parsed_output).join(',') : '(无)');
  if (esr?.parsed_output?.jev) {
    console.log(JSON.stringify(esr.parsed_output.jev, null, 1));
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
