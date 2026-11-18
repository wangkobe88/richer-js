// 05d2 票：入场(+0)到 P7(+171s)之间全部卖出笔明细 + ratio 逐笔轨迹
// 回答「时间门早满足了，为何腿不再 fire」——量门 90 在 +30s 后的完整轨迹
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0x05d26fcacc92500d1de680ee3b428cd2dbe17777';
const BUY_MS = Date.parse('2026-11-02T08:41:07+00:00');

(async () => {
  const c = await dbManager.getClient();
  const { data: rows } = await c.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb')
    .eq('token_address', ADDR)
    .gte('block_time', '2026-11-02T08:41:00+00:00')
    .lte('block_time', '2026-11-02T08:44:00+00:00')
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(2000);

  let buy = 0, sell = 0, nSell = 0;
  console.log('持仓期(+0 → +171s)逐笔（S=卖出,B=买入）hold 秒 | 金额 | 累计Σ买/Σ卖 | ratio%:');
  for (const r of rows || []) {
    const t = Date.parse(r.block_time);
    if (t < BUY_MS) continue;
    const hold = ((t - BUY_MS) / 1000).toFixed(0).padStart(3);
    const amt = r.bnb_amount || 0;
    if (r.trade_type === 'buy') buy += amt; else { sell += amt; nSell++; }
    const ratio = (buy + sell) > 0 ? ((buy - sell) / (buy + sell) * 100).toFixed(1).padStart(5) : ' null';
    const tag = r.trade_type === 'sell' ? 'S' : 'B';
    console.log(`  +${hold}s ${tag} ${amt.toFixed(4).padStart(8)}  Σb=${buy.toFixed(2)} Σs=${sell.toFixed(2)}  ratio=${ratio}`);
  }
  console.log(`\n汇总：Σ买=${buy.toFixed(3)} Σ卖=${sell.toFixed(3)} 卖出笔数=${nSell} 终态 ratio=${((buy - sell) / (buy + sell) * 100).toFixed(1)}%`);
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
