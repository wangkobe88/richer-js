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
  BP_SWING_THRESHOLD_PCT, detectSwings,
} = require('../src/market-analysis/buy-point-snapshot');
const { buildBuyPointState, MAX_STATE_CHARS } = require('../src/market-analysis/buy-point-state-builder');
const {
  buildBuyPointObservation, DIMENSION_IDS, QUALITY_IDS,
  PRICE_TREND_LEVELS, SELL_PRESSURE_LEVELS, HEAT_LEVELS,
  ENTRY_POSITION_LEVELS, PRICE_LEVEL_LEVELS, TREE_POSITION_LEVELS, QUALITY_LEVELS, ASSESSMENT_LEVELS,
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
ok(stD.state.includes('市值位置(BNB 域): 现价市值 1.6 / 窗内峰市值 2 / 较峰回撤 20.00%'), 'D: 市值位置行手算值渲染（BP2）');
ok(stD.state.includes('holder 流向: 现正净持仓钱包 7 个；近 60s 变化 -1'), 'D: holder 流向行渲染（W_D 尾窗清仓净流失）');
ok(stD.state.includes('发行价位置: 现价较发行价 +60.0%') && stD.state.includes('发行价 1.00e-9 BNB'), 'D: 发行价位置行渲染（BP5——fmtPrice 同 [PRICE] 口径）');
ok(stD.state.includes('摆动结构(圣诞树原料): 谷@t+5s→峰@t+110s，现处下跌段') && stD.state.includes('段幅度（旧→新）+100%/105s、-30%/75s')
  && stD.state.includes('摆点 峰1/谷1，最大单段摆幅 100%') && stD.state.includes('现价较最近摆动峰 -20.00% / 较最近摆动谷 +60.00%'),
  'D: 摆动结构行渲染（BP8 手算值——zigzag 峰谷序列/段幅度/现价较峰谷）');
ok(stD.state.includes('判定结构') && stD.state.includes('暂不参与决策') && stD.state.includes('早鸟≈树左侧早段、回调≈树脚企稳'),
  'D: 判定指引两层结构+圣诞树观察档声明（BP8——暂不参与决策+三题挂树教学）');
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
  ...mkAns('sell_pressure', 'low'),
  ...mkAns('market_heat', 'high'),
  ...mkAns('entry_position', 'near_high'),
  ...mkAns('price_level', 'near_launch'),
  ...mkAns('tree_position', 'left_side'),
  ...mkAns('early_bird_quality', 'neutral', 0.7),
  ...mkAns('pullback_entry_quality', 'insufficient', 0.8),
  ...mkAns('high_chase_quality', 'poor', 0.61),
});
const obsE = buildBuyPointObservation(fullAnswers(), dA);
ok(Object.keys(obsE.dimensions).length === 6 && obsE.dimensions.price_trend.bucket === 'fast_up', 'E: 六维度 argmax 透传（BP8 增 tree_position）');
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
let aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_heat', 'low', 0.88) }, dA).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.88) && aM.rule === 'activity_gate', 'E: 门① heat=low → poor/activity_gate（prob=门题 argmax）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_heat', 'low', 0.88), ...mkAns('early_bird_quality', 'good', 0.95) }, dA).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'activity_gate', 'E: 门① 优先于质量题（早鸟 good 0.95 不救——活跃度不够不参与）');
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
ok(!['not_tree', 'position_gate'].includes(aM.rule), 'E: rule 域圣诞树门值绝迹（activity_gate/any_good/any_neutral/else_poor 四值——观察档反证）');
const noTree = { ...fullAnswers() };
delete noTree.tree_position;
ok(buildBuyPointObservation(noTree, dA).assessment.rule === 'any_neutral' && buildBuyPointObservation(noTree, dA).dimensions.tree_position === null,
  'E: tree_position 答案缺席 → 维度 null 容缺+聚合照走（拒=有证据的拒绝）');
ok(buildBuyPointObservation(fullAnswers(), dA).dimensions.tree_position.bucket === 'left_side', 'E: tree_position 维度 argmax 透传（六维度）');
ok(obsE.anchors.chg5Pct === 6.67 && obsE.anchors.chg10Pct === 6.67 && obsE.anchors.chg30Pct === 14.29, 'E: 动量短窗族三键透传（BP6 5/10/30）');
ok(obsE.anchors.swingHighCount === 1 && obsE.anchors.swingLowCount === 1 && obsE.anchors.swingLastDir === -1
  && obsE.anchors.secSinceSwingHigh === 105 && obsE.anchors.secSinceSwingLow === 210
  && obsE.anchors.currentVsSwingHighPct === -20 && obsE.anchors.currentVsSwingLowPct === 60
  && obsE.anchors.swingMaxAmplPct === 100, 'E: 摆动结构族 8 键透传（BP8 圣诞树原料）');
ok(obsE.anchors.swingPoints === undefined && obsE.anchors.swingLegs === undefined, 'E: swingPoints/swingLegs 数组不进锚（state 渲染原料）');
ok(obsE.anchors.chg60Pct === undefined && obsE.anchors.chg120Pct === undefined, 'E: chg60/chg120 键绝迹（BP6 短窗反证）');
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
const partial = { ...fullAnswers() };
delete partial.price_level;
const obsPartial = buildBuyPointObservation(partial, dA);
ok(obsPartial.dimensions.price_level === null && obsPartial.dimensions.price_trend.bucket === 'fast_up', 'E: 维度题缺席 → null 容缺（在场照读；质量题不许缺席）');

(async () => {
  // ═══════════════ F. 题集形状（CJS 经 dynamic import） ═══════════════
  console.log('F. 题集形状（BP7 九题/桶域对锁/活跃度门+三类质量题+圣诞树观察档/两调深相等）');
  const q = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'market-analysis', 'llm', 'buy-point-questions.mjs')).href);
  ok(q.BUY_POINT_QUESTIONS_VERSION === 'BP7', 'F: 版本=BP7（活跃度门+圣诞树形状与位置观察档+摆动结构锚）');
  const qs = q.buildBuyPointQuestions();
  const ids = Object.keys(qs);
  ok(ids.length === 9, `F: 恰 9 题=6 维度+3 质量题（实际 ${ids.length}）`);
  ok(ids[0] === 'price_trend' && ids[3] === 'entry_position' && ids[4] === 'price_level' && ids[5] === 'tree_position', 'F: 维度序=price_trend/sell/heat/entry/level/tree（前 6 题）');
  ok(JSON.stringify(ids.slice(6)) === JSON.stringify(QUALITY_IDS), 'F: 后 3 题=early_bird/pullback_entry/high_chase 质量题（BP6 用户裁定）');
  ok(!('point_category' in qs) && !('buy_point_assessment' in qs), 'F: 类别题/综合题已删（BP6 形态反证——路由依赖从根消除）');
  ok(!('price_momentum' in qs) && !('buy_pressure_quality' in qs) && !('chip_flow' in qs) && !('pace_trend' in qs), 'F: 四道旧维度题已删（BP5 瘦身反证）');
  ok(ids.every((id) => qs[id].type === 'choice' && qs[id].criteria && Object.keys(qs[id].criteria).length >= 3), 'F: 全 choice 且 criteria≥3 桶');
  ok([...DIMENSION_IDS, ...QUALITY_IDS].every((id) => qs[id].instructions.includes('怎么算')), 'F: 9 题各含「怎么算」显式算法段');
  ok(DIMENSION_IDS.every((id) => qs[id].instructions.includes('反锚')), 'F: 六维度题各含反锚段');
  ok(qs.early_bird_quality.instructions.includes('忌讳') && qs.pullback_entry_quality.instructions.includes('忌讳'), 'F: 早鸟/回调题各含忌讳段（poor 主判教学）');
  ok(q.buildBuyPointQuestions() && JSON.stringify(q.buildBuyPointQuestions()) === JSON.stringify(qs), 'F: 函数产物两调深相等（无隐藏状态）');
  // 桶域与 mapper 常量对锁（ESM/CJS 双副本漂移防线）
  ok(JSON.stringify(q.PRICE_TREND_LEVELS) === JSON.stringify(PRICE_TREND_LEVELS), 'F: PRICE_TREND_LEVELS 同域（BP5 六桶）');
  ok(JSON.stringify(q.SELL_PRESSURE_LEVELS) === JSON.stringify(SELL_PRESSURE_LEVELS), 'F: SELL_PRESSURE_LEVELS 同域');
  ok(JSON.stringify(q.HEAT_LEVELS) === JSON.stringify(HEAT_LEVELS), 'F: HEAT_LEVELS 同域');
  ok(JSON.stringify(q.ENTRY_POSITION_LEVELS) === JSON.stringify(ENTRY_POSITION_LEVELS), 'F: ENTRY_POSITION_LEVELS 同域（BP5 四桶）');
  ok(JSON.stringify(q.PRICE_LEVEL_LEVELS) === JSON.stringify(PRICE_LEVEL_LEVELS), 'F: PRICE_LEVEL_LEVELS 同域（BP5 五桶）');
  ok(JSON.stringify(q.TREE_POSITION_LEVELS) === JSON.stringify(TREE_POSITION_LEVELS), 'F: TREE_POSITION_LEVELS 同域（BP8 六桶）');
  ok(JSON.stringify(Object.keys(qs.tree_position.criteria)) === JSON.stringify(TREE_POSITION_LEVELS), 'F: tree_position 桶===TREE_POSITION_LEVELS（六桶）');
  ok(JSON.stringify(q.QUALITY_LEVELS) === JSON.stringify(QUALITY_LEVELS), 'F: QUALITY_LEVELS 同域（BP6 good/neutral/poor/insufficient）');
  ok(JSON.stringify(QUALITY_LEVELS) === JSON.stringify(ASSESSMENT_LEVELS), 'F: ASSESSMENT_LEVELS（门域）与 QUALITY_LEVELS 同域（bpPassLevels 消费域不动）');
  const dimSet = new Set(DIMENSION_IDS);
  const qSet = new Set(QUALITY_IDS);
  ok(ids.every((id) => dimSet.has(id) || qSet.has(id)) && dimSet.size === 6 && qSet.size === 3, 'F: 题集 id 与 mapper DIMENSION_IDS/QUALITY_IDS 对齐（6+3）');
  for (const id of QUALITY_IDS) {
    ok(JSON.stringify(Object.keys(qs[id].criteria)) === JSON.stringify(QUALITY_LEVELS), `F: ${id} 桶===QUALITY_LEVELS（四桶）`);
  }
  // 三道质量题（BP6 核心：场景判别→insufficient；按类忌讳权衡）
  const eb = qs.early_bird_quality;
  ok(eb.instructions.includes('场景') && eb.instructions.includes('insufficient'), 'F: 早鸟题含场景判别（非场景→insufficient 非差）');
  ok(eb.instructions.includes('不因低市值豁免'), 'F: 早鸟忌讳①急拉/已拉高无条件（BP4 臂保留）');
  ok(eb.instructions.includes('位置先于速度'), 'F: 早鸟位置先于速度（贴高+快升=接力风险）');
  ok(eb.instructions.includes('温和爬坡'), 'F: 早鸟 good=温和爬坡+买家多元');
  const pb = qs.pullback_entry_quality;
  ok(pb.instructions.includes('场景') && pb.instructions.includes('insufficient'), 'F: 回调题含场景判别（无回撤形状→insufficient）');
  ok(pb.instructions.includes('没跌到位'), 'F: 回调忌讳①没跌到位（接飞刀）');
  ok(pb.instructions.includes('奔着归零'), 'F: 回调忌讳②奔着归零（阴跌+流失+派发）');
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
