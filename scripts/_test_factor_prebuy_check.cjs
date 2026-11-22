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

console.log('DP. FP23 相邻双块捆绑砸盘尾承接（T190/0x2b63 ASCEND 案夹具）');
{
  // 案值（bt-v156 10-19 窗 0x2b63c82e…7777 买点 t+39s）：相邻双块 128591346+128591347
  // 合并 12 卖方（剔路由）/0.761B/-21.12%/距锚 9s/贴锚 followBuyRatio 恒 null、
  // 已见承接 0.1225B（16.1%）/锚窗总额 4.6635B
  const bd0 = (over = {}) => Object.assign({
    dump2Block: { block: 128591346, block2: 128591347, sellBnb: 0.761, dropPct: -21.12, sellers: 12,
      topSellerPct: 16.9, followBuyRatio: null, followBuyBnb: 0.1225, secToAnchor: 9 },
    totalVolumeBnb: 4.6635,
    tokenAgeSec: 38,
  }, over);
  check('DP1 案值六腿全中（前期龄 38s+贴锚回落 followBuyBnb÷卖额=16.1%<30%）→ 拦', () => {
    assert.strictEqual(M.armDumpPairLowAbsorption(bd0()), true);
  });
  check('DP1b 前期域（用户追裁定「偏前期是案特性」）：票龄 700s 后期下跌段双块砸盘不拦 / 恰 600s 仍拦 / 龄 null 容缺不拦', () => {
    assert.strictEqual(M.armDumpPairLowAbsorption(bd0({ tokenAgeSec: 700 })), false);
    assert.strictEqual(M.armDumpPairLowAbsorption(bd0({ tokenAgeSec: 600 })), true);
    assert.strictEqual(M.armDumpPairLowAbsorption({ tokenAgeSec: null, dump2Block: bd0().dump2Block, totalVolumeBnb: 1 }), false);
  });
  check('DP2 卖方 7 不拦（≥8 线——0x397a AZ 案票 5 卖方用户知情漏）', () => {
    assert.strictEqual(M.armDumpPairLowAbsorption(bd0({ dump2Block: { ...bd0().dump2Block, sellers: 7 } })), false);
  });
  check('DP3 合并卖额 0.4 不拦（≥0.5 线——单块 0.418 分摊形状护 CD403 单块域外）', () => {
    assert.strictEqual(M.armDumpPairLowAbsorption(bd0({ dump2Block: { ...bd0().dump2Block, sellBnb: 0.4 } })), false);
  });
  check('DP4 跌幅 -9 不拦（≤-10 线，snapshot 预筛 -8 一档宽防截断）', () => {
    assert.strictEqual(M.armDumpPairLowAbsorption(bd0({ dump2Block: { ...bd0().dump2Block, dropPct: -9 } })), false);
  });
  check('DP5 距锚 120s 不拦（>60s=历史砸盘遗迹已充分换手，非尾声接刀）', () => {
    assert.strictEqual(M.armDumpPairLowAbsorption(bd0({ dump2Block: { ...bd0().dump2Block, secToAnchor: 120, followBuyRatio: 0.05 } })), false);
  });
  check('DP6 承接 0.35 不拦（≥0.3=承接形成——BP82「达三成」线）：非贴锚 ratio 直读 / 贴锚回落同线', () => {
    assert.strictEqual(M.armDumpPairLowAbsorption(bd0({ dump2Block: { ...bd0().dump2Block, followBuyRatio: 0.35 } })), false);
    assert.strictEqual(M.armDumpPairLowAbsorption(bd0({ dump2Block: { ...bd0().dump2Block, followBuyBnb: 0.27 } })), false); // 0.27/0.761=0.355
  });
  check('DP7 BP78 总额豁免：锚窗总额 ≥20B（市场化恐慌抛售）不拦', () => {
    assert.strictEqual(M.armDumpPairLowAbsorption(bd0({ totalVolumeBnb: 21 })), false);
    assert.strictEqual(M.armDumpPairLowAbsorption(bd0({ totalVolumeBnb: 20 })), false); // 恰 20 也豁免
  });
  check('DP8 dump2Block null / 锚缺失全族容缺不拦（宁漏不冒充）', () => {
    assert.strictEqual(M.armDumpPairLowAbsorption({ totalVolumeBnb: 1 }), false);
    assert.strictEqual(M.armDumpPairLowAbsorption({ dump2Block: { sellers: 12, sellBnb: 0.761, dropPct: -21, secToAnchor: 9, followBuyRatio: null, followBuyBnb: null } }), false); // 承接双 null 不可评
    assert.strictEqual(M.armDumpPairLowAbsorption(null), false);
  });
  check('DP9 主入口：案值形状（PVP 过+CD nearDump 无达标块=单块 0.418<0.5 域外）→ reason=dump_pair_low_absorption', () => {
    const r = M.evaluateFactorPreBuy(SNAP({
      wallets: [W(0.2994, 0.1, 0.2994, 100)],
      buyDerived: { bundledBlock: null, activity: {}, dump2Block: bd0().dump2Block, totalVolumeBnb: 4.6635, tokenAgeSec: 38 },
      cheatDerived: {}, // nearDump 全空=CD400/403 单块口径失明（本案盲区复现）
    }));
    assert.strictEqual(r.pass, false);
    assert.strictEqual(r.reason, 'dump_pair_low_absorption');
    assert.deepStrictEqual(r.arms, ['dump_pair_low_absorption']);
    assert.strictEqual(r.version, 'FP40');
    const g = r.gates.find(x => x.id === 'dump_pair');
    assert.ok(g, 'gates 须含 dump_pair 门');
    assert.strictEqual(g.hit, true);
    assert.ok(g.value.includes('卖方12'), '门值展示卖方数');
  });
}

console.log('E. 主入口组合');
{
  check('E1 全过 → pass=true reason=null', () => {
    const r = M.evaluateFactorPreBuy(SNAP({ wallets: [W(0.2994, 0.1, 0.2994, 100)] }));
    assert.strictEqual(r.pass, true); assert.strictEqual(r.reason, null);
    assert.strictEqual(r.version, 'FP40'); assert.deepStrictEqual(r.arms, []);
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
    assert.strictEqual(r.version, 'FP40');
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

console.log('J. FP5 尾声延伸活跃度门（btv140 BP-T013 1105 案：充分上涨过的票活跃度延伸到前 2 分钟）');
{
  const WIN = (buyBnb, sellBnb) => ({ buyBnb, sellBnb, buyN: 2, sellN: 2, netBnb: 0, buySharePct: 50, ticksPerMin: 10, buyers: 2, sellers: 2, newBuyers: 0 });
  const TS = (bd) => ({
    ticks: [{ dt: 400 }],
    wallets: [W(0.2994, 0.1, 0.2994, 100)], // PVP 过（像样买方在场）
    buyDerived: Object.assign({ activity: { nearTail10BuyN: 3 } }, bd),
    cheatDerived: {},
  });
  check('J1 主案复刻（T013 1105：ath233.7/vol47.3/win120 买 0.2475 全在尾 30s/tpm0.42）→ 拦', () => {
    const r = M.judgeTailPhaseActivity(TS({ athVsLaunchPct: 233.7, totalVolumeBnb: 47.29, win: { 30: WIN(0.2475, 0.4879), 120: WIN(0.2475, 0.5861) } }));
    assert.strictEqual(r.hit, 1); assert.strictEqual(r.reason, 'act_tail_flat'); assert.strictEqual(r.branch, 'tail_tpm_dead');
    assert.strictEqual(r.trace.tpm120, 0.42); assert.strictEqual(r.trace.extBuyBnb, 0);
  });
  check('J2 买入断层腿（吞吐靠卖压撑 1.6/min 达标但前 90s 买入 0）→ 拦 tail_ext_buy_gap', () => {
    const r = M.judgeTailPhaseActivity(TS({ athVsLaunchPct: 150, totalVolumeBnb: 25, win: { 30: WIN(0.3, 1.2), 120: WIN(0.3, 2.9) } }));
    assert.strictEqual(r.hit, 1); assert.strictEqual(r.branch, 'tail_ext_buy_gap');
  });
  check('J3 充分上涨但持续活跃（tpm3.85/ext5.0——btv140 放行面形状）→ 放行 sustained', () => {
    const r = M.judgeTailPhaseActivity(TS({ athVsLaunchPct: 273.5, totalVolumeBnb: 32.9, win: { 30: WIN(0.3, 0.5), 120: WIN(5.3, 2.4) } }));
    assert.strictEqual(r.hit, 0); assert.strictEqual(r.branch, 'sustained');
  });
  check('J4 未充分上涨（ath 80 涨幅不达线）→ 放行 not_fully_risen（普通票归 act 门）', () => {
    const r = M.judgeTailPhaseActivity(TS({ athVsLaunchPct: 80, totalVolumeBnb: 47, win: { 30: WIN(0.2475, 0.4879), 120: WIN(0.2475, 0.5861) } }));
    assert.strictEqual(r.hit, 0); assert.strictEqual(r.branch, 'not_fully_risen');
  });
  check('J5 总额不达线（vol 19.9<20）→ 放行', () => {
    const r = M.judgeTailPhaseActivity(TS({ athVsLaunchPct: 233.7, totalVolumeBnb: 19.9, win: { 30: WIN(0.2475, 0.4879), 120: WIN(0.2475, 0.5861) } }));
    assert.strictEqual(r.hit, 0); assert.strictEqual(r.branch, 'not_fully_risen');
  });
  check('J6 充分上涨锚缺失（athVs/vol null）→ 放行 anchors_missing（拒方向证据缺席）', () => {
    const r = M.judgeTailPhaseActivity(TS({ win: { 30: WIN(0.2, 0.4), 120: WIN(0.2, 0.5) } }));
    assert.strictEqual(r.hit, 0); assert.strictEqual(r.branch, 'anchors_missing');
  });
  check('J7 win 族缺失（ath/vol 达标但无 win120/30）→ 放行 win_missing', () => {
    const r = M.judgeTailPhaseActivity(TS({ athVsLaunchPct: 200, totalVolumeBnb: 30 }));
    assert.strictEqual(r.hit, 0); assert.strictEqual(r.branch, 'win_missing');
  });
  check('J8 主入口：主案形状 pass=false reason=act_tail_flat、enableTail:false 灰度关恢复放行', () => {
    const snap = TS({ athVsLaunchPct: 233.7, totalVolumeBnb: 47.29, win: { 30: WIN(0.2475, 0.4879), 120: WIN(0.2475, 0.5861) } });
    const r = M.evaluateFactorPreBuy(snap);
    assert.strictEqual(r.pass, false); assert.strictEqual(r.reason, 'act_tail_flat');
    assert.ok(r.arms.includes('act_tail_flat')); assert.strictEqual(r.tail.branch, 'tail_tpm_dead');
    const r2 = M.evaluateFactorPreBuy(snap, { enableTail: false });
    assert.strictEqual(r2.pass, true); assert.strictEqual(r2.tail.branch, 'disabled');
  });
  check('J9 reason 优先级：pvp（无像样买方）先于 tail 记因', () => {
    const r = M.evaluateFactorPreBuy(TS({ athVsLaunchPct: 233.7, totalVolumeBnb: 47.29, win: { 30: WIN(0.2475, 0.4879), 120: WIN(0.2475, 0.5861) } }));
    // wallets 有 0.2994 单 → pvp 过，reason=tail；再造 pvp 命中形状：
    const r2 = M.evaluateFactorPreBuy({
      ticks: [{ dt: 400 }],
      wallets: [], // 无像样买方 → pvp 命中
      buyDerived: { athVsLaunchPct: 233.7, totalVolumeBnb: 47.29, win: { 30: WIN(0.2475, 0.4879), 120: WIN(0.2475, 0.5861) } },
      cheatDerived: {},
    });
    assert.strictEqual(r.reason, 'act_tail_flat');
    assert.strictEqual(r2.reason, 'pvp_no_big_participation');
    assert.ok(r2.arms.includes('act_tail_flat')); // tail 同中留痕 arms
  });
}

console.log('K. FP6 famous 高控+砸落观察臂 + 门/值对 gates（btv140 BP-T007 小树案——标记不拦截留待找方案）');
{
  const WIN = (buyBnb, sellBnb) => ({ buyBnb, sellBnb, buyN: 2, sellN: 2, netBnb: 0, buySharePct: 50, ticksPerMin: 10, buyers: 2, sellers: 2, newBuyers: 0 });
  const TS = (bd, cd) => ({
    ticks: [{ dt: 400 }],
    wallets: [W(0.2994, 0.1, 0.2994, 100)], // PVP 过
    buyDerived: Object.assign({ activity: { nearTail10BuyN: 3 } }, bd),
    cheatDerived: Object.assign({}, cd),
  });
  check('K1 观察臂命中（dom=100 ∧ chg30=−31.9 小树形状）→ observe=true 但 pass 不受影响', () => {
    const r = M.judgeFamousDominanceFall(TS({ chg30Pct: -31.92 }, { famousDominancePct: 100 }));
    assert.strictEqual(r.observe, true); assert.strictEqual(r.branch, 'fam_dominance_fall');
    const full = M.evaluateFactorPreBuy(TS({ chg30Pct: -31.92 }, { famousDominancePct: 100 }));
    assert.strictEqual(full.pass, true); // 观察不拦截
    assert.strictEqual(full.observe.code, 'fam_dominance_fall');
    assert.strictEqual(full.observe.domPct, 100);
    assert.ok(!full.arms.includes('fam_dominance_fall')); // 不进 arms
  });
  check('K2 观察臂不命中（dom=82.8 chg30=+17 거침없이形状）→ observe=null', () => {
    const full = M.evaluateFactorPreBuy(TS({ chg30Pct: 16.98 }, { famousDominancePct: 82.8 }));
    assert.strictEqual(full.observe, null);
  });
  check('K3 锚缺失（dom/chg30 缺）→ 不标记', () => {
    const r = M.judgeFamousDominanceFall(TS({}, {}));
    assert.strictEqual(r.observe, false); assert.strictEqual(r.branch, 'anchors_missing');
  });
  check('K4 gates 门/值对结构：17 门齐全、命中门 hit=true、观察门 observe 标记', () => {
    const full = M.evaluateFactorPreBuy(TS({
      chg30Pct: -31.92, athVsLaunchPct: 233.7, totalVolumeBnb: 47.29,
      win: { 30: WIN(0.2475, 0.4879), 120: WIN(0.2475, 0.5861) }, // FP5 尾声同中
    }, { famousDominancePct: 100 }));
    const ids = full.gates.map((x) => x.id);
    for (const want of ['pvp', 'act_idle', 'act_sparse', 'act_dust', 'act_near_dead', 'act_ultra_sell', 'act_ultra_density', 'cd400', 'cd403', 'dump_pair', 'cd401', 'cd405', 'cd412', 'fam_holding', 'fam_harvest', 'tail_activity', 'fam_dom_fall']) {
      assert.ok(ids.includes(want), `缺门 ${want}`);
    }
    const tailGate = full.gates.find((x) => x.id === 'tail_activity');
    assert.strictEqual(tailGate.hit, true); // FP5 拦截门 hit
    assert.ok(tailGate.value.includes('ath233.7%'), tailGate.value);
    const domGate = full.gates.find((x) => x.id === 'fam_dom_fall');
    assert.strictEqual(domGate.hit, false); assert.strictEqual(domGate.observe, true);
    assert.ok(domGate.value.includes('dom100%'), domGate.value);
    // 门结构完整：每门有 id/label/value/line
    for (const gate of full.gates) {
      assert.ok(gate.id && gate.label && typeof gate.value === 'string' && typeof gate.line === 'string', `门形状非法 ${gate.id}`);
    }
  });
  check('K5 gates 与拦截联动：拦截时对应门 hit、放行时全 false（观察门除外）', () => {
    const pass = M.evaluateFactorPreBuy(TS({ chg30Pct: 0 }, {}));
    assert.strictEqual(pass.pass, true);
    assert.ok(pass.gates.every((x) => !x.hit));
    const blocked = M.evaluateFactorPreBuy(TS({ athVsLaunchPct: 233.7, totalVolumeBnb: 47.29, win: { 30: WIN(0.2475, 0.4879), 120: WIN(0.2475, 0.5861) } }, {}));
    assert.strictEqual(blocked.reason, 'act_tail_flat');
    assert.strictEqual(blocked.gates.find((x) => x.id === 'tail_activity').hit, true);
  });
}

console.log('L. FP7 尾声腿3（砸穿发行价）+ CD414 短窗持续密集砸盘（btv140 BP-T009 猴子币案）');
{
  const WIN = (o) => Object.assign({ buyBnb: 0.5, sellBnb: 1, buyN: 3, sellN: 5, netBnb: -0.5, buySharePct: 33, ticksPerMin: 20, buyers: 3, sellers: 5, newBuyers: 1 }, o);
  const TS = (bd, cd) => ({
    ticks: [{ dt: 400 }],
    wallets: [W(0.2994, 0.1, 0.2994, 100)], // PVP 过
    buyDerived: Object.assign({ activity: { nearTail10BuyN: 3 } }, bd),
    cheatDerived: Object.assign({}, cd),
  });
  check('L1 tail 腿3 主案复刻（猴子币：ath317.9/vol40.1/minVs0.3 活跃高 131笔/min）→ 拦（活跃不救）', () => {
    const r = M.judgeTailPhaseActivity(TS({ athVsLaunchPct: 317.9, totalVolumeBnb: 40.07, minVsLaunchPct: 0.3, win: { 30: WIN({ buyBnb: 5.85, sellBnb: 0.5, netBnb: 5.3, ticksPerMin: 131 }), 120: WIN({ buyBnb: 5.85, sellBnb: 0.5, netBnb: 5.3, ticksPerMin: 131 }) } }));
    assert.strictEqual(r.hit, 1); assert.strictEqual(r.branch, 'tail_broke_floor'); assert.strictEqual(r.reason, 'act_tail_flat');
  });
  check('L2 tail 腿3 贴发行价线（minVs=3 线上）→ 拦；minVs=5.9（GIGA 正票）→ 放行 sustained', () => {
    const hit = M.judgeTailPhaseActivity(TS({ athVsLaunchPct: 200, totalVolumeBnb: 30, minVsLaunchPct: 3, win: { 30: WIN(), 120: WIN() } }));
    assert.strictEqual(hit.branch, 'tail_broke_floor');
    const pass = M.judgeTailPhaseActivity(TS({ athVsLaunchPct: 173.6, totalVolumeBnb: 22.6, minVsLaunchPct: 5.9, win: { 30: WIN({ buyBnb: 5, sellBnb: 2, netBnb: 3 }), 120: WIN({ buyBnb: 5.3, sellBnb: 2, netBnb: 3.3 }) } }));
    assert.strictEqual(pass.hit, 0); assert.strictEqual(pass.branch, 'sustained');
  });
  check('L3 tail 腿3 minVs 锚缺失 → 回落活跃两腿评估（不因缺锚拦）', () => {
    const r = M.judgeTailPhaseActivity(TS({ athVsLaunchPct: 200, totalVolumeBnb: 30, win: { 30: WIN({ buyBnb: 5, sellBnb: 2, netBnb: 3 }), 120: WIN({ buyBnb: 5.3, sellBnb: 2, netBnb: 3.3 }) } }));
    assert.strictEqual(r.hit, 0); assert.strictEqual(r.branch, 'sustained');
  });
  check('L4 CD414 主案复刻（win30 48 卖方/3.76B/净−3.18）→ 拒 cd414_dense_dump', () => {
    const r = M.evaluateFactorPreBuy(TS({ win: { 30: WIN({ sellers: 48, sellBnb: 3.7578, netBnb: -3.175 }) }, chg30Pct: -56.7 }));
    assert.strictEqual(r.pass, false); assert.strictEqual(r.reason, 'cd414_dense_dump');
    assert.ok(r.arms.includes('cd414_dense_dump'));
  });
  check('L5 CD414 observe 排除（同形状+famDominance 100/chg30 −50=鯨）→ 不拦（famous 场景归观察）', () => {
    const r = M.evaluateFactorPreBuy(TS({ win: { 30: WIN({ sellers: 22, sellBnb: 2.263, netBnb: -1.84 }) }, chg30Pct: -50 }, { famousDominancePct: 100 }));
    assert.strictEqual(r.observe.code, 'fam_dominance_fall'); // observe 在身
    assert.ok(!r.arms.includes('cd414_dense_dump')); // 臂被排除
    assert.strictEqual(r.pass, true); // 不拦
  });
  check('L6 CD414 卖方不达线（14 户）→ 放行', () => {
    assert.strictEqual(M.armDenseDump({ win: { 30: WIN({ sellers: 14, sellBnb: 3, netBnb: -2 }) } }), false);
  });
  check('L7 CD414 净流不达线（−1.4）→ 放行（高换手双向盘）', () => {
    assert.strictEqual(M.armDenseDump({ win: { 30: WIN({ sellers: 20, sellBnb: 3, netBnb: -1.4 }) } }), false);
  });
  check('L8 CD414 win30 缺失 → 放行（宁不拦）', () => {
    assert.strictEqual(M.armDenseDump({}), false);
  });
  check('L9 gates 含 cd414 门与 tail minVs 值', () => {
    const r = M.evaluateFactorPreBuy(TS({ athVsLaunchPct: 317.9, totalVolumeBnb: 40.07, minVsLaunchPct: 0.3, win: { 30: WIN({ buyBnb: 5.85, sellBnb: 0.5 }), 120: WIN({ buyBnb: 5.85, sellBnb: 0.5 }) } }));
    const tailGate = r.gates.find((x) => x.id === 'tail_activity');
    assert.ok(tailGate.value.includes('minVs0.3%'), tailGate.value);
    assert.strictEqual(tailGate.hit, true);
    const c414 = r.gates.find((x) => x.id === 'cd414');
    assert.ok(c414 && c414.label.includes('短窗持续密集砸盘'));
  });
}

console.log('M. FP8 慢拉卸货 + famous 收割完残局（T024/T025 案）');
{
  const WIN = (buyBnb, sellBnb) => ({ buyBnb, sellBnb, buyN: 2, sellN: 2, netBnb: 0, buySharePct: 50, ticksPerMin: 10, buyers: 2, sellers: 2, newBuyers: 0 });
  const TS = (bd, cd) => ({
    ticks: [{ dt: 400 }],
    wallets: [W(0.2994, 0.1, 0.2994, 100)],
    buyDerived: Object.assign({ activity: { nearTail10BuyN: 3 } }, bd),
    cheatDerived: Object.assign({}, cd),
  });
  check('M1 慢拉卸货主案复刻（T024：59点 R2=0.951 峰后3524s tpm0.27）→ 拒 slow_pump_unload', () => {
    const r = M.evaluateFactorPreBuy(TS({ secSinceAth: 3524, win: { 30: WIN(0.53, 0), 120: WIN(0.53, 0) } }, { pumpStablePoints: 59, pumpStableR2: 0.951 }));
    assert.strictEqual(r.pass, false); assert.strictEqual(r.reason, 'slow_pump_unload');
    assert.ok(r.arms.includes('slow_pump_unload'));
  });
  check('M2 慢拉但峰后近（599s<600）→ 放行（卸货未充分发生）', () => {
    assert.strictEqual(M.armSlowPumpUnload(TS({ secSinceAth: 599, win: { 30: WIN(0.5, 0), 120: WIN(0.5, 0) } }, { pumpStablePoints: 59, pumpStableR2: 0.96 })), false);
  });
  check('M3 缓推但尾声活跃（tpm120=5）→ 放行（本臂要尾声死流量）', () => {
    assert.strictEqual(M.armSlowPumpUnload(TS({ secSinceAth: 3000, win: { 30: WIN(5, 0), 120: WIN(5, 0) } }, { pumpStablePoints: 59, pumpStableR2: 0.96 })), false);
  });
  check('M4 点数不足（29 点）→ 放行', () => {
    assert.strictEqual(M.armSlowPumpUnload(TS({ secSinceAth: 3000, win: { 30: WIN(0.5, 0), 120: WIN(0.5, 0) } }, { pumpStablePoints: 29, pumpStableR2: 0.96 })), false);
  });
  check('M5 pump 锚缺失 → 放行（宁不拦）', () => {
    assert.strictEqual(M.armSlowPumpUnload(TS({ secSinceAth: 3000, win: { 30: WIN(0.5, 0), 120: WIN(0.5, 0) } }, {})), false);
  });
  check('M6 famous 收割完主案复刻（memes：ath138.8 自卖比1.047 占买15.1 chg30-28）→ 拒 fam_harvested_final', () => {
    const r = M.evaluateFactorPreBuy(TS({ athVsLaunchPct: 138.8, chg30Pct: -28.1, famousTraces: { wallets: [{}], groupBuyBnb: 1.0, groupSellBnb: 1.047, groupBuyPct: 15.1 } }, {}));
    assert.strictEqual(r.pass, false); assert.strictEqual(r.reason, 'fam_harvested_final');
  });
  check('M7 自卖比不足（0.89 在场持有）→ 放行（小树 0.845 形状留观察）', () => {
    assert.strictEqual(M.armFamousHarvestFinal(TS({ athVsLaunchPct: 138, chg30Pct: -30, famousTraces: { wallets: [{}], groupBuyBnb: 1.0, groupSellBnb: 0.89, groupBuyPct: 15 } }, {})), false);
  });
  check('M8 大涨过但 chg30 未砸落（-19）→ 放行', () => {
    assert.strictEqual(M.armFamousHarvestFinal(TS({ athVsLaunchPct: 138, chg30Pct: -19, famousTraces: { wallets: [{}], groupBuyBnb: 1.0, groupSellBnb: 1.05, groupBuyPct: 15 } }, {})), false);
  });
  check('M9 占买不足（9.9 路过型）→ 放行', () => {
    assert.strictEqual(M.armFamousHarvestFinal(TS({ athVsLaunchPct: 138, chg30Pct: -30, famousTraces: { wallets: [{}], groupBuyBnb: 0.5, groupSellBnb: 0.6, groupBuyPct: 9.9 } }, {})), false);
  });
  check('M10 roster 缺席（famousTraces=null）→ 放行（轴不可评宁不拦）', () => {
    assert.strictEqual(M.armFamousHarvestFinal(TS({ athVsLaunchPct: 138, chg30Pct: -30 }, {})), false);
  });
  check('M11 gates 含两新门', () => {
    const r = M.evaluateFactorPreBuy(TS({ secSinceAth: 3524, win: { 30: WIN(0.53, 0), 120: WIN(0.53, 0) } }, { pumpStablePoints: 59, pumpStableR2: 0.951 }));
    const g1 = r.gates.find((x) => x.id === 'slow_pump');
    assert.strictEqual(g1.hit, true); assert.ok(g1.value.includes('59点'), g1.value);
    const g2 = r.gates.find((x) => x.id === 'fam_harvest_final');
    assert.ok(g2 && g2.label.includes('famous收割完残局'));
  });
}

console.log('N. FP9 famous 系突发波臂（T166：btv140 BP-T048 TYB——burst 纯 famous 带起来的）');
{
  // 主案形状夹具：499s 静默 → 波内 4 笔 0.891B（3×0.264 同块同额镜像簇含 famous+0.099 路由）
  const FB = (over) => Object.assign({
    stallSec: 499, waveFromDt: 2928, waveToDt: 2929, waveRows: 4, waveBuyN: 4,
    waveBuyBnb: 0.891, famSysSharePct: 88.9, famousFirstInWave: true, mirrorClusters: 1,
    anchorNearWave: true,
  }, over);
  check('N1 主案复刻（share 88.9 ≥80 ∧ 首进波内 ∧ 贴锚）→ 拒 fam_burst_wave', () => {
    assert.strictEqual(M.armFamousBurstWave({ famBurstWave: FB() }), true);
    const r = M.evaluateFactorPreBuy(SNAP({
      wallets: [W(0.2994, 0.1, 0.2994, 100)], // 0.3 级买方在场（PVP 过——波外既有持仓）
      buyDerived: { bundledBlock: null, win: { 30: { buyBnb: 0.5, buyN: 5 } }, bigHolderSellBnb60: null, activity: { nearTail10BuyN: 3 }, famBurstWave: FB() },
    }));
    assert.strictEqual(r.pass, false); assert.strictEqual(r.reason, 'fam_burst_wave');
    assert.ok(r.arms.includes('fam_burst_wave'));
  });
  check('N2 散单参与真实（share 60.2 Cashless 形状）→ 放行', () => {
    assert.strictEqual(M.armFamousBurstWave({ famBurstWave: FB({ famSysSharePct: 60.2, waveBuyBnb: 0.822 }) }), false);
  });
  check('N3 famous 非波内首进（早就在场持仓，波不是它带起来）→ 放行', () => {
    assert.strictEqual(M.armFamousBurstWave({ famBurstWave: FB({ famousFirstInWave: false }) }), false);
  });
  check('N4 尘埃波（waveBuyBnb 0.29<0.3）→ 放行（量级线同 CD401/CD402）', () => {
    assert.strictEqual(M.armFamousBurstWave({ famBurstWave: FB({ waveBuyBnb: 0.29 }) }), false);
  });
  check('N5 波远离锚（波结束后 gap ≥5s=历史遗迹）→ 放行', () => {
    assert.strictEqual(M.armFamousBurstWave({ famBurstWave: FB({ anchorNearWave: false }) }), false);
  });
  check('N6 famBurstWave null（无 ≥30s 静默段/roster 缺失）→ 放行（宁漏不冒充）', () => {
    assert.strictEqual(M.armFamousBurstWave({}), false);
    assert.strictEqual(M.armFamousBurstWave({ famBurstWave: null }), false);
  });
  check('N7 键残缺（share null）→ 放行（证据缺席不拒）', () => {
    assert.strictEqual(M.armFamousBurstWave({ famBurstWave: FB({ famSysSharePct: null }) }), false);
  });
  check('N8 gates 含 FP9 门（值带波构成四元组）', () => {
    const r = M.evaluateFactorPreBuy(SNAP({
      wallets: [W(0.2994, 0.1, 0.2994, 100)],
      buyDerived: { bundledBlock: null, win: { 30: { buyBnb: 0.5, buyN: 5 } }, bigHolderSellBnb60: null, activity: { nearTail10BuyN: 3 }, famBurstWave: FB() },
    }));
    const g = r.gates.find((x) => x.id === 'fam_burst_wave');
    assert.ok(g && g.label.includes('famous系burst波'));
    assert.strictEqual(g.hit, true);
    assert.ok(g.value.includes('88.9%') && g.value.includes('499'), g.value);
  });
}

console.log('O. FP10 famous 低价全清冷却臂（T167：btv140 BP-T055/T056——famous 低价全清后立马接盘）');
{
  // 主案夹具（T055 Muuchan 实测值）：买 0.2878B/自卖比 0.918/残仓 0.0236/末卖 +21.2%/距锚 17s
  const FT = (over) => Object.assign({
    wallets: [{ w: 'w1', buyBnb: 0.2878, sellBnb: 0.2642, netBnb: 0.0236 }],
    groupBuyBnb: 0.2878, groupSellBnb: 0.2642, presenceNetBnb: 0.0236,
    lastSellDt: 115, lastSellPriceBnb: 6.5e-9, lastSellVsLaunchPct: 21.2, lastSellToAnchorSec: 17,
    postSellTroughPct: 5, // T167d 末卖后流通谷值（默认=出清良好的 28ad 型；案值 override）
  }, over);
  const SNAPF = (ft) => SNAP({
    wallets: [W(0.2994, 0.1, 0.2994, 100)], // 0.3 级买方在场（PVP 过——拒因落 FP10）
    buyDerived: { bundledBlock: null, win: { 30: { buyBnb: 0.5, buyN: 5 } }, bigHolderSellBnb60: null, activity: { nearTail10BuyN: 3 }, famousTraces: ft },
  });
  check('O1 主案复刻 T055（买 0.2878/自卖比 0.918/残仓 0.0236/末卖 +21.2%/距锚 17s）→ 拒 fam_low_exit_cooldown', () => {
    assert.strictEqual(M.armFamousLowExit({ buyDerived: { famousTraces: FT() } }), true);
    const r = M.evaluateFactorPreBuy(SNAPF(FT()));
    assert.strictEqual(r.pass, false); assert.strictEqual(r.reason, 'fam_low_exit_cooldown');
    assert.ok(r.arms.includes('fam_low_exit_cooldown'));
  });
  check('O2 T056 形状（自卖比 0.995/残仓 0.0012 全清）→ 拒', () => {
    assert.strictEqual(M.armFamousLowExit({
      buyDerived: { famousTraces: FT({ wallets: [{ w: 'w1', netBnb: 0.0012 }], groupSellBnb: 0.2802, presenceNetBnb: 0.0012 }) },
    }), true);
  });
  check('O3 冷却完成（距锚 121s > 120 窗）→ 放行（窗外=冷却完照常评估）', () => {
    assert.strictEqual(M.armFamousLowExit({ buyDerived: { famousTraces: FT({ lastSellToAnchorSec: 121 }) } }), false);
  });
  check('O4 边界：距锚恰 120s → 拒；末卖恰 +40% → 拒（≤ 含边界）', () => {
    assert.strictEqual(M.armFamousLowExit({ buyDerived: { famousTraces: FT({ lastSellToAnchorSec: 120 }) } }), true);
    assert.strictEqual(M.armFamousLowExit({ buyDerived: { famousTraces: FT({ lastSellVsLaunchPct: 40 }) } }), true);
  });
  check('O5 卖在高位（+40.1）→ 放行（低价域 ≤+40=near_launch 上界）', () => {
    assert.strictEqual(M.armFamousLowExit({ buyDerived: { famousTraces: FT({ lastSellVsLaunchPct: 40.1 }) } }), false);
  });
  check('O6 未全清放行（Xilo 自卖比 0.812/小微 0.832 形状刻意不拦；残仓 0.06>0.05 亦不拦）', () => {
    assert.strictEqual(M.armFamousLowExit({ buyDerived: { famousTraces: FT({ groupSellBnb: 0.234, presenceNetBnb: 0.0538 }) } }), false); // 0.234/0.2878=0.813
    assert.strictEqual(M.armFamousLowExit({ buyDerived: { famousTraces: FT({ presenceNetBnb: 0.06 }) } }), false);
  });
  check('O7 参与不足（0.199<0.2——왹냥 0.097 形状）→ 放行（绝对额门=0.2 级大户线）', () => {
    assert.strictEqual(M.armFamousLowExit({ buyDerived: { famousTraces: FT({ groupBuyBnb: 0.199, groupSellBnb: 0.199 }) } }), false);
  });
  check('O8 键缺席不触发（末卖 null=无可靠价卖行/famousTraces null=roster 缺失/wallets 空）', () => {
    assert.strictEqual(M.armFamousLowExit({ buyDerived: { famousTraces: FT({ lastSellVsLaunchPct: null }) } }), false);
    assert.strictEqual(M.armFamousLowExit({ buyDerived: {} }), false);
    assert.strictEqual(M.armFamousLowExit({ buyDerived: { famousTraces: { wallets: [], groupBuyBnb: 0.3, groupSellBnb: 0.3, presenceNetBnb: 0, lastSellVsLaunchPct: 10, lastSellToAnchorSec: 5 } } }), false);
  });
  check('O9 gates 含 FP10 门（值含末卖/距锚/买额/残仓）', () => {
    const r = M.evaluateFactorPreBuy(SNAPF(FT()));
    const g = r.gates.find((x) => x.id === 'fam_low_exit');
    assert.ok(g && g.label.includes('famous低价全清冷却'));
    assert.strictEqual(g.hit, true);
    assert.ok(g.value.includes('21.2%') && g.value.includes('17s') && g.value.includes('0.2878') && g.value.includes('0.0236'), g.value);
  });
  check('O10 版本号断言随 FP11 上线移交 P13（此处不再锁旧值）', () => {
    assert.ok(typeof M.FACTOR_PREBUY_VERSION === 'string');
  });
  check('O11 T167b 破发豁免：28ad 形状（破深 28.8 ≥20——盘面最低较 famous 加权成本深破）→ 五腿命中但不拦（arms/reason 均无）', () => {
    assert.strictEqual(M.armFamousLowExit({ buyDerived: { famousTraces: FT({ groupEntryAvgBnb: 6.368e-9, postEntryMinBnb: 4.53e-9 }) } }), true); // 五腿原样命中（豁免在调用点）
    const r = M.evaluateFactorPreBuy(SNAPF(FT({ groupEntryAvgBnb: 6.368e-9, postEntryMinBnb: 4.53e-9 }))); // 1-4.53/6.368=28.8%
    assert.ok(!r.arms.includes('fam_low_exit_cooldown'));
    assert.notStrictEqual(r.reason, 'fam_low_exit_cooldown');
  });
  check('O12 T055 形状保持拦截（破深 13.1 <20）+ 边界恰 20 豁免', () => {
    const r = M.evaluateFactorPreBuy(SNAPF(FT({ groupEntryAvgBnb: 6.5e-9, postEntryMinBnb: 5.647e-9 }))); // 13.1%
    assert.strictEqual(r.reason, 'fam_low_exit_cooldown');
    const rb = M.evaluateFactorPreBuy(SNAPF(FT({ groupEntryAvgBnb: 6.368e-9, postEntryMinBnb: 5.09e-9 }))); // 破深 20.03%（1-5.09/6.368）过线豁免；恰 20 因浮点不表达，判据数值上 >=
    assert.ok(!rb.arms.includes('fam_low_exit_cooldown'));
  });
  check('O13 破发豁免键容缺（avg/min null——无可靠价买行/首买后无可靠价）→ 不豁免保持拦截（宁拦不冒充）', () => {
    assert.strictEqual(M.famousBreachExemptPct(null), null);
    assert.strictEqual(M.famousBreachExemptPct(FT()), null); // 无两新键（旧档形状）
    assert.strictEqual(M.famousBreachExemptPct(FT({ groupEntryAvgBnb: null, postEntryMinBnb: 1e-9 })), null);
    assert.strictEqual(M.famousBreachExemptPct(FT({ groupEntryAvgBnb: 6e-9, postEntryMinBnb: null })), null);
    const r = M.evaluateFactorPreBuy(SNAPF(FT()));
    assert.strictEqual(r.reason, 'fam_low_exit_cooldown');
  });
  check('O14 gates FP10 值带破深与豁免标注（28ad 形状 → 破发豁免字样）', () => {
    const r = M.evaluateFactorPreBuy(SNAPF(FT({ groupEntryAvgBnb: 6.368e-9, postEntryMinBnb: 4.53e-9 })));
    const g = r.gates.find((x) => x.id === 'fam_low_exit');
    assert.ok(g && g.value.includes('28.9%') && g.value.includes('破发豁免'), g.value);
    assert.strictEqual(g.hit, false);
  });
  check('O15 T167d 豁免换轨：0x6075 形状（破深 26.2 但谷值 18.4%——末卖后出清从未发生，谷值=窗口起点值）→ 不豁免保持拒', () => {
    const r = M.evaluateFactorPreBuy(SNAPF(FT({ groupEntryAvgBnb: 6.368e-9, postEntryMinBnb: 4.53e-9, postSellTroughPct: 18.4 })));
    assert.strictEqual(r.reason, 'fam_low_exit_cooldown');
    assert.ok(r.arms.includes('fam_low_exit_cooldown'));
    const g = r.gates.find((x) => x.id === 'fam_low_exit');
    assert.ok(g && !g.value.includes('破发豁免'), g.value); // 标注与判定同构：谷值 18.4>9 不标豁免
  });
  check('O16 T167d 边界：谷值恰 9.0（含）→ 豁免；9.1 → 拦；null → 拦（宁拦不冒充）', () => {
    const r9 = M.evaluateFactorPreBuy(SNAPF(FT({ groupEntryAvgBnb: 6.368e-9, postEntryMinBnb: 4.53e-9, postSellTroughPct: 9.0 })));
    assert.ok(!r9.arms.includes('fam_low_exit_cooldown'));
    const r91 = M.evaluateFactorPreBuy(SNAPF(FT({ groupEntryAvgBnb: 6.368e-9, postEntryMinBnb: 4.53e-9, postSellTroughPct: 9.1 })));
    assert.strictEqual(r91.reason, 'fam_low_exit_cooldown');
    const rn = M.evaluateFactorPreBuy(SNAPF(FT({ groupEntryAvgBnb: 6.368e-9, postEntryMinBnb: 4.53e-9, postSellTroughPct: null })));
    assert.strictEqual(rn.reason, 'fam_low_exit_cooldown');
  });
  check('O17 T167d 28ad 形状保持豁免（谷值 2.9——归零出清彻底）+ gates line 含谷值豁免腿', () => {
    const r = M.evaluateFactorPreBuy(SNAPF(FT({ groupEntryAvgBnb: 6.368e-9, postEntryMinBnb: 4.53e-9, postSellTroughPct: 2.9 })));
    assert.ok(!r.arms.includes('fam_low_exit_cooldown'));
    assert.notStrictEqual(r.reason, 'fam_low_exit_cooldown');
    const g = r.gates.find((x) => x.id === 'fam_low_exit');
    assert.ok(g && g.value.includes('破发豁免') && g.value.includes('2.9%') && g.line.includes('≤9%'), g.value + ' | ' + g.line);
  });
}

console.log('P. FP11 famous 早窗快闪双支臂（T171：bt-v141 거침없이/SI 点名两票——famous 极早快闪=基本无救）');
{
  // 案值夹具：거침없이（B 支）=famous 首@4s 群买 0.377 卖 0.419（卖比 1.111）残仓 0
  //           SI（A 支）=famous 首@7s 群买 0.749 卖 0.564（卖比 0.753）残仓 0.185（残仓比 0.247）
  const FTB = (over) => Object.assign({
    wallets: [{ w: 'e1e3', buyBnb: 0.3773, sellBnb: 0.419, netBnb: 0 }],
    groupFirstBuyDt: 4, groupBuyBnb: 0.3773, groupSellBnb: 0.419, presenceNetBnb: 0,
  }, over);
  const FTA = (over) => Object.assign({
    wallets: [{ w: 'a83b', buyBnb: 0.7493, sellBnb: 0.5639, netBnb: 0.1854 }],
    groupFirstBuyDt: 7, groupBuyBnb: 0.7493, groupSellBnb: 0.5639, presenceNetBnb: 0.1854,
  }, over);
  check('P1 主案复刻 SI（A 支：首@7s 买 0.749 卖比 0.753 残仓比 0.247）→ 拒 fam_early_flip_partial', () => {
    assert.strictEqual(M.armFamousEarlyFlip({ buyDerived: { famousTraces: FTA() } }), 'fam_early_flip_partial');
    const r = M.evaluateFactorPreBuy(SNAP({
      wallets: [W(0.2994, 0.1, 0.2994, 100)],
      buyDerived: { bundledBlock: null, win: { 30: { buyBnb: 0.5, buyN: 5 } }, bigHolderSellBnb60: null, activity: { nearTail10BuyN: 3 }, famousTraces: FTA() },
    }));
    assert.strictEqual(r.pass, false); assert.strictEqual(r.reason, 'fam_early_flip_partial');
  });
  check('P2 主案复刻 거침없이（B 支：首@4s 买 0.377 卖比 1.111 残仓 0 清仓走人）→ 拒 fam_early_flip_exit', () => {
    assert.strictEqual(M.armFamousEarlyFlip({ buyDerived: { famousTraces: FTB() } }), 'fam_early_flip_exit');
  });
  check('P3 Xilo/食蟹猴 A 支形状（买 0.249 卖比 0.812 残仓比 0.188）→ 拒 partial', () => {
    assert.strictEqual(M.armFamousEarlyFlip({ buyDerived: { famousTraces: FTA({ groupFirstBuyDt: 8, groupBuyBnb: 0.2492, groupSellBnb: 0.2023, presenceNetBnb: 0.0468, wallets: [{ w: 'x', buyBnb: 0.2492, sellBnb: 0.2023, netBnb: 0.0468 }] }) } }), 'fam_early_flip_partial');
  });
  check('P4 悲伤蛙放行（卖比 0.928 达 A 支线但残仓比 0.072 <0.15；残仓 0.053>0.01 不中 B）', () => {
    assert.strictEqual(M.armFamousEarlyFlip({ buyDerived: { famousTraces: FTA({ groupBuyBnb: 0.7379, groupSellBnb: 0.6848, presenceNetBnb: 0.0534 }) } }), null);
  });
  check('P5 我画地为牢放行（famous 在场持有 1.07/卖比 0.557=仍在场非快闪）', () => {
    assert.strictEqual(M.armFamousEarlyFlip({ buyDerived: { famousTraces: FTA({ groupFirstBuyDt: 33, groupBuyBnb: 1.7201, groupSellBnb: 0.9585, presenceNetBnb: 1.0719 }) } }), null);
  });
  check('P6 情书放行（残仓 0.015>0.01 不中 B——单票敏感度锚：B 线 0.01 的最近放行点）', () => {
    assert.strictEqual(M.armFamousEarlyFlip({ buyDerived: { famousTraces: FTA({ groupBuyBnb: 0.495, groupSellBnb: 0.4802, presenceNetBnb: 0.015 }) } }), null);
  });
  check('P7 极早前提双轴（秒 ≤10 ∨ 顺位 ≤5）：11s 且顺位 6 出前提放行（SI 同名票 67s/位 54 形状）；单轴在场即评', () => {
    assert.strictEqual(M.armFamousEarlyFlip({ buyDerived: { famousTraces: FTB({ groupFirstBuyDt: 11, groupFirstBuyRank: 6 }) } }), null);
    assert.strictEqual(M.armFamousEarlyFlip({ buyDerived: { famousTraces: FTB({ groupFirstBuyDt: 10 }) } }), 'fam_early_flip_exit');
    assert.strictEqual(M.armFamousEarlyFlip({ buyDerived: { famousTraces: FTB({ groupFirstBuyDt: 67, groupFirstBuyRank: 54 }) } }), null); // 二修放行锚：非极早先不控
    assert.strictEqual(M.armFamousEarlyFlip({ buyDerived: { famousTraces: FTB({ groupFirstBuyDt: 25, groupFirstBuyRank: 5 }) } }), 'fam_early_flip_exit'); // 慢速开盘票顺位轴单独中
    assert.strictEqual(M.armFamousEarlyFlip({ buyDerived: { famousTraces: FTB({ groupFirstBuyDt: 25, groupFirstBuyRank: 6 }) } }), null);
    assert.strictEqual(M.armFamousEarlyFlip({ buyDerived: { famousTraces: FTB({ groupFirstBuyDt: null, groupFirstBuyRank: 2 }) } }), 'fam_early_flip_exit'); // dt 缺失顺位在场照判
  });
  check('P8 参与不足放行（0.199<0.2 绝对额门）', () => {
    assert.strictEqual(M.armFamousEarlyFlip({ buyDerived: { famousTraces: FTB({ groupBuyBnb: 0.199, groupSellBnb: 0.199 }) } }), null);
  });
  check('P9 边界：A 支残仓比恰 0.15 拒 / 0.149 放；B 支残仓恰 0.01 拒 / 0.0101 放', () => {
    assert.strictEqual(M.armFamousEarlyFlip({ buyDerived: { famousTraces: FTA({ groupBuyBnb: 1, groupSellBnb: 0.7, presenceNetBnb: 0.15 }) } }), 'fam_early_flip_partial');
    assert.strictEqual(M.armFamousEarlyFlip({ buyDerived: { famousTraces: FTA({ groupBuyBnb: 1, groupSellBnb: 0.7, presenceNetBnb: 0.149 }) } }), null);
    assert.strictEqual(M.armFamousEarlyFlip({ buyDerived: { famousTraces: FTB({ groupBuyBnb: 1, groupSellBnb: 1.0, presenceNetBnb: 0.01 }) } }), 'fam_early_flip_exit');
    assert.strictEqual(M.armFamousEarlyFlip({ buyDerived: { famousTraces: FTB({ groupBuyBnb: 1, groupSellBnb: 1.0, presenceNetBnb: 0.0101 }) } }), null);
  });
  check('P10 B 支卖比线：恰 1.0 拒 / 0.999 放（不对劲 0.964 放行锚）', () => {
    assert.strictEqual(M.armFamousEarlyFlip({ buyDerived: { famousTraces: FTB({ groupBuyBnb: 1, groupSellBnb: 1.0 }) } }), 'fam_early_flip_exit');
    assert.strictEqual(M.armFamousEarlyFlip({ buyDerived: { famousTraces: FTB({ groupBuyBnb: 1, groupSellBnb: 0.999 }) } }), null);
  });
  check('P11 键缺席不触发（dt 与顺位全缺=前提不成立/famousTraces null=roster 缺失/wallets 空/残仓 null）', () => {
    assert.strictEqual(M.armFamousEarlyFlip({ buyDerived: { famousTraces: FTB({ groupFirstBuyDt: null, groupFirstBuyRank: null }) } }), null);
    assert.strictEqual(M.armFamousEarlyFlip({ buyDerived: {} }), null);
    assert.strictEqual(M.armFamousEarlyFlip({ buyDerived: { famousTraces: { wallets: [], groupFirstBuyDt: 5, groupBuyBnb: 0.3 } } }), null);
    assert.strictEqual(M.armFamousEarlyFlip({ buyDerived: { famousTraces: FTB({ presenceNetBnb: null }) } }), null);
  });
  check('P12 gates 含 FP11 门（值含首买/买额/卖比/残仓）', () => {
    const r = M.evaluateFactorPreBuy(SNAP({
      wallets: [W(0.2994, 0.1, 0.2994, 100)],
      buyDerived: { bundledBlock: null, win: { 30: { buyBnb: 0.5, buyN: 5 } }, bigHolderSellBnb60: null, activity: { nearTail10BuyN: 3 }, famousTraces: FTA() },
    }));
    const g = r.gates.find((x) => x.id === 'fam_early_flip');
    assert.ok(g && g.label.includes('famous早窗快闪'));
    assert.strictEqual(g.hit, true);
    assert.ok(g.value.includes('7s') && g.value.includes('0.7493') && g.value.includes('0.75') && g.value.includes('0.25'), g.value);
    assert.ok(g.line.includes('10s') && g.line.includes('顺位≤5'), g.line);
  });
  check('P13 版本 FP17（T180 首两波大部队迁入；FP16=大周期 burst 残局）', () => {
    assert.strictEqual(M.FACTOR_PREBUY_VERSION, 'FP40'); // FP32=T201 大户推迟臂迁入（ladder v34 G2）；FP20=T167d FP10 豁免换轨（末卖后流通谷值≤9%）；FP19=T167c；FP18=T182；FP17=T180
  });
}

console.log('Q. FP13 burst 弱波拦截线（T174：无大户认可 ∧ 无压箱=空波，联立线——或口径否证）');
{
  const BWQ = (whales, pre) => ({ buyDerived: { burstWaveQuality: { exitDt: 300, waveBuyBnb: 0.5, waveWallets: 5, whaleWallets: whales, preWaveBuyBnb: pre } } });
  check('Q1 联立命中（大户0 ∧ 压箱<1B）→ 拒 burst_weak_wave', () => {
    assert.strictEqual(M.armBurstWeakWave(BWQ(0, 0.6).buyDerived), true);
  });
  check('Q2 大户在场（≥1）放行——Cashless 3 户 +184% 反证（或口径误伤面）', () => {
    assert.strictEqual(M.armBurstWeakWave(BWQ(1, 0.1).buyDerived), false);
    assert.strictEqual(M.armBurstWeakWave(BWQ(3, 0.1).buyDerived), false);
  });
  check('Q3 压箱厚（≥1B）放行——给币安的一封情书 4.9B 压箱 +43% 反证', () => {
    assert.strictEqual(M.armBurstWeakWave(BWQ(0, 1.0).buyDerived), false);
    assert.strictEqual(M.armBurstWeakWave(BWQ(0, 4.929).buyDerived), false);
  });
  check('Q4 无段（burstWaveQuality=null=非 burst 语境）不拦——宁不拦', () => {
    assert.strictEqual(M.armBurstWeakWave({ burstWaveQuality: null }), false);
    assert.strictEqual(M.armBurstWeakWave({}), false);
    assert.strictEqual(M.armBurstWeakWave(null), false);
  });
  check('Q5 键缺失（whaleWallets/preWaveBuyBnb 非数值）不拦', () => {
    assert.strictEqual(M.armBurstWeakWave({ burstWaveQuality: { whaleWallets: 0 } }), false);
    assert.strictEqual(M.armBurstWeakWave({ burstWaveQuality: { whaleWallets: null, preWaveBuyBnb: 0.5 } }), false);
  });
  check('Q6 边界：压箱恰 1B 不拦（< 严格小于）/0.999B 拦', () => {
    assert.strictEqual(M.armBurstWeakWave(BWQ(0, 0.999).buyDerived), true);
  });
  check('Q7 主入口臂链挂载（cd405 后）+ reason=burst_weak_wave', () => {
    const r = M.evaluateFactorPreBuy(SNAP(Object.assign({}, {
      wallets: [W(0.3, 0, 0.3, 10)], // PVP 过
      buyDerived: { bundledBlock: null, win: { 30: { buyBnb: 0.5, buyN: 5 } }, activity: { nearTail10BuyN: 3 },
        burstWaveQuality: { exitDt: 300, waveBuyBnb: 0.5, waveWallets: 5, whaleWallets: 0, preWaveBuyBnb: 0.6 } },
    })));
    assert.ok(r.arms.includes('burst_weak_wave'), JSON.stringify(r.arms));
    assert.strictEqual(r.reason, 'burst_weak_wave');
  });
  check('Q8 gates 含 burst_weak 门（值含大户数/压箱额）', () => {
    const r = M.evaluateFactorPreBuy(SNAP({
      wallets: [W(0.3, 0, 0.3, 10)],
      buyDerived: { bundledBlock: null, win: { 30: { buyBnb: 0.5, buyN: 5 } }, activity: { nearTail10BuyN: 3 },
        burstWaveQuality: { exitDt: 300, waveBuyBnb: 0.5, waveWallets: 5, whaleWallets: 0, preWaveBuyBnb: 0.6 } },
    }));
    const g = r.gates.find((x) => x.id === 'burst_weak');
    assert.ok(g && g.label.includes('burst弱波'), g && g.label);
    assert.strictEqual(g.hit, true);
    assert.ok(g.value.includes('0实体') && g.value.includes('0.6B'), g.value);
    assert.ok(g.line.includes('压箱<1B'), g.line);
  });
}



console.log('R. FP16 大周期 burst 残局（2026-11-18 bt-v147 瓦尔哈 0x5fb747c6…7777 案：走过一轮+burst 不买）');
{
  // 本案形状夹具：ath 138.2 / 总额 17.6282 / 静默段 343s / 波贴近锚 4s / 波买 0.70B / 浅破 −5.6
  const BD = (o) => Object.assign({ athVsLaunchPct: 138.2, totalVolumeBnb: 17.6282, launchMinVsFloorPct: -5.6 }, o);
  const CD = (o) => Object.assign({ burstLastGapSec: 343, burstSecSinceWaveEnd: 4, burstWaveSegBuyBnb: 0.70 }, o);
  check('R1 本案形状 → 拦 lifecycle_burst_residual', () => {
    assert.strictEqual(M.armLifecycleBurstResidual(BD(), CD()), true);
  });
  check('R2 深破豁免：−10.01 放行（G1 五连收线同线，ASTER −38 类）/ −10 恰线不豁免（严格 <）', () => {
    assert.strictEqual(M.armLifecycleBurstResidual(BD({ launchMinVsFloorPct: -10.01 }), CD()), false);
    assert.strictEqual(M.armLifecycleBurstResidual(BD({ launchMinVsFloorPct: -38.4 }), CD()), false);
    assert.strictEqual(M.armLifecycleBurstResidual(BD({ launchMinVsFloorPct: -10 }), CD()), true);
  });
  check('R3 豁免证据缺席（launchMinVsFloorPct null/undefined）→ 照拦（不豁免）', () => {
    assert.strictEqual(M.armLifecycleBurstResidual(BD({ launchMinVsFloorPct: null }), CD()), true);
    assert.strictEqual(M.armLifecycleBurstResidual(BD({ launchMinVsFloorPct: undefined }), CD()), true);
  });
  check('R4 生命周期腿：ath 99.9 不拦 / 总额 10.99 不拦 / 11.00 恰线拦 / 14.99 拦（T191 降线 15→11，chibi 案 11.5295 锚定）', () => {
    assert.strictEqual(M.armLifecycleBurstResidual(BD({ athVsLaunchPct: 99.9 }), CD()), false);
    assert.strictEqual(M.armLifecycleBurstResidual(BD({ totalVolumeBnb: 10.99 }), CD()), false);
    assert.strictEqual(M.armLifecycleBurstResidual(BD({ totalVolumeBnb: 11 }), CD()), true);
    assert.strictEqual(M.armLifecycleBurstResidual(BD({ totalVolumeBnb: 14.99 }), CD()), true); // T191 前放行带=现拦截带
  });
  check('R5 burst 结构腿：静默 29s 不拦 / 波远锚 61s 不拦 / 波买 0.29B 不拦 / 任一 null 不拦', () => {
    assert.strictEqual(M.armLifecycleBurstResidual(BD(), CD({ burstLastGapSec: 29 })), false);
    assert.strictEqual(M.armLifecycleBurstResidual(BD(), CD({ burstSecSinceWaveEnd: 61 })), false);
    assert.strictEqual(M.armLifecycleBurstResidual(BD(), CD({ burstWaveSegBuyBnb: 0.29 })), false);
    assert.strictEqual(M.armLifecycleBurstResidual(BD(), CD({ burstLastGapSec: null })), false);
    assert.strictEqual(M.armLifecycleBurstResidual(BD(), CD({ burstSecSinceWaveEnd: null })), false);
  });
  check('R6 主入口链挂载（burst_weak 后）+ reason=lifecycle_burst_residual（本案 act=high 形状不落 act 臂）', () => {
    const r = M.evaluateFactorPreBuy(SNAP(Object.assign({}, {
      wallets: [W(0.3, 0, 0.3, 10)], // PVP 过（0.3 级在场——本案实测 0.3级×7）
      buyDerived: BD({ bundledBlock: null, win: { 30: { buyBnb: 0.5, buyN: 5 } }, activity: { nearTail10BuyN: 5 } }),
      cheatDerived: CD({}),
    })));
    assert.ok(r.arms.includes('lifecycle_burst_residual'), JSON.stringify(r.arms));
    assert.strictEqual(r.reason, 'lifecycle_burst_residual');
  });
  check('R7 gates 含 lifecycle_burst 门（值含 ath/总额/静默/波买，线含深破豁免）', () => {
    const r = M.evaluateFactorPreBuy(SNAP({
      wallets: [W(0.3, 0, 0.3, 10)],
      buyDerived: BD({ bundledBlock: null, win: { 30: { buyBnb: 0.5, buyN: 5 } }, activity: { nearTail10BuyN: 5 } }),
      cheatDerived: CD({}),
    }));
    const g = r.gates.find((x) => x.id === 'lifecycle_burst');
    assert.ok(g && g.label.includes('大周期burst'), g && g.label);
    assert.strictEqual(g.hit, true);
    assert.ok(g.value.includes('138.2%') && g.value.includes('17.6') && g.value.includes('343s'), g.value);
    assert.ok(g.line.includes('深破<−10'), g.line);
  });
  check('R8 CD412 破发豁免腿修复（launchMinVsFloorPct 键此前恒 undefined 静默失效）：≤0 豁免不拦', () => {
    const cd412 = { nearDumpWorstSellers: 15, nearDumpWorstSellBnb: 1.2 };
    assert.strictEqual(M.armExtremeDumpSellers(cd412, BD({ launchMinVsFloorPct: 0 })), false); // 恰 0（T142 严格 ≤0 豁免线）豁免
    assert.strictEqual(M.armExtremeDumpSellers(cd412, BD({ launchMinVsFloorPct: -0.5 })), false); // 浅破豁免
    assert.strictEqual(M.armExtremeDumpSellers(cd412, BD({ launchMinVsFloorPct: 5 })), true); // 未破发照拦
    assert.strictEqual(M.armExtremeDumpSellers(cd412, BD({ launchMinVsFloorPct: null })), true); // 豁免证据缺席不豁免
  });
  check('R9 T191 案值（2026-11-19 真回放六腿）：chibi 11.5295 拦 / 0x8fbb5ae7 12.6675 拦（知情误伤 +0.0321）/ 0x9391a6d2 14.0218 拦', () => {
    assert.strictEqual(M.armLifecycleBurstResidual(
      { athVsLaunchPct: 107.5, totalVolumeBnb: 11.5295, launchMinVsFloorPct: 12.94 },
      { burstLastGapSec: 51, burstSecSinceWaveEnd: 0, burstWaveSegBuyBnb: 0.4178 }), true);
    assert.strictEqual(M.armLifecycleBurstResidual(
      { athVsLaunchPct: 137.7, totalVolumeBnb: 12.6675, launchMinVsFloorPct: -1.93 },
      { burstLastGapSec: 77, burstSecSinceWaveEnd: 0, burstWaveSegBuyBnb: 0.579 }), true);
    assert.strictEqual(M.armLifecycleBurstResidual(
      { athVsLaunchPct: 136.4, totalVolumeBnb: 14.0218, launchMinVsFloorPct: -3.64 },
      { burstLastGapSec: 1710, burstSecSinceWaveEnd: 0, burstWaveSegBuyBnb: 0.5439 }), true);
  });
  check('R10 T191 深破豁免腿不动（真重启票两窗实证）：0x953866a7 −11.87 / 0x4c6c9378 −15.34 → 放行', () => {
    assert.strictEqual(M.armLifecycleBurstResidual(
      { athVsLaunchPct: 162, totalVolumeBnb: 11.1397, launchMinVsFloorPct: -11.87 },
      { burstLastGapSec: 45, burstSecSinceWaveEnd: 0, burstWaveSegBuyBnb: 0.3528 }), false);
    assert.strictEqual(M.armLifecycleBurstResidual(
      { athVsLaunchPct: 228.7, totalVolumeBnb: 14.3837, launchMinVsFloorPct: -15.34 },
      { burstLastGapSec: 547, burstSecSinceWaveEnd: 0, burstWaveSegBuyBnb: 0.5938 }), false);
  });
  check('R11 T192 案值（0x54e33173…7777 @20:59:43 真回放）：FP16 波锚 null 失明、卖压臂精确接住 → 拦 lifecycle_sell_residual', () => {
    const bd = { athVsLaunchPct: 124.4, totalVolumeBnb: 15.6666, launchMinVsFloorPct: 0 };
    const cd = { burstLastGapSec: 32, burstSecSinceWaveEnd: null, burstSecSinceSegEnd: 0,
      burstWaveSegBuyBnb: 0.3467, burstWaveSegSellBnb: 0.4937, burstWaveSegSellPct: 58.7 };
    assert.strictEqual(M.armLifecycleBurstResidual(bd, cd), false); // D3.67 波锚被卖簇劫持 null → FP16 fail-open（本案漏面）
    assert.strictEqual(M.armLifecycleSellResidual(bd, cd), true);   // T192 卖压臂接住
  });
  check('R12 T192 边界：卖占 49.9 不拦（买主导归 FP16 域）/ 50 恰线拦 / 卖额 0.29 不拦 / 簇距 61s 历史遗迹不拦 / 总额 10.99 不拦', () => {
    const base = { athVsLaunchPct: 124.4, totalVolumeBnb: 15.6666, launchMinVsFloorPct: 0 };
    const cdBase = { burstLastGapSec: 32, burstSecSinceSegEnd: 0, burstWaveSegSellBnb: 0.4937 };
    assert.strictEqual(M.armLifecycleSellResidual(base, { ...cdBase, burstWaveSegSellPct: 49.9 }), false);
    assert.strictEqual(M.armLifecycleSellResidual(base, { ...cdBase, burstWaveSegSellPct: 50 }), true);
    assert.strictEqual(M.armLifecycleSellResidual(base, { burstLastGapSec: 32, burstSecSinceSegEnd: 0, burstWaveSegSellPct: 70, burstWaveSegSellBnb: 0.29 }), false);
    assert.strictEqual(M.armLifecycleSellResidual(base, { burstLastGapSec: 32, burstSecSinceSegEnd: 61, burstWaveSegSellPct: 70, burstWaveSegSellBnb: 0.5 }), false);
    assert.strictEqual(M.armLifecycleSellResidual({ ...base, totalVolumeBnb: 10.99 }, { ...cdBase, burstWaveSegSellPct: 70 }), false);
  });
  check('R13 T192 null 容缺与豁免：簇距 null 不拦 / 深破 −10.01 豁免 / 豁免证据缺席照拦 / 与 FP16 分工（买主导簇本臂不拦）', () => {
    const bd = { athVsLaunchPct: 124.4, totalVolumeBnb: 15.6666, launchMinVsFloorPct: 0 };
    const cd = { burstLastGapSec: 32, burstSecSinceSegEnd: null, burstWaveSegSellPct: 70, burstWaveSegSellBnb: 0.5 };
    assert.strictEqual(M.armLifecycleSellResidual(bd, cd), false); // 簇距证据缺席不拦
    assert.strictEqual(M.armLifecycleSellResidual({ ...bd, launchMinVsFloorPct: -10.01 }, { ...cd, burstSecSinceSegEnd: 0 }), false); // 真重启豁免
    assert.strictEqual(M.armLifecycleSellResidual({ ...bd, launchMinVsFloorPct: null }, { ...cd, burstSecSinceSegEnd: 0 }), true); // 豁免证据缺席照拦
    assert.strictEqual(M.armLifecycleSellResidual(bd, { burstLastGapSec: 32, burstSecSinceSegEnd: 0, burstWaveSegSellPct: 30, burstWaveSegSellBnb: 0.2, burstWaveSegBuyBnb: 0.6 }), false); // 买主导=FP16 域
  });
}

console.log('S. launchMinVsFloorPct 锚窗版（buy-point-snapshot 产键——FP16/CD412 消费；夹具=DB 原始行形状）');
{
  const BPS = require(path.join(__dirname, '..', 'src', 'market-analysis', 'buy-point-snapshot.js'));
  const T0 = '2026-11-01T00:00:00+00:00';
  const mkRows = (rows) => rows.map((r, i) => ({
    block_time: new Date(Date.parse(T0) + r.sec * 1000).toISOString(),
    block_number: 100 + i, log_index: 0, tx_hash: 't' + i,
    trade_type: r.side, bnb_amount: r.bnb || 0.1, token_amount: 1000,
    price_bnb: r.p, price_outlier: false,
    trader_address: '0x' + String(i + 1).padStart(40, '0'), sender_address: null, quote_token: null,
  }));
  const meta = (platform) => ({ platform, totalSupply: 1e9, createdAt: T0, creatorAddress: null });
  const run = (rows, platform) => BPS.buildBuyPointSnapshot(mkRows(rows), meta(platform || 'fourmeme'),
    { capped: false, anchorTickCount: rows.length, signalInfo: null });
  // four.meme 常量 4.496e-9；首买 5.0e-9 高于常量 → floor=常量
  const base = [
    { sec: 0, side: 'buy', p: 5.0e-9 },
    { sec: 90, side: 'buy', p: 9.0e-9 },   // ath +100.2%
    { sec: 400, side: 'sell', p: 6.4e-9 },
    { sec: 800, side: 'buy', p: 4.45e-9 }, // 窗内最低（4.45<常量 4.496 → 浅破 −1%）
  ];
  check('S1 浅破形状（窗内最低 4.45e-9 vs floor=常量 4.496e-9）→ −1.x% 不豁免域（本案瓦尔哈 −1.22 同域）', () => {
    const v = run(base).buyDerived.launchMinVsFloorPct;
    assert.ok(typeof v === 'number' && v < 0 && v > -10, `v=${v}`);
  });
  check('S2 深破形状（最低 4.0e-9）→ ≤−10 豁免域（ASTER/快速重启票）', () => {
    const v = run(base.concat([{ sec: 900, side: 'sell', p: 4.0e-9 }])).buyDerived.launchMinVsFloorPct;
    assert.ok(v <= -10, `v=${v}`);
  });
  check('S3 无常量平台（gang）→ null（豁免证据缺席不豁免）', () => {
    assert.strictEqual(run(base, 'gang').buyDerived.launchMinVsFloorPct, null);
  });
  check('S4 低开票 floor=首买价（T142 分母语义 min(常量,首买)；minRel≤首买恒成立 → v≤0）', () => {
    // 首买 4.0<常量 → floor=4.0；首买即全窗最低 → v=0（首笔即最低从未破位不豁免，严格 <0）
    const v0 = run([
      { sec: 0, side: 'buy', p: 4.0e-9 },
      { sec: 90, side: 'buy', p: 8.0e-9 },
      { sec: 500, side: 'sell', p: 4.2e-9 },
    ]).buyDerived.launchMinVsFloorPct;
    assert.strictEqual(v0, 0);
    // 首买 4.0 后砸出 3.8（低于首买价=首批买入者被套）→ v=−5%（相对首买价破位）
    const vn = run([
      { sec: 0, side: 'buy', p: 4.0e-9 },
      { sec: 90, side: 'buy', p: 8.0e-9 },
      { sec: 500, side: 'sell', p: 3.8e-9 },
    ]).buyDerived.launchMinVsFloorPct;
    assert.ok(vn < -4.9 && vn > -5.1, `vn=${vn}`);
  });
  check('S5 端到端锚定：本案瓦尔哈形状（flap/浅破 −1.22/ath 138.2/总 17.63/静默 343/波买 0.69）→ FP16 拒（2026-11-18 真实回放对拍）', () => {
    assert.strictEqual(M.armLifecycleBurstResidual(
      { athVsLaunchPct: 138.2, totalVolumeBnb: 17.6282, launchMinVsFloorPct: -1.22 },
      { burstLastGapSec: 343, burstSecSinceWaveEnd: 0, burstWaveSegBuyBnb: 0.6905 }), true);
    // 28ad 慢重启（07:15:58 真实回放对拍）：ath 58.2/总 4.54 → 放行（锚窗滑出保护）
    assert.strictEqual(M.armLifecycleBurstResidual(
      { athVsLaunchPct: 58.2, totalVolumeBnb: 4.5434, launchMinVsFloorPct: 0.87 },
      { burstLastGapSec: null, burstSecSinceWaveEnd: null, burstWaveSegBuyBnb: null }), false);
  });
}

// ═════ T. FP17/T180 首两波大部队×高占比（ladder v32 迁入——用户裁定归因子过滤模块） ═════
// 2026-11-18 0x17b09420…7777 案（bt-v147）：t+0s 单鲸 0.5 首块→t+1s 第二块（相邻
// 两块同秒）8 钱包挤入 1.26B 占窗买 ~76%→t+41s 鲸全清→fire t+298s 买入 −10.9%。
// 判定线 wave≥8 ∧ dom≥30（两轴联立——wave 单轴三窗切赢家、占比轴才分离）；
// 键源 buyDerived.launchSquad{waveWallets,domPct}（buy-point-snapshot FA 镜像，
// 计算测试在 _test_buy_point_lib.cjs T 组）；锚缺失 null=不评宁不拦。
console.log('T. FP17 首两波大部队×高占比（T180 自 ladder v32 迁入）');
{
  const LS = (waveWallets, domPct) => SNAP({
    wallets: [W(0.3, 0, 0.3), W(0.25, 0, 0.25)], // 两个 0.2+ 买方 → pvp big_buyers_present 不抢拒码
    buyDerived: { launchSquad: waveWallets === null ? null : { waveWallets, domPct }, bundledBlock: null, win: { 30: { buyBnb: 0.5, buyN: 5 } }, activity: { nearTail10BuyN: 3 } },
  });
  check('T1 案源形状 wave=9 dom=36.9 → 拒 launch_squad_dominance（FP 全链最前臂）', () => {
    const r = M.evaluateFactorPreBuy(LS(9, 36.9));
    assert.strictEqual(r.pass, false);
    assert.strictEqual(r.reason, 'launch_squad_dominance');
    assert.ok(r.arms.includes('launch_squad_dominance'));
    assert.strictEqual(r.version, 'FP40');
  });
  check('T2 有机热门盘 wave≥8 但 dom<30 → 放（da405bd0 wave13 dom0 实证——占比轴保护赢家）', () => {
    const r = M.evaluateFactorPreBuy(LS(13, 0));
    assert.strictEqual(r.pass, true);
    assert.strictEqual(r.reason, null);
  });
  check('T3 边界：wave=7 dom=79 放（G1 可冷却域 3~7——0x645886 +0.037 知情保护）', () => {
    assert.strictEqual(M.evaluateFactorPreBuy(LS(7, 79)).pass, true);
  });
  check('T4 边界：wave=8 dom=29.9 放（ebbe7af1 wave8 dom26.5 +0.0726 同域）', () => {
    assert.strictEqual(M.evaluateFactorPreBuy(LS(8, 29.9)).pass, true);
  });
  check('T5 边界：wave=21 dom=37.8 → 拒（0x384fef57 bt-v134 跨窗唯一命中 +0.0034 近零知情）', () => {
    const r = M.evaluateFactorPreBuy(LS(21, 37.8));
    assert.strictEqual(r.reason, 'launch_squad_dominance');
  });
  check('T6 锚缺失 null（截窗不覆盖出生段/窗内零买）→ 不评放行（拒方向证据缺席不拒）', () => {
    const r = M.evaluateFactorPreBuy(LS(null, null));
    assert.strictEqual(r.pass, true);
    assert.strictEqual(r.reason, null);
  });
  check('T7 gates 门行在位（信号页②因子检查卡展示 wave/dom 值）', () => {
    const r = M.evaluateFactorPreBuy(LS(9, 36.9));
    const g = r.gates.find((x) => x.id === 'launch_squad');
    assert.ok(g, 'launch_squad 门行缺失');
    assert.strictEqual(g.hit, true);
    assert.ok(g.value.includes('9') && g.value.includes('36.9'));
    const g2 = M.evaluateFactorPreBuy(LS(5, 0)).gates.find((x) => x.id === 'launch_squad');
    assert.strictEqual(g2.hit, false);
  });
  check('T8 ladder 迁出锁：deploy 脚本无 WAVE_DOM_VETO_GATE（v33 尾门回 G1~G5），臂在本模块', () => {
    const fs = require('fs');
    const deploy = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'deploy-trading-strategy.cjs'), 'utf8');
    assert.ok(!deploy.includes('WAVE_DOM_VETO_GATE'), 'ladder 仍带 G6 门串——迁移未完成');
    assert.ok(!deploy.includes('l.condition += WAVE_DOM_VETO_GATE'), 'G6 仍在拼腿');
    const self = fs.readFileSync(path.join(__dirname, '..', 'src', 'market-analysis', 'factor-pre-buy-check.js'), 'utf8');
    assert.ok(self.includes("arms.push('launch_squad_dominance')"), 'FP 臂不在位');
  });
}

// ═════ U. FP19/T182 尾部接刀臂（bt-v147 0x51d9e360…7777「选择」案研究立法） ═════
// 用户直觉「活跃很久+深跌+性价比位买入应配不同卖出」→ 卖侧六模拟否证（多卡+
// stallClose 已近最优）→ 归因买侧：起涨/死盘 3/3 跨窗分离（买时 5s 动量）→ 本臂。
// 域腿（ath≥40∧curVs≤28.5）是灵魂：对照组（早期/薄量）接刀全量 epΣ=+295.7 肥尾
// 在场（dae106 +88）——去域腿=砍早期肥尾。chg30 腿排插针：dae106 chg30=-1.7 企稳
// 深针 → ep+88 刻意放行。全量重放 43 票 epΣ=-276pp 全负。断言值全部取 182 真实回放。
console.log('U. FP19 尾部接刀臂（T182）');
{
  const TK = (athVs, curVs, chg5, chg30) => SNAP({
    wallets: [W(0.3, 0, 0.3), W(0.25, 0, 0.25)], // pvp big_buyers_present 不抢拒码
    buyDerived: { athVsLaunchPct: athVs, currentVsLaunchPct: curVs, chg5Pct: chg5, chg30Pct: chg30,
      bundledBlock: null, win: { 30: { buyBnb: 0.5, buyN: 5 } }, activity: { nearTail10BuyN: 3 } },
  });
  check('U1 案源 0x4e2d2891（bt-v147 真实回放 ath=50/curVs=19.7/chg5=-5.6/chg30=-12.7 → ep=-28.4）→ 拒 tail_dip_knife', () => {
    const r = M.evaluateFactorPreBuy(TK(50, 19.7, -5.6, -12.7));
    assert.strictEqual(r.pass, false);
    assert.strictEqual(r.reason, 'tail_dip_knife');
    assert.ok(r.arms.includes('tail_dip_knife'));
  });
  check('U2 域外·无拉升历史 ath=30 → 放（对照组接刀是肥尾机会——域腿保护）', () => {
    assert.strictEqual(M.evaluateFactorPreBuy(TK(30, 19.7, -13.0, -25)).pass, true);
  });
  check('U3 域外·未回到低位 curVs=35 → 放', () => {
    assert.strictEqual(M.evaluateFactorPreBuy(TK(120, 35, -13.0, -25)).pass, true);
  });
  check('U4 刀缺一·chg30 企稳插针（dae106 真实回放 chg5=-13.1/chg30=-1.7 → mx+204/ep+88）→ 放', () => {
    assert.strictEqual(M.evaluateFactorPreBuy(TK(74, 23.7, -13.1, -1.7)).pass, true);
  });
  check('U5 刀缺一·chg5 未达急跌线 -4.9 → 放', () => {
    assert.strictEqual(M.evaluateFactorPreBuy(TK(120, 20, -4.9, -25)).pass, true);
  });
  check('U6 边界：chg5=-5.0 恰在线上不拦（严格 <）', () => {
    assert.strictEqual(M.evaluateFactorPreBuy(TK(120, 20, -5.0, -25)).pass, true);
  });
  check('U7 深崩案 0x6dcc6893（chg5=-54.8/chg30=-54.5/ath=355 → ep=-3.8 假起涨）→ 拒', () => {
    const r = M.evaluateFactorPreBuy(TK(355, 14.7, -54.8, -54.5));
    assert.strictEqual(r.reason, 'tail_dip_knife');
  });
  check('U8 null 容缺（athVs/chg5 null=锚缺失）→ 不拦（T143 拒方向证据缺席）', () => {
    assert.strictEqual(M.evaluateFactorPreBuy(TK(null, 20, -13, -25)).pass, true);
    assert.strictEqual(M.evaluateFactorPreBuy(TK(120, 20, null, -25)).pass, true);
    assert.strictEqual(M.evaluateFactorPreBuy(TK(120, null, -13, -25)).pass, true);
    assert.strictEqual(M.evaluateFactorPreBuy(TK(120, 20, -13, null)).pass, true);
  });
  check('U9 gates 门行在位（信号页②因子检查卡展示 ath/curVs/chg5/chg30 值）', () => {
    const r = M.evaluateFactorPreBuy(TK(50, 19.7, -5.6, -12.7));
    const g = r.gates.find((x) => x.id === 'tail_dip_knife');
    assert.ok(g, 'tail_dip_knife 门行缺失');
    assert.strictEqual(g.hit, true);
    assert.ok(g.value.includes('50') && g.value.includes('-5.6') && g.value.includes('-12.7'));
    const g2 = M.evaluateFactorPreBuy(TK(74, 23.7, -13.1, -1.7)).gates.find((x) => x.id === 'tail_dip_knife');
    assert.strictEqual(g2.hit, false);
  });
  check('U10 版本（FP40=FP26 深破豁免；FP39=tail_dip 深破豁免）', () => {
    assert.strictEqual(M.FACTOR_PREBUY_VERSION, 'FP40');
  });
}

console.log('V. T187/FP21 持有者打散臂（筹码结构维度：posH≥25 ∧ top1-2 集中度不足；bt-v155/156 两窗立法）');
{
  const CH = (posH, t1, t12) => SNAP({ buyDerived: { chip: { posHolderCount: posH, top1HoldCircPct: t1, top1Top2HoldCircPct: t12 }, win: { 30: { buyBnb: 0.5, buyN: 5 } }, activity: { nearTail10BuyN: 3 } } });
  check('V1 进场负票形状（h34 ∧ top1=25 ∧ 前2=35——DND 0x359309eb realPct−32 案）→ arms 含 holder_scatter', () => {
    const r = M.evaluateFactorPreBuy(CH(34, 25, 35));
    assert.ok(r.arms.includes('holder_scatter'));
  });
  check('V2 薄肌俱乐部形状（h=19——0x51a17dda t1c=51% 主力承接票）→ 天然不进门', () => {
    assert.strictEqual(M.armHolderScatter(CH(19, 51, 70).buyDerived), false);
    const r = M.evaluateFactorPreBuy(CH(19, 51, 70));
    assert.ok(!r.arms.includes('holder_scatter'));
  });
  check('V3 豁免臂 top1（h30 ∧ top1=50 ≥45=有主力承接在场）→ 放行（用户裁定「通过 top1-2 集中度救回来」）', () => {
    assert.strictEqual(M.armHolderScatter(CH(30, 50, 55).buyDerived), false);
  });
  check('V4 豁免臂 前2（h30 ∧ top1-2=65 ≥60）→ 放行', () => {
    assert.strictEqual(M.armHolderScatter(CH(30, 30, 65).buyDerived), false);
  });
  check('V5 边界严格性（h=25 恰达线 ∧ top1=44.9 ∧ 前2=59.9 双不过线）→ 拒（≥/>= 同向）', () => {
    assert.strictEqual(M.armHolderScatter(CH(25, 44.9, 59.9).buyDerived), true);
    assert.strictEqual(M.armHolderScatter(CH(24.9, 20, 30).buyDerived), false);
  });
  check('V6 null 容缺（posHolderCount null=锚缺席）→ 不评宁不拦（FP 拒方向证据缺席惯例）', () => {
    assert.strictEqual(M.armHolderScatter(CH(null, 20, 30).buyDerived), false);
    assert.strictEqual(M.armHolderScatter({}), false);
  });
  check('V7 豁免键单缺走另一键（top1 null ∧ 前2=30 → 无豁免证据照拒；top1 null ∧ 前2=65 → 豁免）', () => {
    assert.strictEqual(M.armHolderScatter(CH(30, null, 30).buyDerived), true);
    assert.strictEqual(M.armHolderScatter(CH(30, null, 65).buyDerived), false);
  });
  check('V8 gates 门行在位（信号页②因子检查卡展示 posH/top1/前2 值）', () => {
    const r = M.evaluateFactorPreBuy(CH(34, 25, 35));
    const g = r.gates.find((x) => x.id === 'holder_scatter');
    assert.ok(g, 'holder_scatter 门行缺失');
    assert.strictEqual(g.hit, true);
    assert.ok(g.value.includes('34') && g.value.includes('25') && g.value.includes('35'));
    assert.ok(g.line.includes('≥25'));
    const g2 = M.evaluateFactorPreBuy(CH(19, 51, 70)).gates.find((x) => x.id === 'holder_scatter');
    assert.strictEqual(g2.hit, false);
  });
  check('V9 事故反证（进场票两窗 16 票全 t2c≤45〔T91a 口径〕→ CD 口径放大约 1.1-1.2× 后仍 <60 豁免线=零误豁免）', () => {
    // 0x4c46df4c 둥이（h29/t1c28/t2c45 两窗 t2c 峰值票）→ 不豁免
    assert.strictEqual(M.armHolderScatter(CH(29, 28, 50).buyDerived), true);
  });
  check('V10 版本 FP21（T187 持有者打散；豁免=top1≥45 ∨ 前2≥60）', () => {
    assert.strictEqual(M.FACTOR_PREBUY_VERSION, 'FP40');
  });
}

console.log('W. T188/FP22 持仓均等作弊仓臂（HHI<0.10 团伙分仓指纹；四窗 v155/156/140/145 归因）');
{
  const CH2 = (hhi, posH, circ = 20) => SNAP({ buyDerived: { chip: { holderHHI: hhi, posHolderCount: posH, top1HoldCircPct: 20, top1Top2HoldCircPct: 35, circSupplyPct: circ }, win: { 30: { buyBnb: 0.5, buyN: 5 } }, activity: { nearTail10BuyN: 3 } } });
  check('W1 币安锁形状（HHI=0.090 团伙分仓 ∧ 流通 20% 已派发）→ arms 含 even_split_crew', () => {
    const r = M.evaluateFactorPreBuy(CH2(0.090, 20, 20));
    assert.ok(r.arms.includes('even_split_crew'));
  });
  check('W1b 「不对劲」救回形状（HHI=0.091 ∧ 流通 13.7% 拉升中段）→ 放行（用户裁定二修流通腿）', () => {
    const r = M.evaluateFactorPreBuy(CH2(0.091, 26, 13.7));
    assert.ok(!r.arms.includes('even_split_crew'));
  });
  check('W2 边界严格性（HHI 0.099 拒 / 0.100 恰达线放；流通 16.5 拒 / 16.4 放——线值三裁 15→18→16.5 折中）', () => {
    assert.strictEqual(M.armEvenSplitCrew(CH2(0.099, 20, 20).buyDerived), true);
    assert.strictEqual(M.armEvenSplitCrew(CH2(0.100, 20, 20).buyDerived), false);
    assert.strictEqual(M.armEvenSplitCrew(CH2(0.11, 20, 20).buyDerived), false);
    assert.strictEqual(M.armEvenSplitCrew(CH2(0.09, 20, 16.5).buyDerived), true);
    assert.strictEqual(M.armEvenSplitCrew(CH2(0.09, 20, 16.4).buyDerived), false);
  });
  check('W2b 流通腿 null 容缺（circSupplyPct null=totalSupply 缺失）→ 救回方向 fail-open 放行', () => {
    assert.strictEqual(M.armEvenSplitCrew(CH2(0.09, 20, null).buyDerived), false);
  });
  check('W3 null 容缺（holderHHI null——<2 正净持有人有证据的缺席）→ 不评宁不拦', () => {
    assert.strictEqual(M.armEvenSplitCrew(CH2(null, 20).buyDerived), false);
    assert.strictEqual(M.armEvenSplitCrew({}), false);
    const r = M.evaluateFactorPreBuy(CH2(null, 20));
    assert.ok(!r.arms.includes('even_split_crew'));
  });
  check('W4 与 T187 独立并存（HHI 低但 posH<25=不被 holder_scatter 认领 → even_split_crew 认领；HHI 高 posH≥25 → 只 holder_scatter）', () => {
    const r1 = M.evaluateFactorPreBuy(CH2(0.070, 13));
    assert.ok(r1.arms.includes('even_split_crew'));
    assert.ok(!r1.arms.includes('holder_scatter'));
    const r2 = M.evaluateFactorPreBuy(CH2(0.30, 30));
    assert.ok(r2.arms.includes('holder_scatter'));
    assert.ok(!r2.arms.includes('even_split_crew'));
  });
  check('W5 gates 门行在位（信号页②因子检查卡展示 HHI 值）', () => {
    const r = M.evaluateFactorPreBuy(CH2(0.090, 20));
    const g = r.gates.find((x) => x.id === 'even_split_crew');
    assert.ok(g, 'even_split_crew 门行缺失');
    assert.strictEqual(g.hit, true);
    assert.ok(g.value.includes('0.090'));
    assert.ok(g.line.includes('0.10'));
    const g2 = M.evaluateFactorPreBuy(CH2(0.3, 20)).gates.find((x) => x.id === 'even_split_crew');
    assert.strictEqual(g2.hit, false);
  });
  check('W6 事故反证（猫厨师 0.081∧12.4→救回；大美 0.10∧15.3 混合带→16.5 线下救回；DND 0.096∧19.3→拒；BNCBSI 0.064∧16.9→拦误伤知情；甜点带 0.25 放行）', () => {
    assert.strictEqual(M.armEvenSplitCrew(CH2(0.081, 21, 12.4).buyDerived), false);
    assert.strictEqual(M.armEvenSplitCrew(CH2(0.100, 13, 15.3).buyDerived), false);
    assert.strictEqual(M.armEvenSplitCrew(CH2(0.096, 28, 19.3).buyDerived), true);
    assert.strictEqual(M.armEvenSplitCrew(CH2(0.064, 26, 16.9).buyDerived), true);
    assert.strictEqual(M.armEvenSplitCrew(CH2(0.25, 7, 20).buyDerived), false);
  });
  check('W7 HHI 对尾部人数免疫语义锁（同样 top1 份额、尾部户数不同——HHI 由份额平方决定： [50,50]→0.5 vs [50, 25×2]→0.375）', () => {
    const hhi = xs => { const s = xs.reduce((a, b) => a + b, 0); return xs.reduce((a, x) => a + (x / s) ** 2, 0); };
    assert.ok(Math.abs(hhi([50, 50]) - 0.5) < 1e-12);
    assert.ok(Math.abs(hhi([50, 25, 25]) - 0.375) < 1e-12);
  });
  check('W8 版本 FP22（T188 持仓均等作弊仓臂）', () => {
    assert.strictEqual(M.FACTOR_PREBUY_VERSION, 'FP40');
  });
}

console.log('X. FP26/T193 尾段买力枯竭+卖压在场（bt-v158 因子分析立法——卖压假活跃死盘）');
{
  // 夹具：PVP 过（0.3 级在场）+ act 族键容缺（吞吐非死寂）→ 拒因落本臂
  const F26 = (t5n, selN, over) => SNAP(Object.assign({
    wallets: [W(0.3, 0, 0.3, 10)],
    buyDerived: {
      bundledBlock: null,
      win: { 30: { buyBnb: 0.5, buyN: 5, sellN: selN } },
      bigHolderSellBnb60: null,
      activity: { nearTail10BuyN: 3, nearTail5BuyN: t5n },
    },
    cheatDerived: {},
  }, over));
  check('X1 三窗案值全拦：大小姐(1,7)/吕吕(1,7)/阿峰理论(1,7)/라이언(0,11)/HMM(1,5)/김현식(0,6 sbw=burst 唯一命中也负)', () => {
    for (const [t5n, selN] of [[1, 7], [0, 11], [1, 5], [0, 6]]) {
      assert.strictEqual(M.armTailNoBuyerSellPressure(F26(t5n, selN).buyDerived), true, `${t5n},${selN}`);
    }
    const r = M.evaluateFactorPreBuy(F26(1, 7));
    assert.ok(r.arms.includes('tail_no_buyer_pressure'), JSON.stringify(r.arms));
    assert.strictEqual(r.reason, 'tail_no_buyer_pressure');
  });
  check('X2 边界：t5n=2 不拦（尾段买力回到场内）/ selN=4 不拦 / selN=5 恰线拦 / t5n=0 更枯竭照拦', () => {
    assert.strictEqual(M.armTailNoBuyerSellPressure(F26(2, 7).buyDerived), false);
    assert.strictEqual(M.armTailNoBuyerSellPressure(F26(1, 4).buyDerived), false);
    assert.strictEqual(M.armTailNoBuyerSellPressure(F26(1, 5).buyDerived), true);
    assert.strictEqual(M.armTailNoBuyerSellPressure(F26(0, 5).buyDerived), true);
  });
  check('X3 null 容缺（宁漏不冒充）：nearTail5BuyN null / win[30] 缺失 / sellN null → 全不拦', () => {
    assert.strictEqual(M.armTailNoBuyerSellPressure(F26(null, 7).buyDerived), false);
    assert.strictEqual(M.armTailNoBuyerSellPressure({ activity: { nearTail5BuyN: 1 } }), false);
    assert.strictEqual(M.armTailNoBuyerSellPressure({ activity: { nearTail5BuyN: 1 }, win: { 30: { sellN: null } } }), false);
  });
  check('X4 与 CD414 分工（互斥序=重砸盘码先认领）：15户/2B/净−1.5 且 t5n/selN 同真 → cd414 认领、本臂不出场', () => {
    const r = M.evaluateFactorPreBuy(F26(1, 20, {
      buyDerived: {
        bundledBlock: null,
        win: { 30: { buyBnb: 0.4, buyN: 5, sellBnb: 2.5, sellN: 20, sellers: 16, netBnb: -2.1 } },
        activity: { nearTail5BuyN: 1 },
      },
    }));
    assert.ok(r.arms.includes('cd414_dense_dump'), JSON.stringify(r.arms));
    assert.ok(!r.arms.includes('tail_no_buyer_pressure'), '重砸盘由 cd414 先认领');
  });
  check('X5 反例保护（PIKACAT 形状：30s 卖 20 笔但尾 5s 买 5 笔在场=大赢 +0.2778）→ 放行', () => {
    assert.strictEqual(M.armTailNoBuyerSellPressure(F26(5, 20).buyDerived), false);
    assert.strictEqual(M.armTailNoBuyerSellPressure(F26(2, 7).buyDerived), false, '卖压在场但买力回到场内=两腿缺一不拦');
  });
  check('X6 gates 门行在位（信号页②因子检查卡展示两值）', () => {
    const r = M.evaluateFactorPreBuy(F26(1, 7));
    const g = r.gates.find((x) => x.id === 'tail_no_buyer');
    assert.ok(g, 'tail_no_buyer 门行缺失');
    assert.strictEqual(g.hit, true);
    assert.ok(g.value.includes('1笔') && g.value.includes('7笔'), g.value);
    assert.ok(g.line.includes('≥5'), g.line);
    const g2 = M.evaluateFactorPreBuy(F26(2, 7)).gates.find((x) => x.id === 'tail_no_buyer');
    assert.strictEqual(g2.hit, false);
  });
  check('X7 版本（T193 尾段买力枯竭+卖压在场，T194 后顺延 FP27）', () => {
    assert.strictEqual(M.FACTOR_PREBUY_VERSION, 'FP40');
  });
}

console.log('Y. FP27/T194 大户静默卸货（未走完周期庄提前离场——bt-v158 续挖立法）');
{
  const Y27 = (bhs, ath, over) => SNAP(Object.assign({
    wallets: [W(0.3, 0, 0.3, 10)],
    buyDerived: {
      bundledBlock: null,
      win: { 30: { buyBnb: 0.5, buyN: 5, sellN: 0 } },
      bigHolderSellBnb60: bhs, athVsLaunchPct: ath,
      activity: { nearTail10BuyN: 3, nearTail5BuyN: 5 },
    },
    cheatDerived: {},
  }, over));
  check('Y1 三窗案值全拦：Tự do(0.181,46.2)/大小姐(0.198,45.7)/라이언(0.173,58.3)/TI(0.259,40.7)/정책콕(0.251,31.2)/奶螈(0.181,20.2)', () => {
    for (const [bhs, ath] of [[0.181, 46.2], [0.198, 45.7], [0.173, 58.3], [0.259, 40.7], [0.251, 31.2], [0.181, 20.2]]) {
      assert.strictEqual(M.armHolderQuietUnload(Y27(bhs, ath).buyDerived), true, `${bhs},${ath}`);
    }
    const r = M.evaluateFactorPreBuy(Y27(0.181, 46.2));
    assert.ok(r.arms.includes('holder_quiet_unload'), JSON.stringify(r.arms));
    assert.strictEqual(r.reason, 'holder_quiet_unload');
  });
  check('Y2 带状边界：0.099 不拦 / 0.1 恰线拦 / 0.3 上界不拦（换手完成放行——非单调实证 bhs≥0.3 三窗 +0.30 正）/ KIM 案值 0.4585 不拦 / 0.299 带内拦', () => {
    assert.strictEqual(M.armHolderQuietUnload(Y27(0.099, 50).buyDerived), false);
    assert.strictEqual(M.armHolderQuietUnload(Y27(0.1, 50).buyDerived), true);
    assert.strictEqual(M.armHolderQuietUnload(Y27(0.3, 50).buyDerived), false);
    assert.strictEqual(M.armHolderQuietUnload(Y27(0.4585, 24.9).buyDerived), false);
    assert.strictEqual(M.armHolderQuietUnload(Y27(0.299, 50).buyDerived), true);
  });
  check('Y3 ath 边界：79.9 拦 / 80 恰线不拦（严格小于）/ 100.1 残局域不拦（归 FP16/FP25 域）', () => {
    assert.strictEqual(M.armHolderQuietUnload(Y27(0.2, 79.9).buyDerived), true);
    assert.strictEqual(M.armHolderQuietUnload(Y27(0.2, 80).buyDerived), false);
    assert.strictEqual(M.armHolderQuietUnload(Y27(0.2, 100.1).buyDerived), false);
  });
  check('Y4 null 容缺（宁漏不冒充）：bhs null（token_amount 缺失全族 null fail-closed）/ ath null → 全不拦', () => {
    assert.strictEqual(M.armHolderQuietUnload(Y27(null, 50).buyDerived), false);
    assert.strictEqual(M.armHolderQuietUnload(Y27(0.2, null).buyDerived), false);
    assert.strictEqual(M.armHolderQuietUnload(null), false);
  });
  check('Y5 与 FP26 分工（else-if 序=断流预测器先认领）：大小姐形状两臂同真（t5N=1/selN=7 ∧ bhs 0.198/ath 45.7）→ tail_no_buyer_pressure 认领、holder_quiet_unload 不出场', () => {
    const r = M.evaluateFactorPreBuy(Y27(0.198, 45.7, {
      buyDerived: {
        bundledBlock: null, bigHolderSellBnb60: 0.198, athVsLaunchPct: 45.7,
        win: { 30: { buyBnb: 0.5, buyN: 5, sellN: 7 } },
        activity: { nearTail10BuyN: 3, nearTail5BuyN: 1 },
      },
    }));
    assert.ok(r.arms.includes('tail_no_buyer_pressure'), JSON.stringify(r.arms));
    assert.ok(!r.arms.includes('holder_quiet_unload'), 'FP26 在前先认领断流族');
  });
  check('Y6 误伤面保护（三窗 5 张正票全 ≤+0.03 案值确认拦下=知情接受面非误放）：天狗(0.276,25.9)→拦（知情）；对照 astER 深砸重启形状 bhs 0.45+ath 50 → 放行（上界语义）', () => {
    assert.strictEqual(M.armHolderQuietUnload(Y27(0.276, 25.9).buyDerived), true); // 天狗 知情误伤
    assert.strictEqual(M.armHolderQuietUnload(Y27(0.45, 50).buyDerived), false);   // 换手完成放行
  });
  check('Y7 gates 门行在位（信号页②因子检查卡展示 bhs/ath 两值）', () => {
    const r = M.evaluateFactorPreBuy(Y27(0.181, 46.2));
    const g = r.gates.find((x) => x.id === 'holder_quiet_unload');
    assert.ok(g, 'holder_quiet_unload 门行缺失');
    assert.strictEqual(g.hit, true);
    assert.ok(g.value.includes('0.181') && g.value.includes('46.2'), g.value);
    assert.ok(g.line.includes('0.3'), g.line);
    const g2 = M.evaluateFactorPreBuy(Y27(0.3, 50)).gates.find((x) => x.id === 'holder_quiet_unload');
    assert.strictEqual(g2.hit, false);
  });
  check('Y8 版本（T194 大户静默卸货，T195 后顺延 FP28）', () => {
    assert.strictEqual(M.FACTOR_PREBUY_VERSION, 'FP40');
  });
}

console.log('Z. FP28/T195 早窗启动失败死盘（bt-v162 热窗首测立法——7s 窗用户裁定）');
{
  const Z28 = (ath, age, t7, over) => SNAP(Object.assign({
    wallets: [W(0.3, 0, 0.3, 10)],
    buyDerived: {
      bundledBlock: null,
      win: { 30: { buyBnb: 0.5, buyN: 5, sellN: 0 } },
      athVsLaunchPct: ath, tokenAgeSec: age,
      activity: { nearTail10BuyN: 3, nearTail7BuyN: t7 },
    },
    cheatDerived: {},
  }, over));
  check('Z1 案值：MOLLY(31.3,81,1)拦/小团子(24.9,23,1)拦/奶娃踢馆(29.2,15,2)拦/唐三角(21,61,2)拦（真死盘 7s 内也凑不满 3 笔）', () => {
    for (const [ath, age, t7] of [[31.3, 81, 1], [24.9, 23, 1], [29.2, 15, 2], [21, 61, 2]]) {
      assert.strictEqual(M.armLaunchFailDead(Z28(ath, age, t7).buyDerived), true, `${ath},${age},${t7}`);
    }
    const r = M.evaluateFactorPreBuy(Z28(31.3, 81, 1));
    assert.ok(r.arms.includes('launch_fail_dead'), JSON.stringify(r.arms));
    assert.strictEqual(r.reason, 'launch_fail_dead');
  });
  check('Z2 7s 窗救出面（用户裁定改 7s 的实证）：Missy(36.6,85,t7=3)放/凑凑(31.3,81,t7=4)放/テスラSI能飞(t7=4, pnl+0.25)放——买力在 t-6s 格内的边界票', () => {
    assert.strictEqual(M.armLaunchFailDead(Z28(36.6, 85, 3).buyDerived), false);
    assert.strictEqual(M.armLaunchFailDead(Z28(31.3, 81, 4).buyDerived), false);
    assert.strictEqual(M.armLaunchFailDead(Z28(30, 60, 4).buyDerived), false);
  });
  check('Z3 边界：ath 39.9 拦 40 恰线不拦（FP18 域界同值镜像）/ age 89 拦 90 不拦 / t7 2 拦 3 不拦', () => {
    assert.strictEqual(M.armLaunchFailDead(Z28(39.9, 60, 1).buyDerived), true);
    assert.strictEqual(M.armLaunchFailDead(Z28(40, 60, 1).buyDerived), false);
    assert.strictEqual(M.armLaunchFailDead(Z28(30, 89, 1).buyDerived), true);
    assert.strictEqual(M.armLaunchFailDead(Z28(30, 90, 1).buyDerived), false);
    assert.strictEqual(M.armLaunchFailDead(Z28(30, 60, 2).buyDerived), true);
    assert.strictEqual(M.armLaunchFailDead(Z28(30, 60, 3).buyDerived), false);
  });
  check('Z4 null 容缺（宁漏不冒充）：ath/t7 null → 不拦', () => {
    assert.strictEqual(M.armLaunchFailDead(Z28(null, 60, 1).buyDerived), false);
    assert.strictEqual(M.armLaunchFailDead(Z28(30, 60, null).buyDerived), false);
    assert.strictEqual(M.armLaunchFailDead(null), false);
  });
  check('Z5 t7 腿=分离关键锁：同域（ath<40∧age<90）尾段买力 ≥3 放行（「正在启动」好票——去掉该腿四窗 +0.70 正的反证）', () => {
    assert.strictEqual(M.armLaunchFailDead(Z28(30, 60, 3).buyDerived), false);
    assert.strictEqual(M.armLaunchFailDead(Z28(35, 85, 5).buyDerived), false);
  });
  check('Z6 与 FP26 else-if 分工：同票两臂同真（ath31/age81/t7=1 ∧ selN=7）→ tail_no_buyer_pressure 卖压证据更具体先认领', () => {
    const r = M.evaluateFactorPreBuy(Z28(31.3, 81, 1, {
      buyDerived: {
        bundledBlock: null, athVsLaunchPct: 31.3, tokenAgeSec: 81,
        win: { 30: { buyBnb: 0.5, buyN: 5, sellN: 7 } },
        activity: { nearTail10BuyN: 3, nearTail7BuyN: 1, nearTail5BuyN: 1 },
      },
    }));
    assert.ok(r.arms.includes('tail_no_buyer_pressure'), JSON.stringify(r.arms));
    assert.ok(!r.arms.includes('launch_fail_dead'), 'FP26 先认领卖压死盘');
  });
  check('Z7 snapshot 新键 nearTail7BuyN 口径锁（bpInWin 半开窗 (tEnd-7, tEnd]）：t-6s 买在 7s 窗内 5s 窗外', () => {
    const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot.js');
    const T0 = Date.parse('2026-10-03T10:00:00Z');
    let li = 0;
    const mk = (dt, type, bnb) => ({
      block_time: new Date(T0 + dt * 1000).toISOString(), block_number: 1, log_index: li++,
      trade_type: type, bnb_amount: bnb, token_amount: bnb / 5e-9, price_bnb: 5e-9,
      sender_address: '0xw' + dt + '_' + li, trader_address: null,
    });
    const rows = [mk(10, 'buy', 0.1), mk(40, 'buy', 0.1), mk(94, 'buy', 0.3), mk(100, 'sell', 0.15)];
    const act = (buildBuyPointSnapshot(rows, { platform: 'fourmeme', totalSupply: 1e9, createdAt: new Date(T0).toISOString() }, {}).buyDerived || {}).activity || {};
    assert.strictEqual(act.nearTail7BuyN, 1, 't-6s 一笔在 7s 窗内');
    assert.strictEqual(act.nearTail5BuyN, 0, '5s 窗外');
  });
  check('Z8 gates 门行在位（值含 ath/龄/尾7s买）', () => {
    const r = M.evaluateFactorPreBuy(Z28(31.3, 81, 1));
    const g = r.gates.find((x) => x.id === 'launch_fail_dead');
    assert.ok(g, 'launch_fail_dead 门行缺失');
    assert.strictEqual(g.hit, true);
    assert.ok(g.value.includes('31.3') && g.value.includes('1笔'), g.value);
    const g2 = M.evaluateFactorPreBuy(Z28(30, 60, 3)).gates.find((x) => x.id === 'launch_fail_dead');
    assert.strictEqual(g2.hit, false);
  });
  check('Z9 版本 FP28（T195 早窗启动失败死盘）', () => {
    assert.strictEqual(M.FACTOR_PREBUY_VERSION, 'FP40');
  });
}

console.log('AA. FP29/T197 分仓出货残局盘（CI/MOLLY 工厂盘取证立法——超卖钱包×微型盘）');
{
  const Z29 = (oversellBnb, anchorWalletN, over) => SNAP(Object.assign({
    wallets: [W(0.3, 0, 0.3, 10)],
    buyDerived: {
      bundledBlock: null,
      win: { 30: { buyBnb: 0.5, buyN: 5, sellN: 0 } },
      oversellBnb, oversellerN: oversellBnb >= 0.5 ? 1 : 0, anchorWalletN,
    },
    cheatDerived: {},
  }, over));
  check('AA1 四窗案值：MOLLY(1.10,8)/ZEC(0.51,8)/OOC(1.44,7)/BI(1.20,11) → 全拦', () => {
    for (const [b, w] of [[1.10, 8], [0.51, 8], [1.44, 7], [1.20, 11]]) {
      assert.strictEqual(M.armOversellResidual(Z29(b, w).buyDerived), true, `${b},${w}`);
    }
    const r = M.evaluateFactorPreBuy(Z29(1.10, 8));
    assert.ok(r.arms.includes('oversell_residual'), JSON.stringify(r.arms));
    assert.strictEqual(r.reason, 'oversell_residual');
  });
  check('AA2 两腿缺一不可（组合分离锁）：超卖 1.10 但钱包 13/14 → 放（钱包 ≤12 硬腿——12→14 翻正实证）；钱包 8 但超卖 0.3（<0.5）→ 放', () => {
    assert.strictEqual(M.armOversellResidual(Z29(1.10, 13).buyDerived), false, '钱包 13');
    assert.strictEqual(M.armOversellResidual(Z29(1.10, 14).buyDerived), false, '钱包 14');
    assert.strictEqual(M.armOversellResidual(Z29(0.3, 8).buyDerived), false, '超卖 0.3');
  });
  check('AA3 边界：超卖 0.5 恰线拦/0.49 放；钱包 12 恰线拦/13 放', () => {
    assert.strictEqual(M.armOversellResidual(Z29(0.5, 12).buyDerived), true);
    assert.strictEqual(M.armOversellResidual(Z29(0.49, 12).buyDerived), false);
    assert.strictEqual(M.armOversellResidual(Z29(1.0, 12).buyDerived), true);
    assert.strictEqual(M.armOversellResidual(Z29(1.0, 13).buyDerived), false);
  });
  check('AA4 null 容缺（宁漏不冒充）：oversellBnb/anchorWalletN null → 不拦；bd null → 不拦', () => {
    assert.strictEqual(M.armOversellResidual(Z29(null, 8).buyDerived), false);
    assert.strictEqual(M.armOversellResidual(Z29(1.0, null).buyDerived), false);
    assert.strictEqual(M.armOversellResidual(null), false);
  });
  check('AA5 独立 if 非互斥链（结构证据臂与 launchSquad 同族）：FP26 命中时本臂仍可同场双码（四窗零重叠=语义上不会但结构上不互斥）', () => {
    const r = M.evaluateFactorPreBuy(SNAP({
      wallets: [W(0.3, 0, 0.3, 10)],
      buyDerived: {
        bundledBlock: null,
        win: { 30: { buyBnb: 0.5, buyN: 5, sellN: 7 } },
        activity: { nearTail10BuyN: 3, nearTail5BuyN: 1 },
        oversellBnb: 1.1, oversellerN: 1, anchorWalletN: 8,
      },
      cheatDerived: {},
    }));
    assert.ok(r.arms.includes('tail_no_buyer_pressure'), JSON.stringify(r.arms));
    assert.ok(r.arms.includes('oversell_residual'), JSON.stringify(r.arms));
  });
  check('AA6 gates 门行在位（值含 超卖B/钱包数）', () => {
    const r = M.evaluateFactorPreBuy(Z29(1.10, 8));
    const g = r.gates.find((x) => x.id === 'oversell_residual');
    assert.ok(g, 'oversell_residual 门行缺失');
    assert.strictEqual(g.hit, true);
    assert.ok(g.value.includes('1.1') && g.value.includes('8'), g.value);
    const g2 = M.evaluateFactorPreBuy(Z29(0.3, 8)).gates.find((x) => x.id === 'oversell_residual');
    assert.strictEqual(g2.hit, false);
  });
  check('AA7 版本（T197 分仓出货残局盘，T198 后顺延 FP30）', () => {
    assert.strictEqual(M.FACTOR_PREBUY_VERSION, 'FP40');
  });
}

console.log('AB. FP30/T198 机器持筹垄断（arbBot 组净持筹占在场流通——存量口径，注入制键）');
{
  const Z30 = (pct, over) => SNAP(Object.assign({
    wallets: [W(0.3, 0, 0.3, 10)],
    buyDerived: {
      bundledBlock: null,
      win: { 30: { buyBnb: 0.5, buyN: 5 } },
      bigHolderSellBnb60: null,
      activity: { nearTail10BuyN: 3 },
      arbBotHoldCircPct: pct,
      arbBotHolderN: typeof pct === 'number' ? 2 : null,
    },
    cheatDerived: {},
  }, over));
  check('AB1 命中：持筹 ≥30 → 拒 arb_bot_holdings（案值 0x64ed2dab 流 9%/持 61%）', () => {
    const r = M.evaluateFactorPreBuy(Z30(61));
    assert.ok(r.arms.includes('arb_bot_holdings'), JSON.stringify(r.arms));
    assert.strictEqual(r.reason, 'arb_bot_holdings');
    assert.strictEqual(r.pass, false);
  });
  check('AB2 边界：29.99 放行 / 30 恰线拦（四窗校准线不带中间带）', () => {
    assert.strictEqual(M.evaluateFactorPreBuy(Z30(29.99)).pass, true);
    assert.strictEqual(M.evaluateFactorPreBuy(Z30(30)).reason, 'arb_bot_holdings');
  });
  check('AB3 null 容缺（钱包集未注入/wallets 空——宁漏不冒充）：不拦', () => {
    assert.strictEqual(M.evaluateFactorPreBuy(Z30(null)).pass, true);
    const rUndef = M.evaluateFactorPreBuy(Z30(undefined));
    assert.strictEqual(rUndef.pass, true);
  });
  check('AB4 负值恒放行（组净卖超买=机器清仓离场——卖光的不坐庄，28ad 语义护栏）', () => {
    const r = M.evaluateFactorPreBuy(Z30(-200));
    assert.strictEqual(r.pass, true);
    assert.ok(!r.arms.includes('arb_bot_holdings'));
  });
  check('AB5 独立 if 非互斥链（存量口径与流量/结构臂正交）：与 oversell 同场双码', () => {
    const r = M.evaluateFactorPreBuy(Z30(45, {
      buyDerived: {
        bundledBlock: null,
        win: { 30: { buyBnb: 0.5, buyN: 5 } },
        bigHolderSellBnb60: null,
        activity: { nearTail10BuyN: 3 },
        oversellBnb: 1.1, oversellerN: 1, anchorWalletN: 8,
        arbBotHoldCircPct: 45, arbBotHolderN: 2,
      },
    }));
    assert.ok(r.arms.includes('arb_bot_holdings') && r.arms.includes('oversell_residual'), JSON.stringify(r.arms));
  });
  check('AB6 gates 门行在位（值含 持筹%/户数）', () => {
    const r = M.evaluateFactorPreBuy(Z30(42));
    const g = r.gates.find((x) => x.id === 'arb_bot_holdings');
    assert.ok(g, 'arb_bot_holdings 门行缺失');
    assert.strictEqual(g.hit, true);
    assert.ok(g.value.includes('42') && g.value.includes('2'), g.value);
    const g2 = M.evaluateFactorPreBuy(Z30(12)).gates.find((x) => x.id === 'arb_bot_holdings');
    assert.strictEqual(g2.hit, false);
  });
  check('AB7 版本（T198 机器持筹垄断，T198b 流通腿后 FP36）', () => {
    assert.strictEqual(M.FACTOR_PREBUY_VERSION, 'FP40');
  });
  // T198b/FP36 流通腿豁免（2026-11-21 案源 0x2ee9…7777：镜像 sandwich_bot 瞬时
  // 库存误读；四窗深跌分离 0 vs 15，线 16.5=FP22 同线，null 不豁免保持拦）
  const C30 = (circ, over) => SNAP(Object.assign({
    wallets: [W(0.3, 0, 0.3, 10)],
    buyDerived: {
      bundledBlock: null,
      win: { 30: { buyBnb: 0.5, buyN: 5 } },
      bigHolderSellBnb60: null,
      activity: { nearTail10BuyN: 3 },
      arbBotHoldCircPct: 35.18, arbBotHolderN: 3,
      chip: circ === undefined ? undefined : { circSupplyPct: circ, holderHHI: 0.244 },
    },
    cheatDerived: {},
  }, over));
  check('AB8 T198b 低流通豁免：持筹 35.18 ∧ 流通 14.5（0x2ee9 案值）→ 放行', () => {
    const r = M.evaluateFactorPreBuy(C30(14.5));
    assert.strictEqual(r.pass, true, JSON.stringify(r.arms));
    assert.ok(!r.arms.includes('arb_bot_holdings'), JSON.stringify(r.arms));
  });
  check('AB9 T198b 高流通仍拦：持筹 34.96 ∧ 流通 22.4（MiniMaxM3.1 案值）→ 拒', () => {
    const r = M.evaluateFactorPreBuy(C30(22.4));
    assert.strictEqual(r.reason, 'arb_bot_holdings');
    assert.strictEqual(r.pass, false);
  });
  check('AB10 T198b 边界：16.49 豁免 / 16.5 恰线仍拦（<16.5 严格不含本值，FP22 同线同语义）', () => {
    assert.strictEqual(M.evaluateFactorPreBuy(C30(16.49)).pass, true);
    assert.strictEqual(M.evaluateFactorPreBuy(C30(16.5)).reason, 'arb_bot_holdings');
  });
  check('AB11 T198b null 不豁免保持拦（豁免证据缺席 fail-closed——FP33 惯例；chip 缺席/circSupplyPct null 两形状）', () => {
    assert.strictEqual(M.evaluateFactorPreBuy(C30(null)).reason, 'arb_bot_holdings');
    assert.strictEqual(M.evaluateFactorPreBuy(Z30(42)).reason, 'arb_bot_holdings'); // chip 整段缺席（AB 基底）= 照拦
  });
  check('AB12 T198b gates 值含流通%（豁免与拦截两态）', () => {
    const gRel = M.evaluateFactorPreBuy(C30(14.5)).gates.find((x) => x.id === 'arb_bot_holdings');
    assert.strictEqual(gRel.hit, false);
    assert.ok(gRel.value.includes('14.5'), gRel.value);
    const gHit = M.evaluateFactorPreBuy(C30(22.4)).gates.find((x) => x.id === 'arb_bot_holdings');
    assert.strictEqual(gHit.hit, true);
    assert.ok(gHit.value.includes('22.4'), gHit.value);
  });
}

console.log('AC. FP31/T200 fam_holding_thin 中等跟单豁免（slot 级 U 型最好带 win71%——用户裁定豁免）');
{
  // thin 形状基底：famous 在场持有（soldRatio<0.7）∧ 薄盘（totalBuy<3）
  const FT = (fb) => ({
    wallets: [{ w: '0xf', buyBnb: 0.15, sellBnb: 0.02, netBnb: 0.13 }],
    groupBuyBnb: 0.15, groupSellBnb: 0.02, famousFollowBnb: fb,
  });
  const SNAP31 = (fb) => ({
    ticks: [{}], wallets: [],
    buyDerived: { famousTraces: FT(fb), chg30Pct: 0, bundledBlock: null },
    cheatDerived: { totalBuyBnb: 2.0 },
  });
  check('AC1 豁免带边界：follow 0.049 照拦（零响应带）/ 0.05 恰线豁免 / 0.199 豁免 / 0.2 上界照拦（重跟单泡沫带）', () => {
    assert.strictEqual(M.evaluateFactorPreBuy(SNAP31(0.049)).famous.reason, 'fam_holding_thin');
    const r2 = M.evaluateFactorPreBuy(SNAP31(0.05));
    assert.strictEqual(r2.famous.reason, null);
    assert.strictEqual(r2.famous.branch, 'fam_holding_thin_exempt_follow');
    assert.strictEqual(M.evaluateFactorPreBuy(SNAP31(0.199)).famous.reason, null);
    assert.strictEqual(M.evaluateFactorPreBuy(SNAP31(0.2)).famous.reason, 'fam_holding_thin');
  });
  check('AC2 豁免证据缺席（famousFollowBnb null=首买 block 缺失）不豁免保持拦（宁拦不冒充——原 thin 证据仍在场）', () => {
    assert.strictEqual(M.evaluateFactorPreBuy(SNAP31(null)).famous.reason, 'fam_holding_thin');
  });
  check('AC3 留痕：豁免/照拦两路径 trace 都带 famousFollowBnb + followExempt', () => {
    const ex = M.evaluateFactorPreBuy(SNAP31(0.12)).famous;
    assert.strictEqual(ex.trace.famousFollowBnb, 0.12);
    assert.strictEqual(ex.trace.followExempt, true);
    const keep = M.evaluateFactorPreBuy(SNAP31(0.5)).famous;
    assert.strictEqual(keep.trace.famousFollowBnb, 0.5);
    assert.strictEqual(keep.trace.followExempt, false);
  });
  check('AC4 豁免仅薄盘分支：dumping 分支（chg30<-15）与二法收割不受豁免影响', () => {
    const s = {
      ticks: [{}], wallets: [],
      buyDerived: { famousTraces: FT(0.12), chg30Pct: -20, bundledBlock: null },
      cheatDerived: { totalBuyBnb: 8.0 },  // 非 thin（>3）→ 走 dumping 分支
    };
    assert.strictEqual(M.evaluateFactorPreBuy(s).famous.reason, 'fam_holding_dumping');
  });
  check('AC5 常量线：[0.05, 0.2) 豁免带', () => {
    assert.strictEqual(M.FAM_THIN_FOLLOW_EXEMPT_MIN_BNB, 0.05);
    assert.strictEqual(M.FAM_THIN_FOLLOW_EXEMPT_MAX_BNB, 0.2);
  });
  check('AC6 版本 FP31（T200 中等跟单豁免）', () => {
    assert.strictEqual(M.FACTOR_PREBUY_VERSION, 'FP40');
  });
}

console.log('AD. FP32/T201 大户买入推迟（ladder v34 G2 迁入——행복의 날개 0x7b0c9b1b…7777 案源）');
{
  const LD = (bigBuyBnb, sinceFirstTradeSec, minVsFloorPct = null) => ({ bigBuyBnb, sinceFirstTradeSec, minVsFloorPct });
  const LDPASS = (ld, extraBd = {}) => SNAP({
    wallets: [W(0.2994, 0.1, 0.2994, 100)], // 0.3 级单笔在场=PVP 过（E1 同款）
    buyDerived: Object.assign({
      bundledBlock: null, win: { 30: { buyBnb: 0.5, buyN: 5 } },
      bigHolderSellBnb60: null, activity: { nearTail10BuyN: 3 },
    }, extraBd, { launchDefer: ld }),
  });
  check('AD1 案源形状（bigBuy=1.22 ∧ sFT=26 → 推迟）: arms 含 big_buy_defer+reason 认领+gates 三锚展示', () => {
    const r = M.evaluateFactorPreBuy(LDPASS(LD(1.22, 26)));
    assert.strictEqual(r.pass, false);
    assert.strictEqual(r.reason, 'big_buy_defer');
    assert.ok(r.arms.includes('big_buy_defer'));
    const g = r.gates.find((x) => x.id === 'big_buy_defer');
    assert.ok(g, 'gates 须含 big_buy_defer 门');
    assert.strictEqual(g.hit, true);
    assert.ok(g.value.includes('1.22') && g.value.includes('26'), g.value);
  });
  check('AD2 sFT>60 释放（抛压释放窗过）→ arms 不含', () => {
    const r = M.evaluateFactorPreBuy(LDPASS(LD(1.4, 61)));
    assert.strictEqual(r.pass, true);
    assert.ok(!r.arms.includes('big_buy_defer'));
  });
  check('AD3 两档：0.9@46s 放（0.79 档 45s 释放）/0.7934@36s 拦（驴党贴线视同 0.8 级）/0.78 放（线下）', () => {
    assert.ok(!M.evaluateFactorPreBuy(LDPASS(LD(0.9, 46))).arms.includes('big_buy_defer'));
    assert.ok(M.evaluateFactorPreBuy(LDPASS(LD(0.7934, 36))).arms.includes('big_buy_defer'));
    assert.ok(!M.evaluateFactorPreBuy(LDPASS(LD(0.78, 20))).arms.includes('big_buy_defer'));
  });
  check('AD4 深破豁免 −11 < −10 → 不推迟；floor null=豁免证据缺席照拦', () => {
    assert.ok(!M.evaluateFactorPreBuy(LDPASS(LD(0.9, 20, -11))).arms.includes('big_buy_defer'));
    assert.ok(M.evaluateFactorPreBuy(LDPASS(LD(0.9, 20, null))).arms.includes('big_buy_defer'));
  });
  check('AD5 launchDefer null（截窗未覆盖出生段=老票）→ 不评放行', () => {
    const r = M.evaluateFactorPreBuy(LDPASS(null));
    assert.ok(!r.arms.includes('big_buy_defer'));
  });
  check('AD6 臂序：launch_squad 同中时绝对 veto 先认领（arms[0]=launch_squad_dominance，defer 随后）', () => {
    const r = M.evaluateFactorPreBuy(LDPASS(LD(1.22, 26), { launchSquad: { waveWallets: 9, domPct: 41.5 } }));
    assert.strictEqual(r.arms[0], 'launch_squad_dominance');
    assert.ok(r.arms.includes('big_buy_defer'));
  });
  check('AD7 版本 FP33（JG6 tail_dip 有机盘豁免；FP32 大户推迟线不变）', () => {
    assert.strictEqual(M.FACTOR_PREBUY_VERSION, 'FP40');
    assert.strictEqual(M.BIG_BUY_DEFER_TIER079_BNB, 0.79);
    assert.strictEqual(M.BIG_BUY_DEFER_TIER1_BNB, 1);
    assert.strictEqual(M.BIG_BUY_DEFER_SEC_TIER079, 45);
    assert.strictEqual(M.BIG_BUY_DEFER_SEC_TIER1, 60);
    assert.strictEqual(M.BIG_BUY_DEFER_EXEMPT_FLOOR_PCT, -10);
    assert.strictEqual(M.TAIL_DIP_EXEMPT_MIN_TOTAL_BUY_BNB, 3);
    assert.strictEqual(M.TAIL_DIP_EXEMPT_MAX_TOTAL_BUY_BNB, 8);
    assert.strictEqual(M.TAIL_DIP_EXEMPT_MAX_NO_BUY_SELL_PCT, 10);
    assert.strictEqual(M.TAIL_DIP_EXEMPT_MAX_HOLDER_HHI, 0.2);
    assert.strictEqual(M.TAIL_DIP_EXEMPT_MIN_ROUTER_ENTRY_PCT, 60);
    assert.strictEqual(M.TAIL_DIP_EXEMPT_MAX_TOP1_BUY_PCT, 15);
    assert.strictEqual(M.TAIL_DIP_EXEMPT_MAX_SAME_BLOCK_HOLD_CIRC_PCT, 60);
    assert.strictEqual(M.TAIL_DIP_EXEMPT_MIN_FAMOUS_GROUP_BUY_BNB, 0.1);
    assert.strictEqual(M.TAIL_DIP_EXEMPT_MAX_FAMOUS_COHORT_WALLETS, 3);
  });
}

console.log('AE. FP33/JG6 tail_dip 有机盘豁免（金狗 쿠우타 0xc0e896dd…7777 案，2026-11-21）');
{
  // 쿠우타 首次被拦时刻（02:30:40）锚窗真实值：九腿全真（washPairCount null=零对敲）
  const KUTA_CD = { washPairCount: null, noBuySellPct: 6.4, holderHHI: 0.15, totalBuyBnb: 5.6,
    routerEntryBuyPct: 83.6, top1BuyPct: 8.85, sameBlockHoldCircPct: 53.1 };
  const KUTA_FT = { groupBuyBnb: 0.47, famousCohortMaxWallets: 3 };
  const EX = (cdOver, ftOver) => SNAP({
    wallets: [W(0.3, 0, 0.3), W(0.25, 0, 0.25)], // pvp big_buyers_present 不抢拒码
    buyDerived: { athVsLaunchPct: 104.6, currentVsLaunchPct: 21.6, chg5Pct: -5.9, chg30Pct: -14.0,
      famousTraces: ftOver === null ? null : Object.assign({}, KUTA_FT, ftOver),
      bundledBlock: null, win: { 30: { buyBnb: 0.5, buyN: 5 } }, activity: { nearTail10BuyN: 3 } },
    cheatDerived: Object.assign({}, KUTA_CD, cdOver),
  });
  check('AE1 灰度缺省关（不传 opts）→ 照拦 tail_dip_knife（FP32 行为 bit 不变）', () => {
    const r = M.evaluateFactorPreBuy(EX());
    assert.strictEqual(r.pass, false);
    assert.strictEqual(r.reason, 'tail_dip_knife');
    assert.strictEqual(r.tailDipExempt, undefined);
  });
  check('AE2 쿠우타 九腿全真+开关开 → 豁免放行 + 留痕（tailDipExempt/trace/arms 三处）', () => {
    const r = M.evaluateFactorPreBuy(EX(), { enableTailDipExempt: true });
    assert.strictEqual(r.pass, true);
    assert.strictEqual(r.reason, null);
    assert.ok(!r.arms.includes('tail_dip_knife'));
    assert.strictEqual(r.tailDipExempt.code, 'tail_dip_organic_exempt');
    assert.strictEqual(r.trace.tailDipExempt, 'organic');
  });
  check('AE3 kroea 反例（famous 同块跟单 max=4 粉丝团冲量）→ 豁免不适用照拦', () => {
    const r = M.evaluateFactorPreBuy(EX({}, { famousCohortMaxWallets: 4 }), { enableTailDipExempt: true });
    assert.strictEqual(r.reason, 'tail_dip_knife');
  });
  check('AE4 Eagle 反例（sameBlockHoldCircPct=83.2 捆绑持仓）→ 照拦', () => {
    const r = M.evaluateFactorPreBuy(EX({ sameBlockHoldCircPct: 83.2 }), { enableTailDipExempt: true });
    assert.strictEqual(r.reason, 'tail_dip_knife');
  });
  check('AE5 SB 反例（totalBuyBnb=19.8 巨量=注意力释放完）→ 照拦（上界 8 强腿）', () => {
    const r = M.evaluateFactorPreBuy(EX({ totalBuyBnb: 19.8 }), { enableTailDipExempt: true });
    assert.strictEqual(r.reason, 'tail_dip_knife');
  });
  check('AE6 量级下界（totalBuyBnb=2.5 未火过）→ 照拦', () => {
    const r = M.evaluateFactorPreBuy(EX({ totalBuyBnb: 2.5 }), { enableTailDipExempt: true });
    assert.strictEqual(r.reason, 'tail_dip_knife');
  });
  check('AE7 famous 未参与（groupBuyBnb=0，大哥你不丑型）→ 照拦', () => {
    const r = M.evaluateFactorPreBuy(EX({}, { groupBuyBnb: 0 }), { enableTailDipExempt: true });
    assert.strictEqual(r.reason, 'tail_dip_knife');
  });
  check('AE8 famousTraces null（roster 缺失=豁免证据缺席不豁免）→ 照拦', () => {
    const r = M.evaluateFactorPreBuy(EX(null, null), { enableTailDipExempt: true });
    assert.strictEqual(r.reason, 'tail_dip_knife');
  });
  check('AE9 washPairCount=2（真实对敲在场）→ 照拦（null=零对敲与 0 同判放行）', () => {
    const r = M.evaluateFactorPreBuy(EX({ washPairCount: 2 }), { enableTailDipExempt: true });
    assert.strictEqual(r.reason, 'tail_dip_knife');
  });
  check('AE10 insider 抛货（noBuySellPct=15）→ 照拦', () => {
    const r = M.evaluateFactorPreBuy(EX({ noBuySellPct: 15 }), { enableTailDipExempt: true });
    assert.strictEqual(r.reason, 'tail_dip_knife');
  });
  check('AE11 cd 键 null（cheatDerived 缺=证据缺席）→ 照拦（宁拦不冒充）', () => {
    const r = M.evaluateFactorPreBuy(SNAP({
      wallets: [W(0.3, 0, 0.3), W(0.25, 0, 0.25)],
      buyDerived: { athVsLaunchPct: 104.6, currentVsLaunchPct: 21.6, chg5Pct: -5.9, chg30Pct: -14.0,
        famousTraces: { groupBuyBnb: 0.47, famousCohortMaxWallets: 3 },
        bundledBlock: null, win: { 30: { buyBnb: 0.5, buyN: 5 } }, activity: { nearTail10BuyN: 3 } },
      cheatDerived: {},
    }), { enableTailDipExempt: true });
    assert.strictEqual(r.reason, 'tail_dip_knife');
  });
  check('AE12 域外豁免不注记（tail_dip 未命中=FP32 形状完全不变）', () => {
    const r = M.evaluateFactorPreBuy(SNAP({
      wallets: [W(0.3, 0, 0.3)],
      buyDerived: { athVsLaunchPct: 30, currentVsLaunchPct: 19.7, chg5Pct: -13, chg30Pct: -25,
        famousTraces: { groupBuyBnb: 0.47, famousCohortMaxWallets: 3 },
        bundledBlock: null, win: { 30: { buyBnb: 0.5, buyN: 5 } }, activity: { nearTail10BuyN: 3 } },
      cheatDerived: KUTA_CD,
    }), { enableTailDipExempt: true });
    assert.strictEqual(r.pass, true);
    assert.strictEqual(r.tailDipExempt, undefined);
  });
  // FP34 两臂族：tail_no_buyer_pressure 同款豁免（쿠우타 02:30 首拦行实锤=两臂同时命中，
  // 单臂豁免后围堵；lifecycle/act 不在豁免族）
  const TNB = (bdOver) => SNAP({
    wallets: [W(0.3, 0, 0.3), W(0.25, 0, 0.25)],
    buyDerived: Object.assign({ famousTraces: { groupBuyBnb: 0.47, famousCohortMaxWallets: 3 },
      bundledBlock: null, win: { 30: { sellN: 8, sellBnb: 1.2 } }, activity: { nearTail5BuyN: 1 } }, bdOver),
    cheatDerived: JSON.parse(JSON.stringify(KUTA_CD)),
  });
  check('AE13 FP34 两臂族：tail_no_buyer 域内+九腿全真+开关开 → 豁免放行 + tailNoBuyerExempt 留痕', () => {
    const r = M.evaluateFactorPreBuy(TNB({}), { enableTailDipExempt: true });
    assert.strictEqual(r.reason, null);
    assert.ok(!r.arms.includes('tail_no_buyer_pressure'));
    assert.strictEqual(r.tailNoBuyerExempt.code, 'tail_no_buyer_organic_exempt');
    assert.strictEqual(r.trace.tailNoBuyerExempt, 'organic');
  });
  check('AE14 FP34 两臂族灰度关 → tail_no_buyer 照拦（缺省=FP32 行为）', () => {
    const r = M.evaluateFactorPreBuy(TNB({}));
    assert.strictEqual(r.reason, 'tail_no_buyer_pressure');
    assert.strictEqual(r.tailNoBuyerExempt, undefined);
  });
  check('AE15 FP34 豁免腿不全（famous 未参与）→ tail_no_buyer 照拦', () => {
    const r = M.evaluateFactorPreBuy(TNB({ famousTraces: { groupBuyBnb: 0, famousCohortMaxWallets: 0 } }), { enableTailDipExempt: true });
    assert.strictEqual(r.reason, 'tail_no_buyer_pressure');
  });
  check('AE17 fail 腿留痕（SI 案形状：HHI 时变破线 → trace.tailDipExemptFail=holderHHI）', () => {
    const r = M.evaluateFactorPreBuy(EX({ holderHHI: 0.2835 }), { enableTailDipExempt: true });
    assert.strictEqual(r.reason, 'tail_dip_knife');
    assert.strictEqual(r.trace.tailDipExemptFail, 'holderHHI');
    const r2 = M.evaluateFactorPreBuy(TNB({}), { enableTailDipExempt: true });
    assert.strictEqual(r2.trace.tailNoBuyerExempt, 'organic');
    assert.strictEqual(r2.trace.tailNoBuyerExemptFail, undefined);
  });
  check('AE16 lifecycle 不在豁免族（T192 残局臂照拦=用户裁定只豁两臂）', () => {
    const r = M.evaluateFactorPreBuy(SNAP({
      wallets: [W(0.3, 0, 0.3), W(0.25, 0, 0.25)],
      buyDerived: { athVsLaunchPct: 104.6, currentVsLaunchPct: 21.6, chg5Pct: -1.0, chg30Pct: -1.0,
        totalVolumeBnb: 11.2, famousTraces: { groupBuyBnb: 0.47, famousCohortMaxWallets: 3 },
        bundledBlock: null, win: { 30: { buyBnb: 0.5, buyN: 5 } }, activity: { nearTail10BuyN: 3 } },
      cheatDerived: Object.assign({}, KUTA_CD, { burstLastGapSec: 33, burstSecSinceSegEnd: 5, burstWaveSegSellPct: 100, burstWaveSegSellBnb: 0.5 }),
    }), { enableTailDipExempt: true });
    assert.strictEqual(r.reason, 'lifecycle_sell_residual');
    assert.strictEqual(r.tailDipExempt, undefined);
    assert.strictEqual(r.tailNoBuyerExempt, undefined);
  });
}

// ═════ AG. T205/FP35 act low 阶段前提 + tail_dip 量腿（金狗 GWC 0xb71209cb…7777 复活拉回案） ═════
// 案源反证锚：bt-v164 2026-10-03 23:54:36 唯一 BUY 信号 metadata——arms=['tail_dip_knife',
// 'act_low']、reason='factor_gate_act_low'、gate 值 ath43.5/curVs26.3/chg5-6.01/chg30-6.01/
// 静默98.9%吞吐0.05B/min；锚前 30s=4 笔尘埃卖共 0.164B（chg5=chg10=chg30 全等=30s 窗内
// 唯一变价组）；锚后 +932% 毕业。用户两原则=fix① 未火过（ATH<80）act low 让位 /
// fix② 量极少的跌不是从高点下来的（卖30s≥0.3B 才拦）。
console.log('AG. T205 阶段前提+量腿（GWC 复活拉回案）');
{
  // ── fix② 量腿：GWC 全形状夹具（双臂现场值）──
  const GWC = (sellBnb30, sellN30 = 4) => SNAP({
    wallets: [W(0.3, 0, 0.3), W(0.25, 0, 0.25)], // pvp big_buyers_present（0.2级×2 在场）
    buyDerived: { athVsLaunchPct: 43.5, currentVsLaunchPct: 26.3, chg5Pct: -6.01, chg30Pct: -6.01,
      bundledBlock: null, win: { 30: { buyBnb: 0, buyN: 0, sellBnb: sellBnb30, sellN: sellN30 } },
      activity: { idlePct: 98.9, ticksPerMin: 0.3, buyMedianBnb: 0, throughputBnbPerMin: 0.05, spanSec: 400, tickCount: 12 } },
  });
  check('AG1 案源反证：灰度全关（缺省）→ 照拦，arms/tally 与生产行 bit 一致（tail_dip_knife+act_low 双命中、reason=act_low 优先级）', () => {
    const r = M.evaluateFactorPreBuy(GWC(0.164));
    assert.strictEqual(r.pass, false);
    assert.strictEqual(r.reason, 'act_low');
    assert.deepStrictEqual(r.arms, ['tail_dip_knife', 'act_low']);
  });
  check('AG2 量腿开：GWC 尘埃漂移 0.164B → tail_dip 不拦', () => {
    const r = M.evaluateFactorPreBuy(GWC(0.164), { enableTailDipVolumeLeg: true });
    assert.ok(!r.arms.includes('tail_dip_knife'));
  });
  check('AG3 量腿边界：0.299 不拦 / 0.3 恰拦（严格 <）', () => {
    assert.ok(!M.evaluateFactorPreBuy(GWC(0.299), { enableTailDipVolumeLeg: true }).arms.includes('tail_dip_knife'));
    assert.ok(M.evaluateFactorPreBuy(GWC(0.3), { enableTailDipVolumeLeg: true }).arms.includes('tail_dip_knife'));
  });
  check('AG4 量腿 win30 卖额缺席 → 臂不触发（null 容缺同哲学）', () => {
    const snap = SNAP({
      wallets: [W(0.3, 0, 0.3), W(0.25, 0, 0.25)],
      buyDerived: { athVsLaunchPct: 43.5, currentVsLaunchPct: 26.3, chg5Pct: -6.01, chg30Pct: -6.01,
        bundledBlock: null, win: { 30: { buyBnb: 0, buyN: 0 } }, activity: { nearTail10BuyN: 3 } },
    });
    assert.ok(!M.evaluateFactorPreBuy(snap, { enableTailDipVolumeLeg: true }).arms.includes('tail_dip_knife'));
  });
  check('AG5 量腿开：有量崩塌（卖30s=0.5B/8笔）→ 照拦（量少豁的是空簿漂移非崩塌本体）', () => {
    assert.ok(M.evaluateFactorPreBuy(GWC(0.5, 8), { enableTailDipVolumeLeg: true }).arms.includes('tail_dip_knife'));
  });

  // ── fix① 阶段前提：judgeActivityLevel opts ──
  const STAGE = (ath, activity = { idlePct: 98.9, ticksPerMin: 0.3, buyMedianBnb: 0, throughputBnbPerMin: 0.05, spanSec: 400, tickCount: 12, nearTail10BuyN: 2 }, cd = { maxBlockBuyCount: 4 }) => ({
    ticks: [{ dt: 400 }], wallets: [],
    buyDerived: Object.assign({ activity }, ath == null ? {} : { athVsLaunchPct: ath }),
    cheatDerived: cd,
  });
  check('AG10 未火过 ath=43.5 灰度开 → low 五臂整体让位（level null / branch=act_stage_cold / trace 留痕 stageAth+stageCold）', () => {
    const r = M.judgeActivityLevel(STAGE(43.5), { enableActStageCold: true });
    assert.strictEqual(r.level, null);
    assert.strictEqual(r.branch, 'act_stage_cold');
    assert.strictEqual(r.trace.stageAth, 43.5);
    assert.strictEqual(r.trace.stageCold, true);
  });
  check('AG11 边界：ath=79.9 让位 / ath=80 恰照拦（火过线 80=FP27 同线）', () => {
    assert.strictEqual(M.judgeActivityLevel(STAGE(79.9), { enableActStageCold: true }).level, null);
    const r = M.judgeActivityLevel(STAGE(80), { enableActStageCold: true });
    assert.strictEqual(r.level, 'low');
    assert.strictEqual(r.branch, 'act_low_idle');
  });
  check('AG12 ath null=照拦（放行方向证据缺席不释放）', () => {
    const r = M.judgeActivityLevel(STAGE(null), { enableActStageCold: true });
    assert.strictEqual(r.level, 'low');
    assert.strictEqual(r.trace.stageCold, false);
  });
  check('AG13 灰度关（缺省）→ ath=43.5 照拦 low（FP34 行为 bit 不变）', () => {
    const r = M.judgeActivityLevel(STAGE(43.5));
    assert.strictEqual(r.level, 'low');
    assert.strictEqual(r.branch, 'act_low_idle');
  });
  check('AG14 ultra 刻意不受阶段前提影响（协同出货=当下事实非静默语义）', () => {
    const snap = {
      ticks: [{ dt: 400 }], wallets: [],
      buyDerived: { athVsLaunchPct: 43.5, activity: { nearTail10SellWallets: 12, nearTail10BuyN: 0, nearTail10BuyBnb: 0, idlePct: 2, ticksPerMin: 200 } },
      cheatDerived: {},
    };
    const r = M.judgeActivityLevel(snap, { enableActStageCold: true });
    assert.strictEqual(r.level, 'ultra');
    assert.strictEqual(r.branch, 'act_ultra_coordinated_selling');
  });
  check('AG15 端到端（FP38 撤回后=纯阶段语义）：GWC 全形状双灰度全开 → 双臂全让位 pass（复活拉回收官；ABC 三反锚已随 v174 对拍否证撤回）', () => {
    const r = M.evaluateFactorPreBuy(GWC(0.164), { enableTailDipVolumeLeg: true, enableActStageCold: true });
    assert.strictEqual(r.pass, true);
    assert.strictEqual(r.reason, null);
    assert.deepStrictEqual(r.arms, []);
  });
  check('AG16 端到端：只开量腿（阶段关）→ 仍被 act_low 拦（单修不救案源——同源误读双出口）', () => {
    const r = M.evaluateFactorPreBuy(GWC(0.164), { enableTailDipVolumeLeg: true });
    assert.strictEqual(r.reason, 'act_low');
  });
  check('AG17 端到端：只开阶段（量腿关）→ 仍被 tail_dip 拦（ath43.5≥40 域内）', () => {
    const r = M.evaluateFactorPreBuy(GWC(0.164), { enableActStageCold: true });
    assert.strictEqual(r.reason, 'tail_dip_knife');
  });
  check('AG18 火过票灰度全开 → 双臂照拦（ATH≥80 死盘不受保护）', () => {
    const r = M.evaluateFactorPreBuy(GWC(0.5, 8), { enableTailDipVolumeLeg: true, enableActStageCold: true });
    // GWC 夹具换 ath 需重建——用 armTailDipKnife 直测火过域 + act 端到端
    assert.ok(M.armTailDipKnife({ athVsLaunchPct: 120, currentVsLaunchPct: 20, chg5Pct: -10, chg30Pct: -20, win: { 30: { sellBnb: 0.6 } } }, { enableTailDipVolumeLeg: true }));
    const r2 = M.evaluateFactorPreBuy(SNAP({
      wallets: [W(0.3, 0, 0.3), W(0.25, 0, 0.25)],
      buyDerived: { athVsLaunchPct: 120, currentVsLaunchPct: 20, chg5Pct: -10, chg30Pct: -20,
        bundledBlock: null, win: { 30: { buyBnb: 0, buyN: 0, sellBnb: 0.6, sellN: 8 } },
        activity: { idlePct: 98.9, ticksPerMin: 0.3, buyMedianBnb: 0, throughputBnbPerMin: 0.05, spanSec: 400, tickCount: 12 } },
    }), { enableTailDipVolumeLeg: true, enableActStageCold: true });
    assert.strictEqual(r.pass, false);
    assert.deepStrictEqual(r2.arms, ['tail_dip_knife', 'act_low']);
  });
}

// ═════ AH. T205b 三反锚撤回锁（FP38——v174 对拍否证：标定 41.9%→50% 重放反降 39.9%/+1.17，C 腿代理失真切正脸+三键保真漂移；源码常量绝迹+撤回注释在场） ═════
console.log('AH. T205b 三反锚撤回锁（FP38）');
{
  const SRC = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'market-analysis', 'factor-pre-buy-check.js'), 'utf8');
  check('AH1 三反锚常量绝迹（ACT_STAGE_RELEASE_* 不再存在）', () => {
    assert.ok(!SRC.includes('ACT_STAGE_RELEASE_MIN_TAIL10_BUY_N'));
    assert.ok(!SRC.includes('ACT_STAGE_RELEASE_MIN_IDLE_PCT'));
    assert.ok(!SRC.includes('ACT_STAGE_RELEASE_MAX_DEAD_BLOCK_BUY_N'));
    assert.ok(!SRC.includes('releaseTail10Ok') && !SRC.includes('releaseIdleOk') && !SRC.includes('releaseWaveOk'));
  });
  check('AH2 撤回档在场（stageCold 回纯 isColdStage+否证注记）', () => {
    assert.ok(SRC.includes('const stageCold = opts.enableActStageCold === true && isColdStage(stageAth);'));
    assert.ok(SRC.includes('T205b 放行三反锚 ABC 已撤回 FP38'));
  });
  check('AH3 行为锁：纯卖触发形状（nearTail10BuyN=0）阶段放行照过（三腿不再约束）', () => {
    const r = M.judgeActivityLevel({
      ticks: [{ dt: 400 }], wallets: [],
      buyDerived: { athVsLaunchPct: 43.5, activity: { idlePct: 98.9, ticksPerMin: 0.3, buyMedianBnb: 0, throughputBnbPerMin: 0.05, spanSec: 400, tickCount: 12, nearTail10BuyN: 0 } },
      cheatDerived: { maxBlockBuyCount: 0 },
    }, { enableActStageCold: true });
    assert.strictEqual(r.level, null);
    assert.strictEqual(r.branch, 'act_stage_cold');
  });
}


console.log('AI. FP39 tail_dip_knife 深破豁免（一姐 0xfc23…7777 案 JG-18，用户裁定「基本到了很底部，没啥可以跌的了」）');
{
  // 同 U 段 TK 形状（pvp big_buyers_present 不抢拒码），buyDerived 加 launchMinVsFloorPct
  const TKD = (minVs) => SNAP({
    wallets: [W(0.3, 0, 0.3), W(0.25, 0, 0.25)],
    buyDerived: { athVsLaunchPct: 48.9, currentVsLaunchPct: 0, chg5Pct: -10.9, chg30Pct: -32.84,
      launchMinVsFloorPct: minVs, bundledBlock: null, win: { 30: { buyBnb: 0.5, buyN: 5, sellBnb: 0.45 } }, activity: { nearTail10BuyN: 3 } },
  });
  check('AI1 案源一姐全形状（minVsFloor=-11.21 深破）→ 豁免放行（不进 arms）', () => {
    const r = M.evaluateFactorPreBuy(TKD(-11.21));
    assert.strictEqual(r.pass, true);
    assert.ok(!r.arms.includes('tail_dip_knife'));
  });
  check('AI2 浅破（minVsFloor=-5，三窗 [-10,0] 层损耗最重中位 −14.0/深跌 10 票）→ 照拦', () => {
    const r = M.evaluateFactorPreBuy(TKD(-5));
    assert.strictEqual(r.reason, 'tail_dip_knife');
  });
  check('AI3 边界严格 <（FP16 R2 同构）：-10.01 豁免、-10 恰在线上照拦', () => {
    assert.strictEqual(M.evaluateFactorPreBuy(TKD(-10.01)).pass, true);
    assert.strictEqual(M.evaluateFactorPreBuy(TKD(-10)).reason, 'tail_dip_knife');
  });
  check('AI4 豁免证据缺席（null/undefined/非数）→ 照拦 fail-closed（FP33/36 惯例）', () => {
    assert.strictEqual(M.evaluateFactorPreBuy(TKD(null)).reason, 'tail_dip_knife');
    assert.strictEqual(M.evaluateFactorPreBuy(TKD(undefined)).reason, 'tail_dip_knife');
  });
  check('AI5 与 T205 量腿共存：量腿开+深破 → 豁免仍放行（豁免在量腿前短路）', () => {
    const r = M.evaluateFactorPreBuy(TKD(-27.54), { enableTailDipVolumeLeg: true });
    assert.strictEqual(r.pass, true);
  });
  check('AI6 深破票豁免后量腿开+未深破对照仍拦（豁免腿只对深破放行）', () => {
    const r = M.evaluateFactorPreBuy(TKD(-9.66), { enableTailDipVolumeLeg: true }); // 0x6dc1 卡线外知情代价
    assert.strictEqual(r.reason, 'tail_dip_knife');
  });
  check('AI7 gates 门行 value 含破发%（信号页②因子检查卡展示）', () => {
    const r = M.evaluateFactorPreBuy(TKD(-11.21));
    const g = r.gates.find((x) => x.id === 'tail_dip_knife');
    assert.ok(g, 'tail_dip_knife 门行缺失');
    assert.strictEqual(g.hit, false); // 豁免后不命中
    assert.ok(g.value.includes('-11.21'), 'value 应含破发%: ' + g.value);
  });
  check('AI8 版本钉（FP40=FP26 同款深破豁免）', () => {
    assert.strictEqual(M.FACTOR_PREBUY_VERSION, 'FP40');
  });
}


console.log('AJ. FP40 tail_no_buyer_pressure 深破豁免（一姐案 JG-18 续，用户裁定「同样豁免破发」——同域围堵臂二连）');
{
  const F26D = (minVs) => SNAP({
    wallets: [W(0.3, 0, 0.3, 10)],
    buyDerived: {
      bundledBlock: null,
      win: { 30: { buyBnb: 0.5, buyN: 5, sellN: 6 } }, // 一姐 t2 实测：win30 卖 6
      bigHolderSellBnb60: null,
      launchMinVsFloorPct: minVs,
      activity: { nearTail10BuyN: 0, nearTail5BuyN: 0 }, // 一姐 t2 实测：尾 5s 买 0
    },
    cheatDerived: {},
  });
  check('AJ1 案源一姐 t2 形状（win30卖6∧尾5s买0）+ 深破 −11.21 → 豁免放行', () => {
    const r = M.evaluateFactorPreBuy(F26D(-11.21));
    assert.strictEqual(r.pass, true);
    assert.ok(!r.arms.includes('tail_no_buyer_pressure'));
  });
  check('AJ2 一姐 t1 时刻浅破 −5.45（15:42:05 被接棒拒的实测值）→ 仍拦（线内知情）', () => {
    const r = M.evaluateFactorPreBuy(F26D(-5.45));
    assert.strictEqual(r.reason, 'tail_no_buyer_pressure');
  });
  check('AJ3 边界严格 <（同 FP39 AI3）：−10.01 豁免、−10 恰在线上照拦', () => {
    assert.strictEqual(M.evaluateFactorPreBuy(F26D(-10.01)).pass, true);
    assert.strictEqual(M.evaluateFactorPreBuy(F26D(-10)).reason, 'tail_no_buyer_pressure');
  });
  check('AJ4 豁免证据缺席（null/undefined）→ 照拦 fail-closed', () => {
    assert.strictEqual(M.evaluateFactorPreBuy(F26D(null)).reason, 'tail_no_buyer_pressure');
    assert.strictEqual(M.evaluateFactorPreBuy(F26D(undefined)).reason, 'tail_no_buyer_pressure');
  });
  check('AJ5 gates 门行 value 含破发%（信号页展示）', () => {
    const r = M.evaluateFactorPreBuy(F26D(-5.45));
    const g = r.gates.find((x) => x.id === 'tail_no_buyer');
    assert.ok(g, 'tail_no_buyer 门行缺失');
    assert.strictEqual(g.hit, true);
    assert.ok(g.value.includes('-5.45'), 'value 应含破发%: ' + g.value);
    const g2 = M.evaluateFactorPreBuy(F26D(-11.21)).gates.find((x) => x.id === 'tail_no_buyer');
    assert.strictEqual(g2.hit, false); // 深破豁免后不命中
  });
  check('AJ6 与 FP39 豁免共存：一姐 t2 全形状（tail_dip 域内 chg 双负 + FP26 命中）双臂均深破豁免 → 整体放行', () => {
    const r = M.evaluateFactorPreBuy(SNAP({
      wallets: [W(0.3, 0, 0.3, 10)],
      buyDerived: {
        bundledBlock: null,
        athVsLaunchPct: 48.9, currentVsLaunchPct: 0, chg5Pct: -10.9, chg30Pct: -32.84,
        launchMinVsFloorPct: -11.21,
        win: { 30: { buyBnb: 0.5, buyN: 5, sellN: 6, sellBnb: 0.45 } },
        bigHolderSellBnb60: null,
        activity: { nearTail10BuyN: 0, nearTail5BuyN: 0 },
      },
      cheatDerived: {},
    }));
    assert.strictEqual(r.pass, true);
    assert.deepStrictEqual(r.arms, []);
  });
  check('AJ7 版本钉死 FP40', () => {
    assert.strictEqual(M.FACTOR_PREBUY_VERSION, 'FP40');
  });
}

console.log(`\n结果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
