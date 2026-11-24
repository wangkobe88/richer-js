#!/usr/bin/env node
/**
 * T234 famous_conviction_pit 类型三键单测（零 DB 零网络，2026-11-24 用户提案+
 * 裁定「famous/聪明钱强认同健康盘深坑」；案源=躺赢人生 0x2ee9…7777）：
 *   A. FA 臂 A 两键（famousSmartHighBuyBnb/N）：famous∪smart 名单钱包在买入时
 *      curVs（地板锚）≥+40%、单笔 ≥0.02B 的累计额+独立钱包数——全生命周期单调
 *      （「买过」口径），尘/低点/无地板 fail-closed 不计；双段写点每 tick 恰计一次
 *   B. FA 块口径跟单键（famousFollowBlockMaxWallets）：famous 买后**同块**非 famous
 *      买入钱包数全生命周期单调 max（+1 块不计=同块语义）；bn 推进闭合并入 max；
 *      名单空/无 famous 买=0 fail-open
 *   C. point-type-router：0x2ee9 形状命中 famous_conviction_pit（policy 全套豁免
 *      deep-equal）；龄/域/坑深/臂A/跟单/锚买盘六轴负例全走 normal
 */
'use strict';
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FourMemeFactorAggregator = require(path.join(ROOT, 'src/services/FourMemeFactorAggregator.js'));
const {
  POINT_TYPE_VERSION, classifyPointType, assertPointTypesValid,
} = require(path.join(ROOT, 'src/market-analysis/point-type-router.js'));

let passed = 0;
function check(name, fn) { try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exit(1); } }

const T0 = 1700000000000;
function newFA(roster) {
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  if (roster) {
    FourMemeFactorAggregator.setFamousCopyWalletsForTest(new Set(roster.famous || []));
    FourMemeFactorAggregator.setSmartMoneyWalletsForTest(new Set(roster.smart || []));
  }
  return fa;
}
function resetRosters() {
  FourMemeFactorAggregator.setFamousCopyWalletsForTest(null);
  FourMemeFactorAggregator.setSmartMoneyWalletsForTest(null);
}
let tickSeq = 0;
function mkTick(o) {
  return {
    token_address: o.token_address || '0xtoken', trade_type: o.side, trader_address: null, sender_address: o.w,
    price_bnb: o.px ?? 1e-9, price_usd: 5, bnb_amount: o.bnb, token_amount: o.tok ?? 1e8,
    block_number: o.bn ?? Math.floor((o.ts - T0) / 1000), log_index: o.li ?? (tickSeq++),
    timestamp: o.ts, tx_hash: '0xtx' + (tickSeq), price_outlier: !!o.out,
    price_accepted: o.accepted !== false, // 尘行/outlier 行由 collector 定值；默认可靠
  };
}
const PX = 1e-9; // 首可靠价=地板

console.log('A. 臂 A 两键 famousSmartHighBuyBnb/N（famous∪smart 高位买，买时 curVs≥+40%、单笔≥0.02B）');
{
  const fa = newFA({ famous: ['fa', 'fb'], smart: ['sa'] });
  // 地板建立：w0 首笔可靠买 0.1B @PX
  fa.processTick(mkTick({ ts: T0 + 1000, side: 'buy', bnb: 0.1, tok: 1e8, px: PX, w: 'w0' }), {});
  check('A1 名单空→无地板无计数基线 0（famousSmartHighBuyBnb=0/N=0）', () => {
    const f = fa.buildFactorMap('0xtoken', T0 + 1500);
    assert.strictEqual(f.famousSmartHighBuyBnb, 0);
    assert.strictEqual(f.famousSmartHighBuyN, 0);
  });
  fa.processTick(mkTick({ ts: T0 + 2000, side: 'buy', bnb: 0.3, tok: 2e8, px: 1.5e-9, w: 'fa' }), {});   // curVs +50% ✓
  fa.processTick(mkTick({ ts: T0 + 3000, side: 'buy', bnb: 0.2, tok: 1e8, px: 1.6e-9, w: 'sa' }), {});   // curVs +60% ✓ smart 也计（+40% 恰贴线浮点不稳，刻意避开）
  fa.processTick(mkTick({ ts: T0 + 4000, side: 'buy', bnb: 0.019, tok: 1e7, px: 1.5e-9, w: 'fb' }), {}); // 尘 0.019 <0.02 跳过
  fa.processTick(mkTick({ ts: T0 + 5000, side: 'buy', bnb: 0.5, tok: 3e8, px: 1.2e-9, w: 'fb' }), {});   // curVs +20% <40% 跳过
  fa.processTick(mkTick({ ts: T0 + 6000, side: 'sell', bnb: 0.1, tok: 5e7, px: 1.3e-9, w: 'fa' }), {});  // 卖不计
  const f = fa.buildFactorMap('0xtoken', T0 + 6500);
  check('A2 累计 0.5（0.3+0.2）、独立钱包 2（fa+sa；fb 尘/低点两笔全跳过、卖不计）', () => {
    assert.strictEqual(f.famousSmartHighBuyBnb, 0.5);
    assert.strictEqual(f.famousSmartHighBuyN, 2);
  });
  fa.processTick(mkTick({ ts: T0 + 7000, side: 'buy', bnb: 0.05, tok: 4e7, px: 1.5e-9, w: 'fa' }), {}); // +50% 再加 0.05（同钱包 N 不变）
  const f2 = fa.buildFactorMap('0xtoken', T0 + 7500);
  check('A3 单调累计 0.55、N 仍 2（同钱包不重复计）', () => {
    assert.strictEqual(f2.famousSmartHighBuyBnb, 0.55);
    assert.strictEqual(f2.famousSmartHighBuyN, 2);
  });
  check('A4 两键在 getFactorKeys（三防线自动认得）', () => {
    const keys = new Set(fa.getFactorKeys());
    assert.ok(keys.has('famousSmartHighBuyBnb'));
    assert.ok(keys.has('famousSmartHighBuyN'));
    assert.ok(keys.has('famousFollowBlockMaxWallets'));
    assert.ok(keys.has('athVsFloorPct'));
  });
  // T234 六修（用户裁定「athVsLaunchPct 应该跟 currentVsLaunchPct 保持一致，否则
  // 首买入价太高就会允许太高的买入点位——或者换个因子」→ athVsFloorPct 地板口径键）：
  // 分子=可靠价全时峰、分母=T139 地板（min(平台常量, 首买价, 滚动最低)）——首买价
  // 太高时如实放大涨幅（与 athVsLaunchPct 首可靠价锚的分野用 A8 锁定）
  {
    const fa5 = newFA({ famous: [], smart: [] });
    fa5.registerToken('0xflap', { createdAtMs: T0, totalSupply: 1e9, symbol: 'F', creatorAddress: null, platform: 'flap' });
    const { resolveLaunchPriceBnb } = require('../src/market-analysis/launch-price.js');
    const FL = resolveLaunchPriceBnb('flap', null); // 主力档常量 5.546e-9
    // 首买 1e-8（首可靠价=1e-8，高于常量）→ 峰 1.5e-8 → 后续跌到 8e-9（新地板）
    fa5.processTick(mkTick({ token_address: '0xflap', ts: T0 + 1000, side: 'buy', bnb: 0.1, tok: 1e7, px: 1e-8, w: 'w0', bn: 10 }), {});
    fa5.processTick(mkTick({ token_address: '0xflap', ts: T0 + 2000, side: 'buy', bnb: 0.1, tok: 6e6, px: 1.5e-8, w: 'w1', bn: 11 }), {});
    const f6 = fa5.buildFactorMap('0xflap', T0 + 2500);
    check('A8a 地板口径：峰 1.5e-8/地板 5.546e-9 → +170.45（首可靠价口径 athVsLaunchPct 只会 +50）', () => {
      const exp = parseFloat((100 * (1.5e-8 / FL - 1)).toFixed(2));
      assert.strictEqual(f6.athVsFloorPct, exp);
      assert.strictEqual(f6.athVsLaunchPct, 50); // 首可靠价锚 1e-8 → 1.5e-8 = +50（分野锁定）
    });
    // 破发价 4e-9 < FL 常量 5.546e-9 → 滚动最低成为新地板（T139 min 语义：
    // 高于常量的新低不换地板）
    fa5.processTick(mkTick({ token_address: '0xflap', ts: T0 + 3000, side: 'sell', bnb: 0.05, tok: 5e6, px: 4e-9, w: 'w1', bn: 12 }), {});
    const f7 = fa5.buildFactorMap('0xflap', T0 + 3500);
    check('A8b 破发滚动最低 4e-9 成新地板 → +275（地板随新低下修，峰不变；高于常量的新低不动地板）', () => {
      assert.strictEqual(f7.athVsFloorPct, 275);
    });
  }
  // 双段恰一次：defer 路径价格段跳过、wallet 段补跑——恰计一次
  const fa2 = newFA({ famous: ['fa'], smart: [] });
  fa2.processTick(mkTick({ ts: T0 + 1000, side: 'buy', bnb: 0.1, tok: 1e8, px: PX, w: 'w0' }), {});
  const dt = mkTick({ ts: T0 + 2000, side: 'buy', bnb: 0.3, tok: 2e8, px: 1.5e-9, w: 'fa' });
  fa2.processTick(dt, { deferWallet: true }); // 价格段（sender 未知假值→名单钩跳过）
  const f3a = fa2.buildFactorMap('0xtoken', T0 + 2100);
  fa2.applyWalletTick(dt);                    // wallet 段补跑（真 sender）
  const f3b = fa2.buildFactorMap('0xtoken', T0 + 2200);
  check('A5 defer 双段恰计一次（价格段 0 → wallet 段补 0.3，不双计）', () => {
    assert.strictEqual(f3a.famousSmartHighBuyBnb, 0);
    assert.strictEqual(f3b.famousSmartHighBuyBnb, 0.3);
  });
  // 无地板 fail-closed（直接方法调用锁守卫——钩子在可靠价块内、地板恒先行，
  // 守卫只防未来挂点变化/乱序形状）
  const fa3 = newFA({ famous: ['fa'], smart: [] });
  const bare = { _minRelPriceBnb: null, _famousSmartHighBuyBnb: 0, _famousSmartHighBuyWallets: new Set() };
  fa3._noteRosterHighBuy(bare, 'fa', 1.5e-9, 0.3);
  check('A6 无地板 → 不累计 fail-closed 0（守卫锁）', () => {
    assert.strictEqual(bare._famousSmartHighBuyBnb, 0);
    assert.strictEqual(bare._famousSmartHighBuyWallets.size, 0);
  });
  // T234 三修（2026-11-24 用户裁定「臭名昭著钱包就不算在 famous 命中数量中」）：
  // notorious 集合成员的高位买不构成好票背书（a83b 案——famous roster 同框大割）
  const fa4 = newFA({ famous: ['fa', 'fb'], smart: [] });
  FourMemeFactorAggregator.setNotoriousWalletsForTest(new Set(['fa']));
  fa4.processTick(mkTick({ ts: T0 + 1000, side: 'buy', bnb: 0.1, tok: 1e8, px: PX, w: 'w0' }), {});
  fa4.processTick(mkTick({ ts: T0 + 2000, side: 'buy', bnb: 0.3, tok: 2e8, px: 1.5e-9, w: 'fa' }), {});  // fa=notorious → 不计
  fa4.processTick(mkTick({ ts: T0 + 3000, side: 'buy', bnb: 0.3, tok: 2e8, px: 1.5e-9, w: 'fb' }), {});  // fb 正常 → 计 0.3
  const f5 = fa4.buildFactorMap('0xtoken', T0 + 3500);
  check('A7 notorious 钱包高位买不计入臂 A（fa 剔除；fb 0.3 计）', () => {
    assert.strictEqual(f5.famousSmartHighBuyBnb, 0.3);
    assert.strictEqual(f5.famousSmartHighBuyN, 1);
  });
  FourMemeFactorAggregator.setNotoriousWalletsForTest(null);
  resetRosters();
}

console.log('B. 块口径跟单键 famousFollowBlockMaxWallets（同块语义）');
{
  const fa = newFA({ famous: ['fa'] });
  fa.processTick(mkTick({ ts: T0 + 1000, side: 'buy', bnb: 0.1, tok: 1e8, px: PX, w: 'w0' }), {});
  check('B1 无 famous 买 → 0 fail-open', () => {
    const f = fa.buildFactorMap('0xtoken', T0 + 1500);
    assert.strictEqual(f.famousFollowBlockMaxWallets, 0);
  });
  // famous 买 @bn=10：同块 w1/w2 跟随 → 2；+1 块 w3 不计（同块语义）
  fa.processTick(mkTick({ ts: T0 + 2000, side: 'buy', bnb: 0.05, tok: 4e7, px: PX, w: 'fa', bn: 10 }), {});
  fa.processTick(mkTick({ ts: T0 + 2001, side: 'buy', bnb: 0.05, tok: 4e7, px: PX, w: 'w1', bn: 10 }), {});
  fa.processTick(mkTick({ ts: T0 + 2002, side: 'buy', bnb: 0.05, tok: 4e7, px: PX, w: 'w2', bn: 10 }), {});
  fa.processTick(mkTick({ ts: T0 + 2003, side: 'sell', bnb: 0.05, tok: 4e7, px: PX, w: 'w2', bn: 10 }), {}); // 卖不进
  fa.processTick(mkTick({ ts: T0 + 2004, side: 'buy', bnb: 0.05, tok: 4e7, px: PX, w: 'w3', bn: 11 }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 2500);
  check('B2 同块 2 计入（w1/w2）、+1 块 w3 不计、卖行不计 → max=2', () => {
    assert.strictEqual(f.famousFollowBlockMaxWallets, 2);
  });
  // 同块后续 famous 买之间不互相计（famous-famous 排除）
  fa.processTick(mkTick({ ts: T0 + 3000, side: 'buy', bnb: 0.05, tok: 4e7, px: PX, w: 'fa', bn: 20 }), {});
  fa.processTick(mkTick({ ts: T0 + 3001, side: 'buy', bnb: 0.05, tok: 4e7, px: PX, w: 'w4', bn: 20 }), {});
  fa.processTick(mkTick({ ts: T0 + 3002, side: 'buy', bnb: 0.05, tok: 4e7, px: PX, w: 'w5', bn: 20 }), {});
  fa.processTick(mkTick({ ts: T0 + 3003, side: 'buy', bnb: 0.05, tok: 4e7, px: PX, w: 'w6', bn: 20 }), {});
  const f2 = fa.buildFactorMap('0xtoken', T0 + 3500);
  check('B3 第二锚同块 3 → 单调 max 2→3', () => {
    assert.strictEqual(f2.famousFollowBlockMaxWallets, 3);
  });
  // bn 推进闭合后 max 保持（活跃锚读点：闭合并入 max）
  fa.processTick(mkTick({ ts: T0 + 4000, side: 'buy', bnb: 0.05, tok: 4e7, px: PX, w: 'w9', bn: 99 }), {});
  const f3 = fa.buildFactorMap('0xtoken', T0 + 4500);
  check('B4 bn 大幅推进闭合并入后 max 仍 3（污点不洗）', () => {
    assert.strictEqual(f3.famousFollowBlockMaxWallets, 3);
  });
  resetRosters();
  const fa4 = newFA(null);
  fa4.processTick(mkTick({ ts: T0 + 1000, side: 'buy', bnb: 0.1, tok: 1e8, px: PX, w: 'w0' }), {});
  const f4 = fa4.buildFactorMap('0xtoken', T0 + 1500);
  check('B5 名单未启用（null）→ 键恒 0 fail-open', () => {
    assert.strictEqual(f4.famousFollowBlockMaxWallets, 0);
  });
}

console.log('C. point-type-router 类型 famous_conviction_pit');
{
  const PIT = {
    tokenAgeSec: 63, mcapFromPeakPct: 59.9, currentVsLaunchPct: 28.2, earlyReturn: 28.2,
    athVsFloorPct: 114.8, // T234 六修 ath 上限地板口径键（0x2ee9 fire 地板口径 114.8 ≤140 ✓）
    famousSmartHighBuyBnb: 1.335, famousSmartHighBuyN: 5, famousFollowBlockMaxWallets: 3,
    anchorTickIsBuy: 1, anchor15sMaxBuyBnb: 0.025,
  };
  check('C1 0x2ee9 形状命中（policy 全豁观察版 deep-equal；version=POINT_TYPE_VERSION）', () => {
    const r = classifyPointType(PIT);
    assert.strictEqual(r.type, 'famous_conviction_pit');
    assert.deepStrictEqual(r.policy, {
      // T234 定稿（用户裁定「全豁+stuffingOnly」）：FP 整门直通/AF1 直通/cheat 16 题
      // 跳过/BP 只评塞单门（BP67 明裁机械防线零成本兜底）
      factorCheckArms: 'skip',
      actFront: 'pass',
      cheatCheck: 'skip',
      buyPoint: 'stuffingOnly',
    });
    assert.strictEqual(r.version, POINT_TYPE_VERSION);
    for (const k of ['tokenAgeSec', 'mcapFromPeakPct', 'currentVsLaunchPct', 'earlyReturn',
      'athVsFloorPct', 'famousSmartHighBuyBnb', 'famousSmartHighBuyN', 'famousFollowBlockMaxWallets',
      'anchorTickIsBuy', 'anchor15sMaxBuyBnb']) {
      assert.ok(k in r.snapshot, `snapshot 缺 ${k}`);
    }
  });
  check('C1b T234 九修 ath 上限地板口径负例：athVsFloorPct 151 >150 → normal（大热残局切——永生 186 形状）', () => {
    assert.strictEqual(classifyPointType({ ...PIT, athVsFloorPct: 151 }).type, 'normal');
  });
  check('C1c T234 九修 ath 上限地板口径正例：athVsFloorPct 137.6 ≤150 → 命中（0x28ea 地板口径案源）', () => {
    assert.strictEqual(classifyPointType({ ...PIT, athVsFloorPct: 137.6 }).type, 'famous_conviction_pit');
  });
  check('C1d T234 九修 ath 上限地板口径负例：athVsFloorPct 198.6 >150 → normal（CZCOIN 被切=知情代价，用户裁定「保守一点」）', () => {
    assert.strictEqual(classifyPointType({ ...PIT, athVsFloorPct: 198.6 }).type, 'normal');
  });
  check('C2 龄 59 <60 → normal', () => {
    assert.strictEqual(classifyPointType({ ...PIT, tokenAgeSec: 59 }).type, 'normal');
  });
  check('C2b T234 七修龄上界负例：tokenAgeSec 901 >900 → normal（偏前期语义——15 分钟内）', () => {
    assert.strictEqual(classifyPointType({ ...PIT, tokenAgeSec: 901 }).type, 'normal');
  });
  check('C2c T234 七修龄上界正例：tokenAgeSec 899 ≤900 → 命中', () => {
    assert.strictEqual(classifyPointType({ ...PIT, tokenAgeSec: 899 }).type, 'famous_conviction_pit');
  });
  check('C3 坑不够深（mcapFromPeak 63 >62）→ normal', () => {
    assert.strictEqual(classifyPointType({ ...PIT, mcapFromPeakPct: 63 }).type, 'normal');
  });
  check('C4 域帽破（curVs 34 >33.5，earlyReturn 34 ≥15）→ normal', () => {
    assert.strictEqual(classifyPointType({ ...PIT, currentVsLaunchPct: 34, earlyReturn: 34 }).type, 'normal');
  });
  check('C4b 域内 earlyReturn OR 臂（curVs 30 >28.5 但 earlyReturn 8 <15）→ 命中', () => {
    assert.strictEqual(classifyPointType({ ...PIT, currentVsLaunchPct: 30, earlyReturn: 8 }).type, 'famous_conviction_pit');
  });
  check('C5 臂 A 金额 0.49 <0.5 → normal', () => {
    assert.strictEqual(classifyPointType({ ...PIT, famousSmartHighBuyBnb: 0.49 }).type, 'normal');
  });
  check('C6 臂 A 钱包 2 <3 → normal', () => {
    assert.strictEqual(classifyPointType({ ...PIT, famousSmartHighBuyN: 2 }).type, 'normal');
  });
  check('C7 同块跟单 9 >8 → normal（宽松形状门）', () => {
    assert.strictEqual(classifyPointType({ ...PIT, famousFollowBlockMaxWallets: 9 }).type, 'normal');
  });
  check('C8 无锚买盘（非买锚 ∧ 15s 买 0.02 <0.03）→ normal', () => {
    assert.strictEqual(classifyPointType({ ...PIT, anchorTickIsBuy: 0, anchor15sMaxBuyBnb: 0.02 }).type, 'normal');
  });
  check('C9 assertPointTypesValid 用 FA 真键集全过（新键三防线自动认得）', () => {
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    assertPointTypesValid(fa.getFactorKeys());
  });
}

console.log(`\n全部通过 ${passed} 断言`);
