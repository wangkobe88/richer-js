#!/usr/bin/env node
/**
 * trades 页价格线图 ticks 重建单测（2026-10-15）——零 DB 零网络。
 *
 * 背景：experiment_time_series_data 30s 快照停写（效率优化批次 2）后，trades 页
 * 时序价格线图（用户裁定恢复）改由 wss_price_ticks 投影重建：
 *   src/web/services/price-series.js buildPriceSeries + web-server
 *   /api/tokens/price-series + 前端 loadKlineForToken → initPriceLineChart。
 *
 * 价格是 tick 行自带量（无重放语义），正确性集中在：投影合同（行按 block_time
 * 升序传入、输出点单调）+ 降采样形状（与 holder-series 同款：段尾抽样不造中间
 * 值、末点保留）+ 端点/前端链源码口径（价格图口径过滤、service key、挂点、
 * 时序 API 零依赖）。Holder 图的重放口径对拍见 _test_holder_series_rebuild.cjs。
 *
 * 运行：node scripts/_test_price_series_rebuild.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const WEB_SERVER_PATH = path.join(ROOT, 'src', 'web-server.js');
const TRADES_JS_PATH = path.join(ROOT, 'src', 'web', 'static', 'js', 'experiment_trades.js');

const { buildPriceSeries, DEFAULT_MAX_POINTS } = require(
  path.join(ROOT, 'src', 'web', 'services', 'price-series.js'));

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

/** 造 DB 行形状（端点瘦列：block_time/price_usd） */
const T0 = 1790802000000; // 固定锚，结果不依赖墙钟
let _iSeq = 0;
function mkRow(overrides) {
  return Object.assign({
    block_time: new Date(T0 + (_iSeq++) * 450).toISOString(), // BSC 0.45s 块节奏，升序
    price_usd: 0.000005,
  }, overrides);
}

// ═══════════ A 节：投影与合同 ═══════════
console.log('\nA 节：投影与合同');
{
  check('A1 行 → {t, p} 投影（Number 化，字符串 price_usd 可解析）', () => {
    const s = buildPriceSeries([
      mkRow({ price_usd: '0.000005' }),
      mkRow({ price_usd: 0.000006 }),
    ], { maxPoints: Infinity });
    assert.deepStrictEqual(s.points, [{ t: T0, p: 0.000005 }, { t: T0 + 450, p: 0.000006 }]);
  });
  check('A2 无效行跳过但 totalRows 含全量（totalRows=传入行数，降采样前后都不失真）', () => {
    const rows = [
      mkRow({ price_usd: null }),
      mkRow({ price_usd: 'not-a-number' }),
      mkRow({ block_time: 'garbage' }),
      mkRow({ price_usd: 1 }),
    ];
    const s = buildPriceSeries(rows, { maxPoints: Infinity });
    assert.strictEqual(s.points.length, 1);
    assert.strictEqual(s.points[0].p, 1);
    assert.strictEqual(s.totalRows, 4);
  });
  check('A3 空输入 → 空 points / totalRows 0', () => {
    const s = buildPriceSeries([]);
    assert.deepStrictEqual(s.points, []);
    assert.strictEqual(s.totalRows, 0);
  });
  check('A4 升序输入输出 t 单调升（拉取序合同：不排序不兜底，乱序由端点 order 保证）', () => {
    const rows = Array.from({ length: 50 }, (_, i) => mkRow({ price_usd: 1 + i }));
    const pts = buildPriceSeries(rows, { maxPoints: Infinity }).points;
    for (let i = 1; i < pts.length; i++) assert.ok(pts[i].t > pts[i - 1].t, `t 非升 @${i}`);
  });
  check('A5 price_usd=0 是有效观测（Number.isFinite 放行，非 null 语义）', () => {
    const s = buildPriceSeries([mkRow({ price_usd: 0 })], { maxPoints: Infinity });
    assert.strictEqual(s.points[0].p, 0);
  });
}

// ═══════════ B 节：降采样（与 holder-series 同款形状） ═══════════
console.log('\nB 节：降采样');
{
  const rows = Array.from({ length: 100 }, (_, i) => mkRow({ price_usd: 1 + i }));
  const full = buildPriceSeries(rows, { maxPoints: Infinity }).points;
  check('B1 默认 maxPoints=2000', () => assert.strictEqual(DEFAULT_MAX_POINTS, 2000));
  const ds = buildPriceSeries(rows, { maxPoints: 10 }).points;
  check('B2 maxPoints=10 输出恰 10 点（100/step10 段尾）', () => assert.strictEqual(ds.length, 10));
  check('B3 末点保留（终值价格不被抽样吞掉）', () =>
    assert.deepStrictEqual(ds[ds.length - 1], full[full.length - 1]));
  check('B4 抽样点是原序列子集（不造中间值）', () => {
    const key = p => `${p.t}:${p.p}`;
    const set = new Set(full.map(key));
    for (const p of ds) assert.ok(set.has(key(p)), `造值 ${JSON.stringify(p)}`);
  });
  check('B5 非整除余段：101 点 maxPoints 10 → step 11 段尾 9 点 + 末点 = 10 点', () => {
    const rows101 = rows.concat([mkRow({ price_usd: 999 })]);
    const d = buildPriceSeries(rows101, { maxPoints: 10 }).points;
    assert.strictEqual(d.length, 10);
    assert.strictEqual(d[d.length - 1].p,
      buildPriceSeries(rows101, { maxPoints: Infinity }).points[100].p);
  });
  check('B6 n ≤ maxPoints 原样返回（不进抽样分支）', () => {
    const small = buildPriceSeries(rows.slice(0, 5), { maxPoints: 10 }).points;
    assert.strictEqual(small.length, 5);
  });
}

// ═══════════ C 节：源码口径（端点/前端链恢复 + 时序表零依赖） ═══════════
console.log('\nC 节：源码口径');
{
  const webSrc = fs.readFileSync(WEB_SERVER_PATH, 'utf8');
  const jsSrc = fs.readFileSync(TRADES_JS_PATH, 'utf8');

  check('C1 web-server 端点在 + 价格图口径过滤 + service key 形状', () => {
    assert.ok(webSrc.includes("'/api/tokens/price-series'"), '路由缺失');
    assert.ok(webSrc.includes('buildPriceSeries'), 'require/调用缺失');
    assert.ok(/from\('wss_price_ticks'\)/.test(webSrc), 'tick 表查询缺失');
    // 价格图口径：与 /api/ticks 同（outlier 剔除 + null 价剔除）
    const m = /get\('\/api\/tokens\/price-series'[\s\S]{0,2000}?order\('block_time'/.exec(webSrc);
    assert.ok(m, '端点查询块形状变化，请人工核对 web-server.js');
    assert.ok(m[0].includes(".eq('price_outlier', false)"), 'price_outlier 过滤缺失');
    assert.ok(m[0].includes(".not('price_usd', 'is', null)"), 'null 价过滤缺失');
    assert.ok(webSrc.includes('this.dataService.supabase'), '须走 dbManager service key（RLS 红线）');
  });
  check('C2 前端链恢复：fetch/init/入口三件', () => {
    for (const pat of ['fetchPriceSeries', 'initPriceLineChart', 'loadKlineForToken']) {
      assert.ok(jsSrc.includes(pat), `${pat} 缺失`);
    }
  });
  check('C3 挂点两处：parseHashToken 与代币下拉 change 均调 loadKlineForToken', () => {
    const hits = jsSrc.split('this.loadKlineForToken(').length - 1;
    assert.strictEqual(hits, 2, `调用点 ${hits} ≠ 2（URL hash 自动选择 + 下拉切换）`);
  });
  check('C4 trades-K线链 initTradeKlineChart 保留（未被价格线恢复挤掉）', () => {
    assert.ok(/initTradeKlineChart/.test(jsSrc), 'K线链被误删');
    assert.ok(/loadKlineDataAndInitChart/.test(jsSrc), 'K线装载链被误删');
  });
  check('C5 时序表零依赖（数据源不回流 /api/experiment/time-series）', () => {
    assert.ok(!jsSrc.includes('fetchTimeSeriesData'), '时序 API 依赖回流');
    assert.ok(!jsSrc.includes('/api/experiment/time-series'), '时序端点引用回流');
  });
  check('C6 交易标注直画垂直线（原 30s 宿主匹配已去——降采样后点距>交易间隔会丢标注）', () => {
    assert.ok(!jsSrc.includes('closestIndex'), '宿主匹配残留');
    const m = /initPriceLineChart[\s\S]{0,3000}?xMin: tradeTime/.exec(jsSrc);
    assert.ok(m, '垂直线标注缺失（xMin=xMax=交易时刻）');
  });
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`trades 页价格线图 ticks 重建: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
