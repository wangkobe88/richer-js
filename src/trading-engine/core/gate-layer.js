/**
 * 因子过滤门层·决策核（T253，2026-11-28 用户裁定三层模型归位）
 *
 * 买信号链路三层：
 *   ① 触发层——买腿 condition（FA 因子表达式）决定是否触发；
 *   ② 判断层——用同一份 fire 因子表归类 pointType，其 policy 即本信号的「门激活集」；
 *   ③ 因子过滤门层——**每个信号恒算全部门**（上涨趋势值门 + 因子门 FP 各臂 + 活跃度门
 *      AF + 作弊门 + BP 塞单门），四组门共用一次内存取数；结论 = 链序首个「激活∧命中」的门。
 *
 * 本模块是③的纯函数决策核：零 DB 零网络、禁 Date.now（回测 as-of 由上游透传）。
 * 四个旧挂点（_factorGateEvaluate / _actFrontGateEvaluate / _cheatGateEvaluateBinary /
 * _bpGateEvaluate）的**有效结论**在此逐条转录——决策与旧门链逐位一致是硬约束：
 *   - policy 直通（factorCheckArms skip / actFront pass / cheatCheck skip / buyPoint skip）：
 *     门照算（computed 留痕）、不参与决策；
 *   - 首个有效拒之后的门：照算、留痕 status:'not_reached'、不参与决策；
 *   - 取数不足：FP / AF fail-open 放行，BP fail-closed 拒（BP10「数据不够就挡住」）；
 *   - 副作用产出（FA 投影 / BP 落行 / burst 资格）与旧挂点同规则。
 * 不变式由 scripts/_test_gate_layer.cjs C 段穷举对拍锁定（旧链决策函数转录为基线）。
 */
'use strict';

const { CHEAT_RULESET_IDS } = require('../../market-analysis/cheat-grade');
const { STUFFING_MAX_EQ_WALLETS } = require('../../market-analysis/buy-point-result-mapper');

/** 门层留痕形状版本（metadata.gateLayer.v） */
const GATE_LAYER_VERSION = 'GL1';
/** 门组链序（primary 取链序首个有效拒） */
const GATE_CHAIN = Object.freeze(['fp', 'af', 'cheat', 'bp']);
const AF_REJECT_PATHS = new Set(['reject_low', 'reject_ultra', 'reject_wash']);
const AF_SKIP_CHEAT_PATHS = new Set(['burst_exempt', 'restart_exempt', 'high_skip']);
const DEFAULT_BP_PASS_LEVELS = Object.freeze(['good', 'neutral']);

/**
 * pointType policy → 门激活集。与旧挂点的 policy 消费点逐条对应：
 *   factorCheckArms:'skip'（FP 整门直通）/ 'cheatOnly'（只留作弊类臂）/ factorCheckArmExempt（臂差集）
 *   actFront:'pass' / cheatCheck:'skip' / buyPoint:'skip'|'stuffingOnly'
 * cheatRuleset（g23 系）仅 Jev 代消费——因子代下无消费点，这里只留痕不参与决策。
 */
function resolveGateActivation(policy) {
  const p = policy || {};
  return {
    fp: p.factorCheckArms === 'skip' ? 'skip' : (p.factorCheckArms === 'cheatOnly' ? 'cheatOnly' : 'all'),
    fpExempt: Array.isArray(p.factorCheckArmExempt) ? p.factorCheckArmExempt.slice() : [],
    af: p.actFront === 'pass' ? 'pass' : 'active',
    cheat: p.cheatCheck === 'skip' ? 'skip' : 'active',
    cheatRuleset: CHEAT_RULESET_IDS.includes(p.cheatCheck) ? p.cheatCheck : 'g23',
    bp: p.buyPoint === 'skip' ? 'skip' : (p.buyPoint === 'stuffingOnly' ? 'stuffingOnly' : 'full'),
  };
}

/** 作弊门判定原文 → cheatCheck 段（放行 info 与拒路径共用形状；引擎 _cheatGateInfo 委托到此） */
function cheatGateInfo(res) {
  return {
    status: res.status, grade: res.grade, cached: res.cached === true,
    reasons: res.reasons || [], unhealthyGrades: res.unhealthyGrades ?? 0,
    levels: res.levels ?? null, buckets: res.buckets ?? null,
    anchors: res.anchors ?? null, // BP67：波三键/exitVs 数值锚随 info 透出
    strongbackerLike: res.strongbackerLike ?? 0,
    exempt: res.exempt ?? null, // CD379 活跃度豁免留痕 { code:'activity_<桶>', originalGrade }
    unblocked: res.unblocked === true, // CD381 翻案留痕
    // 因子代来源标记（Jev 代返回无此键，metadata 形状不变）
    ...(res.model ? { model: res.model } : {}),
  };
}

const isAfReject = (af) => !!(af && af.status === 'assessed' && AF_REJECT_PATHS.has(af.path));
const isAfSkipCheat = (af) => !!(af && af.status === 'assessed' && AF_SKIP_CHEAT_PATHS.has(af.path));
const isCheatReject = (cheat) => !!(cheat && (cheat.grade === 'cheat' || cheat.grade === 'unhealthy'));

/** 取数失败段（FP/AF 共用：fail-open 放行的留痕形状） */
function prepFailSection(prep) {
  const out = { status: prep.status, anchorTickCount: prep.anchorTickCount ?? 0 };
  if (prep.reason) out.reason = prep.reason;
  return out;
}
const normPrep = (prep) => (prep && prep.ok === true ? prep
  : (prep || { status: 'insufficient_history', reason: 'pullTicks_absent', anchorTickCount: 0 }));

/** 因子门有效结论（policy skip / 取数不足 / 未评估 = 放行） */
function fpEffectivePass({ activation, prep, fp }) {
  if (!(prep && prep.ok === true)) return true;
  if (activation.fp === 'skip') return true;
  return !(fp && fp.status === 'assessed' && fp.pass !== true);
}

/**
 * 门层三门的「到达」判定（BP 计划）：各门有效拒只在其被激活且被到达时成立。
 *   - AF 有效拒：FP 放行 ∧ actFront≠pass ∧ AF reject_*；
 *   - 作弊门让位：FP 放行 ∧ AF 未拒 ∧ actFront≠pass ∧ AF 路由 burst/restart/high_skip；
 *   - 作弊门有效拒：未被让位 ∧ cheatCheck≠skip ∧ grade cheat/unhealthy；
 *   - 到达 BP：三门均无有效拒。落行集合与旧门链逐位相同：仅 BP 为全门 ∧ 到达 BP ∧ 取数成功才落行。
 */
function gateLayerBpPlan({ activation, prep, fp, af, cheat }) {
  const prepOk = !!(prep && prep.ok === true);
  const fpPass = fpEffectivePass({ activation, prep, fp });
  const afActive = fpPass && activation.af !== 'pass' && prepOk;
  const afReject = afActive && isAfReject(af);
  const cheatSkippedByAf = afActive && !afReject && isAfSkipCheat(af);
  const cheatReject = fpPass && !afReject && activation.cheat !== 'skip' && !cheatSkippedByAf && isCheatReject(cheat);
  const reached = fpPass && !afReject && !cheatReject;
  return {
    reached,
    stuffingOnly: activation.bp === 'stuffingOnly',
    writeBpRow: reached && activation.bp === 'full' && prepOk,
    skipCheat: cheatSkippedByAf,
  };
}

/**
 * 门层决策（四门恒算后的结论合成）。入参 = 编排器在同一份快照上算出的四门原文：
 *   prep  = BuyPointCheckService.prepareGateLayer 结果
 *   fp    = evaluateFactorPreBuy({prebuilt}) 结果（prep ok 时；否则 null）
 *   af    = evaluateActFront({prebuilt}) 结果（prep ok 时；否则 null）
 *   cheat = CheatCheckService.gateBuyPoint 因子代结果（CF1 不消费快照，恒在场）
 *   bp    = evaluateFactorBp 结果（按 gateLayerBpPlan 的旗标算出；prep 不 ok 时 null）
 *   trendFactors = fire 因子表（上涨趋势值门行；缺省不出行）
 * @returns {{pass:boolean, primary:{gate:string,code:string}|null, reason:string|null,
 *   sections:{factorCheck,actFrontGate,cheatCheck,buyPoint}, statusUpdate:{message,reason}|null,
 *   faProjection:{blocked:number,reason:string|null}|null, writeBpRow:boolean, t189SbwBurst:boolean,
 *   skipCheat:boolean, prep:Object}}
 */
function decideGateLayer(input) {
  const { activation, passLevels = DEFAULT_BP_PASS_LEVELS, trendFactors } = input;
  const prep = normPrep(input.prep);
  const prepOk = prep.ok === true;
  const fp = prepOk ? input.fp : null;
  const af = prepOk ? input.af : null;
  const cheat = input.cheat || null;
  const bp = prepOk ? input.bp : null;
  const cheatComputed = cheat ? cheatGateInfo(cheat) : { status: 'fail', reason: 'no_result' };

  // ── ① 因子门 FP（门链最前）──
  let factorCheck;
  let fpPass = true;
  let statusUpdate = null;
  let primary = null;
  let reasonText = null;
  let faProjection = null;
  if (activation.fp === 'skip') {
    // 类型直通（旧挂点首位判定——先于取数）：全臂照算仅展示（门行在 buildGateLayerRows 内整体去激活）
    factorCheck = { status: 'policy_pass', policy: 'factorCheckArms:skip', pass: true, computed: fpComputed(fp) };
  } else if (!prepOk) {
    factorCheck = prepFailSection(prep); // 数据不足/历史不完整/异常=放行（BP 门兜底）
  } else if (fp && fp.status === 'assessed') {
    const p = fp.pass === true;
    factorCheck = {
      status: 'assessed', pass: p, reason: fp.reason ?? null, version: fp.version ?? null,
      pvp: fp.pvp ?? null, arms: fp.arms ?? null, trace: fp.trace ?? null,
      gates: fp.gates ?? null, rawHits: fp.rawHits ?? [], observe: fp.observe ?? null,
    };
    faProjection = { blocked: p ? 0 : 1, reason: factorCheck.reason }; // 仅有效评估时投影（skip 不投影）
    if (!p) {
      fpPass = false;
      primary = { gate: 'fp', code: `factor_gate_${factorCheck.reason}` };
      reasonText = `因子门拒买（${factorCheck.reason}）`;
      statusUpdate = { message: `因子门拒买: ${factorCheck.reason}`, reason: primary.code };
    }
  } else {
    factorCheck = fp ? { ...fp } : { status: 'error', reason: 'no_result' }; // error → fail-open 放行
  }

  // ── ② 活跃度门 AF ──
  const plan = gateLayerBpPlan({ activation, prep, fp, af, cheat });
  let actFrontGate;
  let afPass = true;
  const afComputed = prepOk ? (af || { status: 'fail', reason: 'no_result' }) : prepFailSection(prep);
  if (!fpPass) {
    actFrontGate = { status: 'not_reached', computed: afComputed };
  } else if (activation.af === 'pass') {
    actFrontGate = { status: 'policy_pass', policy: 'actFront:pass', computed: afComputed }; // 直通：作弊门照走
  } else if (!prepOk) {
    actFrontGate = prepFailSection(prep); // fail-open 放行进作弊门
  } else {
    actFrontGate = afComputed; // 原文（assessed 带 path/arm/trace；fail/error → 放行）
    if (isAfReject(af)) {
      afPass = false;
      primary = { gate: 'af', code: `act_front_${af.path.replace('reject_', '')}` };
      reasonText = `活跃度前置门拒买（${primary.code}）`;
      statusUpdate = { message: `活跃度前置门拒买: ${af.path}（act=${af.act}）`, reason: primary.code };
    }
  }

  // ── ③ 作弊门（因子代 CF1 恒 healthy；让位形状与旧挂点合成 info 同构）──
  let cheatCheck;
  let cheatPass = true;
  if (!fpPass || !afPass) {
    cheatCheck = { status: 'not_reached', computed: cheatComputed };
  } else if (activation.cheat === 'skip') {
    cheatCheck = { status: 'policy_pass', policy: 'cheatCheck:skip', levels: { stallBurstWave: null }, computed: cheatComputed };
  } else if (plan.skipCheat) {
    cheatCheck = {
      status: 'skipped_by_act_front', path: actFrontGate.path ?? null,
      act: actFrontGate.act ?? null, sbw: actFrontGate.sbw ?? null, wash: actFrontGate.wash ?? null,
      version: actFrontGate.version ?? null,
      levels: { stallBurstWave: actFrontGate.sbw === 'burst' ? 1 : null },
      computed: cheatComputed,
    };
  } else {
    cheatCheck = cheatComputed;
    if (isCheatReject(cheat)) {
      cheatPass = false;
      const reasonCodes = (cheat.reasons || []).map((r) => r.code).join(',');
      primary = { gate: 'cheat', code: `cheat_gate_${cheat.grade}` };
      reasonText = `作弊门拒买（${cheat.grade} [${reasonCodes}]）`;
      statusUpdate = { message: `作弊门拒买: ${cheat.grade} [${reasonCodes}]`, reason: primary.code };
    } // 无 grade（判定异常/检测层故障）= fail-open 放行进 BP（BP fail-closed 兜底）
  }

  // T189b 资格线载体：门链 sbw（levels.stallBurstWave==1）非 burst → 买入后不 arm burst 冷盘
  const t189SbwBurst = !!(cheatCheck.levels && cheatCheck.levels.stallBurstWave === 1);

  // ── ④ BP 塞单门（fail-closed——BP 是点位判定唯一来源，无据不买）──
  let buyPoint;
  let bpPass = true;
  const writeBpRow = plan.writeBpRow; // 给 BP 判定的落行旗标（到达 BP ∧ 全门 ∧ 取数成功）
  if (!plan.reached) {
    buyPoint = { status: 'not_reached', computed: bpComputedSection(bp, passLevels) };
  } else if (activation.bp === 'skip') {
    buyPoint = { status: 'policy_pass', policy: 'buyPoint:skip', computed: bpComputedSection(bp, passLevels) };
  } else if (!prepOk) {
    // BP10「数据不够就挡住」：tick 不足 / 行环历史不完整（D4）/ 取数异常 = 拒
    buyPoint = { ...prepFailSection(prep), passLevels, passed: false };
    bpPass = false;
    primary = { gate: 'bp', code: `bp_gate_${prep.status}` };
    reasonText = `BP 门拒买（${prep.status}${prep.reason ? `: ${prep.reason}` : ''}）`;
    statusUpdate = { message: bpFailMessage(buyPoint), reason: primary.code };
  } else if (bp && bp.status === 'assessed') {
    const bucket = bp.assessment?.bucket ?? null;
    bpPass = bucket != null && passLevels.includes(bucket);
    buyPoint = {
      status: 'assessed', assessment: bp.assessment ?? null,
      dimensions: bp.dimensions ?? null, anchors: bp.anchors ?? null,
      passLevels, passed: bpPass,
      model: bp.model ?? null, usage: bp.usage ?? null,
      ...(bp.participantProfile ? { participantProfile: bp.participantProfile } : {}),
      ...(bp.policy ? { policy: bp.policy } : {}),
      ...(bp.stuffingEqWallets != null ? { stuffingEqWallets: bp.stuffingEqWallets } : {}),
    };
    if (!bpPass) {
      primary = { gate: 'bp', code: 'bp_gate_assessment' };
      reasonText = `BP 门拒买（assessed: ${bucket}）`;
      statusUpdate = { message: `BP 门拒买: ${bucket}`, reason: primary.code };
    }
  } else {
    // fail / error / unknown → 全 fail-closed 拒
    buyPoint = bp
      ? { ...bp, passLevels, passed: false }
      : { status: 'insufficient_history', reason: 'no_result', anchorTickCount: prep.anchorTickCount ?? 0, passLevels, passed: false };
    bpPass = false;
    primary = { gate: 'bp', code: `bp_gate_${buyPoint.status}` };
    reasonText = `BP 门拒买（${buyPoint.status}${buyPoint.assessment?.bucket ? `: ${buyPoint.assessment.bucket}` : buyPoint.reason ? `: ${buyPoint.reason}` : ''}）`;
    statusUpdate = { message: bpFailMessage(buyPoint), reason: primary.code };
  }

  const gates = buildGateLayerRows({ fp, activation, af, cheat, bp, prep, passLevels, trendFactors });
  factorCheck = { ...factorCheck, gates };
  return {
    pass: fpPass && afPass && cheatPass && bpPass,
    primary,
    reason: reasonText,
    sections: { factorCheck, actFrontGate, cheatCheck, buyPoint },
    statusUpdate,
    faProjection,
    writeBpRow,
    t189SbwBurst,
    skipCheat: plan.skipCheat,
    prep,
  };
}

function fpComputed(fp) {
  return fp ? { pass: fp.pass === true, reason: fp.reason ?? null, arms: fp.arms ?? null, rawHits: fp.rawHits ?? [] } : null;
}
function bpComputedSection(bp, passLevels) {
  if (!bp) return null;
  return { status: bp.status, ...(bp.assessment ? { assessment: bp.assessment } : {}), ...(bp.reason ? { reason: bp.reason } : {}),
    ...(bp.stuffingEqWallets != null ? { stuffingEqWallets: bp.stuffingEqWallets } : {}), passLevels, passed: false };
}
function bpFailMessage(info) {
  if (info.status === 'insufficient_ticks') return `BP 门拒买: 锚窗 tick 不足（${info.anchorTickCount ?? '?'}<minTicks，数据不足）`;
  if (info.status === 'insufficient_history') return `BP 门拒买: 内存行环历史不完整（${info.reason || '?'}），数据不足=挡住`;
  return `BP 门拒买: ${info.status}${info.reason ? ` (${info.reason})` : ''}`;
}

/** 取数失败段的 BP 版（塞单门行值） */
const prepFailText = (prep) => (prep.status === 'insufficient_ticks'
  ? `数据不足（锚窗 ${prep.anchorTickCount ?? 0} ticks）`
  : (prep.status === 'insufficient_history' ? `历史不完整（${prep.reason || '行环缺失'}）` : `取数异常（${prep.reason || prep.status}）`));

/**
 * 门层门行全集（追加进 metadata.factorCheck.gates 同一数组——信号页一张表）：
 * 上涨趋势值门 + FP 臂（纯函数产出）+ 活跃度门行 + 作弊门行 + BP 塞单门行，每行带三元组
 * hit/activated/blocked 与 source/group。类型直通（FP skip）时因子臂整体去激活。
 */
function buildGateLayerRows({ fp, activation, af, cheat, bp, prep, passLevels, trendFactors }) {
  const { buildTrendValueGates } = require('../../market-analysis/factor-pre-buy-check');
  const p = normPrep(prep);
  const prepOk = p.ok === true;
  const rows = Array.isArray(fp && fp.gates) ? fp.gates.map((r) => ({ ...r })) : [];
  if (!rows.some((r) => r.group === 'trend') && trendFactors) rows.unshift(...buildTrendValueGates(trendFactors));
  if (activation.fp === 'skip') {
    for (const r of rows) { if (r.group === 'fp') { r.activated = false; r.blocked = false; } }
  }
  rows.push(afGateRow(activation, prepOk ? af : null, p));
  rows.push(cheatGateRow(activation, isAfSkipCheat(af) && activation.af !== 'pass', cheat));
  rows.push(stuffingGateRow(activation, prepOk, prepOk ? bp : null, p));
  return rows;
}

/** 活跃度门行（AF3）：hit=路由为 reject_*；activated=actFront≠pass */
function afGateRow(activation, af, prep) {
  const prepOk = prep.ok === true;
  const hit = isAfReject(af);
  const assessed = !!(af && af.status === 'assessed');
  return {
    category: 'liquidity', id: 'af_act_level', group: 'af', source: 'gate',
    label: 'AF3·活跃度判档',
    value: assessed
      ? `act=${af.act} arm=${af.arm ?? '-'} sbw=${af.sbw ?? '-'} path=${af.path}`
      : (prepOk ? `未判定（${af ? af.status : 'no_result'}${af && af.reason ? `: ${af.reason}` : ''}）` : prepFailText(prep)),
    line: 'low/ultra ∧ sbw≠burst → 拒；low ∧ burst / 停滞再启动 → 豁免作弊门；high → 跳过作弊门；mid → 照走',
    hit,
    activated: activation.af !== 'pass',
    blocked: hit && activation.af !== 'pass',
    code: hit ? `act_front_${af.path.replace('reject_', '')}` : null,
    ...(assessed && af.trace ? { trace: af.trace } : {}),
  };
}

/** 作弊门行（因子代 CF1：无专属判据恒放行；activated=policy≠skip ∧ 未被活跃度门让位） */
function cheatGateRow(activation, skippedByAf, cheat) {
  const grade = cheat && cheat.grade;
  const hit = isCheatReject(cheat);
  const activated = activation.cheat !== 'skip' && !skippedByAf;
  return {
    category: 'organized', id: 'cheat_factor', group: 'cheat', source: 'gate',
    label: '作弊门 CF1（因子代）',
    value: cheat
      ? (grade === 'healthy' ? '恒放行（无专属判据）' : `${grade}${skippedByAf ? '·活跃度门让位' : ''}`)
      : `未判定（${cheat && cheat.status}${cheat && cheat.reason ? `: ${cheat.reason}` : ''}）`,
    line: '因子代作弊门不产拒（组织性作弊形状由因子门作弊类臂承接）；数值门另立案',
    hit,
    activated,
    blocked: hit && activated,
    code: hit ? `cheat_gate_${grade}` : null,
  };
}

/** BP 塞单门行：同块等额买入最大簇 ≥8 钱包；activated=buyPoint≠skip */
function stuffingGateRow(activation, prepOk, bp, prep) {
  const eqW = stuffingEqWallets(bp);
  const hit = eqW !== null && eqW >= STUFFING_MAX_EQ_WALLETS;
  return {
    category: 'organized', id: 'stuffing_gate', group: 'bp', source: 'gate',
    label: 'BP77·同块等额塞单',
    value: prepOk
      ? (eqW === null ? '同块等额买入最大簇 —（锚缺席）' : `同块等额买入最大簇 ${eqW} 钱包`)
      : prepFailText(prep),
    line: '同一区块 ∧ 金额四位小数全等 ∧ ≥8 钱包（BP 门，纯代码）',
    hit,
    activated: activation.bp !== 'skip',
    blocked: hit && activation.bp !== 'skip',
    code: hit ? 'stuffing_gate' : null,
  };
}

/** 塞单锚值：BP 判定原文优先（stuffingOnly 路径带 stuffingEqWallets；全门路径在 anchors） */
function stuffingEqWallets(bp) {
  if (!bp) return null;
  if (typeof bp.stuffingEqWallets === 'number') return bp.stuffingEqWallets;
  if (bp.anchors && typeof bp.anchors.exactEqualBlockMaxWallets === 'number') return bp.anchors.exactEqualBlockMaxWallets;
  return null;
}

/** 门层汇总（信号页头部一行） */
function summarizeGateLayer(rows, primary) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    total: list.length,
    activated: list.filter((r) => r.activated === true).length,
    hit: list.filter((r) => r.hit === true).length,
    blocked: list.filter((r) => r.blocked === true).length,
    valueGates: list.filter((r) => r.hit === null).length,
  };
}

/** metadata.gateLayer 段（层级留痕：来源/取数/激活集/汇总/主拒门） */
function buildGateLayerSection({ activation, prep, rows, primary, pass }) {
  const p = normPrep(prep);
  return {
    v: GATE_LAYER_VERSION,
    source: 'memory',
    pass,
    snapshot: p.ok === true
      ? { anchorTickCount: p.pull.anchorTickCount, capped: p.pull.capped === true, complete: true }
      : { status: p.status, reason: p.reason ?? null, anchorTickCount: p.anchorTickCount ?? 0, complete: false },
    activation,
    summary: summarizeGateLayer(rows, primary),
    primary,
  };
}

module.exports = {
  GATE_LAYER_VERSION, GATE_CHAIN, AF_REJECT_PATHS, AF_SKIP_CHEAT_PATHS, DEFAULT_BP_PASS_LEVELS,
  resolveGateActivation, cheatGateInfo, gateLayerBpPlan, decideGateLayer,
  buildGateLayerRows, summarizeGateLayer, buildGateLayerSection, stuffingEqWallets,
};
