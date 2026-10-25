require("/home/ubuntu/richer-js/node_modules/dotenv").config({ path: "/home/ubuntu/richer-js/config/.env" });
const { dbManager } = require("/home/ubuntu/richer-js/src/services/dbManager");
const Mod = require("/home/ubuntu/richer-js/src/services/FourMemeFactorAggregator");
const FA = Mod.default || Mod;
const fs = require("fs");
const DUST = 0.001;
const EXPS = [["ca8f9493-d6ea-4d97-9b3c-1470cbbafc88","v37"],["cf3d8177-f912-424e-ab1c-e73daa66cfea","v36"]];
(async () => {
  const c = dbManager.getClient();
  const j = JSON.parse(fs.readFileSync("/home/ubuntu/richer-js/config/rosters/sybil-clusters.json","utf8"));
  const ROSTER = new Set(j.wallets.map(w=>String(w).toLowerCase()));
  const rows = [];
  for (const [eid, tag] of EXPS) {
    const tr = await c.from("trades").select("token_address,token_symbol,trade_direction,input_currency,input_amount,output_amount,success,created_at,executed_at").eq("experiment_id", eid).order("created_at").limit(300);
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
        curve.push({ ts, age: ts - buyTs, price: f.currentPriceBnb, holders: f.holders, top1: f.top1HolderCircPct, sybil: f.sybilClusterHolderCircPct });
      }
      const after = curve.filter(p => p.age >= 0);
      if (!after.length) continue;
      const buyPrice = after[0].price;
      const rel = p => buyPrice > 0 ? (p/buyPrice-1)*100 : NaN;
      const row = { tag, sym, actual: actualRet, arms: {} };
      // 臂定义: [名, 谓词fn]  谓词返回 true=该 tick 破线
      const ARMS = [
        ["syb≥50",  p => p.sybil != null && p.sybil >= 50],
        ["syb≥70",  p => p.sybil != null && p.sybil >= 70],
        ["syb≥90",  p => p.sybil != null && p.sybil >= 90],
        ["top1≥50", p => p.top1 != null && p.top1 >= 50],
        ["top1≥65", p => p.top1 != null && p.top1 >= 65],
        ["top1≥80", p => p.top1 != null && p.top1 >= 80],
        ["h≤2",     p => p.holders != null && p.holders <= 2],
        ["h≤3",     p => p.holders != null && p.holders <= 3],
        ["syb50×3t",p => p.sybil != null && p.sybil >= 50],   // + 持续3tick
        ["top1≥50×3t",p => p.top1 != null && p.top1 >= 50],  // + 持续3tick
        ["syb50∧h<0.6h0", p => p.sybil != null && p.sybil >= 50 && p.holders != null && p.holders < after[0].holders * 0.6],
      ];
      for (const [name, fn] of ARMS) {
        const sustained = name.endsWith("×3t");
        let run = 0, firstRunStart = null, hit = null;
        for (const p of after) {
          if (fn(p)) { run++; if (run === 1) firstRunStart = p; if (!sustained || run >= 3) { hit = sustained ? firstRunStart : p; break; } }
          else run = 0;
        }
        row.arms[name] = hit ? rel(hit.price) : null;
      }
      rows.push(row);
    }
  }
  const ARM_NAMES = Object.keys(rows[0].arms);
  console.log("票             实际%  | " + ARM_NAMES.map(n=>n.padStart(10)).join(""));
  for (const r of rows) {
    console.log((r.tag+"/"+r.sym).padEnd(14), String(r.actual!=null?r.actual.toFixed(1):"?").padStart(6), "|",
      ARM_NAMES.map(n => r.arms[n] == null ? "      —   " : r.arms[n].toFixed(1).padStart(10)).join(""));
  }
  console.log("\n各臂 vs 实际净改善（未触发按实际计）:");
  for (const n of ARM_NAMES) {
    let sum = 0, nTrig = 0, kills = [], saves = [];
    for (const r of rows) {
      if (r.actual == null) continue;
      const v = r.arms[n] != null ? r.arms[n] : r.actual;
      const d = v - r.actual; sum += d;
      if (r.arms[n] != null) { nTrig++; if (d < -20) kills.push(`${r.sym}${d.toFixed(0)}`); if (d > 10) saves.push(`${r.sym}+${d.toFixed(0)}`); }
    }
    console.log(`  ${n.padEnd(15)} Σ${sum>=0?"+":""}${sum.toFixed(1)}pp  触发${nTrig}  误杀:${kills.join(",")||"无"}  止血:${saves.join(",")||"无"}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
