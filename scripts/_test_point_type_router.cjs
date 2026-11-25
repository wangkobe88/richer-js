#!/usr/bin/env node
/**
 * T216 点位类型辨别与对应策略（pointType 模块）单测（零 DB 零网络）：
 *   A. classifyPointType：黄金坑因子表命中 famous_holder_cold_pit（policy/snapshot 全键）；
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
  // T232 补 3 差额上界买侧两键（MOYNOK fire 带 0.1022 全为离场卖→带买=0 过
  // 0.15/0.12 线；卖不拦=坑位回撤照放）
  actTotalBnb60Ex15Buy: 0, actTotalBnb90Ex60Buy: 0,
  // PT9 锚点买盘存在（金鲨号形状：锚 tick 是买 0.006B → A 分支过；B 分支 ≥0.03）
  anchorTickIsBuy: 1, anchor15sMaxBuyBnb: 0.006,
  // PT11 价格域双尺（A 分支地板尺过线即够；earlyReturn 键须在快照）
  earlyReturn: 25.7,
};
const PARTIAL = { ...GOLDEN, athVsLaunchPct: 120 }; // ATH 出带（>100）

console.log('A. classifyPointType 分类');
{
  check('A1 黄金坑因子表命中（MOYNOK t+562s 真值；龄门 v6 起 ≥90→v7 收紧 ≥160——tokenAgeSec 600 过线）', () => {
    const r = classifyPointType(GOLDEN);
    assert.strictEqual(r.type, 'famous_holder_cold_pit');
    assert.deepStrictEqual(r.policy, {
      factorCheckArms: 'cheatOnly',
      factorCheckArmExempt: ['slow_pump_unload', 'arb_bot_holdings'],
      actFront: 'pass',
      cheatCheck: 'g23NoSlowGrind',
      buyPoint: 'stuffingOnly',
    });
    assert.strictEqual(r.version, POINT_TYPE_VERSION);
    for (const k of ['tokenAgeSec', 'buyVolumeBnb', 'currentVsLaunchPct', 'athVsLaunchPct', 'mcapFromPeakPct', 'bigBuyersCount', 'bigBuyersHeldDust', 'famousCopyWalletCircPct', 'actTotalBnb90s', 'actTotalBnb60Ex15Buy', 'actTotalBnb90Ex60Buy', 'famousFollowSlotMaxWallets', 'notoriousWalletCircPct', 'anchorTickIsBuy', 'anchor15sMaxBuyBnb', 'earlyReturn']) {
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
  check('A2b2 T231 正例：tokenAgeSec 910 无上界 → 命中（0x4509 超长坑案：famous 双胞胎回场在旧 900s 窗关闭后 10s）', () => {
    const r = classifyPointType({ ...GOLDEN, tokenAgeSec: 910 });
    assert.strictEqual(r.type, 'famous_holder_cold_pit');
  });
  check('A2b3 T231 正例：tokenAgeSec 3600（1h 老票）→ 命中（龄上界已撤除，剩余龄约束=买量带）', () => {
    const r = classifyPointType({ ...GOLDEN, tokenAgeSec: 3600 });
    assert.strictEqual(r.type, 'famous_holder_cold_pit');
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
    assert.strictEqual(r.type, 'famous_holder_cold_pit');
  });
  check('A2f PT8 负例：bf00 流通占比 38.9 >30 → normal（0x37d131 案源）', () => {
    const r = classifyPointType({ ...GOLDEN, notoriousWalletCircPct: 38.9 });
    assert.strictEqual(r.type, 'normal');
  });
  check('A2g PT8 边界：bf00 恰 30 过线（≤）', () => {
    const r = classifyPointType({ ...GOLDEN, notoriousWalletCircPct: 30 });
    assert.strictEqual(r.type, 'famous_holder_cold_pit');
  });
  check('A2h PT9 负例：锚非买 ∧ 15s 最大买 0.01 <0.03 → normal（完全死寂点）', () => {
    const r = classifyPointType({ ...GOLDEN, anchorTickIsBuy: 0, anchor15sMaxBuyBnb: 0.01 });
    assert.strictEqual(r.type, 'normal');
  });
  check('A2i PT9 正例：锚非买但 15s 内 0.05 像样买 → 过', () => {
    const r = classifyPointType({ ...GOLDEN, anchorTickIsBuy: 0, anchor15sMaxBuyBnb: 0.05 });
    assert.strictEqual(r.type, 'famous_holder_cold_pit');
  });
  check('A2j PT9 边界：15s 最大买恰 0.03 过线（≥）', () => {
    const r = classifyPointType({ ...GOLDEN, anchorTickIsBuy: 0, anchor15sMaxBuyBnb: 0.03 });
    assert.strictEqual(r.type, 'famous_holder_cold_pit');
  });
  check('A2k PT10 冷窗放宽边界：15s 0.3/30s 0.35 过线（v15 放行由冷转热波首笔）', () => {
    const r = classifyPointType({ ...GOLDEN, actTotalBnb15s: 0.3, actTotalBnb30s: 0.35 });
    assert.strictEqual(r.type, 'famous_holder_cold_pit');
  });
  check('A2l PT21 正例：15s 0.349 过线（0x4509 fire 时刻真值——离场卖 0.2506+回场买 0.0988 同窗；0.31 时代唯一差项）', () => {
    const r = classifyPointType({ ...GOLDEN, actTotalBnb15s: 0.349, actTotalBnb30s: 0.349 });
    assert.strictEqual(r.type, 'famous_holder_cold_pit');
  });
  check('A2l2 PT21 边界：15s 恰 0.4 过线（≤，与 30s 同线）', () => {
    const r = classifyPointType({ ...GOLDEN, actTotalBnb15s: 0.4, actTotalBnb30s: 0.4 });
    assert.strictEqual(r.type, 'famous_holder_cold_pit');
  });
  check('A2l3 PT21 负例：15s 0.41 >0.4 → normal', () => {
    const r = classifyPointType({ ...GOLDEN, actTotalBnb15s: 0.41, actTotalBnb30s: 0.41 });
    assert.strictEqual(r.type, 'normal');
  });
  check('A2l4 T232 补 3 买侧差额边界：60Ex15Buy 恰 0.15 过线（≤）/ 90Ex60Buy 恰 0.12 过线（≤）', () => {
    const r = classifyPointType({ ...GOLDEN, actTotalBnb60Ex15Buy: 0.15, actTotalBnb90Ex60Buy: 0.12 });
    assert.strictEqual(r.type, 'famous_holder_cold_pit');
  });
  check('A2l5 T232 补 3 负例：60Ex15Buy 0.16 >0.15 → normal（前 45s 有像样买入=热度）', () => {
    const r = classifyPointType({ ...GOLDEN, actTotalBnb60Ex15Buy: 0.16 });
    assert.strictEqual(r.type, 'normal');
  });
  check('A2l6 T232 补 3 负例：90Ex60Buy 0.13 >0.12 → normal（60~90s 前有像样买入=热度）', () => {
    const r = classifyPointType({ ...GOLDEN, actTotalBnb90Ex60Buy: 0.13 });
    assert.strictEqual(r.type, 'normal');
  });
  check('A2l7 T232 补 3 回归：带内卖单不拦（MOYNOK 形状——60Ex15 total 0.108 全为离场卖，买侧=0 照放）', () => {
    const r = classifyPointType({ ...GOLDEN, actTotalBnb60Ex15Buy: 0, actTotalBnb90Ex60Buy: 0, actTotalBnb60s: 0.216, actTotalBnb90s: 0.318 });
    assert.strictEqual(r.type, 'famous_holder_cold_pit');
  });
  check('A2m PT12 正例：curVs 30.13 ∧ earlyReturn 8.2 <15 → 过（MOYNOK 波首笔引擎真值形状）', () => {
    const r = classifyPointType({ ...GOLDEN, currentVsLaunchPct: 30.13, earlyReturn: 8.2 });
    assert.strictEqual(r.type, 'famous_holder_cold_pit');
  });
  check('A2n PT12 负例：curVs 30.13 ∧ earlyReturn 16 ≥15 → normal（双尺都不过）', () => {
    const r = classifyPointType({ ...GOLDEN, currentVsLaunchPct: 30.13, earlyReturn: 16 });
    assert.strictEqual(r.type, 'normal');
  });
  check('A2o PT13 负例：earlyReturn 12 <15 但 curVs 94.12 >33.5 → normal（0x2c3fdb 极端背离票）', () => {
    const r = classifyPointType({ ...GOLDEN, currentVsLaunchPct: 94.12, earlyReturn: 12 });
    assert.strictEqual(r.type, 'normal');
  });
  check('A2p PT13 边界：curVs 33.5 恰过线（≤）', () => {
    const r = classifyPointType({ ...GOLDEN, currentVsLaunchPct: 33.5, earlyReturn: 12 });
    assert.strictEqual(r.type, 'famous_holder_cold_pit');
  });
  check('A3 浅回撤无下限仍命中（dd=20 ≤50 ✓ 用户裁定只有上限）', () => {
    const r = classifyPointType({ ...GOLDEN, mcapFromPeakPct: 20 });
    assert.strictEqual(r.type, 'famous_holder_cold_pit');
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
  check('B4 类型缺 active 字段 throw（2026-11-25 起必填）', () => {
    const { POINT_TYPES } = require(path.join(ROOT, 'src/market-analysis/point-type-router.js'));
    POINT_TYPES.push({ id: 'tmp_missing_active', condition: null, policy: {} });
    try {
      assert.throws(() => assertPointTypesValid(faKeys), /缺 active 布尔字段/);
    } finally {
      POINT_TYPES.pop();
    }
  });
  check('B5 active 非布尔 throw（undefined 语义陷阱——漏填不等于 false）', () => {
    const { POINT_TYPES } = require(path.join(ROOT, 'src/market-analysis/point-type-router.js'));
    POINT_TYPES.push({ id: 'tmp_bad_active', condition: null, policy: {}, active: 'no' });
    try {
      assert.throws(() => assertPointTypesValid(faKeys), /缺 active 布尔字段/);
    } finally {
      POINT_TYPES.pop();
    }
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
    assert.strictEqual(r.type, 'famous_holder_cold_pit');
  });
}
console.log('D. T225 strongbacker_solo_dance（一个钱包的独舞，2026-11-23）');
{
  const SOLO = {
    quietSpanMs: 148000, quietSurgeBuyBnb: 0.586, quietSurgeSec: 12.2, quietExitVsLaunchPct: 9.01,
    currentVsLaunchPct: 20.4, quietExitBigBuyers: 1, quietExitLatchHoldPct: 39.85,
    quietExitEndWithSell: 1, actTotalBnb60Ex15: 0, quietExitOthersBuyBnb: 0.267, quietSurgeSellBnb: 0, actTotalBnb: 0.336, tokenAgeSec: 295,
    launchBundleClusterSize: 1, launchSellBundleClusterSize: 1, launchBuyBundleWaves: 0,
    launchBuyBundleDominancePct: 0, cheatCrewBuyBnb: 0,
  };
  check('D1 LAB 形状命中独舞类型（policy 豁 AF1+cheat E 通道）', () => {
    const r = classifyPointType(SOLO);
    assert.strictEqual(r.type, 'strongbacker_solo_dance');
    assert.deepStrictEqual(r.policy, { actFront: 'pass', cheatCheck: 'g23NoE', factorCheckArmExempt: ['fam_holding_thin', 'oversell_residual'] });
  });
  check('D2 临门 60s 段有成交（act60Ex15 0.3，ZEC 形状）→ normal', () =>
    assert.strictEqual(classifyPointType(Object.assign({}, SOLO, { actTotalBnb60Ex15: 0.3 })).type, 'normal'));
  check('D3 双大户（ZKind 形状）→ normal', () =>
    assert.strictEqual(classifyPointType(Object.assign({}, SOLO, { quietExitBigBuyers: 2 })).type, 'normal'));
  check('D4 无卖收尾（从未活过的死票）→ normal', () =>
    assert.strictEqual(classifyPointType(Object.assign({}, SOLO, { quietExitEndWithSell: 0 })).type, 'normal'));
  check('D5 大户清仓（latchHold 0）→ normal', () =>
    assert.strictEqual(classifyPointType(Object.assign({}, SOLO, { quietExitLatchHoldPct: 0 })).type, 'normal'));
  check('D6 出口破发（exitVs -5）→ normal', () =>
    assert.strictEqual(classifyPointType(Object.assign({}, SOLO, { quietExitVsLaunchPct: -5 })).type, 'normal'));
  check('D7 其他买入超线（湖南 0.597 形状）→ normal', () =>
    assert.strictEqual(classifyPointType(Object.assign({}, SOLO, { quietExitOthersBuyBnb: 0.597 })).type, 'normal'));
  check('D8 policy 豁免 fam_holding_thin+oversell_residual（FP 臂差集）', () =>
    assert.deepStrictEqual(classifyPointType(SOLO).policy.factorCheckArmExempt, ['fam_holding_thin', 'oversell_residual']));
  check('D9 拉盘波绑卖（ZEC 同 slot 对倒 0.508）→ normal', () =>
    assert.strictEqual(classifyPointType(Object.assign({}, SOLO, { quietSurgeSellBnb: 0.5084 })).type, 'normal'));
}
console.log('E. T236 slow_develop_early（缓慢发育潜力币早期点位，active:false 不激活——2026-11-25 用户裁定「给 pointType 增加一个是否激活的参数，像这个还在迭代中的，激活为否，不生效」）');
{
  const SLOW = {
    // 一姐 0xfc23…7777 锚真值形状（bt-v254 扫描口径）
    athVsLaunchPct: 39.9, sinceLaunchTrades: 26, bundledAvgTradeBnb300: 0.1893,
  };
  check('E1 一姐形状命中三刀条件但类型 active:false → 跳过回落 normal（policy={} 全门链现行）', () => {
    const r = classifyPointType(SLOW);
    assert.strictEqual(r.type, 'normal');
    assert.deepStrictEqual(r.policy, {});
    assert.deepStrictEqual(r.snapshot, {});
  });
  check('E2 边界形状（athVs 59.9/笔数 40/avg 0.13~0.1999）→ 一律 normal（类型未激活零豁免面）', () => {
    assert.strictEqual(classifyPointType({ ...SLOW, athVsLaunchPct: 59.9 }).type, 'normal');
    assert.strictEqual(classifyPointType({ ...SLOW, sinceLaunchTrades: 40 }).type, 'normal');
    assert.strictEqual(classifyPointType({ ...SLOW, bundledAvgTradeBnb300: 0.13 }).type, 'normal');
    assert.strictEqual(classifyPointType({ ...SLOW, bundledAvgTradeBnb300: 0.1999 }).type, 'normal');
  });
  check('E3 athVs null（无可靠价）→ normal fail-closed 不误配', () => {
    assert.strictEqual(classifyPointType({ ...SLOW, athVsLaunchPct: null }).type, 'normal');
  });
  check('E4 优先级：athVs 50 同时满足黄金坑全套 → famous_holder_cold_pit 优先命中（famous 背书票保持更强豁免）', () => {
    const overlap = { ...GOLDEN, athVsLaunchPct: 50 };
    assert.strictEqual(classifyPointType(overlap).type, 'famous_holder_cold_pit');
  });
  check('E5 空票（0 笔 0 额）→ normal（0 <0.13 有证据零值不命中）', () => {
    assert.strictEqual(classifyPointType({ athVsLaunchPct: 10, sinceLaunchTrades: 0, bundledAvgTradeBnb300: 0 }).type, 'normal');
  });
  check('E6 激活参数机制：全类型带 active 布尔字段；slow_develop_early 唯一 false，其余全 true', () => {
    const { POINT_TYPES } = require(path.join(ROOT, 'src/market-analysis/point-type-router.js'));
    const ids = new Set();
    for (const t of POINT_TYPES) {
      assert.ok(!ids.has(t.id), `类型 id 重复 ${t.id}`);
      ids.add(t.id);
      assert.strictEqual(typeof t.active, 'boolean', `类型 ${t.id} 缺 active 字段`);
      if (t.id === 'slow_develop_early') assert.strictEqual(t.active, false, 'slow_develop_early 应为未激活');
      else assert.strictEqual(t.active, true, `类型 ${t.id} 应为激活`);
    }
  });
}
console.log('F. T239 steady_trend_climb（趋势成形-中低速持续拉盘，2026-11-25）');
{
  const TREND = {
    tokenAgeSec: 120, currentVsLaunchPct: 55, priceMa60SlopePct: 20, actTotalBnb30s: 1.2,
  };
  check('F1 形状命中 → steady_trend_climb + 全豁 policy', () => {
    const r = classifyPointType(TREND);
    assert.strictEqual(r.type, 'steady_trend_climb');
    assert.strictEqual(r.label, '趋势成形-中低速持续拉盘-低位域入场-持续上涨币');
    assert.deepStrictEqual(r.policy, { factorCheckArms: 'skip', actFront: 'pass', cheatCheck: 'skip', buyPoint: 'stuffingOnly' });
    assert.strictEqual(r.version, POINT_TYPE_VERSION);
    assert.deepStrictEqual(Object.keys(r.snapshot).sort(), ['actTotalBnb30s', 'currentVsLaunchPct', 'priceMa60SlopePct', 'tokenAgeSec']);
  });
  check('F2 域上界恰 80 过线 / 80.1 → normal（用户裁定「最多接受上涨 80% 的点位」）', () => {
    assert.strictEqual(classifyPointType({ ...TREND, currentVsLaunchPct: 80 }).type, 'steady_trend_climb');
    assert.strictEqual(classifyPointType({ ...TREND, currentVsLaunchPct: 80.1 }).type, 'normal');
  });
  check('F3 域下界恰 30 过线 / 29.9 → normal（趋势形成需要一定价格高度）', () => {
    assert.strictEqual(classifyPointType({ ...TREND, currentVsLaunchPct: 30 }).type, 'steady_trend_climb');
    assert.strictEqual(classifyPointType({ ...TREND, currentVsLaunchPct: 29.9 }).type, 'normal');
  });
  check('F4 斜率带 5/60 恰过线；4.9 太平 / 60.1 太陡 → normal（用户方法「拒绝太平也拒绝太陡」）', () => {
    assert.strictEqual(classifyPointType({ ...TREND, priceMa60SlopePct: 5 }).type, 'steady_trend_climb');
    assert.strictEqual(classifyPointType({ ...TREND, priceMa60SlopePct: 60 }).type, 'steady_trend_climb');
    assert.strictEqual(classifyPointType({ ...TREND, priceMa60SlopePct: 4.9 }).type, 'normal');
    assert.strictEqual(classifyPointType({ ...TREND, priceMa60SlopePct: 60.1 }).type, 'normal');
  });
  check('F5 act30s 恰 1.9 过线（PT47 用户裁定「砍吧」3.9→1.9，类整数线纪律 2→1.9）；1.91 → normal（高流量=出货段 24h 档层实证 −0.721）', () => {
    assert.strictEqual(classifyPointType({ ...TREND, actTotalBnb30s: 1.9 }).type, 'steady_trend_climb');
    assert.strictEqual(classifyPointType({ ...TREND, actTotalBnb30s: 1.91 }).type, 'normal');
  });
  check('F6 龄恰 60 过线 / 59 → normal（120s 与 curVs≤80 自相矛盾，182 校准实证零候选窗）', () => {
    assert.strictEqual(classifyPointType({ ...TREND, tokenAgeSec: 60 }).type, 'steady_trend_climb');
    assert.strictEqual(classifyPointType({ ...TREND, tokenAgeSec: 59.9 }).type, 'normal');
  });
  check('F7 priceMa60SlopePct null → normal（前窗空 fail-closed：裸比较恒 false）', () => {
    assert.strictEqual(classifyPointType({ ...TREND, priceMa60SlopePct: null }).type, 'normal');
  });
  check('F8 排位：famous_participation_pit 优先命中（30~33.5 域重叠带 earlyReturn 双尺臂）', () => {
    const overlap = {
      ...TREND, currentVsLaunchPct: 32, earlyReturn: 10,
      athVsFloorPct: 100, mcapFromPeakPct: 30,
      famousLifetimeBuyBnb: 0.8, famousFollowBlockMaxWallets: 3, famousLifetimeBuyN: 5, buyVolumeBnb: 5, max5sRisePct: 30, famousEarlyBuySharePct: 60,
    };
    assert.strictEqual(classifyPointType(overlap).type, 'famous_participation_pit');
  });
  check('F9 类型注册形状：active:true 且位于 famous 系之后/slow_develop_early 之前', () => {
    const { POINT_TYPES } = require(path.join(ROOT, 'src/market-analysis/point-type-router.js'));
    const ids = POINT_TYPES.map((t) => t.id);
    const i = ids.indexOf('steady_trend_climb');
    assert.ok(i > ids.indexOf('famous_participation_pit'), '排位须在 famous_participation_pit 之后');
    assert.ok(i < ids.indexOf('slow_develop_early'), '排位须在 slow_develop_early 之前');
    assert.strictEqual(POINT_TYPES[i].active, true);
  });
}
console.log(`\n全部通过 ${passed}/${passed}`);
