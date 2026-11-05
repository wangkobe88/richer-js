/**
 * 买入点位分析 Jev 结果映射（BP1）——纯函数，零 DB 零网络
 *
 * 判定形态（BP6 三类质量题制，用户裁定 2026-11-05）：维度题档位（5 题）+
 * **3 类别质量题**（early_bird_quality/pullback_entry_quality/high_chase_quality，
 * 桶域 good/neutral/poor/insufficient——Jev 三视角并行独立评估）；
 * 综合判定 = **代码侧确定性聚合**（用户原话「这三者有任何一个为 good 则为
 * good，为 neutral 则为 neutral，否则为 poor」）：任一 good → good；否则
 * 任一 neutral → neutral；否则 poor——insufficient（该视角不适用/材料薄）
 * **不贡献聚合**；三题全 insufficient → poor（fallback 无 poor 证据 prob=null）。
 * 维度题仍纯透传（argmax 照抄无规则映射——与 CD D3.5「判断一律 Jev」同哲学；
 * 聚合规则是用户明裁的确定性 max 规则非加权 grade）。
 *
 * 容错双轨（镜像 cheat mapper 纪律）：
 * - 质量题缺答案/形状异常/未知桶名 → **throw**（fail-loud：质量题是综合判定
 *   唯一来源，缺失=链路坏，调用方落 error 行）
 * - 维度题缺席 → null（容缺：材料薄时 Jev 可能拒答个别维度，存档重放兼容）；
 *   在场答案走 argmax + 桶域校验，未知桶名 throw（题集/映射漂移防线不因容缺放宽）
 * - 观测记录**无 verdict/grade/score/recommendation 键**（纯透传反证，单测锁死
 *   ——rule 键=聚合来源留痕（any_good/any_neutral/else_poor）非档位结论）
 *
 * 桶域常量与题集（llm/buy-point-questions.mjs ESM）同域同值：ESM 无法被本 CJS
 * require，故此处自持副本，由单测 `_test_buy_point_lib.cjs` F 组经 dynamic import
 * 锁两域逐桶相等（改任一侧须同步——版本 bump 纪律兜底）。
 */

/** 维度题 id 清单（与题集对齐——漂移由未知桶名 throw 兜住；BP5 维度瘦身） */
const DIMENSION_IDS = [
  'price_trend',
  'sell_pressure',
  'market_heat',
  'entry_position',
  'price_level',
];

/** 三类质量题 id（BP6：Jev 三视角并行评估——综合判定唯一来源，strict 强制在场） */
const QUALITY_IDS = ['early_bird_quality', 'pullback_entry_quality', 'high_chase_quality'];

// ── 桶域（与题集导出同域同值——单测锁相等）──
const PRICE_TREND_LEVELS = ['fast_up', 'slow_up', 'fast_down', 'slow_down', 'flat', 'volatile'];
const SELL_PRESSURE_LEVELS = ['low', 'mid', 'high'];
const HEAT_LEVELS = ['low', 'mid', 'high', 'ultra'];
const ENTRY_POSITION_LEVELS = ['near_high', 'shallow_pullback', 'half_off', 'ankle_cut'];
const PRICE_LEVEL_LEVELS = ['near_launch', 'low', 'mid', 'high', 'very_high'];
/** 质量题桶域（BP6——与题集同域；insufficient=不适用/材料薄不贡献聚合） */
const QUALITY_LEVELS = ['good', 'neutral', 'poor', 'insufficient'];
/** 综合判定桶域（聚合产物 ∈ {good, neutral, poor}；门 bpPassLevels 消费域含 insufficient 历史行兼容） */
const ASSESSMENT_LEVELS = ['good', 'neutral', 'poor', 'insufficient'];

/** 维度 id → 桶域（题面/桶域增改须同步题集并 bump 版本） */
const DIMENSION_LEVELS = {
  price_trend: PRICE_TREND_LEVELS,
  sell_pressure: SELL_PRESSURE_LEVELS,
  market_heat: HEAT_LEVELS,
  entry_position: ENTRY_POSITION_LEVELS,
  price_level: PRICE_LEVEL_LEVELS,
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
 * Jev answers → 买点观测记录（维度档位+三类质量+聚合综合判定+数值锚；无 verdict/grade）
 * @param {Object} answers - JevClient.ask 返回的 answers（8 题 Choice=5 维度+3 质量；
 *   维度题可缺席→null；质量题 strict 必须在场）
 * @param {Object|null} [anchors] - buyDerived 数值锚（buildBuyPointSnapshot
 *   产物 .buyDerived；缺省/形状异常=缺席）
 * @returns {{dimensions:Object, qualities:Object, assessment:{bucket,prob,rule}, anchors:Object}}
 * @throws {Error} 质量题缺失/形状异常/未知桶名；维度题在场但未知桶名
 */
function buildBuyPointObservation(answers, anchors = null) {
  const dimensions = {};
  for (const id of DIMENSION_IDS) {
    dimensions[id] = _choice(answers, id, DIMENSION_LEVELS[id], false);
  }
  // 三类质量题（strict：早鸟/回调/追高三视角各一道，综合判定唯一来源）
  const qualities = {};
  for (const id of QUALITY_IDS) {
    qualities[id.replace('_quality', '')] = _choice(answers, id, QUALITY_LEVELS, true);
  }
  // 聚合（BP6 用户裁定确定性规则，代码侧执行不依赖 Jev 路由）：
  // 任一 good → good；否则任一 neutral → neutral；否则 poor。
  // insufficient（不适用/材料薄）不贡献；全 insufficient → poor（prob=null 无 poor 证据）。
  const qList = Object.values(qualities);
  const tier = (t) => qList.filter((e) => e && e.bucket === t);
  const bestProb = (arr) => (arr.length ? Math.max(...arr.map((e) => e.prob)) : null);
  let bucket, prob, rule;
  const g = tier('good');
  const n = tier('neutral');
  const p = tier('poor');
  if (g.length) { bucket = 'good'; prob = bestProb(g); rule = 'any_good'; }
  else if (n.length) { bucket = 'neutral'; prob = bestProb(n); rule = 'any_neutral'; }
  else { bucket = 'poor'; prob = bestProb(p); rule = 'else_poor'; }
  const assessment = { bucket, prob, rule };
  const flat = {};
  for (const W of [30, 60, 120]) {
    for (const k of ['buyBnb', 'sellBnb', 'buyN', 'sellN', 'netBnb', 'buySharePct', 'ticksPerMin', 'buyers', 'sellers', 'newBuyers']) {
      flat[`win${W}${k[0].toUpperCase()}${k.slice(1)}`] = _winNum(anchors, W, k);
    }
  }
  const b = anchors || {};
  const burst = b.burst5In120;
  return {
    // 五维度档位（缺席 null=材料薄/Jev 拒答；在场 {bucket, prob} argmax）
    dimensions,
    // 三类入场质量（BP6 strict：early_bird/pullback_entry/high_chase 各 {bucket,prob}）
    qualities,
    // 综合判定（代码侧聚合：any_good → any_neutral → else_poor；rule=聚合来源留痕）
    assessment,
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
      // 近窗动量族（BP6 短窗 5/10/30s；可负）
      chg5Pct: _num(b, 'chg5Pct'),
      chg10Pct: _num(b, 'chg10Pct'),
      chg30Pct: _num(b, 'chg30Pct'),
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
  QUALITY_IDS,
  PRICE_TREND_LEVELS,
  SELL_PRESSURE_LEVELS,
  HEAT_LEVELS,
  ENTRY_POSITION_LEVELS,
  PRICE_LEVEL_LEVELS,
  QUALITY_LEVELS,
  ASSESSMENT_LEVELS,
};
