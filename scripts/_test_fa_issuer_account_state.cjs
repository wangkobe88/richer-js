#!/usr/bin/env node
/**
 * C166 issuerAccountState FA 因子单测（2026-10-22 一次性专号 rug 家族案）——本地零 DB 零网络。
 *
 * 三件套（模块级 Map）+ _buildFactorMap 字面量投影：'active'|'deleted'|'tweets_gone'|null。
 * null=未检测/无宣告账号/API 故障 unknown（fail-open）→ 卖臂 == 'deleted' 恒 false 不误卖。
 *
 * 覆盖：
 *   A. set/get/clear 生命周期
 *   B. buildFactorMap 投影（未回填 null/三态透传/unknown→null/per-token 隔离）
 *   C. 真 ConditionEvaluator 真值表（卖臂条件串 + null fail-closed 事故反证：
 *      `!= 'x'` 对 null 恒 false——ConditionEvaluator null 语义红线）
 *   D. getFactorKeys 探针收录（三防线自动认得）
 *   E. 源码口径反证（FA 注入块零 Date.now / 回测不接线零 setAccountHealthFactors）
 *
 * 用法：node scripts/_test_fa_issuer_account_state.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const FourMemeFactorAggregator = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'));
const { ConditionEvaluator } = require(path.join(ROOT, 'src', 'strategies', 'ConditionEvaluator'));

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const T0 = 1790802000000;
const ADDR = '0xtok_ah';
const ADDR2 = '0xtok_ah2';
function newFA() {
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  fa.registerToken(ADDR, { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  fa.processTick({
    token_address: ADDR, trade_type: 'buy', trader_address: 'wA', sender_address: null,
    price_bnb: 0.00001, price_usd: 5, bnb_amount: 1, token_amount: 1000,
    block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: 0,
  }, {});
  return fa;
}
function cleanMap() {
  FourMemeFactorAggregator.clearAccountHealthFactors(ADDR);
  FourMemeFactorAggregator.clearAccountHealthFactors(ADDR2);
}

// ═══════════════ A. 生命周期 ═══════════════
console.log('A. set/get/clear 生命周期');
{
  const fa = newFA();
  check('A1 未回填 get=null', () =>
    assert.strictEqual(FourMemeFactorAggregator.getAccountHealthFactors(ADDR), null));
  check('A2 set 返回 true 且 get 整包返回（unknown 原值保留供审计）', () => {
    assert.strictEqual(FourMemeFactorAggregator.setAccountHealthFactors(ADDR,
      { state: 'unknown', checkedAt: T0 }), true);
    const g = FourMemeFactorAggregator.getAccountHealthFactors(ADDR);
    assert.deepStrictEqual([g.state, g.checkedAt], ['unknown', T0]);
  });
  check('A3 clear 返回 true 且 get=null；不存在返回 false', () => {
    assert.strictEqual(FourMemeFactorAggregator.clearAccountHealthFactors(ADDR), true);
    assert.strictEqual(FourMemeFactorAggregator.getAccountHealthFactors(ADDR), null);
    assert.strictEqual(FourMemeFactorAggregator.clearAccountHealthFactors(ADDR), false);
  });
  check('A4 空 tokenAddress set 拒绝返回 false（防 null 键污染）', () =>
    assert.strictEqual(FourMemeFactorAggregator.setAccountHealthFactors('', { state: 'deleted' }), false));
  check('A5 空地址不炸 build（tokenAddress 键健全性由引擎保证）', () =>
    assert.strictEqual(fa.buildFactorMap(ADDR, T0 + 2000).issuerAccountState, null));
  cleanMap();
}

// ═══════════════ B. buildFactorMap 投影 ═══════════════
console.log('B. buildFactorMap 投影');
{
  const fa = newFA();
  check('B1 未回填 → null', () =>
    assert.strictEqual(fa.buildFactorMap(ADDR, T0 + 2000).issuerAccountState, null));
  check('B2 active 透传', () => {
    FourMemeFactorAggregator.setAccountHealthFactors(ADDR, { state: 'active', checkedAt: T0 });
    assert.strictEqual(fa.buildFactorMap(ADDR, T0 + 2000).issuerAccountState, 'active');
  });
  check('B3 deleted 透传（卖臂触发形状）', () => {
    FourMemeFactorAggregator.setAccountHealthFactors(ADDR, { state: 'deleted', checkedAt: T0 });
    assert.strictEqual(fa.buildFactorMap(ADDR, T0 + 2000).issuerAccountState, 'deleted');
  });
  check('B4 tweets_gone 透传（卖臂触发形状）', () => {
    FourMemeFactorAggregator.setAccountHealthFactors(ADDR, { state: 'tweets_gone', checkedAt: T0 });
    assert.strictEqual(fa.buildFactorMap(ADDR, T0 + 2000).issuerAccountState, 'tweets_gone');
  });
  check('B5 unknown（API 故障）投影 null——与未检测不可区分（故障不产生信号形状）', () => {
    FourMemeFactorAggregator.setAccountHealthFactors(ADDR, { state: 'unknown', checkedAt: T0 });
    assert.strictEqual(fa.buildFactorMap(ADDR, T0 + 2000).issuerAccountState, null);
    // 审计侧保留原值
    assert.strictEqual(FourMemeFactorAggregator.getAccountHealthFactors(ADDR).state, 'unknown');
  });
  check('B6 per-token 隔离（A2 token 未回填不受 A1 回填影响）', () => {
    FourMemeFactorAggregator.setAccountHealthFactors(ADDR, { state: 'deleted', checkedAt: T0 });
    assert.strictEqual(FourMemeFactorAggregator.getAccountHealthFactors(ADDR2), null);
  });
  check('B7 clear 后 build 回 null', () => {
    FourMemeFactorAggregator.clearAccountHealthFactors(ADDR);
    assert.strictEqual(fa.buildFactorMap(ADDR, T0 + 2000).issuerAccountState, null);
  });
  cleanMap();
}

// ═══════════════ C. 真 ConditionEvaluator 真值表 ═══════════════
console.log('C. 卖臂条件真值表（真 ConditionEvaluator）');
{
  const ce = new ConditionEvaluator();
  const faC = newFA();
  const COND = "issuerAccountState == 'deleted' OR issuerAccountState == 'tweets_gone'";
  const parsed = ce.parseCondition(COND);
  check('C1 卖臂条件串 parse 成功且对 FA 全键集 validate 零错误（三防线自动认得）', () => {
    const keys = faC.getFactorKeys();
    assert.ok(keys.has('issuerAccountState'), '探针未收键');
    const { valid, errors } = ce.validateCondition(parsed, keys);
    assert.ok(valid, `validate 失败: ${JSON.stringify(errors)}`);
  });
  const ev = (ctx) => ce.evaluate(parsed, ctx);
  check('C2 未检测（null）→ false（fail-closed 不误卖）', () =>
    assert.strictEqual(ev({ issuerAccountState: null }), false));
  check('C3 active → false（账号健康不卖）', () =>
    assert.strictEqual(ev({ issuerAccountState: 'active' }), false));
  check('C4 deleted → true（删号全清）', () =>
    assert.strictEqual(ev({ issuerAccountState: 'deleted' }), true));
  check('C5 tweets_gone → true（删推全清）', () =>
    assert.strictEqual(ev({ issuerAccountState: 'tweets_gone' }), true));
  check('C6 事故反证：null 对任何比较（含 !=）恒 false——`!= \'active\'` 不得当卖臂', () => {
    const p2 = ce.parseCondition("issuerAccountState != 'active'");
    assert.strictEqual(ce.evaluate(p2, { issuerAccountState: null }), false);
    assert.strictEqual(ce.evaluate(p2, { issuerAccountState: 'deleted' }), true);
  });
  check('C7 FA 全键 context 下真值表一致（探针键集含 issuerAccountState）', () => {
    const keys = faC.getFactorKeys();
    assert.ok(keys.has('issuerAccountState'), '探针未收键');
    for (const [v, want] of [[null, false], ['active', false], ['deleted', true], ['tweets_gone', true]]) {
      const ctx = Object.fromEntries([...keys].map(k => [k, null]));
      ctx.issuerAccountState = v;
      assert.strictEqual(ev(ctx), want, `state=${v}`);
    }
  });
  cleanMap();
}

// ═══════════════ D. getFactorKeys 探针 ═══════════════
console.log('D. getFactorKeys 探针收录');
{
  const fa = newFA();
  check('D1 探针收键（三防线 loadStrategies/validateLegs 自动认得，零校验改动）', () =>
    assert.ok(fa.getFactorKeys().has('issuerAccountState')));
  check('D2 buildFactorMap 输出键与探针一致', () => {
    const f = fa.buildFactorMap(ADDR, T0 + 2000);
    assert.ok('issuerAccountState' in f);
  });
}

// ═══════════════ E. 源码口径反证 ═══════════════
console.log('E. 源码口径反证');
{
  check('E1 FA 注入块零 Date.now（纯投影无周期判定）', () => {
    const src = read('src/services/FourMemeFactorAggregator.js');
    const start = src.indexOf('── 账号信息复检注入（C166'); // build 块锚（:248 模块注释同名，── 前缀唯一定位）
    const blk = src.slice(start, src.indexOf('return factors;', start));
    assert.ok(blk.length > 0 && blk.length < 2000, '块提取失败（过长=锚错位）');
    const code = blk.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // 剥注释（注释本身提及红线措辞）
    assert.ok(!code.includes('Date.now'), '注入块出现 Date.now');
  });
  check('E2 回测不接线：BacktestEngine 零 setAccountHealthFactors（时序穿越防线，gwp 同款）', () => {
    const src = read('src/trading-engine/implementations/BacktestEngine.js');
    assert.ok(!src.includes('setAccountHealthFactors'), '回测引擎出现复检接线');
    assert.ok(!src.includes('AccountHealthMonitor'), '回测引擎出现 Monitor');
  });
  check('E3 引擎接线存在（FourMemeWssTradingEngine 消费三件套）', () => {
    const src = read('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
    assert.ok(src.includes('setAccountHealthFactors'));
    assert.ok(src.includes('clearAccountHealthFactors'));
    assert.ok(src.includes('AccountHealthMonitor'));
  });
  check('E4 FactorBuilder 快照白名单透传（不落库即丢）', () => {
    const src = read('src/trading-engine/core/FactorBuilder.js');
    assert.ok(src.includes('issuerAccountState: factorResults.issuerAccountState ?? null'));
  });
  cleanMap();
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
