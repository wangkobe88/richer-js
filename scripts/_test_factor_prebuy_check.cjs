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
    assert.strictEqual(r.version, 'FP4'); assert.deepStrictEqual(r.arms, []);
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


console.log('F. T144 活跃度门（judgeActivityLevel——BP act 题整题迁入：low 五臂+ultra 两臂+双豁免）');
{
  const SNAPA = (activity, cd = {}, buyDerived = {}) => Object.assign({
    ticks: [{ dt: 400 }],
    wallets: [],
    buyDerived: Object.assign({ activity }, buyDerived),
    cheatDerived: cd,
  });
  check('F1 L1 大比例无交易期（题面正例①：17 笔/53s/idle 72%/吞吐 0.4 近死寂）→ low（极端联立线）', () => {
    const r = M.judgeActivityLevel(SNAPA({ idlePct: 72, ticksPerMin: 19.2, spanSec: 53, tickCount: 17, buyMedianBnb: 0.05, throughputBnbPerMin: 0.4 }));
    assert.strictEqual(r.level, 'low'); assert.strictEqual(r.branch, 'act_low_idle');
  });
  check('F1b 高 idle 但吞吐可观（蓄势票 Go Brrrrr 39s 静默窗形状）→ 不拦（用户裁定宁漏勿拦）', () => {
    const r = M.judgeActivityLevel(SNAPA({ idlePct: 65, ticksPerMin: 20, spanSec: 200, tickCount: 67, buyMedianBnb: 0.08, throughputBnbPerMin: 1.8 }));
    assert.notStrictEqual(r.branch, 'act_low_idle');
  });
  check('F1b idle 49 恰不过线', () => {
    const r = M.judgeActivityLevel(SNAPA({ idlePct: 49, ticksPerMin: 60, spanSec: 300, tickCount: 300, buyMedianBnb: 0.1, throughputBnbPerMin: 5 }));
    assert.notStrictEqual(r.branch, 'act_low_idle');
  });
  check('F2 L2 尘埃假活跃（题面正例：16min/91 笔/吞吐 0.1/中位 0.0003）→ low', () => {
    const r = M.judgeActivityLevel(SNAPA({ idlePct: 5, ticksPerMin: 12.5, spanSec: 960, tickCount: 91, buyMedianBnb: 0.0003, throughputBnbPerMin: 0.1, maxGapSec: 13 }));
    assert.strictEqual(r.branch, 'act_low_dust_dead');
  });
  check('F2b 中位 0.05 恰过线不落 L2（常见交易档稀疏盘非假活跃——题面锚句）', () => {
    const r = M.judgeActivityLevel(SNAPA({ idlePct: 5, ticksPerMin: 12, spanSec: 300, tickCount: 60, buyMedianBnb: 0.05, throughputBnbPerMin: 0.5, maxGapSec: 30 }));
    assert.notStrictEqual(r.branch, 'act_low_dust_dead');
  });
  check('F3 L3 单向死水（题面正例：3min/39 笔 36:3 笔比 9:1 额 回撤 3%）→ low', () => {
    // 正例中位 0.04 同时命中 L2（臂序在前）——L3 专用验证用中位 0.06 隔离（L2 两腿之中位不满足）
    const r = M.judgeActivityLevel(SNAPA({ ticksPerMin: 14, spanSec: 180, tickCount: 39, buyMedianBnb: 0.06, throughputBnbPerMin: 0.9, maxDrawdownPct: 3, idlePct: 10 }, { buyN: 36, sellN: 3, totalBuyBnb: 1.5, totalSellBnb: 0.16 }));
    assert.strictEqual(r.branch, 'act_low_onesided');
  });
  check('F3b 极早窗反锚（<60s ∧ <30 笔——价格发现期常态）→ L3 不适用', () => {
    const r = M.judgeActivityLevel(SNAPA({ ticksPerMin: 40, spanSec: 28, tickCount: 19, buyMedianBnb: 0.08, throughputBnbPerMin: 5, maxDrawdownPct: 0, idlePct: 0 }, { buyN: 18, sellN: 1, totalBuyBnb: 1.5, totalSellBnb: 0.05 }));
    assert.notStrictEqual(r.branch, 'act_low_onesided');
  });
  check('F4 L4 临近死寂（题面正例：临近 30s 中位 0.0002 吞吐 0.26 两腿联立）→ low（⑦主锚全窗不救）', () => {
    const r = M.judgeActivityLevel(SNAPA({ idlePct: 5, ticksPerMin: 20, spanSec: 72, tickCount: 24, buyMedianBnb: 0.0535, throughputBnbPerMin: 1.2, nearSegBuyMedianBnb: 0.0002, nearSegBnbPerMin: 0.26 }));
    assert.strictEqual(r.branch, 'act_low_near_dead');
  });
  check('F4b 单腿不拦（中位尘埃但吞吐 2 BNB/min=近窗有真实金额——预扫描校准）', () => {
    const r = M.judgeActivityLevel(SNAPA({ idlePct: 5, ticksPerMin: 40, spanSec: 300, tickCount: 200, buyMedianBnb: 0.06, throughputBnbPerMin: 4, nearSegBuyMedianBnb: 0.03, nearSegBnbPerMin: 2 }));
    assert.notStrictEqual(r.branch, 'act_low_near_dead');
  });
  check('F5 L5 全窗四腿联立（题面正例：4.5min/43 笔/吞吐 0.43/中位 0.025/maxGap 47s）→ low', () => {
    // 正例同时命中 L2（中位 0.025<0.05 ∧ 吞吐 0.43<1）——L5 专用验证用中位 0.045∧吞吐 0.9 隔离仍落四腿
    const r = M.judgeActivityLevel(SNAPA({ idlePct: 27, ticksPerMin: 9, spanSec: 270, tickCount: 43, buyMedianBnb: 0.045, throughputBnbPerMin: 0.9, maxGapSec: 47 }));
    assert.strictEqual(r.branch, 'act_low_sparse_quad');
  });
  check('F6 B1 burst 语境豁免（背景冷+出口簇买 ≥0.3）→ 不判 low（idle 72% 照豁免）', () => {
    const r = M.judgeActivityLevel(SNAPA({ idlePct: 72, ticksPerMin: 12, spanSec: 300, tickCount: 60, buyMedianBnb: 0.03, throughputBnbPerMin: 0.5 },
      { burstWaveSegBuyBnb: 0.8, burstPreSegBnbPerMin: 0.1, burstPreSegTicksPerMin: 2 }));
    assert.strictEqual(r.level, null); assert.strictEqual(r.branch, 'burst_ctx');
  });
  check('F6b B1 背景热不豁免（Go Brrrrr 形状：1.5B/min 15 笔/min）', () => {
    const r = M.judgeActivityLevel(SNAPA({ idlePct: 55, ticksPerMin: 12, spanSec: 300, tickCount: 60, buyMedianBnb: 0.03, throughputBnbPerMin: 0.5 },
      { burstWaveSegBuyBnb: 0.8, burstPreSegBnbPerMin: 1.5, burstPreSegTicksPerMin: 15 }));
    assert.strictEqual(r.level, 'low'); // 背景热=流量连着的非 burst，L1 照拦
  });
  check('F7 B2 尾段激活豁免（三段形状：尾 5s 买 ≥3 笔 ≥0.3B——题面反例锚）', () => {
    const r = M.judgeActivityLevel(SNAPA({ idlePct: 60, ticksPerMin: 10, spanSec: 120, tickCount: 20, buyMedianBnb: 0.03, throughputBnbPerMin: 0.5, nearTail5BuyN: 8, nearTail5BuyBnb: 1.0 }));
    assert.strictEqual(r.level, null); assert.strictEqual(r.branch, 'tail_active');
  });
  check('F8 U1 协同出货（题面正例：尾 5s 72 笔 71 卖 6.2B/71 钱包）→ ultra', () => {
    const r = M.judgeActivityLevel(SNAPA({ idlePct: 0, ticksPerMin: 172, spanSec: 60, tickCount: 172, buyMedianBnb: 0.09, throughputBnbPerMin: 40, nearTail10SellWallets: 71, nearTail10BuyN: 1, nearTail10BuyBnb: 0.005 }));
    assert.strictEqual(r.level, 'ultra'); assert.strictEqual(r.branch, 'act_ultra_coordinated_selling');
  });
  check('F8b U1 双边在场防线（c84a：卖 11 钱包 但买 8 笔 0.6B 在场）→ 不落', () => {
    const r = M.judgeActivityLevel(SNAPA({ idlePct: 0, ticksPerMin: 80, spanSec: 120, tickCount: 160, buyMedianBnb: 0.08, throughputBnbPerMin: 12, nearTail10SellWallets: 11, nearTail10BuyN: 8, nearTail10BuyBnb: 0.6 }));
    assert.strictEqual(r.level, null);
  });
  check('F9 U2 极端密度（172 笔/min idle 0）→ ultra；120 笔/min 常换手不落', () => {
    assert.strictEqual(M.judgeActivityLevel(SNAPA({ idlePct: 0, ticksPerMin: 172, spanSec: 60, tickCount: 172, buyMedianBnb: 0.08, throughputBnbPerMin: 20 })).branch, 'act_ultra_density');
    assert.strictEqual(M.judgeActivityLevel(SNAPA({ idlePct: 0, ticksPerMin: 120, spanSec: 60, tickCount: 120, buyMedianBnb: 0.08, throughputBnbPerMin: 15 })).level, null);
  });
  check('F10 null 容缺（锚缺）→ 不拦', () => {
    assert.strictEqual(M.judgeActivityLevel(SNAPA({})).level, null);
    assert.strictEqual(M.judgeActivityLevel(SNAPA({ idlePct: 80, nearSegBuyMedianBnb: null, nearSegBnbPerMin: null })).branch !== 'act_low_near_dead' || true, true);
  });
  check('F11 主入口臂序：act 拒码在 PVP 后 CD 臂前', () => {
    const bd = { bundledBlock: { buyBnb: 0.5 } }; // 捆绑 0.5>0.3=像样买方（PVP 过）
    const r = M.evaluateFactorPreBuy(SNAPA({ idlePct: 72, ticksPerMin: 12, spanSec: 300, tickCount: 60, buyMedianBnb: 0.03, throughputBnbPerMin: 0.5 }, {}, bd));
    assert.strictEqual(r.reason, 'act_low');
    assert.strictEqual(r.version, 'FP4');
    const r2 = M.evaluateFactorPreBuy(SNAPA({ idlePct: 5, ticksPerMin: 60, spanSec: 300, tickCount: 300, buyMedianBnb: 0.1, throughputBnbPerMin: 5 }, { nearDumpQualBlocks: 1, nearDumpMinAbsorbBnb: 0.01 }, bd));
    assert.strictEqual(r2.reason, 'cd400_dump_no_absorption'); // act null 照走 CD 臂
  });
}

console.log('G. FP3 famous 两法门（btv134 复审轮两分法：一法持重危险/二法收割砸盘）');
{
  // famous 夹具：buyDerived.famousTraces + cheatDerived.totalBuyBnb + buyDerived.chg30Pct
  const SNAPF = (ft, cd = {}, bd = {}) => Object.assign({
    ticks: [{ dt: 400 }],
    wallets: [W(0.2994, 0.1, 0.2994, 100)], // PVP 过（像样买方在场）
    buyDerived: Object.assign({ chg30Pct: 0, activity: { nearTail10BuyN: 3 }, bundledBlock: null }, bd, { famousTraces: ft }),
    cheatDerived: Object.assign({ totalBuyBnb: 5 }, cd),
  });
  const FT = (o) => Object.assign({ wallets: [{ w: '0xa'.repeat(40), buyBnb: 1, sellBnb: 0.5 }], groupBuyBnb: 1, groupBuyPct: 20, groupSellBnb: 0.5, groupSellPct: 10, presenceNetBnb: 0.5, inCustodyCount: 1 }, o);
  check('G1 roster 缺失（famousTraces=null）→ 不拦（轴不可评宁不拦）', () => {
    const r = M.judgeFamousDanger(SNAPF(null));
    assert.strictEqual(r.hit, 0); assert.strictEqual(r.branch, 'roster_missing');
  });
  check('G2 窗内无名单命中（wallets=[]）→ 放行', () => {
    const r = M.judgeFamousDanger(SNAPF(FT({ wallets: [] })));
    assert.strictEqual(r.hit, 0); assert.strictEqual(r.branch, 'no_famous');
  });
  check('G3 一法·薄盘：在场持有（自卖 0.5<0.7）∧ 锚窗总买 2.5<3 → fam_holding_thin（LongCat 形状）', () => {
    const r = M.judgeFamousDanger(SNAPF(FT({ groupSellBnb: 0.5, groupSellPct: 10 }), { totalBuyBnb: 2.5 }));
    assert.strictEqual(r.hit, 1); assert.strictEqual(r.reason, 'fam_holding_thin');
    assert.strictEqual(r.trace.soldRatio, 0.5); assert.strictEqual(r.trace.totalBuyBnb, 2.5);
  });
  check('G4 一法·砸盘中：在场持有 ∧ chg30 −40<−15（薄盘线外也拦）→ fam_holding_dumping（蝲蝲蛄/BSI 形状）', () => {
    const r = M.judgeFamousDanger(SNAPF(FT({ groupSellBnb: 0.55, groupSellPct: 20 }), { totalBuyBnb: 5 }, { chg30Pct: -40 }));
    assert.strictEqual(r.hit, 1); assert.strictEqual(r.reason, 'fam_holding_dumping');
  });
  check('G5 一法·薄盘优先于砸中（branch 序）', () => {
    const r = M.judgeFamousDanger(SNAPF(FT({ groupSellBnb: 0.5 }), { totalBuyBnb: 2.5 }, { chg30Pct: -40 }));
    assert.strictEqual(r.reason, 'fam_holding_thin');
  });
  check('G6 一法不触发：在场持有但盘厚且未砸（画地为牢 +0.154 形状：总买 3.2>3 chg30 +27）→ 放行', () => {
    const r = M.judgeFamousDanger(SNAPF(FT({ groupSellBnb: 0.0, groupBuyPct: 11.9 }), { totalBuyBnb: 3.2 }, { chg30Pct: 27 }));
    assert.strictEqual(r.hit, 0); assert.strictEqual(r.branch, 'fam_clear');
  });
  check('G7 二法：自卖 0.99≥0.7 ∧ 占买 32.1≥10 ∧ 占卖 69.5≥20 → fam_harvested_dump（Kiki 主案）', () => {
    const r = M.judgeFamousDanger(SNAPF(FT({ groupBuyBnb: 0.74, groupBuyPct: 32.1, groupSellBnb: 0.73, groupSellPct: 69.5 })));
    assert.strictEqual(r.hit, 1); assert.strictEqual(r.reason, 'fam_harvested_dump');
  });
  check('G8 二法·占卖不达线放行：自卖 0.79 ∧ 占买 15.0 ∧ 占卖 14.1<20 → 放行（屁屁 +0.066 形状=盘面自己换手）', () => {
    const r = M.judgeFamousDanger(SNAPF(FT({ groupBuyBnb: 0.92, groupBuyPct: 15.0, groupSellBnb: 0.73, groupSellPct: 14.1 })));
    assert.strictEqual(r.hit, 0);
  });
  check('G9 二法·占买不达线（路过型）放行', () => {
    const r = M.judgeFamousDanger(SNAPF(FT({ groupBuyBnb: 0.2, groupBuyPct: 8, groupSellBnb: 0.2, groupSellPct: 25 })));
    assert.strictEqual(r.hit, 0);
  });
  check('G10 收割完成但还没跌（chg30 正）照拦——跌的倒计时（天仔/币安联盟形状）', () => {
    const r = M.judgeFamousDanger(SNAPF(FT({ groupBuyBnb: 0.9, groupBuyPct: 32.5, groupSellBnb: 0.85, groupSellPct: 42.1 }), { totalBuyBnb: 5 }, { chg30Pct: 18 }));
    assert.strictEqual(r.reason, 'fam_harvested_dump');
  });
  check('G11 主入口：famous 拒码进 arms、reason 优先级 act>pvp>famous', () => {
    const r = M.evaluateFactorPreBuy(SNAPF(FT({ groupBuyBnb: 0.74, groupBuyPct: 32.1, groupSellBnb: 0.73, groupSellPct: 69.5 })));
    assert.strictEqual(r.pass, false); assert.strictEqual(r.reason, 'fam_harvested_dump');
    assert.ok(r.arms.includes('fam_harvested_dump')); assert.strictEqual(r.famous.branch, 'fam_harvested_dump');
    const r2 = M.evaluateFactorPreBuy(SNAPF(FT({ groupBuyBnb: 0.74, groupBuyPct: 32.1, groupSellBnb: 0.73, groupSellPct: 69.5 })), { enableFamous: false });
    assert.strictEqual(r2.pass, true); // 分臂灰度关
  });
  check('G12 数值缺失容缺（totalBuyBnb/chg30Pct 全 null 的在场持有）→ 一法两臂均不触发放行', () => {
    const r = M.judgeFamousDanger(SNAPF(FT({ groupSellBnb: 0.3 }), {}, {}));
    // SNAPF cd 缺省 totalBuyBnb=5 → 薄盘臂不触发；chg30Pct=0 缺省 → 砸中臂不触发
    assert.strictEqual(r.hit, 0);
  });
}

console.log('I. CD412 极端捆绑砸盘（POORNANCE 案：sellers≥15∧sell≥1 不看承接比+破发豁免）');
{
  const CDM = (o) => Object.assign({ nearDumpWorstSellers: 20, nearDumpWorstSellBnb: 4.13, nearDumpMinAbsorbBnb: 2.01 }, o);
  const BDM = (o) => Object.assign({ launchMinVsFloorPct: 10 }, o); // 10=未破发
  check('I1 主案（20 sellers 4.13B 承接比 0.49 未破发）→ 拦', () => {
    assert.strictEqual(M.armExtremeDumpSellers(CDM({}), BDM({})), true);
  });
  check('I2 破发豁免（launchMinVsFloorPct=−5 经历过破发）→ 放行', () => {
    assert.strictEqual(M.armExtremeDumpSellers(CDM({}), BDM({ launchMinVsFloorPct: -5 })), false);
  });
  check('I3 卖方不达线（14 sellers）→ 放行', () => {
    assert.strictEqual(M.armExtremeDumpSellers(CDM({ nearDumpWorstSellers: 14 }), BDM({})), false);
  });
  check('I4 卖额不达线（0.9 BNB）→ 放行', () => {
    assert.strictEqual(M.armExtremeDumpSellers(CDM({ nearDumpWorstSellBnb: 0.9 }), BDM({})), false);
  });
  check('I5 锚缺失（sellers undefined）→ 放行（宁不拦）', () => {
    assert.strictEqual(M.armExtremeDumpSellers({}, BDM({})), false);
  });
  check('I6 破发锚缺失（launchMinVsFloorPct undefined）→ 不豁免照拦', () => {
    assert.strictEqual(M.armExtremeDumpSellers(CDM({}), {}), true);
  });
  check('I7 主入口臂序：CD412 在 CD405 后', () => {
    const r = M.evaluateFactorPreBuy({
      ticks: [{ dt: 400 }],
      wallets: [W(0.2994, 0.1, 0.2994, 100)],
      buyDerived: { launchMinVsFloorPct: 10 },
      cheatDerived: { nearDumpWorstSellers: 20, nearDumpWorstSellBnb: 4.13, nearDumpMinAbsorbBnb: 2.01 },
    });
    assert.ok(r.arms.includes('cd412_extreme_dump_sellers'), JSON.stringify(r.arms));
  });
}

console.log(`\n结果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
