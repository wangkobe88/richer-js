require("/home/ubuntu/richer-js/node_modules/dotenv").config({ path: "/home/ubuntu/richer-js/config/.env" });
const { dbManager } = require("/home/ubuntu/richer-js/src/services/dbManager");
const Mod = require("/home/ubuntu/richer-js/src/services/FourMemeFactorAggregator");
const FA = Mod.default || Mod;
const fs = require("fs");
const DUST = 0.001;
const EXPS = [["ca8f9493-d6ea-4d97-9b3c-1470cbbafc88","v37"],["cf3d8177-f912-424e-ab1c-e73daa66cfea","v36"]];
const KS = [2,3,4,5,6];
(async () => {
  const c = dbManager.getClient();
  const j = JSON.parse(fs.readFileSync("/home/ubuntu/richer-js/config/rosters/sybil-clusters.json","utf8"));
  const ROSTER = new Set(j.wallets.map(w=>String(w).toLowerCase()));
  const rows = [];
  for (const [eid, tag] of EXPS) {
    const tr = await c.from("trades").select("token_address,token_symbol,trade_direction,input_amount,output_amount,success,created_at,executed_at").eq("experiment_id", eid).order("created_at").limit(300);
    const byTok = {};
    for (const t of (tr.data||[])) if (t.success !== false) (byTok[t.token_address] = byTok[t.token_address] || []).push(t);
    for (const [tok, trows] of Object.entries(byTok)) {
      const buys = trows.filter(x=>x.trade_direction==="buy"), sells = trows.filter(x=>x.trade_direction==="sell");
      const bB = buys.reduce((s,x)=>s+Number(x.input_amount||0),0);
      const sB = sells.reduce((s,x)=>s+Number(x.output_amount||0),0);
      const actualRet = bB > 0 ? (sB/bB-1)*100 : null;
      const buyTs = Date.parse((buys[0].executed_at || buys[0].created_at)+"");
      const sym = trows[0].token_symbol || "?";
      const r = await c.from("wss_price_ticks").select("id,block_number,log_index,block_time,trader_address,sender_address,trade_type,token_amount,bnb_amount,price_bnb,platform").eq("token_address", tok).order("id").limit(2000);
      const ticks = (r.data||[]).filter(t => Number(t.bnb_amount) >= DUST).sort((a,b)=>(a.block_number-b.block_number)||(a.log_index-b.log_index));
      if (!ticks.length) continue;
      const fa = new FA({});
      FA.setSybilClustersForTest(ROSTER);
      await fa.registerToken(tok, { symbol: sym, platform: ticks[0].platform });
      const curve = [];
      for (const t of ticks) {
        const ts = Date.parse(t.block_time);
        fa.processTick({ token_address: tok, platform: t.platform, timestamp: ts,
          block_number: t.block_number, log_index: t.log_index, trader_address: t.trader_address, sender_address: t.sender_address,
          trade_type: t.trade_type, token_amount: Number(t.token_amount), bnb_amount: Number(t.bnb_amount||0), price_bnb: Number(t.price_bnb||0) }, { emitFactors: false });
        const f = fa.buildFactorMap(tok, ts) || {};
        curve.push({ age: ts - buyTs, price: f.currentPriceBnb, holders: f.holders });
      }
      const after = curve.filter(p => p.age >= 0);
      if (!after.length) continue;
      const buyPrice = after[0].price;
      const rel = p => buyPrice > 0 ? (p/buyPrice-1)*100 : NaN;
      const row = { tag, sym, h0: after[0].holders, actual: actualRet, arms: {}, t: {} };
      for (const k of KS) {
        const hit = after.find(p => p.holders != null && p.holders <= k);
        row.arms["h≤"+k] = hit ? rel(hit.price) : null;
        row.t["h≤"+k] = hit ? (hit.age/1000).toFixed(0)+"s" : "-";
      }
      rows.push(row);
    }
  }
  console.log("票              h0  实际%  | " + KS.map(k=>("h≤"+k).padStart(11)).join(""));
  for (const r of rows) {
    console.log((r.tag+"/"+r.sym).padEnd(14), String(r.h0).padStart(4), String(r.actual!=null?r.actual.toFixed(1):"?").padStart(6), "|",
      KS.map(k => r.arms["h≤"+k] == null ? "     —    " : (r.arms["h≤"+k].toFixed(1)+"@"+r.t["h≤"+k]).padStart(11)).join(""));
  }
  console.log("\n各臂 vs 实际净改善（未触发按实际计）:");
  for (const k of KS) {
    const n = "h≤"+k;
    let sum = 0, nTrig = 0, worst = null, best = null;
    for (const r of rows) {
      if (r.actual == null) continue;
      const v = r.arms[n] != null ? r.arms[n] : r.actual;
      const d = v - r.actual; sum += d;
      if (r.arms[n] != null) { nTrig++; if (!worst || d < worst.d) worst = { d, s: r.sym }; if (!best || d > best.d) best = { d, s: r.sym }; }
    }
    console.log(`  ${n.padEnd(6)} Σ${sum>=0?"+":""}${sum.toFixed(1)}pp  触发${nTrig}  最差单票:${worst?worst.s+" "+worst.d.toFixed(1):"-"}  最好单票:${best?best.s+" +"+best.d.toFixed(1):"-"}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
