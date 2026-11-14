// 一次性探针（182 跑）：bt-v90 全部豁免信号 通道×originalGrade 二维效果矩阵
// —— CD388 只收紧 ultra∧cheat；本探针看其它格子（high∧cheat / high∧unhealthy /
//    ultra∧unhealthy / stall_burst∧cheat / stall_burst∧unhealthy）各自盈亏效果。
// 盈亏口径=bt-v90 trades per-token 净额（Σ卖出 bnb − Σ买入 bnb，与 CD388 定线同源）。
const path = require("path"); require("dotenv").config({ path: path.join(__dirname, "../../config/.env") });
const { dbManager } = require("../../src/services/dbManager.js");
const db = dbManager.getClient();
const EXP = "cebf56f5-7d41-403e-9f9e-b6812a2c7127"; // bt-v90

(async () => {
  // 0) trades 列名先验（182 大表坑：列名先验再查）
  const { data: t0 } = await db.from("trades").select("*").eq("experiment_id", EXP).limit(1);
  const tkeys = Object.keys(t0[0] || {});
  if (!tkeys.includes("trade_direction") || !tkeys.includes("input_amount") || !tkeys.includes("output_amount")) {
    throw new Error(`列名不符（keys=${tkeys.join(",")}）`);
  }
  console.log(`trades 列 OK（keys=${tkeys.join(",")}）`);

  // 1) 豁免信号（metadata->cheatCheck->exempt 非空）分页拉
  const rows = [];
  let idCur = null;
  for (let p = 0; p < 40; p++) {
    let q = db.from("strategy_signals")
      .select("id,token_address,created_at,metadata->cheatCheck->exempt,metadata->execution_status")
      .eq("experiment_id", EXP).eq("signal_type", "BUY")
      .not("metadata->cheatCheck->exempt", "is", null)
      .order("id", { ascending: true }).limit(500);
    if (idCur) q = q.gt("id", idCur);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data); idCur = data[data.length - 1].id;
    if (data.length < 500) break;
  }
  console.log(`豁免 BUY 信号=${rows.length}`);

  // 2) per-token 净盈亏：buy 支出=input_amount（BNB）、sell 收入=output_amount（BNB）
  const netBy = new Map();
  {
    const tr = []; idCur = null;
    for (let p = 0; p < 40; p++) {
      let q = db.from("trades").select("id,token_address,trade_direction,input_amount,output_amount")
        .eq("experiment_id", EXP).order("id", { ascending: true }).limit(1000);
      if (idCur) q = q.gt("id", idCur);
      const { data, error } = await q;
      if (error) throw error;
      if (!data?.length) break;
      tr.push(...data); idCur = data[data.length - 1].id;
      if (data.length < 1000) break;
    }
    for (const t of tr) {
      const d = String(t.trade_direction).toLowerCase();
      const delta = d === "sell" ? Number(t.output_amount || 0) : -Number(t.input_amount || 0);
      netBy.set(t.token_address, (netBy.get(t.token_address) || 0) + delta);
    }
    console.log(`trades 行=${tr.length} token 数=${netBy.size}（已成交票）`);
  }

  // 3) 组矩阵：per (token, code, grade) 取形状（同 token 多形状分别计；同形状多信号只计票一次，信号数另记）
  const cell = new Map(); // key=code|grade → {sigs, tokens:Set, netSum, pos, neg, flat, detail:[]}
  const perToken = new Map(); // token → Set(code|grade)
  for (const r of rows) {
    const ex = r["exempt"] || (r.metadata && r.metadata.exempt) || null;
    if (!ex || !ex.code) continue;
    const key = `${ex.code}|${ex.originalGrade}`;
    if (!perToken.has(r.token_address)) perToken.set(r.token_address, new Set());
    const first = !perToken.get(r.token_address).has(key);
    perToken.get(r.token_address).add(key);
    if (!cell.has(key)) cell.set(key, { sigs: 0, tokens: new Set(), netSum: 0, pos: 0, neg: 0, flat: 0, detail: [] });
    const c = cell.get(key);
    c.sigs++;
    if (first) {
      c.tokens.add(r.token_address);
      const net = netBy.get(r.token_address);
      if (net === undefined) { c.detail.push([r.token_address, null]); }
      else { c.netSum += net; net > 0 ? c.pos++ : (net < 0 ? c.neg++ : c.flat++); c.detail.push([r.token_address, net]); }
    }
  }

  // 4) 输出
  console.log("\n== 通道×originalGrade 矩阵（票级净额；未成交=豁免后 BP 拒/腿未触发）==");
  console.log(["格子", "信号", "票数", "成交", "净额Σ", "正/平/负"].join("\t"));
  for (const [key, c] of [...cell.entries()].sort()) {
    const traded = c.pos + c.neg + c.flat;
    console.log([key, c.sigs, c.tokens.size, traded, c.netSum.toFixed(4), `${c.pos}/${c.flat}/${c.neg}`].join("\t"));
  }
  console.log("\n== 明细（每格全部票）==");
  for (const [key, c] of [...cell.entries()].sort()) {
    console.log(`\n[${key}]`);
    for (const [addr, net] of c.detail.sort((a, b) => (b[1] ?? -9) - (a[1] ?? -9))) {
      console.log(`  ${addr} ${net === null ? "未成交" : net.toFixed(4)}`);
    }
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e); process.exit(1); });
