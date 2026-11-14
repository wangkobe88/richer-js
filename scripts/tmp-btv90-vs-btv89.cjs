// bt-v90（quote 盘 FL 常量锚）vs bt-v89（基线）对照 + 豁免通道×净额分组 —— 182 跑
// 重点验证：①quote 常量锚单变量变化面 ②用户观察「损失最大还是活跃度 ultra」
// —— cheat 豁免通道（activity_ultra/activity_high/stall_burst/healthy 直过）×净盈亏
const path = require("path"); require("dotenv").config({ path: path.join(__dirname, "../config/.env") });
const { dbManager } = require("../src/services/dbManager.js");
const db = dbManager.getClient();
const LEGN = { buy_0_1: "t0a", buy_1_2: "t0b", buy_2_3: "t2", buy_3_4: "t3", buy_4_5: "t4", buy_5_6: "N30", buy_6_7: "N36", buy_7_8: "N45", buy_8_9: "NL15", buy_9_10: "NL20", buy_10_11: "NL25", buy_11_12: "RL15", buy_12_13: "RL10" };
const ZHAO = '0x5793b7ead75851206529f98cfe89db54511a7777';

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
  // 首成交 BUY 信号的豁免通道 per-token 归集
  const tokExempt = {}; const tokLeg = {};
  for (const s of sigs) {
    const m = s.metadata || {};
    if (m.execution_status !== "executed") continue;
    const ccx = ((m.cheatCheck || {}).exempt || {}).code;
    if (tokExempt[s.token_address] === undefined) {
      tokExempt[s.token_address] = ccx || "healthy直过";
      tokLeg[s.token_address] = LEGN[((m.signalGate || {}).legId)] || "-";
    }
  }
  const funnel = { signals: sigs.length, executed: 0, cheatReject: {}, cheatExempt: {}, bpRule: {} };
  const execTokens = new Set();
  for (const s of sigs) {
    const m = s.metadata || {};
    if (m.execution_status === "executed") { funnel.executed++; execTokens.add(s.token_address); continue; }
    const cc = m.cheatCheck || {}; const bp = m.buyPoint || {};
    let dom = "other:" + (m.execution_status || (m.signalGate || {}).status || "?");
    if (cc.status === "cheat") dom = "cheat:" + (cc.gradeReasons && cc.gradeReasons[0] || "cheat");
    else if (cc.status === "unhealthy") dom = "cheat:unhealthy";
    else if (cc.status === "reset_insufficient_ticks") dom = "cheat:reset_insufficient";
    else if (bp.rule) dom = "bp:" + bp.rule;
    funnel.cheatReject[dom] = (funnel.cheatReject[dom] || 0) + 1;
    const ccx = (m.cheatCheck || {}).exempt;
    if (ccx) funnel.cheatExempt[ccx.code || "?"] = (funnel.cheatExempt[ccx.code || "?"] || 0) + 1;
    const bpa = (m.buyPoint || {}).assessment;
    if (bpa && bpa.rule) funnel.bpRule[bpa.rule] = (funnel.bpRule[bpa.rule] || 0) + 1;
  }
  const net = grossSell - grossBuy;
  console.log(`\n===== ${label} =====`);
  console.log(`BUY 信号 ${funnel.signals} | 成交 ${funnel.executed}（成交票 ${execTokens.size}）| 净盈亏 ${net >= 0 ? "+" : ""}${net.toFixed(4)} BNB | 买 ${grossBuy.toFixed(4)} / 卖 ${grossSell.toFixed(4)}`);
  console.log("拒因分布:", JSON.stringify(funnel.cheatReject));
  console.log("cheat 豁免通道(信号级):", JSON.stringify(funnel.cheatExempt));
  // 豁免通道 × 净盈亏（票级聚合——用户观察验证）
  const grp = {};
  for (const [addr, v] of Object.entries(by)) {
    const g = tokExempt[addr] ?? "未买(纯卖?)";
    grp[g] = grp[g] || { n: 0, net: 0 };
    grp[g].n++; grp[g].net += v.sell - v.buy;
  }
  console.log("── 豁免通道 × 净盈亏（票级）:");
  for (const [g, v] of Object.entries(grp).sort((a, b) => a[1].net - b[1].net))
    console.log(`  ${g.padEnd(14)} ${String(v.n).padStart(3)} 票  净 ${v.net >= 0 ? "+" : ""}${v.net.toFixed(4)}`);
  const rows = Object.entries(by).map(([a, v]) => ({ a, net: v.sell - v.buy, g: tokExempt[a] ?? "?", leg: tokLeg[a] ?? "?" })).sort((x, y) => x.net - y.net);
  console.log("── 亏损 Top10（带豁免通道）:");
  for (const r of rows.slice(0, 10)) console.log(`  ${r.a.slice(0, 10)} ${r.g.padEnd(13)} ${r.leg.padEnd(5)} ${r.net.toFixed(4)}`);
  console.log("── 盈利 Top5:");
  for (const r of rows.slice(-5).reverse()) console.log(`  ${r.a.slice(0, 10)} ${r.g.padEnd(13)} ${r.leg.padEnd(5)} +${r.net.toFixed(4)}`);
  return { net, executed: funnel.executed, tokens: execTokens, by };
}

(async () => {
  const a = await run(process.argv[2], "新(90) " + process.argv[2].slice(0, 8));
  const b = await run(process.argv[3], "旧(89) " + process.argv[3].slice(0, 8));
  console.log(`\n===== 成交票差集 =====`);
  const onlyA = [...a.tokens].filter(t => !b.tokens.has(t));
  const onlyB = [...b.tokens].filter(t => !a.tokens.has(t));
  console.log(`v90 独有成交 ${onlyA.length}:`, onlyA.map(t => `${t.slice(0, 10)}:${(a.by[t].sell - a.by[t].buy).toFixed(4)}`).join(" "));
  console.log(`v89 独有成交 ${onlyB.length}（quote 锚翻拒面候选）:`, onlyB.map(t => `${t.slice(0, 10)}:${(b.by[t].sell - b.by[t].buy).toFixed(4)}`).join(" "));
  // 赵公主专项
  for (const [tag, exp] of [["v90", process.argv[2]], ["v89", process.argv[3]]]) {
    const { data: zs } = await db.from("strategy_signals").select("created_at,metadata")
      .eq("experiment_id", exp).eq("token_address", ZHAO).eq("signal_type", "BUY").limit(3);
    const zt = await db.from("trades").select("trade_direction,input_amount,output_currency,output_amount,success")
      .eq("experiment_id", exp).eq("token_address", ZHAO).limit(5);
    const ztOk = (zt.data || []).filter(t => t.success !== false);
    console.log(`赵公主 ${tag}: BUY信号=${zs?.length || 0} 成交=${ztOk.length}` +
      (zs && zs[0] ? ` 首信号=${String(zs[0].created_at).slice(11, 19)} exec=${zs[0].metadata?.execution_status} bp=${JSON.stringify((zs[0].metadata?.buyPoint || {}).assessment || {}).slice(0, 160)}` : ""));
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e); process.exit(1); });
