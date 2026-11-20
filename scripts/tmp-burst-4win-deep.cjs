const { dbManager } = require('../src/services/dbManager');

const WINS = [
  { k: 'v155', id: 'dddbe79e-480a-402a-aa35-85a72d2f591e' },
  { k: 'v156', id: 'b8ae9f2e-832f-42db-bbda-8d8701aecb63' },
  { k: 'v140', id: '6e75ed6d-807a-4164-9551-d3b95d1fc37b' },
  { k: 'v145', id: '2448116a-bebe-457d-9d8a-b4556c9a8e0d' },
];

async function main() {
  const sb = dbManager.getClient();
  const rows = [];
  const seen = new Map();
  for (const w of WINS) {
    // 首信号 per token
    const sigs = [];
    let from = 0;
    while (true) {
      const { data, error } = await sb.from('strategy_signals').select('*')
        .eq('experiment_id', w.id).eq('signal_type', 'BUY')
        .order('created_at', { ascending: true }).range(from, from + 999);
      if (error) throw error;
      if (!data || !data.length) break;
      sigs.push(...data); from += 1000;
      if (data.length < 1000) break;
    }
    const first = new Map();
    for (const s of sigs) if (!first.has(s.token_address)) first.set(s.token_address, s);
    // trades
    const tmap = new Map();
    {
      let f2 = 0;
      while (true) {
        const { data, error } = await sb.from('trades').select('*')
          .eq('experiment_id', w.id).order('created_at').range(f2, f2 + 999);
        if (error) throw error;
        if (!data || !data.length) break;
        for (const t of data) {
          if (!tmap.has(t.token_address)) tmap.set(t.token_address, []);
          tmap.get(t.token_address).push(t);
        }
        f2 += 1000;
        if (data.length < 1000) break;
      }
    }
    for (const [tok, s] of first) {
      const dedupKey = tok + '|' + (s.created_at || '').slice(0, 13);
      if (seen.has(dedupKey)) continue;
      seen.set(dedupKey, 1);
      const m = s.metadata || {};
      const bp = m.buyPoint || {};
      const an = bp.anchors || {};
      const dim = bp.dimensions || {};
      const tr = (tmap.get(tok) || []).filter(t => t.success);
      const buys = tr.filter(t => t.trade_direction === 'buy');
      if (!buys.length) continue; // 只看成交票
      const sells = tr.filter(t => t.trade_direction === 'sell');
      const buyBnb = buys.reduce((x, t) => x + Number(t.input_amount), 0);
      const sellBnb = sells.reduce((x, t) => x + Number(t.output_amount), 0);
      const burstBnb = an.burst5BuyBnb, bundleBnb = an.bundledBlockBnb;
      rows.push({
        win: w.k, tok, t: s.created_at,
        shape: dim.entry_shape && dim.entry_shape.bucket,
        chg5: an.chg5Pct, idle: an.actIdlePct, tvm: an.totalVolumeBnb,
        burstN: an.burst5N, burstBnb,
        bundleBnb, bundlePct: (typeof bundleBnb === 'number' && typeof burstBnb === 'number' && burstBnb > 0) ? +(bundleBnb / burstBnb * 100).toFixed(1) : null,
        anchorVs: an.currentVsLaunchPct,
        buyT: buys[0].created_at, lastSellT: sells.length ? sells[sells.length - 1].created_at : null,
        pnl: +(sellBnb - buyBnb).toFixed(4),
      });
    }
  }
  console.log('四窗成交票(去重):', rows.length);

  // 轴1: 波内同块捆绑占比 × pnl（spike 桶 & 全体）
  for (const scope of ['spike', 'all']) {
    const g = scope === 'spike' ? rows.filter(r => r.shape === 'spike') : rows;
    console.log(`\n== ${scope === 'spike' ? 'spike 桶' : '全体'} 波内捆绑占比分桶 ==`);
    for (const [lo, hi] of [[0, 20], [20, 35], [35, 999]]) {
      const b = g.filter(r => r.bundlePct !== null && r.bundlePct >= lo && r.bundlePct < hi);
      if (!b.length) continue;
      const s = b.reduce((x, r) => x + r.pnl, 0);
      console.log(`  捆绑占比 [${lo},${hi}): ${String(b.length).padStart(3)}票 pnlΣ=${s.toFixed(4).padStart(8)} 胜${b.filter(r=>r.pnl>0).length}/${b.length}`);
    }
  }
  // spike ∧ 捆绑占比≥35 明细
  console.log('\n== spike ∧ 波内捆绑占比≥35% 明细 ==');
  for (const r of rows.filter(r => r.shape === 'spike' && r.bundlePct !== null && r.bundlePct >= 35).sort((a, b) => b.bundlePct - a.bundlePct)) {
    console.log(`  ${r.win} ${r.tok.slice(0, 10)} 捆绑${r.bundlePct}% (${r.bundleBnb}/${r.burstBnb}B) chg5=${r.chg5} idle=${r.idle} tvm=${r.tvm}B pnl=${r.pnl}`);
  }

  // 方向2: burst/spike 票入场后「砸盘开始」时刻 vs 实际卖出（回放 sinceEntryNetBuyRatio<=-60 ∧ sinceEntrySellBnb>=0.3）
  console.log('\n== 方向2: burst 票快逃臂回放（入场后累计卖≥0.3B ∧ 净买比≤-60 触发） ==');
  const targets = rows.filter(r => r.shape === 'spike' || (r.chg5 !== null && r.chg5 >= 25));
  let gain = 0, hit = 0, miss = 0;
  for (const r of targets) {
    const { data: ticks, error } = await sb.from('wss_price_ticks')
      .select('block_time,price_bnb,bnb_amount,trade_type')
      .eq('token_address', r.tok)
      .gte('block_time', r.buyT)
      .order('block_time', { ascending: true }).limit(600);
    if (error || !ticks || !ticks.length) { miss++; continue; }
    // 回放：入场后逐笔累计（卖额、净比），首触发时刻价
    let sellB = 0, buyB = 0, trigT = null, trigP = null, trigSellB = 0;
    for (const tk of ticks.slice(1)) { // slice(1)=跳过买点本身
      const amt = Number(tk.bnb_amount), isBuy = tk.trade_type === 'buy';
      if (isBuy) buyB += amt; else sellB += amt;
      const tot = buyB + sellB;
      const ratio = tot > 0 ? (buyB - sellB) / tot * 100 : null;
      if (sellB >= 0.3 && ratio !== null && ratio <= -60) {
        trigT = tk.block_time; trigP = Number(tk.price_bnb); trigSellB = sellB;
        break;
      }
    }
    if (!trigT) { miss++; continue; }
    hit++;
    // 实际卖出均价（相对）
    const firstBuyP = Number(ticks[0].price_bnb) || null;
    // 快逃理论卖价 vs 实际整体 pnl 换算：以 trigP/firstBuyP 估算快逃 pp
    const fastPct = firstBuyP ? (trigP / firstBuyP - 1) * 100 : null;
    const actualPct = r.pnl / 0.2 * 100; // 每票买 0.2
    const delta = fastPct !== null ? (fastPct - actualPct) * 0.2 / 100 : null; // BNB 增益近似
    if (delta !== null) gain += delta;
    console.log(`  ${r.win} ${r.tok.slice(0, 10)} 触发@${trigT.slice(11, 19)} 快逃价vs买价=${fastPct !== null ? fastPct.toFixed(1) + '%' : '?'} 实际pnl=${r.pnl} (${actualPct.toFixed(1)}%) 增益≈${delta !== null ? delta.toFixed(4) : '?'}`);
  }
  console.log(`\n快逃臂回放: 目标 ${targets.length} 票 | 触发 ${hit} | 未触发 ${miss} | 增益Σ≈${gain.toFixed(4)} BNB`);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
