// 一次性（182 跑，只读）：idx189 AURVEN 0x8614…ffff 买入后 ticks 取证——
// 「为什么只有下跌卖出没有买入？这个币是不是有问题」：BUY 信号/成交在场
// （11:21:04 P1·首买 executed），36s 后流动性止损-无成交超时(30s,≥0.02BNB) 全清
// -7.9%。本探针看买入后链上是否直接断流（burst 波尾接死寂形状）。
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager.js');

async function main() {
  const sb = await dbManager.getClient();
  const { data: tk, error: e1 } = await sb.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,price_bnb')
    .eq('token_address', '0x8614876e509c18d7be305a39a4a8d9e69c5effff')
    .gte('block_time', '2026-11-05T11:21:04+00:00')
    .lte('block_time', '2026-11-05T11:25:00+00:00')
    .order('block_number', { ascending: true }).order('log_index', { ascending: true })
    .limit(60);
  if (e1) throw new Error(e1.message);
  console.log('--- idx189 买入后 ticks（11:21:04-11:25:00）:', tk.length, '行 ---');
  let maxB = 0, lastT = '', minPx = Infinity;
  for (let i = 0; i < tk.length; i++) {
    const r = tk[i];
    if (r.trade_type === 'buy') maxB = Math.max(maxB, r.bnb_amount || 0);
    if (r.price_bnb) minPx = Math.min(minPx, r.price_bnb);
    lastT = r.block_time;
    if (i < 25) console.log(r.block_time, r.trade_type, (r.bnb_amount || 0).toFixed(4) + 'B', r.price_bnb ? r.price_bnb.toExponential(3) : '-');
  }
  console.log('合计行数:', tk.length, '| 最大单笔买:', maxB.toFixed(4), 'B | 末行:', lastT, '| 最低价:', minPx === Infinity ? '-' : minPx.toExponential(3), '（买价 4.066e-9）');

  const { data: ed, error: e2 } = await sb.from('experiments').select('status').eq('id', '11fc182a-b051-4665-857c-5c14e6713334').limit(1);
  if (e2) throw new Error(e2.message);
  console.log('bt-v100 status:', ed[0].status);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
