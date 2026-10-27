// 一次性查询：0x08be…7777 叙事档案 + 创建事件 + 信号/交易落点（单条小结果）
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0x08be87804707fe0ebc86ef56d4bddb202c627777';

async function main() {
  const client = await dbManager.getClient();

  const { data: narr, error: e1 } = await client
    .from('token_narrative')
    .select('*')
    .eq('token_address', ADDR.toLowerCase())
    .maybeSingle();
  if (e1) throw e1;
  if (!narr) {
    console.log('token_narrative 无行');
  } else {
    fs.writeFileSync('/tmp/08be-narrative.json', JSON.stringify(narr, null, 1));
    console.log(`token_narrative id=${narr.id} analyzed_at=${narr.analyzed_at}`);
    console.log('列名:', Object.keys(narr).join(', '));
  }

  const { data: evs, error: e2 } = await client
    .from('wss_events')
    .select('id,kind,block_number,log_index,created_at,payload')
    .eq('token_address', ADDR.toLowerCase())
    .order('id', { ascending: true })
    .limit(10);
  if (e2) throw e2;
  console.log(`\n=== wss_events: ${evs?.length ?? 0} 行 ===`);
  for (const ev of evs || []) {
    const p = ev.payload || {};
    console.log(`#${ev.id} ${ev.kind} blk=${ev.block_number} at=${ev.created_at}`);
    console.log(`  payload: ${JSON.stringify(p).slice(0, 900)}`);
  }

  const { data: sigs, error: e3 } = await client
    .from('strategy_signals')
    .select('*')
    .eq('token_address', ADDR.toLowerCase())
    .order('id', { ascending: true })
    .limit(10);
  if (e3) throw e3;
  console.log(`\n=== signals: ${sigs?.length ?? 0} 行 ===`);
  for (const s of sigs || []) {
    console.log(`sig#${s.id} exp=${s.experiment_id} action=${s.action} type=${s.signal_type} status=${s.current_status ?? s.state ?? '?'} exec=${s.executed_at} at=${s.created_at}`);
    const md = s.metadata || {};
    const nc = md.narrativeCall;
    if (nc) console.log(`  narrativeCall rating=${nc.rating ?? nc.numericRating} category=${nc.narrativeCategory ?? nc.tokenCategory ?? '-'} reason=${String(nc.reason ?? '').slice(0, 160)}`);
  }

  const { data: trades, error: e4 } = await client
    .from('trades')
    .select('*')
    .eq('token_address', ADDR.toLowerCase())
    .order('created_at', { ascending: true })
    .limit(20);
  if (e4) throw e4;
  console.log(`\n=== trades: ${trades?.length ?? 0} 行 ===`);
  for (const t of trades || []) {
    const keys = ['trade_type', 'side', 'action', 'amount_bnb', 'bnb_amount', 'price_bnb', 'profit_percent', 'execution_reason', 'created_at'];
    const parts = keys.filter(k => t[k] !== undefined).map(k => `${k}=${t[k]}`);
    console.log(`  trade ${parts.join(' ')}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
