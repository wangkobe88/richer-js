// T113 阈值假想评估：sinceEntryNetBuyRatio >= 90 改 >= 80 在 bt-v140 上的影响面
// 口径：每票 tick 级重放入场后累计净买比 + 卖确认窗状态机（3.5s+5tick+翻假clear+120s逃生）
// 假想回收 = Σ买入BNB × (成交tick价/入场tick价)（忽略滑点/多轮再买按全仓近似）
const { dbManager } = require('../src/services/dbManager.js');
const EXP = '6e75ed6d-807a-4164-9551-d3b95d1fc37b';

const DEBOUNCE_MS = 3500, MIN_TICKS = 5, MAX_WAIT_MS = 120000;

// 确认窗状态机：返回 {sold, t, price, hold} 或 null
function simulate(recs, buyMs, th) {
  let buy = 0, sell = 0;
  let pending = null; // {firstT, touches}
  for (const r of recs) {
    const holdMs = r.t - buyMs;
    const amt = r.amt || 0;
    if (r.type === 'buy') buy += amt; else sell += amt;
    const ratio = (buy + sell) > 0 ? (buy - sell) / (buy + sell) * 100 : null;
    const cond = holdMs >= 30000 && ratio != null && ratio >= th;
    if (pending) {
      if (!cond) { pending = null; continue; }
      pending.touches++;
      const elapsed = r.t - pending.firstT;
      if ((elapsed >= DEBOUNCE_MS && pending.touches >= MIN_TICKS) || elapsed >= MAX_WAIT_MS) {
        return { sold: true, t: r.t, price: r.price, hold: Math.round(holdMs / 1000), ratio };
      }
    } else if (cond) {
      pending = { firstT: r.t, touches: 0 };
    }
  }
  return null;
}

(async () => {
  const c = await dbManager.getClient();

  // 1) 全部成交，按票组织
  const { data: trades } = await c.from('trades')
    .select('token_address,trade_direction,trade_status,input_amount,output_amount,created_at')
    .eq('experiment_id', EXP).order('created_at', { ascending: true }).limit(1000);
  const byTok = {};
  for (const t of trades || []) {
    if (t.trade_status !== 'success') continue;
    (byTok[t.token_address] = byTok[t.token_address] || []).push(t);
  }
  const toks = Object.keys(byTok).filter(a => byTok[a].some(t => t.trade_direction === 'buy'));
  console.log(`买入票数=${toks.length}`);

  const stats = { both: 0, only80: 0, none: 0, laterThanActual: 0 };
  let sumDelta80 = 0, sumDelta90 = 0; // 相对实际盈亏
  const rows = [];
  for (const addr of toks) {
    const tl = byTok[addr];
    const firstBuy = tl.find(t => t.trade_direction === 'buy');
    const lastSell = tl.filter(t => t.trade_direction === 'sell').pop() || null;
    const buyBnb = tl.filter(t => t.trade_direction === 'buy').reduce((s, t) => s + (t.input_amount || 0), 0);
    const sellBnb = tl.filter(t => t.trade_direction === 'sell').reduce((s, t) => s + (t.output_amount || 0), 0);
    const actualPnl = sellBnb - buyBnb;
    const buyMs = Date.parse(firstBuy.created_at);
    const firstSellMs = lastSell ? Date.parse(tl.find(t => t.trade_direction === 'sell').created_at) : Infinity;

    // 2) 拉 ticks（买入前60s ~ min(末卖+5s, 买入+2h)）
    const winEnd = new Date(Math.min(lastSell ? Date.parse(lastSell.created_at) + 5000 : buyMs + 7200000, buyMs + 7200000)).toISOString();
    const { data: ticks } = await c.from('wss_price_ticks')
      .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb')
      .eq('token_address', addr)
      .gte('block_time', new Date(buyMs - 60000).toISOString())
      .lte('block_time', winEnd)
      .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(3000);
    const recs = (ticks || []).map(r => ({
      t: Date.parse(r.block_time), type: r.trade_type, amt: r.bnb_amount || 0, price: r.price_bnb
    })).sort((a, b) => a.t - b.t || (a.type === 'sell' ? -1 : 1));
    if (!recs.length) { stats.none++; continue; }

    // 入场参考价 = 买入时刻起第一个 tick 价格（前 5s 内），否则买入前最后一个
    let p0 = recs.find(r => r.t >= buyMs && r.t <= buyMs + 5000)?.price;
    if (p0 == null) { const prior = [...recs].reverse().find(r => r.t < buyMs); p0 = prior?.price; }
    if (!p0) { stats.none++; continue; }

    const sim90 = simulate(recs, buyMs, 90);
    const sim80 = simulate(recs, buyMs, 80);

    // 触发晚于实际首卖 → 当时已无全仓语义，记无效
    const valid = s => s && s.t < firstSellMs;
    const v90 = valid(sim90), v80 = valid(sim80);

    let tag;
    if (v80 && v90) { stats.both++; tag = 'BOTH'; }
    else if (v80 && !v90) { stats.only80++; tag = 'ONLY80'; }
    else { stats.none++; tag = (sim80 || sim90) ? 'LATE' : 'NONE'; if ((sim80 || sim90) && !(v80 || v90)) stats.laterThanActual++; }

    const hyp = s => s ? buyBnb * (s.price / p0) - buyBnb : null;
    const h80 = hyp(v80 ? sim80 : null), h90 = hyp(v90 ? sim90 : null);
    if (v80) sumDelta80 += (h80 - actualPnl);
    if (v90) sumDelta90 += (h90 - actualPnl);
    if (v80 || v90) rows.push({ addr: addr.slice(0, 10), tag, hold80: v80 ? sim80.hold : '-', pp80: h80 != null ? (h80 / buyBnb * 100).toFixed(1) : '-',
      hold90: v90 ? sim90.hold : '-', pp90: h90 != null ? (h90 / buyBnb * 100).toFixed(1) : '-',
      actPct: (actualPnl / buyBnb * 100).toFixed(1), d80: h80 != null ? (h80 - actualPnl) : null, buyBnb });
  }

  console.log(`\n触发面：两线都成交=${stats.both} 仅80成交=${stats.only80} 都不成交=${stats.none}（其中晚于实际卖出=${stats.laterThanActual}）`);
  console.log(`\n成交票明细（pp%=假想全清收益率, act%=实际收益率, Δ80=假想-实际 BNB）:`);
  console.log('  token      tag     hold80  pp80%   hold90  pp90%   act%    Δ80');
  for (const r of rows) {
    console.log(`  ${r.addr}  ${r.tag.padEnd(7)} ${String(r.hold80).padStart(6)} ${String(r.pp80).padStart(7)} ${String(r.hold90).padStart(7)} ${String(r.pp90).padStart(7)} ${r.actPct.padStart(7)} ${r.d80 != null ? r.d80.toFixed(4) : '-'}`);
  }
  console.log(`\nΣ(假想80 − 实际)=${sumDelta80.toFixed(4)} BNB；Σ(假想90 − 实际)=${sumDelta90.toFixed(4)} BNB`);
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
