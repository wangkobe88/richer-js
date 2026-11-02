// 一次性查询：0x90a5…7777 叙事分析结果（单条小结果）
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0x90a5ce7ae44132c06990f05cda15ce854ec27777';

async function main() {
  const client = await dbManager.getClient();

  // 1. token_narrative 主行
  const { data: narr, error: e1 } = await client
    .from('token_narrative')
    .select('id,token_address,token_symbol,analyzed_at,is_valid,prompt_version,pre_check_result,prestage_result,final_result,event_score_result,relation_result,classified_urls,twitter_info,raw_api_data,jev_prompt')
    .eq('token_address', ADDR)
    .maybeSingle();
  if (e1) throw e1;
  if (!narr) {
    console.log('token_narrative 无行');
  } else {
    console.log(`=== token_narrative #${narr.id} symbol=${narr.token_symbol} analyzed_at=${narr.analyzed_at} is_valid=${narr.is_valid} ===`);
    const pc = narr.pre_check_result;
    if (pc) {
      console.log(`--- pre_check_result: pass=${pc.pass} rule=${pc.ruleName ?? '-'} reason=${String(pc.reason ?? '').slice(0, 300)}`);
      if (pc.details) console.log(`    details=${JSON.stringify(pc.details).slice(0, 500)}`);
    } else {
      console.log('--- pre_check_result: null');
    }
    const fr = narr.final_result;
    if (fr) {
      console.log(`--- final_result: ${JSON.stringify(fr).slice(0, 1200)}`);
    } else {
      console.log('--- final_result: null');
    }
    const ps = narr.prestage_result;
    if (ps) {
      console.log(`--- prestage_result: ${JSON.stringify(ps).slice(0, 800)}`);
    }
    console.log(`--- classified_urls: ${JSON.stringify(narr.classified_urls).slice(0, 600)}`);
    const ti = narr.twitter_info;
    if (ti) {
      const t = typeof ti === 'string' ? JSON.parse(ti) : ti;
      console.log(`--- twitter_info keys=${Object.keys(t).join(',')}`);
      if (t.main_tweet) console.log(`    main_tweet: text=${String(t.main_tweet.full_text ?? t.main_tweet.text ?? '').slice(0, 300)}`);
    }
  }

  // 2. 当前实验的信号行（narrativeCall / narrativeTrigger 轨迹）
  const { data: sigs, error: e2 } = await client
    .from('strategy_signals')
    .select('id,experiment_id,signal_type,action,reason,metadata,created_at')
    .eq('token_address', ADDR)
    .order('id', { ascending: true })
    .limit(10);
  if (e2) throw e2;
  console.log(`\n=== signals: ${sigs?.length ?? 0} 行 ===`);
  for (const s of sigs || []) {
    const md = s.metadata || {};
    console.log(`sig#${s.id} exp=${s.experiment_id} type=${s.signal_type} action=${s.action} at=${s.created_at}`);
    console.log(`  reason=${String(s.reason ?? '').slice(0, 300)}`);
    if (md.narrativeCall) {
      const nc = md.narrativeCall;
      console.log(`  narrativeCall.rating=${nc.rating ?? nc.numericRating} category=${nc.narrativeCategory ?? nc.tokenCategory ?? '-'} reason=${String(nc.reason ?? '').slice(0, 300)}`);
    }
  }

  // 3. narrative_analysis_rounds（C84 触发模型轮次留痕）
  const { data: rounds, error: e3 } = await client
    .from('narrative_analysis_rounds')
    .select('*')
    .eq('token_address', ADDR)
    .order('id', { ascending: true })
    .limit(30);
  if (e3) throw e3;
  console.log(`\n=== narrative_analysis_rounds: ${rounds?.length ?? 0} 行 ===`);
  for (const r of rounds || []) {
    console.log(`round#${r.id} exp=${r.experiment_id} round=${r.round} rating=${r.rating} reason=${String(r.reason ?? r.reason_text ?? '').slice(0, 200)} trigger=${r.trigger_condition ?? '-'} at=${r.created_at}`);
    if (r.details) console.log(`    details=${JSON.stringify(r.details).slice(0, 400)}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
