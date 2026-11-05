/**
 * 买入点位分析 Jev 结果映射（BP1）——纯函数，零 DB 零网络
 *
 * 判定形态=用户裁定「Jev 综合判定」：维度题档位 + 1 类别题（point_category，
 * BP3：早鸟/回调/追高/难分类）+ 1 综合题（buy_point_assessment）由 Jev 直接给
 * 「当前点位适合买入程度」（good/neutral/poor/insufficient）。BP5 维度瘦身：
 * 4 维度（price_trend 价格趋势六桶 / sell_pressure / market_heat / entry_position
 * 相对价格高低四桶）+ price_level 绝对价格高低五桶 + 类别 + 综合。
 * 本 mapper **纯透传**：argmax 桶位照抄，代码不做任何规则映射/加权/grade
 * （无 grade.js——与 CD D3.5「判断一律 Jev」同哲学）。
 *
 * 容错双轨（镜像 cheat mapper 纪律）：
 * - 综合题缺答案/形状异常/未知桶名 → **throw**（fail-loud：综合判定是本模块
 *   唯一产出，缺失=链路坏，调用方落 error 行）
 * - 维度题缺席 → null（容缺：材料薄时 Jev 可能拒答个别维度，存档重放兼容）；
 *   在场答案走 argmax + 桶域校验，未知桶名 throw（题集/映射漂移防线不因容缺放宽）
 * - 观测记录**无 verdict/grade/score/recommendation 键**（纯透传反证，单测锁死
 *   ——入场决策映射是第二步引擎融合的事，用户裁定后另行立项）
 *
 * 桶域常量与题集（llm/buy-point-questions.mjs ESM）同域同值：ESM 无法被本 CJS
 * require，故此处自持副本，由单测 `_test_buy_point_lib.cjs` F 组经 dynamic import
 * 锁两域逐桶相等（改任一侧须同步——版本 bump 纪律兜底）。
 */

/** 维度/类别题 id 清单（与题集对齐——漂移由未知桶名 throw 兜住；BP5 维度瘦身） */
const DIMENSION_IDS = [
  'price_trend',
  'sell_pressure',
  'market_heat',
  'entry_position',
  'price_level',
  'point_category',
];

/** 综合判定题 id（Jev 直接给适合买入程度） */
const ASSESSMENT_ID = 'buy_point_assessment';

// ── 桶域（与题集导出同域同值——单测锁相等）──
const PRICE_TREND_LEVELS = ['fast_up', 'slow_up', 'fast_down', 'slow_down', 'flat', 'volatile'];
const SELL_PRESSURE_LEVELS = ['low', 'mid', 'high'];
const HEAT_LEVELS = ['low', 'mid', 'high', 'ultra'];
const ENTRY_POSITION_LEVELS = ['near_high', 'shallow_pullback', 'half_off', 'ankle_cut'];
const PRICE_LEVEL_LEVELS = ['near_launch', 'low', 'mid', 'high', 'very_high'];
const POINT_CATEGORY_LEVELS = ['early_bird', 'pullback_entry', 'high_chase', 'unclear'];
const ASSESSMENT_LEVELS = ['good', 'neutral', 'poor', 'insufficient'];

/** 维度 id → 桶域（题面/桶域增改须同步题集并 bump 版本） */
const DIMENSION_LEVELS = {
  price_trend: PRICE_TREND_LEVELS,
  sell_pressure: SELL_PRESSURE_LEVELS,
  market_heat: HEAT_LEVELS,
  entry_position: ENTRY_POSITION_LEVELS,
  price_level: PRICE_LEVEL_LEVELS,
  point_category: POINT_CATEGORY_LEVELS,
};

/**
 * Choice 答案 → argmax {bucket, prob}。strict=true 时缺失/形状异常 throw；
 * strict=false 容缺返回 null（在场仍校验桶域）。
 */
function _choice(answers, id, levels, strict) {
  const a = answers && answers[id];
  if (!a || !a.probabilities) {
    if (strict) {
      const shape = JSON.stringify(a);
      throw new Error(`题 ${id} 答案缺失或无概率分布: ${shape === undefined ? '(undefined)' : shape.slice(0, 120)}`);
    }
    return null;
  }
  let best = null;
  for (const [bucket, p] of Object.entries(a.probabilities)) {
    if (best === null || p > best.prob) best = { bucket, prob: p };
  }
  if (!levels.includes(best.bucket)) {
    throw new Error(`题 ${id} 未知桶名 '${best.bucket}'（题集/映射漂移——桶域须同步）`);
  }
  return { bucket: best.bucket, prob: best.prob };
}

/**
 * 数值锚读取（形状异常按缺席=null 处理——绝不冒充）。与 cheat _anchorPct 的
 * 差异：**允许负数**（chg 族净涨跌/净买额可为负——负值是证据不是形状异常）。
 */
function _num(anchors, key) {
  const v = anchors && anchors[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * buyDerived.win[W] 扁平化锚读取（anchors.win 嵌套 {30:{…},60:{…},120:{…}}；
 * 输出键名 win30BuyBnb 形状）
 */
function _winNum(anchors, W, key) {
  const w = anchors && anchors.win && anchors.win[W];
  const v = w && w[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Jev answers → 买点观测记录（维度档位+综合判定+数值锚；无 verdict/grade）
 * @param {Object} answers - JevClient.ask 返回的 answers（8 题 Choice；
 *   维度题可缺席→null；综合题必须在场）
 * @param {Object|null} [anchors] - buyDerived 数值锚（buildBuyPointSnapshot
 *   产物 .buyDerived；缺省/形状异常=缺席）
 * @returns {{dimensions:Object, assessment:{bucket,prob}, anchors:Object}}
 * @throws {Error} 综合题缺失/形状异常/未知桶名；维度题在场但未知桶名
 */
function buildBuyPointObservation(answers, anchors = null) {
  const dimensions = {};
  for (const id of DIMENSION_IDS) {
    dimensions[id] = _choice(answers, id, DIMENSION_LEVELS[id], false);
  }
  const flat = {};
  for (const W of [30, 60, 120]) {
    for (const k of ['buyBnb', 'sellBnb', 'buyN', 'sellN', 'netBnb', 'buySharePct', 'ticksPerMin', 'buyers', 'sellers', 'newBuyers']) {
      flat[`win${W}${k[0].toUpperCase()}${k.slice(1)}`] = _winNum(anchors, W, k);
    }
  }
  const b = anchors || {};
  const burst = b.burst5In120;
  return {
    // 七维度档位（缺席 null=材料薄/Jev 拒答；在场 {bucket, prob} argmax）
    dimensions,
    // 综合判定（唯一强制产出——Jev 直接给「当前点位适合买入程度」）
    assessment: _choice(answers, ASSESSMENT_ID, ASSESSMENT_LEVELS, true),
    // 数值锚（纯事实透传：观测/校准素材，非档位判定；异常形状缺席不冒充）
    anchors: {
      // 时点位置族
      tokenAgeSec: _num(b, 'tokenAgeSec'),
      spanSec: _num(b, 'spanSec'),
      currentVsAthPct: _num(b, 'currentVsAthPct'),
      secSinceAth: _num(b, 'secSinceAth'),
      // 发行价位置族（BP5：截窗未覆盖出生段 → null 不冒充；launchCovered boolean → 1/0 数值化）
      launchPriceBnb: _num(b, 'launchPriceBnb'),
      currentVsLaunchPct: _num(b, 'currentVsLaunchPct'),
      launchCovered: b.launchCovered === null || b.launchCovered === undefined ? null : (b.launchCovered ? 1 : 0),
      // 市值位置族（BP2：supply 缺失 null fail-closed）
      mcapBnb: _num(b, 'mcapBnb'),
      mcapPeakBnb: _num(b, 'mcapPeakBnb'),
      mcapFromPeakPct: _num(b, 'mcapFromPeakPct'),
      // holder 流向族（BP2：tok 缺失 null fail-closed；delta 可负）
      holdersNow: _num(b, 'holdersNow'),
      holdersDelta60: _num(b, 'holdersDelta60'),
      // 近窗动量族（可负）
      chg30Pct: _num(b, 'chg30Pct'),
      chg60Pct: _num(b, 'chg60Pct'),
      chg120Pct: _num(b, 'chg120Pct'),
      // 近窗族（W∈{30,60,120} 扁平 10 键/窗）
      ...flat,
      // 参与结构族（近 60s）
      top1BuyPct60: _num(b, 'top1BuyPct60'),
      top1SellPct60: _num(b, 'top1SellPct60'),
      routerBuyPct60: _num(b, 'routerBuyPct60'),
      // 节奏族（rateTrend 三桶字符串不进锚；burst 三键）
      halfTpmEarly: _num(b, 'halfTpmEarly'),
      halfTpmLate: _num(b, 'halfTpmLate'),
      burst5N: burst && typeof burst.n === 'number' ? burst.n : null,
      burst5BuyBnb: burst && typeof burst.buyBnb === 'number' ? burst.buyBnb : null,
      burst5Wallets: burst && typeof burst.wallets === 'number' ? burst.wallets : null,
      // 卖压族
      bigHolderSellBnb60: _num(b, 'bigHolderSellBnb60'),
      exitSellerCount60: _num(b, 'exitSellerCount60'),
    },
  };
}

module.exports = {
  buildBuyPointObservation,
  DIMENSION_IDS,
  ASSESSMENT_ID,
  PRICE_TREND_LEVELS,
  SELL_PRESSURE_LEVELS,
  HEAT_LEVELS,
  ENTRY_POSITION_LEVELS,
  PRICE_LEVEL_LEVELS,
  POINT_CATEGORY_LEVELS,
  ASSESSMENT_LEVELS,
};
