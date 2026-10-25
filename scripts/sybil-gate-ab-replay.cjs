require("/home/ubuntu/richer-js/node_modules/dotenv").config({ path: "/home/ubuntu/richer-js/config/.env" });
const { dbManager } = require("/home/ubuntu/richer-js/src/services/dbManager");
const Mod = require("/home/ubuntu/richer-js/src/services/FourMemeFactorAggregator");
const FA = Mod.default || Mod;
const DUST = 0.001;
const FLAP_TOTAL_SUPPLY = 1e9; // 生产 collector 同款常量（flap-ankr-ws-collector.js:69）
const EXPS = [["ca8f9493-d6ea-4d97-9b3c-1470cbbafc88","v37"],["cf3d8177-f912-424e-ab1c-e73daa66cfea","v36"]];
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
const sybilOK = f => (f.sybilClusterHolderCircPct ?? 0) < 35;
(async () => {
  const c = dbManager.getClient();
  await Promise.all([FA.loadSybilClusters(), FA.loadCopyWalletRoster(), FA.loadFamousCopyWallets()]);
  const NEW = [], EARLIER = [], BOTH = [];
  const actualBought = new Set();
  let noMeta = 0;
  const chain = arr => arr.sort((a,b)=>(a.block_number-b.block_number)||(a.log_index-b.log_index));
  const mkFa = async (tok, sym, platform, createdAtMs, supply) => { const fa = new FA({}); await fa.registerToken(tok, { symbol: sym, platform, createdAtMs, totalSupply: supply }); return fa; };
  for (const [eid, tag] of EXPS) {
    const tr = await c.from("trades").select("token_address,trade_direction,success").eq("experiment_id", eid).limit(500);
    for (const t of (tr.data||[])) if (t.success !== false && t.trade_direction === "buy") actualBought.add(t.token_address);
    const toks = []; let cur = "00000000-0000-0000-0000-000000000000";
    while (true) {
      const r = await c.from("experiment_tokens").select("id,token_address,token_symbol,discovered_at,created_at").eq("experiment_id", eid).order("id").gt("id", cur).limit(500);
      if (r.error) { console.log("tokErr", JSON.stringify(r.error).slice(0,150)); break; }
      if (!r.data || !r.data.length) break;
      toks.push(...r.data); cur = r.data[r.data.length-1].id;
      if (r.data.length < 500) break;
    }
    console.log(`[${tag}] tokens=${toks.length}`);
    let done = 0;
    for (const tk of toks) {
      done++;
      if (done % 200 === 0) console.log(`[${tag}] progress ${done}/${toks.length}`);
      const tok = tk.token_address, sym = tk.token_symbol || "?";
      const discMs = Date.parse(tk.discovered_at || tk.created_at || "");
      if (!discMs) continue;
      // token_create meta：年龄锚=blockTimeMs、供应量=four.meme payload / flap 常量（生产 collector 同口径）
      const mr = await c.from("wss_events").select("payload,platform").eq("kind","token_create").eq("token_address", tok).order("block_time").limit(1);
      const meta = (mr.data && mr.data[0] && mr.data[0].payload) || null;
      if (!meta) noMeta++;
      const anchorMs = meta && meta.blockTimeMs ? Number(meta.blockTimeMs) : discMs;
      const supply = meta && Number(meta.totalSupply) > 0 ? Number(meta.totalSupply) : FLAP_TOTAL_SUPPLY;
      const winStart = new Date(anchorMs - 60*1000).toISOString(), winEnd = new Date(anchorMs + 12*60*1000).toISOString();
      let r;
      try { r = await c.from("wss_price_ticks").select("id,block_number,log_index,block_time,trader_address,sender_address,trade_type,token_amount,bnb_amount,price_bnb,price_usd,platform").eq("token_address", tok).gte("block_time", winStart).lte("block_time", winEnd).order("id").limit(3000); } catch(e) { continue; }
      if (r.error) continue;
      const ticks = chain((r.data||[]).filter(t => Number(t.bnb_amount) >= DUST));
      if (ticks.length < 5) continue;
      let fa; try { fa = await mkFa(tok, sym, ticks[0].platform, anchorMs, supply); } catch(e) { continue; }
      const feed = t => { const ts = Date.parse(t.block_time); fa.processTick({ token_address: tok, platform: t.platform, timestamp: ts, block_number: t.block_number, log_index: t.log_index, trader_address: t.trader_address, sender_address: t.sender_address, trade_type: t.trade_type, token_amount: Number(t.token_amount), bnb_amount: Number(t.bnb_amount||0), price_bnb: Number(t.price_bnb||0), price_usd: Number(t.price_usd||0) }, { emitFactors: false }); return ts; };
      let baseF = null, varF = null, endP = null, peak = 0;
      for (const t of ticks) {
        const ts = feed(t);
        const f = fa.buildFactorMap(tok, ts) || {};
        if (f.currentPriceBnb > 0) { endP = f.currentPriceBnb; if (f.currentPriceBnb > peak) peak = f.currentPriceBnb; }
        if (!varF && baseArm(f)) varF = { p: f.currentPriceBnb, ts, f: {...f} };
        if (!baseF && baseArm(f) && sybilOK(f)) baseF = { p: f.currentPriceBnb, ts, f: {...f} };
      }
      if (!varF) continue;
      // 收益段：门扫窗之后到当前（过门票才拉）
      let r2;
      try { r2 = await c.from("wss_price_ticks").select("id,block_number,log_index,block_time,trader_address,sender_address,trade_type,token_amount,bnb_amount,price_bnb,price_usd,platform").eq("token_address", tok).gt("block_time", winEnd).order("id").limit(2000); } catch(e) { r2 = { data: [] }; }
      for (const t of chain((r2.data||[]).filter(t => Number(t.bnb_amount) >= DUST))) {
        const ts = feed(t);
        const f = fa.buildFactorMap(tok, ts) || {};
        if (f.currentPriceBnb > 0) { endP = f.currentPriceBnb; if (f.currentPriceBnb > peak) peak = f.currentPriceBnb; }
      }
      const rel = p => varF.p > 0 ? (p/varF.p-1)*100 : NaN;
      const row = { tag, sym, tok, varF, baseF, end: endP ? rel(endP) : null, peak: rel(peak), actual: actualBought.has(tok), _t0: anchorMs };
      if (baseF) { BOTH.push(row); if (varF.ts < baseF.ts - 1000) EARLIER.push(row); }
      else NEW.push(row);
    }
    console.log(`[${tag}] scan complete: NEW=${NEW.length} BOTH=${BOTH.length}`);
  }
  const bothActual = BOTH.filter(r=>r.actual);
  console.log(`\n对拍: 实际成交=${actualBought.size} 落入BOTH=${bothActual.length} 无token_create行=${noMeta}`);
  const missing = [...actualBought].filter(a => !BOTH.find(r=>r.tok===a));
  if (missing.length) console.log("⚠实际成交但重放未过门(需查):", missing.map(a=>a.slice(0,10)).join(","));
  console.log(`\n=== NEW: 删 sybil 门后新增买入 (${NEW.length} 票) ===`);
  for (const r of NEW) {
    const f = r.varF.f;
    console.log(`${r.tag}/${r.sym}`.padEnd(14), r.tok, "| age" + String(Math.round((r.varF.ts - r._t0)/1000)).padStart(5) + "s",
      "syb" + String(Math.round(f.sybilClusterHolderCircPct)).padStart(4),
      "top1" + String(Math.round(f.top1HolderCircPct)).padStart(5),
      "h" + String(f.holderCount ?? 0).padStart(4),
      "mcap" + String(Math.round(f.marketCap)).padStart(6), "|",
      "窗末", (r.end!=null?r.end.toFixed(1):"?").padStart(7), "峰", (r.peak!=null?r.peak.toFixed(1):"?").padStart(7), r.actual ? "  ←实际也买过" : "");
  }
  console.log(`\n=== EARLIER: 同票买点提前 (${EARLIER.length} 票) ===`);
  for (const r of EARLIER) {
    const d = ((r.baseF.ts - r.varF.ts)/1000).toFixed(0);
    const px = r.varF.p > 0 ? (r.baseF.p/r.varF.p-1)*100 : NaN;
    console.log(`${r.tag}/${r.sym}`.padEnd(14), r.tok.slice(0,12), `提前${d}s 买点价差${px.toFixed(1)}%`);
  }
  const sum = a => a.reduce((s,x)=>s+(x??0),0);
  console.log(`\n汇总:`);
  console.log(`  NEW ${NEW.length} 票: 窗末Σ=${sum(NEW.map(r=>r.end??0)).toFixed(1)}% 均值=${(sum(NEW.map(r=>r.end??0))/Math.max(1,NEW.length)).toFixed(1)}% 峰值均值=${(sum(NEW.map(r=>r.peak??0))/Math.max(1,NEW.length)).toFixed(1)}%`);
  const nb = BOTH.filter(r=>!r.actual);
  console.log(`  BOTH ${BOTH.length} 票 其中实际未买 ${nb.length} 票: 窗末均值=${(sum(nb.map(r=>r.end??0))/Math.max(1,nb.length)).toFixed(1)}%`);
  console.log("DONE");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
