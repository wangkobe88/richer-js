#!/usr/bin/env node
/**
 * T237 famous_participation_pit 类型+FA 键单测（零 DB 零网络，2026-11-25 用户裁定
 * 「增加这个新的 pointType」；案源=来财 0xc84a…7777）：
 *   A. FA 键 famousLifetimeBuyBnb：famous 名单全史累计买入额（不判价不判尘、
 *      「参与过」口径单调累计不随卖出回退；双段写点每 tick 恰计一次；
 *      名单未启用/空/无命中=0 fail-open）
 *   B. point-type-router：来财 30s 形状命中 famous_participation_pit（policy 全豁+
 *      stuffingOnly deep-equal）；未参与/域外/超涨/锚门缺失四轴负例+famous 在场正例（PT38）全
 *      走 normal（famousLifetimeBuyBnb ≥0.5 自身防从未参与票（PT38 起无离场要求
 *      
 *   C. assertPointTypesValid 用 FA 真键集全过（新键三防线自动认得）
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
  }
  return fa;
}
function resetRosters() {
  FourMemeFactorAggregator.setFamousCopyWalletsForTest(null);
}
let tickSeq = 0;
function mkTick(o) {
  return {
    token_address: o.token_address || '0xtoken', trade_type: o.side, trader_address: null, sender_address: o.w,
    price_bnb: o.px ?? 1e-9, price_usd: 5, bnb_amount: o.bnb, token_amount: o.tok ?? 1e8,
    block_number: o.bn ?? Math.floor((o.ts - T0) / 1000), log_index: o.li ?? (tickSeq++),
    timestamp: o.ts, tx_hash: '0xtx' + (tickSeq), price_outlier: !!o.out,
    price_accepted: o.accepted !== false,
  };
}
const PX = 1e-9;

console.log('A. FA 键 famousLifetimeBuyBnb（famous 名单全史累计买入额，0 语义）');
{
  const fa = newFA({ famous: ['fa', 'fb'] });
  check('A1 名单启用但无命中 → 0（0 语义基线）', () => {
    const f = fa.buildFactorMap('0xtoken', T0 + 500);
    assert.strictEqual(f.famousLifetimeBuyBnb, 0);
  });
  // 任意价任意额都计（不判价不判尘——低价参与即证据；0.5 线在类型 condition）
  fa.processTick(mkTick({ ts: T0 + 1000, side: 'buy', bnb: 0.3, tok: 2e8, px: PX, w: 'fa' }), {});
  fa.processTick(mkTick({ ts: T0 + 2000, side: 'buy', bnb: 0.2, tok: 1e8, px: 1.5e-9, w: 'fa' }), {});
  fa.processTick(mkTick({ ts: T0 + 3000, side: 'buy', bnb: 0.005, tok: 5e6, px: 1e-9, w: 'fb' }), {}); // 小额也计（不剔尘）
  fa.processTick(mkTick({ ts: T0 + 4000, side: 'sell', bnb: 0.4, tok: 3e8, px: 1.2e-9, w: 'fa' }), {}); // 卖不减
  fa.processTick(mkTick({ ts: T0 + 5000, side: 'buy', bnb: 0.1, tok: 5e7, px: 1.1e-9, w: 'w0' }), {}); // 名单外不计
  const f = fa.buildFactorMap('0xtoken', T0 + 5500);
  check('A2 累计 0.505（0.3+0.2+0.005；卖不减、名单外不计）', () => {
    assert.strictEqual(f.famousLifetimeBuyBnb, 0.505);
  });
  check('A2b PT39 参与钱包数 N=2（fa/fb 独立地址；卖不减、名单外不计、同址重复买不重复计）', () => {
    assert.strictEqual(f.famousLifetimeBuyN, 2);
  });
  check('A2c PT43 smart 参与钱包数：smart 名单成员买入计数（独立地址；卖不减；非名单不计）', () => {
    const fa4 = newFA({ famous: ['fa'], smart: ['sa', 'sb'] });
    FourMemeFactorAggregator.setSmartMoneyWalletsForTest(new Set(['sa', 'sb']));
    fa4.processTick(mkTick({ ts: T0 + 1000, side: 'buy', bnb: 0.1, tok: 1e8, px: PX, w: 'sa' }), {});
    fa4.processTick(mkTick({ ts: T0 + 2000, side: 'buy', bnb: 0.1, tok: 1e8, px: PX, w: 'sb' }), {});
    fa4.processTick(mkTick({ ts: T0 + 3000, side: 'sell', bnb: 0.1, tok: 1e8, px: PX, w: 'sa' }), {});
    fa4.processTick(mkTick({ ts: T0 + 4000, side: 'buy', bnb: 0.1, tok: 1e8, px: PX, w: 'w0' }), {});
    const f4 = fa4.buildFactorMap('0xtoken', T0 + 4500);
    assert.strictEqual(f4.smartLifetimeBuyN, 2);
    resetRosters();
  });
  // 双段恰一次：defer 路径价格段跳过、wallet 段补跑
  const fa2 = newFA({ famous: ['fa'] });
  const dt = mkTick({ ts: T0 + 1000, side: 'buy', bnb: 0.3, tok: 2e8, px: PX, w: 'fa' });
  fa2.processTick(dt, { deferWallet: true });
  const f2a = fa2.buildFactorMap('0xtoken', T0 + 1100);
  fa2.applyWalletTick(dt);
  const f2b = fa2.buildFactorMap('0xtoken', T0 + 1200);
  check('A3 defer 双段恰计一次（价格段 0 → wallet 段补 0.3，不双计）', () => {
    assert.strictEqual(f2a.famousLifetimeBuyBnb, 0);
    assert.strictEqual(f2b.famousLifetimeBuyBnb, 0.3);
  });
  // 名单未启用 → 恒 0 fail-open（先重置模块级名单，避免受前段 setter 污染——
  // setter 是模块级静态状态，测试间必须显式复位）
  resetRosters();
  const fa3 = newFA(null);
  fa3.processTick(mkTick({ ts: T0 + 1000, side: 'buy', bnb: 0.3, tok: 2e8, px: PX, w: 'fa' }), {});
  const f3 = fa3.buildFactorMap('0xtoken', T0 + 1500);
  check('A4 名单未启用（null）→ 恒 0 fail-open', () => {
    assert.strictEqual(f3.famousLifetimeBuyBnb, 0);
  });
  check('A5 键在 getFactorKeys（三防线自动认得）', () => {
    assert.ok(new Set(fa.getFactorKeys()).has('famousLifetimeBuyBnb'));
    assert.ok(new Set(fa.getFactorKeys()).has('famousLifetimeBuyN'));
  });
  resetRosters();
}

console.log('B. point-type-router 类型 famous_participation_pit');
{
  // 来财 30s 形状（设计探针实测值）：famous 1s 买 2.4B 后 4~16s 卖光（circPct=0）、
  // curVs=23.07、athVsFloor=148.79（贴 150 线）、mcapFromPeak=50.53、锚买盘=1
  const PIT = {
    tokenAgeSec: 30, athVsFloorPct: 148.79, mcapFromPeakPct: 50.53,
    currentVsLaunchPct: 23.07, earlyReturn: 5.55,
    famousLifetimeBuyBnb: 2.4, famousLifetimeBuyN: 3, famousCopyWalletCircPct: 0,
    buyVolumeBnb: 7.07,
    famousFollowBlockMaxWallets: 2,
    anchorTickIsBuy: 1, anchor15sMaxBuyBnb: 0.111,
  };
  check('B1 来财 30s 形状命中（policy 全豁+stuffingOnly deep-equal；version=POINT_TYPE_VERSION）', () => {
    const r = classifyPointType(PIT);
    assert.strictEqual(r.type, 'famous_participation_pit');
    assert.strictEqual(r.version, POINT_TYPE_VERSION);
    assert.deepStrictEqual(r.policy, {
      factorCheckArms: 'skip', actFront: 'pass', cheatCheck: 'skip', buyPoint: 'stuffingOnly',
    });
    assert.ok(r.snapshot && r.snapshot.famousLifetimeBuyBnb === 2.4);
  });
  check('B2 从未参与（famousLifetimeBuyBnb=0 ∧ circPct=0）→ 不命中（痕迹门自身防误放行）', () => {
    const r = classifyPointType({ ...PIT, famousLifetimeBuyBnb: 0 });
    assert.notStrictEqual(r.type, 'famous_participation_pit');
  });
  check('B3 famous 在场持有（circPct=7.8）→ 命中（PT38 二修「famous 持有并不是坏事」——离场门已删，在场=背书两可）', () => {
    const r = classifyPointType({ ...PIT, famousCopyWalletCircPct: 7.8 });
    assert.strictEqual(r.type, 'famous_participation_pit');
  });
  check('B4 参与额不足（0.4 <0.5）→ 不命中', () => {
    const r = classifyPointType({ ...PIT, famousLifetimeBuyBnb: 0.4 });
    assert.notStrictEqual(r.type, 'famous_participation_pit');
  });
  check('B5 域外（curVs=36 ∧ earlyReturn=36 双尺全挂）→ 不命中', () => {
    const r = classifyPointType({ ...PIT, currentVsLaunchPct: 36, earlyReturn: 36 });
    assert.notStrictEqual(r.type, 'famous_participation_pit');
  });
  check('B6 ath 190.65 命中（PT40 抬线 200——ChillGuy 案「高度不算高」）', () => {
    const r = classifyPointType({ ...PIT, athVsFloorPct: 190.65 });
    assert.strictEqual(r.type, 'famous_participation_pit');
  });
  check('B6b ath 357 不命中（超汪汪队 39s「开盘暴涨」案仍拦）', () => {
    const r = classifyPointType({ ...PIT, athVsFloorPct: 357 });
    assert.notStrictEqual(r.type, 'famous_participation_pit');
  });
  check('B7 龄上界外（301 >300，PT44 尾气门）→ 不命中', () => {
    const r = classifyPointType({ ...PIT, tokenAgeSec: 301 });
    assert.notStrictEqual(r.type, 'famous_participation_pit');
  });
  check('B8 锚买盘门缺失（非买锚 ∧ 15s 买 0.02 <0.03 ∧ famous N<5）→ 不命中（反弹确认）', () => {
    const r = classifyPointType({ ...PIT, anchorTickIsBuy: 0, anchor15sMaxBuyBnb: 0.02, famousLifetimeBuyN: 3 });
    assert.notStrictEqual(r.type, 'famous_participation_pit');
  });
  check('B8b PT39 豁免臂：famous 参与众 N=5 时锚门豁免（非买锚 ∧ 15s 买 0 → 命中；彪弟 86s 死寂点案）', () => {
    const r = classifyPointType({ ...PIT, anchorTickIsBuy: 0, anchor15sMaxBuyBnb: 0, famousLifetimeBuyN: 5 });
    assert.strictEqual(r.type, 'famous_participation_pit');
  });
  check('B8c PT39 豁免臂：N=4 不豁免（线 5 严格；ChillGuy 4 F 钱包仍挂锚门或 ath 线）', () => {
    const r = classifyPointType({ ...PIT, anchorTickIsBuy: 0, anchor15sMaxBuyBnb: 0, famousLifetimeBuyN: 4 });
    assert.notStrictEqual(r.type, 'famous_participation_pit');
  });
  check('B8d PT41 参与钱包数下界：N=2 <3 → 不命中（famous 参与数必要条件——小狗山 24s 点案，召回点推迟到 31s N=3）', () => {
    const r = classifyPointType({ ...PIT, famousLifetimeBuyN: 2 });
    assert.notStrictEqual(r.type, 'famous_participation_pit');
  });
  check('B8e PT41 N=3 恰过下界（ChillGuy 3 F 钱包买入案）', () => {
    const r = classifyPointType({ ...PIT, famousLifetimeBuyN: 3 });
    assert.strictEqual(r.type, 'famous_participation_pit');
  });
  check('B8f PT43 N=2 ∧ smart N≥3 → 命中（小狗山 24s 案：famous 2 钱包+smart 3 钱包）', () => {
    const r = classifyPointType({ ...PIT, famousLifetimeBuyN: 2, smartLifetimeBuyN: 3 });
    assert.strictEqual(r.type, 'famous_participation_pit');
  });
  check('B8g PT43 N=2 ∧ smart N=2 → 不命中（smart 不足 3 不豁免）', () => {
    const r = classifyPointType({ ...PIT, famousLifetimeBuyN: 2, smartLifetimeBuyN: 2 });
    assert.notStrictEqual(r.type, 'famous_participation_pit');
  });
  check('B8h PT43 famous N=1 ∧ smart N≥3 → 不命中（豁免臂仅 N=2；用户未裁定 N=1）', () => {
    const r = classifyPointType({ ...PIT, famousLifetimeBuyN: 1, smartLifetimeBuyN: 5 });
    assert.notStrictEqual(r.type, 'famous_participation_pit');
  });
  check('B8i PT44 买量下界：buyVolumeBnb=2.42 <3 → 不命中（PinkCare 死盘案）', () => {
    const r = classifyPointType({ ...PIT, buyVolumeBnb: 2.42 });
    assert.notStrictEqual(r.type, 'famous_participation_pit');
  });
  check('B8j PT44 buyVolumeBnb=3 恰过下界', () => {
    const r = classifyPointType({ ...PIT, buyVolumeBnb: 3 });
    assert.strictEqual(r.type, 'famous_participation_pit');
  });
  check('B9 跟单拥挤（同块 9 >8）→ 不命中', () => {
    const r = classifyPointType({ ...PIT, famousFollowBlockMaxWallets: 9 });
    assert.notStrictEqual(r.type, 'famous_participation_pit');
  });
  check('B10 域内无坑（mcapFromPeak=70 >62）→ 不命中', () => {
    const r = classifyPointType({ ...PIT, mcapFromPeakPct: 70 });
    assert.notStrictEqual(r.type, 'famous_participation_pit');
  });
  check('B11 龄 24 命中（PT40 下界 20——小狗山 24s 点案）', () => {
    const r = classifyPointType({ ...PIT, tokenAgeSec: 24 });
    assert.strictEqual(r.type, 'famous_participation_pit');
  });
  check('B11b 龄 19 <20 → 不命中（15s 抢速门基线不碰）', () => {
    const r = classifyPointType({ ...PIT, tokenAgeSec: 19 });
    assert.notStrictEqual(r.type, 'famous_participation_pit');
  });
}

console.log('C. 注册表与启动防线');
{
  check('C1 active:true 已激活（2026-11-25 用户裁定正式增加）', () => {
    const { POINT_TYPES } = require(path.join(ROOT, 'src/market-analysis/point-type-router.js'));
    const t = POINT_TYPES.find(x => x.id === 'famous_participation_pit');
    assert.ok(t, '类型已注册');
    assert.strictEqual(t.active, true);
    assert.ok(t.label && t.label.length > 0);
  });
  check('C2 assertPointTypesValid 用 FA 真键集全过（新键三防线自动认得）', () => {
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    assertPointTypesValid(fa.getFactorKeys());
  });
}

console.log(`\n全部通过 ${passed} 断言`);
