#!/usr/bin/env node
/**
 * T216 点位类型辨别与对应策略（pointType 模块）单测（零 DB 零网络）：
 *   A. classifyPointType：黄金坑因子表命中 retail_golden_pit（policy/snapshot 全键）；
 *      不命中→normal 兜底（policy={}）；条件部分满足不命中；评估异常 fail-safe 走 normal
 *   B. assertPointTypesValid：FA 真键集全过；未知因子 throw；policy 非法维度/值 throw；
 *      normal 必须末位
 *   C. 未启用模块路径：引擎 _classifyPointType null 语义（strategyResolved 无 pointType → null）
 */
'use strict';
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const {
  POINT_TYPE_VERSION, classifyPointType, assertPointTypesValid,
} = require(path.join(ROOT, 'src/market-analysis/point-type-router.js'));
const FourMemeFactorAggregator = require(path.join(ROOT, 'src/services/FourMemeFactorAggregator.js'));

let passed = 0;
function check(name, fn) { try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exit(1); } }

const GOLDEN = {
  tokenAgeSec: 600, buyVolumeBnb: 8, currentVsLaunchPct: 25.7, athVsLaunchPct: 76.9,
  mcapFromPeakPct: 28.8, bigBuyersCount: 9, bigBuyersHeldDust: 7, famousCopyWalletCircPct: 0.5,
  // T218 三窗冷门（MOYNOK bt-v204 引擎锚真值 0.072/0.174/0.180——v11 线 0.12/0.25/0.5 过）
  actTotalBnb15s: 0.072, actTotalBnb30s: 0.174, actTotalBnb60s: 0.180,
  // PT7 两键（v12 腿同款）：90s 冷窗 ≤1.0（MOYNOK 锚 90s≈0.18 过线）；
  // famous 跟单 ≤8（MOYNOK 买点前 4 过线；0x2a05 同块 16 钱包案为负例）
  actTotalBnb90s: 0.18, famousFollowSlotMaxWallets: 4,
  // PT8 臭名昭著钱包 ≤30（MOYNOK bf00 18.7 过线；0x37d131 38.9 案源为负例）
  notoriousWalletCircPct: 18.7,
  // PT9 锚点买盘存在（金鲨号形状：锚 tick 是买 0.006B → A 分支过；B 分支 ≥0.03）
  anchorTickIsBuy: 1, anchor15sMaxBuyBnb: 0.006,
  // PT11 价格域双尺（A 分支地板尺过线即够；earlyReturn 键须在快照）
  earlyReturn: 25.7,
};
const PARTIAL = { ...GOLDEN, athVsLaunchPct: 120 }; // ATH 出带（>100）

console.log('A. classifyPointType 分类');
{
  check('A1 黄金坑因子表命中（MOYNOK t+562s 真值；v6 起加龄门 ≥90——tokenAgeSec 600 过线）', () => {
    const r = classifyPointType(GOLDEN);
    assert.strictEqual(r.type, 'retail_golden_pit');
    assert.deepStrictEqual(r.policy, {
      factorCheckArms: 'cheatOnly',
      factorCheckArmExempt: ['slow_pump_unload', 'arb_bot_holdings'],
      actFront: 'pass',
      cheatCheck: 'g23NoSlowGrind',
      buyPoint: 'stuffingOnly',
    });
    assert.strictEqual(r.version, POINT_TYPE_VERSION);
    for (const k of ['tokenAgeSec', 'buyVolumeBnb', 'currentVsLaunchPct', 'athVsLaunchPct', 'mcapFromPeakPct', 'bigBuyersCount', 'bigBuyersHeldDust', 'famousCopyWalletCircPct', 'actTotalBnb90s', 'famousFollowSlotMaxWallets', 'notoriousWalletCircPct', 'anchorTickIsBuy', 'anchor15sMaxBuyBnb', 'earlyReturn']) {
      assert.ok(k in r.snapshot, `snapshot 缺 ${k}`);
    }
  });
  check('A2 条件不满足（ATH 出带）→ normal 兜底 policy={}', () => {
    const r = classifyPointType(PARTIAL);
    assert.strictEqual(r.type, 'normal');
    assert.deepStrictEqual(r.policy, {});
  });
  check('A2b 龄门负例：tokenAgeSec 159 <160 → normal（v7 用户裁定龄门收紧到 160）', () => {
    const r = classifyPointType({ ...GOLDEN, tokenAgeSec: 159 });
    assert.strictEqual(r.type, 'normal');
  });
  check('A2c PT7 负例：90s 冷窗 1.4 >1.0 → normal（0x53691a 刚冷一分钟不够案）', () => {
    const r = classifyPointType({ ...GOLDEN, actTotalBnb90s: 1.4 });
    assert.strictEqual(r.type, 'normal');
  });
  check('A2d PT7 负例：famous 跟单 16 >8 → normal（0x2a05 同块挤爆案）', () => {
    const r = classifyPointType({ ...GOLDEN, famousFollowSlotMaxWallets: 16 });
    assert.strictEqual(r.type, 'normal');
  });
  check('A2e PT7 边界：跟单恰 8 过线（≤）', () => {
    const r = classifyPointType({ ...GOLDEN, famousFollowSlotMaxWallets: 8 });
    assert.strictEqual(r.type, 'retail_golden_pit');
  });
  check('A2f PT8 负例：bf00 流通占比 38.9 >30 → normal（0x37d131 案源）', () => {
    const r = classifyPointType({ ...GOLDEN, notoriousWalletCircPct: 38.9 });
    assert.strictEqual(r.type, 'normal');
  });
  check('A2g PT8 边界：bf00 恰 30 过线（≤）', () => {
    const r = classifyPointType({ ...GOLDEN, notoriousWalletCircPct: 30 });
    assert.strictEqual(r.type, 'retail_golden_pit');
  });
  check('A2h PT9 负例：锚非买 ∧ 15s 最大买 0.01 <0.03 → normal（完全死寂点）', () => {
    const r = classifyPointType({ ...GOLDEN, anchorTickIsBuy: 0, anchor15sMaxBuyBnb: 0.01 });
    assert.strictEqual(r.type, 'normal');
  });
  check('A2i PT9 正例：锚非买但 15s 内 0.05 像样买 → 过', () => {
    const r = classifyPointType({ ...GOLDEN, anchorTickIsBuy: 0, anchor15sMaxBuyBnb: 0.05 });
    assert.strictEqual(r.type, 'retail_golden_pit');
  });
  check('A2j PT9 边界：15s 最大买恰 0.03 过线（≥）', () => {
    const r = classifyPointType({ ...GOLDEN, anchorTickIsBuy: 0, anchor15sMaxBuyBnb: 0.03 });
    assert.strictEqual(r.type, 'retail_golden_pit');
  });
  check('A2k PT10 冷窗放宽边界：15s 0.3/30s 0.35 过线（v15 放行由冷转热波首笔）', () => {
    const r = classifyPointType({ ...GOLDEN, actTotalBnb15s: 0.3, actTotalBnb30s: 0.35 });
    assert.strictEqual(r.type, 'retail_golden_pit');
  });
  check('A2l PT10 负例：15s 0.32 >0.31 → normal（用户裁「大于 0.31 再砍」）', () => {
    const r = classifyPointType({ ...GOLDEN, actTotalBnb15s: 0.32 });
    assert.strictEqual(r.type, 'normal');
  });
  check('A2m PT12 正例：curVs 30.13 ∧ earlyReturn 8.2 <15 → 过（MOYNOK 波首笔引擎真值形状）', () => {
    const r = classifyPointType({ ...GOLDEN, currentVsLaunchPct: 30.13, earlyReturn: 8.2 });
    assert.strictEqual(r.type, 'retail_golden_pit');
  });
  check('A2n PT12 负例：curVs 30.13 ∧ earlyReturn 16 ≥15 → normal（双尺都不过）', () => {
    const r = classifyPointType({ ...GOLDEN, currentVsLaunchPct: 30.13, earlyReturn: 16 });
    assert.strictEqual(r.type, 'normal');
  });
  check('A3 浅回撤无下限仍命中（dd=20 ≤50 ✓ 用户裁定只有上限）', () => {
    const r = classifyPointType({ ...GOLDEN, mcapFromPeakPct: 20 });
    assert.strictEqual(r.type, 'retail_golden_pit');
  });
  check('A4 null 因子表 → normal（fail-safe 不误配）', () => {
    const r = classifyPointType({});
    assert.strictEqual(r.type, 'normal');
  });
  check('A5 评估异常容错（非数值比较炸）→ 不命中该类型走 normal', () => {
    const r = classifyPointType({ tokenAgeSec: 'x', buyVolumeBnb: 8, currentVsLaunchPct: 1, athVsLaunchPct: 50, mcapFromPeakPct: 40, bigBuyersCount: 5, bigBuyersHeldDust: 4, famousCopyWalletCircPct: 0.1 });
    assert.strictEqual(r.type, 'normal');
  });
}

console.log('B. assertPointTypesValid 启动防线');
{
  const faKeys = new FourMemeFactorAggregator({}).getFactorKeys();
  check('B1 FA 真键集全过（注册表 condition 键域合法——PT2 policy 五键含 cheatCheck 规则集+臂差集）', () => {
    assert.doesNotThrow(() => assertPointTypesValid(faKeys));
  });
  check('B2 未知因子 throw 拒启', () => {
    assert.throws(() => assertPointTypesValid(new Set(['tokenAgeSec'])), /condition 非法/);
  });
  check('B3 非法 policy 维度/值 throw（构造性验证经源码形状——注册表现值合法即过）', () => {
    assert.doesNotThrow(() => assertPointTypesValid(faKeys));
  });
}

console.log('C. 引擎未启用路径（_classifyPointType null 语义）');
{
  const { AbstractTradingEngine } = require(path.join(ROOT, 'src/trading-engine/core/AbstractTradingEngine.js'));
  check('C1 strategyResolved 无 pointType 模块 → null（全现行 bit 不变）', () => {
    const fake = Object.create(AbstractTradingEngine.prototype);
    fake._strategyResolved = { modules: { factorCheck: 'v1' } };
    assert.strictEqual(fake._classifyPointType(GOLDEN), null);
  });
  check('C2 strategyResolved 缺失 → null', () => {
    const fake = Object.create(AbstractTradingEngine.prototype);
    fake._strategyResolved = null;
    assert.strictEqual(fake._classifyPointType(GOLDEN), null);
  });
  check('C3 pointType 启用 → 分类生效', () => {
    const fake = Object.create(AbstractTradingEngine.prototype);
    fake._strategyResolved = { modules: { pointType: POINT_TYPE_VERSION } };
    const r = fake._classifyPointType(GOLDEN);
    assert.strictEqual(r.type, 'retail_golden_pit');
  });
}
console.log(`\n全部通过 ${passed}/${passed}`);
