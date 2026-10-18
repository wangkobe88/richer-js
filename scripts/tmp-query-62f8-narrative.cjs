// 一次性查询：0x62f8…7777 信号/交易落点 + prestage state 推文内容（单条小结果）
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0x62f829bae9f387ae399ccd0c45a1360e61857777';

async function main() {
  const client = await dbManager.getClient();

  // 信号 + 交易
  const { data: sigs, error: e4 } = await client
    .from('strategy_signals')
    .select('*')
    .eq('token_address', ADDR)
    .order('id', { ascending: true })
    .limit(10);
  if (e4) throw e4;
  console.log(`=== signals: ${sigs?.length ?? 0} 行 ===`);
  for (const s of sigs || []) {
    const md = s.metadata || {};
    const nc = md.narrativeCall;
    console.log(`sig#${s.id} exp=${s.experiment_id} action=${s.action} type=${s.signal_type} status=${s.current_status ?? s.state ?? '?'} exec=${s.executed_at} at=${s.created_at}`);
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

  // prestage state 开头（账号+推文）
  const { data: narr, error: e1 } = await client
    .from('token_narrative')
    .select('prestage_prompt')
    .eq('token_address', ADDR)
    .maybeSingle();
  if (e1) throw e1;
  const pp = narr?.prestage_prompt;
  if (pp) {
    const st = typeof pp === 'string' ? pp : (pp.state ?? JSON.stringify(pp));
    const s = String(st);
    const i = s.indexOf('[ACCOUNT');
    console.log(`\n=== prestage state 账号/推文段（长度 ${s.length}）===`);
    console.log(s.slice(Math.max(0, i - 100), i + 4000));
    // CA 命中检查
    const lower = s.toLowerCase();
    console.log(`\nstate 含全地址: ${lower.includes(ADDR.toLowerCase())}`);
    console.log(`state 含前8hex(0x62f829): ${lower.includes('0x62f829')}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
