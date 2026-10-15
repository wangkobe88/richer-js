#!/usr/bin/env node
/**
 * Holder 走势图 ticks 重建单测（2026-10-15）——零 DB 零网络。
 *
 * 背景：experiment_time_series_data 30s 快照停写（效率优化批次 2）后，signals 页
 * Holder 走势图（用户裁定保留）改由 wss_price_ticks 全量重放重建：
 *   src/web/services/holder-series.js buildHolderSeries + web-server
 *   /api/tokens/holder-series + 前端 initHolderChart（新数据形状 {t, holders}）。
 *
 * 口径防线：重放必须与 FA _applyWalletAggregation 的 holderCount bit 一致
 * （五要素：wallet COALESCE / 尘 tick 剔除 / tokenAmount>0 / 跨 0 边界 ±1 /
 * (block,log) 链上真序）——A 节真身 FA 对拍逐点锁定；任一侧口径改动此处必红。
 *
 * 运行：node scripts/_test_holder_series_rebuild.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const FA_PATH = path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js');
const HS_PATH = path.join(ROOT, 'src', 'web', 'services', 'holder-series.js');
const WEB_SERVER_PATH = path.join(ROOT, 'src', 'web-server.js');
const SIGNALS_JS_PATH = path.join(ROOT, 'src', 'web', 'static', 'js', 'experiment_signals.js');
const SIGNALS_HTML_PATH = path.join(ROOT, 'src', 'web', 'templates', 'experiment_signals.html');
const REMOVAL_TEST_PATH = path.join(ROOT, 'scripts', '_test_timeseries_removal.cjs');

const FourMemeFactorAggregator = require(FA_PATH);
const { buildHolderSeries, DEFAULT_MIN_TICK_BNB, DEFAULT_MAX_POINTS } = require(HS_PATH);

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

/** 造 DB 行形状（web-server 端点瘦列） */
let _liSeq = 0;
const T0 = 1790802000000; // 固定锚（2026-09-30 附近），结果不依赖墙钟
function mkRow(overrides) {
  return Object.assign({
    block_time: new Date(T0 + _liSeq * 450).toISOString(), // BSC 0.45s 块节奏
    block_number: 1000 + _liSeq,
    log_index: ++_liSeq,
    trade_type: 'buy',
    token_amount: 1000,
    bnb_amount: 1,      // ≥ 0.001 非尘
    sender_address: '0xE1',
    trader_address: null,
  }, overrides);
}

/** DB 行 → FA tick 形状（字段名映射；尘 tick 已由调用方滤除=collector 分流语义） */
function toFaTick(row, tokenAddress) {
  return {
    token_address: tokenAddress,
    trade_type: row.trade_type,
    trader_address: row.trader_address,
    sender_address: row.sender_address,
    price_bnb: 0.00001,
    price_usd: 5,
    bnb_amount: row.bnb_amount,
    token_amount: row.token_amount,
    block_number: row.block_number,
    log_index: row.log_index,
    timestamp: new Date(row.block_time).getTime(),
    tx_hash: '0xtx',
  };
}

/** FA 侧真身对拍：按 (block,log) 真序（回测喂食口径）滤尘后逐行喂 processTick，
 *  返回每 tick 后的 holderCount 序列。live 到达序的中间值是 resolver 乱序 artefact
 *  （holderCount 终值序无关收敛），重放图与回测口径对齐故对拍也用真序。 */
function faReplay(rows, tokenAddress = '0xtoken') {
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  const seq = [];
  const ordered = [...rows].sort((a, b) =>
    (Number(a.block_number) - Number(b.block_number)) || (Number(a.log_index) - Number(b.log_index)));
  for (const row of ordered) {
    // collector 分流语义：尘 tick（bnb < minTickBnb）不进 FA（只落表）
    if (!((Number(row.bnb_amount) || 0) >= DEFAULT_MIN_TICK_BNB)) continue;
    fa.processTick(toFaTick(row, tokenAddress));
    seq.push(fa._states.get(tokenAddress).holderCount);
  }
  return seq;
}

// 简单可复现随机源（不依赖墙钟）
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ═══════════ A 节：FA 真身对拍（口径 bit 一致） ═══════════
console.log('\nA 节：FA 真身对拍');
{
  // A1 固定场景：多钱包买卖/清仓再买回/净卖穿 0/尘 tick/sender COALESCE。
  // 对拍行集刻意不含 tokenAmount<=0 与双 NULL 行——FA 对这两类行产出「值不变点」
  // 而重放不产点（图表等价的水平段），逐点对拍须同推进行集；其语义由 B 节单点锁定。
  const rows = [
    mkRow({ sender_address: '0xE1', token_amount: 500 }),                       // E1 入场 → 1
    mkRow({ sender_address: '0xE2', token_amount: 300 }),                       // E2 入场 → 2
    mkRow({ sender_address: '0xE1', trade_type: 'sell', token_amount: 500 }),   // E1 清仓 → 1
    mkRow({ sender_address: '0xE1', token_amount: 800 }),                       // E1 回场 → 2
    mkRow({ sender_address: '0xE3', trade_type: 'sell', token_amount: 900 }),   // E3 卖无底仓净负 → 2
    mkRow({ sender_address: null, trader_address: '0xE4', token_amount: 100 }), // COALESCE 回退 trader → 3
    mkRow({ sender_address: '0xE2', token_amount: 50, bnb_amount: 0.0005 }),    // 尘 tick（两侧都不产点）
    mkRow({ sender_address: '0xE2', token_amount: 50, bnb_amount: 0.001 }),     // 恰等阈值非尘，E2 已在场 → 3
    mkRow({ sender_address: '0xE4', trade_type: 'sell', token_amount: 40 }),    // E4 净 60 仍在场 → 3
    mkRow({ sender_address: '0xE4', trade_type: 'sell', token_amount: 60 }),    // E4 清仓 → 2
  ];
  const faSeq = faReplay(rows);
  const series = buildHolderSeries(rows, { maxPoints: Infinity });
  check('A1 固定场景逐点 holderCount 与 FA 一致', () =>
    assert.deepStrictEqual(series.points.map(p => p.holders), faSeq));
  check('A1 序列形状 [1,2,1,2,2,3,3,3,2]', () =>
    assert.deepStrictEqual(series.points.map(p => p.holders), [1, 2, 1, 2, 2, 3, 3, 3, 2]));
  check('A1 终值 holders=2（E1/E2 在场，E4 清仓，E3 净负不算）', () =>
    assert.strictEqual(series.holders, 2));

  // A2 随机压力对拍：500 行随机（钱包池 20、买卖、量、尘、COALESCE 回退混合；同 A1 行集约束）
  const rnd = mulberry32(20261015);
  const wallets = Array.from({ length: 20 }, (_, i) => `0xW${i}`);
  const randRows = Array.from({ length: 500 }, () => {
    const w = wallets[Math.floor(rnd() * wallets.length)];
    const roll = rnd();
    return mkRow({
      sender_address: roll < 0.08 ? null : w,
      trader_address: roll < 0.08 ? w.toUpperCase() : null, // 8% COALESCE 回退 trader
      trade_type: rnd() < 0.55 ? 'buy' : 'sell',
      token_amount: 1 + Math.floor(rnd() * 400),
      bnb_amount: rnd() < 0.2 ? 0.0002 : 0.01 + rnd() * 2, // 20% 尘
      block_number: 2000 + Math.floor(rnd() * 50),          // 块号乱序（模拟 block_time 拉取序）
    });
  });
  const faSeq2 = faReplay(randRows);
  const series2 = buildHolderSeries(randRows, { maxPoints: Infinity });
  check('A2 随机 500 行逐点 holderCount 与 FA 一致', () =>
    assert.deepStrictEqual(series2.points.map(p => p.holders), faSeq2));
  check('A2 终值一致', () => assert.strictEqual(series2.holders, faSeq2[faSeq2.length - 1]));
}

// ═══════════ B 节：口径要素单点锁定（A 之外的退化形状） ═══════════
console.log('\nB 节：口径要素');
{
  check('B1 空输入 → 空 points / holders 0 / totalRows 0', () => {
    const s = buildHolderSeries([]);
    assert.deepStrictEqual(s.points, []);
    assert.strictEqual(s.holders, 0);
    assert.strictEqual(s.totalRows, 0);
  });
  check('B2 全尘行 → 空 points（重放等于引擎从未见过任何行）', () => {
    const s = buildHolderSeries([mkRow({ bnb_amount: 0.0001 }), mkRow({ bnb_amount: 0 })]);
    assert.deepStrictEqual(s.points, []);
  });
  check('B3 totalRows=传入全量行数（含尘/NULL 行——降采样前后都不失真）', () => {
    const rows = [mkRow(), mkRow({ bnb_amount: 0.0001 }), mkRow({ sender_address: null, trader_address: null })];
    assert.strictEqual(buildHolderSeries(rows).totalRows, 3);
  });
  check('B4 卖大于买（净穿负再买回小额）跨 0 只回 +1 一次', () => {
    const rows = [
      mkRow({ sender_address: '0xE1', token_amount: 100 }),
      mkRow({ sender_address: '0xE1', trade_type: 'sell', token_amount: 300 }), // 净 -200 → 0
      mkRow({ sender_address: '0xE1', trade_type: 'sell', token_amount: 50 }),  // 净 -250 仍 ≤0 → 0
      mkRow({ sender_address: '0xE1', token_amount: 10 }),                      // 净 -240 仍 ≤0 → 0
      mkRow({ sender_address: '0xE1', token_amount: 300 }),                     // 净 +60 → 1
    ];
    const s = buildHolderSeries(rows, { maxPoints: Infinity });
    assert.deepStrictEqual(s.points.map(p => p.holders), [1, 0, 0, 0, 1]);
  });
}

// ═══════════ C 节：行序（链上真序重排） ═══════════
console.log('\nC 节：行序');
{
  // C1 拉取序乱序（block_time 非单调的到达序）→ 按 (block,log) 真序重放，与真序输入一致
  const ordered = [
    mkRow({ sender_address: '0xE1', token_amount: 100, block_number: 10, log_index: 1 }),
    mkRow({ sender_address: '0xE2', token_amount: 100, block_number: 10, log_index: 2 }),
    mkRow({ sender_address: '0xE1', trade_type: 'sell', token_amount: 100, block_number: 11, log_index: 1 }),
  ];
  const shuffled = [ordered[2], ordered[0], ordered[1]]; // 倒置到达序
  const a = buildHolderSeries(ordered, { maxPoints: Infinity });
  const b = buildHolderSeries(shuffled, { maxPoints: Infinity });
  check('C1 乱序输入与真序输入输出 bit 一致（(block,log) 排序接管）', () =>
    assert.deepStrictEqual(b.points, a.points));
  check('C1 真序下 holders 序列 [1,2,1]', () =>
    assert.deepStrictEqual(a.points.map(p => p.holders), [1, 2, 1]));

  // C2 points 时间戳单调升：block_time 从 block_number 派生（链上同源单调——
  // 到达序乱，重放按 (block,log) 排序后 t 必随真序单调）
  const rnd = mulberry32(777);
  const rows = Array.from({ length: 200 }, () => {
    const bn = 5000 + Math.floor(rnd() * 40);
    return mkRow({
      block_number: bn,
      log_index: Math.floor(rnd() * 1000),
      block_time: new Date(T0 + bn * 450).toISOString(),
    });
  });
  const pts = buildHolderSeries(rows, { maxPoints: Infinity }).points;
  check('C2 乱序块号输入重放后时间单调升', () => {
    for (let i = 1; i < pts.length; i++) assert.ok(pts[i].t >= pts[i - 1].t, `t 回退 @${i}`);
  });
}

// ═══════════ D 节：降采样 ═══════════
console.log('\nD 节：降采样');
{
  const rows = Array.from({ length: 100 }, (_, i) =>
    mkRow({ sender_address: `0xE${i % 7}`, token_amount: 10 + i }));
  const full = buildHolderSeries(rows, { maxPoints: Infinity }).points;
  check('D1 默认 maxPoints=2000', () => assert.strictEqual(DEFAULT_MAX_POINTS, 2000));
  const ds = buildHolderSeries(rows, { maxPoints: 10 }).points;
  check('D2 maxPoints=10 输出恰 10 点（100/step10 段尾）', () => assert.strictEqual(ds.length, 10));
  check('D3 末点保留（终态 holderCount 不被抽样吞掉）', () =>
    assert.deepStrictEqual(ds[ds.length - 1], full[full.length - 1]));
  check('D4 抽样点是原序列子集（不造中间值）', () => {
    const key = p => `${p.t}:${p.holders}`;
    const set = new Set(full.map(key));
    for (const p of ds) assert.ok(set.has(key(p)), `造值 ${JSON.stringify(p)}`);
  });
  check('D5 非整除余段：101 点 maxPoints 10 → step 11 段尾 9 点 + 末点 = 10 点', () => {
    const rows101 = rows.concat([mkRow({ sender_address: '0xE9' })]);
    const d = buildHolderSeries(rows101, { maxPoints: 10 }).points;
    assert.strictEqual(d.length, 10);
    assert.strictEqual(d[d.length - 1].holders, buildHolderSeries(rows101, { maxPoints: Infinity }).holders);
  });
}

// ═══════════ E 节：源码口径（端点/前端链恢复 + 时序表零依赖） ═══════════
console.log('\nE 节：源码口径');
{
  const webSrc = fs.readFileSync(WEB_SERVER_PATH, 'utf8');
  const jsSrc = fs.readFileSync(SIGNALS_JS_PATH, 'utf8');
  const htmlSrc = fs.readFileSync(SIGNALS_HTML_PATH, 'utf8');
  const removalTestSrc = fs.readFileSync(REMOVAL_TEST_PATH, 'utf8');

  check('E1 web-server 端点在 + service key 形状', () => {
    assert.ok(webSrc.includes("'/api/tokens/holder-series'"), '路由缺失');
    assert.ok(webSrc.includes("buildHolderSeries"), 'require/调用缺失');
    assert.ok(/from\('wss_price_ticks'\)/.test(webSrc), 'tick 表查询缺失');
    assert.ok(webSrc.includes('this.dataService.supabase'), '须走 dbManager service key（RLS 红线）');
  });
  check('E2 前端链恢复：fetch/_render/init/占位/缓存五件', () => {
    for (const pat of ['fetchHolderSeries', '_renderHolderForWindow', 'initHolderChart', 'showHolderPlaceholder', '_lastHolderSeries']) {
      assert.ok(jsSrc.includes(pat), `${pat} 缺失`);
    }
  });
  check('E3 前端窗口联动三挂点（applyTickWindow/resetTickWindow/loadFullTickRange 各含 _renderHolderForWindow）', () => {
    const hits = jsSrc.split('_renderHolderForWindow()').length - 1;
    assert.ok(hits >= 4, `调用点 ${hits} < 4（3 窗口联动 + loadKlineForToken 初渲染）`);
  });
  check('E4 html 容器在（holder-chart-wrapper + canvas）', () => {
    assert.ok(htmlSrc.includes('id="holder-chart-wrapper"'), 'wrapper 缺失');
    assert.ok(htmlSrc.includes('id="holder-chart"'), 'canvas 缺失');
  });
  check('E5 时序表零依赖仍锁死（Holder 图数据源不回流 /api/experiment/time-series）', () => {
    assert.ok(!jsSrc.includes('fetchTimeSeriesData'), '时序 API 依赖回流');
    assert.ok(!jsSrc.includes('/api/experiment/time-series'), '时序端点引用回流');
  });
  check('E6 _test_timeseries_removal 口径已改写（不再锁 holder 链零残留）', () => {
    // 恢复后该测试的 E1/E2 应只锁 fetchTimeSeriesData 时序依赖，不再锁 initHolderChart 等重建链
    const m = /E1[^;]*?for \(const pat of \[([^\]]+)\]/.exec(removalTestSrc);
    assert.ok(m, 'E1 断言块形状变化，请人工核对 _test_timeseries_removal.cjs');
    assert.ok(!m[1].includes('initHolderChart') && !m[1].includes('holder-chart-wrapper'),
      'E1 仍锁 holder 重建链——须按 ticks 重建版口径改写');
  });
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`Holder 走势图 ticks 重建: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
