/**
 * 作弊盘检测回归集纯函数（CD1，2026-10-30）——零 DB 零网络。
 * 供 run.mjs（同目录 runner，182 跑）与将来单测共用；工具文档 docs/作弊盘检测与Case台账.md。
 *
 * 与叙事回归集（scripts/narrative/case-regression/lib.mjs）的最大差异=**anchor 必填**：
 * 作弊判定是 as-of 时点性的，重析必须按锚截窗（链上真序前 N 笔），全史重析=马后炮
 * 污染对拍（事后知道它是 rug 再看全程当然像作弊——但当时买点看到的只是前 N 笔）。
 */

export const VERDICTS = new Set(['cheat', 'unhealthy', 'healthy', 'unclear']);
export const PATTERNS = new Set([
  'dev_self_trade', 'same_block_burst', 'equal_amount_split',
  'rapid_churn', 'wash_pump', 'none_apparent',
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
    for (const k of ['cheatProbGte', 'retailLte', 'retailGte']) {
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
 * 判读 mapper 输出 → 统一口径（runner 断言与 --add 基线快照共用）。
 * @param {object|null} mapped mapCheatAnswers 产物 { verdict, cheatProb, patternType, retailParticipation }
 */
export function interpret(mapped) {
  if (!mapped) return { verdict: null, cheatProb: null, patternType: null, retailParticipation: null };
  return {
    verdict: mapped.verdict ?? null,
    cheatProb: typeof mapped.cheatProb === 'number' ? mapped.cheatProb : null,
    patternType: mapped.patternType ?? null,
    retailParticipation: typeof mapped.retailParticipation === 'number' ? mapped.retailParticipation : null,
  };
}

/**
 * 断言 expect DSL。@returns {{failures: string[]}} 空=全过
 */
export function assertExpectation(interp, expect) {
  const failures = [];
  if (!interp || interp.verdict === null) return { failures: ['判读输入缺失（分析失败/无 verdict）'] };
  const e = expect ?? {};
  if (e.verdict !== undefined && interp.verdict !== e.verdict) {
    failures.push(`verdict: 期望 ${e.verdict} 实际 ${interp.verdict}`);
  }
  if (e.cheatProbGte !== undefined && (interp.cheatProb === null || interp.cheatProb < e.cheatProbGte)) {
    failures.push(`cheatProb: 期望 ≥${e.cheatProbGte} 实际 ${interp.cheatProb}`);
  }
  if (Array.isArray(e.patternsIncludes) && !e.patternsIncludes.includes(interp.patternType)) {
    failures.push(`patternType: 期望 ∈[${e.patternsIncludes.join('|')}] 实际 ${interp.patternType}`);
  }
  if (e.retailLte !== undefined && (interp.retailParticipation === null || interp.retailParticipation > e.retailLte)) {
    failures.push(`retailParticipation: 期望 ≤${e.retailLte} 实际 ${interp.retailParticipation}`);
  }
  if (e.retailGte !== undefined && (interp.retailParticipation === null || interp.retailParticipation < e.retailGte)) {
    failures.push(`retailParticipation: 期望 ≥${e.retailGte} 实际 ${interp.retailParticipation}`);
  }
  return { failures };
}

/**
 * --add 生成新 case（机器只记录现状，断言意图必须人来定——C111 纪律同款）。
 * anchor=收录时刻全量 tick 数（as-of=收录时点；超 pullLimit 由 runner capped 标记）。
 */
export function buildCase({ caseId, symbol, addr, platform, anchorTickCount, capped, interp, note, observe, today }) {
  return {
    caseId,
    symbol: symbol ?? '',
    addr: String(addr).toLowerCase(),
    platform: platform ?? null,
    anchor: { tickCount: anchorTickCount, ...(capped ? { capped: true } : {}) },
    expect: { verdict: interp.verdict ?? 'unclear' },
    note: note ?? '',
    addedAt: today,
    expectSince: today,
    expectBecause: note ? `--add 基线快照（${note}）` : '--add 基线快照（人工复核改写）',
    ...(observe ? { observe: true } : {}),
  };
}

/** --update-expect：verdict/cheatProb 从现行刷新，细节键保留，留痕因由 */
export function updateExpect(oldCase, interp, because, today) {
  const expect = {
    ...oldCase.expect,
    verdict: interp.verdict ?? oldCase.expect.verdict,
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
