// 一次性查询：0xed38…7777 现有叙事缓存行 + 信号/交易落点（单条小结果）
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0xed389dfed0568f07b71ff678b92da1c052957777';

async function main() {
  const client = await dbManager.getClient();

  const { data: narr, error: e1 } = await client
    .from('token_narrative')
    .select('*')
    .eq('token_address', ADDR)
    .maybeSingle();
  if (e1) throw e1;
  if (!narr) {
    console.log('token_narrative 无行（首析）');
  } else {
    console.log('=== 现有 token_narrative 行 ===');
    const keys = ['numeric_rating', 'rating', 'analysis_stage', 'pre_check_result', 'rule_name', 'is_valid', 'created_at', 'updated_at', 'prompt_type', 'prompt_version'];
    for (const k of keys) if (narr[k] !== undefined) console.log(`${k}: ${JSON.stringify(narr[k])}`);
    console.log(`reason: ${String(narr.reason ?? '').slice(0, 400)}`);
    const rad = narr.raw_api_data || {};
    console.log(`token_category: ${JSON.stringify((narr.parsed_output || {}).token_category ?? rad.token_category)}`);
    console.log(`raw_api_data keys: ${Object.keys(rad).join(', ')}`);
    const tp = narr.token_profile || narr.tokenProfile;
    if (tp) console.log(`token_profile.symbol: ${tp.symbol ?? '-'}`);
    // 找 symbol
    const sym = narr.symbol ?? rad.symbol ?? (narr.parsed_output || {}).symbol;
    if (sym) console.log(`symbol: ${sym}`);
  }

  const { data: sigs, error: e4 } = await client
    .from('strategy_signals')
    .select('*')
    .eq('token_address', ADDR)
    .order('id', { ascending: true })
    .limit(10);
  if (e4) throw e4;
  console.log(`\n=== signals: ${sigs?.length ?? 0} 行 ===`);
  for (const s of sigs || []) {
    const md = s.metadata || {};
    const nc = md.narrativeCall;
    console.log(`sig#${s.id} exp=${s.experiment_id} action=${s.action} type=${s.signal_type} exec=${s.executed_at} at=${s.created_at}`);
    if (nc) {
      console.log(`  narrativeCall rating=${nc.rating ?? nc.numericRating} category=${nc.narrativeCategory ?? nc.tokenCategory ?? '-'}`);
      console.log(`  narrativeCall.reason=${String(nc.reason ?? '').slice(0, 200)}`);
    }
  }

  const { data: trades, error: e5 } = await client
    .from('trades')
    .select('*')
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(20);
  if (e5) throw e5;
  console.log(`=== trades: ${trades?.length ?? 0} 行 ===`);
  for (const t of trades || []) {
    const keys = ['trade_type', 'side', 'action', 'amount_bnb', 'bnb_amount', 'price_bnb', 'profit_percent', 'execution_reason', 'created_at'];
    const parts = keys.filter(k => t[k] !== undefined).map(k => `${k}=${t[k]}`);
    console.log(`  trade ${parts.join(' ')}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
