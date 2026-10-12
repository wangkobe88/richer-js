/**
 * SameNarrativeLeaderService 增量缓存单测（2026-10-12 回测性能案 P3a + P3d）
 *
 * 零 DB 零网络：mock supabase 链式打桩（from/select/eq/neq/gte/lte/in/order/limit/range，
 * await thenable 触发执行），内存数据集过滤。七节：
 *  A 基线全量语义（对照原版）：首价/峰值/首达/truncated/尘门/outlier 服务端过滤
 *  B 三实例 bit-identical 对拍（全量 / 逐候选增量 / P3d 批量聚合）：同数据同
 *    checkTime 序列逐字段对拍（含 firstTickAt/firstReachAt/peakMultiple/inWindow/truncated）
 *  C 增量查询形状：逐候选增量第二次 check 每候选 1 次增量；P3d 批量聚合第二次
 *    check 全组仅 1 次 .in 查询；hardDone（首达/封顶）后零查询
 *  D 候选集缓存 L1：同 tweet 二次 check 零候选查询；使用点排除自身
 *  E checkTime 倒退 → 弃缓存全量重算（warn）
 *  F 火窗语义：首达后 24h 内 hot=1，窗外 hot=0（增量纯函数路径）
 *  G 失败自愈：首查失败候选（无 state）在聚合 check 中走 needInit 全量首查，
 *    终态与全量实例 bit 一致；跨 tweet 状态复用（候选级 state 不回退）
 */

'use strict';

const { SameNarrativeLeaderService } = require('../src/trading-engine/pre-check/SameNarrativeLeaderService');

let passed = 0, failed = 0;
function ok(cond, label, detail) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}${detail ? ` | ${detail}` : ''}`); }
}
const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };
const warnLogger = { info() {}, error() {}, debug() {}, warn: (...a) => warnCalls.push(a) };
let warnCalls = [];

// ═══════════ mock supabase（链式打桩 + 内存过滤）═══════════
// rows.wssPriceTicks: [{token_address, price_bnb, bnb_amount, block_time(ISO), log_index, price_outlier}]
// rows.experimentTokens: [{token_address, token_symbol, discovered_at(ISO), narrative_material_id}]
function mkSupabase(rows, counters) {
  const builder = (table) => {
    const state = { table, conds: [], orders: [], range: null, limitN: null };
    const b = {
      select: (cols) => { state.cols = cols; return b; },
      eq: (k, v) => { state.conds.push([k, 'eq', v]); return b; },
      neq: (k, v) => { state.conds.push([k, 'neq', v]); return b; },
      gte: (k, v) => { state.conds.push([k, 'gte', v]); return b; },
      lte: (k, v) => { state.conds.push([k, 'lte', v]); return b; },
      in: (k, arr) => { state.conds.push([k, 'in', arr]); return b; },
      order: (k, o) => { state.orders.push([k, !o || o.ascending]); return b; },
      limit: (n) => { state.limitN = n; return b; },
      range: (from, to) => { state.range = [from, to]; return b; },
    };
    b.then = (resolve) => resolve(exec(state));
    return b;
  };
  function exec(state) {
    if (counters) counters.queries.push(state);
    // 可选失败注入：rows.failTokens = { addr: 剩余失败次数 }——对单候选地址查询抛错
    if (rows.failTokens && state.table === 'wss_price_ticks') {
      const addrCond = state.conds.find(([k, op]) => k === 'token_address' && op === 'eq');
      if (addrCond && rows.failTokens[addrCond[2]] > 0) {
        rows.failTokens[addrCond[2]]--;
        return { data: null, error: { message: 'mock 注入失败' } };
      }
    }
    // 可选失败注入：rows.failBatchAt = N——第 N 次 P3d 批量 .in 查询抛错（计次式，
    // 可造「页 0 成功页 1 失败」的中途页失败形状）
    if (rows.failBatchAt != null && state.table === 'wss_price_ticks'
      && state.conds.some(([k, op]) => k === 'token_address' && op === 'in')) {
      rows._inCount = (rows._inCount || 0) + 1;
      if (rows.failBatchAt === rows._inCount) {
        return { data: null, error: { message: 'mock 批量注入失败' } };
      }
    }
    let data = state.table === 'wss_price_ticks' ? rows.wssPriceTicks : rows.experimentTokens;
    for (const [k, op, v] of state.conds) {
      data = data.filter(r => {
        const rv = r[k];
        if (op === 'eq') return String(rv) === String(v);
        if (op === 'neq') return String(rv) !== String(v);
        if (op === 'in') return v.map(String).includes(String(rv));
        if (op === 'gte') return rv != null && rv >= v;
        if (op === 'lte') return rv != null && rv <= v;
        return true;
      });
    }
    for (const [k, asc] of [...state.orders].reverse()) {
      data = [...data].sort((x, y) => {
        const c = x[k] < y[k] ? -1 : (x[k] > y[k] ? 1 : 0);
        return asc ? c : -c;
      });
    }
    if (state.limitN != null) data = data.slice(0, state.limitN);
    if (state.range) data = data.slice(state.range[0], state.range[1] + 1);
    // 列裁剪（对齐 PostgREST select 语义：select 什么返回什么）。首查 select 3 字段
    // 不含 log_index → wmIdx 伪 0 是真实 DB 口径——I5 剥离防线断言依赖此形状
    // （mock 全行返回会把 DB 版也变成 log_index 真值 = 防线测不到）
    if (state.cols) {
      const keys = state.cols.split(',').map(s => s.trim());
      data = data.map(r => Object.fromEntries(keys.map(k => [k, r[k]])));
    }
    return { data: JSON.parse(JSON.stringify(data)), error: null };
  }
  return { from: builder };
}

// ISO 时间工厂
const T = (sec) => new Date(sec * 1000).toISOString();
// tick 行工厂
const tick = (addr, sec, price, bnb, logIdx, outlier) => ({
  token_address: addr, block_time: T(sec), log_index: logIdx ?? 0,
  price_bnb: String(price), bnb_amount: String(bnb), price_outlier: !!outlier,
});

const SELF = '0xself0000000000000000000000000000000000001';
const CAND_A = '0xcand00000000000000000000000000000000a1'; // 龙头：首价 1 → 峰值 6x 首达
const CAND_B = '0xcand00000000000000000000000000000000b2'; // 平庸：1 → 2x 不首达
const CAND_C = '0xcand00000000000000000000000000000000c3'; // 尘盘：全尘行
const TWEET = '21074490765100';

// 基线数据：A 5s 首价 1，300s 涨到 6（首达），500s 回落；B 缓涨 2x；C 全尘
function baseRows() {
  return {
    experimentTokens: [
      { token_address: SELF, token_symbol: 'SELF', discovered_at: T(1000), narrative_material_id: TWEET },
      { token_address: CAND_A, token_symbol: 'A', discovered_at: T(1002), narrative_material_id: TWEET },
      { token_address: CAND_B, token_symbol: 'B', discovered_at: T(1003), narrative_material_id: TWEET },
      { token_address: CAND_C, token_symbol: 'C', discovered_at: T(1004), narrative_material_id: TWEET },
      { token_address: '0xother', token_symbol: 'X', discovered_at: T(1005), narrative_material_id: '999' },
    ],
    wssPriceTicks: [
      tick(CAND_A, 5, 1, 1, 0), tick(CAND_A, 100, 2, 1, 0), tick(CAND_A, 200, 3, 1, 1),
      tick(CAND_A, 300, 6, 1, 0),   // 首达 6x @300s
      tick(CAND_A, 400, 1, 1, 1, true), // outlier 服务端已滤（mock eq 行为）
      tick(CAND_A, 500, 4, 1, 0),
      tick(CAND_B, 10, 1, 1, 0), tick(CAND_B, 150, 1.5, 1, 0), tick(CAND_B, 250, 2, 1, 0),
      tick(CAND_C, 20, 1, 0.0001, 0), tick(CAND_C, 120, 9, 0.0001, 1), // 全尘（< MIN_PRICE_UPDATE_BNB）
    ],
  };
}

// 服务工厂（数据共享同一 rows 对象——对拍实例看到同库）。mode: 'off'=全量对照 /
// 'inc'=逐候选增量（P3a） / 'agg'=增量+批量聚合（P3d，默认 true 的生产行为）
function mkSvc(rows, counters, mode, extra) {
  return new SameNarrativeLeaderService(mkSupabase(rows, counters), mode === 'off' ? noopLogger : warnLogger, {
    incrementalCache: mode !== 'off',
    ...(mode === 'inc' ? { tweetAggregate: false } : {}),
    ...extra,
  });
}

async function main() {
  // ═══ A. 基线全量语义 ═══
  console.log('A. 基线全量语义（cache off 对照）');
  {
    const rows = baseRows();
    const counters = { queries: [] };
    const svc = mkSvc(rows, counters, 'off');
    const r = await svc.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 600 });
    ok(r.success === true, 'A1. 成功');
    ok(r.factors.narrativeLeaderCount === 3, 'A2. 候选数 3（排除自身/异推文行）', `count=${r.factors.narrativeLeaderCount}`);
    ok(r.factors.narrativeLeaderHot === 1, 'A3. 首达 300s + 24h 窗内（600s 判定）→ hot=1');
    ok(r.factors.narrativeLeaderMaxMultiple === 6, 'A4. maxMultiple=6（A 峰值；outlier 行已滤）', `max=${r.factors.narrativeLeaderMaxMultiple}`);
    const leaderA = r.detail.leaders.find(l => l.tokenAddress === CAND_A);
    ok(leaderA && leaderA.firstReachAt === T(300), 'A5. A 首达时刻=300s');
    ok(!r.detail.leaders.some(l => l.tokenAddress === CAND_C), 'A6. 尘盘 C 不入 leaders（全尘无首价）');
    // 无 tweet → 空因子
    const r0 = await svc.check({ tokenAddress: SELF, sourceTweetId: null, checkTimeSec: 600 });
    ok(r0.success === false && r0.factors.narrativeLeaderHot === 0, 'A7. 无 tweet → fail-open 空');
  }

  // ═══ B. 三实例 bit-identical（全量 / 逐候选增量 / P3d 批量聚合）═══
  console.log('B. 三实例 bit-identical 对拍（同数据同 checkTime 序列）');
  {
    const rows = baseRows();
    // 追加时间上渐进的行（增量路径才有新数据可拼）
    rows.wssPriceTicks.push(tick(CAND_A, 700, 7, 1, 0));   // 7x 新峰
    rows.wssPriceTicks.push(tick(CAND_B, 350, 2.5, 1, 0)); // B 新峰（仍 <5x）
    rows.wssPriceTicks.push(tick(CAND_C, 300, 2, 5, 0));   // C 后来出现非尘行 → 有首价
    const times = [150, 310, 450, 800];
    const cOff = { queries: [] }, cInc = { queries: [] }, cAgg = { queries: [] };
    const svcOff = mkSvc(rows, cOff, 'off');
    const svcInc = mkSvc(rows, cInc, 'inc');
    const svcAgg = mkSvc(rows, cAgg, 'agg');
    for (const t of times) {
      const rOff = await svcOff.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: t });
      const rInc = await svcInc.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: t });
      const rAgg = await svcAgg.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: t });
      const strip = (r) => JSON.stringify({ f: r.factors, l: r.detail.leaders });
      ok(strip(rInc) === strip(rOff) && strip(rAgg) === strip(rOff),
        `B[${t}]. factors+leaders 三实例 bit 一致`,
        `\noff: ${strip(rOff)}\ninc: ${strip(rInc)}\nagg: ${strip(rAgg)}`);
    }
    // 最终态抽查
    const rFinal = await svcAgg.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 900 });
    ok(rFinal.factors.narrativeLeaderMaxMultiple === 7, 'B1. 终态 maxMultiple=7（700s 新峰经增量拼入）', `max=${rFinal.factors.narrativeLeaderMaxMultiple}`);
    // C 的内部增量状态直接验证（factors 不含未首达候选峰值，对拍覆盖不到）
    const cState = svcAgg._peakCache.get(CAND_C);
    ok(cState && cState.firstPrice === 2 && cState.rowCount === 3,
      'B2. C 尘行×2 + 后来非尘行 300s 增量拼接（firstPrice=2, rowCount=3）',
      `state=${cState && JSON.stringify({ f: cState.firstPrice, n: cState.rowCount })}`);
  }

  // ═══ C. 增量查询形状（逐候选增量 vs 批量聚合）═══
  console.log('C. 增量查询形状（查询次数）');
  {
    const rows = baseRows();
    const counters = { queries: [] };
    const svc = mkSvc(rows, counters, 'inc');
    await svc.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 600 });
    const q1 = counters.queries.length;
    ok(q1 === 1 + 3, 'C1. 首查 = 1 候选查询 + 3 候选 ticks 查询', `q=${q1}`);
    counters.queries.length = 0;
    await svc.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 630 });
    const tickQ2 = counters.queries.filter(q => q.table === 'wss_price_ticks').length;
    const candQ2 = counters.queries.filter(q => q.table === 'experiment_tokens').length;
    ok(candQ2 === 0, 'C2. L1 候选缓存命中 → 零候选查询', `cand=${candQ2}`);
    // A 首达但 rowCount(5) < 首达页界(2000) → 仍增量；B/C 各 1 → 共 3
    ok(tickQ2 === 3, 'C3. ticks 查询 3（A/B/C 增量各 1 次，非 3 页全量）', `ticks=${tickQ2}`);
    const gteQ = counters.queries.filter(q => q.conds.some(([k, op]) => k === 'block_time' && op === 'gte'));
    ok(gteQ.every(q => q.conds.some(([k, , v]) => k === 'block_time' && v === T(500) || v === T(250) || v === T(120))),
      'C4. 增量查询带水位 gte（B 水位 250s / C 水位 120s）');

    // P3d 批量聚合：同场景第 2 次 check 全组合并为 1 次 .in 查询
    const cAgg = { queries: [] };
    const svcAgg = mkSvc(rows, cAgg, 'agg');
    await svcAgg.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 600 });
    cAgg.queries.length = 0;
    await svcAgg.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 630 });
    const aggTick = cAgg.queries.filter(q => q.table === 'wss_price_ticks');
    const inQ = aggTick.filter(q => q.conds.some(([k, op]) => k === 'token_address' && op === 'in'));
    ok(aggTick.length === 1 && inQ.length === 1, 'C5. P3d 第 2 次 check = 1 次批量 .in 查询（非每候选 1 次）',
      `ticks=${aggTick.length} in=${inQ.length}`);
    ok(inQ[0] && inQ[0].conds.some(([k, , v]) => k === 'block_time' && v === T(600)),
      'C6. 批量查询 gte tweet 时间水位（上次 check 时刻 600s）');
    ok(inQ[0] && inQ[0].conds.some(([k, , v]) => k === 'token_address' && v.length === 3),
      'C7. 批量 .in 含全部未 hardDone 候选（A/B/C）',
      `addrs=${inQ[0] && inQ[0].conds.filter(c => c[0] === 'token_address').map(c => c[2])}`);
  }

  // ═══ D. 候选集缓存使用点排除自身 ═══
  console.log('D. L1 候选集缓存 + 排除自身');
  {
    const rows = baseRows();
    const counters = { queries: [] };
    const svc = mkSvc(rows, counters, 'agg');
    const r1 = await svc.check({ tokenAddress: CAND_A, sourceTweetId: TWEET, checkTimeSec: 600 });
    ok(r1.factors.narrativeLeaderCount === 3, 'D1. 以 A 为 self → 候选含 SELF/B/C（缓存含自身行）', `count=${r1.factors.narrativeLeaderCount}`);
    counters.queries.length = 0;
    const r2 = await svc.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 630 });
    ok(r2.factors.narrativeLeaderCount === 3, 'D2. 同 tweet 换 self=SELF → 候选 A/B/C（同缓存互切）');
    ok(counters.queries.filter(q => q.table === 'experiment_tokens').length === 0, 'D3. 二次调用零候选查询');
  }

  // ═══ E. checkTime 倒退 → 弃缓存全量 ═══
  console.log('E. checkTime 倒退防御');
  {
    const rows = baseRows();
    const counters = { queries: [] };
    warnCalls = [];
    const svc = mkSvc(rows, counters, 'agg');
    await svc.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 600 });
    counters.queries.length = 0;
    const r = await svc.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 500 });
    ok(r.success === true, 'E1. 倒退调用仍成功（全量重算）');
    ok(warnCalls.length > 0, 'E2. 倒退告警留痕');
    const tickQ = counters.queries.filter(q => q.table === 'wss_price_ticks');
    // A 全量重查（lte 500 → 4 行 1 页）；倒退后 500s 时刻 A 未回落仍 6x 峰
    ok(r.factors.narrativeLeaderMaxMultiple === 6, 'E3. 倒退到 500s → maxMultiple 回到 6（无 700s 峰）');
    ok(tickQ.length === 3, 'E4. 三候选全量重查（弃 tweet 水位 + 弃候选 state 后）', `q=${tickQ.length}`);
  }

  // ═══ F. 火窗语义 + hardDone 页界封顶（tinyConfig 快速达界）═══
  console.log('F. 火窗 24h 语义 + hardDone 页界');
  {
    // tickPageSize=2/maxTickPages=3：A 5 行，首达在处理序 3（页 1）→ max 封顶页界=4，
    // 全量首查 rowCount=4 → 立即 hardDone（此后 max 冻结 6，500s 行永不进统计=原版页 break）
    const rows = baseRows();
    const counters = { queries: [] };
    const svc = mkSvc(rows, counters, 'inc', { tickPageSize: 2, maxTickPages: 3 });
    await svc.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 86400 + 299 }); // 首达+24h-1s
    const r1 = (await svc.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 86400 + 299 })).factors;
    ok(r1.narrativeLeaderHot === 1, 'F1. 窗内最后一秒仍 hot');
    ok(r1.narrativeLeaderMaxMultiple === 6, 'F1b. max 冻结在首达页界内（500s 回落行不进 max）', `max=${r1.narrativeLeaderMaxMultiple}`);
    counters.queries.length = 0;
    const r2 = (await svc.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 86400 + 301 })).factors;
    ok(r2.narrativeLeaderHot === 0, 'F2. 窗外 → hot=0（纯函数直出）');
    ok(r2.narrativeLeaderMaxMultiple === 6, 'F3. 窗外 maxMultiple 保留观测');
    const tickQF = counters.queries.filter(q => q.table === 'wss_price_ticks');
    const qAddrs = tickQF.map(q => q.conds.find(([k, op]) => k === 'token_address' && op === 'eq')?.[2]);
    ok(tickQF.length === 2 && !qAddrs.includes(CAND_A),
      'F4. A hardDone 零查询；未达界候选 B/C 各 1 增量', `q=${JSON.stringify(qAddrs)}`);
    // P3d 聚合同场景：hardDone 排除出批量，B/C 合并为 1 次 .in（不含 A）
    const cAggF = { queries: [] };
    const svcAggF = mkSvc(rows, cAggF, 'agg', { tickPageSize: 2, maxTickPages: 3 });
    await svcAggF.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 86400 + 299 });
    cAggF.queries.length = 0;
    const rAggF = (await svcAggF.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 86400 + 301 })).factors;
    const inQF = cAggF.queries.filter(q => q.table === 'wss_price_ticks' && q.conds.some(([k, op]) => k === 'token_address' && op === 'in'));
    const inAddrs = inQF.length ? inQF[0].conds.find(([k, op]) => k === 'token_address' && op === 'in')[2] : [];
    ok(rAggF.narrativeLeaderHot === 0 && rAggF.narrativeLeaderMaxMultiple === 6,
      'F4b. 聚合路径 hardDone 语义一致（max 冻结 6 / 窗外 hot=0）',
      `hot=${rAggF.narrativeLeaderHot} max=${rAggF.narrativeLeaderMaxMultiple}`);
    ok(cAggF.queries.filter(q => q.table === 'wss_price_ticks').length === 1
      && inQF.length === 1 && !inAddrs.includes(CAND_A) && inAddrs.length === 2,
      'F4c. 聚合 = 1 次 .in 且不含 hardDone 的 A', `q=${JSON.stringify(inAddrs)}`);
    // 对照：全量实例同数据同配置，max 同为 6（页界语义与原版 break 一致）
    const svcOff = mkSvc(rows, { queries: [] }, 'off', { tickPageSize: 2, maxTickPages: 3 });
    const rOff = await svcOff.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 86400 + 301 });
    ok(rOff.factors.narrativeLeaderMaxMultiple === 6 && rOff.factors.narrativeLeaderHot === 0,
      'F5. 全量对照同结果（原版首达页 break 语义 = 增量页界封顶）');
  }

  // ═══ G. P3d 失败自愈 + 跨 tweet 状态复用 ═══
  console.log('G. P3d needInit 失败自愈 + 跨 tweet 状态复用');
  {
    const strip = (r) => JSON.stringify({ f: r.factors, l: r.detail.leaders });
    // G1-G3 首查失败 → 聚合 check 中 needInit 全量首查自愈，终态与全量实例 bit 一致
    const rows = baseRows();
    rows.wssPriceTicks.push(tick(CAND_A, 700, 7, 1, 0));
    rows.failTokens = { [CAND_B]: 1 };
    const svcAgg = mkSvc(rows, { queries: [] }, 'agg');
    const svcOff = mkSvc(rows, { queries: [] }, 'off');
    const r1 = await svcAgg.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 300 });
    ok(r1.detail.candidateErrors.length === 1, 'G1. 首查失败候选进 candidateErrors（fail-open 其余照常）',
      `errs=${JSON.stringify(r1.detail.candidateErrors)}`);
    const r2 = await svcAgg.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 800 });
    const rOff = await svcOff.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 800 });
    ok(strip(r2) === strip(rOff), 'G2. 失败自愈后（needInit 全量首查）终态与全量 bit 一致',
      `\nagg: ${strip(r2)}\noff: ${strip(rOff)}`);
    ok(r2.detail.candidateErrors.length === 0, 'G3. 自愈后无残留错误');

    // G4-G6 跨 tweet 状态复用：tweet2 候选 = 已建 state 的 A + 新 D。tweet2 首查时
    // A 的 state lastCheckSec=800（tweet1 建）→ checkTime 须 > 800 才走增量复用
    const TWEET2 = '888';
    const CAND_D = '0xcand00000000000000000000000000000000d4';
    rows.experimentTokens.push({ token_address: CAND_D, token_symbol: 'D', discovered_at: T(1006), narrative_material_id: TWEET2 });
    rows.experimentTokens.push({ token_address: CAND_A, token_symbol: 'A2', discovered_at: T(1007), narrative_material_id: TWEET2 });
    rows.wssPriceTicks.push(tick(CAND_D, 50, 1, 1, 0), tick(CAND_D, 600, 9, 1, 0)); // D 9x 首达
    const cA2 = { queries: [] }, cO2 = { queries: [] };
    const svcAgg2 = mkSvc(rows, cA2, 'agg');
    const svcOff2 = mkSvc(rows, cO2, 'off');
    await svcAgg2.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 800 }); // A/B/C 状态已建（水位 800）
    cA2.queries.length = 0;
    const t2a = await svcAgg2.check({ tokenAddress: SELF, sourceTweetId: TWEET2, checkTimeSec: 850 });
    const o2a = await svcOff2.check({ tokenAddress: SELF, sourceTweetId: TWEET2, checkTimeSec: 850 });
    ok(strip(t2a) === strip(o2a), 'G4. tweet2 首查（逐候选；A 复用跨 tweet 的既有 state 增量）与全量一致',
      `\nagg: ${strip(t2a)}\noff: ${strip(o2a)}`);
    cA2.queries.length = 0;
    const t2b = await svcAgg2.check({ tokenAddress: SELF, sourceTweetId: TWEET2, checkTimeSec: 900 });
    const o2b = await svcOff2.check({ tokenAddress: SELF, sourceTweetId: TWEET2, checkTimeSec: 900 });
    ok(strip(t2b) === strip(o2b), 'G5. tweet2 第 2 查（聚合批量）与全量一致',
      `\nagg: ${strip(t2b)}\noff: ${strip(o2b)}`);
    const inQ2 = cA2.queries.filter(q => q.table === 'wss_price_ticks' && q.conds.some(([k, op]) => k === 'token_address' && op === 'in'));
    ok(inQ2.length === 1, 'G6. tweet2 第 2 查 = 1 次批量 .in 查询', `n=${cA2.queries.filter(q => q.table === 'wss_price_ticks').length}`);
  }

  // ═══ H. P3d 批量失败自愈（tweet 水位不推进 + state 副本不残留半推进）═══
  // H1-H3 首查即失败形状：水位误推进 → r3 从 T(800) 拉起漏 620/700s 行 → max=6≠7
  // H4-H6 中途页失败形状（tinyConfig 满页翻页）：state 原地残留半推进 → 失败的
  // 那次 check 把页 0 半截首达报进 leaders（偏拦，违反 fail-open）且 r3 幂等跳过
  console.log('H. P3d 批量失败自愈（failBatchAt 计次注入）');
  {
    const strip = (r) => JSON.stringify({ f: r.factors, l: r.detail.leaders });
    const rows = baseRows();
    const svcAgg = mkSvc(rows, { queries: [] }, 'agg');
    const svcOff = mkSvc(rows, { queries: [] }, 'off');
    await svcAgg.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 600 }); // 逐候选首查建 state（A wm=500s）
    rows.wssPriceTicks.push(tick(CAND_A, 620, 6.5, 1, 0), tick(CAND_A, 700, 7, 1, 0));  // 水位后新行（模拟回放推进）
    rows.failBatchAt = 1; // 第 1 次批量 .in 查询失败
    const r2 = await svcAgg.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 800 });
    ok(r2.success === true && r2.detail.candidateErrors.length === 3,
      'H1. 批量失败 → 整批进 candidateErrors（fail-open），结果仍成功', `errs=${r2.detail.candidateErrors.length}`);
    const r3 = await svcAgg.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 900 });
    const rOff = await svcOff.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 900 });
    ok(strip(r3) === strip(rOff) && r3.factors.narrativeLeaderMaxMultiple === 7,
      'H2. 失败后下次聚合自愈无漏行（620/700s 行重新拉到，max=7 与全量 bit 一致）',
      `\nagg: ${strip(r3)}\noff: ${strip(rOff)}`);
    ok(r3.detail.candidateErrors.length === 0, 'H3. 自愈后无残留错误');
  }
  {
    // 中途页失败：tickPageSize=2 下批量页 0 = [B620, B700] 满页，页 1 查询失败。
    // B 620=5.5 首达——若 state 原地残留，r2 失败的 check 仍把 B 报进 leaders（hot 抬升）
    const strip = (r) => JSON.stringify({ f: r.factors, l: r.detail.leaders });
    const rows = baseRows();
    const svcAgg = mkSvc(rows, { queries: [] }, 'agg', { tickPageSize: 2, maxTickPages: 3 });
    const svcOff = mkSvc(rows, { queries: [] }, 'off', { tickPageSize: 2, maxTickPages: 3 });
    await svcAgg.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 600 }); // A hardDone（页界4）；B wm=150 rowCount=3
    rows.wssPriceTicks.push(tick(CAND_B, 620, 5.5, 1, 0), tick(CAND_B, 700, 6, 1, 0));  // B 首达 620s
    rows.failBatchAt = 2; // 第 1 次 .in（页 0）成功，第 2 次（页 1）失败
    const r2 = await svcAgg.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 800 });
    ok(r2.detail.candidateErrors.length === 2 && !r2.detail.leaders.some(l => l.tokenAddress === CAND_B),
      'H4. 中途页失败：整批进 errors，页 0 半截首达**不**报进 leaders（副本丢弃，fail-open 方向）',
      `errs=${r2.detail.candidateErrors.length} leaders=${JSON.stringify(r2.detail.leaders.map(l => l.tokenAddress))}`);
    const r3 = await svcAgg.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 900 });
    const rOff = await svcOff.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 900 });
    const leadB = r3.detail.leaders.find(l => l.tokenAddress === CAND_B);
    ok(strip(r3) === strip(rOff) && leadB && leadB.firstReachAt === T(620) && leadB.peakMultiple === 5.5,
      'H5. 自愈后 B 首达 620s 拼入且 cap 收紧到首达页界（peak=5.5：700s 行在页界外不进 max，与全量页 break bit 一致）',
      `\nagg: ${strip(r3)}\noff: ${strip(rOff)}`);
    ok(r3.detail.candidateErrors.length === 0, 'H6. 自愈后无残留错误');
    // 同形状走逐候选增量（非聚合）：首达在增量阶段的 cap 收紧是 _evalCandidateIncremental
    // 的 P3a 遗留缺陷本尊，同数据锁定（inc 不发 .in 查询，不受 failBatchAt 影响）
    const svcInc2 = mkSvc(rows, { queries: [] }, 'inc', { tickPageSize: 2, maxTickPages: 3 });
    await svcInc2.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 600 });
    await svcInc2.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 800 });
    const r3inc = await svcInc2.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 900 });
    const leadBinc = r3inc.detail.leaders.find(l => l.tokenAddress === CAND_B);
    ok(strip(r3inc) === strip(rOff) && leadBinc && leadBinc.peakMultiple === 5.5,
      'H7. 逐候选增量同形状 cap 收紧一致（B peak=5.5，与全量/聚合 bit 一致）',
      `\ninc: ${strip(r3inc)}\noff: ${strip(rOff)}`);
  }

  // ═══ I. P6 回放内存行源（enableReplayRowSource）对拍 ═══
  // I1-I3 全量/聚合/回放三实例同数据同序列 bit 一致 + 装载查询形状 + 装载后零
  //      wss_price_ticks DB 查询（核心性能断言）
  // I4 迟到行口径：装载后外部进程新写的行不可见（fail-open 方向，文档化）
  // I5 首查切片剥离 log_index：wmIdx 伪 0 口径 bit 保真（携带真值→增量幂等跳过分叉）
  // I6 tinyConfig 首达在增量阶段 cap 收紧 + 页切片分页跨页（pageSize=2）
  // I7 装载失败退路：warn + 整 tweet 退 DB 行源，终态与全量 bit 一致
  // I8 跨 tweet 装载：已入桶地址跳过；tweet2 首查（A 逐候选增量 idx 路径 + D 首查）零 DB
  console.log('I. P6 回放内存行源对拍');
  {
    // 场景 1：B 节同款数据全预置（历史行全在 = 回测真实形态，checkTime 推进只是虚拟时钟）
    const strip = (r) => JSON.stringify({ f: r.factors, l: r.detail.leaders });
    const rows = baseRows();
    rows.wssPriceTicks.push(tick(CAND_A, 700, 7, 1, 0));
    rows.wssPriceTicks.push(tick(CAND_B, 350, 2.5, 1, 0));
    rows.wssPriceTicks.push(tick(CAND_C, 300, 2, 5, 0));
    const cAgg = { queries: [] }, cRep = { queries: [] };
    const svcOff = mkSvc(rows, { queries: [] }, 'off');
    const svcAgg = mkSvc(rows, cAgg, 'agg');
    const svcRep = mkSvc(rows, cRep, 'agg');
    svcRep.enableReplayRowSource({ endTimeIso: T(2000) });

    const rRep150 = await svcRep.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 150 });
    const rOff150 = await svcOff.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 150 });
    ok(strip(rRep150) === strip(rOff150), 'I1a. 首查（@150）回放行源与全量 bit 一致',
      `\noff: ${strip(rOff150)}\nrep: ${strip(rRep150)}`);

    // I2 装载查询形状（@150 唯一一次 wss ticks DB 查询 = 装载；首查本身走 idx）
    const loadQs = cRep.queries.filter(q => q.table === 'wss_price_ticks');
    ok(loadQs.length === 1, 'I2a. 首查仅 1 次 wss ticks 查询（装载；首查零 DB）', `n=${loadQs.length}`);
    const inCond = loadQs[0] && loadQs[0].conds.find(([k, op]) => k === 'token_address' && op === 'in');
    ok(inCond && inCond[2].length === 4, 'I2b. 装载 .in 全候选（SELF/A/B/C 单 chunk）',
      `addrs=${JSON.stringify(inCond && inCond[2])}`);
    ok(loadQs[0].conds.some(([k, op, v]) => k === 'price_outlier' && op === 'eq' && v === false),
      'I2c. outlier 服务端过滤（对齐生产查询形状）');
    ok(loadQs[0].conds.some(([k, op, v]) => k === 'block_time' && op === 'lte' && v === T(2000)),
      'I2d. 装载上界 lte(endTimeIso)');

    cRep.queries.length = 0; cAgg.queries.length = 0;
    let allSame = true, diffDetail = '';
    for (const t of [310, 450, 800, 900]) {
      const rO = await svcOff.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: t });
      const rA = await svcAgg.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: t });
      const rR = await svcRep.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: t });
      if (strip(rO) !== strip(rR) || strip(rA) !== strip(rR)) {
        allSame = false; diffDetail = `t=${t}\noff:${strip(rO)}\nagg:${strip(rA)}\nrep:${strip(rR)}`;
      }
    }
    ok(allSame, 'I1b. 续查（310-900）三实例 bit 一致', diffDetail);
    const repTicks = cRep.queries.filter(q => q.table === 'wss_price_ticks').length;
    const aggTicks = cAgg.queries.filter(q => q.table === 'wss_price_ticks').length;
    ok(repTicks === 0 && aggTicks === 6,
      'I3. 装载后回放实例 wss_price_ticks DB 查询 = 0（DB 版 agg：@310 首查 3 eq + @450/800/900 聚合 3 次 .in）',
      `rep=${repTicks} agg=${aggTicks}`);
    const rRepFin = await svcRep.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 950 });
    ok(rRepFin.factors.narrativeLeaderMaxMultiple === 7, 'I1c. 终态 maxMultiple=7（增量拼入与全量一致）',
      `max=${rRepFin.factors.narrativeLeaderMaxMultiple}`);

    // 场景 2（I4）：迟到行——装载后外部进程新写的行不可见（回测 endTime=回放终点时
    // 窗内行装载时已全在，本形状仅文档化 fail-open 声明口径）
    {
      const rows2 = baseRows();
      rows2.wssPriceTicks.push(tick(CAND_A, 700, 7, 1, 0));
      const svcOff2 = mkSvc(rows2, { queries: [] }, 'off');
      const svcRep2 = mkSvc(rows2, { queries: [] }, 'agg');
      svcRep2.enableReplayRowSource({ endTimeIso: T(2000) });
      await svcRep2.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 600 }); // 装载时点
      rows2.wssPriceTicks.push(tick(CAND_A, 850, 8, 1, 0)); // 装载后追加（迟到行）
      const rO = await svcOff2.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 900 });
      const rR = await svcRep2.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 900 });
      ok(rR.factors.narrativeLeaderMaxMultiple === 7 && rO.factors.narrativeLeaderMaxMultiple === 8,
        'I4. 迟到行回放行源不可见（max=7 vs DB 版 8）——少算龙头=fail-open 方向，口径声明',
        `rep=${rR.factors.narrativeLeaderMaxMultiple} db=${rO.factors.narrativeLeaderMaxMultiple}`);
    }

    // 场景 3（I5）：首查末行 logIdx≠0 + 增量首行同刻——剥离防线（携带真值→wmIdx=5
    // → 同刻水位行被幂等跳过 → rowCount 7≠8 分叉；剥离后两版都重复处理 rowCount=8）
    {
      const rows3 = baseRows();
      rows3.wssPriceTicks.push(tick(CAND_A, 600, 5.5, 1, 5)); // 首查末行（logIdx=5）
      rows3.wssPriceTicks.push(tick(CAND_A, 700, 7, 1, 0));
      const svcAgg3 = mkSvc(rows3, { queries: [] }, 'agg');
      const svcRep3 = mkSvc(rows3, { queries: [] }, 'agg');
      svcRep3.enableReplayRowSource({ endTimeIso: T(2000) });
      await svcAgg3.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 600 });
      await svcRep3.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 600 });
      await svcAgg3.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 800 });
      await svcRep3.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 800 });
      const stD = svcAgg3._peakCache.get(CAND_A);
      const stR = svcRep3._peakCache.get(CAND_A);
      ok(JSON.stringify(stR) === JSON.stringify(stD) && stD.rowCount === 8 && stD.wmIdx === 0,
        'I5. 首查切片剥离 log_index：state 与 DB 版深度一致（wmIdx 伪 0、rowCount=8 含同刻水位行重复多计）',
        `\ndb: ${JSON.stringify(stD)}\nrep: ${JSON.stringify(stR)}`);
    }

    // 场景 4（I6）：tinyConfig pageSize=2 首达在增量阶段 cap 收紧 + idxRows 页切片分页跨页
    {
      const rows4 = baseRows();
      rows4.wssPriceTicks.push(tick(CAND_B, 620, 5.5, 1, 0), tick(CAND_B, 700, 6, 1, 0)); // 全预置（回测形态）
      const svcOff4 = mkSvc(rows4, { queries: [] }, 'off', { tickPageSize: 2, maxTickPages: 3 });
      const svcRep4 = mkSvc(rows4, { queries: [] }, 'agg', { tickPageSize: 2, maxTickPages: 3 });
      svcRep4.enableReplayRowSource({ endTimeIso: T(2000) });
      await svcOff4.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 600 });
      await svcRep4.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 600 });
      const rO8 = await svcOff4.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 800 });
      const rR8 = await svcRep4.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 800 });
      const rO9 = await svcOff4.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 900 });
      const rR9 = await svcRep4.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 900 });
      const leadB = rR9.detail.leaders.find(l => l.tokenAddress === CAND_B);
      ok(strip(rR8) === strip(rO8) && strip(rR9) === strip(rO9)
        && leadB && leadB.peakMultiple === 5.5 && leadB.firstReachAt === T(620),
        'I6. tinyConfig 首达在增量阶段：cap 收紧到首达页界（B peak=5.5）+ 页切片分页，与全量 bit 一致',
        `\noff9: ${strip(rO9)}\nrep9: ${strip(rR9)}`);
    }

    // 场景 5（I7）：装载失败退路（第 1 次 .in = 装载查询注入失败）
    {
      warnCalls = [];
      const rows5 = baseRows();
      rows5.wssPriceTicks.push(tick(CAND_A, 700, 7, 1, 0));
      rows5.failBatchAt = 1;
      const svcOff5 = mkSvc(rows5, { queries: [] }, 'off');
      const svcRep5 = mkSvc(rows5, { queries: [] }, 'agg');
      svcRep5.enableReplayRowSource({ endTimeIso: T(2000) });
      const r1 = await svcRep5.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 600 });
      ok(r1.success === true && warnCalls.some(a => String(a[0]).includes('回放 idx 装载失败')),
        'I7a. 装载失败 warn 留痕 + check 仍成功（fail-open）',
        `success=${r1.success} warns=${JSON.stringify(warnCalls.map(a => String(a[0])))}`);
      ok(svcRep5._replayIdx.size === 0, 'I7b. 失败 tweet 零桶（首查/增量退回 DB 路径）',
        `buckets=${svcRep5._replayIdx.size}`);
      const rR = await svcRep5.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 900 });
      const rO = await svcOff5.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 900 });
      ok(strip(rR) === strip(rO) && rR.factors.narrativeLeaderMaxMultiple === 7,
        'I7c. 退 DB 路径终态与全量 bit 一致', `\noff: ${strip(rO)}\nrep: ${strip(rR)}`);
    }

    // 场景 6（I8）：跨 tweet 装载——已入桶地址跳过；tweet2 逐候选增量亦走 idx（零 DB）
    {
      const TWEET2 = '888';
      const CAND_D = '0xcand00000000000000000000000000000000d4';
      const rows6 = baseRows();
      rows6.wssPriceTicks.push(tick(CAND_A, 700, 7, 1, 0));
      rows6.experimentTokens.push({ token_address: CAND_D, token_symbol: 'D', discovered_at: T(1006), narrative_material_id: TWEET2 });
      rows6.experimentTokens.push({ token_address: CAND_A, token_symbol: 'A2', discovered_at: T(1007), narrative_material_id: TWEET2 });
      rows6.wssPriceTicks.push(tick(CAND_D, 50, 1, 1, 0), tick(CAND_D, 600, 9, 1, 0)); // D 9x 首达
      const cRep6 = { queries: [] };
      const svcOff6 = mkSvc(rows6, { queries: [] }, 'off');
      const svcRep6 = mkSvc(rows6, cRep6, 'agg');
      svcRep6.enableReplayRowSource({ endTimeIso: T(2000) });
      await svcRep6.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 800 }); // tweet1 装载 A/B/C/SELF
      await svcRep6.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 810 });
      cRep6.queries.length = 0;
      const t2a = await svcRep6.check({ tokenAddress: SELF, sourceTweetId: TWEET2, checkTimeSec: 850 });
      const o2a = await svcOff6.check({ tokenAddress: SELF, sourceTweetId: TWEET2, checkTimeSec: 850 });
      ok(strip(t2a) === strip(o2a), 'I8a. tweet2 首查（A 跨 tweet 复用 state 的逐候选增量走 idx + D idx 首查）与全量一致',
        `\noff: ${strip(o2a)}\nrep: ${strip(t2a)}`);
      const t2Loads = cRep6.queries.filter(q => q.table === 'wss_price_ticks' && q.conds.some(([k, op]) => k === 'token_address' && op === 'in'));
      const t2Addrs = t2Loads.length ? t2Loads[0].conds.find(([k, op]) => k === 'token_address' && op === 'in')[2] : [];
      ok(t2Loads.length === 1 && t2Addrs.length === 1 && String(t2Addrs[0]).toLowerCase() === CAND_D,
        'I8b. tweet2 装载 .in 只含新地址 D（A 已入桶跳过）', `addrs=${JSON.stringify(t2Addrs)}`);
      ok(cRep6.queries.filter(q => q.table === 'wss_price_ticks'
        && q.conds.some(([k, op]) => k === 'token_address' && op === 'eq')).length === 0,
        'I8c. tweet2 首查零逐候选 eq 查询（A 增量/D 首查全走 idx 切片）');
      cRep6.queries.length = 0;
      const t2b = await svcRep6.check({ tokenAddress: SELF, sourceTweetId: TWEET2, checkTimeSec: 900 });
      const o2b = await svcOff6.check({ tokenAddress: SELF, sourceTweetId: TWEET2, checkTimeSec: 900 });
      ok(strip(t2b) === strip(o2b)
        && cRep6.queries.filter(q => q.table === 'wss_price_ticks').length === 0,
        'I8d. tweet2 聚合批量零 DB 且与全量一致', `\noff: ${strip(o2b)}\nrep: ${strip(t2b)}`);
    }
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
