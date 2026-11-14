#!/usr/bin/env node
/**
 * BP launch 族口径锁单测——零 DB 零网络。
 *
 * 案史：CD382 盘面重置截窗（2026-11-08）曾以 computeMarketResetIndex
 * （cheat-snapshot.js）与 BP44 minVsLaunchPct（buy-point-snapshot.js）构成**双向
 * 口径锁**；**CD393（2026-11-09 用户裁定「把『代币价格跌到底 ticks 截断』这个策略
 * 去掉吧，否则 ticks 不够，更买入不了了」，6a1e4567 案）CD 侧整链退役**——
 * service 5b 截窗+CD384 reset_insufficient 硬拒+computeMarketResetIndex 函数本体
 * 全删，cheat 判定回到锚截窗全窗口径（天然 insufficient_ticks fail-open）。
 *
 * 本文件现锁 **BP 侧存量口径**（不受 CD393 影响）：BP 锚窗从不受 CD 截断影响，
 * minVsLaunchPct 仍是 restart 桶（⑦）判定源+常量锚行为+T138 地板回退（T130/T134 退役）。失败 exit 非零。
 */

const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot');

let passed = 0;
function ok(cond, label) {
  if (!cond) {
    console.error(`\n❌ FAIL: ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`  ✓ ${label}`);
}
const near = (a, b, eps = 1e-12) => Math.abs(a - b) < eps;

// ── 行工厂（DB 形状；与 _test_buy_point_lib.row 同款）──
const E9 = 1e-9;
const T0 = '2026-11-03T10:00:00.000Z';
const at = (dt) => new Date(Date.parse(T0) + dt * 1000).toISOString();
function row(dt, price, opts = {}) {
  return {
    block_time: at(dt), block_number: 1000 + dt, log_index: 0,
    trade_type: 'buy', bnb_amount: 0.1, token_amount: 1e8,
    price_bnb: price, price_outlier: opts.outlier === true,
    trader_address: `0x${String(dt % 7)}`.padEnd(42, '0'),
    sender_address: `0x${String(dt % 7)}`.padEnd(42, '0'),
    tx_hash: '0x' + String(dt), quote_token: null,
  };
}
/** 价格轨迹 → 行集（dt 递增=链上真序） */
function traj(prices) { return prices.map((p, i) => row((i + 1) * 10, p)); }

// platform 刻意不设：B 段=旧口径（首可靠价+launchCovered 门）回归 bit 锁；
// 常量平台锚行为锁在 C 段
const metaBP = { address: '0x' + 'ab'.repeat(20), symbol: 'T', name: 'T', createdAt: T0, creatorAddress: null, totalSupply: 1e9 };

// ═══════════════ A. BP44 minVsLaunchPct 七形状（涨起后定义，案号 BP39/BP44）═══════════════
console.log('A. BP44 minVsLaunchPct 口径锁（CD393 后 BP 侧独存——restart 桶判定源）');
{
  // BP 侧锚窗=近窗（buildBuyPointSnapshot 内部再截 launchCovered 判出生段覆盖）；
  // 本段构造首行 dt≤90 全程短窗=launchCovered 恒真。上界 2026-11-09 almost 20→10。
  const shapes = [
    { name: 'dR 回到 +5', prices: [1.0, 1.4, 2.0, 1.3, 1.05, 1.3], expectBp: 5 },
    { name: 'dMono 没回到 +20', prices: [1.0, 1.2, 1.5, 1.8], expectBp: 20 },
    { name: 'dNH 创新高重启 +5', prices: [1.0, 1.5, 1.1, 1.05, 1.6], expectBp: 5 },
    { name: 'dStay 从未离开 null', prices: [1.0, 1.05, 1.08, 1.05], expectBp: null },
    { name: 'dA 涨起后最低 +20', prices: [1.0, 1.0, 1.2, 1.3, 1.4, 1.5], expectBp: 20 },
    { name: '恰回到 +10', prices: [1.0, 1.5, 1.1], expectBp: 10 },
    { name: '破发回到 −10', prices: [1.0, 1.5, 0.9], expectBp: -10 },
  ];
  for (const s of shapes) {
    const rows = traj(s.prices.map((p) => p * E9));
    const bp = buildBuyPointSnapshot(rows, metaBP).buyDerived.minVsLaunchPct;
    ok(bp === s.expectBp,
      `BP ${s.name}：minVsLaunchPct=${s.expectBp}（实际 ${bp}）`);
  }
}

// ═══════════════ B. 平台常量锚（2026-11-08 发行价口径修正）═══════════════
console.log('B. 常量锚（four.meme 主流档 4.496173469e-9——恒有效不依赖 launchCovered）');
{
  const FM = 4496173469e-18;
  const metaConst = { ...metaBP, platform: 'fourmeme' };
  // B1 锚窗不含出生段（首行 dt=100 > 90 → launchCovered=false）——常量平台下
  // 锚恒有效：价格轨迹=常量×[1.5, 1.05, 2.0, 1.3, 1.102, 1.3]（首行=滑点后的中途价）
  // → minVsLaunchPct=涨起后最低 1.05×FM 较常量=+5（旧口径下 launchCovered=false
  // → 全族 null=截窗不冒充——常量锚消除该失明）
  const mult = [1.5, 1.05, 2.0, 1.3, 1.102, 1.3];
  const rowsC = mult.map((m, i) => row(100 + i * 10, FM * m));
  const bdC = buildBuyPointSnapshot(rowsC, metaConst).buyDerived;
  ok(bdC.launchPriceBnb === FM,
    `B1 BP 常量锚原值（launchCovered=false 仍有效；实际 ${bdC.launchPriceBnb}）`);
  ok(bdC.minVsLaunchPct === 5,
    `B1 BP 涨起后最低=+5（首行 1.5 已突破 → 段最低=全行最低 1.05×FM；实际 ${bdC.minVsLaunchPct}）`);
  ok(bdC.currentVsLaunchPct === 30,
    `B1 BP currentVsLaunchPct=+30（1.3×FM；实际 ${bdC.currentVsLaunchPct}）`);

  // B2 T138 地板回退（2026-11-14 用户裁定「以 配置价/发布价 最低点位为准」）：
  // T130 首买地板+T134 滚动地板整体退役——launch 锚恒=常量。夹具=低开 −20% 形状
  //（6efa11ce 同款，T130 立法案形状）：首笔 buy 0.8×FM、现价 1.0×FM → 回退后
  // currentVsLaunchPct=0 常量口径（T130/T134 时代曾显 +25——低锚抬涨幅的误伤面
  // 反证：正是「价格略高一点买入不进来」的机理反向）
  const rowsLow = [0.8, 1.0, 0.9, 1.0].map((m, i) => row((i + 1) * 10, FM * m));
  const bdLow = buildBuyPointSnapshot(rowsLow, metaConst).buyDerived;
  ok(bdLow.launchPriceBnb === FM,
    `B2 T138 低开票 launch=常量原值（回退；实际 ${bdLow.launchPriceBnb}）`);
  ok(bdLow.currentVsLaunchPct === 0,
    `B2 T138 低开票 currentVsLaunchPct=0 常量口径（T130 地板时代曾 +25；实际 ${bdLow.currentVsLaunchPct}）`);

  // B3 高开票：全程 [1.5, 1.2, 1.3]×FM 均 > 常量 → launch=常量原值（回退前后
  // 同值——地板 min 语义只降不升从未作用于高开票）
  const rowsHigh = [1.5, 1.2, 1.3].map((m, i) => row((i + 1) * 10, FM * m));
  const bdHigh = buildBuyPointSnapshot(rowsHigh, metaConst).buyDerived;
  ok(bdHigh.launchPriceBnb === FM,
    `B3 高开票 launch=常量原值（回退前后同值；实际 ${bdHigh.launchPriceBnb}）`);
  ok(bdHigh.minVsLaunchPct === 20,
    `B3 高开票 minVsLaunchPct=+20（1.2×FM 段最低 ÷ 常量；实际 ${bdHigh.minVsLaunchPct}）`);

  // B4 T138 回退后运行期新低不动锚（T134 案主形状反向锁定）：[1.5, 0.9, 1.0]×FM
  // 高开后跌出 0.9×FM 新低 → 回退后 launch 恒常量；minVsLaunchPct=涨起后最低
  // 0.9×FM 较常量 −10（T134 滚动地板时代分母=0.9×FM 显 0）；currentVs=1.0×FM → 0
  const rowsFall = [1.5, 0.9, 1.0].map((m, i) => row((i + 1) * 10, FM * m));
  const bdFall = buildBuyPointSnapshot(rowsFall, metaConst).buyDerived;
  ok(bdFall.launchPriceBnb === FM,
    `B4 T138 运行期新低不动锚 launch=常量（T134 时代曾 0.9×FM；实际 ${bdFall.launchPriceBnb}）`);
  ok(bdFall.minVsLaunchPct === -10,
    `B4 T138 minVsLaunchPct=-10（0.9×FM ÷ 常量；T134 时代曾 0；实际 ${bdFall.minVsLaunchPct}）`);
  ok(bdFall.currentVsLaunchPct === 0,
    `B4 T138 currentVsLaunchPct=0（1.0×FM ÷ 常量；T134 时代曾 +11.1；实际 ${bdFall.currentVsLaunchPct}）`);

  // B4b 中途窗（launchCovered=false 截窗不含出生段）：常量锚恒有效不依赖
  // launchCovered（T130 时代保护门+T134 窗内 min 已全随回退退役）——夹具=低开
  // 形状首行 dt=100 → launch=常量原值
  const rowsLate = [0.8, 0.9, 1.0].map((m, i) => row(100 + i * 10, FM * m));
  const bdLate = buildBuyPointSnapshot(rowsLate, metaConst).buyDerived;
  ok(bdLate.launchPriceBnb === FM,
    `B4b T138 中途窗 launch=常量原值（实际 ${bdLate.launchPriceBnb}）`);

  // B5 flap quote 盘=FL 常量（2026-11-09 同常量裁定）；gang 无常量=旧口径
  const FL = 6.14 / (107036752 + 1e9);
  const rowsQ = [1.0, 1.1].map((m, i) => row((i + 1) * 10, FL * m));
  const bdQ = buildBuyPointSnapshot(rowsQ.map((r) => ({ ...r, quote_token: '0xquote' })), { ...metaBP, platform: 'flap' }).buyDerived;
  ok(bdQ.launchPriceBnb === FL,
    `B5 flap quote 盘=FL 常量（实际 ${bdQ.launchPriceBnb}）`);
  const bdG = buildBuyPointSnapshot(rowsC, { ...metaBP, platform: 'gang' }).buyDerived;
  ok(bdG.launchPriceBnb === null,
    `B5 gang=旧口径（无常量+launchCovered=false → null 截窗不冒充；实际 ${bdG.launchPriceBnb}）`);
}

console.log(`\n✅ _test_cheat_market_reset 全过（${passed} 断言）`);
