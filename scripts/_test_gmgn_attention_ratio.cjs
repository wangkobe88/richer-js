#!/usr/bin/env node
/**
 * 注意力空转观测键单测（T76 2026-10-27）——本地零 DB 零网络。
 *
 * 用户裁定判据：「VC 高但买入者少 / 买入量小」=获得了注意力但没有吸引力
 * （visiting count 高=GMGN 侧有人看，链上买盘不跟）。
 *
 * 键族（纯观察不进条件串，阈值须票池分布裁定——同 T74 纪律）：
 *   - FA：buyWallets（独立买入钱包数=K 组 _buyerAddresses 全史 Set size；曾买入
 *     即计入、清仓不回退；与 buyVolumeBnb 同刻同源）
 *   - GMGN 层：gmgnBuyWallets / gmgnBuyVolumeBnb（原料透传）+ gmgnVisitorsPerBuyer
 *     （访客÷买家）/ gmgnVisitorsPerBuyBnb（访客÷买入 BNB）——本层新鲜 vc 与 fire
 *     因子表买盘现算；buyWallets=0 且 vc>0 → 取 vc（零买家全额空转上限形状）；
 *     vc=0 → 0（无注意力可观察）；covered≠1 → 比值 0 不合成（fail-open 形状一致）
 *
 * 同批清理反证：gmgnWhaleWallets / gmgnCreatorCreatedCount 两观测键删除
 * （10-24 起 47 票 BUY 信号全零=零区分度，用户裁定；同一次响应字段，删除不省
 * API 配额——省映射与审计体积；历史快照行含旧键被忽略）。
 *
 * 覆盖：
 *   A. computeGmgnAttentionFactors 纯函数真值表（各零值/round1/零买家上限形状/covered 门）
 *   B. checkAndEvaluate 第六参集成（context 合成+metadata factors 可见；第六参缺省
 *      不并键=存量零影响；context spread 拷贝不污染 TTL 缓存对象）
 *   C. FA buyWallets（复买幂等/清仓不回退/null wallet 行不计/defer 两阶段 parity）
 *   D. 键集与表达式（GMGN_CONDITION_FACTOR_KEYS 含四键、FA getFactorKeys 收
 *      buyWallets、ConditionEvaluator 可求值、FactorBuilder 快照透传）
 *   E. 源码口径断言（引擎实时调用点传第六参/回测组装点 spread 同构/whale-creator
 *      三文件防复活反证）
 *
 * 用法：node scripts/_test_gmgn_attention_ratio.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const FourMemeFactorAggregator = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'));
const { GmgnRiskCheckService, GMGN_CONDITION_FACTOR_KEYS } = require(path.join(ROOT, 'src', 'trading-engine', 'pre-check', 'GmgnRiskCheckService.js'));
const { mapGmgnRiskFactors } = require(path.join(ROOT, 'src', 'trading-engine', 'pre-check', 'NarrativeDirectCaller.js'));
const { buildFactorValuesForTimeSeries } = require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));
const { ConditionEvaluator } = require(path.join(ROOT, 'src', 'strategies', 'ConditionEvaluator.js'));

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

async function main() {
console.log('== A. computeGmgnAttentionFactors 纯函数真值表 ==');
const C = GmgnRiskCheckService.computeGmgnAttentionFactors;
check('正常形状：vc=50 / 3 买家 / 2.5 BNB → 16.7 / 20.0 + 原料透传',
  () => assert.deepStrictEqual(
    C({ gmgnRiskCovered: 1, gmgnVisitingCount: 50 }, 3, 2.5),
    { gmgnBuyWallets: 3, gmgnBuyVolumeBnb: 2.5, gmgnVisitorsPerBuyer: 16.7, gmgnVisitorsPerBuyBnb: 20 }));
check('用户判据现场形状：vc 高买入者少（vc=200 / 1 买家）→ perBuyer 200 空转极值',
  () => assert.strictEqual(C({ gmgnRiskCovered: 1, gmgnVisitingCount: 200 }, 1, 0.3).gmgnVisitorsPerBuyer, 200));
check('零买家上限形状：buyWallets=0 且 vc>0 → 比值取 vc（有数不 null）',
  () => assert.deepStrictEqual(
    C({ gmgnRiskCovered: 1, gmgnVisitingCount: 37 }, 0, 1.2),
    { gmgnBuyWallets: 0, gmgnBuyVolumeBnb: 1.2, gmgnVisitorsPerBuyer: 37, gmgnVisitorsPerBuyBnb: 30.8 }));
check('零买入量上限形状：buyVolumeBnb=0 且 vc>0 → perBuyBnb 取 vc',
  () => assert.strictEqual(C({ gmgnRiskCovered: 1, gmgnVisitingCount: 9 }, 4, 0).gmgnVisitorsPerBuyBnb, 9));
check('vc=0（死盘/秒新盘）→ 两比值 0（正常新票形状，<=N 门恒过放行）',
  () => assert.deepStrictEqual(
    C({ gmgnRiskCovered: 1, gmgnVisitingCount: 0 }, 5, 3),
    { gmgnBuyWallets: 5, gmgnBuyVolumeBnb: 3, gmgnVisitorsPerBuyer: 0, gmgnVisitorsPerBuyBnb: 0 }));
check('covered=0（fail-open 路径）→ 比值 0 不合成，原料照透传（metadata 对照可见）',
  () => assert.deepStrictEqual(
    C({ gmgnRiskCovered: 0, gmgnVisitingCount: 88 }, 6, 4),
    { gmgnBuyWallets: 6, gmgnBuyVolumeBnb: 4, gmgnVisitorsPerBuyer: 0, gmgnVisitorsPerBuyBnb: 0 }));
check('null/非有限数输入 → 归 0（买盘缺失不 NaN）',
  () => assert.deepStrictEqual(
    C({ gmgnRiskCovered: 1, gmgnVisitingCount: 10 }, null, undefined),
    { gmgnBuyWallets: 0, gmgnBuyVolumeBnb: 0, gmgnVisitorsPerBuyer: 10, gmgnVisitorsPerBuyBnb: 10 }));
check('round1：vc=20 / 3 买家 → 6.7（非 6.6666…）',
  () => assert.strictEqual(C({ gmgnRiskCovered: 1, gmgnVisitingCount: 20 }, 3, 1).gmgnVisitorsPerBuyer, 6.7));

console.log('== B. checkAndEvaluate 第六参集成（check() 打桩零网络） ==');
function stubbedService(factors) {
  const svc = new GmgnRiskCheckService({}, null);
  let cached = factors;                       // 模拟 TTL 缓存里的共享对象
  svc.check = async () => cached;
  return svc;
}
check('第六参透传 → factors 含四键（metadata 审计可见）',
  async () => {
    const svc = stubbedService({ covered: 1, gmgnRiskCovered: 1, gmgnVisitingCount: 40, gmgnIssuerTokenCount: 0, gmgnBundlerWalletRatio: 0, fromCache: false, failReason: null });
    const r = await svc.checkAndEvaluate('0xt', 'bsc', 'gmgnVisitingCount >= 1', null, null, { buyWallets: 4, buyVolumeBnb: 2 });
    assert.strictEqual(r.factors.gmgnVisitorsPerBuyer, 10);
    assert.strictEqual(r.factors.gmgnVisitorsPerBuyBnb, 20);
    assert.strictEqual(r.factors.gmgnBuyWallets, 4);
    assert.strictEqual(r.factors.gmgnBuyVolumeBnb, 2);
    assert.strictEqual(r.passed, true);
  });
check('第六参缺省（存量调用形状）→ 不并键（buyContext 键不在 factors）',
  async () => {
    const svc = stubbedService({ covered: 1, gmgnRiskCovered: 1, gmgnVisitingCount: 40, fromCache: false, failReason: null });
    const r = await svc.checkAndEvaluate('0xt', 'bsc', 'gmgnRiskCovered == 1', null, null);
    assert.ok(!('gmgnVisitorsPerBuyer' in r.factors));
    assert.ok(!('gmgnBuyWallets' in r.factors));
  });
check('context spread 拷贝——合成键不写回 TTL 缓存共享对象',
  async () => {
    const cachedObj = { covered: 1, gmgnRiskCovered: 1, gmgnVisitingCount: 40, fromCache: false, failReason: null };
    const svc = stubbedService(cachedObj);
    await svc.checkAndEvaluate('0xt', 'bsc', 'gmgnRiskCovered == 1', null, null, { buyWallets: 4, buyVolumeBnb: 2 });
    assert.ok(!('gmgnVisitorsPerBuyer' in cachedObj), '缓存对象不得被合成键污染（下次 TTL 命中会带陈旧比值）');
  });
check('covered=0 fail-open → 不评表达式放行（evaluated=false），键不合成',
  async () => {
    const svc = stubbedService({ covered: 0, gmgnRiskCovered: 0, gmgnVisitingCount: 0, failReason: 'cooldown', fromCache: false });
    const r = await svc.checkAndEvaluate('0xt', 'bsc', 'gmgnVisitorsPerBuyer <= 50', null, null, { buyWallets: 0, buyVolumeBnb: 0 });
    assert.strictEqual(r.passed, true);
    assert.strictEqual(r.evaluated, false);
    assert.strictEqual(r.factors.gmgnVisitorsPerBuyer, 0);
  });

console.log('== C. FA buyWallets（_buyerAddresses 全史 Set） ==');
const T0 = 1790802000000;
const mkTick = (o) => Object.assign({
  token_address: '0xtoken', trade_type: 'buy', trader_address: null, sender_address: null,
  price_bnb: 0.00001, price_usd: 5, bnb_amount: 1, token_amount: 1000000,
  block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: 0,
}, o);
function newFA() {
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  return fa;
}
check('三个钱包买入 → buyWallets=3（与 buyVolumeBnb 同刻同源）',
  () => {
    const fa = newFA();
    fa.processTick(mkTick({ sender_address: 'w1', token_amount: 100000, bnb_amount: 0.1 }), {});
    fa.processTick(mkTick({ sender_address: 'w2', token_amount: 200000, bnb_amount: 0.2 }), {});
    fa.processTick(mkTick({ sender_address: 'w3', token_amount: 300000, bnb_amount: 0.3 }), {});
    const f = fa.buildFactorMap('0xtoken', T0 + 5000);
    assert.strictEqual(f.buyWallets, 3);
    assert.ok(Math.abs(f.buyVolumeBnb - 0.6) < 1e-9, `buyVolumeBnb=${f.buyVolumeBnb}`);
  });
check('复买幂等：w1 买 3 次 → 仍计 1 钱包',
  () => {
    const fa = newFA();
    for (let i = 0; i < 3; i++) fa.processTick(mkTick({ sender_address: 'w1', token_amount: 100000, bnb_amount: 0.1, block_number: 100 + i }), {});
    const f = fa.buildFactorMap('0xtoken', T0 + 5000);
    assert.strictEqual(f.buyWallets, 1);
  });
check('全史=曾买入即计入：w2 清仓卖光 → buyWallets 不回退（与 holderCount 分母分离）',
  () => {
    const fa = newFA();
    fa.processTick(mkTick({ sender_address: 'w1', token_amount: 100000, bnb_amount: 0.1 }), {});
    fa.processTick(mkTick({ sender_address: 'w2', token_amount: 100000, bnb_amount: 0.1 }), {});
    fa.processTick(mkTick({ trade_type: 'sell', sender_address: 'w2', token_amount: 100000, bnb_amount: 0.1 }), {});
    const f = fa.buildFactorMap('0xtoken', T0 + 5000);
    assert.strictEqual(f.buyWallets, 2);
    assert.strictEqual(f.holders, 1);
  });
check('null wallet 行不计（sender/trader 双缺）',
  () => {
    const fa = newFA();
    fa.processTick(mkTick({ sender_address: 'w1', token_amount: 100000, bnb_amount: 0.1 }), {});
    fa.processTick(mkTick({ token_amount: 100000, bnb_amount: 0.1 }), {});
    const f = fa.buildFactorMap('0xtoken', T0 + 5000);
    assert.strictEqual(f.buyWallets, 1);
  });
check('defer 两阶段 parity：价格段 deferWallet 喂 + applyWalletTick 补 wallet 段 → 计数一致',
  () => {
    const fa1 = newFA();
    const fa2 = newFA();
    // 直推路径
    for (const w of ['w1', 'w2', 'w3']) fa1.processTick(mkTick({ sender_address: w, token_amount: 100000, bnb_amount: 0.1 }), {});
    // defer 两阶段：价格段不带 sender（resolver 回查前），pushRow 回推补真 wallet
    const ticks = ['w1', 'w2', 'w3'].map((w, i) => mkTick({ sender_address: w, token_amount: 100000, bnb_amount: 0.1, block_number: 200 + i }));
    for (const t of ticks) fa2.processTick({ ...t, sender_address: null, trader_address: 'router' }, { deferWallet: true, emitFactors: false });
    for (const t of ticks) fa2.applyWalletTick(t, { emitFactors: false });
    const f1 = fa1.buildFactorMap('0xtoken', T0 + 5000);
    const f2 = fa2.buildFactorMap('0xtoken', T0 + 5000);
    assert.strictEqual(f2.buyWallets, 3);
    assert.strictEqual(f2.buyWallets, f1.buyWallets);
  });

console.log('== D. 键集与表达式 ==');
check('GMGN_CONDITION_FACTOR_KEYS 含四键（条件可引用；观察期不部署条件串）',
  () => {
    for (const k of ['gmgnBuyWallets', 'gmgnBuyVolumeBnb', 'gmgnVisitorsPerBuyer', 'gmgnVisitorsPerBuyBnb'])
      assert.ok(GMGN_CONDITION_FACTOR_KEYS.includes(k), `缺 ${k}`);
  });
check('FA getFactorKeys 收 buyWallets（探针自动收键）',
  () => assert.ok(newFA().getFactorKeys().has('buyWallets')));
check('ConditionEvaluator 可求值（观察门形状：空转极高 → 拦；正常 → 放）',
  () => {
    const ev = new ConditionEvaluator();
    const ctx = { ...mapGmgnRiskFactors({ issuerTokenCount: 1, bundlerWallets: 2, topWallets: 40, visitingCount: 120 }),
      ...C({ gmgnRiskCovered: 1, gmgnVisitingCount: 120 }, 2, 0.8) };
    assert.strictEqual(ev.evaluate('gmgnVisitorsPerBuyer <= 50', ctx), false);   // 60 → 拦
    assert.strictEqual(ev.evaluate('gmgnVisitorsPerBuyBnb <= 100', ctx), false); // 150 → 拦
    const healthy = { ...mapGmgnRiskFactors({ issuerTokenCount: 1, bundlerWallets: 0, topWallets: 40, visitingCount: 30 }),
      ...C({ gmgnRiskCovered: 1, gmgnVisitingCount: 30 }, 15, 6) };
    assert.strictEqual(ev.evaluate('gmgnVisitorsPerBuyer <= 50', healthy), true);  // 2 → 放
    assert.strictEqual(ev.evaluate('gmgnVisitorsPerBuyBnb <= 100', healthy), true); // 5 → 放
  });
check('FactorBuilder 时序快照透传 buyWallets（不落库即丢防线；旧 FA → null 不掩盖）',
  () => {
    const snap = buildFactorValuesForTimeSeries({ buyWallets: 7, buyVolumeBnb: 3.2 });
    assert.strictEqual(snap.buyWallets, 7);
    assert.strictEqual(buildFactorValuesForTimeSeries({}).buyWallets, null);
  });

console.log('== E. 源码口径断言 ==');
check('引擎实时调用点传第六参（fire 因子表 buyWallets/buyVolumeBnb 同刻同源）',
  () => {
    const src = read('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
    assert.ok(/buyWallets: factorResults\?\.buyWallets \?\? 0,/.test(src), '第六参 buyContext 缺失');
    assert.ok(/buyVolumeBnb: factorResults\?\.buyVolumeBnb \?\? 0,/.test(src), '第六参 buyVolumeBnb 缺失');
  });
check('回测组装点 spread computeGmgnAttentionFactors（回放同构单一真相）',
  () => assert.ok(/computeGmgnAttentionFactors\(/.test(read('src/trading-engine/implementations/BacktestEngine.js')), '回测挂点缺失'));
check('T76 清理防复活：service/mapper/risk-fields 三文件无 whale/creator 键定义（`键:` 形状；注释提及不算）',
  () => {
    for (const p of ['src/trading-engine/pre-check/GmgnRiskCheckService.js',
      'src/trading-engine/pre-check/NarrativeDirectCaller.js',
      'src/core/gmgn-api/risk-fields.js']) {
      const src = read(p);
      assert.ok(!/gmgnWhaleWallets\s*:/.test(src), `${p} 含已删 gmgnWhaleWallets 键定义`);
      assert.ok(!/gmgnCreatorCreatedCount\s*:/.test(src), `${p} 含已删 gmgnCreatorCreatedCount 键定义`);
      assert.ok(!/whaleWallets\s*:/.test(src), `${p} 仍提取 whaleWallets`);
      assert.ok(!/creatorCreatedCount\s*:/.test(src), `${p} 仍提取 creatorCreatedCount`);
    }
  });
check('存活键未被误伤：renowned/smart 映射保留',
  () => {
    const m = mapGmgnRiskFactors({ issuerTokenCount: 1, bundlerWallets: 2, topWallets: 40, renownedWallets: 2, smartWallets: 3 });
    assert.strictEqual(m.gmgnRenownedWallets, 2);
    assert.strictEqual(m.gmgnSmartWallets, 3);
  });

}

main().then(() => {
  console.log(`\n${passed}/${passed + failed}`);
  process.exit(failed === 0 ? 0 : 1);
}).catch(e => { console.error(e); process.exit(1); });
