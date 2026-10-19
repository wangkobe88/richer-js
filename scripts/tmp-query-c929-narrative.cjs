// 一次性查询：0xc929…7777 为何没过叙事分析（单行/少行小结果）
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0xc929c8d1e57569b706d7cfdc3487c7d33b287777';

function j(v, n = 1200) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s == null ? 'null' : (s.length > n ? s.slice(0, n) + `…(+${s.length - n})` : s);
}

async function main() {
  const client = await dbManager.getClient();

  // 1) token_narrative 行
  const { data: narr, error: e1 } = await client
    .from('token_narrative')
    .select('*')
    .eq('token_address', ADDR.toLowerCase())
    .maybeSingle();
  if (e1) throw e1;
  if (!narr) {
    console.log('token_narrative: 无行（从未完成过一次分析）');
  } else {
    console.log(`=== token_narrative id=${narr.id} analyzed_at=${narr.analyzed_at} is_valid=${narr.is_valid} ===`);
    console.log(`rating(numeric)=${narr.numeric_rating ?? narr.rating} category=${narr.token_category}`);
    console.log(`pre_check_result=${j(narr.pre_check_result, 600)}`);
    for (const col of ['stage1_result', 'stage2_result', 'stage3_result', 'stage_final_result']) {
      const s = narr[col];
      if (s == null) { console.log(`${col}: null`); continue; }
      console.log(`--- ${col} ---`);
      console.log(j(s, 4000));
    }
    console.log(`--- classified_urls=${j(narr.classified_urls, 800)}`);
    console.log(`--- gmgn_info 非空=${narr.gmgn_info != null}`);
    const raw = narr.raw_api_data;
    if (raw) {
      console.log(`--- raw_api_data.created_at=${raw.created_at} name=${raw.name} symbol=${raw.symbol}`);
      const ti = raw.twitter_info || raw.twitterInfo;
      if (ti) console.log(`--- twitter_info: handle=${ti.screen_name ?? ti.handle} 粉丝=${ti.followers_count ?? '?'} 推文数=${(ti.tweets || ti.full_tweets || []).length ?? '?'}`);
    }
    // prestage 行（账号自发宣告路径）
    if (narr.prestage_result !== undefined) console.log(`--- prestage_result=${j(narr.prestage_result, 800)}`);
    if (narr.parsed_prestage !== undefined) console.log(`--- parsed_prestage=${j(narr.parsed_prestage, 800)}`);
  }

  // 2) 轮次留痕
  const { data: rounds, error: e2 } = await client
    .from('narrative_analysis_rounds')
    .select('*')
    .eq('token_address', ADDR.toLowerCase())
    .order('id', { ascending: true })
    .limit(30);
  if (e2) throw e2;
  console.log(`\n=== narrative_analysis_rounds: ${rounds?.length ?? 0} 行 ===`);
  for (const r of rounds || []) {
    console.log(`  r${r.round_no} exp=${r.experiment_id} ${r.trigger_reason} start=${r.started_at} done=${r.completed_at} rating=${r.rating} from_cache=${r.from_cache} error=${r.error ? String(r.error).slice(0, 300) : '-'}`);
  }

  // 3) 信号行（有没有 fire、narrativeCall 轨迹）
  const { data: sigs, error: e3 } = await client
    .from('strategy_signals')
    .select('*')
    .eq('token_address', ADDR.toLowerCase())
    .order('id', { ascending: true })
    .limit(20);
  if (e3) throw e3;
  console.log(`\n=== strategy_signals: ${sigs?.length ?? 0} 行 ===`);
  for (const s of sigs || []) {
    const md = s.metadata || {};
    console.log(`sig#${s.id} exp=${s.experiment_id} action=${s.action} type=${s.signal_type} status=${s.current_status} at=${s.created_at}`);
    if (md.narrativeCall) console.log(`  narrativeCall=${j(md.narrativeCall, 800)}`);
    if (md.preBuyCheckFactors) {
      const f = md.preBuyCheckFactors;
      console.log(`  preBuy: rating=${f.narrativeRating} lag=${f.narrativeCorpusLagSec} sameName=${f.strictSameNameTokenCount} snipers=${f.earlyTradesSniperWallets}`);
    }
    if (md.gmgnCheck) console.log(`  gmgnCheck=${j(md.gmgnCheck, 400)}`);
    if (md.narrativeTrigger) console.log(`  narrativeTrigger=${j(md.narrativeTrigger, 400)}`);
  }

  // 4) token_create 事件（创建时间/平台/名字）
  const { data: evs, error: e4 } = await client
    .from('wss_events')
    .select('*')
    .eq('token_address', ADDR.toLowerCase())
    .order('id', { ascending: true })
    .limit(5);
  if (e4) throw e4;
  console.log(`\n=== wss_events: ${evs?.length ?? 0} 行 ===`);
  for (const e of evs || []) {
    const p = e.payload || {};
    console.log(`  ${e.kind} at=${e.created_at} keys=${Object.keys(e).filter(k => /block|log/i.test(k)).map(k => k + '=' + e[k]).join(' ')} name=${p.name ?? p.tokenName ?? '-'} symbol=${p.symbol ?? p.tokenSymbol ?? '-'} url=${p.url ?? p.tokenUrl ?? '-'}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
// 附：stage1_prompt 语料段（临时追加段）
