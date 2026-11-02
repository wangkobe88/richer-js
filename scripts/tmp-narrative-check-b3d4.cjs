// 单票叙事结果排查：token_narrative + narrative_analysis_rounds + signals 单条读取
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0xb3d4d7faf25bec37960be028fbc40bf500957777';

(async () => {
  const db = dbManager.getClient();

  const { data: tn, error: e1 } = await db
    .from('token_narrative')
    .select('id,token_address,token_symbol,analyzed_at,is_valid,prompt_version,pre_check_result,prestage_result,final_result,event_score_result,relation_result,classified_urls,twitter_info,raw_api_data')
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
      console.log('--- final.rating:', fin.rating, '| reason:', (fin.reason || '').slice(0, 400));
      if (fin.details) {
        const d = fin.details;
        console.log('    blockReason:', d.blockReason, '| scores: event', d.eventCompositeScore, 'rel', d.relevanceScore, 'qual', d.qualityScore);
        if (d.jev) console.log('    jev audit:', JSON.stringify(d.jev).slice(0, 1500));
      }
    } else {
      console.log('--- final_result: NULL');
    }
    const esr = row.event_score_result;
    if (esr) {
      const j = esr?.details?.jev || {};
      console.log('--- event_score blockChoice:', j.blockChoice);
      console.log('    probabilities:', JSON.stringify(j.probabilities).slice(0, 800));
      const audit = Object.fromEntries(Object.entries(j).filter(([k]) => !['probabilities','blockChoice'].includes(k)));
      console.log('    audit:', JSON.stringify(audit).slice(0, 800));
    }
    if (row.prestage_result) console.log('--- prestage:', JSON.stringify(row.prestage_result).slice(0, 300));
    // 语料形状
    const ti = row.twitter_info;
    if (ti) {
      console.log('--- twitter_info handle:', ti.handle ?? ti.screen_name, '| 粉丝:', ti.followers_count, '| name:', ti.name);
      const tw = ti.tweets || [];
      console.log('    推文数:', tw.length);
      for (const t of tw.slice(0, 3)) {
        console.log('    tweet created:', t.created_at, '| 赞:', t.favorite_count, '转:', t.retweet_count);
        console.log('    text:', (t.full_text || t.text || '').slice(0, 300));
        if (t.image_analysis) console.log('    [image_analysis]:', JSON.stringify(t.image_analysis).slice(0, 200));
        if (Array.isArray(t.entities?.media) && t.entities.media.length) console.log('    [media]', t.entities.media.length, '张');
      }
    } else {
      console.log('--- twitter_info: NULL');
    }
    console.log('--- classified_urls:', JSON.stringify(row.classified_urls).slice(0, 500));
    const rad = row.raw_api_data || {};
    console.log('--- raw_api_data created_at:', rad.created_at, '| symbol:', rad.symbol, '| name:', rad.name);
    if (rad.search_evidence) console.log('--- search_evidence:', JSON.stringify(rad.search_evidence).slice(0, 400));
    if (rad.knowledge_matches) console.log('--- knowledge_matches:', JSON.stringify(rad.knowledge_matches).slice(0, 400));
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
      if (r.details) console.log('   details:', JSON.stringify(r.details).slice(0, 400));
    }
  }

  // 当前实验 signals 留痕（这票有没有到过信号层）
  const { data: sigs, error: e3 } = await db
    .from('strategy_signals')
    .select('id,experiment_id,strategy_id,signal_type,action,reason,created_at,metadata')
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(20);
  if (e3) console.log('signals error:', e3.message);
  else {
    console.log('\n=== strategy_signals 行数:', sigs.length);
    for (const s of sigs) {
      console.log(`signal: exp=${s.experiment_id} type=${s.signal_type} action=${s.action} created=${s.created_at}`);
      console.log('   reason:', (s.reason || '').slice(0, 300));
      const nc = s.metadata?.narrativeCall || s.metadata?.trigger;
      if (nc) console.log('   metadata narrative:', JSON.stringify(nc).slice(0, 400));
    }
  }

  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
