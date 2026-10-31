/**
 * 作弊盘检测 Jev 结果映射（CD1）——纯函数，零 DB 零网络
 *
 * D3.0 架构（2026-10-31 用户裁定「现象锚观测+代码综合」分层）：
 * Jev 只答现象程度题（Choice 四档 none/weak/moderate/strong）；
 * 盘面三分类 verdict 由本模块综合规则从现象锚**导出**——Jev 不判性质。
 *
 * 为什么综合进代码（而非二段 Jev）：①规则改动可对 answers_raw **零配额重放**
 * （现象标注一次落库，规则迭代无限次）②每现象可单独对拍归因 ③权重/阈值
 * 确定可审计。二段 Jev 综合为后续可选升级。
 *
 * D3.1 综合规则（2026-10-31 用户裁定题集瘦身后的重设计；55 票 D3.0 重放网格
 * 定形=v5 形状删 sb 臂、买侧结构改代码锚）：
 * - 作弊臂（按优先序首命中 → cheat）：
 *   A1 coordinated_sell_back ≥ strong —— 闭环配对签名（D3.0 实测 strong 6:1:0
 *      近零误报；moderate 档健康票早期获利盘同卖也常见=倒挂，故 moderate 降级
 *      进 A4 需卖分散反证联判）
 *   A2 creator_front_run ≥ strong   —— 抢跑自卖/配额倾倒（strong 8:0:0 零误报；
 *      creator 部分卖=常态不可坐实）
 *   A3 equal_amount_split ≥ strong  —— 强规整等额分仓（strong 10:0:0 零误报）
 *   A4 coordinated_sell_back ≥ moderate ∧ sell_dispersion = none
 *      —— 协同卖回中等在场且卖出完全不分散（v5 网格形状：sd<weak 才坐实；
 *      weak 以上=有零星各自择时卖=早期获利盘常态不坐实）
 *   A5 持仓占比锚过线（anchors 第二参数，代码侧数值门）——
 *      sameBlockHoldPct ≥ SB_HOLD_PCT_MIN 或 equalBandHoldPct ≥ EQ_HOLD_PCT_MIN
 *      —— 累积期作弊形状（买簇仍持有主导份额、卖面干净——D3.0 漏检 7 票的共同
 *      形状，Jev 眼估「同块簇/等额在场」三档全饱和无法分离，占比必须代码算）；
 *      pattern=slow_coordinated_accumulation。锚 null（无合格簇/无人正净持仓）
 *      =有证据的缺席，臂不评。阈值经 182 全量 55 票校准定档，调参零配额重放验证。
 * - 健康臂（非 cheat）：B1 sell_dispersion ≥ moderate → healthy
 *   （卖出分散=真实承接的最佳单一信号，D3.0 实测 healthy 69% vs cheat 22%）
 * - 其余 → unhealthy（强庄/低活跃/失衡兜底；时点状态可转化）
 * - unclear 规则不产出（minTicks 8 以下 service 已拦）——VERDICT_COLUMN_MAP
 *   保留映射供兼容域。
 *
 * anchors 兼容：旧存档（D3.0 起）行无锚 → 传 null/缺省 → A5 不评（重放归因须
 * 知道锚臂静默）；D3.1 起 runner/service 从 snapshot.derived 传入并存档。
 *
 * pattern_type：cheat 时按命中臂映射回 PATTERNS 八桶（runner patternsIncludes
 * 对拍消费）；非 cheat 恒 null（「细分仅 cheat 域」语义不变）。
 * cheat_prob：现象臂=命中臂主现象 argmax 桶概率；锚臂=主导锚持仓占比/100
 * （合成值，列审计用，无门语义）。
 *
 * JevClient 缺答案 id 直接 throw（fail-loud）——现象题缺失/未知桶名同样 throw
 * （题集/映射漂移防线，调用方落 error 行）。
 */

/** 现象题 id 清单（与题集对齐——漂移由未知桶名/缺题 throw 兜住） */
const PHENOMENON_IDS = [
  'equal_amount_split',
  'coordinated_sell_back',
  'creator_front_run',
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

/**
 * A5 持仓占比锚阈值（%）。初值 50=D3.0 归因测量（cheat 中位 58 vs healthy 38.9）
 * 的先验起点；D3.1 182 全量 55 票逐票校准后定档（scripts/cheat-detection 侧
 * 零配额重放验证），调参只改这两个常量。
 */
const SB_HOLD_PCT_MIN = 50;
const EQ_HOLD_PCT_MIN = 50;

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

/** 数值锚读取（形状异常按缺席=null 处理——A5 静默不评，绝不冒充） */
function _anchorPct(anchors, key) {
  const v = anchors && anchors[key];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/**
 * Jev answers → 落库行字段（综合规则导出 verdict）
 * @param {Object} answers - JevClient.ask 返回的 answers（4 现象 Choice）
 * @param {Object|null} [anchors] - snapshot.derived 持仓占比锚
 *   {sameBlockHoldPct, equalBandHoldPct}（% 或 null=无合格簇；缺省/形状异常=A5 不评）
 * @returns {{verdict:string, cheatProb:number|null, patternType:string|null,
 *            ruleAudit:Object}}
 * @throws {Error} 任一现象题缺失/形状异常/未知桶名（调用方落 error 行）
 */
function mapCheatAnswers(answers, anchors = null) {
  const ph = {};
  for (const id of PHENOMENON_IDS) ph[id] = _phenomenon(answers, id);
  const ge = (id, min) => ph[id].level >= LEVEL_ORDER[min];
  const sbHold = _anchorPct(anchors, 'sameBlockHoldPct');
  const eqHold = _anchorPct(anchors, 'equalBandHoldPct');

  // ── 作弊臂（优先序：闭环配对 > creator > 强规整分仓 > 联判卖回 > 持仓占比锚）──
  let verdict = null;
  let hitArm = null;
  let mainPhenom = null;   // 现象臂主现象（cheat_prob 取其 argmax 概率）
  let anchorProb = null;   // 锚臂主占比（cheat_prob=占比/100）
  if (ge('coordinated_sell_back', 'strong')) {
    hitArm = 'A1';
    mainPhenom = ph.coordinated_sell_back;
  } else if (ge('creator_front_run', 'strong')) {
    hitArm = 'A2';
    mainPhenom = ph.creator_front_run;
  } else if (ge('equal_amount_split', 'strong')) {
    hitArm = 'A3';
    mainPhenom = ph.equal_amount_split;
  } else if (ge('coordinated_sell_back', 'moderate') && !ge('sell_dispersion', 'weak')) { // sd=none（<weak）
    hitArm = 'A4';
    mainPhenom = ph.coordinated_sell_back;
  } else if ((sbHold !== null && sbHold >= SB_HOLD_PCT_MIN)
    || (eqHold !== null && eqHold >= EQ_HOLD_PCT_MIN)) {
    hitArm = 'A5';
    anchorProb = Math.max(sbHold ?? 0, eqHold ?? 0) / 100;
  }
  if (hitArm) verdict = 'cheat';

  // ── 健康臂（非 cheat；卖出分散=真实承接单一最佳信号）──
  if (!verdict && ge('sell_dispersion', 'moderate')) {
    verdict = 'healthy';
    hitArm = 'B1';
  }
  if (!verdict) verdict = 'unhealthy'; // 兜底：强庄/低活跃/失衡（时点状态可转化）

  // ── pattern 映射（仅 cheat；臂→PATTERNS 八桶）──
  let patternType = null;
  if (verdict === 'cheat') {
    if (hitArm === 'A1') {
      patternType = ge('equal_amount_split', 'moderate') ? 'equal_amount_split' : 'wash_pump';
    } else if (hitArm === 'A2') {
      patternType = 'dev_self_trade';
    } else if (hitArm === 'A3') {
      patternType = 'equal_amount_split';
    } else if (hitArm === 'A4') {
      patternType = 'wash_pump';
    } else { // A5：累积期协同持仓（买簇持有主导份额、未走卖回闭环）
      patternType = 'slow_coordinated_accumulation';
    }
  }

  return {
    verdict,
    cheatProb: verdict === 'cheat'
      ? (mainPhenom ? mainPhenom.prob : anchorProb)
      : null,
    patternType,
    // 归因审计：命中臂+全现象档位+锚数值快照（answers_raw 已落库，此为规则侧快照便于直读）
    ruleAudit: {
      hitArm: hitArm || (verdict === 'healthy' ? 'B1' : 'fallback_unhealthy'),
      levels: Object.fromEntries(PHENOMENON_IDS.map((id) => [id, ph[id].bucket])),
      anchors: { sameBlockHoldPct: sbHold, equalBandHoldPct: eqHold },
    },
  };
}

module.exports = {
  mapCheatAnswers,
  VERDICT_COLUMN_MAP,
  PHENOMENON_IDS,
  LEVEL_ORDER,
  SB_HOLD_PCT_MIN,
  EQ_HOLD_PCT_MIN,
};
