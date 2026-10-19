// 一次性查询：0xe935…7777 为啥没过叙事分析（单票小结果读取）
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0xe9356facf0558ab0d7025e2898f51d111d517777';

async function main() {
  const client = await dbManager.getClient();

  // 1. token_narrative 标量列
  const { data: tn, error: e1 } = await client
    .from('token_narrative')
    .select('id,analyzed_at,is_valid,token_category,pre_check_result,token_symbol,analysis_stage,prompt_type')
    .eq('token_address', ADDR)
    .maybeSingle();
  if (e1) throw e1;
  if (!tn) {
    console.log('token_narrative 无行——从未分析过或分析未落库');
  } else {
    console.log('=== token_narrative ===');
    console.log(JSON.stringify({
      id: tn.id, token_symbol: tn.token_symbol, analyzed_at: tn.analyzed_at, is_valid: tn.is_valid,
      token_category: tn.token_category,
      pre_check_result: tn.pre_check_result,
      analysis_stage: tn.analysis_stage,
      prompt_type: tn.prompt_type,
    }, null, 2));
  }

  // stage1 审计（jev 判读 + 各题答案摘要）单独拉
  const { data: tnStage, error: eS } = await client
    .from('token_narrative')
    .select('stage1_result,stage1_prompt,prestage_result,classified_urls,url_extraction_result,data_fetch_results')
    .eq('token_address', ADDR)
    .maybeSingle();
  if (eS) throw eS;
  if (tnStage) {
    const s1 = tnStage.stage1_prompt;
    if (s1) {
      const st = typeof s1 === 'string' ? s1 : (s1.state ?? JSON.stringify(s1));
      console.log('\n=== stage1_prompt.state 头 3000 字 ===');
      console.log(String(st).slice(0, 3000));
    }
    const s1r = tnStage.stage1_result;
    if (s1r) {
      console.log('\n=== stage1_result ===');
      console.log(JSON.stringify(s1r, null, 2).slice(0, 4000));
    }
    const ps = tnStage.prestage_result;
    if (ps) {
      console.log('\n=== prestage_result ===');
      console.log(JSON.stringify(ps, null, 2).slice(0, 3000));
    }
    console.log('\n=== classified_urls ===');
    console.log(JSON.stringify(tnStage.classified_urls, null, 2)?.slice(0, 2000));
    console.log('\n=== data_fetch_results ===');
    console.log(JSON.stringify(tnStage.data_fetch_results, null, 2)?.slice(0, 3000));
  }

  // 2. 轮次表（C84 触发模型的轮次留痕）
  const { data: rounds, error: e2 } = await client
    .from('narrative_analysis_rounds')
    .select('*')
    .eq('token_address', ADDR)
    .order('id', { ascending: true })
    .limit(20);
  if (e2) throw e2;
  console.log(`\n=== narrative_analysis_rounds: ${rounds?.length ?? 0} 行 ===`);
  for (const r of rounds || []) {
    console.log(JSON.stringify({
      id: r.id, experiment_id: r.experiment_id, round: r.round, reason: r.reason,
      rating: r.rating, category: r.category, status: r.status,
      started_at: r.started_at, completed_at: r.completed_at,
      error: r.error ? String(r.error).slice(0, 300) : undefined,
    }));
  }

  // 3. 信号行（narrativeCall 轨迹 / 拒因）
  const { data: sigs, error: e3 } = await client
    .from('strategy_signals')
    .select('*')
    .eq('token_address', ADDR)
    .order('id', { ascending: true })
    .limit(10);
  if (e3) throw e3;
  console.log(`\n=== strategy_signals: ${sigs?.length ?? 0} 行 ===`);
  for (const s of sigs || []) {
    const md = s.metadata || {};
    console.log(`sig#${s.id} exp=${s.experiment_id} action=${s.action} type=${s.signal_type} status=${s.current_status ?? s.state} at=${s.created_at}`);
    const nc = md.narrativeCall;
    if (nc) {
      console.log(`  narrativeCall rating=${nc.rating ?? nc.numericRating} category=${nc.narrativeCategory ?? nc.tokenCategory ?? '-'}`);
      console.log(`  narrativeCall.reason=${String(nc.reason ?? '').slice(0, 300)}`);
    }
    const nf = md.narrativeFireInfo || md.narrativeTrigger;
    if (nf) console.log(`  narrativeFireInfo=${JSON.stringify(nf).slice(0, 300)}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
