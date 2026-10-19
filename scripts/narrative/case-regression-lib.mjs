/**
 * 叙事 case 回归集判读/断言纯函数（2026-10-19，C94-C110 近期案票回归）。
 * 零 DB 零网络：只消费 token_narrative 回读行快照，供 run-case-regression.mjs 与
 * _test_case_regression_lib.cjs 共用（红线：新机制配零 DB 零网络单测）。
 *
 * 落库两信封是既定事实（C88 信封坑，superip-labels.js s?.details ?? s?.parsed_output
 * 同款），interpret 里 ?? 链是形状切换非兜底：
 *   - precheck 拒票：stage_final_result=null，pre_check_result={rating,reason,details:{ruleName}}
 *   - stage2 拦截票：stage_final_result={rating:'low',details:{blockReason}}，reason 顶层 null
 *   - 评级票：stage_final_result={rating,score,...}
 */

/**
 * 判读一行 token_narrative 回读 → 统一口径。
 * @param {object|null} row 回读行（须含 stage_final_result/pre_check_result/stage1_result）
 */
export function interpret(row) {
  if (!row) {
    return { rating: null, reason: null, ruleName: null, score: null, stage: null, blob: '' };
  }
  const fin = row.stage_final_result ?? null;
  const pcr = row.pre_check_result ?? null;
  return {
    // precheck 拒票终态在 pcr；stage 评级/拦截票在 fin
    rating: fin?.rating ?? pcr?.rating ?? null,
    // stage2 拦截文案在 fin.details.blockReason；precheck 拒文案在 pcr.reason
    reason: fin?.details?.blockReason ?? pcr?.reason ?? null,
    // ruleName 两形状：buildPreCheckResult 信封 details.ruleName / 顶层 ruleName（address 拒路径顶层也无）
    ruleName: pcr?.details?.ruleName ?? pcr?.ruleName ?? null,
    score: fin?.score ?? null,
    stage: row.analysis_stage ?? null,
    // 审计子串匹配源：三个结果列整体序列化（superIpSlogan/subjectCarrierImgOverride 等审计键落在内）
    blob: JSON.stringify({
      fin, pcr,
      s1: row.stage1_result ?? null,
      s2: row.stage2_result ?? null,
    }),
  };
}

const RATING_SET = new Set(['low', 'mid', 'high']);

/**
 * 断言一份预期（expect DSL）对判读结果。
 * @returns {{failures: string[]}} 空数组=全过
 */
export function assertExpectation(interp, expect) {
  const failures = [];
  if (!interp || interp.rating === undefined) {
    return { failures: ['判读输入缺失（interpret 返回空）'] };
  }

  const e = expect ?? {};

  // rating：字符串单值或数组（null=不断言，观察票/评级交后腿）
  if (e.rating !== null && e.rating !== undefined) {
    const allowed = Array.isArray(e.rating) ? e.rating : [e.rating];
    for (const r of allowed) {
      if (!RATING_SET.has(r)) failures.push(`fixtures 非法 rating 枚举: ${r}`);
    }
    if (!allowed.includes(interp.rating)) {
      failures.push(`rating=${interp.rating} 不在预期 [${allowed.join('|')}]`);
    }
  }

  // reasonIncludes：全子串 AND（对 blockReason/precheck.reason）
  const reason = interp.reason ?? '';
  for (const kw of e.reasonIncludes ?? []) {
    if (!reason.includes(kw)) failures.push(`reason 缺少关键词「${kw}」（实际: ${reason || 'null'}）`);
  }
  // reasonExcludes：任一出现即 fail
  for (const kw of e.reasonExcludes ?? []) {
    if (reason.includes(kw)) failures.push(`reason 含禁词「${kw}」（实际: ${reason}）`);
  }

  // precheckRuleIncludes / Excludes：对 pcr ruleName
  const rule = interp.ruleName ?? '';
  for (const kw of e.precheckRuleIncludes ?? []) {
    if (!rule.includes(kw)) failures.push(`precheckRule 缺少「${kw}」（实际: ${rule || 'null'}）`);
  }
  for (const kw of e.precheckRuleExcludes ?? []) {
    if (rule.includes(kw)) failures.push(`precheckRule 含禁值「${kw}」（实际: ${rule}）`);
  }

  // auditIncludes：审计键须在结果列序列化内在场
  for (const key of e.auditIncludes ?? []) {
    if (!interp.blob.includes(key)) failures.push(`审计键「${key}」不在场（stage1/stage2 结果列缺失该键）`);
  }

  return { failures };
}

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * fixtures 结构校验（加载时 fail-fast，防手写 JSON 错形状静默跑）。
 * @returns {{cases: Array, errors: string[]}}
 */
export function loadAndValidateFixtures(doc) {
  const errors = [];
  const cases = doc?.cases;
  if (!Array.isArray(cases) || !cases.length) {
    return { cases: [], errors: ['fixtures 缺 cases 数组或为空'] };
  }
  const seen = new Set();
  for (const c of cases) {
    for (const [field, val] of [['caseId', c.caseId], ['addr', c.addr]]) {
      if (typeof val !== 'string' || !val) errors.push(`case 缺 ${field}: ${JSON.stringify(c).slice(0, 80)}`);
    }
    if (seen.has(c.caseId)) errors.push(`caseId 重复: ${c.caseId}`);
    seen.add(c.caseId);
    if (typeof c.addr === 'string' && !ADDR_RE.test(c.addr)) errors.push(`${c.caseId} addr 非 0x40hex: ${c.addr}`);
    if (!c.expect || typeof c.expect !== 'object') errors.push(`${c.caseId} 缺 expect 段`);
    else if (c.expect.rating !== null && c.expect.rating !== undefined) {
      const allowed = Array.isArray(c.expect.rating) ? c.expect.rating : [c.expect.rating];
      for (const r of allowed) if (!RATING_SET.has(r)) errors.push(`${c.caseId} expect.rating 非法枚举: ${r}`);
    }
    for (const arrField of ['reasonIncludes', 'reasonExcludes', 'precheckRuleIncludes', 'precheckRuleExcludes', 'auditIncludes']) {
      const v = c.expect?.[arrField];
      if (v !== undefined && !Array.isArray(v)) errors.push(`${c.caseId} expect.${arrField} 须为数组`);
    }
  }
  return { cases, errors };
}

/**
 * CSV 转义（RFC 4180 最小面）：含逗号/引号/换行的字段包引号，内部引号双写。
 */
export function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 回归结果行 → CSV（期望/基线/当前/状态同表，BOM 由调用方前置）。
 */
export function toCsv(rows) {
  const HEADERS = ['caseId', 'symbol', 'addr', 'status', '期望rating', '期望reason关键词', '期望禁词', '期望precheck规则', '期望禁规则', '期望审计键', '期望说明', '基线rating', '基线score', '基线ruleName', '基线reason', '当前rating', '当前score', '当前ruleName', '当前stage', '当前reason', '失败明细', 'observe说明', 'case语义'];
  const lines = [HEADERS.join(',')];
  for (const r of rows) {
    lines.push([
      r.caseId, r.symbol, r.addr, r.status,
      Array.isArray(r.expect?.rating) ? r.expect.rating.join('|') : r.expect?.rating ?? '',
      (r.expect?.reasonIncludes ?? []).join('|'), (r.expect?.reasonExcludes ?? []).join('|'),
      (r.expect?.precheckRuleIncludes ?? []).join('|'), (r.expect?.precheckRuleExcludes ?? []).join('|'),
      (r.expect?.auditIncludes ?? []).join('|'), r.expect?.note ?? '',
      r.baseline?.rating, r.baseline?.score, r.baseline?.ruleName, r.baseline?.reason,
      r.current?.rating, r.current?.score, r.current?.ruleName, r.current?.stage, r.current?.reason,
      (r.failures ?? []).join(' | '), r.observe ?? '', r.caseNote ?? '',
    ].map(csvEscape).join(','));
  }
  return lines.join('\n');
}
