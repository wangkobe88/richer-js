/**
 * SameNarrativeLeaderService 增量缓存单测（2026-10-12 回测性能案 P3a）
 *
 * 零 DB 零网络：mock supabase 链式打桩（from/select/eq/neq/gte/lte/order/limit/range，
 * await thenable 触发执行），内存数据集过滤。六节：
 *  A 基线全量语义（对照原版）：首价/峰值/首达/truncated/尘门/outlier 服务端过滤
 *  B 增量 vs 全量 bit-identical：同数据同 checkTime 序列，两实例（cache on/off）
 *    逐字段对拍（含 firstTickAt/firstReachAt/peakMultiple/inWindow/truncated）
 *  C 增量查询形状：同候选第二次 check 只拉增量（查询次数断言）；
 *    hardDone（首达/封顶）后零查询
 *  D 候选集缓存 L1：同 tweet 二次 check 零候选查询；使用点排除自身
 *  E checkTime 倒退 → 弃缓存全量重算（warn）
 *  F 火窗语义：首达后 24h 内 hot=1，窗外 hot=0（增量纯函数路径）
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
      order: (k, o) => { state.orders.push([k, !o || o.ascending]); return b; },
      limit: (n) => { state.limitN = n; return b; },
      range: (from, to) => { state.range = [from, to]; return b; },
    };
    b.then = (resolve) => resolve(exec(state));
    return b;
  };
  function exec(state) {
    if (counters) counters.queries.push(state);
    let data = state.table === 'wss_price_ticks' ? rows.wssPriceTicks : rows.experimentTokens;
    for (const [k, op, v] of state.conds) {
      data = data.filter(r => {
        const rv = r[k];
        if (op === 'eq') return String(rv) === String(v);
        if (op === 'neq') return String(rv) !== String(v);
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

// 服务工厂（数据共享同一 rows 对象——对拍两实例看到同库）
function mkSvc(rows, counters, incremental, extra) {
  return new SameNarrativeLeaderService(mkSupabase(rows, counters), incremental ? warnLogger : noopLogger, {
    incrementalCache: incremental,
    ...extra,
  });
}

async function main() {
  // ═══ A. 基线全量语义 ═══
  console.log('A. 基线全量语义（cache off 对照）');
  {
    const rows = baseRows();
    const counters = { queries: [] };
    const svc = mkSvc(rows, counters, false);
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

  // ═══ B. 增量 vs 全量 bit-identical ═══
  console.log('B. 增量 vs 全量 bit-identical（同数据同 checkTime 序列）');
  {
    const rows = baseRows();
    // 追加时间上渐进的行（增量路径才有新数据可拼）
    rows.wssPriceTicks.push(tick(CAND_A, 700, 7, 1, 0));   // 7x 新峰
    rows.wssPriceTicks.push(tick(CAND_B, 350, 2.5, 1, 0)); // B 新峰（仍 <5x）
    rows.wssPriceTicks.push(tick(CAND_C, 300, 2, 5, 0));   // C 后来出现非尘行 → 有首价
    const times = [150, 310, 450, 800];
    const cOn = { queries: [] }, cOff = { queries: [] };
    const svcOn = mkSvc(rows, cOn, true);
    const svcOff = mkSvc(rows, cOff, false);
    for (const t of times) {
      const rOn = await svcOn.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: t });
      const rOff = await svcOff.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: t });
      const strip = (r) => JSON.stringify({ f: r.factors, l: r.detail.leaders });
      ok(strip(rOn) === strip(rOff), `B[${t}]. factors+leaders bit 一致`, `\non : ${strip(rOn)}\noff: ${strip(rOff)}`);
    }
    // 最终态抽查
    const rFinal = await svcOn.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 900 });
    ok(rFinal.factors.narrativeLeaderMaxMultiple === 7, 'B1. 终态 maxMultiple=7（700s 新峰经增量拼入）', `max=${rFinal.factors.narrativeLeaderMaxMultiple}`);
    // C 的内部增量状态直接验证（factors 不含未首达候选峰值，对拍覆盖不到）
    const cState = svcOn._peakCache.get(CAND_C);
    ok(cState && cState.firstPrice === 2 && cState.rowCount === 3,
      'B2. C 尘行×2 + 后来非尘行 300s 增量拼接（firstPrice=2, rowCount=3）',
      `state=${cState && JSON.stringify({ f: cState.firstPrice, n: cState.rowCount })}`);
  }

  // ═══ C. 增量查询形状 ═══
  console.log('C. 增量查询形状（查询次数）');
  {
    const rows = baseRows();
    const counters = { queries: [] };
    const svc = mkSvc(rows, counters, true);
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
  }

  // ═══ D. 候选集缓存使用点排除自身 ═══
  console.log('D. L1 候选集缓存 + 排除自身');
  {
    const rows = baseRows();
    const counters = { queries: [] };
    const svc = mkSvc(rows, counters, true);
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
    const svc = mkSvc(rows, counters, true);
    await svc.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 600 });
    counters.queries.length = 0;
    const r = await svc.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 500 });
    ok(r.success === true, 'E1. 倒退调用仍成功（全量重算）');
    ok(warnCalls.length > 0, 'E2. 倒退告警留痕');
    const tickQ = counters.queries.filter(q => q.table === 'wss_price_ticks');
    // A 全量重查（lte 500 → 4 行 1 页）；倒退后 500s 时刻 A 未回落仍 6x 峰
    ok(r.factors.narrativeLeaderMaxMultiple === 6, 'E3. 倒退到 500s → maxMultiple 回到 6（无 700s 峰）');
    ok(tickQ.length === 3, 'E4. 三候选全量重查', `q=${tickQ.length}`);
  }

  // ═══ F. 火窗语义 + hardDone 页界封顶（tinyConfig 快速达界）═══
  console.log('F. 火窗 24h 语义 + hardDone 页界');
  {
    // tickPageSize=2/maxTickPages=3：A 5 行，首达在处理序 3（页 1）→ max 封顶页界=4，
    // 全量首查 rowCount=4 → 立即 hardDone（此后 max 冻结 6，500s 行永不进统计=原版页 break）
    const rows = baseRows();
    const counters = { queries: [] };
    const svc = mkSvc(rows, counters, true, { tickPageSize: 2, maxTickPages: 3 });
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
    // 对照：全量实例同数据同配置，max 同为 6（页界语义与原版 break 一致）
    const svcOff = mkSvc(rows, { queries: [] }, false, { tickPageSize: 2, maxTickPages: 3 });
    const rOff = await svcOff.check({ tokenAddress: SELF, sourceTweetId: TWEET, checkTimeSec: 86400 + 301 });
    ok(rOff.factors.narrativeLeaderMaxMultiple === 6 && rOff.factors.narrativeLeaderHot === 0,
      'F5. 全量对照同结果（原版首达页 break 语义 = 增量页界封顶）');
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
