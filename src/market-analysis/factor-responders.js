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
 * 现行版本：cheat=CF1 / 前置活跃度=AF2（精简代）；买点=BPF3（精简代）。**精简代** =
 * 只留已经是代码的门，不新增任何未经引擎级对拍校准的拦截。
 *   - AF2：不判档不拒。low / ultra 的「极端拿得准」形状已由门链最前的 FP
 *     act_low / act_ultra 臂（T144）承接；Jev 的 reject_low 面（24h 全局窗约 45
 *     信号 / 日）精简代先放行，结局由确定性回测看，再定活跃度因子分类器的收线。
 *   - CF1：A 主判 / L / E / M 四通道都要 Jev 档位，无因子来源即不产拒；N 通道
 *     虽是纯代码，精简代同样不启用——它的 Jev 代作用域是 AF1 分流后的 mid 票，
 *     精简代没有档位分类就无从保真（T175b 无条件升格三窗净 −0.15 证伪）。
 *   - BPF3：本模块不答任何维度题——买点门在拦的只有 service 链内的塞单门（BP77
 *     纯代码）与 BP10 minTicks 预门。crash 形态（无回调 + 无换手的单边下跌）自
 *     BPF3 起是因子门的一条臂（FP48 judgeCrashForm，factor-pre-buy-check.js——T243
 *     用户裁定「没有必要做复核了吧，直接就是作为一个因子门」；BPF2 曾把它做成 BP
 *     因子应答器的 entry_shape 答案）；malicious_dump 与 crash 数值判序早已由 FP47
 *     代码化；famous_monopoly / one_wave_dump 不产拒。
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
/** 前置活跃度门因子代版本（Jev 代为 AF1；AF3=判档因子版） */
const ACT_FRONT_FACTOR_VERSION = 'AF3';
/** 买点门因子代版本（BPF3=不再答维度题：crash 形态迁因子门 FP48；BPF2=crash 形态复核臂在 BP 应答器） */
const BUY_POINT_FACTOR_VERSION = 'BPF3';

/** 结论来源标记：signal metadata 的 model 键 / 全局表 answers_raw.model */
function factorModel(version) {
  return `factor@${version}`;
}

/**
 * BP crash 形态复核：**已迁出**（T243，2026-11-26 用户裁定「crash 形态复核……没有必要
 * 做复核了吧，直接就是作为一个因子门不就好了」）——判据函数与常量在
 * factor-pre-buy-check.js（judgeCrashForm / CRASHFORM_*，FP48 臂 crash_form）。
 * 本文件不再承载（单一真相源防两处判据漂移）。
 */

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
 * 前置活跃度门因子判定（AF3 判档因子版，2026-11-26 用户指令「活跃度判定这块尽量
 * 对齐 Jev，并且同样需要拦截 low/ultra」）：act 四档=judgeActLevel（act-judge.js，
 * Jev activity_level 题判序全量因子化——⑦四臂+全窗背景校验+D3.73 时间结构）；
 * sbw=judgeStallBurstWave（CD422 波绑定+CD398 流向硬腿同源代码判定）；
 * wash 暂 null（Jev reject_wash 面极小，标定后单独立项——见 act-judge.js 头注）。
 * 分流仍走 actFrontRoute（low/ultra∧sbw≠burst → reject），由调用方执行。
 * @param {Object|null} snapshot - cheat 快照；null/无锚=act null fail-open（上游放行）
 * @returns {{act:string|null, sbw:'burst'|'none'|null, wash:null, model:string}}
 */
function judgeActFrontFactor(snapshot = null) {
  const derived = (snapshot && snapshot.derived) || null;
  if (!derived) {
    return { act: null, sbw: null, wash: null, model: factorModel(ACT_FRONT_FACTOR_VERSION) };
  }
  const { judgeActLevel, judgeStallBurstWave } = require('./act-judge');
  const sbw = judgeStallBurstWave(derived);
  const level = judgeActLevel(derived, { sbwBurst: sbw === 'burst' });
  return { act: level.act, sbw, wash: null, model: factorModel(ACT_FRONT_FACTOR_VERSION) };
}

/**
 * 买点题集因子答案（BPF3）：不答任何维度题（buildBuyPointObservation 对维度题容缺）
 * ——买点门读档后只有纯代码的塞单门在拦，其余归 neutral / gates_passed。
 * @param {Object|null} _snapshot - 买点快照；BPF3 不消费
 * @returns {{answers:Object, model:string, usage:null}}
 */
function answerBuyPointQuestions(_snapshot = null) {
  return { answers: {}, model: factorModel(BUY_POINT_FACTOR_VERSION), usage: null };
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
  answerBuyPointQuestions,
};
