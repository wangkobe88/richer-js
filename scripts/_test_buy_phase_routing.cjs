#!/usr/bin/env node
/**
 * buyPhase 首买/再买路由（T100）——本地零 DB 零网络单测
 *
 * 案件（2026-10-29 Sprout 0x3319…7777 借壳案）：正主首买时点 GMGN
 * twitter_create_token_count=1 干净，issuer 分档门（C85+T73）判断正确；
 * 二次入场时点计数已被借壳者连环发币污染到 5（13 秒 4 钱包同 meta CID），
 * 再买轮误拦。裁定：首买/再买分臂——再买臂 gmgnCheckCondition 删 issuer 臂，
 * 路由显式化（buyPhase），防两臂条件分叉后首买绕门。
 *
 * 覆盖：
 *   A. loadStrategies：buyPhase 透传 / 非法值拒启 / 卖腿携带拒启 / 缺省 null
 *   B. evaluate 路由：round 0 只见 first / round 1 只见 repeat / 无标记两轮恒见 /
 *      tokenData 缺失视作 round 0（repeat 不可见）/ first 被滤掉后 repeat 顶上
 *   C. 事故现场反证（Sprout 形状锁定）：round 0 首买臂 GMGN issuer 拒时再买臂
 *      不可顶上（首买必须过 issuer 门）；round 1 再买臂被选中且条件为删臂版
 *   D. validateLegs：值域 400 / 卖腿携带 400 / 合法值放行
 *   E. 源码口径透传锁定（v15 gmgnCheckCondition 漏透传事故同款防线）：
 *      FourMeme/Backtest 装载映射文本含 buyPhase 透传
 *
 * 用法：node scripts/_test_buy_phase_routing.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { StrategyEngine } = require('../src/strategies/StrategyEngine');
const { validateLegs } = require('../src/web/services/StrategyLibraryService');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const IDS = new Set(['buyVolumeBnb']);
const leg = (over) => Object.assign({
  id: 'L', name: 'leg', action: 'buy', priority: 10, condition: 'buyVolumeBnb >= 1',
}, over);
const FACTORS = { buyVolumeBnb: 5 }; // 恒满足 condition——路由是唯一变量
const round0 = { completedPairs: [], strategyExecutions: {} };
const round1 = { completedPairs: [{ closedAt: 1 }], strategyExecutions: {} };

// ═══ A. loadStrategies 透传与值域 ═══
console.log('A. loadStrategies：buyPhase 透传 / 值域拒启');
{
  check('A1 合法值 first/repeat 透传', () => {
    const se = new StrategyEngine();
    se.loadStrategies([leg({ id: 'F', buyPhase: 'first' }), leg({ id: 'R', buyPhase: 'repeat' })], IDS);
    const byId = Object.fromEntries(se.getAllStrategies().map(s => [s.id, s]));
    assert.strictEqual(byId.F.buyPhase, 'first');
    assert.strictEqual(byId.R.buyPhase, 'repeat');
  });
  check('A2 缺省 → null（存量腿 bit 一致）', () => {
    const se = new StrategyEngine();
    se.loadStrategies([leg({})], IDS);
    assert.strictEqual(se.getAllStrategies()[0].buyPhase, null);
  });
  check('A3 非法值 → throw 拒启（fail-fast 三防线同风格）', () =>
    assert.throws(() => new StrategyEngine().loadStrategies(
      [leg({ buyPhase: 'always' })], IDS), /buyPhase 非法值/));
  check('A4 卖腿携带 → throw 拒启（无消费点显式报错）', () =>
    assert.throws(() => new StrategyEngine().loadStrategies(
      [leg({ action: 'sell', buyPhase: 'first' })], IDS), /非买腿携带 buyPhase/));
}

// ═══ B. evaluate 轮次路由 ═══
console.log('B. evaluate：round 0 只见 first / round 1 只见 repeat');
{
  const mk = (legs) => {
    const se = new StrategyEngine();
    se.loadStrategies(legs, IDS);
    return se;
  };
  const FIRST = leg({ id: 'first', priority: 1, buyPhase: 'first' });
  const REPEAT = leg({ id: 'repeat', priority: 2, buyPhase: 'repeat', gmgnCheckCondition: 'gmgnRiskCovered == 1' });
  check('B1 round 0（completedPairs 空）：first 臂被选中', () => {
    const s = mk([FIRST, REPEAT]).evaluate(FACTORS, '0xa', 1000, round0, 'buy');
    assert.strictEqual(s.id, 'first');
  });
  check('B2 round 1（全清后）：repeat 臂被选中、first 臂不可见', () => {
    const s = mk([FIRST, REPEAT]).evaluate(FACTORS, '0xa', 1000, round1, 'buy');
    assert.strictEqual(s.id, 'repeat');
  });
  check('B3 无标记腿两轮恒可见（存量 bit 一致）', () => {
    const s0 = mk([leg({ id: 'plain', priority: 1 })]).evaluate(FACTORS, '0xa', 1000, round0, 'buy');
    const s1 = mk([leg({ id: 'plain', priority: 1 })]).evaluate(FACTORS, '0xa', 1000, round1, 'buy');
    assert.strictEqual(s0.id, 'plain');
    assert.strictEqual(s1.id, 'plain');
  });
  check('B4 tokenData 缺失视作 round 0：repeat 不可见（保守防首买绕门）', () => {
    const s = mk([FIRST, REPEAT]).evaluate(FACTORS, '0xa', 1000, null, 'buy');
    assert.strictEqual(s.id, 'first');
  });
  check('B5 completedPairs 缺失（字段未挂）视作 round 0', () => {
    const s = mk([FIRST, REPEAT]).evaluate(FACTORS, '0xa', 1000, { strategyExecutions: {} }, 'buy');
    assert.strictEqual(s.id, 'first');
  });
  check('B6 round 1 下 first 腿被滤掉 → 低优先级 repeat 顶上（与 maxExecutions 跳过同构）', () => {
    const only = mk([FIRST]).evaluate(FACTORS, '0xa', 1000, round1, 'buy');
    assert.strictEqual(only, null); // 全 first 配置 round 1 无腿可见
  });
}

// ═══ C. 事故现场反证（Sprout 0x3319…7777 形状锁定）═══
console.log('C. Sprout 借壳案形状反证：首买必须过 issuer 门');
{
  // 再买臂 gmgnCheckCondition=删 issuer 臂版（T100 库条目 buy-v2-repeat 同款）
  const GMGN_REPEAT = '(marketCap < 10.7 OR gmgnBundlerWalletRatio <= 100)';
  // 首买臂=现行 buy-v2 v50 全串
  const GMGN_FIRST = '(marketCap < 10.7 OR gmgnBundlerWalletRatio <= 100) AND ((narrativeCategory IS NULL OR (narrativeCategory != \'project\' AND narrativeCategory != \'account_based_meme\' AND narrativeCategory != \'web3_native_ip_early\')) OR gmgnIssuerTokenCount <= 1)';
  const se = new StrategyEngine();
  se.loadStrategies([
    leg({ id: 'first', priority: 1, buyPhase: 'first', gmgnCheckCondition: GMGN_FIRST }),
    leg({ id: 'repeat', priority: 2, buyPhase: 'repeat', gmgnCheckCondition: GMGN_REPEAT }),
  ], IDS);
  check('C1 round 0 选中腿=首买臂（带 issuer 分档门全串）', () => {
    const s = se.evaluate(FACTORS, '0x3319', 1000, round0, 'buy');
    assert.strictEqual(s.id, 'first');
    assert.ok(s.gmgnCheckCondition.includes('gmgnIssuerTokenCount'), '首买臂条件须含 issuer 门');
  });
  check('C2 round 0 首买臂被 GMGN 拒（issuer 计数=5 污染形状）时，再买臂不可顶上——无腿可见=不买', () => {
    // round 0 下 repeat 臂恒不可见：即使首买臂因 GMGN 拒单（下游层），evaluate 也不会
    // 改选 repeat 臂（路由先于条件评估，本断言锁 evaluate 返回值本身）
    const s = se.evaluate(FACTORS, '0x3319', 1000, round0, 'buy');
    assert.notStrictEqual(s.id, 'repeat');
  });
  check('C3 round 1 选中腿=再买臂（删 issuer 臂版）', () => {
    const s = se.evaluate(FACTORS, '0x3319', 1000, round1, 'buy');
    assert.strictEqual(s.id, 'repeat');
    assert.ok(!s.gmgnCheckCondition.includes('gmgnIssuerTokenCount'), '再买臂条件须无 issuer 门');
  });
  check('C4 快票形状（Sprout 7 分钟内买→全清→再买，age<600 early 臂仍真）：再买臂 P1 须压过 early P2——否则再买轮被带 issuer 门的 early 臂遮蔽误拦', () => {
    const se2 = new StrategyEngine();
    se2.loadStrategies([
      leg({ id: 'first', priority: 1, buyPhase: 'first', condition: 'buyVolumeBnb >= 1' }),
      leg({ id: 'early', priority: 2, condition: 'buyVolumeBnb >= 1' }), // early 臂无 buyPhase 两轮恒可见
      leg({ id: 'repeat', priority: 1, buyPhase: 'repeat', condition: 'buyVolumeBnb >= 1' }),
    ], IDS);
    const s = se2.evaluate(FACTORS, '0x3319', 1000, round1, 'buy');
    assert.strictEqual(s.id, 'repeat'); // P1(repeat) < P2(early)，稳定排序数组序同为 P1 时 first 已被滤
  });
}

// ═══ D. validateLegs 值域校验（库入库 400 口径）═══
console.log('D. validateLegs：buyPhase 值域');
{
  check('D1 first 合法', () =>
    assert.strictEqual(validateLegs('buy', [
      { condition: 'profitPercent > 1', buyPhase: 'first' }]).valid, true));
  check('D2 repeat 合法', () =>
    assert.strictEqual(validateLegs('buy', [
      { condition: 'profitPercent > 1', buyPhase: 'repeat' }]).valid, true));
  check('D3 非法值 400', () =>
    assert.ok(validateLegs('buy', [
      { condition: 'profitPercent > 1', buyPhase: 'always' }])
      .errors.some(e => e.includes('buyPhase 非法值'))));
  check('D4 卖腿携带 400', () =>
    assert.ok(validateLegs('sell', [
      { condition: 'profitPercent > 1', cards: 1, buyPhase: 'first' }])
      .errors.some(e => e.includes('非买腿携带 buyPhase'))));
}

// ═══ E. 源码口径透传锁定（v15 漏透传事故防线同款）═══
console.log('E. 装载映射源码口径：buyPhase 两处透传');
{
  const fm = read('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
  const bt = read('src/trading-engine/implementations/BacktestEngine.js');
  check('E1 FourMeme 买腿映射透传 buyPhase', () =>
    assert.ok(/buyPhase: s\.buyPhase \|\| null,/.test(fm), '实时引擎映射漏 buyPhase 透传'));
  check('E2 Backtest 买腿映射透传 buyPhase', () =>
    assert.ok(/buyPhase: s\.buyPhase \|\| null,/.test(bt), '回测引擎映射漏 buyPhase 透传'));
  check('E3 路由过滤在 evaluate 内（判据 completedPairs 同源）', () => {
    const se = read('src/strategies/StrategyEngine.js');
    assert.ok(/buyPhase === 'first' && completedPairs > 0/.test(se), 'first 路由分支漂移');
    assert.ok(/buyPhase === 'repeat' && completedPairs === 0/.test(se), 'repeat 路由分支漂移');
  });
  check('E4 装载 name 后缀（signals 页区分首买/再买臂——两臂同 P1 的唯一展示位）', () => {
    assert.ok(fm.includes("'·首买'"), '实时引擎 name 缺首买后缀');
    assert.ok(fm.includes("'·再买'"), '实时引擎 name 缺再买后缀');
    assert.ok(bt.includes("'·首买'"), '回测引擎 name 缺首买后缀');
    assert.ok(bt.includes("'·再买'"), '回测引擎 name 缺再买后缀');
  });
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
