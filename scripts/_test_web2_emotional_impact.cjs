#!/usr/bin/env node
/**
 * Web2 旁观热点情感冲击臂（J1.123/C193）+ 中国政治门 C192b 收窄——零 DB 零网络单测
 *
 * 2026-10-25 用户裁定：齐天大圣 0x4a6a6c8b3c15eb8422ad7b95c5c6280ed68d7777（抖音
 * 博主树枝搭齐天大圣游乐园 70 万赞）「对 BSC Meme 币用户，没有感情冲击力。因为
 * 是一件 Web2 的事情，缺少感情冲击力，哪怕有个形象，也不够」——在
 * bsc_meme_user_event_fit 加一臂试影响面。
 *
 * 同批 C192b：J1.122 中国政治门首跑回归反证两张误拦（C94 京小安 china_politics
 * 0.61=北京日报 AI 警犬产品、C194 小黑 0.54=交警救助流浪狗 #中国故事），题面
 * 加边界句收窄为「政治议题/人物/事件/宣传符号」，官媒非政治内容回归事件本身评估。
 *
 * 覆盖：
 *   A. 题面：版本 J1.123 / C193 锚句与边界（C161 可玩产品不适用、C160 情感路径
 *      不适用）/ marginal 桶新增臂 / 桶数仍 5 不新增桶 / C192b 边界句
 *   B. mapper 语义（不加代码门，靠既有 web3FitMassBlock）：marginal 主导
 *      → sf+fit<0.5 拦；marginal + sf+fit≥0.5 不拦；china_politics 门不受污染
 *
 * 用法：node scripts/_test_web2_emotional_impact.cjs
 */

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

const tokenData = { symbol: '齐天大圣', name: '齐天大圣', raw_api_data: { name: '齐天大圣' } };

function answersWith(fitChoice, fitProbs) {
  return {
    event_category: { choice: 'E', probabilities: { A: 0.16, B: 0, C: 0, D: 0, E: 0.84, F: 0, G: 0, W: 0 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 1 } },
    bsc_meme_user_event_impact: { choice: 'none', probabilities: { none: 0.64, token_ip_reuse: 0.24, event_empty_content: 0.04, event_baseless_speculation: 0.08 } },
    bsc_meme_user_event_fit: { choice: fitChoice, probabilities: fitProbs },
    bsc_meme_user_name_entity_acceptance: { choice: 'accepted', probabilities: { accepted: 1 } },
    bsc_meme_user_name_event_acceptance: { choice: 'exact_match', probabilities: { exact_match: 0.9, acceptable: 0.08, unacceptable: 0.02 } },
    bsc_meme_user_phrase_acceptability: { choice: 'acceptable', probabilities: { acceptable: 0.9 } },
    relevance_level: { score: 3.0, probabilities: { '3': 0.8 } },
    quality_spelling: { score: 3 },
    quality_reasonability: { score: 3 },
    token_name_quality: { score: 3 },
  };
}

function makeContext() {
  return {
    tokenData,
    includeBrandHijack: false,
    tweetClassification: null,
    twitterInfo: null,
    callInfo: { model: 'stub', questions: {}, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  };
}

async function main() {
  const mapper = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const qm = await import('../src/narrative/analyzer/llm/jev-questions.mjs');
  const questionsSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/analyzer/llm/jev-questions.mjs'), 'utf8');

  console.log('\n── A. 题面（J1.123/C193 + C192b）──');
  check('A1 版本 ≥ J1.123（J1.123=C193 旁观热点判据臂；当前 J1.125=C196）', parseInt(qm.JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 123, qm.JEV_QUESTIONS_VERSION);
  const q = qm.buildStandardQuestions({});
  const fitQ = q.bsc_meme_user_event_fit;
  check('A2 C193 锚句在场（Web2 旁观热点 / 情感冲击 / 哪怕有形象也不够 / 至多 marginal / 齐天大圣案）',
    fitQ.instructions.includes('Web2 旁观热点的情感冲击门槛（J1.123/C193')
    && fitQ.instructions.includes('没有情感冲击力')
    && fitQ.instructions.includes('哪怕热度极高（几十万赞）、有知名 IP/形象（如齐天大圣）')
    && fitQ.instructions.includes('至多 marginal（不选 strong_fit/fit）'),
    fitQ.instructions.includes('Web2 旁观热点的情感冲击门槛'));
  check('A3 C193 两条边界在场（C161 可参与产品/网站/游戏不适用 + C160 公益救助不适用）',
    fitQ.instructions.includes('全球级爆火且用户能参与/讨论/二创的产品、网站、游戏、生成器不适用本臂')
    && fitQ.instructions.includes('真实正向公益/动物救助/纪念故事有情感冲击，不适用本臂'));
  check('A4 marginal 桶含 C193 臂（旁观热度/无情感冲击/有形象高赞也不够/至多本档）',
    fitQ.criteria.marginal.includes('J1.123/C193 Web2 旁观热点臂')
    && fitQ.criteria.marginal.includes('无情感冲击')
    && fitQ.criteria.marginal.includes('至多本档'));
  check('A5 不新增桶（四档+china_politics=5，C109 题集收敛；C244 起观察题加入题集 10→11 题）',
    Object.keys(fitQ.criteria).length === 5 && Object.keys(q).length === 11,
    { buckets: Object.keys(fitQ.criteria).length, questions: Object.keys(q).length });
  check('A6 C192b 中国政治门收窄边界在场（官媒非政治内容不选本项 + 京小安/小黑案例锚）',
    fitQ.instructions.includes('边界（C192b，2026-10-25 回归后收窄）')
    && fitQ.instructions.includes('官方媒体/党政机构发布的**非政治内容**')
    && fitQ.instructions.includes('不选本项')
    && fitQ.instructions.includes('C194 小黑案')
    && fitQ.instructions.includes('C94 京小安案'));

  console.log('\n── B. mapper 语义（无新代码门，走既有 web3FitMassBlock）──');
  // B1 齐天大圣改判后的预期形状：marginal 主导、sf+fit<0.5 → 契合证据门拦
  const rMarginal = mapper.mapStandardAnswers(
    answersWith('marginal', { strong_fit: 0.12, fit: 0.1, marginal: 0.7, unfit: 0.06 }),
    makeContext(),
  );
  const blkM = rMarginal.stage2DataToSave?.parsed_output?.blockReason || '';
  check('B1 marginal 主导（sf+fit=22%<50%）→ low + 契合证据门 label',
    rMarginal.llmResult.rating === 'low' && blkM.includes('Web3用户契合证据不足(J1.83)'), { rating: rMarginal.llmResult.rating, blkM });
  // B2 marginal 但 sf+fit≥0.5 → 不拦（marginal 只降档不硬杀，复核边界票不被误拦）
  const rMarginalPass = mapper.mapStandardAnswers(
    answersWith('marginal', { strong_fit: 0.35, fit: 0.2, marginal: 0.4, unfit: 0.05 }),
    makeContext(),
  );
  check('B2 marginal ∧ sf+fit=55%≥50% → 契合证据门不拦（label 不冒认；若仍 low 只能是事件分不足 55<60 的评分层，非本臂硬杀）',
    !(rMarginalPass.stage2DataToSave?.parsed_output?.blockReason || '').includes('Web3用户契合证据不足'),
    { rating: rMarginalPass.llmResult.rating, reason: rMarginalPass.stage2DataToSave?.parsed_output?.blockReason });
  // B3 高 fit 票不受污染（C193 是题面臂，不改变 strong_fit 判定路径）
  const rStrong = mapper.mapStandardAnswers(
    answersWith('strong_fit', { strong_fit: 0.85, fit: 0.08, marginal: 0.05, unfit: 0.02 }),
    makeContext(),
  );
  check('B3 strong_fit 0.85 → 不拦（情感/玩梗路径票不受新臂影响）',
    rStrong.llmResult.rating !== 'low', rStrong.llmResult.rating);
  // B4 china_politics 门不受 C193 影响（两臂互不污染）
  const rChina = mapper.mapStandardAnswers(
    answersWith('china_politics', { strong_fit: 0.1, fit: 0.1, marginal: 0.2, unfit: 0.1, china_politics: 0.6 }),
    makeContext(),
  );
  check('B4 china_politics 桶照拦（C192 门与 C193 题面臂互不污染）',
    rChina.llmResult.rating === 'low'
    && (rChina.stage2DataToSave?.parsed_output?.blockReason || '').includes('中国政治主题不适合构建 meme 币'));
  check('B5 源码口径：J1.123 注释含 C193 归因（bump 纪律可追溯）',
    questionsSrc.includes('J1.123（C193，2026-10-25）'));

  console.log(`\n═══ _test_web2_emotional_impact: ${passed} passed, ${failed} failed ═══`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
