// T113 确认窗减弱档位矩阵：阈值 {90,80} × 窗 {3500/5 现行, 2000/2, 1500/1, 1000/1, 0/0 bypass}
// 输出每档成交票数 + ΣΔ(假想全清−实际) + 明细
const { dbManager } = require('../src/services/dbManager.js');
const EXP = '6e75ed6d-807a-4164-9551-d3b95d1fc37b';
const MAX_WAIT_MS = 120000;

const WINDOWS = [
  { name: '3500/5现行', deb: 3500, ticks: 5 },
  { name: '2000/2', deb: 2000, ticks: 2 },
  { name: '1500/1', deb: 1500, ticks: 1 },
  { name: '1000/1', deb: 1000, ticks: 1 },
  { name: 'bypass', deb: 0, ticks: 0 },
];

function simulate(recs, buyMs, th, deb, minTicks) {
  let buy = 0, sell = 0, pending = null;
  for (const r of recs) {
    const holdMs = r.t - buyMs;
    if (r.type === 'buy') buy += r.amt; else sell += r.amt;
    const ratio = (buy + sell) > 0 ? (buy - sell) / (buy + sell) * 100 : null;
    const cond = holdMs >= 30000 && ratio != null && ratio >= th;
    if (pending) {
      if (!cond) { pending = null; continue; }
      pending.touches++;
      const elapsed = r.t - pending.firstT;
      if ((elapsed >= deb && pending.touches >= minTicks) || elapsed >= MAX_WAIT_MS) {
        return { sold: true, t: r.t, price: r.price, hold: Math.round(holdMs / 1000) };
      }
    } else if (cond) {
      pending = { firstT: r.t, touches: 0 };
      if (minTicks === 0) return { sold: true, t: r.t, price: r.price, hold: Math.round(holdMs / 1000) };
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

  const ctx = [];
  for (const addr of toks) {
    const tl = byTok[addr];
    const firstBuy = tl.find(t => t.trade_direction === 'buy');
    const firstSell = tl.find(t => t.trade_direction === 'sell') || null;
    const lastSell = tl.filter(t => t.trade_direction === 'sell').pop() || null;
    const buyBnb = tl.filter(t => t.trade_direction === 'buy').reduce((s, t) => s + (t.input_amount || 0), 0);
    const sellBnb = tl.filter(t => t.trade_direction === 'sell').reduce((s, t) => s + (t.output_amount || 0), 0);
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
    ctx.push({ addr: addr.slice(0, 10), recs, buyMs, firstSellMs, buyBnb, actualPnl: sellBnb - buyBnb, actPct: (sellBnb - buyBnb) / buyBnb * 100 });
  }
  console.log(`有效票=${ctx.length}\n`);

  for (const th of [90, 80]) {
    console.log(`===== 阈值 ${th} =====`);
    for (const w of WINDOWS) {
      let n2 = 0, sumD2 = 0; const det2 = [];
      for (const x of ctx) {
        const s = simulate(x.recs, x.buyMs, th, w.deb, w.ticks);
        if (!s || s.t >= x.firstSellMs) continue;
        let p0 = x.recs.find(r => r.t >= x.buyMs && r.t <= x.buyMs + 5000)?.price;
        if (p0 == null) { const prior = [...x.recs].reverse().find(r => r.t < x.buyMs); p0 = prior?.price; }
        const hyp = x.buyBnb * (s.price / p0) - x.buyBnb;
        const d = hyp - x.actualPnl;
        n2++; sumD2 += d;
        det2.push(`    ${x.addr} hold=${s.hold}s 卖位=${(s.price / p0 * 100 - 100).toFixed(1)}% 实际=${x.actPct.toFixed(1)}% Δ=${d >= 0 ? '+' : ''}${d.toFixed(4)}`);
      }
      console.log(`  窗=${w.name.padEnd(10)} 成交=${n2} 票  ΣΔ=${sumD2 >= 0 ? '+' : ''}${sumD2.toFixed(4)} BNB`);
      for (const line of det2) console.log(line);
    }
    console.log('');
  }
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
