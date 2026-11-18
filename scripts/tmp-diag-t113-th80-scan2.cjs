// T113 阈值评估第二层：①量门「曾满足」面（不走确认窗）②无确认窗假想（首真即卖）盈亏
const { dbManager } = require('../src/services/dbManager.js');
const EXP = '6e75ed6d-807a-4164-9551-d3b95d1fc37b';

function firstTrue(recs, buyMs, th) {
  let buy = 0, sell = 0;
  for (const r of recs) {
    const holdMs = r.t - buyMs;
    if (r.type === 'buy') buy += r.amt; else sell += r.amt;
    if (holdMs >= 30000 && (buy + sell) > 0 && (buy - sell) / (buy + sell) * 100 >= th) {
      return { t: r.t, price: r.price, hold: Math.round(holdMs / 1000) };
    }
  }
  return null;
}

(async () => {
  const c = await dbManager.getClient();
  const { data: trades } = await c.from('trades')
    .select('token_address,trade_direction,trade_status,input_amount,output_amount,created_at')
    .eq('experiment_id', EXP).order('created_at', { ascending: true }).limit(1000);
  const byTok = {};
  for (const t of trades || []) {
    if (t.trade_status !== 'success') continue;
    (byTok[t.token_address] = byTok[t.token_address] || []).push(t);
  }
  const toks = Object.keys(byTok).filter(a => byTok[a].some(t => t.trade_direction === 'buy'));

  let ever80 = 0, ever90 = 0, ever80only = 0;
  let sumNoDeb80 = 0, sumNoDeb90 = 0;
  const rows = [];
  for (const addr of toks) {
    const tl = byTok[addr];
    const firstBuy = tl.find(t => t.trade_direction === 'buy');
    const firstSell = tl.find(t => t.trade_direction === 'sell') || null;
    const lastSell = tl.filter(t => t.trade_direction === 'sell').pop() || null;
    const buyBnb = tl.filter(t => t.trade_direction === 'buy').reduce((s, t) => s + (t.input_amount || 0), 0);
    const sellBnb = tl.filter(t => t.trade_direction === 'sell').reduce((s, t) => s + (t.output_amount || 0), 0);
    const actualPnl = sellBnb - buyBnb;
    const buyMs = Date.parse(firstBuy.created_at);
    const firstSellMs = firstSell ? Date.parse(firstSell.created_at) : Infinity;

    const winEnd = new Date(Math.min(lastSell ? Date.parse(lastSell.created_at) + 5000 : buyMs + 7200000, buyMs + 7200000)).toISOString();
    const { data: ticks } = await c.from('wss_price_ticks')
      .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb')
      .eq('token_address', addr)
      .gte('block_time', new Date(buyMs - 60000).toISOString())
      .lte('block_time', winEnd)
      .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(3000);
    const recs = (ticks || []).map(r => ({ t: Date.parse(r.block_time), type: r.trade_type, amt: r.bnb_amount || 0, price: r.price_bnb }));
    if (!recs.length) continue;

    let p0 = recs.find(r => r.t >= buyMs && r.t <= buyMs + 5000)?.price;
    if (p0 == null) { const prior = [...recs].reverse().find(r => r.t < buyMs); p0 = prior?.price; }
    if (!p0) continue;

    const f80 = firstTrue(recs, buyMs, 80), f90 = firstTrue(recs, buyMs, 90);
    const valid = f => f && f.t < firstSellMs;
    const v80 = valid(f80), v90 = valid(f90);
    if (v80) ever80++;
    if (v90) ever90++;
    if (v80 && !v90) ever80only++;

    // 无确认窗假想（首真即全清，忽略滑点）
    if (v80) {
      const hyp = buyBnb * (f80.price / p0) - buyBnb;
      sumNoDeb80 += hyp - actualPnl;
      rows.push({ addr: addr.slice(0, 10), only: v90 ? '' : '←80新增', hold: f80.hold,
        pp80: (buyBnb * (f80.price / p0) / buyBnb * 100 - 100).toFixed(1), act: (actualPnl / buyBnb * 100).toFixed(1),
        d: hyp - actualPnl });
    }
    if (v90) sumNoDeb90 += (buyBnb * (f90.price / p0) - buyBnb) - actualPnl;
  }
  console.log(`票数=${toks.length}`);
  console.log(`量门曾满足（hold≥30 且早于实际首卖）：≥90=${ever90} 票；≥80=${ever80} 票（其中 80 新增=${ever80only}）`);
  console.log(`\n无确认窗假想（首真即全清）：`);
  console.log('  token      hold  pp80%  act%   Δ(假想−实际)BNB');
  for (const r of rows) console.log(`  ${r.addr}  ${String(r.hold).padStart(4)}s ${r.pp80.padStart(6)} ${r.act.padStart(6)}  ${r.d >= 0 ? '+' : ''}${r.d.toFixed(4)} ${r.only}`);
  console.log(`\nΣΔ(80,无确认窗)=${sumNoDeb80.toFixed(4)} BNB；ΣΔ(90,无确认窗)=${sumNoDeb90.toFixed(4)} BNB`);
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
