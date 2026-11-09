#!/usr/bin/env node
/**
 * T107 市值拱形时间全清臂因子单测——**持仓期口径**（2026-11-09 用户裁定
 * 「mcapPeakBnb/secSinceMcapPeak/mcapRiseHalfSec 改为持有后的 Peak（其它的类似臂
 * 也要换）。否则如果 Peak 在持有之前，会很快卖出」）——本地零 DB 零网络。
 *
 * 三键持仓期轨道（峰=pos.highestPriceSinceBuyBnb，与 secSincePeak/
 * peakMarketCapSinceLastBuy 同门同价流：任意接受价轨——outlier（>1000× 中位数判）
 * 不推峰、chainLate 不推、尘价照推）：
 *   mcapPeakBnb     = 入场后峰价 × totalSupply（= peakMarketCapSinceLastBuy 同源同值）
 *   secSinceMcapPeak= (now − 入场后峰时刻) / 1000（now=buildFactorMap 入参，回测
 *                     =虚拟时钟，红线 6 禁 Date.now）
 *   mcapRiseHalfSec = (入场后峰时刻 − buyTime 成交锚) / 2000（X/2 预计算——条件
 *                     求值器无算术文法；fire→成交窗冲高回填使峰时刻可早于 buyTime
 *                     → max(0,·)=0=「入场即峰」）
 * 无持仓 / totalSupply 缺失 → mcapPeakBnb null 恒 false fail-closed（marketCap 族惯例）。
 * 入场即峰 → X=0 → secSinceMcapPeak >= 0 恒真：过市值门即清（忠实用户口径，非兜底）。
 *
 * ★事故形状反证（2026-11-09 用户报告「如果 Peak 在持有之前，会很快卖出」）：
 * 持有前大峰（mcap 30）+ 回落段入场（mcap 15 未过门）→ 持仓期峰 15 不过 20.1 门
 * → 不触发（旧 token 全生命口径拿持有前峰 30 过门+时间早过 → 入场即秒卖）。
 *
 * 覆盖：
 *   A. 仅注册无 tick / 有 tick 未持仓 → 三键 null + 条件 fail-closed
 *   B. 事故形状反证：持有前峰 30 过门，入场 15 未过门 → 恒 false（不再秒卖）
 *   C. 基础拱形（持仓期）：入场 15 → 持仓期涨至 25 过门（X=29s/X/2=14.5s）；
 *      时间未到 false / 时间到 true；持仓期峰不过门恒 false
 *   D. 再破新高：计时归零 + X 变大（原窗已过但不再触发）
 *   E. 不新高回落震荡：峰值时刻不动，时间到即触发
 *   F. outlier 突刺不推峰（幽灵峰不得重置计时）；尘价新高推峰（任意接受价轨）
 *   G. X=0 退化（入场即峰且过门）：过门即触发（含峰当刻 0 >= 0）
 *   H. totalSupply 缺失 → mcapPeakBnb null fail-closed（时间键独立非 null）
 *   I. 清仓后三键归 null（持仓期轨道随仓销毁）+ asOf 入参口径 + 源码口径锁
 *   J. FactorBuilder 快照透传三键（值透传 + undefined → null 不掩盖 + 源码白名单锁）
 *   K. 探针收键（getFactorKeys/getAvailableFactorIds）+ 条件四态 + 右因子缺失恒 false
 *
 * 用法：node scripts/_test_mcap_arc_exit.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const FourMemeFactorAggregator = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'));
const { buildFactorValuesForTimeSeries, getAvailableFactorIds } = require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));
const { ConditionEvaluator } = require(path.join(ROOT, 'src', 'strategies', 'ConditionEvaluator.js'));

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const T0 = 1790802000000;
const SUPPLY = 1e9;
const mkTick = (o) => Object.assign({
  token_address: '0xtoken', trade_type: 'buy', trader_address: 'w1', sender_address: null,
  price_bnb: 1.5e-8, price_usd: 0.01, bnb_amount: 1, token_amount: 1000,
  block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: 0,
}, o);

function newFA(token = '0xtoken', withSupply = true) {
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  const meta = { createdAtMs: T0, symbol: 'T', creatorAddress: null };
  if (withSupply) meta.totalSupply = SUPPLY;
  fa.registerToken(token, meta);
  return fa;
}

// T107 卖腿条件（mcap-arc-fullclose v1 同串；20.1 BNB ≈ 15K USD @745）
const COND = 'mcapPeakBnb > 20.1 AND secSinceMcapPeak >= mcapRiseHalfSec';

/** 建 FA + 峰前史 ticks + 入场（buyTime=Tbuy，入场价 entryBnb） */
function positionedFA(preTicks, entryBnb, Tbuy, withSupply = true) {
  const fa = newFA('0xtoken', withSupply);
  for (const t of preTicks) fa.processTick(mkTick(t), {});
  fa.setBuyState('0xtoken', { buyPriceBnb: entryBnb, buyPriceUsd: null, buyTime: Tbuy });
  return fa;
}

// ═══════════════ A. 未持仓 → null ═══════════════
console.log('A. 仅注册无 tick / 有 tick 未持仓 → null + fail-closed');
{
  const fa = newFA();
  const f = fa.buildFactorMap('0xtoken', T0 + 60000);
  check('A1 三键全 null（无仓=缺证据，持仓期轨道随仓存在）', () => {
    assert.strictEqual(f.mcapPeakBnb, null);
    assert.strictEqual(f.secSinceMcapPeak, null);
    assert.strictEqual(f.mcapRiseHalfSec, null);
  });
  check('A2 条件恒 false（fail-closed 不卖）', () =>
    assert.strictEqual(new ConditionEvaluator().evaluate(COND, f), false));

  // 有 tick（token 全生命峰 30 已过门）但未持仓 → 仍 null：卖腿仅持仓期评估，
  // 但本断言锁「未持仓读数不得泄漏全生命峰」（旧口径在此给 30/秒数——形状回归锚）
  const fa2 = newFA();
  fa2.processTick(mkTick({ timestamp: T0 + 1000, price_bnb: 1.5e-8, block_number: 100 }), {});
  fa2.processTick(mkTick({ timestamp: T0 + 30000, price_bnb: 3.0e-8, block_number: 101 }), {});
  const f2 = fa2.buildFactorMap('0xtoken', T0 + 100000);
  check('A3 有 tick 未持仓：三键仍 null（全生命峰 30 不泄漏进持仓期键）', () => {
    assert.strictEqual(f2.mcapPeakBnb, null);
    assert.strictEqual(f2.secSinceMcapPeak, null);
    assert.strictEqual(f2.mcapRiseHalfSec, null);
  });
}

// ═══════════════ B. 事故形状反证 ═══════════════
console.log('B. ★事故形状反证：持有前峰 30 过门，回落段入场 15 未过门 → 不再秒卖');
{
  // token 全生命：T0+1s 涨到 3.0e-8（mcap 30）后回落——旧 token 级口径下
  // mcapPeakBnb=30>20.1、secSinceMcapPeak 巨大、X/2=(30−1)/2=14.5s 早过 → 入场即清
  const fa = positionedFA([
    { timestamp: T0 + 1000, price_bnb: 1.5e-8, block_number: 100 },
    { timestamp: T0 + 30000, price_bnb: 3.0e-8, block_number: 101 },
    { timestamp: T0 + 60000, price_bnb: 1.5e-8, block_number: 102 },
  ], 1.5e-8, T0 + 100000); // 回落段入场 mcap 15（未过门；入场时刻现价=入场价）
  const f = fa.buildFactorMap('0xtoken', T0 + 100000);
  check('B1 mcapPeakBnb = 持仓期峰 15（持有前峰 30 不进键）', () =>
    assert.ok(Math.abs(f.mcapPeakBnb - 15) < 1e-6, `got ${f.mcapPeakBnb}`));
  check('B2 mcapRiseHalfSec = 0（入场即持仓期峰）', () =>
    assert.ok(Math.abs(f.mcapRiseHalfSec) < 1e-6, `got ${f.mcapRiseHalfSec}`));
  check('B3 条件 false（市值门 15<20.1 拦——事故形状不再秒卖）', () =>
    assert.strictEqual(new ConditionEvaluator().evaluate(COND, f), false));
  const f2 = fa.buildFactorMap('0xtoken', T0 + 500000);
  check('B4 之后任意时刻仍 false（持仓期峰未过门前拱形臂不武装）', () => {
    assert.ok(f2.secSinceMcapPeak > 300);
    assert.strictEqual(new ConditionEvaluator().evaluate(COND, f2), false);
  });
}

// ═══════════════ C. 基础拱形（持仓期）═══════════════
console.log('C. 基础拱形：入场 15 → 持仓期涨至 25 过门，X=29s → X/2=14.5s');
{
  const fa = positionedFA([
    { timestamp: T0 + 1000, price_bnb: 1.5e-8, block_number: 100 },
  ], 1.5e-8, T0 + 10000); // 入场 mcap 15
  fa.processTick(mkTick({ timestamp: T0 + 39000, price_bnb: 2.5e-8, block_number: 101 }), {}); // 持仓期新高 mcap 25 过门
  const f = fa.buildFactorMap('0xtoken', T0 + 49000);
  check('C1 mcapPeakBnb = 25（持仓期峰价×supply）', () =>
    assert.ok(Math.abs(f.mcapPeakBnb - 25) < 1e-6, `got ${f.mcapPeakBnb}`));
  check('C2 mcapRiseHalfSec = 14.5（(39000−10000)/2/1000，buyTime 成交锚起算）', () =>
    assert.ok(Math.abs(f.mcapRiseHalfSec - 14.5) < 1e-6, `got ${f.mcapRiseHalfSec}`));
  check('C3 secSinceMcapPeak = 10 < 14.5 → 条件 false（时间未到）', () => {
    assert.ok(Math.abs(f.secSinceMcapPeak - 10) < 1e-6, `got ${f.secSinceMcapPeak}`);
    assert.strictEqual(new ConditionEvaluator().evaluate(COND, f), false);
  });
  const f2 = fa.buildFactorMap('0xtoken', T0 + 54500);
  check('C4 流逝 15.5s ≥ 14.5s → 条件 true（拱形完成全清）', () =>
    assert.strictEqual(new ConditionEvaluator().evaluate(COND, f2), true));
  check('C5 恰 14.5s 在线上也触发（>= 含等）', () => {
    const f3 = fa.buildFactorMap('0xtoken', T0 + 53500);
    assert.ok(Math.abs(f3.secSinceMcapPeak - 14.5) < 1e-6);
    assert.strictEqual(new ConditionEvaluator().evaluate(COND, f3), true);
  });
}
console.log('C6. 持仓期峰不过门（15 BNB < 20.1）恒 false——时间再久也不清');
{
  const fa = positionedFA([
    { timestamp: T0 + 1000, price_bnb: 1.2e-8, block_number: 100 },
  ], 1.2e-8, T0 + 10000);
  const f = fa.buildFactorMap('0xtoken', T0 + 600000);
  check('C6a 持仓期峰 12 不过门：secSince 已 ~590s 仍 false', () => {
    assert.ok(Math.abs(f.mcapPeakBnb - 12) < 1e-6);
    assert.ok(f.secSinceMcapPeak >= 590);
    assert.strictEqual(new ConditionEvaluator().evaluate(COND, f), false);
  });
}

// ═══════════════ D. 再破新高重置 ═══════════════
console.log('D. 再破新高：计时归零 + X 变大');
{
  const fa = positionedFA([
    { timestamp: T0 + 1000, price_bnb: 1.5e-8, block_number: 100 },
  ], 1.5e-8, T0 + 10000);
  fa.processTick(mkTick({ timestamp: T0 + 39000, price_bnb: 2.5e-8, block_number: 101 }), {}); // mcap 25
  fa.processTick(mkTick({ timestamp: T0 + 59000, price_bnb: 3.0e-8, block_number: 102 }), {}); // 再破高 mcap 30
  const f = fa.buildFactorMap('0xtoken', T0 + 69000);
  check('D1 X 重算 = 49/2 = 24.5（buyTime→新峰 49s）', () =>
    assert.ok(Math.abs(f.mcapRiseHalfSec - 24.5) < 1e-6, `got ${f.mcapRiseHalfSec}`));
  check('D2 新峰后 10s < 24.5s → false（旧窗 20≥14.5 已过但重置后不再触发）', () => {
    assert.ok(Math.abs(f.secSinceMcapPeak - 10) < 1e-6);
    assert.strictEqual(new ConditionEvaluator().evaluate(COND, f), false);
  });
  check('D3 mcapPeakBnb 推进 = 30', () =>
    assert.ok(Math.abs(f.mcapPeakBnb - 30) < 1e-6, `got ${f.mcapPeakBnb}`));
}

// ═══════════════ E. 不新高回落震荡 ═══════════════
console.log('E. 不新高：峰值时刻不动，时间到即触发');
{
  const fa = positionedFA([
    { timestamp: T0 + 1000, price_bnb: 1.5e-8, block_number: 100 },
  ], 1.5e-8, T0 + 10000);
  fa.processTick(mkTick({ timestamp: T0 + 39000, price_bnb: 2.5e-8, block_number: 101 }), {});
  fa.processTick(mkTick({ timestamp: T0 + 59000, price_bnb: 3.0e-8, block_number: 102 }), {});
  // 回落震荡均低于峰 3.0e-8——持仓期峰值时刻保持 T0+59000
  fa.processTick(mkTick({ timestamp: T0 + 79000, price_bnb: 2.8e-8, block_number: 103 }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 84500);
  check('E1 峰值不动（mcapPeakBnb 仍 30）', () =>
    assert.ok(Math.abs(f.mcapPeakBnb - 30) < 1e-6, `got ${f.mcapPeakBnb}`));
  check('E2 流逝 25.5s ≥ 24.5s → true（回落不救，拱形完成）', () => {
    assert.ok(Math.abs(f.secSinceMcapPeak - 25.5) < 1e-6, `got ${f.secSinceMcapPeak}`);
    assert.strictEqual(new ConditionEvaluator().evaluate(COND, f), true);
  });
}

// ═══════════════ F. outlier 突刺不推峰 / 尘价新高推峰 ═══════════════
console.log('F. outlier 不推峰（>1000× 中位数拒收——_acceptPrice 窗≥3 才评）；尘价新高推峰');
{
  const fa = positionedFA([
    { timestamp: T0 + 1000, price_bnb: 1.5e-8, block_number: 100 },
  ], 1.5e-8, T0 + 10000);
  fa.processTick(mkTick({ timestamp: T0 + 39000, price_bnb: 2.5e-8, block_number: 101 }), {});
  fa.processTick(mkTick({ timestamp: T0 + 59000, price_bnb: 3.0e-8, block_number: 102 }), {});
  // 窗 [1.5e-8, 2.5e-8, 3.0e-8] 中位 2.5e-8；1e-4 = 4000× 突刺 → 离群拒收
  fa.processTick(mkTick({ timestamp: T0 + 69000, price_bnb: 1e-4, block_number: 103 }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 74500);
  check('F1 幽灵峰不进 mcapPeakBnb（仍 30 非 100000）', () =>
    assert.ok(Math.abs(f.mcapPeakBnb - 30) < 1e-6, `got ${f.mcapPeakBnb}`));
  check('F2 峰值时刻不动（secSince=15.5 自 T0+59000）', () =>
    assert.ok(Math.abs(f.secSinceMcapPeak - 15.5) < 1e-6, `got ${f.secSinceMcapPeak}`));
}
{
  const fa = positionedFA([
    { timestamp: T0 + 1000, price_bnb: 1.5e-8, block_number: 100 },
  ], 1.5e-8, T0 + 10000);
  fa.processTick(mkTick({ timestamp: T0 + 39000, price_bnb: 2.5e-8, block_number: 101 }), {});
  fa.processTick(mkTick({ timestamp: T0 + 59000, price_bnb: 3.0e-8, block_number: 102 }), {});
  // 尘量 0.0005 BNB < 可靠价尘门 0.002：不进可靠价轨但非离群 → 接受价轨推峰
  fa.processTick(mkTick({ timestamp: T0 + 99000, price_bnb: 3.5e-8, bnb_amount: 0.0005, block_number: 104 }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 109000);
  check('F3 尘价新高推进 mcapPeakBnb = 35', () =>
    assert.ok(Math.abs(f.mcapPeakBnb - 35) < 1e-6, `got ${f.mcapPeakBnb}`));
  check('F4 计时重置（secSince=10 自 T0+99000）+ X 重算 44.5', () => {
    assert.ok(Math.abs(f.secSinceMcapPeak - 10) < 1e-6, `got ${f.secSinceMcapPeak}`);
    assert.ok(Math.abs(f.mcapRiseHalfSec - 44.5) < 1e-6, `got ${f.mcapRiseHalfSec}`);
  });
}

// ═══════════════ G. X=0 退化（入场即峰且过门）═══════════════
console.log('G. X=0 退化：入场即峰票过市值门即清（忠实口径非兜底）');
{
  const fa = positionedFA([
    { timestamp: T0 + 1000, price_bnb: 1.0e-8, block_number: 100 },
  ], 3.0e-8, T0 + 2000); // 入场价即 mcap 30（>20.1）——入场即峰
  const f = fa.buildFactorMap('0xtoken', T0 + 2000);
  check('G1 X=0 → mcapRiseHalfSec=0、峰当刻 0 >= 0 → 条件 true', () => {
    assert.strictEqual(f.mcapRiseHalfSec, 0);
    assert.strictEqual(f.secSinceMcapPeak, 0);
    assert.strictEqual(new ConditionEvaluator().evaluate(COND, f), true);
  });
  const f2 = fa.buildFactorMap('0xtoken', T0 + 100000);
  check('G2 之后任意时刻恒 true（流逝 ≥ 0 恒真）', () =>
    assert.strictEqual(new ConditionEvaluator().evaluate(COND, f2), true));
}

// ═══════════════ H. totalSupply 缺失 ═══════════════
console.log('H. totalSupply 缺失 → mcapPeakBnb null fail-closed');
{
  const fa = positionedFA([
    { timestamp: T0 + 1000, price_bnb: 1.0e-8, block_number: 100 },
  ], 3.0e-8, T0 + 2000, false);
  const f = fa.buildFactorMap('0xtoken', T0 + 100000);
  check('H1 mcapPeakBnb null（marketCap 族 fail-closed）', () =>
    assert.strictEqual(f.mcapPeakBnb, null));
  check('H2 时间键独立非 null（观察键有证据即出）', () => {
    assert.ok(f.secSinceMcapPeak > 0);
    assert.ok(f.mcapRiseHalfSec >= 0);
  });
  check('H3 条件恒 false（无市值证据不卖）', () =>
    assert.strictEqual(new ConditionEvaluator().evaluate(COND, f), false));
}

// ═══════════════ I. 清仓归 null + asOf 入参口径 + 源码锁 ═══════════════
console.log('I. 清仓后三键归 null（持仓期轨道随仓销毁）+ asOf 口径 + 源码口径锁');
{
  const fa = positionedFA([
    { timestamp: T0 + 1000, price_bnb: 1.5e-8, block_number: 100 },
  ], 1.5e-8, T0 + 10000);
  fa.processTick(mkTick({ timestamp: T0 + 39000, price_bnb: 2.5e-8, block_number: 101 }), {});
  const fa1 = fa.buildFactorMap('0xtoken', T0 + 49000).secSinceMcapPeak;
  const fa2 = fa.buildFactorMap('0xtoken', T0 + 99000).secSinceMcapPeak;
  check('I1 同 state 不同 asOf：差值精确=50s（虚拟时钟驱动，回测同源）', () =>
    assert.ok(Math.abs((fa2 - fa1) - 50) < 1e-6, `${fa1} → ${fa2}`));
  fa.clearBuyState('0xtoken');
  const f3 = fa.buildFactorMap('0xtoken', T0 + 150000);
  check('I2 清仓后三键归 null（全生命峰 25 不复活）', () => {
    assert.strictEqual(f3.mcapPeakBnb, null);
    assert.strictEqual(f3.secSinceMcapPeak, null);
    assert.strictEqual(f3.mcapRiseHalfSec, null);
  });
  const src = read('src/services/FourMemeFactorAggregator.js');
  check('I3 三键映射持仓期轨道（发射式形状锁——factors 字面量零算术）', () => {
    assert.ok(src.includes('mcapPeakBnb: positionFactors.mcapPeakBnb ?? null'),
      'mcapPeakBnb 发射式形状漂移');
    assert.ok(src.includes('secSinceMcapPeak: positionFactors.secSinceMcapPeak ?? null'),
      'secSinceMcapPeak 发射式形状漂移');
    assert.ok(src.includes('mcapRiseHalfSec: positionFactors.mcapRiseHalfSec ?? null'),
      'mcapRiseHalfSec 发射式形状漂移');
  });
  check('I4 时间键用入参 now 与 buyTime 锚（源码口径锁，禁 Date.now/全生命锚）', () => {
    assert.ok(src.includes('? Math.max(0, (now - pos.highestPriceSinceBuyAt) / 1000) : null'),
      'secSinceMcapPeak 持仓期发射式形状漂移');
    assert.ok(src.includes('? Math.max(0, (pos.highestPriceSinceBuyAt - pos.buyTime) / 2000) : null'),
      'mcapRiseHalfSec 持仓期发射式形状漂移');
  });
  check('I5 旧 token 全生命发射式退役（反证锁：不得回归 state.highestPrice 口径）', () =>
    assert.ok(!src.includes('secSinceMcapPeak: state.highestPriceAt !== null'),
      '旧全生命口径残留'));
  check('I6 发射段无 Date.now', () => {
    const block = src.split('T107 持仓期化三键')[1].split('无持仓 → null fail-closed')[0];
    assert.ok(!block.includes('Date.now'), '发射段泄漏 Date.now');
  });
}

// ═══════════════ J. FactorBuilder 快照透传 ═══════════════
console.log('J. FactorBuilder 快照透传');
{
  const snap = buildFactorValuesForTimeSeries({ mcapPeakBnb: 25.5, secSinceMcapPeak: 73.5, mcapRiseHalfSec: 14.5 });
  check('J1 三键值透传', () => {
    assert.ok(Math.abs(snap.mcapPeakBnb - 25.5) < 1e-9);
    assert.ok(Math.abs(snap.secSinceMcapPeak - 73.5) < 1e-9);
    assert.ok(Math.abs(snap.mcapRiseHalfSec - 14.5) < 1e-9);
  });
  const snap2 = buildFactorValuesForTimeSeries({ profitPercent: 12 });
  check('J2 旧 FA 无键 → null 不掩盖', () => {
    assert.strictEqual(snap2.mcapPeakBnb, null);
    assert.strictEqual(snap2.secSinceMcapPeak, null);
    assert.strictEqual(snap2.mcapRiseHalfSec, null);
  });
  const fbSrc = read('src/trading-engine/core/FactorBuilder.js');
  check('J3 快照白名单源码锁（不落库即丢防线）', () => {
    assert.ok(fbSrc.includes('mcapPeakBnb: factorResults.mcapPeakBnb ?? null'));
    assert.ok(fbSrc.includes('secSinceMcapPeak: factorResults.secSinceMcapPeak ?? null'));
    assert.ok(fbSrc.includes('mcapRiseHalfSec: factorResults.mcapRiseHalfSec ?? null'));
  });
}

// ═══════════════ K. 探针收键 + 条件四态 ═══════════════
console.log('K. 探针收键 + 条件四态');
{
  const fa = newFA();
  const keys = fa.getFactorKeys();
  check('K1 getFactorKeys 含三键（三防线自动认得）', () => {
    assert.ok(keys.has('mcapPeakBnb'), [...keys].filter(k => k.includes('mcap')).join(','));
    assert.ok(keys.has('secSinceMcapPeak'));
    assert.ok(keys.has('mcapRiseHalfSec'));
  });
  check('K2 getAvailableFactorIds 含三键（条件校验可过）', () => {
    assert.ok(getAvailableFactorIds().has('mcapPeakBnb'));
    assert.ok(getAvailableFactorIds().has('secSinceMcapPeak'));
    assert.ok(getAvailableFactorIds().has('mcapRiseHalfSec'));
  });

  const ev = new ConditionEvaluator();
  check('K3 条件串可解析（右操作数因子名合法）', () => {
    ev.parseCondition(COND);
  });
  check('K4 峰 20.0 不过门（差 0.1）+ 时间到 → false', () =>
    assert.strictEqual(ev.evaluate(COND, { mcapPeakBnb: 20.0, secSinceMcapPeak: 100, mcapRiseHalfSec: 0 }), false));
  check('K5 峰过门 + 时间未到（59 < 60）→ false', () =>
    assert.strictEqual(ev.evaluate(COND, { mcapPeakBnb: 25, secSinceMcapPeak: 59, mcapRiseHalfSec: 60 }), false));
  check('K6 峰过门 + 恰在线上（60 >= 60）→ true', () =>
    assert.strictEqual(ev.evaluate(COND, { mcapPeakBnb: 25, secSinceMcapPeak: 60, mcapRiseHalfSec: 60 }), true));
  check('K7 峰过门 + 右因子缺失/undefined → false（fail-closed）', () =>
    assert.strictEqual(ev.evaluate(COND, { mcapPeakBnb: 25, secSinceMcapPeak: 100 }), false));
  check('K8 任一键 null → false', () =>
    assert.strictEqual(ev.evaluate(COND, { mcapPeakBnb: null, secSinceMcapPeak: 100, mcapRiseHalfSec: 0 }), false));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
