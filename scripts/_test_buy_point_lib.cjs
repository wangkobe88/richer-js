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
  HOLDER_CONCENTRATION_LEVELS,
  PRICE_LEVEL_LEVELS,
  MARKET_PATTERN_LEVELS, PATTERN_GATE_POOR_BUCKETS,
  ACTIVITY_GATE_POOR_BUCKETS,
  SUSTAINED_CLIMB_LAUNCH_PCT, NORMAL_ENTRY_LAUNCH_PCT,
  ENTRY_SHAPE_LEVELS, ENTRY_GATE_POOR_BUCKETS,
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

// BP49 退役导出绝迹锁（FAMOUS_DOMINATION_LEVELS/ENTRY_POSITION_LEVELS/
// CHIP_GATE_FAMOUS_POOR_BUCKETS 随 famous_domination/entry_position 题删除）
{
  const m49 = require('../src/market-analysis/buy-point-result-mapper');
  ok(m49.FAMOUS_DOMINATION_LEVELS === undefined && m49.ENTRY_POSITION_LEVELS === undefined
    && m49.CHIP_GATE_FAMOUS_POOR_BUCKETS === undefined,
    'E: BP49 退役导出绝迹（FAMOUS_DOMINATION_LEVELS/ENTRY_POSITION_LEVELS/CHIP_GATE_FAMOUS_POOR_BUCKETS）');
  // BP58 退役导出绝迹锁（随④桶豁免臂/独立位置门删除的九常量——RESTART/
  // STRONG_BACKER/BLENDED/GOLDEN_POINT/SNIPER 族；统一门=NORMAL_ENTRY_LAUNCH_PCT）
  ok(m49.RESTART_LAUNCH_PCT === undefined && m49.STRONG_BACKER_LAUNCH_PCT === undefined
    && m49.BLENDED_LAUNCH_PCT === undefined && m49.GOLDEN_POINT_LAUNCH_PCT === undefined
    && m49.SNIPER_DECAY_HEAT_LAUNCH_PCT === undefined && m49.SNIPER_DECAY_HEAT_BUCKETS === undefined
    && m49.SNIPER_DECAY_OPEN_SHARE_MAX === undefined && m49.SNIPER_ULTRA_ROUTER_MIN_PCT === undefined
    && m49.SNIPER_ULTRA_ROUTER_LAUNCH_PCT === undefined,
    'E: BP58 退役导出绝迹（RESTART/STRONG_BACKER/BLENDED/GOLDEN_POINT/SNIPER 族九常量随改制删除）');
  ok(m49.NORMAL_ENTRY_LAUNCH_PCT === 27.5 && m49.SUSTAINED_CLIMB_LAUNCH_PCT === 10,
    'E: BP58 统一位置门常量（NORMAL_ENTRY_LAUNCH_PCT=27.5 / SUSTAINED_CLIMB_LAUNCH_PCT=10 独立保留）');
}

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
// platform 刻意不设（2026-11-08 发行价口径修正后）：场景 A 全链=旧口径（首可靠价
// launchCovered 门）bit 回归锁——null 平台零变化；常量平台锚行为锁在
// _test_cheat_market_reset C 段/_test_current_vs_launch_factor H 段
const metaA = { address: '0x' + 'ab'.repeat(20), symbol: 'TEST', name: 'Test Token', createdAt: T0, creatorAddress: CREATOR, totalSupply: 1e9 };
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
  // BP58 点位性质速度三键（rowsM 全窗=临近段 44s<120s → near 族与全窗同值）：
  // 最大跌幅段=40→42 的 1.3→1.0（-23.08%）；最大涨幅段=30→33 的 0.9→1.35（+50%）
  ok(dM.maxDn5Pct === -23.08 && dM.nearMaxUp5Pct === 50 && dM.nearMaxDn5Pct === -23.08,
    `BP58 速度三键（maxDn5=-23.08（40→42 段 1.3→1.0）/nearMaxUp5=+50/nearMaxDn5=-23.08（全窗=临近段），实际 ${dM.maxDn5Pct}/${dM.nearMaxUp5Pct}/${dM.nearMaxDn5Pct}）`);
  // BP58 curVsMinGapPct：launch=首可靠价 1.0，首个突破 +10% 离开=行2@13 的 1.4（+40%），
  // 涨起后最低=行5@30 的 0.9（破发 −10%）→ minVs=-10；现价 1.3=+30% → gap=30−(−10)=40
  ok(dM.minVsLaunchPct === -10 && dM.curVsMinGapPct === 40,
    `BP58 curVsMinGapPct（minVs=-10（涨起后最低 0.9 破发）/gap=40（现价 +30 − 最低 −10），实际 ${dM.minVsLaunchPct}/${dM.curVsMinGapPct}）`);
}
ok(dA.maxChg5Pct === null, `A fixture 无 ≤5s 跨行段（间隔≥10s、同块行队首==j 不计）→ maxChg5=null（实际 ${dA.maxChg5Pct}）`);
// BP58 A fixture 三键：同块行 9→10（2.0→1.95）=-2.5% 计入（双单调队列同块两笔价格差真实）；
// 临近段 dt>95 段内无 ≤5s 跨行涨段（110→125 已 15s 外）→ nearMaxUp5=null 有证据缺失
ok(dA.maxDn5Pct === -2.5 && dA.nearMaxUp5Pct === null && dA.nearMaxDn5Pct === -2.5,
  `BP58 A fixture 速度三键（maxDn5=-2.5 同块段/nearMaxUp5=null 段内无涨段/nearMaxDn5=-2.5，实际 ${dA.maxDn5Pct}/${dA.nearMaxUp5Pct}/${dA.nearMaxDn5Pct}）`);
// BP58 A fixture curVsMinGapPct：launch=首可靠价 1.0@5，首个突破 +10% 离开=行3@35 的 1.2，
// 涨起后最低=离开笔自身 1.2（此后再未低于它）→ minVs=+20；现价 1.6=+60% → gap=40
ok(dA.minVsLaunchPct === 20 && dA.curVsMinGapPct === 40,
  `BP58 A fixture curVsMinGapPct（minVs=+20（涨起后最低=离开笔自身 1.2）/gap=40（60−20），实际 ${dA.minVsLaunchPct}/${dA.curVsMinGapPct}）`);
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
// almost 上界（2026-11-09 起 +10%）离开起（含离开那一笔）的最低）：dA 首个 >1.1e-9=行3
//（1.2e-9；行2=1.1 恰等不算离开），涨起后段最低=行3 本身 1.2e-9（其后 1.3 起更高）→ +20.0%
// ——涨过 +100% 后只回到 +20，未回到 almost_launch（>10）；
// 刻意不取整窗最低（整窗最低=发行价本身 → 恒 0% 结构性失效）
ok(dA.minVsLaunchPct === 20,
  `minVsLaunchPct=+20（涨起后最低 1.2e-9 ÷ 发行价 1e-9=+20.0%——涨起后段最低=突破行本身（1.2），其后 1.3 起更高未再低于；整窗最低恒=发行价不作判据，实际 ${dA.minVsLaunchPct}）`);
{
  // BP43 restart 形状微夹具手算：1.0→1.4→2.0(ATH)→1.3→1.05→1.3——首个突破 1.1=行2(1.4)，
  // 涨起后段最低 1.05=+5.0% ≤10（重启盘价格回到腿成立）；对照单调涨（1.0→1.2→1.5→1.8，
  // 首个突破 1.1=行2(1.2)）涨起后段最低 1.2=+20.0% >10=从未回到（值非 null——判据不成立而非无证据）
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
    `restart 形状：涨起后最低 +5.0% ≤10（回到腿成立）/现价 +30%/ATH +100%（实际 ${dR.minVsLaunchPct}/${dR.currentVsLaunchPct}/${dR.athVsLaunchPct}）`);
  const rowsMono = [
    row(10, 'BUY', W_B, 0.1, 1.0 * E9, 1e8),
    row(20, 'BUY', W_C, 0.1, 1.2 * E9, 1e8),
    row(30, 'BUY', W_D, 0.1, 1.5 * E9, 1e8),
    row(40, 'BUY', W_E, 0.1, 1.8 * E9, 1e8),
  ];
  const dMono = buildBuyPointSnapshot(rowsMono, metaA).buyDerived;
  ok(dMono.minVsLaunchPct === 20,
    `单调涨（从未回落）：涨起后最低 +20.0% >10=从未回到 almost_launch——值非 null（有证据的「没回到」，BP44 定义下不再因 ATH 在末位失明；回到腿不成立，实际 ${dMono.minVsLaunchPct}）`);
  // BP44 案核心形状（bt-s01 0x28ad2c7d）：回落 almost_launch 后重新拉起创新高——
  // 1.0→1.5→1.1→1.05→1.6(ATH 在末位)。BP43 首版「峰后」定义下 ATH 在末位→null 结构性
  // 失明（对拍 0/9 判④根因）；涨起后定义=首个突破 1.1=行2(1.5) 之后段最低 1.05=+5.0%
  // ≤10 → 回到腿成立（创新高不遮蔽回落）
  const rowsNH = [
    row(10, 'BUY', W_B, 0.1, 1.0 * E9, 1e8),
    row(20, 'BUY', W_C, 0.1, 1.5 * E9, 1e8),
    row(30, 'SELL', W_D, 0.1, 1.1 * E9, 1e8),
    row(40, 'SELL', W_E, 0.1, 1.05 * E9, 1e8),
    row(50, 'BUY', W_F, 0.1, 1.6 * E9, 1e8),
  ];
  const dNH = buildBuyPointSnapshot(rowsNH, metaA).buyDerived;
  ok(dNH.minVsLaunchPct === 5 && dNH.athVsLaunchPct === 60 && dNH.currentVsLaunchPct === 60,
    `创新高重启形状（BP44 案核心）：涨起后最低 +5.0% ≤10（回到腿成立——ATH 在末位不失明）/ATH +60%=现价（重新拉起创新高中）（实际 ${dNH.minVsLaunchPct}/${dNH.athVsLaunchPct}/${dNH.currentVsLaunchPct}）`);
  // 从未离开 almost_launch（1.0→1.05→1.08→1.05，全程 ≤+10%——2026-11-09 上界 20→10
  // 夹具同步收紧）→ null（无「回到」语义不冒充）
  const rowsStay = [
    row(10, 'BUY', W_B, 0.1, 1.0 * E9, 1e8),
    row(20, 'BUY', W_C, 0.1, 1.05 * E9, 1e8),
    row(30, 'SELL', W_D, 0.1, 1.08 * E9, 1e8),
    row(40, 'BUY', W_E, 0.1, 1.05 * E9, 1e8),
  ];
  const dStay = buildBuyPointSnapshot(rowsStay, metaA).buyDerived;
  ok(dStay.minVsLaunchPct === null,
    `从未离开 almost_launch（全程 ≤+10%）→ null（无「回到」语义不冒充，实际 ${dStay.minVsLaunchPct}）`);
}
// priceBuckets：17 可靠价行 → 等笔距 20 桶 3 空（b∈{0,6,13}）=17 桶
ok(dA.priceBuckets.length === 17, `priceBuckets=17 桶（实际 ${dA.priceBuckets.length}）`);
ok(dA.priceBuckets[0].dt === 5 && near(dA.priceBuckets[0].price, 1.0 * E9), '首桶=行1 @t+5');
ok(dA.priceBuckets[16].dt === 215 && near(dA.priceBuckets[16].price, 1.6 * E9), '末桶=行18 @t+215');
// cheatDerived 背景直读不重算
ok(snapA.cheatDerived.totalBuyBnb > 0 && Array.isArray(snapA.cheatDerived.holdingsProfile), 'cheatDerived 原样在场（背景复用）');

// ═══════════════ A9. famous 痕迹族（BP53 二修/案号 BP61——state 补行路线） ═══════════════
console.log('A9. famousTraces 手算（注入名单——收割完/在场/无命中/名单缺失四形状）');
{
  const W_FA = '0x' + 'fa'.repeat(20); // famous A：t+0 买 0.30 → t+5 卖 0.29（净 +0.01、卖/买 96.7%=收割中形状）
  const W_FB = '0x' + 'fb'.repeat(20); // famous B：t+8 买 0.35 → t+11 卖 0.36（净 −0.01 已清仓）
  const rosterFt = new Set([W_FA, W_FB]);
  const rowsFt = [
    row(0, 'BUY', W_FA, 0.30, 1.0 * E9, 3e8),
    row(5, 'SELL', W_FA, 0.29, 1.2 * E9, 2.4e8),
    row(8, 'BUY', W_FB, 0.35, 1.1 * E9, 3.2e8),
    row(11, 'SELL', W_FB, 0.36, 1.05 * E9, 3.4e8),
    row(20, 'BUY', W_B, 0.20, 1.15 * E9, 1.7e8), // 散户（占比分母）
    row(30, 'BUY', W_C, 0.15, 1.2 * E9, 1.25e8),
  ];
  const metaFt = { ...metaA, address: '0x' + 'cd'.repeat(20) };
  const snapFt = buildBuyPointSnapshot(rowsFt, metaFt, { famousRoster: rosterFt });
  const ft = snapFt.buyDerived.famousTraces;
  // 手算：famous 买 0.30+0.35=0.65 / 全窗买 1.00 → 65.0%；famous 卖 0.65 / 全窗卖 0.65 → 100.0%
  // Σ净 = +0.01−0.01 = 0.00；净>0 的名单钱包=1（W_FA）；排序按买额降序 W_FB 首
  ok(ft && ft.wallets.length === 2, `famousTraces 钱包 2 个（实际 ${ft && ft.wallets.length}）`);
  ok(ft.wallets[0].w === W_FB && ft.wallets[0].buyBnb === 0.35 && ft.wallets[0].buyN === 1
    && ft.wallets[0].firstBuyDt === 8 && ft.wallets[0].sellBnb === 0.36 && ft.wallets[0].firstSellDt === 11
    && ft.wallets[0].netBnb === -0.01, `FB 行精确值（买 0.35@t+8/卖 0.36@t+11/净 −0.01，实际 ${JSON.stringify(ft.wallets[0])}）`);
  ok(ft.wallets[1].w === W_FA && ft.wallets[1].firstBuyDt === 0 && ft.wallets[1].firstSellDt === 5
    && ft.wallets[1].netBnb === 0.01, `FA 行精确值（买 0.30@t+0/卖 0.29@t+5/净 +0.01，实际 ${JSON.stringify(ft.wallets[1])}）`);
  ok(ft.groupBuyBnb === 0.65 && ft.groupBuyPct === 65.0 && ft.groupSellPct === 100.0,
    `合计占比（groupBuy 0.65=65.0%/groupSell=100.0%，实际 ${ft.groupBuyBnb}/${ft.groupBuyPct}/${ft.groupSellPct}）`);
  ok(ft.netSumBnb === 0.00 && ft.inCustodyCount === 1, `Σ净 0.00 且在场计数 1（实际 ${ft.netSumBnb}/${ft.inCustodyCount}）`);
  // state 渲染三形状
  const stFt = buildBuyPointState(snapFt).state;
  ok(stFt.includes('famous 痕迹: 锚窗内名单钱包 2 个') && stFt.includes('0xfbfb…fbfb') && stFt.includes('0xfafa…fafa'),
    'state 命中行（2 钱包+短址直供——slice(0,6)+…+slice(-4)）');
  ok(stFt.includes('净 +0.0100') && stFt.includes('净 -0.0100') && stFt.includes('Σ净 +0.0000')
    && stFt.includes('净持仓>0 的名单钱包 1 个') && stFt.includes('占全窗买 65.0%') && stFt.includes('占全窗卖 100.0%')
    && stFt.includes('卖出/买入 102.9%') && stFt.includes('卖出/买入 96.7%') && stFt.includes('在场性判读三分') && stFt.includes('=收割中——收割完/收割中同落③桶残局臂'),
    'state 命中行数值（单钱包净/Σ净/在场计数/占比+三修卖/买比与判读三分句——FB 102.9%/FA 96.7%）');
  const ftMiss = buildBuyPointSnapshot(rowsFt, metaFt, { famousRoster: new Set(['0x' + '99'.repeat(20)]) }).buyDerived.famousTraces;
  ok(ftMiss.wallets.length === 0 && ftMiss.inCustodyCount === 0
    && buildBuyPointState(buildBuyPointSnapshot(rowsFt, metaFt, { famousRoster: new Set(['0x' + '99'.repeat(20)]) })).state.includes('famous 痕迹: 锚窗内名单钱包 0 个（无 famous 活动证据'),
    '无命中形状（wallets=[] 计数 0 + state 0 个行）');
  const snapFtNull = buildBuyPointSnapshot(rowsFt, metaFt, { famousRoster: null });
  ok(snapFtNull.buyDerived.famousTraces === null
    && buildBuyPointState(snapFtNull).state.includes('famous 痕迹: ?（名单缺失'),
    '名单缺失形状（键整体 null + state ? 行——与 cheatDerived famous 族 null 语义同向）');
  // 注入路径反证：不传 options.famousRoster → 读真实 config 名单（rowsFt 钱包不在册=0 命中）
  const ftDefault = buildBuyPointSnapshot(rowsFt, metaFt).buyDerived.famousTraces;
  ok(ftDefault && ftDefault.wallets.length === 0, '缺省名单加载路径（真实 config 名单——rowsFt 钱包不在册零命中）');
}

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
  ok(keysAct === 'buyMedianBnb,idlePct,maxDrawdownPct,nearPre20BnbPerMin,nearSegBnbPerMin,nearSegBuyMedianBnb,nearSegBuyN,nearSegMaxGapSec,nearSegSellN,nearSegTickN,nearSegTicksPerMin,nearTail10BnbPerMin,nearTail10SellWallets,nearTail10TickN,nearTail5BuyBnb,nearTail5BuyN,nearTail5BuySharePct,nearTail5TickN,spanSec,throughputBnbPerMin,tickCount', `C: activity 恰 21 键（BP41 尾段占比锚 16→17+CD394 尾窗四键 17→21：nearTail10TickN/BnbPerMin+nearPre20BnbPerMin+nearTail10SellWallets 出货臂判读线，实际 ${keysAct}）`);
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
ok(stD.state.includes('临近尾窗(尾10秒/前20秒):') && stD.state.includes('卖侧独立钱包') && stD.state.includes('协同出货') && stD.state.includes('档位照实落超高') && stD.state.includes('买入方向才是买方需求在场'),
  'D: BP57 临近尾窗行渲染（CD394 尾窗锚+出货臂判读线卖侧独立钱包数+四臂句——AMM 卖出恒被池子接走的认知修正句）');
ok(stD.state.includes('市值位置(BNB 域): 现价市值 1.6 / 窗内峰市值 2 / 较峰回撤 20.00%'), 'D: 市值位置行手算值渲染（BP2）');
ok(stD.state.includes('holder 流向: 现正净持仓钱包 7 个；近 60s 变化 -1'), 'D: holder 流向行渲染（W_D 尾窗清仓净流失）');
ok(stD.state.includes('发行价位置: 现价较发行价 +60.0%') && stD.state.includes('发行价 1.00e-9 BNB'), 'D: 发行价位置行渲染（BP5——fmtPrice 同 [PRICE] 口径）');
ok(stD.state.includes('锚窗最高价较发行价 +100.0%'), 'D: 发行价位置行渲染锚窗最高价较发行价（BP39 athVsLaunchPct——锚窗 ATH 2e-9 ÷ 发行价 1e-9）');
ok(stD.state.includes('锚窗涨起后最低价较发行价 +20.0%'), 'D: 发行价位置行渲染锚窗涨起后最低价较发行价（BP43 minVsLaunchPct——首个突破 +10%（2026-11-09 上界 20→10）=行3 1.2e-9、段最低即 1.2e-9 ÷ 发行价 1e-9，restart 重启盘回到腿判据行）');
ok(stD.state.includes('现价高于该最低 40.0pp'), 'D: 发行价位置行渲染 curVsMinGapPct（BP58 点位性质 crash 贴底臂判读原料——现价 +60 − 涨起后最低 +20 = 40pp 手算）');
ok(stD.state.includes('回看速度(5秒段): 全窗最大涨幅 ? / 最大跌幅 -2.50%；临近段(锚前120s)最大涨幅 ? / 最大跌幅 -2.50%') && stD.state.includes('点位性质判读原料——临近段单段跌 ≥15%=直线砸盘进行时、单段涨 ≥15%=尖刺拉升'),
  'D: 回看速度行四键渲染（BP58 maxDn5/nearMaxUp5/nearMaxDn5 三新键——A fixture 同块段 2.0→1.95=-2.50%、无涨段 ?；判读教学句直线砸盘/尖刺拉升）');
ok(!stD.state.includes('摆动结构') && !stD.state.includes('圣诞树原料'),
  'D: 摆动结构行已删（BP30/题集 BP33 tree_position 退役——state 不再渲染圣诞树原料行，zigzag 锚照算落 digest 纯留档）');
ok(stD.state.includes('判定结构') && stD.state.includes('①盘型门（预判断，最前）——异常盘面识别') && stD.state.includes('早鸟/回调两道质量题与 tree_position、追高、famous 控盘、相对价格、市场热度维度题均已退役'),
  'D: 判定指引纯门链结构+质量题/tree/追高/热度退役声明（BP48 两质量题退役+BP30 盘型前置预判断+BP49 famous 控盘/相对价格两维度题退役+BP60 market_heat 退役）');
ok(stD.state.includes('②点位性质门（BP58 新题 entry_shape）') && stD.state.includes('好点位=活跃交易中对倒中的低价/正常下跌造成的低价')
  && stD.state.includes('直线砸盘（crash——庄离场暴跌：较锚窗高点回撤 ≥25%/30s 跌 ≥25%/临近段 5s 单段跌 ≥15%/现价贴着锚窗最低 ≤2pp 任一臂，砸盘后的反弹不救）')
  && stD.state.includes('尖刺拉盘追高（spike——30s 涨 ≥20%/临近段 5s 单段涨 ≥15%/现价贴锚窗高点 ≥-5% 任一臂）')
  && stD.state.includes('正常回调低价（normal_dip——有下跌但非直线砸盘，对倒/正常下跌造成的低价=目标买入形状）'),
  'D: 判定指引②点位性质门四桶判读句（BP58 新题——crash 四臂/spike 三臂判读线+normal_dip 目标形状声明）');
ok(stD.state.includes('③活跃度门') && stD.state.includes('activity_level=ultra（机器盘级极端密集') && stD.state.includes('无条件拦'),
  'D: 判定指引③活跃度门 ultra 臂无条件拦声明（BP30 改三「act 为 ultra 也不玩」+BP58 豁免臂随桶改制删除）');
ok(stD.state.includes('④筹码门') && stD.state.includes('持仓集中（holder_concentration）strong') && stD.state.includes('代码侧停用中不激活'),
  'D: 判定指引④筹码门 holder 单臂停用声明（BP54 CHIP_GATE_ENABLED=false 答案照答落档观察材料保留）');
ok(stD.state.includes('持续拉升弱回调（sustained_climb）走独立位置门') && stD.state.includes('（≤+10% 含破发）的起点段放行、已拉离=不参与（判型归你、位置归代码）'),
  'D: 判定指引①盘型门⑥位置臂声明（BP34/BP31 案——只能临近发布价格参与；判型归 Jev 位置归代码）');
ok(stD.state.includes('none 正常盘面统一位置门 ≤+27.5%') && stD.state.includes('已拉离（>+27.5%）=不参与（只买性价比高的点位，不追高）'),
  'D: 判定指引 none 统一位置门 27.5 声明（BP58 用户裁定「现在买入点位已经不是小于 40，应该是小于 27.5」）');
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
  ...mkAns('market_heat', 'high'), // BP60 退役键：维度缺席不被消费不 throw（重放兼容留档锚）
  ...mkAns('activity_level', 'mid'),
  ...mkAns('holder_concentration', 'none'),
  ...mkAns('price_level', 'near_launch'),
  ...mkAns('market_pattern', 'none', 0.8),
  ...mkAns('entry_shape', 'normal_dip'),
  // BP48 两质量题（early_bird_quality/pullback_entry_quality）+BP49 两维度题
  // （famous_domination/entry_position）+BP60 market_heat 退役——均不被消费；
  // BP58 新题 entry_shape 基线=normal_dip；BP60 四桶化 market_pattern 基线=none
});
const dE = { ...dA, currentVsLaunchPct: 20 }; // obsE 专用锚：none 走统一位置门 27.5——20 ≤27.5 过门（dA 原 +60 被统一门拒）
const obsE = buildBuyPointObservation(fullAnswers(), dE);
ok(Object.keys(obsE.dimensions).length === 6 && obsE.dimensions.price_trend.bucket === 'fast_up' && obsE.dimensions.activity_level.bucket === 'mid' && obsE.dimensions.entry_shape.bucket === 'normal_dip' && obsE.dimensions.market_pattern.bucket === 'none', 'E: 六维度 argmax 透传（BP30 删 tree_position；BP48 无质量题；BP49 删 famous_domination/entry_position；BP58 增 entry_shape；BP60 删 market_heat——market_heat 答案在场也不进 dimensions 键集）');
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
// BP49 旧档重放兼容：带 famous_domination/entry_position 答案的旧 answers 不被消费不 throw
// （键忽略——famous heavy/dominant 不再触发 chip_gate，纯键忽略重放）
{
  const legacyAns = { ...fullAnswers(), ...mkAns('famous_domination', 'dominant', 0.95), ...mkAns('entry_position', 'near_high', 0.8) };
  const obsLegacy49 = buildBuyPointObservation(legacyAns, dE);
  ok(obsLegacy49.assessment.bucket === 'neutral' && obsLegacy49.assessment.rule === 'gates_passed' && !('famous_domination' in obsLegacy49.dimensions) && !('entry_position' in obsLegacy49.dimensions),
    'E: 旧档带 famous_domination/entry_position 答案不被消费（BP49 重放兼容——维度键忽略不 throw、famous 臂不再拦）');
}
// BP8 活跃度门（用户裁定：活跃度 low 不参与）；BP13 曾扩双题（market_heat low OR
// activity_level low——ZELDA 案：market_heat 纯密度对「每分钟成交额 BNB」失真）；
// BP60 起 market_heat 整题退役（与 activity_level 重复——用户裁定），门收单题臂
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_heat', 'low', 0.88) }, dE).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: BP60 heat=low 答案不被消费（题退役——维度键缺席桶域校验不触及，旧档重放兼容放行）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('activity_level', 'low', 0.81) }, dE).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.81) && aM.rule === 'activity_gate', 'E: 门① act=low（heat=high 答案在场不参与）→ poor/activity_gate（买点前全窗量级死寂——ZELDA 形状拦截臂）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_heat', 'low', 0.7), ...mkAns('activity_level', 'low', 0.93) }, dE).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.93) && aM.rule === 'activity_gate', 'E: 门② 双 low 答案在场 → prob=act 单臂（BP60 heat 臂删——只有 activity_level 一个门臂）');
// BP30 改三 ultra 臂：act=ultra 机器盘级极端密集同拒（로켓급 S086/雪球SI S092 形状——
// 用户裁定「act 为altra也不玩」，对齐 CD M 通道）；market_heat 的 ultra 不拦
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('activity_level', 'ultra', 0.86) }, dE).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.86) && aM.rule === 'activity_gate', 'E: 门② BP30 ultra 臂 act=ultra → poor/activity_gate（机器盘级极端密集也不玩）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('activity_level', 'ultra', 0.86), ...mkAns('early_bird_quality', 'good', 0.95) }, dE).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'activity_gate', 'E: 门② ultra 臂拒（act ultra——旧档质量题答案在场不被消费照拒）');
// BP58 ultra 臂无条件拦（BP38 strong_backer ultra 豁免臂随桶改制删除；BP60 四桶化
// 后正常盘面归 none——机器盘级极端密度不因盘型豁免，苍蝇/来财类 ultra 票由 act 门直接拦）
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('activity_level', 'ultra', 0.65) }, dE).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.65) && aM.rule === 'activity_gate', 'E: BP58+BP60 none+act=ultra → 无条件拦 activity_gate（BP38 豁免臂随④桶改制删除——正常盘面归 none 后无 act 豁免通道）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('activity_level', 'ultra', 0.65), ...mkAns('early_bird_quality', 'good', 0.95) }, dE).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'activity_gate', 'E: BP58 ultra 无条件拦（旧档质量题答案不被消费照拒）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('activity_level', 'low', 0.8) }, dE).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.8) && aM.rule === 'activity_gate', 'E: BP58+BP60 none+act low 照拦（活跃度死寂不豁免——low 臂从未在豁免域）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('activity_level', 'ultra', 0.65), ...mkAns('market_heat', 'low', 0.9) }, dE).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.65) && aM.rule === 'activity_gate', 'E: BP60 act=ultra+heat low 在场 → prob=act 单臂（heat 答案不被消费——prob 不再取 heat 臂）');
{
  const { market_pattern: _drop, ...noPattern } = fullAnswers();
  aM = buildBuyPointObservation({ ...noPattern, ...mkAns('activity_level', 'ultra', 0.86) }, dE).assessment;
  ok(aM.bucket === 'poor' && aM.rule === 'activity_gate', 'E: BP58 盘型缺席+ultra 照拦（保守方向——豁免通道全删后无差分）');
}
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_heat', 'ultra', 0.9), ...mkAns('activity_level', 'high', 0.8) }, dE).assessment;
ok(aM.rule === 'gates_passed', 'E: BP60 heat=ultra 答案不被消费（题退役——BP30 时代「近窗密度不拦过热」语义随臂删除，act=high 放行）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_heat', 'mid', 0.6), ...mkAns('activity_level', 'mid', 0.6), ...mkAns('early_bird_quality', 'good', 0.9) }, dE).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: 门② 双 mid 放行（act low/ultra 才有证据拒——mid/high 不拦）');
{
  const legacyAns = fullAnswers();
  delete legacyAns.activity_level; // BP12 旧档重放形状：无 activity_level 答案
  const aLegacy = buildBuyPointObservation(legacyAns, dE).assessment;
  ok(aLegacy.bucket === 'neutral' && aLegacy.rule === 'gates_passed', 'E: 门① act 答案缺席=该臂失效容缺放行（BP12 旧档重放兼容——BP60 后活跃度门单臂，缺席=门整体失效）');
  const aLegacyHeat = buildBuyPointObservation({ ...legacyAns, ...mkAns('market_heat', 'low', 0.9) }, dE).assessment;
  ok(aLegacyHeat.rule === 'gates_passed', 'E: 门① 旧档无 act 答案时 heat 答案也不救门（BP60 heat 臂删——单臂缺席=容缺放行，门不再退化吞票）');
}
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_heat', 'low', 0.88), ...mkAns('early_bird_quality', 'good', 0.95) }, dE).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: BP60 heat low 不再拒（题退役——活跃度不够的拦截全归 activity_level 臂；旧档质量题答案不被消费）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('activity_level', 'low', 0.88), ...mkAns('early_bird_quality', 'good', 0.95) }, dE).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'activity_gate', 'E: 门① BP13 臂 act low 拒（买点前全窗量级死寂）');
// ③ 筹码门（BP14 BEM 案立法——BP49 起单臂）：holder_concentration=strong →
// poor/chip_gate；**BP54 停用（2026-11-09 用户裁定「筹码门可以去掉（改为先不
// 激活），看看效果」）：CHIP_GATE_ENABLED=false 拦截臂不激活——holder strong
// 不再拒（BP53 对拍来财/VirusSI 被 chip 再拦的形状引出），chipArms 照算留档、
// BP14 防线代码保留恢复=置 true**；**famous 臂已随 famous_domination 题退役
// （BP49/案号 BP45 用户裁定「盘形中已经分析了」）**——famous 判型全归盘型题
// ③独食桶+互斥检查（BP45 再起来域/BP47 厚度域均在题面判读里），失去 Jev 判⑤
// 时代码兜底=知情 trade-off；mapper 对 famous_domination 答案（含 heavy/
// dominant）一律不消费不拦
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('famous_domination', 'dominant', 0.92) }, dE).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: 门③ BP49 famous=dominant 答案不拦（famous 臂随题退役——BEM 案主拦截臂归题面③独食桶判读，mapper 无代码兜底）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('famous_domination', 'heavy', 0.9) }, dE).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: 门③ BP49 famous=heavy 答案不拦（BP30 heavy 扩档臂随题退役）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('holder_concentration', 'strong', 0.87) }, dE).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: 门③ BP54 停用 holder=strong 不再拒 → neutral/gates_passed（用户裁定「先不激活看看效果」——CD240 分层线臂代码保留恢复=置 true）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('famous_domination', 'dominant', 0.8), ...mkAns('holder_concentration', 'strong', 0.94) }, dE).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: 门③ BP54 停用后 famous+holder 双答案均不拦（famous 退役键零消费+holder 臂停用——chipArms 照算纯留档）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('famous_domination', 'dominant', 0.9), ...mkAns('early_bird_quality', 'good', 0.97) }, dE).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: 门③ BP49 famous=dominant 不再拒（旧档双退役键答案均不被消费）');
// BP45 famous 轴再起来域（minVsLaunchPct ≤+20）在 BP49 后无 mapper 消费点——
// 域语义全在题面（market_pattern 判读「再起来的盘子 famous 轴只适用第一波」+
// famous_domination 退役后由③独食桶判读承接）。mapper 侧 minVs 全域（含第一波
// 22.3/锚缺失）均不因 famous 答案拦截
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('famous_domination', 'dominant', 0.92) }, { ...dE, minVsLaunchPct: 22.3 }).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: BP45 域语义归题面后 mapper 第一波域（minVs=22.3）也不拦（famous 臂全域退役——0x28ad2c7d 首锚 +22.3 形状由 Jev ③桶判读决定）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('famous_domination', 'dominant', 0.92), ...mkAns('holder_concentration', 'strong', 0.94) }, { ...dE, minVsLaunchPct: -9.9 }).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: 再起来域 BP54 停用后 holder=strong 不拦（筹码集中臂停用——restart 留痕逻辑独立照带）');
// BP60 删⑦restart 桶（用户裁定「restart 应该是可以去掉的类别」——回落重启是盘面
// 历史不是盘面类型；BP58 后处理早已与常规桶统一 27.5，判型只是分流注意力。历史：
// BP52 立法 restart_chip 豁免→BP58 改制豁免臂随宿主桶退役→BP60 桶本体删除）；exempt 键全绝迹
{
  const oR = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.57), ...mkAns('holder_concentration', 'strong', 0.91) }, dE);
  ok(oR.assessment.bucket === 'neutral' && oR.assessment.rule === 'gates_passed' && oR.assessment.exempt === undefined,
    'E: BP60 none+holder=strong+curVs≤27.5 → neutral/gates_passed 无 exempt（restart_chip 豁免臂已绝迹——exempt 键全绝迹）');
  aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.57), ...mkAns('holder_concentration', 'strong', 0.91) }, { ...dE, currentVsLaunchPct: 50 }).assessment;
  ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: none 已拉离（curVs=50>27.5）→ 统一位置门拒（正常盘面唯一放行通道）');
  {
    const { market_pattern: _drop, ...noPat } = fullAnswers();
    aM = buildBuyPointObservation({ ...noPat, ...mkAns('holder_concentration', 'strong', 0.9) }, dE).assessment;
    ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: BP54 停用盘型缺席 holder=strong 也不拦（门整体停用——恢复=true 后保守方向形状复活）');
  }
  aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('holder_concentration', 'strong', 0.93) }, dE).assessment;
  ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: BP54 停用 none+holder=strong 不拦（BP14 防线代码保留——恢复=true 后照拦形状复活）');
  aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.57), ...mkAns('holder_concentration', 'moderate', 0.9) }, dE).assessment;
  ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed' && !aM.exempt, 'E: none+holder=moderate → neutral 无 exempt（exempt 键全绝迹不因组合复活）');
}
ok(require('../src/market-analysis/buy-point-result-mapper').CHIP_GATE_ENABLED === false, 'E: BP54 常量锁 CHIP_GATE_ENABLED=false（用户裁定「先不激活看看效果」——恢复=显式置 true+同步本断言）');
ok(require('../src/market-analysis/buy-point-result-mapper').FAMOUS_AXIS_RELAUNCH_PCT === undefined, 'E: FAMOUS_AXIS_RELAUNCH_PCT 已随 famous_domination 退役删除（BP49——域语义归题面，常量绝迹锁）');
{
  let threw = false;
  try { buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'golden_point', 0.85) }, dA); } catch { threw = true; }
  ok(threw, 'E: BP60 golden_point 传入=未知桶名 throw（⑧桶随四桶化删除——允许买入型桶语义归 none 题面判读，幻觉返回即 fail-closed 拒）');
}
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('activity_level', 'low', 0.85), ...mkAns('holder_concentration', 'strong', 0.95) }, dE).assessment;
ok(aM.rule === 'activity_gate' && near(aM.prob, 0.85), 'E: 门序 活跃度门先于筹码门（双门命中 rule 留痕 activity_gate——首个命中门）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('famous_domination', 'light', 0.9), ...mkAns('holder_concentration', 'moderate', 0.9) }, dE).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: 门③ light/moderate 不拦（moderate 观察档防误伤——holder 臂豁免域）');
// ① 盘型门（BP18 五类型学；BP30 前置为预判断——用户裁定「market_pattern 要放到
// 很靠前的位置，因为这是个预判断」：判定链最前，②③桶硬拒买+⑥独立位置门；BP60
// 四桶化后正常形状全归 none 走统一门——强庄盘/狙击衰竭/融合盘不再细分识别）
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'retail_pvp', 0.86) }, dE).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.86) && aM.rule === 'pattern_gate', 'E: 门① retail_pvp 散户 PVP → poor/pattern_gate（只有小散户额度偏低互捅攒流动性——不要参与）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'famous_monopoly', 0.91) }, dE).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.91) && aM.rule === 'pattern_gate', 'E: 门① famous_monopoly famous 独食 → poor/pattern_gate（小散底子+一个 famous 拿太多筹码盘子就是它的）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_heat', 'mid', 0.6) }, dE).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: BP60 狙击衰竭形状归 none 放行（④桶随四桶化删除——curVs=20≤27.5 过统一门；heat=mid 答案不被消费）');
// BP42（2026-11-08 用户裁定）真庄反锚机械门整段拆除：回归 BP12「不搞代码门」两次
// 明裁——代码不改写 Jev 桶判定；S072/S006/S109 类真庄贴顶票被④吞=设计内代价入
// 攒批池。拆除反证断言：两腿证据全在场的④形状（贴顶 0%+尾段 48.7=無為 S072 形状）
// 现在照拒 pattern_gate，dimensions 无 exempt 留痕（BP41 机制绝迹锁）
{
  const anchor4 = (ath, tail) => ({ ...dA, currentVsAthPct: ath, activity: { ...dA.activity, nearTail5BuySharePct: tail } });
  const obs42 = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.92) }, anchor4(0, 48.7));
  ok(obs42.dimensions.market_pattern.bucket === 'none'
    && obs42.dimensions.market_pattern.exempt === undefined
    && obs42.assessment.bucket === 'poor' && obs42.assessment.rule === 'pattern_gate'
    && obs42.assessment.exempt === undefined,
    'E: BP42 机械门已拆：④形状归 none+贴顶 0%+尾段 48.7（BP41 救臂证据全在场）照拒统一门不动 Jev 判定、无 exempt 留痕（S072 形状回归设计内代价；dA curVs=+60 界外）');
}
// BP58 桶改制+BP60 四桶化：④桶判型删除归 none（走统一位置门 27.5）——BP46/BP47
// （④高热近价豁免：heat=high∧openShare<80∧curVs≤40 放行+同盖 act ultra 臂）与
// BP53/BP56（④ultra router 散户入口豁免 routerBuyPct60≥30+价格腿 curVs≤40）三臂
// 随宿主④桶退役整链删除；heat/openShare/router 不再进 mapper 门，判读全归题面；
// ultra 臂恢复无条件拦（BP38 同删）；放行唯一通道=统一门 27.5
{
  const ans58 = (heat, act) => ({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.86), ...mkAns('market_heat', heat, 0.98), ...mkAns('activity_level', act, 0.73) });
  // 苍蝇 06/09 形状（④+heat ultra+curVs 26.8+act ultra）BP58 后由 act 门拦（不再走
  // ④ pattern_gate 豁免/拒拔河——④归 none 26.8≤27.5 过统一门，act=ultra 无条件拦）
  const oCy = buildBuyPointObservation(ans58('ultra', 'ultra'), { ...dE, currentVsLaunchPct: 26.8 });
  ok(oCy.assessment.bucket === 'poor' && oCy.assessment.rule === 'activity_gate' && !oCy.assessment.exempt,
    'E: BP58 苍蝇形状（④形状归 none+curVs 26.8≤27.5+act ultra）→ activity_gate 拒（④桶归 none 过统一门、ultra 无条件拦——BP47/BP53 豁免臂删除后不再有放行通道）');
  const oH = buildBuyPointObservation(ans58('high', 'high'), dE);
  ok(oH.assessment.bucket === 'neutral' && oH.assessment.rule === 'gates_passed' && !oH.assessment.exempt,
    'E: BP58 ④形状归 none+heat=high+curVs≤27.5 → 统一门放行 neutral 无 exempt（BP47 高热近价豁免臂删除——heat/openShare 不再进 mapper 门，判读归题面）');
  const osAnchor = (v) => ({ ...dE, openSeg: { ...dE.openSeg, buySharePct: v } });
  const oOs100 = buildBuyPointObservation(ans58('high', 'high'), osAnchor(100));
  ok(oOs100.assessment.bucket === 'neutral' && oOs100.assessment.rule === 'gates_passed',
    'E: BP58 openShare=100 照放行（openSeg 锚照透传落 digest 但不进门——BP47 硬线 <80 随④桶退役，一波流冲高砸落形状由 entry_shape crash 臂接棒拦截）');
  const oMid = buildBuyPointObservation(ans58('mid', 'mid'), dE);
  ok(oMid.assessment.bucket === 'neutral' && oMid.assessment.rule === 'gates_passed',
    'E: BP58 heat=mid 不再有豁免域外拒（④归 none——「必须有热度一阵」判读归题面，mapper 只看统一门）');
  const oNull = buildBuyPointObservation(ans58('high', 'high'), { ...dE, currentVsLaunchPct: null });
  ok(oNull.assessment.bucket === 'poor' && oNull.assessment.rule === 'pattern_gate',
    'E: BP58 none curVs 锚缺失 → 统一门宁拦不冒充拒（fail-closed 方向不变）');
  const oOut = buildBuyPointObservation(ans58('high', 'high'), { ...dE, currentVsLaunchPct: 27.6 });
  ok(oOut.assessment.bucket === 'poor' && oOut.assessment.rule === 'pattern_gate',
    'E: BP58 none curVs 27.6>27.5 → 统一门拒（BP46 时代 ≤40 豁免域整体收回——BEM +56.4/FIGHT +76.1 类价格腿由 27.5 守）');
  const oRt = buildBuyPointObservation(ans58('ultra', 'ultra'), { ...dE, routerBuyPct60: 93.9, currentVsLaunchPct: 26.8 });
  ok(oRt.assessment.bucket === 'poor' && oRt.assessment.rule === 'activity_gate',
    'E: BP58 router=93.9 散户入口不再豁免（BP53 ultra_router_entry 臂随④桶退役——routerBuyPct60 锚照透传纯留档，act=ultra 照拦）');
  const oPvp = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'retail_pvp', 0.86), ...mkAns('market_heat', 'ultra', 0.98), ...mkAns('activity_level', 'ultra', 0.7) }, dE);
  ok(oPvp.assessment.bucket === 'poor' && oPvp.assessment.rule === 'pattern_gate' && !oPvp.assessment.exempt,
    'E: BP58 retail_pvp 照拒（硬拒桶在役——异常盘面识别改制不影响的拦截面；heat=ultra 答案不被消费）');
  const oMono = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'famous_monopoly', 0.9), ...mkAns('market_heat', 'ultra', 0.98), ...mkAns('activity_level', 'ultra', 0.7) }, dE);
  ok(oMono.assessment.bucket === 'poor' && oMono.assessment.rule === 'pattern_gate',
    'E: BP58 famous_monopoly 照拒（硬拒桶在役）');
}
// BP58 ②点位性质门（entry_shape 新题——用户交易理念「只买性价比高的点位，不追高；
// 我希望买入的是活跃交易中对倒中的低价/正常下跌造成的低价，而不是庄家离场时的暴跌
// （直线砸盘）」；bt-v94 七票复盘四分类：砸盘三票 LOVE/STOCKLESS/币安之心+尖刺
// YiYi=拒、对倒两票 米/施工鸭=目标形状、苍蝇=act 门已闭环）：crash/spike →
// poor/entry_gate；normal_dip/flat 放行；门序=盘型门后、活跃度门前
{
  const es = (shape, p) => ({ ...fullAnswers(), ...mkAns('entry_shape', shape, p) });
  const oCrash = buildBuyPointObservation(es('crash', 0.92), dE);
  ok(oCrash.assessment.bucket === 'poor' && near(oCrash.assessment.prob, 0.92) && oCrash.assessment.rule === 'entry_gate',
    'E: BP58 entry_gate crash 直线砸盘 → poor/entry_gate（庄离场暴跌不参与——LOVE curVsAth -37.0/chg30 -29.3 形状）');
  const oSpike = buildBuyPointObservation(es('spike', 0.77), dE);
  ok(oSpike.assessment.bucket === 'poor' && near(oSpike.assessment.prob, 0.77) && oSpike.assessment.rule === 'entry_gate',
    'E: BP58 entry_gate spike 尖刺拉盘 → poor/entry_gate（追高不参与——YiYi chg30 +23.4 形状）');
  const oDip = buildBuyPointObservation(es('normal_dip'), dE);
  ok(oDip.assessment.bucket === 'neutral' && oDip.assessment.rule === 'gates_passed',
    'E: BP58 entry_gate normal_dip 正常回调低价 → 放行（目标买入形状——米 curVsAth -7.0/施工鸭 -6.4 对倒盘低价）');
  const oFlat = buildBuyPointObservation(es('flat'), dE);
  ok(oFlat.assessment.bucket === 'neutral' && oFlat.assessment.rule === 'gates_passed', 'E: BP58 entry_gate flat 横盘缓行 → 放行');
  {
    const legacyAns = fullAnswers();
    delete legacyAns.entry_shape; // BP51 及更早旧档重放形状：无点位性质题答案
    const obsLegacyEs = buildBuyPointObservation(legacyAns, dE);
    ok(obsLegacyEs.assessment.bucket === 'neutral' && obsLegacyEs.assessment.rule === 'gates_passed' && obsLegacyEs.dimensions.entry_shape === null,
      'E: BP58 entry_shape 答案缺席=门臂失效容缺放行（BP51 旧档重放兼容——拒=有证据的拒绝，维度键在场值 null）');
  }
  assert.throws(() => buildBuyPointObservation({ ...fullAnswers(), entry_shape: { probabilities: { boom: 0.9 } } }, dA), /未知桶名/, 'E: entry_shape 在场未知桶 throw（桶域校验不因容缺放宽）');
  // 门序：盘型门→点位性质门→活跃度门（BP58 判定指引①②③序）
  const oPvpCrash = buildBuyPointObservation({ ...es('crash'), ...mkAns('market_pattern', 'retail_pvp', 0.95) }, dE).assessment;
  ok(oPvpCrash.rule === 'pattern_gate' && near(oPvpCrash.prob, 0.95), 'E: BP58 门序 盘型门前置于点位性质门（pattern+crash 双命中留痕 pattern_gate）');
  const oCrashLow = buildBuyPointObservation({ ...es('crash', 0.92), ...mkAns('activity_level', 'low', 0.88) }, dE).assessment;
  ok(oCrashLow.rule === 'entry_gate' && near(oCrashLow.prob, 0.92), 'E: BP58 门序 点位性质门前置于活跃度门（crash+act low 双命中留痕 entry_gate）');
  const oCrashOut = buildBuyPointObservation(es('crash'), { ...dE, currentVsLaunchPct: 50 }).assessment;
  ok(oCrashOut.rule === 'pattern_gate', 'E: BP58 门序 统一位置门（盘型门）先拒已拉离（crash+curVs 50>27.5 双命中留痕 pattern_gate）');
  ok(JSON.stringify(buildBuyPointObservation({ ...es('crash'), ...mkAns('market_pattern', 'none', 0.6), ...mkAns('holder_concentration', 'strong', 0.9) }, dE)).includes('exempt') === false,
    'E: BP58 exempt 键全绝迹（BP38/BP46/BP47/BP52/BP53 五豁免臂随桶改制删除——任何组合不留 exempt 指纹）');
}
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.88) }, dA).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: BP58 统一位置门 dA vsLaunch=+60% >+27.5 → poor/pattern_gate（正常盘面唯一放行上界——不追高）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.77) }, dA).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: BP58 统一位置门 none +60% 拒（S055 无税人生 +126.8% 形状照拒不变）');
// BP58 统一位置门 27.5（用户裁定「现在买入点位已经不是小于 40，应该是小于 27.5」
// ——与 T129 ladder v14 触发线同线；BP60 四桶化后 none=唯一正常桶走本门，恰 +40
// 放行时代结束）
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.88) }, { ...dA, currentVsLaunchPct: 27.5 }).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: 统一位置门 恰 +27.5% 放行（≤27.5 边界含——T129 同线）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.88) }, { ...dA, currentVsLaunchPct: 27.6 }).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: 统一位置门 +27.6% 拒（严格大于 27.5——BP48 时代恰 40 放行断言随改制反转）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.88) }, { ...dA, currentVsLaunchPct: 40 }).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: 统一位置门 +40% 拒（low 档全域收回——庄盘不再独享也无人独享）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.88) }, { ...dA, currentVsLaunchPct: null }).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: 统一位置门 锚缺失（发行价位置 ?）宁拦不冒充拒');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.77) }, { ...dA, currentVsLaunchPct: -8 }).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: 统一位置门 破发 −8% 放行（含破发）');
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
ok(!PATTERN_GATE_POOR_BUCKETS.includes('sustained_climb'), 'E: PATTERN_GATE_POOR_BUCKETS 两桶不含⑥（⑥走 SUSTAINED_CLIMB_LAUNCH_PCT=10 独立位置臂——硬拒与⑥位置拒分治）');
// BP60 收口四桶：桶清单=②③硬拒+⑥独立位置门+none 兜底（用户裁定「只识别出
// 不交易的盘形即可」——①strong_backer/④early_sniper_decay/⑤blended_unremarkable/
// ⑧golden_point 处理与 none 完全一致没必要保留，判型随桶域删除；restart 已于
// BP60 第一轮删除；none 正式入域=正常盘面兜底桶）
ok(JSON.stringify(MARKET_PATTERN_LEVELS) === JSON.stringify(['retail_pvp', 'famous_monopoly', 'sustained_climb', 'none']),
  'E: BP60 桶域清单=四桶（②③硬拒/⑥≤10/none 统一门 27.5——正常形状不再细分识别）');
ok(JSON.stringify(PATTERN_GATE_POOR_BUCKETS) === JSON.stringify(['retail_pvp', 'famous_monopoly']),
  'E: BP58 硬拒桶恰两桶（③⑥中⑥走位置门，硬拒=②③——拉高/砸盘由 entry_shape+统一门接力）');
for (const legacyBucket of ['strong_backer', 'early_sniper_decay', 'blended_unremarkable', 'golden_point', 'restart']) {
  let threw = false;
  try { buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', legacyBucket, 0.8) }, dE); } catch { threw = true; }
  ok(threw, `E: BP60 判型删除桶 ${legacyBucket} 传入=未知桶名 throw（四桶域外 fail-closed 拒——题集 criteria 无此桶，幻觉/漂移返回即拒；BP52 未部署生产零存档行无重放污染面）`);
}
// BP60 删⑦restart：桶绝迹三重锁——LEVELS 不含+硬拒表不含+传入即 throw（未知桶
// 防线兜住 Jev 幻觉/漂移；题面 criteria 同步删桶由 F 组锁两域相等）
ok(!MARKET_PATTERN_LEVELS.includes('restart'), 'E: BP60 restart 已从桶域删除（用户裁定「restart 应该是可以去掉的类别」——回落票按盘面重置语义以当前形状归类，判读归题面）');
ok(!PATTERN_GATE_POOR_BUCKETS.includes('restart'), 'E: PATTERN_GATE_POOR_BUCKETS 不含 restart（删桶后无从传入；none 走统一门 27.5——硬拒仅 retail_pvp/famous_monopoly 两桶）');
// 统一位置门边界（BP58 收口 27.5；BP60 后 none 承载——唯一正常桶同门）
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.87) }, dA).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.87) && aM.rule === 'pattern_gate', 'E: 门① none 已拉离（dA vsLaunch=+60% >+27.5%）→ poor/pattern_gate（统一位置门拒）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.87) }, { ...dA, currentVsLaunchPct: 27.5 }).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: none 恰 +27.5% 放行（统一门域内）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.87) }, { ...dA, currentVsLaunchPct: 40 }).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: none +40% 拒（BP43 时代 RESTART_LAUNCH_PCT=40 独立臂已随 BP58 统一门 27.5 接管）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.87) }, { ...dA, currentVsLaunchPct: -12 }).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: none 破发 −12% 放行（含破发——回落到起点以下也在统一门域内）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.87) }, { ...dA, currentVsLaunchPct: null }).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: none 锚缺失（发行价位置 ? = ticks 未覆盖出生段）宁拦不冒充拒');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.87), ...mkAns('early_bird_quality', 'good', 0.95) }, dA).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: none 已拉离拒（旧档质量题答案不被消费）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'retail_pvp', 0.86), ...mkAns('early_bird_quality', 'good', 0.95) }, dA).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: 门① 散户 PVP 拒（盘型不对不参与——旧档质量题答案不被消费）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('activity_level', 'low', 0.85), ...mkAns('market_pattern', 'retail_pvp', 0.95) }, dA).assessment;
ok(aM.rule === 'pattern_gate' && near(aM.prob, 0.95), 'E: 门序 BP30 盘型门前置最前（pattern+act 双命中留痕 pattern_gate——预判断先于活跃度门）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('holder_concentration', 'strong', 0.9), ...mkAns('market_pattern', 'famous_monopoly', 0.95) }, dA).assessment;
ok(aM.rule === 'pattern_gate' && aM.bucket === 'poor', 'E: 门序 盘型门前置于筹码门（holder strong+独食双语义命中留痕 pattern_gate）');
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
  delete legacyChip.holder_concentration; // BP13 及更早旧档重放形状：无筹码题答案（famous_domination 已随 BP49 退役不在 fullAnswers）
  const aLegacy = buildBuyPointObservation(legacyChip, dE).assessment;
  ok(aLegacy.bucket === 'neutral' && aLegacy.rule === 'gates_passed', 'E: 门①b 筹码题答案缺席=筹码门臂自动失效容缺放行（BP13 旧档重放兼容零影响）');
}
// BP49 退役键反证：famous_domination 在场（含未知桶）不被消费不 throw——维度键绝迹后
// 桶域校验不触及（重放兼容；在役题未知桶仍 throw 见 market_pattern 断言）
{
  const retiredAns = { ...fullAnswers(), famous_domination: { probabilities: { control: 0.9 } }, entry_position: { probabilities: { ankle: 0.9 } } };
  const aRetired = buildBuyPointObservation(retiredAns, dE).assessment;
  ok(aRetired.bucket === 'neutral' && aRetired.rule === 'gates_passed', 'E: BP49 退役键答案（含未知桶名）不被消费不 throw（键绝迹后桶域校验不触及）');
}
assert.throws(() => buildBuyPointObservation({ ...fullAnswers(), holder_concentration: { probabilities: { extreme: 0.9 } } }, dA), /未知桶名/, 'E: holder_concentration 在场未知桶 throw');
// BP30 改六 tree_position/high_chase 退役：题/维度/质量键绝迹——旧档 answers 带两题
// 答案（BP32 及更早存档）也不消费不 throw（重放兼容）
{
  const legacyTree = { ...fullAnswers(), ...mkAns('tree_position', 'not_tree', 0.83), ...mkAns('high_chase_quality', 'poor', 0.61) };
  const obsLegacyTree = buildBuyPointObservation(legacyTree, dE);
  ok(!('tree_position' in obsLegacyTree.dimensions) && !('qualities' in obsLegacyTree)
    && obsLegacyTree.assessment.bucket === 'neutral' && obsLegacyTree.assessment.rule === 'gates_passed',
    'E: BP30/BP48 退役反证——旧档带 tree_position/high_chase/质量题答案=不被消费不 throw（键绝迹+门链照走）');
  ok(!['not_tree', 'position_gate', 'any_good', 'any_neutral', 'else_poor'].includes(obsLegacyTree.assessment.rule), 'E: rule 域聚合值绝迹（BP58 后五值 pattern_gate/entry_gate/activity_gate/chip_gate/gates_passed）');
}
ok(JSON.stringify(ACTIVITY_GATE_POOR_BUCKETS) === JSON.stringify({ activity_level: ['low', 'ultra'] }),
  'E: 活跃度门拒买档常量（BP60 收单题臂——market_heat 臂随题退役删除，act low+ultra）');
// 筹码门 BP49 起单臂（holder strong）——CHIP_GATE_FAMOUS_POOR_BUCKETS 已随 famous
// 臂退役删除（绝迹锁见文件头 MAPPER_EXPORTS_49 断言）
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
ok(obsE.anchors.launchPriceBnb !== null && near(obsE.anchors.launchPriceBnb, 1.0 * E9) && obsE.anchors.currentVsLaunchPct === 20 && obsE.anchors.launchCovered === 1,
  'E: 发行价位置族三键透传（BP5——launchCovered boolean → 1 数值化；obsE 用 dE 现价 +20 过统一位置门 27.5）');
ok(obsE.anchors.athVsLaunchPct === 100 && obsE.anchors.minVsLaunchPct === 20,
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
  console.log('F. 题集形状（BP52 七题=7 维度 0 质量/桶域对锁/market_pattern 异常盘面识别四桶+entry_shape 点位性质新题/统一位置门 27.5）');
  const q = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'market-analysis', 'llm', 'buy-point-questions.mjs')).href);
  ok(q.BUY_POINT_QUESTIONS_VERSION === 'BP53', 'F: 版本=BP53（BP58 案 bt-v94 七票复盘两改制：①market_pattern 改制异常盘面识别——用户裁定「没必要费劲识别太多盘形，只需要把异常的找出来即可」：桶域收四桶 retail_pvp/famous_monopoly/sustained_climb/none，strong_backer/early_sniper_decay/blended_unremarkable/restart/golden_point 五桶退役归 LEGACY 并域（重放=none 语义）；②entry_shape 点位性质新题——用户裁定「只买性价比高的点位，不追高：买入活跃交易中对倒中的低价/正常下跌造成的低价，不接庄离场直线砸盘、不追尖刺拉起」crash/spike/normal_dip/flat 四桶；统一位置门 NORMAL_ENTRY_LAUNCH_PCT=27.5（用户裁定「现在买入点位已经不是小于 40，应该是小于 27.5」——none+LEGACY 统一放行上界，锚缺失宁拦不冒充拒）；五豁免臂随宿主桶退役全删（BP38 strong_backer ultra/BP46-47 ④高热近价/BP52 restart_chip/BP53-56 ④ultra router+价格腿）——ultra 臂恢复无条件拦、exempt 键绝迹；门链=pattern_gate→entry_gate→activity_gate→chip_gate(停用)→gates_passed；前版 BP51 案号 BP57 CD394 同车活跃度四臂；BP53=案号 BP61 famous 快进快出收割完残局臂+退出臂前提修正）');
  const qs = q.buildBuyPointQuestions();
  const ids = Object.keys(qs);
  ok(ids.length === 6, `F: 恰 6 题=6 维度 0 质量（BP48 两质量题+BP49 两维度题退役+BP58 entry_shape 新题+BP60 market_heat 退役；实际 ${ids.length}）`);
  ok(ids[0] === 'market_pattern', 'F: BP30 改五 market_pattern 题序首位（前置预判断）');
  ok(JSON.stringify(ids) === JSON.stringify(['market_pattern', 'entry_shape', 'price_trend', 'activity_level', 'holder_concentration', 'price_level']), 'F: 题序=pattern 首位（预判断）+entry_shape 第二位（点位性质紧随盘面定性）+trend/activity/holder/level（BP49 删 famous/entry 两题+BP58 增 entry_shape+BP60 删 market_heat——与 activity_level 重复，用户裁定「如果 market_heat 没有什么用处，也可以删除」）');
  ok(!('tree_position' in qs) && !('high_chase_quality' in qs) && !('early_bird_quality' in qs) && !('pullback_entry_quality' in qs), 'F: tree_position/high_chase/early_bird/pullback_entry 题绝迹（BP30/BP48 退役反证）');
  ok(!('famous_domination' in qs) && !('entry_position' in qs), 'F: famous_domination/entry_position 题绝迹（BP49 退役反证——famous 判型归盘型题③独食桶+互斥检查、entry_position 无消费者）');
  ok(!('point_category' in qs) && !('buy_point_assessment' in qs), 'F: 类别题/综合题已删（BP6 形态反证——路由依赖从根消除）');
  ok(!('price_momentum' in qs) && !('buy_pressure_quality' in qs) && !('chip_flow' in qs) && !('pace_trend' in qs), 'F: 四道旧维度题已删（BP5 瘦身反证）');
  ok(ids.every((id) => qs[id].type === 'choice' && qs[id].criteria && Object.keys(qs[id].criteria).length >= 3), 'F: 全 choice 且 criteria≥3 桶');
  ok(DIMENSION_IDS.every((id) => qs[id].instructions.includes('怎么算')), 'F: 七题各含「怎么算」显式算法段');
  ok(DIMENSION_IDS.every((id) => qs[id].instructions.includes('反锚')), 'F: 七维度题各含反锚段');
  ok(q.buildBuyPointQuestions() && JSON.stringify(q.buildBuyPointQuestions()) === JSON.stringify(qs), 'F: 函数产物两调深相等（无隐藏状态）');
  // 桶域与 mapper 常量对锁（ESM/CJS 双副本漂移防线）
  ok(JSON.stringify(q.PRICE_TREND_LEVELS) === JSON.stringify(PRICE_TREND_LEVELS), 'F: PRICE_TREND_LEVELS 同域（BP5 六桶）');
  ok(!('SELL_PRESSURE_LEVELS' in q) && !('sell_pressure' in qs), 'F: sell_pressure 题与桶域常量已删（BP11 用户裁定「sell_pressure 直接删掉」——体系中无此指标）');
  ok(JSON.stringify(q.HEAT_LEVELS) === JSON.stringify(HEAT_LEVELS), 'F: HEAT_LEVELS 同域');
  ok(JSON.stringify(q.ACTIVITY_LEVELS) === JSON.stringify(ACTIVITY_LEVELS), 'F: ACTIVITY_LEVELS 同域（BP13——CD activity_level 同词表四档）');
  ok(JSON.stringify(Object.keys(qs.activity_level.criteria)) === JSON.stringify(ACTIVITY_LEVELS), 'F: activity_level 桶===ACTIVITY_LEVELS（四桶）');
  ok(!('FAMOUS_DOMINATION_LEVELS' in q), 'F: FAMOUS_DOMINATION_LEVELS 常量绝迹（BP49 famous_domination 退役——ESM 侧同删）');
  ok(JSON.stringify(q.HOLDER_CONCENTRATION_LEVELS) === JSON.stringify(HOLDER_CONCENTRATION_LEVELS), 'F: HOLDER_CONCENTRATION_LEVELS 同域（BP14——CD240 分层线词表）');
  ok(JSON.stringify(Object.keys(qs.holder_concentration.criteria)) === JSON.stringify(HOLDER_CONCENTRATION_LEVELS), 'F: holder_concentration 桶===HOLDER_CONCENTRATION_LEVELS（四桶 none/weak/moderate/strong）');
  ok(!('ENTRY_POSITION_LEVELS' in q), 'F: ENTRY_POSITION_LEVELS 常量绝迹（BP49 entry_position 退役——ESM 侧同删）');
  ok(JSON.stringify(q.PRICE_LEVEL_LEVELS) === JSON.stringify(PRICE_LEVEL_LEVELS), 'F: PRICE_LEVEL_LEVELS 同域（BP43 六桶 almost_launch 前插——ESM/CJS 双副本对锁）');
  ok(!('TREE_POSITION_LEVELS' in q), 'F: TREE_POSITION_LEVELS 常量绝迹（BP30 tree_position 退役——ESM 侧同删）');
  // BP18 盘面分类锚（五类型学——用户裁定原话直译）
  ok(JSON.stringify(q.MARKET_PATTERN_LEVELS) === JSON.stringify(MARKET_PATTERN_LEVELS), 'F: MARKET_PATTERN_LEVELS 同域（BP58 二修判型恢复八桶——ESM/CJS 双副本对锁）');
  ok(JSON.stringify(Object.keys(qs.market_pattern.criteria)) === JSON.stringify(MARKET_PATTERN_LEVELS), 'F: market_pattern 桶===MARKET_PATTERN_LEVELS（BP58 二修八桶——PATTERN_GATE_POOR_BUCKETS 硬拒恰 retail_pvp/famous_monopoly 两桶）');
  // BP43（CD381 同车需求 2/4'）：almost_launch 六桶+restart 第七桶+数值锚联动
  ok(JSON.stringify(PRICE_LEVEL_LEVELS) === JSON.stringify(['almost_launch', 'near_launch', 'low', 'mid', 'high', 'very_high']), 'F: price_level 六桶域=almost_launch/near_launch/low/mid/high/very_high（BP43 almost_launch 前插；BP50 上界 20→10）');
  ok(JSON.stringify(Object.keys(qs.price_level.criteria)) === JSON.stringify(PRICE_LEVEL_LEVELS), 'F: price_level 桶===PRICE_LEVEL_LEVELS（六桶——ESM 题集 criteria 键序一致）');
  ok(qs.price_level.criteria.almost_launch.includes('≤ +10%，含破发') && qs.price_level.criteria.near_launch.includes('+10%~+40%') && qs.price_level.criteria.low.includes('+40%~+80%，1.4~1.8 倍') && qs.price_level.criteria.mid.includes('+80%~+600%，1.8~7 倍'), 'F: price_level criteria 六桶分界（almost_launch ≤+10/near_launch 10~40/low 40~80/mid 80~600——BP43 六桶改制+BP50 almost 20→10「基本再次归零」）');
  ok(MARKET_PATTERN_LEVELS.includes('none') && MARKET_PATTERN_LEVELS.includes('retail_pvp') && MARKET_PATTERN_LEVELS.includes('famous_monopoly') && MARKET_PATTERN_LEVELS.includes('sustained_climb') && !MARKET_PATTERN_LEVELS.includes('restart') && !MARKET_PATTERN_LEVELS.includes('golden_point') && !MARKET_PATTERN_LEVELS.includes('strong_backer') && !MARKET_PATTERN_LEVELS.includes('early_sniper_decay') && !MARKET_PATTERN_LEVELS.includes('blended_unremarkable'), 'F: BP60 四桶收口（第二轮裁定「retail_pvp sustained_climb famous_monopoly 是不进行交易的，其它几个类型的处理方式完全一致，所以没必要保留在里头，只识别出不交易的盘形即可」——①④⑤⑦⑧判型桶全删、none 兜底桶在场、处理=②③硬拒+⑥≤10+none 统一门 27.5）');
  ok(!('LEGACY_MARKET_PATTERN_LEVELS' in q) && !('LEGACY_MARKET_PATTERN_LEVELS' in require('../src/market-analysis/buy-point-result-mapper')), 'F: LEGACY_MARKET_PATTERN_LEVELS 两侧绝迹（BP58 二修判型恢复后无并域语义——八桶均在役，题集/mapper 均不导出）');
  ok(require('../src/market-analysis/buy-point-result-mapper').NORMAL_ENTRY_LAUNCH_PCT === 27.5 && require('../src/market-analysis/buy-point-result-mapper').SUSTAINED_CLIMB_LAUNCH_PCT === 10, 'F: 位置门常量导出（NORMAL_ENTRY_LAUNCH_PCT=27.5 ①④⑤⑦⑧统一放行上界/SUSTAINED_CLIMB_LAUNCH_PCT=10——BP58 用户裁定「现在买入点位已经不是小于 40，应该是小于 27.5」）');
  const mp = qs.market_pattern.instructions;
  ok(mp.includes('没有任何像样的买方力量') && mp.includes('大户卖出、零散小散承接') && mp.includes('②这种不要参与'), 'F: ②散户 PVP=不要参与（BP21 双形状——(a) 从来无像样买单+(b) 大户卖出零散小散承接：大户向小散出货盘面散户化仍②=정책콕 案）');
  ok(mp.includes('拿了太多筹码') && mp.includes('这个盘子就是它的/它们的了'), 'F: ③famous 独食=盘子就是它的了（原话直译；BP30 复数 famous 扩句后单复数并表「它的/它们的」）');
  ok(mp.includes('famous 集团买入主导判序（BP57）') && mp.includes('famous 集团买入占全窗买入大头') && mp.includes('教科书形状') && qs.market_pattern.criteria.famous_monopoly.includes('famous 集团买入占全窗买入大头=教科书形状') && qs.market_pattern.criteria.famous_monopoly.includes('再起来/已有大量交易的盘面 famous 在场=正面证据，退出 famous 轴归 none'),
    'F: BP57 ③桶 famous 集团买入主导判序（徐苍蝇案 0x59f5…7777 两 famous 控盘 85.4%/集团买 80.1%/两 famous 买入 1.445=全窗 56% 误判④——famous 抢筹天然制造开盘集中+吞吐骤降形状是进场方式产物非衰竭证据；BP60 四桶化后④桶已删判序句改判本桶；厚度域界=再起来/已有大量交易退出 famous 轴归 none；题面+criteria 双锚）');
  ok(mp.includes('famous 快进快出收割完/收割中的残局同落本桶（BP53，判读看「famous 痕迹」行；适用域同桶级') && mp.includes('随即秒级~极快清仓式卖出') && mp.includes('收割中（三修）') && mp.includes('判例 147d') && mp.includes('判例米 338a') && mp.includes('判例 0432') && mp.includes('痕迹行单钱包/Σ净 ≈0 或负、净持仓>0 的名单钱包 0 个') && mp.includes('[WALLETS] 前列行不标名单身份') && mp.includes('区分锚（不误伤在场持有型）') && qs.market_pattern.criteria.famous_monopoly.includes('（收割完）或已卖出绝大部分只差微末（收割中）的残局同落本桶'),
    'F: BP53 ③桶 famous 收割完/收割中残局臂·三修（147d/0432/米338a 案用户裁定「买入的时候算是 famous 收割完了的状态」——首版判据在题面但 [WALLETS] 不标名单身份+famous 本人净持仓无直供键=Jev 无法判在场性走厚度退出臂归 none（③采信率七案）；二修=snapshot famousTraces 锚族+state「famous 痕迹」行直供名单钱包时间线/在场性+占比（S053→BP31 state 补行先例同构）；三修=0432 用户裁定「那就算收割中呗，肯定也不买」——在场名单钱包已卖出绝大部分只差微末（95%+ 已卖、净投入 ≈0）=收割中与收割完同构同落③，区分锚=买入基本未卖（59f5 0xe1e3 零卖出）=在场持有不落本臂；题面+criteria 双锚）');
  ok(mp.includes('两退出臂的前提=famous 还在场（BP53，在场性看「famous 痕迹」行）') && mp.includes('不适用退出臂') && mp.includes('砸回发行价的正是 famous 自己的出货') && mp.includes('痕迹行净持仓>0 的名单钱包在场=在场持有') && mp.includes('收割中不算在场持有（三修）'),
    'F: BP53 退出臂前提修正·二修同读痕迹行+三修排除收割中（「再起来/盘子已厚」退出臂正面证据主体=famous 本身（落底后持无浮盈筹码继续看好）——痕迹行净>0 名单钱包在场=正常评估退出臂、Σ净 ≈0 或负=收割完残局不适用退出臂、净>0 但净投入 ≈0=收割中同不适用（三修）；147d minVs=−7.7 再起来域仍判③的法律依据）');
  ok(mp.includes('famous 集团买入主导判序（BP57）') && mp.includes('「famous 痕迹」行直供名单钱包时间线与在场性'), 'F: BP57 判序句补痕迹行引用（③采信七案根因=BP57 句只给占比聚合键无名单身份直供——二修补「famous 痕迹」行引用后 famous 轴判读证据链完整）');
  ok(mp.includes('BP60 收口——只识别「不参与交易」的异常盘形') && mp.includes('不再细分识别，一律归 none 正常盘面'), 'F: BP60 收口题头句（用户裁定「只识别出不交易的盘形即可」——处理一致的正常盘面不细分识别一律归 none；四桶=②③⑥+none 兜底）');
  ok(qs.market_pattern.criteria.none.includes('回落重启') && mp.includes('回落重启'), 'F: 回落重启归 none 兜底（BP44 判序语义随④⑦⑧桶退役简化——回落发生在交易量充分之后=上一轮痕迹，按当前形状归类，四桶化后不再细分识别一律归 none 正常盘面）');
  ok(mp.includes('买入额到 0.2 BNB 级（≥0.19 视同）的钱包 ≥2 个，或单笔 0.3+ BNB 级买入，且买点时刻在场=大户参与满足'), 'F: ②⑤分界双臂语义保留（BP19 突突车案——多笔 0.2 级（≥2 钱包）或单笔 0.3+ 在场=满足大户参与不属纯散户 PVP；BP28 判序化后该双臂成为前置门判据；BP47 精简后主述在②桶 (a) 判序前置段）');
  ok(mp.includes('「多笔」是硬笔数') && mp.includes('0.2 BNB 级（≥0.19 视同）钱包须 ≥2 个') && mp.includes('仅一笔 0.2 级+其余全 0.1 级及以下=凑不成多笔仍落②'), 'F: ②「多笔」硬笔数锚（BP20 两改——到 0.2 级钱包 ≥2 个、单笔 0.2 凑不成多笔仍落②：T006/T008 单笔 0.2 判 blended 宽松执行收口；BP47 精简去冗词）');
  // BP23 两轴（159 点复审第 2-3 批立法）
  ok(mp.includes('「一眼可辨的大量小散单」两要件缺一不落②') && mp.includes('①买盘中位尘埃级（0.0x 级，不是 0.1 级常见交易档）②前列再无任何像样买方'), 'F: ②(b) 收窄=零散小散须一眼可辨（BP23/S018 吉祥B 案——「有大量零散小散户的可以明显看出来」方法论锚：中位尘埃级+前列无像样买方两要件缺一不落②；BP58 二修后承接档位分界回①⑤）');
  ok(mp.includes('承接单在 0.1~0.2 BNB 级常见交易档（买盘中位 0.1 级）→ 不落②') && mp.includes('正常换手盘面（归 none') && mp.includes('0.2~0.3+ BNB 级像样买盘承接') , 'F: ②(b) 承接中间档不落②（BP23——大户在场+承接非零散小散=正常换手盘面归 none 不落②；像样级承接=对倒换手流动性在场同归 none——BP60 四桶化后①⑤桶退役统一归 none）');
  // BP24 案大户持续卖持续承接臂（三改：BP24 离场后承接→BP25 卖压消化过程性→BP26 卖方在场性优先三分）
  ok(mp.includes('卖方在场性三分') && mp.includes('「一波接没下文」是这种结构的必然结局、不是锚窗内可见的状态') && mp.includes('判结构不判承接当下的活跃度'), 'F: ②(b) 必然结局判结构（BP26——T001 触发时散户承接高潮致 Jev 误判：「一波接没下文」是前向结局锚窗不可见 → 卖压归零∧清仓成批+散户一波接=②(b) 判结构不看承接当下活跃度）');
  ok(mp.includes('**①大户卖出仍在进行**（卖压行近 60s 大户卖出额 >0') && mp.includes('**②大户已卖完离场**') && mp.includes('**③大户在场持有未卖**') && mp.includes('→ **不落②（正常换手盘面归 none）**'), 'F: ②(b) 卖方在场性三分（BP26——①持续卖+持续接（身份不限）=正常换手归 none 不落②（VirusSI）/②卖完离场+散户一波接没下文=②(b)（T001）/③在场未卖看承接档位——BP60 四桶化后⑤桶退役归 none）');
  // BP26 案大户参与判序前置（2026-11-06 S045 谷谷② 灰区单误判案——题集 BP28）
  ok(mp.includes('从来无像样买单（判序前置）'), 'F: ②(a) 判序前置声明（BP28——先判大户参与再分类，S045 灰区单案）');
  ok(mp.includes('先判「大户参与」') && mp.includes('或单笔 0.3+ BNB 级买入，且买点时刻在场=大户参与满足') && mp.includes('直接落②，不再看承接、不看盘面活跃度') && mp.includes('0.1~0.19 BNB 级灰区单不构成大户参与'), 'F: ②(a) 大户参与双臂+不满足直接落②（BP26 案立法核心——用户裁定原话「大户参与不满足是直接 pvp 盘的，满足之后根据承接再次分类」；灰区 0.1~0.19 单不构成大户参与=S045 前列 0.1568/0.1484/0.1090 三笔灰区单成因）');
  ok(mp.includes('小散互捅的盘面再活跃（新买家多、吞吐高、笔密度大）也只是散户 PVP，不是融合盘') && mp.includes('满足大户参与之后才按承接分类'), 'F: ②(a) 活跃度不救+承接分类后置（BP28——S045 灰区单被 activity high 带走错放；小散互捅的活跃不是大户参与）');
  ok(mp.includes('大户参与不满足（开盘段大额单 0 笔、[WALLETS] 前列买入最大也就 0.1x 级灰区单或 0.0x 尘埃档') && mp.includes('卖方在场性三分见②桶 (b) 第三通道'), 'F: 反锚②判序回指（BP28——大户参与不满足直接落②活跃度不救；卖方三分回指②桶主述）');
  ok(qs.market_pattern.criteria.retail_pvp.includes('大户参与判序前置（0.2 级钱包 ≥2 个或单笔 0.3+ 且买点时刻在场——末笔后已清仓离场的历史大户不算在场）不满足直接落本桶、盘面活跃度不救') && qs.market_pattern.criteria.retail_pvp.includes('判据全文见题面②桶'), 'F: criteria retail_pvp 判序同步（BP28+BP58 二修在场加硬——桶描述与题面判序一致，Jev 选桶时同判序；末笔后已清仓离场的历史大户不算在场=a8e70 在场加硬语义核心；BP58 精简压缩版判据全文指针回②桶）');
  ok(mp.includes('占比大且绝对额大') && mp.includes('不构成独食'), 'F: ③门槛锚=占比大且绝对额大（famous 边缘参与不构成独食）');
  // BP28 案改三（S064 FIGHT strong_backer 误放 -41.5%——复数 famous 扩句+roster 收录）
  ok(mp.includes('或两个及以上 famous 钱包极早入场（开盘段内/锚窗最早段首买）合计拿筹过多') && mp.includes('famous 抢筹建仓盘——famous 钱包入仓太早、拿的是最便宜的筹码，散户盘子起不来') && mp.includes('这个盘子就是它的/它们的了'), 'F: ③复数 famous 扩句（BP30/BP28 案 S064——用户裁定原话「他俩入仓太早了拿的太多，起不来」：0xfb4e/0x5506 两著名钱包 t+7s/t+13s 抢筹 0.252/0.343 合计 0.595 BNB，单个占比不及独食线的复数合计达线也落③；两址已收录 famous-copy-wallets.json）');
  ok(qs.market_pattern.criteria.famous_monopoly.includes('单个占比极大，或两个及以上 famous 极早入场合计达线') && qs.market_pattern.criteria.famous_monopoly.includes('这个盘子就是它的/它们的了'), 'F: criteria famous_monopoly 复数 famous 同步（BP30——桶描述与题面判据一致；BP58 精简压缩版保留单/复数双臂+原话锚）');
  ok(mp.includes('材料不足（开盘段结构行 ? /钱包证据缺/窗极短）归 none 处理不硬归类到异常桶（拒买桶须证据坐实）'), 'F: 材料不足归 none 不硬归类（BP60 四桶化——⑤融合桶退役，none 兜底桶承载「没有明确分类」语义；拒买桶须证据坐实）');
  ok(mp.includes('②③由盘型门硬拒（不要参与）'), 'F: 门桶声明=②③盘型门硬拒（BP58——⑥/none 走各自位置臂非不拦）');
  ok(mp.includes('⑥ ≤+10% 起点段放行、已拉离（>+10%）拒') && mp.includes('none 统一位置门 ≤+27.5%（含破发，BP58 用户裁定「现在买入点位已经不是小于 40，应该是小于 27.5」）放行、已拉离（>+27.5%）拒') && mp.includes('拉高/砸盘形状的拦截由点位性质题 entry_shape+位置门接力（BP58 二修语义，原④桶已删）') && mp.includes('锚缺失（发行价位置行 ?）宁拦不冒充一律拒'), 'F: 收尾位置门（⑥ ≤+10 独立臂+none 统一门 ≤+27.5——拉高/砸盘拦截由 entry_shape+位置门接力；锚缺失宁拦不冒充一律拒、放行后统一走点位性质门/活跃度门；判型归 Jev 位置归代码）');
  // ═══ BP58 entry_shape 点位性质新题（四桶+判序+判读线+形状样本） ═══
  ok(JSON.stringify(q.ENTRY_SHAPE_LEVELS) === JSON.stringify(ENTRY_SHAPE_LEVELS), 'F: ENTRY_SHAPE_LEVELS 同域（BP58 四桶 crash/spike/normal_dip/flat——ESM/CJS 双副本对锁）');
  ok(JSON.stringify(Object.keys(qs.entry_shape.criteria)) === JSON.stringify(ENTRY_SHAPE_LEVELS), 'F: entry_shape 桶===ENTRY_SHAPE_LEVELS（四桶——ENTRY_GATE_POOR_BUCKETS 硬拒恰 crash/spike 两桶）');
  const esIns = qs.entry_shape.instructions;
  ok(esIns.includes('判定**买点时刻价格走到当前位置的方式**') && esIns.includes('BP58 立法：只买性价比高的点位、不追高——好点位=活跃交易中对倒中的低价/正常下跌造成的低价，不是庄家离场时的暴跌，也不是尖刺拉起的追高点'), 'F: entry_shape 题头=交易理念直译（BP58 用户裁定——好点位=对倒中的低价/正常下跌的低价）');
  ok(esIns.includes('四桶判序：先看 crash 数值提示臂（命中进入**形态复核**——[PRICE] 价格拱直线垂直砸落才落 crash），再判 spike（尖刺拉起）各臂，都不命中按回落形态分 normal_dip/flat') && esIns.includes('crash/normal_dip 判的是价格拱形态、不是跌幅数值'), 'F: entry_shape 四桶判序句（BP58 二修形态判读——crash 数值臂=复核提示、定桶看 [PRICE] 拱形态；判序 crash→spike→normal_dip/flat）');
  ok(esIns.includes('① 现价较锚窗最高价深跌：currentVsAthPct ≤ -25%') && esIns.includes('② 近 30s 动量深跌：chg30Pct ≤ -25%') && esIns.includes('③ 临近段单 5s 段急跌：nearMaxDn5Pct ≤ -15%') && esIns.includes('④ 现价贴着锚窗最低价：curVsMinGapPct ≤ 2 个百分点'), 'F: crash 四臂判读线（bt-v94 三砸盘 LOVE/STOCKLESS/币安之心 curVsAth -28~-37+chg30 深跌全中；对倒正例米/施工鸭 -6~-7 不中）');
  ok(!esIns.includes('砸盘后的反弹不救 crash') && esIns.includes('较最高深跌/急跌数值命中不等于 crash') && esIns.includes('f485/40a2 深跌+急跌数值双中、用户裁定「能接受的盘形」照放'), 'F: crash 反弹不救句已随二修删除（f485/40a2 实证推翻——反弹台阶是 normal_dip 证据非 crash 洗白；数值命中不等于 crash 反锚句在场）');
  ok(esIns.includes('① 现价贴锚窗最高价：currentVsAthPct ≥ -5%（拉升进行时贴顶——单独成立，此刻买入=顶上接）') && esIns.includes('② 贴顶+近 30s 动量急涨：chg30Pct ≥ +20%（须与①联立）') && esIns.includes('③ 贴顶+临近段单 5s 段急拉：nearMaxUp5Pct ≥ +15%（须与①联立）') && esIns.includes('急拉但已从高点回落超过 5 个百分点（currentVsAthPct < -5）不判 spike'), 'F: spike 三臂判读线=贴顶必要条件+联立（首版米/施工鸭误中急拉臂后修正：对倒回升波段 5s 段 +20~25 同样有急拉，区分轴=现价在不在刺尖上——YiYi curVsAth 0 贴顶中臂+统一门 38.8>27.5 双拦；米 -6.98/施工鸭 -6.38 已回落 6~7pp 不贴顶走 normal_dip）');
  ok(esIns.includes('④急拉不贴顶不误判 spike（贴顶是必要条件——对倒回升波段 5s 段 +20~25% 但现价离顶 6~7pp 照 normal_dip）'), 'F: 反锚④回升波段反例（对拍修正案——急拉数值轴无区分度，位置轴才是判据）');
  ok(esIns.includes('normal_dip 阶梯/震荡/阴跌回落（好点位）') && esIns.includes('即便深跌+急跌数值双中、只要形态是阶梯/震荡/阴跌的照放本桶') && esIns.includes('对倒盘/正常换手造成的低价、回落有节奏盘面仍活跃'), 'F: normal_dip=目标形状（二修形态判读版——阶梯/震荡/阴跌皆好点位深浅不是判据；判例 a813 阶梯阴跌 -52%/f485 -62% 穿插反弹/28ad V 形收复/c84a 慢跌横盘企稳）');
  ok(esIns.includes('flat 横盘/缓行'), 'F: flat 横盘桶（各臂不命中且无回落结构如实归本桶）');
  ok(esIns.includes('crash=拉顶后连续两个 5s 段 -16.9%/-16.1% 零反弹垂直砸落（LOVE）/顶上 3s 单段 -22.3% 大单直砸（STOCKLESS）') && esIns.includes('normal_dip=较最高 -7%+5s 段最大跌 -0.2%（对倒盘温和回踩=目标形状）/90s 阶梯阴跌 -52% 段间企稳（a813）/-62% 震荡下行穿插 +25% 反弹段（f485）') && esIns.includes('spike=chg30 +23%+现价贴最高 -0%（尖刺拉盘贴顶，不追）'), 'F: entry_shape 形状样本（二修版——crash 两判例 LOVE 连续垂直砸落/STOCKLESS 单段直砸+normal_dip 三判例 米温回踩/a813 阶梯阴跌/f485 震荡下行+YiYi 尖刺）');
  // BP59（案号同 BP58 二修续）crash 第三形态轴=急跌进行时（bt-v96 2ef6 判例——用户裁定「买入时刻突然下跌不是可以接受的点位」）
  ok(esIns.includes('突发砸落进行时同落本桶（BP59）') && esIns.includes('chg5Pct≈chg10Pct 同深=整个下跌就发生在眼下几秒') && esIns.includes('下跌刚开始，买点接在急跌进行中=接刀进行时') && esIns.includes('判例 2ef6：+81.6% 高位横盘后买点前 5s 突发 -32%'), 'F: BP59 crash 急跌进行时第三形态轴（2ef6——+81.6% 横盘后买点前 5s 突发 -32%、chg5=chg10 同深无铺垫=接刀进行时落 crash；可接受的「跌」=已走完一段的位置）');
  ok(esIns.includes('且下跌已走完一段、此刻不在急跌进行中（BP59：chg5 深负无铺垫的急跌进行时落 crash）') && qs.entry_shape.criteria.crash.includes('买点时刻突发急跌进行时（chg5 深负+chg5≈chg10 同深无铺垫=刚开始砸）也落本桶') && qs.entry_shape.criteria.normal_dip.includes('前提=下跌已走完一段、此刻不在急跌进行中'), 'F: BP59 normal_dip 前提+criteria 两桶同步（正例对照锚 a813 chg5 -0.8/28ad +14 温和或已收复照放；chg5 深负无铺垫急跌进行时归 crash）');
  ok(esIns.includes('怎么算：[PRECOMPUTED] 现价较锚窗最高价行（currentVsAthPct）+ 近窗动量行（chg30Pct）+ 临近段 5s 段最大涨/跌行（nearMaxUp5Pct/nearMaxDn5Pct）+ 发行价位置行的 curVsMinGapPct'), 'F: entry_shape 怎么算=四键直供（snapshot 临近段 5s 双单调队列 nearMaxUp5Pct/nearMaxDn5Pct+发行价位置行 curVsMinGapPct）');
  // BP31 案（题集 BP34/BP35）：⑥持续拉升弱回调+①散户入场机会双臂+①⑥强庄家族从宽①
  ok(mp.includes('⑥持续拉升弱回调盘（sustained_climb，BP34 新增）') && mp.includes('「一开盘一直拉、几乎无回调的都不是啥好东西」') && mp.includes('没有庄筹码对倒、没有像样的换手') && mp.includes('浮筹全部悬在拉升段上方，拉不动的那一下就是山顶'), 'F: ⑥持续拉升弱回调盘立法（BP31 案 Shellbank 0x24436292 不健康最终证明 cheat——原话「一开盘一直拉几乎无回调的都不是啥好东西」：几乎无回调 ∧ 买卖几乎完全不平衡（近窗卖归零/尘埃+买占比 ≥90% 无对倒无换手不给散户入场机会）；二修恢复 BP51 全文）');
  ok(mp.includes('**大户在场不豁免双臂判据（BP35）**') && mp.includes('拉升的执行者就是大户') && mp.includes('身份证据在场不豁免'), 'F: ⑥身份证据不豁免双臂判据（BP35——拉升执行者就是大户；BP60 四桶化后①桶退役家族归属句删，身份不豁免语义保留）');
  ok(mp.includes('防误伤的从宽方向=双臂材料混合/证据薄时从宽 none') && mp.includes('有对倒证据（近窗有像样卖出）的照正常盘面归 none 评估'), 'F: ⑥从宽 none 防误伤（BP35——①桶退役后从宽方向回指 none；拒买类从严拿不准从宽）');
  ok(mp.includes('⑥ ≤+10% 起点段放行、已拉离（>+10%）拒'), 'F: ⑥参与窗口位置门语义（原话「这种只能临近发布价格参与」——贴发行价起点段放行、已拉离拒；BP58 后表述并收尾门段）');
  ok(qs.market_pattern.criteria.sustained_climb.includes('价格从开盘起持续单边拉升几乎无回调（全窗价格拱一路向上）∧ 买卖几乎完全不平衡（近窗卖出归零/仅尘埃级 <0.12 ∧ 买占比 ≥90%；近窗卖出 ≥0.12=对倒痕迹在场归 none）') && qs.market_pattern.criteria.sustained_climb.includes('判据全文见题面⑥桶') && qs.market_pattern.criteria.sustained_climb.includes('只有现价 ≤+10%（含破发）起点段放行，已拉离（>+10%）或锚缺失=不要参与'), 'F: criteria sustained_climb 同步（BP37+BP58 二修+BP60 四桶化——0.12 线/身份不豁免/从宽 none 全文在⑥桶主述，criteria 指针+位置门双臂保留）');
  ok(mp.includes('（参考合计 <0.12 BNB）∧ 买占比极高（参考 ≥90%）（BP36 近窗锚定，BP37 收紧）') && mp.includes('近窗卖出合计有像样金额（参考 ≥0.12 BNB）=对倒痕迹在场，不落本桶（对倒换手是正常盘面，归 none）；刚过 0.1 的贴线微小卖出（0.10x 级）不构成对倒痕迹、照常落本桶'), 'F: ⑥对倒臂 0.12 线（BP37 收紧——無為 S072 近窗卖 0.128≥0.12=对倒痕迹归 none，太空逆袭 S054 卖 0.1021=贴线微小卖出不算对倒仍⑥，羊王 S156 卖 0.0000=臂失落⑥：⑥/none 分界客观化，Jev 对照近窗流量行即可判；BP60 四桶化后①桶退役归 none）');
  ok(mp.includes('看价格拱形状不看单根回针（BP36）') && mp.includes('回针是拉升途中的洗盘针不是回调结构，不破坏「一路向上」形状'), 'F: ⑥回撤判据看全窗价格拱（BP36——「窗内最大回撤」行是临近段口径：S156 回针 35.3% 但末价=ATH 0s 前刚创新高，单根深急回针收复不破坏一路向上）');
  ok(mp.includes('⑥看拉升的「现在进行时」（BP36）') && mp.includes('全窗更早段的对倒（如开盘大额买进后部分兑现）不救近窗纯拉段'), 'F: ⑥现在进行时（BP36——S156 第 1 大 0xb036 全窗卖 0.756 是更早段兑现，近窗 30s 卖 0.0000×0 纯拉进行时不给入场机会仍落⑥）');
  ok(mp.includes('承接归零的除外（BP36）') && mp.includes('近窗买入归零/仅尘埃（买占比 ≈0、无人接盘）=没有任何人在接——没有买方的盘面不是正常盘面，落②(b)（在场持有+零承接=对倒停摆的死盘）'), 'F: ②(b) 承接归零例外（BP36——S157 近窗买 0.0001 卖 0.661：大户在场持有未卖但承接归零，没有买方的盘面不是正常换手盘面落②(b)；⑤桶退役归 none 后语义承接）');
  // BP30 案三改（盘型前置预判断+互斥教学+④判据补强——题集 BP33）
  ok(mp.includes('本题是预判断——先于其它题作答、先定盘面性质再谈点位'), 'F: BP30 改五 前置预判断声明（market_pattern 放最前——用户裁定原话「market_pattern 要放到很靠前的位置，因为这是个预判断」）');
  ok(mp.includes('才做互斥检查（BP33）') && mp.includes('famous 控盘 ≥25 的盘子按③famous_monopoly（小散底子被 famous 抢筹）或按散户化/持续拉升形状归②⑥') && mp.includes('famous 的货是要出货的，不是锁仓拉盘的庄'), 'F: BP30 改二 分类互斥教学（famous 控盘 ≥25 的盘子在早期薄盘域内对照②⑥判——①桶退役后「强庄的庄不能是 famous」句随桶删除，互斥目标=③或按散户化/持续拉升形状归②⑥；互斥主述在 famous 轴前置段）');
  // BP47（案号 BP43 第二版）famous 轴适用域厚度维度+③桶薄盘限定+控盘题厚盘不判拦截档（题面化——用户裁定「famous盘只用于判定早期，盘子很薄，famous入场收割」「famous 盘不适合已经有大量交易的情况」）
  ok(mp.includes('对归类的约束**只在盘面尚薄、尚未火过成立（BP62 用户立法「famous 只判交易量尚且不足/尚未火过的代币」') && mp.includes('两维度任一命中即**退出 famous 轴**') && mp.includes('厚度维度（BP47') && mp.includes('**盘子已厚**') && mp.includes('famous 占比是换手结果不是收割前兆'), 'F: BP47+BP62 famous 轴互斥适用域（前置段升级为用户立法句「famous 只判交易量尚且不足/尚未火过的代币」；已有大量交易的盘面=盘子已厚，famous 占比是换手结果不是收割前兆，不触发互斥不落③——与 BP45 第一波价格维度并列双维度；主述在 famous 轴前置段）');
  ok(mp.includes('适用域=盘面尚薄、尚未火过（BP47 厚度维度+BP62 用户立法「famous 只判交易量尚且不足/尚未火过的代币」）——「盘子很薄、famous 入场收割」才是本桶的形状') && mp.includes('苍蝇判例：出生数十秒 ultra 吞吐大量成交的盘面，famous 占比高但绝不是 famous 收割形状'), 'F: BP47+BP62 ③桶适用域限定（famous 独食致命前提=盘子还薄——薄盘 famous 大额才拿得动太多筹码；大量交易厚盘不落本桶退出 famous 轴）');
  // BP53 四修/案号 BP62（版本内返工不 bump）：③桶 famous 轴适用域升级——c84a +0.4297 兑现票被收割完臂拦引出
  ok(mp.includes('判厚薄三证据，**①吞吐量级是主判硬前提**') && mp.includes('退出本桶/退出 famous 轴的前提=全窗吞吐量级充分') && mp.includes('量不足的薄盘即使价格拉高过又回落（「火过」），仍是「薄盘被 famous 打完第一波就走」的形状照落本桶') && mp.includes('反判例 147d/0432：吞吐仅 3.5~3.7 BNB 薄') && mp.includes('②③为**辅助证据**（吞吐量足时并读）') && mp.includes('②价格形状（价格族锚：锚窗高点较发行价大幅拉高过且现价已回落到底部区=涨跌轮回走完，是「火过后的回落」不是「薄盘被吃光」——**单独不构成退出理由**，量不足的回落照落本桶）') && mp.includes('③「famous 集团买入占比」是 famous+跟单的**合并口径**') && mp.includes('判例 c84a：93 笔/买入 6.96 BNB 厚吞吐') && mp.includes('痕迹行 famous 本人占买仅 12.7%、卖/买 123% 带底仓连续操作（7 买 3 卖）') && mp.includes('肯定不能算 famous 单级持仓」→ 不落本桶归 none 正常盘面'), 'F: BP62 五修 ③桶厚薄三证据·吞吐主判硬前提（立法原话「famous 只判交易量尚且不足」——量不足的薄盘即使火过回落照落③（反判例 147d/0432 首版②轮回句被单独放大翻 none 漏拦引出）；②轮回/③合并口径降辅助；c84a 判例全数值；用户裁定原话语义锚定）');
  ok(mp.includes('适用域同桶级=盘面尚薄、尚未火过——收割完/收割中同样是「尚未火过的薄盘被 famous 打完第一波就走」的形状，吞吐厚+涨跌轮回走完的厚盘不适用本臂') && mp.includes('判例见上 c84a：厚吞吐 6.96 BNB+famous 本人占买仅 12.7% 带底仓连续操作=换手不是收割'), 'F: BP62 收割臂适用域回指（收割完/收割中臂同受桶级适用域覆盖——0432/米/147d 全薄盘秒闪不受影响；c84a 厚盘不适用收割臂）');
  ok(!('famous_domination' in qs), 'F: BP47 控盘题厚盘判档语义已随题退役（BP49——厚盘不判拦截档/先看厚薄再谈切点等判档教学随题删除，厚度维度适用域主述在 market_pattern 前置检查②承接）');
  // BP58 二修——判型恢复：五桶桶名+判据全文在场（首版误删被用户裁定「简化而不是删除」推翻）
  // （识别能力全保留=Jev 判型落档留观察；处理统一=②③硬拒+⑥≤10+①④⑤⑦⑧统一门 27.5）
  ok(!JSON.stringify(qs).includes('early_sniper_decay') && !JSON.stringify(qs).includes('blended_unremarkable') && !JSON.stringify(qs).includes('golden_point') && !JSON.stringify(qs).includes('restart') && !JSON.stringify(qs).includes('strong_backer'), 'F: 旧桶名全量绝迹（BP60 四桶化——strong_backer/early_sniper_decay/blended_unremarkable/restart/golden_point 五桶判据全文删除：criteria 键域即 Jev Choice options，桶名不在=Jev 无法产出=unknown-bucket throw 兜底；BP52 未部署生产零存档行无重放污染面）');
  // BP48 两质量题退役：QUALITY_LEVELS/QUALITY_IDS 双侧绝迹（ESM 题集+CJS mapper）；
  // ASSESSMENT_LEVELS 门域四值保留（bpPassLevels 消费域与历史 digest 行兼容不收窄）
  ok(!('QUALITY_LEVELS' in q) && !('QUALITY_IDS' in q), 'F: ESM 侧 QUALITY_LEVELS/QUALITY_IDS 常量绝迹（BP48 两质量题退役反证）');
  ok(JSON.stringify(ASSESSMENT_LEVELS) === JSON.stringify(['good', 'neutral', 'poor', 'insufficient']), 'F: ASSESSMENT_LEVELS 门域四值保留（bpPassLevels 消费域不动——good 不再产出但历史行重放兼容不收窄）');
  ok(ids.every((id) => DIMENSION_IDS.includes(id)) && DIMENSION_IDS.length === 6, 'F: 题集 id 与 mapper DIMENSION_IDS 对齐（6 维度 0 质量——BP58 entry_shape 入域+BP60 market_heat 出域）');
  // BP58 收尾门链=②③硬拒+位置门（⑥ 10/none 27.5）+点位性质门+活跃度门（①⑤⑧位置臂随桶退役）
  ok(mp.includes('放行后统一走点位性质门/活跃度门'), 'F: 收尾门链句（BP58——②③硬拒；⑥/none 过位置门后统一走点位性质门/活跃度门）');
  // BP58 二修——④桶拉高判据恢复在场（maxChg5 速度锚回题面；拦截执行归 entry_shape+统一门）
  ok(!JSON.stringify(qs).includes('maxChg5'), 'F: maxChg5 速度锚题面绝迹（BP60 四桶化——④桶拉高判据随桶删除，拉高拦截由 entry_shape spike 臂+统一门接力；snapshot maxChg5Pct 锚照算照渲染纯留档——E 组「maxChg5Pct 锚透传」断言锁）');
  const noQuality = JSON.stringify(qs);
  ok(!noQuality.includes('第一分支·价格低救') && !noQuality.includes('累计位置硬腿') && !noQuality.includes('崩塌第一腿') && !noQuality.includes('庄盘豁免（BP32'), 'F: 早鸟/回调题忌讳救臂句绝迹（BP48 退役反证——maxChg5 救臂/忌讳/庄盘豁免链不迁移，①庄盘语义由①桶 strong_backer ≤+80 位置门承载）');
  // BP48 裁定 3（C 弃）后两质量题整段删除——⑦⑧承载大户未清场判读（B 迁）、
  // ④桶保留拉高判据、黄金点豁免奔零臂语义并入⑧桶自身三条件（区内∧活跃∧有买入）
  // BP25 案三改（S043 高点接盘——low 档收窄+庄盘豁免一档帽+mid 浅回调一律拒）；
  // BP43 六桶改制（almost_launch 前插/low 40~80/mid 下界 +100→+80）；BP50 almost 20→10
  ok(qs.price_level.instructions.includes('+10%~+40% =接近发行价；+40%~+80% ≈ 1.4~1.8 倍=偏低；+80%~+600% ≈ 1.8~7 倍=不高不低') && qs.price_level.criteria.low.includes('+40%~+80%，1.4~1.8 倍') && qs.price_level.criteria.mid.includes('+80%~+600%，1.8~7 倍'), 'F: price_level 六桶分界（BP27/BP25 案 low 档收窄+BP43 六桶改制 almost_launch 前插+BP50 上界 20→10——low=较发行价 +40~80、mid 改 +80~600）');
  ok(qs.price_level.instructions.includes('较发行价 >+80%（近 2 倍以上）=已明显脱离发行价区——正常路径不构成「价格低」的可参与证据') && qs.price_level.instructions.includes('BP58 统一位置门收口：全盘型参与上界 ≤+27.5%（含破发），>+80% 已远超上界，无任何参与路径'), 'F: price_level 反锚④不开口句（BP27+BP43 界 +100→+80；BP58 后 +80 以上无任何参与路径——统一门 27.5，庄盘门教学随①桶退役删除）');
  // price_trend BP6 短窗锚（用户裁定：近窗趋势 5/10/30s）
  ok(qs.price_trend.instructions.includes('近 5/10/30 秒'), 'F: price_trend 动量窗=5/10/30s（BP6 短窗）');
  ok(qs.price_trend.instructions.includes('chg5/10/30Pct'), 'F: price_trend 引用短窗键族');
  ok(qs.price_trend.instructions.includes('速度参照：|chg30| 两位数'), 'F: price_trend 速度参照=|chg30| 两位数界（30s 仍为最长窗）');
  ok(qs.price_trend.instructions.includes('快升不等于该追'), 'F: price_trend 反锚⑤只述事实不判买卖');
  ok(!('entry_position' in qs), 'F: entry_position 题绝迹（BP49 退役——回撤深度较 ATH 相对位置无消费者，现行位置门全用 currentVsLaunchPct 较发行价绝对位置）');
  ok(qs.price_level.instructions.includes('currentVsLaunchPct') && qs.price_level.instructions.includes('launchPriceBnb'), 'F: price_level 怎么算=发行价位置行两键（BP5 新增维度）');
  ok(qs.price_level.instructions.includes('未覆盖出生段'), 'F: price_level 反锚④? 行=材料缺失不猜（截窗不冒充）');
  ok(qs.price_level.instructions.includes('破发') && qs.price_level.instructions.includes('near_launch'), 'F: price_level 破发负值归接近发行价桶');
  ok(!('market_heat' in qs) && !('HEAT_LEVELS' in q), 'F: market_heat 题对象+HEAT_LEVELS 常量绝迹（BP60 退役——与 activity_level 重复，用户裁定「market_heat 感觉跟 activity_level 也重复了，如果 market_heat 没有什么用处，也可以删除」；近窗密度信息保留在 activity_level 题头辅助证据句；旧档 answers 带该键=维度缺席不被消费不 throw）');
  // activity_level 题面（BP13：CD 七要素判法搬运——判读倾向临近买点段）
  const al = qs.activity_level;
  ok(al.instructions.includes('买入点位之前的盘面活跃度') && al.instructions.includes('判读倾向临近买入点位段'), 'F: activity_level 题头=买点前窗口+临近段倾向（BP12 案用户原话「活跃度检测要倾向于检测买入点位之前的」）');
  ok(al.instructions.includes('近窗密度（win30/60 笔/分）作辅助证据并读'), 'F: activity_level 吸纳 market_heat 近窗密度视角（BP60 分工句改辅助证据——近窗密度并入 activity 判读不再独立成题）');
  for (const seg of ['无交易期占比', '笔密度', '买盘中位数为主、笔均为辅', '单向死水推进', '开盘极早窗反锚', '金额吞吐', '停滞突发反锚', '临近买入点位段（锚窗末端 30 秒=买点前最后 30 秒）', '全窗量级综合锚']) {
    ok(al.instructions.includes(seg), `F: activity_level 七要素+综合锚段在场：${seg.slice(0, 18)}`);
  }
  ok(al.instructions.includes('数值行「临近买点段」「锚前尾段」与「临近尾窗（尾 10 秒 / 此前 20 秒）」事实均已算好直接采信') && al.instructions.includes('尾窗按绝对位置取窗：窗口不足 30 秒时临近段行可能缺席，尾窗行仍有值'), 'F: activity_level ⑦ 消费 state 临近买点段/临近尾窗行（D3.59 搬运+BP57 尾窗绝对位置窗——短窗票临近段 null 盲区修复）');
  ok(al.instructions.includes('低档与超高档均由代码侧活跃度门直接消费拒买') && al.instructions.includes('超高=机器盘级极端密集——正常散户参与盘到不了这个密度，BP30 用户裁定「act 为 ultra 也不玩」'), 'F: activity_level 收尾=门消费声明（BP30 ultra 臂；BP58 ①strong_backer 豁免教学随桶退役——ultra 恢复无条件拦）');
  // BP28 案改一（S053 太空逆袭 activity 误 low——三段形状执行缝隙）
  ok(al.instructions.includes('三段形状（开局冲一波→中段完全静默→临近买点再集中涌入，BP30）同样属「静默后买入涌入」') && al.instructions.includes('判读锚定**买点时刻的即时状态**') && al.instructions.includes('中段静默的占比不压档') && al.instructions.includes('不是针对静默居中的三段形状'), 'F: activity⑥反锚三段形状归属句（BP30/BP28 案 S053——开局 7 秒冲 7 笔→中段 24 秒完全静默→锚前 2 秒 8 笔近 1 BNB 同块涌入：静默居中的三段形状按「静默后买入涌入」中档起判，「先冲一波后静默」不保护臂只管涌入后死到锚点的形状）');
  ok(al.instructions.includes('买点时刻盘面正被涌入激活（锚前尾段行=8 笔近 1 BNB 直接可见），静默居中的三段形状按「静默后买入涌入」中档起判，不因中段静默占比判低'), 'F: activity 反例样本段补三段形状反例（BP31——S053 形状直译锚+尾段行数值佐证）');
  // BP28 案四改：⑥句挂尾段行判读锚（state 时序盲区补位）
  ok(al.instructions.includes('判读原料=**数值行「锚前尾段(最后5秒)」**') && al.instructions.includes('锚前尾段多笔且金额可观（参考 ≥3 笔/合计 ≥0.3 BNB 级）=锚点时刻正被流量激活的直接证据') && al.instructions.includes('三段形状判尾段行不判段内最大间隔') && al.instructions.includes('尾段仅 1 笔/合计尘级=锚点即静默边界'), 'F: activity⑥尾段行判读锚（BP31——临近段 totals 无时序测不出涌入在段尾；末行恒在尾段内最少 1 笔，死寂臂=仅 1 笔尘级非 0 笔）');
  ok(al.criteria.low.includes('临近买点段（最后 30 秒）') && al.criteria.low.includes('四腿联立'), 'F: activity_level low 桶=临近段死寂+四腿联立双臂');
  ok(al.criteria.high.includes('金额吞吐与之相称') && al.criteria.high.includes('尘埃假活跃不入本档'), 'F: activity_level high 桶=吞吐相称门槛（假活跃不入高档——ZELDA 案失真修复）');
  // ═══ BP57/CD394 同车：activity ⑦定档主锚四臂判读（bt-v94 六案「活跃度以临近买入点附近行为为准」） ═══
  ok(al.instructions.includes('定档主锚') && al.instructions.includes('四臂判读'), 'F: BP57 activity ⑦升级定档主锚+四臂判读声明在场');
  for (const seg of ['协同出货', '临近衰减', '临近仍活', '临近死寂']) {
    ok(al.instructions.includes(seg), `F: BP57 activity 四臂段在场：${seg}`);
  }
  ok(al.instructions.includes('多个独立钱包（参考 ≥10 个）几乎纯卖出') && al.instructions.includes('照实落超高') && al.instructions.includes('档位只述节奏事实') && al.instructions.includes('出货臂须协同钱包数与买入趋零两腿同时在场') && al.criteria.ultra.includes('不因买卖失衡降档'),
    'F: BP57 协同出货臂（末 10s ≥10 独立卖侧钱包+买入趋零/纯尘 → ultra——第五案 71 钱包协同卖 6.2 BNB/第六案庄极速跑路 15 钱包；出货臂两腿同在场才命中防误伤——彪姐 5 钱包/徐苍蝇 10 钱包但买 7 笔在场不命中）');
  ok(al.instructions.includes('末 10 秒吞吐较此前 20 秒断崖跌落') && al.instructions.includes('全窗密集不救临近衰减') && al.instructions.includes('档位至多「中」'),
    'F: BP57 衰减臂（苍蝇案 05:09:44 尾 10s 3.93 vs 前 20s 33.69 断崖 1/8.6+尾 5s 趋零 → 至多 mid——CD391 activity_high 豁免失效）');
  ok(al.instructions.includes('尾 5 秒仍有真实买入') && al.instructions.includes('卖出恒被池子接走') && al.instructions.includes('买入方向才是买方需求在场'),
    'F: BP57 密集臂真实买入腿（AMM/曲线池语境卖出恒成交≠对手方在场——第六案暴露的原认知错误修正：memes 尾 5s 6 买 0.62 → ≥high）');
  ok(al.instructions.includes('先按⑦定基准档') && al.instructions.includes('只压不抬'),
    'F: BP57 判序句（⑦定基准档+全窗背景校验只压不抬——全窗密集不救临近衰减/全窗稀疏不抹临近真实涌入）');
  ok(al.criteria.ultra.includes('协同出货') && al.criteria.mid.includes('临近衰减（末 10 秒断崖+尾 5 秒趋零）的档位上限为本档') && al.criteria.high.includes('尾 5 秒仍有真实买入') && al.criteria.low.includes('不救临近死寂') && al.criteria.low.includes('见题面⑦衰减臂'),
    'F: BP57 criteria 四桶同步四臂句');
  // famous_domination 题面（BP14 立法：CD famous 控盘判法搬运 BEM Miner 案）已随 BP49 整题
  // 退役——题头/三档切点/联立加重臂/门消费声明全删；famous 判读材料（筹码结构行
  // famous 控盘占比/跟单集中度/集团买入占比）仍在 state 供 market_pattern ③桶判读
  ok(!('famous_domination' in qs) && mp.includes('筹码结构行'), 'F: famous_domination 题面绝迹（BP49——判读材料筹码结构行仍在 state 供③桶判读，BEM 案拦截改由 Jev ③独食桶+互斥检查承接）');
  // holder_concentration 题面（BP14：CD240 分层线判法搬运）
  const hc2 = qs.holder_concentration;
  ok(hc2.instructions.includes('持有者基数分层') || hc2.instructions.includes('分层判法（持有者基数分层'), 'F: holder_concentration 分层判法声明');
  for (const seg of ['**持有者 ≥10**', '**持有者 6~9**', '**持有者 ≤5**', '单一 >45% 或 前二 >55% 或 前三 >70%']) {
    ok(hc2.instructions.includes(seg), `F: holder_concentration 分层线段在场：${seg}`);
  }
  ok(hc2.instructions.includes('**参与/持有分叉**') && hc2.instructions.includes('拉高出货'), 'F: holder_concentration 参与持有分叉=拉高出货前奏度量');
  ok(hc2.instructions.includes('极早窗筹码集中是价格发现常态'), 'F: holder_concentration 反锚①极早窗从宽（价格发现期天然集中）');
  ok(hc2.instructions.includes('价格几乎发行价豁免持有者不均衡') && hc2.instructions.includes('currentVsLaunchPct ≤ +10%') && hc2.instructions.includes('不坐实 strong'),
    'F: holder_concentration 反锚⑥价格豁免锚（BP15 谷谷案+BP43 界 ≤+50 收至 ≤+20 almost_launch 档+BP50 上界 20→10——贴发行价头部无浮盈可砸，不坐实 strong）');
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
