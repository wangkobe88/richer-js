/**
 * 作弊盘检测三级分级规则（G1，2026-11-01 用户裁定立项）——纯函数，零 DB 零网络
 *
 * 输入=buildObservation 观测产物（Jev 档位 + 代码数值锚），输出交易三级
 * cheat / unhealthy / healthy。**D3.5 判定层停产的修订边界（2026-11-01 用户裁定，
 * 案号见台账 G1 段）**：判断仍一律 Jev——本题集只消费 Jev 档位（现象/EXT/活跃度/
 * 捆绑）与代码数值锚（sbHold/t1流），**不做任何「档位→现象强度」的新判断**；本
 * 模块做的是「档位→交易动作」的策略映射（哪些组合算作弊盘不交易/不健康盘重判/
 * 健康盘放行），属引擎侧策略决策（类似条件串评估），非代码产作弊结论。
 *
 * 规则（G1，42 票 D3.26 存档对拍 88% 一致，healthy 侧 9/9 全对；残留五票定性
 * 见台账 G1 段——CD56 版本漂移/CD108↔CD99 人工漂移对称/CD110 t1 豁免副作用/
 * CD119 B 口径权衡/CD121 半坡机器盲区）：
 *
 *   cheat（优先级最高）:
 *     A. 七主判题（四现象剔 cr + tier/bw/rat/pump）任一 strong
 *        豁免降级 unhealthy：唯一 strong=pump ∧ sbw=burst ∧ 七主判 moderate
 *        合计<3 ∧ sbHold<50（CD99 形状——停滞后涌入的自然 pump，非协同推价）
 *     B. 四现象 moderate≥3 ∧ sbHold≥50 ∧ dom≠high（现象门刻意严格：放宽到
 *        EXT 含计会把 CD95/CD100 两票真 unhealthy 误判永久拉黑）
 *     C. sbHold≥85（极端同块集中）
 *   unhealthy:
 *     D. famous dom=high（bd 只有 low/mid/high 档，high 单独不定 cheat——
 *        CD98/CD116/CD127 反证）
 *     E. Jev activityLevel=low ∧ sbw≠burst ∧ t1流<40 ∧ 锚窗卖笔≤1
 *        （「停滞突发不算活跃度低」→ sbw=burst 豁免；t1流≥40=单钱包吃独食
 *        家族豁免（CD105/CD122）；卖笔≥2=有真实对手盘豁免（CD107）——三豁免
 *        各有一对真实票支撑，攒票观察）
 *     F. sbHold≥50（中高同块集中）
 *   healthy: 其余
 *
 * cr（创建者抢跑）刻意不进主判=辅助判定（用户语义；CD75 cr strong 人工判
 * unhealthy 反证 cr strong 不足以定 cheat）。
 *
 * 容缺语义（fail-open 放行方向，与 GMGN 层「数据不可用不得拦买点」同向）：
 * 档位 null（旧档断代/容缺）不计 strong/moderate；数值锚 null 不触发比较门；
 * anchorSellCount 缺失（旧 digest 重放）E 不触发。已知例外：sbw null 按「非
 * burst」处理（burst 豁免需在场证据，无证据不豁免）。
 *
 * 改规则必须 bump CHEAT_GRADE_RULES_VERSION 并同步台账 G 段+跑 42 票黄金集
 * （scripts/cheat-detection/data/cheat-grade-golden-42.json，单测
 * _test_cheat_grade.cjs 对拍锁定防漂移）。
 */

const { PHENOMENON_IDS, EXT_PHENOMENON_IDS } = require('./cheat-result-mapper');

const CHEAT_GRADE_RULES_VERSION = 'G1';

/** 四现象题（B 通道现象门原料） */
const PHEN_IDS = PHENOMENON_IDS; // [equal_amount_split, coordinated_sell_back, creator_front_run, sell_dispersion]

/** 七主判题：四现象剔 cr + EXT 四题剔 sbw（cr/sbw=辅助判定不进主判） */
const MAIN_IDS = [
  'equal_amount_split',
  'coordinated_sell_back',
  'sell_dispersion',
  ...EXT_PHENOMENON_IDS.filter((id) => id !== 'stall_burst_wave'), // tier/bw/rat/pump
];

/** 数值锚读取（null/非有限/负数按缺席——绝不冒充） */
function _pct(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/**
 * 观测记录 → 交易三级
 * @param {Object} observation - buildObservation 产物
 *   {phenomena, extLevels, activityLevel:{bucket}|null, bundledDominance, anchors}
 * @param {Object} [extras] - 分级附加原料
 *   {famousLevel: 'low'|'mid'|'high'|null, anchorSellCount: number|null}
 *   （famousLevel=snapshot.derived.famousDominanceLevel；anchorSellCount=锚窗
 *   卖笔数，service 从 pull.rows 现数——digest 重放旧档无此键=缺席 E 不触发）
 * @returns {{grade:'cheat'|'unhealthy'|'healthy', reasons:Array<{level:string,code:string}>, version:string}}
 */
function gradeObservation(observation, extras = {}) {
  const obs = observation || {};
  const ex = extras || {};
  const ph = obs.phenomena || {};
  const ext = obs.extLevels || {};
  const lv = {};
  for (const id of PHEN_IDS) lv[id] = ph[id] ?? null;
  for (const id of EXT_PHENOMENON_IDS) lv[id] = ext[id] ?? null;

  const sbw = ext.stall_burst_wave ?? null;
  const strongHit = MAIN_IDS.filter((k) => lv[k] === 'strong');
  const modAll = MAIN_IDS.filter((k) => lv[k] === 'moderate').length;
  const modPhen = PHEN_IDS.filter((k) => ph[k] === 'moderate').length;
  const dom = typeof ex.famousLevel === 'string' ? ex.famousLevel : null;
  const act = obs.activityLevel && typeof obs.activityLevel.bucket === 'string'
    ? obs.activityLevel.bucket : null;
  const anchors = obs.anchors || {};
  const sbHold = _pct(anchors.sameBlockHoldPct);
  const t1Circ = _pct(anchors.top1HoldCircPct);
  const sells = Number.isFinite(ex.anchorSellCount) ? ex.anchorSellCount : null;

  const reasons = [];

  // A：七主判任一 strong → cheat；单 pump+burst 形状降级 unhealthy
  if (strongHit.length > 0) {
    const lonePumpBurst = strongHit.length === 1
      && strongHit[0] === 'slow_grind_pump'
      && sbw === 'burst'
      && modAll < 3
      && (sbHold === null || sbHold < 50);
    if (lonePumpBurst) {
      reasons.push({ level: 'unhealthy', code: 'A_downgrade_single_pump_burst' });
    } else {
      reasons.push({ level: 'cheat', code: `A_strong:${strongHit.join('+')}` });
    }
  }

  // B：现象三档堆叠 + 中高同块集中（dom=high 让位 D——著名主导优先归 unhealthy）
  if (modPhen >= 3 && sbHold !== null && sbHold >= 50 && dom !== 'high') {
    reasons.push({ level: 'cheat', code: `B_phen_mod${modPhen}_sbHold${sbHold.toFixed(0)}` });
  }

  // C：极端同块集中
  if (sbHold !== null && sbHold >= 85) {
    reasons.push({ level: 'cheat', code: `C_sbHold${sbHold.toFixed(0)}` });
  }

  // D：著名钱包主导
  if (dom === 'high') {
    reasons.push({ level: 'unhealthy', code: 'D_famous_dominance' });
  }

  // E：活跃度低（三豁免：sbw=burst 突发涌入 / t1流≥40 单钱包吃独食 / 卖笔≥2 真实对手盘）
  if (act === 'low' && sbw !== 'burst' && t1Circ !== null && t1Circ < 40
    && sells !== null && sells <= 1) {
    reasons.push({ level: 'unhealthy', code: `E_low_activity(sells=${sells})` });
  }

  // F：中高同块集中
  if (sbHold !== null && sbHold >= 50) {
    reasons.push({ level: 'unhealthy', code: `F_sbHold${sbHold.toFixed(0)}` });
  }

  const grade = reasons.some((r) => r.level === 'cheat') ? 'cheat'
    : (reasons.some((r) => r.level === 'unhealthy') ? 'unhealthy' : 'healthy');
  return { grade, reasons, version: CHEAT_GRADE_RULES_VERSION };
}

module.exports = { gradeObservation, CHEAT_GRADE_RULES_VERSION, MAIN_IDS };
