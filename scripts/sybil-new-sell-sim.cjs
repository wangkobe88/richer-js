require("/home/ubuntu/richer-js/node_modules/dotenv").config({ path: "/home/ubuntu/richer-js/config/.env" });
const { dbManager } = require("/home/ubuntu/richer-js/src/services/dbManager");
const Mod = require("/home/ubuntu/richer-js/src/services/FourMemeFactorAggregator");
const FA = Mod.default || Mod;
const DUST = 0.001;
const FLAP_TOTAL_SUPPLY = 1e9;
// NEW 14 票（v4 输出，sybil 门当前拦截、删门后新增买入）
const TOKS = [
  ["v37","朗月","0xe68c4491f4b7d1eaf2f5591af2bcdede89917777"],
  ["v37","金铲铲","0xeeb391a7c79a5e38470ba8ab345b4d5f0e5f7777"],
  ["v37","币安拉新","0xac02e7b4383958b7da3993082b36ce2d57277777"],
  ["v37","修狗","0x5d07e1d3dadfbbcb2c41b8720d116b26e2527777"],
  ["v36","孔子学院","0x847aaed9ffa1aee967f9483d0f0b86cf0f407777"],
  ["v36","奶龙学","0xcfacb45e719507e72fec77251ed240b4e0da7777"],
  ["v36","묭묭밍밍","0x8d5b5ce056ed5940565096f328e865dc29457777"],
  ["v36","飞天羊","0x10121e136384d587da779633c84633a21bfa7777"],
  ["v36","努努","0x2fae56c17b5c869f856b3502c8194489540d7777"],
  ["v36","BNCB人生","0x23dea619c0ee0578d19215a14780a9fad8bb7777"],
  ["v36","小航","0x760a0ec0a95ce61a158616dcb94d9542df647777"],
  ["v36","兔极猴","0x79a145ab6748b415a9db4f09fb77b67307757777"],
  ["v36","超强社区","0xb37c822a4c06e205829a2813704b37526b257777"],
  ["v36","豆姐","0x9468a540ab8f4410721a6d4c3e6058a3d6727777"],
];
// v36 买门（叙事恒真）——与 v4 同款
const baseArm = f =>
  ((f.tokenAgeSec != null && f.tokenAgeSec < 90) || (f.tradeCount >= 25 && f.tokenAgeSec != null && f.tokenAgeSec < 600)) &&
  f.marketCap > 3500 && f.marketCap < 20000 &&
  (f.holderTrendSlope != null && f.holderTrendSlope > 0) &&
  (f.bundleClusterHoldCircPct ?? 99) < 35 &&
  (f.top1HolderCircPct ?? 99) < 35 &&
  (f.maxCopyWalletHolderCircPct ?? 99) < 20 &&
  (f.platform !== "flap" || (f.earlyTradesRouterPct ?? 0) >= 30) &&
  (f.earlyTradesPerWallet ?? 99) < 4 &&
  (f.famousCopyWalletCircPct ?? 0) < 15 &&
  ((f.buyVolumeBnbExSybil ?? 0) >= 1.25 || (f.holdersExSybil ?? 0) >= 10) &&
  (f.earlyTradesNetBuyRatio ?? -1) >= 50 &&
  (f.drawdownFromHighest ?? -100) > -70 &&
  (f.crashSpeedPctPerSec ?? -100) > -10;
// 卖腿 17 条（v37/v36 实验同款；narrativeCategory/issuerAccountState 重放无源恒 false 如实模拟）
const LEGS = [
  { pri: 0, name: "[0]-50全清",      cards: "all", cool: 0,   cond: f => f.profitPercent <= -50 },
  { pri: 2, name: "[2]-35全清",      cards: "all", cool: 0,   cond: f => f.profitPercent <= -35 },
  { pri: 3, name: "[3]毕业.9卖2",    cards: 2,     cool: 0,   cond: f => (f.graduationProgress ?? 0) >= 0.9 },
  { pri: 4, name: "[4]mcap3.5-4K清", cards: "all", cool: 0,   cond: f => f.marketCap > 3500 && f.marketCap < 4000 && f.realHoldDuration > 10 },
  { pri: 4, name: "[4]mcap<3.5K清",  cards: "all", cool: 0,   cond: f => f.marketCap > 0 && f.marketCap < 3500 && f.realHoldDuration > 120 },
  { pri: 5, name: "[5]RSI>85卖1",    cards: 1,     cool: 0,   cond: f => (f.rsi9Bar5mRt ?? 0) > 85 && (f.risePct5m ?? 0) >= 5 },
  { pri: 6, name: "[6]RSI78-85卖1",  cards: 1,     cool: 0,   cond: f => { const r = f.rsi9Bar5mRt ?? 0; return r > 78 && r <= 85 && (f.risePct5m ?? 0) >= 5; } },
  { pri: 7, name: "[7]+100卖1",      cards: 1,     cool: 80,  cond: f => f.profitPercent > 100 },
  { pri: 8, name: "[8]毕业.98卖2",   cards: 2,     cool: 0,   cond: f => (f.graduationProgress ?? 0) >= 0.98 },
  { pri: 9, name: "[9]+50卖1",       cards: 1,     cool: 300, cond: f => f.profitPercent > 50 },
  { pri: 11, name: "[11]回撤-35清(<6K)",  cards: "all", cool: 0, cond: f => f.peakProfitPct >= 10 && (f.drawdownFromHighestSinceLastBuy ?? 0) <= -35 && f.marketCap < 6000 },
  { pri: 11, name: "[11]回撤-35清(6-20K)", cards: "all", cool: 0, cond: f => f.peakProfitPct >= 10 && (f.drawdownFromHighestSinceLastBuy ?? 0) <= -35 && f.marketCap >= 6000 && f.marketCap < 20000 },
  { pri: 11, name: "[11]回撤-25清(≥20K)", cards: "all", cool: 0, cond: f => f.peakProfitPct >= 10 && (f.drawdownFromHighestSinceLastBuy ?? 0) <= -25 && f.marketCap >= 20000 },
  { pri: 1, name: "[1]1h死票清",     cards: "all", cool: 0,   cond: f => f.holdDuration > 3600 && f.profitPercent <= 0 },
  { pri: 4, name: "[4]120s量弱清",   cards: "all", cool: 0,   cond: f => f.holdDuration > 120 && (f.buyVolumeBnb ?? 0) < 2 },
];
(async () => {
  const c = dbManager.getClient();
  await Promise.all([FA.loadSybilClusters(), FA.loadCopyWalletRoster(), FA.loadFamousCopyWallets()]);
  const chain = arr => arr.sort((a,b)=>(a.block_number-b.block_number)||(a.log_index-b.log_index));
  const results = [];
  for (const [tag, sym, tok] of TOKS) {
    const mr = await c.from("wss_events").select("payload,platform").eq("kind","token_create").eq("token_address", tok).order("block_time").limit(1);
    const meta = (mr.data && mr.data[0] && mr.data[0].payload) || null;
    const anchorMs = meta && meta.blockTimeMs ? Number(meta.blockTimeMs) : null;
    const supply = meta && Number(meta.totalSupply) > 0 ? Number(meta.totalSupply) : FLAP_TOTAL_SUPPLY;
    if (!anchorMs) { console.log(`${sym} no meta, skip`); continue; }
    const winEnd = new Date(anchorMs + 12*60*1000).toISOString();
    const r1 = await c.from("wss_price_ticks").select("block_number,log_index,block_time,trader_address,sender_address,trade_type,token_amount,bnb_amount,price_bnb,price_usd,platform").eq("token_address", tok).gte("block_time", new Date(anchorMs - 60*1000).toISOString()).lte("block_time", winEnd).order("id").limit(3000);
    const r2 = await c.from("wss_price_ticks").select("block_number,log_index,block_time,trader_address,sender_address,trade_type,token_amount,bnb_amount,price_bnb,price_usd,platform").eq("token_address", tok).gt("block_time", winEnd).order("id").limit(2000);
    const ticks = chain([...(r1.data||[]), ...(r2.data||[])].filter(t => Number(t.bnb_amount) >= DUST));
    if (ticks.length < 5) continue;
    const fa = new FA({});
    await fa.registerToken(tok, { symbol: sym, platform: ticks[0].platform, createdAtMs: anchorMs, totalSupply: supply });
    // 状态：4 张卡 + 各腿确认窗/冷却
    let cards = 4, bought = false, buyP = 0, buyTs = 0;
    const legState = LEGS.map(() => ({ anchor: null, trueTicks: 0, lastFire: -1e18, done: false }));
    const sells = [];
    let lastP = 0, lastTs = 0, peakAfterBuy = 0;
    for (const t of ticks) {
      const ts = Date.parse(t.block_time);
      fa.processTick({ token_address: tok, platform: t.platform, timestamp: ts, block_number: t.block_number, log_index: t.log_index, trader_address: t.trader_address, sender_address: t.sender_address, trade_type: t.trade_type, token_amount: Number(t.token_amount), bnb_amount: Number(t.bnb_amount||0), price_bnb: Number(t.price_bnb||0), price_usd: Number(t.price_usd||0) }, { emitFactors: false });
      const f = fa.buildFactorMap(tok, ts) || {};
      if (f.currentPriceBnb > 0) { lastP = f.currentPriceBnb; lastTs = ts; if (bought && f.currentPriceBnb > peakAfterBuy) peakAfterBuy = f.currentPriceBnb; }
      if (!bought) {
        if (baseArm(f)) { bought = true; buyP = f.currentPriceBnb; buyTs = ts; fa.setBuyState(tok, { buyPriceBnb: buyP, buyTime: ts, buySignalAt: ts }); }
        continue;
      }
      if (cards <= 0) break;
      // 逐腿：确认窗 3.5s+5 真tick、120s 逃生、冷却；同 tick 按 pri 序消费卡
      for (let i = 0; i < LEGS.length; i++) {
        const leg = LEGS[i], st = legState[i];
        if (st.done || cards <= 0) continue;
        if (ts - st.lastFire < leg.cool * 1000) continue;
        let cond;
        try { cond = leg.cond(f); } catch(e) { cond = false; }
        if (!cond) { st.anchor = null; st.trueTicks = 0; continue; }
        st.trueTicks++; if (st.anchor == null) st.anchor = ts;
        const elapsed = ts - st.anchor;
        if ((elapsed >= 3500 && st.trueTicks >= 5) || elapsed >= 120000) {
          const n = leg.cards === "all" ? cards : Math.min(leg.cards, cards);
          sells.push({ leg: leg.name, n, ret: buyP > 0 ? (f.currentPriceBnb / buyP - 1) * 100 : 0, atS: Math.round((ts - buyTs)/1000) });
          cards -= n; st.lastFire = ts; st.anchor = null; st.trueTicks = 0;
          if (leg.cards === "all") st.done = true;
          if (cards <= 0) { fa.clearBuyState(tok); break; }
        }
      }
    }
    const realized = sells.length ? sells.reduce((s, x) => s + x.n * x.ret, 0) / 4 : 0;
    const remainRet = cards > 0 && lastP > 0 && buyP > 0 ? (lastP / buyP - 1) * 100 : null;
    results.push({ tag, sym, tok, buyP, sells, cards, realized, remainRet, peakRet: buyP > 0 ? (peakAfterBuy / buyP - 1) * 100 : null, spanTicks: ticks.length });
  }
  console.log("\n================ 假想买入后的卖腿模拟（4 卡，含确认窗/冷却）================");
  let tot = 0;
  for (const r of results) {
    tot += r.realized + (r.remainRet ?? 0) * (r.cards / 4);
    console.log(`\n${r.tag}/${r.sym} ${r.tok}`);
    console.log(`  买点价=${r.buyP.toExponential(3)} 峰值=${r.peakRet != null ? r.peakRet.toFixed(1) + "%" : "?"}`);
    for (const s of r.sells) console.log(`    卖 ${s.n} 张 @${s.ret.toFixed(1)}%  (+${s.atS}s)  ${s.leg}`);
    if (r.cards > 0) console.log(`    未平仓 ${r.cards} 张 浮动=${r.remainRet != null ? r.remainRet.toFixed(1) + "%" : "?"}`);
    const net = r.realized + (r.remainRet ?? 0) * (r.cards / 4);
    console.log(`  组合净收益=${net.toFixed(1)}%`);
  }
  console.log(`\n14 票组合净收益 Σ=${tot.toFixed(1)}pp 均值=${(tot / results.length).toFixed(1)}%`);
  console.log("DONE");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
