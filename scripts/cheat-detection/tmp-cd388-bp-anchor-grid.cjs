// 一次性探针 3（182 跑）：12 票首成交信号 buyPoint.anchors 量维度对比表
// —— 找「交易量」维度在正例（c84a0ff2/32f18a98/f485ec1d）vs 亏损 Top5 的分离线。
const path = require("path"); require("dotenv").config({ path: path.join(__dirname, "../../config/.env") });
const { dbManager } = require("../../src/services/dbManager.js");
const db = dbManager.getClient();

const ROWS = [
  ["0x45ec048990b80b70448cf352b7064fda47557777", -0.0948, "负"],
  ["0x68bb8cd436bdc8b178ab886b5a7abed5e6177777", -0.0740, "负"],
  ["0xc62d2dffb9567746a5c883ede552d231e3967777", -0.0660, "负"],
  ["0x04323e04c5f48587951c2d974b7f1b007b6e7777", -0.0634, "负"],
  ["0x75d5286d3ac478334fe098f015624486d7a77777", -0.0614, "负BEM"],
  ["0xb30f0b8a8270271989e37d6bc00e627a07637777", 0, "中苍蝇"],
  ["0x92aac04f03278ce7ac82ba0367dbaf9686437777", 0, "中"],
  ["0xaf7ee1418a51536b3c6da32fec678bc382197777", 0, "中"],
  ["0x9f001e6ab28d82c3f4182618d0d72524db937777", 0, "中"],
  ["0x32f18a98e4fc3b33013f80454faae710a6367777", +0.1592, "★正"],
  ["0xf485ec1d518185e73ca53164ddaa85dcfde77777", 0, "★正"],
  ["0xc84a0ff2e7bab3d32cb6426f07855b70694f7777", +0.4023, "★正"],
];
const K = ["tokenAgeSec", "actTickCount", "actSpanSec", "win30TicksPerMin", "win30BuyBnb", "burst5BuyBnb", "actBuyMedianBnb", "routerBuyPct60", "win30Buyers", "holdersNow", "openSegBigBuyN", "openSegBigBuyBnb", "win30SellBnb", "chipBuyersTotal"];

(async () => {
  const out = [];
  for (const [addr, net, tag] of ROWS) {
    const { data } = await db.from("strategy_signals").select("created_at,metadata")
      .eq("experiment_id", "cebf56f5-7d41-403e-9f9e-b6812a2c7127")
      .eq("token_address", addr).eq("signal_type", "BUY").order("created_at").limit(1);
    const an = ((data[0]?.metadata || {}).buyPoint || {}).anchors || {};
    out.push({ tag, addr: addr.slice(0, 10), net, an });
  }
  console.log(["票", "tag", "net"].concat(K).join("\t"));
  for (const r of out) {
    console.log([r.addr, r.tag, r.net.toFixed(4)].concat(K.map(k => r.an[k] === undefined ? "?" : r.an[k])).join("\t"));
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e); process.exit(1); });
