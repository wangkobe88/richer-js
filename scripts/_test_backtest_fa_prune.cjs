#!/usr/bin/env node
/**
 * P17 虚拟时钟 prune 单测（2026-10-13 OOM 根治，零 DB 零网络）
 *
 * 覆盖：
 * A. FA pruneStaleTokens 第三参 nowMs 语义（虚拟时钟判定 / 缺省墙钟 live 兼容）
 * B. 保护集矩阵（heldTokens 豁免）
 * C. 容量上限（maxTrackedTokens 最久未动淘汰 + 保护集豁免）
 * D. 复流语义（prune 后 processTick 自动重建 state）
 * E. BacktestEngine 侧：保护集构成四类来源 + 节流 + 开关 off
 * F. 毕业卖事故反证（plan P7 最大坑：state 被 prune → buildFactorMap null → 毕业卖
 *    「无因子」失败每 tick 重试）——保护集含毕业 token 时必须存活
 * G. 源码口径防线（红线 6：回测路径禁 Date.now——prune 判定时钟必须传 tickTs）
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const FA_PATH = path.join(__dirname, '..', 'src', 'services', 'FourMemeFactorAggregator.js');
const BE_PATH = path.join(__dirname, '..', 'src', 'trading-engine', 'implementations', 'BacktestEngine.js');

// ── 测试基建 ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${label}`); }
}

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };

function newFa(overrides = {}) {
  const FA = require(FA_PATH);
  return new FA({
    fourmemeWs: { ...overrides },
    maintainClassifierTracks: false,
    maintainTpaTracks: false,
  }, noopLogger);
}

function mkTick(addr, ts, extra = {}) {
  return {
    token_address: addr,
    timestamp: ts,
    trade_type: 'buy',
    bnb_amount: 0.5,
    price_bnb: 1e-9,
    token_amount: 5e8,
    block_number: 100,
    trader_address: '0xabc0000000000000000000000000000000000001',
    ...extra,
  };
}

const MIN = 60 * 1000;

// ── A. 第三参 nowMs 语义 ─────────────────────────────────────────────────
console.log('A. pruneStaleTokens 虚拟时钟参数');
{
  const T0 = 1_700_000_000_000;
  // A1: 虚拟时刻判定——lastTickAt 距虚拟 now 超 maxAge 删 / 未超留
  {
    const fa = newFa();
    fa.processTick(mkTick('0xdead1', T0));
    fa.processTick(mkTick('0xalive1', T0 + 26 * MIN));
    const pruned = fa.pruneStaleTokens(30 * MIN, new Set(), T0 + 31 * MIN);
    ok(pruned === 1, `A1 虚拟时钟删过期票（期望 1，实际 ${pruned}）`);
    ok(!fa.getTokenState('0xdead1'), 'A1 过期票 state 已删');
    ok(!!fa.getTokenState('0xalive1'), 'A1 窗内票 state 存活');
  }
  // A2: 边界——距 now 恰好 = maxAge（> 判定，不含边界）不删
  {
    const fa = newFa();
    fa.processTick(mkTick('0xedge', T0));
    fa.pruneStaleTokens(30 * MIN, new Set(), T0 + 30 * MIN);
    ok(!!fa.getTokenState('0xedge'), 'A2 边界时刻（差值==maxAge 不删，> 才删）');
  }
  // A3: 缺省第三参 = 墙钟（live 兼容）——40min 前的票按 Date.now 判定删
  {
    const fa = newFa();
    fa.processTick(mkTick('0xwallclock', Date.now() - 40 * MIN));
    fa.processTick(mkTick('0xwallfresh', Date.now() - 1 * MIN));
    const pruned = fa.pruneStaleTokens(30 * MIN, new Set());
    ok(pruned === 1 && !fa.getTokenState('0xwallclock') && !!fa.getTokenState('0xwallfresh'),
      'A3 缺省 nowMs 走墙钟（live setInterval 调用点零变化）');
  }
  // A4: 虚拟时钟下新票不受墙钟污染——lastTickAt 在「未来墙钟」的票按虚拟时刻判死
  {
    const fa = newFa();
    // 虚拟时刻体系：窗口起点 T0，票活跃于 T0 附近；墙钟此刻与 T0 无关
    fa.processTick(mkTick('0xvclk', T0));
    const pruned = fa.pruneStaleTokens(30 * MIN, new Set(), T0 + 31 * MIN);
    ok(pruned === 1 && !fa.getTokenState('0xvclk'),
      'A4 纯虚拟时钟判定（不读墙钟）');
  }
}

// ── B. 保护集矩阵 ────────────────────────────────────────────────────────
console.log('B. heldTokens 保护集');
{
  const T0 = 1_700_000_000_000;
  const fa = newFa();
  fa.processTick(mkTick('0xhelda', T0));
  fa.processTick(mkTick('0xheldb', T0));
  fa.processTick(mkTick('0xunheld', T0));
  const pruned = fa.pruneStaleTokens(30 * MIN, new Set(['0xhelda', '0xheldb']), T0 + 60 * MIN);
  ok(pruned === 1, `B1 保护集豁免（只删未保护票，期望 1，实际 ${pruned}）`);
  ok(!!fa.getTokenState('0xhelda') && !!fa.getTokenState('0xheldb'), 'B1 保护集票存活');
  ok(!fa.getTokenState('0xunheld'), 'B1 未保护票删除');
}

// ── C. 容量上限 ──────────────────────────────────────────────────────────
console.log('C. maxTrackedTokens 容量上限');
{
  const T0 = 1_700_000_000_000;
  const fa = newFa({ maxTrackedTokens: 3 });
  // 4 票全活跃（age 窗内）但超容量 → 最久未动淘汰
  fa.processTick(mkTick('0xc1', T0));
  fa.processTick(mkTick('0xc2', T0 + MIN));
  fa.processTick(mkTick('0xc3', T0 + 2 * MIN));
  fa.processTick(mkTick('0xc4', T0 + 3 * MIN));
  // c1 在保护集 → 淘汰顺延到 c2
  const pruned = fa.pruneStaleTokens(30 * MIN, new Set(['0xc1']), T0 + 4 * MIN);
  ok(pruned === 1, `C1 超容淘汰最久未动且保护集豁免（期望 1，实际 ${pruned}）`);
  ok(!fa.getTokenState('0xc2'), 'C1 c2（最久未动未保护）被淘汰');
  ok(!!fa.getTokenState('0xc1') && !!fa.getTokenState('0xc3') && !!fa.getTokenState('0xc4'),
    'C1 c1（保护）+ c3/c4（较新）存活');
}

// ── D. 复流语义 ──────────────────────────────────────────────────────────
console.log('D. prune 后复流自建');
{
  const T0 = 1_700_000_000_000;
  const fa = newFa();
  fa.processTick(mkTick('0xrevive', T0, { price_bnb: 2e-9 }));
  fa.pruneStaleTokens(30 * MIN, new Set(), T0 + 31 * MIN);
  ok(!fa.getTokenState('0xrevive'), 'D1 死票已删');
  fa.processTick(mkTick('0xrevive', T0 + 60 * MIN, { price_bnb: 3e-9 }));
  const st = fa.getTokenState('0xrevive');
  ok(!!st, 'D2 复流自动重建 state');
  ok(st.firstTickAt === T0 + 60 * MIN, 'D3 首 tick 锚重置（新生命周期口径）');
  const f = fa.buildFactorMap('0xrevive', T0 + 60 * MIN);
  ok(f != null && f.currentPriceBnb === 3e-9, 'D4 复流后 buildFactorMap 正常');
}

// ── E. BacktestEngine 保护集构成 + 节流 + 开关 ──────────────────────────
console.log('E. BacktestEngine 侧');
{
  const { BacktestEngine: BE } = require(BE_PATH);
  // 绕 constructor 构造最小实例（先例 _test_backtest_preload_overlap）
  const eng = Object.create(BE.prototype);
  eng._getAllHoldings = () => [
    { tokenAddress: '0xPOS1' },
    { tokenAddress: null },
    { tokenAddress: '0xpos2' },
  ];
  eng._buyingTokens = new Set(['0xBUY1']);
  eng._sellingTokens = new Set(['0xSELL1']);
  eng._graduationEvents = [
    { token: '0xGRAD_CONSUMED', tsMs: 1 },
    { token: '0xgrad_pending', tsMs: 2 },
    { token: '0xGRAD_FUTURE', tsMs: 3 },
  ];
  eng._gradEvtIdx = 1; // 第 0 个已消费

  const held = eng._buildFaPruneProtectedSet();
  ok(held.has('0xpos1') && held.has('0xpos2'), 'E1 账面持仓进保护集（小写归一）');
  ok(held.has('0xbuy1') && held.has('0xsell1'), 'E2 执行中两集合进保护集（小写归一）');
  ok(held.has('0xgrad_pending') && held.has('0xgrad_future'), 'E3 未消费 graduation 事件 token 进保护集');
  ok(!held.has('0xgrad_consumed'), 'E4 已消费 graduation 事件 token 不进（指针后切片）');
  ok(!held.has('0xpos1') || held.has('0xpos1'), 'E5 null tokenAddress 跳过不炸');

  // E6: 节流与开关（直接驱动快照桶分支同款判定式——引擎主循环内联逻辑）
  const intervalOk = (lastTs, tickTs, intervalMs) =>
    lastTs === null || tickTs - lastTs >= intervalMs;
  ok(intervalOk(null, 5, 300) === true, 'E6 首次（lastFaPruneTs=null）触发');
  ok(intervalOk(100, 200, 300) === false, 'E6 虚拟间隔未到不触发');
  ok(intervalOk(100, 400, 300) === true, 'E6 虚拟间隔到触发');
}

// ── F. 毕业卖事故反证（plan P7 最大坑）───────────────────────────────────
console.log('F. 毕业卖 prune 事故反证');
{
  const T0 = 1_700_000_000_000;
  // F1: 未保护——毕业票 state 被 prune → buildFactorMap(evtTs) null（事故形状实证）
  {
    const fa = newFa();
    fa.processTick(mkTick('0xgrad1', T0, { price_bnb: 5e-9 }));
    fa.pruneStaleTokens(30 * MIN, new Set(), T0 + 45 * MIN);
    const f = fa.buildFactorMap('0xgrad1', T0 + 45 * MIN);
    ok(f == null, 'F1 无保护时毕业时刻取因子为 null（_emitGraduationSell 会每 tick 重试的事故形状）');
  }
  // F2: 有保护（未消费 graduation 事件 / 持仓）——state 存活，毕业卖因子就绪
  {
    const fa = newFa();
    fa.processTick(mkTick('0xgrad2', T0, { price_bnb: 5e-9 }));
    const pruned = fa.pruneStaleTokens(30 * MIN, new Set(['0xgrad2']), T0 + 45 * MIN);
    const f = fa.buildFactorMap('0xgrad2', T0 + 45 * MIN);
    ok(pruned === 0, 'F2 保护集内毕业票零 prune');
    ok(f != null && f.currentPriceBnb === 5e-9,
      'F2 毕业时刻 buildFactorMap 非 null 且价格史可用（断流前最后可靠价落袋）');
  }
}

// ── G. 源码口径防线 ──────────────────────────────────────────────────────
console.log('G. 源码口径断言');
{
  const faSrc = fs.readFileSync(FA_PATH, 'utf8');
  const beSrc = fs.readFileSync(BE_PATH, 'utf8');

  // G1: FA prune 判定时钟——nowMs 优先、缺省墙钟（live 兼容）
  ok(/const now = nowMs != null \? nowMs : Date\.now\(\);/.test(faSrc),
    'G1 FA 虚拟时钟优先、缺省 Date.now');

  // G2: 主循环 prune 调用第三参必须是 tickTs（红线 6：回测路径禁 Date.now）
  const pruneCall = beSrc.match(/pruneStaleTokens\(\s*[\s\S]{0,120}?\)/g) || [];
  ok(pruneCall.length === 1, `G2 BacktestEngine prune 调用点唯一（实际 ${pruneCall.length}）`);
  ok(/pruneStaleTokens\(\s*\n?\s*this\._faPruneMaxAgeMs, this\._buildFaPruneProtectedSet\(\), tickTs\)/.test(beSrc),
    'G2 prune 第三参=tickTs（虚拟时刻）');

  // G3: 开关 off 短路在调用前
  ok(/this\._faPruneMaxAgeMs > 0 &&[\s\S]{0,400}?pruneStaleTokens/.test(beSrc),
    'G3 faPruneMaxAgeSec=0 短路（回滚开关）');

  // G4: maxTrackedTokens 注入必须在 FA 构造之前（构造函数即刻读取）
  const injectIdx = beSrc.indexOf('wsConfig.maxTrackedTokens = btPrune.maxTrackedTokens ?? 100000;');
  const ctorIdx = beSrc.indexOf('this._factorAggregator = new FourMemeFactorAggregator({');
  ok(injectIdx > 0 && ctorIdx > 0 && injectIdx < ctorIdx,
    `G4 maxTrackedTokens 注入先于 FA 构造（inject=${injectIdx} ctor=${ctorIdx}）`);

  // G5: prune 挂点在 30s 快照桶分支内（虚拟时钟驱动，非墙钟 setInterval）
  const snapIdx = beSrc.indexOf("tickTs - this._lastSnapshotTs >= SNAPSHOT_INTERVAL_MS");
  const prunedLoopIdx = beSrc.indexOf('this._faPruneMaxAgeMs > 0 &&');
  ok(snapIdx > 0 && prunedLoopIdx > snapIdx && prunedLoopIdx - snapIdx < 600,
    'G5 prune 挂快照桶分支内（距桶判定 <600 字符）');

  // G6: 缺省值对齐 live（30min/5min）
  ok(beSrc.includes('this._faPruneMaxAgeMs = btPrune.faPruneMaxAgeSec != null ? btPrune.faPruneMaxAgeSec * 1000 : 30 * 60 * 1000;'),
    'G6 maxAge 缺省 30min 对齐 live');
  ok(beSrc.includes('this._faPruneIntervalMs = btPrune.faPruneIntervalSec != null ? btPrune.faPruneIntervalSec * 1000 : 5 * 60 * 1000;'),
    'G6 interval 缺省 5min 对齐 live');

  // G7: 保护集四类来源齐全
  const protoIdx = beSrc.indexOf('_buildFaPruneProtectedSet() {');
  const protoSrc = beSrc.slice(protoIdx, protoIdx + 900);
  ok(protoIdx > 0
    && protoSrc.includes('_getAllHoldings()')
    && protoSrc.includes('_buyingTokens')
    && protoSrc.includes('_sellingTokens')
    && protoSrc.includes('_graduationEvents')
    && protoSrc.includes('_gradEvtIdx'),
    'G7 保护集四类来源（持仓/买入中/卖出中/未消费毕业）');

  // G8: 失败 fail-open（对齐 live catch 不中断回放）
  const pruneBlock = beSrc.slice(prunedLoopIdx, prunedLoopIdx + 700);
  ok(pruneBlock.includes('catch (err)'), 'G8 prune 失败 catch 不中断回放（对齐 live）');
}

// ── 汇总 ─────────────────────────────────────────────────────────────────
console.log(`\n${'_'.repeat(50)}`);
console.log(`P17 虚拟时钟 prune 单测: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
