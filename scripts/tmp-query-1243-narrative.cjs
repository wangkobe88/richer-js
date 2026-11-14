// 一次性查询：0x12434b4a4e587984c0422929163b58c8a67c7777 叙事分析结果（单条小结果）
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0x12434b4a4e587984c0422929163b58c8a67c7777';

async function main() {
  const client = await dbManager.getClient();

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
      console.log(`--- pre_check: pass=${pc.pass} rule=${pc.ruleName ?? '-'} reason=${String(pc.reason ?? '').slice(0, 500)}`);
      if (pc.details) console.log(`    details=${JSON.stringify(pc.details).slice(0, 1200)}`);
    } else {
      console.log('--- pre_check_result: null');
    }
    const ps = narr.prestage_result;
    if (ps) console.log(`--- prestage_result: ${JSON.stringify(ps).slice(0, 600)}`);
    const fr = narr.final_result;
    if (fr) {
      console.log(`--- final_result: ${JSON.stringify(fr).slice(0, 4000)}`);
    } else {
      console.log('--- final_result: null');
    }
    const er = narr.event_result;
    if (er) {
      console.log(`--- event_result(jev 审计): ${JSON.stringify(er).slice(0, 5000)}`);
    }
    console.log(`--- classified_urls: ${JSON.stringify(narr.classified_urls).slice(0, 1000)}`);
    const rad = narr.raw_api_data;
    if (rad) {
      const r = typeof rad === 'string' ? JSON.parse(rad) : rad;
      console.log(`--- raw_api_data.created_at=${r.created_at ?? '-'} name=${r.name ?? '-'} symbol=${r.symbol ?? '-'}`);
      const se = r.search_evidence;
      if (se) {
        console.log(`--- search_evidence.query="${se.query ?? se.term ?? '-'}" count=${se.tweets?.length ?? se.count ?? '-'} searchedAt=${se.searched_at ?? '-'}`);
        const tw = se.tweets ?? [];
        tw.slice(0, 5).forEach((t, i) => {
          console.log(`    [${i}] ${t.created_at ?? '-'} @${t.user?.screen_name ?? '-'} 粉=${t.user?.followers_count ?? '-'} 赞=${t.favorite_count ?? '-'} : ${String(t.full_text ?? t.text ?? '').slice(0, 200)}`);
        });
      } else {
        console.log('--- search_evidence: 无');
      }
    }
    const ti = narr.twitter_info;
    if (ti) {
      const t = typeof ti === 'string' ? JSON.parse(ti) : ti;
      const mt = t.main_tweet;
      console.log(`--- twitter_info.main_tweet: ${mt ? `${mt.created_at ?? '-'} 作者=@${mt.user?.screen_name ?? '-'} 粉=${mt.user?.followers_count ?? '-'} 赞=${mt.favorite_count ?? '-'} 转=${mt.retweet_count ?? '-'}\n    text=${String(mt.full_text ?? mt.text ?? '').slice(0, 800)}` : 'null'}`);
      if (t.in_reply_to) console.log(`--- in_reply_to: created_at=${t.in_reply_to.created_at ?? '-'} text=${String(t.in_reply_to.full_text ?? t.in_reply_to.text ?? '').slice(0, 400)}`);
    } else {
      console.log('--- twitter_info: null');
    }
  }

  const { data: raw, error: e2 } = await client
    .from('token_narrative')
    .select('jev_raw_output')
    .eq('token_address', ADDR)
    .maybeSingle();
  if (!e2 && raw?.jev_raw_output) {
    console.log(`--- jev_raw_output: ${JSON.stringify(raw.jev_raw_output).slice(0, 6000)}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
