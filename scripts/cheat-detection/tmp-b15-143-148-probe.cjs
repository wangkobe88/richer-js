// 一次性（182 跑，小结果读取）：①idx143 我靠 首价异常取证（首 8 笔）②idx148 TRENCHER famous 0x40e5 钱包锚窗行。
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager.js');

async function main() {
  const sb = await dbManager.getClient();
  // ① idx143 首价
  const { data: d1, error: e1 } = await sb.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,price_bnb,price_outlier')
    .eq('token_address', '0xcbfe6b2bceacfab7934c82513f568f4e31a04444')
    .order('block_number', { ascending: true }).order('log_index', { ascending: true })
    .limit(8);
  if (e1) throw new Error(e1.message);
  console.log('--- idx143 我靠 首 8 笔 ---');
  for (const r of d1) console.log(r.block_time, r.trade_type, (r.bnb_amount || 0).toFixed(4) + 'B', 'px=' + (r.price_bnb ? r.price_bnb.toExponential(4) : '-'), r.price_outlier ? 'OUTLIER' : '');
  console.log('FM 常量=4.4962e-9 | 首行较常量:', d1[0] && d1[0].price_bnb ? ((d1[0].price_bnb / 4.496173469e-9 - 1) * 100).toFixed(1) + '%' : '-');

  // ② idx148 famous 钱包 0x40e5 锚窗行（锚 08:32:50Z）
  const W = '0x40e569e9b5458c89b4910f3ecfade0f650e92a40';
  const { data: d2, error: e2 } = await sb.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,price_bnb,sender_address,trader_address')
    .eq('token_address', '0xc6abc6b66438e07fd1600c023ebfad0a09184444')
    .lte('block_time', '2026-11-05T08:32:50.000Z')
    .or(`sender_address.eq.${W},trader_address.eq.${W}`)
    .order('block_number', { ascending: true }).order('log_index', { ascending: true })
    .limit(50);
  if (e2) throw new Error(e2.message);
  console.log('--- idx148 TRENCHER 0x40e5 行（≤锚）:', d2.length, '笔 ---');
  let buy = 0, sell = 0;
  for (const r of d2) {
    if (r.trade_type === 'buy') buy += r.bnb_amount || 0; else sell += r.bnb_amount || 0;
    console.log(r.block_time, r.trade_type, (r.bnb_amount || 0).toFixed(4) + 'B', 'sender=' + (r.sender_address || '-').slice(-4), 'trader=' + (r.trader_address || '-').slice(-4));
  }
  console.log('合计: 买', buy.toFixed(4), 'B / 卖', sell.toFixed(4), 'B / 净', (buy - sell).toFixed(4), 'B');
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
