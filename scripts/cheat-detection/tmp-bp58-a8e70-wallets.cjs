// 一次性探针（182 跑）：a8e70 锚窗（≤04:46:52）钱包材料直读——②(a) 大户参与判序证据定论。
const { dbManager } = require('../../src/services/dbManager.js');

const TOKEN = '0xa8e70ca07b68a07683c963513a26f2fa91647777';
const ANCHOR = '2026-11-05T04:46:52.000+00:00';

async function main() {
  const client = await dbManager.getClient();
  const { data: rows, error } = await client.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,output_amount,sender_address,trader_address')
    .eq('token_address', TOKEN).lte('block_time', ANCHOR)
    .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(1000);
  if (error) throw new Error(error.message);
  console.log(`行数=${(rows || []).length}`);
  const t0 = Date.parse(rows[0].block_time);
  const wallets = new Map();
  let buyTotal = 0, sellTotal = 0;
  for (const r of rows || []) {
    const w = (r.sender_address || r.trader_address || '').toLowerCase();
    const bnb = Number(r.bnb_amount || 0);
    const m = wallets.get(w) || { buy: 0, sell: 0, buys: 0, sells: 0, first: (Date.parse(r.block_time) - t0) / 1000, maxSingle: 0 };
    if (r.trade_type === 'buy') { m.buy += bnb; m.buys++; m.maxSingle = Math.max(m.maxSingle, bnb); buyTotal += bnb; }
    else { m.sell += bnb; m.sells++; sellTotal += bnb; }
    m.last = (Date.parse(r.block_time) - t0) / 1000;
    wallets.set(w, m);
  }
  const top = [...wallets.entries()].map(([w, m]) => ({ w: w.slice(0, 10), ...m, net: m.buy - m.sell })).sort((a, b) => b.buy - a.buy);
  console.log(`钱包数=${top.length} 总买=${buyTotal.toFixed(3)} 总卖=${sellTotal.toFixed(3)}\n前列（按买入额）：`);
  for (const t of top.slice(0, 12)) {
    console.log(`${t.w} buy=${t.buy.toFixed(3)}(${t.buys}笔,max=${t.maxSingle.toFixed(3)}) sell=${t.sell.toFixed(3)}(${t.sells}) net=${t.net.toFixed(3)} 首见=${t.first.toFixed(1)}s 末见=${t.last.toFixed(1)}s`);
  }
  const big02 = top.filter((t) => t.buy >= 0.19);
  const big03 = (rows || []).filter((r) => r.trade_type === 'buy' && Number(r.bnb_amount || 0) >= 0.3).length;
  console.log(`\n②(a) 大户参与双臂：买入≥0.19 的钱包数=${big02.length}（判序线=≥2 个）｜0.3+ 单笔数=${big03}（线=≥1）`);
  const anchorMs = Date.parse(ANCHOR);
  const near60 = (rows || []).filter((r) => anchorMs - Date.parse(r.block_time) <= 60000);
  const sellers60 = near60.filter((r) => r.trade_type === 'sell');
  const bigSell60 = sellers60.filter((r) => Number(r.bnb_amount || 0) >= 0.19);
  console.log(`近 60s 行=${near60.length} 卖=${sellers60.length} 大户卖(≥0.19)=${bigSell60.length}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
