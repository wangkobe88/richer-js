// 一次性探针（182 跑）：CD388 生效效果模拟 + high∧cheat 推广增量——全部以 bt-v90
// (cebf56f5) 生产 metadata 为准（旧判定重放，无 Jev 重判方差）。
// 口径：per 成交票，全部 BUY 信号按时间序重放——
//   新门放行 = cheat 段 assessed∧healthy（豁免变形照放，收紧域除外）/ timeout fail-open / 无段
//   收紧域（现行 CD388）= exempt.code=activity_ultra ∧ originalGrade=cheat → 拒
//   收紧域（推广臂）= 额外 exempt.code=activity_high ∧ originalGrade=cheat → 拒
//   BP 段沿用旧跑结果（buyPoint.result∈{neutral,good}）——BT 门不受 CD388 影响
//   模拟首过信号 vs 旧 executed 信号：不变 / 丢票 / 买点推延（净额按原值近似并标注）
const path = require("path"); require("dotenv").config({ path: path.join(__dirname, "../../config/.env") });
const { dbManager } = require("../../src/services/dbManager.js");
const db = dbManager.getClient();
const EXP = "cebf56f5-7d41-403e-9f9e-b6812a2c7127"; // bt-v90

const cheatPassNew = (cc, denyHigh) => {
  if (!cc) return true;                       // 无段=门没跑（理论不发生，保守放行）
  if (cc.status && cc.status !== "assessed") return cc.status === "timeout"; // timeout fail-open；insufficient/reset_insufficient/fail=拒
  const g = cc.grade;
  if (g === "healthy") {
    const ex = cc.exempt;
    if (!ex) return true;                     // 直过
    if (ex.code === "activity_ultra" && ex.originalGrade === "cheat") return false; // CD388
    if (denyHigh && ex.code === "activity_high" && ex.originalGrade === "cheat") return false; // 推广臂
    return true;
  }
  return false;                               // cheat/unhealthy 无豁免=拒
};
const bpPass = (bp) => !bp || ["neutral", "good"].includes(bp.result) || ["neutral", "good"].includes(bp.status);

(async () => {
  // 1) 全部 BUY 信号分页（只取判定所需列）
  const sigs = []; let idCur = null;
  for (let p = 0; p < 60; p++) {
    let q = db.from("strategy_signals")
      .select("id,token_address,created_at,metadata->execution_status,metadata->cheatCheck,metadata->buyPoint")
      .eq("experiment_id", EXP).eq("signal_type", "BUY")
      .order("id", { ascending: true }).limit(500);
    if (idCur) q = q.gt("id", idCur);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    sigs.push(...data); idCur = data[data.length - 1].id;
    if (data.length < 500) break;
  }
  console.log(`BUY 信号=${sigs.length}`);

  // 2) per-token 净盈亏
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
      const delta = String(t.trade_direction).toLowerCase() === "sell" ? Number(t.output_amount || 0) : -Number(t.input_amount || 0);
      netBy.set(t.token_address, (netBy.get(t.token_address) || 0) + delta);
    }
  }

  // 3) 按票分组、找旧 executed 锚
  const byToken = new Map();
  for (const s of sigs) {
    if (!byToken.has(s.token_address)) byToken.set(s.token_address, []);
    byToken.get(s.token_address).push(s);
  }
  const tokens = [...netBy.keys()]; // 65 成交票
  const scenarios = [
    ["现行 CD388（ultra∧cheat 拒）", false],
    ["推广臂（+high∧cheat 拒）", true],
  ];
  for (const [label, denyHigh] of scenarios) {
    console.log(`\n===== ${label} =====`);
    let keep = 0, lostList = [], delayList = [];
    for (const addr of tokens) {
      const list = (byToken.get(addr) || []).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      const oldExec = list.find((s) => s["execution_status"] === "executed");
      const firstPass = list.find((s) => cheatPassNew(s["cheatCheck"], denyHigh) && bpPass(s["buyPoint"]));
      const net = netBy.get(addr) || 0;
      if (!oldExec) { keep++; continue; }        // 旧跑未从 BUY 信号成交（手工/异常），不动
      if (firstPass && firstPass.id === oldExec.id) keep++;
      else if (firstPass) delayList.push([addr, net, String(oldExec.created_at).slice(11, 19), String(firstPass.created_at).slice(11, 19)]);
      else lostList.push([addr, net]);
    }
    const lostNet = lostList.reduce((a, [, n]) => a + n, 0);
    console.log(`保住（不变）=${keep} / 丢票=${lostList.length}（净额 ${lostNet.toFixed(4)}：负票收回 ${lostList.filter((x) => x[1] < 0).reduce((a, [, n]) => a + n, 0).toFixed(4)}，正票放弃 ${lostList.filter((x) => x[1] > 0).reduce((a, [, n]) => a + n, 0).toFixed(4)}）/ 买点推延=${delayList.length}`);
    if (lostList.length) { console.log("丢票明细："); for (const [a, n] of lostList.sort((x, y) => x[1] - y[1])) console.log(`  ${a} ${n.toFixed(4)}`); }
    if (delayList.length) { console.log("推延明细（净额按原买点近似）："); for (const [a, n, o, w] of delayList) console.log(`  ${a} ${n.toFixed(4)} ${o}→${w}`); }
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e); process.exit(1); });
