#!/usr/bin/env node
/**
 * J1.21 指代对象 meme 价值豁免（superIP 通道 nameReferentBlock × referent_memeability）
 * ——本地零 DB 单测（2026-09-30 用户裁定，C33 MTAT 案 0x67fd…7777）
 *
 * 裁定原话「要看被转发的指代对象meme程度，以及被web3用户喜欢的程度。丫丫肯定
 * 不行啊是个币安员工，这首歌明显可以」：超级IP转发/提及的无名对象按类型分流——
 * 人名/账号（YAYA 型）维持拦截；内容作品双达标（meme 玩味 + web3 契合，题面 3 档
 * AND 下限）豁免 nameReferentBlock 走正常评分管线。仅 superIP 快车道。
 *
 * 覆盖：
 *   A. 问卷形状：J1.28 起恒带（默认即携带，superIP 选项已废弃）/ 版本 ≥J1.21
 *   B. 豁免矩阵：nrBlock 命中（阻断侧 0.68）× meme 分 {null,0,2,3,4,5}
 *      → <3 或 null 保持拦、≥3 豁免走评分管线
 *   C. nrBlock 未命中：豁免逻辑不激活（本来就不拦，分数落库观察）
 *   D. 其他门不受豁免：web3 unfit≥0.5 照拦（豁免不放 web3 unfit 盘）
 *   E. YAYA 形状锚定：人名指代 meme 0-1 档 → 保持拦
 *   F. MTAT 案形状端到端：真实 answers 形状 + meme 4 → 豁免 pass + 审计落库
 *   G. 标准路径：nrBlock 照拦（J1.21 语义不变）+ J1.28 低档门矩阵
 *      （mem≤1 拦「不适合成为meme币」/ mem>1 放行评分 / 无键不拦=旧缓存形状）
 *   H. 源码口径：门槛常量 3 / 豁免逻辑仅在 mapSuperIPAnswers
 *
 * 用法：node scripts/_test_referent_memeability.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

// ── C33 MTAT 案真实形状（DB 实证 prestage_raw_output）────────────────────────
// 币安中文（S级 institution）转发 Yuki 的歌《More Than a Trade》45 秒后抢发；
// name_referent minor_other 0.52（阻断侧合计 0.68）/ block institution_routine 0.66
// （superIP 通道豁免不拦）/ magnitude 3.44 / dim2 3.71 / web3 unfit 0.17
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

function superCtx(extraPreScores) {
  return {
    superIPInfo: { name: '币安中文', type: 'institution', tier: 'S', desc: '币安中文官方' },
    preScores: extraPreScores || { tierScore: 40, timeliness: 15, baseEventScore: 55 },
    symbol: 'MTAT',
    includeBrandHijack: false,
    callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  };
}

async function main() {
  const mapper = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const { mapStandardAnswers, mapSuperIPAnswers } = mapper;
  const { buildStandardQuestions, JEV_QUESTIONS_VERSION } = await import('../src/narrative/analyzer/llm/jev-questions.mjs');

  // ═══ A. 问卷形状 ═══
  console.log('\n── A. 问卷形状（J1.28 起恒带；superIP 选项废弃）──');
  check('A1 版本号 ≥ J1.28（J1.28 恒带+低档门）', parseInt(JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 28, JEV_QUESTIONS_VERSION);
  const qsDefault = buildStandardQuestions();
  check('A2 J1.28 起默认恒带 referent_memeability（标准路径低档门判据源）', 'referent_memeability' in qsDefault, Object.keys(qsDefault).length);
  const qsSuper = buildStandardQuestions({ referentMemeability: true });
  const mq = qsSuper.referent_memeability;
  check('A3 传废弃选项 referentMemeability:true 与默认同一形状', !!mq && mq.type === 'score' && JSON.stringify(mq) === JSON.stringify(qsDefault.referent_memeability), mq?.type);
  check('A4 题面钉死评估对象=指代对象本身', mq && mq.instructions.includes('指代对象') && mq.instructions.includes('不加分'), null);
  check('A5 分档承载两维度（人名 0 档 + AND 下限 3 档）', mq && /0分：人名/.test(mq.criteria[0]) && /3分：内容作品/.test(mq.criteria[3]) && mq.criteria[3].includes('同时满足'), null);
  check('A6 与品牌劫持条件题互不影响', buildStandardQuestions({ includeBrandHijack: true, referentMemeability: true }).brand_hijack != null && !('brand_hijack' in qsSuper), null);

  // ═══ B. 豁免矩阵 ═══
  console.log('\n── B. nrBlock 命中（阻断侧 0.68）× meme 分矩阵 ──');
  const rNoScore = mapSuperIPAnswers(mtatAnswers(undefined), superCtx());
  check('B1 分缺失（标准路径形状/条件题未答）→ 保持拦（fail-closed）', rNoScore.llmResult.rating === 'low' && rNoScore.llmResult.reason.includes('名字指向无名对象'), rNoScore.llmResult.reason);
  check('B1b 审计 referentMemeability=null / exempt=false', rNoScore.prestageDataToSave.parsed_output.jev.referentMemeability === null && rNoScore.prestageDataToSave.parsed_output.jev.nameReferentExempt === false, rNoScore.prestageDataToSave.parsed_output.jev);
  const rNull = mapSuperIPAnswers(mtatAnswers(null), superCtx());
  check('B2 显式 null 分 → 保持拦', rNull.llmResult.rating === 'low' && rNull.llmResult.reason.includes('名字指向无名对象'), rNull.llmResult.reason);

  const r0 = mapSuperIPAnswers(mtatAnswers(0), superCtx());
  check('B3 meme 0（人名）→ 保持拦', r0.llmResult.rating === 'low' && r0.llmResult.reason.includes('名字指向无名对象'), r0.llmResult.reason);
  const r2 = mapSuperIPAnswers(mtatAnswers(2), superCtx());
  check('B4 meme 2（玩味弱/圈外）→ 保持拦', r2.llmResult.rating === 'low' && r2.llmResult.reason.includes('名字指向无名对象'), r2.llmResult.reason);

  const r3 = mapSuperIPAnswers(mtatAnswers(3), superCtx());
  check('B5 meme 3（AND 下限）→ 豁免：rating 非 low-by-nr', r3.llmResult.rating !== 'low' || !r3.llmResult.reason.includes('名字指向无名对象'), r3.llmResult);
  check('B5b 豁免后 pass=true 走评分管线', r3.llmResult.pass === true, r3.llmResult);
  check('B5c 审计 nameReferentExempt=true + 分数落库', r3.prestageDataToSave.parsed_output.jev.nameReferentExempt === true && r3.prestageDataToSave.parsed_output.jev.referentMemeability === 3, r3.prestageDataToSave.parsed_output.jev);
  const r4 = mapSuperIPAnswers(mtatAnswers(4), superCtx());
  check('B6 meme 4（MTAT 形状）→ 豁免 + 高分事件管线', r4.llmResult.pass === true && r4.llmResult.score != null && r4.llmResult.score >= 50, r4.llmResult);
  const r5 = mapSuperIPAnswers(mtatAnswers(5), superCtx());
  check('B7 meme 5 → 豁免', r5.llmResult.pass === true, r5.llmResult);

  // ═══ C. nrBlock 未命中：豁免逻辑不激活 ═══
  console.log('\n── C. nrBlock 未命中（super_ip 0.9）──');
  const okNr = mtatAnswers(0); // 分数 0 也不该改变任何东西（本来就不拦）
  okNr.name_referent = { choice: 'super_ip', probabilities: { super_ip: 0.9, notable_other: 0.1 } };
  const rOk = mapSuperIPAnswers(okNr, superCtx());
  check('C1 nrBlock 未命中 + meme 0 → 不拦（豁免逻辑不激活）', rOk.llmResult.pass === true, rOk.llmResult);
  check('C1b 审计 exempt=false（未命中无豁免语义）+ 分数照落库观察', rOk.prestageDataToSave.parsed_output.jev.nameReferentExempt === false && rOk.prestageDataToSave.parsed_output.jev.referentMemeability === 0, rOk.prestageDataToSave.parsed_output.jev);

  // ═══ D. web3 unfit 负门不受豁免 ═══
  console.log('\n── D. web3FitBlock unfit≥0.5 独立保底 ──');
  const unfit = mtatAnswers(4);
  unfit.web3_fit = { choice: 'unfit', probabilities: { unfit: 0.7, marginal: 0.2, fit: 0.1 } };
  const rUnfit = mapSuperIPAnswers(unfit, superCtx());
  check('D1 meme 4 + unfit 0.7 → 仍拦（Web3用户偏好不合，优先级在前）', rUnfit.llmResult.rating === 'low' && rUnfit.llmResult.reason.includes('Web3用户偏好不合'), rUnfit.llmResult.reason);

  // ═══ E. YAYA 形状锚定（人名指代保持拦——裁定「丫丫肯定不行是个币安员工」）═══
  console.log('\n── E. YAYA 案形状锚定 ──');
  // YAYA：何一（S级 person）推文 @ 的周边账号名，minor_other 主导；对象=人名 → 题面 0 档
  const yaya = mtatAnswers(0);
  yaya.name_referent = { choice: 'minor_other', probabilities: { minor_other: 0.55, subject_self: 0.43 } }; // J1.10 案值：阻断侧 0.55
  yaya.block_reason = { choice: 'none', probabilities: { none: 0.9 } };
  const rYaya = mapSuperIPAnswers(yaya, {
    superIPInfo: { name: '何一', type: 'person', tier: 'S', desc: '币安联创' },
    preScores: { tierScore: 40, timeliness: 15, baseEventScore: 55 },
    symbol: 'YAYA',
    includeBrandHijack: false,
    callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  });
  check('E1 YAYA 人名指代 meme 0 → 保持拦截（回归不变）', rYaya.llmResult.rating === 'low' && rYaya.llmResult.reason.includes('名字指向无名对象'), rYaya.llmResult.reason);

  // ═══ F. MTAT 案端到端数值（豁免后事件管线数值锚定）═══
  console.log('\n── F. MTAT 案豁免后评分数值 ──');
  // eventTotal = baseEventScore 55 + dim2(3.71→band) ；quality/relevance 由 mapper 算
  const rF = mapSuperIPAnswers(mtatAnswers(4), superCtx());
  const fin = rF.stageFinalData;
  check('F1 stageFinalData 产出（category/totalScore 非空）', fin && fin.totalScore != null && fin.category != null, fin);
  check('F2 reason 标注事件分构成（含 tierScore 40）', rF.llmResult.reason.includes('事件分') && rF.llmResult.reason.includes('40'), rF.llmResult.reason);
  check('F3 prestage pass=true + blockReason=null（豁免后无阻断）', rF.prestageDataToSave.parsed_output.pass === true && rF.prestageDataToSave.parsed_output.blockReason === null, rF.prestageDataToSave.parsed_output);

  // ═══ G. 标准路径：nrBlock 照拦 + J1.28 低档门矩阵 ═══
  console.log('\n── G. 标准路径（mapStandardAnswers）：J1.21 语义不变 + J1.28 低档门 ──');
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
  check('G3 mem 0（人名/账号）→ 拦「不适合成为meme币」', rLow0.llmResult.rating === 'low' && (rLow0.llmResult.reason || '').includes('不适合成为meme币'), rLow0.llmResult.reason);
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

  // ═══ H. 源码口径 ═══
  console.log('\n── H. 源码口径 ──');
  const { readFileSync } = await import('fs');
  const { join } = await import('path');
  const mapperSrc = readFileSync(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-result-mapper.mjs'), 'utf8');
  check('H1 门槛常量 REFERENT_MEME_EXEMPT_MIN = 3', /REFERENT_MEME_EXEMPT_MIN = 3/.test(mapperSrc), null);
  // C59 指代载体在图豁免复用同一分数（imgReferentExempt 条件 2 次 + 审计 1 次），
  // 计数 4→7；本质断言 = 标准路径函数体内零出现（豁免域仍仅 superIP 块）
  const stdFnBody = mapperSrc.slice(mapperSrc.indexOf('export function mapStandardAnswers'), mapperSrc.indexOf('export function mapSuperIPAnswers'));
  check('H2 豁免仅 mapSuperIPAnswers（referentMemeScore 唯一出现域=superIP 块；C59 复用后计数 7）',
    (mapperSrc.match(/referentMemeScore/g) || []).length === 7 && !stdFnBody.includes('referentMemeScore'),
    (mapperSrc.match(/referentMemeScore/g) || []).length);
  check('H3 校准脚本 superIP 分支同口径携带', (readFileSync(join(__dirname, '..', 'scripts', 'narrative', 'jev_calibration.mjs'), 'utf8')).includes('referentMemeability: isSuperIP'), null);
  const analyzerSrc = readFileSync(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'NarrativeAnalyzer.mjs'), 'utf8');
  check('H4 主链路两调用点形状（J1.28 恒带后 superIP 传废弃选项无害，标准路径零改动）', analyzerSrc.includes('referentMemeability: true') && (analyzerSrc.match(/buildStandardQuestions\(/g) || []).length === 2, null);
  const qsSrc = readFileSync(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-questions.mjs'), 'utf8');
  check('H5 头部历史含 J1.21 条目（C33 MTAT 案）', qsSrc.includes('* J1.21：') && qsSrc.includes('C33 MTAT'), null);
  check('H5b 头部历史含 J1.28 条目（恒带+低档门）+ 版本常量 J1.28', qsSrc.includes('J1.28') && qsSrc.includes("JEV_QUESTIONS_VERSION = 'J1.28'"), null);
  check('H6 题面中性化（大V/超级IP）', qsDefault.referent_memeability.instructions.includes('大V/超级IP'), null);

  // ═══ 汇总 ═══
  console.log(`\n══════ _test_referent_memeability: ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('单测异常:', e); process.exit(1); });
