/**
 * 买入点位分析 Jev 结果映射（BP1）——纯函数，零 DB 零网络
 *
 * 判定形态（BP34/案号 BP31 六桶制——盘型前置预判断+famous heavy/ultra 门扩+
 * tree/追高题退役（BP30）+⑥sustained_climb 位置门（BP34），用户裁定 2026-11-07）：
 * 维度题档位（7 题纯参考）+ **2 类别质量题**
 * （early_bird_quality/pullback_entry_quality，桶域 good/neutral/poor/
 * insufficient——Jev 两视角并行独立评估）；综合判定 = **代码侧四层**：
 *   ① 盘型门（BP18 五类型学；**BP30 前置为预判断**——用户裁定「market_pattern
 *      要放到很靠前的位置，因为这是个预判断」）：market_pattern ∈ {retail_pvp
 *      散户 PVP/famous_monopoly famous 独食/early_sniper_decay 狙击衰竭}
 *      → poor（rule=pattern_gate，这三种盘子不要参与）；strong_backer（强庄盘
 *      =最好类型）与 blended_unremarkable（融合盘=好点位可赌）不拦；
 *      **BP34 ⑥sustained_climb 持续拉升弱回调走位置臂**（rule 同 pattern_gate）：
 *      现价较发行价 ≤+10%（含破发）起点段放行走质量题、已拉离（>+10%）或锚缺失
 *      （宁拦不冒充）拒买——用户裁定「一开盘一直拉几乎无回调的都不是啥好东西
 *      ……这种只能临近发布价格参与」；判型归 Jev（题面教形状与强庄身份豁免）、
 *      位置归代码（SUSTAINED_CLIMB_LAUNCH_PCT=10 由羊王四点定标）
 *   ② 活跃度门（BP13 扩双题+BP30 ultra 臂）：market_heat=low（近窗密度）**或**
 *      activity_level=low（买点前全窗量级）**或** activity_level=ultra（机器盘
 *      级极端密集——用户裁定「act 为 ultra 也不玩」，对齐 CD M 通道）→ poor
 *      （rule=activity_gate；market_heat=ultra 不拦——近窗密度视角不拦过热，
 *      只拦全窗量级 ultra）
 *   ③ 筹码门（BP14+BP30 heavy 扩档）：famous_domination ∈ {heavy, dominant}
 *      （famous+跟单正净持仓 ≥25 即 famous 主导——用户裁定「famous 主导就
 *      不玩」；light 正常参与不拦）**或** holder_concentration=strong（TOP 过
 *      CD240 分层线/一人控盘）→ poor（rule=chip_gate）
 *   ④ 两质量题确定性聚合（BP6 原话裁定的两题化：「任何一个为 good 则为 good，
 *      为 neutral 则为 neutral，否则为 poor」）：任一 good → good；否则任一
 *      neutral → neutral；否则 poor——insufficient 不贡献聚合；两题全
 *      insufficient → poor（fallback 无 poor 证据 prob=null）
 * **tree_position 已退役（BP30 用户裁定「tree_position 可以去掉」）**：题/题面/
 *   state 摆动结构行整链删除；snapshot zigzag 数值锚保留落 digest=纯留档
 *   （历史 run 对拍兼容，本 mapper 无消费者）。
 * **high_chase_quality 已退役（BP30 用户裁定「high_chase_quality 也删除，不开
 *   这个选项」）**：聚合两题化；追高形状的拦截由早鸟忌讳（速度/累计位置）与
 *   门链承接。
 * 门题答案缺席（null）= 无证据不拦，放行进下层（拒=有证据的拒绝）；门优先于
 * 质量题（质量题证据再好，门拒即 poor，prob=门题 argmax）。
 * 维度题仍纯透传（argmax 照抄——与 CD D3.5「判断一律 Jev」同哲学；门与聚合
 * 规则是用户明裁的确定性规则非加权 grade）。
 *
 * 容错双轨（镜像 cheat mapper 纪律）：
 * - 质量题缺答案/形状异常/未知桶名 → **throw**（fail-loud：质量题是综合判定
 *   唯一来源，缺失=链路坏，调用方落 error 行）
 * - 维度题缺席 → null（容缺：材料薄时 Jev 可能拒答个别维度，存档重放兼容）；
 *   在场答案走 argmax + 桶域校验，未知桶名 throw（题集/映射漂移防线不因容缺放宽）
 * - 观测记录**无 verdict/grade/score/recommendation 键**（纯透传反证，单测锁死
 *   ——rule 键=聚合来源留痕（pattern_gate/activity_gate/chip_gate/any_good/
 *   any_neutral/else_poor）非档位结论）
 *
 * 桶域常量与题集（llm/buy-point-questions.mjs ESM）同域同值：ESM 无法被本 CJS
 * require，故此处自持副本，由单测 `_test_buy_point_lib.cjs` F 组经 dynamic import
 * 锁两域逐桶相等（改任一侧须同步——版本 bump 纪律兜底）。
 */

/** 维度题 id 清单（与题集对齐——漂移由未知桶名 throw 兜住；BP9 删 sell_pressure；BP13 增 activity_level；BP14 增 famous_domination/holder_concentration；BP18 增 market_pattern；BP30 删 tree_position） */
const DIMENSION_IDS = [
  'price_trend',
  'market_heat',
  'activity_level',
  'famous_domination',
  'holder_concentration',
  'entry_position',
  'price_level',
  'market_pattern',
];

/** 两类质量题 id（BP6 两题制——BP30 删 high_chase_quality；综合判定唯一来源，strict 强制在场） */
const QUALITY_IDS = ['early_bird_quality', 'pullback_entry_quality'];

// ── 桶域（与题集导出同域同值——单测锁相等）──
const PRICE_TREND_LEVELS = ['fast_up', 'slow_up', 'fast_down', 'slow_down', 'flat', 'volatile'];
const HEAT_LEVELS = ['low', 'mid', 'high', 'ultra'];
/** 买点前活跃度四档（BP13：CD activity_level 判法搬运——与 HEAT_LEVELS 同词表） */
const ACTIVITY_LEVELS = ['low', 'mid', 'high', 'ultra'];
/** famous 控盘四桶（BP14：CD D3.2 三档切点 50/25 判法搬运；BP30 heavy+dominant 两档=门桶硬消费拒买（famous 主导就不玩），light=正常参与不拦） */
const FAMOUS_DOMINATION_LEVELS = ['none', 'light', 'heavy', 'dominant'];
/** 持仓集中四桶（BP14：CD240 分层线判法搬运——strong=门桶硬消费） */
const HOLDER_CONCENTRATION_LEVELS = ['none', 'weak', 'moderate', 'strong'];
const ENTRY_POSITION_LEVELS = ['near_high', 'shallow_pullback', 'half_off', 'ankle_cut'];
const PRICE_LEVEL_LEVELS = ['near_launch', 'low', 'mid', 'high', 'very_high'];
/** 盘面分类六桶（BP18 用户裁定五类型学；BP34 加第六桶 sustained_climb：strong_backer
 * 强盘最好类型/retail_pvp 散户 PVP（门桶拒买）/famous_monopoly famous 独食（门桶
 * 拒买）/early_sniper_decay 狙击衰竭（门桶拒买）/blended_unremarkable 融合盘中性
 * 可赌/sustained_climb 持续拉升弱回调（走独立位置门非三桶硬拒） */
const MARKET_PATTERN_LEVELS = ['strong_backer', 'retail_pvp', 'famous_monopoly', 'early_sniper_decay', 'blended_unremarkable', 'sustained_climb'];
/** 盘型门拒买桶（BP18：retail_pvp/famous_monopoly/early_sniper_decay 三桶硬拒；
 * strong_backer（最好类型）与 blended_unremarkable（融合可赌）不拦；BP30 起为
 * 判定链首门（预判断最前）；BP34 的 sustained_climb **刻意不入本表**——走
 * SUSTAINED_CLIMB_LAUNCH_PCT 独立位置臂（贴发行价起点段放行、已拉离/锚缺失拒） */
const PATTERN_GATE_POOR_BUCKETS = ['retail_pvp', 'famous_monopoly', 'early_sniper_decay'];
/** ⑥sustained_climb 参与位置界（BP34 用户裁定「这种只能临近发布价格参与」）：现价
 * 较发行价 ≤+10%（含破发）=临近发行价起点段放行两道质量题正常评估；已拉离
 * （>+10%）或锚缺失（宁拦不冒充——发行价位置 ? = ticks 未覆盖出生段）→ 盘型门拒。
 * 界由羊王 0x5a8d94c6 四点定标：S154 −4.2% 贴发行价（用户裁 neutral 放行）与
 * S155 +17.1%（拒）之间取 10；S072 無為 +86.6% 由题面强庄身份豁免保护不落⑥ */
const SUSTAINED_CLIMB_LAUNCH_PCT = 10;
/** 活跃度门拒买档（BP30：low=活跃度不够；activity_level=ultra=机器盘级极端密集
 * 「act 为 ultra 也不玩」——对齐 CD 侧 M 通道 hyper_activity 拒买级；market_heat
 * 的 ultra 不拦：近窗密度视角不拦过热，只拦全窗量级 ultra） */
const ACTIVITY_GATE_POOR_BUCKETS = { market_heat: ['low'], activity_level: ['low', 'ultra'] };
/** 筹码门 famous 拒买档（BP30：heavy+dominant ≥25=famous 主导不玩；light 正常参与不拦） */
const CHIP_GATE_FAMOUS_POOR_BUCKETS = ['heavy', 'dominant'];
/** 质量题桶域（BP6——与题集同域；insufficient=不适用/材料薄不贡献聚合） */
const QUALITY_LEVELS = ['good', 'neutral', 'poor', 'insufficient'];
/** 综合判定桶域（聚合产物 ∈ {good, neutral, poor}；门 bpPassLevels 消费域含 insufficient 历史行兼容） */
const ASSESSMENT_LEVELS = ['good', 'neutral', 'poor', 'insufficient'];

/** 维度 id → 桶域（题面/桶域增改须同步题集并 bump 版本） */
const DIMENSION_LEVELS = {
  price_trend: PRICE_TREND_LEVELS,
  market_heat: HEAT_LEVELS,
  activity_level: ACTIVITY_LEVELS,
  famous_domination: FAMOUS_DOMINATION_LEVELS,
  holder_concentration: HOLDER_CONCENTRATION_LEVELS,
  entry_position: ENTRY_POSITION_LEVELS,
  price_level: PRICE_LEVEL_LEVELS,
  market_pattern: MARKET_PATTERN_LEVELS,
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
 * buyDerived.activity 嵌套锚读取（BP13：cheatDerived 同名透传的买点前活跃度
 * 锚族——idlePct/买盘中位/吞吐/临近段七键等；形状异常按缺席=null 不冒充）
 */
function _actNum(anchors, key) {
  const a = anchors && anchors.activity;
  const v = a && a[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * buyDerived.chip 嵌套锚读取（BP14：cheatDerived 同名透传的筹码结构锚族——
 * famous 三键+分层三键+簇持仓两键+分叉锚；形状异常按缺席=null 不冒充）
 */
function _chipNum(anchors, key) {
  const c = anchors && anchors.chip;
  const v = c && c[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * buyDerived.openSeg 嵌套锚读取（BP18 盘面分类锚：首 30s 买入占比/大额单/
 * 开盘后密度——强庄盘/狙击衰竭盘判读原料；截窗未覆盖开盘段全族 null 不冒充）
 */
function _openNum(anchors, key) {
  const o = anchors && anchors.openSeg;
  const v = o && o[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Jev answers → 买点观测记录（维度档位+两类质量+聚合综合判定+数值锚；无 verdict/grade）
 * @param {Object} answers - JevClient.ask 返回的 answers（9 题 Choice=7 维度+2 质量；
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
  // 两类质量题（strict：早鸟/回调两视角各一道，综合判定唯一来源）
  const qualities = {};
  for (const id of QUALITY_IDS) {
    qualities[id.replace('_quality', '')] = _choice(answers, id, QUALITY_LEVELS, true);
  }
  // 四层判定链（BP30/题集 BP33——盘型门前置预判断最前，rule 留痕首个命中门）：
  // ①盘型门（BP18 五类型学；BP30 前置——用户裁定「market_pattern 要放到很靠前
  //   的位置，因为这是个预判断」）：retail_pvp/famous_monopoly/early_sniper_decay
  //   → poor（不要参与）；strong_backer 与 blended_unremarkable 不拦；BP34 六桶
  //   sustained_climb 走位置臂——现价较发行价 ≤+10%（含破发）起点段放行、已拉离
  //   或锚缺失拒（rule 同 pattern_gate）；
  // ②活跃度门（BP13 双题+BP30 ultra 臂）：market_heat=low（近窗密度死寂）**或**
  //   activity_level ∈ {low（CD 七要素低档形状）, ultra（机器盘级极端密集——
  //   「act 为 ultra 也不玩」）}→ poor（rule=activity_gate）；
  // ③筹码门（BP14+BP30 heavy 扩档）：famous_domination ∈ {heavy, dominant}
  //   （正净 ≥25=famous 主导不玩）**或** holder_concentration=strong（CD240
  //   分层线/一人控盘）→ poor（rule=chip_gate）；
  // ④两质量题聚合：任一 good → good；否则任一 neutral → neutral；否则 poor。
  // 门题答案缺席（null）=无证据不拦放行（拒=有证据的拒绝；旧档重放缺答案=该臂
  // 自动失效）；门优先于质量题。
  // insufficient（不适用/材料薄）不贡献；全 insufficient → poor（prob=null 无 poor 证据）。
  const patternArms = dimensions.market_pattern && PATTERN_GATE_POOR_BUCKETS.includes(dimensions.market_pattern.bucket)
    ? [dimensions.market_pattern] : [];
  // ⑥sustained_climb 位置臂（BP34）：贴发行价起点段放行；已拉离/锚缺失（宁拦不
  // 冒充）入盘型门拒（题面已教位置门语义，此处代码侧硬执行——判型归 Jev 位置归代码）
  if (dimensions.market_pattern && dimensions.market_pattern.bucket === 'sustained_climb') {
    const rawVs = anchors ? anchors.currentVsLaunchPct : null;
    const vsLaunch = typeof rawVs === 'number' && Number.isFinite(rawVs) ? rawVs : null;
    if (vsLaunch == null || vsLaunch > SUSTAINED_CLIMB_LAUNCH_PCT) patternArms.push(dimensions.market_pattern);
  }
  const gateArms = [
    dimensions.market_heat && ACTIVITY_GATE_POOR_BUCKETS.market_heat.includes(dimensions.market_heat.bucket) ? dimensions.market_heat : null,
    dimensions.activity_level && ACTIVITY_GATE_POOR_BUCKETS.activity_level.includes(dimensions.activity_level.bucket) ? dimensions.activity_level : null,
  ].filter(Boolean);
  const chipArms = [
    dimensions.famous_domination && CHIP_GATE_FAMOUS_POOR_BUCKETS.includes(dimensions.famous_domination.bucket) ? dimensions.famous_domination : null,
    dimensions.holder_concentration && dimensions.holder_concentration.bucket === 'strong' ? dimensions.holder_concentration : null,
  ].filter(Boolean);
  const qList = Object.values(qualities);
  const tier = (t) => qList.filter((e) => e && e.bucket === t);
  const bestProb = (arr) => (arr.length ? Math.max(...arr.map((e) => e.prob)) : null);
  let bucket, prob, rule;
  if (patternArms.length) {
    bucket = 'poor'; prob = bestProb(patternArms); rule = 'pattern_gate';
  } else if (gateArms.length) {
    bucket = 'poor'; prob = bestProb(gateArms); rule = 'activity_gate';
  } else if (chipArms.length) {
    bucket = 'poor'; prob = bestProb(chipArms); rule = 'chip_gate';
  } else {
    const g = tier('good');
    const n = tier('neutral');
    const p = tier('poor');
    if (g.length) { bucket = 'good'; prob = bestProb(g); rule = 'any_good'; }
    else if (n.length) { bucket = 'neutral'; prob = bestProb(n); rule = 'any_neutral'; }
    else { bucket = 'poor'; prob = bestProb(p); rule = 'else_poor'; }
  }
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
    // 维度档位（缺席 null=材料薄/Jev 拒答；在场 {bucket, prob} argmax）
    dimensions,
    // 两类入场质量（BP6 两题制 strict：early_bird/pullback_entry 各 {bucket,prob}）
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
      // 近窗动量族（BP6 短窗 5/10/30s；可负；BP10 maxChg5=回看速度锚）
      chg5Pct: _num(b, 'chg5Pct'),
      chg10Pct: _num(b, 'chg10Pct'),
      chg30Pct: _num(b, 'chg30Pct'),
      maxChg5Pct: _num(b, 'maxChg5Pct'),
      // 摆动结构族（BP8 圣诞树原料；BP30/题集 BP33 tree_position 题退役后**无消费者
      // 纯留档**——历史 run 对拍兼容照落 digest；<2 可靠价全族 null；lastDir
      // 1=涨段/-1=跌段/0=未定向；swingPoints/swingLegs=state 渲染原料不进锚）
      swingHighCount: _num(b, 'swingHighCount'),
      swingLowCount: _num(b, 'swingLowCount'),
      swingLastDir: _num(b, 'swingLastDir'),
      secSinceSwingHigh: _num(b, 'secSinceSwingHigh'),
      secSinceSwingLow: _num(b, 'secSinceSwingLow'),
      currentVsSwingHighPct: _num(b, 'currentVsSwingHighPct'),
      currentVsSwingLowPct: _num(b, 'currentVsSwingLowPct'),
      swingMaxAmplPct: _num(b, 'swingMaxAmplPct'),
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
      // 活跃度锚族（BP13：cheatDerived 同名透传——act 前缀=买点前窗口口径；
      // 观察/校准素材非档位判定；临近段七键=? 时窗口 ≤30s 无对比语义；
      // 尾段三键=锚前最后 5s 时序证据（BP28 案四改，BP 侧自算））
      actSpanSec: _actNum(anchors, 'spanSec'),
      actTickCount: _actNum(anchors, 'tickCount'),
      actIdlePct: _actNum(anchors, 'idlePct'),
      actBuyMedianBnb: _actNum(anchors, 'buyMedianBnb'),
      actThroughputBnbPerMin: _actNum(anchors, 'throughputBnbPerMin'),
      actMaxDrawdownPct: _actNum(anchors, 'maxDrawdownPct'),
      actNearSegTickN: _actNum(anchors, 'nearSegTickN'),
      actNearSegTicksPerMin: _actNum(anchors, 'nearSegTicksPerMin'),
      actNearSegBuyMedianBnb: _actNum(anchors, 'nearSegBuyMedianBnb'),
      actNearSegBnbPerMin: _actNum(anchors, 'nearSegBnbPerMin'),
      actNearSegMaxGapSec: _actNum(anchors, 'nearSegMaxGapSec'),
      actNearSegBuyN: _actNum(anchors, 'nearSegBuyN'),
      actNearSegSellN: _actNum(anchors, 'nearSegSellN'),
      actNearTail5TickN: _actNum(anchors, 'nearTail5TickN'),
      actNearTail5BuyN: _actNum(anchors, 'nearTail5BuyN'),
      actNearTail5BuyBnb: _actNum(anchors, 'nearTail5BuyBnb'),
      // 筹码结构锚族（BP14：cheatDerived 同名透传 famous 三键+分层三键+簇持仓
      // 两键+参与/持有分叉锚——chip 前缀=买点前锚窗口径；观察/校准素材与门判读原料）
      chipFamousDominancePct: _chipNum(anchors, 'famousDominancePct'),
      chipFamousFollowerTop3Pct: _chipNum(anchors, 'famousFollowerTop3Pct'),
      chipFamousGroupBuyPct: _chipNum(anchors, 'famousGroupBuyPct'),
      chipPosHolderCount: _chipNum(anchors, 'posHolderCount'),
      chipTop1HoldCircPct: _chipNum(anchors, 'top1HoldCircPct'),
      chipTop1Top2HoldCircPct: _chipNum(anchors, 'top1Top2HoldCircPct'),
      chipTop3HoldCircPct: _chipNum(anchors, 'top3HoldCircPct'),
      chipSameBlockHoldPct: _chipNum(anchors, 'sameBlockHoldPct'),
      chipEqualBandHoldPct: _chipNum(anchors, 'equalBandHoldPct'),
      chipBuyersTotal: _chipNum(anchors, 'buyersTotal'),
      // 开盘段结构锚族（BP18 盘面分类：首 30s 买入额/占比/大额单（≥0.3 BNB 判线）/
      // 开盘后买入与密度——strong_backer/early_sniper_decay 桶判读数值原料；
      // late 族 null=窗口 ≤30s 无后段对比语义；全族 null=截窗未覆盖开盘段）
      openSegBuyBnb: _openNum(anchors, 'buyBnb'),
      openSegBuyN: _openNum(anchors, 'buyN'),
      openSegBuySharePct: _openNum(anchors, 'buySharePct'),
      openSegBigBuyN: _openNum(anchors, 'bigBuyN'),
      openSegBigBuyBnb: _openNum(anchors, 'bigBuyBnb'),
      openLateBuyBnb: _openNum(anchors, 'lateBuyBnb'),
      openLateTicksPerMin: _openNum(anchors, 'lateTicksPerMin'),
    },
  };
}

module.exports = {
  buildBuyPointObservation,
  DIMENSION_IDS,
  QUALITY_IDS,
  PRICE_TREND_LEVELS,
  HEAT_LEVELS,
  ACTIVITY_LEVELS,
  FAMOUS_DOMINATION_LEVELS,
  HOLDER_CONCENTRATION_LEVELS,
  ENTRY_POSITION_LEVELS,
  PRICE_LEVEL_LEVELS,
  MARKET_PATTERN_LEVELS,
  PATTERN_GATE_POOR_BUCKETS,
  ACTIVITY_GATE_POOR_BUCKETS,
  CHIP_GATE_FAMOUS_POOR_BUCKETS,
  QUALITY_LEVELS,
  ASSESSMENT_LEVELS,
};
