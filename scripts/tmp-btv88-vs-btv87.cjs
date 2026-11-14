// bt-v88（+BP53 ④ultra router 豁免）vs bt-v87（BP50 基线）对照 —— 182 跑
// 在 tmp-btv85-vs-btv84 基础上加：BP 门 exempt 分布（ultra_router_entry 放行面）+
// v88 独有成交票的 BP53 痕迹核对
const path = require("path"); require("dotenv").config({ path: path.join(__dirname, "../config/.env") });
const { dbManager } = require("../src/services/dbManager.js");
const db = dbManager.getClient();
const LEGN = { buy_0_1: "t0a", buy_1_2: "t0b", buy_2_3: "t2", buy_3_4: "t3", buy_4_5: "t4", buy_5_6: "N30", buy_6_7: "N36", buy_7_8: "N45", buy_8_9: "NL15", buy_9_10: "NL20", buy_10_11: "NL25", buy_11_12: "RL15", buy_12_13: "RL10" };
async function run(EXP, label) {
  const sigs = []; let cur = "";
  for (let p = 0; p < 40; p++) {
    let q = db.from("strategy_signals").select("created_at,token_address,metadata")
      .eq("experiment_id", EXP).eq("signal_type", "BUY").order("created_at", { ascending: true }).limit(1000);
    if (cur) q = q.gt("created_at", cur);
    const { data } = await q; if (!data?.length) break;
    sigs.push(...data); cur = data[data.length - 1].created_at; if (data.length < 1000) break;
  }
  const { data: trades } = await db.from("trades")
    .select("token_address,trade_direction,input_currency,input_amount,output_currency,output_amount,success")
    .eq("experiment_id", EXP).limit(3000);
  const by = {}; let grossBuy = 0, grossSell = 0;
  for (const t of trades || []) {
    if (t.success === false) continue;
    by[t.token_address] = by[t.token_address] || { buy: 0, sell: 0 };
    if (t.trade_direction === "buy") { const v = t.input_currency === "BNB" ? Number(t.input_amount || 0) : t.output_currency === "BNB" ? Number(t.output_amount || 0) : 0; by[t.token_address].buy += v; grossBuy += v; }
    else { const v = t.output_currency === "BNB" ? Number(t.output_amount || 0) : t.input_currency === "BNB" ? Number(t.input_amount || 0) : 0; by[t.token_address].sell += v; grossSell += v; }
  }
  const funnel = { signals: sigs.length, executed: 0, cheatReject: {}, legs: {}, cheatExempt: {}, bpExempt: {}, bpRule: {}, resetRej: 0 };
  const execTokens = new Set();
  const bpExemptRows = []; // exempt=ultra_router_entry 明细
  for (const s of sigs) {
    const m = s.metadata || {};
    const sg = m.signalGate || {};
    const leg = LEGN[sg.legId] || sg.legId || "-";
    if (m.execution_status === "executed") { funnel.executed++; funnel.legs[leg] = (funnel.legs[leg] || 0) + 1; execTokens.add(s.token_address); }
    else {
      const cc = m.cheatCheck || {}; const bp = m.buyPoint || {};
      let dom = "other:" + (m.execution_status || sg.status || "?");
      if (cc.status === "cheat") dom = "cheat:" + (cc.gradeReasons && cc.gradeReasons[0]) || "cheat";
      else if (cc.status === "unhealthy") dom = "cheat:unhealthy";
      else if (cc.status === "reset_insufficient_ticks") { dom = "cheat:reset_insufficient"; funnel.resetRej++; }
      else if (bp.rule) dom = "bp:" + bp.rule;
      funnel.cheatReject[dom] = (funnel.cheatReject[dom] || 0) + 1;
    }
    const ccx = (m.cheatCheck || {}).exempt;
    if (ccx) funnel.cheatExempt[ccx.code || "?"] = (funnel.cheatExempt[ccx.code || "?"] || 0) + 1;
    const bpa = (m.buyPoint || {}).assessment;
    if (bpa && bpa.rule) funnel.bpRule[bpa.rule] = (funnel.bpRule[bpa.rule] || 0) + 1;
    if (bpa && bpa.exempt) {
      funnel.bpExempt[bpa.exempt.code || "?"] = (funnel.bpExempt[bpa.exempt.code || "?"] || 0) + 1;
      if (bpa.exempt.code === "ultra_router_entry") bpExemptRows.push({ t: s.token_address, at: s.created_at, leg, exec: m.execution_status === "executed", rule: bpa.rule, router: bpa.exempt.routerBuyPct60 });
    }
  }
  let open = 0;
  for (const [addr, v] of Object.entries(by)) { if (Math.abs(v.buy) > 1e-12 && v.sell < v.buy * 0.999) open++; }
  const net = grossSell - grossBuy;
  console.log(`\n===== ${label} =====`);
  console.log(`BUY 信号 ${funnel.signals} | 成交 ${funnel.executed}（成交票 ${execTokens.size}）| 净盈亏 ${net >= 0 ? "+" : ""}${net.toFixed(4)} BNB | 买 ${grossBuy.toFixed(4)} / 卖 ${grossSell.toFixed(4)} | 未平仓票 ${open}（残值不计）`);
  console.log("成交腿分布:", JSON.stringify(funnel.legs));
  console.log("拒因分布:", JSON.stringify(funnel.cheatReject));
  console.log("cheat 豁免通道:", JSON.stringify(funnel.cheatExempt));
  console.log("BP 综合规则分布:", JSON.stringify(funnel.bpRule));
  console.log("BP exempt 分布:", JSON.stringify(funnel.bpExempt));
  if (bpExemptRows.length) {
    console.log("ultra_router_entry 明细（BP53 放行面）:");
    for (const r of bpExemptRows) console.log(`  ${r.t.slice(0, 10)} ${String(r.at).slice(11, 19)} ${r.leg} router=${r.router} ${r.exec ? "→成交" : "→拒(" + r.rule + ")"}`);
  }
  const rows = Object.entries(by).map(([a, v]) => ({ a, net: v.sell - v.buy })).sort((x, y) => y.net - x.net);
  console.log("Top5 盈利:", rows.slice(0, 5).map(r => `${r.a.slice(0, 10)}:${r.net >= 0 ? "+" : ""}${r.net.toFixed(4)}`).join(" "));
  console.log("Top5 亏损:", rows.slice(-5).reverse().map(r => `${r.a.slice(0, 10)}:${r.net >= 0 ? "+" : ""}${r.net.toFixed(4)}`).join(" "));
  return { net, executed: funnel.executed, tokens: execTokens, by };
}
(async () => {
  const a = await run(process.argv[2], "新(88) " + process.argv[2].slice(0, 8));
  const b = await run(process.argv[3], "旧(87) " + process.argv[3].slice(0, 8));
  const onlyA = [...a.tokens].filter(t => !b.tokens.has(t));
  const onlyB = [...b.tokens].filter(t => !a.tokens.has(t));
  console.log(`\n===== 成交票差集 =====`);
  console.log(`新独有成交 ${onlyA.length}:`, onlyA.map(t => `${t.slice(0, 10)}:${(a.by[t].sell - a.by[t].buy).toFixed(4)}`).join(" "));
  console.log(`旧独有成交 ${onlyB.length}:`, onlyB.map(t => `${t.slice(0, 10)}:${(b.by[t].sell - b.by[t].buy).toFixed(4)}`).join(" "));
  process.exit(0);
})().catch(e => { console.error("FATAL", e.message); process.exit(1); });
