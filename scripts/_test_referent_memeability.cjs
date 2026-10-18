#!/usr/bin/env node
/**
 * 指代对象 meme 价值门（referent_memeability）——本地零 DB 单测
 *
 * 历史：J1.21（2026-09-30 用户裁定，C33 MTAT 案 0x67fd…7777）是 superIP 快车道
 * 专属豁免（nrBlock 命中 × meme≥3 豁免走评分管线）。C83（2026-10-17）快车道
 * 删除后该豁免不复存在：superIP 语料票走标准路径，指代对象甄别统一由 J1.28
 * 低档门（mem≤1 拦）承载——人名/账号/严肃事务仍拦、内容作品高分过，意图覆盖。
 *
 * 覆盖（C83 后形态）：
 *   A. 问卷形状：恒带 / 版本 ≥J1.28 / 题面锚点
 *   G. 标准路径：nrBlock 照拦 + J1.28 低档门矩阵
 *      （mem≤1 拦「不适合成为meme币」/ mem>1 放行评分 / 无键不拦=旧缓存形状）
 *   H. 源码口径：J1.21 豁免机制零残留（mapper 无豁免标识符 / analyzer 无废弃
 *      选项 / 校准脚本无 superIP 分支）
 *
 * 用法：node scripts/_test_referent_memeability.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

// ── C33 MTAT 案真实形状（DB 实证 prestage_raw_output，G 段矩阵基底）───────
// 币安中文（S级 institution）转发 Yuki 的歌《More Than a Trade》45 秒后抢发；
// name_referent minor_other 0.52（阻断侧合计 0.68）/ magnitude 3.44 / dim2 3.71
function mtatAnswers(memeScore) {
  const answers = {
    event_category: { choice: 'D', probabilities: { D: 0.45, C: 0.21, W: 0.14, E: 0.11, B: 0.06 } },
    event_magnitude: { score: 3.44, probabilities: { '3': 0.27, '4': 0.17, '5': 0.3 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 1 } },
    dimension2: { score: 3.71, probabilities: { '4': 0.29, '5': 0.35, '2': 0.22 } },
    block_reason: { choice: 'institution_routine', probabilities: { institution_routine: 0.66, none: 0.22, routine_content_product: 0.06 } },
    name_referent: { choice: 'minor_other', probabilities: { minor_other: 0.52, subject_self: 0.27, common_word: 0.1, notable_other: 0.06, super_ip: 0.04, none_related: 0.01 } },
    web3_fit: { choice: 'marginal', probabilities: { marginal: 0.32, strong_fit: 0.28, fit: 0.23, unfit: 0.17 } },
    relevance_type: { choice: 'exact_match', probabilities: { exact_match: 0.7, semantic: 0.25 } },
    relevance_level: { score: 4.2, probabilities: { '4': 0.5, '3': 0.4 } },
    block_misspelling: { noul: 0.02 },
    quality_spelling: { score: 6.5 },
    quality_reasonability: { score: 4.5 },
  };
  if (memeScore !== undefined) answers.referent_memeability = { score: memeScore, probabilities: {} };
  return answers;
}

async function main() {
  const mapper = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const { mapStandardAnswers } = mapper;
  const { buildStandardQuestions, JEV_QUESTIONS_VERSION } = await import('../src/narrative/analyzer/llm/jev-questions.mjs');

  // ═══ A. 问卷形状 ═══
  console.log('\n── A. 问卷形状（J1.28 起恒带）──');
  check('A1 版本号 ≥ J1.28（J1.28 恒带+低档门；现值含 C83 断代 bump）', parseInt(JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 28, JEV_QUESTIONS_VERSION);
  const qsDefault = buildStandardQuestions();
  check('A2 J1.28 起默认恒带 referent_memeability（标准路径低档门判据源）', 'referent_memeability' in qsDefault, Object.keys(qsDefault).length);
  const mq = qsDefault.referent_memeability;
  check('A3 题面钉死评估对象=指代对象本身', mq && mq.instructions.includes('指代对象') && mq.instructions.includes('不加分'), null);
  check('A4 分档承载两维度（无名普通人 0 档（J1.33 收窄，人物按高度评）+ AND 下限 3 档）', mq && /0分：无名普通人名/.test(mq.criteria[0]) && mq.criteria[0].includes('只有无名普通人才归本档') && /3分：内容作品/.test(mq.criteria[3]) && mq.criteria[3].includes('同时满足'), null);
  check('A5 与品牌劫持条件题互不影响', buildStandardQuestions({ includeBrandHijack: true }).brand_hijack != null && !('brand_hijack' in qsDefault), null);

  // ═══ G. 标准路径：nrBlock 照拦 + J1.28 低档门矩阵 ═══
  console.log('\n── G. 标准路径（mapStandardAnswers）：nrBlock + J1.28 低档门 ──');
  const stdToken = { symbol: 'MTAT', name: 'More Than a Trade', raw_api_data: { name: 'More Than a Trade' } };
  const stdCtx = {
    tokenData: stdToken,
    includeBrandHijack: false,
    tweetClassification: null,
    twitterInfo: null,
    callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  };
  // 标准路径形状：block_reason none 主导（institution_routine 在标准路径 D 类作用域先拦，
  // 压掉它以专测 nrBlock 环节——ChainPulse/Muse 语义不变性）
  const stdShape = mtatAnswers(4);
  stdShape.block_reason = { choice: 'none', probabilities: { none: 0.9, institution_routine: 0.06, routine_content_product: 0.02 } };
  const stdBlocked = mapStandardAnswers(stdShape, stdCtx); // meme 4 也照拦——nrBlock 在低档门之前
  const stdReason = stdBlocked.llmResult.reason || '';
  check('G1 标准路径 nrBlock 照拦（ChainPulse/Muse 语义不变；门链序 nr→低档门）', stdBlocked.llmResult.rating === 'low' && (stdReason.includes('名字指向无名对象') || stdReason.includes('知名但非超级IP') || stdReason.includes('截词')), stdReason);
  const stdShapeNoKey = mtatAnswers(undefined);
  stdShapeNoKey.block_reason = stdShape.block_reason;
  check('G2 nrBlock 先拦时低档门不参与（无键同判——llmResult 逐字节相等）',
    JSON.stringify(mapStandardAnswers(stdShapeNoKey, stdCtx).llmResult) === JSON.stringify(stdBlocked.llmResult), null);

  // J1.28 低档门矩阵：nrBlock 不命中（super_ip 0.9）× meme 分
  const lowGateShape = meme => {
    const a = mtatAnswers(meme);
    a.block_reason = { choice: 'none', probabilities: { none: 0.9, institution_routine: 0.06, routine_content_product: 0.02 } };
    a.name_referent = { choice: 'super_ip', probabilities: { super_ip: 0.9, notable_other: 0.1 } };
    return a;
  };
  const rLow0 = mapStandardAnswers(lowGateShape(0), stdCtx);
  check('G3 mem 0（人名/账号，YAYA 形状）→ 拦「不适合成为meme币」', rLow0.llmResult.rating === 'low' && (rLow0.llmResult.reason || '').includes('不适合成为meme币'), rLow0.llmResult.reason);
  check('G3b 审计 referentMemeabilityScore=0 + referentMemeabilityBlock={score:0}',
    rLow0.stage2DataToSave.parsed_output.jev.referentMemeabilityScore === 0 && JSON.stringify(rLow0.stage2DataToSave.parsed_output.jev.referentMemeabilityBlock) === '{"score":0}', rLow0.stage2DataToSave.parsed_output.jev.referentMemeabilityBlock);
  const rLow1 = mapStandardAnswers(lowGateShape(1), stdCtx);
  check('G4 mem 1（严肃对象/事务性名称）→ 拦（≤1 含边界）', rLow1.llmResult.rating === 'low' && (rLow1.llmResult.reason || '').includes('不适合成为meme币'), rLow1.llmResult.reason);
  const rLow2 = mapStandardAnswers(lowGateShape(2), stdCtx);
  check('G5 mem 2（>1）→ 不被低档门拦（走向评分管线，拦截原因非本门）',
    !(rLow2.llmResult.rating === 'low' && (rLow2.llmResult.reason || '').includes('不适合成为meme币')), rLow2.llmResult.reason);
  check('G5b 审计 score 恒落（未命中门 block=null）',
    rLow2.stage2DataToSave.parsed_output.jev.referentMemeabilityScore === 2 && rLow2.stage2DataToSave.parsed_output.jev.referentMemeabilityBlock === null, rLow2.stage2DataToSave.parsed_output.jev.referentMemeabilityBlock);
  const rLowNoKey = mapStandardAnswers(lowGateShape(undefined), stdCtx);
  check('G6 无键（旧缓存行形状）→ 低档门不拦（走评分管线）',
    !(rLowNoKey.llmResult.rating === 'low' && (rLowNoKey.llmResult.reason || '').includes('不适合成为meme币')), rLowNoKey.llmResult.reason);
  check('G6b 审计 score=null（旧行无此题，事后校准可识别）',
    rLowNoKey.stage2DataToSave.parsed_output.jev.referentMemeabilityScore === null && rLowNoKey.stage2DataToSave.parsed_output.jev.referentMemeabilityBlock === null, rLowNoKey.stage2DataToSave.parsed_output.jev.referentMemeabilityScore);

  // ═══ H. 源码口径（J1.21 豁免机制零残留）═══
  console.log('\n── H. 源码口径 ──');
  const { readFileSync } = await import('fs');
  const { join } = await import('path');
  const mapperSrc = readFileSync(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-result-mapper.mjs'), 'utf8');
  // J1.21 快车道豁免的三个标识符随 mapSuperIPAnswers 删除，全文件零出现
  // （豁免语义终结的事故反证式锁定——BI 簇案的「引用即 IP」通道不复存在）
  check('H1 mapper 零 referentMemeScore / nameReferentExempt / REFERENT_MEME_EXEMPT_MIN 残留',
    !mapperSrc.includes('referentMemeScore') && !mapperSrc.includes('nameReferentExempt') && !mapperSrc.includes('REFERENT_MEME_EXEMPT_MIN'), null);
  const analyzerSrc = readFileSync(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'NarrativeAnalyzer.mjs'), 'utf8');
  check('H2 analyzer 无废弃选项 referentMemeability + buildStandardQuestions 调用恰 1 处',
    !analyzerSrc.includes('referentMemeability') && (analyzerSrc.match(/buildStandardQuestions\(/g) || []).length === 1, null);
  const calibSrc = readFileSync(join(__dirname, '..', 'scripts', 'narrative', 'jev_calibration.mjs'), 'utf8');
  check('H3 校准脚本无 superIP 分支（isSuperIP / mapSuperIPAnswers / calculatePreScores）',
    !calibSrc.includes('isSuperIP') && !calibSrc.includes('mapSuperIPAnswers') && !calibSrc.includes('calculatePreScores'), null);
  const qsSrc = readFileSync(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-questions.mjs'), 'utf8');
  check('H4 头部历史含 J1.21 条目（C33 MTAT 案，历史档案保留）', qsSrc.includes('* J1.21：') && qsSrc.includes('C33 MTAT'), null);
  check('H4b 头部历史含 J1.28 条目（恒带+低档门）+ 版本常量 ≥J1.28', qsSrc.includes('J1.28') && parseInt(JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 28, JEV_QUESTIONS_VERSION);
  check('H5 题面中性化（大V/超级IP）', qsDefault.referent_memeability.instructions.includes('大V/超级IP'), null);

  // ═══ 汇总 ═══
  console.log(`\n══════ _test_referent_memeability: ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('单测异常:', e); process.exit(1); });
