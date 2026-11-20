require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const EXP = '5b2c1747-959f-42de-a622-f57deb9fb407';

async function main() {
  const sb = dbManager.getClient();
  const { data: tr, error } = await sb.from('trades')
    .select('token_symbol,token_address,trade_direction,input_amount,output_amount,unit_price,executed_at,created_at,signal_id,metadata')
    .eq('experiment_id', EXP)
    .order('created_at', { ascending: true }).limit(1000);
  if (error) throw new Error(error.message);
  const buys = tr.filter(t => t.trade_direction === 'buy');
  const sells = tr.filter(t => t.trade_direction === 'sell');
  console.log(`成交 买 ${buys.length} 卖 ${sells.length}`);
  // 票级配对（买→卖 BNB 差）
  const byTok = new Map();
  for (const t of tr) {
    const k = t.token_address;
    const e = byTok.get(k) || { sym: t.token_symbol, buyBnb: 0, sellBnb: 0, firstBuy: t.created_at, sells: [] };
    if (t.trade_direction === 'buy') e.buyBnb += Number(t.input_amount || 0);
    else { e.sellBnb += Number(t.output_amount || 0); e.sells.push(t); }
    byTok.set(k, e);
  }
  const rows = [...byTok.entries()].map(([addr, e]) => {
    const pnl = e.sellBnb - e.buyBnb;
    return { addr, sym: e.sym, buy: e.buyBnb, sell: e.sellBnb, pnl, pnlPct: e.buyBnb > 0 ? (pnl / e.buyBnb * 100) : 0, firstBuy: e.firstBuy, soldOut: e.sells.length > 0 };
  }).sort((a, b) => a.pnl - b.pnl);
  const sum = rows.reduce((s, r) => s + r.pnl, 0);
  const wins = rows.filter(r => r.pnl > 0), losses = rows.filter(r => r.pnl <= 0);
  console.log(`票数 ${rows.length} | Σ${sum.toFixed(3)}B | 盈 ${wins.length}(${wins.reduce((s, r) => s + r.pnl, 0).toFixed(3)}) 亏 ${losses.length}(${losses.reduce((s, r) => s + r.pnl, 0).toFixed(3)})`);
  console.log('\n== 全部票按盈亏排序 ==');
  for (const r of rows) console.log(`${r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(4)}B (${r.pnlPct.toFixed(1)}%) ${r.sym?.slice(0, 14)} ${r.addr.slice(0, 12)}… 买${r.buy.toFixed(3)}卖${r.sell.toFixed(3)} ${r.firstBuy?.slice(5, 16)}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
