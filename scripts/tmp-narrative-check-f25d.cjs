// 单票叙事结果排查：0xf25d 为什么叙事分析没过？
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0xf25dcd1c1652e56718518d49e6006def757e7777';

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
    if (pcr?.details) {
      console.log('    pcr.details.ruleName:', pcr.details.ruleName, '| details keys:', Object.keys(pcr.details).join(','));
      if (pcr.details.freshness) console.log('    freshness:', JSON.stringify(pcr.details.freshness).slice(0, 400));
    }
    const fin = row.final_result;
    if (fin) {
      console.log('--- final.rating:', fin.rating, '| reason:', (fin.reason || '').slice(0, 600));
      if (fin.details) {
        const d = fin.details;
        console.log('    blockReason:', d.blockReason, '| scores: event', d.eventCompositeScore, 'rel', d.relevanceScore, 'qual', d.qualityScore, '| category:', d.category);
        if (d.timing != null) console.log('    timing:', JSON.stringify(d.timing).slice(0, 300));
        if (d.jev) {
          console.log('    jev keys:', Object.keys(d.jev).join(','));
          console.log('    jev audit:', JSON.stringify(d.jev).slice(0, 3000));
        }
      }
    } else {
      console.log('--- final_result: NULL');
    }
    if (row.prestage_result) console.log('--- prestage:', JSON.stringify(row.prestage_result).slice(0, 800));

    const ti = row.twitter_info;
    if (ti) {
      console.log('--- twitter_info type:', ti.type, '| handle:', ti.handle ?? ti.screen_name, '| 粉丝:', ti.followers_count, '| name:', ti.name);
      const tw = ti.tweets || [];
      console.log('    推文数:', tw.length);
      for (const t of tw.slice(0, 5)) {
        const txt = (t.full_text || t.text || '');
        console.log(`    tweet ${t.id_str ?? ''} created: ${t.created_at} | 赞:${t.favorite_count} 转:${t.retweet_count}`);
        console.log('    text:', txt.slice(0, 400).replace(/\n/g, ' ⏎ '));
        if (t.in_reply_to) console.log('    in_reply_to:', JSON.stringify(t.in_reply_to).slice(0, 200));
      }
      if (ti.description) console.log('    bio:', ti.description.slice(0, 200));
      if (ti.created_at) console.log('    账号注册:', ti.created_at);
    } else {
      console.log('--- twitter_info: NULL');
    }
    console.log('--- classified_urls:', JSON.stringify(row.classified_urls).slice(0, 800));

    const rad = row.raw_api_data || {};
    console.log('--- raw created_at:', rad.created_at, '| symbol:', rad.symbol, '| name:', rad.name);
    if (rad.twitter_url) console.log('--- twitter_url(原料):', rad.twitter_url);
    if (rad.search_evidence) console.log('--- search_evidence:', JSON.stringify(rad.search_evidence).slice(0, 600));
    if (rad.knowledge_matches) console.log('--- knowledge_matches:', JSON.stringify(rad.knowledge_matches).slice(0, 400));
    if (rad.appendix) console.log('--- appendix:', JSON.stringify(rad.appendix).slice(0, 300));
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
      const md = s.metadata || {};
      if (md.narrativeCall) console.log('   narrativeCall:', JSON.stringify(md.narrativeCall).slice(0, 600));
      if (md.narrative) console.log('   narrative(md.narrative):', JSON.stringify(md.narrative).slice(0, 600));
    }
  }

  const { data: trs, error: e4 } = await db
    .from('trades')
    .select('id,experiment_id,side,amount_bnb,price_bnb,trade_time')
    .eq('token_address', ADDR)
    .order('trade_time', { ascending: true })
    .limit(10);
  if (e4) console.log('trades error:', e4.message);
  else console.log('\n=== trades 行数:', trs.length);

  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
