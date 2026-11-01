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
 * 规则（G3=G2+H 通道+八主判，2026-11-01 批次二 CD27 裁定；G2 基线 42 票 D3.26
 * 存档对拍 34/42（八票偏差见台账 G2 修订段），G3 对存档重放零变化——旧档
 * anchors 无 washPair 键=H 通道缺席不触发、extLevels 无 wash_pair 档=A 通道
 * 主判集扩容对旧档容缺 null 不计）：
 *
 *   cheat（优先级最高）:
 *     A. 八主判题（四现象剔 cr + tier/bw/rat/pump/wash）任一 strong
 *        豁免降级 unhealthy：唯一 strong=pump ∧ sbw=burst ∧ 八主判 moderate
 *        合计<3 ∧ sbHold<50（CD99 形状——停滞后涌入的自然 pump，非协同推价）
 *     B. 四现象 moderate≥3 ∧ sbHold≥50 ∧ dom≠high（现象门刻意严格：放宽到
 *        EXT 含计会把 CD95/CD100 两票真 unhealthy 误判永久拉黑）
 *     C. sbHold≥85（极端同块集中）
 *     H. washPairSellPct≥60 ∧ washPairCount≥3（G3 新增，2026-11-01 批次二
 *        CD27 用户裁定「对倒交易非常严重，如有必要可能需要增加锚」+落法选定
 *        「≥60% 且 ≥3 对 → cheat」——对倒=操纵盘面铁指纹；128 票锚窗分布
 *        126 票零配对、唯一命中 CD27 卖占 95.1%，断层稀有占比条件天然防误触）
 *   unhealthy:
 *     D. famous dom=high（著名钱包掌控度高档——D 通道消费 famous 非bd）
 *     E. Jev activityLevel=low ∧ sbw≠burst（G2 简化，2026-11-01 用户裁定
 *        「活跃度这一臂为 low 的，也判为 unhealthy，不过流量 burst 命中的不要
 *        判定为活跃度 low」——G1 期 t1流<40 吃独食豁免（CD105/CD122）与卖笔≤1
 *        对手盘豁免（CD107）撤销，改由题面 D3.27 burst 反锚在档位源头修正；
 *        sbw=burst 豁免保留为通道层双保险）
 *     F. sbHold≥50（中高同块集中）
 *     G. bd（bundled_trade_dominance）=high（G2 新增，2026-11-01 用户裁定
 *        「捆绑钱包主导 是重要的负面臂」——128 票影响面 65 票 bd=high：人工
 *        cheat 39/unhealthy 17/healthy 7，直落 cheat 误伤 healthy 7 票+17 票
 *        拉黑级偏重，用户选定 unhealthy 档=拒买可重判不清仓；G1 期「bd high
 *        单独不定档（CD98/CD116/CD127 反证）」旧裁定同步废止）
 *   healthy: 其余
 *
 * cr（创建者抢跑）刻意不进主判=辅助判定（用户语义；CD75 cr strong 人工判
 * unhealthy 反证 cr strong 不足以定 cheat）。
 *
 * 容缺语义（fail-open 放行方向，与 GMGN 层「数据不可用不得拦买点」同向）：
 * 档位 null（旧档断代/容缺）不计 strong/moderate；数值锚 null 不触发比较门。
 * 已知例外：sbw null 按「非 burst」处理（burst 豁免需在场证据，无证据不豁免）。
 *
 * 改规则必须 bump CHEAT_GRADE_RULES_VERSION 并同步台账 G 段+跑 42 票黄金集
 * （scripts/cheat-detection/data/cheat-grade-golden-42.json，单测
 * _test_cheat_grade.cjs 对拍锁定防漂移）。
 */

const { PHENOMENON_IDS, EXT_PHENOMENON_IDS } = require('./cheat-result-mapper');

const CHEAT_GRADE_RULES_VERSION = 'G3';

/**
 * 档位→数值映射（G1 因子化投影，2026-11-01 用户指令「以因子的形式放到表达式中」）：
 * 全族数值序（narrativeRating 1/2/3/9 先例同构）——条件串可直接 >=/</== 比较，
 * 调阈值免改枚举；null=未判定/档位断代/容缺（条件比较恒 false，fail-closed 方向
 * 由条件串作者自定：未判定放行须显式 `cheatGrade IS NULL OR` 臂）。
 * 未知档位值（题集演进新增桶）→ null 不冒充（fail-loud 单测锁）。
 */
const CHEAT_LEVEL_SCORES = {
  grade: { healthy: 0, unhealthy: 1, cheat: 2 },
  level: { none: 0, weak: 1, moderate: 2, strong: 3 }, // 四档现象/EXT 题
  sbw: { none: 0, burst: 1 },                          // 停滞突发二桶
  activity: { low: 0, mid: 1, high: 2, ultra: 3 },     // 活跃度档
  dominance: { low: 0, mid: 1, high: 2 },              // 捆绑主导度档
};

/** 档位→数值（未知值/null → null 不冒充） */
function scoreLevel(map, value) {
  if (value == null) return null;
  return Object.prototype.hasOwnProperty.call(map, value) ? map[value] : null;
}

/**
 * 观测产物 → FA 因子投影原料（service 分析链尾部调用，随返回形状透传引擎）：
 * levels=12 题数值档（FA 出口键；washPair D3.28 起入列）、buckets=字符串原值
 * （metadata/日志研究友好）、anchors=数值锚九键（2026-11-01 用户补点「著名钱包
 * 掌控/持仓极不均衡」：obs.anchors 持仓占比四键 sb/eq/t1 供/流 + extras famous
 * 数值/档位——G1 B/C/F 通道 sbHold、E 通道 t1 流、D 通道 famous 档的同源数值；
 * D3.28 同块对敲三键 washPair 数量/卖占/买占——G3 H 通道同源数值，条件串可做
 * 同款门）。
 * activityLevel/bundledDominance/washPair 缺席（<D3.5/<D3.8/<D3.28 旧档）→ null。
 */
function levelsFromObservation(observation, extras = {}) {
  const obs = observation || {};
  const ph = obs.phenomena || {};
  const ex = obs.extLevels || {};
  const fx = extras || {};
  const act = obs.activityLevel && obs.activityLevel.bucket ? obs.activityLevel.bucket : null;
  const dom = obs.bundledDominance && obs.bundledDominance.bucket ? obs.bundledDominance.bucket : null;
  const levels = {
    equalAmountSplit: scoreLevel(CHEAT_LEVEL_SCORES.level, ph.equal_amount_split),
    coordinatedSellBack: scoreLevel(CHEAT_LEVEL_SCORES.level, ph.coordinated_sell_back),
    creatorFrontRun: scoreLevel(CHEAT_LEVEL_SCORES.level, ph.creator_front_run),
    sellDispersion: scoreLevel(CHEAT_LEVEL_SCORES.level, ph.sell_dispersion),
    stallBurstWave: scoreLevel(CHEAT_LEVEL_SCORES.sbw, ex.stall_burst_wave),
    amountTiering: scoreLevel(CHEAT_LEVEL_SCORES.level, ex.amount_tiering),
    sameBlockBuyWave: scoreLevel(CHEAT_LEVEL_SCORES.level, ex.same_block_buy_wave),
    insiderSupplySell: scoreLevel(CHEAT_LEVEL_SCORES.level, ex.insider_supply_sell),
    slowGrindPump: scoreLevel(CHEAT_LEVEL_SCORES.level, ex.slow_grind_pump),
    washPair: scoreLevel(CHEAT_LEVEL_SCORES.level, ex.wash_pair),
    activityLevel: scoreLevel(CHEAT_LEVEL_SCORES.activity, act),
    bundledDominance: scoreLevel(CHEAT_LEVEL_SCORES.dominance, dom),
  };
  const buckets = {
    equalAmountSplit: ph.equal_amount_split ?? null,
    coordinatedSellBack: ph.coordinated_sell_back ?? null,
    creatorFrontRun: ph.creator_front_run ?? null,
    sellDispersion: ph.sell_dispersion ?? null,
    stallBurstWave: ex.stall_burst_wave ?? null,
    amountTiering: ex.amount_tiering ?? null,
    sameBlockBuyWave: ex.same_block_buy_wave ?? null,
    insiderSupplySell: ex.insider_supply_sell ?? null,
    slowGrindPump: ex.slow_grind_pump ?? null,
    washPair: ex.wash_pair ?? null,
    activityLevel: act,
    bundledDominance: dom,
  };
  const an = obs.anchors || {};
  const famousLevel = typeof fx.famousDominanceLevel === 'string' ? fx.famousDominanceLevel : null;
  const anchors = {
    sameBlockHoldPct: _pct(an.sameBlockHoldPct),
    equalBandHoldPct: _pct(an.equalBandHoldPct),
    washPairCount: _pct(an.washPairCount),
    washPairSellPct: _pct(an.washPairSellPct),
    washPairBuyPct: _pct(an.washPairBuyPct),
    top1HoldSupplyPct: _pct(an.top1HoldSupplyPct),
    top1HoldCircPct: _pct(an.top1HoldCircPct),
    famousDominancePct: _pct(fx.famousDominancePct),
    famousDominanceLevel: famousLevel,
    famousDominance: scoreLevel(CHEAT_LEVEL_SCORES.dominance, famousLevel),
  };
  return { levels, buckets, anchors };
}


/** 四现象题（B 通道现象门原料） */
const PHEN_IDS = PHENOMENON_IDS; // [equal_amount_split, coordinated_sell_back, creator_front_run, sell_dispersion]

/** 八主判题：四现象剔 cr + EXT 五题剔 sbw（cr/sbw=辅助判定不进主判；wash_pair D3.28 随 EXT 清单自动入列） */
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
 *   卖笔数，service 从 pull.rows 现数——G2 起 E 通道不再消费（历史 D3.x 豁免
 *   原料），字段保留为 service/digest 兼容形状）
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
  const bd = obs.bundledDominance && typeof obs.bundledDominance.bucket === 'string'
    ? obs.bundledDominance.bucket : null;
  const anchors = obs.anchors || {};
  const sbHold = _pct(anchors.sameBlockHoldPct);
  const washSell = _pct(anchors.washPairSellPct);
  const washCount = _pct(anchors.washPairCount);

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

  // H：同块对敲锚（G3，2026-11-01 批次二 CD27 用户裁定「对倒交易非常严重，如有
  // 必要可能需要增加锚」+落法选定「≥60% 且 ≥3 对 → cheat」——对倒=操纵盘面
  // 铁指纹：≥60% 卖出是同块等额换手且 ≥3 对。锚缺席（旧档/无配对 null）不触发
  if (washSell !== null && washSell >= 60 && washCount !== null && washCount >= 3) {
    reasons.push({ level: 'cheat', code: `H_wash_pair_sell${washSell.toFixed(0)}x${washCount}` });
  }

  // D：著名钱包主导
  if (dom === 'high') {
    reasons.push({ level: 'unhealthy', code: 'D_famous_dominance' });
  }

  // E：活跃度低（G2 简化，2026-11-01 用户裁定「活跃度这一臂为 low 的，也判为
  // unhealthy，不过流量 burst 命中的不要判定为活跃度 low」——t1流<40 吃独食豁免
  // 与卖笔≤1 对手盘豁免撤销；sbw=burst 豁免保留为通道层双保险，主修正前移到
  // 题面 D3.27：burst 形状（长静默后集中涌入）Jev 不再产 low 档）
  if (act === 'low' && sbw !== 'burst') {
    reasons.push({ level: 'unhealthy', code: 'E_low_activity' });
  }

  // F：中高同块集中
  if (sbHold !== null && sbHold >= 50) {
    reasons.push({ level: 'unhealthy', code: `F_sbHold${sbHold.toFixed(0)}` });
  }

  // G：捆绑钱包主导高档（G2，重要负面臂——用户裁定 unhealthy 档）
  if (bd === 'high') {
    reasons.push({ level: 'unhealthy', code: 'G_bundled_dominance' });
  }

  const grade = reasons.some((r) => r.level === 'cheat') ? 'cheat'
    : (reasons.some((r) => r.level === 'unhealthy') ? 'unhealthy' : 'healthy');
  return { grade, reasons, version: CHEAT_GRADE_RULES_VERSION };
}

module.exports = {
  gradeObservation, CHEAT_GRADE_RULES_VERSION, MAIN_IDS,
  CHEAT_LEVEL_SCORES, scoreLevel, levelsFromObservation,
};
