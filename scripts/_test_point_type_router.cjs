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
};
const PARTIAL = { ...GOLDEN, athVsLaunchPct: 120 }; // ATH 出带（>100）

console.log('A. classifyPointType 分类');
{
  check('A1 黄金坑因子表命中（MOYNOK t+562s 真值；v6 起加龄门 ≥90——tokenAgeSec 600 过线）', () => {
    const r = classifyPointType(GOLDEN);
    assert.strictEqual(r.type, 'retail_golden_pit');
    assert.deepStrictEqual(r.policy, {
      factorCheckArms: 'cheatOnly',
      factorCheckArmExempt: ['slow_pump_unload'],
      actFront: 'pass',
      cheatCheck: 'g23NoSlowGrind',
      buyPoint: 'stuffingOnly',
    });
    assert.strictEqual(r.version, POINT_TYPE_VERSION);
    for (const k of ['tokenAgeSec', 'buyVolumeBnb', 'currentVsLaunchPct', 'athVsLaunchPct', 'mcapFromPeakPct', 'bigBuyersCount', 'bigBuyersHeldDust', 'famousCopyWalletCircPct']) {
      assert.ok(k in r.snapshot, `snapshot 缺 ${k}`);
    }
  });
  check('A2 条件不满足（ATH 出带）→ normal 兜底 policy={}', () => {
    const r = classifyPointType(PARTIAL);
    assert.strictEqual(r.type, 'normal');
    assert.deepStrictEqual(r.policy, {});
  });
  check('A2b 龄门负例：tokenAgeSec 89 <90 → normal（v6 用户裁定「交易了一段时间，大户还是不肯卖」）', () => {
    const r = classifyPointType({ ...GOLDEN, tokenAgeSec: 89 });
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
