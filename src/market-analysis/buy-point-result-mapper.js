/**
 * 买入点位分析 Jev 结果映射（BP1）——纯函数，零 DB 零网络
 *
 * 判定形态（BP48/案号 BP44——两质量题退役+盘型位置门收口，用户裁定 2026-11-08
 * 「现在是使用活跃度/盘形做第一层判断，然后根据盘形，再确定能接受的价格范围。
 * 但是点位本身的类似似乎意义不大，而且前期比较难分清」）：维度题档位（8 题
 * 纯参考）+ 综合判定 = **代码侧纯门链**（无质量层）：
 *   ① 盘型门（BP18 五类型学；**BP30 前置为预判断**——用户裁定「market_pattern
 *      要放到很靠前的位置，因为这是个预判断」）：market_pattern ∈ {retail_pvp
 *      散户 PVP/famous_monopoly famous 独食/early_sniper_decay 狙击衰竭}
 *      → poor（rule=pattern_gate，这三种盘子不要参与）；
 *      **盘型位置门（BP48 收口用户裁定「blended 接受 价格 near_launch 以及
 *      almost_launch，当前只有庄盘可以接受 low，其它最多是 near_launch」；
 *      案号 BP48 收紧=strong_backer 也同样不接受 low（用户裁定 2026-11-08，
 *      ①⑤⑧三臂同线 40——判型归 Jev、位置归代码，rule 同 pattern_gate）**：
 *      ⑥sustained_climb
 *      ≤+10%（含破发）起点段放行、已拉离或锚缺失（宁拦不冒充）拒；⑦restart
 *      ≤+40%（near_launch 以内含 almost_launch 与破发）放行、已拉离或锚缺失拒；
 *      ①strong_backer ≤+40%（案号 BP48 自 80 收紧——low 档 +40~80 不再接受）
 *      放行、>+40% 或锚缺失拒；
 *      ⑤blended ≤+40%（almost_launch/near_launch）放行、>+40% 或锚缺失拒；
 *      ⑧golden_point ≤+40% 防御门（判据自带 ≤+20，>+40%=判序错位按⑦同线拒）
 *   ② 活跃度门（BP13 扩双题+BP30 ultra 臂+BP38 strong_backer 豁免）：
 *      market_heat=low（近窗密度）**或** activity_level=low（买点前全窗量级）
 *      **或** activity_level=ultra（机器盘级极端密集——用户裁定「act 为 ultra
 *      也不玩」，对齐 CD M 通道）→ poor（rule=activity_gate；market_heat=ultra
 *      不拦——近窗密度视角不拦过热，只拦全窗量级 ultra；**BP38：盘型=
 *      strong_backer 时 ultra 臂豁免不拦**——强庄盘拉盘天然密集，ultra 密度
 *      不是拒买证据；low 臂不豁免）
 *   ③ 筹码门（BP14 holder 臂单臂）：holder_concentration=strong（TOP 过
 *      CD240 分层线/一人控盘——筹码垄断不参与）→ poor（rule=chip_gate）。
 *      **famous 臂已随 famous_domination 题退役（BP49/案号 BP45 用户裁定
 *      「盘形中已经分析了」）**：famous 判型全归盘型题判读（③独食桶+互斥检查
 *      ≥25 不落⑤①⑥——BP45 再起来域/BP47 厚度域适用域均在题面判读里）；
 *      FAMOUS_AXIS_RELAUNCH_PCT/CHIP_GATE_FAMOUS_POOR_BUCKETS 常量随之删除
 *   ④ 全部门过 → **neutral 放行**（rule='gates_passed'，prob=null——无质量层，
 *      bpPassLevels=['good','neutral'] 门链消费域天然放行）
 * **两道质量题（early_bird_quality/pullback_entry_quality）已退役（BP48）**：
 *   判定职责迁移——大户未清场两臂（BP16/BP17）迁⑦⑧题面判读（B 迁）、深崩阴跌
 *   失血并入⑦题面判读（D 并入⑦）、maxChg5 速度锚不迁移（C 弃——④桶拉高判据
 *   保留在盘型层）；旧档 answers 带两题答案不被消费不 throw（重放兼容）。
 * **tree_position 已退役（BP30 用户裁定「tree_position 可以去掉」）**：题/题面/
 *   state 摆动结构行整链删除；snapshot zigzag 数值锚保留落 digest=纯留档
 *   （历史 run 对拍兼容，本 mapper 无消费者）。
 * **high_chase_quality 已退役（BP30）**：追高形状的拦截由门链与④桶拉高判据承接。
 * **famous_domination/entry_position 已退役（BP49/案号 BP45 用户裁定——「famous
 *   _domination 盘形中已经分析了」「entry_position 现在买入基本不看相对价格」）**：
 *   famous_domination=chip_gate famous 臂（BP30「famous 主导就不玩」）唯一消费者，
 *   退役后 famous 拦截全归 Jev 盘型判读（③独食桶+互斥检查——失去代码侧兜底为知情
 *   trade-off；state 筹码结构行 famous 材料照渲染供③桶判读）；entry_position=
 *   纯参考题三门零消费（现行位置门全用 currentVsLaunchPct 绝对位置，回撤深度无
 *   消费者）零行为变化；旧档 answers 带两题答案不被消费不 throw（重放兼容）。
 * 门题答案缺席（null）= 无证据不拦，放行进下层（拒=有证据的拒绝；位置臂锚缺失
 * = 宁拦不冒充拒）。维度题仍纯透传（argmax 照抄——与 CD D3.5「判断一律 Jev」
 * 同哲学；门规则是用户明裁的确定性规则非加权 grade）。
 *
 * 容错双轨（镜像 cheat mapper 纪律）：
 * - 维度题缺席 → null（容缺：材料薄时 Jev 可能拒答个别维度，存档重放兼容）；
 *   在场答案走 argmax + 桶域校验，未知桶名 throw（题集/映射漂移防线不因容缺放宽）
 * - 观测记录**无 verdict/grade/score/recommendation 键**（纯透传反证，单测锁死
 *   ——rule 键=门来源留痕（pattern_gate/activity_gate/chip_gate/gates_passed）
 *   非档位结论）
 *
 * 桶域常量与题集（llm/buy-point-questions.mjs ESM）同域同值：ESM 无法被本 CJS
 * require，故此处自持副本，由单测 `_test_buy_point_lib.cjs` F 组经 dynamic import
 * 锁两域逐桶相等（改任一侧须同步——版本 bump 纪律兜底）。
 */

/** 维度题 id 清单（与题集对齐——漂移由未知桶名 throw 兜住；BP9 删 sell_pressure；BP13 增 activity_level；BP14 增 famous_domination/holder_concentration；BP18 增 market_pattern；BP30 删 tree_position；BP49 删 famous_domination/entry_position） */
const DIMENSION_IDS = [
  'price_trend',
  'market_heat',
  'activity_level',
  'holder_concentration',
  'price_level',
  'market_pattern',
];

// 两质量题（early_bird_quality/pullback_entry_quality）已随 BP48 退役（用户裁定
// 「现在是使用活跃度/盘形做第一层判断，然后根据盘形，再确定能接受的价格范围。
// 但是点位本身的类似似乎意义不大，而且前期比较难分清」）——QUALITY_IDS 删除；
// 判定职责迁移：大户未清场两臂→⑦⑧题面判读（B 迁）、深崩阴跌失血→⑦题面判读
// （D 并入⑦）、maxChg5 速度锚不迁移（C 弃——④桶拉高判据保留在盘型层）；旧档
// answers 带两题答案不被消费不 throw（重放兼容）。

// ── 桶域（与题集导出同域同值——单测锁相等）──
const PRICE_TREND_LEVELS = ['fast_up', 'slow_up', 'fast_down', 'slow_down', 'flat', 'volatile'];
const HEAT_LEVELS = ['low', 'mid', 'high', 'ultra'];
/** 买点前活跃度四档（BP13：CD activity_level 判法搬运——与 HEAT_LEVELS 同词表） */
const ACTIVITY_LEVELS = ['low', 'mid', 'high', 'ultra'];
// FAMOUS_DOMINATION_LEVELS 已随 famous_domination 题退役删除（BP49/案号 BP45——
//   chip_gate famous 臂退役，famous 判型归盘型题③独食桶+互斥检查）。
/** 持仓集中四桶（BP14：CD240 分层线判法搬运——strong=门桶硬消费） */
const HOLDER_CONCENTRATION_LEVELS = ['none', 'weak', 'moderate', 'strong'];
// ENTRY_POSITION_LEVELS 已随 entry_position 题退役删除（BP49/案号 BP45——纯参考
//   题三门零消费，现行位置门全用 currentVsLaunchPct 绝对位置）。
const PRICE_LEVEL_LEVELS = ['almost_launch', 'near_launch', 'low', 'mid', 'high', 'very_high'];
/** 盘面分类七桶（BP18 用户裁定五类型学；BP34 加 sustained_climb；BP43 加 restart
 * 重启盘：strong_backer 强盘最好类型/retail_pvp 散户 PVP（门桶拒买）/famous_monopoly
 * famous 独食（门桶拒买）/early_sniper_decay 狙击衰竭（门桶拒买）/blended_unremarkable
 * 融合盘中性可赌/sustained_climb 持续拉升弱回调（走独立位置门非三桶硬拒）/restart
 * 重启盘（走独立位置门非三桶硬拒） */
const MARKET_PATTERN_LEVELS = ['strong_backer', 'retail_pvp', 'famous_monopoly', 'early_sniper_decay', 'blended_unremarkable', 'sustained_climb', 'restart', 'golden_point'];
/** 盘型门拒买桶（BP18：retail_pvp/famous_monopoly/early_sniper_decay 三桶硬拒；
 * strong_backer（最好类型）与 blended_unremarkable（融合可赌）不拦；BP30 起为
 * 判定链首门（预判断最前）；BP34 的 sustained_climb **刻意不入本表**——走
 * SUSTAINED_CLIMB_LAUNCH_PCT 独立位置臂（贴发行价起点段放行、已拉离/锚缺失拒） */
const PATTERN_GATE_POOR_BUCKETS = ['retail_pvp', 'famous_monopoly', 'early_sniper_decay'];
/** ⑥sustained_climb 参与位置界（BP34 用户裁定「这种只能临近发布价格参与」）：现价
 * 较发行价 ≤+10%（含破发）=临近发行价起点段放行走后续门链（活跃度门/筹码门，
 * BP48 前为「放行两道质量题」）；已拉离
 * （>+10%）或锚缺失（宁拦不冒充——发行价位置 ? = ticks 未覆盖出生段）→ 盘型门拒。
 * 界由羊王 0x5a8d94c6 四点定标：S154 −4.2% 贴发行价（用户裁 neutral 放行）与
 * S155 +17.1%（拒）之间取 10；S072 無為 +86.6% 不落⑥ 由①双臂保护（12min 前 8
 * 大户人人有卖=对倒平衡——BP34 初版「强庄身份豁免」致⑥零命中，BP35 收口为家族
 * 归属句非逃逸门，身份证据不豁免双臂判据） */
const SUSTAINED_CLIMB_LAUNCH_PCT = 10;
/** ⑦restart 重启盘参与位置界（BP43/CD381 2026-11-08 用户裁定「盘型判重启后现价
 * ≤+40% 位置门放行质量题」）：盘型判 restart（经历一定交易量后价格回到过
 * almost_launch）的票，现价较发行价 ≤+40%（near_launch 以内，含 almost_launch
 * 与破发）=放行走后续门链（活跃度门/筹码门，BP48 前为「放行两道质量题」）；已拉离
 * （>+40%）或锚缺失（宁拦不冒充——发行价
 * 位置 ? = ticks 未覆盖出生段）→ 盘型门拒。与 ⑥SUSTAINED_CLIMB_LAUNCH_PCT 同款
 * 「判型归 Jev、位置归代码」模式；交易量门槛（tradeCount≥10 ∧ buyVolumeBnb≥1.5）
 * 是题面判据材料非代码门——BP42「不搞代码门」铁律 */
const RESTART_LAUNCH_PCT = 40;
/** ①strong_backer 强庄盘参与位置界（BP48/案号 BP44 立法 80；**案号 BP48 收紧
 * 2026-11-08 用户裁定「strong_backer 也同样不接受 low 的价格范围」——①⑤⑧三臂
 * 同线 40**）：现价较发行价 ≤+40%（almost_launch/near_launch 含破发）=放行走
 * 后续门链（活跃度门/筹码门）；>+40%（low 档 +40~80 起，庄盘不再独享）或锚缺失
 * （宁拦不冒充）→ 盘型门拒（BP25「坑要够深」一档帽语义的盘型化收口）；与⑥⑦
 * 同款「判型归 Jev、位置归代码」模式 */
const STRONG_BACKER_LAUNCH_PCT = 40;
/** ⑤blended_unremarkable 融合盘参与位置界（BP48/案号 BP44 2026-11-08 用户裁定
 * 「blended 接受 价格 near_launch 以及 almost_launch」）：现价较发行价 ≤+40%
 * （almost_launch/near_launch 含破发）=放行走后续门链；>+40%（low 档起）或锚
 * 缺失（宁拦不冒充）→ 盘型门拒——案号 BP48 起 low 档（+40~80）无盘型接受
 * （strong_backer 同线收紧），融合盘最多 near_launch。与⑥⑦①同款「判型归
 * Jev、位置归代码」模式 */
const BLENDED_LAUNCH_PCT = 40;
/** ⑧golden_point 黄金点防御门（BP48/案号 BP44）：判据自带位置（现价在
 * almost_launch 区内 ≤+20 含破发），代码侧另有 ≤+40 防御门兜判序错位——判⑧但
 * 现价 >+40%=判序错位按⑦位置门同线拒；锚缺失同拒（宁拦不冒充）。与
 * RESTART_LAUNCH_PCT「同线同值各自常量」先例 */
const GOLDEN_POINT_LAUNCH_PCT = 40;
/** ④early_sniper_decay 高热近价豁免（案号 BP46/2026-11-08 用户裁定「如果热度是
 * 高热以上，价格到 near_launch 以内，可以买」——适用域=盘型④狙击衰竭；苍蝇
 * 0xb30f0b8a…7777 ④贴线误杀攒批（BP43 案）的立法落地）：盘型判④ ∧ market_heat∈
 * {high,ultra}（高热以上——④的「衰竭/无人接」前提被高热度证伪，热度本身就是
 * 活跃证据）∧ 现价较发行价 ≤+40%（near_launch 以内，含 almost_launch 与破发）
 * → ④臂不拦放行走后续门链；**同条件一并豁免活跃度门 ultra 臂**（高热④票的
 * 密集是真实参与非机器盘——BP38 strong_backer ultra 豁免同构扩展；act low/
 * heat low 死寂臂不豁免照拦）。market_heat 答案缺席（旧档重放）/curVsLaunchPct
 * 锚缺失/已拉离（>+40%）→ 不豁免宁拦不冒充（同⑥⑦位置门模式）。反例天然
 * 保护：BEM +56.4/FIGHT +76.1 未回到 near_launch 照拦。同线同值各自常量先例
 * （PUMP_EXEMPT/RESTART/BLENDED/GOLDEN=40）；mapper-only 门改动不 bump 题集
 * 版本（BP37/CD380 先例——exempt 落 assessment 留痕即指纹）；代码不改写
 * Jev 桶判定（④答案原样保留，仅参与决策=与⑥⑦位置门/actUltraExempt 同形态）。
 * **BP47 收紧（2026-11-08 用户裁定「openShare < 80 ∧ heat = high」——bt-v83/v84
 * 两窗④真判票 187 票复盘：④亏损全部来自「热度只在开盘一波」的票，openSegBuy
 * SharePct=100% 两窗各 53 票各亏 ~1 BNB（开盘一波流冲高砸落=买点落在下跌途中
 * 残余热度里）；<70∧high 两窗 27 票 +1.39、<80∧high 30 票 +1.39（70-80 层 3 票
 * 零贡献，80 线与 70 线净额等价略宽容）；heat=ultra 全层两窗皆负（63 票 -1.08
 * 机器盘密度，BP45 ⑧「ultra 机器盘不适用」同语义——BP46 立臂时漏了同款排除）。
 * 三要件=heat 仅 high（ultra 退出豁免域）∧ openSegBuySharePct < 80（开盘 30s 段
 * 买入占锚窗总买入比——「开盘段之后热度仍在延续」才是「大量交易后活跃度依然
 * 高」的真④语义；票龄/actTickCount 无区分度：臂内 143/187 票 <60s、age≥300 仅
 * 2 票全亏，tick≥200 层反而 -0.56）∧ curVsLaunchPct ≤+40 照旧；openShare 锚
 * 缺失（截窗未覆盖开盘段/旧档断代）→ 不豁免宁拦不冒充。mapper-only 不 bump 题
 * 集版本；豁免票 exempt 留痕带 openSegBuySharePct 值）** */
const SNIPER_DECAY_HEAT_LAUNCH_PCT = 40;
const SNIPER_DECAY_HEAT_BUCKETS = ['high'];
const SNIPER_DECAY_OPEN_SHARE_MAX = 80;
// FAMOUS_AXIS_RELAUNCH_PCT（BP45 famous 轴再起来域 20）已随 famous_domination 题
//   退役删除（BP49/案号 BP45）——唯一消费者 chip_gate famous 臂同退役；再起来域
//   语义（落底后 famous 未离场=正面证据）保留在盘型题⑦⑧桶判读里（题面层）。
// BP42（2026-11-08 用户裁定）：真庄反锚机械门整段拆除，回归 BP12「不搞代码门」
// 两次明裁——代码不改写 Jev 桶判定；S072/S006/S109 类真庄贴顶票被④吞=设计内
// 代价入攒批池（复审候选=题面独立前置题形态，仍非代码门）。题面层④桶反锚判序
// 前置句与尾段占比锚（nearTail5BuySharePct 数据供给）保留不动。
/** 活跃度门拒买档（BP30：low=活跃度不够；activity_level=ultra=机器盘级极端密集
 * 「act 为 ultra 也不玩」——对齐 CD 侧 M 通道 hyper_activity 拒买级；market_heat
 * 的 ultra 不拦：近窗密度视角不拦过热，只拦全窗量级 ultra；
 * BP38 豁免：盘型=strong_backer 时 ultra 臂不拦——强庄盘拉盘天然密集，ultra
 * 密度不是拒买证据（用户裁定「盘型如果是 strong_backer，活跃度 ultra 豁免，不
 * 给 poor」）；low 臂（heat/activity）不豁免——活跃度死寂的强庄盘照拦） */
const ACTIVITY_GATE_POOR_BUCKETS = { market_heat: ['low'], activity_level: ['low', 'ultra'] };
// CHIP_GATE_FAMOUS_POOR_BUCKETS 已随 famous_domination 题退役删除（BP49/案号
//   BP45）——筹码门只剩 holder_concentration strong 单臂。
// 质量题桶域 QUALITY_LEVELS 已随两题退役删除（BP48）。
/** 综合判定桶域（BP48 纯门链产物 ∈ {neutral=门全过放行, poor=门拒}；good 不再
 * 产出——保留 good/insufficient 值为门 bpPassLevels 消费域与历史 digest 行兼容，
 * 桶域不收窄防旧档重放 throw） */
const ASSESSMENT_LEVELS = ['good', 'neutral', 'poor', 'insufficient'];

/** 维度 id → 桶域（题面/桶域增改须同步题集并 bump 版本） */
const DIMENSION_LEVELS = {
  price_trend: PRICE_TREND_LEVELS,
  market_heat: HEAT_LEVELS,
  activity_level: ACTIVITY_LEVELS,
  holder_concentration: HOLDER_CONCENTRATION_LEVELS,
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
 * Jev answers → 买点观测记录（维度档位+纯门链综合判定+数值锚；无 verdict/grade）
 * @param {Object} answers - JevClient.ask 返回的 answers（8 题 Choice 维度；可缺席→null）
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
  // 纯门链（BP48/案号 BP44——两质量题退役，rule 留痕首个命中门）：
  // ①盘型门（BP18 五类型学；BP30 前置——用户裁定「market_pattern 要放到很靠前
  //   的位置，因为这是个预判断」）：retail_pvp/famous_monopoly/early_sniper_decay
  //   → poor（不要参与）；**④桶另有高热近价豁免臂（案号 BP46：④∧heat∈
  //   {high,ultra}∧curVsLaunch ≤+40 放行，详 SNIPER_DECAY_HEAT_LAUNCH_PCT；
  //   BP47 收紧=heat 仅 high ∧ openSegBuySharePct<80）**；
  //   BP34 ⑥ sustained_climb/BP43 ⑦ restart/**BP48 ① strong_backer ≤+40
  //   （案号 BP48 收紧自 80——庄盘同样不接受 low）/⑤ blended ≤+40/⑧ golden_point
  //   ≤+40 防御门——①⑤⑧三臂同线 40**——各桶位置臂（判型归 Jev、位置归代码；
  //   锚缺失一律宁拦不冒充拒）；
  // ②活跃度门（BP13 双题+BP30 ultra 臂+BP38 strong_backer 豁免+BP46 ④高热近价
  //   豁免同盖 ultra 臂——BP47 收紧后豁免票 heat 恒 high，act ultra 臂同盖条件
  //   收紧自动跟随 sniperHeatExempt 三要件）：
  //   market_heat=low（近窗密度死寂）**或** activity_level ∈ {low（CD 七要素
  //   低档形状）, ultra（机器盘级极端密集——「act 为 ultra 也不玩」；盘型=
  //   strong_backer 时豁免不拦——强庄盘拉盘天然密集）}→ poor（rule=activity_gate）；
  // ③筹码门（BP14 holder 单臂——famous 臂已随 famous_domination 题退役 BP49）：
  //   holder_concentration=strong（CD240 分层线/一人控盘；BP15 价格豁免锚照旧）
  //   → poor（rule=chip_gate）；
  // ④全部门过 → neutral 放行（rule='gates_passed'，prob=null——bpPassLevels
  //   消费域 ['good','neutral'] 天然放行）。
  // 门题答案缺席（null）=无证据不拦放行（拒=有证据的拒绝；旧档重放缺答案=该臂
  // 自动失效；位置臂锚缺失=宁拦不冒充拒）。
  // 案号 BP46：④early_sniper_decay 高热近价豁免——盘型④ ∧ market_heat∈{high,ultra}
  //   ∧ curVsLaunchPct ≤+40 → ④臂不拦（放行走活跃度门/筹码门，同条件豁免 act
  //   ultra 臂）；heat 答案缺席/锚缺失/已拉离 → null 不豁免（宁拦不冒充）；
  //   豁免对象仅④（sniperHeatExempt 非 null 时 bucket 必为④，②③不受影响）
  //   **BP47 收紧：heat 仅 high（ultra 退出——机器盘密度两窗皆负）∧ 新增
  //   openSegBuySharePct < 80 硬腿（开盘段后热度延续才放——=100% 开盘一波流
  //   冲高砸落两窗各亏 ~1 BNB 是④亏损全部来源）；openShare 锚缺失同 null 拒**
  const sniperHeatExempt = (() => {
    if (!dimensions.market_pattern || dimensions.market_pattern.bucket !== 'early_sniper_decay') return null;
    if (!dimensions.market_heat || !SNIPER_DECAY_HEAT_BUCKETS.includes(dimensions.market_heat.bucket)) return null;
    const rawVs = anchors ? anchors.currentVsLaunchPct : null;
    const vsLaunch = typeof rawVs === 'number' && Number.isFinite(rawVs) ? rawVs : null;
    if (vsLaunch == null || vsLaunch > SNIPER_DECAY_HEAT_LAUNCH_PCT) return null;
    const openShare = _openNum(anchors, 'buySharePct');
    if (openShare == null || openShare >= SNIPER_DECAY_OPEN_SHARE_MAX) return null;
    return { code: 'sniper_decay_heat_price', heat: dimensions.market_heat.bucket, curVsLaunchPct: vsLaunch, openSegBuySharePct: openShare };
  })();
  const patternArms = dimensions.market_pattern
    && PATTERN_GATE_POOR_BUCKETS.includes(dimensions.market_pattern.bucket)
    && !sniperHeatExempt
    ? [dimensions.market_pattern] : [];
  // ⑥sustained_climb 位置臂（BP34）：贴发行价起点段放行；已拉离/锚缺失（宁拦不
  // 冒充）入盘型门拒（题面已教位置门语义，此处代码侧硬执行——判型归 Jev 位置归代码）
  if (dimensions.market_pattern && dimensions.market_pattern.bucket === 'sustained_climb') {
    const rawVs = anchors ? anchors.currentVsLaunchPct : null;
    const vsLaunch = typeof rawVs === 'number' && Number.isFinite(rawVs) ? rawVs : null;
    if (vsLaunch == null || vsLaunch > SUSTAINED_CLIMB_LAUNCH_PCT) patternArms.push(dimensions.market_pattern);
  }
  // ⑦restart 重启盘位置臂（BP43）：near_launch 以内（≤+40% 含 almost_launch 与
  //   破发）放行走后续门链；已拉离/锚缺失拒（同⑥模式——判型归 Jev 位置归代码）
  if (dimensions.market_pattern && dimensions.market_pattern.bucket === 'restart') {
    const rawVs = anchors ? anchors.currentVsLaunchPct : null;
    const vsLaunch = typeof rawVs === 'number' && Number.isFinite(rawVs) ? rawVs : null;
    if (vsLaunch == null || vsLaunch > RESTART_LAUNCH_PCT) patternArms.push(dimensions.market_pattern);
  }
  // ①strong_backer 强庄盘位置臂（BP48 立法 80；案号 BP48 收紧）：≤+40%
  //   （almost_launch/near_launch 含破发——庄盘同样不接受 low）放行走后续门链；
  //   >+40%（low 档 +40~80 起）或锚缺失拒（同⑥⑦模式；①⑤⑧三臂同线 40）
  if (dimensions.market_pattern && dimensions.market_pattern.bucket === 'strong_backer') {
    const rawVs = anchors ? anchors.currentVsLaunchPct : null;
    const vsLaunch = typeof rawVs === 'number' && Number.isFinite(rawVs) ? rawVs : null;
    if (vsLaunch == null || vsLaunch > STRONG_BACKER_LAUNCH_PCT) patternArms.push(dimensions.market_pattern);
  }
  // ⑤blended_unremarkable 融合盘位置臂（BP48）：≤+40%（almost_launch/near_launch
  //   含破发——「blended 接受 价格 near_launch 以及 almost_launch」）放行走后续
  //   门链；>+40%（low 档起——案号 BP48 起无盘型接受 low）或锚缺失拒（同⑥⑦模式）
  if (dimensions.market_pattern && dimensions.market_pattern.bucket === 'blended_unremarkable') {
    const rawVs = anchors ? anchors.currentVsLaunchPct : null;
    const vsLaunch = typeof rawVs === 'number' && Number.isFinite(rawVs) ? rawVs : null;
    if (vsLaunch == null || vsLaunch > BLENDED_LAUNCH_PCT) patternArms.push(dimensions.market_pattern);
  }
  // ⑧golden_point 黄金点防御门位置臂（BP48）：判据自带位置（现价 almost_launch
  //   区内 ≤+20 含破发），此处 ≤+40 防御门兜判序错位——判⑧但现价 >+40%=判序
  //   错位按⑦位置门同线拒；锚缺失拒（宁拦不冒充，同⑥⑦模式）
  if (dimensions.market_pattern && dimensions.market_pattern.bucket === 'golden_point') {
    const rawVs = anchors ? anchors.currentVsLaunchPct : null;
    const vsLaunch = typeof rawVs === 'number' && Number.isFinite(rawVs) ? rawVs : null;
    if (vsLaunch == null || vsLaunch > GOLDEN_POINT_LAUNCH_PCT) patternArms.push(dimensions.market_pattern);
  }
  // BP38：strong_backer ultra 豁免——强庄盘拉盘天然密集，ultra 密度不是拒买证据
  //   （ultra 臂仅此豁免；low 臂不豁免——活跃度死寂强庄盘照拦；market_pattern 缺席
  //   时豁免不生效=照拦保守方向；盘型门最前，走④②③⑥拒的票轮不到本门不受影响）
  const actUltraExempt = dimensions.activity_level
    && dimensions.activity_level.bucket === 'ultra'
    && dimensions.market_pattern
    && dimensions.market_pattern.bucket === 'strong_backer';
  // 案号 BP46：④高热近价豁免成立时同盖 ultra 臂——高热④票的密集是真实参与非
  //   机器盘（豁免条件含 heat∈{high,ultra} 本身排除死寂；ultraArmExempt 语义=
  //   「act ultra 臂豁免」——act low 死寂臂不豁免照拦，actUltraExempt 自带
  //   bucket===ultra 前提、sniperHeatExempt 侧显式补同一前提防 low 臂误豁免）
  const ultraArmExempt = actUltraExempt
    || (Boolean(sniperHeatExempt) && Boolean(dimensions.activity_level) && dimensions.activity_level.bucket === 'ultra');
  const gateArms = [
    dimensions.market_heat && ACTIVITY_GATE_POOR_BUCKETS.market_heat.includes(dimensions.market_heat.bucket) ? dimensions.market_heat : null,
    dimensions.activity_level && ACTIVITY_GATE_POOR_BUCKETS.activity_level.includes(dimensions.activity_level.bucket) && !ultraArmExempt ? dimensions.activity_level : null,
  ].filter(Boolean);
  // ③筹码门（BP49 起单臂）：famous 臂已随 famous_domination 题退役（BP49/案号
  //   BP45 用户裁定「盘形中已经分析了」）——famous 拦截归盘型题③独食桶+互斥
  //   检查（BP45 再起来域/BP47 厚度域在题面判读里）；holder strong 臂照旧
  const chipArms = [
    dimensions.holder_concentration && dimensions.holder_concentration.bucket === 'strong' ? dimensions.holder_concentration : null,
  ].filter(Boolean);
  const bestProb = (arr) => (arr.length ? Math.max(...arr.map((e) => e.prob)) : null);
  let bucket, prob, rule;
  if (patternArms.length) {
    bucket = 'poor'; prob = bestProb(patternArms); rule = 'pattern_gate';
  } else if (gateArms.length) {
    bucket = 'poor'; prob = bestProb(gateArms); rule = 'activity_gate';
  } else if (chipArms.length) {
    bucket = 'poor'; prob = bestProb(chipArms); rule = 'chip_gate';
  } else {
    // BP48 纯门链收口：全部门过=neutral 放行（无质量层；prob=null 无档位概率）
    bucket = 'neutral'; prob = null; rule = 'gates_passed';
  }
  const assessment = { bucket, prob, rule };
  // 案号 BP46 豁免留痕（豁免成立时 additive——旧形状零变化；豁免后被其它门拒
  //   （如 chip strong）也带，审计完整）
  if (sniperHeatExempt) assessment.exempt = sniperHeatExempt;
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
    // 综合判定（BP48 纯门链：pattern_gate → activity_gate → chip_gate →
    // gates_passed=neutral 放行；rule=门来源留痕；qualities 键已随两题退役删除）
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
      athVsLaunchPct: _num(b, 'athVsLaunchPct'), // BP39 开盘拉高出货度量锚（锚窗最高价较发行价 %）
      minVsLaunchPct: _num(b, 'minVsLaunchPct'), // BP43 restart 重启盘轨迹锚（锚窗涨起后最低价较发行价 %；BP44 定义=首个突破 +20% 之后，创新高不遮蔽回落）
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
  PRICE_TREND_LEVELS,
  HEAT_LEVELS,
  ACTIVITY_LEVELS,
  HOLDER_CONCENTRATION_LEVELS,
  PRICE_LEVEL_LEVELS,
  MARKET_PATTERN_LEVELS,
  PATTERN_GATE_POOR_BUCKETS,
  SUSTAINED_CLIMB_LAUNCH_PCT,
  RESTART_LAUNCH_PCT,
  STRONG_BACKER_LAUNCH_PCT,
  BLENDED_LAUNCH_PCT,
  GOLDEN_POINT_LAUNCH_PCT,
  SNIPER_DECAY_HEAT_LAUNCH_PCT,
  SNIPER_DECAY_HEAT_BUCKETS,
  SNIPER_DECAY_OPEN_SHARE_MAX,
  ACTIVITY_GATE_POOR_BUCKETS,
  ASSESSMENT_LEVELS,
};
