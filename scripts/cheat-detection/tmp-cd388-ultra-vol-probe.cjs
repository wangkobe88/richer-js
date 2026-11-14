// 一次性探针（182 跑）：bt-v90 activity_ultra 12 票首成交信号锚的量维度分布
// —— CD388 候选「ultra 豁免须长期交易后依然维持超高活跃度」交易量门槛定线用。
// 正例（必须能买）=c84a0ff2/32f18a98/f485ec1d；负例=亏损 Top5；其余=中间带观察。
const path = require("path"); require("dotenv").config({ path: path.join(__dirname, "../../config/.env") });
const { dbManager } = require("../../src/services/dbManager.js");
const db = dbManager.getClient();

const POS = new Set([
  "0xc84a0ff2e7bab3d32cb6426f07855b70694f7777",
  "0x32f18a98e4fc3b33013f80454faae710a6367777",
  "0xf485ec1d518185e73ca53164ddaa85dcfde77777",
]);
const NET = {}; // addr → 净额（对照参考，硬编码自 report）

(async () => {
  const sigs = []; let cur = "";
  for (let p = 0; p < 40; p++) {
    let q = db.from("strategy_signals").select("created_at,token_address,metadata")
      .eq("experiment_id", "cebf56f5-7d41-403e-9f9e-b6812a2c7127").eq("signal_type", "BUY")
      .order("created_at", { ascending: true }).limit(1000);
    if (cur) q = q.gt("created_at", cur);
    const { data } = await q; if (!data?.length) break;
    sigs.push(...data); cur = data[data.length - 1].created_at; if (data.length < 1000) break;
  }
  const seen = new Set();
  for (const s of sigs) {
    const m = s.metadata || {};
    if (m.execution_status !== "executed") continue;
    const cc = m.cheatCheck || {};
    if (((cc.exempt || {}).code) !== "activity_ultra") continue;
    if (seen.has(s.token_address)) continue;
    seen.add(s.token_address);
    const tag = POS.has(s.token_address) ? "★正例" : "  负例";
    const an = cc.anchors || cc.digest?.anchors || {};
    const lv = cc.levels || {};
    const bk = cc.buckets || {};
    const bpa = ((m.buyPoint || {}).anchors) || {};
    const sg = m.signalGate || {};
    console.log(`\n${tag} ${s.token_address.slice(0, 10)} @${String(s.created_at).slice(11, 19)} leg=${sg.legId} originalGrade=${(cc.exempt || {}).originalGrade}`);
    console.log(`  cheat.anchors: ${JSON.stringify(an).slice(0, 400)}`);
    console.log(`  cheat.levels: ${JSON.stringify(lv).slice(0, 300)}`);
    console.log(`  bp.anchors: tickCount=${bpa.anchorTickCount} curVs=${bpa.currentVsLaunchPct} spanSec=${bpa.spanSec} tickCnt2=${bpa.tickCount}`);
    // 快照因子表里若有 tradeCount/buyVolumeBnb 一并采（signalGate 触发条件值）
    const fr = m.factors || m.factorResults || m.preBuyCheckFactors || null;
    if (fr && typeof fr === "object") {
      const keys = ["tradeCount", "buyVolumeBnb", "holdersExDust", "currentVsLaunchPct", "actTrades"];
      const pick = {}; for (const k of keys) if (fr[k] !== undefined) pick[k] = fr[k];
      console.log(`  factors.pick: ${JSON.stringify(pick)}`);
    }
    if (Object.keys(bk).length) console.log(`  buckets: ${JSON.stringify(bk).slice(0, 200)}`);
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e); process.exit(1); });
