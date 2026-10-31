/**
 * 作弊盘检测 Jev 结果映射（CD1）——纯函数，零 DB 零网络
 *
 * D3.0 架构（2026-10-31 用户裁定「现象锚观测+代码综合」分层）：
 * Jev 只答 8 现象程度题（Choice 四档 none/weak/moderate/strong）+ retail Score；
 * 盘面三分类 verdict 由本模块综合规则从现象锚**导出**——Jev 不再端到端判性质。
 *
 * 为什么综合进代码（而非二段 Jev）：①规则改动可对 answers_raw **零配额重放**
 * （54 票现象标注一次落库，规则迭代无限次）②每现象可单独对拍归因（原 Q1 判错
 * 无法定位错在哪层）③权重/阈值确定可审计。二段 Jev 综合为后续可选升级。
 *
 * 综合规则（初版=D2.x 两轮对拍沉淀的 20 条校准信号直译；调参只改本文件，
 * 182 重放脚本零 Jev 成本验证）：
 * - 作弊臂（按优先序首命中 → cheat）：
 *   A1 coordinated_sell_back ≥ moderate   —— 买簇→同步卖回配对（最强作弊签名）
 *   A2 creator_front_run ≥ strong          —— 抢跑自卖/配额倾倒（strong 才坐实：
 *                                            creator 部分卖=常态不可坐实，校准信号 ④）
 *   A3 quota_ladder_heat ≥ moderate ∧ retail ≤ 3 —— 假热度+散户缺席（砸盘不要求，
 *                                            校准信号 ⑱；retail null=证据洞按保守低算）
 *   A4 same_block ≥ moderate ∧ equal_amount ≥ moderate ∧ retail ≤ 3
 *                                            —— 双指纹叠加+散户缺席（单指纹在健康票
 *                                            常态在场=校准信号 ③⑯，双叠加才过门）
 * - 健康臂（非 cheat）：retail ≥ 6 ∧ second_wave_absorption ≥ weak ∧
 *   sell_dispersion ≥ moderate → healthy（散户轴三要素，校准信号 ⑯⑲）
 * - 其余 → unhealthy（强庄/低活跃/失衡兜底；时点状态可转化）
 * - unclear 规则不产出（minTicks 8 以下 service 已拦；「无证据」形状落 unhealthy
 *   低活跃子形状=校准信号 ⑪）——VERDICT_COLUMN_MAP 保留映射供兼容域。
 *
 * pattern_type：cheat 时按命中臂映射回 PATTERNS 八桶（runner patternsIncludes
 * 对拍消费）；非 cheat 恒 null（「细分仅 cheat 域」语义不变）。
 * cheat_prob：cheat 时=命中臂主现象 argmax 桶概率（合成值，语义与 D2 的 Q1
 * cheat 桶概率不同——列审计用，无门语义）。
 *
 * JevClient 缺答案 id 直接 throw（fail-loud）——现象题缺失/未知桶名同样 throw
 * （题集/映射漂移防线，调用方落 error 行）；仅 retail Score 形状异常降 null
 * 不拦主判定（D2 语义保留）。
 */

/** 现象题 id 清单（与题集对齐——漂移由未知桶名/缺题 throw 兜住） */
const PHENOMENON_IDS = [
  'same_block_buy_burst',
  'equal_amount_split',
  'coordinated_sell_back',
  'quota_ladder_heat',
  'creator_front_run',
  'strong_hand_real_buy',
  'second_wave_absorption',
  'sell_dispersion',
];

/** 程度档位序（与题集 PHENOMENON_LEVELS 一致；档位比较用） */
const LEVEL_ORDER = { none: 0, weak: 1, moderate: 2, strong: 3 };

/** verdict 列值映射（DDL CHECK 域；unclear 规则不产出、映射留档兼容） */
const VERDICT_COLUMN_MAP = {
  cheat: 'cheat',
  unhealthy: 'unhealthy',
  healthy: 'healthy',
  unclear_insufficient: 'unclear',
};

/** 综合规则阈值（调参单点；A3/A4 散户反证线与 B 臂门槛） */
const RETAIL_ABSENCE_MAX = 3;   // 作弊臂的「散户缺席」线（null=证据洞按保守低算）
const RETAIL_HEALTHY_MIN = 6;   // 健康臂散户线

/** 单现象题 → {bucket, prob, level}（argmax 桶；缺题/未知桶 throw） */
function _phenomenon(answers, id) {
  const a = answers && answers[id];
  if (!a || !a.probabilities) {
    throw new Error(`现象题 ${id} 答案缺失或无概率分布: ${JSON.stringify(a).slice(0, 120)}`);
  }
  let best = null;
  for (const [bucket, p] of Object.entries(a.probabilities)) {
    if (best === null || p > best.prob) best = { bucket, prob: p };
  }
  const level = LEVEL_ORDER[best.bucket];
  if (level === undefined) {
    throw new Error(`现象题 ${id} 未知桶名 '${best.bucket}'（题集/映射漂移——PHENOMENON_LEVELS 须同步）`);
  }
  return { bucket: best.bucket, prob: best.prob, level };
}

/** retail Score → 数值（形状异常 null=证据洞，作弊臂按保守低算） */
function _retail(answers) {
  const q = answers && answers.retail_participation;
  return q && typeof q.score === 'number' && Number.isFinite(q.score) ? q.score : null;
}

/**
 * Jev answers → 落库行字段（综合规则导出 verdict）
 * @param {Object} answers - JevClient.ask 返回的 answers（8 现象 Choice + retail Score）
 * @returns {{verdict:string, cheatProb:number|null, patternType:string|null,
 *            retailParticipation:number|null, ruleAudit:Object}}
 * @throws {Error} 任一现象题缺失/形状异常/未知桶名（调用方落 error 行）
 */
function mapCheatAnswers(answers) {
  const ph = {};
  for (const id of PHENOMENON_IDS) ph[id] = _phenomenon(answers, id);
  const retail = _retail(answers);
  const retailAbsent = retail === null || retail <= RETAIL_ABSENCE_MAX;
  const ge = (id, min) => ph[id].level >= LEVEL_ORDER[min];
  const arm = (name) => `A${name}`;

  // ── 作弊臂（优先序：配对签名 > creator > 假热度 > 双指纹）──
  let verdict = null;
  let hitArm = null;
  let mainPhenom = null;   // 命中臂主现象（cheat_prob 取其 argmax 概率）
  if (ge('coordinated_sell_back', 'moderate')) {
    hitArm = arm(1);
    mainPhenom = ph.coordinated_sell_back;
  } else if (ge('creator_front_run', 'strong')) {
    hitArm = arm(2);
    mainPhenom = ph.creator_front_run;
  } else if (ge('quota_ladder_heat', 'moderate') && retailAbsent) {
    hitArm = arm(3);
    mainPhenom = ph.quota_ladder_heat;
  } else if (ge('same_block_buy_burst', 'moderate')
    && ge('equal_amount_split', 'moderate') && retailAbsent) {
    hitArm = arm(4);
    mainPhenom = ph.same_block_buy_burst.prob >= ph.equal_amount_split.prob
      ? ph.same_block_buy_burst : ph.equal_amount_split;
  }
  if (hitArm) verdict = 'cheat';

  // ── 健康臂（非 cheat；散户轴三要素联立）──
  if (!verdict
    && retail !== null && retail >= RETAIL_HEALTHY_MIN
    && ge('second_wave_absorption', 'weak')
    && ge('sell_dispersion', 'moderate')) {
    verdict = 'healthy';
  }
  if (!verdict) verdict = 'unhealthy'; // 兜底：强庄/低活跃/失衡（时点状态可转化）

  // ── pattern 映射（仅 cheat；臂→PATTERNS 八桶）──
  let patternType = null;
  if (verdict === 'cheat') {
    if (hitArm === arm(1)) {
      patternType = ge('same_block_buy_burst', 'moderate') ? 'same_block_burst'
        : ge('equal_amount_split', 'moderate') ? 'equal_amount_split'
          : 'wash_pump';
    } else if (hitArm === arm(2)) {
      patternType = 'dev_self_trade';
    } else if (hitArm === arm(3)) {
      patternType = 'quota_ladder';
    } else {
      patternType = ph.same_block_buy_burst.prob >= ph.equal_amount_split.prob
        ? 'same_block_burst' : 'equal_amount_split';
    }
  }

  return {
    verdict,
    cheatProb: verdict === 'cheat' && mainPhenom ? mainPhenom.prob : null,
    patternType,
    retailParticipation: retail,
    // 归因审计：命中臂+全现象档位快照（answers_raw 已落库，此为规则侧快照便于直读）
    ruleAudit: {
      hitArm: hitArm || (verdict === 'healthy' ? 'B1' : 'fallback_unhealthy'),
      levels: Object.fromEntries(PHENOMENON_IDS.map((id) => [id, ph[id].bucket])),
    },
  };
}

module.exports = {
  mapCheatAnswers,
  VERDICT_COLUMN_MAP,
  PHENOMENON_IDS,
  LEVEL_ORDER,
  RETAIL_ABSENCE_MAX,
  RETAIL_HEALTHY_MIN,
};
