// 一次性（182 跑）：赵公主 0x5793b7ea…7777 量纲对齐——DB ticks 原始行（price 域判定）
// + trades 成交价 + buy_2_3 信号 metadata 的 launch 锚留痕 + token_quote_set 定价参数。
const { dbManager } = require('../src/services/dbManager.js');

const TOKEN = '0x5793b7ead75851206529f98cfe89db54511a7777';
const EXP = 'b7941b0c-b758-4bff-8dce-8818249caae7'; // bt-v89

async function main() {
  const client = await dbManager.getClient();

  // ① ticks 全量（生产拉数同款形状：token eq + 链上真序）
  const { data: ticks, error: e1 } = await client.from('wss_price_ticks')
    .select('block_time,block_number,log_index,price_bnb,bnb_amount,quote_token,trade_type,price_outlier')
    .eq('token_address', TOKEN)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(400);
  if (e1) throw e1;
  console.log('ticks 总数(≤400):', ticks.length);
  console.log('— 前 8 行:');
  for (const t of ticks.slice(0, 8)) {
    console.log(`  ${t.block_time} type=${t.trade_type} price=${t.price_bnb} bnb=${t.bnb_amount} qt=${t.quote_token || '-'} outlier=${t.price_outlier}`);
  }
  const w = ticks.filter((t) => t.block_time >= '2026-11-05T11:17:11' && t.block_time <= '2026-11-05T11:17:14');
  console.log('— 11:17:12±1s 行:');
  for (const t of w) {
    console.log(`  ${t.block_time} type=${t.trade_type} price=${t.price_bnb} bnb=${t.bnb_amount} qt=${t.quote_token || '-'}`);
  }
  const last = ticks[ticks.length - 1];
  console.log('— 末行:', last.block_time, 'price=', last.price_bnb);

  // ② trades（bt-v89 本票）
  const { data: trades, error: e2 } = await client.from('trades')
    .select('*').eq('experiment_id', EXP).eq('token_address', TOKEN);
  if (e2) throw e2;
  console.log('\ntrades:', trades.length);
  for (const t of trades) {
    const keys = Object.keys(t).filter((k) => /price|amount|bnb|token_out|executed|side|type/i.test(k));
    const o = {}; for (const k of keys) o[k] = t[k];
    console.log(' ', JSON.stringify(o));
  }

  // ③ signals buy_2_3 metadata 里 launch/price 锚留痕
  const { data: sigs, error: e3 } = await client.from('strategy_signals')
    .select('created_at,action,metadata').eq('experiment_id', EXP).eq('token_address', TOKEN);
  if (e3) throw e3;
  console.log('\nsignals:', sigs.length);
  for (const s of sigs) {
    const raw = JSON.stringify(s.metadata || {});
    const hits = raw.match(/[^,{}]*(?:[Ll]aunch|[Cc]urVs|priceBnb|price_bnb|currentVs)[^,}]*/g) || [];
    console.log(`  ${s.created_at} ${s.action}:`);
    for (const h of hits.slice(0, 14)) console.log('    ', h.trim());
  }

  // ④ quote 盘定价参数（token_quote_set payload）
  const { data: qs, error: e4 } = await client.from('wss_events')
    .select('block_time,payload').eq('kind', 'token_quote_set').eq('token_address', TOKEN);
  if (e4) throw e4;
  console.log('\ntoken_quote_set:', qs.length);
  for (const q of qs) console.log(' ', q.block_time, JSON.stringify(q.payload).slice(0, 400));

  // ⑤ token_create payload（gradAmt/定价线索）
  const { data: tc, error: e5 } = await client.from('wss_events')
    .select('block_time,payload').eq('kind', 'token_create').eq('token_address', TOKEN);
  if (e5) throw e5;
  if (tc[0]) console.log('\ntoken_create payload:', JSON.stringify(tc[0].payload).slice(0, 600));

  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
