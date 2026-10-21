/**
 * 叙事 case 回归集判读/断言纯函数（2026-10-19 建，同日工具正式化：--add/--update-expect 收录与预期更新）。
 * 零 DB 零网络：只消费 token_narrative 回读行快照，供 run.mjs（同目录 runner）与
 * scripts/_test_case_regression_lib.cjs 共用（红线：新机制配零 DB 零网络单测）。工具文档 docs/case-regression-tool.md。
 *
 * 落库两信封是既定事实（C88 信封坑，superip-labels.js s?.details ?? s?.parsed_output
 * 同款），interpret 里 ?? 链是形状切换非兜底：
 *   - precheck 拒票：stage_final_result=null，pre_check_result={rating,reason,details:{ruleName}}
 *   - stage2 拦截票：stage_final_result={rating:'low',details:{blockReason}}，reason 顶层 null
 *   - 评级票：stage_final_result={rating,score,...}
 *   - prestage 路径票（C70/C85 回归揭出的第四信封）：project 票终态在
 *     prestage_result 顶层 {rating,reason}（粉丝带定档 mid）；abm 续走标准路径时
 *     fin 先占位不受影响（?? 链序 fin > pcr > prest）
 */

/**
 * 判读一行 token_narrative 回读 → 统一口径。
 * @param {object|null} row 回读行（须含 stage_final_result/pre_check_result/stage1_result）
 */
export function interpret(row) {
  if (!row) {
    return { rating: null, reason: null, ruleName: null, score: null, stage: null, tokenCategory: null, blob: '' };
  }
  const fin = row.stage_final_result ?? null;
  const pcr = row.pre_check_result ?? null;
  const prest = row.prestage_result ?? null;
  return {
    // 终态优先序：stage 评级/拦截（fin）> precheck 拒（pcr）> prestage 定档（prest）
    rating: fin?.rating ?? pcr?.rating ?? prest?.rating ?? null,
    // stage2 拦截文案在 fin.details.blockReason；precheck 拒文案在 pcr.reason；prestage 定档文案在 prest.reason
    reason: fin?.details?.blockReason ?? pcr?.reason ?? prest?.reason ?? null,
    // ruleName 两形状：buildPreCheckResult 信封 details.ruleName / 顶层 ruleName（address 拒路径顶层也无）
    ruleName: pcr?.details?.ruleName ?? pcr?.ruleName ?? null,
    score: fin?.score ?? null,
    stage: row.analysis_stage ?? null,
    // token_category（C85 断言 'project'；C75/C83 断言不再 'super_ip_fast'——快车道退役面）
    tokenCategory: row.token_category ?? null,
    // 审计子串匹配源：三个结果列整体序列化（superIpSlogan/subjectCarrierImgOverride 等审计键落在内）
    blob: JSON.stringify({
      fin, pcr, prest,
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

  // tokenCategory：精确等（C85 断言 'project'）
  if (e.tokenCategory !== undefined && e.tokenCategory !== null) {
    if (interp.tokenCategory !== e.tokenCategory) {
      failures.push(`token_category=${interp.tokenCategory ?? 'null'} ≠ 预期 ${e.tokenCategory}`);
    }
  }
  // tokenCategoryExcludes：不得再出现的类别（C75/C83 断言脱离 super_ip_fast 快车道）
  for (const cat of e.tokenCategoryExcludes ?? []) {
    if (interp.tokenCategory === cat) {
      failures.push(`token_category 仍为「${cat}」（预期已脱离该形状）`);
    }
  }

  return { failures };
}

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
    for (const arrField of ['reasonIncludes', 'reasonExcludes', 'precheckRuleIncludes', 'precheckRuleExcludes', 'auditIncludes', 'tokenCategoryExcludes']) {
      const v = c.expect?.[arrField];
      if (v !== undefined && !Array.isArray(v)) errors.push(`${c.caseId} expect.${arrField} 须为数组`);
    }
    if (c.expect?.tokenCategory !== undefined && typeof c.expect.tokenCategory !== 'string') {
      errors.push(`${c.caseId} expect.tokenCategory 须为字符串`);
    }
    // 收录/预期更新留痕键（长期维护）：expectSince/expectBecause 必须成对，日期一律 YYYY-MM-DD
    if ((c.expectSince !== undefined) !== (c.expectBecause !== undefined)) {
      errors.push(`${c.caseId} expectSince/expectBecause 必须成对在场（预期更新须留痕）`);
    }
    if (c.expectSince !== undefined && !ISO_DATE_RE.test(c.expectSince)) errors.push(`${c.caseId} expectSince 非 YYYY-MM-DD: ${c.expectSince}`);
    if (c.addedAt !== undefined && !ISO_DATE_RE.test(c.addedAt)) errors.push(`${c.caseId} addedAt 非 YYYY-MM-DD: ${c.addedAt}`);
  }
  return { cases, errors };
}

/**
 * 从现行行判读生成新 case（--add 收录路径）：expect 只取判读终态的确定性键
 * （rating + tokenCategory），意图键（reasonIncludes/auditIncludes 等）留给人工复核补写
 * ——机器只能记录现状，断言意图必须人来定。
 */
export function buildCase({ caseId, symbol, addr, interp, note = '', observe = '', today = '' }) {
  const expect = {};
  if (interp?.rating !== null && interp?.rating !== undefined) expect.rating = interp.rating;
  if (interp?.tokenCategory) expect.tokenCategory = interp.tokenCategory;
  const c = { caseId, symbol: symbol ?? '', addr, expect };
  if (note) c.note = note;
  if (observe) c.observe = observe;
  if (today) c.addedAt = today;
  return c;
}

/**
 * 预期更新（--update-expect 路径）：rating/tokenCategory 从现行判读刷新，
 * 其余 expect 键（人工调过的 reasonIncludes/auditIncludes 等）原样保留，
 * expectSince/expectBecause 留痕——长期维护的根：每个预期都能回答「为什么是这个值」。
 * 纯函数不改原对象。
 */
export function updateExpect(caseObj, interp, because, today) {
  const next = { ...caseObj, expect: { ...caseObj.expect } };
  if (interp?.rating !== null && interp?.rating !== undefined) next.expect.rating = interp.rating;
  if (interp?.tokenCategory) next.expect.tokenCategory = interp.tokenCategory;
  if (because) next.expectBecause = because;
  if (today) next.expectSince = today;
  return next;
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
  const HEADERS = ['caseId', 'symbol', 'addr', 'status', '期望rating', '期望reason关键词', '期望禁词', '期望precheck规则', '期望禁规则', '期望审计键', '期望tokenCat', '期望说明', '基线rating', '基线score', '基线ruleName', '基线reason', '当前rating', '当前score', '当前ruleName', '当前stage', '当前tokenCat', '当前reason', '失败明细', 'observe说明', 'case语义'];
  const lines = [HEADERS.join(',')];
  for (const r of rows) {
    const expectCat = r.expect?.tokenCategory ?? ((r.expect?.tokenCategoryExcludes ?? []).length ? `≠${r.expect.tokenCategoryExcludes.join('|≠')}` : '');
    lines.push([
      r.caseId, r.symbol, r.addr, r.status,
      Array.isArray(r.expect?.rating) ? r.expect.rating.join('|') : r.expect?.rating ?? '',
      (r.expect?.reasonIncludes ?? []).join('|'), (r.expect?.reasonExcludes ?? []).join('|'),
      (r.expect?.precheckRuleIncludes ?? []).join('|'), (r.expect?.precheckRuleExcludes ?? []).join('|'),
      (r.expect?.auditIncludes ?? []).join('|'), expectCat, r.expect?.note ?? '',
      r.baseline?.rating, r.baseline?.score, r.baseline?.ruleName, r.baseline?.reason,
      r.current?.rating, r.current?.score, r.current?.ruleName, r.current?.stage, r.current?.tokenCategory, r.current?.reason,
      (r.failures ?? []).join(' | '), r.observe ?? '', r.caseNote ?? '',
    ].map(csvEscape).join(','));
  }
  return lines.join('\n');
}

/**
 * 确定性 PRNG（mulberry32）——抽样集随机层可复现（seed 落盘在集合元数据里）。
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 涨幅分层抽样（build-sample.mjs 消费；零 DB 零网络纯函数）。
 *
 * pool: [{addr, max, final, ...}]（涨幅已知池，final 可 null；addr 池内唯一）
 * 口径：top = max 降序前 N（并列 final 降序、addr 升序定序）；
 *      bottom = max 升序前 N（并列 final 升序——max=0 尘票里最终跌最狠的优先、addr 升序）；
 *      random = 剩余池 mulberry32(seed) 洗牌取 N。
 * @returns {{top: Array, bottom: Array, random: Array}} 三层互斥（同一 pool 的元素引用）
 */
export function stratifySample(pool, { top, bottom, random, seed }) {
  if (!Array.isArray(pool)) throw new Error('pool 须为数组');
  if (pool.length < top + bottom + random) {
    throw new Error(`抽样池不足: ${pool.length} < top${top}+bottom${bottom}+random${random}`);
  }
  const desc = [...pool].sort((x, y) => (y.max - x.max) || ((y.final ?? -Infinity) - (x.final ?? -Infinity)) || (x.addr < y.addr ? -1 : 1));
  const asc = [...pool].sort((x, y) => (x.max - y.max) || ((x.final ?? Infinity) - (y.final ?? Infinity)) || (x.addr < y.addr ? -1 : 1));
  const topPicks = desc.slice(0, top);
  const bottomPicks = asc.slice(0, bottom);
  const chosen = new Set([...topPicks, ...bottomPicks].map((p) => p.addr));
  const rest = pool.filter((p) => !chosen.has(p.addr));
  const rnd = mulberry32(seed);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return { top: topPicks, bottom: bottomPicks, random: rest.slice(0, random) };
}
