// 核实两票手动卖出落账 + 队列状态
const { dbManager } = require('../src/services/dbManager.js');
const EXP = 'f0898589-58f1-4101-a648-0dc9cad41f3a';
const TOKS = ['0x1f54d5e1b8be12b049d5e5328b484701640a7777', '0xd245fb1634f5dac63c864b43683cf25d2daf7777'];

async function main() {
  const c = await dbManager.getClient();
  for (const addr of TOKS) {
    const { data: trades } = await c.from('trades')
      .select('token_symbol,trade_direction,trade_status,input_currency,output_currency,input_amount,output_amount,sold_cards,metadata,created_at')
      .eq('experiment_id', EXP).eq('token_address', addr)
      .order('created_at', { ascending: false }).limit(3);
    console.log(`\n=== ${addr} ===`);
    for (const t of trades || []) {
      console.log(`${t.created_at} ${t.trade_direction} ${t.trade_status} in=${t.input_amount}${t.input_currency} out=${t.output_amount}${t.output_currency} sold_cards=${t.sold_cards}`);
    }
  }
  // 队列表探针
  for (const tbl of ['manual_trade_queue', 'manual_trades']) {
    const { data: q, error } = await c.from(tbl).select('*').eq('experiment_id', EXP).order('requested_at', { ascending: false }).limit(5);
    if (!error && q) {
      console.log(`\n=== ${tbl} 最新 ${q.length} 行 ===`);
      for (const r of q) console.log(JSON.stringify({ token: (r.token_address || '').slice(0, 10), status: r.status, dir: r.direction || r.trade_direction, at: r.requested_at || r.created_at }));
      break;
    }
  }
  await dbManager.close?.();
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
