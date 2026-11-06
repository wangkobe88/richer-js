#!/usr/bin/env node
/**
 * 买入点位分析纯函数单测（BP1→BP3 已扩）——零 DB 零网络
 *
 * 覆盖：buy-point-snapshot（buildBuyPointSnapshot/computeBuyPointDerived——A/B/C 组
 * 手算精确值，BP2 增市值位置/holder 流向两族）+ buy-point-state-builder（D 组分区/
 * 截断/超帽+两新行渲染）+ buy-point-result-mapper（E 组容错双轨/纯透传反证+BP2 五锚
 * +BP3 类别题透传）+ llm/buy-point-questions.mjs（F 组形状与桶域对锁+BP3 分类判读
 * 框架——CJS 经 dynamic import）+ scripts/buy-point/lib.mjs（G 60s 去重 / H 前向收益 / I as-of 与 episode）。
 *
 * 合成微夹具（18 tick / 220s / 8 钱包）：跨窗钱包/router 双形状（viaRouter 用户行
 * +sender 缺失伪钱包行）/outlier 天价行/清仓卖家/同块 burst——buyDerived 全键手算
 * 锁定。断言失败 exit 非零（项目纪律：改到哪块跑哪块）。
 */

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  buildBuyPointSnapshot, computeBuyPointDerived, bpTEndOf, bpInWin,
  BP_WINDOWS, BP_TOP_HOLDER_N, BP_BURST_SEC, BP_PRICE_BUCKETS,
  BP_SWING_THRESHOLD_PCT, BP_OPEN_SEG_SEC, BP_OPEN_BIG_BUY_BNB, detectSwings,
} = require('../src/market-analysis/buy-point-snapshot');
const { buildBuyPointState, MAX_STATE_CHARS } = require('../src/market-analysis/buy-point-state-builder');
const {
  buildBuyPointObservation, DIMENSION_IDS, QUALITY_IDS,
  PRICE_TREND_LEVELS, HEAT_LEVELS, ACTIVITY_LEVELS,
  FAMOUS_DOMINATION_LEVELS, HOLDER_CONCENTRATION_LEVELS,
  ENTRY_POSITION_LEVELS, PRICE_LEVEL_LEVELS, TREE_POSITION_LEVELS,
  MARKET_PATTERN_LEVELS, PATTERN_GATE_POOR_BUCKETS, QUALITY_LEVELS, ASSESSMENT_LEVELS,
} = require('../src/market-analysis/buy-point-result-mapper');

const ROUTER = '0x1de460f363af910f51726def188f9004276bf4bc'; // GMGN 聚合路由（AGGREGATOR_ROUTER_ADDRS）
let passed = 0;
function ok(cond, label) {
  if (!cond) {
    console.error(`\n❌ FAIL: ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`  ✓ ${label}`);
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ── 夹具工厂 ──
const T0 = '2026-11-03T10:00:00.000Z';
const at = (dt) => new Date(Date.parse(T0) + dt * 1000).toISOString();
function row(dt, side, wallet, bnb, price, tok, opts = {}) {
  return {
    block_time: at(dt), block_number: opts.block ?? 1000 + dt, log_index: opts.li ?? 0,
    trade_type: side === 'BUY' ? 'buy' : 'sell',
    trader_address: opts.trader !== undefined ? opts.trader : wallet,
    sender_address: opts.sender !== undefined ? opts.sender : wallet,
    bnb_amount: bnb, token_amount: tok, price_bnb: price,
    price_outlier: opts.outlier === true,
    tx_hash: opts.tx !== undefined ? opts.tx : '0x' + String(1e6 + dt * 10 + (opts.li ?? 0)),
    quote_token: opts.quote !== undefined ? opts.quote : null,
  };
}
const CREATOR = '0x' + 'aa'.repeat(20);
const W_B = '0x' + 'bb'.repeat(20);
const W_C = '0x' + 'cc'.repeat(20);
const W_D = '0x' + 'dd'.repeat(20);
const W_E = '0x' + 'ee'.repeat(20);
const W_F = '0x' + 'ff'.repeat(20);
const W_G = '0x' + '11'.repeat(20);
const W_H = '0x' + '22'.repeat(20);

// ═══════════════ A. 快照 derived 手算精确值（18 tick / 220s 微夹具） ═══════════════
console.log('A. buyDerived 全键手算（18 tick / 8 钱包 / 220s）');
const E9 = 1e-9;
const rowsA = [
  row(5, 'BUY', CREATOR, 0.5, 1.0 * E9, 5e8),                    // 1 creator 首买
  row(20, 'BUY', W_B, 1.0, 1.1 * E9, 9e8),                       // 2
  row(35, 'BUY', W_C, 0.2, 1.2 * E9, 1.6e8),                     // 3
  row(50, 'BUY', W_D, 0.3, 1.3 * E9, 2.3e8),                     // 4 清仓卖家买入
  row(65, 'BUY', W_B, 0.8, 1.5 * E9, 5.3e8),                     // 5
  row(80, 'SELL', CREATOR, 0.25, 1.4 * E9, 1.8e8),               // 6 creator 获利卖
  row(95, 'BUY', W_E, 0.1, 1.6 * E9, 6.25e7),                    // 7 恰=tEnd−120 边界行（不入 120s 窗）
  row(100, 'BUY', ROUTER, 0.4, 99 * E9, 2e7, { outlier: true, sender: null }), // 8 outlier 天价+伪钱包（资金照计）
  row(110, 'BUY', W_F, 0.6, 2.0 * E9, 3e8, { trader: ROUTER }),  // 9 ATH 行；router 用户（sender=W_F 在场）
  row(110, 'BUY', W_G, 0.1, 1.95 * E9, 5e7, { li: 1 }),          // 10 同块第二笔（burst 对）
  row(125, 'SELL', W_E, 0.05, 1.8 * E9, 2.7e7),                  // 11
  row(140, 'BUY', W_C, 0.15, 1.7 * E9, 8.8e7),                   // 12
  row(155, 'BUY', W_H, 0.05, 1.55 * E9, 3.1e7),                  // 13 恰=tEnd−60 边界行（不入 60s 窗）
  row(170, 'SELL', W_D, 0.2, 1.5 * E9, 1.15e8),                  // 14 清仓卖家卖一半
  row(185, 'BUY', W_G, 0.12, 1.4 * E9, 8.6e7),                   // 15 同钱包二买（win30 内）
  row(185, 'SELL', W_D, 0.2, 1.4 * E9, 1.15e8),                  // 16 清仓卖家卖完（净=0→exitSeller）
  row(200, 'BUY', W_H, 0.05, 1.5 * E9, 3.3e7),                   // 17
  row(215, 'BUY', W_C, 0.1, 1.6 * E9, 6.25e7),                   // 18 末行 tEnd=215
];
const metaA = { address: '0x' + 'ab'.repeat(20), symbol: 'TEST', name: 'Test Token', platform: 'fourmeme', createdAt: T0, creatorAddress: CREATOR, totalSupply: 1e9 };
const snapA = buildBuyPointSnapshot(rowsA, metaA);
const dA = snapA.buyDerived;

ok(BP_WINDOWS.join(',') === '30,60,120' && BP_TOP_HOLDER_N === 5 && BP_BURST_SEC === 5 && BP_PRICE_BUCKETS === 20, '常量 BP_WINDOWS/TopN/BurstSec/Buckets');
ok(snapA.dtBase === 'created' && snapA.anchor.tickCount === 18, 'dtBase=created / anchor=18');
ok(snapA.signalInfo === null, 'signalInfo 缺省 null');
ok(bpTEndOf(snapA.ticks) === 215, 'tEnd=215（max dt）');
ok(dA.tokenAgeSec === 215 && dA.spanSec === 210, `tokenAge=215 / span=210（实际 ${dA.tokenAgeSec}/${dA.spanSec}）`);
ok(dA.currentVsAthPct === -20 && dA.secSinceAth === 105, `currentVsAth=-20% / 距ATH=105s（实际 ${dA.currentVsAthPct}/${dA.secSinceAth}）`);
ok(dA.madeHigh120 === true, 'madeHigh120=true（ATH@110 ∈ 近120s）');
// BP6 短窗 5/10/30s：tEnd=215，窗前最后可靠价——5/10s 窗均=行17@200 的 1.5e-9；30s 窗含行16@185 卖行 1.4e-9
ok(dA.chg5Pct === 6.67, `chg5=6.67%（1.6/1.5@200，实际 ${dA.chg5Pct}）`);
ok(dA.chg10Pct === 6.67, `chg10=6.67%（205 前最后可靠价同 @200，实际 ${dA.chg10Pct}）`);
ok(dA.chg30Pct === 14.29, `chg30=14.29%（1.6/1.4@185 卖行可靠价，实际 ${dA.chg30Pct}）`);
ok(dA.chg60Pct === undefined && dA.chg120Pct === undefined, 'chg60/chg120 已删（BP6 短窗换 5/10/30）');
// BP10 maxChg5 回看速度锚手算：3s 段 +40% / 2s 段 +25% / 3s 段 +50% → max=+50%；
// 先跌后涨形状（40:1.3→42:1.0→44:1.3）锁定「窗内最低价为起点」而非最旧（最旧 1.3 会得 0% 低估）
{
  const rowsM = [
    row(10, 'BUY', W_B, 0.1, 1.0 * E9, 1e8),
    row(13, 'BUY', W_C, 0.1, 1.4 * E9, 1e8),
    row(20, 'BUY', W_D, 0.1, 1.2 * E9, 1e8),
    row(22, 'BUY', W_E, 0.1, 1.5 * E9, 1e8),
    row(30, 'BUY', W_F, 0.1, 0.9 * E9, 1e8),
    row(33, 'BUY', W_G, 0.1, 1.35 * E9, 1e8),
    row(40, 'BUY', W_B, 0.1, 1.3 * E9, 1e8),
    row(42, 'BUY', W_C, 0.1, 1.0 * E9, 1e8),
    row(44, 'BUY', W_D, 0.1, 1.3 * E9, 1e8),
  ];
  const dM = buildBuyPointSnapshot(rowsM, metaA).buyDerived;
  ok(dM.maxChg5Pct === 50, `maxChg5=+50%（33s 段 0.9→1.35 为最陡；44s 先跌后涨段 1.0→1.3=+30% 次之，实际 ${dM.maxChg5Pct}）`);
}
ok(dA.maxChg5Pct === null, `A fixture 无 ≤5s 跨行段（间隔≥10s、同块行队首==j 不计）→ maxChg5=null（实际 ${dA.maxChg5Pct}）`);
// BP18 开盘段结构族手算：开盘段 dt<30 买入=行1 0.5+行2 1.0 → 1.5×2 笔（两笔均
// ≥0.3 大额）；全窗买入 4.47（资金口径不滤 outlier，行8 ROUTER 0.4 照计）→ 占比
// 33.6%；late 段（dt≥30）16 笔跨 210−30=180s → 5.33 笔/分、买入 2.97
ok(BP_OPEN_SEG_SEC === 30 && BP_OPEN_BIG_BUY_BNB === 0.3, 'BP18 开盘段常量=30s/大额线 0.3 BNB（与 BP16 大户判据同线）');
ok(dA.openSeg.buyBnb === 1.5 && dA.openSeg.buyN === 2 && dA.openSeg.buySharePct === 33.6
  && dA.openSeg.bigBuyN === 2 && dA.openSeg.bigBuyBnb === 1.5
  && dA.openSeg.lateBuyBnb === 2.97 && dA.openSeg.lateTicksPerMin === 5.33,
  `开盘段结构七键手算（实际 ${JSON.stringify(dA.openSeg)}）`);
{
  // 短窗形状（spanSec≤30）：开盘段锚照出（判强庄在场不需后段）、late 族 null 无对比语义
  const rowsShort = [
    row(5, 'BUY', W_B, 0.4, 1.0 * E9, 4e8),
    row(12, 'BUY', W_C, 0.05, 1.1 * E9, 4.5e7),
    row(25, 'BUY', W_D, 0.1, 1.15 * E9, 8.7e7),
  ];
  const dS = buildBuyPointSnapshot(rowsShort, metaA).buyDerived;
  ok(dS.openSeg.buyBnb === 0.55 && dS.openSeg.buyN === 3 && dS.openSeg.bigBuyN === 1 && dS.openSeg.bigBuyBnb === 0.4
    && dS.openSeg.lateBuyBnb === null && dS.openSeg.lateTicksPerMin === null,
    `短窗（span=20s≤30）开盘段照出+late 族 null（实际 ${JSON.stringify(dS.openSeg)}）`);
  // 截窗未覆盖开盘段（首行 dt>90 容差线）：全族 null 不冒充（同 launchCovered 判据）
  const rowsLate = [
    row(120, 'BUY', W_B, 0.5, 1.0 * E9, 5e8),
    row(180, 'BUY', W_C, 0.3, 1.2 * E9, 2.5e8),
  ];
  const dL = buildBuyPointSnapshot(rowsLate, metaA).buyDerived;
  ok(dL.openSeg.buyBnb === null && dL.openSeg.bigBuyN === null && dL.openSeg.lateBuyBnb === null,
    '截窗未覆盖开盘段（首行 dt=120>90）→ 全族 null（开盘段缺席语义不冒充）');
}
// BP8 摆动结构族手算（thr=20%）：dir=0 期 1.0→1.5 后回落 1.4 触 fromMin=+40% → 确认谷@5(1.0)、dir=1；
// ext 追至 110@2.0（ATH 行）；155@1.55 回落 −22.5% 触阈 → 确认峰@110(2.0)、dir=−1；ext 追至 185@1.4；
// 末段 200/215 反弹 +14.3% <20 未确认谷 → 现处下跌段
ok(BP_SWING_THRESHOLD_PCT === 20, 'BP8 摆动确认阈值=20%（初版待校准）');
ok(dA.swingPoints.length === 2 && dA.swingPoints[0].dt === 5 && dA.swingPoints[0].kind === 'low'
  && near(dA.swingPoints[0].price, 1.0 * E9) && dA.swingPoints[1].dt === 110 && dA.swingPoints[1].kind === 'high'
  && near(dA.swingPoints[1].price, 2.0 * E9),
  `swingPoints=[谷@5(1e-9), 峰@110(2e-9)]（实际 ${JSON.stringify(dA.swingPoints)}）`);
ok(dA.swingHighCount === 1 && dA.swingLowCount === 1, `摆点计数 峰1/谷1（实际 ${dA.swingHighCount}/${dA.swingLowCount}）`);
ok(dA.swingLastDir === -1, `swingLastDir=−1（末段下跌进行时，实际 ${dA.swingLastDir}）`);
ok(dA.secSinceSwingHigh === 105 && dA.secSinceSwingLow === 210, `距最近摆动峰 105s/谷 210s（实际 ${dA.secSinceSwingHigh}/${dA.secSinceSwingLow}）`);
ok(dA.currentVsSwingHighPct === -20 && dA.currentVsSwingLowPct === 60, `现价较最近摆动峰 −20%/谷 +60%（实际 ${dA.currentVsSwingHighPct}/${dA.currentVsSwingLowPct}）`);
ok(dA.swingMaxAmplPct === 100, `swingMaxAmplPct=100（段 +100/−30 最大，实际 ${dA.swingMaxAmplPct}）`);
ok(dA.swingLegs.length === 2 && dA.swingLegs[0].fromDt === 5 && dA.swingLegs[0].toDt === 110 && dA.swingLegs[0].amplPct === 100
  && dA.swingLegs[1].fromDt === 110 && dA.swingLegs[1].toDt === 185 && dA.swingLegs[1].amplPct === -30,
  `swingLegs=[5→110:+100, 110→185:−30]（实际 ${JSON.stringify(dA.swingLegs)}）`);
// detectSwings 裸函数边界：<2 可靠价 → 空结构 lastDir=null
ok(detectSwings([], 20).lastDir === null && detectSwings([{ dt: 1, priceBnb: 1 }], 20).points.length === 0, 'detectSwings <2 行 → 空结构（lastDir=null）');

// win30=(185,215]：行 15/16 dt=185 恰=tEnd−30 不入（半开锁）→ 只含行 17,18
ok(near(dA.win[30].buyBnb, 0.15) && dA.win[30].buyN === 2, `win30 买 0.15×2（实际 ${dA.win[30].buyBnb}×${dA.win[30].buyN}）`);
ok(dA.win[30].sellBnb === 0 && dA.win[30].sellN === 0, 'win30 卖 0×0（有证据零值）');
ok(near(dA.win[30].netBnb, 0.15) && dA.win[30].buySharePct === 100, `win30 净 0.15 / 买占 100%（实际 ${dA.win[30].netBnb}/${dA.win[30].buySharePct}）`);
ok(dA.win[30].ticksPerMin === 4 && dA.win[30].buyers === 2 && dA.win[30].sellers === 0, 'win30 tpm=4 / 买卖家 2/0');
ok(dA.win[30].newBuyers === 0, 'win30 新进场=0');
// win60=(155,215]：行 14..18（行 13 dt=155 恰边界不入）
ok(near(dA.win[60].buyBnb, 0.27) && dA.win[60].buyN === 3 && dA.win[60].sellN === 2, 'win60 买 0.27×3 / 卖 ×2');
ok(near(dA.win[60].netBnb, -0.13) && dA.win[60].buySharePct === 40.3, `win60 净 −0.13 / 买占 40.3%（实际 ${dA.win[60].netBnb}/${dA.win[60].buySharePct}）`);
ok(dA.win[60].ticksPerMin === 5 && dA.win[60].buyers === 3 && dA.win[60].sellers === 1 && dA.win[60].newBuyers === 0, 'win60 tpm=5 / 买卖家 3/1 / 新进场 0');
// win120=(95,215]：行 8..18（行 7 dt=95 恰边界不入；行 8 outlier 伪钱包资金照计）
ok(near(dA.win[120].buyBnb, 1.57) && dA.win[120].buyN === 8, `win120 买 1.57×8（含 outlier 0.4，实际 ${dA.win[120].buyBnb}×${dA.win[120].buyN}）`);
ok(near(dA.win[120].sellBnb, 0.45) && dA.win[120].sellN === 3 && near(dA.win[120].netBnb, 1.12), 'win120 卖 0.45×3 / 净 1.12');
ok(dA.win[120].buySharePct === 77.7 && dA.win[120].ticksPerMin === 5.5, `win120 买占 77.7% / tpm=5.5（实际 ${dA.win[120].buySharePct}/${dA.win[120].ticksPerMin}）`);
ok(dA.win[120].buyers === 4 && dA.win[120].sellers === 2, 'win120 买卖家 4/2（伪钱包剔——ROUTER 不计入 buyers）');
ok(dA.win[120].newBuyers === 3, 'win120 新进场=3（W_F/W_G@110 + W_H@155；W_E@95 边界不入）');

ok(dA.top1BuyPct60 === 44.4, `top1BuyPct60=44.4%（W_G 0.12/0.27，实际 ${dA.top1BuyPct60}）`);
ok(dA.top1SellPct60 === 100, `top1SellPct60=100%（W_D 0.4/0.4，实际 ${dA.top1SellPct60}）`);
ok(dA.routerBuyPct60 === 0, `routerBuyPct60=0（win60 无 viaRouter 买，实际 ${dA.routerBuyPct60}）`);
ok(dA.halfTpmEarly === 6 && dA.halfTpmLate === 5 && dA.rateTrend === 'flat', `half 6/5 → flat（实际 ${dA.halfTpmEarly}/${dA.halfTpmLate}/${dA.rateTrend}）`);
ok(dA.burst5In120 && dA.burst5In120.n === 2 && near(dA.burst5In120.buyBnb, 0.7) && dA.burst5In120.wallets === 2,
  `burst5={2笔,0.7,2钱包}（110 同块 W_F+W_G，实际 ${JSON.stringify(dA.burst5In120)}）`);
// 持仓 top5 = {W_B 1.43e9, creator 3.2e8, W_C 3.105e8, W_F 3.0e8, W_G 1.36e8}；win60 卖家只有 W_D（不在 top5）
ok(dA.bigHolderSellBnb60 === 0, `bigHolderSellBnb60=0（top5 近60s 零卖出=有证据零值，实际 ${dA.bigHolderSellBnb60}）`);
ok(dA.exitSellerCount60 === 1, `exitSellerCount60=1（W_D 清仓净=0，实际 ${dA.exitSellerCount60}）`);
// 市值位置族（BP2）：arc.last=1.6e-9/ATH=2.0e-9 × supply 1e9；currentVsAthPct=-20 同源互证
ok(dA.mcapBnb === 1.6 && dA.mcapPeakBnb === 2, `mcap=1.6 / 峰=2.0 BNB（实际 ${dA.mcapBnb}/${dA.mcapPeakBnb}）`);
ok(dA.mcapFromPeakPct === 20, `mcapFromPeakPct=20%（与 currentVsAthPct=−20 同源互证，实际 ${dA.mcapFromPeakPct}）`);
// holder 流向族（BP2）：末点正净=7（CREATOR/W_B/W_C/W_E/W_F/W_G/W_H；W_D 净 0 不计）；
// 60s 前（dt≤155，含 W_D 未清仓+W_C 未三买+W_H 首买恰 155 入）=8 → delta=−1（净流失）
ok(dA.holdersNow === 7, `holdersNow=7（实际 ${dA.holdersNow}）`);
ok(dA.holdersDelta60 === -1, `holdersDelta60=−1（W_D 尾窗清仓流失，实际 ${dA.holdersDelta60}）`);
// 发行价位置族（BP5）：发行价=rel[0]=行1 1.0e-9@t+5（出生段覆盖：firstDt=5≤90）；
// arc.last=1.6e-9 → +60.0%
ok(dA.launchCovered === true && near(dA.launchPriceBnb, 1.0 * E9) && dA.currentVsLaunchPct === 60,
  `launch 族：覆盖=true / 发行价=1e-9 / 现价较发行 +60%（实际 ${dA.launchCovered}/${dA.launchPriceBnb}/${dA.currentVsLaunchPct}）`);
// priceBuckets：17 可靠价行 → 等笔距 20 桶 3 空（b∈{0,6,13}）=17 桶
ok(dA.priceBuckets.length === 17, `priceBuckets=17 桶（实际 ${dA.priceBuckets.length}）`);
ok(dA.priceBuckets[0].dt === 5 && near(dA.priceBuckets[0].price, 1.0 * E9), '首桶=行1 @t+5');
ok(dA.priceBuckets[16].dt === 215 && near(dA.priceBuckets[16].price, 1.6 * E9), '末桶=行18 @t+215');
// cheatDerived 背景直读不重算
ok(snapA.cheatDerived.totalBuyBnb > 0 && Array.isArray(snapA.cheatDerived.holdingsProfile), 'cheatDerived 原样在场（背景复用）');

// ═══════════════ B. 窗语义边界 ═══════════════
console.log('B. 窗语义边界（半开/伪钱包/双口径）');
const rowsB = [
  row(5, 'BUY', W_B, 0.1, 1.0 * E9, 1e8),
  row(25, 'BUY', W_C, 0.2, 1.1 * E9, 2e8),   // 恰=tEnd−30 → 不入 30s 窗
  row(50, 'BUY', ROUTER, 0.1, 1.2 * E9, 1e7, { sender: null }), // 伪钱包：资金照计人不计
  row(55, 'SELL', W_C, 0.05, 1.15 * E9, 5e7),
];
const snapB = buildBuyPointSnapshot(rowsB, { ...metaA, createdAt: T0 });
const dB = snapB.buyDerived;
ok(bpTEndOf(snapB.ticks) === 55, 'B: tEnd=55');
ok(dB.win[30].buyN === 1 && dB.win[30].sellN === 1, `B: 30s 窗只含 (25,55]（dt=25 恰边界不入，实际 买${dB.win[30].buyN}/卖${dB.win[30].sellN}）`);
ok(near(dB.win[30].buyBnb, 0.1), 'B: 伪钱包行 bnb 照计（0.1 在窗 30 资金里）');
ok(dB.win[30].buyers === 0 && dB.win[30].sellers === 1, `B: buyers 剔伪钱包（ROUTER 不算，实际 ${dB.win[30].buyers}）`);
ok(bpInWin({ dt: 25 }, 55, 30) === false && bpInWin({ dt: 26 }, 55, 30) === true && bpInWin({ dt: 55 }, 55, 30) === true, 'B: bpInWin 半开锁 (tEnd−W, tEnd]');
ok(bpInWin({ dt: null }, 55, 30) === false && bpInWin({ dt: 10 }, null, 30) === false, 'B: dt 缺失/tEnd 缺失不入窗');

// ═══════════════ C. 缺证据两态 ═══════════════
console.log('C. 缺证据两态（null=有证据缺席 / 0=有证据零值）');
const snapC0 = buildBuyPointSnapshot([], metaA);
const dC0 = snapC0.buyDerived;
ok(dC0.win[30].buyBnb === 0 && dC0.win[30].buyN === 0 && dC0.win[30].ticksPerMin === 0 && dC0.win[30].buyers === 0, 'C: 空 tick → win 族有证据零值');
ok(dC0.win[30].buySharePct === null, 'C: 双边 0 → buySharePct=null（不以 0 冒充）');
ok(dC0.chg5Pct === null && dC0.chg10Pct === null && dC0.chg30Pct === null, 'C: 无可靠价 → chg 族 null');
ok(dC0.swingPoints === null && dC0.swingHighCount === null && dC0.swingLowCount === null && dC0.swingLastDir === null
  && dC0.secSinceSwingHigh === null && dC0.secSinceSwingLow === null && dC0.currentVsSwingHighPct === null
  && dC0.currentVsSwingLowPct === null && dC0.swingMaxAmplPct === null && dC0.swingLegs === null,
  'C: 无可靠价 → 摆动结构族全 null（<2 可靠价，BP8）');
ok(dC0.currentVsAthPct === null && dC0.secSinceAth === null && dC0.madeHigh120 === null, 'C: priceArc 缺 → 位置族 null');
ok(dC0.rateTrend === null && dC0.halfTpmEarly === null && dC0.halfTpmLate === null, 'C: 两半窗皆 0 → rateTrend=null');
ok(dC0.burst5In120 === null, 'C: 窗内行 <2 → burst null');
ok(dC0.tokenAgeSec === null && dC0.spanSec === null, 'C: 无 tick → tokenAge/span null');

const rowsCOut = [row(5, 'BUY', W_B, 0.1, 99 * E9, 1e8, { outlier: true }), row(15, 'SELL', W_B, 0.05, 98 * E9, 5e7, { outlier: true })];
const dCOut = buildBuyPointSnapshot(rowsCOut, metaA).buyDerived;
ok(dCOut.chg30Pct === null && dCOut.priceBuckets.length === 0, 'C: 全 outlier → 价格族全缺（资金照算 win.buyBnb=0.1）');
ok(dCOut.swingPoints === null && dCOut.swingMaxAmplPct === null, 'C: 全 outlier → 摆动族 null（可靠价口径，BP8）');
ok(near(dCOut.win[30].buyBnb, 0.1), 'C: outlier 行资金照计');

const rowsCTok = [row(5, 'BUY', W_B, 0.1, 1.0 * E9, null), row(60, 'SELL', W_B, 0.05, 1.1 * E9, 5e7)];
const dCTok = buildBuyPointSnapshot(rowsCTok, metaA).buyDerived;
ok(dCTok.bigHolderSellBnb60 === null && dCTok.exitSellerCount60 === null, 'C: token_amount 任一行缺失 → 卖压族 null fail-closed');
ok(dCTok.holdersNow === null && dCTok.holdersDelta60 === null, 'C: token_amount 缺失 → holder 流向族 null fail-closed（BP2）');

// supply 缺失（meta.totalSupply 空洞）：可靠价在场也不冒充市值（BP2——两族证据门独立）
const dCNoSupply = buildBuyPointSnapshot(rowsA, { ...metaA, totalSupply: null }).buyDerived;
ok(dCNoSupply.mcapBnb === null && dCNoSupply.mcapPeakBnb === null && dCNoSupply.mcapFromPeakPct === null, 'C: supply 缺失 → 市值位置族 null fail-closed（BP2）');
ok(dCNoSupply.holdersNow === 7 && dCNoSupply.holdersDelta60 === -1, 'C: supply 缺失不影响 holder 族（证据门独立，实际 7/-1）');

// 截窗未覆盖出生段（BP5）：首行 dt>90s → 发行价族 null 不冒充（覆盖判据=false 观测键）
const rowsCStart = [row(200, 'BUY', W_B, 0.1, 2.0 * E9, 1e8), row(210, 'BUY', W_C, 0.1, 2.2 * E9, 1e8)];
const dCStart = buildBuyPointSnapshot(rowsCStart, metaA).buyDerived;
ok(dCStart.launchCovered === false && dCStart.launchPriceBnb === null && dCStart.currentVsLaunchPct === null,
  'C: ticks 首行 >90s → 发行价族 null fail-closed（截窗不冒充，BP5）');

const rowsCNoPos = [row(5, 'BUY', W_B, 0.1, 1.0 * E9, 1e8), row(60, 'SELL', W_B, 0.1, 1.1 * E9, 1e8)];
const dCNoPos = buildBuyPointSnapshot(rowsCNoPos, metaA).buyDerived;
ok(dCNoPos.bigHolderSellBnb60 === null, 'C: 无正净持有人 → bigHolderSell null（轴不适用）');
ok(dCNoPos.exitSellerCount60 === 1, 'C: 清仓卖家计数照算=1（净≤0 有证据零值路径）');

// BP13 活跃度锚族透传（cheatDerived 同名单点照抄——不重算；rowsA 跨 180s 窗临近段在场）
{
  const snapAct = buildBuyPointSnapshot(rowsA, metaA);
  const act = snapAct.buyDerived.activity;
  const cd = snapAct.cheatDerived;
  ok(act && act.idlePct === cd.idlePct && act.buyMedianBnb === cd.buyMedianBnb && act.throughputBnbPerMin === cd.throughputBnbPerMin
    && act.nearSegTickN === cd.nearSegTickN && act.nearSegBnbPerMin === cd.nearSegBnbPerMin && act.spanSec === cd.spanSec && act.tickCount === cd.tickCount,
    'C: activity 锚族=cheatDerived 同名同值透传（单点计算不重算——BP 锚窗=买点前窗口）');
  const keysAct = Object.keys(act).sort().join(',');
  ok(keysAct === 'buyMedianBnb,idlePct,maxDrawdownPct,nearSegBnbPerMin,nearSegBuyMedianBnb,nearSegBuyN,nearSegMaxGapSec,nearSegSellN,nearSegTickN,nearSegTicksPerMin,spanSec,throughputBnbPerMin,tickCount', `C: activity 恰 13 键（实际 ${keysAct}）`);
  ok(snapAct.buyDerived.activity.maxDrawdownPct === cd.maxDrawdownPct, 'C: maxDrawdownPct 透传（可靠价运行峰回撤）');
}

// ═══════════════ D. state builder ═══════════════
console.log('D. state builder（分区/近端字段/截断/超帽）');
const snapD = buildBuyPointSnapshot(rowsA, metaA, { signalInfo: { signalId: 'BP-S042', createdAt: '2026-11-03T10:03:35Z', strategyName: 'buy-v2 v54', firePriceBnb: 1.62 * E9 } });
const stD = buildBuyPointState(snapD);
for (const sec of ['[TOKEN]', '[ANCHOR]', '[PRECOMPUTED]', '[PRICE]', '[TICKS]', '[WALLETS]', '[判定指引]']) {
  ok(stD.state.includes(sec), `D: 分区 ${sec} 在场`);
}
ok(stD.state.includes('BP-S042') && stD.state.includes('buy-v2 v54') && stD.state.includes('1.62e-9'), 'D: signalInfo（signalId/策略/fire 价）进 [ANCHOR]');
ok(stD.state.includes('近120s 买'), 'D: [WALLETS] 近端字段在场');
ok(stD.state.includes('近窗动量') && stD.state.includes('节奏趋势') && stD.state.includes('卖压') && stD.state.includes('参与结构') && stD.state.includes('时点位置'), 'D: PRECOMPUTED 七族行');
ok(stD.state.includes('近窗动量(涨跌%): 5s 6.67% / 10s 6.67% / 30s 14.29%'), 'D: chg 手算值渲染（BP6 短窗 5/10/30s）');
ok(stD.state.includes('清仓式卖出钱包 1 个'), 'D: 卖压行 exitSellerCount60=1');
ok(stD.state.includes('活跃度数值:') && stD.state.includes('买盘中位') && stD.state.includes('金额吞吐') && stD.state.includes('无交易期占比') && stD.state.includes('窗口时长'), 'D: 活跃度数值行扩容（BP13：中位/吞吐/静默占比/窗口两原料——CD 数值族搬运渲染）');
ok(stD.state.includes('临近买点段(最后30秒):') && stD.state.includes('买入点位之前的直接承接环境——开盘段/前期密集不救临近死寂'), 'D: 临近买点段行渲染（BP13：锚窗末端 30s 独立口径）');
ok(stD.state.includes('市值位置(BNB 域): 现价市值 1.6 / 窗内峰市值 2 / 较峰回撤 20.00%'), 'D: 市值位置行手算值渲染（BP2）');
ok(stD.state.includes('holder 流向: 现正净持仓钱包 7 个；近 60s 变化 -1'), 'D: holder 流向行渲染（W_D 尾窗清仓净流失）');
ok(stD.state.includes('发行价位置: 现价较发行价 +60.0%') && stD.state.includes('发行价 1.00e-9 BNB'), 'D: 发行价位置行渲染（BP5——fmtPrice 同 [PRICE] 口径）');
ok(stD.state.includes('摆动结构(圣诞树原料): 谷@t+5s→峰@t+110s，现处下跌段') && stD.state.includes('段幅度（旧→新）+100%/105s、-30%/75s')
  && stD.state.includes('摆点 峰1/谷1，最大单段摆幅 100%') && stD.state.includes('现价较最近摆动峰 -20.00% / 较最近摆动谷 +60.00%'),
  'D: 摆动结构行渲染（BP8 手算值——zigzag 峰谷序列/段幅度/现价较峰谷）');
ok(stD.state.includes('判定结构') && stD.state.includes('暂不参与决策') && stD.state.includes('早鸟≈树左侧早段、回调≈树脚企稳'),
  'D: 判定指引三层结构+圣诞树观察档声明（BP8 挂树教学——暂不参与决策）');
ok(stD.state.includes('②筹码门') && stD.state.includes('famous 控盘（famous_domination）dominant 或持仓集中（holder_concentration）strong=不参与交易'),
  'D: 判定指引②筹码门声明（BP14——BEM 案 famous 掌控/持仓集中两档硬门消费）');
ok(stD.state.includes('筹码结构: famous 控盘占比 ?%') && stD.state.includes('正净持有者 7 个，第一大占流通 55.1%') && stD.state.includes('买过钱包 8 个 vs 正净持有 7 个'),
  'D: 筹码结构行渲染（BP14：famous ? 缺证据如实渲染+持有者/top 占比手算值+参与持有分叉）');
ok(stD.promptChars === stD.state.length && stD.truncated.ticks === false && stD.truncated.wallets === false && stD.truncated.hardCap === false, 'D: 小夹具零截断');

const rowsMany = [];
for (let i = 1; i <= 320; i++) rowsMany.push(row(i, i % 2 ? 'BUY' : 'SELL', '0x' + (1000 + (i % 10)).toString(16).padStart(40, '0'), 0.01, (1 + i * 0.001) * E9, 1e6));
const stMany = buildBuyPointState(buildBuyPointSnapshot(rowsMany, metaA));
ok(stMany.truncated.ticks === true && stMany.state.includes('超展示帽'), 'D: >300 tick → 首50+末250 截断声明（高活跃票常态触发 20k 硬帽，与 CD 模板同款行为）');
ok(stMany.promptChars <= MAX_STATE_CHARS + 200, `D: 预算内（${stMany.promptChars} ≤ ${MAX_STATE_CHARS}+注记）`);
// 钱包截断单独夹具（60 tick / 60 钱包——不与 20k 硬帽耦合）
const rowsW60 = [];
for (let i = 1; i <= 60; i++) rowsW60.push(row(i, i % 2 ? 'BUY' : 'SELL', '0x' + (1000 + i).toString(16).padStart(40, '0'), 0.01, (1 + i * 0.001) * E9, 1e6));
const stW60 = buildBuyPointState(buildBuyPointSnapshot(rowsW60, metaA));
ok(stW60.truncated.wallets === true && !stW60.truncated.hardCap && stW60.state.includes('按买入额保留 top 40'), 'D: >40 钱包 → top40 截断声明');

const snapHuge = buildBuyPointSnapshot(rowsA, { ...metaA, name: 'X'.repeat(25000) });
const stHuge = buildBuyPointState(snapHuge);
ok(stHuge.truncated.hardCap === true && stHuge.state.startsWith('⚠'), 'D: 超帽 → ⚠ 头 + 硬截断');

// ═══════════════ E. mapper（BP6 三质量题聚合 + 容错双轨 + 纯透传反证） ═══════════════
console.log('E. mapper（BP6 三质量题聚合/容错双轨/纯透传反证）');
const mkAns = (id, bucket, prob = 0.9) => ({ [id]: { probabilities: { [bucket]: prob, [bucket === 'good' ? 'neutral' : 'good']: 1 - prob } } });
const fullAnswers = () => ({
  ...mkAns('price_trend', 'fast_up'),
  ...mkAns('market_heat', 'high'),
  ...mkAns('activity_level', 'mid'),
  ...mkAns('famous_domination', 'none'),
  ...mkAns('holder_concentration', 'none'),
  ...mkAns('entry_position', 'near_high'),
  ...mkAns('price_level', 'near_launch'),
  ...mkAns('tree_position', 'left_side'),
  ...mkAns('market_pattern', 'blended_unremarkable', 0.8),
  ...mkAns('early_bird_quality', 'neutral', 0.7),
  ...mkAns('pullback_entry_quality', 'insufficient', 0.8),
  ...mkAns('high_chase_quality', 'poor', 0.61),
});
const obsE = buildBuyPointObservation(fullAnswers(), dA);
ok(Object.keys(obsE.dimensions).length === 9 && obsE.dimensions.price_trend.bucket === 'fast_up' && obsE.dimensions.activity_level.bucket === 'mid', 'E: 九维度 argmax 透传（BP18 增 market_pattern 盘面分类——用户五类型学）');
ok(!('point_category' in obsE.dimensions) && JSON.stringify(obsE).indexOf('point_category') === -1 && JSON.stringify(obsE).indexOf('buy_point_assessment') === -1, 'E: point_category/buy_point_assessment 键绝迹（BP6 形态反证）');
ok(Object.keys(obsE.qualities).length === 3 && obsE.qualities.early_bird.bucket === 'neutral' && obsE.qualities.pullback_entry.bucket === 'insufficient' && obsE.qualities.high_chase.bucket === 'poor', 'E: 三质量题 strict 透传（early_bird/pullback_entry/high_chase）');
ok(obsE.assessment.bucket === 'neutral' && near(obsE.assessment.prob, 0.7) && obsE.assessment.rule === 'any_neutral', 'E: 聚合=任一 neutral → neutral（insufficient 不贡献，rule 留痕）');
const jsonE = JSON.stringify(obsE);
ok(!jsonE.includes('"verdict"') && !jsonE.includes('"grade"') && !jsonE.includes('"score"') && !jsonE.includes('"recommendation"'), 'E: 观测记录无 verdict/grade/score/recommendation 键（纯透传反证——rule 是聚合来源留痕不在禁列）');
// 聚合三臂（用户裁定 2026-11-05 原话：任一 good→good；任一 neutral→neutral；否则 poor）
const agg = (e, ep, p, pp, h, hp) => buildBuyPointObservation({
  ...fullAnswers(),
  ...mkAns('early_bird_quality', e, ep),
  ...mkAns('pullback_entry_quality', p, pp),
  ...mkAns('high_chase_quality', h, hp),
}, dA).assessment;
let aG = agg('good', 0.9, 'poor', 0.5, 'good', 0.8);
ok(aG.bucket === 'good' && near(aG.prob, 0.9) && aG.rule === 'any_good', 'E: 聚合臂① 任一 good → good（prob=该 tier 最大）');
aG = agg('poor', 0.5, 'insufficient', 0.9, 'neutral', 0.66);
ok(aG.bucket === 'neutral' && near(aG.prob, 0.66) && aG.rule === 'any_neutral', 'E: 聚合臂② 无 good 有 neutral → neutral（压过 poor）');
aG = agg('insufficient', 0.9, 'poor', 0.55, 'insufficient', 0.9);
ok(aG.bucket === 'poor' && near(aG.prob, 0.55) && aG.rule === 'else_poor', 'E: 聚合臂③ 无 good/neutral → poor（poor 证据 prob 照带）');
aG = agg('insufficient', 0.9, 'insufficient', 0.9, 'insufficient', 0.9);
ok(aG.bucket === 'poor' && aG.prob === null && aG.rule === 'else_poor', 'E: 三题全 insufficient → poor 且 prob=null（fallback 无 poor 证据）');
aG = agg('good', 0.55, 'insufficient', 0.9, 'poor', 0.99);
ok(aG.bucket === 'good' && near(aG.prob, 0.55), 'E: good 优先于 high prob poor（tier 序非概率序）');
aG = agg('good', 0.6, 'poor', 0.5, 'good', 0.9);
ok(aG.bucket === 'good' && near(aG.prob, 0.9), 'E: 多 good 并存 prob=取最大');
// BP8 活跃度门+圣诞树观察档（用户裁定：①活跃度 low 不参与；②圣诞树锚「暂时先不
// 参与决策…可以先放里头」——tree 各桶一律不拦，题照问答照落攒分布）
// BP13 门扩双题：market_heat low（近窗密度）OR activity_level low（买点前全窗量级
// ——CD 七要素判法搬运，ZELDA 案：market_heat 纯密度对「每分钟成交额 BNB」失真）
let aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_heat', 'low', 0.88) }, dA).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.88) && aM.rule === 'activity_gate', 'E: 门① heat=low → poor/activity_gate（prob=门题 argmax；act=mid 不参与）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('activity_level', 'low', 0.81) }, dA).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.81) && aM.rule === 'activity_gate', 'E: 门① BP13 臂 act=low（heat=high）→ poor/activity_gate（买点前全窗量级死寂——ZELDA 形状拦截臂）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_heat', 'low', 0.7), ...mkAns('activity_level', 'low', 0.93) }, dA).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.93) && aM.rule === 'activity_gate', 'E: 门① 双 low → prob 取两臂最大（同 rule 留痕）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_heat', 'mid', 0.6), ...mkAns('activity_level', 'mid', 0.6), ...mkAns('early_bird_quality', 'good', 0.9) }, dA).assessment;
ok(aM.bucket === 'good' && aM.rule === 'any_good', 'E: 门① 双 mid 放行（低档才有证据拒——mid/high/ultra 不拦）');
{
  const legacyAns = fullAnswers();
  delete legacyAns.activity_level; // BP12 旧档重放形状：无 activity_level 答案
  const aLegacy = buildBuyPointObservation(legacyAns, dA).assessment;
  ok(aLegacy.bucket === 'neutral' && aLegacy.rule === 'any_neutral', 'E: 门① act 答案缺席=该臂失效容缺放行（BP12 旧档重放兼容——market_heat 臂照常）');
  const aLegacyHeat = buildBuyPointObservation({ ...legacyAns, ...mkAns('market_heat', 'low', 0.9) }, dA).assessment;
  ok(aLegacyHeat.rule === 'activity_gate', 'E: 门① 旧档无 act 答案时 heat 臂照拦（单臂退化不吞门）');
}
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_heat', 'low', 0.88), ...mkAns('early_bird_quality', 'good', 0.95) }, dA).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'activity_gate', 'E: 门① 优先于质量题（早鸟 good 0.95 不救——活跃度不够不参与）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('activity_level', 'low', 0.88), ...mkAns('early_bird_quality', 'good', 0.95) }, dA).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'activity_gate', 'E: 门① BP13 臂同优先于质量题（act low+早鸟 good 不救）');
// ①b 筹码门（BP14/案号 BP14 BEM Miner 案——用户裁定「全部搬过来直接用于判定」：
// famous_domination=dominant ∨ holder_concentration=strong → poor/chip_gate；
// 只取最高档 dominant/strong 拒买，heavy/moderate=观察档不拦防误伤）
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('famous_domination', 'dominant', 0.92) }, dA).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.92) && aM.rule === 'chip_gate', 'E: 门①b famous=dominant → poor/chip_gate（BEM 案主拦截臂——famous 掌控的盘子不参与）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('holder_concentration', 'strong', 0.87) }, dA).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.87) && aM.rule === 'chip_gate', 'E: 门①b holder=strong → poor/chip_gate（CD240 分层线臂——持有者不少但 TOP 占比太大）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('famous_domination', 'dominant', 0.8), ...mkAns('holder_concentration', 'strong', 0.94) }, dA).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.94) && aM.rule === 'chip_gate', 'E: 门①b 双臂命中 → prob 取两臂最大（同 rule 留痕）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('famous_domination', 'dominant', 0.9), ...mkAns('early_bird_quality', 'good', 0.97) }, dA).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'chip_gate', 'E: 门①b 优先于质量题（dominant+早鸟 good 0.97 不救——控盘盘不参与）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_heat', 'low', 0.85), ...mkAns('famous_domination', 'dominant', 0.95) }, dA).assessment;
ok(aM.rule === 'activity_gate' && near(aM.prob, 0.85), 'E: 门① 活跃度门先于筹码门（双门命中 rule 留痕 activity_gate——首个命中门）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('famous_domination', 'heavy', 0.9), ...mkAns('holder_concentration', 'moderate', 0.9) }, dA).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'any_neutral', 'E: 门①b heavy/moderate 观察档不拦（只取最高档拒——防误伤豁免域）');
// ①c 盘型门（BP18 用户裁定五类型学：retail_pvp 散户 PVP/famous_monopoly famous
// 独食/early_sniper_decay 狙击衰竭三桶硬拒买；strong_backer 强庄=最好类型与
// blended_unremarkable 融合盘=好点位可赌 不拦——点位质量仍归三质量题）
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'retail_pvp', 0.86) }, dA).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.86) && aM.rule === 'pattern_gate', 'E: 门①c retail_pvp 散户 PVP → poor/pattern_gate（只有小散户额度偏低互捅攒流动性——不要参与）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'famous_monopoly', 0.91) }, dA).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.91) && aM.rule === 'pattern_gate', 'E: 门①c famous_monopoly famous 独食 → poor/pattern_gate（小散底子+一个 famous 拿太多筹码盘子就是它的）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'early_sniper_decay', 0.84) }, dA).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.84) && aM.rule === 'pattern_gate', 'E: 门①c early_sniper_decay 狙击衰竭 → poor/pattern_gate（购买力集中最早期数 slot 后衰竭）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'strong_backer', 0.88) }, dA).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'any_neutral', 'E: 门①c strong_backer 强庄盘不拦（最好类型——开盘大户进流动性未拉爆价，点位质量归质量题）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'blended_unremarkable', 0.77) }, dA).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'any_neutral', 'E: 门①c blended_unremarkable 融合盘不拦（交易额中等无明显特征——好点位可以赌一赌）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'retail_pvp', 0.86), ...mkAns('early_bird_quality', 'good', 0.95) }, dA).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: 门①c 优先于质量题（散户 PVP+早鸟 good 0.95 不救——盘型不对不参与）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_heat', 'low', 0.85), ...mkAns('market_pattern', 'retail_pvp', 0.95) }, dA).assessment;
ok(aM.rule === 'activity_gate' && near(aM.prob, 0.85), 'E: 门序 活跃度门先于盘型门（双门命中 rule 留痕 activity_gate——首个命中门）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('famous_domination', 'dominant', 0.9), ...mkAns('market_pattern', 'famous_monopoly', 0.95) }, dA).assessment;
ok(aM.rule === 'chip_gate' && aM.bucket === 'poor', 'E: 门序 筹码门先于盘型门（famous dominant+独食双语义命中留痕 chip_gate——阈值硬线优先）');
{
  const legacyPat = fullAnswers();
  delete legacyPat.market_pattern; // BP17 及更早旧档重放形状：无盘面分类题答案
  const aLegacy = buildBuyPointObservation(legacyPat, dA).assessment;
  ok(aLegacy.bucket === 'neutral' && aLegacy.rule === 'any_neutral', 'E: 门①c 答案缺席=盘型门臂自动失效容缺放行（BP17 旧档重放兼容零影响——拒=有证据的拒绝）');
}
assert.throws(() => buildBuyPointObservation({ ...fullAnswers(), market_pattern: { probabilities: { sniper_pool: 0.9 } } }, dA), /未知桶名/, 'E: market_pattern 在场未知桶 throw（容缺不因新题放宽桶域校验）');
{
  const legacyChip = fullAnswers();
  delete legacyChip.famous_domination; // BP13 及更早旧档重放形状：无两筹码题答案
  delete legacyChip.holder_concentration;
  const aLegacy = buildBuyPointObservation(legacyChip, dA).assessment;
  ok(aLegacy.bucket === 'neutral' && aLegacy.rule === 'any_neutral', 'E: 门①b 两题答案缺席=筹码门臂自动失效容缺放行（BP13 旧档重放兼容零影响）');
}
assert.throws(() => buildBuyPointObservation({ ...fullAnswers(), famous_domination: { probabilities: { control: 0.9 } } }, dA), /未知桶名/, 'E: famous_domination 在场未知桶 throw（容缺不因新题放宽桶域校验）');
assert.throws(() => buildBuyPointObservation({ ...fullAnswers(), holder_concentration: { probabilities: { extreme: 0.9 } } }, dA), /未知桶名/, 'E: holder_concentration 在场未知桶 throw');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('tree_position', 'not_tree', 0.83) }, dA).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'any_neutral', 'E: tree=not_tree 不拦（观察档——圣诞树门裁定暂不参与决策，走质量题聚合）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('tree_position', 'top', 0.77) }, dA).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'any_neutral', 'E: tree=top 不拦（观察档——位置门同缓）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('tree_position', 'right_side', 0.75) }, dA).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'any_neutral', 'E: tree=right_side 不拦（观察档）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('tree_position', 'unclear', 0.9) }, dA).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'any_neutral', 'E: tree=unclear → 质量题聚合（观察档全桶同路）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('tree_position', 'right_bottom', 0.8) }, dA).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'any_neutral', 'E: tree=right_bottom → 质量题聚合（回调质量题主场）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_heat', 'low', 0.9), ...mkAns('tree_position', 'not_tree', 0.85) }, dA).assessment;
ok(aM.rule === 'activity_gate', 'E: heat=low 门照拒（活跃度门独立于 tree 观察档）');
ok(!['not_tree', 'position_gate'].includes(aM.rule), 'E: rule 域圣诞树门值绝迹（activity_gate/chip_gate/pattern_gate/any_good/any_neutral/else_poor 六值——观察档反证）');
const noTree = { ...fullAnswers() };
delete noTree.tree_position;
ok(buildBuyPointObservation(noTree, dA).assessment.rule === 'any_neutral' && buildBuyPointObservation(noTree, dA).dimensions.tree_position === null,
  'E: tree_position 答案缺席 → 维度 null 容缺+聚合照走（拒=有证据的拒绝）');
ok(buildBuyPointObservation(fullAnswers(), dA).dimensions.tree_position.bucket === 'left_side', 'E: tree_position 维度 argmax 透传（九维度）');
ok(obsE.anchors.chg5Pct === 6.67 && obsE.anchors.chg10Pct === 6.67 && obsE.anchors.chg30Pct === 14.29, 'E: 动量短窗族三键透传（BP6 5/10/30）');
ok(obsE.anchors.maxChg5Pct === null, `E: maxChg5Pct 锚透传（A fixture 无 5s 段→null 容忍，实际 ${obsE.anchors.maxChg5Pct}）`);
ok(obsE.anchors.swingHighCount === 1 && obsE.anchors.swingLowCount === 1 && obsE.anchors.swingLastDir === -1
  && obsE.anchors.secSinceSwingHigh === 105 && obsE.anchors.secSinceSwingLow === 210
  && obsE.anchors.currentVsSwingHighPct === -20 && obsE.anchors.currentVsSwingLowPct === 60
  && obsE.anchors.swingMaxAmplPct === 100, 'E: 摆动结构族 8 键透传（BP8 圣诞树原料）');
ok(obsE.anchors.swingPoints === undefined && obsE.anchors.swingLegs === undefined, 'E: swingPoints/swingLegs 数组不进锚（state 渲染原料）');
ok(obsE.anchors.chg60Pct === undefined && obsE.anchors.chg120Pct === undefined, 'E: chg60/chg120 键绝迹（BP6 短窗反证）');
// BP13 活跃度锚族透传（cheatDerived 同名单点照抄——act 前缀=买点前窗口口径）
ok(obsE.anchors.actIdlePct === (dA.activity ? dA.activity.idlePct : undefined) && obsE.anchors.actBuyMedianBnb === (dA.activity ? dA.activity.buyMedianBnb : undefined)
  && obsE.anchors.actThroughputBnbPerMin === (dA.activity ? dA.activity.throughputBnbPerMin : undefined) && obsE.anchors.actNearSegTickN === (dA.activity ? dA.activity.nearSegTickN : undefined),
  'E: 活跃度锚族 act 四代表键透传（idlePct/买盘中位/吞吐/临近段——与 buyDerived.activity 同值）');
ok(obsE.anchors.actSpanSec !== undefined && obsE.anchors.actTickCount !== undefined && obsE.anchors.actNearSegBnbPerMin !== undefined && obsE.anchors.actNearSegMaxGapSec !== undefined
  && obsE.anchors.actNearSegBuyN !== undefined && obsE.anchors.actNearSegSellN !== undefined && obsE.anchors.actNearSegTicksPerMin !== undefined && obsE.anchors.actNearSegBuyMedianBnb !== undefined,
  'E: 活跃度锚族 act 13 键全在场（spanSec/tickCount/中位/吞吐/回撤/临近段七键）');
// BP14 筹码锚族透传（buyDerived.chip 嵌套段——cheatDerived 同名/派生单点照抄零重算）
ok(obsE.anchors.chipFamousDominancePct === null && obsE.anchors.chipFamousFollowerTop3Pct === null && obsE.anchors.chipFamousGroupBuyPct === null && obsE.anchors.chipSameBlockHoldPct === null,
  'E: 筹码锚族 famous 三键+同块簇=缺证据 null 容忍（A fixture 无 famous 名单钱包/无合格同块簇——不冒充）');
ok(obsE.anchors.chipPosHolderCount === 7 && obsE.anchors.chipBuyersTotal === 8,
  'E: 筹码锚族持有者/买过钱包手算（正净 7 个（W_D 净 0 剔）/买过 8 个（ROUTER 伪钱包不计）——holdersNow=7 同源互证）');
ok(near(obsE.anchors.chipTop1HoldCircPct, 1430 / 2596 * 100) && near(obsE.anchors.chipTop1Top2HoldCircPct, 1750 / 2596 * 100) && near(obsE.anchors.chipTop3HoldCircPct, 2060.5 / 2596 * 100),
  'E: 筹码锚族分层三键手算（Σ正净=2596M：top1=55.08%/top1+2=67.41%/top3=79.37%——top1HoldCircPct 自 holdingsProfile[0].circPct 派生）');
ok(obsE.anchors.chipEqualBandHoldPct === dA.chip.equalBandHoldPct && obsE.anchors.chipEqualBandHoldPct !== null && obsE.anchors.chipTop1Top2HoldCircPct === dA.chip.top1Top2HoldCircPct,
  'E: 筹码锚族=buyDerived.chip 同值透传（BP 零重算契约——等额带簇/分层键不冒充）');
const obsChip = buildBuyPointObservation(fullAnswers(), {
  ...dA,
  chip: {
    famousDominancePct: 74.5, famousFollowerTop3Pct: 64.5, famousGroupBuyPct: 74.5,
    posHolderCount: 3, top1HoldCircPct: 65.4, top1Top2HoldCircPct: 100, top3HoldCircPct: 100,
    sameBlockHoldPct: 0, equalBandHoldPct: null, buyersTotal: 29,
  },
});
ok(obsChip.anchors.chipFamousDominancePct === 74.5 && obsChip.anchors.chipFamousFollowerTop3Pct === 64.5 && obsChip.anchors.chipFamousGroupBuyPct === 74.5
  && obsChip.anchors.chipPosHolderCount === 3 && obsChip.anchors.chipTop1HoldCircPct === 65.4 && obsChip.anchors.chipTop1Top2HoldCircPct === 100
  && obsChip.anchors.chipBuyersTotal === 29 && obsChip.anchors.chipSameBlockHoldPct === 0,
  'E: 筹码锚族 chip 锚值透传（BEM 实测形状——29 买过/3 持有/top2=100% 分叉）');
ok(obsChip.anchors.chipEqualBandHoldPct === null, 'E: chip 锚 null 语义保持（无等额簇=缺证据 null 不冒充——非数值吞为 null）');
// BP18 开盘段结构锚族透传（openSeg 嵌套段——A fixture 手算：开盘段 dt<30 买入
// =行1 dt5 0.5+行2 dt20 1.0 → 1.5×2 笔全 ≥0.3 大额；全窗买入 4.47（资金不滤
// outlier 行8 ROUTER 0.4 照计）→ 占比 33.6%；late 段 16 笔/180s → 5.33 笔/分）
ok(obsE.anchors.openSegBuyBnb === 1.5 && obsE.anchors.openSegBuyN === 2 && obsE.anchors.openSegBuySharePct === 33.6
  && obsE.anchors.openSegBigBuyN === 2 && obsE.anchors.openSegBigBuyBnb === 1.5
  && obsE.anchors.openLateBuyBnb === 2.97 && obsE.anchors.openLateTicksPerMin === 5.33,
  'E: 开盘段结构锚族七键手算（首 30s 买入 1.5×2 全大额/占比 33.6%/late 买入 2.97 密度 5.33 笔每分——BP18 判 strong_backer/early_sniper_decay 的数值原料）');
{
  const obsNoOpen = buildBuyPointObservation(fullAnswers(), { ...dA, openSeg: { buyBnb: null, buyN: null, buySharePct: null, bigBuyN: null, bigBuyBnb: null, lateBuyBnb: null, lateTicksPerMin: null } });
  ok(obsNoOpen.anchors.openSegBigBuyN === null && obsNoOpen.anchors.openLateTicksPerMin === null, 'E: 开盘段锚全族 null 透传（截窗未覆盖开盘段不冒充）');
}
const obsNeg = buildBuyPointObservation(fullAnswers(), { ...dA, chg30Pct: -12.34, win: dA.win });
ok(obsNeg.anchors.chg30Pct === -12.34, 'E: chg 负值 −12.34 照读（不以 null 吞）');
ok(obsE.anchors.win60BuyBnb !== undefined && near(obsE.anchors.win60BuyBnb, 0.27), 'E: win 族扁平键 win60BuyBnb 透传');
ok(obsE.anchors.mcapBnb === 1.6 && obsE.anchors.mcapPeakBnb === 2 && obsE.anchors.mcapFromPeakPct === 20, 'E: 市值位置族三键透传（BP2）');
ok(obsE.anchors.holdersNow === 7 && obsE.anchors.holdersDelta60 === -1, 'E: holder 流向族两键透传（BP2，delta 负值照读不吞）');
ok(obsE.anchors.launchPriceBnb !== null && near(obsE.anchors.launchPriceBnb, 1.0 * E9) && obsE.anchors.currentVsLaunchPct === 60 && obsE.anchors.launchCovered === 1,
  'E: 发行价位置族三键透传（BP5——launchCovered boolean → 1 数值化）');
ok(buildBuyPointObservation(fullAnswers(), null).assessment.bucket === 'neutral', 'E: anchors 缺省 null 容忍（聚合照常）');
const badAnchor = buildBuyPointObservation(fullAnswers(), { ...dA, chg30Pct: 'not-a-number' });
ok(badAnchor.anchors.chg30Pct === null, 'E: 非数值锚形状异常 → null 不冒充');

assert.throws(() => { const a = { ...fullAnswers() }; delete a.early_bird_quality; buildBuyPointObservation(a, dA); }, /答案缺失/, 'E: 质量题缺答案 throw（strict——综合判定唯一来源）');
assert.throws(() => buildBuyPointObservation({ ...fullAnswers(), high_chase_quality: { probabilities: { excellent: 0.9 } } }, dA), /未知桶名/, 'E: 质量题未知桶 throw');
assert.throws(() => buildBuyPointObservation({ ...fullAnswers(), pullback_entry_quality: {} }, dA), /答案缺失|无概率分布/, 'E: 质量题空答案 throw');
assert.throws(() => buildBuyPointObservation({ ...fullAnswers(), price_trend: { probabilities: { extreme: 0.9 } } }, dA), /未知桶名/, 'E: 维度题在场未知桶 throw');
assert.throws(() => buildBuyPointObservation({ ...fullAnswers(), activity_level: { probabilities: { dead: 0.9 } } }, dA), /未知桶名/, 'E: activity_level 在场未知桶 throw（容缺不因新题放宽桶域校验）');
const partial = { ...fullAnswers() };
delete partial.price_level;
const obsPartial = buildBuyPointObservation(partial, dA);
ok(obsPartial.dimensions.price_level === null && obsPartial.dimensions.price_trend.bucket === 'fast_up', 'E: 维度题缺席 → null 容缺（在场照读；质量题不许缺席）');

(async () => {
  // ═══════════════ F. 题集形状（CJS 经 dynamic import） ═══════════════
  console.log('F. 题集形状（BP29 十二题=9 维度+3 质量/桶域对锁/活跃度门双题+筹码门双题+盘型门三桶+价格豁免锚+三类质量题+圣诞树观察档/BP19 案②⑤边界两改+BP21 案①②承接轴两改+BP23 案庄盘豁免+②(b) 收窄+BP24 案大户持续卖持续承接臂三改+BP25 案 low 档收窄+庄盘豁免一档帽+BP26 案大户参与判序前置+BP27 案①庄时序锚/两调深相等）');
  const q = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'market-analysis', 'llm', 'buy-point-questions.mjs')).href);
  ok(q.BUY_POINT_QUESTIONS_VERSION === 'BP29', 'F: 版本=BP29（BP27 案=S048 散户接力盘误判① 庄时序锚——用户裁定原话「S048 也不是庄盘，如果你是庄，肯定一开盘最早期买入大额，然后对倒分仓，它是一开始先小散户，然后有稍微大一点的散户接了罢了」+措辞更正「应该是最早的买入（至少是次早）得有大户」：S048 出生段 36 行 0.3+ 大额 0 笔、最早的买入 5 笔全 0.03~0.14 小散、13 秒后 0.1985/0.1976 贴线单被 Jev 当大额判① → ①补庄时序锚：大额=0.3+、最早（至少次早）买入得有大户、散户接力盘不走①至多⑤）');
  const qs = q.buildBuyPointQuestions();
  const ids = Object.keys(qs);
  ok(ids.length === 12, `F: 恰 12 题=9 维度+3 质量题（实际 ${ids.length}）`);
  ok(ids[0] === 'price_trend' && ids[1] === 'market_heat' && ids[2] === 'activity_level' && ids[3] === 'famous_domination' && ids[4] === 'holder_concentration' && ids[5] === 'entry_position' && ids[6] === 'price_level' && ids[7] === 'tree_position' && ids[8] === 'market_pattern', 'F: 维度序=price_trend/heat/activity/famous/holder/entry/level/tree/market_pattern（前 9 题——BP18 盘面分类插 tree 后）');
  ok(JSON.stringify(ids.slice(9)) === JSON.stringify(QUALITY_IDS), 'F: 后 3 题=early_bird/pullback_entry/high_chase 质量题（BP6 用户裁定）');
  ok(!('point_category' in qs) && !('buy_point_assessment' in qs), 'F: 类别题/综合题已删（BP6 形态反证——路由依赖从根消除）');
  ok(!('price_momentum' in qs) && !('buy_pressure_quality' in qs) && !('chip_flow' in qs) && !('pace_trend' in qs), 'F: 四道旧维度题已删（BP5 瘦身反证）');
  ok(ids.every((id) => qs[id].type === 'choice' && qs[id].criteria && Object.keys(qs[id].criteria).length >= 3), 'F: 全 choice 且 criteria≥3 桶');
  ok([...DIMENSION_IDS, ...QUALITY_IDS].every((id) => qs[id].instructions.includes('怎么算')), 'F: 12 题各含「怎么算」显式算法段');
  ok(DIMENSION_IDS.every((id) => qs[id].instructions.includes('反锚')), 'F: 九维度题各含反锚段');
  ok(qs.early_bird_quality.instructions.includes('忌讳') && qs.pullback_entry_quality.instructions.includes('忌讳'), 'F: 早鸟/回调题各含忌讳段（poor 主判教学）');
  ok(q.buildBuyPointQuestions() && JSON.stringify(q.buildBuyPointQuestions()) === JSON.stringify(qs), 'F: 函数产物两调深相等（无隐藏状态）');
  // 桶域与 mapper 常量对锁（ESM/CJS 双副本漂移防线）
  ok(JSON.stringify(q.PRICE_TREND_LEVELS) === JSON.stringify(PRICE_TREND_LEVELS), 'F: PRICE_TREND_LEVELS 同域（BP5 六桶）');
  ok(!('SELL_PRESSURE_LEVELS' in q) && !('sell_pressure' in qs), 'F: sell_pressure 题与桶域常量已删（BP11 用户裁定「sell_pressure 直接删掉」——体系中无此指标）');
  ok(JSON.stringify(q.HEAT_LEVELS) === JSON.stringify(HEAT_LEVELS), 'F: HEAT_LEVELS 同域');
  ok(JSON.stringify(q.ACTIVITY_LEVELS) === JSON.stringify(ACTIVITY_LEVELS), 'F: ACTIVITY_LEVELS 同域（BP13——CD activity_level 同词表四档）');
  ok(JSON.stringify(Object.keys(qs.activity_level.criteria)) === JSON.stringify(ACTIVITY_LEVELS), 'F: activity_level 桶===ACTIVITY_LEVELS（四桶）');
  ok(JSON.stringify(q.FAMOUS_DOMINATION_LEVELS) === JSON.stringify(FAMOUS_DOMINATION_LEVELS), 'F: FAMOUS_DOMINATION_LEVELS 同域（BP14——CD D3.2 三档切点 50/25 词表）');
  ok(JSON.stringify(Object.keys(qs.famous_domination.criteria)) === JSON.stringify(FAMOUS_DOMINATION_LEVELS), 'F: famous_domination 桶===FAMOUS_DOMINATION_LEVELS（四桶 none/light/heavy/dominant）');
  ok(JSON.stringify(q.HOLDER_CONCENTRATION_LEVELS) === JSON.stringify(HOLDER_CONCENTRATION_LEVELS), 'F: HOLDER_CONCENTRATION_LEVELS 同域（BP14——CD240 分层线词表）');
  ok(JSON.stringify(Object.keys(qs.holder_concentration.criteria)) === JSON.stringify(HOLDER_CONCENTRATION_LEVELS), 'F: holder_concentration 桶===HOLDER_CONCENTRATION_LEVELS（四桶 none/weak/moderate/strong）');
  ok(JSON.stringify(q.ENTRY_POSITION_LEVELS) === JSON.stringify(ENTRY_POSITION_LEVELS), 'F: ENTRY_POSITION_LEVELS 同域（BP5 四桶）');
  ok(JSON.stringify(q.PRICE_LEVEL_LEVELS) === JSON.stringify(PRICE_LEVEL_LEVELS), 'F: PRICE_LEVEL_LEVELS 同域（BP5 五桶）');
  ok(JSON.stringify(q.TREE_POSITION_LEVELS) === JSON.stringify(TREE_POSITION_LEVELS), 'F: TREE_POSITION_LEVELS 同域（BP8 六桶）');
  ok(JSON.stringify(Object.keys(qs.tree_position.criteria)) === JSON.stringify(TREE_POSITION_LEVELS), 'F: tree_position 桶===TREE_POSITION_LEVELS（六桶）');
  // BP18 盘面分类锚（五类型学——用户裁定原话直译）
  ok(JSON.stringify(q.MARKET_PATTERN_LEVELS) === JSON.stringify(MARKET_PATTERN_LEVELS), 'F: MARKET_PATTERN_LEVELS 同域（BP18 五桶——ESM/CJS 双副本对锁）');
  ok(JSON.stringify(Object.keys(qs.market_pattern.criteria)) === JSON.stringify(MARKET_PATTERN_LEVELS), 'F: market_pattern 桶===MARKET_PATTERN_LEVELS（五桶 strong_backer/retail_pvp/famous_monopoly/early_sniper_decay/blended_unremarkable）');
  const mp = qs.market_pattern.instructions;
  ok(mp.includes('这是最好的类型') && mp.includes('开盘段结构行大额单') && mp.includes('大户卖出后有像样的承接') && mp.includes('价格已被拉高不排除①') && mp.includes('大户尚未卖出') && mp.includes('承接条件直接满足'), 'F: ①强庄盘=最好类型（BP21 承接轴——大户卖出有像样买盘承接=对倒换手流动性在场；价格拉高不排除①：定类看承接结构不看价格高度=SB 案；BP22 零卖出满足路径——大户只买未卖=强庄在场承接条件直接满足=HAUL 案防误翻⑤）');
  ok(mp.includes('没有任何像样的买方力量') && mp.includes('大户卖出、零散小散承接') && mp.includes('开盘段大额单 >0 不自动排除②') && mp.includes('这种不要参与'), 'F: ②散户 PVP=不要参与（BP21 双形状——(a) 从来无像样买单+(b) 大户卖出零散小散承接：大户向小散出货盘面散户化仍②=정책콕 案）');
  ok(mp.includes('拿了太多筹码') && mp.includes('这个盘子就是它的了'), 'F: ③famous 独食=盘子就是它的了（原话直译）');
  ok(mp.includes('购买力完全集中在最早期的数个 slot') && mp.includes('随之购买力衰竭') && mp.includes('这种盘子不要参与'), 'F: ④狙击衰竭=不要参与（原话直译）');
  ok(mp.includes('融合无明显特征盘') && mp.includes('这种出现好的点位可以赌一赌'), 'F: ⑤融合盘=好点位可赌（原话直译——中性不拦）');
  ok(mp.includes('同为开盘大额，后段死活定类'), 'F: ①④分界锚=大户买入后盘面是否仍活（同为开盘大额，后段死活定类）');
  ok(mp.includes('多笔 0.2 BNB 级左右的买入（≥2~3 笔）或单笔 0.3+ BNB 级买家=像样买方在场'), 'F: ②⑤分界双臂语义保留（BP19 突突车案——多笔 0.2 级（≥2~3 笔）或单笔 0.3+ 在场=满足大户参与不属纯散户 PVP；BP28 判序化后该双臂成为前置门判据）');
  ok(mp.includes('「多笔」是硬笔数') && mp.includes('（≥0.19 BNB 视同 0.2 级左右）的钱包须 ≥2 个') && mp.includes('仅一笔 0.2 级+其余全 0.1 级及以下=凑不成多笔仍落②'), 'F: ②「多笔」硬笔数锚（BP20 两改——到 0.2 级钱包 ≥2 个、单笔 0.2 凑不成多笔仍落②：T006/T008 单笔 0.2 判 blended 宽松执行收口）');
  ok(mp.includes('①②分界=大户卖出后谁在接') && mp.includes('承接方全是一堆很小的散户') && mp.includes('「多笔不落②」的前提是像样买方买点时刻仍在场'), 'F: ①②分界承接轴（BP21 정책콕 T001/SB T003 两案——大户卖出像样单接=①对倒、小散堆接=②散户化；「多笔不落②」前提=像样买方买点时刻仍在场，已卖离场接盘全小散走②(b)）');
  // BP23 两轴（159 点复审第 2-3 批立法）
  ok(mp.includes('大量零散小散户——这种形状可以明显看出来') && mp.includes('「一眼可辨的大量小散单」两要件缺一不落②') && mp.includes('中位尘埃级（0.0x 级，不是 0.1 级常见交易档）') && mp.includes('至少是⑤融合盘'), 'F: ②(b) 收窄=零散小散须一眼可辨（BP23/S018 吉祥B 案——「有大量零散小散户的可以明显看出来」方法论锚：中位尘埃级+前列无像样买方两要件缺一不落②；大户在场+承接 0.1~0.2 级=至少⑤）');
  ok(mp.includes('承接方是 0.1~0.2 BNB 级常见交易档单（非尘埃小散堆、买盘中位 0.1 级）且大户仍在场参与 → 不落②'), 'F: ①②分界承接中间档（BP23——大户参与+承接非零散小散不落②，至少⑤/像样级走①）');
  // BP24 案大户持续卖持续承接臂（三改：BP24 离场后承接→BP25 卖压消化过程性→BP26 卖方在场性优先三分）
  ok(mp.includes('大户持续卖+持续有承接（卖方在场性优先）') && mp.includes('卖方状态三分') && mp.includes('「一波接没下文」是这种结构的必然结局、不是锚窗内可见的状态') && mp.includes('判结构不判承接当下的活跃度'), 'F: ②(b) 第三通道卖方在场性优先三分（BP26——T001 触发时散户承接高潮致 Jev 误判⑤：「一波接没下文」是前向结局锚窗不可见 → ②卖压归零∧清仓成批/前列走空+承接只剩散户=②(b) 判结构不看承接当下活跃度）');
  ok(mp.includes('大户卖压下的②⑤分界=卖方在场性优先') && mp.includes('大户持续卖+有人持续接=混合盘；大户卖完离场+散户一波接没下文=PVP；大户在场未卖=看承接档位') && mp.includes('③大户在场持有未卖') && mp.includes('走在场承接路径不落②'), 'F: ②⑤分界卖方在场性三分（BP26——①持续卖+持续接=⑤（VirusSI P2-P4 bigSell60 0.48/0.83/1.00）；②卖完离场+散户一波接=②（T001 bigSell60=0+exitSellers=3）；③在场未卖=BP23 中间档原路径保护不落②）');
  // BP26 案大户参与判序前置（2026-11-06 S045 谷谷② 灰区单误判案——题集 BP28）
  ok(mp.includes('从来无像样买单（判序前置）'), 'F: ②(a) 判序前置声明（BP28——先判大户参与再分类，S045 灰区单案）');
  ok(mp.includes('先判「大户参与」') && mp.includes('或单笔 0.3+ BNB 级买入，且买点时刻在场=大户参与满足') && mp.includes('直接落②，不再看承接、不看盘面活跃度') && mp.includes('0.1~0.19 BNB 级灰区单不构成大户参与'), 'F: ②(a) 大户参与双臂+不满足直接落②（BP26 案立法核心——用户裁定原话「大户参与不满足是直接 pvp 盘的，满足之后根据承接再次分类」；灰区 0.1~0.19 单不构成大户参与=S045 前列 0.1568/0.1484/0.1090 三笔灰区单成因）');
  ok(mp.includes('小散互捅的盘面再活跃（新买家多、吞吐高、笔密度大）也只是散户 PVP，不是融合盘') && mp.includes('满足大户参与之后才按承接分类'), 'F: ②(a) 活跃度不救+承接分类后置（BP28——S045 被 activity high 22 秒 14 笔+8 全新买家带走判 blended 0.85 错放；小散互捅的活跃不是大户参与）');
  ok(mp.includes('大户参与（硬笔数双臂）不满足直接落②') && mp.includes('盘面活跃度不救') && mp.includes('（小散互捅的活跃不是大户参与、不是融合盘证据）') && mp.includes('满足大户参与才看承接分类'), 'F: 反锚②⑤分界判序化（BP28——「全场无任何像样买单」自由裁量句退役，硬笔数双臂不满足直接落②活跃度不救；满足后才看承接=BP21/BP23/BP26 承接轴全保留）');
  ok(qs.market_pattern.criteria.retail_pvp.includes('判序前置——先判大户参与（0.2 级钱包 ≥2 个或单笔 0.3+ 在场）：不满足（前列最大 0.1x 级灰区单/尘埃档、仅一笔 0.2 级凑不成多笔）=直接落②，盘面活跃度不救'), 'F: criteria retail_pvp 判序同步（BP28——桶描述与题面判序一致，Jev 选桶时同判序）');
  // BP27 案①庄时序锚（2026-11-06 S048 阿里美股 散户接力盘误判案——题集 BP29）
  ok(mp.includes('最早的买入（至少次早）得有大户') && mp.includes('0.19~0.2 BNB 级贴线单是「稍微大一点的散户」不是大额') && mp.includes('散户接力盘不是庄建仓，不走①至多⑤'), 'F: ①庄时序锚三句（BP29/BP27 案——用户裁定原话「如果你是庄，肯定一开盘最早期买入大额，然后对倒分仓」+措辞更正「应该是最早的买入（至少是次早）得有大户」：大额线=0.3+ 与 openSeg 同线，0.198/0.198 贴线单是稍微大一点的散户；最早（至少次早）买入无大户+之后贴线单接力=散户接力盘不走①）');
  ok(mp.includes('①的时序反锚=最早的买入（至少次早）得有大户') && mp.includes('开局最早的买入全小散铺垫、之后才来 0.19~0.2 级贴线单接盘') && mp.includes('（「一开始先小散户，然后有稍微大一点的散户接了罢了」）'), 'F: 反锚①时序反锚（BP29——S048 形状直译锚：最早的买入（开局第一秒 5 笔）全 0.03~0.14 小散+13 秒后 0.1985/0.1976 接力，双臂满足按承接分类至多⑤不走①）');
  ok(qs.market_pattern.criteria.strong_backer.includes('最早的买入（至少次早）里便有大额（单笔 0.3+，0.19~0.2 贴线单=稍微大一点的散户不算大额）') && qs.market_pattern.criteria.strong_backer.includes('最早的买入全小散铺垫+之后 0.2 级贴线单接力=散户接力盘不是庄建仓不走①（至多⑤）'), 'F: criteria strong_backer 时序锚同步（BP29——桶描述与题面判序一致）');
  ok(mp.includes('占比大且绝对额大') && mp.includes('不构成独食'), 'F: ③门槛锚=占比大且绝对额大（famous 边缘参与不构成独食）');
  ok(mp.includes('按⑤处理不硬归类') && mp.includes('⑤含「没有明确分类」语义'), 'F: 材料不足按⑤融合桶处理不硬归类（⑤语义含无明确分类）');
  ok(mp.includes('②③④由代码侧盘型门硬消费拒买'), 'F: 门桶声明=②③④盘型门硬消费、①⑤不拦（点位质量归质量题）');
  ok(JSON.stringify(q.QUALITY_LEVELS) === JSON.stringify(QUALITY_LEVELS), 'F: QUALITY_LEVELS 同域（BP6 good/neutral/poor/insufficient）');
  ok(JSON.stringify(QUALITY_LEVELS) === JSON.stringify(ASSESSMENT_LEVELS), 'F: ASSESSMENT_LEVELS（门域）与 QUALITY_LEVELS 同域（bpPassLevels 消费域不动）');
  const dimSet = new Set(DIMENSION_IDS);
  const qSet = new Set(QUALITY_IDS);
  ok(ids.every((id) => dimSet.has(id) || qSet.has(id)) && dimSet.size === 9 && qSet.size === 3, 'F: 题集 id 与 mapper DIMENSION_IDS/QUALITY_IDS 对齐（9+3——market_pattern 入维度域）');
  for (const id of QUALITY_IDS) {
    ok(JSON.stringify(Object.keys(qs[id].criteria)) === JSON.stringify(QUALITY_LEVELS), `F: ${id} 桶===QUALITY_LEVELS（四桶）`);
  }
  // 三道质量题（BP6 核心：场景判别→insufficient；按类忌讳权衡）
  const eb = qs.early_bird_quality;
  ok(eb.instructions.includes('场景') && eb.instructions.includes('insufficient'), 'F: 早鸟题含场景判别（非场景→insufficient 非差）');
  ok(eb.instructions.includes('不因低市值豁免'), 'F: 早鸟忌讳①暴涨无条件（BP4 臂保留）');
  ok(eb.instructions.includes('涨幅不是速度：不看累计涨幅、不看 chg30'), 'F: 早鸟主锚=速度非涨幅（BP10 四改用户原话「涨幅不是速度」）');
  ok(eb.instructions.includes('maxChg5Pct'), 'F: 早鸟主锚=maxChg5Pct 回看速度行（BP10：锚窗内任意 5 秒段最大涨幅）');
  ok(eb.instructions.includes('第一分支·价格低救（命中即停，肯定判 neutral 不判 poor——确定性规则，不是权衡项）'), 'F: 早鸟价格低救=第一分支命中即停肯定 neutral（BP11：确定性规则非权衡项）');
  ok(eb.instructions.includes('位置先于速度'), 'F: 早鸟位置先于速度（贴高+暴涨=接力风险）');
  ok(eb.instructions.includes('温和爬坡'), 'F: 早鸟 good=温和爬坡+买家多元');
  const pb = qs.pullback_entry_quality;
  ok(pb.instructions.includes('场景') && pb.instructions.includes('insufficient'), 'F: 回调题含场景判别（无回撤形状→insufficient）');
  ok(pb.instructions.includes('maxChg5Pct'), 'F: 回调主锚=maxChg5Pct 回看速度行（BP10 四改：前期拉升快慢，非累计涨幅非 chg30）');
  ok(pb.instructions.includes('崩塌第一腿不是健康回撤'), 'F: 回调忌讳①前期暴涨级拉升后的下跌点（BP10 用户裁定：前期上涨太快的下跌点很危险）');
  ok(pb.instructions.includes('无论回撤深浅'), 'F: 回调崩塌第一腿无条件 poor（企稳迹象不救）');
  ok(pb.instructions.includes('没跌到位'), 'F: 回调忌讳②没跌到位（接飞刀）');
  ok(pb.instructions.includes('判定按三层顺序') && pb.instructions.includes('第二层·核心规则（先于一切忌讳，命中即定档 neutral，不再评估第三层）'), 'F: 回调题=三层结构（BP12 重写：核心规则置顶先于一切忌讳——忌讳清单内救臂十轮全败后升层）');
  ok(pb.instructions.includes('**价格跌到很低 + 活跃度没有丧失 → 中等（neutral）**'), 'F: 核心规则=用户裁定原话直译（BP12「价格跌到很低，活跃度又没有丧失，可以给中等」）');
  ok(pb.instructions.includes('价格跌到很低=price_level=near_launch') && pb.instructions.includes('活跃度没有丧失=热度未死寂 ∧ 大户未清场'), 'F: 核心规则两条件=维度档位可判化（near_launch + 热度∧大户双条件——BP16/BP17 立法）');
  ok(pb.instructions.includes('大户清场两臂任一成立') && pb.instructions.includes('这种情况不要抄') && pb.instructions.includes('①规模臂') && pb.instructions.includes('②撤退臂'), 'F: 大户清场两臂=活跃度实质丧失不适用核心规则（BP17 两臂——Lily T049 用户原话「完全没有大户在了只剩几个小散户不要抄」）');
  // BP23 庄盘豁免（吉祥A/S016+S021 案——用户裁定两连）
  ok(pb.instructions.includes('庄盘豁免（先于①②查——命中则①②不适用）') && pb.instructions.includes('下跌的坑是好东西') && pb.instructions.includes('庄盘加仓范围比普通盘宽'), 'F: 回调题庄盘豁免置顶（BP23/S016+S021 案——开盘大额在场∧大户未清场=庄盘语境，忌讳①②不适用+加仓范围比普通盘宽）');
  ok(pb.instructions.includes('不止跌到很低的位置，从高点回落后的稍高位置（浅回调半山腰）也可以') && pb.instructions.includes('核心规则的「价格跌到很低」条件同步放宽') && pb.instructions.includes('low 档内的浅回调位同样 neutral'), 'F: 庄盘价格条件放宽（BP23 用户追加裁定「不仅仅是临近购买点，稍微高一点也可以」——浅回调半山腰同样 neutral；BP27 一档帽后=low 档内）');
  ok(pb.instructions.includes('豁免只解除①②，不解除③奔零④断流⑤协同') && pb.instructions.includes('开盘无大额单/大户已清场=非庄盘，照常走忌讳清单'), 'F: 庄盘豁免边界（只解除①②——奔零/断流/协同庄盘照判 poor；非庄盘照常忌讳清单）');
  ok(pb.instructions.includes('庄盘语境豁免——开盘大额在场∧大户未清场时本条不适用，下跌的坑是好东西'), 'F: 忌讳①句内庄盘豁免回指（崩塌第一腿庄盘语境不适用）');
  // BP25 案三改（S043 高点接盘——low 档收窄+庄盘豁免一档帽+mid 浅回调一律拒）
  ok(qs.price_level.instructions.includes('+50%~+100% ≈ 1.5~2 倍=偏低；+100%~+600% ≈ 2~7 倍=不高不低') && qs.price_level.criteria.low.includes('+50%~+100%，1.5~2 倍') && qs.price_level.criteria.mid.includes('+100%~+600%，2~7 倍'), 'F: price_level low 档收窄（BP27/BP25 案——原 +50~200% 装进了最低价近三倍的票（S043 +155% 判 low），用户裁定 low=较发行价 +50~100%、mid 改 +100~600%）');
  ok(qs.price_level.instructions.includes('较发行价 >+100%（2 倍以上）=已明显脱离发行价区——正常路径不构成「价格低」的可参与证据') && qs.price_level.instructions.includes('+100% 以上的位置只有非常少的情况才可参与，此类豁免口暂未开设'), 'F: price_level 反锚④不开口句（BP27——用户裁定「100% 以上应该只有非常少的情况才入，暂时还没有开这个口」）');
  ok(pb.instructions.includes('但只放宽一个档位') && pb.instructions.includes('从 near_launch 放宽到 low 档（较发行价 +50~100%）为止') && pb.instructions.includes('+100% 以上（price_level=mid 及以上）不在豁免范围') && pb.instructions.includes('庄盘也不追二倍以上的位置') && pb.instructions.includes('low 档内的浅回调位同样 neutral'), 'F: 庄盘豁免一档帽（BP27/BP25 案——用户裁定「庄盘，价格要求只是豁免一个档位」：near_launch→low 为止，mid+ 不在豁免范围）');
  ok(pb.instructions.includes('price_level=mid 及以上（较发行价 >+100%）的浅回调一律没跌到位') && pb.instructions.includes('高位浅回调没有可参与路径，庄盘豁免也不覆盖'), 'F: 忌讳②mid+ 一律句（BP27——+100% 以上不开口，高位浅回调庄盘豁免也不覆盖）');
  ok(pb.instructions.includes('不以清场否决本规则（判缺不猜，只有有证据的清场才否决）'), 'F: 大户证据缺失 fail-open（? 行不以清场否决——判缺不猜）');
  ok(pb.instructions.includes('绝对买入金额') && pb.instructions.includes('占比高≠大户'), 'F: 大户判据=持仓前三绝对买入金额非流通占比（BP17 修正锚——T047 第 1 大占 64.2% 只买 0.02=小散互捅非大户）');
  ok(pb.instructions.includes('「清仓式卖出钱包」数是快进快出噪音，不作清场主判据'), 'F: 清仓钱包数降级噪音参考（BP17 修正锚——正例 T041 清仓 6 个仍 good：真大户 0.412 刚进场锁仓）');
  ok(pb.instructions.includes('不再评估第三层') && pb.instructions.includes('卖压/holder 流向等观察证据一律不用来否决本规则（体系中本就无这两个评估指标）'), 'F: 核心规则证据闭包=忌讳与暗证据双不评估（BP11 用户裁定「我当前设计的体系中，没有这两个指标」）');
  ok(pb.instructions.includes('奔零叙事对贴近发行价的票不成立（无「从高位跌向归零」的起点与空间）'), 'F: 核心规则含奔零叙事排除（S071 阴跌+holders −3 不构成低位奔零证据）');
  ok(pb.instructions.includes('「跌到位」的要求只对涨过一截（low+）的票适用——没涨起来就无所谓跌到位'), 'F: 跌到位要求限 low+ 票（BP11 三改发现②触发条件与救臂同域的盲区句，BP12 收进核心规则）');
  ok(pb.instructions.includes('half_off/ankle_cut 腰斩级=跌过头是崩塌形状，不算「跌到很低」，走第三层'), 'F: 核心规则深崩排除（S026 near_launch+half_off 深崩不救——SB 案分界锁定）');
  ok(pb.instructions.includes('奔着归零'), 'F: 回调忌讳③奔着归零（阴跌+流失+派发）');
  ok(pb.instructions.includes('企稳'), 'F: 回调 good=深回撤后企稳（急砸+买盘回流）');
  const hc = qs.high_chase_quality;
  ok(hc.instructions.includes('一律 poor'), 'F: 追高题策略停买=一律 poor（BP4 硬路由精神保留——放开只改本题面）');
  ok(hc.instructions.includes('insufficient'), 'F: 追高题非场景→insufficient（不贡献聚合）');
  // price_trend BP6 短窗锚（用户裁定：近窗趋势 5/10/30s）
  ok(qs.price_trend.instructions.includes('近 5/10/30 秒'), 'F: price_trend 动量窗=5/10/30s（BP6 短窗）');
  ok(qs.price_trend.instructions.includes('chg5/10/30Pct'), 'F: price_trend 引用短窗键族');
  ok(qs.price_trend.instructions.includes('速度参照：|chg30| 两位数'), 'F: price_trend 速度参照=|chg30| 两位数界（30s 仍为最长窗）');
  ok(qs.price_trend.instructions.includes('快升不等于该追'), 'F: price_trend 反锚⑤只述事实不判买卖');
  ok(qs.entry_position.instructions.includes('currentVsAthPct') && qs.entry_position.instructions.includes('mcapFromPeakPct'), 'F: entry_position 怎么算=价格口径+市值口径双源互证');
  ok(qs.entry_position.instructions.includes('35%~70%') && qs.entry_position.instructions.includes('脚脖子斩'), 'F: entry_position 回撤分界四档（<10/10~35/35~70/>70——BP5 用户桶名）');
  ok(qs.entry_position.instructions.includes('8-9 BNB') && qs.entry_position.instructions.includes('市值位置行'), 'F: entry_position 反锚④贴高与市值位置并读（BP2 臂保留）');
  ok(qs.price_level.instructions.includes('currentVsLaunchPct') && qs.price_level.instructions.includes('launchPriceBnb'), 'F: price_level 怎么算=发行价位置行两键（BP5 新增维度）');
  ok(qs.price_level.instructions.includes('未覆盖出生段'), 'F: price_level 反锚④? 行=材料缺失不猜（截窗不冒充）');
  ok(qs.price_level.instructions.includes('破发') && qs.price_level.instructions.includes('near_launch'), 'F: price_level 破发负值归接近发行价桶');
  ok(qs.market_heat.instructions.includes('活跃度是入场的必要条件'), 'F: market_heat 反锚④活跃度门槛教学（BP8 门①消费 low 档）');
  // activity_level 题面（BP13：CD 七要素判法搬运——判读倾向临近买点段）
  const al = qs.activity_level;
  ok(al.instructions.includes('买入点位之前的盘面活跃度') && al.instructions.includes('判读倾向临近买入点位段'), 'F: activity_level 题头=买点前窗口+临近段倾向（BP12 案用户原话「活跃度检测要倾向于检测买入点位之前的」）');
  ok(al.instructions.includes('与市场热度题（market_heat，近 30/60s 密度视角）分工'), 'F: activity_level 与 market_heat 分工声明（两题并读非替代——原题保留）');
  for (const seg of ['无交易期占比', '笔密度', '买盘中位数为主、笔均为辅', '单向死水推进', '开盘极早窗反锚', '金额吞吐', '停滞突发反锚', '临近买入点位段（锚窗末端 30 秒=买点前最后 30 秒）', '全窗量级综合锚']) {
    ok(al.instructions.includes(seg), `F: activity_level 七要素+综合锚段在场：${seg.slice(0, 18)}`);
  }
  ok(al.instructions.includes('数值行「临近买点段」事实已算好直接采信'), 'F: activity_level ⑦ 消费 state 临近买点段行（D3.59 搬运）');
  ok(al.instructions.includes('活跃度门直接消费拒买（活跃度不够不参与交易——买点之前盘面已冷=无承接）'), 'F: activity_level 收尾=门消费声明（镜像 market_heat 反锚④）');
  ok(al.criteria.low.includes('临近买点段（最后 30 秒）') && al.criteria.low.includes('四腿联立'), 'F: activity_level low 桶=临近段死寂+四腿联立双臂');
  ok(al.criteria.high.includes('金额吞吐与之相称') && al.criteria.high.includes('尘埃假活跃不入本档'), 'F: activity_level high 桶=吞吐相称门槛（假活跃不入高档——ZELDA 案失真修复）');
  // famous_domination 题面（BP14：CD famous 控盘判法搬运——BEM Miner 案）
  const fd = qs.famous_domination;
  ok(fd.instructions.includes('不是热度也不是买盘强弱，是**谁拿着货**'), 'F: famous_domination 题头=谁拿着货（筹码控制非热度）');
  ok(fd.instructions.includes('[PRECOMPUTED] 筹码结构行'), 'F: famous_domination 怎么算消费 state 筹码结构行');
  ok(fd.instructions.includes('≥50=dominant') && fd.instructions.includes('25~50=heavy') && fd.instructions.includes('<25 但 famous 在场有持仓=light'), 'F: famous_domination 三档切点 50/25（CD D3.2 同款）');
  ok(fd.instructions.includes('跟单集中度') && fd.instructions.includes('集团买入占比') && fd.instructions.includes('从重'), 'F: famous_domination 联立加重臂（G17 D 通道同款判读——top3≥45/groupBuy≥80 从重）');
  ok(fd.instructions.includes('**买过 ≠ 持有**') && fd.instructions.includes('正净持仓'), 'F: famous_domination 反锚①买过≠持有（正净持仓口径）');
  ok(fd.instructions.includes('dominant 档由代码侧筹码门直接消费拒买'), 'F: famous_domination 收尾=门消费声明（BEM 案主拦截臂）');
  ok(fd.instructions.includes('BEM Miner') && fd.instructions.includes('74.5'), 'F: famous_domination 形状样本=BEM 实测（出生 5s 74.5%→87.5%）');
  // holder_concentration 题面（BP14：CD240 分层线判法搬运）
  const hc2 = qs.holder_concentration;
  ok(hc2.instructions.includes('持有者基数分层') || hc2.instructions.includes('分层判法（持有者基数分层'), 'F: holder_concentration 分层判法声明');
  for (const seg of ['**持有者 ≥10**', '**持有者 6~9**', '**持有者 ≤5**', '单一 >45% 或 前二 >55% 或 前三 >70%']) {
    ok(hc2.instructions.includes(seg), `F: holder_concentration 分层线段在场：${seg}`);
  }
  ok(hc2.instructions.includes('**参与/持有分叉**') && hc2.instructions.includes('拉高出货'), 'F: holder_concentration 参与持有分叉=拉高出货前奏度量');
  ok(hc2.instructions.includes('极早窗筹码集中是价格发现常态'), 'F: holder_concentration 反锚①极早窗从宽（价格发现期天然集中）');
  ok(hc2.instructions.includes('价格临近发行价豁免持有者不均衡') && hc2.instructions.includes('currentVsLaunchPct ≤ +50%') && hc2.instructions.includes('不坐实 strong'),
    'F: holder_concentration 反锚⑥价格豁免锚（BP15 谷谷案——贴发行价头部无浮盈可砸，不坐实 strong）');
  ok(hc2.instructions.includes('只豁本题（holder 集中轴），不豁 famous 控盘题'), 'F: holder_concentration 豁免⑥限定 holder 轴（BEM famous dominant 验收零翻案防线）');
  ok(hc2.instructions.includes('谷谷案·价格豁免正例') && hc2.instructions.includes('56.5%'), 'F: holder_concentration 形状样本含谷谷正例（6~9 过线+佐证但 +25% 贴发行价→豁免落观察档）');
  ok(hc2.instructions.includes('top1 单一 >90%') && hc2.instructions.includes('一人控盘'), 'F: holder_concentration 一人控盘例外（≤5 豁免域破例 strong）');
  ok(hc2.instructions.includes('strong 档由代码侧筹码门直接消费拒买'), 'F: holder_concentration 收尾=门消费声明');
  ok(hc2.instructions.includes('BEM Miner') && hc2.instructions.includes('BOSS'), 'F: holder_concentration 形状样本=BEM（一人控盘）+BOSS（CD240 ≥10 过线坐实）双对照');
  // tree_position 题面（BP8 观察档——形状+位置；圣诞树门裁定暂不参与决策，题照问攒分布）
  const tp = qs.tree_position;
  ok(tp.instructions.includes('暴涨暴跌'), 'F: tree_position 形状=暴涨暴跌反常 → not_tree（非正常用户行为形状）');
  ok(tp.instructions.includes('形状判断不出来') && tp.instructions.includes('unclear') && tp.instructions.includes('≠ not_tree'), 'F: tree_position unclear=形状判不出非 not_tree（前期树形未成形是常态）');
  ok(tp.instructions.includes('左侧') && tp.instructions.includes('顶部') && tp.instructions.includes('右侧底部'), 'F: tree_position 位置四态=左侧/顶部/右侧/树脚（用户原话桶名）');
  ok(tp.instructions.includes('多树串联') || tp.instructions.includes('一棵结束后连着下一棵'), 'F: tree_position 多圣诞树串联教学');
  ok(tp.instructions.includes('小圣诞树结束') && tp.instructions.includes('大圣诞树开始'), 'F: tree_position 狙击手回调=小树结束/大树开始（用户原话）');
  ok(tp.instructions.includes('摆动结构行'), 'F: tree_position 怎么算引用摆动结构行（BP8 数值锚）');
  ok(tp.instructions.includes('贴高≠自动 top'), 'F: tree_position 反锚①贴高≠自动 top（首树左侧爬坡进行时）');
  ok(!tp.instructions.includes('形状门') && !tp.criteria.not_tree.includes('拦') && !tp.criteria.unclear.includes('放行'),
    'F: tree_position 门语义措辞绝迹（观察档反证——不参与决策不暗示拦截/放行）');
  // 三质量题场景判别挂树（BP8）
  ok(qs.early_bird_quality.instructions.includes('left_side'), 'F: 早鸟场景挂树=left_side/unclear 佐证（树形未成形正是早鸟窗口）');
  ok(qs.pullback_entry_quality.instructions.includes('right_bottom') && qs.pullback_entry_quality.instructions.includes('大圣诞树开始'), 'F: 回调场景挂树=树脚/小树结束大树开始');
  ok(qs.high_chase_quality.instructions.includes('top 佐证') || qs.high_chase_quality.instructions.includes('tree_position=top'), 'F: 追高场景挂树=top 佐证（首树左侧贴高不是追高）');

  // ═══════════════ G/H/I. scripts/buy-point/lib.mjs（ESM dynamic import） ═══════════════
  console.log('G. 60s 窗去重');
  const lib = await import(pathToFileURL(path.join(__dirname, 'buy-point', 'lib.mjs')).href);
  const T = (s) => `2026-11-03T12:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.000Z`;
  const sig = (id, token, iso, exp = 1) => ({ id, token_address: token, created_at: iso, experiment_id: exp });
  const TK1 = '0x' + 'c1'.repeat(20), TK2 = '0x' + 'c2'.repeat(20);
  ok(lib.dedupeBuySignals([sig('a', TK1, T(0)), sig('b', TK1, T(55))]).length === 1, 'G: 55s 间隔 → 只留首');
  ok(lib.dedupeBuySignals([sig('a', TK1, T(0)), sig('b', TK1, T(65))]).length === 2, 'G: 65s 间隔 → 双留');
  ok(lib.dedupeBuySignals([sig('a', TK1, T(0)), sig('b', TK1, T(60))]).length === 1, 'G: 恰 60.0s → 不留（严格 >）');
  ok(lib.dedupeBuySignals([sig('a', TK1, T(0), 1), sig('b', TK1, T(30), 2)]).length === 1, 'G: 跨实验同 token 全局去重');
  ok(lib.dedupeBuySignals([sig('a', TK1, T(0)), sig('b', TK2, T(30))]).length === 2, 'G: 跨 token 不去重');
  const shuffled = [sig('c', TK1, T(120)), sig('a', TK1, T(0)), sig('b', TK2, T(10)), sig('d', TK1, T(60)), sig('e', TK2, T(20))];
  const keptG = lib.dedupeBuySignals(shuffled);
  ok(keptG.map((s) => s.id).join(',') === 'a,b,c', `G: 乱序收敛+全局升序（TK1 留 a/c——d 恰 60s 被去重；TK2 留 b；实际 ${keptG.map((s) => s.id).join(',')}）`);
  ok(lib.dedupeBuySignals([sig('a', TK1, null)]).length === 0, 'G: 无 created_at 丢弃');
  // 窗从上次**保留**起算（非上一信号）：链 0/65/125/180 → s2 恰 60s 被去重、s3 距上次保留 115s 再留
  const chain = [0, 65, 125, 180].map((t, i) => sig('s' + i, TK1, T(t)));
  ok(lib.dedupeBuySignals(chain).map((s) => s.id).join(',') === 's0,s1,s3', 'G: 窗从上次保留起算（125−65 恰 60s 去重）');

  console.log('H. 前向收益（entry=锚末可靠价/horizon 半开/峰值回落）');
  const T0H = '2026-11-03T12:00:00.000Z';
  const atH = (dt) => new Date(Date.parse(T0H) + dt * 1000).toISOString();
  const hrow = (dt, price, outlier = false) => ({ block_time: atH(dt), block_number: 100 + dt, log_index: 0, trade_type: 'buy', bnb_amount: 0.1, token_amount: 1e6, price_bnb: price, price_outlier: outlier, trader_address: W_B, sender_address: W_B, tx_hash: '0x' + dt, quote_token: null });
  const rowsH = [hrow(0, 1.0), hrow(5, 99, true), hrow(10, 1.1), hrow(65, 1.2), hrow(70, 1.15), hrow(400, 0.9)];
  const fr = lib.computeForwardReturns(rowsH, 3); // 锚=前 3 行，tA=10s，entry=1.1（outlier 行跳过）
  ok(fr.entryPriceBnb === 1.1 && fr.anchorTimeIso === atH(10), `H: entry=1.1 / 锚时刻=t+10s（实际 ${fr.entryPriceBnb}/${fr.anchorTimeIso}）`);
  const h60 = fr.byHorizon[60], h300 = fr.byHorizon[300], h900 = fr.byHorizon[900];
  ok(h60 && h60.maxRisePct === 9.09 && h60.lastPct === 4.55 && h60.pullbackFromMaxPct === -4.17, `H: +1min 9.09/4.55/−4.17（实际 ${JSON.stringify(h60)}）`);
  ok(h300 && h300.maxRisePct === 9.09, 'H: +5min 同窗（400s 行不入 310s 界）');
  ok(h900 && h900.maxRisePct === 9.09 && h900.lastPct === -18.18 && h900.pullbackFromMaxPct === -25.00, `H: +15min 含 0.9 尾行 −18.18/−25.00（实际 ${JSON.stringify(h900)}）`);
  ok(lib.computeForwardReturns(rowsH, 0) === null, 'H: anchorCount=0 → null');
  const frNoWin = lib.computeForwardReturns([hrow(0, 1)], 1);
  ok(frNoWin !== null && frNoWin.entryPriceBnb === 1 && frNoWin.byHorizon[60] === null && frNoWin.byHorizon[900] === null, 'H: 锚后零行 → 三 horizon 全 null（entry 照常在场）');
  const frThin = lib.computeForwardReturns(rowsH, 3, { horizonsSec: [15] });
  ok(frThin.byHorizon[15] === null, 'H: horizon 窗内可靠价<2 → null');
  const frOut = lib.computeForwardReturns([hrow(0, 1.0), hrow(5, 50, true), hrow(10, 2.0)], 3);
  ok(frOut.entryPriceBnb === 2.0, 'H: outlier 不推 entry（天价行跳过）');

  console.log('I. as-of 与 episode');
  const rowsI = [hrow(0, 1.0), hrow(10, 1.1), hrow(20, 1.2)];
  ok(lib.anchorCountAt(rowsI, atH(10)) === 2, 'I: anchorCountAt ≤锚时刻计数=2（宁多勿少口径单点 re-export）');
  ok(lib.anchorCountAt(rowsI, null) === 0, 'I: 无锚时刻 → 0');
  ok(lib.sliceAsOf(rowsI, 2).length === 2, 'I: sliceAsOf 截 2');
  assert.throws(() => lib.sliceAsOf(rowsI, 4), /行数不足/, 'I: sliceAsOf 不足 throw');
  assert.throws(() => lib.sliceAsOf(rowsI, -1), /n 非法/, 'I: sliceAsOf n 非法 throw');
  const trow = (min, dir, input, output) => ({ trade_direction: dir, input_amount: input, output_amount: output, created_at: `2026-11-03T10:${String(min).padStart(2, '0')}:00Z`, executed_at: null });
  const tradesI = [
    trow(0, 'buy', 0.5, 60),
    trow(5, 'sell', 60, 0.35),
    trow(10, 'buy', 0.4, 80),
    trow(15, 'sell', 50, 0.3),
    trow(20, 'sell', 30, 0.2),
    trow(25, 'buy', 0.1, 20),
  ];
  const eps = lib.buildEpisodes(tradesI);
  ok(eps.length === 3 && eps[0].trades.length === 2 && !eps[0].open, 'I: episode1 闭合（买1卖1）');
  ok(eps[1].trades.length === 3 && !eps[1].open, 'I: episode2 闭合（买1卖2）');
  ok(eps[2].trades.length === 1 && eps[2].open, 'I: episode3 open');
  ok(near(lib.episodePnlBnb(eps[0]).pnlBnb, -0.15), 'I: ep1 pnl=−0.15（0.35−0.5）');
  ok(near(lib.episodePnlBnb(eps[1]).pnlBnb, 0.1), 'I: ep2 pnl=+0.1（0.5−0.4）');
  const ep3m = lib.episodePnlBnb(eps[2], { markPriceBnb: 0.012 });
  ok(ep3m.open && near(ep3m.pnlBnb, 0.14) && near(ep3m.openQtyToken, 20), 'I: open 盯市 0−0.1+20×0.012=0.14');
  const ep3u = lib.episodePnlBnb(eps[2]);
  ok(ep3u.open && ep3u.pnlBnb === null && near(ep3u.openQtyToken, 20), 'I: open 无盯市价 → pnl null 只记余量');
  ok(lib.episodePnlBnb({ trades: [trow(0, 'sell', 10, 0.05)] }) === null, 'I: 卖先于买 → null 防御');
  ok(lib.episodePnlBnb(null) === null, 'I: 空 episode → null');
  ok(lib.quoteTokenOf([{ quote_token: null }, { quote_token: 'USDT' }, { quote_token: null }]) === 'USDT', 'I: quoteTokenOf 尾扫');

  console.log('\nJ. 成交买点映射（buildTradePoints——BP3 trades 源）');
  const TOKEN_L = '0x' + 'ee'.repeat(20);
  const tr1 = { id: 'tr-1', token_address: TOKEN_L, input_currency: 'BNB', input_amount: 0.1, output_amount: 5e7, executed_at: '2026-11-05T01:02:03Z', created_at: '2026-11-05T01:02:02Z', signal_id: 'sig-9' };
  const tr2 = { id: 'tr-2', token_address: TOKEN_L, input_currency: 'USDT', input_amount: 60, output_amount: 5e7, created_at: '2026-11-05T02:00:00Z' };
  const ptsJ = lib.buildTradePoints([tr1, tr2], 'exp-1');
  ok(ptsJ.length === 2, 'J: 行数透传');
  ok(near(ptsJ[0].priceBnb, 2e-9), `J: BNB 换算=input/output=2e-9（实际 ${ptsJ[0].priceBnb}）`);
  ok(ptsJ[1].priceBnb === null, 'J: 非 BNB input_currency → null 不冒充（USD 域 unit_price 禁冒充 BNB fire 价）');
  ok(ptsJ[0].created_at === '2026-11-05T01:02:03Z', 'J: 点位时刻=executed_at 优先');
  ok(ptsJ[1].created_at === '2026-11-05T02:00:00Z', 'J: executed_at 缺失回退 created_at');
  ok(ptsJ[0].experiment_id === 'exp-1' && ptsJ[0].signalId === 'sig-9' && ptsJ[0].tradeId === 'tr-1', 'J: provenance 字段（experiment/signalId/tradeId）');
  ok(ptsJ[0].signalInfo.price === ptsJ[0].priceBnb && ptsJ[0].signalInfo.strategyName === null, 'J: signalInfo 同构（price=BNB 价/strategyName null）');
  ok(lib.buildTradePoints(null, 'e').length === 0, 'J: 空行 → 空数组');

  console.log('K. cheat/unhealthy 剔除（filterByCheatGrades）');
  const A_K = '0x' + 'aa'.repeat(20), B_K = '0x' + 'bb'.repeat(20), C_K = '0x' + 'cc'.repeat(20), D_K = '0x' + 'dd'.repeat(20);
  const gmK = new Map([[A_K, 'cheat'], [B_K, 'unhealthy'], [C_K, 'healthy']]);
  const ptsK = [{ token_address: A_K }, { token_address: B_K }, { token_address: C_K }, { token_address: D_K }];
  const fK = lib.filterByCheatGrades(ptsK, gmK);
  ok(fK.kept.length === 2 && fK.excluded.length === 2, 'K: cheat+unhealthy 剔 / healthy+无判定留');
  ok(fK.excluded[0].token === A_K && fK.excluded[0].grade === 'cheat' && fK.excluded[1].grade === 'unhealthy', 'K: excluded 明细（token+grade）');
  ok(fK.kept[0].token_address === C_K && fK.kept[1].token_address === D_K, 'K: 保留序不变');
  ok(lib.filterByCheatGrades(ptsK).kept.length === 4, 'K: 空判定图全放行（gradeMap 缺省）');

  console.log('L. ladder 挖掘（mineLadderPoints 真 FA 重放——BP3 零 DB 零网络）');
  const { mineLadderPoints } = await import(pathToFileURL(path.join(__dirname, 'buy-point', 'mine-ladder.mjs')).href);
  const rowsL = [];
  for (let i = 1; i <= 5; i++) rowsL.push(row(i * 3, 'BUY', W_B, 0.1, 1e-9 * (100 + i), 1e8, { trader: ROUTER, sender: W_B }));
  rowsL.push(row(30, 'SELL', W_C, 0.05, 1e-9 * 90, 5e7));
  rowsL.forEach((r) => { r.token_address = TOKEN_L; });
  const metaL = { address: TOKEN_L, symbol: 'TESTL', name: 'Test L', platform: 'fourmeme', createdAt: at(0), creatorAddress: CREATOR, totalSupply: 1e9 };
  const legsL = [
    { id: 'tA', priority: 1, condition: 'tradeCount >= 3 AND buyVolumeBnb >= 0.3' },
    { id: 'tB', priority: 2, condition: 'tradeCount >= 5' },
    { id: 'tC', priority: 3, condition: 'tradeCount >= 99' },
  ];
  const hitsL = mineLadderPoints({ rowsAsc: rowsL, meta: metaL, legs: legsL });
  ok(hitsL.length === 2, `L: 两腿首触发（tA/tB 命中、tC 永假零点位；实际 ${hitsL.map((h) => h.legId).join(',')}）`);
  const hA = hitsL.find((h) => h.legId === 'tA');
  const hB = hitsL.find((h) => h.legId === 'tB');
  ok(hA && hA.anchorTickCount === 3, `L: tA 首真在第 3 行（tradeCount=3 ∧ buyVolumeBnb=0.3；实际 ${hA && hA.anchorTickCount}）`);
  ok(hB && hB.anchorTickCount === 5, `L: tB 首真在第 5 行（实际 ${hB && hB.anchorTickCount}）`);
  ok(hA && hA.tsIso === rowsL[2].block_time, 'L: 触发时刻=触发行 block_time');
  ok(hA && Number.isFinite(hA.priceBnb) && hA.priceBnb > 0, 'L: priceBnb=触发时刻 FA currentPriceBnb');
  ok(hA && hA.factors && hA.factors.tradeCount === 3 && near(hA.factors.buyVolumeBnb, 0.3), 'L: 因子摘要（tradeCount/buyVolumeBnb 触发时刻值）');
  ok(hA && hA.condition === legsL[0].condition, 'L: 腿条件随行（provenance）');
  ok(mineLadderPoints({ rowsAsc: [], meta: metaL, legs: legsL }).length === 0, 'L: 空 rows → []');
  ok(mineLadderPoints({ rowsAsc: rowsL, meta: metaL, legs: [] }).length === 0, 'L: 空 legs → []');
  let threwParse = false;
  try { mineLadderPoints({ rowsAsc: rowsL, meta: metaL, legs: [{ id: 'tBad', priority: 9, condition: 'tradeCount >=' }] }); }
  catch (e) { threwParse = true; }
  ok(threwParse, 'L: 条件解析失败 → throw fail-loud');

  console.log(`\n✅ buy_point_lib 全部通过（${passed} 断言）`);
})().catch((e) => {
  console.error('\n❌ FAIL:', e && e.message);
  console.error(e);
  process.exit(1);
});
