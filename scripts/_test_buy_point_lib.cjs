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
  PRICE_TREND_LEVELS, ACTIVITY_LEVELS,
  HOLDER_CONCENTRATION_LEVELS,
  PRICE_LEVEL_LEVELS,
  MARKET_PATTERN_LEVELS, PATTERN_GATE_POOR_BUCKETS,
  ACTIVITY_GATE_POOR_BUCKETS,
  NORMAL_ENTRY_LAUNCH_PCT,
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
  ok(m49.NORMAL_ENTRY_LAUNCH_PCT === 28.5 && m49.SUSTAINED_CLIMB_LAUNCH_PCT === undefined,
    'E: BP59 统一位置门常量（NORMAL_ENTRY_LAUNCH_PCT=28.5（BP58 立线 27.5、BP69 微放宽）；SUSTAINED_CLIMB_LAUNCH_PCT 已随⑥桶退役绝迹）');
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
  // BP72 M fixture recentDip5 三键：tEnd=44 全窗在 30s 域内，最深 5s 段=40→42 的
  // 1.3→1.0（-23.08%，dqHi 队首 40 差 2s）；未收复=末价 1.3/段起点 1.3=0（已收复形状）
  ok(dM.recentDip5Pct === -23.08 && dM.recentDip5SecAgo === 2 && dM.recentDip5UnrecoveredPct === 0,
    `BP72 M fixture recentDip5（-23.08%/距 2s/未收复 0——44s 行已回到段起点价，实际 ${dM.recentDip5Pct}/${dM.recentDip5SecAgo}/${dM.recentDip5UnrecoveredPct}）`);
  // BP72 M fixture 尾 10s (34,44]=行 40/42/44 三笔买各 0.1 → 3 笔/0.3/卖 0
  ok(dM.activity.nearTail10BuyN === 3 && near(dM.activity.nearTail10BuyBnb, 0.3) && dM.activity.nearTail10SellBnb === 0,
    `BP72 M fixture 尾 10s=3 笔买 0.3/卖 0（实际 ${dM.activity.nearTail10BuyN}/${dM.activity.nearTail10BuyBnb}/${dM.activity.nearTail10SellBnb}）`);
}
{
  // BP72 族二立法形状迷你 fixture（idx195 币安之心变体）：横盘 1.0 → 87s 买拉起
  // → 92s 深砸 5s 段 -25%（0.75）→ 尾段零买纯卖小推进稳在 0.75~0.76——
  // 臂 B（深段距 6s 未收复 -24%）+臂 A（尾 10s 零买纯卖 0.6）双主锚形状
  const rowsB72 = [
    row(10, 'BUY', W_B, 0.2, 1.0 * E9, 1e8),
    row(40, 'BUY', W_C, 0.2, 1.0 * E9, 1e8),
    row(70, 'SELL', W_B, 0.15, 0.98 * E9, 1e8),
    row(87, 'BUY', W_D, 0.3, 1.0 * E9, 1e8),
    row(92, 'SELL', W_E, 0.4, 0.75 * E9, 1e8),
    row(95, 'SELL', W_C, 0.1, 0.75 * E9, 1e8),
    row(98, 'SELL', W_B, 0.1, 0.76 * E9, 1e8),
  ];
  const dB = buildBuyPointSnapshot(rowsB72, metaA).buyDerived;
  ok(dB.recentDip5Pct === -25 && dB.recentDip5SecAgo === 6 && dB.recentDip5UnrecoveredPct === -24,
    `BP72 族二形状 recentDip5 三键（-25%/距 6s/未收复 -24%——深段就在近 30s 且现价未收复，实际 ${dB.recentDip5Pct}/${dB.recentDip5SecAgo}/${dB.recentDip5UnrecoveredPct}）`);
  ok(dB.activity.nearTail10BuyN === 0 && dB.activity.nearTail10BuyBnb === 0 && dB.activity.nearTail10SellBnb === 0.6,
    `BP72 族二形状尾 10s 零买纯卖 0.6（臂 A 主锚形状——「先买入、然后只有卖出」，实际 ${dB.activity.nearTail10BuyN}/${dB.activity.nearTail10BuyBnb}/${dB.activity.nearTail10SellBnb}）`);
  // BP72 两行 state 直供行渲染（BP71 铁律：判据引入派生量必须 state 直供——题面
  // 判读原料不能只落 digest）：族二形状双主锚行的渲染精确文本（chg=toFixed(2)）
  const stB = buildBuyPointState(buildBuyPointSnapshot(rowsB72, metaA)).state;
  ok(stB.includes('近期暴跌段(锚前30秒内最深5秒段): -25.00%、距今 6 秒、现价距该段起点 -24.00%'),
    'BP72 state 暴跌血缘行渲染（-25.00%/距 6 秒/未收复 -24.00%——臂 B 主锚直供行在场）');
  ok(stB.includes('锚前尾段买卖对比(最后10秒): 买 0 笔 / 0 BNB、卖 0.6 BNB'),
    'BP72 state 尾段买卖对比行渲染（臂 A 主锚直供行——买 0 笔/0 BNB、卖 0.6 BNB）');
  // A fixture recentDip5 null → 暴跌血缘行缺席（缺证据不渲染，宁缺不冒充）。
  // 锁数据行完整前缀而非裸子串：趋势打断行的打断余波口指引文提及「（近期暴跌段行）」
  // 行名（R1 三修）——指引在场≠数据行在场。
  const stB0 = buildBuyPointState(buildBuyPointSnapshot(rowsA, metaA)).state;
  ok(!stB0.includes('近期暴跌段(锚前30秒内最深5秒段):'), 'BP72 state 暴跌血缘行缺席（recentDip5 null 不渲染——守卫非 null 才出场；趋势打断行指引文提行名不算）');
}
ok(dA.maxChg5Pct === null, `A fixture 无 ≤5s 跨行段（间隔≥10s、同块行队首==j 不计）→ maxChg5=null（实际 ${dA.maxChg5Pct}）`);
// BP58 A fixture 三键：同块行 9→10（2.0→1.95）=-2.5% 计入（双单调队列同块两笔价格差真实）；
// 临近段 dt>95 段内无 ≤5s 跨行涨段（110→125 已 15s 外）→ nearMaxUp5=null 有证据缺失
ok(dA.maxDn5Pct === -2.5 && dA.nearMaxUp5Pct === null && dA.nearMaxDn5Pct === -2.5,
  `BP58 A fixture 速度三键（maxDn5=-2.5 同块段/nearMaxUp5=null 段内无涨段/nearMaxDn5=-2.5，实际 ${dA.maxDn5Pct}/${dA.nearMaxUp5Pct}/${dA.nearMaxDn5Pct}）`);
// BP72 暴跌血缘三键（A fixture：30s 域 dt≥185 内无跨行 5s 段——185 两行同 dt 同价
// 队首==j 不计、200/215 各自窗内无更早行）→ 全族 null（缺证据语义，宁缺不冒充）
ok(dA.recentDip5Pct === null && dA.recentDip5SecAgo === null && dA.recentDip5UnrecoveredPct === null,
  `BP72 A fixture recentDip5 三键 null（30s 域无跨行 5s 段，实际 ${dA.recentDip5Pct}/${dA.recentDip5SecAgo}/${dA.recentDip5UnrecoveredPct}）`);
// BP72 尾 10s 买卖分解三键（半开窗 (205,215]=行18 一笔买 0.1；行17@200 窗外）
ok(dA.activity.nearTail10BuyN === 1 && near(dA.activity.nearTail10BuyBnb, 0.1) && dA.activity.nearTail10SellBnb === 0,
  `BP72 A fixture 尾 10s=1 笔买 0.1/卖 0（实际 ${dA.activity.nearTail10BuyN}/${dA.activity.nearTail10BuyBnb}/${dA.activity.nearTail10SellBnb}）`);
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
// BP73 同块捆绑买入：全窗单 block 买入合计最大块=W_B@20 单笔 1.0（block=1000+dt 各自
// 唯一，110 两笔 0.7 次之——单笔大买本身就是最大块，多钱包捆绑形状由下方剔伪夹具锁）
ok(dA.bundledBlock && dA.bundledBlock.block === 1020 && dA.bundledBlock.n === 1
  && near(dA.bundledBlock.buyBnb, 1) && dA.bundledBlock.wallets === 1 && dA.bundledBlock.dt === 20,
  `BP73 bundledBlock={块1020,1笔,1.0,1钱包,dt20}（实际 ${JSON.stringify(dA.bundledBlock)}）`);
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
  // BP70：在场净和=presenceNetBnb（净>0 钱包净额合计——W_FA +0.01 入、W_FB −0.01 不入；
  // 与 netSumBnb（含负）刻意分开：尘埃残仓判读锚=28ad 案在场净和 0.0152 vs 59f5 0.7810 定线）
  ok(ft.presenceNetBnb === 0.01, `在场净和 0.01（只计净>0 的 W_FA，实际 ${ft.presenceNetBnb}）`);
  // state 渲染三形状
  const stFt = buildBuyPointState(snapFt).state;
  ok(stFt.includes('famous 痕迹: 锚窗内名单钱包 2 个') && stFt.includes('0xfbfb…fbfb') && stFt.includes('0xfafa…fafa'),
    'state 命中行（2 钱包+短址直供——slice(0,6)+…+slice(-4)）');
  ok(stFt.includes('净 +0.0100') && stFt.includes('净 -0.0100') && stFt.includes('Σ净 +0.0000')
    && stFt.includes('净持仓>0 的名单钱包 1 个') && stFt.includes('占全窗买 65.0%') && stFt.includes('占全窗卖 100.0%')
    && stFt.includes('卖出/买入 102.9%') && stFt.includes('卖出/买入 96.7%') && stFt.includes('在场性判读三分') && stFt.includes('=收割中——收割完/收割中同落③桶残局臂'),
    'state 命中行数值（单钱包净/Σ净/在场计数/占比+三修卖/买比与判读三分句——FB 102.9%/FA 96.7%）');
  // BP70：在场净额合计直供+尘埃残仓判读指针（判据与 state 直供同构——BP61 三修铁律）
  ok(stFt.includes('在场净额合计（净>0 钱包净额之和）+0.0100') && stFt.includes('在场净额合计=尘埃量级（参考 <0.05 BNB）∧盘面基本归零过（发行价位置行「涨起后最低」≤+10%）后又流量涌入的 burst 重启形状=上一轮尘埃残仓不算在场（BP70 判读见③桶）'),
    'state 痕迹行 BP70 直供（在场净额合计数值+burst 重启尘埃残仓指针句）');
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
  // BP63（KOL 研究 I 判据/asof-严 题面化）：per-wallet entryVsLaunchPct/holdSec/fastFlip
  // 手算——锚=未地板发行价锚（rowsFt 无 platform → launchCovered dt0 首可靠价 1.0e-9）：
  // W_FA 首买 t+0@1.0e-9 → entryVs 0.0%（低价）持 5s 但净 +0.01>0.005 未清仓 → fastFlip false；
  // W_FB 首买 t+8@1.1e-9 → entryVs +10.0%（低价）持 3s 净 −0.01 已清仓 → fastFlip true
  const faRow = ft.wallets.find((e) => e.w === W_FA);
  const fbRow = ft.wallets.find((e) => e.w === W_FB);
  ok(faRow.entryVsLaunchPct === 0.0 && faRow.holdSec === 5 && faRow.fastFlip === false
    && fbRow.entryVsLaunchPct === 10.0 && fbRow.holdSec === 3 && fbRow.fastFlip === true,
    `BP63 per-wallet 三键（FA entryVs 0.0%/持 5s/未清仓 fastFlip false；FB entryVs +10.0%/持 3s/已清仓 fastFlip true，实际 ${JSON.stringify({ fa: faRow, fb: fbRow })}）`);
  ok(ft.lowEntryN === 2 && ft.fastFlipN === 1 && ft.holdingN === 1,
    `BP63 顶层三计数（lowEntryN 2/fastFlipN 1/holdingN 1——FA 在场持有 0.01>0.005，实际 ${ft.lowEntryN}/${ft.fastFlipN}/${ft.holdingN}）`);
  ok(buildBuyPointState(snapFt).state.includes('低价抢进速倒事实（BP63 纯计数，③桶低价抢进速倒臂三要件原料')
    && buildBuyPointState(snapFt).state.includes('低位入场（首买价较该票首价 ≤+15% 且合计买入 ≥0.05 BNB；锚=票自身开盘首可靠价，窗口未覆盖出生段时=发行价常量）2/2 个')
    && buildBuyPointState(snapFt).state.includes('快进快出（首买→末卖 ≤60 秒且已清仓）1/2 个')
    && buildBuyPointState(snapFt).state.includes('买点在场持有（净 >0.005）1/2 个')
    && buildBuyPointState(snapFt).state.includes('价较该票首价 10% 持有 3s（快进快出·已清仓）'),
    'BP63 state 直供（痕迹行 per-wallet 三键+汇总事实计数——判据与直供同构铁律）');
}

// ═══════════════ A9b. BP63 低价抢进速倒臂三要件反证（小四形状/慢走/地板锚事故反证） ═══════════════
console.log('A9b. famousTraces BP63 三要件形状（臂成立/小四反锚/慢走/未地板锚/outlier 首买）');
{
  // 形状一（臂三要件原料全真）：K1 t+2 贴发行价买 0.30 → t+10 全清（持 8s）；
  // 价格中途拉高又砸回破发 0.82e-9 —— 研究口径 asof-严五张（股股嘎嘎/meme.jpg/100/FOUR米米/SI）形状
  const W_K1 = '0x' + 'k1'.repeat(20).slice(0, 40); // 0x6b31…
  const W_K2 = '0x' + 'k2'.repeat(20).slice(0, 40);
  const W_K3 = '0x' + 'k3'.repeat(20).slice(0, 40);
  const W_K4 = '0x' + 'k4'.repeat(20).slice(0, 40);
  const roster63 = new Set([W_K1, W_K2, W_K3, W_K4]);
  const rowsArm = [
    row(0, 'BUY', W_B, 0.20, 1.0 * E9, 2e8),                    // 散户底子（launchCovered 首可靠价锚）
    row(2, 'BUY', W_K1, 0.30, 1.0 * E9, 3e8),                    // K1 低价抢进（贴发行价）
    row(6, 'BUY', W_C, 0.40, 1.5 * E9, 2.7e8),                   // 拉高
    row(10, 'SELL', W_K1, 0.31, 1.4 * E9, 2.2e8),                // K1 速倒砸出（持 8s 净 −0.01 清仓）
    row(200, 'SELL', W_D, 0.20, 0.82 * E9, 2.4e8),               // 砸回破发（窗 min=0.82e-9 拖地板锚）
    row(202, 'BUY', W_E, 0.10, 0.84 * E9, 1.2e8),                // 承接（锚前尾段）
  ];
  const meta63 = { ...metaA, address: '0x' + 'ee'.repeat(20), createdAt: T0 };
  const ftArm = buildBuyPointSnapshot(rowsArm, meta63, { famousRoster: roster63 }).buyDerived.famousTraces;
  const k1 = ftArm.wallets[0];
  // 未地板锚事故反证（小四 0xf057 案形状）：窗 min 0.82e-9 < 首可靠价 1.0e-9 —— T134 地板锚
  // 会把 K1 入场伪算成 +22%（1.0/0.82−1）；BP63 famous 锚刻意未地板 → entryVs 0.0% 低价成立
  ok(k1.entryVsLaunchPct === 0.0 && k1.holdSec === 8 && k1.fastFlip === true,
    `形状一：K1 低价+速倒+清仓（entryVs 0.0 未被地板锚拖高/持 8s/fastFlip true，实际 ${JSON.stringify(k1)}）`);
  ok(ftArm.lowEntryN === 1 && ftArm.fastFlipN === 1 && ftArm.holdingN === 0,
    `形状一：三要件原料全真（1/1 低价∧1/1 速倒∧0 在场——臂成立态，实际 ${ftArm.lowEntryN}/${ftArm.fastFlipN}/${ftArm.holdingN}）`);
  ok(ftArm.fastFlipArmReady === true,
    `形状一：fastFlipArmReady 组合布尔（三修直供——钱包>0∧低位≥1∧在场0∧全员速倒，实际 ${ftArm.fastFlipArmReady}）`);

  // 形状二（小四反锚——名单钱包高位二次进场在场持有）：K2 t+150@+45% 买入不卖 → holdingN=1
  // 三要件之二（在场持有 0）不成立——小四 0xf057 案卷柏/Ed_x t+241s 高位二次进场同构
  const rowsXs = rowsArm.concat([
    row(150, 'BUY', W_K2, 0.25, 1.45 * E9, 1.7e8),
  ]);
  const ftXs = buildBuyPointSnapshot(rowsXs, meta63, { famousRoster: roster63 }).buyDerived.famousTraces;
  const k2 = ftXs.wallets.find((e) => e.w === W_K2);
  ok(k2.holdSec === null && k2.fastFlip === false && k2.entryVsLaunchPct === 45.0,
    `形状二：K2 二次进场未卖（entryVs +45.0 高位/holdSec null/fastFlip false，实际 ${JSON.stringify(k2)}）`);
  ok(ftXs.holdingN === 1 && ftXs.fastFlipN === 1 && ftXs.fastFlipN !== ftXs.wallets.length,
    `形状二：在场持有 1 → 三要件之二不成立（小四反锚——高位二次进场 famous 在场=臂前提破，实际 holdingN ${ftXs.holdingN}）`);
  ok(ftXs.fastFlipArmReady === false,
    `形状二：fastFlipArmReady false（在场>0 破组合，实际 ${ftXs.fastFlipArmReady}）`);

  // 形状三（慢走不算速倒）：K3 t+5 买 → t+200 才卖（持 195s>60）→ fastFlip false
  const rowsSlow = rowsArm.concat([
    row(5, 'BUY', W_K3, 0.25, 1.05 * E9, 2.4e8),
    row(200, 'SELL', W_K3, 0.25, 0.85 * E9, 2.9e8),
  ]);
  const ftSlow = buildBuyPointSnapshot(rowsSlow, meta63, { famousRoster: roster63 }).buyDerived.famousTraces;
  const k3 = ftSlow.wallets.find((e) => e.w === W_K3);
  ok(k3.holdSec === 195 && k3.fastFlip === false,
    `形状三：K3 慢走（持 195s>60 不算速倒——有人慢走没走光的不是本形状，实际 ${JSON.stringify(k3)}）`);
  ok(ftSlow.fastFlipArmReady === false,
    `形状三：fastFlipArmReady false（K1 速倒但 K3 慢走 → 非全员速倒破组合，实际 ${ftSlow.fastFlipArmReady}）`);

  // 形状四（首买 outlier 价 → entryVs null fail-closed）：K4 首买行天价 outlier → 不冒充入场价
  const rowsOut = rowsArm.concat([
    row(3, 'BUY', W_K4, 0.25, 99 * E9, 2.5e5, { outlier: true }),
    row(9, 'SELL', W_K4, 0.25, 1.2 * E9, 2.1e8),
  ]);
  const ftOut = buildBuyPointSnapshot(rowsOut, meta63, { famousRoster: roster63 }).buyDerived.famousTraces;
  const k4 = ftOut.wallets.find((e) => e.w === W_K4);
  ok(k4.entryVsLaunchPct === null && k4.holdSec === 6 && k4.fastFlip === true && ftOut.lowEntryN === 1,
    `形状四：K4 outlier 首买价 entryVs null（宁漏不冒充不进低位计数；holdSec 6/fastFlip 照判，实际 ${JSON.stringify(k4)}）`);

  // 形状五（二修·高开票常量锚反证——2026-11-12 182 探针实证）：fourmeme 票首可靠价
  // 5.85e-9（高开 +30.1% over 常量 4.496e-9——六票首 tick 全部高开 +12~41% 的研究票池形状）
  // → famous 锚=票自身首可靠价（研究口径 launch=首 tick 价）而非常量；K5 贴首价买
  // → entryVs 0.0%（首版常量优先会伪算 +30.1% → 全员 lowEntryN=0 臂失明）
  const W_K5 = '0x' + 'k5'.repeat(20).slice(0, 40);
  const roster65 = new Set([W_K1, W_K5]);
  const rowsHigh = [
    row(0, 'BUY', W_B, 0.20, 5.85 * E9, 3.4e7),               // 首可靠价 5.85e-9（高开 30.1%）
    row(2, 'BUY', W_K5, 0.30, 5.85 * E9, 5.1e7),               // K5 贴首价买（研究低价）
    row(10, 'SELL', W_K5, 0.31, 6.5 * E9, 4.8e7),              // 速倒清仓（持 8s）
  ];
  const metaHigh = { ...meta63, platform: 'fourmeme' };
  const ftHigh = buildBuyPointSnapshot(rowsHigh, metaHigh, { famousRoster: roster65 }).buyDerived.famousTraces;
  const k5 = ftHigh.wallets.find((e) => e.w === W_K5);
  ok(k5.entryVsLaunchPct === 0.0 && k5.fastFlip === true && ftHigh.lowEntryN === 1,
    `形状五：高开票 famous 锚=票自身首可靠价（K5 贴首价 entryVs 0.0 非常量伪算 +30.1；lowEntryN 1，实际 ${JSON.stringify(k5)}/${ftHigh.lowEntryN}）`);
  ok(ftHigh.fastFlipArmReady === true,
    `形状五：fastFlipArmReady true（三要件全真高开票形状，实际 ${ftHigh.fastFlipArmReady}）`);

  // 形状六（fallback·窗口未覆盖出生段）：首行 dt=300 > BP_LAUNCH_COVER_TOL=90 →
  // launchCovered=false → famous 锚=平台常量（4.496173469e-9）；K6@4.9458e-9（=1.1×常量）
  // → entryVs +10.0（fallback 方向=高估 entryVs → 宁漏不误伤）
  const W_K6 = '0x' + 'k6'.repeat(20).slice(0, 40);
  const roster66 = new Set([W_K6]);
  const rowsLate = [
    row(300, 'BUY', W_B, 0.20, 4.6 * E9, 4.3e7),
    row(302, 'BUY', W_K6, 0.30, 4.9458e-9, 6.1e7),             // 1.1×fourmeme 常量
    row(310, 'SELL', W_K6, 0.31, 5.0 * E9, 6.2e7),
  ];
  const ftLate = buildBuyPointSnapshot(rowsLate, metaHigh, { famousRoster: roster66 }).buyDerived.famousTraces;
  const k6 = ftLate.wallets[0];
  ok(k6.entryVsLaunchPct === 10.0,
    `形状六：窗口未覆盖出生段 fallback=平台常量（entryVs +10.0 vs 常量非 vs 窗内首价 −4.5，实际 ${JSON.stringify(k6)}）`);
}

// ═══════════════ A10. cheatBurst 透传（BP67——cheat 门 burst 判定输入桶） ═══════════════
console.log('A10. cheatBurst 透传（cheat 门 sbw 引擎组装 [ANCHOR] 渲染——在场/缺席两分支）');
{
  const cbPayload = {
    source: 'cheat', sbw: 1,
    maxGapSec: 58, waveBuyBnb: 0.77, waveWallets: 11, exitVsLaunchPct: 2.9,
  };
  // snapshot 整包透传（options.cheatBurst 原样挂出——引擎侧 _cheatBurstForBp 产物）
  const snapCb = buildBuyPointSnapshot(rowsA, metaA, { cheatBurst: cbPayload });
  ok(snapCb.cheatBurst && snapCb.cheatBurst.sbw === 1 && snapCb.cheatBurst.maxGapSec === 58
    && snapCb.cheatBurst.waveBuyBnb === 0.77 && snapCb.cheatBurst.waveWallets === 11
    && snapCb.cheatBurst.exitVsLaunchPct === 2.9,
    'A10: snapshot.cheatBurst 原样透传（波三键+exitVs 数值锚——cheat 门 anchors 段产物）');
  // state 渲染 [ANCHOR] burst 判定行
  const stCb = buildBuyPointState(snapCb).state;
  ok(stCb.includes('作弊盘检测 burst 判定') && stCb.includes('长期沉积后一朝放量操盘')
    && stCb.includes('activity_level 选 burst') && stCb.includes('本题不重复判定'),
    'A10: state [ANCHOR] burst 判定行（「作弊盘检测 burst 判定」+沉积前提语义+选 burst 指令+不重复判定声明——BP67 立法核心句）');
  ok(stCb.includes('58s') && stCb.includes('0.77') && stCb.includes('11 钱包'),
    'A10: state burst 行波锚数值（maxGapSec 58/waveBuyBnb 0.77/wallets 11——ba5e 07:52 案实值形状；exitVs 2.9 已随 D3.67 ④「仅参考不作否决」退出渲染）');
  // D3.67/CD397：新键在场时波族行补流向/跨度段（净额/卖回率/波末距锚点）；旧键回退兼容（?? 链）
  const cbPayload67 = {
    ...cbPayload,
    lastGapSec: 68, exitWaveBuyBnb: 2.04, exitWaveWallets: 55,
    waveWalletNetBnb: 1.83, waveSellBackPct: 10.3, secSinceWaveEnd: 9,
  };
  const stCb67 = buildBuyPointState(buildBuyPointSnapshot(rowsA, metaA, { cheatBurst: cbPayload67 })).state;
  ok(stCb67.includes('最后静默段 68s') && stCb67.includes('2.04 BNB / 55 钱包')
    && stCb67.includes('波钱包全窗净额 1.83 BNB（卖回 10.3%）') && stCb67.includes('波末距锚点 9s'),
    'A10: D3.67 波族事实透传（新键优先：lastGapSec/exitWave 两键+流向段净额/卖回+跨度段波末距锚点——act 题头「沉积期低活跃是前提」语境核对原料）');
  // 缺席分支：null/不传 → state 不渲染（fail 方向=cheat 无结果时 BP 照常七要素判档宁拦）
  const snapCbNull = buildBuyPointSnapshot(rowsA, metaA, { cheatBurst: null });
  const snapCbNoOpt = buildBuyPointSnapshot(rowsA, metaA);
  ok(snapCbNull.cheatBurst === null && snapCbNoOpt.cheatBurst === null
    && !buildBuyPointState(snapCbNull).state.includes('作弊盘检测 burst 判定')
    && !buildBuyPointState(snapCbNoOpt).state.includes('作弊盘检测 burst 判定'),
    'A10: cheatBurst null/缺席 → snapshot null + state 不渲染（行缺席=act 照常判档不冒充 burst——宁拦方向）');
}

// ═══════════════ A11. BP77 塞单簇（exactEqualBlock）+恶意砸块族（dumpBlock/dump2Block）手算 ═══════════════
console.log('A11. BP77 塞单簇+恶意砸块族手算（四件方案立法①③）');
{
  // 存量夹具 A 反证：无等额簇/无砸块 → 零值/null（有证据零值 vs 缺证据 null 两态口径）
  ok(dA.exactEqualBlockMaxWallets === 0 && Array.isArray(dA.exactEqualBlockClusters) && dA.exactEqualBlockClusters.length === 0
    && dA.dumpBlock === null && dA.dump2Block === null,
    'A11: 存量夹具 A 零簇零砸块（无等额同块买入=0 有证据零值；无合格砸块=null 缺证据——两态口径反证）');

  // 塞单簇夹具：7000=8 钱包×0.25 等额簇（≥8 塞单门线）；7001=3 钱包×0.5；7002 尘门下；
  // 7003 同钱包两笔去重；7004 router 聚合两笔（多散户同块同档天然不成簇）
  const rowsStuff = [
    row(100, 'BUY', W_B, 0.25, 1.0 * E9, 2.5e8, { block: 7000, li: 0 }),
    row(100, 'BUY', W_C, 0.25, 1.0 * E9, 2.5e8, { block: 7000, li: 1 }),
    row(100, 'BUY', W_D, 0.25, 1.0 * E9, 2.5e8, { block: 7000, li: 2 }),
    row(100, 'BUY', W_E, 0.25, 1.0 * E9, 2.5e8, { block: 7000, li: 3 }),
    row(100, 'BUY', W_F, 0.25, 1.0 * E9, 2.5e8, { block: 7000, li: 4 }),
    row(100, 'BUY', W_G, 0.25, 1.0 * E9, 2.5e8, { block: 7000, li: 5 }),
    row(100, 'BUY', W_H, 0.25, 1.0 * E9, 2.5e8, { block: 7000, li: 6 }),
    row(100, 'BUY', CREATOR, 0.25, 1.0 * E9, 2.5e8, { block: 7000, li: 7 }),
    row(105, 'BUY', W_B, 0.5, 1.0 * E9, 5e8, { block: 7001, li: 0 }),
    row(105, 'BUY', W_C, 0.5, 1.0 * E9, 5e8, { block: 7001, li: 1 }),
    row(105, 'BUY', W_D, 0.5, 1.0 * E9, 5e8, { block: 7001, li: 2 }),
    row(110, 'BUY', W_E, 0.0005, 1.0 * E9, 5e5, { block: 7002, li: 0 }),
    row(110, 'BUY', W_F, 0.0005, 1.0 * E9, 5e5, { block: 7002, li: 1 }),
    row(115, 'BUY', W_G, 0.3, 1.0 * E9, 3e8, { block: 7003, li: 0 }),
    row(115, 'BUY', W_G, 0.3, 1.0 * E9, 3e8, { block: 7003, li: 1 }),
    row(120, 'BUY', ROUTER, 0.2, 1.0 * E9, 2e8, { block: 7004, li: 0, sender: null }),
    row(120, 'BUY', ROUTER, 0.2, 1.0 * E9, 2e8, { block: 7004, li: 1, sender: null }),
    row(130, 'BUY', W_H, 0.1, 1.0 * E9, 1e8, { block: 7005 }),
  ];
  const dS77 = buildBuyPointSnapshot(rowsStuff, metaA).buyDerived;
  ok(dS77.exactEqualBlockMaxWallets === 8,
    `A11: 塞单簇 maxWallets=8（block 7000 八钱包 ×0.25 同块等额——实际 ${dS77.exactEqualBlockMaxWallets}）`);
  const cl77 = dS77.exactEqualBlockClusters;
  ok(Array.isArray(cl77) && cl77.length === 2 && cl77[0].block === 7000 && cl77[0].amt === 0.25
    && cl77[0].wallets === 8 && cl77[0].n === 8 && near(cl77[0].sumBnb, 2.0) && cl77[0].firstDt === 100
    && cl77[1].block === 7001 && cl77[1].wallets === 3 && near(cl77[1].sumBnb, 1.5),
    'A11: clusters 按 sumBnb 降序 top3（7000 簇 2.0 在前/7001 簇 1.5 次之；尘门 0.0005 不入桶、同钱包去重 1<2、router 聚合行 wallet 同址去重不成簇——三反证）');
  ok(dS77.dumpBlock === null && dS77.dump2Block === null, 'A11: 纯买夹具零砸块（无 SELL 行 → 无候选）');

  // 砸块夹具：4001 块内 1.0→0.89=-11% 卖 0.5（dump1）；4002 单行块只进相邻对；
  // 4001+4002 合并卖 1.0、1.0→0.8=-20%（dump2）；承接窗 (endDt, endDt+60]
  const rowsDump = [
    row(10, 'BUY', W_B, 0.3, 1.0 * E9, 3e8, { block: 4000 }),
    row(20, 'BUY', CREATOR, 0.1, 1.0 * E9, 1e8, { block: 4001, li: 0 }),
    row(21, 'SELL', W_C, 0.5, 0.89 * E9, 5.6e8, { block: 4001, li: 1 }),
    row(30, 'SELL', W_D, 0.5, 0.8 * E9, 6.25e8, { block: 4002 }),
    row(40, 'BUY', W_E, 0.3, 0.81 * E9, 3.7e8, { block: 4003 }),
    row(55, 'BUY', W_F, 0.2, 0.805 * E9, 2.5e8, { block: 4004 }),
    row(60, 'BUY', W_G, 0.1, 0.8 * E9, 1.25e8, { block: 4005 }),
  ];
  const dD77 = buildBuyPointSnapshot(rowsDump, metaA).buyDerived;
  const db1 = dD77.dumpBlock, db2 = dD77.dump2Block;
  ok(db1 && db1.block === 4001 && db1.block2 === null && near(db1.sellBnb, 0.5) && db1.dropPct === -11
    && db1.sellers === 1 && db1.topSellerPct === 100 && db1.dt === 20 && db1.endDt === 21
    && near(db1.followBuyRatio, 1.2),
    `A11: dumpBlock 手算（4001 块内 1.0→0.89=-11% 卖 0.5 单卖方 top 100%；承接 (21,81] 买 0.3+0.2+0.1=0.6÷0.5=1.2——实际 ${db1 && JSON.stringify(db1)}）`);
  ok(db2 && db2.block === 4001 && db2.block2 === 4002 && near(db2.sellBnb, 1.0) && db2.dropPct === -20
    && db2.sellers === 2 && db2.topSellerPct === 50 && db2.endDt === 30 && near(db2.followBuyRatio, 0.6),
    `A11: dump2Block 相邻对手算（4001+4002 合并卖 1.0、首块首价 1.0→末块末价 0.8=-20、卖方并集 2、top 50%；承接 (30,90] 买 0.6÷1.0=0.6；单行块 4002 块内零跌幅只进相邻对——实际 ${db2 && JSON.stringify(db2)}）`);
  // BP82 贴锚臂两新键：距锚秒数=锚末 tick−砸块末行；砸后已见买入=(endDt, endDt+60] 承接窗部分和
  // （观察窗不足时照出——贴锚砸盘形状的承接证据载体，与 followBuyRatio 同窗同分子）
  ok(db1 && db1.secToAnchor === 39 && near(db1.followBuyBnb, 0.6)
    && db2 && db2.secToAnchor === 30 && near(db2.followBuyBnb, 0.6),
    `A11: BP82 砸块两新键（db1 距锚 60−21=39s/已见买入 (21,81] 0.6；db2 距锚 60−30=30s/已见买入 (30,90] 0.6——与 followBuyRatio 同窗同分子，实际 db1=${db1 && JSON.stringify({ s: db1.secToAnchor, b: db1.followBuyBnb })} db2=${db2 && JSON.stringify({ s: db2.secToAnchor, b: db2.followBuyBnb })}）`);
  ok(dS77.exactEqualBlockMaxWallets === 8 && dD77.exactEqualBlockMaxWallets === 0,
    'A11: 两族算法独立（砸块夹具无等额簇=0；塞单夹具照上）');

  // 承接观察窗不足：tEnd−endDt <10s → followBuyRatio null 不冒充
  const rowsDumpNear = [
    row(10, 'BUY', W_B, 0.1, 1.0 * E9, 1e8, { block: 5000 }),
    row(15, 'BUY', W_C, 0.1, 1.0 * E9, 1e8, { block: 5001, li: 0 }),
    row(15, 'SELL', W_D, 0.5, 0.85 * E9, 5.9e8, { block: 5001, li: 1 }),
    row(20, 'BUY', W_E, 0.05, 0.85 * E9, 6e7, { block: 5002 }),
  ];
  const dN77 = buildBuyPointSnapshot(rowsDumpNear, metaA).buyDerived;
  ok(dN77.dumpBlock && dN77.dumpBlock.block === 5001 && dN77.dumpBlock.dropPct === -15
    && dN77.dumpBlock.followBuyRatio === null,
    'A11: 承接观察窗不足 → followBuyRatio null（tEnd 20−endDt 15=5s<10s 下限——砸块事实照出、承接腿缺证据不冒充）');
  // BP82 贴锚砸盘臂核心形状：距锚 <10s 承接比恒 null，但已见买入部分和照出（0.05 对砸卖 0.5=10%<30%
  // 参考线——砸完立刻把价格按到买点尚无人接，题面贴锚臂第四腿据此立）；
  // ratio≠null 时分子=followBuyBnb 同源锁（部分和恒 ≤ 完整窗和，ratio=followBuyBnb/sellBnb）
  ok(dN77.dumpBlock && dN77.dumpBlock.secToAnchor === 5 && near(dN77.dumpBlock.followBuyBnb, 0.05),
    `A11: BP82 贴锚形状两新键照出（距锚 20−15=5s<10s ratio 恒 null 但已见买入 (15,75]=0.05 部分和在场——null≠无承接证据，实际 ${dN77.dumpBlock && JSON.stringify({ s: dN77.dumpBlock.secToAnchor, b: dN77.dumpBlock.followBuyBnb })}）`);
  ok(db1 && near(db1.followBuyBnb, db1.followBuyRatio * db1.sellBnb),
    'A11: BP82 ratio 分子=followBuyBnb 同源锁（ratio=followBuyBnb÷sellBnb——观察窗充足时部分和=窗内全额）');

  // 砸块跌幅=价格影响事实口径含 outlier（与价格族可靠价口径刻意不同向）
  const rowsDumpOut = [
    row(10, 'BUY', W_B, 0.1, 1.0 * E9, 1e8, { block: 6000 }),
    row(50, 'BUY', W_C, 0.1, 1.0 * E9, 1e8, { block: 6001, li: 0 }),
    row(50, 'SELL', W_D, 0.5, 0.6 * E9, 8.3e8, { block: 6001, li: 1, outlier: true }),
    row(80, 'BUY', W_E, 0.05, 0.99 * E9, 5e7, { block: 6002 }),
  ];
  const dO77 = buildBuyPointSnapshot(rowsDumpOut, metaA).buyDerived;
  ok(dO77.dumpBlock && near(dO77.dumpBlock.sellBnb, 0.5) && dO77.dumpBlock.dropPct === -40,
    `A11: 砸块跌幅含 outlier（块末 outlier 价 0.6 计入 lastPx → -40%——价格影响事实口径；实际 ${dO77.dumpBlock && dO77.dumpBlock.dropPct}）`);

  // state 三渲染行
  const st77 = buildBuyPointState(buildBuyPointSnapshot(rowsDump, metaA)).state;
  ok(st77.includes('恶意砸块(单block)') && st77.includes('恶意砸块(相邻两block)'),
    'A11: state 渲染砸块两行（单 block/相邻两 block——Jev 四腿判读原料）');
  ok(st77.includes('距锚 39 秒') && st77.includes('距锚 30 秒') && st77.includes('砸后已见买入') && st77.includes('贴锚砸盘臂判读'),
    'A11: BP82 state 渲染直供（距锚秒数+砸后已见买入+贴锚臂判读指引——判据与直供同构，Jev 按已见买入 vs 砸卖额判第四腿）');
  const st77s = buildBuyPointState(buildBuyPointSnapshot(rowsStuff, metaA)).state;
  ok(st77s.includes('同块等额买单(锚窗)') && st77s.includes('8'),
    'A11: state 渲染塞单簇行（eqMax ≥2 才渲染——8 钱包 ×0.25 簇在场）');
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
ok(dC0.bundledBlock === null, 'C: 无 BUY 行 → bundledBlock null（缺证据不冒充，BP73）');

// BP73 bundledBlock 剔伪钱包+多钱包捆绑块胜出：块 500=ROUTER 两笔未解析行
// （wallet=ROUTER 剔）0.2+0.15+正常 W_B 0.05 → 计后仅 0.05；块 501=W_C 单笔 0.1；
// 块 502=W_F 0.18+W_G 0.16 两钱包捆绑 0.34 → 最大块=502（router 散单堆凑不出
// 同块合计+真捆绑块按合计胜出——「只认组织性买入」的口径实现）
{
  const rowsRt = [
    row(10, 'BUY', ROUTER, 0.2, 1.0 * E9, 2e8, { block: 500, trader: ROUTER }),
    row(10, 'BUY', ROUTER, 0.15, 1.0 * E9, 1.5e8, { block: 500, trader: ROUTER, li: 1 }),
    row(10, 'BUY', W_B, 0.05, 1.0 * E9, 5e7, { block: 500, li: 2 }),
    row(20, 'BUY', W_C, 0.1, 1.05 * E9, 1e8, { block: 501 }),
    row(30, 'BUY', W_F, 0.18, 1.1 * E9, 1.6e8, { block: 502 }),
    row(30, 'BUY', W_G, 0.16, 1.1 * E9, 1.5e8, { block: 502, li: 1 }),
  ];
  // row() 缺省 sender=wallet=ROUTER → 未解析伪钱包行（isRouterWallet 剔）
  const dRt = buildBuyPointSnapshot(rowsRt, metaA).buyDerived;
  ok(dRt.bundledBlock && dRt.bundledBlock.block === 502 && dRt.bundledBlock.n === 2
    && near(dRt.bundledBlock.buyBnb, 0.34) && dRt.bundledBlock.wallets === 2 && dRt.bundledBlock.dt === 30,
    `BP73 bundledBlock 剔 router 伪钱包+多钱包捆绑块胜出（块500 计后仅 0.05、块501 单笔 0.1 < 块502 捆绑 0.34×2 钱包，实际 ${JSON.stringify(dRt.bundledBlock)}）`);
}
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
  ok(keysAct === 'buyMedianBnb,idlePct,maxDrawdownPct,nearPre20BnbPerMin,nearSegBnbPerMin,nearSegBuyMedianBnb,nearSegBuyN,nearSegMaxGapSec,nearSegSellN,nearSegTickN,nearSegTicksPerMin,nearTail10BnbPerMin,nearTail10BuyBnb,nearTail10BuyN,nearTail10SellBnb,nearTail10SellWallets,nearTail10TickN,nearTail5BuyBnb,nearTail5BuyN,nearTail5BuySharePct,nearTail5TickN,spanSec,throughputBnbPerMin,tickCount', `C: activity 恰 24 键（BP41 尾段占比锚 16→17+CD394 尾窗四键 17→21+BP72 尾 10s 买卖分解三键 21→24：nearTail10BuyN/BuyBnb/SellBnb 臂 A 本地买方在场性主锚（BP 侧自算非 cheat 层），实际 ${keysAct}）`);
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
// BP55/v100-R2 案：0.2 级大户判据单笔口径——W_G 两笔 0.1+0.12 累计 0.22 形式上过
// 0.2 级，单笔最大 0.12=灰区单不算大户（用户裁定「买入仓位不累计」）
{
  const wg = snapD.wallets.find((e) => e.w === W_G);
  ok(wg && near(wg.buyBnb, 0.22) && wg.maxBuyBnb === 0.12,
    `D: [WALLETS] maxBuyBnb 单笔口径键（W_G 累计 0.22 vs 单笔最大 0.12 分离——BP55 判读读单笔不读累计，实际 ${wg && wg.buyBnb}/${wg && wg.maxBuyBnb}）`);
  ok(stD.state.includes('买 0.220×2(最大单笔0.120)'), 'D: [WALLETS] 行渲染「(最大单笔X)」直供判读（BP55——判据与 state 直供同构铁律；fmtBnb 三位小数）');
  const wb = snapD.wallets.find((e) => e.w === W_B);
  ok(wb && near(wb.buyBnb, 1.8) && wb.maxBuyBnb === 1.0, 'D: W_B 累计 1.8 / 单笔最大 1.0（多笔钱包 maxBuyBnb=单笔最大非累计）');
  // BP55 二层直供（a8e70 对拍三连不翻②教训——判据与 state 直供同构铁律：题面单笔化之外，
  // Jev 从行内自算「单笔 0.2 级钱包数」判序失灵（BP43/BP53 同族），组好计数直供一行）
  ok(stD.state.includes('大户参与判读（0.2 级按单笔计不累计/BP55；在场三分/BP79）: 单笔 ≥0.19 的钱包 5 个') && stD.state.includes('单笔 0.3+ 的钱包 4 个（其中活跃在场 1 个）')
    && stD.state.includes('活跃在场（净 >0 且末动距今 ≤120s）的单笔 0.2 级钱包 2 个'),
    'D: 大户参与判读直供行计数（rowsA=单笔 ≥0.19 五个 W_B/W_F/CREATOR/W_C/W_D、0.3+ 四个其中活跃在场 1（W_F）；活跃 0.2 级 2 个（W_F 末动 105s/W_C 末动 0s）——BP79 在场三分后判序材料组好直供）');
  ok(stD.state.includes('灰区单不计入') && stD.state.includes('单笔最大 0.120（累计 0.220×2、已卖 0.0000≈0% 净 0.220'),
    'D: 直供行灰区单 fmtEntry（W_G 累计 0.220×2 单笔 0.120=灰区单不计入教学现场——BP55 核心形状随行直供）');
  ok(stD.state.includes('判序线=活跃在场 ≥2 个（或单笔 0.3+ 活跃在场）才算大户参与') && stD.state.includes('不满足=无大户参与直接落②散户 PVP，盘面活跃度不救'),
    'D: 直供行判序线句（活跃在场 ≥2（BP79 三分后口径——W_B 末动 150s/CREATOR 135s 挂账不算、W_D 清仓离场不算）、不满足直接落②活跃度不救——BP26 判序前置语义随直供行重申）');
}
ok(stD.state.includes('近窗动量') && stD.state.includes('节奏趋势') && stD.state.includes('卖压') && stD.state.includes('参与结构') && stD.state.includes('时点位置'), 'D: PRECOMPUTED 七族行');
ok(stD.state.includes('同块捆绑买入(锚窗单block买入合计最大块): 块 1020 / 买 1.000 BNB × 1 笔 / 1 钱包') && stD.state.includes('同一 block 内多钱包同时买入=链上同时性的组织性买入证据'),
  'D: BP73 同块捆绑买入行渲染（块/买额/笔数/钱包数直供+组织性买入判读句——判据与 state 直供同构铁律，Jev 不从 tick 列表自算块聚合）');
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
ok(stD.state.includes('回看速度(5秒段): 全窗最大涨幅 ? / 最大跌幅 -2.50%；临近段(锚前120s)最大涨幅 ? / 最大跌幅 -2.50%') && stD.state.includes('点位性质判读原料——临近段单段跌 ≥15%=急跌砸盘进行时（crash 判轴=无回调+无换手对倒、速度不设限——见题面）、单段涨 ≥15%=尖刺拉升'),
  'D: 回看速度行四键渲染（BP58 maxDn5/nearMaxUp5/nearMaxDn5 三新键——A fixture 同块段 2.0→1.95=-2.50%、无涨段 ?；判读教学句急跌砸盘（BP72 措辞修正：判轴=无回调+无换手对倒）/尖刺拉升）');
ok(!stD.state.includes('摆动结构') && !stD.state.includes('圣诞树原料'),
  'D: 摆动结构行已删（BP30/题集 BP33 tree_position 退役——state 不再渲染圣诞树原料行，zigzag 锚照算落 digest 纯留档）');
ok(stD.state.includes('判定结构') && stD.state.includes('①盘型门（预判断，最前）——异常盘面识别') && stD.state.includes('早鸟/回调两道质量题与 tree_position、追高、famous 控盘、相对价格、市场热度维度题均已退役'),
  'D: 判定指引纯门链结构+质量题/tree/追高/热度退役声明（BP48 两质量题退役+BP30 盘型前置预判断+BP49 famous 控盘/相对价格两维度题退役+BP60 market_heat 退役）');
ok(stD.state.includes('②点位性质门（BP58 新题 entry_shape）') && stD.state.includes('好点位=活跃交易中对倒中的低价/正常下跌造成的低价')
  && stD.state.includes('无回调、无换手对倒砸盘（crash——庄离场：较锚窗高点回撤 ≥25%/30s 跌 ≥25%/临近段 5s 单段跌 ≥15%/现价贴锚窗最低 ≤2pp 任一提示进形态复核，判轴=无回调+无换手对倒、速度不设限急砸缓砸都是；有回调节奏或有买方换手承接的放 normal_dip）')
  && stD.state.includes('尖刺拉盘（spike——30s 涨 ≥20%/临近段 5s 单段涨 ≥15%/现价贴锚窗高点 ≥-5% 任一臂）判型如实落档、不拦买入')
  && stD.state.includes('正常回调低价（normal_dip——有下跌但有回调节奏/有换手承接，对倒/正常下跌造成的低价=目标买入形状）')
  && stD.state.includes('BP68 用户裁定：统一位置门已控价'),
  'D: 判定指引②点位性质门四桶判读句（BP58 新题+BP72 措辞修正——crash 判轴=无回调+无换手对倒速度不设限/spike 三臂判读线+normal_dip 目标形状声明；BP68 spike 判型落档不拦）');
ok(stD.state.includes('③活跃度门') && stD.state.includes('activity_level=ultra（机器盘级极端密集') && stD.state.includes('无条件拦'),
  'D: 判定指引③活跃度门 ultra 臂无条件拦声明（BP30 改三「act 为 ultra 也不玩」+BP58 豁免臂随桶改制删除）');
ok(stD.state.includes('④筹码门') && stD.state.includes('持仓集中（holder_concentration）strong') && stD.state.includes('代码侧停用中不激活'),
  'D: 判定指引④筹码门 holder 单臂停用声明（BP54 CHIP_GATE_ENABLED=false 答案照答落档观察材料保留）');
ok(stD.state.includes('先买后卖一波流（one_wave_dump') && stD.state.includes('开盘段一波买入拉起后**再无第二波买入**') && !stD.state.includes('持续拉升弱回调（sustained_climb）走独立位置门'),
  'D: 判定指引①盘型门⑨一波流硬拒桶+⑥位置臂绝迹声明（BP59——⑥sustained_climb 退役归 none 走统一位置门、⑨one_wave_dump 新增进硬拒桶）');
ok(stD.state.includes('none 正常盘面统一位置门 ≤+28.5%') && stD.state.includes('已拉离（>+28.5%）=不参与（只买性价比高的点位，不追高）'),
  'D: 判定指引 none 统一位置门 28.5 声明（BP58 立线 27.5；BP69 2026-11-10 微放宽「只稍微宽一点，再继续观察」）');
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
const dE = { ...dA, currentVsLaunchPct: 20 }; // obsE 专用锚：none 走统一位置门 28.5（BP69）——20 ≤28.5 过门（dA 原 +60 被统一门拒）
const obsE = buildBuyPointObservation(fullAnswers(), dE);
ok(Object.keys(obsE.dimensions).length === 6 && obsE.dimensions.price_trend.bucket === 'fast_up' && obsE.dimensions.activity_level.bucket === 'mid' && obsE.dimensions.entry_shape.bucket === 'normal_dip' && obsE.dimensions.market_pattern.bucket === 'none', 'E: 六维度 argmax 透传（BP30 删 tree_position；BP48 无质量题；BP49 删 famous_domination/entry_position；BP58 增 entry_shape；BP60 删 market_heat——market_heat 答案在场也不进 dimensions 键集）');
ok(!('tree_position' in obsE.dimensions) && !('qualities' in obsE), 'E: tree_position/qualities 键绝迹（BP30/BP48 退役反证）');
ok(!('point_category' in obsE.dimensions) && JSON.stringify(obsE).indexOf('point_category') === -1 && JSON.stringify(obsE).indexOf('buy_point_assessment') === -1, 'E: point_category/buy_point_assessment 键绝迹（BP6 形态反证）');
ok(obsE.assessment.bucket === 'neutral' && obsE.assessment.prob === null && obsE.assessment.rule === 'gates_passed', 'E: 纯门链全过 → neutral/gates_passed（prob=null——BP48 无质量层）');
ok(obsE.anchors.bundledBlockBnb === 1 && obsE.anchors.bundledBlockWallets === 1 && obsE.anchors.bundledBlockN === 1 && obsE.anchors.bundledBlockDt === 20,
  `E: BP73 同块捆绑锚四键透传（A fixture 最大块=W_B 单笔 1.0/dt20——digest 落档与审计读数；实际 ${obsE.anchors.bundledBlockBnb}/${obsE.anchors.bundledBlockWallets}/${obsE.anchors.bundledBlockN}/${obsE.anchors.bundledBlockDt}）`);
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
// BP67 burst 档（cheat 门 burst 判定输入桶——不在拦域自然放行；ba5e 07:52 案 act low 拒矛盾修复）
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('activity_level', 'burst', 0.9) }, dE).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: BP67 act=burst → 放行 gates_passed（burst 不在 ACTIVITY_GATE_POOR_BUCKETS——沉积期低活跃度是 burst 前提而非拒买证据，cheat 侧已豁免放行两模块叙事一致化）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('activity_level', 'burst', 0.9), ...mkAns('early_bird_quality', 'good', 0.95) }, dE).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: BP67 act=burst+旧档质量题答案在场照放行（质量题 BP48 退役答案不被消费——burst 档无任何拦截路径）');
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
    'E: BP60 none+holder=strong+curVs≤28.5 → neutral/gates_passed 无 exempt（restart_chip 豁免臂已绝迹——exempt 键全绝迹）');
  aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.57), ...mkAns('holder_concentration', 'strong', 0.91) }, { ...dE, currentVsLaunchPct: 50 }).assessment;
  ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: none 已拉离（curVs=50>28.5）→ 统一位置门拒（正常盘面唯一放行通道）');
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
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: BP60 狙击衰竭形状归 none 放行（④桶随四桶化删除——curVs=20≤28.5 过统一门；heat=mid 答案不被消费）');
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
// BP58 桶改制+BP60 四桶化：④桶判型删除归 none（走统一位置门，BP69 起 28.5）——BP46/BP47
// （④高热近价豁免：heat=high∧openShare<80∧curVs≤40 放行+同盖 act ultra 臂）与
// BP53/BP56（④ultra router 散户入口豁免 routerBuyPct60≥30+价格腿 curVs≤40）三臂
// 随宿主④桶退役整链删除；heat/openShare/router 不再进 mapper 门，判读全归题面；
// ultra 臂恢复无条件拦（BP38 同删）；放行唯一通道=统一门（BP69 起 28.5）
{
  const ans58 = (heat, act) => ({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.86), ...mkAns('market_heat', heat, 0.98), ...mkAns('activity_level', act, 0.73) });
  // 苍蝇 06/09 形状（④+heat ultra+curVs 26.8+act ultra）BP58 后由 act 门拦（不再走
  // ④ pattern_gate 豁免/拒拔河——④归 none 26.8≤28.5 过统一门，act=ultra 无条件拦）
  const oCy = buildBuyPointObservation(ans58('ultra', 'ultra'), { ...dE, currentVsLaunchPct: 26.8 });
  ok(oCy.assessment.bucket === 'poor' && oCy.assessment.rule === 'activity_gate' && !oCy.assessment.exempt,
    'E: BP58 苍蝇形状（④形状归 none+curVs 26.8≤28.5+act ultra）→ activity_gate 拒（④桶归 none 过统一门、ultra 无条件拦——BP47/BP53 豁免臂删除后不再有放行通道）');
  const oH = buildBuyPointObservation(ans58('high', 'high'), dE);
  ok(oH.assessment.bucket === 'neutral' && oH.assessment.rule === 'gates_passed' && !oH.assessment.exempt,
    'E: BP58 ④形状归 none+heat=high+curVs≤28.5 → 统一门放行 neutral 无 exempt（BP47 高热近价豁免臂删除——heat/openShare 不再进 mapper 门，判读归题面）');
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
  const oOut = buildBuyPointObservation(ans58('high', 'high'), { ...dE, currentVsLaunchPct: 28.6 });
  ok(oOut.assessment.bucket === 'poor' && oOut.assessment.rule === 'pattern_gate',
    'E: BP58 none curVs 28.6>28.5 → 统一门拒（BP46 时代 ≤40 豁免域整体收回——BEM +56.4/FIGHT +76.1 类价格腿由本门守；BP69 起 27.5→28.5）');
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
// （无回调无换手对倒砸盘——BP72 措辞修正「无回调，无换手对倒砸盘」：判轴=双缺位、速度不设限）」；bt-v94 七票复盘四分类：砸盘三票 LOVE/STOCKLESS/币安之心+尖刺
// YiYi=拒、对倒两票 米/施工鸭=目标形状、苍蝇=act 门已闭环）：crash →
// poor/entry_gate；normal_dip/flat 放行（BP68 起 spike 判型保留但不拦——
// 统一位置门已控价（BP69 起 28.5），控价域内 spike 判定不正常，判例 ea78）；门序=盘型门后、活跃度门前
{
  const es = (shape, p) => ({ ...fullAnswers(), ...mkAns('entry_shape', shape, p) });
  const oCrash = buildBuyPointObservation(es('crash', 0.92), dE);
  ok(oCrash.assessment.bucket === 'poor' && near(oCrash.assessment.prob, 0.92) && oCrash.assessment.rule === 'entry_gate',
    'E: BP58 entry_gate crash 无回调无换手砸盘 → poor/entry_gate（庄离场不参与——LOVE curVsAth -37.0/chg30 -29.3 形状；BP72 措辞修正判轴=无回调+无换手对倒）');
  const oSpike = buildBuyPointObservation(es('spike', 0.77), dE);
  ok(oSpike.assessment.bucket === 'neutral' && oSpike.assessment.rule === 'gates_passed' && oSpike.assessment.prob == null,
    'E: BP68 spike 尖刺拉盘 → 判型落档不拦、综 neutral/gates_passed（用户裁定「我们已经控制了价格，所以 spike 没有必要再存在……或者保留也可以，但是不 block 买入」——统一位置门已控价（BP69 起 28.5），控价域内 spike 判定不正常；判例 ea78 两笔 0.136/0.16 正常额度买单贴顶臂 -5.13 恰过线误判 spike）');
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
  ok(oCrashOut.rule === 'pattern_gate', 'E: BP58 门序 统一位置门（盘型门）先拒已拉离（crash+curVs 50>28.5 双命中留痕 pattern_gate）');
  ok(JSON.stringify(buildBuyPointObservation({ ...es('crash'), ...mkAns('market_pattern', 'none', 0.6), ...mkAns('holder_concentration', 'strong', 0.9) }, dE)).includes('exempt') === false,
    'E: BP58 exempt 键绝迹于 crash 域（BP38/BP46/BP47/BP52/BP53 五豁免臂随桶改制删除；**BP78 恢复=malicious_dump 域专属 dump_total_volume 豁免**——crash 域仍零 exempt 指纹）');
  // BP77 恶意砸盘桶：malicious_dump → entry_gate 拒（与 crash 同 rule 双桶拦域）
  const oDump77 = buildBuyPointObservation(es('malicious_dump', 0.9), dE);
  ok(oDump77.assessment.bucket === 'poor' && near(oDump77.assessment.prob, 0.9) && oDump77.assessment.rule === 'entry_gate'
    && oDump77.dimensions.entry_shape.bucket === 'malicious_dump',
    'E: BP77 malicious_dump 桶 → poor/entry_gate（恶意砸盘单独落桶与 crash 同走点位门——判轴分离拦截同门）');
}
// ═══ BP77 塞单门（mapper 门链最前代码门）+砸块/塞单锚透传 ═══
{
  ok(require('../src/market-analysis/buy-point-result-mapper').STUFFING_MAX_EQ_WALLETS === 8, 'E: BP77 塞单门常量 STUFFING_MAX_EQ_WALLETS=8（≥8 拒买；7 值带在线外）');
  const stuff = (v) => buildBuyPointObservation(fullAnswers(), { ...dE, exactEqualBlockMaxWallets: v }).assessment;
  ok(stuff(8).bucket === 'poor' && stuff(8).rule === 'stuffing_gate' && stuff(8).prob === null,
    'E: BP77 塞单门 ≥8 → poor/stuffing_gate/prob null（代码门无 Jev 概率——门链最前先于盘型门）');
  ok(stuff(7).bucket === 'neutral' && stuff(7).rule === 'gates_passed',
    'E: BP77 塞单门 7=线外不拦（走正常门链——dE curVs +20 过统一门 neutral）');
  ok(stuff(0).rule === 'gates_passed' && stuff(null).rule === 'gates_passed',
    'E: BP77 塞单门 0/null 容缺不拦（无簇=有证据零值放行；锚缺席=null 放行——拒=有证据的拒绝）');
  ok(stuff('x').rule === 'gates_passed' && stuff(Infinity).rule === 'gates_passed',
    'E: BP77 塞单门非有限数 → null 不拦（typeof number ∧ finite 守卫）');
  // 塞单门先于盘型门：⑨硬拒桶+塞单 8 同命中 → stuffing_gate 留痕（门链最前）
  const stuffBoth = buildBuyPointObservation(
    { ...fullAnswers(), ...mkAns('market_pattern', 'one_wave_dump', 0.9) },
    { ...dE, exactEqualBlockMaxWallets: 12 }).assessment;
  ok(stuffBoth.rule === 'stuffing_gate' && stuffBoth.bucket === 'poor',
    'E: BP77 塞单门=门链最前（⑨硬拒桶+塞单 12 双命中 → stuffing_gate 留痕先于 pattern_gate）');
  // 砸块族扁平十键+塞单锚透传（BP82 起扩 14 键：followBuyBnb/secToAnchor 两键随行）
  const dDump77 = {
    ...dE,
    exactEqualBlockMaxWallets: 3,
    dumpBlock: { block: 4001, block2: null, sellBnb: 0.5, dropPct: -11, sellers: 1, topSellerPct: 100, dt: 20, endDt: 21, followBuyRatio: 1.2, followBuyBnb: 0.6, secToAnchor: 39 },
    dump2Block: { block: 4001, block2: 4002, sellBnb: 1.0, dropPct: -20, sellers: 2, topSellerPct: 50, dt: 20, endDt: 30, followBuyRatio: 0.6, followBuyBnb: 0.6, secToAnchor: 30 },
  };
  const an77 = buildBuyPointObservation(fullAnswers(), dDump77).anchors;
  ok(an77.exactEqualBlockMaxWallets === 3
    && an77.dumpBlockBnb === 0.5 && an77.dumpBlockDropPct === -11 && an77.dumpBlockSellers === 1
    && an77.dumpBlockTopSellerPct === 100 && an77.dumpBlockFollowBuyRatio === 1.2
    && an77.dump2BlockBnb === 1 && an77.dump2BlockDropPct === -20 && an77.dump2BlockSellers === 2
    && an77.dump2BlockTopSellerPct === 50 && an77.dump2BlockFollowBuyRatio === 0.6
    && an77.dumpBlockFollowBuyBnb === 0.6 && an77.dumpBlockSecToAnchor === 39
    && an77.dump2BlockFollowBuyBnb === 0.6 && an77.dump2BlockSecToAnchor === 30,
    'E: BP77+BP82 砸块族扁平十四键+塞单锚透传（dumpBlock*/dump2Block* 含 followBuyBnb/secToAnchor——signal metadata/digest 消费，四腿判读原料不进门）');
  const anMiss77 = buildBuyPointObservation(fullAnswers(), dE).anchors;
  ok(anMiss77.dumpBlockBnb === null && anMiss77.dumpBlockDropPct === null && anMiss77.dumpBlockFollowBuyRatio === null
    && anMiss77.dumpBlockFollowBuyBnb === null && anMiss77.dumpBlockSecToAnchor === null
    && anMiss77.dump2BlockBnb === null && anMiss77.dump2BlockFollowBuyRatio === null
    && anMiss77.dump2BlockFollowBuyBnb === null && anMiss77.dump2BlockSecToAnchor === null
    && anMiss77.exactEqualBlockMaxWallets === 0,
    'E: BP77/BP82 砸块/塞单锚缺席 → null/0 透传不冒充（dE=存量夹具零簇零砸块——题面「砸块行缺席不落」同向；旧档断代 undefined==null 同域）');
}
// ═══ BP78 malicious_dump 总交易额豁免（mapper 代码侧豁免臂——「交易了比较久往下的
// 过程中的恐慌砸盘不像是恶意的」；线=20 BNB 用户裁定「有一些作弊币也刷量的别被骗」） ═══
{
  ok(require('../src/market-analysis/buy-point-result-mapper').DUMP_EXEMPT_TOTAL_VOLUME_BNB === 20,
    'E: BP78 豁免线常量 DUMP_EXEMPT_TOTAL_VOLUME_BNB=20（锚定读数：获救票 T031 4=46.85/588 笔，被拦五张 SI 2.45/蝴蝶 2.61/海水 5.92/meme.jpg 6.02/CR 6.77 全 ≤6.77——7 倍 gap 中间无票；20 线下 T031 照过五张照拦）');
  // snapshot 侧全窗合计（A 段 18 tick 手算 5.17——含 outlier 行 0.4 资金照计）
  ok(near(dA.totalVolumeBnb, 5.17, 1e-9) && buildBuyPointObservation(fullAnswers(), dE).anchors.totalVolumeBnb === 5.17,
    'E: BP78 totalVolumeBnb 全窗合计手算锁（rowsA Σbnb=5.17 含 outlier 资金口径；dE 继承同值）');
  const esD = (p) => ({ ...fullAnswers(), ...mkAns('entry_shape', 'malicious_dump', p) });
  // 豁免触发：mdump ∧ tv ≥20 → 本门不拦放行+exempt 留痕
  const exHit = buildBuyPointObservation(esD(0.86), { ...dE, totalVolumeBnb: 46.85 }).assessment;
  ok(exHit.bucket === 'neutral' && exHit.rule === 'gates_passed' && exHit.exempt
    && exHit.exempt.code === 'dump_total_volume' && near(exHit.exempt.totalVolumeBnb, 46.85),
    'E: BP78 豁免触发 mdump+tv 46.85 ≥20 → neutral/gates_passed+exempt={code:dump_total_volume,totalVolumeBnb}（Jev 桶答案原样保留落档，代码不改写判定——门层放行留痕）');
  // 贴线边界
  const exEdge = buildBuyPointObservation(esD(0.8), { ...dE, totalVolumeBnb: 20 }).assessment;
  ok(exEdge.bucket === 'neutral' && exEdge.exempt && near(exEdge.exempt.totalVolumeBnb, 20),
    'E: BP78 恰 20 BNB 放行（≥ 边界含）；19.99 拒（见下 dE 天然 5.17）');
  // 线下照拦：dE 自带 tv=5.17（被拦五张同域 ≤6.77）
  const exUnder = buildBuyPointObservation(esD(0.86), dE).assessment;
  ok(exUnder.bucket === 'poor' && exUnder.rule === 'entry_gate' && near(exUnder.prob, 0.86) && exUnder.exempt === undefined,
    'E: BP78 线下（tv 5.17<20）照拦 poor/entry_gate 零 exempt（SI/蝴蝶/海水/meme.jpg/CR 五张保持被拦——市场化大额豁免只放真大额盘）');
  // 锚缺失宁拦不冒充（旧档重放 buyDerived 无键）
  const exNull = buildBuyPointObservation(esD(0.86), { ...dE, totalVolumeBnb: null }).assessment;
  ok(exNull.bucket === 'poor' && exNull.rule === 'entry_gate' && exNull.exempt === undefined,
    'E: BP78 锚缺失照拦不豁免（宁拦不冒充——旧档重放域无键=fail-closed）');
  ok(buildBuyPointObservation(esD(0.7), { ...dE, totalVolumeBnb: 'x' }).assessment.rule === 'entry_gate',
    'E: BP78 非有限数 → null 不豁免（typeof number ∧ finite 守卫）');
  // crash 臂不豁免（庄离场直线砸盘判轴与恐慌抛售无关）
  const exCrash = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('entry_shape', 'crash', 0.9) }, { ...dE, totalVolumeBnb: 100 }).assessment;
  ok(exCrash.bucket === 'poor' && exCrash.rule === 'entry_gate' && exCrash.exempt === undefined,
    'E: BP78 crash 臂不豁免（tv 100 照拦——豁免臂 malicious_dump 域专属）');
  // 豁免后后续门拒不吞没 exempt 留痕（activity low 双命中 → 门链顺序拒但 entry 放行记录在场）
  const exLate = buildBuyPointObservation({ ...esD(0.86), ...mkAns('activity_level', 'low', 0.9) }, { ...dE, totalVolumeBnb: 46.85 }).assessment;
  ok(exLate.bucket === 'poor' && exLate.rule === 'activity_gate' && exLate.exempt && exLate.exempt.code === 'dump_total_volume',
    'E: BP78 豁免后 act low 仍拒（rule=activity_gate）+ exempt 留痕不吞没（BP46/BP53 additive 同构——本门放行记录与后续门拒互不遮蔽）');
  // BP82 豁免资格收紧（贴锚砸盘臂落桶的形状不吃本豁免——T003 案 33s 窗 20.5 BNB 机器盘吞吐
  // 即贴线反例：砸块距锚 1~3s 承接比恒 null 被豁免放行；行在场 ∧ 双 ratio null=观察窗未启的
  // 贴锚形状，豁免失效照拦；行缺席=存量豁免行为 bit 不变（上组 exHit 夹具即此形状零改动））
  const dumpNear = { ...dE, totalVolumeBnb: 20.508,
    dumpBlock: { block: 4001, block2: null, sellBnb: 1.9, dropPct: -12, sellers: 5, topSellerPct: 40, dt: 20, endDt: 21, followBuyRatio: null, followBuyBnb: 0.24, secToAnchor: 3 } };
  const exNear = buildBuyPointObservation(esD(0.86), dumpNear).assessment;
  ok(exNear.bucket === 'poor' && exNear.rule === 'entry_gate' && exNear.exempt === undefined,
    'E: BP82 贴锚砸盘 tv 20.508≥20 照拦（砸块行在场∧双 ratio null=观察窗未启贴锚形状 → 豁免资格失效——机器盘吞吐不能给「砸完立刻按到买点」的形状开脱）');
  // ratio1 null 但 ratio2 非 null（相邻两块臂观察窗充足）→ obsBlocked=false 豁免照常
  const dumpHalf = { ...dE, totalVolumeBnb: 46.85,
    dumpBlock: { block: 4001, block2: null, sellBnb: 1.9, dropPct: -12, sellers: 5, topSellerPct: 40, dt: 20, endDt: 21, followBuyRatio: null, followBuyBnb: 0.24, secToAnchor: 3 },
    dump2Block: { block: 4001, block2: 4002, sellBnb: 2.4, dropPct: -15, sellers: 6, topSellerPct: 30, dt: 20, endDt: 55, followBuyRatio: 2.1, followBuyBnb: 5.0, secToAnchor: 45 } };
  const exHalf = buildBuyPointObservation(esD(0.86), dumpHalf).assessment;
  ok(exHalf.bucket === 'neutral' && exHalf.exempt && exHalf.exempt.code === 'dump_total_volume',
    'E: BP82 双 ratio 任一非 null → 豁免照常（单块贴锚但相邻两块臂观察窗充足有承接证据=非贴锚形状——obsBlocked 须双 null 才立，最小侵入不扩大收紧面）');
  // 砸块行在场但两 ratio 齐（观察窗充足）→ 豁免照常（收紧只针对贴锚 null 形状）
  const dumpFull = { ...dE, totalVolumeBnb: 46.85,
    dumpBlock: { block: 4001, block2: null, sellBnb: 1.9, dropPct: -12, sellers: 5, topSellerPct: 40, dt: 20, endDt: 21, followBuyRatio: 1.8, followBuyBnb: 3.4, secToAnchor: 39 } };
  const exFull = buildBuyPointObservation(esD(0.86), dumpFull).assessment;
  ok(exFull.bucket === 'neutral' && exFull.exempt && exFull.exempt.code === 'dump_total_volume',
    'E: BP82 砸块行在场但 ratio 齐 → 豁免照常（观察窗充足有承接证据的市场化大额盘=BP78 原语义域不受 BP82 收紧影响）');
}
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.88) }, dA).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: BP58 统一位置门 dA vsLaunch=+60% >+28.5 → poor/pattern_gate（正常盘面唯一放行上界——不追高）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.77) }, dA).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: BP58 统一位置门 none +60% 拒（S055 无税人生 +126.8% 形状照拒不变）');
// BP58 统一位置门（立线 27.5，用户裁定「现在买入点位已经不是小于 40，应该是小于 27.5」
// ——与 T129 ladder v14 触发线同线；BP60 四桶化后 none=唯一正常桶走本门；**BP69
// 2026-11-10 微放宽 27.5→28.5**——ea78 案同秒 n=8 +27.75 被拒 0.25pp 毫秒竞态）
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.88) }, { ...dA, currentVsLaunchPct: 28.5 }).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: 统一位置门 恰 +28.5% 放行（≤28.5 边界含——BP69；BP58 时代 27.5）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.88) }, { ...dA, currentVsLaunchPct: 27.6 }).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: 统一位置门 +27.6% 放行（BP69 放宽后 27.5~28.5 域回归参与——ea78 同秒抖动窗）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.88) }, { ...dA, currentVsLaunchPct: 28.6 }).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: 统一位置门 +28.6% 拒（严格大于 28.5——BP48 时代恰 40 放行断言随改制反转）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.88) }, { ...dA, currentVsLaunchPct: 40 }).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: 统一位置门 +40% 拒（low 档全域收回——庄盘不再独享也无人独享）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.88) }, { ...dA, currentVsLaunchPct: null }).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: 统一位置门 锚缺失（发行价位置 ?）宁拦不冒充拒');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.77) }, { ...dA, currentVsLaunchPct: -8 }).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: 统一位置门 破发 −8% 放行（含破发）');
// BP59 ⑥sustained_climb 整桶退役（BT-v103 复盘统一裁定①）：桶域删除传入即 throw
// （持续拉升形状归 none 走统一位置门 28.5——羊王 S154/S155 的 ≤10 独立位置臂随桶删除）；
// ⑨one_wave_dump 先买后卖一波流新增=硬拒桶（三要件=开盘段占比 ≥80+开盘段后买入
// 枯竭+后段已转卖；观察族 SAMSUNG/GNusmas/CZ/黎明/#29 五例占比 92~100% 全亏——
// BP47 openShare 臂退役后该形状无门，BT-v103 复盘立法回补）
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'one_wave_dump', 0.87) }, dA).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.87) && aM.rule === 'pattern_gate', 'E: 门① BP59 ⑨one_wave_dump 硬拒（dA vsLaunch=+60%——硬拒桶位置不救：开盘段一波买完转卖，买点落在出货方向上）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'one_wave_dump', 0.87) }, { ...dA, currentVsLaunchPct: -4.2 }).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: ⑨硬拒 贴发行价（−4.2%）照拒（硬拒桶无位置放行臂——区别于⑥时代的独立位置门）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'one_wave_dump', 0.87) }, { ...dA, currentVsLaunchPct: null }).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: ⑨硬拒 锚缺失照拒（盘型硬拒先于位置门判——rule 同 pattern_gate）');
ok(PATTERN_GATE_POOR_BUCKETS.includes('one_wave_dump'), 'E: PATTERN_GATE_POOR_BUCKETS 含⑨one_wave_dump（BP59 硬拒桶=②③⑨三桶）');
// BP60 收口+BP59 改制四桶：桶清单=②③⑨硬拒+none 兜底（用户裁定「只识别出
// 不交易的盘形即可」——①strong_backer/④early_sniper_decay/⑤blended_unremarkable/
// ⑧golden_point 处理与 none 完全一致没必要保留，判型随桶域删除；restart 已于
// BP60 第一轮删除；⑥sustained_climb 已随 BP59 退役；none 正式入域=正常盘面兜底桶）
ok(JSON.stringify(MARKET_PATTERN_LEVELS) === JSON.stringify(['retail_pvp', 'famous_monopoly', 'one_wave_dump', 'none']),
  'E: BP59 桶域清单=四桶（②③⑨硬拒/none 统一门 28.5——⑥退役归 none）');
ok(JSON.stringify(PATTERN_GATE_POOR_BUCKETS) === JSON.stringify(['retail_pvp', 'famous_monopoly', 'one_wave_dump']),
  'E: BP59 硬拒桶恰三桶（②③⑨——BT-v103 复盘统一裁定①）');
for (const legacyBucket of ['strong_backer', 'early_sniper_decay', 'blended_unremarkable', 'golden_point', 'restart', 'sustained_climb']) {
  let threw = false;
  try { buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', legacyBucket, 0.8) }, dE); } catch { threw = true; }
  ok(threw, `E: BP60 判型删除桶 ${legacyBucket} 传入=未知桶名 throw（四桶域外 fail-closed 拒——题集 criteria 无此桶，幻觉/漂移返回即拒；BP52 未部署生产零存档行无重放污染面）`);
}
// BP60 删⑦restart：桶绝迹三重锁——LEVELS 不含+硬拒表不含+传入即 throw（未知桶
// 防线兜住 Jev 幻觉/漂移；题面 criteria 同步删桶由 F 组锁两域相等）
ok(!MARKET_PATTERN_LEVELS.includes('restart'), 'E: BP60 restart 已从桶域删除（用户裁定「restart 应该是可以去掉的类别」——回落票按盘面重置语义以当前形状归类，判读归题面）');
ok(!PATTERN_GATE_POOR_BUCKETS.includes('restart') && !PATTERN_GATE_POOR_BUCKETS.includes('sustained_climb'), 'E: PATTERN_GATE_POOR_BUCKETS 不含 restart/⑥（删桶后无从传入；none 走统一门 28.5——硬拒=retail_pvp/famous_monopoly/one_wave_dump 三桶）');
// 统一位置门边界（BP58 收口 27.5→BP69 28.5；BP60 后 none 承载——唯一正常桶同门）
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.87) }, dA).assessment;
ok(aM.bucket === 'poor' && near(aM.prob, 0.87) && aM.rule === 'pattern_gate', 'E: 门① none 已拉离（dA vsLaunch=+60% >+28.5%）→ poor/pattern_gate（统一位置门拒）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.87) }, { ...dA, currentVsLaunchPct: 28.5 }).assessment;
ok(aM.bucket === 'neutral' && aM.rule === 'gates_passed', 'E: none 恰 +28.5% 放行（统一门域内）');
aM = buildBuyPointObservation({ ...fullAnswers(), ...mkAns('market_pattern', 'none', 0.87) }, { ...dA, currentVsLaunchPct: 40 }).assessment;
ok(aM.bucket === 'poor' && aM.rule === 'pattern_gate', 'E: none +40% 拒（BP43 时代 RESTART_LAUNCH_PCT=40 独立臂已随 BP58 统一门接管）');
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
  'E: 发行价位置族三键透传（BP5——launchCovered boolean → 1 数值化；obsE 用 dE 现价 +20 过统一位置门 28.5）');
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
  console.log('F. 题集形状（BP60 四题=4 维度 0 质量/桶域对锁/题面清洗——零编号零判例名，判例剥名留形状为匿名例）');
  const q = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'market-analysis', 'llm', 'buy-point-questions.mjs')).href);
  ok(q.BUY_POINT_QUESTIONS_VERSION === 'BP66', 'F: 版本=BP66（**BP66=⑨卖期主导性（btv111 复审 Cashless 案 2026-11-14：卖期 2 笔卖 0.41 vs 1 笔买 0.20=2:1 交织误判 one_wave_dump、拒错代价 +463%/15min；用户裁定「买期买入占绝对主导，卖期卖占绝对主导，2:1 肯定不算主导」——③腿对称定义：卖期=卖绝对主导，卖额占首卖后成交绝大部分（行内「卖占首卖后成交」直供参考 ≥80% 即 4:1 起；首卖后同块捆绑买入同样计入买入方向；2:1 级交织=买卖双方在场不构成卖期归 none；买入仅尘级=单向流成立）；btv111 49 owd 信号 25/49 卖占比 <75%=交织误判面）**）；BP65=malignant_dump 贴锚砸盘臂（followBuyBnb/secToAnchor+BP78 obsBlocked 收紧）；BP64=③桶抢筹臂绝对额参考线（famous 合计买 ≥0.5 BNB）；BP63=③桶低价抢进速倒臂（fastFlipArmReady 组合布尔直供）；BP62=bt-v104 R1 三件+二修（②大户在场三分/⑨买期卖期分界直供行/crash 趋势打断轴三口+打断家族不豁免）；BP61=四件方案立法（塞单门/⑨时间分界点/malicious_dump 独立桶）');
  const qs = q.buildBuyPointQuestions();
  const ids = Object.keys(qs);
  ok(ids.length === 4, `F: 恰 4 题=4 维度 0 质量（price_trend/price_level 两题随整理退役——纯参考零消费者，price_level 桶=currentVsLaunchPct 锚的确定性函数离线可复算；实际 ${ids.length}）`);
  ok(ids[0] === 'market_pattern', 'F: market_pattern 题序首位（前置预判断）');
  ok(JSON.stringify(ids) === JSON.stringify(['market_pattern', 'entry_shape', 'activity_level', 'holder_concentration']), 'F: 题序=pattern 首位（预判断）+entry_shape 第二位（点位性质紧随盘面定性）+activity+holder');
  ok(!('price_trend' in qs) && !('price_level' in qs), 'F: price_trend/price_level 题对象绝迹（纯参考零消费——LEVELS 常量保留供旧档重放容缺与 mapper 双副本对锁）');
  ok(!('tree_position' in qs) && !('high_chase_quality' in qs) && !('early_bird_quality' in qs) && !('pullback_entry_quality' in qs), 'F: tree_position/high_chase/early_bird/pullback_entry 题绝迹（退役反证）');
  ok(!('famous_domination' in qs) && !('entry_position' in qs), 'F: famous_domination/entry_position 题绝迹（famous 判型归盘型题③独食桶+互斥检查、entry_position 无消费者）');
  ok(!('market_heat' in qs) && !('point_category' in qs) && !('buy_point_assessment' in qs) && !('price_momentum' in qs) && !('buy_pressure_quality' in qs) && !('chip_flow' in qs) && !('pace_trend' in qs), 'F: market_heat/类别题/综合题/四道旧维度题绝迹（历次退役反证）');
  ok(ids.every((id) => qs[id].type === 'choice' && qs[id].criteria && Object.keys(qs[id].criteria).length >= 3), 'F: 全 choice 且 criteria≥3 桶');
  ok(ids.every((id) => qs[id].instructions.includes('怎么算')), 'F: 四活题各含「怎么算」显式算法段');
  ok(ids.every((id) => qs[id].instructions.includes('反锚')), 'F: 四活题各含反锚段');
  ok(q.buildBuyPointQuestions() && JSON.stringify(q.buildBuyPointQuestions()) === JSON.stringify(qs), 'F: 函数产物两调深相等（无隐藏状态）');
  // ═══ 清洗回归（题面零编号零判例名零演进叙事——防回潮） ═══
  const PROMPT_TEXT = ids.map((id) => qs[id].instructions + Object.values(qs[id].criteria || {}).join('\n')).join('\n');
  ok(!/(BP|CD|D3\.|BT-v|v10\d)[0-9]/.test(PROMPT_TEXT), 'F: 清洗回归=题面零编号标记（BP/CD/D3.x/BT-v/vNNN 全绝迹——改进历史归台账）');
  ok(!/(判例|用户裁定|二修|三修|四修|首版|推翻|收回|已退役)/.test(PROMPT_TEXT), 'F: 清洗回归=题面零演进叙事词（判例/用户裁定/二修三修/首版/推翻/收回/已退役）');
  ok(!/(c84a|ba5e|a8e70|59f5|f485|28ad|258e|44d9|2ef6|147d|0432|338a|d928|ea7d|40a2|a813|ea78|SAMSUNG|GNusmas|海水|汤圆|谷谷|BEM|BOSS|苍蝇|赵公主|币安之心|蝴蝶|王涛|黎明|S0\d\d|T0\d\d)/.test(PROMPT_TEXT), 'F: 清洗回归=题面零判例地址/昵称/编号（防过拟合）');
  ok((PROMPT_TEXT.match(/例：/g) || []).length >= 15, `F: 清洗回归=匿名例在场（判例剥名留形状——「例：」≥15 处，实际 ${(PROMPT_TEXT.match(/例：/g) || []).length}）`);
  // 桶域与 mapper 常量对锁（ESM/CJS 双副本漂移防线）
  ok(JSON.stringify(q.PRICE_TREND_LEVELS) === JSON.stringify(PRICE_TREND_LEVELS), 'F: PRICE_TREND_LEVELS 同域（BP5 六桶）');
  ok(!('SELL_PRESSURE_LEVELS' in q) && !('sell_pressure' in qs), 'F: sell_pressure 题与桶域常量已删（BP11 用户裁定「sell_pressure 直接删掉」——体系中无此指标）');
  ok(!('HEAT_LEVELS' in q) && !('HEAT_LEVELS' in require('../src/market-analysis/buy-point-result-mapper')), 'F: HEAT_LEVELS 双侧绝迹（market_heat 题与桶域常量同删——与 activity_level 重复；旧档 answers 带该键=维度缺席不被消费不 throw）');
  ok(JSON.stringify(q.ACTIVITY_LEVELS) === JSON.stringify(ACTIVITY_LEVELS), 'F: ACTIVITY_LEVELS 同域（BP13 CD activity_level 同词表四档+BP67 第五档 burst 输入桶）');
  ok(JSON.stringify(Object.keys(qs.activity_level.criteria)) === JSON.stringify(ACTIVITY_LEVELS), 'F: activity_level 桶===ACTIVITY_LEVELS（五桶 low/mid/high/ultra/burst——mapper 桶域校验双处同步防 throw）');
  // ═══ BP67 burst 输入桶（act 第五档——cheat 门 burst 判定透传，不重复检测不拦） ═══
  ok(q.ACTIVITY_LEVELS.length === 5 && q.ACTIVITY_LEVELS[4] === 'burst', 'F: ACTIVITY_LEVELS 第五档=burst（cheat 门 burst 判定透传输入桶——不重复检测不拦）');
  ok(typeof qs.activity_level.criteria.burst === 'string'
    && qs.activity_level.criteria.burst.includes('输入桶')
    && qs.activity_level.criteria.burst.includes('[ANCHOR] 段「作弊盘检测 burst 判定」行在场时选')
    && qs.activity_level.criteria.burst.includes('不因低档要素压档')
    && qs.activity_level.criteria.burst.includes('行缺席时本档不可选'),
    'F: criteria.burst（输入桶语义——行在场才选/不重复判定/缺席不可选三锚句）');
  ok(qs.activity_level.instructions.includes('burst 档（输入桶）')
    && qs.activity_level.instructions.includes('「作弊盘检测 burst 判定」行在场')
    && qs.activity_level.instructions.includes('不重复判定 burst 形状')
    && qs.activity_level.instructions.includes('不因全窗量级结构（大比例静默/间歇死水/临近死寂等低档要素）压低档位')
    && qs.activity_level.instructions.includes('该行缺席时本档不可选、按七要素照常判档')
    && qs.activity_level.instructions.includes('burst 档不拦买入'),
    'F: act 题面 burst 档判读句（采信上游结论+不压档+不拦买入三句——行缺席时本档不可选按七要素照常判档）');
  ok(ACTIVITY_GATE_POOR_BUCKETS.activity_level.includes('low') && ACTIVITY_GATE_POOR_BUCKETS.activity_level.includes('ultra')
    && !ACTIVITY_GATE_POOR_BUCKETS.activity_level.includes('burst')
    && !ACTIVITY_GATE_POOR_BUCKETS.activity_level.includes('mid') && !ACTIVITY_GATE_POOR_BUCKETS.activity_level.includes('high'),
    'F: BP67 活跃度门拦域不动（low/ultra 照拦——burst 不在拦域=用户裁定「这个选项不 block 买入」自然放行，门上零改动）');
  ok(!('FAMOUS_DOMINATION_LEVELS' in q), 'F: FAMOUS_DOMINATION_LEVELS 常量绝迹（BP49 famous_domination 退役——ESM 侧同删）');
  ok(JSON.stringify(q.HOLDER_CONCENTRATION_LEVELS) === JSON.stringify(HOLDER_CONCENTRATION_LEVELS), 'F: HOLDER_CONCENTRATION_LEVELS 同域（BP14——CD240 分层线词表）');
  ok(JSON.stringify(Object.keys(qs.holder_concentration.criteria)) === JSON.stringify(HOLDER_CONCENTRATION_LEVELS), 'F: holder_concentration 桶===HOLDER_CONCENTRATION_LEVELS（四桶 none/weak/moderate/strong）');
  ok(!('ENTRY_POSITION_LEVELS' in q), 'F: ENTRY_POSITION_LEVELS 常量绝迹（BP49 entry_position 退役——ESM 侧同删）');
  ok(JSON.stringify(q.PRICE_LEVEL_LEVELS) === JSON.stringify(PRICE_LEVEL_LEVELS), 'F: PRICE_LEVEL_LEVELS 同域（BP43 六桶 almost_launch 前插——ESM/CJS 双副本对锁）');
  ok(!('TREE_POSITION_LEVELS' in q), 'F: TREE_POSITION_LEVELS 常量绝迹（BP30 tree_position 退役——ESM 侧同删）');
  // BP18 盘面分类锚（五类型学——用户裁定原话直译）
  ok(JSON.stringify(q.MARKET_PATTERN_LEVELS) === JSON.stringify(MARKET_PATTERN_LEVELS), 'F: MARKET_PATTERN_LEVELS 同域（BP59 四桶=②③⑨硬拒+none——ESM/CJS 双副本对锁）');
  ok(JSON.stringify(Object.keys(qs.market_pattern.criteria)) === JSON.stringify(MARKET_PATTERN_LEVELS), 'F: market_pattern 桶===MARKET_PATTERN_LEVELS（BP59 四桶——PATTERN_GATE_POOR_BUCKETS 硬拒=retail_pvp/famous_monopoly/one_wave_dump 三桶）');
  // BP43（CD381 同车需求 2/4'）：almost_launch 六桶+restart 第七桶+数值锚联动
  ok(JSON.stringify(PRICE_LEVEL_LEVELS) === JSON.stringify(['almost_launch', 'near_launch', 'low', 'mid', 'high', 'very_high']), 'F: price_level 六桶域=almost_launch/near_launch/low/mid/high/very_high（BP43 almost_launch 前插；BP50 上界 20→10）');
  ok(!('price_level' in qs) && !('price_trend' in qs), 'F: price_level/price_trend 题对象绝迹（BP60 整理=纯参考零消费题删除；PRICE_LEVEL_LEVELS/PRICE_TREND_LEVELS export 常量保留供旧档重放域校验——桶是 currentVsLaunchPct 锚的确定性函数离线可复算）');
  ok(MARKET_PATTERN_LEVELS.includes('none') && MARKET_PATTERN_LEVELS.includes('retail_pvp') && MARKET_PATTERN_LEVELS.includes('famous_monopoly') && MARKET_PATTERN_LEVELS.includes('one_wave_dump') && !MARKET_PATTERN_LEVELS.includes('sustained_climb') && !MARKET_PATTERN_LEVELS.includes('restart') && !MARKET_PATTERN_LEVELS.includes('golden_point') && !MARKET_PATTERN_LEVELS.includes('strong_backer') && !MARKET_PATTERN_LEVELS.includes('early_sniper_decay') && !MARKET_PATTERN_LEVELS.includes('blended_unremarkable'), 'F: BP59 四桶收口（BP60 裁定「只识别出不交易的盘形即可」+BT-v103 统一裁定①——①④⑤⑦⑧判型桶已删、⑥sustained_climb 退役归 none、⑨one_wave_dump 新增硬拒、处理=②③⑨硬拒+none 统一门 28.5）');
  ok(!('LEGACY_MARKET_PATTERN_LEVELS' in q) && !('LEGACY_MARKET_PATTERN_LEVELS' in require('../src/market-analysis/buy-point-result-mapper')), 'F: LEGACY_MARKET_PATTERN_LEVELS 两侧绝迹（BP58 二修判型恢复后无并域语义——题集/mapper 均不导出）');
  ok(require('../src/market-analysis/buy-point-result-mapper').NORMAL_ENTRY_LAUNCH_PCT === 28.5 && require('../src/market-analysis/buy-point-result-mapper').SUSTAINED_CLIMB_LAUNCH_PCT === undefined, 'F: 位置门常量导出（NORMAL_ENTRY_LAUNCH_PCT=28.5（BP58 立线 27.5、BP69 微放宽）；SUSTAINED_CLIMB_LAUNCH_PCT 已随 BP59 ⑥桶退役绝迹——唯一位置门=统一门）');
  const mp = qs.market_pattern.instructions;
  ok(mp.includes('本题只识别「不参与交易」的异常盘形') && mp.includes('不再细分识别，一律归 none 正常盘面'), 'F: 题头收口句（只识别不参与的异常盘形——处理一致正常形状不细分一律 none）');
  ok(mp.includes('本题是预判断——先于其它题作答、先定盘面性质再谈点位'), 'F: 前置预判断声明（market_pattern 放最前）');
  ok(mp.indexOf('价格区间术语') >= 0 && mp.indexOf('价格区间术语') < mp.indexOf('famous 轴前置') && mp.includes('**almost_launch 区**=较发行价 **≤+10%（含破发）**') && mp.includes('「从未离开 almost_launch」=现价从未高于 +10% 上界'), 'F: almost_launch 术语定义前置（用户裁定：特指价格范围的术语在 prompt 里要用就不能删、定义放到题面前部——state「发行价位置」行自带 almost_launch 措辞，题面必须先定义后引用）');
  ok(/从未回到 almost_launch|回到 almost_launch|回到过 almost_launch/.test(mp + qs.entry_shape.instructions + qs.holder_concentration.instructions), 'F: almost_launch 术语全程引用（mp 退出维度①/③厚薄分流+entry 急跌进行时+holder 价格豁免——术语与数值括号并存）');
  ok(mp.includes('买点时刻无任何像样买方') && mp.includes('(a) 从来无像样买单') && mp.includes('大户卖出、零散小散承接'), 'F: ②双形状（(a) 从来无像样买单+(b) 大户卖出零散小散承接——大户向小散出货盘面散户化仍②）');
  // ═══ famous 轴前置（适用域两维度+互斥+退出臂前提） ═══
  ok(mp.includes('famous 控盘（筹码结构行 famous 控盘占比 ≥25）') && mp.includes('只在盘面尚薄、尚未火过时成立') && mp.includes('两维度任一命中即**退出 famous 轴**'), 'F: famous 轴前置适用域（famous 只判交易量尚且不足/尚未火过的代币——两维度退出）');
  ok(mp.includes('锚窗涨起后最低价较发行价 ≤+10% 含破发=回到过 almost_launch 区') && mp.includes('还在场=真金白银继续看好（**正面证据**'), 'F: famous 轴退出维度①价格（再起来 ≤+10 含破发——落底后 famous 持无浮盈筹码=正面证据）');
  ok(mp.includes('盘面已有大量交易') && mp.includes('famous 占比是换手结果不是收割前兆'), 'F: famous 轴退出维度②厚度（已有大量交易=盘子已厚——换手结果非收割前兆）');
  ok(mp.includes('仍在早期薄盘域（两维度都不命中）才做互斥检查') && mp.includes('famous 控盘 ≥25 的盘子按③famous_monopoly（小散底子被 famous 抢筹）或按散户化形状归②') && mp.includes('famous 的货是要出货的，不是锁仓拉盘的庄'), 'F: 互斥检查（famous 控盘 ≥25 的盘子只能在③或按散户化形状归②——强庄的庄不能是著名跟单钱包）');
  ok(mp.includes('两退出臂的前提=famous 还在场（在场性看「famous 痕迹」行）') && mp.includes('砸回发行价的正是 famous 自己的出货') && mp.includes('收割中不算在场持有，同不适用退出臂'), 'F: 退出臂前提=famous 在场（痕迹行净>0=在场持有；收割中不算在场持有；收割完残局不适用退出臂）');
  // ═══ ②三步判序（量维度→大户参与→承接轴） ═══
  ok(mp.includes('第一步·量维度前置（只对 (a) 臂）') && mp.includes('先判「盘面 0.3 级买入力量在场」') && mp.includes('**单笔买入 >0.3 BNB**') && mp.includes('**同 block 捆绑买入汇总 >0.3 BNB**') && mp.includes('「同块捆绑买入」行直供') && mp.includes('散单堆凑的合计不豁免') && mp.includes('买完已清仓离场的不算'), 'F: ②第一步量维度前置（单笔 >0.3/同 block 捆绑汇总 >0.3 两口径任一在场=(a) 臂不成立归 none；散单堆凑合计不豁免；已清仓离场不算）');
  ok(mp.includes('第二步·大户参与判序前置（对②整体，先于承接）') && mp.includes('按单笔计不累计') && mp.includes('三笔买到 0.23 的钱包不算 0.2 级') && mp.includes('**单笔 0.2 BNB 级（≥0.19 视同）钱包 ≥2 个且活跃在场**') && mp.includes('或**单笔 0.3+ 且活跃在场**=满足') && mp.includes('**在场=活跃在场**：净持仓 >0 且末动距今 ≤120 秒') && mp.includes('挂账在场（净 >0 但末动距今 >120s 的沉默持仓）与已清仓离场都不算在场') && mp.includes('末动距今 452s/211s=挂账沉默，不算') && mp.includes('**不满足 → 直接落②**') && mp.includes('不再看承接、不看盘面活跃度') && mp.includes('三笔 0.1264+0.0385+0.0660 累计 0.2309 的钱包按单笔只是 0.1 级灰区单、单笔 0.2286 恰 1 个=大户参与不满足落②；仅一笔 0.2 级凑不成多笔仍落②'), 'F: ②第二步大户参与（单笔 0.2 级 ≥0.19 ×≥2 且活跃在场或 0.3+ 且活跃在场；挂账沉默/清仓离场不算；多笔累计不算；不满足直接落②不看活跃度——灰区单匿名例锚+挂账例锚）');
  ok(mp.includes('第三步·承接轴（(b) 臂判据）') && mp.includes('开盘段大额单 >0 **不自动排除②**') && mp.includes('判据=开盘段结构行+[WALLETS] 前列行+筹码结构行+活跃度行+卖压行+[PRICE] 行六源并读'), 'F: ②第三步承接轴（开盘段大额不自动排除——六源并读）');
  ok(mp.includes('落②(b) 须「一眼可辨的大量小散单」，两要件缺一不落') && mp.includes('买盘中位尘埃级 0.0x + 前列再无像样买方') && mp.includes('承接是 0.1~0.2 BNB 级常见交易档（中位 0.1 级）=正常换手盘面不落②') && mp.includes('承接 0.2~0.3+ 像样级=像样承接、流动性真实，归 none'), 'F: ②(b) 收窄两要件+承接档位分界（中位尘埃+前列无像样买方缺一不落；0.1~0.2 常见档不落②；0.2~0.3+ 像样承接归 none）');
  ok(mp.includes('**卖方在场性优先三分**') && mp.includes('①大户持续卖（卖压行近 60s 大户卖出 >0）+ 持续有承接（身份不限）→ 正常换手不落②') && mp.includes('②大户已卖完离场（卖压归零 ∧ 清仓式卖出成批/前列走空）+ 散户承接只剩一波 → ②(b)') && mp.includes('「一波接没下文」是这种结构的必然结局，判结构、不判承接当下活跃度') && mp.includes('③卖压归零但前列大买家在场持有未卖 → 走在场承接路径不落②'), 'F: ②(b) 卖方在场性三分（持续卖+持续承接=换手归 none／卖完离场一波接=②判结构不判当下活跃度／在场未卖看承接档位）');
  ok(mp.includes('**承接归零例外**') && mp.includes('近窗买入归零/仅尘埃（买占比 ≈0、无人接盘）的除外') && mp.includes('（在场持有+零承接=对倒停摆的死盘）'), 'F: ②(b) 承接归零例外（在场持有未卖不落②，但近窗买占比≈0 的除外——没有买方的盘面不是融合盘）');
  // ═══ ③ famous 独食（痕迹行+抢筹/收割臂+厚薄分流+burst 残仓） ═══
  ok(mp.includes('这个盘子就是它的/它们的了') && mp.includes('**判读看 state「famous 痕迹」行**') && mp.includes('[WALLETS] 不标名单身份、本人净持仓无直供键，不读痕迹行无从判「famous 还在场吗」'), 'F: ③判读锚=「famous 痕迹」行（名单钱包时间线+Σ净+占买比+在场净额——[WALLETS] 不标名单身份）');
  ok(mp.includes('**抢筹臂（筹码在手）**') && mp.includes('**占比大且绝对额大**双要件') && mp.includes('或**两个及以上 famous 极早入场合计拿筹过多、盘起不来**（复数同落③）'), 'F: ③抢筹臂（单个占比大且绝对额大双要件；复数极早合计达线同落③）');
  ok(mp.includes('**收割臂（快进快出的残局）**') && mp.includes('净>0 名单钱包 0 个 ∧ Σ净 ≈0 或负 ∧ 合计占买约一成以上') && mp.includes('**收割完**（已清仓离场）／**收割中**（在场名单钱包已卖 ≥95%、净投入 ≈0 差微末；**占买约一成上下贴线亦构成**）') && mp.includes('净投入与买入额相当、基本未卖=**在场持有**，不落收割臂'), 'F: ③收割臂两分支+在场判据+区分锚（收割完/收割中；在场持有不落收割臂）');
  ok(mp.includes('**③桶在场持有的厚薄分流（前置段退出臂的完整判读）**') && mp.includes('薄盘（锚窗买入 <5 BNB 量级）famous 在场持有**照落③不豁免**') && mp.includes('在场 ≠ 护盘') && mp.includes('≥5 BNB 厚盘充分换手的在场持有不落③归 none——换手结果非收割前兆'), 'F: ③在场持有厚薄分流（薄盘 <5 BNB 照落③——在场 ≠ 护盘；厚盘 ≥5 BNB 归 none）');
  ok(mp.includes('**burst 重启盘尘埃残仓例外**') && mp.includes('①**基本归零过**（发行价位置行涨起后最低 ≤+10 含破发=回到过 almost_launch 区）②**流量涌入**（近窗买入额/笔数可观）') && mp.includes('痕迹行在场净额合计 <0.05 级、已基本卖完九成以上') && mp.includes('在场净额大照落③') && mp.includes('**未基本归零过的盘面不适用本例外**'), 'F: ③ burst 重启尘埃残仓例外（两要件=归零过 ≤+10+流量涌入；在场净额 <0.05 级尘埃残仓=上一轮遗迹归 none；净额大照落③；未归零过不适用）');
  // ═══ 集团买入主导判序臂+跟单合并口径+量不足回落反锚（BP60 整理补回——线值 diff 抓出三线遗漏后补） ═══
  ok(mp.includes('**集团买入主导（判序臂）**') && mp.includes('famous 集团买入占全窗买入大头（筹码结构行「famous 集团买入占比」，参考 ≥50%）→ 判本桶') && mp.includes('famous 极早抢筹天然制造「开盘段买入集中+其后吞吐骤降、盘面冷下来」的形状，那是 famous 进场方式的产物') && mp.includes('只看到「开局集中其后冷」的形状、没看到 famous 本体，就是漏判本桶'), 'F: ③集团买入主导判序臂（控盘达线∧集团买入占比 ≥50% → 本桶——「开局集中其后冷」是 famous 进场方式产物非正常盘面，防漏判）');
  ok(mp.includes('「集团买入占比」是 famous+跟单的**合并口径**') && mp.includes('≥50% 判序线会被跟单顶上') && mp.includes('须并读痕迹行（只计 famous 本人）占买比：本人占买不高+吞吐厚=famous 之外多元参与已承接买入'), 'F: ③集团买入占比跟单合并口径注意（防跟单簇顶线误判——并读痕迹行只计本人占买比）');
  ok(mp.includes('**「火过」的判据是量不是价格形状**') && mp.includes('量不足的薄盘即使价格拉高过又回落（看似「火过」），仍是「薄盘被 famous 打完第一波就走」的形状，不构成厚度维度退出') && mp.includes('吞吐仅 3.5~3.7 BNB 薄+锚窗高点拉高约 +99~112% 后回落底部'), 'F: 厚度维度量不足回落反锚（「火过」判据是量不是价格形状——量不足的拉高回落照落③不退出）');
  ok(qs.market_pattern.criteria.famous_monopoly.includes('参考 ≥50%，famous+跟单合并口径须并读痕迹行只计本人'), 'F: criteria famous_monopoly 同步 ≥50% 线+口径注意');
  // ═══ ⑨ 一波流（BP77 判据=时间分界点——存在性判读替换完成时态占比） ═══
  ok(mp.includes('⑨one_wave_dump（先买后卖一波流）') && mp.includes('本质：**买入之前基本上只有买没有卖，买入的时候刚好是「卖」的开始**') && mp.includes('这种盘**没有对倒换手**') && mp.includes('判读主锚=**「买期/卖期分界」行直供**') && mp.includes('①**首卖前纯买期**——首卖前尘门后零卖出') && mp.includes('②**卖期在买点前夕刚启动**——首卖距今买点很近（参考 ≤30s 量级') && mp.includes('③**卖期卖占绝对主导（无对倒换手）**——「买期/卖期」是对称定义') && mp.includes('卖额须占首卖后成交的绝大部分（行内「卖占首卖后成交」直供，参考 ≥80% 级即 4:1 起') && mp.includes('**首卖后同块捆绑买入同样计入买入方向**') && mp.includes('**首卖后买入与卖出同量级交织（哪怕卖略大——2:1 级≈卖占三分之二）=买卖双方在场，不构成「卖期」**') && mp.includes('首卖后买入仅尘级小单=不是换手承接、单向流成立') && mp.includes('行缺席（零像样卖/行不足）=本桶轴不适用归 none') && mp.includes('像强开盘，实际买完就转卖'), 'F: ⑨判轴=首卖分界三要件（BP83 主导性：买期买绝对主导↔卖期卖绝对主导 ≥80% 参考；捆绑买入计入买入方向；2:1 交织不构成卖期归 none；尘级买=单向流成立；分界行直供尘门 0.05/0.01；行缺席归 none）');
  ok(mp.includes('**与②的区别**') && mp.includes('本桶买期**有**一波像样买盘') && mp.includes('像强开盘，实际买完就转卖'), 'F: ⑨与②区别（②(a) 从来无像样买单；⑨买期有像样买盘——像强开盘实际买完就转卖）');
  ok(mp.includes('**反锚（不落本桶，一律从宽归 none）**') && mp.includes('全窗都是买期（尚无像样卖出现') && mp.includes('**首卖后买盘与卖出同量级交织（卖不占绝对主导——2:1 级不算卖期，买卖双方在场）**') && mp.includes('卖从拉升早期就散布全窗=边拉边卖、对倒换手在场') && mp.includes('后段有非捆绑的像样买入承接（换手正常盘面）') && mp.includes('首卖距买点远（出货中段）') && mp.includes('证据薄或窗极短'), 'F: ⑨反锚六条从宽归 none（全买期/买卖同量级交织（BP83）/边拉边卖/有承接/出货中段/证据薄窗极短——拒买桶须证据坐实）');
  // ═══ 怎么算/反锚/收尾 ═══
  ok(mp.includes('怎么算：开盘段结构行'), 'F: mp 怎么算段在场（[PRECOMPUTED] 直供键算法段）');
  ok(mp.includes('**「多笔」是硬笔数且按单笔计**') && mp.includes('多笔累计到 0.2 级的钱包不算（读 [WALLETS]「最大单笔」不读累计）') && mp.includes('仅 1 个单笔 0.2 级+其余全 0.1 级及以下=凑不成多笔仍落②') && mp.includes('**前提是像样买方买点时刻仍在场**'), 'F: 反锚单笔口径（多笔硬笔数按单笔计；累计不算；在场前提）');
  ok(mp.includes('③要 famous/单一钱包**拿了太多筹码**（占比大且绝对额大——**绝对额参考线：痕迹行合计买 ≥0.5 BNB**，合计 <0.5 的零星 famous 买入不构成独食）才落③——边缘参与（占比 <25）、绝对额不足（<0.5）或大额多元并存不构成独食') && mp.includes('**复数 famous 形状**'), 'F: 反锚③门槛+复数形状（边缘参与不构成独食；BP64 绝对额参考线 ≥0.5——零星 famous 买入 <0.5 不落③；复数合计达线同落③）');
  ok(mp.includes('**⑨的判轴=「买期/卖期分界」行（首笔像样卖）**') && mp.includes('首卖前纯买期（尘门后零卖出+像样买盘拉起）∧ 首卖距买点近（参考 ≤30s）∧ 卖期卖占绝对主导（卖占首卖后成交绝大部分、行内直供参考 ≥80%；首卖后买入与卖出同量级交织〔2:1 级〕=不是卖期不落⑨——捆绑买入同样计入买入方向）') && mp.includes('首卖后买卖同量级交织（卖不占绝对主导）') && mp.includes('证据薄/窗极短时从宽 none（拒买类从严、拿不准从宽）') && mp.includes('材料不足归 none 处理不硬归类到异常桶（拒买桶须证据坐实）'), 'F: 反锚⑨分界行三要件复述（BP83 主导性腿+交织反锚）+从宽方向+材料不足兜底（拒买桶须证据坐实、拿不准从宽 none）');
  ok(mp.includes('②③⑨由盘型门硬拒（不要参与）') && mp.includes('判型归 Jev、位置归代码') && mp.includes('none 统一位置门 ≤+28.5%（含破发）放行、已拉离（>+28.5%）拒') && mp.includes('锚缺失（发行价位置行 ?）宁拦不冒充一律拒') && mp.includes('拉高/砸盘形状的拦截由点位性质题 entry_shape+位置门接力'), 'F: 收尾分工+位置门（②③⑨门硬拒；none 统一门 ≤+28.5 含破发、锚缺失宁拦不冒充；判型归 Jev 位置归代码）');
  ok(!mp.includes('⑥ ≤+10% 起点段放行'), 'F: ⑥独立位置臂句绝迹（持续拉升归 none 统一门）');
  // criteria 四桶同步
  ok(qs.market_pattern.criteria.retail_pvp.includes('单笔 >0.3 BNB 买入在场、或同一 block 内捆绑买入汇总 >0.3 BNB（「同块捆绑买入」行直供——链上同时性的组织性买入）=盘面有 0.3 级买入力量，不落本桶归 none') && qs.market_pattern.criteria.retail_pvp.includes('量维度不在场再看大户参与（单笔 0.2 级钱包 ≥2 个或单笔 0.3+，且**活跃在场**——净 >0 且末动距今 ≤120s；挂账沉默（末动 >120s）与已清仓离场都不算在场、「大户参与判读」行已算好活跃在场计数——0.2 级按单笔计不累计）不满足直接落本桶、盘面活跃度（笔数/钱包数）不救') && qs.market_pattern.criteria.retail_pvp.includes('判据全文见题面②桶'), 'F: criteria retail_pvp 判序同步（量维度两口径前置+大户参与单笔计+活跃在场加硬——桶描述与题面判序一致）');
  ok(qs.market_pattern.criteria.famous_monopoly.includes('这个盘子就是它的/它们的了') && qs.market_pattern.criteria.famous_monopoly.includes('吞吐厚/涨跌轮回走完的厚盘归 none') && qs.market_pattern.criteria.famous_monopoly.includes('famous 快进快出已清仓离场（收割完）或已卖出绝大部分只差微末（收割中）的残局同落本桶') && qs.market_pattern.criteria.famous_monopoly.includes('薄盘（锚窗买入 <5 BNB）famous 在场持有照落本桶——在场 ≠ 护盘') && qs.market_pattern.criteria.famous_monopoly.includes('**burst 重启盘（基本归零过+流量涌入）famous 仅剩尘埃残仓（在场净额合计 <0.05 级、已基本卖完）不算在场不落本桶；在场净额大的照落**'), 'F: criteria famous_monopoly 同步（适用域+收割两分支+厚薄分流+burst 残仓例外——桶级语义句）');
  ok(qs.market_pattern.criteria.one_wave_dump.includes('买入之前基本上只有买没有卖，买入的时候刚好是「卖」的开始；本质=没有对倒换手') && qs.market_pattern.criteria.one_wave_dump.includes('判读主锚=「买期/卖期分界」行（首笔像样卖）：首卖前纯买期（尘门后零卖出+像样买盘拉起）∧ 首卖距买点近（参考 ≤30s）∧ **卖期卖占绝对主导**（卖额占首卖后成交绝大部分、行内「卖占首卖后成交」直供参考 ≥80%——首卖后买入与卖出同量级交织〔2:1 级〕=买卖双方在场不构成卖期，捆绑买入同样计入买入方向；买入仅尘级=单向流成立）→ 落本桶') && qs.market_pattern.criteria.one_wave_dump.includes('首卖距买点数十秒以上=出货中段不落本桶、首卖后买卖同量级交织/卖从拉升早期就散布全窗（边拉边卖=对倒换手在场）/全窗都是买期/后段有非捆绑的像样承接/证据薄窗极短的从宽归 none（拒买桶须证据坐实）') && qs.market_pattern.criteria.one_wave_dump.includes('与②的区别=买期有一波像样买盘（像强开盘、实际买完就转卖——这正是它危险的地方）') && qs.market_pattern.criteria.one_wave_dump.includes('判据全文见题面⑨桶'), 'F: criteria one_wave_dump 同步（首卖分界三要件判轴（BP83 主导性腿）+从宽六条+区别+判据指针）');
  ok(qs.market_pattern.criteria.none.includes('强庄盘/狙击衰竭/融合盘/回落重启/高活跃黄金点/持续拉升') && qs.market_pattern.criteria.none.includes('统一位置门 ≤+28.5% 含破发，已拉离（>+28.5%）或锚缺失=拒（宁拦不冒充）'), 'F: criteria none 兜底桶（正常形状清单+统一位置门+宁拦不冒充）');
  // ═══ entry_shape 点位性质（四桶+判序+判读线+形状样本） ═══
  ok(JSON.stringify(q.ENTRY_SHAPE_LEVELS) === JSON.stringify(ENTRY_SHAPE_LEVELS), 'F: ENTRY_SHAPE_LEVELS 同域（五桶 crash/malicious_dump/spike/normal_dip/flat——BP77 恶意砸盘单独落桶；ESM/CJS 双副本对锁）');
  ok(JSON.stringify(Object.keys(qs.entry_shape.criteria)) === JSON.stringify(ENTRY_SHAPE_LEVELS), 'F: entry_shape 桶===ENTRY_SHAPE_LEVELS（五桶判型桶域——spike 判型保留落档、拦截域由 mapper 单独决定）');
  ok(JSON.stringify(ENTRY_GATE_POOR_BUCKETS) === JSON.stringify(['crash', 'malicious_dump']), 'F: ENTRY_GATE_POOR_BUCKETS 双桶（crash+malicious_dump——恶意砸盘 BP77 单独落桶同走点位门拒买；spike 判型落档不拦（BP68），恢复拦截=把 spike 加回本数组）');
  const esIns = qs.entry_shape.instructions;
  ok(esIns.includes('判定**买点时刻价格走到当前位置的方式**') && esIns.includes('只买性价比高的点位、不追高') && esIns.includes('好点位只有两种') && esIns.includes('「对倒交易换手中的低点」') && esIns.includes('较长时间下跌后形成的低点（活跃度未失去）') && esIns.includes('不是庄家离场时的暴跌，也不是尖刺拉起的追高点'), 'F: entry_shape 题头=交易理念直译（好点位只有两种=对倒换手中的低点/较长时间下跌后形成的低点——非庄离场暴跌非尖刺追高）');
  ok(esIns.includes('五桶判序：先看 malicious_dump（恶意砸盘——state「恶意砸块」行在场且四腿联立才落，判读见恶意砸盘桶）、再看 crash 数值提示臂（命中进入**形态复核**——[PRICE] 价格拱无回调+近窗无换手对倒才落 crash，速度不设限）与**两臂**（本地买方缺席的单边下跌段/近期暴跌后的余波小活跃——判读见 crash 桶两臂段）') && esIns.includes('再判 spike（尖刺拉起）各臂，都不命中按回落形态分 normal_dip/flat') && esIns.includes('crash/normal_dip 判的是价格拱形态、不是跌幅数值'), 'F: entry_shape 五桶判序（malicious_dump 独立桶最前（BP77 判轴分离）→crash 提示臂+两臂→spike→normal_dip/flat；形态判读非数值判读）');
  ok(esIns.includes('① 现价较锚窗最高价深跌：currentVsAthPct ≤ -25%') && esIns.includes('② 近 30s 动量深跌：chg30Pct ≤ -25%') && esIns.includes('③ 临近段单 5s 段急跌：nearMaxDn5Pct ≤ -15%') && esIns.includes('④ 现价贴着锚窗最低价：curVsMinGapPct ≤ 2 个百分点'), 'F: crash 四臂判读线（-25/-25/-15/2pp——数值臂只进复核不定桶）');
  ok(esIns.includes('**速度不是判轴**') && esIns.includes('急砸（连续两位数级 5s 段垂直下行）与缓砸（中等速率但一路向下、无回调无承接）都是庄离场砸盘') && esIns.includes('只要持续无回调、无换手对倒，同样落本桶') && esIns.includes('**判读序：数值臂只是进入复核的提示，定桶看 [PRICE] 价格拱形态+近窗买卖结构**') && qs.entry_shape.criteria.crash.startsWith('无回调、无换手对倒的砸盘：'), 'F: crash 判轴=无回调+无换手对倒双缺位（速度不设限——急砸缓砸都落；判读序=数值臂提示→形态复核定桶；criteria 头同步）');
  ok(esIns.includes('① 现价贴锚窗最高价：currentVsAthPct ≥ -5%（拉升进行时贴顶——单独成立，此刻买入=顶上接）') && esIns.includes('② 贴顶+近 30s 动量急涨：chg30Pct ≥ +20%（须与①联立）') && esIns.includes('③ 贴顶+临近段单 5s 段急拉：nearMaxUp5Pct ≥ +15%（须与①联立）') && esIns.includes('急拉但已从高点回落超过 5 个百分点（currentVsAthPct < -5）不判 spike'), 'F: spike 三臂=贴顶必要条件+联立（①贴顶 -5 单独成立；②③须联立；回落 >5pp 不判=对倒回升波段非追高点）');
  ok(esIns.includes('贴顶是必要条件') && esIns.includes('对倒回升波段'), 'F: 反锚回升波段（急拉数值轴无区分度——位置轴=现价在不在刺尖上）');
  ok(esIns.includes('**normal_dip 阶梯/震荡/阴跌回落（好点位）**') && esIns.includes('浅或深皆可') && esIns.includes('即便深跌+急跌数值双中') && esIns.includes('有回调节奏或买方换手承接'), 'F: normal_dip=目标形状（阶梯/震荡/阴跌皆好点位、深浅不是判据——判据=有回调节奏或买方换手承接）');
  ok(esIns.includes('flat 横盘/缓行'), 'F: flat 横盘桶（各臂不命中且无回落结构如实归本桶）');
  // ═══ BP77 malicious_dump 独立桶（题面+criteria+形状样本三载体同步） ═══
  ok(esIns.includes('**malicious_dump 恶意砸盘（拒买——单独桶）**——判轴=**卖方阵列的块级结构证据**（与 crash 的价格拱形态判轴分离：砸块在买点前任何时候——不限临近段，窗内其它地方有回调/换手不救本桶）')
    && esIns.includes('①砸块卖额 ≥0.5 BNB（规模）') && esIns.includes('②块内跌幅 ≥10%（价格影响——卖出额与价格影响联合，单看卖额不落）')
    && esIns.includes('③卖方 ≥4 钱包阵列（组织性——多钱包协同砸，剔路由口径）') && esIns.includes('④承接不足：砸后 60s 承接比 <0.5（承接不到砸卖额一半）')
    && esIns.includes('**单鲸版**：卖额 ≥1.0 BNB ∧ 最大卖家占 ≥30% ∧ 承接比 <0.5（不要求卖方 ≥4）')
    && esIns.includes('**连续两块臂**：「恶意砸块(相邻两block)」行同款四腿（合并口径）')
    && esIns.includes('承接比 ≥0.5=承接在场——砸掉的货有人接走=活跃盘正常换手/出货（照 normal_dip/flat 正常评估）')
    && esIns.includes('承接比 ? 且贴锚臂已见买入达三成上下（承接正在形成）、砸块行缺席=证据不足不落') && esIns.includes('任一腿不过线=不落（四腿联立宁漏不误伤）')
    && esIns.includes('本桶看砸完的余波结构（卖方组织性证据），crash 急跌进行时轴看此刻正在砸——两轴互补各自判')
    && esIns.includes('**贴锚砸盘臂（承接比 ? 形状的第四腿替代）**：砸块紧贴锚点（行内「距锚 <10 秒」=承接比观察窗未启、承接比恒 ?）时，第四腿承接改用「砸后已见买入」判')
    && esIns.includes('已见买入占砸卖额可忽略（参考 <30%）=砸完立刻把价格按到买点、尚无人接，第四腿成立同落本桶')
    && esIns.includes('已见买入达砸卖额三成上下=承接正在形成，第四腿不立'),
    'F: BP77+BP82 malicious_dump 独立桶题面（判轴分离声明+四腿联立+单鲸版+相邻两块臂+贴锚砸盘臂第四腿替代+承接反锚+宁漏不误伤+两轴互补）');
  ok(qs.entry_shape.criteria.malicious_dump.startsWith('恶意砸盘（单独桶——判轴=卖方阵列的块级结构证据，与 crash 价格拱形态判轴分离、不限临近段）')
    && qs.entry_shape.criteria.malicious_dump.includes('①砸块卖额 ≥0.5 BNB ②块内跌幅 ≥10% ③卖方 ≥4 钱包（剔路由，组织性阵列）④砸后 60s 承接比 <0.5')
    && qs.entry_shape.criteria.malicious_dump.includes('单鲸版（卖额 ≥1.0 BNB ∧ 最大卖家占 ≥30% ∧ 承接 <0.5，不要求卖方数）')
    && qs.entry_shape.criteria.malicious_dump.includes('**贴锚砸盘臂（第四腿替代——砸块距锚 <10 秒、承接比恒 ? 时）**：承接腿改用「砸后已见买入」判——已见买入占砸卖额 <30%（参考）=尚无人接，第四腿成立同落；已见买入达三成上下=承接正在形成不落')
    && qs.entry_shape.criteria.malicious_dump.includes('贴锚臂已见买入达三成、砸块行缺席或任一腿不过线的不落（宁漏不误伤）')
    && qs.entry_shape.criteria.malicious_dump.includes('不落时按判序继续 crash/两臂/spike 评估'),
    'F: criteria.malicious_dump 同步（独立桶判轴+四腿+单鲸版+相邻两块臂+BP82 贴锚臂+不落续判序）');
  ok(esIns.includes('malicious_dump=**砸块行四腿全中（单块卖 0.8 BNB、块内 -12%、卖方 5 钱包、承接比 0.3——组织性阵列砸盘无承接）／相邻两块合并 1.5 BNB、-15%、承接 0.2（接力砸拆块形状）／贴锚砸盘前三腿全中、距锚 3 秒承接比 ?、砸后已见买入 0.24 对砸卖 1.9（约 13% 无人接——砸完立刻把价格按到买点，贴锚臂照落）／砸块承接比 2.1 不落（砸掉的货有人接=正常换手）／贴锚砸盘距锚 8 秒承接比 ?、砸后已见买入 0.9 对砸卖 2.0（达四成——承接正在形成，贴锚臂不落）**'),
    'F: malicious_dump 形状样本五例（四腿全中/相邻两块/贴锚臂照落/承接 2.1 不落/贴锚承接形成不落——匿名例，BP82 贴锚两例新入）');
  ok(esIns.includes('形状样本（匿名）') && esIns.includes('拉顶后连续两个 5s 段 -16.9%/-16.1% 零反弹垂直砸落') && esIns.includes('尾 10s 零买纯卖可观推进的单边出货段（臂 A）') && esIns.includes('深段未收复 -42~-44 级深坑张着但尾 10s 买 0.12~2.0B 在场照放') && esIns.includes('深段距 16s 但 chg5/chg10 双 +14.3+未收复仅 -11.1 收复过半、离最低 +26.1 反弹进行时照放——臂 B 第一步反例') && esIns.includes('近窗 120s 双边巨量但尾 10s 零买'), 'F: entry_shape 形状样本（匿名例——crash 侧垂直砸落/单段直砸/臂 A 臂 B 样本+normal_dip 侧温和回踩/阶梯阴跌/买力在场照放/反弹进行时+spike 尖刺贴顶）');
  // ═══ 两臂判据全文（criteria.crash 承载）+急跌进行时+判例样本 ═══
  const esc = qs.entry_shape.criteria;
  ok(esc.crash.includes('两臂同落本桶：臂 A 本地买方缺席的单边下跌段**') && esc.crash.includes('「先买入拉起、然后只有卖出」') && esc.crash.includes('尾 10s 买归零/纯尘+卖可观推进') && esc.crash.includes('近 30~120s 买归零/买中位 0.0x 级纯小单而卖 ≥0.4 级') && esc.crash.includes('判读看「买入前一段时间（一批交易）」不只尾 10s') && esc.crash.includes('反例照放：尾段像样买单在场、近窗双边像样换手的不落臂 A'), 'F: 臂 A=本地买方缺席的单边下跌段（先买拉起后只有卖；尾 10s 买归零/纯尘+卖可观+近窗买也缺席；判读看买入前一段时间不只尾 10s；反例照放句在场）');
  ok(esc.crash.includes('**臂 B 近期暴跌后的余波小活跃（判序四步）**') && esc.crash.includes('**第一步先判「快速暴跌后的反弹阶段」**') && esc.crash.includes('chg5 转正（双正更坚）+未收复收窄到 **-20% 以内**') && esc.crash.includes('直接照放 normal_dip 不落本臂'), 'F: 臂 B 第一步=反弹两件套照放（chg5 转正+未收复收窄 -20 内=收复过半——反弹确立直接照放）');
  ok(esc.crash.includes('**第二步买入力在场豁免**') && esc.crash.includes('尾 10s 买入 ≥3 笔 ∧ 合计 ≥0.1 BNB 级') && esc.crash.includes('照放 normal_dip——买入力较拉盘期坍缩是下跌票的正常现象，判「还在不在」不判「比之前少多少」') && esc.crash.includes('打断家族（急跌进行时 chg5≈chg10 同深无铺垫，或趋势打断轴三口任一命中——摆点轴三腿联立/chg 同深轴/打断余波域，均含上升腿 ≥60s 且 ≥20% 形态前提）不被豁免——砸穿途中的买力是接刀，打断刚落地余波里的买力同样是接刀，唯一放行出口=第一步反弹两件套（秒级开盘脉冲上升腿 <60s 不在打断家族、照本步正常评买入力）'), 'F: 臂 B 第二步=买入力在场豁免（尾 10s 买 ≥3 笔 ∧ ≥0.1 BNB 照放——判「还在不在」不判「比之前少多少」；打断家族（三口任一，均含上升腿形态前提）不被本步豁免——唯一放行出口=第一步反弹两件套，秒级脉冲照本步评）');
  ok(esc.crash.includes('**第三步深段未收复坐实+买入力不在场才落本桶**') && esc.crash.includes('锚前 30s 内深 5s 段（-18% 级）') && esc.crash.includes('-20% 级以上未收复') && esc.crash.includes('尾 10s 买 <3 笔或 <0.1 BNB') && esc.crash.includes('**收复证据认第一步两件套或第二步买入力在场**') && esc.crash.includes('curVsMinGap 双位数在深坑张着时不单独豁免') && esc.crash.includes('判在场性看尾 10s 本地窗'), 'F: 臂 B 第三步+收复证据口径（深段 -18% 级+未收复 -20% 级+买力不在场才坐实；curVsMinGap 双位数不单独豁免；判在场性看尾 10s 本地窗不看近窗遗迹）');
  ok(esc.normal_dip.includes('尾段买入力在场') || esIns.includes('尾段买入力在场'), 'F: normal_dip 前提句含三态（无深段/反弹两件套/尾段买入力在场——单边出货段与买力已走的余波归 crash）');
  ok(esIns.includes('**突发砸落进行时同落本桶**') && esIns.includes('chg5Pct≈chg10Pct 同深=整个下跌就发生在眼下几秒') && esIns.includes('接刀进行时') && esIns.includes('例：+81.6% 高位横盘后买点前 5s 突发 -32%、chg5=chg10=-32.4 无铺垫'), 'F: crash 急跌进行时轴（chg5 深负+chg5≈chg10 同深无铺垫=刚开始砸——买点接在急跌进行中=接刀进行时非「跌过的位置」）');
  ok(esIns.includes('例：**暴跌回落到 almost_launch 区（curVs 仅 +6~+10%）也不是豁免理由**') && esIns.includes('价格回到发行价附近的方式是「正在暴跌」而非「跌完企稳」') && esIns.includes('chg5 -43、chg10 -40 同深差仅 3pp（无铺垫）、nearMaxDn5 -52') && esIns.includes('**回到 almost_launch 区（≤+10%）只说明位置低，不说明跌势已止**'), 'F: 暴跌回 almost_launch 区不豁免判例（位置低≠跌势已止——回发行价区的方式是「正在暴跌」非「跌完企稳」）');
  ok(esIns.includes('例：curVsAth -27.7 命中臂①+chg5 -22.3≈chg10 -20.3 同深差仅 2pp、买点前 1 秒 chg5 还是 +0.2（一秒内翻转 -22）') && esIns.includes('**幅度二十分级的接刀进行时照样砸：幅度浅不等于跌完了，同深无铺垫就是刚开始砸**'), 'F: 浅幅同深无铺垫判例（幅度二十分级的接刀进行时照样砸——一秒翻转是在场进行时的直接证据）');
  ok(esIns.includes('可接受的「跌」=已走完一段：chg5 收敛于 0 或为正、或 chg5 明显浅于 chg10（下跌主体在过去几秒而非眼下）') && esc.normal_dip.includes('前提=下跌已走完一段、此刻不在急跌进行中') && esc.crash.includes('买点时刻突发急跌进行时（chg5 深负+chg5≈chg10 同深无铺垫=刚开始砸）也落本桶'), 'F: 可接受的「跌」方向锚+两桶同步（chg5 收敛/为正或明显浅于 chg10；normal_dip 前提=跌完一段不在急跌进行中；criteria crash 急跌句同步）');
  ok(esIns.includes('**累计跌幅深也不等于砸盘、速度不急也不等于安全**') && esIns.includes('深坑张着的先查臂 B 第二步买入力在场性') && esIns.includes('反锚：①窗极短（各锚 ?/缺失）不判 crash/spike——判缺不猜'), 'F: 反锚段（窗极短判缺不猜；数值命中不等于 crash；累计深≠砸盘速度缓≠安全；深坑张着先查买力在场性）');
  ok(esIns.includes('怎么算：[PRECOMPUTED] 现价较锚窗最高价行（currentVsAthPct）+ 近窗动量行（chg30Pct）+ 临近段 5s 段最大涨/跌行（nearMaxUp5Pct/nearMaxDn5Pct）+ 发行价位置行的 curVsMinGapPct') && esIns.includes('**锚前尾段买卖对比(最后10秒)行（臂 A 主锚：买笔数/买额/卖额直供）+ 近期暴跌段(锚前30秒内最深5秒段)行（臂 B 主锚：段深度/距今秒数/未收复幅度直供）+ 恶意砸块行（malicious_dump 主锚：单 block/相邻两 block 卖额/块内跌幅/卖方数（剔路由）/最大卖家占比/砸后 60s 承接比/距锚秒数/砸后已见买入直供）+ 趋势打断行（趋势打断轴主锚：最近确认摆高点距今秒数/现价距摆高/上升腿涨幅与时长/chg5-chg10 差值直供——摆点轴与 chg 同深轴双载体）**'), 'F: entry_shape 怎么算=四键+四主锚直供（nearMax 双队列+curVsMinGap+尾段买卖对比行+近期暴跌段行+恶意砸块行（BP77+BP82 距锚/已见买入两键随行）+趋势打断行（摆点/chg 同深双载体+上升腿形态前提锚））');
  // ═══ famous 轴补充锚（主述断言见上文 famous 轴前置/③桶块——此处锁前置段与③桶的缝合点） ═══
  ok(mp.includes('退出臂评估**须并读③桶在场持有的厚薄分流**') && mp.includes('（例：出生数十秒 ultra 吞吐大量成交的盘面，famous 占比高但不是 famous 收割形状）'), 'F: 退出臂并读指针+厚度维度匿名例（退出臂评估须并读③桶厚薄分流防两段判读脱节；ultra 大量成交厚盘=famous 占比是换手结果非收割形状）');
  // 旧桶名全量绝迹（字符串层面——criteria 键域即 Jev Choice options，桶名不在=Jev 无法产出=unknown-bucket throw 兜底）
  ok(!JSON.stringify(qs).includes('early_sniper_decay') && !JSON.stringify(qs).includes('blended_unremarkable') && !JSON.stringify(qs).includes('golden_point') && !JSON.stringify(qs).includes('restart') && !JSON.stringify(qs).includes('strong_backer') && !JSON.stringify(qs).includes('sustained_climb'), 'F: 旧桶名全量绝迹（五判型桶+⑥持续拉升——桶名不在题面任何位置=Jev 无法产出，unknown-bucket throw 兜底防旧桶残留致幻）');
  // BP48 两质量题退役：QUALITY_LEVELS/QUALITY_IDS 双侧绝迹（ESM 题集+CJS mapper）；
  // ASSESSMENT_LEVELS 门域四值保留（bpPassLevels 消费域与历史 digest 行兼容不收窄）
  ok(!('QUALITY_LEVELS' in q) && !('QUALITY_IDS' in q), 'F: ESM 侧 QUALITY_LEVELS/QUALITY_IDS 常量绝迹（BP48 两质量题退役反证）');
  ok(JSON.stringify(ASSESSMENT_LEVELS) === JSON.stringify(['good', 'neutral', 'poor', 'insufficient']), 'F: ASSESSMENT_LEVELS 门域四值保留（bpPassLevels 消费域不动——good 不再产出但历史行重放兼容不收窄）');
  ok(ids.every((id) => DIMENSION_IDS.includes(id)) && DIMENSION_IDS.length === 6, 'F: 题集 id 与 mapper DIMENSION_IDS 对齐（6 维度 0 质量——BP58 entry_shape 入域+BP60 market_heat 出域）');
  // 拉高判据与忌讳救臂句随④桶/质量题退役绝迹（拦截归 entry_shape+统一位置门；snapshot 锚照算纯留档）
  ok(!JSON.stringify(qs).includes('maxChg5'), 'F: maxChg5 速度锚题面绝迹（拉高拦截归统一位置门+spike 判型；snapshot maxChg5Pct 锚照算照渲染纯留档——E 组「maxChg5Pct 锚透传」断言锁）');
  const noQuality = JSON.stringify(qs);
  ok(!noQuality.includes('第一分支·价格低救') && !noQuality.includes('累计位置硬腿') && !noQuality.includes('崩塌第一腿') && !noQuality.includes('庄盘豁免（BP32'), 'F: 早鸟/回调题忌讳救臂句绝迹（两质量题退役反证——救臂/忌讳/庄盘豁免链不迁移）');
  // ═══ activity_level（七要素+⑦定档主锚四臂+判序只压不抬） ═══
  const al = qs.activity_level;
  ok(al.instructions.includes('买入点位之前的盘面活跃度') && al.instructions.includes('判读倾向临近买入点位段'), 'F: activity_level 题头=买点前窗口+临近段倾向（买点发生在窗口末端，买点之前的盘面状态才是入场的直接承接环境）');
  ok(al.instructions.includes('近窗密度（win30/60 笔/分）作辅助证据并读'), 'F: activity_level 吸纳近窗密度视角（market_heat 退役后近窗密度并入 activity 判读作辅助证据）');
  for (const seg of ['无交易期占比', '笔密度', '买盘中位数为主、笔均为辅', '单向死水推进', '开盘极早窗反锚', '金额吞吐', '停滞突发反锚', '临近买入点位段（锚窗末端 30 秒=买点前最后 30 秒）', '全窗量级综合锚']) {
    ok(al.instructions.includes(seg), `F: activity_level 七要素+综合锚段在场：${seg.slice(0, 18)}`);
  }
  ok(al.instructions.includes('数值行「临近买点段」「锚前尾段」与「临近尾窗（尾 10 秒 / 此前 20 秒）」事实均已算好直接采信') && al.instructions.includes('尾窗按绝对位置取窗：窗口不足 30 秒时临近段行可能缺席，尾窗行仍有值'), 'F: activity ⑦消费 state 临近段/尾窗行（绝对位置取窗——短窗票临近段 null 盲区修复）');
  ok(al.instructions.includes('低档与超高档均由代码侧活跃度门直接消费拒买') && al.instructions.includes('超高=机器盘级极端密集——正常散户参与盘到不了这个密度'), 'F: activity 收尾=门消费声明（低=活跃度不够不参与；超高=机器盘级密度——只述档位不下入场结论）');
  ok(al.instructions.includes('三段形状（开局冲一波→中段完全静默→临近买点再集中涌入）同样属「静默后买入涌入」') && al.instructions.includes('判读锚定**买点时刻的即时状态**') && al.instructions.includes('中段静默的占比不压档') && al.instructions.includes('「先冲一波后静默」的不保护臂针对的是**涌入后再无交易持续到锚点**'), 'F: activity⑥反锚三段形状归属（静默居中的三段形状按「静默后买入涌入」中档起判；「先冲一波后静默」不保护臂只管涌入后死到锚点的形状——判读锚定买点时刻即时状态）');
  ok(al.instructions.includes('买点时刻盘面正被涌入激活（锚前尾段行=8 笔近 1 BNB 直接可见）'), 'F: activity 三段形状匿名例（锚前尾段行数值佐证——尾段行直供激活证据）');
  ok(al.instructions.includes('判读原料=**数值行「锚前尾段(最后5秒)」**') && al.instructions.includes('锚前尾段多笔且金额可观（参考 ≥3 笔/合计 ≥0.3 BNB 级）=锚点时刻正被流量激活的直接证据') && al.instructions.includes('三段形状判尾段行不判段内最大间隔') && al.instructions.includes('尾段仅 1 笔/合计尘级=锚点即静默边界'), 'F: activity⑥尾段行判读锚（临近段 totals 无时序测不出涌入在段尾；末行恒在尾段内最少 1 笔，死寂臂=仅 1 笔尘级非 0 笔）');
  ok(al.criteria.low.includes('临近买点段（最后 30 秒）') && al.criteria.low.includes('四腿联立'), 'F: activity low 桶=临近段死寂+全窗四腿联立双臂');
  ok(al.criteria.high.includes('金额吞吐与之相称') && al.criteria.high.includes('尘埃假活跃不入本档'), 'F: activity high 桶=吞吐相称门槛（尘埃假活跃不入高档）');
  // ═══ ⑦定档主锚四臂判读（判序：先⑦定基准档，全窗背景校验只压不抬） ═══
  ok(al.instructions.includes('定档主锚') && al.instructions.includes('四臂判读（按「协同出货→衰减→密集→死寂」序逐臂判定'), 'F: ⑦定档主锚+四臂判序声明（均不命中按全窗+临近段综合要素定档）');
  for (const seg of ['协同出货（出货臂）→超高', '临近衰减（衰减臂）→至多中', '临近仍活（密集臂）→至少高', '临近死寂（死寂臂）→低']) {
    ok(al.instructions.includes(seg), `F: 四臂段在场：${seg.slice(0, 12)}`);
  }
  ok(al.instructions.includes('多个独立钱包（参考 ≥10 个）几乎纯卖出') && al.instructions.includes('照实落超高（档位只述节奏事实，买卖失衡的成色归盘型题判读、不因失衡降档') && al.criteria.ultra.includes('不因买卖失衡降档'), 'F: 协同出货臂（末 10s ≥10 独立卖侧钱包几乎纯卖+买入趋零 → ultra——档位只述节奏事实）');
  ok(al.instructions.includes('**本臂两腿（协同钱包数+买入趋零）须同时坐实，卖家数贴线而买侧双向在场的不是协同出货**') && al.instructions.includes('（例：尾窗每秒 1~2 笔、卖 11 钱包约 1.2 BNB 对买 8 钱包约 0.6 BNB 双边在场——正常换手密度曾被误判超高）'), 'F: 协同出货臂两腿同坐实（卖家数贴线而买卖双边在场=正常换手密集按密度臂评——匿名例锚定误判形状）');
  ok(al.instructions.includes('**密度臂的参考线**：超高=几乎无空窗的极端密集——每秒十笔级连绵落地（真实样本协同出货例尾 5 秒 72 笔每秒 14+）；每秒 1~2 笔、尾 10 秒二十笔上下的常见换手密度最多高档、不是超高'), 'F: 密度臂数值参考线（超高=每秒十笔级；1~2 笔/秒常见换手至多高档——判读重心移近买点≠把普通换手段拔成 ultra）');
  ok(al.instructions.includes('末 10 秒吞吐较此前 20 秒断崖跌落（跌去大半）') && al.instructions.includes('全窗密集不救临近衰减') && al.instructions.includes('档位至多「中」'), 'F: 衰减臂（断崖+尾 5s 趋零 → 至多中——全窗密集不救临近衰减）');
  ok(al.instructions.includes('临近段吞吐可观（参考 ≥2~3 BNB/分钟）') && al.instructions.includes('**尾 5 秒仍有真实买入**') && al.instructions.includes('注意 AMM/曲线池语境下卖出恒被池子接走、不构成对手方在场的证据，买入方向才是买方需求在场'), 'F: 密集臂真实买入腿（吞吐可观+未断崖+尾 5s 真实买入 → 至少高；AMM 卖出恒成交≠对手方在场）');
  ok(al.instructions.includes('临近死寂（死寂臂）→低') && al.instructions.includes('注意尘单滴答会不断打破时间静默——①的静默占比对「开盘密集→临近只剩尘单滴答」的形状失明'), 'F: 死寂臂+尘单滴答失明补位（临近段中位/吞吐暴露金额死寂——静默占比对尘单滴答形状失明）');
  ok(al.instructions.includes('先按⑦定基准档，再以全窗要素做背景校验——校验只压不抬'), 'F: 判序句（⑦定基准档+全窗背景校验只压不抬——全窗密集不救临近衰减/全窗稀疏不抹临近真实涌入）');
  ok(al.criteria.ultra.includes('协同出货') && al.criteria.mid.includes('临近衰减') && al.criteria.high.includes('尾 5 秒仍有真实买入') && al.criteria.low.includes('不救临近死寂') && al.criteria.low.includes('见题面⑦衰减臂'), 'F: criteria 四桶同步四臂句');
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
  ok(hc2.instructions.includes('本豁免只豁本题（holder 集中轴），不豁盘型题的 famous 判读') && hc2.instructions.includes('famous 集团控盘是组织行为问题，不因价格低而豁免'), 'F: holder_concentration 豁免⑥限定 holder 轴（价格豁免不外溢 famous 判读——组织行为不因价格低豁免）');
  ok(hc2.instructions.includes('对照（价格豁免正例）') && hc2.instructions.includes('56.5%') && hc2.instructions.includes('价格豁免生效不坐实 strong、落观察档'), 'F: holder_concentration 形状样本含价格豁免正例（6~9 过线+佐证但 almost_launch 区内贴发行价→豁免落观察档）');
  ok(hc2.instructions.includes('top1 单一 >90%') && hc2.instructions.includes('一人控盘'), 'F: holder_concentration 一人控盘例外（≤5 豁免域破例 strong）');
  ok(hc2.instructions.includes('strong 档由代码侧筹码门直接消费（门当前停用、答案照判落档）'), 'F: holder_concentration 收尾=门消费声明（筹码门停用如实陈述，答案照判落档）');
  ok(hc2.instructions.includes('某票 29 个钱包买过、正净持有仅 3 人') && hc2.instructions.includes('23 个正净持有者的盘第一大占流通 73%'), 'F: holder_concentration 形状样本双对照（一人控盘+参与/持有分叉极端 vs ≥10 持有者单一 >45% 过线坐实——匿名化保留形状+数值）');
  // BP30 改六 tree_position/追高题退役+BP48 两质量题退役——四题题面整链绝迹（反证）
  ok(!('tree_position' in qs) && !('high_chase_quality' in qs) && !('early_bird_quality' in qs) && !('pullback_entry_quality' in qs), 'F: BP30/BP48 四题绝迹（tree_position/high_chase/early_bird/pullback_entry 题面/桶域/常量整链删除）');
  ok(!JSON.stringify(qs).includes('tree_position') && !JSON.stringify(qs).includes('high_chase') && !JSON.stringify(qs).includes('圣诞树视角'), 'F: 全题集文本 tree_position/high_chase/圣诞树视角字样绝迹（BP30/BP48 退役反证）');

  // ═══════════════ F2. BP79（bt-v104 R1 三件）：⑨phaseSplit/在场三分/趋势打断 ═══════════════
  console.log('F2. BP79 ⑨买期/卖期分界+大户在场三分+趋势打断行');
  const W_Q = '0x' + '33'.repeat(20), W_R = '0x' + '44'.repeat(20), W_P = '0x' + '55'.repeat(20);
  // ⑨形状缩微（SAMSUNG 形状骨架）：纯买期 3 笔 0.9 → 尘卖探路（不算首卖）→ 首笔像样卖@10
  // → 尾段尘级买（不计）+同块 3 笔捆绑分仓
  const rows79 = [
    row(2, 'BUY', W_B, 0.4, 1.0 * E9, 4e8),
    row(5, 'BUY', W_C, 0.3, 1.05 * E9, 2.9e8),
    row(8, 'BUY', W_D, 0.2, 1.1 * E9, 1.8e8),
    row(9, 'SELL', W_D, 0.005, 1.1 * E9, 4.5e6),                                   // 尘级探路卖（<0.01）不打断轴
    row(10, 'SELL', W_B, 0.25, 1.08 * E9, 2.3e8),                                  // 首笔像样卖
    row(12, 'SELL', W_B, 0.15, 1.0 * E9, 1.5e8),
    row(14, 'BUY', W_E, 0.039, 0.99 * E9, 3.9e6, { block: 9900 }),                 // 尘级买（<0.05 不计买卖期）
    row(16, 'BUY', W_F, 0.1, 0.98 * E9, 1.0e7, { block: 9900 }),                   // 同块=捆绑分仓
    row(18, 'BUY', W_G, 0.12, 0.97 * E9, 1.2e7, { block: 9900 }),
  ];
  const d79 = buildBuyPointSnapshot(rows79, metaA).buyDerived;
  const ps79 = d79.phaseSplit;
  ok(ps79 && ps79.firstSellDt === 10 && ps79.secSinceFirstSell === 8,
    `F2: phaseSplit 首卖@t+10s/距今 8s（尘卖 0.005 不算首卖——探路碎卖不打断轴；实际 ${ps79 && ps79.firstSellDt}/${ps79 && ps79.secSinceFirstSell}）`);
  ok(ps79 && near(ps79.preBuyBnb, 0.9) && ps79.preBuyN === 3 && ps79.preDustSellN === 1 && ps79.preDustBuyN === 0,
    `F2: 首卖前纯买期=0.9×3+尘卖 1 笔计观测（实际 ${ps79 && ps79.preBuyBnb}/${ps79 && ps79.preBuyN}/${ps79 && ps79.preDustSellN}）`);
  ok(ps79 && near(ps79.preBuySharePct, 80.4) && near(ps79.postBuyBnb, 0.22) && ps79.postBuyN === 2
    && near(ps79.postSellBnb, 0.4) && ps79.postSellN === 2,
    `F2: 占比 80.4%（0.9/1.12）+首卖后买 0.22×2（尘买 0.039 不计）/卖 0.4×2（实际 ${ps79 && ps79.preBuySharePct}/${ps79 && ps79.postBuyBnb}/${ps79 && ps79.postSellBnb}）`);
  ok(ps79 && ps79.postBundledBlock && ps79.postBundledBlock.n === 3 && near(ps79.postBundledBlock.buyBnb, 0.259) && ps79.postBundledBlock.block === 9900,
    `F2: 首卖后最大同块买入=块 9900×3 笔 0.259（含尘买 0.039——pbb 口径与 BP73 bundledBlock 同款无尘门，判读归题面；实际 ${JSON.stringify(ps79 && ps79.postBundledBlock)}）`);
  const st79 = buildBuyPointState(buildBuyPointSnapshot(rows79, metaA)).state;
  ok(st79.includes('买期/卖期分界(首笔像样卖@t+10s): 首卖距今买点 8s')
    && st79.includes('尘门后买入 0.900×3（另有尘级买 0 笔/尘级卖 1 笔不计）、占全窗尘门后买入 80.4%')
    && st79.includes('首卖后 买入 0.220×2 / 卖出 0.400×2、卖占首卖后成交 64.5%')
    && st79.includes('最大同块买入合计 0.259 BNB×3 笔（同块捆绑=组织性分仓，不是换手承接）')
    && st79.includes('卖期卖占绝对主导〔参考 ≥80%，买卖同量级交织（2:1 级）不算卖期〕'),
    'F2: state 买期/卖期分界行渲染（⑨主锚直供——首卖位置/纯买期/首卖后结构/捆绑分仓+BP83 卖占首卖后成交 64.5% 主导比直供与提示句同构）');
  // 零像样卖（全买盘）→ phaseSplit null=⑨轴不适用；state 行缺席
  const rows79No = [
    row(2, 'BUY', W_B, 0.4, 1.0 * E9, 4e8),
    row(5, 'BUY', W_C, 0.3, 1.05 * E9, 2.9e8),
    row(8, 'BUY', W_D, 0.2, 1.1 * E9, 1.8e8),
    row(12, 'BUY', W_E, 0.25, 1.0 * E9, 2.5e8),
  ];
  const d79No = buildBuyPointSnapshot(rows79No, metaA).buyDerived;
  ok(d79No.phaseSplit === null, 'F2: 零像样卖 → phaseSplit null（全窗都是买期=⑨轴不适用，宁缺不冒充）');
  ok(!buildBuyPointState(buildBuyPointSnapshot(rows79No, metaA)).state.includes('买期/卖期分界'), 'F2: state 分界行缺席（null 不渲染）');
  // mapper anchors 透传（flattened 十键）
  const obs79 = buildBuyPointObservation({}, buildBuyPointSnapshot(rows79, metaA).buyDerived);
  ok(obs79.anchors.phaseSplitSecSinceFirstSell === 8 && obs79.anchors.phaseSplitPreBuyBnb === 0.9
    && obs79.anchors.phaseSplitPreBuyN === 3 && obs79.anchors.phaseSplitPreBuySharePct === 80.4
    && obs79.anchors.phaseSplitPostBuyBnb === 0.22 && obs79.anchors.phaseSplitPostSellBnb === 0.4
    && obs79.anchors.phaseSplitPostBundledBnb === 0.259 && obs79.anchors.phaseSplitPostBundledN === 3,
    'F2: mapper anchors phaseSplit 族透传（⑨主锚 digest 落档+res.anchors 审计读数）');
  const obs79No = buildBuyPointObservation({}, buildBuyPointSnapshot(rows79No, metaA).buyDerived);
  ok(obs79No.anchors.phaseSplitSecSinceFirstSell === null && obs79No.anchors.phaseSplitPostBundledBnb === null,
    'F2: phaseSplit null 时 anchors 族全 null（不冒充）');
  // 在场三分（蝴蝶案形状）：挂账沉默（末动 >120s）/活跃在场（≤120s）/清仓离场（净 ≤0.005）
  const rows79W = [
    row(10, 'BUY', W_Q, 0.198, 1.0 * E9, 2e8),                    // 挂账：末动距 tEnd 205s >120
    row(50, 'BUY', W_R, 0.3, 1.05 * E9, 2.9e8),
    row(60, 'SELL', W_R, 0.3, 1.05 * E9, 2.9e8),                  // 离场：净 0
    row(200, 'BUY', W_P, 0.2, 1.1 * E9, 1.8e8),                   // 活跃：末动距 tEnd 15s
    row(215, 'BUY', W_P, 0.05, 1.12 * E9, 4.5e6),
  ];
  const st79W = buildBuyPointState(buildBuyPointSnapshot(rows79W, metaA)).state;
  ok(st79W.includes('单笔 ≥0.19 的钱包 3 个') && st79W.includes('活跃在场（净 >0 且末动距今 ≤120s）的单笔 0.2 级钱包 1 个'),
    'F2: 在场三分行渲染（3 个 0.2 级钱包中活跃在场仅 1——挂账/离场不算在场）');
  ok(st79W.includes('距今205s）[挂账在场]') && st79W.includes('[活跃在场]') && st79W.includes('[离场]'),
    'F2: 每钱包分类标签直供（活跃在场/挂账在场/离场三态+末动距今秒）');
  ok(st79W.includes('判序线=活跃在场 ≥2 个（或单笔 0.3+ 活跃在场）才算大户参与；挂账在场（末动距今 >120s 的沉默持仓）与已清仓离场都不算在场'),
    'F2: 判序线句=活跃在场口径（蝴蝶案 0.20/0.198 挂账沉默不构成大户参与——bt-v104 R1 立法）');
  // 趋势打断行（闪崩判轴直供）
  const rows79S = [
    row(0, 'BUY', W_B, 0.3, 1.0 * E9, 3e8),
    row(5, 'BUY', W_C, 0.3, 1.5 * E9, 2e8),                       // 摆高点 1.5（+50% 拉起）
    row(12, 'SELL', W_D, 0.2, 1.05 * E9, 1.9e8),                  // -30% 砸落 → 摆高确认@dt5
    row(15, 'SELL', W_D, 0.2, 0.9 * E9, 2.2e8),                   // 现价 0.9=距摆高 -40%
  ];
  const snap79S = buildBuyPointSnapshot(rows79S, metaA);
  const st79S = buildBuyPointState(snap79S).state;
  ok(st79S.includes('趋势打断: 最近确认摆高点距今 10s、现价距该摆高 -40.0%'),
    'F2: 趋势打断行摆点轴渲染（刚确认摆高 10s 前现价距峰 -40%——「涨着涨着一下子闪崩」直供）');
  ok(st79S.includes('上升腿（前一确认摆低/序列起点→摆高）+50.0%/5s') && st79S.includes('形态前提=上升腿是有一定时长的持续上涨（参考 ≥60s 且涨幅 ≥20%）'),
    'F2: 趋势打断行上升腿直供+形态前提句（c84a 7s/+92.8% 秒级开盘脉冲≠「涨着涨着」——bt-v104 R1 二修：形态本身不一致，不是买力豁免拆层）');
  ok(snap79S.buyDerived.swingRisePct === 50 && snap79S.buyDerived.swingRiseSec === 5,
    'F2: swingRisePct/RiseSec digest 键（buyDerived 摆高上升腿涨幅/时长——series 起点→首个确认摆高）');
  // 上升腿取「前一确认摆低」路径（事故现场反证：points 元素字段=price 非 priceBnb，
  // 首版误读 priceBnb → risePct 恒 null → 蝴蝶人生路 286s 分钟腿涨幅显示 ? 不落摆点轴）
  const rows79L = [
    row(0, 'BUY', W_B, 0.3, 2.0 * E9, 3e8),
    row(10, 'SELL', W_D, 0.2, 1.5 * E9, 4e8),                   // 跌 → runMin=1.5@dt10
    row(20, 'BUY', W_C, 0.3, 1.9 * E9, 3.5e8),                  // 从低回升 +26.7% → 确认 low@dt10，dir=1
    row(130, 'BUY', W_C, 0.3, 3.0 * E9, 3e8),                   // 持续拉涨 ext=3.0（+100% 上升腿）
    row(140, 'SELL', W_D, 0.2, 2.1 * E9, 4.3e8),                // -30% → 确认 high@dt130，现价距峰 -30%
  ];
  const snap79L = buildBuyPointSnapshot(rows79L, metaA);
  ok(snap79L.buyDerived.swingRisePct === 100 && snap79L.buyDerived.swingRiseSec === 120,
    'F2: swingRise 前一确认摆低路径（legFrom=low point 取 price 字段——蝴蝶人生路 286s 分钟腿形状：+100%/120s）');
  ok(st79S.includes('打断家族（摆点轴/chg 同深/打断余波三口，均含上升腿形态前提）命中唯一放行出口=反弹两件套（chg5 转正∧未收复收窄 -20 内）；「买入力在场」豁免对打断家族不适用——砸穿途中/刚落地余波里的买力是接刀不是承接'),
    'F2: 趋势打断行带判序句（打断家族三口命中唯一放行出口=反弹两件套、买入力在场豁免不适用——R1 三修封口，BP74 赵公主先例延伸）');
  ok(st79S.includes('摆高距今可超 60s（峰后横盘无 20% 摆动确认=摆高停旧）时看打断余波口：上升腿 ≥60s∧≥20% 结束后锚前 30s 内 ≥15% 深段且未收复 ≤-20（近期暴跌段行）=打断刚落地的余波，同属打断家族'),
    'F2: 趋势打断行打断余波口指引（摆高停旧形状不看摆高距今看打断事实本身——苹果SI 375s 涨 70%→横盘 140s→22s 砸 -31% 摆高被横盘拉旧盲区）');
  const rows79C = [
    row(0, 'BUY', W_B, 0.3, 1.0 * E9, 3e8),
    row(1, 'BUY', W_C, 0.3, 1.0 * E9, 3e8),
    row(4, 'BUY', W_D, 0.2, 1.0 * E9, 2e8),
    row(10, 'SELL', W_E, 0.2, 0.83 * E9, 2.4e8),                  // chg5=-17（窗内无更早价自首可靠价起算）但距 runMax -17 <20 → 无摆点
  ];
  const st79C = buildBuyPointState(buildBuyPointSnapshot(rows79C, metaA)).state;
  ok(st79C.includes('趋势打断: 无确认摆点（新票/单边行情——摆动轴不适用，由 chg 同深轴判）')
    && st79C.includes('chg5 与 chg10 差 '),
    'F2: 趋势打断行 chg 同深轴变体（swing null 新票由 chg5-chg10 差值判——赵公主 age 20s 无摆点形状）');
  const rows79F = [
    row(0, 'BUY', W_B, 0.3, 1.0 * E9, 3e8),
    row(10, 'BUY', W_C, 0.3, 1.02 * E9, 2.9e8),
    row(20, 'BUY', W_D, 0.2, 0.99 * E9, 2e8),
    row(30, 'BUY', W_E, 0.2, 1.0 * E9, 2e8),
  ];
  ok(!buildBuyPointState(buildBuyPointSnapshot(rows79F, metaA)).state.includes('趋势打断'),
    'F2: 平静盘趋势打断行缺席（无摆点且 chg5 >-15——两载体都缺席不渲染，近窗动量行兜底）');
  // 题面 BP62 三件判据锁定（⑨分界行主锚/②活跃在场/趋势打断轴）
  const mp79 = qs.market_pattern.instructions;
  ok(mp79.includes('买期/卖期分界') && mp79.includes('首卖前纯买期') && mp79.includes('卖期在买点前夕刚启动') && mp79.includes('无对倒换手'),
    'F2: ⑨题面三要件在场（用户语义立法：买前基本只有买∧买点时卖刚启动∧本质无对倒换手）');
  ok(mp79.includes('**在场=活跃在场**：净持仓 >0 且末动距今 ≤120 秒') && mp79.includes('挂账在场（净 >0 但末动距今 >120s 的沉默持仓）与已清仓离场都不算在场') && mp79.includes('末动距今 452s/211s=挂账沉默，不算'),
    'F2: ②第二步题面=活跃在场口径（末动 452s/211s 挂账例句在场）');
  const es79 = qs.entry_shape.instructions;
  ok(es79.includes('趋势打断轴（swing 摆点直供') && es79.includes('最近确认摆高点距今 ≤60 秒') && es79.includes('现价距该摆高 ≤-25%')
    && es79.includes('形态前提——摆高前上升腿（前一确认摆低/序列起点→摆高，行内直供涨幅与时长）是有一定时长的持续上涨（参考 ≥60s 且涨幅 ≥20%）')
    && es79.includes('秒级开盘脉冲（上升腿 <60s，如十几秒内翻倍后回落）不算「涨着涨着」'),
    'F2: crash 趋势打断轴题面（摆点轴三腿联立含形态前提+用户裁定维持 crash 桶——散卖/薄盘闪崩不需组织性证据、不受 BP78 交易额豁免误放）');
  ok(es79.includes('按三口互补判读') && es79.includes('打断余波域（摆高停旧形状——峰后横盘期无 20% 摆动确认，最近确认摆高被横盘拉旧、距今可超 60 秒）')
    && es79.includes('改看打断事实本身——上升腿 ≥60s 且 ≥20%（行内直供）的持续上涨结束后，锚前 30s 内出现 ≥15% 深 5s 段且现价距段起点未收复 ≤-20'),
    'F2: 趋势打断轴三口化（①摆点轴②chg 同深轴③打断余波域——摆高停旧不看摆高距今看打断事实本身，苹果SI 盲区立法）');
  ok(es79.includes('打断家族（上述三口任一命中，均含上升腿形态前提）的唯一放行出口=臂 B 第一步反弹两件套（chg5 转正∧未收复收窄 -20 内）；臂 B 第二步「买入力在场」豁免对打断家族不适用')
    && es79.includes('chg5 -44.7≈chg10 -41.7'),
    'F2: 打断家族唯一放行出口题面句（第二步买入力豁免不适用——赵公主先例数值锚在场；R1 三修用户裁定「打断家族不豁免，加吧」）');
  ok(es79.includes('不得以「盘面有换手/活跃度高」为由放行打断家族的票') && es79.includes('换手豁免只适用于下跌已走完的形状，不适用于正在被打断/刚被打断的趋势'),
    'F2: 打断家族换手豁免封口句（换手豁免只适用于跌完的形状——蝴蝶人生路摆点轴三腿全中仍被买力豁免吐出案封口）');
  ok(es79.includes('**打断家族不被本步豁免**——打断家族=急跌进行时（chg5 深负且 chg5≈chg10 同深无铺垫）∨ 趋势打断轴三口任一命中')
    && es79.includes('**唯一放行出口=第一步反弹两件套**（秒级开盘脉冲上升腿 <60s 不在打断家族——照本步正常评买入力，在场照放）'),
    'F2: 臂 B 第二步边界①打断家族段（打断刚落地余波里的买力是接刀；秒级脉冲不在打断家族照本步评买入力）');
  ok(es79.includes('打断家族形状不在除外内——打断刚落地余波里的买力是接刀，见趋势打断轴')
    && es79.includes('打断家族（急跌进行时/趋势打断三口任一）的照 crash 维持且第二步买入力在场不豁免'),
    'F2: 安全臂除外句限定+反锚②打断家族维持句（两处同步封口——打断家族不被任何豁免出口吐出）');
  ok(qs.market_pattern.criteria.one_wave_dump.includes('买期/卖期分界') && qs.market_pattern.criteria.retail_pvp.includes('活跃在场'),
    'F2: criteria 两桶同步（one_wave_dump 分界行/retail_pvp 活跃在场口径）');

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
