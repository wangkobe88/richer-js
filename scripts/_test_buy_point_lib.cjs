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
  BP_SWING_THRESHOLD_PCT, BP_OPEN_SEG_SEC, BP_OPEN_BIG_BUY_BNB, BP_TAIL_SEC, detectSwings,
} = require('../src/market-analysis/buy-point-snapshot');
const { buildBuyPointState, MAX_STATE_CHARS } = require('../src/market-analysis/buy-point-state-builder');
const {
  buildBuyPointObservation, DIMENSION_IDS,
  PRICE_TREND_LEVELS, HEAT_LEVELS, ACTIVITY_LEVELS,
  FAMOUS_DOMINATION_LEVELS, HOLDER_CONCENTRATION_LEVELS,
  ENTRY_POSITION_LEVELS, PRICE_LEVEL_LEVELS,
  MARKET_PATTERN_LEVELS, PATTERN_GATE_POOR_BUCKETS,
  ACTIVITY_GATE_POOR_BUCKETS, CHIP_GATE_FAMOUS_POOR_BUCKETS,
  SUSTAINED_CLIMB_LAUNCH_PCT, RESTART_LAUNCH_PCT,
  STRONG_BACKER_LAUNCH_PCT, BLENDED_LAUNCH_PCT, GOLDEN_POINT_LAUNCH_PCT,
  ASSESSMENT_LEVELS,
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
// BP28 案四改：锚前尾段三键手算——A fixture tEnd=215，尾段 dt>210 只有行18@215
ok(BP_TAIL_SEC === 5, 'BP_TAIL_SEC 常量=5（锚前尾段固定子窗）');
ok(dA.activity.nearTail5TickN === 1 && dA.activity.nearTail5BuyN === 1 && near(dA.activity.nearTail5BuyBnb, 0.1)
  && dA.activity.nearTail5BuySharePct === 2.2, `A fixture 尾段=1 笔买 0.1 占全窗买 2.2%（dt>210 只有行18@215；全窗买 4.47 → 0.1/4.47，实际 ${dA.activity.nearTail5TickN}/${dA.activity.nearTail5BuyN}/${dA.activity.nearTail5BuyBnb}/${dA.activity.nearTail5BuySharePct}）`);
{
  // S053 三段形状迷你 fixture（BP28 案立法形状回归锁定）：开局冲 3 笔（dt 2/4/6）
  // →中段完全静默 40s→锚前 4s 涌入 4 笔（dt 46/47/48/49 买 0.2/0.25/0.2/0.15）
  // ——临近段 totals（30s 段 7 笔/段内最大间隔 40s）呈现死寂、尾段行见涌入
  const rowsT = [
    row(2, 'BUY', W_B, 0.1, 1.0 * E9, 1e8),
    row(4, 'BUY', W_C, 0.1, 1.0 * E9, 1e8),
    row(6, 'BUY', W_D, 0.1, 1.05 * E9, 1e8),
    row(46, 'BUY', W_E, 0.2, 1.1 * E9, 2e8),
    row(47, 'BUY', W_F, 0.25, 1.1 * E9, 2.5e8),
    row(48, 'BUY', W_G, 0.2, 1.15 * E9, 2e8),
    row(49, 'BUY', W_H, 0.15, 1.15 * E9, 1.5e8),
  ];
  const dT = buildBuyPointSnapshot(rowsT, metaA).buyDerived;
  ok(dT.activity.nearTail5TickN === 4 && dT.activity.nearTail5BuyN === 4 && near(dT.activity.nearTail5BuyBnb, 0.8)
    && dT.activity.nearTail5BuySharePct === 72.7, `三段形状尾段=4 笔全买合计 0.8 占全窗买 72.7%（dt>44 全入尾段；全窗买 1.1 → 0.8/1.1，实际 ${dT.activity.nearTail5TickN}/${dT.activity.nearTail5BuyN}/${dT.activity.nearTail5BuyBnb}/${dT.activity.nearTail5BuySharePct}）`);
  // 死寂臂：末行单笔尘级——末行 dt=tEnd 恒在尾段内（最少 1 笔），「仅 1 笔尘级」
  // 才是买点时刻死寂的直接证据（0 笔数学上不存在）
  const rowsDead = [
    row(2, 'BUY', W_B, 0.5, 1.0 * E9, 5e8),
    row(42, 'BUY', W_C, 0.02, 1.0 * E9, 2e7),
  ];
  const dDead = buildBuyPointSnapshot(rowsDead, metaA).buyDerived;
  ok(dDead.activity.nearTail5TickN === 1 && dDead.activity.nearTail5BuyN === 1 && near(dDead.activity.nearTail5BuyBnb, 0.02)
    && dDead.activity.nearTail5BuySharePct === 3.8, `死寂臂尾段=仅末行 1 笔 0.02 尘级占全窗买 3.8%（tEnd=42 前静默 40s；全窗买 0.52 → 0.02/0.52——两成线以下=burst 已过形状，实际 ${dDead.activity.nearTail5TickN}/${dDead.activity.nearTail5BuyN}/${dDead.activity.nearTail5BuyBnb}/${dDead.activity.nearTail5BuySharePct}）`);
}
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
// arc.last=1.6e-9 → +60.0%；arc.ath=2.0e-9 → 锚窗最高较发行 +100.0%（BP39）
ok(dA.launchCovered === true && near(dA.launchPriceBnb, 1.0 * E9) && dA.currentVsLaunchPct === 60,
  `launch 族：覆盖=true / 发行价=1e-9 / 现价较发行 +60%（实际 ${dA.launchCovered}/${dA.launchPriceBnb}/${dA.currentVsLaunchPct}）`);
ok(dA.athVsLaunchPct === 100,
  `athVsLaunchPct=+100（锚窗最高 2e-9 ÷ 发行价 1e-9 −1=+100.0%，BP39「开盘拉得过高」度量锚——Jev 组合不了 currentVsLaunch+currentVsAth 两数故直供，实际 ${dA.athVsLaunchPct}）`);
// minVsLaunchPct=锚窗涨起后最低较发行价 %（BP43 restart 轨迹锚；BP44 定义=首个突破
// +20% 离开 almost_launch 起（含离开那一笔）的最低）：dA 首个 >1.2e-9=行4（1.3e-9；
// 行3=1.2 恰等不算离开），涨起后段最低=行4 本身 1.3e-9（其后再未低于 1.3）→ +30.0%
// ——涨过 +100% 后只回到 +30，未回到 almost_launch（>20）；
// 刻意不取整窗最低（整窗最低=发行价本身 → 恒 0% 结构性失效）
ok(dA.minVsLaunchPct === 30,
  `minVsLaunchPct=+30（涨起后最低 1.3e-9 ÷ 发行价 1e-9=+30.0%——涨起后段最低=突破行本身，其后最低 1.4 未再低于；整窗最低恒=发行价不作判据，实际 ${dA.minVsLaunchPct}）`);
{
  // BP43 restart 形状微夹具手算：1.0→1.4→2.0(ATH)→1.3→1.05→1.3——首个突破 1.2=行2(1.4)，
  // 涨起后段最低 1.05=+5.0% ≤20（重启盘价格回到腿成立）；对照单调涨（1.0→1.2→1.5→1.8，
  // 首个突破 1.2=行3(1.5)）涨起后段最低 1.5=+50.0% >20=从未回到（值非 null——判据不成立而非无证据）
  const rowsR = [
    row(10, 'BUY', W_B, 0.1, 1.0 * E9, 1e8),
    row(20, 'BUY', W_C, 0.1, 1.4 * E9, 1e8),
    row(30, 'BUY', W_D, 0.1, 2.0 * E9, 1e8),
    row(40, 'SELL', W_E, 0.1, 1.3 * E9, 1e8),
    row(50, 'BUY', W_F, 0.1, 1.05 * E9, 1e8),
    row(60, 'BUY', W_G, 0.1, 1.3 * E9, 1e8),
  ];
  const dR = buildBuyPointSnapshot(rowsR, metaA).buyDerived;
  ok(dR.minVsLaunchPct === 5 && dR.currentVsLaunchPct === 30 && dR.athVsLaunchPct === 100,
    `restart 形状：涨起后最低 +5.0% ≤20（回到腿成立）/现价 +30%/ATH +100%（实际 ${dR.minVsLaunchPct}/${dR.currentVsLaunchPct}/${dR.athVsLaunchPct}）`);
  const rowsMono = [
    row(10, 'BUY', W_B, 0.1, 1.0 * E9, 1e8),
    row(20, 'BUY', W_C, 0.1, 1.2 * E9, 1e8),
    row(30, 'BUY', W_D, 0.1, 1.5 * E9, 1e8),
    row(40, 'BUY', W_E, 0.1, 1.8 * E9, 1e8),
  ];
  const dMono = buildBuyPointSnapshot(rowsMono, metaA).buyDerived;
  ok(dMono.minVsLaunchPct === 50,
    `单调涨（从未回落）：涨起后最低 +50.0% >20=从未回到 almost_launch——值非 null（有证据的「没回到」，BP44 定义下不再因 ATH 在末位失明；回到腿不成立，实际 ${dMono.minVsLaunchPct}）`);
  // BP44 案核心形状（bt-s01 0x28ad2c7d）：回落 almost_launch 后重新拉起创新高——
  // 1.0→1.5→1.1→1.05→1.6(ATH 在末位)。BP43 首版「峰后」定义下 ATH 在末位→null 结构性
  // 失明（对拍 0/9 判④根因）；涨起后定义=首个突破 1.2=行2(1.5) 之后段最低 1.05=+5.0%
  // ≤20 → 回到腿成立（创新高不遮蔽回落）
  const rowsNH = [
    row(10, 'BUY', W_B, 0.1, 1.0 * E9, 1e8),
    row(20, 'BUY', W_C, 0.1, 1.5 * E9, 1e8),
    row(30, 'SELL', W_D, 0.1, 1.1 * E9, 1e8),
    row(40, 'SELL', W_E, 0.1, 1.05 * E9, 1e8),
    row(50, 'BUY', W_F, 0.1, 1.6 * E9, 1e8),
  ];
  const dNH = buildBuyPointSnapshot(rowsNH, metaA).buyDerived;
  ok(dNH.minVsLaunchPct === 5 && dNH.athVsLaunchPct === 60 && dNH.currentVsLaunchPct === 60,
    `创新高重启形状（BP44 案核心）：涨起后最低 +5.0% ≤20（回到腿成立——ATH 在末位不失明）/ATH +60%=现价（重新拉起创新高中）（实际 ${dNH.minVsLaunchPct}/${dNH.athVsLaunchPct}/${dNH.currentVsLaunchPct}）`);
  // 从未离开 almost_launch（1.0→1.1→1.15，全程 ≤+20%）→ null（无「回到」语义不冒充）
  const rowsStay = [
    row(10, 'BUY', W_B, 0.1, 1.0 * E9, 1e8),
    row(20, 'BUY', W_C, 0.1, 1.1 * E9, 1e8),
    row(30, 'SELL', W_D, 0.1, 1.05 * E9, 1e8),
    row(40, 'BUY', W_E, 0.1, 1.15 * E9, 1e8),
  ];
  const dStay = buildBuyPointSnapshot(rowsStay, metaA).buyDerived;
  ok(dStay.minVsLaunchPct === null,
    `从未离开 almost_launch（全程 ≤+20%）→ null（无「回到」语义不冒充，实际 ${dStay.minVsLaunchPct}）`);
}
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
ok(dCStart.athVsLaunchPct === null, 'C: athVsLaunchPct 同族 null（launchCovered 域内 fail-closed，BP39）');
ok(dCStart.minVsLaunchPct === null, 'C: minVsLaunchPct 同族 null（launchCovered 域内 fail-closed，BP43——截窗不冒充发行价往返轨迹）');

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
  ok(keysAct === 'buyMedianBnb,idlePct,maxDrawdownPct,nearSegBnbPerMin,nearSegBuyMedianBnb,nearSegBuyN,nearSegMaxGapSec,nearSegSellN,nearSegTickN,nearSegTicksPerMin,nearTail5BuyBnb,nearTail5BuyN,nearTail5BuySharePct,nearTail5TickN,spanSec,throughputBnbPerMin,tickCount', `C: activity 恰 17 键（BP41 尾段加占比锚 16→17，实际 ${keysAct}）`);
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
ok(stD.state.includes('锚前尾段(最后5秒):') && stD.state.includes('买点时刻的即时状态——多笔且金额可观=锚点落在涌入波内') && stD.state.includes('仅 1 笔/尘级=锚点即静默边界')
  && stD.state.includes('合计买 0.1 BNB、占全窗买入 2.2%') && stD.state.includes('两成上下=burst 已过的顶部、三分之一以上=拉升进行时'), 'D: 锚前尾段行渲染（BP31/BP28 案四改+BP41 占比口径——A fixture 手算 0.1/4.47=2.2%；占比判读句两成/三分之一线）');
ok(stD.state.includes('市值位置(BNB 域): 现价市值 1.6 / 窗内峰市值 2 / 较峰回撤 20.00%'), 'D: 市值位置行手算值渲染（BP2）');
ok(stD.state.includes('holder 流向: 现正净持仓钱包 7 个；近 60s 变化 -1'), 'D: holder 流向行渲染（W_D 尾窗清仓净流失）');
ok(stD.state.includes('发行价位置: 现价较发行价 +60.0%') && stD.state.includes('发行价 1.00e-9 BNB'), 'D: 发行价位置行渲染（BP5——fmtPrice 同 [PRICE] 口径）');
ok(stD.state.includes('锚窗最高价较发行价 +100.0%'), 'D: 发行价位置行渲染锚窗最高价较发行价（BP39 athVsLaunchPct——锚窗 ATH 2e-9 ÷ 发行价 1e-9）');
ok(stD.state.includes('锚窗涨起后最低价较发行价 +30.0%'), 'D: 发行价位置行渲染锚窗涨起后最低价较发行价（BP43 minVsLaunchPct——涨起后段最低 1.3e-9 ÷ 发行价 1e-9，restart 重启盘回到腿判据行）');
ok(stD.state.includes('④开盘拉高出货盘新形态'), 'D: 判定指引行含 BP39 新形态句');
ok(!stD.state.includes('摆动结构') && !stD.state.includes('圣诞树原料'),
  'D: 摆动结构行已删（BP30/题集 BP33 tree_position 退役——state 不再渲染圣诞树原料行，zigzag 锚照算落 digest 纯留档）');
ok(stD.state.includes('判定结构') && stD.state.includes('①盘型门（预判断，最前）') && stD.state.includes('早鸟/回调两道质量题与 tree_position、追高质量题均已退役'),
  'D: 判定指引纯门链结构+质量题/tree/追高退役声明（BP48 两质量题退役+BP30 盘型前置预判断）');
ok(stD.state.includes('②活跃度门') && stD.state.includes('activity_level=ultra（机器盘级极端密集）'),
  'D: 判定指引②活跃度门 ultra 臂声明（BP30 改三——「act 为 ultra 也不玩」）');
ok(stD.state.includes('③筹码门') && stD.state.includes('famous 控盘（famous_domination）heavy 或 dominant（≥25=famous 主导就不玩；light=正常参与不拦）'),
  'D: 判定指引③筹码门 heavy 扩档声明（BP30 改一——famous 主导就不玩）');
ok(stD.state.includes('持续拉升弱回调（sustained_climb）代码侧位置门判定：现价仍临近发行价（≤+10% 含破发）的起点段放行、已拉离发行价=不参与（判型归你、位置归代码）'),
  'D: 判定指引①盘型门⑥位置臂声明（BP34/BP31 案——只能临近发布价格参与；判型归 Jev 位置归代码）');
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

// ═══════════════ E. mapper（BP48/案号 BP44 纯门链——两质量题退役+盘型位置门收口 + 容错双轨 + 纯透传反证） ═══════════════
console.log('E. mapper（BP48 纯门链/容错双轨/纯透传反证）');
const mkAns = (id, bucket, prob = 0.9) => ({ [id]: { probabilities: { [bucket]: prob, [bucket === 'good' ? 'neutral' : 'good']: 1 - prob } } });
const fullAnswers = () => ({
  ...mkAns('price_trend', 'fast_up'),
  ...mkAns('market_heat', 'high'),
  ...mkAns('activity_level', 'mid'),
  ...mkAns('famous_domination', 'none'),
  ...mkAns('holder_concentration', 'none'),
  ...mkAns('entry_position', 'near_high'),
  ...mkAns('price_level', 'near_launch'),
  ...mkAns('market_pattern', 'blended_unremarkable', 0.8),
  // BP48 两质量题（early_bird_quality/pullback_entry_quality）退役——不在 fullAnswers
});
const dE = { ...dA, currentVsLaunchPct: 30 }; // obsE 专用锚：blended ≤+40 过⑤位置门（dA 原 +60 会被 BP48 ⑤新门拒——⑤断言见下）
const obsE = buildBuyPointObservation(fullAnswers(), dE);
ok(Object.keys(obsE.dimensions).length === 8 && obsE.dimensions.price_trend.bucket === 'fast_up' && obsE.dimensions.activity_level.bucket === 'mid', 'E: 八维度 argmax 透传（BP30 删 tree_position 后 9→8；BP48 无质量题）');
ok(!('tree_position' in obsE.dimensions) && !('qualities' in obsE), 'E: tree_position/qualities 键绝迹（BP30/BP48 退役反证）');
ok(!('point_category' in obsE.dimensions) && JSON.stringify(obsE).indexOf('point_category') === -1 && JSON.stringify(obsE).indexOf('buy_point_assessment') === -1, 'E: point_category/buy_point_assessment 键绝迹（BP6 形态反证）');
ok(obsE.assessment.bucket === 'neutral' && obsE.assessment.prob === null && obsE.assessment.rule === 'gates_passed', 'E: 纯门链全过 → neutral/gates_passed（prob=null——BP48 无质量层）');
const jsonE = JSON.stringify(obsE);
ok(!jsonE.includes('"verdict"') && !jsonE.includes('"grade"') && !jsonE.includes('"score"') && !jsonE.includes('"recommendation"'), 'E: 观测记录无 verdict/grade/score/recommendation 键（纯透传反证——rule 是门来源留痕不在禁列）');
// BP48 旧档重放兼容：带两质量题答案的旧 answers 不被消费不 throw（键忽略）
{
  const legacyAns = { ...fullAnswers(), ...mkAns('early_bird_quality', 'good', 0.95), ...mkAns('pullback_entry_quality', 'poor', 0.6) };
  const aLegacyQ = buildBuyPointObservation(legacyAns, dE).assessment;
  ok(aLegacyQ.bucket === 'neutral' && aLegacyQ.rule === 'gates_passed', 'E: 旧档带质量题答案不被消费（BP48 重放兼容——答案键忽略不 throw）');
}
// BP8 活跃度门+圣诞树观察档（用户裁定：①活跃度 low 不参与；②圣诞树锚「暂时先不
// 参与决策…可以先放里头」——tree 各桶一律不拦，题照问答照落攒分布）
// BP13 门扩双题：market_heat low（近窗密度）OR activity_level low（买点前全窗量级
// ——CD 七要素判法搬运，ZELDA 案：market_heat 纯密度对「每分钟成交额 BNB」失真）
let aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_heat', 'low', 0.88) }, dE).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.88) && aM.rule === 'activity_gate', 'E: 门① heat=low → poor/activity_gate（prob=门题 argmax；act=mid 不参与）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('activity_level', 'low', 0.81) }, dE).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.81) && aM.rule === 'activity_gate', 'E: 门① BP13 臂 act=low（heat=high）→ poor/activity_gate（买点前全窗量级死寂——ZELDA 形状拦截臂）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_heat', 'low', 0.7), ...mkAns('activity_level', 'low', 0.93) }, dE).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.93) && aM.rule === 'activity_gate', 'E: 门② 双 low → prob 取两臂最大（同 rule 留痕）');
// BP30 改三 ultra 臂：act=ultra 机器盘级极端密集同拒（로켓급 S086/雪球SI S092 形状——
// 用户裁定「act 为altra也不玩」，对齐 CD M 通道）；market_heat 的 ultra 不拦
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('activity_level', 'ultra', 0.86) }, dE).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.86) && aM.rule === 'activity_gate', 'E: 门② BP30 ultra 臂 act=ultra → poor/activity_gate（机器盘级极端密集也不玩）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('activity_level', 'ultra', 0.86), ...mkAns('early_bird_quality', 'good', 0.95) }, dE).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'activity_gate', 'E: 门② ultra 臂拒（act ultra——旧档质量题答案在场不被消费照拒）');
// BP38 strong_backer ultra 豁免：强庄盘拉盘天然密集，ultra 密度不是拒买证据
// （用户裁定「盘型如果是 strong_backer，活跃度 ultra 豁免，不给 poor」——SB 四点/
// S011 ALPHA 形状；豁免后走质量题正常聚合；low 臂不豁免；heat 臂不豁免；
// 盘型缺席豁免不生效=照拦保守方向）
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'strong_backer', 0.69), ...mkAns('activity_level', 'ultra', 0.65) }, dE).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: BP38 豁免 strong_backer+ultra → 不拦全门链过（SB S004 形状——盘型①+act ultra 豁免，gates_passed）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'strong_backer', 0.69), ...mkAns('activity_level', 'ultra', 0.65), ...mkAns('early_bird_quality', 'good', 0.95) }, dE).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: BP38 豁免后纯门链放行（strong_backer+ultra——旧档质量题答案不被消费）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'strong_backer', 0.69), ...mkAns('activity_level', 'low', 0.8) }, dE).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.8) && aM.rule === 'activity_gate', 'E: BP38 豁免只豁 ultra 臂——strong_backer+act low 照拦（活跃度死寂强庄盘不豁免）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'strong_backer', 0.69), ...mkAns('activity_level', 'ultra', 0.65), ...mkAns('market_heat', 'low', 0.9) }, dE).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.9) && aM.rule === 'activity_gate', 'E: BP38 豁免不覆盖 heat 臂——strong_backer+ultra+heat low 照拦（prob=heat 臂）');
{
  const { market_pattern: _drop, ...noPattern } = fullAnswers();
  aM = buildBuyPointObservation({ ...noPattern, ...mkAns('activity_level', 'ultra', 0.86) }, dE).assessment;
  ok(aM.bucket === 'poor' && aM.rule === 'activity_gate', 'E: BP38 盘型缺席豁免不生效（market_pattern=null+ultra 照拦——保守方向）');
}
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_heat', 'ultra', 0.9), ...mkAns('activity_level', 'high', 0.8) }, dE).assessment;
ok(aM.rule === 'gates_passed', 'E: 门② market_heat=ultra 不拦（近窗密度视角不拦过热——只拦全窗量级 ultra）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_heat', 'mid', 0.6), ...mkAns('activity_level', 'mid', 0.6), ...mkAns('early_bird_quality', 'good', 0.9) }, dE).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: 门② 双 mid 放行（low/act-ultra 才有证据拒——mid/high 不拦）');
{
  const legacyAns = fullAnswers();
  delete legacyAns.activity_level; // BP12 旧档重放形状：无 activity_level 答案
  const aLegacy = buildBuyPointObservation(legacyAns, dE).assessment;
  ok(aLegacy.bucket === 'neutral' && aLegacy.rule === 'gates_passed', 'E: 门① act 答案缺席=该臂失效容缺放行（BP12 旧档重放兼容——market_heat 臂照常）');
  const aLegacyHeat = buildBuyPointObservation({ ...legacyAns, ...mkAns('market_heat', 'low', 0.9) }, dE).assessment;
  ok(aLegacyHeat.rule === 'activity_gate', 'E: 门① 旧档无 act 答案时 heat 臂照拦（单臂退化不吞门）');
}
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_heat', 'low', 0.88), ...mkAns('early_bird_quality', 'good', 0.95) }, dE).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'activity_gate', 'E: 门① heat low 拒（活跃度不够不参与——旧档质量题答案不被消费）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('activity_level', 'low', 0.88), ...mkAns('early_bird_quality', 'good', 0.95) }, dE).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'activity_gate', 'E: 门① BP13 臂 act low 拒（买点前全窗量级死寂）');
// ③ 筹码门（BP14 BEM 案+BP30 heavy 扩档——用户裁定「famous 主导就不玩」：
// famous_domination ∈ {heavy, dominant}（正净 ≥25）∨ holder_concentration=strong
// → poor/chip_gate；light=正常参与不拦）
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('famous_domination', 'dominant', 0.92) }, dE).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.92) && aM.rule === 'chip_gate', 'E: 门③ famous=dominant → poor/chip_gate（BEM 案主拦截臂——famous 掌控的盘子不参与）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('famous_domination', 'heavy', 0.9) }, dE).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.9) && aM.rule === 'chip_gate', 'E: 门③ BP30 heavy 扩档 famous=heavy → poor/chip_gate（≥25=famous 主导就不玩——我画地为牢 S082 案「既然是 famous 为啥还给中」）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('holder_concentration', 'strong', 0.87) }, dE).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.87) && aM.rule === 'chip_gate', 'E: 门③ holder=strong → poor/chip_gate（CD240 分层线臂——持有者不少但 TOP 占比太大）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('famous_domination', 'dominant', 0.8), ...mkAns('holder_concentration', 'strong', 0.94) }, dE).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.94) && aM.rule === 'chip_gate', 'E: 门③ 双臂命中 → prob 取两臂最大（同 rule 留痕）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('famous_domination', 'dominant', 0.9), ...mkAns('early_bird_quality', 'good', 0.97) }, dE).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'chip_gate', 'E: 门③ famous=dominant 拒（控盘盘不参与——旧档质量题答案不被消费）');
// BP45（2026-11-08，案号 BP40）famous 轴只适用第一波（用户裁定「famous 轴本身不应该
// 用于再起来的盘子，它只适用于第一波」+「价格落到底了，但是famous没有离场，这不是好事吗」）：
// 盘面再起来（锚窗涨起后最低 ≤+20 含破发=回到过 almost_launch）后 famous 臂退出 chip_gate
// ——落底后 famous 持无浮盈筹码、未离场=正面证据；第一波 famous「拿最便宜筹码等抬轿砸盘」
// 的风险模型才成立。null（从未离开/刚离开无回落/截窗缺失）=第一波域照拦保守（宁拦不冒充，
// 与⑥⑦位置门锚缺失拒同向）；holder 臂不受影响；上文 dA（minVsLaunchPct=30 >20）各断言
// =第一波域照拦反证组
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('famous_domination', 'dominant', 0.92), ...mkAns('market_pattern', 'golden_point', 0.85) }, { ...dA, minVsLaunchPct: -9.9, currentVsLaunchPct: -9.9 }).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: BP45 再起来域 famous dominant 不拦（minVsLaunchPct=-9.9 破发=回到过 almost_launch——落底后 famous 未离场=正面证据；golden_point 现价 -9.9 ≤+40 防御门过全链放行——bt-s02 07:15:45 案形状：RL10 破发段信号被 chip_gate 误杀的翻案）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('famous_domination', 'dominant', 0.92) }, { ...dE, minVsLaunchPct: 15.4 }).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: BP45 再起来域界=≤+20（minVsLaunchPct=15.4 涨起后最低回到 almost_launch 内——famous 臂退出不拒）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('famous_domination', 'dominant', 0.92), ...mkAns('holder_concentration', 'strong', 0.94) }, { ...dE, minVsLaunchPct: -9.9 }).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.94) && aM.rule === 'chip_gate', 'E: BP45 只退 famous 臂——再起来域 holder=strong 照拦（筹码集中臂不受域影响）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('famous_domination', 'dominant', 0.92) }, { ...dE, minVsLaunchPct: 22.3 }).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'chip_gate', 'E: BP45 第一波域照拦（minVsLaunchPct=22.3 >20=没回到过 almost_launch——famous 主导不玩原判保持，0x28ad2c7d 首锚 t0b 07:14:21 +22.3 形状）');
{
  const anchorNoMin = { ...dE }; delete anchorNoMin.minVsLaunchPct;
  aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('famous_domination', 'dominant', 0.92) }, anchorNoMin).assessment;
  ok(aM.bucket === 'poor' && aM.rule === 'chip_gate', 'E: BP45 锚缺失=null=第一波域照拦（宁拦不冒充——从未离开/刚离开无回落/截窗缺失均保守拦）');
}
ok(require('../src/market-analysis/buy-point-result-mapper').FAMOUS_AXIS_RELAUNCH_PCT === 20, 'E: FAMOUS_AXIS_RELAUNCH_PCT=20 导出（域界=almost_launch 上界 +20，与 minVsLaunchPct 同源）');
ok(!PATTERN_GATE_POOR_BUCKETS.includes('golden_point'), 'E: ⑧golden_point 不进 PATTERN_GATE_POOR_BUCKETS（允许买入型桶——判据自带现价位置 ≤+20，代码侧另有 ≤+40 防御门兜判序错位）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_heat', 'low', 0.85), ...mkAns('famous_domination', 'dominant', 0.95) }, dE).assessment;
ok(aM.rule === 'activity_gate' && near(aM.prob, 0.85), 'E: 门序 活跃度门先于筹码门（双门命中 rule 留痕 activity_gate——首个命中门）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('famous_domination', 'light', 0.9), ...mkAns('holder_concentration', 'moderate', 0.9) }, dE).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: 门③ light/moderate 不拦（<25 正常参与——heavy+ 才是 famous 主导；防误伤豁免域）');
// ① 盘型门（BP18 五类型学；BP30 前置为预判断——用户裁定「market_pattern 要放到
// 很靠前的位置，因为这是个预判断」：判定链最前，②③④桶硬拒买；strong_backer
// 强庄=最好类型与 blended_unremarkable 融合盘=好点位可赌 不拦）
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'retail_pvp', 0.86) }, dE).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.86) && aM.rule === 'pattern_gate', 'E: 门① retail_pvp 散户 PVP → poor/pattern_gate（只有小散户额度偏低互捅攒流动性——不要参与）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'famous_monopoly', 0.91) }, dE).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.91) && aM.rule === 'pattern_gate', 'E: 门① famous_monopoly famous 独食 → poor/pattern_gate（小散底子+一个 famous 拿太多筹码盘子就是它的）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'early_sniper_decay', 0.84) }, dE).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.84) && aM.rule === 'pattern_gate', 'E: 门① early_sniper_decay 狙击衰竭 → poor/pattern_gate（购买力集中最早期数 slot 后衰竭）');
// BP42（2026-11-08 用户裁定）真庄反锚机械门整段拆除：回归 BP12「不搞代码门」两次
// 明裁——代码不改写 Jev 桶判定；S072/S006/S109 类真庄贴顶票被④吞=设计内代价入
// 攒批池。拆除反证断言：两腿证据全在场的④形状（贴顶 0%+尾段 48.7=無為 S072 形状）
// 现在照拒 pattern_gate，dimensions 无 exempt 留痕（BP41 机制绝迹锁）
{
  const anchor4 = (ath, tail) => ({ ...dA, currentVsAthPct: ath, activity: { ...dA.activity, nearTail5BuySharePct: tail } });
  const obs42 = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'early_sniper_decay', 0.92) }, anchor4(0, 48.7));
  ok(obs42.dimensions.market_pattern.bucket === 'early_sniper_decay'
    && obs42.dimensions.market_pattern.exempt === undefined
    && obs42.assessment.bucket === 'poor' && obs42.assessment.rule === 'pattern_gate',
    'E: BP42 机械门已拆：④+贴顶 0%+尾段 48.7（BP41 救臂证据全在场）照拒④不动 Jev 判定、无 exempt 留痕（S072 形状回归设计内代价）');
}
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'strong_backer', 0.88) }, dA).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: 门① strong_backer 强庄盘不拦（dA vsLaunch=+60% ≤+80 庄盘独享 low 档放行——BP48 ①位置门内）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'blended_unremarkable', 0.77) }, dA).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: BP48 ⑤blended 位置门（dA vsLaunch=+60% >+40=low 档起）→ poor/pattern_gate（「blended 接受 价格 near_launch 以及 almost_launch」——low 只有庄盘①可接受；S055 无税人生 +126.8% 形状收口）');
// BP48/案号 BP44 盘型位置门收口三新臂（用户裁定「当前只有庄盘可以接受 low，其它最多是 near_launch」）
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'strong_backer', 0.88) }, { ...dA, currentVsLaunchPct: 80 }).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: ①位置门 恰 +80% 放行（≤+80 边界含——庄盘独享 low 档上界）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'strong_backer', 0.88) }, { ...dA, currentVsLaunchPct: 80.1 }).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: ①位置门 +80.1% 拒（严格大于 80=mid 及以上——庄盘也不追近二倍以上的位置，坑要够深）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'strong_backer', 0.88) }, { ...dA, currentVsLaunchPct: null }).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: ①位置门 锚缺失（发行价位置 ?）宁拦不冒充拒');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'blended_unremarkable', 0.77) }, { ...dA, currentVsLaunchPct: 40 }).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: ⑤位置门 恰 +40% 放行（≤+40 边界含——almost_launch/near_launch 最多 near_launch）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'blended_unremarkable', 0.77) }, { ...dA, currentVsLaunchPct: 40.1 }).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: ⑤位置门 +40.1% 拒（严格大于 40=low 档起——融合盘不接受 low）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'blended_unremarkable', 0.77) }, { ...dA, currentVsLaunchPct: -8 }).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: ⑤位置门 破发 −8% 放行（almost_launch 含破发）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'blended_unremarkable', 0.77) }, { ...dA, currentVsLaunchPct: null }).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: ⑤位置门 锚缺失宁拦不冒充拒');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'golden_point', 0.85) }, { ...dA, currentVsLaunchPct: 40 }).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: ⑧防御门 恰 +40% 放行（≤+40 边界含）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'golden_point', 0.85) }, { ...dA, currentVsLaunchPct: 45 }).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: ⑧防御门 +45% 拒（判⑧但现价 >+40%=判序错位按⑦位置门同线拒）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'golden_point', 0.85) }, { ...dA, currentVsLaunchPct: null }).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: ⑧防御门 锚缺失拒（宁拦不冒充）');
ok(STRONG_BACKER_LAUNCH_PCT === 80 && BLENDED_LAUNCH_PCT === 40 && GOLDEN_POINT_LAUNCH_PCT === 40, 'E: 三新位置界常量导出（①=80 庄盘独享 low/⑤=40/⑧=40 防御门）');
// BP34/案号 BP31 ⑥sustained_climb 位置门（盘型六桶制）：贴发行价起点段放行、已拉离/
// 锚缺失拒（rule 同 pattern_gate；判型归 Jev 位置归代码——界由羊王 0x5a8d94c6 四点定标：
// S154 −4.2% 放 / S155 +17.1% 拒，界取 10；S072 無為 +86.6% 不落⑥由①双臂保护（12min
// 前 8 大户人人有卖=对倒平衡；BP35——身份证据不是逃逸门））
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'sustained_climb', 0.87) }, dA).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.87) && aM.rule === 'pattern_gate', 'E: 门① BP34 ⑥sustained_climb 已拉离（dA vsLaunch=+60% >+10%）→ poor/pattern_gate（位置臂拒——一开盘一直拉几乎无回调不给散户入场机会，只能临近发布价格参与）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'sustained_climb', 0.87) }, { ...dA, currentVsLaunchPct: -4.2 }).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: ⑥位置门 贴发行价起点段（−4.2% ≤+10% 含破发）放行走后续门链（羊王 S154 形状——起点段位置放行不因盘型扣分）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'sustained_climb', 0.87) }, { ...dA, currentVsLaunchPct: 17.1 }).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: ⑥位置门 已拉离 +17.1% 拒（羊王 S155 形状——拉离发行价一截浮筹悬在拉升段上方）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'sustained_climb', 0.87) }, { ...dA, currentVsLaunchPct: null }).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: ⑥位置门 锚缺失（发行价位置 ? = ticks 未覆盖出生段）宁拦不冒充拒');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'sustained_climb', 0.87), ...mkAns('early_bird_quality', 'good', 0.95) }, dA).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: ⑥位置臂已拉离拒（盘型位置不对不参与——旧档质量题答案不被消费）');
ok(!PATTERN_GATE_POOR_BUCKETS.includes('sustained_climb'), 'E: PATTERN_GATE_POOR_BUCKETS 三桶不含⑥（⑥走 SUSTAINED_CLIMB_LAUNCH_PCT=10 独立位置臂——三桶硬拒与⑥位置拒分治）');
// BP43/CD381 ⑦restart 重启盘位置门（同⑥模式）：现价 ≤+40%（near_launch 以内含
// almost_launch 与破发）放行质量题、已重新拉离（>+40%）/锚缺失拒 rule=pattern_gate
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'restart', 0.87) }, dA).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.87) && aM.rule === 'pattern_gate', 'E: 门① BP43 ⑦restart 已拉离（dA vsLaunch=+60% >+40%）→ poor/pattern_gate（位置臂拒——重启盘已重新拉离起点段不参与）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'restart', 0.87) }, { ...dA, currentVsLaunchPct: 40 }).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: ⑦位置门 恰 +40% 放行（≤+40 边界含——near_launch 以内含 almost_launch 与破发，重启起点段走后续门链）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'restart', 0.87) }, { ...dA, currentVsLaunchPct: 40.1 }).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: ⑦位置门 +40.1% 拒（严格大于 40=已重新拉离）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'restart', 0.87) }, { ...dA, currentVsLaunchPct: -12 }).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: ⑦位置门 破发 −12% 放行（含破发——重启回到起点以下也是重启起点段）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'restart', 0.87) }, { ...dA, currentVsLaunchPct: null }).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: ⑦位置门 锚缺失（发行价位置 ? = ticks 未覆盖出生段）宁拦不冒充拒');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'restart', 0.87), ...mkAns('early_bird_quality', 'good', 0.95) }, dA).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: ⑦位置臂已拉离拒（重启盘已拉离不参与——旧档质量题答案不被消费）');
ok(!PATTERN_GATE_POOR_BUCKETS.includes('restart'), 'E: PATTERN_GATE_POOR_BUCKETS 不含⑦（restart 走 RESTART_LAUNCH_PCT=40 独立位置臂——与⑥同模式分治）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'retail_pvp', 0.86), ...mkAns('early_bird_quality', 'good', 0.95) }, dA).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: 门① 散户 PVP 拒（盘型不对不参与——旧档质量题答案不被消费）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_heat', 'low', 0.85), ...mkAns('market_pattern', 'retail_pvp', 0.95) }, dA).assessment;
ok(aM.rule === 'pattern_gate' && near(aM.prob, 0.95), 'E: 门序 BP30 盘型门前置最前（pattern+heat 双命中留痕 pattern_gate——预判断先于活跃度门）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('famous_domination', 'dominant', 0.9), ...mkAns('market_pattern', 'famous_monopoly', 0.95) }, dA).assessment;
ok(aM.rule === 'pattern_gate' && aM.bucket === 'poor', 'E: 门序 盘型门前置于筹码门（famous dominant+独食双语义命中留痕 pattern_gate）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'retail_pvp', 0.86), ...mkAns('activity_level', 'ultra', 0.95) }, dA).assessment;
ok(aM.rule === 'pattern_gate', 'E: 门序 盘型门前置于活跃度门 ultra 臂（pattern+act ultra 双命中留痕 pattern_gate）');
{
  const legacyPat = fullAnswers();
  delete legacyPat.market_pattern; // BP17 及更早旧档重放形状：无盘面分类题答案
  const aLegacy = buildBuyPointObservation(legacyPat, dA).assessment;
  ok(aLegacy.bucket === 'neutral' && aLegacy.rule === 'gates_passed', 'E: 门① 答案缺席=盘型门臂自动失效容缺放行（BP17 旧档重放兼容零影响——拒=有证据的拒绝）');
}
assert.throws(() => buildBuyPointObservation({ ...fullAnswers(), market_pattern: { probabilities: { sniper_pool: 0.9 } } }, dA), /未知桶名/, 'E: market_pattern 在场未知桶 throw（容缺不因新题放宽桶域校验）');
{
  const legacyChip = fullAnswers();
  delete legacyChip.famous_domination; // BP13 及更早旧档重放形状：无两筹码题答案
  delete legacyChip.holder_concentration;
  const aLegacy = buildBuyPointObservation(legacyChip, dE).assessment;
  ok(aLegacy.bucket === 'neutral' && aLegacy.rule === 'gates_passed', 'E: 门①b 两题答案缺席=筹码门臂自动失效容缺放行（BP13 旧档重放兼容零影响）');
}
assert.throws(() => buildBuyPointObservation({ ...fullAnswers(), famous_domination: { probabilities: { control: 0.9 } } }, dA), /未知桶名/, 'E: famous_domination 在场未知桶 throw（容缺不因新题放宽桶域校验）');
assert.throws(() => buildBuyPointObservation({ ...fullAnswers(), holder_concentration: { probabilities: { extreme: 0.9 } } }, dA), /未知桶名/, 'E: holder_concentration 在场未知桶 throw');
// BP30 改六 tree_position/high_chase 退役：题/维度/质量键绝迹——旧档 answers 带两题
// 答案（BP32 及更早存档）也不消费不 throw（重放兼容）
{
  const legacyTree = { ...fullAnswers(), ...mkAns('tree_position', 'not_tree', 0.83), ...mkAns('high_chase_quality', 'poor', 0.61) };
  const obsLegacyTree = buildBuyPointObservation(legacyTree, dE);
  ok(!('tree_position' in obsLegacyTree.dimensions) && !('qualities' in obsLegacyTree)
    && obsLegacyTree.assessment.bucket === 'neutral' && obsLegacyTree.assessment.rule === 'gates_passed',
    'E: BP30/BP48 退役反证——旧档带 tree_position/high_chase/质量题答案=不被消费不 throw（键绝迹+门链照走）');
  ok(!['not_tree', 'position_gate', 'any_good', 'any_neutral', 'else_poor'].includes(obsLegacyTree.assessment.rule), 'E: rule 域聚合值绝迹（BP48 后四值 pattern_gate/activity_gate/chip_gate/gates_passed）');
}
ok(JSON.stringify(ACTIVITY_GATE_POOR_BUCKETS) === JSON.stringify({ market_heat: ['low'], activity_level: ['low', 'ultra'] }),
  'E: 活跃度门拒买档常量（BP30 ultra 臂——heat 只 low、act low+ultra）');
ok(JSON.stringify(CHIP_GATE_FAMOUS_POOR_BUCKETS) === JSON.stringify(['heavy', 'dominant']),
  'E: 筹码门 famous 拒买档常量（BP30 heavy 扩档——light 不在拒买域）');
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
ok(obsE.anchors.actNearTail5TickN === dA.activity.nearTail5TickN && obsE.anchors.actNearTail5BuyN === dA.activity.nearTail5BuyN && obsE.anchors.actNearTail5BuyBnb === dA.activity.nearTail5BuyBnb
  && obsE.anchors.actNearTail5BuySharePct === dA.activity.nearTail5BuySharePct,
  'E: 活跃度锚族 act 尾段四键透传（BP31/BP28 三键+BP41 占比锚——nearTail5 与 buyDerived 同值）');
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
ok(obsE.anchors.launchPriceBnb !== null && near(obsE.anchors.launchPriceBnb, 1.0 * E9) && obsE.anchors.currentVsLaunchPct === 30 && obsE.anchors.launchCovered === 1,
  'E: 发行价位置族三键透传（BP5——launchCovered boolean → 1 数值化；obsE 用 dE 现价 +30 过⑤位置门）');
ok(obsE.anchors.athVsLaunchPct === 100 && obsE.anchors.minVsLaunchPct === 30,
  'E: 发行价位置族 ath/min 两锚透传（BP39 athVsLaunchPct + BP43 minVsLaunchPct 涨起后最低（BP44 定义）——与 buyDerived 同值零重算）');
ok(buildBuyPointObservation(fullAnswers(), null).assessment.bucket === 'poor'
  && buildBuyPointObservation(fullAnswers(), null).assessment.rule === 'pattern_gate',
  'E: anchors 缺省 null 容忍不 throw（BP48 ⑤位置臂 null=宁拦不冒充 → poor/pattern_gate——与 ⑦/⑧ null 语义同向）');
const badAnchor = buildBuyPointObservation(fullAnswers(), { ...dA, chg30Pct: 'not-a-number' });
ok(badAnchor.anchors.chg30Pct === null, 'E: 非数值锚形状异常 → null 不冒充');

// BP48 起无质量题 strict——维度题缺席容缺（质量题缺答案不再 throw：旧档缺两题答案=门链照走）
{
  const a = { ...fullAnswers() };
  delete a.early_bird_quality;
  delete a.pullback_entry_quality;
  const aNoQ = buildBuyPointObservation(a, dE).assessment;
  ok(aNoQ.bucket === 'neutral' && aNoQ.rule === 'gates_passed', 'E: 质量题缺答案不 throw（BP48 退役——strict 随题删除，旧档缺两题答案门链照走）');
}
assert.throws(() => buildBuyPointObservation({ ...fullAnswers(), price_trend: { probabilities: { extreme: 0.9 } } }, dA), /未知桶名/, 'E: 维度题在场未知桶 throw');
assert.throws(() => buildBuyPointObservation({ ...fullAnswers(), activity_level: { probabilities: { dead: 0.9 } } }, dA), /未知桶名/, 'E: activity_level 在场未知桶 throw（容缺不因新题放宽桶域校验）');
const partial = { ...fullAnswers() };
delete partial.price_level;
const obsPartial = buildBuyPointObservation(partial, dA);
ok(obsPartial.dimensions.price_level === null && obsPartial.dimensions.price_trend.bucket === 'fast_up', 'E: 维度题缺席 → null 容缺（在场照读）');

(async () => {
  // ═══════════════ F. 题集形状（CJS 经 dynamic import） ═══════════════
  console.log('F. 题集形状（BP48 八题=8 维度 0 质量/桶域对锁/price_level 六桶 almost_launch+①⑤⑧盘型位置门收口/④两路径判序/P0 矛盾修复/⑥位置门 10+⑦位置门 40）');
  const q = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'market-analysis', 'llm', 'buy-point-questions.mjs')).href);
  ok(q.BUY_POINT_QUESTIONS_VERSION === 'BP48', 'F: 版本=BP48（案号 BP44 两质量题退役+盘型位置门收口——用户开工令四条裁定原话「1. blended 接受 价格 near_launch 以及 almost_launch，当前只有庄盘可以接受 low，其它最多是 near_launch；2. B可以迁；3.C可以弃；4.D并入吧。」=①⑤blended ≤+40/①strong_backer 庄盘独享 low ≤+80/⑧≤+40 防御门三位置臂+大户未清场两臂迁⑦⑧判读（B 迁）+maxChg5 速度锚不迁移（C 弃——④桶拉高判据保留）+深崩阴跌失血并入⑦判读（D 并入⑦）；判定形态=纯门链（盘型门含位置臂→活跃度门→筹码门→neutral 放行 rule=gates_passed），无质量层；前版 BP47 案号 BP43 v2（苍蝇④误杀案题面化+深度精简——三轮对拍④未翻案=题面判序失灵第三例攒批，本版位置门/门链收口为其结构性出路））');
  const qs = q.buildBuyPointQuestions();
  const ids = Object.keys(qs);
  ok(ids.length === 8, `F: 恰 8 题=8 维度 0 质量（BP48 两质量题退役；实际 ${ids.length}）`);
  ok(ids[0] === 'market_pattern', 'F: BP30 改五 market_pattern 题序首位（前置预判断）');
  ok(JSON.stringify(ids) === JSON.stringify(['market_pattern', 'price_trend', 'market_heat', 'activity_level', 'famous_domination', 'holder_concentration', 'entry_position', 'price_level']), 'F: 题序=pattern 首+trend/heat/activity/famous/holder/entry/level（BP48 尾部质量题删除）');
  ok(!('tree_position' in qs) && !('high_chase_quality' in qs) && !('early_bird_quality' in qs) && !('pullback_entry_quality' in qs), 'F: tree_position/high_chase/early_bird/pullback_entry 题绝迹（BP30/BP48 退役反证）');
  ok(!('point_category' in qs) && !('buy_point_assessment' in qs), 'F: 类别题/综合题已删（BP6 形态反证——路由依赖从根消除）');
  ok(!('price_momentum' in qs) && !('buy_pressure_quality' in qs) && !('chip_flow' in qs) && !('pace_trend' in qs), 'F: 四道旧维度题已删（BP5 瘦身反证）');
  ok(ids.every((id) => qs[id].type === 'choice' && qs[id].criteria && Object.keys(qs[id].criteria).length >= 3), 'F: 全 choice 且 criteria≥3 桶');
  ok(DIMENSION_IDS.every((id) => qs[id].instructions.includes('怎么算')), 'F: 8 题各含「怎么算」显式算法段');
  ok(DIMENSION_IDS.every((id) => qs[id].instructions.includes('反锚')), 'F: 八维度题各含反锚段');
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
  ok(JSON.stringify(q.PRICE_LEVEL_LEVELS) === JSON.stringify(PRICE_LEVEL_LEVELS), 'F: PRICE_LEVEL_LEVELS 同域（BP43 六桶 almost_launch 前插——ESM/CJS 双副本对锁）');
  ok(!('TREE_POSITION_LEVELS' in q), 'F: TREE_POSITION_LEVELS 常量绝迹（BP30 tree_position 退役——ESM 侧同删）');
  // BP18 盘面分类锚（五类型学——用户裁定原话直译）
  ok(JSON.stringify(q.MARKET_PATTERN_LEVELS) === JSON.stringify(MARKET_PATTERN_LEVELS), 'F: MARKET_PATTERN_LEVELS 同域（BP18 五桶+BP34 第六桶 sustained_climb+BP43 第七桶 restart+BP45 第八桶 golden_point——ESM/CJS 双副本对锁）');
  ok(JSON.stringify(Object.keys(qs.market_pattern.criteria)) === JSON.stringify(MARKET_PATTERN_LEVELS), 'F: market_pattern 桶===MARKET_PATTERN_LEVELS（BP45 八桶 strong_backer/retail_pvp/famous_monopoly/early_sniper_decay/blended_unremarkable/sustained_climb/restart/golden_point）');
  // BP43（CD381 同车需求 2/4'）：almost_launch 六桶+restart 第七桶+数值锚联动
  ok(JSON.stringify(PRICE_LEVEL_LEVELS) === JSON.stringify(['almost_launch', 'near_launch', 'low', 'mid', 'high', 'very_high']), 'F: price_level 六桶域=almost_launch/near_launch/low/mid/high/very_high（BP43 almost_launch ≤+20 含破发前插）');
  ok(JSON.stringify(Object.keys(qs.price_level.criteria)) === JSON.stringify(PRICE_LEVEL_LEVELS), 'F: price_level 桶===PRICE_LEVEL_LEVELS（六桶——ESM 题集 criteria 键序一致）');
  ok(qs.price_level.criteria.almost_launch.includes('≤ +20%，含破发') && qs.price_level.criteria.near_launch.includes('+20%~+40%') && qs.price_level.criteria.low.includes('+40%~+80%，1.4~1.8 倍') && qs.price_level.criteria.mid.includes('+80%~+600%，1.8~7 倍'), 'F: price_level criteria 六桶分界（almost_launch ≤+20/near_launch 20~40/low 40~80/mid 80~600——BP43 六桶改制）');
  ok(MARKET_PATTERN_LEVELS.includes('restart') && !PATTERN_GATE_POOR_BUCKETS.includes('restart'), 'F: restart 进八桶但不进 PATTERN_GATE_POOR_BUCKETS（⑦走 RESTART_LAUNCH_PCT=40 独立位置臂非三桶硬拒——与⑥同模式分治）');
  ok(MARKET_PATTERN_LEVELS.includes('golden_point') && !PATTERN_GATE_POOR_BUCKETS.includes('golden_point'), 'F: golden_point 进八桶但不进 PATTERN_GATE_POOR_BUCKETS（⑧允许买入型——判据自带现价位置（区内 ≤+20）无需位置门，BP45 用户裁定「这个盘面也是性价比极高的点，允许买入」）');
  ok(require('../src/market-analysis/buy-point-result-mapper').RESTART_LAUNCH_PCT === 40 && require('../src/market-analysis/buy-point-result-mapper').SUSTAINED_CLIMB_LAUNCH_PCT === 10, 'F: 位置门常量导出（RESTART_LAUNCH_PCT=40/SUSTAINED_CLIMB_LAUNCH_PCT=10——用户裁定「盘型判重启后现价 ≤+40% 位置门放行质量题」）');
  const mp = qs.market_pattern.instructions;
  ok(mp.includes('⑦重启盘（restart，BP43 新增）') && mp.includes('价格又回到了 almost_launch') && mp.includes('①交易量腿') && mp.includes('②价格回到腿') && mp.includes('窗口总笔数参考 ≥10 笔 ∧ 全窗买入额参考 ≥1.5 BNB') && mp.includes('锚窗**涨起后最低**价较发行价 ≤+20%') && mp.includes('整窗最低恒是发行价本身不作判据') && mp.includes('重新创新高不遮蔽回落'), 'F: ⑦重启盘立法（BP43——交易量腿 ≥10 笔 ∧ ≥1.5 BNB 与 ladder RL15 臂同线+价格回到腿=锚窗涨起后最低 ≤+20（首个突破 +20% 离开后的最低非整窗：整窗最低恒=发行价结构性失效；BP44 创新高不遮蔽回落）两腿制）');
  ok(mp.includes('④的回落=没人玩了，⑦的回落=玩过一轮又回到起点') && mp.includes('**④与⑦分界=回落方向（BP43）+判序优先（BP44 盘面重置，见前置检查）**') && mp.includes('交易量腿不达标的回落票走④不走⑦（无人问津不是重启）') && mp.includes('⑦与①⑤分界=判的是回落形状不是盘面好坏'), 'F: ④⑦/⑦①⑤分界（④开局抢完就没人玩了/⑦玩过一轮回到起点——交易量腿不达标走④；⑦只述结构事实质量归质量题）');
  // BP44（案号 BP39 盘面重置判读+restart 优先判序——0x28ad2c7d 单票回测 bt-s01 判例）
  ok(mp.includes('**盘面重置前置（BP44 判序，先于④⑦评分类）**') && mp.includes('=**盘面重新计算**——此前的高位形状（狙击抢筹/开盘拉高/出货）是**上一轮**的痕迹') && mp.includes('优先判⑦重启盘**，不落④狙击衰竭（④的衰竭语义=回落之后没人玩了；活跃度又起来的回落是重启不是衰竭）') && mp.includes('回落之后死寂无人玩的仍走④（重启失败=衰竭）'), 'F: BP44 题头盘面重置前置段（用户裁定「一旦 almost_launch 会认为这个代币的盘面重新计算了」——回到过 almost_launch=盘面重新计算，回落后活跃度又起来的优先判⑦不落④，死寂仍走④）');
  ok(mp.includes('**让位（BP44，见前置检查）**') && mp.includes('回到过 almost_launch 后回落、且交易活跃度又起来的优先判⑦重启盘不落④'), 'F: BP44 ④桶让位句（开盘段形状在回到 almost_launch 后是上一轮痕迹，活跃度又起来的让位⑦——BP35 反锚出口接本判序；BP47 精简重组后让位句压引用，上一轮痕迹语义主述在前置检查段）');
  ok(mp.includes('**判序优先（BP44）**') && mp.includes('价格回到腿成立=盘面重新计算（见前置检查）') && mp.includes('即便锚窗内同时可见④的开盘段集中抢筹形状（上一轮的痕迹不改本轮定性'), 'F: BP44 ⑦桶优先句（两桶形状同现优先⑦——上一轮痕迹不改本轮定性；BP47 精简重组后口径定义压引用）');
  ok(qs.market_pattern.criteria.early_sniper_decay.includes('**盘面重置让位（BP44）**') && qs.market_pattern.criteria.early_sniper_decay.includes('优先判⑦重启盘不落本桶'), 'F: criteria ④桶 BP44 让位同步（Jev 选桶时同判序）');
  ok(qs.market_pattern.criteria.restart.includes('**判序优先（BP44 盘面重置）：回到过 almost_launch=盘面重新计算') && qs.market_pattern.criteria.restart.includes('回落后活跃度又起来的（近窗/锚窗末段吞吐双向活跃金额可观）优先落本桶不落④'), 'F: criteria ⑦桶 BP44 优先句同步（Jev 选桶时同判序）');
  ok(mp.includes('参与窗口由代码侧位置门判**：现价较发行价 ≤+40%（near_launch 以内，含 almost_launch 与破发）=重启后仍在起点段附近，放行走后续门链（活跃度门/筹码门）；现价已重新拉离（>+40%）或发行价位置行 ?（锚缺失宁拦不冒充）→ 不参与'), 'F: 门桶声明 BP43 ⑦位置门句（≤+40 near_launch 以内放行走后续门链、已拉离/锚缺失拒——判型归 Jev 位置归代码；BP48 后无质量层改走门链）');
  ok(qs.market_pattern.criteria.restart.includes('锚窗涨起后最低价较发行价 ≤+20%，含破发') && qs.market_pattern.criteria.restart.includes('窗口总笔数参考 ≥10 ∧ 全窗买入额参考 ≥1.5 BNB') && qs.market_pattern.criteria.restart.includes('现价较发行价 ≤+40%（near_launch 以内含 almost_launch 与破发）放行走后续门链'), 'F: criteria restart 同步（BP43——桶描述与题面两腿+位置门一致，Jev 选桶时同判据；BP44 涨起后定义；BP48 放行走门链）');
  ok(mp.includes('这是最好的类型') && mp.includes('开盘段结构行大额单') && mp.includes('大户卖出后有像样的承接') && mp.includes('价格已被拉高不排除①') && mp.includes('大户尚未卖出') && mp.includes('承接条件直接满足'), 'F: ①强庄盘=最好类型（BP21 承接轴——大户卖出有像样买盘承接=对倒换手流动性在场；价格拉高不排除①：定类看承接结构不看价格高度=SB 案；BP22 零卖出满足路径——大户只买未卖=强庄在场承接条件直接满足=HAUL 案防误翻⑤）');
  ok(mp.includes('没有任何像样的买方力量') && mp.includes('大户卖出、零散小散承接') && mp.includes('开盘段大额单 >0 不自动排除②') && mp.includes('这种不要参与'), 'F: ②散户 PVP=不要参与（BP21 双形状——(a) 从来无像样买单+(b) 大户卖出零散小散承接：大户向小散出货盘面散户化仍②=정책콕 案）');
  ok(mp.includes('拿了太多筹码') && mp.includes('这个盘子就是它的/它们的了'), 'F: ③famous 独食=盘子就是它的了（原话直译；BP30 复数 famous 扩句后单复数并表「它的/它们的」）');
  ok(mp.includes('购买力完全集中在最早期的数个 slot') && mp.includes('随之购买力衰竭') && mp.includes('这种盘子不要参与'), 'F: ④狙击衰竭=不要参与（原话直译）');
  ok(mp.includes('融合无明显特征盘') && mp.includes('这种出现好的点位可以赌一赌'), 'F: ⑤融合盘=好点位可赌（原话直译——中性不拦）');
  ok(mp.includes('①与④分界=大户在场性+盘面死活（BP33）') && mp.includes('同为开盘大额，强庄买完盘面持续有交易'), 'F: ①④分界锚=大户在场性+盘面是否仍活（BP33 措辞；BP47 精简去「补强」二字）');
  ok(mp.includes('买入额到 0.2 BNB 级（≥0.19 视同）的钱包 ≥2 个，或单笔 0.3+ BNB 级买入，且买点时刻在场=大户参与满足'), 'F: ②⑤分界双臂语义保留（BP19 突突车案——多笔 0.2 级（≥2 钱包）或单笔 0.3+ 在场=满足大户参与不属纯散户 PVP；BP28 判序化后该双臂成为前置门判据；BP47 精简后主述在②桶 (a) 判序前置段）');
  ok(mp.includes('「多笔」是硬笔数') && mp.includes('0.2 BNB 级（≥0.19 视同）钱包须 ≥2 个') && mp.includes('仅一笔 0.2 级+其余全 0.1 级及以下=凑不成多笔仍落②'), 'F: ②「多笔」硬笔数锚（BP20 两改——到 0.2 级钱包 ≥2 个、单笔 0.2 凑不成多笔仍落②：T006/T008 单笔 0.2 判 blended 宽松执行收口；BP47 精简去冗词）');
  ok(mp.includes('①②分界=大户卖出后谁在接') && mp.includes('承接方全是很小的散户') && mp.includes('前提是像样买方买点时刻仍在场'), 'F: ①②分界承接轴（BP21 정책콕 T001/SB T003 两案——大户卖出像样单接=①对倒、小散堆接=②散户化；「多笔不落②」前提=像样买方买点时刻仍在场，已卖离场接盘全小散走②(b)；BP47 精简去冗词）');
  // BP23 两轴（159 点复审第 2-3 批立法）
  ok(mp.includes('大量零散小散户——这种形状可以明显看出来') && mp.includes('「一眼可辨的大量小散单」两要件缺一不落②') && mp.includes('中位尘埃级（0.0x 级，不是 0.1 级常见交易档）') && mp.includes('至少是⑤融合盘'), 'F: ②(b) 收窄=零散小散须一眼可辨（BP23/S018 吉祥B 案——「有大量零散小散户的可以明显看出来」方法论锚：中位尘埃级+前列无像样买方两要件缺一不落②；大户在场+承接 0.1~0.2 级=至少⑤）');
  ok(mp.includes('大户仍在场参与 ∧ 承接单在 0.1~0.2 BNB 级常见交易档（买盘中位 0.1 级）→ 不落②') && mp.includes('至少是⑤融合盘') && mp.includes('承接达 0.2~0.3+ 像样级走①'), 'F: ①②分界承接中间档（BP23——大户参与+承接非零散小散不落②，至少⑤/像样级走①；BP47 精简后主述在②桶 (b) 落桶门槛段）');
  // BP24 案大户持续卖持续承接臂（三改：BP24 离场后承接→BP25 卖压消化过程性→BP26 卖方在场性优先三分）
  ok(mp.includes('大户持续卖+持续有承接（卖方在场性优先）') && mp.includes('卖方状态三分') && mp.includes('「一波接没下文」是这种结构的必然结局、不是锚窗内可见的状态') && mp.includes('判结构不判承接当下的活跃度'), 'F: ②(b) 第三通道卖方在场性优先三分（BP26——T001 触发时散户承接高潮致 Jev 误判⑤：「一波接没下文」是前向结局锚窗不可见 → ②卖压归零∧清仓成批/前列走空+承接只剩散户=②(b) 判结构不看承接当下活跃度）');
  ok(mp.includes('卖方在场性优先') && mp.includes('①大户卖出仍在进行') && mp.includes('②大户已卖完离场') && mp.includes('③大户在场持有未卖') && mp.includes('走「大户在场+承接」路径不落②'), 'F: ②⑤分界卖方在场性三分（BP26——①持续卖+持续接=⑤（VirusSI P2-P4 bigSell60 0.48/0.83/1.00）；②卖完离场+散户一波接=②（T001 bigSell60=0+exitSellers=3）；③在场未卖=BP23 中间档原路径保护不落②；BP47 精简后三分主述在②桶 (b) 第三通道）');
  // BP26 案大户参与判序前置（2026-11-06 S045 谷谷② 灰区单误判案——题集 BP28）
  ok(mp.includes('从来无像样买单（判序前置）'), 'F: ②(a) 判序前置声明（BP28——先判大户参与再分类，S045 灰区单案）');
  ok(mp.includes('先判「大户参与」') && mp.includes('或单笔 0.3+ BNB 级买入，且买点时刻在场=大户参与满足') && mp.includes('直接落②，不再看承接、不看盘面活跃度') && mp.includes('0.1~0.19 BNB 级灰区单不构成大户参与'), 'F: ②(a) 大户参与双臂+不满足直接落②（BP26 案立法核心——用户裁定原话「大户参与不满足是直接 pvp 盘的，满足之后根据承接再次分类」；灰区 0.1~0.19 单不构成大户参与=S045 前列 0.1568/0.1484/0.1090 三笔灰区单成因）');
  ok(mp.includes('小散互捅的盘面再活跃（新买家多、吞吐高、笔密度大）也只是散户 PVP，不是融合盘') && mp.includes('满足大户参与之后才按承接分类'), 'F: ②(a) 活跃度不救+承接分类后置（BP28——S045 被 activity high 22 秒 14 笔+8 全新买家带走判 blended 0.85 错放；小散互捅的活跃不是大户参与）');
  ok(mp.includes('大户参与（硬笔数双臂，判据见②桶 (a) 判序前置）不满足直接落②、盘面活跃度不救') && mp.includes('小散互捅的盘面再活跃（新买家多、吞吐高、笔密度大）也只是散户 PVP，不是融合盘') && mp.includes('满足大户参与之后才按承接分类'), 'F: 反锚②⑤分界判序化（BP28——「全场无任何像样买单」自由裁量句退役，硬笔数双臂不满足直接落②活跃度不救；满足后才看承接=BP21/BP23/BP26 承接轴全保留；BP47 精简后判据主述在②桶）');
  ok(qs.market_pattern.criteria.retail_pvp.includes('判序前置——先判大户参与（0.2 级钱包 ≥2 个或单笔 0.3+ 在场）：不满足（前列最大 0.1x 级灰区单/尘埃档、仅一笔 0.2 级凑不成多笔）=直接落②，盘面活跃度不救'), 'F: criteria retail_pvp 判序同步（BP28——桶描述与题面判序一致，Jev 选桶时同判序）');
  // BP27 案①庄时序锚（2026-11-06 S048 阿里美股 散户接力盘误判案——题集 BP29）
  ok(mp.includes('最早的买入（至少次早）得有大户') && mp.includes('0.19~0.2 BNB 级贴线单是「稍微大一点的散户」不是大额') && mp.includes('散户接力盘不是庄建仓，不走①至多⑤'), 'F: ①庄时序锚三句（BP29/BP27 案——用户裁定原话「如果你是庄，肯定一开盘最早期买入大额，然后对倒分仓」+措辞更正「应该是最早的买入（至少是次早）得有大户」：大额线=0.3+ 与 openSeg 同线，0.198/0.198 贴线单是稍微大一点的散户；最早（至少次早）买入无大户+之后贴线单接力=散户接力盘不走①）');
  ok(mp.includes('**最早的买入（至少次早）得有大户**') && mp.includes('开局最早买入全小散铺垫、之后才来 0.19~0.2 级贴线单接盘') && mp.includes('（「一开始先小散户，然后有稍微大一点的散户接了罢了」）'), 'F: 反锚①时序反锚（BP29——S048 形状直译锚：最早的买入（开局第一秒 5 笔）全 0.03~0.14 小散+13 秒后 0.1985/0.1976 接力，双臂满足按承接分类至多⑤不走①；BP47 精简后主述在①桶、原话直译已补回）');
  ok(qs.market_pattern.criteria.strong_backer.includes('最早的买入（至少次早）里便有大额（单笔 0.3+，0.19~0.2 贴线单=稍微大一点的散户不算大额）') && qs.market_pattern.criteria.strong_backer.includes('最早的买入全小散铺垫+之后 0.2 级贴线单接力=散户接力盘不是庄建仓不走①（至多⑤）'), 'F: criteria strong_backer 时序锚同步（BP29——桶描述与题面判序一致）');
  ok(mp.includes('占比大且绝对额大') && mp.includes('不构成独食'), 'F: ③门槛锚=占比大且绝对额大（famous 边缘参与不构成独食）');
  // BP28 案改三（S064 FIGHT strong_backer 误放 -41.5%——复数 famous 扩句+roster 收录）
  ok(mp.includes('或两个及以上 famous 钱包极早入场（开盘段内/锚窗最早段首买）合计拿筹过多') && mp.includes('famous 抢筹建仓盘——famous 钱包入仓太早、拿的是最便宜的筹码，散户盘子起不来') && mp.includes('这个盘子就是它的/它们的了'), 'F: ③复数 famous 扩句（BP30/BP28 案 S064——用户裁定原话「他俩入仓太早了拿的太多，起不来」：0xfb4e/0x5506 两著名钱包 t+7s/t+13s 抢筹 0.252/0.343 合计 0.595 BNB，单个占比不及独食线的复数合计达线也落③；两址已收录 famous-copy-wallets.json）');
  ok(mp.includes('复数 famous 形状（BP30）') && mp.includes('两个及以上 famous 钱包极早入场（开盘段内首买）合计拿筹（控盘占比 ≥25~30 且合计绝对额大）同样落③') && mp.includes('入仓太早拿的太多、盘子起不来'), 'F: 反锚③复数 famous 形状句（BP30——单 famous 24.4%<25 边缘不落③的 S062 反例保护：复数臂须 ≥2 钱包且合计达线）');
  ok(qs.market_pattern.criteria.famous_monopoly.includes('单个 famous 占比极大，或两个及以上 famous 钱包极早入场（开盘段内首买）合计拿筹过多（控盘 ≥25~30 且合计绝对额大）=famous 抢筹建仓盘'), 'F: criteria famous_monopoly 复数 famous 同步（BP30——桶描述与题面判据一致）');
  ok(mp.includes('按⑤处理不硬归类') && mp.includes('⑤含「没有明确分类」语义'), 'F: 材料不足按⑤融合桶处理不硬归类（⑤语义含无明确分类）');
  ok(mp.includes('②③④由盘型门硬拒（不要参与）'), 'F: 门桶声明=②③④盘型门硬拒（BP48 收口句——①⑤⑦⑧受各自位置臂非不拦）');
  ok(mp.includes('⑥现价较发行价 ≤+10%（含破发）起点段放行、已拉离（>+10%）或发行价位置行 ?（锚缺失宁拦不冒充）拒'), 'F: 门桶声明 BP34 ⑥位置门句（锚缺失宁拦不冒充——判型归 Jev 位置归代码）');
  // BP31 案（题集 BP34/BP35）：⑥持续拉升弱回调+①散户入场机会双臂+①⑥强庄家族从宽①
  ok(mp.includes('⑥持续拉升弱回调盘（sustained_climb，BP34 新增）') && mp.includes('一开盘一直拉、几乎无回调的都不是啥好东西') && mp.includes('没有庄筹码对倒、没有像样的换手') && mp.includes('浮筹全部悬在拉升段上方'), 'F: ⑥持续拉升弱回调盘立法（BP31 案 Shellbank 0x24436292 不健康最终证明 cheat——原话「一开盘一直拉几乎无回调的都不是啥好东西」：几乎无回调（窗内最大回撤极小 <10%）∧ 买卖几乎完全不平衡（近窗买占比 ≥90% 卖出稀薄——无对倒无换手不给散户入场机会））');
  ok(mp.includes('①的散户入场机会双臂（BP34）') && mp.includes('有一定的卖出、买卖不是完全不平衡的') && mp.includes('或拉盘的速度不是那么快') && mp.includes('两臂全失，不是①走⑥') && mp.includes('大户在场/开盘有大额不区分①⑥（同属强庄家族——拉升的执行者就是大户，分界只在双臂') && mp.includes('零卖出但盘面有回调/换手形状的照常①'), 'F: ①散户入场机会双臂（BP31 案两段补充裁定「有一定的卖出，买卖不是完全不平衡的，庄筹码对倒，给散户进场机会」+「或者，拉盘的速度不是那么快，给散户入场机会」——两臂至少占一，两臂全失走⑥；BP35 点明大户在场不救本臂（拉升执行者就是大户①⑥同形分界只在双臂）；零卖出+有回调/换手照常①防误伤；BP47 精简后⑥互引压一句）');
  ok(mp.includes('近窗零买/纯卖无承接的不落①（BP35）') && mp.includes('大户在向市场出货、没有换手——承接臂不满足，不落①（按②(b) 散户化/出货形状判）'), 'F: ①承接臂收紧（BP35 修正三——羊王 S157 误放修复：近 60s 买 0.000 卖 0.661 纯卖零承接判① 0.71 错放，纯卖无承接=大户向市场出货没有换手，不落①按②(b) 散户化判）');
  ok(mp.includes('极早窗（BP35）同界') && mp.includes('占比高本身不是④的证据') && mp.includes('路径 A 的成立必须落在衰竭臂上') && mp.includes('**活跃度一直高=没有衰竭形状，路径 A 不成立（BP47 前提臂）**'), 'F: ④衰竭前提臂（BP47 通用化+BP35 极早窗反锚——羊王 S154 误杀修复先例+苍蝇判例：开局段集中+此后数十秒持续 ultra 吞吐双向活跃的盘面判④=只见结构不见状态；活跃度一直高（末段/近窗吞吐双向活跃金额可观）=盘面没有衰竭路径 A 不成立，开局段占比是历史结构、衰竭是当下状态；BP48 两路径判序后前提臂只管路径 A）');
  ok(mp.includes('与①同属强庄家族（BP35 防误伤）') && mp.includes('「也可以视为是强庄盘」指家族归属、不是逃逸门') && mp.includes('身份证据在场不豁免双臂判据，近窗纯买零卖+急拉的即便大户在场也落本桶'), 'F: ⑥①⑥强庄家族句（BP35 修正一——BP34 对拍⑥桶零命中的根因：羊王 t+0/t+1 大额+多个零卖钱包，大户在场恒真→「强庄身份豁免」系统性吞掉⑥；「也可以视为是强庄盘（否则容易误伤）」=①⑥同属强庄家族的归属说明不是逃逸门——身份证据不豁免双臂判据）');
  ok(mp.includes('防误伤的从宽方向=双臂材料混合/证据薄时从宽①') && mp.includes('拒买类从严、拿不准从宽') && mp.includes('有对倒证据（近窗有像样卖出）的照①评估'), 'F: ⑥从宽①防误伤（BP35 修正一——真强庄的对倒节奏可能间歇：双臂材料混合/证据薄时从宽①不落⑥，拒买类从严拿不准从宽；無為 S072 12min 前 8 大户人人有卖=对倒平衡照①）');
  ok(mp.includes('参与窗口（代码侧位置门）') && mp.includes('≤+10%、含破发）的起点段点位可参与') && mp.includes('已拉离发行价一截（>+10%）→ 本桶=不要参与') && mp.includes('「这种只能临近发布价格参与」'), 'F: ⑥参与窗口位置门语义（原话「这种只能临近发布价格参与」——贴发行价起点段放行走后续门链、已拉离拒）');
  ok(mp.includes('①与⑥分界=散户入场机会双臂（BP34') && mp.includes('「视为强庄盘」是家族归属不是逃逸门') && mp.includes('双臂材料混合/证据薄时从宽①不落⑥（BP35 防误伤）') && mp.includes('④与⑥分界=死活') && mp.includes('，⑥持续在拉不衰竭（近窗流量照常、价格拱持续抬升）'), 'F: 反锚①⑥/④⑥分界（①⑥=散户入场机会双臂+家族归属不是逃逸门+从宽①防误伤；④⑥=死活——④开局抢完即衰竭、⑥持续在拉不衰竭；BP47 精简后从宽判据长句在①/⑥桶主述）');
  ok(qs.market_pattern.criteria.sustained_climb.includes('价格从开盘起持续单边拉升几乎无回调（全窗价格拱一路向上——单根深急回针迅速收复创新高不破坏形状）') && qs.market_pattern.criteria.sustained_climb.includes('近窗卖出归零/仅尘埃级 <0.12 ∧ 买占比 ≥90%') && qs.market_pattern.criteria.sustained_climb.includes('近窗卖出 ≥0.12 BNB=对倒痕迹走①（贴线微小卖出 0.10x 级不算对倒，BP37）') && qs.market_pattern.criteria.sustained_climb.includes('更早段对倒不救近窗纯拉段') && qs.market_pattern.criteria.sustained_climb.includes('与①同属强庄家族（开盘大额与大户在场不区分①⑥——身份证据不是逃逸门，近窗纯买零卖急拉的即便大户在场也落本桶；双臂材料混合/证据薄时从宽①防误伤，有对倒证据的照①）') && qs.market_pattern.criteria.sustained_climb.includes('已拉离发行价（>+10%）或锚缺失=不要参与'), 'F: criteria sustained_climb 同步（BP37——近窗 0.12 线+贴线微小卖出不算对倒+现在进行时+价格拱回针句+家族归属从宽①+位置门）');
  ok(qs.market_pattern.criteria.strong_backer.includes('近窗零买/纯卖无承接的不落①（大户向市场出货无换手走②(b)）') && qs.market_pattern.criteria.strong_backer.includes('①的散户入场机会双臂：拉升（近窗）有一定卖出（近窗卖出合计 ≥0.12 BNB 级=对倒痕迹，贴线微小卖出 0.10x 级不算——BP37）或拉得慢（缓推）至少占一') && qs.market_pattern.criteria.strong_backer.includes('一直拉几乎无回调+近窗卖出归零/尘埃（两臂全失）走⑥不落①') && qs.market_pattern.criteria.strong_backer.includes('双臂材料混合/证据薄时从宽①防误伤'), 'F: criteria strong_backer 承接臂收紧+双臂近窗 0.12 线同步（BP37——纯卖无承接走②(b)、对倒臂=近窗 ≥0.12、贴线微小卖出不算、两臂全失走⑥、从宽①防误伤，Jev 选桶时同判序）');
  ok(mp.includes('对倒臂判据（BP36 近窗锚定，BP37 收紧）：近窗卖出合计 ≥0.12 BNB 级=对倒痕迹在场；卖出归零/仅尘埃级（<0.12）=对倒臂失——刚过 0.1 的贴线微小卖出（0.10x 级）不构成对倒痕迹、仍属臂失（非常微小的卖出力量不豁免）'), 'F: ①对倒臂 0.12 线（BP37 收紧——無為 S072 近窗卖 0.128≥0.12=对倒痕迹照①，太空逆袭 S054 卖 0.1021=贴线微小卖出不算对倒仍⑥，羊王 S156 卖 0.0000=臂失走⑥：①⑥分界客观化，Jev 对照近窗流量行即可判）');
  ok(mp.includes('看价格拱形状不看单根回针（BP36）') && mp.includes('回针是拉升途中的洗盘针不是回调结构，不破坏「一路向上」形状'), 'F: ⑥回撤判据看全窗价格拱（BP36——「窗内最大回撤」行是临近段口径：S156 回针 35.3% 但末价=ATH 0s 前刚创新高，单根深急回针收复不破坏一路向上）');
  ok(mp.includes('⑥看拉升的「现在进行时」（BP36）') && mp.includes('全窗更早段的对倒（如开盘大额买进后部分兑现）不救近窗纯拉段'), 'F: ⑥现在进行时（BP36——S156 第 1 大 0xb036 全窗卖 0.756 是更早段兑现，近窗 30s 卖 0.0000×0 纯拉进行时不给入场机会仍落⑥）');
  ok(mp.includes('承接归零的除外（BP36）') && mp.includes('近窗买入归零/仅尘埃（买占比 ≈0、无人接盘）=没有任何人在接') && mp.includes('没有买方的盘面不是⑤，落②(b)（在场持有+零承接=对倒停摆的死盘）'), 'F: ②⑤第三臂承接归零例外（BP36——S157 近窗买 0.0001 卖 0.661：大户在场持有未卖但承接归零，无论谁在卖没有买方就不是⑤落②(b)；BP47 精简去冗词）');
  // BP30 案三改（盘型前置预判断+互斥教学+④判据补强——题集 BP33）
  ok(mp.includes('本题是预判断——先于其它题作答、先定盘面性质再谈点位'), 'F: BP30 改五 前置预判断声明（market_pattern 放最前——用户裁定原话「market_pattern 要放到很靠前的位置，因为这是个预判断」）');
  ok(mp.includes('才做互斥检查（BP33）') && mp.includes('不是①⑤') && mp.includes('强庄盘的「庄」不能是著名跟单钱包') && mp.includes('famous 的货是要出货的，不是锁仓拉盘的庄'), 'F: BP30 改二 分类互斥教学（famous 控盘 ≥25 heavy+ 的盘子不落①⑤——「我画地为牢 既然是 famous 为啥还给中」：强庄的庄不能是著名跟单钱包，归③或按散户化/狙击形状归②④；BP47 精简重组后互斥主述在 famous 轴前置段）');
  // BP47（案号 BP43 第二版）famous 轴适用域厚度维度+③桶薄盘限定+控盘题厚盘不判拦截档（题面化——用户裁定「famous盘只用于判定早期，盘子很薄，famous入场收割」「famous 盘不适合已经有大量交易的情况」）
  ok(mp.includes('对归类的约束**只在早期薄盘成立**') && mp.includes('两维度任一命中即**退出 famous 轴**') && mp.includes('厚度维度（BP47') && mp.includes('盘子已厚') && mp.includes('厚盘 famous 占比是换手结果不是收割前兆'), 'F: BP47 famous 轴互斥适用域厚度维度（已有大量交易的盘面=盘子已厚，famous 占比是换手结果不是收割前兆，不触发互斥不落③——与 BP45 第一波价格维度并列双维度；BP47 精简重组后主述在 famous 轴前置段）');
  ok(mp.includes('适用域=早期薄盘（BP47，判据见前置检查②厚度维度）——「盘子很薄、famous 入场收割」才是本桶的形状') && mp.includes('苍蝇判例：出生数十秒 ultra 活跃吞吐、大量成交的盘面，famous 占比高但绝不是 famous 收割形状'), 'F: BP47 ③桶薄盘适用域限定（famous 独食致命前提=盘子还薄——薄盘 famous 大额才拿得动太多筹码；大量交易厚盘不落本桶按实际形状归类；BP47 精简后③桶压引用、判据主述在前置检查）');
  ok(qs.famous_domination.instructions.includes('⑦厚盘不判拦截档（BP47') && qs.famous_domination.instructions.includes('占比再高也不判 heavy/dominant 拦截档') && qs.famous_domination.instructions.includes('先看盘子厚薄，再谈占比切点') && qs.famous_domination.criteria.dominant.includes('仅早期薄盘适用（BP47）') && qs.famous_domination.criteria.heavy.includes('仅早期薄盘适用（BP47）'), 'F: BP47 控盘题厚盘判档语义（判档语义「价格由 famous 出货节奏决定」在厚盘不成立——总笔数多/吞吐金额可观/钱包数十个=承接在场 famous 砸不崩，heavy/dominant 不判往 light 靠占比照留档；BEM 极薄正例 74.5% 判 dominant 正确/苍蝇厚盘占比过半不判——纯题面路径代码不动）');
  ok(mp.includes('开盘段买入占全窗买入比例极高（参考 ≥70~80%）') && mp.includes('[WALLETS] 前列钱包首买@全在 t+0~几秒') && mp.includes('金额衰减比笔数更本质') && mp.includes('早期大买家清仓式撤退或只出不进'), 'F: BP30 改四 ④狙击衰竭判据补强（雪球SI S092/S100 案——开盘段占比 ≥70~80% ∧ 前列首买全在最初几秒 ∧ 后段金额吞吐骤降（笔密度可靠尘埃单撑、金额撑不住）∧ 早期大买家清仓式撤退）');
  ok(mp.includes('开局抢完即衰竭') && mp.includes('庄跑了的开盘大额只是狙击痕迹'), 'F: BP30 改四 ①④分界大户在场性（开盘大额但大买家已清仓式撤退=庄/狙击手已跑 → 走④不走①——S100 第 1 大 0x915e 清仓式卖出 1.247/1.300 只出不进）');
  ok(qs.market_pattern.criteria.early_sniper_decay.includes('开盘段后金额吞吐骤降') && qs.market_pattern.criteria.early_sniper_decay.includes('早期大买家清仓式撤退'), 'F: criteria early_sniper_decay 判据补强同步（BP30——桶描述与题面④判据一致）');
  ok(qs.market_pattern.criteria.early_sniper_decay.includes('极早窗（<90s 占比臂天然失明）看三证据（属路径 A 衰竭臂证据形状，同受前提臂约束）：正净持有人个位数且 top1 独食（60%+）+现价已破发+开盘大额买家已在卖=开局抢完无人接（BP38，不落①') && mp.includes('窗极短的衰竭三证据（BP38，不依赖开盘段占比——占比臂天然失明') && mp.includes('三证据属路径 A 衰竭臂的极早窗证据形状，同受前提臂约束') && mp.includes('①窗内正净持有人极少（筹码结构行正净持有者个位数）且 top1 独食') && mp.includes('②现价已破发（发行价位置行现价较发行价 <0') && mp.includes('③开盘大额买家已在卖（卖压行近 60s 大户卖出 >0'), 'F: ④极早窗衰竭三证据（BP38——ALPHA S011 判例：t+3s top1 64.8% 独食+正净持有 3 人+破发 −25%+大户已在卖=「除了最最早期无任何购买力」判④不判①；极早窗占比臂天然失明不依赖占比；BP47 精简重组后判据树在④桶；BP48 P0-4 三证据归属路径 A 同受前提臂约束）');
  // BP39（案号 BP34）④开盘拉高出货盘+三证据弱化+①④分界两判例+真庄保护反锚+athVsLaunchPct 锚
  ok(mp.includes('任两件在场且方向同向即坐实落④（BP39 弱化：三件是充分不是必要') && mp.includes('영복이 判例：正净持有 2 人+top1 近 60%+已破发+大户在卖=④'),
    'F: ④三证据弱化（BP39——三件充分非必要、任两件同向即落④，영복이 S103 判例；BP47 精简重组后判据树在④桶）');
  ok(mp.includes('拉高出货形态（BP39/BP40，不看开盘段占比、不受前提臂约束——拉得过高本身即风险，活跃度高不救拉高出货）——判序：先判真庄保护反锚，命中即停不落④；反锚不成立才按拉高判') && mp.includes('很短的窗内把价格拉得过高') && mp.includes('锚窗最高价较发行价 **+35% 以上**——BP40 由 +50 下调') && mp.includes('FlapGuy 判例：第一波购买太强、卖出后承接接不住') && mp.includes('单独成立即落④'),
    'F: ④开盘拉高出货盘新形态（BP39 立法+BP40 参考线下调 35+BP41 判序前置——开局拉得过高不看开盘段占比；先判反锚后判拉高命中即停；BP48 P0-2 路径 B 不受前提臂约束表述收口）');
  ok(mp.includes('反锚不成立的按拉高判**：很短的窗内把价格拉得过高') && mp.includes('**单独成立即落④——不再要求「已砸回+承接太弱」两要件**') && mp.includes('仍在拉升中的（现价贴锚窗最高价）同样落④——一开盘就拉高太多的票没有好，开局拉离发行价过远的位置本身就是风险，无论其后走势如何'),
    'F: ④拉得过高单独成立（BP40 收紧核心——bt-v79 三票 47.4/37.6/54.4 全 ≥35 线；已砸回/承接弱照落、仍在拉升中除真庄反锚外同落）');
  ok(mp.includes('腿①现价仍贴锚窗最高价（回落 <5% 级=拉升进行时）') && mp.includes('腿②锚前尾段（最后 5 秒）买入合计占全窗买入 **≥ 约三分之一**') && mp.includes('→ 不落④（拉升速度与位置交给位置门与①⑥分界——真庄第一波贴高点位不是接力风险）') && mp.includes('尾段占比**两成及以下**=burst 已过的顶部、反锚不成立') && mp.includes('b788e63b 判例 20%'),
    'F: ④真庄保护反锚 BP41 机械两腿（判序前置+腿②占比锚——贴顶 ∧ 尾段买占全窗买 ≥ 约三分之一=庄拉第一波推进中不落④；速度与位置交给位置门与①⑥分界）');
  ok(mp.includes('尾段占比**两成及以下**=burst 已过的顶部、反锚不成立（b788e63b 判例 20%：t+0s 单笔 1.5 BNB 巨单占全窗买入近半、尾段绝对额可观但流量已枯）') && mp.includes('**两成~三分之一边缘从宽救**（拒买类从严、真庄第一波勿误伤）'),
    'F: ④反锚腿②两档边界（两成及以下=burst 已过不救（b788e63b 判例 20%——巨单绝对额可观但流量已枯）；两成~三分之一边缘从宽救（用户裁定「不好处理就先不要误伤」——勿误伤真庄第一波））');
  ok(mp.includes('缓推盘（maxChg5 不过线**且**锚窗高点较发行价 <35%）不算拉过高（缓推但锚窗高点已拉离发行价一截的照落——位置不看速度）'),
    'F: ④缓推豁免两臂维持（BP40——缓推但锚窗高点 ≥35% 照落④位置不看速度）');
  ok(mp.includes('大户卖出后无承接=④不走①（BP39，Lily 判例）') && mp.includes('大户离场+狙击手跟风盘离场') && mp.includes('盘面无任何承接（尾段近窗买入归零或只剩零散小单）'),
    'F: ①④分界 Lily 判例（BP39——大户离场+狙击手离场+无承接=④非①；BP47 精简去冗词）');
  ok(mp.includes('开盘拉得过高=④单独成立（BP39/BP40 收紧）+真庄保护反锚两腿判序前置（BP41）') && mp.includes('判据全文见④桶开盘拉高出货盘形态'),
    'F: ①④分界开盘拉过高通则（BP39 立法+BP40 收紧为单独成立——反锚块同步；BP47 精简后反锚段压引用）');
  ok(mp.includes('**开盘拉得过高=④单独成立（BP39/BP40 收紧）+真庄保护反锚两腿判序前置（BP41）**') && mp.includes('判据全文见④桶开盘拉高出货盘形态'),
    'F: 反锚块 BP41 同步（④桶主文改判序后反锚块压引用——Jev 对照反锚段与④桶判读一致；BP47 精简）');
  ok(mp.includes('④⑥分位（BP40）') && mp.includes('锚窗最高价较发行价已拉得过高（参考 +35% 以上）的持续拉升归**④开盘拉高形态**不落本桶') && mp.includes('本桶收拉得不高（<35%）的持续纯拉——两桶门行为都拒，分位只影响归类'),
    'F: ④⑥分位句（BP40——拉得过高 ≥35% 归④位置风险、<35% 归⑥位置门再分，两桶门行为同效都拒只明归类）');
  ok(qs.market_pattern.criteria.early_sniper_decay.includes('BP39 弱化：任两件在场且同向即落④，三件充分非必要') && qs.market_pattern.criteria.early_sniper_decay.includes('开盘拉高出货盘（BP39，BP40 收紧，BP41 反锚前置）：开局短窗拉得过高') && qs.market_pattern.criteria.early_sniper_decay.includes('锚窗最高价较发行价过大（参考 +35% 以上）') && qs.market_pattern.criteria.early_sniper_decay.includes('单独成立即落④——不看是否已砸回/承接强弱、不受前提臂约束（拉得过高本身即风险，活跃度高不救拉高出货；一开盘就拉高太多的票没有好；仍在拉升中的同样落——**真庄反锚除外：现价贴锚窗最高价（回落 <5%）∧ 尾段买占全窗买 ≥ 约三分之一=庄拉第一波推进中不落④**（两成及以下=burst 已过不救；两成~三分之一边缘从宽救——勿误伤真庄第一波））'),
    'F: ④criteria 同步（BP39 弱化句+BP40 拉高收紧句+35 线+BP41 反锚机械两腿句——桶描述与题面判序一致）');
  ok(qs.market_pattern.instructions.includes('锚窗最高价较发行价已拉得过高（参考 +35% 以上') && qs.market_pattern.instructions.includes('锚窗最高价较发行价 **+35% 以上**——BP40 由 +50 下调'),
    'F: ④桶引用 athVsLaunchPct 渲染锚（发行价位置行「锚窗最高价较发行价」——BP39；BP47 精简后渲染句在④桶拉高判段）');
  // BP48 两质量题退役：QUALITY_LEVELS/QUALITY_IDS 双侧绝迹（ESM 题集+CJS mapper）；
  // ASSESSMENT_LEVELS 门域四值保留（bpPassLevels 消费域与历史 digest 行兼容不收窄）
  ok(!('QUALITY_LEVELS' in q) && !('QUALITY_IDS' in q), 'F: ESM 侧 QUALITY_LEVELS/QUALITY_IDS 常量绝迹（BP48 两质量题退役反证）');
  ok(JSON.stringify(ASSESSMENT_LEVELS) === JSON.stringify(['good', 'neutral', 'poor', 'insufficient']), 'F: ASSESSMENT_LEVELS 门域四值保留（bpPassLevels 消费域不动——good 不再产出但历史行重放兼容不收窄）');
  ok(ids.every((id) => DIMENSION_IDS.includes(id)) && DIMENSION_IDS.length === 8, 'F: 题集 id 与 mapper DIMENSION_IDS 对齐（8 维度 0 质量——BP48）');
  // BP48 裁定 1（位置门收口）——收尾门桶声明段三位置臂
  ok(mp.includes('盘型位置门（BP48 收口用户裁定「blended 接受 价格 near_launch 以及 almost_launch，当前只有庄盘可以接受 low，其它最多是 near_launch」）'), 'F: 收尾盘型位置门 BP48 收口句（用户开工令裁定 1 原话直译）');
  ok(mp.includes('①strong_backer 现价 ≤+80%（almost_launch/near_launch/low——庄盘独享 low 档 +40~80）放行、>+80% 或锚缺失拒') && mp.includes('⑤blended 现价 ≤+40%（almost_launch/near_launch）放行、>+40% 或锚缺失拒') && mp.includes('⑧golden_point ≤+40% 防御门（判据自带 ≤+20；现价 >+40%=判序错位同拒、锚缺失拒）') && mp.includes('各桶位置门放行后统一走活跃度门/筹码门'), 'F: 收尾①⑤⑧三位置臂声明（①庄盘独享 low ≤+80/⑤almost_launch+near_launch ≤+40/⑧防御门 ≤+40——放行后统一走门链）');
  // BP48 裁定 2（B 迁）——大户未清场两臂（BP16/BP17）迁入⑦⑧题面判读
  ok(mp.includes('大户未清场前提（BP48 迁移，先于两腿判——大户已清场的回落不落本桶）') && mp.includes('判据看「全窗持仓前三(正净 token)」行的**绝对买入金额**而非流通占比') && mp.includes('①**规模臂**——持仓前列买入全是小散尘级') && mp.includes('②**撤退臂**——在场大户正离场：全窗正净持仓 top5 钱包近 60s 卖出合计已占到前列持仓者买入额的大半（过半即撤退）') && mp.includes('两臂任一成立=大户已清场——回落无人承接，**不落⑦，按②(b) 散户化/④衰竭评**'), 'F: ⑦桶大户未清场前提（BP48 B 迁——BP16/BP17 规模臂+撤退臂判据原样迁入⑦题面：大户已清场的回落不落⑦按②(b)/④评；绝对买入金额口径非流通占比；判缺不猜保留）');
  ok(mp.includes('**大户未清场前提（BP48 迁移，与⑦同判）**') && mp.includes('活着不只看交易笔数，也要有真金承接者在场') && mp.includes('不落本桶，按②(b)/④评'), 'F: ⑧桶大户未清场前提（BP48 B 迁与⑦同判——黄金点「盘面仍然活着」含真金承接者在场）');
  ok(mp.includes('**⑦⑧的大户未清场前提（BP48 迁移）**：持仓前列大户已清场（规模臂/撤退臂，判据见⑦桶）的回落不落⑦⑧，按②(b)/④评'), 'F: 反锚段⑦⑧大户未清场前提回指（BP48 B 迁——判据主述在⑦桶反锚压引用）');
  ok(qs.market_pattern.criteria.restart.includes('**大户未清场前提（BP48 迁移）**') && qs.market_pattern.criteria.restart.includes('撤退臂=top5 近 60s 卖出合计占前列持仓者买入额大半') && qs.market_pattern.criteria.golden_point.includes('**大户未清场前提（BP48 迁移，与⑦同判）**'), 'F: criteria restart/golden_point 大户未清场同步（桶描述与题面判据一致，Jev 选桶时同判序）');
  // BP48 裁定 4（D 并入⑦）——深崩阴跌失血形状并入⑦题面判读（不落⑦按④/②(b)）
  ok(mp.includes('深崩阴跌失血不落本桶（BP48 并入）') && mp.includes('chg 阴性缓慢下行（非急砸）、holdersDelta60 为负（持有人净流失）、买盘枯竭（近窗买入归零/仅尘埃级）、大持仓派发放量') && mp.includes('是趋势性死亡不是重启洗盘，**不落⑦，按④/②(b) 评**') && mp.includes('⑦的回落=洗回起点仍有对手盘；失血回落=没人要了'), 'F: ⑦桶深崩阴跌失血不落⑦（BP48 D 并入——阴跌+持有人流失+买盘枯竭+派发放量=趋势性死亡非重启洗盘按④/②(b) 评）');
  ok(qs.market_pattern.criteria.restart.includes('**深崩阴跌失血不落本桶（BP48 并入）**'), 'F: criteria restart 深崩阴跌同步（桶描述与题面一致）');
  // BP48 裁定 3（C 弃）——maxChg5 速度锚不迁移：④桶拉高判据保留（maxChg5 ≥+40~50% 级），两质量题相关救臂/忌讳句绝迹
  ok(mp.includes('maxChg5 ≥+40~50% 级'), 'F: maxChg5 速度锚在④桶拉高判据保留（BP48 C 弃=不迁移——速度证据仍供④路径 B 拉高判读）');
  const noQuality = JSON.stringify(qs);
  ok(!noQuality.includes('第一分支·价格低救') && !noQuality.includes('累计位置硬腿') && !noQuality.includes('崩塌第一腿') && !noQuality.includes('庄盘豁免（BP32'), 'F: 早鸟/回调题忌讳救臂句绝迹（BP48 退役反证——maxChg5 救臂/忌讳/庄盘豁免链不迁移，①庄盘语义由①桶 strong_backer ≤+80 位置门承载）');
  // BP48 裁定 3（C 弃）后两质量题整段删除——⑦⑧承载大户未清场判读（B 迁）、
  // ④桶保留拉高判据、黄金点豁免奔零臂语义并入⑧桶自身三条件（区内∧活跃∧有买入）
  // BP25 案三改（S043 高点接盘——low 档收窄+庄盘豁免一档帽+mid 浅回调一律拒）；
  // BP43 六桶改制（almost_launch 前插/near_launch 20~40/low 40~80/mid 下界 +100→+80）
  ok(qs.price_level.instructions.includes('+20%~+40% =接近发行价；+40%~+80% ≈ 1.4~1.8 倍=偏低；+80%~+600% ≈ 1.8~7 倍=不高不低') && qs.price_level.criteria.low.includes('+40%~+80%，1.4~1.8 倍') && qs.price_level.criteria.mid.includes('+80%~+600%，1.8~7 倍'), 'F: price_level 六桶分界（BP27/BP25 案 low 档收窄+BP43 六桶改制 almost_launch 前插——low=较发行价 +40~80、mid 改 +80~600）');
  ok(qs.price_level.instructions.includes('较发行价 >+80%（近 2 倍以上）=已明显脱离发行价区——正常路径不构成「价格低」的可参与证据') && qs.price_level.instructions.includes('+80% 以上的位置只有非常少的情况（庄盘位置门内）才可参与，其它豁免口暂未开设'), 'F: price_level 反锚④不开口句（BP27+BP43 界 +100→+80——mid 下界收到 +80；BP48 收口后 +80 以上唯一参与路径=①庄盘位置门 ≤+80）');
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
  ok(al.instructions.includes('低档与超高档均由代码侧活跃度门直接消费拒买') && al.instructions.includes('超高=机器盘级极端密集——正常散户参与盘到不了这个密度，BP30 用户裁定「act 为 ultra 也不玩」') && al.instructions.includes('BP38 豁免：盘型题判①strong_backer 的票 ultra 不由活跃度门拦') && al.instructions.includes('强庄盘拉盘天然密集，ultra 密度不是拒买证据，代码侧豁免'), 'F: activity_level 收尾=门消费声明（BP30 ultra 臂+BP38 strong_backer 豁免教学——Jev 只管判档，豁免由代码执行）');
  // BP28 案改一（S053 太空逆袭 activity 误 low——三段形状执行缝隙）
  ok(al.instructions.includes('三段形状（开局冲一波→中段完全静默→临近买点再集中涌入，BP30）同样属「静默后买入涌入」') && al.instructions.includes('判读锚定**买点时刻的即时状态**') && al.instructions.includes('中段静默的占比不压档') && al.instructions.includes('不是针对静默居中的三段形状'), 'F: activity⑥反锚三段形状归属句（BP30/BP28 案 S053——开局 7 秒冲 7 笔→中段 24 秒完全静默→锚前 2 秒 8 笔近 1 BNB 同块涌入：静默居中的三段形状按「静默后买入涌入」中档起判，「先冲一波后静默」不保护臂只管涌入后死到锚点的形状）');
  ok(al.instructions.includes('买点时刻盘面正被涌入激活（锚前尾段行=8 笔近 1 BNB 直接可见），静默居中的三段形状按「静默后买入涌入」中档起判，不因中段静默占比判低'), 'F: activity 反例样本段补三段形状反例（BP31——S053 形状直译锚+尾段行数值佐证）');
  // BP28 案四改：⑥句挂尾段行判读锚（state 时序盲区补位）
  ok(al.instructions.includes('判读原料=**数值行「锚前尾段(最后5秒)」**') && al.instructions.includes('锚前尾段多笔且金额可观（参考 ≥3 笔/合计 ≥0.3 BNB 级）=锚点时刻正被流量激活的直接证据') && al.instructions.includes('三段形状判尾段行不判段内最大间隔') && al.instructions.includes('尾段仅 1 笔/合计尘级=锚点即静默边界'), 'F: activity⑥尾段行判读锚（BP31——临近段 totals 无时序测不出涌入在段尾；末行恒在尾段内最少 1 笔，死寂臂=仅 1 笔尘级非 0 笔）');
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
  ok(hc2.instructions.includes('价格几乎发行价豁免持有者不均衡') && hc2.instructions.includes('currentVsLaunchPct ≤ +20%') && hc2.instructions.includes('不坐实 strong'),
    'F: holder_concentration 反锚⑥价格豁免锚（BP15 谷谷案+BP43 界 ≤+50 收至 ≤+20 almost_launch 档——贴发行价头部无浮盈可砸，不坐实 strong）');
  ok(hc2.instructions.includes('只豁本题（holder 集中轴），不豁 famous 控盘题'), 'F: holder_concentration 豁免⑥限定 holder 轴（BEM famous dominant 验收零翻案防线）');
  ok(hc2.instructions.includes('谷谷案·价格豁免正例') && hc2.instructions.includes('56.5%'), 'F: holder_concentration 形状样本含谷谷正例（6~9 过线+佐证但 +25% 贴发行价→豁免落观察档）');
  ok(hc2.instructions.includes('top1 单一 >90%') && hc2.instructions.includes('一人控盘'), 'F: holder_concentration 一人控盘例外（≤5 豁免域破例 strong）');
  ok(hc2.instructions.includes('strong 档由代码侧筹码门直接消费拒买'), 'F: holder_concentration 收尾=门消费声明');
  ok(hc2.instructions.includes('BEM Miner') && hc2.instructions.includes('BOSS'), 'F: holder_concentration 形状样本=BEM（一人控盘）+BOSS（CD240 ≥10 过线坐实）双对照');
  // BP30 改六 tree_position/追高题退役+BP48 两质量题退役——四题题面整链绝迹（反证）
  ok(!('tree_position' in qs) && !('high_chase_quality' in qs) && !('early_bird_quality' in qs) && !('pullback_entry_quality' in qs), 'F: BP30/BP48 四题绝迹（tree_position/high_chase/early_bird/pullback_entry 题面/桶域/常量整链删除）');
  ok(!JSON.stringify(qs).includes('tree_position') && !JSON.stringify(qs).includes('high_chase') && !JSON.stringify(qs).includes('圣诞树视角'), 'F: 全题集文本 tree_position/high_chase/圣诞树视角字样绝迹（BP30/BP48 退役反证）');

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
