// 一次性查询：0x0195…7777 叙事档案（单条小结果，落本地 JSON 后离线看）
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0x0195119e4806441c871adada6256296265ed7777';
const OUT = '/tmp/narr-0195.json';

async function main() {
  const client = await dbManager.getClient();

  const { data: narr, error: e1 } = await client
    .from('token_narrative')
    .select('id,token_address,token_symbol,analyzed_at,is_valid,prompt_version,pre_check_result,prestage_result,stage1_result,stage2_result,stage3_result,stage_final_result,raw_api_data,classified_urls,twitter_info,extracted_info')
    .eq('token_address', ADDR)
    .maybeSingle();
  if (e1) throw e1;
  if (!narr) { console.log('token_narrative 无行'); }
  else {
    fs.writeFileSync(OUT, JSON.stringify(narr, null, 2));
    console.log(`token_narrative #${narr.id} symbol=${narr.token_symbol} analyzed_at=${narr.analyzed_at} prompt_version=${narr.prompt_version} is_valid=${narr.is_valid} → ${OUT}`);
  }

  // 轮次留痕（C84）
  const { data: rounds, error: e2 } = await client
    .from('narrative_analysis_rounds')
    .select('*')
    .eq('token_address', ADDR)
    .order('id', { ascending: true })
    .limit(20);
  if (e2) throw e2;
  console.log(`\nnarrative_analysis_rounds: ${rounds?.length ?? 0} 行`);
  for (const r of rounds || []) {
    console.log(`  round#${r.id} exp=${r.experiment_id} reason=${r.reason} rating=${r.rating} category=${r.token_category} started=${r.started_at} done=${r.completed_at}`);
  }

  // 信号 + 交易
  const { data: sigs, error: e3 } = await client
    .from('strategy_signals')
    .select('*')
    .eq('token_address', ADDR)
    .order('id', { ascending: true })
    .limit(10);
  if (e3) throw e3;
  console.log(`\nsignals: ${sigs?.length ?? 0} 行`);
  for (const s of sigs || []) {
    const md = s.metadata || {};
    console.log(`sig#${s.id} exp=${s.experiment_id} type=${s.signal_type} status=${s.current_status ?? s.state ?? '?'} at=${s.created_at}`);
    if (md.narrativeCall) console.log(`  narrativeCall.rating=${md.narrativeCall.rating ?? md.narrativeCall.numericRating}`);
  }
  const { data: trades, error: e4 } = await client
    .from('trades')
    .select('*')
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(20);
  if (e4) throw e4;
  console.log(`\ntrades: ${trades?.length ?? 0} 行`);
  for (const t of trades || []) {
    const keys = ['trade_type', 'side', 'action', 'amount_bnb', 'bnb_amount', 'price_bnb', 'profit_percent', 'execution_reason', 'created_at'];
    console.log(`  ${keys.filter(k => t[k] !== undefined).map(k => `${k}=${t[k]}`).join(' ')}`);
  }

  // token 基本信息从 wss_events 拿创建时间
  const { data: ev, error: e5 } = await client
    .from('wss_events')
    .select('kind,block_time,payload')
    .eq('token_address', ADDR)
    .order('id', { ascending: true })
    .limit(5);
  if (e5) throw e5;
  for (const e of ev || []) {
    const p = e.payload || {};
    console.log(`event kind=${e.kind} block_time=${e.block_time} symbol=${p.symbol ?? p.tokenSymbol ?? '-'} name=${p.name ?? p.tokenName ?? '-'}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
