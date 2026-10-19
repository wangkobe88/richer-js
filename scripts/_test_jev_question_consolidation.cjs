#!/usr/bin/env node
/**
 * C109 题集收敛（J1.43）——本地零 DB 单测（2026-10-19 交易猫 0xc929…7777 案）
 *
 * 收敛清单（用户裁定「合并题/桶」）：
 *   - relevance_type+relevance_level 两题合一（9 融合桶，分值 RELEVANCE_FUSED_SCORES）
 *   - quality_spelling+quality_reasonability 合并 token_quality（band 索引 0-3）
 *   - name_referent 6→3（other_referent 并四桶+配图形象指代源）
 *   - subject_entity 8→2（product_entity/other_entity，J1.27 兼容集）
 *   - block_reason 删 regional_event（死桶 0 拦截）/subject_unqualified（三重冗余）
 *   - subject_carrier 锚修正（M1 图证覆盖在 _test_subject_carrier.cjs H 段）
 *
 * 覆盖：
 *   A. 问卷形状：16 题/桶数/版本 J1.43/旧题不存在
 *   B. 融合关联分：9 桶精确分值 + reason 模板无 lv 段 + 截断线两侧（weak 9 拦/clear 13 过）
 *   C. legacy 关联形状 bit 不变（semantic/lv 查表原样）
 *   D. token_quality 四档映射 + legacy 双题路径 bit 不变
 *   E. C88 relPositiveMass 融合桶名求和（新桶全量形状 hit / 旧桶名 legacy 形状照 hit）
 *   F. J1.27 产品实体门：product_entity 新桶拦 + 旧两桶名兼容拦 + other_entity 不拦
 *   G. 退役阻断桶：subject_unqualified/regional_event choice 空域不拦（blockInScope
 *      未知选项按通用拦的坑——显式空数组封死）
 *
 * 用法：node scripts/_test_jev_question_consolidation.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

/** 干净不拦形状：A 档量级、exact 关联、superIP 指代、无 carrier（可注入） */
function baseAnswers() {
  return {
    event_category: { choice: 'C', probabilities: { C: 0.7 } },
    event_magnitude: { score: 4.6, probabilities: { '4': 0.5, '5': 0.3 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.9 } },
    dimension2: { score: 25, probabilities: { '5': 0.6, '4': 0.3 } },
    block_reason: { choice: 'none', probabilities: { none: 0.92 } },
    name_referent: { choice: 'super_ip', probabilities: { super_ip: 0.9, subject_self: 0.08 } },
    referent_memeability: { score: 3, probabilities: {} },
    web3_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.85, fit: 0.1 } },
    subject_entity: { choice: 'other_entity', probabilities: { other_entity: 0.7 } },
    subject_carrier: { choice: 'existing_entity', probabilities: { existing_entity: 0.8 } },
    name_form: { choice: 'meme_name', probabilities: { meme_name: 0.85 } },
    finding_vs_recap: { choice: 'new_finding', probabilities: { new_finding: 0.8 } },
  };
}

const stdCtx = (symbol, name) => ({
  tokenData: { symbol, name: name || symbol, raw_api_data: { name: name || symbol } },
  includeBrandHijack: false,
  tweetClassification: null,
  twitterInfo: null,
  callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
});

async function main() {
  const mapper = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const { mapStandardAnswers } = mapper;
  const { buildStandardQuestions, JEV_QUESTIONS_VERSION } = await import('../src/narrative/analyzer/llm/jev-questions.mjs');

  // ═══ A. 问卷形状 ═══
  console.log('\n── A. 问卷形状（J1.43）──');
  check('A1 版本 J1.43', JEV_QUESTIONS_VERSION === 'J1.43', JEV_QUESTIONS_VERSION);
  const qs = buildStandardQuestions();
  check('A2 基础 16 题', Object.keys(qs).length === 16, Object.keys(qs).length);
  check('A3 旧题已删（relevance_level/quality_spelling/quality_reasonability 不存在）',
    !('relevance_level' in qs) && !('quality_spelling' in qs) && !('quality_reasonability' in qs), null);
  check('A4 token_quality 在（0-3 四档）', qs.token_quality?.type === 'score' && qs.token_quality.criteria.length === 4, qs.token_quality?.criteria?.length);
  check('A5 relevance_type 9 融合桶',
    Object.keys(qs.relevance_type.criteria).length === 9
    && ['exact_match', 'translation_match', 'abbreviation_alias', 'semantic_clear', 'semantic_weak', 'cultural_rich', 'cultural_thin', 'generic_concept', 'none'].every(k => k in qs.relevance_type.criteria), null);
  check('A6 name_referent 3 桶（subject_self/super_ip/other_referent）',
    Object.keys(qs.name_referent.criteria).length === 3 && 'other_referent' in qs.name_referent.criteria, null);
  check('A6b other_referent 含配图形象指代源（交易猫断链修复点）',
    qs.name_referent.criteria.other_referent.includes('配图中出现的形象'), null);
  check('A7 subject_entity 2 桶（product_entity/other_entity）',
    Object.keys(qs.subject_entity.criteria).length === 2 && 'product_entity' in qs.subject_entity.criteria, null);
  check('A8 block_reason 10 桶（退役桶不在）',
    Object.keys(qs.block_reason.criteria).length === 10
    && !('regional_event' in qs.block_reason.criteria) && !('subject_unqualified' in qs.block_reason.criteria), null);

  // ═══ B. 融合关联分 ═══
  console.log('\n── B. 融合关联分（RELEVANCE_FUSED_SCORES 单值直查）──');
  const fusedScores = { exact_match: 20, translation_match: 18, abbreviation_alias: 17, semantic_clear: 13, semantic_weak: 9, cultural_rich: 12, cultural_thin: 3, generic_concept: 5, none: 0 };
  for (const [bin, want] of Object.entries(fusedScores)) {
    const a = baseAnswers();
    a.relevance_type = { choice: bin, probabilities: { [bin]: 0.8 } };
    const r = mapStandardAnswers(a, stdCtx('TST', 'TST'));
    const rs = r.stage3DataToSave?.parsed_output?.relevanceScore;
    check(`B ${bin} → ${want}`, rs === want, { rs, reason: r.llmResult.reason });
  }
  // reason 模板：融合形状无 lv 段
  const aClear = baseAnswers();
  aClear.relevance_type = { choice: 'semantic_clear', probabilities: { semantic_clear: 0.8 } };
  aClear.token_quality = { score: 3, probabilities: {} };
  const rClear = mapStandardAnswers(aClear, stdCtx('TST', 'TST'));
  check('B10 reason 模板融合形状：关联13(semantic_clear) 无 lv 段 + 质量(长8+名10)',
    (rClear.llmResult.reason || '').includes('关联13(semantic_clear)') && (rClear.llmResult.reason || '').includes('质量18(长8+名10)'),
    rClear.llmResult.reason);
  // 截断线两侧：weak 9 仍被关联截断拦；clear 13 不因截断拦
  const aWeak = baseAnswers();
  aWeak.relevance_type = { choice: 'semantic_weak', probabilities: { semantic_weak: 0.8 } };
  const rWeak = mapStandardAnswers(aWeak, stdCtx('TST', 'TST'));
  check('B11 semantic_weak 9 ≤10 → 关联性不足截断（对齐旧 lv0-1）',
    rWeak.llmResult.rating === 'low' && (rWeak.llmResult.reason || '').includes('关联性不足'), rWeak.llmResult.reason);
  check('B12 semantic_clear 13 >10 → 不因截断拦（对齐旧 lv2-4）',
    rClear.llmResult.rating !== 'low' || !(rClear.llmResult.reason || '').includes('关联性不足'), rClear.llmResult.reason);
  // none=0 锚：保 imgNameExempt relevance.score>0 语义
  const aNone = baseAnswers();
  aNone.relevance_type = { choice: 'none', probabilities: { none: 0.8 } };
  const rNone = mapStandardAnswers(aNone, stdCtx('TST', 'TST'));
  check('B13 none → 0 分（旧 lv0 同语义，截断线内）',
    rNone.stage3DataToSave.parsed_output.relevanceScore === 0
    && rNone.llmResult.rating === 'low' && (rNone.llmResult.reason || '').includes('关联性不足'), rNone.llmResult.reason);

  // ═══ C. legacy 关联形状 bit 不变 ═══
  console.log('\n── C. legacy 关联形状（旧桶名+relevance_level 查表原样）──');
  // levelIdx=round(level) 钳 0-4 直查 RELEVANCE_TABLE（旧代码口径）
  const legacyCases = [
    // [type, levelScore, wantScore, wantLv]
    ['semantic', 2.6, 15, 3],
    ['semantic', 0.4, 8, 0],
    ['cultural', 3.5, 15, 4],
    ['exact_match', 1, 20, 1],
    ['generic_concept', 2.4, 6, 2],
    // 同名桶防劫持反证：这三桶新旧表分值不同，legacy 形状必须走旧表
    ['abbreviation_alias', 0, 16, 0], // 融合表 17——旧形状不得被劫持
    ['none', 4, 2, 4],                // 融合表 0——旧形状不得被劫持
  ];
  for (const [type, lv, wantScore, wantLv] of legacyCases) {
    const a = baseAnswers();
    a.relevance_type = { choice: type, probabilities: { [type]: 0.8 } };
    a.relevance_level = { score: lv, probabilities: {} };
    a.token_quality = undefined; // legacy 形状不带新题
    const r = mapStandardAnswers(a, stdCtx('TST', 'TST'));
    const j = r.stage3DataToSave?.parsed_output;
    const okScore = j?.relevanceScore === wantScore;
    const okLv = j?.jev?.relevanceLevelIdx === wantLv;
    check(`C ${type}/lv${lv} → ${wantScore}(lv${wantLv})`, okScore && okLv, { score: j?.relevanceScore, lv: j?.jev?.relevanceLevelIdx });
  }

  // ═══ D. token_quality 映射 + legacy 双题 bit 不变 ═══
  console.log('\n── D. token_quality（band 索引 0-3 → 联合量纲 0-12）──');
  const tqCases = [[0, 0], [1, 3], [2, 6], [3, 10], [2.5, 7.5], [0.5, 1]];
  for (const [score, want] of tqCases) {
    const a = baseAnswers();
    a.relevance_type = { choice: 'exact_match', probabilities: { exact_match: 0.8 } };
    a.token_quality = { score, probabilities: {} };
    const r = mapStandardAnswers(a, stdCtx('TST', 'TST'));
    const j = r.stage3DataToSave.parsed_output;
    // TST 1 词 → length 8；total = 8 + want
    check(`D token_quality ${score} → 名${want}（total=${8 + want}）`,
      j.jev === undefined || (j.breakdown.name === want && j.qualityScore === 8 + want && j.breakdown.spelling === null),
      { name: j.breakdown?.name, total: j.qualityScore });
  }
  // legacy 双题：spelling 6.5 → band[3] 6.5；reasonability 4.5 → band[2] 4.5
  const aLeg = baseAnswers();
  aLeg.relevance_type = { choice: 'exact_match', probabilities: { exact_match: 0.8 } };
  aLeg.quality_spelling = { score: 6.5, probabilities: {} };
  aLeg.quality_reasonability = { score: 4.5, probabilities: {} };
  const rLeg = mapStandardAnswers(aLeg, stdCtx('TST', 'TST'));
  const jLeg = rLeg.stage3DataToSave.parsed_output;
  check('D7 legacy 拼合双题 bit 不变（拼6.5+合4.5，total=19，name=null）',
    jLeg.qualityScore === 19 && jLeg.breakdown.spelling === 6.5 && jLeg.breakdown.reasonability === 4.5 && jLeg.breakdown.name === null,
    jLeg.breakdown);
  check('D8 legacy reason 模板保持 长+拼+合 原样',
    (rLeg.llmResult.reason || '').includes('质量19(长8+拼6.5+合4.5)'), rLeg.llmResult.reason);

  // ═══ E. C88 relPositiveMass 融合桶求和 ═══
  console.log('\n── E. C88 五腿·关联腿融合桶名──');
  function c88Answers(relProbs) {
    const a = baseAnswers();
    a.relevance_type = { choice: Object.keys(relProbs)[0], probabilities: relProbs };
    a.name_referent = { choice: 'super_ip', probabilities: { super_ip: 0.8, subject_self: 0.15 } };
    a.referent_memeability = { score: 3, probabilities: {} };
    a.web3_fit = { choice: 'strong_fit', probabilities: { strong_fit: 0.8, fit: 0.1 } };
    a.event_timing = { choice: 'within_7d', probabilities: { within_7d: 0.9 } };
    return a;
  }
  // 新桶全量形状：semantic_clear 0.35 + cultural_rich 0.2 → relPositive 0.55
  const rNew = mapStandardAnswers(c88Answers({ semantic_clear: 0.35, cultural_rich: 0.2, none: 0.3 }), stdCtx('暗号', '暗号資産の覹者'));
  const s2New = rNew.stage2DataToSave.parsed_output.jev.superIpSlogan;
  check('E1 新桶名求和：relPositive=0.55（semantic_clear+cultural_rich）→ 五腿 hit',
    s2New.hit === true && s2New.relPositive === 0.55, s2New);
  // 旧桶名 legacy 形状照 hit（求和保留旧名防回放工具）
  const rOld = mapStandardAnswers(c88Answers({ semantic: 0.35, cultural: 0.2, none: 0.3 }), stdCtx('暗号', '暗号資産の覹者'));
  const s2Old = rOld.stage2DataToSave.parsed_output.jev.superIpSlogan;
  check('E2 旧桶名照求和（legacy 形状 bit 不变）', s2Old.hit === true && s2Old.relPositive === 0.55, s2Old);
  // 薄关联不救：thin 0.35 不足以过 mem 腿以外的五腿（relPositive 0.35≥0.3 但 none 0.65 主导 → relNoneMass 0.65 ≥0.5 断腿）
  const rThin = mapStandardAnswers(c88Answers({ cultural_thin: 0.35, none: 0.65 }), stdCtx('TST', 'TST'));
  const s2Thin = rThin.stage2DataToSave.parsed_output.jev.superIpSlogan;
  check('E3 none 主导（0.65≥0.5）→ 五腿断（relNone 腿锁死）', s2Thin.hit === false, s2Thin);

  // ═══ F. J1.27 产品实体门兼容集 ═══
  console.log('\n── F. J1.27 产品实体门（subject_entity 8→2 兼容）──');
  function peAnswers(se) {
    const a = baseAnswers();
    a.subject_entity = { choice: se, probabilities: { [se]: 0.7 } };
    // marginal 主导：unfit=0 不触 J1.19 负门，fitMass=strong_fit+fit=0.2<0.5 → J1.27 拦
    a.web3_fit = { choice: 'marginal', probabilities: { marginal: 0.6, fit: 0.2 } };
    return a;
  }
  for (const [se, wantBlock, wantLabel] of [
    ['product_entity', true, '产品实体'],
    ['product_functional', true, '功能产品'],
    ['product_character', true, '产品形象'],
    ['other_entity', false, null],
  ]) {
    const r = mapStandardAnswers(peAnswers(se), stdCtx('TST', 'TST'));
    const blocked = r.llmResult.rating === 'low' && (r.llmResult.reason || '').includes('产品实体未被web3买家接纳');
    check(`F ${se} → ${wantBlock ? `拦（${wantLabel}）` : '不拦'}`, blocked === wantBlock, r.llmResult.reason);
  }

  // ═══ G. 退役阻断桶空域 ═══
  console.log('\n── G. 退役阻断桶（regional_event/subject_unqualified 空域不拦）──');
  for (const [bin, cat] of [['subject_unqualified', 'C'], ['subject_unqualified', 'D'], ['regional_event', 'E']]) {
    const a = baseAnswers();
    a.event_category = { choice: cat, probabilities: { [cat]: 0.7 } };
    a.block_reason = { choice: bin, probabilities: { [bin]: 0.55, none: 0.4 } }; // 旧形状域内拦截实测档位
    const r = mapStandardAnswers(a, stdCtx('TST', 'TST'));
    check(`G ${bin}+${cat}（旧形状原拦）→ 退役后不再拦`, r.llmResult.rating !== 'low' || !(r.llmResult.reason || '').includes('阻断:'),
      r.llmResult.reason);
  }
  // 对照：活桶照拦（empty_content 全域）
  const aEc = baseAnswers();
  aEc.block_reason = { choice: 'empty_content', probabilities: { empty_content: 0.55, none: 0.4 } };
  const rEc = mapStandardAnswers(aEc, stdCtx('TST', 'TST'));
  check('G4 活桶对照：empty_content 照拦（删除不外溢）',
    rEc.llmResult.rating === 'low' && (rEc.llmResult.reason || '').includes('空洞内容'), rEc.llmResult.reason);

  // ═══ 汇总 ═══
  console.log(`\n══════ _test_jev_question_consolidation: ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('单测异常:', e); process.exit(1); });
