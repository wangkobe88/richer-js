#!/usr/bin/env node
/**
 * 中国政治主题否决门（J1.122/C192）——本地零 DB 零网络单测
 *
 * 2026-10-25 用户裁定：BSC 链用户多是中文用户、中国政治方面非常敏感——中国
 * 政治相关的票「这种影响力绝大多数情况并不适合构建 meme 币」，在
 * bsc_meme_user_event_fit 拦住。案发 强强国国
 * 0x7f9fce00af76ac1c4cf5760f047e71b6852b7777（学习强国官方 IP 全民征名，
 * fit strong_fit 0.43 argmax → mid 65.49 放行）。
 *
 * 覆盖：
 *   A. 题面完整性：版本 J1.122 / fit 题第 5 桶 china_politics 存在 / 四档保留 /
 *      锚句（学习强国示例、不看玩味空间、港澳台同标准、非中国政治不选本项）/
 *      题集题数不变（不新增题）
 *   B. mapper 集成：案发形状（strong_fit 0.43 + china_politics 高概率）→ 拦；
 *      独立否决桶与 sf+fit 概率无关；非该桶不拦；旧缓存行无该桶 fail-open；
 *      门序先于 web3UnfitBlock（label 归属）；无豁免链（币安语料/W 类不豁免）
 *   C. 源码口径：门链位置 / 桶名题面-mapper 一致 / 版本 bump 纪律
 *
 * 用法：node scripts/_test_china_politics_gate.cjs
 */

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

// 案发形状（2026-10-25 token_narrative 实测）：event A 0.78 / impact none 0.71 /
// fit strong_fit 0.43·fit 0.20·marginal 0.17·unfit 0.20 / 实体 accepted 0.52
const FIT_PROBS_CASE = { fit: 0.2, unfit: 0.2, marginal: 0.17, strong_fit: 0.43 };
const tokenData = { symbol: '强强国国', name: '强强国国', raw_api_data: { name: '强强国国' } };

function answersWith(fitChoice, fitProbs) {
  return {
    event_category: { choice: 'A', probabilities: { A: 0.78, B: 0.01, C: 0, D: 0.19, E: 0.01, F: 0, G: 0, W: 0.01 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 1, within_30d: 0, older: 0, unknown: 0 } },
    bsc_meme_user_event_impact: { choice: 'none', probabilities: { none: 0.71, token_ip_reuse: 0.17, event_empty_content: 0.11, event_baseless_speculation: 0.01 } },
    bsc_meme_user_event_fit: fitChoice === undefined ? undefined : { choice: fitChoice, probabilities: fitProbs },
    bsc_meme_user_name_entity_acceptance: { choice: 'accepted', probabilities: { accepted: 0.52, not_entity: 0.04, wrong_entity: 0.1, unacceptable_type: 0.34 } },
    bsc_meme_user_name_event_acceptance: { choice: 'exact_match', probabilities: { exact_match: 0.8, acceptable: 0.15, unacceptable: 0.05 } },
    bsc_meme_user_phrase_acceptability: { choice: 'acceptable', probabilities: { acceptable: 0.8, unacceptable: 0.1, unclear: 0.1 } },
    relevance_level: { score: 3.0, probabilities: { '3': 0.8, '4': 0.1 } },
    quality_spelling: { score: 3 },
    quality_reasonability: { score: 3 },
    token_name_quality: { score: 3 },
  };
}

function makeContext(td, answers) {
  return {
    tokenData: td,
    includeBrandHijack: false,
    tweetClassification: null,
    twitterInfo: null,
    callInfo: { model: 'stub', questions: {}, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  };
}

async function main() {
  const mapper = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const qm = await import('../src/narrative/analyzer/llm/jev-questions.mjs');
  const mapperSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/analyzer/llm/jev-result-mapper.mjs'), 'utf8');
  const questionsSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/analyzer/llm/jev-questions.mjs'), 'utf8');

  console.log('\n── A. 题面完整性（J1.122/C192）──');
  check('A1 版本 = J1.122', qm.JEV_QUESTIONS_VERSION === 'J1.122', qm.JEV_QUESTIONS_VERSION);
  const q = qm.buildStandardQuestions({});
  const fitQ = q.bsc_meme_user_event_fit;
  check('A2 fit 题存在且四档保留 + 新增 china_politics（第 5 桶，四档不删）',
    fitQ && ['strong_fit', 'fit', 'marginal', 'unfit', 'china_politics'].every(k => fitQ.criteria[k]),
    fitQ && Object.keys(fitQ.criteria));
  check('A3 题集题数不变（10 题——本改动加桶不加题，C109 题集收敛纪律）',
    Object.keys(q).length === 10, Object.keys(q).length);
  check('A4 instructions 含中国政治锚句（学习强国示例 / 不看玩味空间 / 港澳台同标准 / 非中国政治不选本项）',
    fitQ.instructions.includes('中国政治主题（J1.122/C192')
    && fitQ.instructions.includes('学习强国')
    && fitQ.instructions.includes('本项不看玩味空间')
    && fitQ.instructions.includes('港澳台议题按同一标准')
    && fitQ.instructions.includes('非中国的政治')
    && fitQ.instructions.includes('影响力存在 ≠ 适合做 meme'),
    fitQ.instructions.includes('中国政治主题（J1.122/C192'));
  check('A5 criteria.china_politics 桶文本含核心判据',
    fitQ.criteria.china_politics.includes('中国政治主题')
    && fitQ.criteria.china_politics.includes('学习强国')
    && fitQ.criteria.china_politics.includes('不适合构建 meme 币')
    && fitQ.criteria.china_politics.includes('不看玩味空间'));

  console.log('\n── B. mapStandardAnswers 集成（案发形状）──');
  // B1 案发形状：fit 四档 argmax 若仍是 strong_fit（旧题集答案），新桶概率在场 → 不拦
  //    （独立否决桶只在 Jev 判该桶时生效；本题集版本的实际答案是 china_politics）
  const rCase = mapper.mapStandardAnswers(
    answersWith('china_politics', { ...FIT_PROBS_CASE, china_politics: 0.55, strong_fit: 0.2 }),
    makeContext(tokenData, null),
  );
  const blk = rCase.stage2DataToSave?.parsed_output?.blockReason || '';
  check('B1 china_politics argmax → rating low + blockReason 命中中国政治否决门',
    rCase.llmResult.rating === 'low' && blk.includes('中国政治主题不适合构建 meme 币（J1.122）'),
    { rating: rCase.llmResult.rating, blk });
  const audit = rCase.stage2DataToSave?.parsed_output?.jev?.chinaPoliticsBlock;
  check('B2 审计键 chinaPoliticsBlock={choice} 命中才落',
    audit && audit.choice === 'china_politics', audit);

  // B3 独立否决：sf+fit 高（0.9）也照拦——影响力/契合概率不改变中国政治判定
  const rHighFit = mapper.mapStandardAnswers(
    answersWith('china_politics', { strong_fit: 0.6, fit: 0.3, marginal: 0.05, unfit: 0.03, china_politics: 0.5 }),
    makeContext(tokenData, null),
  );
  check('B3 sf+fit=0.9 高契合形状照拦（独立否决桶，不走 fitMass 概率门）',
    rHighFit.llmResult.rating === 'low'
    && (rHighFit.stage2DataToSave?.parsed_output?.blockReason || '').includes('中国政治主题不适合构建 meme 币'),
    rHighFit.stage2DataToSave?.parsed_output?.blockReason);

  // B4 非该桶：strong_fit 0.9 → 不拦（防误伤面）
  const rNormal = mapper.mapStandardAnswers(
    answersWith('strong_fit', { strong_fit: 0.9, fit: 0.05, marginal: 0.03, unfit: 0.02, china_politics: 0.01 }),
    makeContext(tokenData, null),
  );
  check('B4 非 china_politics（strong_fit 0.9）→ 不拦，审计键 null',
    rNormal.llmResult.rating !== 'low'
    && rNormal.stage2DataToSave?.parsed_output?.jev?.chinaPoliticsBlock === null,
    { rating: rNormal.llmResult.rating, audit: rNormal.stage2DataToSave?.parsed_output?.jev?.chinaPoliticsBlock });

  // B5 旧缓存行（fit 答案缺失）→ 中国政治门 fail-open（由既有 fitMass 门接管，label 不得冒认）
  const rLegacy = mapper.mapStandardAnswers(answersWith(undefined, undefined), makeContext(tokenData, null));
  const blkLegacy = rLegacy.stage2DataToSave?.parsed_output?.blockReason || '';
  check('B5 旧缓存行无 fit 答案 → 中国政治门不触发（fail-open，不冒认 label）',
    !blkLegacy.includes('中国政治主题不适合构建 meme 币'),
    blkLegacy);

  // B6 门序：china_politics 且 unfit 概率也 ≥0.5 → label 归中国政治门（主题类别先于概率门）
  const rBoth = mapper.mapStandardAnswers(
    answersWith('china_politics', { strong_fit: 0.05, fit: 0.05, marginal: 0.1, unfit: 0.7, china_politics: 0.6 }),
    makeContext(tokenData, null),
  );
  check('B6 门序：china_politics ∧ unfit≥0.5 → label=中国政治（类别否决先于概率门，归属更准）',
    (rBoth.stage2DataToSave?.parsed_output?.blockReason || '').includes('中国政治主题不适合构建 meme 币'),
    rBoth.stage2DataToSave?.parsed_output?.blockReason);

  // B7 无豁免链：币安语料 + W 类也不豁免（C55/C56/isW 豁免不适用于中国政治）
  const binanceToken = { symbol: '币安', name: '币安', raw_api_data: { name: '币安' } };
  const binanceAnswers = answersWith('china_politics', { strong_fit: 0.2, fit: 0.2, marginal: 0.1, unfit: 0.1, china_politics: 0.6 });
  binanceAnswers.event_category = { choice: 'W', probabilities: { W: 0.9, D: 0.05 } };
  const rBinance = mapper.mapStandardAnswers(binanceAnswers, makeContext(binanceToken, null));
  check('B7 无豁免链：币安语料 + W 类竞合形状 → 中国政治门照拦',
    rBinance.llmResult.rating === 'low'
    && (rBinance.stage2DataToSave?.parsed_output?.blockReason || '').includes('中国政治主题不适合构建 meme 币'),
    rBinance.stage2DataToSave?.parsed_output?.blockReason);

  console.log('\n── C. 源码口径 ──');
  const cpIdx = mapperSrc.indexOf('} else if ((cpBlock = chinaPoliticsBlock(answers))) {');
  const w3Idx = mapperSrc.indexOf('} else if ((w3Block = web3UnfitBlock(answers))) {');
  check('C1 门链接线：cpBlock 分支存在且先于 web3UnfitBlock（主题类别否决在概率门之前）',
    cpIdx > 0 && w3Idx > cpIdx, { cpIdx, w3Idx });
  check('C2 桶名题面-mapper 一致（criteria 键 china_politics + mapper 判定字面量）',
    !!fitQ.criteria.china_politics && (mapperSrc.match(/china_politics/g) || []).length >= 3,
    { hasCriteriaKey: !!fitQ.criteria.china_politics, mapperHits: (mapperSrc.match(/china_politics/g) || []).length });
  check('C3 chinaPoliticsBlock 私有（不导出，门矩阵经集成测）',
    mapper.chinaPoliticsBlock === undefined && mapper.__chinaPoliticsBlock === undefined);
  check('C4 版本注释含 C192 归因（bump 纪律可追溯）',
    questionsSrc.includes('J1.122（C192，2026-10-25）'));

  console.log(`\n═══ _test_china_politics_gate: ${passed} passed, ${failed} failed ═══`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
