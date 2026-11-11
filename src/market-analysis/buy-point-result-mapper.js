/**
 * 买入点位分析 Jev 结果映射（BP1）——纯函数，零 DB 零网络
 *
 * 判定形态（BP52/案号 BP58——market_pattern 改制「异常盘面识别」+点位性质新题+
 * 统一位置门 27.5（**BP69 2026-11-10 →28.5**）；用户裁定 2026-11-09「只买性价比
 * 高的点位，不追高」「没必要
 * 费劲识别太多盘形，只需要把异常的找出来即可」「现在买入点位已经不是小于 40，
 * 应该是小于 27.5」）：维度题档位（7 题纯参考）+ 综合判定 = **代码侧纯门链**：
 *   ① 盘型门（BP30 前置为预判断——用户裁定「market_pattern 要放到很靠前的位置，
 *      因为这是个预判断」）：
 *      · 硬拒桶：retail_pvp 散户 PVP / famous_monopoly famous 独食 → poor
 *        （rule=pattern_gate，这两种盘子不要参与）
 *      · ⑥sustained_climb 位置臂：现价较发行价 ≤+10%（含破发）起点段放行、
 *        已拉离（>+10%）或锚缺失（宁拦不冒充）拒
 *      · none 统一位置门：**≤+28.5%**（BP58 收口 27.5；BP69 2026-11-10 →28.5
 *        「只稍微宽一点再继续观察」，与 ladder v17 触发线同线）
 *        放行、已拉离（>+28.5%）或锚缺失拒——**BP60 收口四桶**（用户裁定「只识别
 *        出不交易的盘形即可」）：①strong_backer/④early_sniper_decay/⑤blended_
 *        unremarkable/⑧golden_point 判型随桶域删除（处理与 none 完全一致没必要
 *        保留；旧档四桶名答案→未知桶 throw fail-closed 拒——BP52 未部署生产无
 *        中间存档行，buy_point_analyses 零历史行）
 *   ② 点位性质门（BP58 新题 entry_shape）：crash 庄离场直线砸盘 → poor
 *      （rule=entry_gate——好点位=活跃交易中对倒中的低价/正常下跌造成的低价，
 *      不是庄家离场时的暴跌）；normal_dip 正常回调低价=目标买入形状、flat 横盘
 *      缓行 → 放行；**spike 尖刺拉盘判型保留但出拦域（BP68/2026-11-10 用户裁定
 *      「我们已经控制了价格，所以 spike 没有必要再存在，直接删除即可/或者保留
 *      也可以但是不 block 买入」——统一位置门 ≤+28.5 已控价，控价域内 spike
 *      判定本身不正常（判例 ea78 开盘 28s 薄票贴顶臂 -5.13 恰过线判 spike、锚窗
 *      买盘中位仅 0.136——正常小单抬薄票到新高附近就贴「顶」）；判型如实落档
 *      观察，有真实追高亏损 case 再思考对策；恢复拦截=把 'spike' 加回本数组）**；
 *      答案缺席容缺不拦（与其它门题同语义：拒=有证据的拒绝）
 *   ③ 活跃度门（BP30 ultra 臂+BP60 收单题）：activity_level=low（买点前全窗
 *      量级）**或** activity_level=ultra（机器盘级极端密集——用户裁定「act 为
 *      ultra 也不玩」，对齐 CD M 通道）→ poor（rule=activity_gate；**BP60 起
 *      market_heat 臂删除**——题与 activity_level 重复，整题退役；ultra 臂
 *      无条件拦——BP38 strong_backer 豁免已随①桶退役删除，BP46/BP47 ④高热近价
 *      豁免与 BP53 ④ultra 散户入口豁免已随④桶退役删除）；**BP67 burst 桶不拦**
 *      （cheat 门 burst 判定输入桶——引擎透传 sbw，[ANCHOR] 行在场 Jev 选
 *      burst；ba5e 07:52 案 cheat sbw 豁免放行 vs BP act low 拒的叙事矛盾立法
 *      「这个选项不 block 买入」）
 *   ④ 筹码门（BP14 holder 臂单臂）：holder_concentration=strong → poor
 *      （rule=chip_gate）。**BP54 停用（2026-11-09 用户裁定「筹码门可以去掉
 *      （改为先不激活），看看效果」）：CHIP_GATE_ENABLED=false 拦截臂不激活**，
 *      holder strong 不再拒；BP14 防线代码保留恢复=置 true 一键还原。BP52
 *      restart 筹码豁免已随⑦桶退役删除（宿主桶不存在）。
 *   ⑤ 全部门过 → **neutral 放行**（rule='gates_passed'，prob=null——无质量层，
 *      bpPassLevels=['good','neutral'] 门链消费域天然放行）
 * **随宿主退役整链删除的豁免臂（BP58）**：BP38（strong_backer ultra 豁免）/
 *   BP46+BP47（④高热近价豁免 sniperHeatExempt）/BP53+BP56（④ultra 散户入口
 *   豁免 sniperUltraRouterExempt）/BP52（restart 筹码豁免）——①④⑤⑦⑧五桶
 *   退役后豁免宿主不存在；bt-v94 七票复盘=现行豁免臂正是放走三砸盘票（BP53
 *   ultra_router_entry）+币安之心（BP47 sniper_decay_heat_price）的通道，改制
 *   后由 entry_shape crash 臂+统一位置门（BP69 起 28.5）接力拦截；RESTART/STRONG_BACKER/
 *   BLENDED/GOLDEN_POINT/SNIPER_DECAY_HEAT/SNIPER_ULTRA_ROUTER 常量随之删除。
 * **两道质量题（early_bird_quality/pullback_entry_quality）已退役（BP48）**：
 *   旧档 answers 带答案不被消费不 throw（重放兼容）。
 * **tree_position 已退役（BP30）**：snapshot zigzag 数值锚保留落 digest=纯留档。
 * **famous_domination/entry_position 已退役（BP49）**：famous 拦截全归盘型题③
 *   独食桶判读；旧档重放同上兼容。
 * 门题答案缺席（null）= 无证据不拦，放行进下层（拒=有证据的拒绝；位置臂锚缺失
 * = 宁拦不冒充拒）。维度题仍纯透传（argmax 照抄——与 CD D3.5「判断一律 Jev」
 * 同哲学；门规则是用户明裁的确定性规则非加权 grade）。
 *
 * 容错双轨（镜像 cheat mapper 纪律）：
 * - 维度题缺席 → null（容缺：材料薄时 Jev 可能拒答个别维度，存档重放兼容）；
 *   在场答案走 argmax + 桶域校验，未知桶名 throw（题集/映射漂移防线不因容缺
 *   放宽；market_pattern 桶域=BP60 四桶+none（旧档带①④⑤⑧桶名答案 throw
 *   fail-closed 拒——BP52 未部署生产零存档行，无重放污染面）
 * - 观测记录**无 verdict/grade/score/recommendation 键**（纯透传反证，单测锁死
 *   ——rule 键=门来源留痕（pattern_gate/entry_gate/activity_gate/chip_gate/
 *   gates_passed）非档位结论）
 *
 * 桶域常量与题集（llm/buy-point-questions.mjs ESM）同域同值：ESM 无法被本 CJS
 * require，故此处自持副本，由单测 `_test_buy_point_lib.cjs` F 组经 dynamic import
 * 锁两域逐桶相等（改任一侧须同步——版本 bump 纪律兜底）。
 */

/** 维度题 id 清单（与题集对齐——漂移由未知桶名 throw 兜住；BP9 删 sell_pressure；BP13 增 activity_level；BP14 增 famous_domination/holder_concentration；BP18 增 market_pattern；BP30 删 tree_position；BP49 删 famous_domination/entry_position；BP58 增 entry_shape；BP60 删 market_heat） */
const DIMENSION_IDS = [
  'price_trend',
  'activity_level',
  'holder_concentration',
  'price_level',
  'market_pattern',
  'entry_shape',
];

// ── 桶域（与题集导出同域同值——单测锁相等）──
const PRICE_TREND_LEVELS = ['fast_up', 'slow_up', 'fast_down', 'slow_down', 'flat', 'volatile'];
/** 买点前活跃度四档（BP13：CD activity_level 判法搬运；BP60 起唯一活跃度题——
 * market_heat 已退役（与 activity_level 重复，题/门臂/日志段整链删除））；
 * BP67 加第五档 burst=cheat 门 burst 判定输入桶（[ANCHOR] 行在场才选）——
 * **不在拦域**（burst 不拦买入，沉积期低活跃度是 burst 前提语义） */
const ACTIVITY_LEVELS = ['low', 'mid', 'high', 'ultra', 'burst'];
/** 持仓集中四桶（BP14：CD240 分层线判法搬运——strong=门桶硬消费；BP54 停用不激活） */
const HOLDER_CONCENTRATION_LEVELS = ['none', 'weak', 'moderate', 'strong'];
const PRICE_LEVEL_LEVELS = ['almost_launch', 'near_launch', 'low', 'mid', 'high', 'very_high'];
/** 盘面分类四桶（BP60 收口——用户裁定「只识别出不交易的盘形即可」：①strong_
 * backer/④early_sniper_decay/⑤blended_unremarkable/⑧golden_point 判型随桶域
 * 删除——处理与 none 完全一致（统一位置门 ≤+28.5）没必要保留；保留=②
 * retail_pvp/③famous_monopoly 两异常桶（盘型门硬拒）+⑥sustained_climb（独立
 * 位置门 ≤+10）+none 正常盘面兜底（统一位置门 ≤+28.5））
 * 演进：BP18 五类型学→BP30 六桶→BP38 七桶→BP45 八桶→BP58 二修判型恢复→
 * BP60 删⑦restart→BP60 收口四桶 */
const MARKET_PATTERN_LEVELS = ['retail_pvp', 'famous_monopoly', 'sustained_climb', 'none'];
/** 盘型门拒买桶（BP58：retail_pvp/famous_monopoly 两异常桶硬拒；砸盘形状的拦截
 * 由 entry_shape crash 臂+统一位置门（BP69 起 28.5）接力（拉高拦截 BP68 起全归统一位置门
 * ——spike 出拦域）；sustained_climb 刻意不入本表——走 SUSTAINED_CLIMB_LAUNCH_PCT
 * 独立位置臂） */
const PATTERN_GATE_POOR_BUCKETS = ['retail_pvp', 'famous_monopoly'];
/** ⑥sustained_climb 参与位置界（BP34 用户裁定「这种只能临近发布价格参与」）：现价
 * 较发行价 ≤+10%（含破发）=临近发行价起点段放行走后续门链；已拉离（>+10%）或
 * 锚缺失（宁拦不冒充——发行价位置 ? = ticks 未覆盖出生段）→ 盘型门拒。
 * 界由羊王 0x5a8d94c6 四点定标：S154 −4.2% 贴发行价（用户裁 neutral 放行）与
 * S155 +17.1%（拒）之间取 10 */
const SUSTAINED_CLIMB_LAUNCH_PCT = 10;
/** 统一参与位置界（BP58 用户裁定「现在买入点位已经不是小于 40，应该是小于
 * 27.5」——与 T129 ladder v14 触发线同线；**BP69（2026-11-10）27.5→28.5**：用户
 * 裁定「只稍微宽一点，再继续观察」——ea78 案同秒 n=8 +27.75 进 BP 锚窗被 27.5 拒
 * 0.25pp 毫秒竞态，28.5 吃下同秒抖动）：正常盘面（none——BP60 四桶化后
 * 正常形状全部归 none 统一走本门）现价较发行价 ≤+28.5%（含破发）=放行走点位
 * 性质门/活跃度门；已拉离（>+28.5%）或锚缺失（宁拦不冒充）→ 盘型门拒
 * （rule=pattern_gate）。改制前各桶专属位置臂（①80→40/⑤40/⑦40/⑧40/④豁免
 * 臂 40）不再恢复，统一收口本线 */
const NORMAL_ENTRY_LAUNCH_PCT = 28.5;
/** 点位性质四桶（BP58 新题 entry_shape——用户理念「只买性价比高的点位，不追高」：
 * 好点位=活跃交易中对倒中的低价/正常下跌造成的低价，不是庄家离场时的暴跌
 * （直线砸盘），也不是尖刺拉起的追高点） */
const ENTRY_SHAPE_LEVELS = ['crash', 'spike', 'normal_dip', 'flat'];
/** 点位性质门拒买桶（BP58）：crash 庄离场直线砸盘（curVsAth≤-25/chg30≤-25/
 * nearMaxDn5≤-15/curVsMinGap≤2pp 任一臂）→ poor（rule=entry_gate）；
 * normal_dip 正常回调低价=目标买入形状、flat 横盘缓行 → 放行。
 * **BP68（2026-11-10）spike 出拦域**：用户裁定「因为我们已经控制了价格，所以
 * spike 没有必要再存在，直接删除即可／或者保留也可以，但是不 block 买入」——
 * 统一位置门 ≤+28.5 已保证只在临近发行价域买入，控价域内出现 spike（贴顶/急拉）
 * 判定本身不正常（ea78 案实证：开盘 28s 薄票 curVs 27.8、贴顶臂 currentVsAthPct
 * -5.13 恰过 -5 线判 spike(0.49)、锚窗买盘中位仅 0.136/两笔 0.136+0.16——正常
 * 小单就能把薄票价格抬到新高附近贴「顶」）；spike 判型保留落档观察（题面桶域
 * 不变、Jev 照判），有真实追高亏损 case 再思考对策；恢复拦截=加回 'spike' */
const ENTRY_GATE_POOR_BUCKETS = ['crash'];
/** 活跃度门拒买档（BP30：low=活跃度不够；activity_level=ultra=机器盘级极端密集
 * 「act 为 ultra 也不玩」——对齐 CD 侧 M 通道 hyper_activity 拒买级；**BP60 起
 * market_heat 臂删除**（题与 activity_level 重复整题退役，旧档 answers 带答案
 * 不被消费不 throw——维度缺席容缺）；**ultra 臂无条件拦**——BP38 strong_backer
 * 豁免/BP46+47 ④高热豁免同盖/BP53 ④ultra 散户入口豁免同盖三臂已随宿主桶退役
 * 删除；**BP67 burst 桶不在拦域**（cheat 门 burst 判定输入桶——上游判 burst=
 * 沉积期低活跃度前提语义，不拦买入；cheat 侧 sbw 与 BP act low 的活跃度叙事
 * 矛盾由引擎透传+burst 桶解决，不在门上加臂） */
const ACTIVITY_GATE_POOR_BUCKETS = { activity_level: ['low', 'ultra'] };
/** BP54 筹码门停用（2026-11-09 用户裁定「筹码门可以去掉（改为先不激活），看看
 * 效果」）：CHIP_GATE_ENABLED=false 筹码门拦截臂不激活——holder strong 不再拒
 * （rule=chip_gate 不产出），holder 维度答案原样透传 digest 照落（观察材料
 * 保留）；BP14 防线代码全保留，恢复=置 true 一键还原 */
const CHIP_GATE_ENABLED = false;
/** 综合判定桶域（BP48 纯门链产物 ∈ {neutral=门全过放行, poor=门拒}；good 不再
 * 产出——保留 good/insufficient 值为门 bpPassLevels 消费域与历史 digest 行兼容，
 * 桶域不收窄防旧档重放 throw） */
const ASSESSMENT_LEVELS = ['good', 'neutral', 'poor', 'insufficient'];

/** 维度 id → 桶域（题面/桶域增改须同步题集并 bump 版本） */
const DIMENSION_LEVELS = {
  price_trend: PRICE_TREND_LEVELS,
  activity_level: ACTIVITY_LEVELS,
  holder_concentration: HOLDER_CONCENTRATION_LEVELS,
  price_level: PRICE_LEVEL_LEVELS,
  market_pattern: MARKET_PATTERN_LEVELS,
  entry_shape: ENTRY_SHAPE_LEVELS,
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
 * 开盘后密度——②(a) 大户参与判读原料；截窗未覆盖开盘段全族 null 不冒充）
 */
function _openNum(anchors, key) {
  const o = anchors && anchors.openSeg;
  const v = o && o[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Jev answers → 买点观测记录（维度档位+纯门链综合判定+数值锚；无 verdict/grade）
 * @param {Object} answers - JevClient.ask 返回的 answers（7 题 Choice 维度；可缺席→null）
 * @param {Object|null} [anchors] - buyDerived 数值锚（buildBuyPointSnapshot
 *   产物 .buyDerived；缺省/形状异常=缺席）
 * @returns {{dimensions:Object, assessment:{bucket,prob,rule}, anchors:Object}}
 * @throws {Error} 维度题在场但未知桶名（题集/映射漂移防线）
 */
function buildBuyPointObservation(answers, anchors = null) {
  const dimensions = {};
  for (const id of DIMENSION_IDS) {
    dimensions[id] = _choice(answers, id, DIMENSION_LEVELS[id], false);
  }
  const rawVs = anchors ? anchors.currentVsLaunchPct : null;
  const vsLaunch = typeof rawVs === 'number' && Number.isFinite(rawVs) ? rawVs : null;
  // 纯门链（BP58——盘型门→点位性质门→活跃度门→筹码门（停用））
  // ①盘型门（BP30 前置预判断；BP60 收口四桶）：· retail_pvp/famous_monopoly
  //   两异常桶硬拒（不要参与）；· ⑥sustained_climb 位置臂：≤+10（含破发）起点段
  //   放行，已拉离/锚缺失拒（判型归 Jev、位置归代码——宁拦不冒充）；· none
  //   统一位置臂：≤+28.5（BP69；BP58 立线 27.5）放行，已拉离/锚缺失拒（①④⑤⑧判型已随桶域
  //   删除，正常形状全归 none）
  const patternArms = [];
  if (dimensions.market_pattern) {
    const mp = dimensions.market_pattern.bucket;
    if (PATTERN_GATE_POOR_BUCKETS.includes(mp)) {
      patternArms.push(dimensions.market_pattern);
    } else if (mp === 'sustained_climb') {
      if (vsLaunch == null || vsLaunch > SUSTAINED_CLIMB_LAUNCH_PCT) patternArms.push(dimensions.market_pattern);
    } else {
      // none 走统一位置门（BP60 四桶化后唯一正常桶）
      if (vsLaunch == null || vsLaunch > NORMAL_ENTRY_LAUNCH_PCT) patternArms.push(dimensions.market_pattern);
    }
  }
  // ②点位性质门（BP58 新题）：crash 庄离场直线砸盘 → poor（rule=entry_gate——
  //   「我希望买入的是，活跃交易中对倒中的低价/正常下跌造成的低价，而不是庄家
  //   离场时的暴跌」）；spike 已出拦域（BP68 判型落档不拦）、normal_dip/flat
  //   放行；答案缺席容缺不拦（拒=有证据的拒绝；旧档 BP51 及以前无 entry_shape
  //   答案=门自动失效）
  const entryArms = dimensions.entry_shape
    && ENTRY_GATE_POOR_BUCKETS.includes(dimensions.entry_shape.bucket)
    ? [dimensions.entry_shape] : [];
  // ③活跃度门（BP60 收单题——market_heat 臂已随题退役删除；BP58 起 ultra 无条件
  //   拦——三豁免臂已随宿主桶退役删除）：activity_level ∈ {low（CD 七要素低档
  //   形状）, ultra（机器盘级极端密集——「act 为 ultra 也不玩」）}→ poor
  //   （rule=activity_gate；旧档带 market_heat 答案不被消费不 throw）
  const gateArms = [
    dimensions.activity_level && ACTIVITY_GATE_POOR_BUCKETS.activity_level.includes(dimensions.activity_level.bucket) ? dimensions.activity_level : null,
  ].filter(Boolean);
  // ④筹码门（BP14 holder 单臂；BP54 停用 CHIP_GATE_ENABLED=false 不产出——
  //   chipArms 照算留档观察，恢复=true 一键还原；BP52 restart 豁免已随⑦桶退役删）
  const chipArms = [
    dimensions.holder_concentration && dimensions.holder_concentration.bucket === 'strong' ? dimensions.holder_concentration : null,
  ].filter(Boolean);
  const bestProb = (arr) => (arr.length ? Math.max(...arr.map((e) => e.prob)) : null);
  let bucket, prob, rule;
  if (patternArms.length) {
    bucket = 'poor'; prob = bestProb(patternArms); rule = 'pattern_gate';
  } else if (entryArms.length) {
    bucket = 'poor'; prob = bestProb(entryArms); rule = 'entry_gate';
  } else if (gateArms.length) {
    bucket = 'poor'; prob = bestProb(gateArms); rule = 'activity_gate';
  } else if (CHIP_GATE_ENABLED && chipArms.length) {
    // BP54 停用开关（false=holder strong 不拦，chipArms 照算留档观察）
    bucket = 'poor'; prob = bestProb(chipArms); rule = 'chip_gate';
  } else {
    // BP48 纯门链收口：全部门过=neutral 放行（无质量层；prob=null 无档位概率）
    bucket = 'neutral'; prob = null; rule = 'gates_passed';
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
    // 综合判定（BP58 纯门链：pattern_gate → entry_gate → activity_gate →
    // chip_gate（停用） → gates_passed=neutral 放行；rule=门来源留痕）
    assessment,
    // 数值锚（纯事实透传：观测/校准素材，非档位判定；异常形状缺席不冒充）
    anchors: {
      // 时点位置族
      tokenAgeSec: _num(b, 'tokenAgeSec'),
      spanSec: _num(b, 'spanSec'),
      currentVsAthPct: _num(b, 'currentVsAthPct'),
      secSinceAth: _num(b, 'secSinceAth'),
      // 发行价位置族（BP5：截窗未覆盖出生段 → null 不冒充；launchCovered boolean → 1/0 数值化；
      // BP58 curVsMinGapPct=现价较锚窗最低价距离（crash 贴底臂判读原料，minVs null→null 不冒充））
      launchPriceBnb: _num(b, 'launchPriceBnb'),
      currentVsLaunchPct: _num(b, 'currentVsLaunchPct'),
      athVsLaunchPct: _num(b, 'athVsLaunchPct'), // BP39 开盘拉高出货度量锚（锚窗最高价较发行价 %）
      minVsLaunchPct: _num(b, 'minVsLaunchPct'), // 锚窗涨起后最低价较发行价 %（BP44 定义=首个突破 almost 上界之后，创新高不遮蔽回落；BP60 ⑦桶删除后消费者=famous 轴前置「再起来」价格维度判读锚）
      curVsMinGapPct: _num(b, 'curVsMinGapPct'), // BP58 点位性质锚（现价−minVsLaunchPct，单位个百分点；≤2=贴着锚窗最低价）
      launchCovered: b.launchCovered === null || b.launchCovered === undefined ? null : (b.launchCovered ? 1 : 0),
      // 市值位置族（BP2：supply 缺失 null fail-closed）
      mcapBnb: _num(b, 'mcapBnb'),
      mcapPeakBnb: _num(b, 'mcapPeakBnb'),
      mcapFromPeakPct: _num(b, 'mcapFromPeakPct'),
      // holder 流向族（BP2：tok 缺失 null fail-closed；delta 可负）
      holdersNow: _num(b, 'holdersNow'),
      holdersDelta60: _num(b, 'holdersDelta60'),
      // 近窗动量族（BP6 短窗 5/10/30s；可负；BP10 maxChg5=回看速度锚；BP58 三键=
      // entry_shape 判读原料——maxDn5 全窗最深 5s 段跌幅、nearMaxUp5/nearMaxDn5=
      // 锚前 120s（BP_NEAR_SPEED_SEC）临近段最深 5s 段涨/跌，<4 可靠价 null 不冒充）
      chg5Pct: _num(b, 'chg5Pct'),
      chg10Pct: _num(b, 'chg10Pct'),
      chg30Pct: _num(b, 'chg30Pct'),
      maxChg5Pct: _num(b, 'maxChg5Pct'),
      maxDn5Pct: _num(b, 'maxDn5Pct'),
      nearMaxUp5Pct: _num(b, 'nearMaxUp5Pct'),
      nearMaxDn5Pct: _num(b, 'nearMaxDn5Pct'),
      // BP72 臂 B 近期暴跌血缘锚（锚前 30s 内最深 5s 段深度/距今/未收复幅度；
      // 首版落地漏透传 mapper anchors——state 直供行在=Jev 判定不受影响，此处补
      // digest 落档与 res.anchors 审计读数；mapper-only additive 题集不 bump）
      recentDip5Pct: _num(b, 'recentDip5Pct'),
      recentDip5SecAgo: _num(b, 'recentDip5SecAgo'),
      recentDip5UnrecoveredPct: _num(b, 'recentDip5UnrecoveredPct'),
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
      // CD394 尾窗键（act 定档主锚判读原料——尾 10s/前 20s 断崖对比，短窗照出）
      actNearTail10TickN: _actNum(anchors, 'nearTail10TickN'),
      actNearTail10BnbPerMin: _actNum(anchors, 'nearTail10BnbPerMin'),
      actNearPre20BnbPerMin: _actNum(anchors, 'nearPre20BnbPerMin'),
      actNearTail10SellWallets: _actNum(anchors, 'nearTail10SellWallets'), // CD394 出货臂判读线（末 10s 独立卖侧钱包数）
      // BP41 真庄反锚腿②：尾段买 ÷ 全窗买 ×100（拉升进行时=买量仍占全窗流量实质份额）
      actNearTail5BuySharePct: _actNum(anchors, 'nearTail5BuySharePct'),
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
      // 开盘后买入与密度——②(a) 大户参与/③ famous 独食判读数值原料；
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
  PRICE_TREND_LEVELS,
  ACTIVITY_LEVELS,
  HOLDER_CONCENTRATION_LEVELS,
  PRICE_LEVEL_LEVELS,
  MARKET_PATTERN_LEVELS,
  PATTERN_GATE_POOR_BUCKETS,
  SUSTAINED_CLIMB_LAUNCH_PCT,
  NORMAL_ENTRY_LAUNCH_PCT,
  ENTRY_SHAPE_LEVELS,
  ENTRY_GATE_POOR_BUCKETS,
  CHIP_GATE_ENABLED,
  ACTIVITY_GATE_POOR_BUCKETS,
  ASSESSMENT_LEVELS,
};
