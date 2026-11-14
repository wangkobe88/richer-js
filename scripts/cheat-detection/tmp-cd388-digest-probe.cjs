// 一次性探针 2（182 跑）：bt-v90 activity_ultra 12 票首判定 cheat_detection 行 digest 数值锚
// —— CD388 ultra 量门定线：找「长期交易量」维度（fullAnchorTickCount/anchorSellCount/
// 活跃度数值族）在正例（c84a0ff2/32f18a98/f485ec1d）vs 负例（亏损 Top5）的分离度。
const path = require("path"); require("dotenv").config({ path: path.join(__dirname, "../../config/.env") });
const { dbManager } = require("../../src/services/dbManager.js");
const db = dbManager.getClient();

const POS = new Set([
  "0xc84a0ff2e7bab3d32cb6426f07855b70694f7777",
  "0x32f18a98e4fc3b33013f80454faae710a6367777",
  "0xf485ec1d518185e73ca53164ddaa85dcfde77777",
]);
// bt-v90 首成交信号时刻（超探针 1 输出；cheat 判定行 created_at<=信号 取最近）
const ANCHORS = [
  ["0x45ec048990b80b70448cf352b7064fda47557777", "2026-11-05T04:52:06", -0.0948],
  ["0x68bb8cd436bdc8b178ab886b5a7abed5e6177777", "2026-11-05T05:09:21", -0.0740],
  ["0xc62d2dffb9567746a5c883ede552d231e3967777", "2026-11-05T12:32:06", -0.0660],
  ["0x04323e04c5f48587951c2d974b7f1b007b6e7777", "2026-11-05T05:09:22", -0.0634],
  ["0x75d5286d3ac478334fe098f015624486d7a77777", "2026-11-05T07:03:49", -0.0614],
  ["0xb30f0b8a8270271989e37d6bc00e627a07637777", "2026-11-05T05:10:06", 0],
  ["0x92aac04f03278ce7ac82ba0367dbaf9686437777", "2026-11-05T05:10:23", 0],
  ["0xaf7ee1418a51536b3c6da32fec678bc382197777", "2026-11-05T07:22:44", 0],
  ["0x9f001e6ab28d82c3f4182618d0d72524db937777", "2026-11-05T08:56:46", 0],
  ["0x32f18a98e4fc3b33013f80454faae710a6367777", "2026-11-05T07:06:19", +0.1592],
  ["0xf485ec1d518185e73ca53164ddaa85dcfde77777", "2026-11-05T09:07:00", 0],
  ["0xc84a0ff2e7bab3d32cb6426f07855b70694f7777", "2026-11-05T12:31:24", +0.4023],
];

(async () => {
  for (const [addr, at, net] of ANCHORS) {
    const { data } = await db.from("cheat_detection")
      .select("created_at,digest,grade")
      .eq("token_address", addr)
      .lte("created_at", at)
      .order("created_at", { ascending: false })
      .limit(1);
    if (!data?.length) { console.log(`${addr.slice(0, 10)} 无判定行`); continue; }
    const d = data[0].digest || {};
    const tag = POS.has(addr) ? "★正例" : "  负例";
    console.log(`\n${tag} ${addr.slice(0, 10)} @${String(data[0].created_at).slice(11, 19)} grade=${data[0].grade} net=${net.toFixed(4)}`);
    console.log(`  digest.keys: ${Object.keys(d).join(",")}`);
    const an = d.anchors || {};
    console.log(`  anchors: ${JSON.stringify(an).slice(0, 600)}`);
    const act = d.activity || d.activityNumerics || null;
    if (act) console.log(`  activity数值: ${JSON.stringify(act)}`);
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e); process.exit(1); });
