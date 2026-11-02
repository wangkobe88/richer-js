// 单票排查：GMGN 名字票 0x699a…7777（token_narrative + experiment_tokens + trades 单条读取）
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0x699a81a93f55d52691f20a9818d8a042e6cd7777';

(async () => {
  const db = dbManager.getClient();

  const { data: et, error: e0 } = await db
    .from('experiment_tokens')
    .select('*')
    .eq('token_address', ADDR)
    .limit(1);
  if (e0) throw e0;
  console.log('=== experiment_tokens 行数:', et.length);
  for (const r of et) {
    console.log('cols:', Object.keys(r).join(','));
    console.log(`exp=${r.experiment_id} platform=${r.platform} symbol=${r.token_symbol}`);
    console.log(`   intro: ${(r.intro || '').slice(0, 200)}`);
    console.log(`   creator: ${r.creator_address} / handle=${r.creator_handle}`);
  }

  const { data: tn, error: e1 } = await db
    .from('token_narrative')
    .select('analyzed_at,is_valid,prompt_version,pre_check_result,final_result,event_score_result,relation_result,classified_urls,twitter_info,raw_api_data')
    .eq('token_address', ADDR);
  if (e1) throw e1;
  console.log('\n=== token_narrative 行数:', tn.length);
  for (const row of tn) {
    console.log('analyzed_at:', row.analyzed_at, '| is_valid:', row.is_valid, '| pv:', row.prompt_version);
    const pcr = row.pre_check_result;
    console.log('pre_check.pass:', pcr?.pass, '| reason:', pcr?.reason);
    const fin = row.final_result;
    if (fin) {
      console.log('final.rating:', fin.rating, '| reason:', (fin.reason || '').slice(0, 500));
      if (fin.details) {
        const d = fin.details;
        console.log('blockReason:', d.blockReason, '| event', d.eventCompositeScore, 'rel', d.relevanceScore, 'qual', d.qualityScore);
        if (d.jev) console.log('jev audit:', JSON.stringify(d.jev).slice(0, 2500));
      }
    } else console.log('final_result: NULL');
    const esr = row.event_score_result;
    if (esr) {
      const j = esr?.details?.jev || {};
      console.log('event_score blockChoice:', j.blockChoice);
      console.log('  probabilities:', JSON.stringify(j.probabilities).slice(0, 1200));
    }
    const ti = row.twitter_info;
    if (ti) {
      console.log('twitter handle:', ti.handle ?? ti.screen_name, '| 粉丝:', ti.followers_count, '| name:', ti.name);
      for (const t of (ti.tweets || []).slice(0, 4)) {
        console.log(`  tweet ${t.created_at} 赞${t.favorite_count} 转${t.retweet_count}:`, (t.full_text || t.text || '').slice(0, 300));
      }
    } else console.log('twitter_info: NULL');
    console.log('classified_urls:', JSON.stringify(row.classified_urls).slice(0, 500));
    const rad = row.raw_api_data || {};
    console.log('raw name/symbol:', rad.name, '/', rad.symbol, '| created_at:', rad.created_at);
    if (rad.knowledge_matches) console.log('knowledge_matches:', JSON.stringify(rad.knowledge_matches).slice(0, 400));
    if (rad.search_evidence) console.log('search_evidence:', JSON.stringify(rad.search_evidence).slice(0, 300));
  }

  const { data: rounds, error: e2 } = await db
    .from('narrative_analysis_rounds')
    .select('experiment_id,reason,rating,created_at,details')
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true });
  if (e2) console.log('rounds error:', e2.message);
  else {
    console.log('\n=== narrative_analysis_rounds 行数:', rounds.length);
    for (const r of rounds) console.log(`round: exp=${r.experiment_id} reason=${r.reason} rating=${r.rating} created=${r.created_at}`);
  }

  const { data: trades, error: e4 } = await db
    .from('trades')
    .select('experiment_id,trade_type,token_amount,bnb_amount,price_bnb,created_at,metadata')
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(20);
  if (e4) console.log('trades error:', e4.message);
  else {
    console.log('\n=== trades 行数:', trades.length);
    for (const t of trades) {
      console.log(`${t.created_at} ${t.trade_type} qty=${t.token_amount} bnb=${t.bnb_amount} price=${t.price_bnb} exp=${t.experiment_id}`);
      if (t.metadata?.cardTrade) console.log('   cardTrade:', JSON.stringify(t.metadata.cardTrade));
      if (t.metadata?.manual) console.log('   manual:', JSON.stringify(t.metadata.manual).slice(0, 200));
    }
  }

  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
// 追加：全量 search_evidence + trades 全列
