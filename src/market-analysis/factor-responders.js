/**
 * 门链因子应答器（Jev 退役·因子代，2026-11-25 用户裁定「退役 Jev 的使用……Jev 的
 * 所有门，都改为因子门……Jev 的调用框架与 Prompt 等等都保留，防止以后再使用」）
 * ——零依赖纯函数，零 DB 零网络。
 *
 * 定位：策略包 modules.{cheatCheck,actFrontGate,buyPointCheck} 取因子代键
 * （module-registry FACTOR_GENERATION_KEY）时，CheatCheckService / BuyPointCheckService
 * 在唯一接缝（JevClient.ask）改由本模块出结论。**产物形状与 Jev 链逐键同构**，
 * 下游零改动：actFrontRoute / gradeObservation（含规则集差集与豁免链）/
 * levelsFromObservation / buildBuyPointObservation / 拉黑 + 清仓联动 / FA 投影 /
 * signal metadata 形状全部照旧。Jev 代代码原样保留（runner / 题集 / Prompt 永久
 * 留档，Jev 转离线审计器）。
 *
 * 现行版本：cheat=CF1 / 前置活跃度=AF2（精简代）；买点=BPF2（精简代 + crash 形态
 * 复核因子臂）。**精简代** = 只留已经是代码的门，不新增任何未经引擎级对拍校准的
 * 拦截。
 *   - AF2：不判档不拒。low / ultra 的「极端拿得准」形状已由门链最前的 FP
 *     act_low / act_ultra 臂（T144）承接；Jev 的 reject_low 面（24h 全局窗约 45
 *     信号 / 日）精简代先放行，结局由确定性回测看，再定活跃度因子分类器的收线。
 *   - CF1：A 主判 / L / E / M 四通道都要 Jev 档位，无因子来源即不产拒；N 通道
 *     虽是纯代码，精简代同样不启用——它的 Jev 代作用域是 AF1 分流后的 mid 票，
 *     精简代没有档位分类就无从保真（T175b 无条件升格三窗净 −0.15 证伪）。
 *   - BPF2：塞单门（BP77 纯代码）与 BP10 minTicks 预门照常在 service 链内评估，
 *     不经本模块；entry_shape 由 crash 形态复核因子臂回答（judgeCrashForm——Jev
 *     「无回调 + 无换手」价格拱复核的因子直译，BPF1 精简代时整段缺席）；
 *     famous_monopoly / one_wave_dump 不产拒（malicious_dump 与 crash 数值判序已由
 *     FP47 代码化）。
 *
 * 档位语义：因子代「未评估」= null（不冒充）。Jev 代 buildObservation 对三道现象题
 * 是 strict（缺答案即 throw，防题集漂移），因子代不经它——观测记录由
 * buildFactorObservation 直接按同一份题 id 清单构造，题 id 域仍以 mapper 为单源。
 *
 * 版本规约：改任何因子结论的产出必 bump 对应版本常量。版本串落 signal metadata
 * 与全局表 question_version 列，是独立的版本域——与 Jev 代的 D3.x / AF1 / BPxx
 * 天然隔离，两代的粘滞与 bootstrap 状态不串。
 *
 * 单测：scripts/_test_factor_responders.cjs
 */
'use strict';

const { PHENOMENON_IDS, EXT_PHENOMENON_IDS } = require('./cheat-result-mapper');
const { gradeObservation, levelsFromObservation, CHEAT_RULESET_IDS } = require('./cheat-grade');

/** 作弊门因子代版本 */
const CHEAT_FACTOR_VERSION = 'CF1';
/** 前置活跃度门因子代版本（Jev 代为 AF1） */
const ACT_FRONT_FACTOR_VERSION = 'AF2';
/** 买点门因子代版本（BPF2=加 crash 形态复核因子臂） */
const BUY_POINT_FACTOR_VERSION = 'BPF2';

// ── BPF2：BP crash 形态复核因子化（2026-11-26 用户裁定「把 BP crash 形态复核做成
// 因子臂」）。Jev 题 BP69 entry_shape 里留给 Jev 的最后一块——数值提示臂命中后的
// 「无回调 + 无换手」价格拱复核（数值判序已由 FP47b 代码化）──
/** 提示臂①现价较锚窗最高价深跌（题面直供） */
const CRASHFORM_VS_ATH_MAX = -25;
/** 提示臂②近 30s 动量深跌（题面直供） */
const CRASHFORM_CHG30_MAX = -25;
/** 提示臂③临近段单 5s 段急跌（题面直供） */
const CRASHFORM_NEAR_DN5_MAX = -15;
/** 提示臂④现价贴锚窗最低价（题面直供，百分点） */
const CRASHFORM_MIN_GAP_MAX = 2;
/** 无回调：5 秒动量 ≤ 此 = 仍在线性下行 / 无反弹台阶（ⓟ 候选线；研究集 11 命中
 *  300s 末值 100% 为负；放宽到 ≤0 会多放进 2 张正在反弹的正票） */
const CRASHFORM_CHG5_MAX = -1.5;
/** 无换手：尾 10 秒买单笔数 ≤ 此（含尘埃的买 tick 一笔都没有=买方归零；ⓟ 放宽到
 *  ≤1 笔负率 100%→76%） */
const CRASHFORM_TAIL_BUY_N_MAX = 0;

/** 结论来源标记：signal metadata 的 model 键 / 全局表 answers_raw.model */
function factorModel(version) {
  return `factor@${version}`;
}

/**
 * BP crash 形态复核（纯函数，零 DB 零网络）——Jev 题「数值臂只是进入复核的提示，
 * 定桶看价格拱形态 + 近窗买卖结构」的因子直译，判序逐条对应题面：
 *  ⓪ 锚缺席不判（题面反锚①「窗极短 / 各锚 ? 缺失不判 crash——判缺不猜」；研究集
 *     里锚缺失面含金狗 쿠우타 +55%）；
 *  ① 数值提示臂四选一命中才进复核；
 *  ② 有回调 → 放行（chg5 已转正 / 走平 = 出现反弹）；
 *  ③ 有换手 → 放行（尾 10 秒有买单 = 买方在场）；
 *  ④ 卖单未停（尾 10 秒有卖出）∧ 以上全过 = 无回调 + 无换手的单边下跌 → hit。
 * FP47b（急跌进行时 / 趋势打断 / 臂 A / 臂 B）在门链更前的因子门已拦，本函数只
 * 接它放行后剩下的「缓跌 / 阴跌」形状。
 * @param {Object|null} bd - 买点快照 buyDerived
 * @returns {{hit:boolean, branch:string, trace:Object}}
 */
function judgeCrashForm(bd) {
  const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const act = (bd && bd.activity) || {};
  const chg5 = fin(bd && bd.chg5Pct);
  const chg30 = fin(bd && bd.chg30Pct);
  const vsAth = fin(bd && bd.currentVsAthPct);
  const nearDn5 = fin(bd && bd.nearMaxDn5Pct);
  const minGap = fin(bd && bd.curVsMinGapPct);
  const dip5 = fin(bd && bd.recentDip5Pct);
  const tailBuyN = fin(act.nearTail10BuyN);
  const tailSellBnb = fin(act.nearTail10SellBnb);
  const trace = {
    chg5Pct: chg5, chg30Pct: chg30, currentVsAthPct: vsAth, nearMaxDn5Pct: nearDn5,
    curVsMinGapPct: minGap, recentDip5Pct: dip5, nearTail10BuyN: tailBuyN, nearTail10SellBnb: tailSellBnb,
  };
  if (!bd) return { hit: false, branch: 'no_snapshot', trace };
  if (chg5 === null || dip5 === null || tailBuyN === null || tailSellBnb === null) {
    return { hit: false, branch: 'anchors_missing', trace };
  }
  const hint = (vsAth !== null && vsAth <= CRASHFORM_VS_ATH_MAX)
    || (chg30 !== null && chg30 <= CRASHFORM_CHG30_MAX)
    || (nearDn5 !== null && nearDn5 <= CRASHFORM_NEAR_DN5_MAX)
    || (minGap !== null && minGap <= CRASHFORM_MIN_GAP_MAX);
  if (!hint) return { hit: false, branch: 'no_hint', trace };
  if (chg5 > CRASHFORM_CHG5_MAX) return { hit: false, branch: 'rebounding', trace };
  if (tailBuyN > CRASHFORM_TAIL_BUY_N_MAX) return { hit: false, branch: 'turnover_present', trace };
  if (!(tailSellBnb > 0)) return { hit: false, branch: 'no_sell', trace };
  return { hit: true, branch: 'crash_form', trace };
}

/**
 * 因子档位 → 作弊观测记录（与 cheat-result-mapper buildObservation 产物同形状）。
 * @param {Object} levels - 题 id → 档位字符串；缺键 / null = 未评估
 * @param {Object|null} anchors - 数值锚原值（levelsFromObservation 按白名单挑键）
 */
function buildFactorObservation(levels = {}, anchors = null) {
  const lv = levels || {};
  return {
    phenomena: Object.fromEntries(PHENOMENON_IDS.map((id) => [id, lv[id] ?? null])),
    extLevels: Object.fromEntries(EXT_PHENOMENON_IDS.map((id) => [id, lv[id] ?? null])),
    activityLevel: lv.activity_level ? { bucket: lv.activity_level, prob: null } : null,
    bundledDominance: null,
    anchors: anchors || {},
  };
}

/**
 * 作弊门因子档位（CF1 精简代）：全题未评估。
 * @param {Object|null} _snapshot - cheat 快照；精简代不消费（后续因子判定臂接入时读取）
 * @returns {Object} 题 id → 档位
 */
function cheatFactorLevels(_snapshot = null) {
  return {};
}

/**
 * 作弊门因子代分级：下游与 Jev 链同一条（gradeObservation → levelsFromObservation），
 * 规则集差集按 opts.ruleset 重评（T217 语义不变）。返回形状与 Jev 链 analyzed 行
 * 同构（另带 model）。
 * @param {Object|null} snapshot
 * @param {{ruleset?:string}} [opts]
 * @returns {{status:'analyzed', grade:string, reasons:Array, unhealthyGrades:number,
 *   levels:Object, buckets:Object, anchors:Object, model:string}}
 */
function judgeCheatFactor(snapshot = null, opts = {}) {
  const obs = buildFactorObservation(cheatFactorLevels(snapshot), null);
  const graded = gradeObservation(obs, {});
  obs.grade = graded.grade;
  obs.gradeReasons = graded.reasons;
  obs.gradeVersion = graded.version;
  const ruleset = CHEAT_RULESET_IDS.includes(opts.ruleset) ? opts.ruleset : 'g23';
  const gateGraded = ruleset === 'g23' ? graded : gradeObservation(obs, { ruleset });
  const { levels, buckets, anchors } = levelsFromObservation(obs, {});
  return {
    status: 'analyzed', grade: gateGraded.grade, reasons: gateGraded.reasons,
    ...(gateGraded !== graded ? { rawGrade: graded.grade, ruleset } : {}),
    levels, buckets, anchors, model: factorModel(CHEAT_FACTOR_VERSION),
  };
}

/**
 * 前置活跃度门因子判定（AF2 精简代）：不判档——act / sbw / wash 全 null。
 * 分流仍走 actFrontRoute（act 缺席 = mid_full，照走 cheat 门），由调用方执行。
 * @param {Object|null} _snapshot - cheat 快照；精简代不消费
 * @returns {{act:null, sbw:null, wash:null, model:string}}
 */
function judgeActFrontFactor(_snapshot = null) {
  return { act: null, sbw: null, wash: null, model: factorModel(ACT_FRONT_FACTOR_VERSION) };
}

/**
 * 买点题集因子答案（BPF2）：维度题只答 entry_shape，且只在 crash 形态复核命中时
 * 答 crash；其余维度缺席（buildBuyPointObservation 对维度题容缺）——读档后塞单门
 * （纯代码）与 crash 形态臂在拦，其余归 neutral / gates_passed。
 * @param {Object|null} snapshot - 买点快照（消费 buyDerived）
 * @returns {{answers:Object, model:string, usage:null, factor:Object}}
 *   factor.crashForm = judgeCrashForm 产物（分支 + 判据数值，随 signal metadata 留痕）
 */
function answerBuyPointQuestions(snapshot = null) {
  const crashForm = judgeCrashForm(snapshot ? snapshot.buyDerived : null);
  const answers = {};
  if (crashForm.hit) {
    answers.entry_shape = { type: 'choice', choice: 'crash', probabilities: { crash: 1 } };
  }
  return { answers, model: factorModel(BUY_POINT_FACTOR_VERSION), usage: null, factor: { crashForm } };
}

module.exports = {
  CHEAT_FACTOR_VERSION,
  ACT_FRONT_FACTOR_VERSION,
  BUY_POINT_FACTOR_VERSION,
  factorModel,
  buildFactorObservation,
  cheatFactorLevels,
  judgeCheatFactor,
  judgeActFrontFactor,
  judgeCrashForm,
  answerBuyPointQuestions,
  CRASHFORM_VS_ATH_MAX, CRASHFORM_CHG30_MAX, CRASHFORM_NEAR_DN5_MAX, CRASHFORM_MIN_GAP_MAX,
  CRASHFORM_CHG5_MAX, CRASHFORM_TAIL_BUY_N_MAX,
};
