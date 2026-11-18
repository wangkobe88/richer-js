// bea7 票持仓期逐笔：验证「pump 失衡→确认窗成交→随后崩盘」形状
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0xbea734d93b9d47066e8eb20a4f3e17183e457777';
const EXP = '6e75ed6d-807a-4164-9551-d3b95d1fc37b';
const BUY_MS = Date.parse('2026-11-02T00:00:00Z'); // 先占位，实际用 trades

(async () => {
  const c = await dbManager.getClient();
  const { data: tr } = await c.from('trades')
    .select('trade_direction,trade_status,input_amount,output_amount,created_at')
    .eq('experiment_id', EXP).eq('token_address', ADDR).order('created_at', { ascending: true });
  for (const t of tr || []) console.log(`trade ${t.created_at} ${t.trade_direction} in=${t.input_amount} out=${t.output_amount}`);
  const buyMs = Date.parse(tr.find(t => t.trade_direction === 'buy').created_at);

  const { data: rows } = await c.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb')
    .eq('token_address', ADDR)
    .gte('block_time', new Date(buyMs - 60000).toISOString())
    .lte('block_time', new Date(buyMs + 300000).toISOString())
    .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(2000);
  let buy = 0, sell = 0, i = 0;
  console.log('\ntick 重放（每5笔抽1 + 前60笔全打）：');
  for (const r of rows || []) {
    const t = Date.parse(r.block_time);
    if (t < buyMs) continue;
    i++;
    const amt = r.bnb_amount || 0;
    if (r.trade_type === 'buy') buy += amt; else sell += amt;
    const hold = Math.round((t - buyMs) / 1000);
    if (i <= 60 || i % 5 === 0) {
      const ratio = (buy + sell) > 0 ? ((buy - sell) / (buy + sell) * 100).toFixed(1) : 'null';
      console.log(`  +${String(hold).padStart(3)}s ${r.trade_type === 'buy' ? 'B' : 'S'} ${amt.toFixed(4).padStart(8)}  Σb=${buy.toFixed(2)} Σs=${sell.toFixed(2)}  ratio=${ratio}`);
    }
  }
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
