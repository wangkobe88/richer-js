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
} = require('../src/market-analysis/buy-point-snapshot');
const { buildBuyPointState, MAX_STATE_CHARS } = require('../src/market-analysis/buy-point-state-builder');
const {
  buildBuyPointObservation, DIMENSION_IDS, ASSESSMENT_ID,
  MOMENTUM_LEVELS, PRESSURE_QUALITY_LEVELS, CHIP_FLOW_LEVELS, SELL_PRESSURE_LEVELS,
  HEAT_LEVELS, PACE_LEVELS, ENTRY_POSITION_LEVELS, POINT_CATEGORY_LEVELS, ASSESSMENT_LEVELS,
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
ok(dA.chg30Pct === 14.29, `chg30=14.29%（1.6/1.4，实际 ${dA.chg30Pct}）`);
ok(dA.chg60Pct === 3.23, `chg60=3.23%（1.6/1.55，实际 ${dA.chg60Pct}）`);
ok(dA.chg120Pct === 0, `chg120=0.00%（1.6/1.6，实际 ${dA.chg120Pct}）`);

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
ok(dC0.chg30Pct === null && dC0.chg60Pct === null && dC0.chg120Pct === null, 'C: 无可靠价 → chg 族 null');
ok(dC0.currentVsAthPct === null && dC0.secSinceAth === null && dC0.madeHigh120 === null, 'C: priceArc 缺 → 位置族 null');
ok(dC0.rateTrend === null && dC0.halfTpmEarly === null && dC0.halfTpmLate === null, 'C: 两半窗皆 0 → rateTrend=null');
ok(dC0.burst5In120 === null, 'C: 窗内行 <2 → burst null');
ok(dC0.tokenAgeSec === null && dC0.spanSec === null, 'C: 无 tick → tokenAge/span null');

const rowsCOut = [row(5, 'BUY', W_B, 0.1, 99 * E9, 1e8, { outlier: true }), row(15, 'SELL', W_B, 0.05, 98 * E9, 5e7, { outlier: true })];
const dCOut = buildBuyPointSnapshot(rowsCOut, metaA).buyDerived;
ok(dCOut.chg30Pct === null && dCOut.priceBuckets.length === 0, 'C: 全 outlier → 价格族全缺（资金照算 win.buyBnb=0.1）');
ok(near(dCOut.win[30].buyBnb, 0.1), 'C: outlier 行资金照计');

const rowsCTok = [row(5, 'BUY', W_B, 0.1, 1.0 * E9, null), row(60, 'SELL', W_B, 0.05, 1.1 * E9, 5e7)];
const dCTok = buildBuyPointSnapshot(rowsCTok, metaA).buyDerived;
ok(dCTok.bigHolderSellBnb60 === null && dCTok.exitSellerCount60 === null, 'C: token_amount 任一行缺失 → 卖压族 null fail-closed');
ok(dCTok.holdersNow === null && dCTok.holdersDelta60 === null, 'C: token_amount 缺失 → holder 流向族 null fail-closed（BP2）');

// supply 缺失（meta.totalSupply 空洞）：可靠价在场也不冒充市值（BP2——两族证据门独立）
const dCNoSupply = buildBuyPointSnapshot(rowsA, { ...metaA, totalSupply: null }).buyDerived;
ok(dCNoSupply.mcapBnb === null && dCNoSupply.mcapPeakBnb === null && dCNoSupply.mcapFromPeakPct === null, 'C: supply 缺失 → 市值位置族 null fail-closed（BP2）');
ok(dCNoSupply.holdersNow === 7 && dCNoSupply.holdersDelta60 === -1, 'C: supply 缺失不影响 holder 族（证据门独立，实际 7/-1）');

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
ok(stD.state.includes('近窗动量(涨跌%): 30s 14.29% / 60s 3.23% / 120s 0.00%'), 'D: chg 手算值渲染');
ok(stD.state.includes('清仓式卖出钱包 1 个'), 'D: 卖压行 exitSellerCount60=1');
ok(stD.state.includes('市值位置(BNB 域): 现价市值 1.6 / 窗内峰市值 2 / 较峰回撤 20.00%'), 'D: 市值位置行手算值渲染（BP2）');
ok(stD.state.includes('holder 流向: 现正净持仓钱包 7 个；近 60s 变化 -1'), 'D: holder 流向行渲染（W_D 尾窗清仓净流失）');
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

// ═══════════════ E. mapper（容错双轨 + 纯透传反证） ═══════════════
console.log('E. mapper（容错双轨/纯透传反证）');
const mkAns = (id, bucket, prob = 0.9) => ({ [id]: { probabilities: { [bucket]: prob, [bucket === 'good' ? 'neutral' : 'good']: 1 - prob } } });
const fullAnswers = () => ({
  ...mkAns('price_momentum', 'moderate'),
  ...mkAns('buy_pressure_quality', 'weak'),
  ...mkAns('chip_flow', 'accumulating'),
  ...mkAns('sell_pressure', 'low'),
  ...mkAns('market_heat', 'high'),
  ...mkAns('pace_trend', 'heating'),
  ...mkAns('entry_position', 'near_high'),
  ...mkAns('point_category', 'early_bird'),
  ...mkAns('buy_point_assessment', 'poor', 0.61),
});
const obsE = buildBuyPointObservation(fullAnswers(), dA);
ok(Object.keys(obsE.dimensions).length === 8 && obsE.dimensions.price_momentum.bucket === 'moderate', 'E: 七维度+类别题 argmax 透传（BP3）');
ok(obsE.dimensions.point_category.bucket === 'early_bird', 'E: 类别题（point_category）进 dimensions 透传（BP3）');
ok(obsE.assessment.bucket === 'poor' && near(obsE.assessment.prob, 0.61), 'E: 综合判定 argmax+prob 透传');
const jsonE = JSON.stringify(obsE);
ok(!jsonE.includes('"verdict"') && !jsonE.includes('"grade"') && !jsonE.includes('"score"') && !jsonE.includes('"recommendation"'), 'E: 观测记录无 verdict/grade/score/recommendation 键（纯透传反证）');
ok(obsE.anchors.chg30Pct === 14.29, 'E: 锚负数保留（chg30 正值臂）');
const obsNeg = buildBuyPointObservation(fullAnswers(), { ...dA, chg30Pct: -12.34, win: dA.win });
ok(obsNeg.anchors.chg30Pct === -12.34, 'E: chg 负值 −12.34 照读（不以 null 吞）');
ok(obsE.anchors.win60BuyBnb !== undefined && near(obsE.anchors.win60BuyBnb, 0.27), 'E: win 族扁平键 win60BuyBnb 透传');
ok(obsE.anchors.mcapBnb === 1.6 && obsE.anchors.mcapPeakBnb === 2 && obsE.anchors.mcapFromPeakPct === 20, 'E: 市值位置族三键透传（BP2）');
ok(obsE.anchors.holdersNow === 7 && obsE.anchors.holdersDelta60 === -1, 'E: holder 流向族两键透传（BP2，delta 负值照读不吞）');
ok(buildBuyPointObservation(fullAnswers(), null).assessment.bucket === 'poor', 'E: anchors 缺省 null 容忍');
const badAnchor = buildBuyPointObservation(fullAnswers(), { ...dA, chg30Pct: 'not-a-number' });
ok(badAnchor.anchors.chg30Pct === null, 'E: 非数值锚形状异常 → null 不冒充');

assert.throws(() => buildBuyPointObservation({ ...fullAnswers(), buy_point_assessment: undefined }, dA), /答案缺失/, 'E: 综合题缺答案 throw');
assert.throws(() => buildBuyPointObservation({ ...fullAnswers(), buy_point_assessment: { probabilities: { excellent: 0.9 } } }, dA), /未知桶名/, 'E: 综合题未知桶 throw');
assert.throws(() => buildBuyPointObservation({ ...fullAnswers(), buy_point_assessment: {} }, dA), /答案缺失|无概率分布/, 'E: 综合题空答案 throw');
assert.throws(() => buildBuyPointObservation({ ...fullAnswers(), price_momentum: { probabilities: { extreme: 0.9 } } }, dA), /未知桶名/, 'E: 维度题在场未知桶 throw');
const partial = { ...fullAnswers() };
delete partial.chip_flow;
delete partial.point_category;
const obsPartial = buildBuyPointObservation(partial, dA);
ok(obsPartial.dimensions.chip_flow === null && obsPartial.dimensions.price_momentum.bucket === 'moderate', 'E: 维度题缺席 → null 容缺（在场照读）');
ok(obsPartial.dimensions.point_category === null, 'E: 类别题缺席 → null 容缺（同维度轨道，不强制）');

(async () => {
  // ═══════════════ F. 题集形状（CJS 经 dynamic import） ═══════════════
  console.log('F. 题集形状（BP4 九题/桶域对锁/分类判读框架/两调深相等）');
  const q = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'market-analysis', 'llm', 'buy-point-questions.mjs')).href);
  ok(q.BUY_POINT_QUESTIONS_VERSION === 'BP4', 'F: 版本=BP4');
  const qs = q.buildBuyPointQuestions();
  const ids = Object.keys(qs);
  ok(ids.length === 9, `F: 恰 9 题（实际 ${ids.length}）`);
  ok(ids[ids.length - 2] === 'point_category' && ids[ids.length - 1] === ASSESSMENT_ID, 'F: 类别题居综合题前（分路→权衡序）');
  ok(ids.every((id) => qs[id].type === 'choice' && qs[id].criteria && Object.keys(qs[id].criteria).length >= 3), 'F: 全 choice 且 criteria≥3 桶');
  ok(DIMENSION_IDS.every((id) => qs[id].instructions.includes('怎么算')), 'F: 七维度+类别题各含「怎么算」显式算法段');
  ok(DIMENSION_IDS.every((id) => qs[id].instructions.includes('反锚')), 'F: 七维度+类别题各含反锚段');
  ok(qs[ASSESSMENT_ID].instructions.includes('降档'), 'F: 综合题含协同形状降档处理教学');
  ok(q.buildBuyPointQuestions() && JSON.stringify(q.buildBuyPointQuestions()) === JSON.stringify(qs), 'F: 函数产物两调深相等（无隐藏状态）');
  // 桶域与 mapper 常量对锁（ESM/CJS 双副本漂移防线）
  ok(JSON.stringify(q.MOMENTUM_LEVELS) === JSON.stringify(MOMENTUM_LEVELS), 'F: MOMENTUM_LEVELS 同域');
  ok(JSON.stringify(q.PRESSURE_QUALITY_LEVELS) === JSON.stringify(PRESSURE_QUALITY_LEVELS), 'F: PRESSURE_QUALITY_LEVELS 同域');
  ok(JSON.stringify(q.CHIP_FLOW_LEVELS) === JSON.stringify(CHIP_FLOW_LEVELS), 'F: CHIP_FLOW_LEVELS 同域');
  ok(JSON.stringify(q.SELL_PRESSURE_LEVELS) === JSON.stringify(SELL_PRESSURE_LEVELS), 'F: SELL_PRESSURE_LEVELS 同域');
  ok(JSON.stringify(q.HEAT_LEVELS) === JSON.stringify(HEAT_LEVELS), 'F: HEAT_LEVELS 同域');
  ok(JSON.stringify(q.PACE_LEVELS) === JSON.stringify(PACE_LEVELS), 'F: PACE_LEVELS 同域');
  ok(JSON.stringify(q.ENTRY_POSITION_LEVELS) === JSON.stringify(ENTRY_POSITION_LEVELS), 'F: ENTRY_POSITION_LEVELS 同域');
  ok(JSON.stringify(q.POINT_CATEGORY_LEVELS) === JSON.stringify(POINT_CATEGORY_LEVELS), 'F: POINT_CATEGORY_LEVELS 同域（BP3）');
  ok(JSON.stringify(q.ASSESSMENT_LEVELS) === JSON.stringify(ASSESSMENT_LEVELS), 'F: ASSESSMENT_LEVELS 同域（good/neutral/poor/insufficient 不动=服务端零改动）');
  const dimSet = new Set(DIMENSION_IDS);
  ok(ids.every((id) => id === ASSESSMENT_ID || dimSet.has(id)) && dimSet.size === 8, 'F: 题集 id 与 mapper DIMENSION_IDS/ASSESSMENT_ID 对齐（8+1）');
  ok(Object.keys(qs[ASSESSMENT_ID].criteria).every((b) => ASSESSMENT_LEVELS.includes(b)), 'F: 综合题桶===ASSESSMENT_LEVELS');
  // 类别题（point_category——BP3 核心）
  const cat = qs.point_category;
  ok(cat.instructions.includes('tokenAgeSec') && cat.instructions.includes('currentVsAthPct') && cat.instructions.includes('mcapPeakBnb'), 'F: 类别题三轴材料引用（时间轴/位置轴/轨迹轴）');
  ok(cat.instructions.includes('只判**类别事实**') && cat.instructions.includes('不下入场结论'), 'F: 类别题只判类别不下买卖结论（权衡归综合题）');
  ok(cat.instructions.includes('早鸟与回调的分界是') && cat.instructions.includes('贴高≠自动 high_chase'), 'F: 类别题反锚（分界=是否走完一波拉升再跌下来/贴高不自动追高）');
  ok(JSON.stringify(Object.keys(cat.criteria)) === JSON.stringify(POINT_CATEGORY_LEVELS), 'F: 类别题桶===POINT_CATEGORY_LEVELS（四桶）');
  ok(qs[ASSESSMENT_ID].instructions.includes('狙击'), 'F: 综合题角色代入（狙击交易者）');
  ok(qs[ASSESSMENT_ID].instructions.includes('材料太薄'), 'F: 综合题薄窗 insufficient 指引');
  // BP3 分类判读框架（用户裁定 2026-11-05：早鸟/回调/追高三类，先分类后按类忌讳权衡）
  const insA = qs[ASSESSMENT_ID].instructions;
  ok(insA.includes('第一步先按类别题') && insA.includes('point_category'), 'F: 综合题判读总纲=先分类后权衡（路由轴=类别题）');
  ok(['early_bird', 'pullback_entry', 'high_chase', 'unclear'].every((c) => insA.includes(c)), 'F: 四类分路段全在场');
  ok(insA.includes('不买极快速上涨'), 'F: 早鸟类核心忌讳=不买极快速上涨/已拉高（用户原话锚）');
  ok(insA.includes('不因低市值豁免'), 'F: 早鸟忌讳无条件化（BP4：急拉/已拉高不因低市值豁免——对拍 good 误放修正）');
  ok(insA.includes('位置先于动能'), 'F: 早鸟类位置先于动能（贴高强买压=接力风险非入场信号）');
  ok(insA.includes('仅限温和爬坡'), 'F: 豁免臂收紧=仅限温和爬坡（BP4）');
  ok(insA.includes('没跌到位'), 'F: 回调类忌讳①没跌到位（半山腰接飞刀）');
  ok(insA.includes('奔着归零'), 'F: 回调类忌讳②下跌奔着归零去（阴跌+流失+枯竭）');
  ok(insA.includes('先等等') && insA.includes('无条件一律 poor'), 'F: 追高类本轮先等等=无条件一律 poor（BP4 硬路由）');
  ok(insA.includes('分路是硬路由'), 'F: 总纲硬路由声明（维度档位不构成跨路放行）');
  ok(insA.includes('unclear') && insA.includes('insufficient'), 'F: unclear → insufficient 分路');
  ok(insA.includes('活跃度门槛') && insA.includes('降档'), 'F: 通用条保留（活跃门槛/协同降档不下结论）');
  ok(insA.includes('mcapBnb 尚低') && insA.includes('8-9 BNB'), 'F: 早鸟类豁免臂引用市值位置行（8-9 BNB 阈，BP2 收编）');
  ok(insA.includes('holdersDelta60 为负') && insA.includes('bigHolderSellBnb60'), 'F: 回调类归零臂引用 holder 流向行+大持仓卖压行');
  ok(qs[ASSESSMENT_ID].criteria.poor.includes('先等等'), 'F: poor 桶描述含追高类留痕');
  ok(qs[ASSESSMENT_ID].criteria.good.includes('不含追高类'), 'F: good 桶描述显式排除追高类（BP4 桶描述级防线）');
  // 四维度题 BP2 反锚补强（BP3 原样保留）
  ok(qs.price_momentum.instructions.includes('8-9 BNB'), 'F: momentum 反锚④追高低市值豁免臂');
  ok(qs.entry_position.instructions.includes('8-9 BNB') && qs.entry_position.instructions.includes('市值位置行'), 'F: entry_position 反锚④贴高与市值位置并读');
  ok(qs.chip_flow.instructions.includes('holdersDelta60'), 'F: chip_flow 怎算②holder 流向行 + 反锚④阴跌流失臂');
  ok(qs.market_heat.instructions.includes('活跃度是入场的必要条件'), 'F: market_heat 反锚④活跃度门槛教学（拒买权衡归综合题）');

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
