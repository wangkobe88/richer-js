// 一次性查询：0x8cb6be67aaab6cdd9116fbd02f370cf494ca7777 叙事分析结果（单条小结果）
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0x8cb6be67aaab6cdd9116fbd02f370cf494ca7777';

async function main() {
  const client = await dbManager.getClient();

  // 1. token_narrative 主行
  const { data: narr, error: e1 } = await client
    .from('token_narrative')
    .select('id,token_address,token_symbol,token_category,analyzed_at,is_valid,prompt_version,pre_check_result,prestage_result,final_result,event_score_result,event_result,classified_urls,twitter_info,raw_api_data')
    .eq('token_address', ADDR)
    .maybeSingle();
  if (e1) throw e1;
  if (!narr) {
    console.log('token_narrative 无行');
  } else {
    console.log(`=== token_narrative #${narr.id} symbol=${narr.token_symbol} category=${narr.token_category ?? '-'} analyzed_at=${narr.analyzed_at} is_valid=${narr.is_valid} prompt_version=${narr.prompt_version ?? '-'} ===`);
    const pc = narr.pre_check_result;
    if (pc) {
      console.log(`--- pre_check: pass=${pc.pass} rule=${pc.ruleName ?? '-'} reason=${String(pc.reason ?? '').slice(0, 400)}`);
    } else {
      console.log('--- pre_check_result: null');
    }
    const fr = narr.final_result;
    if (fr) {
      console.log(`--- final_result: ${JSON.stringify(fr).slice(0, 4000)}`);
    } else {
      console.log('--- final_result: null');
    }
    const er = narr.event_result;
    if (er) {
      console.log(`--- event_result(jev 审计): ${JSON.stringify(er).slice(0, 4000)}`);
    }
    console.log(`--- classified_urls: ${JSON.stringify(narr.classified_urls).slice(0, 800)}`);
    const rad = narr.raw_api_data;
    if (rad) {
      const r = typeof rad === 'string' ? JSON.parse(rad) : rad;
      console.log(`--- raw_api_data.created_at=${r.created_at ?? '-'} name=${r.name ?? '-'} search_evidence keys=${r.search_evidence ? Object.keys(r.search_evidence).join(',') : '-'}`);
    }
    const ti = narr.twitter_info;
    if (ti) {
      const t = typeof ti === 'string' ? JSON.parse(ti) : ti;
      const mt = t.main_tweet;
      console.log(`--- twitter_info.main_tweet: ${mt ? `${mt.created_at ?? '-'} 作者=@${mt.user?.screen_name ?? '-'} 粉=${mt.user?.followers_count ?? '-'} 赞=${mt.favorite_count ?? '-'} 转=${mt.retweet_count ?? '-'}\n    text=${String(mt.full_text ?? mt.text ?? '').slice(0, 800)}` : 'null'}`);
      if (t.in_reply_to) console.log(`--- in_reply_to: created_at=${t.in_reply_to.created_at ?? '-'} text=${String(t.in_reply_to.full_text ?? t.in_reply_to.text ?? '').slice(0, 400)}`);
    }
  }

  // 2. jev_raw_output / 逐题答案（若表有列）——先用 final_result 内嵌审计兜底，此处查 raw 列
  const { data: raw, error: e2 } = await client
    .from('token_narrative')
    .select('jev_raw_output')
    .eq('token_address', ADDR)
    .maybeSingle();
  if (!e2 && raw?.jev_raw_output) {
    console.log(`--- jev_raw_output: ${JSON.stringify(raw.jev_raw_output).slice(0, 5000)}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
