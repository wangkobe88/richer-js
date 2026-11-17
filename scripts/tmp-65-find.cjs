// 0x65ae 地址核对（182 跑）：v129 全票列表 0x65 开头 + 近似地址（手敲陷阱防呆）
const { dbManager } = require('../src/services/dbManager.js');

async function main() {
  const c = await dbManager.getClient();
  const { data: exps } = await c.from('experiments').select('id').limit(500);
  const id = exps.find((e) => e.id.startsWith('4af09d63')).id;
  const { data: t } = await c.from('trades').select('token_address,token_symbol').eq('experiment_id', id).limit(500);
  const uniq = [...new Map((t || []).map((x) => [x.token_address, x.token_symbol])).entries()];
  const hit = uniq.filter(([k]) => k.startsWith('0x65'));
  console.log('v129 成交票 0x65 开头:');
  for (const [k, s] of hit) console.log(' ', s, k);
  const { data: sig } = await c.from('strategy_signals')
    .select('token_address,token_symbol,executed,er:metadata->>execution_reason')
    .eq('experiment_id', id).eq('signal_type', 'BUY')
    .ilike('token_address', '0x65%').limit(20);
  console.log('v129 BUY 信号 0x65 开头:');
  for (const r of sig || []) console.log(`  ${r.token_symbol} exec=${r.executed} ${r.er || ''} ${r.token_address}`);
  // 全库里找含 65aebe91 的地址（防止抄写差异）
  const { data: any } = await c.from('wss_price_ticks')
    .select('token_address').ilike('token_address', '%65aebe91%').limit(3);
  console.log('wss_price_ticks 含 65aebe91:', JSON.stringify(any));
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
