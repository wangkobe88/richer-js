// 一次性探针 4（182 跑）：12 票买入后 5min 活跃度轨迹（分段 tick 密度+买量）
// —— 验证「负例速死/正例维持」假设，定 CD388 ultra 观察窗形状。
// 拉数形状：block_time range（cheat 服务同款可走索引）+ id 升序，内存分段。
const path = require("path"); require("dotenv").config({ path: path.join(__dirname, "../../config/.env") });
const { dbManager } = require("../../src/services/dbManager.js");
const db = dbManager.getClient();

const ROWS = [
  ["0x45ec048990b80b70448cf352b7064fda47557777", "2026-11-05T04:52:06", -0.0948, "负"],
  ["0x68bb8cd436bdc8b178ab886b5a7abed5e6177777", "2026-11-05T05:09:21", -0.0740, "负"],
  ["0xc62d2dffb9567746a5c883ede552d231e3967777", "2026-11-05T12:32:06", -0.0660, "负"],
  ["0x04323e04c5f48587951c2d974b7f1b007b6e7777", "2026-11-05T05:09:22", -0.0634, "负"],
  ["0x75d5286d3ac478334fe098f015624486d7a77777", "2026-11-05T07:03:49", -0.0614, "负BEM"],
  ["0xb30f0b8a8270271989e37d6bc00e627a07637777", "2026-11-05T05:10:06", 0, "中苍蝇"],
  ["0x92aac04f03278ce7ac82ba0367dbaf9686437777", "2026-11-05T05:10:23", 0, "中"],
  ["0xaf7ee1418a51536b3c6da32fec678bc382197777", "2026-11-05T07:22:44", 0, "中"],
  ["0x9f001e6ab28d82c3f4182618d0d72524db937777", "2026-11-05T08:56:46", 0, "中"],
  ["0x32f18a98e4fc3b33013f80454faae710a6367777", "2026-11-05T07:06:19", +0.1592, "★正"],
  ["0xf485ec1d518185e73ca53164ddaa85dcfde77777", "2026-11-05T09:07:00", 0, "★正"],
  ["0xc84a0ff2e7bab3d32cb6426f07855b70694f7777", "2026-11-05T12:31:24", +0.4023, "★正"],
];
const SEG = [[0, 30], [30, 60], [60, 120], [120, 300], [300, 600]];

(async () => {
  console.log(["票", "tag", "net", "前60s"].concat(SEG.map(s => `${s[0]}-${s[1]}s`), ["total", "尾密度"]).join("\t"));
  for (const [addr, at, net, tag] of ROWS) {
    const t0 = Date.parse(at);
    const from = new Date(t0 - 60e3).toISOString(), to = new Date(t0 + 600e3).toISOString();
    const rows = []; let idCur = null;
    for (let p = 0; p < 6; p++) {
      let q = db.from("wss_price_ticks").select("id,block_time,bnb_amount,trade_type")
        .eq("token_address", addr).gt("block_time", from).lte("block_time", to)
        .order("id", { ascending: true }).limit(1000);
      if (idCur) q = q.gt("id", idCur);
      const { data } = await q; if (!data?.length) break;
      rows.push(...data); idCur = data[data.length - 1].id; if (data.length < 1000) break;
    }
    // 分段：tick 数 + 买量 BNB
    const cell = (lo, hi) => {
      const a = t0 + lo * 1e3, b = t0 + hi * 1e3;
      let n = 0, buy = 0;
      for (const r of rows) { const ts = Date.parse(r.block_time); if (ts >= a && ts < b) { n++; if (r.trade_type === "buy") buy += Number(r.bnb_amount || 0); } }
      return `${n}t/${buy.toFixed(1)}b`;
    };
    const pre = cell(-60, 0);
    const cells = SEG.map(s => cell(s[0], s[1]));
    const last300 = rows.filter(r => Date.parse(r.block_time) >= t0 + 300e3).length;
    console.log([addr.slice(0, 10), tag, net.toFixed(4), pre].concat(cells, [`${rows.length}r`, last300]).join("\t"));
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e); process.exit(1); });
