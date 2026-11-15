'use strict';

/**
 * T143 因子购买前检查门单测（FP1）——零 DB 零网络纯函数：PVP 判定树全分支 +
 * duanju 0x65aebe91…7777 反证夹具 + CD 四臂升格门夹具（CD400/403/401/405）+
 * CD401 sbw 机械化代理线各腿 + null 容缺。
 * 运行：node scripts/_test_factor_prebuy_check.cjs（断言失败退出非零）
 */

const assert = require('assert');
const path = require('path');
const M = require(path.join(__dirname, '..', 'src', 'market-analysis', 'factor-pre-buy-check.js'));

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const T0 = 0; // snapshot dt 域=相对锚基秒（F2 夹具教训：单位秒非 ms）
// 钱包夹具：buy/sell 累计、maxBuy 单笔、idleSec=末动距锚末秒数（≤120=活跃在场）
const TEND = 400;
const W = (buy, sell, maxBuy, idleSec) => ({
  w: 'w' + Math.random().toString(36).slice(2, 8), buyBnb: buy, sellBnb: sell,
  buyN: 1, sellN: sell > 0 ? 1 : 0, maxBuyBnb: maxBuy == null ? buy : maxBuy,
  firstBuyDt: T0, firstSellDt: null, lastActDt: idleSec == null ? null : TEND - idleSec,
  isCreator: false,
});
// snapshot 夹具：tEnd=锚末 tick dt（wallets 的 lastAct 相对此计 idle）
const SNAP = (over) => Object.assign({
  ticks: [{ dt: 400 }],
  wallets: [],
  buyDerived: { bundledBlock: null, win: { 30: { buyBnb: 0.5, buyN: 5 } }, bigHolderSellBnb60: null, activity: { nearTail10BuyN: 3 } },
  cheatDerived: {},
}, over);

console.log('B. PVP 判定（BP84 二修：纯买入侧极简口径）');
{
  check('B1 无 0.2 级单笔（全 0.1x）→ 拒 pvp_no_big_participation', () => {
    const r = M.judgeRetailPvp(SNAP({ wallets: [W(0.1, 0, 0.1, 10), W(0.08, 0, 0.08, 10)] }));
    assert.strictEqual(r.hit, 1); assert.strictEqual(r.reason, 'pvp_no_big_participation');
  });
  check('B2 灰区单不救（三笔累计 0.23 单笔 0.1x=不算 0.2 级，BP55 单笔口径）', () => {
    const r = M.judgeRetailPvp(SNAP({ wallets: [W(0.23, 0, 0.11, 10)] }));
    assert.strictEqual(r.hit, 1);
  });
  check('B3 单笔 0.2994（≥0.29 视同 0.3）→ 像样买方在场不落 PVP（duanju 案）', () => {
    const r = M.judgeRetailPvp(SNAP({ wallets: [W(0.2994, 0.2994, 0.2994, 10)] }));
    assert.strictEqual(r.hit, 0); assert.strictEqual(r.trace.act30, 1);
  });
  check('B4 0.29 边界：0.29 恰过 / 0.2899 不过', () => {
    assert.strictEqual(M.judgeRetailPvp(SNAP({ wallets: [W(0.29, 0, 0.29, 100)] })).trace.act30, 1);
    const r2 = M.judgeRetailPvp(SNAP({ wallets: [W(0.2899, 0, 0.2899, 100)] }));
    assert.strictEqual(r2.trace.act30, 0); assert.strictEqual(r2.hit, 1);
  });
  check('B5 买完立刻清仓也放（不看持有——Go Brrrrr/好似喵案语义内建）', () => {
    const r = M.judgeRetailPvp(SNAP({ wallets: [W(0.5, 0.533, 0.5, 0)] }));
    assert.strictEqual(r.hit, 0); // 买入过就算
  });
  check('B6 两个 0.2 级（≥0.19）→ 不落 PVP', () => {
    const r = M.judgeRetailPvp(SNAP({ wallets: [W(0.2, 0, 0.2, 50), W(0.19, 0, 0.19, 100)] }));
    assert.strictEqual(r.trace.act20, 2); assert.strictEqual(r.hit, 0);
  });
  check('B7 同块捆绑合计 >0.3（严格大于）→ 组织性买入在场不落', () => {
    const s = SNAP({ wallets: [], buyDerived: { bundledBlock: { buyBnb: 0.31 }, activity: {} } });
    assert.strictEqual(M.judgeRetailPvp(s).hit, 0);
    const s2 = SNAP({ wallets: [], buyDerived: { bundledBlock: { buyBnb: 0.3 }, activity: {} } });
    assert.strictEqual(M.judgeRetailPvp(s2).hit, 1); // 恰 0.3 不过
  });
  check('B8 蓄势静默不误伤（无持有/承接维度——Go Brrrrr 39s 静默形状：买入侧 12 个 0.2 级在场即过）', () => {
    const wallets = Array.from({ length: 12 }, (_, i) => W(0.21, 0.05, 0.21, 30 + i));
    const r = M.judgeRetailPvp(SNAP({ wallets, buyDerived: { bundledBlock: null, activity: {} } }));
    assert.strictEqual(r.hit, 0);
  });
}

console.log('C. duanju 0x65aebe91…7777 反证夹具（0.2994 首买，BP84 二修口径）');
{
  const duanju = SNAP({
    wallets: [W(0.2994, 0.1692, 0.2994, 39)], // 买 0.2994 卖 0.1692（57% 兑现）——买入过即像样买方
    buyDerived: { bundledBlock: null, activity: {} },
  });
  const r = M.judgeRetailPvp(duanju);
  check('C1 0.2994 ≥0.29 → act30=1 像样买方在场不落 PVP（不看兑现/持有）', () => {
    assert.strictEqual(r.trace.act30, 1); assert.strictEqual(r.hit, 0); assert.strictEqual(r.reason, null);
  });
  check('C2 死盘/承接形状不再属 PVP 域（承接语义归盘面其它门——首版承接轴删除锁）', () => {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'market-analysis', 'factor-pre-buy-check.js'), 'utf8');
    // 锁代码形状非注释（jsdoc 提及历史合法）：函数体/trace 键/常量绝迹
    assert.ok(!/function classifyWallet/.test(src), '在场三分函数残留');
    assert.ok(!/trace\.absorb|trace\.sell60|trace\.holdersHolding/.test(src), '承接轴 trace 键残留');
    assert.ok(!/PVP_ABSORB|PVP_NET_EPS|PVP_ACTIVE_IDLE_SEC|PVP_SELL_ZERO|PVP_UNSOLD/.test(src), '承接轴/在场常量残留');
  });
}

console.log('D. CD 四臂升格门（CD408）');
{
  const cd = (over) => Object.assign({}, over);
  check('D1 CD400 命中：qualBlocks≥1 ∧ 承接 <0.05', () =>
    assert.strictEqual(M.armDumpNoAbsorption(cd({ nearDumpQualBlocks: 2, nearDumpMinAbsorbBnb: 0.03 })), true));
  check('D2 CD400 不命中：承接 ≥0.05 / qualBlocks null', () => {
    assert.strictEqual(M.armDumpNoAbsorption(cd({ nearDumpQualBlocks: 1, nearDumpMinAbsorbBnb: 0.06 })), false);
    assert.strictEqual(M.armDumpNoAbsorption(cd({ nearDumpQualBlocks: null })), false);
  });
  check('D3 CD403 命中：卖方 ≥8 ∧ 承接比 <0.3（T003 形状 0.193）', () =>
    assert.strictEqual(M.armDumpLowAbsorption(cd({ nearDumpQualBlocks: 1, nearDumpWorstSellers: 23, nearDumpMinAbsorbBnb: 0.7, nearDumpWorstSellBnb: 3.62 })), true));
  check('D4 CD403 不命中：卖方 7 / 比 ≥0.3 / 锚缺', () => {
    assert.strictEqual(M.armDumpLowAbsorption(cd({ nearDumpQualBlocks: 1, nearDumpWorstSellers: 7, nearDumpMinAbsorbBnb: 0.1, nearDumpWorstSellBnb: 1 })), false);
    assert.strictEqual(M.armDumpLowAbsorption(cd({ nearDumpQualBlocks: 1, nearDumpWorstSellers: 9, nearDumpMinAbsorbBnb: 0.4, nearDumpWorstSellBnb: 1 })), false);
    assert.strictEqual(M.armDumpLowAbsorption(cd({})), false);
  });
  // CD401 代理线逐腿（基座=卖压两线达标+冷背景——T143 追裁定背景腿：低/中背景才构成 burst 语境）
  const cd401Base = { burstWaveSegSellPct: 35, burstWaveSegSellBnb: 0.5, burstSecSinceWaveEnd: 10, burstWaveWalletMedianBnb: 0.02, burstWaveWalletNetBnb: 0.5, burstPreSegBnbPerMin: 0.1, burstPreSegTicksPerMin: 2 };
  check('D5 CD401 代理全腿命中（冷背景）→ true', () =>
    assert.strictEqual(M.armBurstExitSellPressure(cd(cd401Base)), true));
  check('D5b 背景腿：高活跃背景（Go Brrrrr 形状 1.5B/min 15 笔/min）→ 不触发', () => {
    assert.strictEqual(M.armBurstExitSellPressure(cd({ ...cd401Base, burstPreSegBnbPerMin: 1.5, burstPreSegTicksPerMin: 15 })), false);
    assert.strictEqual(M.armBurstExitSellPressure(cd({ ...cd401Base, burstPreSegBnbPerMin: 0.6 })), false); // 额超线
    assert.strictEqual(M.armBurstExitSellPressure(cd({ ...cd401Base, burstPreSegTicksPerMin: 7 })), false); // 笔超线
  });
  check('D5c 背景腿：锚缺失（无段）→ 不触发（宁不拦）', () =>
    assert.strictEqual(M.armBurstExitSellPressure(cd({ ...cd401Base, burstPreSegBnbPerMin: null })), false));
  check('D6 CD401 波远离锚（>60s 历史遗迹）→ 不拦', () =>
    assert.strictEqual(M.armBurstExitSellPressure(cd({ ...cd401Base, burstSecSinceWaveEnd: 120 })), false));
  check('D7 CD401 波钱包中位非尘埃（≥0.05 大户波）→ 不拦', () =>
    assert.strictEqual(M.armBurstExitSellPressure(cd({ ...cd401Base, burstWaveWalletMedianBnb: 0.2 })), false));
  check('D8 CD401 波净流出（≤0 卖出引发）→ 不拦', () =>
    assert.strictEqual(M.armBurstExitSellPressure(cd({ ...cd401Base, burstWaveWalletNetBnb: -0.1 })), false));
  check('D9 CD401 无段（SellPct null）→ 不拦（拒方向证据缺席）', () =>
    assert.strictEqual(M.armBurstExitSellPressure(cd({})), false));
  const bg = { burstPreSegBnbPerMin: 0.1, burstPreSegTicksPerMin: 2 }; // 冷背景基座（背景腿两臂同加）
  check('D10 CD405 命中（冷背景）：单块 7 钱包 / 相邻两 slot 合计 7', () => {
    assert.strictEqual(M.armBurstBundledWave(cd({ ...bg, burstWaveBundleMaxWallets: 7 })), true);
    assert.strictEqual(M.armBurstBundledWave(cd({ ...bg, burstWaveBundleAdjPairSum: 8 })), true);
  });
  check('D10b CD405 背景腿：高活跃背景 7 钱包捆绑也不触发（两臂同加裁定）', () =>
    assert.strictEqual(M.armBurstBundledWave(cd({ burstPreSegBnbPerMin: 1.5, burstPreSegTicksPerMin: 15, burstWaveBundleMaxWallets: 9 })), false));
  check('D11 CD405 不命中：6 钱包（TukTuk 门外先例）', () =>
    assert.strictEqual(M.armBurstBundledWave(cd({ ...bg, burstWaveBundleMaxWallets: 6, burstWaveBundleAdjPairSum: 5 })), false));
}

console.log('E. 主入口组合');
{
  check('E1 全过 → pass=true reason=null version=FP1', () => {
    const r = M.evaluateFactorPreBuy(SNAP({ wallets: [W(0.2994, 0.1, 0.2994, 100)] }));
    assert.strictEqual(r.pass, true); assert.strictEqual(r.reason, null);
    assert.strictEqual(r.version, 'FP1'); assert.deepStrictEqual(r.arms, []);
  });
  check('E2 PVP 拒 → reason=pvp_no_big_participation（臂序最先）', () => {
    const r = M.evaluateFactorPreBuy(SNAP({ wallets: [W(0.1, 0, 0.1, 10)] }));
    assert.strictEqual(r.pass, false); assert.strictEqual(r.reason, 'pvp_no_big_participation');
  });
  check('E3 CD 臂命中（PVP 过）→ reason=cd 码', () => {
    const r = M.evaluateFactorPreBuy(SNAP({ wallets: [W(0.2994, 0.1, 0.2994, 100)],
      cheatDerived: { nearDumpQualBlocks: 1, nearDumpMinAbsorbBnb: 0.01 } }));
    assert.strictEqual(r.pass, false); assert.strictEqual(r.reason, 'cd400_dump_no_absorption');
    assert.deepStrictEqual(r.arms, ['cd400_dump_no_absorption']);
  });
  check('E4 分臂开关：enableCheatArms=false 只跑 PVP', () => {
    const r = M.evaluateFactorPreBuy(SNAP({ wallets: [W(0.2994, 0.1, 0.2994, 100)],
      cheatDerived: { nearDumpQualBlocks: 1, nearDumpMinAbsorbBnb: 0.01 } }), { enableCheatArms: false });
    assert.strictEqual(r.pass, true);
  });
  check('E5 源码锁：CD401 代理不含 stallBurstWave Jev 档（机械化路线锁）', () => {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'market-analysis', 'factor-pre-buy-check.js'), 'utf8');
    assert.ok(!/stallBurstWave/.test(src), '不得引用 Jev sbw 档');
    assert.ok(/PVP_TREAT03_BNB = 0\.29/.test(src), '0.29 视同线锁');
    assert.ok(/PVP_LEVEL02_BNB = 0\.19/.test(src), '0.2 级线锁');
  });
}

console.log(`\n结果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
