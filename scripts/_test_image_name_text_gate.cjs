#!/usr/bin/env node
/**
 * C78 图文名不符拼写门（J1.140 图片直连架构：条件题 image_name_text_match
 * 四桶承接，detectNameImageSpellingMismatch 纯代码门退役）
 * ——本地零 DB 零网络单测。案史：2026-10-16 用户裁定「拼写错误这个肯定要
 * 阻断」，鲸元卷案 0xe0cf0905310fc63cd8192513883d7426fc1e7777——币名
 * 「鲸元卷」、图内两处独立文字段都写正字「鲸元券」，全图无一「卷」字。
 *
 * 判据演进：旧=纯代码 substitution 一字差对照（读 SiliconFlow caption
 * visible_text 转写）；J1.140 图片直连（Jev 原生看图）后 caption 中介退役
 * → 判据源换条件题四桶：exact_match（币名整体在图内，不拦）/
 * one_char_diff_repeated（等长恰一位差写法 ≥2 次独立出现，拦）/
 * one_char_diff_once（仅 1 次，不拦）/ unrelated_or_none（不拦）。
 * CJK≥3 前提=isCjkLongName 代码侧（题只在前提真时问）。
 *
 * 覆盖：
 *   A. 四桶矩阵：仅 one_char_diff_repeated ≥0.5 拦（Stage3 截断 low+
 *      reason 图文名不符+审计 spellingMismatch {name,bucket,prob}）
 *   B. 阈值边界：0.49 不拦 / 0.50 拦
 *   C. 旧缓存行（无 image_name_text_match 答案键）→ fail-open 不拦
 *   D. isCjkLongName 真值表（CJK/韩文/假名 ≥3 拉丁/短名/混合/空）
 *   E. 题集矩阵：开关含/不含；四桶 criteria 在场；鲸元卷对照锚措辞
 *   F. analyzer 接线口径：开关=withImage ∧ image_asset（jev 直连本体）
 *      ∧ isCjkLongName——caption 臂（image_analysis 无图本体）不问
 *   G. detectNameImageSpellingMismatch 防复活反证（源码零残留）
 *   H. 源码口径锁定：mapper 读键/阈值/审计形状/概率块内嵌
 *
 * 用法：node scripts/_test_image_name_text_gate.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

const { readFileSync } = require('fs');
const { join } = require('path');

async function main() {
const MAPPER = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
const { mapStandardAnswers, isCjkLongName } = MAPPER;
const { buildStandardQuestions } = await import('../src/narrative/analyzer/llm/jev-questions.mjs');

const TOKEN_ADDR = '0xe0cf0905310fc63cd8192513883d7426fc1e7777';

/** 鲸元卷案 answers 骨架：过 stage1/2（E 类 + 高量级 + 高 dim2），relevance exact_match 高分——只验 Stage3 截断位 */
function jyjAnswers(imgNameText) {
  return {
    event_category: { choice: 'E', probabilities: { E: 0.62, C: 0.21 } },
    event_magnitude: { score: 4.4, probabilities: { '4': 0.55, '5': 0.25 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.99 } },
    dimension2: { score: 24, probabilities: { '5': 0.58, '4': 0.3 } },
    event_quality_veto: { choice: 'none', probabilities: { none: 0.55, low_quality_derivative: 0.26 } },
    web3_user_name_entity_acceptance: { choice: 'unknown', probabilities: { unknown: 0.6 } },
    name_entity_memeability: { score: 3.48, probabilities: { '4': 0.58, '3': 0.32 } },
    web3_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.97 } },
    event_subject_entity: { choice: 'company', probabilities: { company: 0.38, product_functional: 0.29 } },
    name_entity_carrier: { choice: 'existing_entity', probabilities: { existing_entity: 0.8 } },
    name_event_relevance: { choice: 'exact_match', probabilities: { exact_match: 0.55 } },
    relevance_level: { score: 2.75, probabilities: { '3': 0.6 } },
    block_misspelling: { noul: 0.28 }, // 线上真实值：旧文本探针拦不住（新门判据源不再依赖它）
    quality_spelling: { score: 2.53 },
    quality_reasonability: { score: 1.32 },
    ...(imgNameText ? { image_name_text_match: imgNameText } : {}),
  };
}

const q4 = (repeatedP) => ({
  choice: repeatedP >= 0.5 ? 'one_char_diff_repeated' : 'exact_match',
  probabilities: { exact_match: 0.08, one_char_diff_repeated: repeatedP, one_char_diff_once: 0.1, unrelated_or_none: 0.05 },
});

const stdCtx = (over = {}) => ({
  tokenData: { symbol: '鲸元卷', name: '鲸元卷', raw_api_data: { name: '鲸元卷' } },
  includeBrandHijack: false,
  imageEvidence: true,
  tweetClassification: null,
  twitterInfo: null,
  callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  ...over,
});

console.log('══════ A. 四桶矩阵（仅 one_char_diff_repeated 拦） ══════');
{
  const cases = [
    ['exact_match（币名整体在图内）→ 放行', { choice: 'exact_match', probabilities: { exact_match: 0.85, one_char_diff_repeated: 0.05, one_char_diff_once: 0.03, unrelated_or_none: 0.02 } }, false],
    ['one_char_diff_repeated 0.72（鲸元卷案形状）→ 拦截', { choice: 'one_char_diff_repeated', probabilities: { exact_match: 0.12, one_char_diff_repeated: 0.72, one_char_diff_once: 0.06, unrelated_or_none: 0.04 } }, true],
    ['one_char_diff_once（仅一处这样写）→ 放行', { choice: 'one_char_diff_once', probabilities: { exact_match: 0.05, one_char_diff_repeated: 0.05, one_char_diff_once: 0.8, unrelated_or_none: 0.04 } }, false],
    ['unrelated_or_none（图内无币名相关文字）→ 放行', { choice: 'unrelated_or_none', probabilities: { exact_match: 0.02, one_char_diff_repeated: 0.05, one_char_diff_once: 0.03, unrelated_or_none: 0.84 } }, false],
  ];
  for (const [label, ans, shouldBlock] of cases) {
    const r = mapStandardAnswers(jyjAnswers(ans), stdCtx());
    const blocked = r.llmResult.rating === 'low';
    const reason = r.stage3DataToSave?.parsed_output?.blockReason || '';
    check(`A1 ${label}`, blocked === shouldBlock, { blocked, rating: r.llmResult.rating });
    if (shouldBlock) {
      check(`A2 ${label} → blockReason 图文名不符`, String(reason).includes('图文名不符'), reason);
    }
  }
}

console.log('══════ B. 鲸元卷案审计形状 + 阈值边界 ══════');
{
  const r = mapStandardAnswers(jyjAnswers(q4(0.72)), stdCtx());
  const jev = r.stage3DataToSave?.parsed_output?.jev;
  const sm = jev?.spellingMismatch;
  check('B1 审计 spellingMismatch {name,bucket,prob}', sm && sm.name === '鲸元卷' && sm.bucket === 'one_char_diff_repeated' && Math.abs(sm.prob - 0.72) < 1e-9, sm);
  check('B2 概率块内嵌 image_name_text_match', !!jev?.probabilities?.image_name_text_match?.one_char_diff_repeated, jev?.probabilities?.image_name_text_match);
  const r49 = mapStandardAnswers(jyjAnswers(q4(0.49)), stdCtx());
  check('B3 0.49 < 0.5 不拦', r49.llmResult.rating !== 'low');
  const r50 = mapStandardAnswers(jyjAnswers(q4(0.5)), stdCtx());
  check('B4 0.50 恰阈值拦（>=0.5）', r50.llmResult.rating === 'low');
  const rPass = mapStandardAnswers(jyjAnswers(q4(0.08)), stdCtx());
  check('B5 不拦截票审计 spellingMismatch=null', rPass.stage3DataToSave?.parsed_output?.jev?.spellingMismatch == null);
}

console.log('══════ C. 旧缓存行（无答案键）fail-open ══════');
{
  const r = mapStandardAnswers(jyjAnswers(null), stdCtx());
  check('C1 旧缓存行无 image_name_text_match → 不拦（历史行零翻转）', r.llmResult.rating !== 'low');
  check('C2 无答案键概率块不内嵌', !r.stage3DataToSave?.parsed_output?.jev?.probabilities?.image_name_text_match);
}

console.log('══════ D. isCjkLongName 真值表（题前提代码侧） ══════');
{
  const t = (name, expected) => check(`D ${JSON.stringify(name)} → ${expected}`, isCjkLongName({ name }) === expected);
  t('鲸元卷', true);            // CJK 3 字
  t('币安上电视', true);         // CJK 5 字
  t('犬', false);               // CJK 但 <3
  t('柴犬', false);             // CJK 2 字
  t('TEST', false);             // 拉丁无 CJK
  t('ABC Coin', false);         // 拉丁混合
  t('AI犬', true);              // 混合去空白后 3 字含 CJK
  t('불개미군단', true);         // 韩文
  t('パピプペポ', true);         // 假名
  t('', false);                 // 空
  check('D11 raw_api_data.name 兜底', isCjkLongName({ raw_api_data: { name: '鲸元券' } }) === true);
  check('D12 undefined → false', isCjkLongName(undefined) === false);
}

console.log('══════ E. 题集矩阵 ══════');
{
  const qsOn = buildStandardQuestions({ imageNameTextMatch: true });
  const qsOff = buildStandardQuestions({ imageNameTextMatch: false });
  check('E1 开=true 含题', 'image_name_text_match' in qsOn);
  check('E2 开=false 不含题', !('image_name_text_match' in qsOff));
  const q = qsOn.image_name_text_match;
  const buckets = Object.keys(q.criteria);
  check('E3 四桶恰齐', buckets.length === 4 && ['exact_match', 'one_char_diff_repeated', 'one_char_diff_once', 'unrelated_or_none'].every(b => buckets.includes(b)), buckets);
  const qsSrc = readFileSync(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-questions.mjs'), 'utf8');
  check('E4 鲸元卷对照锚在题面', qsSrc.includes('币名「鲸元卷」、图内两处空间独立的文字都写「鲸元券」'));
  check('E5 只看逐字拼写不看画面/音近锚在题面', qsSrc.includes('只看图内文字与币名的逐字拼写') && qsSrc.includes('不读音近似'));
  check('E6 子串算 exact_match 锚（原代码③分支承接）', qsSrc.includes('币名整体作为更长文字段的子串出现也算 exact_match'));
}

console.log('══════ F. analyzer 接线口径 ══════');
{
  const naSrc = readFileSync(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'NarrativeAnalyzer.mjs'), 'utf8');
  check('F1 开关=withImage ∧ image_asset ∧ isCjkLongName（caption 臂无图本体不问）',
    naSrc.includes('imageNameTextMatch: withImage && !!(imageAsset && isCjkLongName(tokenData))'));
  check('F2 imageAsset 定义=asset 优先（jev 直连本体）', naSrc.includes('const imageAsset = !visionSkipped ? twitterInfo?.image_asset : null;'));
}

console.log('══════ G. detectNameImageSpellingMismatch 防复活反证 ══════');
{
  const mapperSrc = readFileSync(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-result-mapper.mjs'), 'utf8');
  // 退役注释段（L758/772/1791）保留函数名作历史档案——只锁代码形状零残留
  check('G1 声明+调用形状零残留（注释提及=档案）',
    !mapperSrc.includes('function detectNameImageSpellingMismatch') && !mapperSrc.includes('detectNameImageSpellingMismatch('));
  check('G2 旧 image_analysis stringify 判据零残留', !mapperSrc.includes('JSON.stringify(image_analysis') && !/image_analysis\?\.\s*analysis\?\.\s*description/.test(mapperSrc));
  const naSrc = readFileSync(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'NarrativeAnalyzer.mjs'), 'utf8');
  check('G3 analyzer 侧调用点零残留', !naSrc.includes('detectNameImageSpellingMismatch'));
}

console.log('══════ H. 源码口径锁定 ══════');
{
  const mapperSrc = readFileSync(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-result-mapper.mjs'), 'utf8');
  check('H1 读键形状（可选链 ?? 0）', mapperSrc.includes('answers.image_name_text_match?.probabilities?.one_char_diff_repeated ?? 0'));
  check('H2 阈值 >= 0.5', mapperSrc.includes('nameTextRejP >= 0.5'));
  check('H3 审计三键 {name,bucket,prob}', /spellingMismatch\.hit[\s\S]{0,120}bucket: spellingMismatch\.bucket, prob: spellingMismatch\.prob/.test(mapperSrc));
  check('H4 概率块条件内嵌', mapperSrc.includes('...(answers.image_name_text_match ? { image_name_text_match: answers.image_name_text_match.probabilities } : {})'));
}

console.log(`\n══════ _test_image_name_text_gate: ${passed} passed, ${failed} failed ══════`);
if (failed > 0) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });
