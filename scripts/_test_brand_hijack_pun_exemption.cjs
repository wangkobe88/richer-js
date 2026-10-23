#!/usr/bin/env node
/**
 * J1.103/C172 品牌劫持轴整轴退役——退役反证单测（2026-10-22 用户裁定）
 *
 * 裁定原话：「对，品牌劫持其实本质是事件/代币关系层面的，如果要放，也是放到
 * web3_user_name_event_acceptance，而如果 web3_user_name_event_acceptance 已经
 * 站在了用户视角进行判断了，那么其实 品牌劫持 可以删掉」
 *
 * 案发现场（TREE 0xd50e11204f7f3d63598b0118ee4151bf95917777，C106 j7tracker
 * 直链解锁票）：Jev 内部 name_event=exact_match 0.74 与 entity=brand_mismatch
 * 0.74 自相矛盾——复合创意名（品牌词作修饰、名词主体=事件主体）被实体轴误吃；
 * 且 punExempt 断第四腿 credibleEventAnchor 把 81 分票拦成 low。品牌劫持判据
 * 归位事件/代币关系轴 = web3_user_name_event_acceptance（J1.92 用户视角三桶，
 * exact 20/acceptable 15 过线放行、unacceptable 5 落 ≤10 截断）。
 *
 * 整链退役清单：BRAND_HIJACK_KEYWORDS 预检表+shouldIncludeBrandHijackCheck、
 * 实体题 brand_mismatch 桶（六桶回五桶）、brandMismatch: 传参、mapper
 * brandMismatchP+punExempt（J1.24 戏谑豁免）+劫持截断臂、analyzer
 * includeBrandHijack/credibleEventAnchor 传参、审计键 brandMismatchP/punExempt、
 * reason「戏谑关联豁免(J1.24)」前缀与「品牌劫持」blockReason。
 *
 * 覆盖：
 *   A. 案票终态：C40 BI Inu 形状在 J1.92 语义下（acceptable 15）正常放行计分；
 *      unacceptable 5 由关联≤10 截断拦（承接语义）；旧缓存行残留
 *      brand_mismatch 概率键零影响（bit 一致）
 *   B. 桶退役：实体题恒五桶、brandMismatch:true 传参静默忽略、旧题不在
 *   C. 源码防复活：预检表/函数/mapper 劫持臂/punExempt/analyzer 传参全不在；
 *      spelling 臂升 Stage3 链首
 *   D. 审计停产出：新行 jev 无 brandMismatchP/punExempt 键；magExempt 豁免源
 *      收窄为 imgNameExempt || recognizedEntitySlogan
 *   E. 版本 ≥ J1.103
 *   F. 量级门豁免源收窄：D/E 臂唯一守卫 !imgNameExempt、事件分不足臂 !magExempt、
 *      W pass 线裸线（J1.24 贯穿臂随轴删除）
 *
 * 用法：node scripts/_test_brand_hijack_pun_exemption.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

// ── C40 BI Inu answers 快照改写为 J1.92 新形状（关联题三桶融合分，无
// relevance_level 键）；brand_mismatch 为旧缓存行残留键（A3 验证零影响）────
// category D 0.78 / magnitude 4→fit 0.8→事件分 80（A 档）；entity accepted；
// 关联 acceptable（BSC meme 用户能理解并接受的引申关联=戏谑关联的正名）。
const biTokenData = { symbol: 'BI', name: 'Binance Inu', raw_api_data: { name: 'Binance Inu' } };

function biAnswers({ relChoice = 'acceptable', brandMismatchResidual = 0.72, dim2Score = 3.5 } = {}) {
  return {
    event_category: { choice: 'D', probabilities: { D: 0.78, W: 0.19, B: 0.02 } },
    event_magnitude: { score: 4, probabilities: { '5': 0.43, '4': 0.25 } },
    web3_user_event_fit: { choice: 'fit', probabilities: { strong_fit: 0, fit: 0.8 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.96 } },
    dimension2: { score: dim2Score, probabilities: { '4': 0.5, '3': 0.3 } },
    event_quality_veto: { choice: 'none', probabilities: { none: 0.37, low_quality_derivative: 0.18 } },
    web3_user_name_entity_acceptance: { choice: 'accepted', probabilities: { accepted: 0.79, brand_mismatch: brandMismatchResidual } },
    web3_user_name_event_acceptance: { choice: relChoice, probabilities: { [relChoice]: 0.7 } },
    block_misspelling: { noul: 0.1 },
    quality_spelling: { score: 6 },
    quality_reasonability: { score: 4 },
  };
}

function makeContext({ tokenData = biTokenData, imageConsistency = false } = {}) {
  return {
    tokenData,
    tweetClassification: null,
    twitterInfo: null,
    imageConsistency,
    callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  };
}

function stage3Of(mapped) {
  return mapped?.stage3DataToSave?.parsed_output || {};
}

async function main() {
  const { mapStandardAnswers } = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const { JEV_QUESTIONS_VERSION, buildStandardQuestions } = await import('../src/narrative/analyzer/llm/jev-questions.mjs');

  console.log('\n── A. 案票终态（C40 BI Inu 形状 × J1.92 关联三桶）──');

  // A1 acceptable（戏谑关联的正名归位）：15 分过 ≤10 线 → 放行正常计分
  const m1 = mapStandardAnswers(biAnswers(), makeContext());
  const s1 = stage3Of(m1);
  check('A1 acceptable：15 分放行（pass + blockReason null + rating 非 low + 关联 15 照常计入）',
    s1.pass === true && s1.blockReason === null && m1.llmResult.rating !== 'low'
      && s1.relevanceScore === 15,
    { pass: s1.pass, blockReason: s1.blockReason, rating: m1.llmResult.rating, relevanceScore: s1.relevanceScore });

  // A2 unacceptable（真蹭名票）：5 分 → 承接语义=关联≤10 截断拦（裁定承诺锁死）
  const m2 = mapStandardAnswers(biAnswers({ relChoice: 'unacceptable' }), makeContext());
  const s2 = stage3Of(m2);
  check('A2 unacceptable：5 分由「关联性不足（5分/unacceptable）」拦——品牌劫持判据归位承接',
    s2.pass === false && /关联性不足（5分\/unacceptable）/.test(s2.blockReason || '')
      && !/品牌劫持/.test(s2.blockReason || ''),
    { blockReason: s2.blockReason });

  // A3 旧缓存行残留键零影响：brand_mismatch 概率在/不在 → stage3 bit 一致
  const m3a = mapStandardAnswers(biAnswers({ brandMismatchResidual: 0.72 }), makeContext());
  const m3b = mapStandardAnswers(biAnswers({ brandMismatchResidual: 0 }), makeContext());
  check('A3 残留 brand_mismatch 概率键零影响（两次 stage3 bit 一致 + reason 无「品牌劫持」）',
    JSON.stringify(stage3Of(m3a)) === JSON.stringify(stage3Of(m3b))
      && !/品牌劫持/.test(m1.llmResult.reason || ''),
    m1.llmResult.reason);

  console.log('\n── B. 桶退役 ──');

  const qs = buildStandardQuestions();
  const qsBrand = buildStandardQuestions({ brandMismatch: true });
  check('B1 实体题恒五桶（accepted/unknown/new_entity/wrong_entity/not_entity）',
    Object.keys(qs.bsc_meme_user_name_entity_acceptance.criteria).length === 5
    && !('brand_mismatch' in qs.bsc_meme_user_name_entity_acceptance.criteria), null);
  check('B2 brandMismatch:true 传参静默忽略（同五桶，与默认逐字节一致）',
    JSON.stringify(qsBrand) === JSON.stringify(qs), null);
  check('B3 旧题 name_brand_hijack 不在（J1.85 已删不复活）',
    !('name_brand_hijack' in qs), null);

  console.log('\n── C. 源码防复活 ──');

  const fs = require('fs');
  const mapperSrc = fs.readFileSync('src/narrative/analyzer/llm/jev-result-mapper.mjs', 'utf8');
  const analyzerSrc = fs.readFileSync('src/narrative/analyzer/NarrativeAnalyzer.mjs', 'utf8');
  const questionsSrc = fs.readFileSync('src/narrative/analyzer/llm/jev-questions.mjs', 'utf8');

  check('C1 预检表+函数已删（无 const BRAND_HIJACK_KEYWORDS 定义/function shouldIncludeBrandHijackCheck；版本日志/退役注记刻意保留）',
    !/const BRAND_HIJACK_KEYWORDS/.test(questionsSrc) && !/function shouldIncludeBrandHijackCheck/.test(questionsSrc), null);
  check('C2 mapper 劫持臂+豁免全删（无 brandMismatchP 定义/消费、无 punExempt 定义/守卫、无「品牌劫持」拦截字符串）',
    !/brandMismatchP\s*=/.test(mapperSrc) && !/answers\?\.brand_mismatch/.test(mapperSrc)
    && !/const punExempt/.test(mapperSrc) && !/!punExempt/.test(mapperSrc)
    && !/品牌劫持'/.test(mapperSrc), null);
  check('C3 analyzer 传参已删（无 includeBrandHijack:/credibleEventAnchor: 构建传参；退役注记刻意保留）',
    !/includeBrandHijack\s*[:=]/.test(analyzerSrc) && !/credibleEventAnchor\s*[:=]/.test(analyzerSrc), null);
  check('C4 spelling 臂升 Stage3 链首（品牌劫持臂删除后 if 形状锁定）',
    mapperSrc.includes('if (spellingMismatch.hit)'), null);

  console.log('\n── D. 审计停产出 ──');

  check('D1 新行 jev 审计无 brandMismatchP/punExempt 键（历史行保留展示、新行停产出）',
    !('brandMismatchP' in (s1.jev || {})) && !('punExempt' in (s1.jev || {})),
    Object.keys(s1.jev || {}).filter(k => /brand|pun/i.test(k)));
  check('D2 magExempt 豁免源收窄为 imgNameExempt || recognizedEntitySlogan（J1.24戏谑 tag 删除）',
    /const magExempt = imgNameExempt \|\| recognizedEntitySlogan;/.test(mapperSrc)
    && !/J1\.24戏谑/.test(mapperSrc), null);

  console.log('\n── E. 版本断言 ──');
  check('E1 JEV_QUESTIONS_VERSION ≥ J1.103（J1.103=C172 品牌劫持轴退役；J1.102=C171 形象载体轴退役）',
    parseInt(JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 103, JEV_QUESTIONS_VERSION);

  console.log('\n── F. 量级门豁免源收窄（J1.24 贯穿臂随轴删除）──');

  check('F1 D/E 量级臂唯一守卫 !imgNameExempt（punExempt 臂删除）',
    /\(effTier === 'E' \|\| effTier === 'D'\) && !imgNameExempt/.test(mapperSrc)
    && !/\(effTier === 'E' \|\| effTier === 'D'\) && !punExempt/.test(mapperSrc), null);
  check('F2 事件分不足臂 = eventCompositeScore < 60 && !magExempt（imgName/C88 口号两源豁免仍在）',
    /eventScoreBlocked = eventCompositeScore < 60 && !magExempt;/.test(mapperSrc), null);
  check('F3 W 数学 pass 线保持裸线（恰好一处；豁免不贯穿 W 语义维持）',
    mapperSrc.split('eventScoreBlocked = eventCompositeScore < 32;').length - 1 === 1, null);

  console.log(`\n═══════ ${passed} passed, ${failed} failed ═══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('SUITE ERROR', e); process.exit(1); });
