// 一次性探针 5（182 跑）：12 票 bt-v90 全部 BUY 信号序列
// —— ultra 量门模拟：腿 id=tradeCount 里程碑（t0a=9/t0b=12/t2-t4/N30/36/45/NL15/20/25/RL15/RL10）
// 若线=全史 tradeCount≥N，首信号被拒后正例是否有后续腿再触发（豁免非粘滞每信号重判）。
const path = require("path"); require("dotenv").config({ path: path.join(__dirname, "../../config/.env") });
const { dbManager } = require("../../src/services/dbManager.js");
const db = dbManager.getClient();

const ROWS = [
  ["0x45ec048990b80b70448cf352b7064fda47557777", "负"],
  ["0x68bb8cd436bdc8b178ab886b5a7abed5e6177777", "负"],
  ["0xc62d2dffb9567746a5c883ede552d231e3967777", "负"],
  ["0x04323e04c5f48587951c2d974b7f1b007b6e7777", "负"],
  ["0x75d5286d3ac478334fe098f015624486d7a77777", "负BEM"],
  ["0xb30f0b8a8270271989e37d6bc00e627a07637777", "中苍蝇"],
  ["0x92aac04f03278ce7ac82ba0367dbaf9686437777", "中"],
  ["0xaf7ee1418a51536b3c6da32fec678bc382197777", "中"],
  ["0x9f001e6ab28d82c3f4182618d0d72524db937777", "中"],
  ["0x32f18a98e4fc3b33013f80454faae710a6367777", "★正"],
  ["0xf485ec1d518185e73ca53164ddaa85dcfde77777", "★正"],
  ["0xc84a0ff2e7bab3d32cb6426f07855b70694f7777", "★正"],
];

(async () => {
  for (const [addr, tag] of ROWS) {
    const { data } = await db.from("strategy_signals").select("created_at,metadata")
      .eq("experiment_id", "cebf56f5-7d41-403e-9f9e-b6812a2c7127")
      .eq("token_address", addr).eq("signal_type", "BUY")
      .order("created_at", { ascending: true }).limit(50);
    console.log(`\n${tag} ${addr}`);
    for (const s of data || []) {
      const m = s.metadata || {};
      const leg = (m.signalGate || {}).legId || "?";
      const st = m.execution_status || "?";
      const cc = m.cheatCheck || {};
      const ex = cc.exempt ? `${cc.exempt.code}(${cc.exempt.originalGrade})` : (cc.grade || (cc.status ? `st:${cc.status}` : "?"));
      const bp = (m.buyPoint || {}).result || (m.buyPoint || {}).status || "?";
      const fr = m.factors || m.factorResults || {};
      const tc = fr.tradeCount !== undefined ? fr.tradeCount : ((m.buyPoint || {}).anchors || {}).tradeCount ?? "?";
      const hnt = ((m.buyPoint || {}).anchors || {}).holdersNow ?? "";
      console.log(`  ${String(s.created_at).slice(11, 19)} leg=${leg} exec=${st} cheat=${ex} bp=${bp} tc=${tc} h=${hnt}`);
    }
    if (!data?.length) console.log("  （无 BUY 信号）");
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e); process.exit(1); });
