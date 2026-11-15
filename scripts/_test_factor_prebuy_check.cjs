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

console.log('A. 在场三分（BP79）');
{
  check('A1 净 ≤0.005=离场', () => assert.strictEqual(M.classifyWallet(W(0.3, 0.3, 0.3, 10), TEND), '离场'));
  check('A2 净 >0.005 ∧ 末动 ≤120s=活跃在场', () => assert.strictEqual(M.classifyWallet(W(0.3, 0.1, 0.3, 100), TEND), '活跃在场'));
  check('A3 净 >0.005 ∧ 末动 >120s=挂账在场', () => assert.strictEqual(M.classifyWallet(W(0.3, 0.1, 0.3, 200), TEND), '挂账在场'));
  check('A4 末动不可算=挂账（宁拦方向）', () => assert.strictEqual(M.classifyWallet(W(0.3, 0, 0.3, null), TEND), '挂账在场'));
}

console.log('B. PVP 判定树');
{
  check('B1 无大户参与（零 0.2 级单）→ 拒 pvp_no_big_participation', () => {
    const r = M.judgeRetailPvp(SNAP({ wallets: [W(0.1, 0, 0.1, 10), W(0.08, 0, 0.08, 10)] }), TEND);
    assert.strictEqual(r.hit, 1); assert.strictEqual(r.reason, 'pvp_no_big_participation');
    assert.strictEqual(r.branch, 'pvp_a_no_participation'); // 无量在场=②(a) 形状
  });
  check('B2 灰区单不救（三笔累计 0.23 单笔 0.1x=不算 0.2 级，BP55）', () => {
    const r = M.judgeRetailPvp(SNAP({ wallets: [W(0.23, 0, 0.11, 10)] }), TEND);
    assert.strictEqual(r.hit, 1); assert.strictEqual(r.reason, 'pvp_no_big_participation');
  });
  check('B3 单笔 0.2994（≥0.29 视同 0.3）活跃在场 → act30≥1 参与满足', () => {
    const r = M.judgeRetailPvp(SNAP({ wallets: [W(0.2994, 0.1, 0.2994, 100)] }), TEND);
    assert.strictEqual(r.trace.act30, 1);
  });
  check('B4 0.29 边界：0.29 恰过 / 0.2899 不过', () => {
    assert.strictEqual(M.judgeRetailPvp(SNAP({ wallets: [W(0.29, 0, 0.29, 100)] }), TEND).trace.act30, 1);
    assert.strictEqual(M.judgeRetailPvp(SNAP({ wallets: [W(0.2899, 0, 0.2899, 100)] }), TEND).trace.act30, 0);
  });
  check('B5 挂账/离场 0.3+ 也算买入过（BP84 追裁定：不要求在场）→ participation 满足', () => {
    const r = M.judgeRetailPvp(SNAP({ wallets: [W(0.3, 0, 0.3, 200)] }), TEND);
    assert.strictEqual(r.trace.act30, 1); assert.strictEqual(r.trace.act30Active, 0);
    assert.notStrictEqual(r.reason, 'pvp_no_big_participation');
  });
  check('B6 两个 0.2 级（≥0.19）活跃在场 → participation 满足不落②', () => {
    const r = M.judgeRetailPvp(SNAP({ wallets: [W(0.2, 0, 0.2, 50), W(0.19, 0, 0.19, 100)] }), TEND);
    assert.strictEqual(r.trace.act20, 2); assert.strictEqual(r.hit, 0);
  });
  check('B7 同块捆绑合计 >0.3（严格大于）→ 量在场', () => {
    const s = SNAP({ wallets: [], buyDerived: { bundledBlock: { buyBnb: 0.31 }, win: { 30: { buyBnb: 0.5, buyN: 5 } }, bigHolderSellBnb60: null, activity: {} } });
    assert.strictEqual(M.judgeRetailPvp(s, TEND).trace.volBundledBnb, 0.31);
    const s2 = SNAP({ wallets: [], buyDerived: { bundledBlock: { buyBnb: 0.3 }, win: { 30: { buyBnb: 0.5, buyN: 5 } }, bigHolderSellBnb60: null, activity: {} } });
    const r2 = M.judgeRetailPvp(s2, TEND);
    assert.strictEqual(r2.trace.volSingle, 0); assert.strictEqual(r2.reason, 'pvp_no_big_participation');
  });
  // 承接轴
  const bigActive = W(0.2994, 0.1, 0.2994, 100); // 参与满足基座（在场持有+未卖）
  check('B8 承接轴① 大户持续卖+承接在场 → 放行', () => {
    const r = M.judgeRetailPvp(SNAP({ wallets: [bigActive],
      buyDerived: { bigHolderSellBnb60: 0.2, win: { 30: { buyBnb: 0.5, buyN: 5 } }, activity: {} } }), TEND);
    assert.strictEqual(r.hit, 0); assert.strictEqual(r.branch, 'big_selling_absorbed');
  });
  check('B9 承接轴① 大户持续卖+承接不在场（win30 买 1 笔 0.02）→ 拒 pvp_absorption_dust', () => {
    const r = M.judgeRetailPvp(SNAP({ wallets: [bigActive],
      buyDerived: { bigHolderSellBnb60: 0.2, win: { 30: { buyBnb: 0.02, buyN: 1 } }, activity: { nearTail10BuyN: 0 } } }), TEND);
    assert.strictEqual(r.hit, 1); assert.strictEqual(r.reason, 'pvp_absorption_dust');
  });
  check('B10 卖完离场+散户尘埃承接（买入过即参与）→ 承接轴落 pvp_zero_absorption', () => {
    const exited = W(0.2994, 0.2994, 0.2994, 100); // 卖完净≈0——买入过=参与满足（BP84 追裁定）
    const r = M.judgeRetailPvp(SNAP({ wallets: [exited],
      buyDerived: { bundledBlock: { buyBnb: 0.4 }, bigHolderSellBnb60: 0, win: { 30: { buyBnb: 0.02, buyN: 1 } }, activity: { nearTail10BuyN: 0 } } }), TEND);
    assert.strictEqual(r.hit, 1);
    assert.strictEqual(r.reason, 'pvp_zero_absorption'); // sell60 归零+承接尘埃=②(b) 死盘语义
  });
  check('B11 承接轴③ 在场持有未卖+承接归零（win30 ≤0.03 ∧ 尾10s ≤1 笔）→ 拒 pvp_zero_absorption', () => {
    const r = M.judgeRetailPvp(SNAP({ wallets: [bigActive],
      buyDerived: { bigHolderSellBnb60: 0, win: { 30: { buyBnb: 0.02, buyN: 1 } }, activity: { nearTail10BuyN: 1 } } }), TEND);
    assert.strictEqual(r.hit, 1); assert.strictEqual(r.reason, 'pvp_zero_absorption');
  });
  check('B12 承接轴③ 在场持有未卖+承接在场 → 放行 holding_absorbed', () => {
    const r = M.judgeRetailPvp(SNAP({ wallets: [bigActive],
      buyDerived: { bigHolderSellBnb60: 0, win: { 30: { buyBnb: 0.5, buyN: 5 } }, activity: {} } }), TEND);
    assert.strictEqual(r.hit, 0); assert.strictEqual(r.branch, 'holding_absorbed');
  });
  check('B13 sell60 null（quote 盘锚缺）：双证据（持有+承接归零）才拒，否则放行', () => {
    const r1 = M.judgeRetailPvp(SNAP({ wallets: [bigActive],
      buyDerived: { bigHolderSellBnb60: null, win: { 30: { buyBnb: 0.02, buyN: 1 } }, activity: { nearTail10BuyN: 0 } } }), TEND);
    assert.strictEqual(r1.hit, 1); assert.strictEqual(r1.reason, 'pvp_zero_absorption');
    const r2 = M.judgeRetailPvp(SNAP({ wallets: [bigActive],
      buyDerived: { bigHolderSellBnb60: null, win: { 30: { buyBnb: 0.02, buyN: 1 } }, activity: { nearTail10BuyN: 3 } } }), TEND);
    assert.strictEqual(r2.hit, 0); assert.strictEqual(r2.branch, 'sell_anchor_null');
  });
  check('B14 量在场只杀 (a) 标签不救 participation（branch= pvp_b_no_participation）', () => {
    const s = SNAP({ wallets: [], buyDerived: { bundledBlock: { buyBnb: 0.4 }, win: { 30: { buyBnb: 0.02, buyN: 0 } }, bigHolderSellBnb60: null, activity: {} } });
    const r = M.judgeRetailPvp(s, TEND);
    assert.strictEqual(r.reason, 'pvp_no_big_participation');
    assert.strictEqual(r.branch, 'pvp_b_no_participation');
  });
}

console.log('C. duanju 0x65aebe91…7777 反证夹具（0.2994 首买+部分兑现 57% 后买点）');
{
  // 现场形状：0x5ba6b91a 买 0.2994（00:57:31）卖 0.1692（01:03:19，距买点 39s=活跃）
  // → 净 0.1302>0.005 在场持有；volSingle=1；act30=1 → 参与满足 → 承接轴③
  // buyDerived.win30 买点秒三笔 0.3175/5 笔 → 承接在场 → 放行
  const duanju = SNAP({
    wallets: [W(0.2994, 0.1692, 0.2994, 39)], // 末动距锚末 39s=活跃在场
    buyDerived: { bundledBlock: null, bigHolderSellBnb60: 0, activity: { nearTail10BuyN: 3 },
      win: { 30: { buyBnb: 0.3175, buyN: 3 } } },
  });
  const r = M.judgeRetailPvp(duanju, TEND);
  check('C1 0.2994≥0.29 在场持有 → volSingle=1（量在场，(a) 臂死）', () =>
    assert.strictEqual(r.trace.volSingle, 1));
  check('C2 act30=1（活跃在场）→ 参与满足不落 PVP', () => {
    assert.strictEqual(r.trace.act30, 1); assert.strictEqual(r.hit, 0);
  });
  check('C3 终局放行（无论走③承接在场或①分支）', () =>
    assert.strictEqual(r.reason, null));
  // 同形状若买点后无承接（承接归零）→ 落 pvp_zero_absorption（对倒停摆死盘语义）
  const dead = SNAP({
    wallets: [W(0.2994, 0.1692, 0.2994, 39)],
    buyDerived: { bundledBlock: null, bigHolderSellBnb60: 0, activity: { nearTail10BuyN: 0 },
      win: { 30: { buyBnb: 0.01, buyN: 1 } } },
  });
  check('C4 同形状买方归零 → 拒 pvp_zero_absorption（死盘语义保持）', () =>
    assert.strictEqual(M.judgeRetailPvp(dead, TEND).reason, 'pvp_zero_absorption'));
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
  // CD401 代理线逐腿（基座=卖压两线达标）
  const cd401Base = { burstWaveSegSellPct: 35, burstWaveSegSellBnb: 0.5, burstSecSinceWaveEnd: 10, burstWaveWalletMedianBnb: 0.02, burstWaveWalletNetBnb: 0.5 };
  check('D5 CD401 代理全腿命中 → true', () =>
    assert.strictEqual(M.armBurstExitSellPressure(cd(cd401Base)), true));
  check('D6 CD401 波远离锚（>60s 历史遗迹）→ 不拦', () =>
    assert.strictEqual(M.armBurstExitSellPressure(cd({ ...cd401Base, burstSecSinceWaveEnd: 120 })), false));
  check('D7 CD401 波钱包中位非尘埃（≥0.05 大户波）→ 不拦', () =>
    assert.strictEqual(M.armBurstExitSellPressure(cd({ ...cd401Base, burstWaveWalletMedianBnb: 0.2 })), false));
  check('D8 CD401 波净流出（≤0 卖出引发）→ 不拦', () =>
    assert.strictEqual(M.armBurstExitSellPressure(cd({ ...cd401Base, burstWaveWalletNetBnb: -0.1 })), false));
  check('D9 CD401 无段（SellPct null）→ 不拦（拒方向证据缺席）', () =>
    assert.strictEqual(M.armBurstExitSellPressure(cd({})), false));
  check('D10 CD405 命中：单块 7 钱包 / 相邻两 slot 合计 7', () => {
    assert.strictEqual(M.armBurstBundledWave(cd({ burstWaveBundleMaxWallets: 7 })), true);
    assert.strictEqual(M.armBurstBundledWave(cd({ burstWaveBundleAdjPairSum: 8 })), true);
  });
  check('D11 CD405 不命中：6 钱包（TukTuk 门外先例）', () =>
    assert.strictEqual(M.armBurstBundledWave(cd({ burstWaveBundleMaxWallets: 6, burstWaveBundleAdjPairSum: 5 })), false));
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
