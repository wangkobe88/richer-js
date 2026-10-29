#!/usr/bin/env node
/**
 * T107 市值拱形时间全清臂因子单测（2026-10-29 用户裁定：X=首次交易→最高市值耗时；
 * 峰值市值超 15K USD（=20.1 BNB，T84 换算率 bnbUsd≈745）后距峰已流逝 ≥ X/2 秒且未再
 * 破新高 → 全部清仓）——本地零 DB 零网络。
 *
 * 三键 token 级全生命口径（与持仓期 secSincePeak/peakMarketCapSinceLastBuy 分轨）：
 *   mcapPeakBnb     = highestPriceBnb × totalSupply（峰=既有任意接受价轨峰，
 *                     与 drawdownFromHighest 同峰：outlier（>1000× 中位数判）不推峰、
 *                     chainLate 不推、尘价照推——T97 同门同价流）
 *   secSinceMcapPeak= (now − highestPriceAt) / 1000（now=buildFactorMap 入参，回测
 *                     =虚拟时钟，红线 6 禁 Date.now）
 *   mcapRiseHalfSec = (highestPriceAt − firstTickAt) / 2000（X/2 预计算——条件求值器
 *                     无算术文法，除法不能写在条件串里）
 * 无接受价/totalSupply 缺失 → null 恒 false fail-closed（marketCap 族惯例）。
 * 首峰即首 tick（开跌即峰）→ X=0 → X/2=0 → secSinceMcapPeak >= 0 恒真：过市值门即清
 * （忠实用户口径，非兜底）。首交易锚=firstTickAt 首 tick 到达序 write-once：进程晚接管/
 * 回测窗口晚于真实首交易 → X 低估提前触发（保守出场方向，trend age 家族同限）。
 *
 * 覆盖：
 *   A. 仅注册无 tick → 三键 null + 条件 fail-closed
 *   B. 基础拱形：X=29s/X/2=14.5s；时间未到 false / 时间到 true；峰值市值不过门恒 false
 *   C. 再破新高：计时归零 + X 变大（原窗已过但不再触发）
 *   D. 不新高回落震荡：峰值时刻不动，时间到即触发
 *   E. outlier 突刺不推峰（>1000× 中位数拒收——幽灵峰不得重置计时）
 *   F. 尘价新高推峰（任意接受价轨，mcap 峰与 T97 峰同门）
 *   G. X=0 退化（首 tick 即峰）：过门即触发（含峰当刻 0 >= 0）
 *   H. totalSupply 缺失 → mcapPeakBnb null fail-closed（时间键独立非 null）
 *   I. asOf 入参口径 + 源码口径锁（now 入参/X/2 除 2000/无 Date.now）
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

// T107 卖腿条件（create-v65 内联腿同串；20.1 BNB ≈ 15K USD @745）
const COND = 'mcapPeakBnb > 20.1 AND secSinceMcapPeak >= mcapRiseHalfSec';

// ═══════════════ A. 仅注册无 tick ═══════════════
console.log('A. 仅注册无 tick → null + fail-closed');
{
  const fa = newFA();
  const f = fa.buildFactorMap('0xtoken', T0 + 60000);
  check('A1 三键全 null（无接受价=缺证据）', () => {
    assert.strictEqual(f.mcapPeakBnb, null);
    assert.strictEqual(f.secSinceMcapPeak, null);
    assert.strictEqual(f.mcapRiseHalfSec, null);
  });
  check('A2 条件恒 false（fail-closed 不卖）', () =>
    assert.strictEqual(new ConditionEvaluator().evaluate(COND, f), false));
}

// ═══════════════ B. 基础拱形 ═══════════════
console.log('B. 基础拱形：X=29s → X/2=14.5s');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 1000, price_bnb: 1.5e-8, block_number: 100 }), {}); // mcap 15（不过门）
  fa.processTick(mkTick({ timestamp: T0 + 30000, price_bnb: 2.5e-8, block_number: 101 }), {}); // 新高 mcap 25 过门
  const f = fa.buildFactorMap('0xtoken', T0 + 40000);
  check('B1 mcapPeakBnb = 25（峰价×supply）', () =>
    assert.ok(Math.abs(f.mcapPeakBnb - 25) < 1e-6, `got ${f.mcapPeakBnb}`));
  check('B2 mcapRiseHalfSec = 14.5（(30000−1000)/2/1000）', () =>
    assert.ok(Math.abs(f.mcapRiseHalfSec - 14.5) < 1e-6, `got ${f.mcapRiseHalfSec}`));
  check('B3 secSinceMcapPeak = 10 < 14.5 → 条件 false（时间未到）', () => {
    assert.ok(Math.abs(f.secSinceMcapPeak - 10) < 1e-6, `got ${f.secSinceMcapPeak}`);
    assert.strictEqual(new ConditionEvaluator().evaluate(COND, f), false);
  });
  const f2 = fa.buildFactorMap('0xtoken', T0 + 45000);
  check('B4 流逝 15s ≥ 14.5s → 条件 true（拱形完成全清）', () =>
    assert.strictEqual(new ConditionEvaluator().evaluate(COND, f2), true));
  check('B5 恰 14.5s 在线上也触发（>= 含等）', () => {
    const f3 = fa.buildFactorMap('0xtoken', T0 + 44500);
    assert.ok(Math.abs(f3.secSinceMcapPeak - 14.5) < 1e-6);
    assert.strictEqual(new ConditionEvaluator().evaluate(COND, f3), true);
  });
}
console.log('B6. 峰值市值不过门（15 BNB < 20.1）恒 false——时间再久也不清');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 1000, price_bnb: 1.5e-8, block_number: 100 }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 600000);
  check('B6a 峰 15 不过门：secSince 已 599s 仍 false', () => {
    assert.ok(Math.abs(f.mcapPeakBnb - 15) < 1e-6);
    assert.ok(f.secSinceMcapPeak >= 599);
    assert.strictEqual(new ConditionEvaluator().evaluate(COND, f), false);
  });
}

// ═══════════════ C. 再破新高重置 ═══════════════
console.log('C. 再破新高：计时归零 + X 变大');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 1000, price_bnb: 1.5e-8, block_number: 100 }), {});
  fa.processTick(mkTick({ timestamp: T0 + 30000, price_bnb: 2.5e-8, block_number: 101 }), {});
  fa.processTick(mkTick({ timestamp: T0 + 50000, price_bnb: 3.0e-8, block_number: 102 }), {}); // 再破高 mcap 30
  const f = fa.buildFactorMap('0xtoken', T0 + 60000);
  check('C1 X 重算 = 49/2 = 24.5（首 tick→新峰 49s）', () =>
    assert.ok(Math.abs(f.mcapRiseHalfSec - 24.5) < 1e-6, `got ${f.mcapRiseHalfSec}`));
  check('C2 新峰后 10s < 24.5s → false（旧窗 15≥14.5 已过但重置后不再触发）', () => {
    assert.ok(Math.abs(f.secSinceMcapPeak - 10) < 1e-6);
    assert.strictEqual(new ConditionEvaluator().evaluate(COND, f), false);
  });
  check('C3 mcapPeakBnb 推进 = 30', () =>
    assert.ok(Math.abs(f.mcapPeakBnb - 30) < 1e-6, `got ${f.mcapPeakBnb}`));
}

// ═══════════════ D. 不新高回落震荡 ═══════════════
console.log('D. 不新高：峰值时刻不动，时间到即触发');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 1000, price_bnb: 1.5e-8, block_number: 100 }), {});
  fa.processTick(mkTick({ timestamp: T0 + 30000, price_bnb: 2.5e-8, block_number: 101 }), {});
  fa.processTick(mkTick({ timestamp: T0 + 50000, price_bnb: 3.0e-8, block_number: 102 }), {});
  // 回落震荡均低于峰 3.0e-8——峰值时刻保持 T0+50000
  fa.processTick(mkTick({ timestamp: T0 + 70000, price_bnb: 2.8e-8, block_number: 103 }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 75000);
  check('D1 峰值不动（mcapPeakBnb 仍 30）', () =>
    assert.ok(Math.abs(f.mcapPeakBnb - 30) < 1e-6, `got ${f.mcapPeakBnb}`));
  check('D2 流逝 25s ≥ 24.5s → true（回落不救，拱形完成）', () => {
    assert.ok(Math.abs(f.secSinceMcapPeak - 25) < 1e-6, `got ${f.secSinceMcapPeak}`);
    assert.strictEqual(new ConditionEvaluator().evaluate(COND, f), true);
  });
}

// ═══════════════ E. outlier 突刺不推峰 ═══════════════
console.log('E. outlier 不推峰（>1000× 中位数拒收——_acceptPrice 窗≥3 才评）');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 1000, price_bnb: 1.5e-8, block_number: 100 }), {});
  fa.processTick(mkTick({ timestamp: T0 + 30000, price_bnb: 2.5e-8, block_number: 101 }), {});
  fa.processTick(mkTick({ timestamp: T0 + 50000, price_bnb: 3.0e-8, block_number: 102 }), {});
  // 窗 [1.5e-8, 2.5e-8, 3.0e-8] 中位 2.5e-8；1e-4 = 4000× 突刺 → 离群拒收
  fa.processTick(mkTick({ timestamp: T0 + 60000, price_bnb: 1e-4, block_number: 103 }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 65000);
  check('E1 幽灵峰不进 mcapPeakBnb（仍 30 非 100000）', () =>
    assert.ok(Math.abs(f.mcapPeakBnb - 30) < 1e-6, `got ${f.mcapPeakBnb}`));
  check('E2 峰值时刻不动（secSince=15 自 T0+50000）', () =>
    assert.ok(Math.abs(f.secSinceMcapPeak - 15) < 1e-6, `got ${f.secSinceMcapPeak}`));
}

// ═══════════════ F. 尘价新高推峰（任意接受价轨）═══════════════
console.log('F. 尘价新高推峰——mcap 峰与 T97 峰同门同价流（尘不卡尘门）');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 1000, price_bnb: 1.5e-8, block_number: 100 }), {});
  fa.processTick(mkTick({ timestamp: T0 + 30000, price_bnb: 2.5e-8, block_number: 101 }), {});
  fa.processTick(mkTick({ timestamp: T0 + 50000, price_bnb: 3.0e-8, block_number: 102 }), {});
  // 尘量 0.0005 BNB < 可靠价尘门 0.002：不进可靠价轨但非离群 → 接受价轨推峰
  fa.processTick(mkTick({ timestamp: T0 + 90000, price_bnb: 3.5e-8, bnb_amount: 0.0005, block_number: 104 }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 100000);
  check('F1 尘价新高推进 mcapPeakBnb = 35', () =>
    assert.ok(Math.abs(f.mcapPeakBnb - 35) < 1e-6, `got ${f.mcapPeakBnb}`));
  check('F2 计时重置（secSince=10 自 T0+90000）+ X 重算 44.5', () => {
    assert.ok(Math.abs(f.secSinceMcapPeak - 10) < 1e-6, `got ${f.secSinceMcapPeak}`);
    assert.ok(Math.abs(f.mcapRiseHalfSec - 44.5) < 1e-6, `got ${f.mcapRiseHalfSec}`);
  });
}

// ═══════════════ G. X=0 退化（首 tick 即峰）═══════════════
console.log('G. X=0 退化：开跌即峰票过市值门即清（忠实口径非兜底）');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 1000, price_bnb: 3.0e-8, block_number: 100 }), {}); // 首 tick 即峰 mcap 30
  const f = fa.buildFactorMap('0xtoken', T0 + 1000);
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
  const fa = newFA('0xtoken', false);
  fa.processTick(mkTick({ timestamp: T0 + 1000, price_bnb: 3.0e-8, block_number: 100 }), {});
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

// ═══════════════ I. asOf 入参口径 + 源码锁 ═══════════════
console.log('I. asOf 入参口径（禁 Date.now）+ 源码口径锁');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 1000, price_bnb: 1.5e-8, block_number: 100 }), {});
  fa.processTick(mkTick({ timestamp: T0 + 30000, price_bnb: 2.5e-8, block_number: 101 }), {});
  const fa1 = fa.buildFactorMap('0xtoken', T0 + 40000).secSinceMcapPeak;
  const fa2 = fa.buildFactorMap('0xtoken', T0 + 90000).secSinceMcapPeak;
  check('I1 同 state 不同 asOf：差值精确=50s（虚拟时钟驱动，回测同源）', () =>
    assert.ok(Math.abs((fa2 - fa1) - 50) < 1e-6, `${fa1} → ${fa2}`));
  const src = read('src/services/FourMemeFactorAggregator.js');
  check('I2 发射式用入参 now 非时钟（源码口径锁）', () =>
    assert.ok(src.includes('secSinceMcapPeak: state.highestPriceAt !== null')
      && src.includes('? Math.max(0, (now - state.highestPriceAt) / 1000) : null'),
      'secSinceMcapPeak 发射式形状漂移'));
  check('I3 X/2 = (峰时刻−首tick)/2000（除法预计算锁——求值器无算术文法）', () =>
    assert.ok(src.includes('? Math.max(0, (state.highestPriceAt - state.firstTickAt) / 2000) : null'),
      'mcapRiseHalfSec 发射式形状漂移'));
  check('I4 三键发射段无 Date.now', () => {
    const block = src.split('T107 市值拱形时间全清臂')[1].split('── WSS 事件流口径')[0];
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
