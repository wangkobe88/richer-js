/**
 * 作弊盘检测回归集纯函数（CD1，2026-10-30）——零 DB 零网络。
 * 供 run.mjs（同目录 runner，182 跑）与将来单测共用；工具文档 docs/作弊盘检测与Case台账.md。
 *
 * 与叙事回归集（scripts/narrative/case-regression/lib.mjs）的最大差异=**anchor 必填**：
 * 作弊判定是 as-of 时点性的，重析必须按锚截窗（链上真序前 N 笔），全史重析=马后炮
 * 污染对拍（事后知道它是 rug 再看全程当然像作弊——但当时买点看到的只是前 N 笔）。
 *
 * D3.5（2026-10-31）判定层停产：interpret 透传观测记录（现象+档位，无 verdict）；
 * assertExpectation 对拍停产（failures 恒空——仅异常路径仍 FAIL：mapper throw=链路坏）；
 * expect.verdict=**人工裁定记录**保留展示不比对（VERDICTS 域不变=历史 fixtures 兼容）；
 * verdict/cheatProb 机器刷新随判定层停产退役（updateExpect 仅留痕，不覆盖人工裁定）。
 */

export const VERDICTS = new Set(['cheat', 'unhealthy', 'healthy', 'unclear']);
export const PATTERNS = new Set([
  'dev_self_trade', 'same_block_burst', 'equal_amount_split',
  'rapid_churn', 'wash_pump', 'quota_ladder', 'slow_coordinated_accumulation',
  'none_apparent',
]);

/**
 * 校验 fixtures 文档。@returns {{cases: object[], errors: string[]}}
 */
export function loadAndValidateFixtures(doc) {
  const errors = [];
  const cases = Array.isArray(doc && doc.cases) ? doc.cases : [];
  if (!cases.length) errors.push('cases 为空');
  const seenId = new Set();
  const seenAddr = new Set();
  for (const c of cases) {
    const tag = c.caseId || '(无 caseId)';
    if (!/^CD\d+$/.test(c.caseId || '')) errors.push(`${tag}: caseId 须为 CD<n>`);
    if (seenId.has(c.caseId)) errors.push(`${tag}: caseId 重复`);
    seenId.add(c.caseId);
    if (!/^0x[0-9a-fA-F]{40}$/.test(c.addr || '')) errors.push(`${tag}: addr 须为 0x+40hex`);
    if (seenAddr.has(String(c.addr || '').toLowerCase())) errors.push(`${tag}: addr 重复（一票一 case）`);
    seenAddr.add(String(c.addr || '').toLowerCase());
    const n = c.anchor && c.anchor.tickCount;
    if (!Number.isInteger(n) || n < 1) errors.push(`${tag}: anchor.tickCount 必填且为正整数（防全史马后炮——as-of 锚是一等公民）`);
    const e = c.expect || {};
    if (e.verdict !== undefined && !VERDICTS.has(e.verdict)) errors.push(`${tag}: expect.verdict 须在 ${[...VERDICTS].join('/')}`);
    if (e.patternsIncludes !== undefined
      && (!Array.isArray(e.patternsIncludes) || !e.patternsIncludes.length || !e.patternsIncludes.every((p) => PATTERNS.has(p)))) {
      errors.push(`${tag}: expect.patternsIncludes 须为非空 PATTERNS 子集（any-of 语义）`);
    }
    for (const k of ['cheatProbGte']) {
      if (e[k] !== undefined && !(Number.isFinite(e[k]) && e[k] >= 0 && e[k] <= 10)) errors.push(`${tag}: expect.${k} 须为 0-10 数值`);
    }
    if (e.verdict === undefined && e.patternsIncludes === undefined && e.cheatProbGte === undefined) {
      errors.push(`${tag}: expect 至少一个断言键（纯 observe 票也须写 verdict 现状）`);
    }
    if (!c.expectSince || !c.expectBecause) errors.push(`${tag}: expectSince/expectBecause 必填（预期留痕=长期维护的根）`);
  }
  return { cases, errors };
}

/**
 * 观测记录透传（D3.5：buildObservation 产物即存档口径——现象+档位+锚，无 verdict）。
 * @param {object|null} obs buildObservation 产物
 *   { phenomena, extLevels, activityLevel:{bucket,prob}|null,
 *     bundledDominance:{bucket,prob}|null, anchors }（D3.8 起含捆绑主导度档；
 *     D3.9 起 extLevels 含 insider_supply_sell 老鼠仓档；sbw 桶域 D3.10 起
 *     none/burst_cheat/burst_normal（「可疑」中间态废）——旧档断代/缺席 null）
 */
export function interpret(obs) {
  if (!obs) return null;
  return {
    phenomena: obs.phenomena ?? null,
    extLevels: obs.extLevels ?? null,
    activityLevel: obs.activityLevel ?? null,
    bundledDominance: obs.bundledDominance ?? null,
    anchors: obs.anchors ?? null,
  };
}

/**
 * 断言 expect DSL（D3.5 对拍停产：verdict/cheatProb/pattern 无机器产出可比——
 * expect.verdict=人工裁定记录，展示不比对）。恒空 failures；异常路径（mapper
 * throw）在 runner 侧已 FAIL，本函数仅保留签名兼容。
 * @returns {{failures: string[]}}
 */
export function assertExpectation() {
  return { failures: [] };
}

/**
 * --add 生成新 case（机器只记录现状，断言意图必须人来定——C111 纪律同款）。
 * anchor=收录时刻全量 tick 数（as-of=收录时点；超 pullLimit 由 runner capped 标记）。
 * D3.5：expect.verdict 恒 'unclear'=待人工裁定（判定层停产无机器判读）。
 */
export function buildCase({ caseId, symbol, addr, platform, anchorTickCount, capped, interp, note, observe, today }) {
  return {
    caseId,
    symbol: symbol ?? '',
    addr: String(addr).toLowerCase(),
    platform: platform ?? null,
    anchor: { tickCount: anchorTickCount, ...(capped ? { capped: true } : {}) },
    expect: { verdict: (interp && interp.verdict) || 'unclear' },
    note: note ?? '',
    addedAt: today,
    expectSince: today,
    expectBecause: note ? `--add 基线快照（${note}）` : '--add 基线快照（人工复核改写）',
    ...(observe ? { observe: true } : {}),
  };
}

/**
 * --update-expect（D3.5：机器刷新退役——判定层停产无 verdict 可写；本指令仅推进
 * expectSince/Because 留痕，人工改写的 expect.verdict 原样保留。旧存档重放形状
 * （interp 带 verdict）照旧刷新，防误用旧档自动覆盖）。
 */
export function updateExpect(oldCase, interp, because, today) {
  const expect = {
    ...oldCase.expect,
    ...(interp && interp.verdict ? { verdict: interp.verdict } : {}),
  };
  return {
    ...oldCase,
    expect,
    expectSince: today,
    expectBecause: because,
  };
}

/**
 * 实验基线锚计算（--experiment 模式）：链上真序行集中 block_time <= 锚时刻的行数。
 * 锚时刻=首笔成功买入 trade 的 created_at + settle 窗（对齐实时 service 的 settle 语义：
 * 买点 fire 后延迟 settle 4s 再拉数）。回放无法重放「当时 DB 已落几行」（落库延迟不可逆推），
 * 用链上时间近似且宁多勿少——settle 窗的设计目的就是覆盖尾部突发簇。
 * 不依赖 block_time 单调（倒退行照数），全量扫描；等号含边界。
 */
export function anchorCountAt(rowsAsc, isoTime) {
  if (!isoTime) return 0;
  const t = Date.parse(isoTime);
  if (!Number.isFinite(t)) return 0;
  let n = 0;
  for (const r of rowsAsc) {
    const bt = Date.parse(r && r.block_time);
    if (Number.isFinite(bt) && bt <= t) n++;
  }
  return n;
}
