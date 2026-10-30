/**
 * 作弊盘检测 Jev 结果映射（CD1）——纯函数，零 DB 零网络
 *
 * 照 jev-result-mapper 三核心模式：argmax + 概率门 + 桶名→列值映射表。
 * 决断全在代码侧（题面改锚分不动——叙事侧反复实证的教训），Jev 只出概率分布。
 *
 * - Q1 market_health_verdict（Choice 四桶）：
 *   argmax=cheat 且 P≥0.5 → 'cheat'；argmax=cheat 但 P<0.5 → 剔除 cheat 桶后
 *   重取 argmax（runner-up 规则——「协同作弊」是重主张，低置信不给坐实）；
 *   其余桶按 argmax 直落。
 *   桶名→DDL CHECK 列值映射表显式钉死：unclear_insufficient→'unclear'
 *   （桶名≠列值，漏映射=INSERT 违 CHECK 整行静默丢——事故防线）。
 * - Q2 cheat_pattern（Choice 六桶）：仅 verdict='cheat' 时消费，argmax 且 P≥0.4
 *   才落 pattern_type，否则 null；桶名与列值同形直传（pattern_type 无 CHECK）。
 * - Q3 retail_participation（Score 0-10）：score 值直落。
 *
 * JevClient 对缺答案 id 直接 throw（fail-loud）——本模块假设三题全在；答案形状
 * 异常（缺 probabilities/score）按 error 处理由调用方捕获落 error 行。
 */

/** Q1 桶名 → cheat_detection.verdict 列值（DDL CHECK 域） */
const VERDICT_COLUMN_MAP = {
  cheat: 'cheat',
  unhealthy: 'unhealthy',
  healthy: 'healthy',
  unclear_insufficient: 'unclear',
};

/** Q1 cheat 判定的概率门（≥0.5 才坐实） */
const CHEAT_PROB_GATE = 0.5;
/** Q2 pattern 落库概率门（细分主张比三分类弱，门略松） */
const PATTERN_PROB_GATE = 0.4;

/**
 * 取 choice 答案的 argmax 桶与概率（排除指定桶时重取——runner-up 规则）
 * @returns {{bucket:string, prob:number}|null} probabilities 缺失/为空 → null
 */
function _argmax(answer, excludeBucket = null) {
  const probs = answer && answer.probabilities;
  if (!probs) return null;
  let best = null;
  for (const [bucket, p] of Object.entries(probs)) {
    if (excludeBucket !== null && bucket === excludeBucket) continue;
    if (best === null || p > best.prob) best = { bucket, prob: p };
  }
  return best;
}

/**
 * Jev answers → 落库行字段
 * @param {Object} answers - JevClient.ask 返回的 answers（含三题）
 * @returns {{verdict:string, cheatProb:number|null, patternType:string|null,
 *            retailParticipation:number|null, rankedVerdicts:Array}}
 * @throws {Error} Q1 缺失或形状异常（调用方落 error 行）
 */
function mapCheatAnswers(answers) {
  const q1 = answers && answers.market_health_verdict;
  if (!q1 || !q1.probabilities) {
    throw new Error(`market_health_verdict 答案缺失或无概率分布: ${JSON.stringify(q1).slice(0, 120)}`);
  }
  const cheatProb = Object.prototype.hasOwnProperty.call(q1.probabilities, 'cheat')
    ? Number(q1.probabilities.cheat) : null;

  const first = _argmax(q1);
  let effective = first;
  let runnerUpApplied = false;
  if (first && first.bucket === 'cheat' && (cheatProb === null || cheatProb < CHEAT_PROB_GATE)) {
    // runner-up 规则：argmax=cheat 但置信不足 → 剔除 cheat 桶重取
    effective = _argmax(q1, 'cheat') || first;
    runnerUpApplied = true;
  }
  const column = VERDICT_COLUMN_MAP[effective.bucket];
  if (!column) {
    throw new Error(`market_health_verdict 未知桶名 '${effective.bucket}'（题集/映射表漂移——桶名→列值映射表须同步）`);
  }

  // Q2：仅 cheat 消费（观察期也落 unhealthy/healthy 票的 pattern 供研究？
  // 刻意不落——非 cheat 行 pattern_type=null 与「细分仅 cheat 域」的题面声明一致）
  let patternType = null;
  if (column === 'cheat') {
    const q2 = answers.cheat_pattern;
    const p2 = _argmax(q2);
    if (p2 && p2.prob >= PATTERN_PROB_GATE) patternType = p2.bucket;
  }

  // Q3：Score 直落（形状异常→null 不拦主判定）
  let retailParticipation = null;
  const q3 = answers.retail_participation;
  if (q3 && typeof q3.score === 'number' && Number.isFinite(q3.score)) {
    retailParticipation = q3.score;
  }

  return {
    verdict: column,
    cheatProb,
    patternType,
    retailParticipation,
    rankedVerdicts: {
      argmax: first ? first.bucket : null,
      argmaxProb: first ? first.prob : null,
      effective: effective.bucket,
      runnerUpApplied,
    },
  };
}

module.exports = {
  mapCheatAnswers,
  VERDICT_COLUMN_MAP,
  CHEAT_PROB_GATE,
  PATTERN_PROB_GATE,
};
