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
 * minVsLaunchPct 仍是 restart 桶（⑦）判定源+常量锚行为+T130 地板补丁。失败 exit 非零。
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

  // B2 T130 地板补丁（2026-11-09 用户裁定，67ad68e0/6efa11ce 案）：「代币首次购买
  // 价格低于我们配置的代币初始价格，那么地板改为首次购买价」——launch 锚=
  // min(常量, 首笔买入可靠价)。夹具=低开 −20% 形状（6efa11ce 同款）：
  // 首笔 buy 0.8×FM → launch=0.8×FM；现价 1.0×FM → currentVsLaunchPct=+25
  //（常量锚下会显 0=发行价即视，near_launch 判定系统性失真——补丁消除）
  const rowsLow = [0.8, 1.0, 0.9, 1.0].map((m, i) => row((i + 1) * 10, FM * m));
  const bdLow = buildBuyPointSnapshot(rowsLow, metaConst).buyDerived;
  ok(bdLow.launchPriceBnb === FM * 0.8,
    `B2 T130 低开票 launch=首买价 0.8×FM（min(常量,首买)；实际 ${bdLow.launchPriceBnb}）`);
  ok(bdLow.currentVsLaunchPct === 25,
    `B2 T130 低开票 currentVsLaunchPct=+25（1.0×FM ÷ 0.8×FM；实际 ${bdLow.currentVsLaunchPct}）`);

  // B3 T130 高开票不降锚：全程 [1.5, 1.2, 1.3]×FM 均 > 常量 → launch=常量原值
  //（地板=min 语义，高开不抬地板；T134 起窗内 min=1.2×FM 仍 >常量不触发滚动地板）
  const rowsHigh = [1.5, 1.2, 1.3].map((m, i) => row((i + 1) * 10, FM * m));
  const bdHigh = buildBuyPointSnapshot(rowsHigh, metaConst).buyDerived;
  ok(bdHigh.launchPriceBnb === FM,
    `B3 T130 高开票 launch=常量原值（实际 ${bdHigh.launchPriceBnb}）`);
  ok(bdHigh.minVsLaunchPct === 20,
    `B3 T130 高开票 minVsLaunchPct=+20（1.2×FM 段最低；实际 ${bdHigh.minVsLaunchPct}）`);

  // B4 T134 滚动地板（2026-11-11 v100 族一 9/9 案，用户方案三「出现价格更低以其
  // 为准」）：高开后运行期跌出 0.9×FM 新低（<常量）→ 地板下移=0.9×FM（sell 低价
  // 同样是真实成交价；锚只降不升）——族一案主体形状（idx2 -29.3%/idx192 -31.7%
  // 均 min 在首买后）。minVs/currentVs 分母随锚换
  const rowsFall = [1.5, 0.9, 1.0].map((m, i) => row((i + 1) * 10, FM * m));
  const bdFall = buildBuyPointSnapshot(rowsFall, metaConst).buyDerived;
  ok(bdFall.launchPriceBnb === FM * 0.9,
    `B4 T134 运行期新低下移锚 launch=0.9×FM（实际 ${bdFall.launchPriceBnb}）`);
  ok(bdFall.minVsLaunchPct === 0,
    `B4 T134 minVsLaunchPct=0（段最低=地板本身；实际 ${bdFall.minVsLaunchPct}）`);
  ok(bdFall.currentVsLaunchPct === 11.1,
    `B4 T134 currentVsLaunchPct=+11.1（1.0/0.9；实际 ${bdFall.currentVsLaunchPct}）`);

  // B4b 中途窗（launchCovered=false 截窗不含出生段）：T130 的 launchCovered 保护门
  //（窗内首笔 BUY 冒充全局首买=错锚）已随 T134 退役——窗内 min 是因果统计量：
  // 截窗长票窗内 min ≥ 全局 min 恒成立=锚只会偏高不冒充低锚，且锚窗本来就是
  // per-锚窗 as-of 重算（BP 对拍口径）。夹具=低开形状首行 dt=100 → 窗内 min
  // 0.8×FM 照应用为地板
  const rowsLate = [0.8, 0.9, 1.0].map((m, i) => row(100 + i * 10, FM * m));
  const bdLate = buildBuyPointSnapshot(rowsLate, metaConst).buyDerived;
  ok(bdLate.launchPriceBnb === FM * 0.8,
    `B4b T134 中途窗窗内 min 照应用（launchCovered 门退役；实际 ${bdLate.launchPriceBnb}）`);

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
