#!/usr/bin/env node
/**
 * cashtag 改道 W 类——本地零 DB 单测（J1.17，2026-09-28 用户裁定，C28 iNu案）
 *
 * 覆盖：
 *   A. detectCorpusCashtag 纯函数：直接推文/父推命中、大小写、全等非包含、
 *      价格串不误配、短名保守、name 回退、空输入
 *   B. mapStandardAnswers 路由矩阵：iNu 案数值复现（cashtag 强制 W → W 数学
 *      25.97<60 拦截 + 审计标记 + promptType）/ 无 cashtag 同答案走 C 类 68.5
 *      放行（改道前后行为对照）/ Jev 原生 W 不标注改道 / 非匹配 cashtag 不改道
 *
 * 用法：node scripts/_test_cashtag_w_route.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

// ── C28 iNu 案的 Jev answers 快照（token_narrative d6681041 行数值复现）────────
const iNuAnswers = {
  event_category: { choice: 'C', probabilities: { A: 0, B: 0, C: 0.52, D: 0, E: 0.01, F: 0.02, G: 0.2, W: 0.25 } },
  event_magnitude: { score: 3.4, probabilities: { '0': 0.05, '1': 0.03, '2': 0.26, '3': 0.54, '4': 0.09, '5': 0.03 } }, // → B 档
  event_timing: { choice: 'within_7d', probabilities: { within_7d: 1 } },
  dimension2: { score: 3.7, probabilities: { '3': 0.48, '4': 0.41 } }, // → 26.5
  block_reason: {
    choice: 'none',
    probabilities: { none: 0.65, ip_reuse: 0.02, empty_content: 0.01, regional_event: 0, niche_subculture: 0.01, marketing_gimmick: 0.12, negative_hard_news: 0, institution_routine: 0.14, subject_unqualified: 0, baseless_speculation: 0.01, low_quality_derivative: 0.04, routine_content_product: 0 },
  },
  name_referent: { choice: 'super_ip', probabilities: { super_ip: 0.54, common_word: 0.04, minor_other: 0.2, none_related: 0, subject_self: 0.02, notable_other: 0.2 } },
  w_product_score: { score: 0.11, probabilities: { '0': 0.96, '1': 0.02, '2': 0.01, '3': 0.01 } },   // → 0.88
  w_binance_interaction: { score: 0.01, probabilities: { '0': 0.99, '1': 0.01 } },                    // → 0.09
  relevance_type: { choice: 'exact_match', probabilities: { exact_match: 0.5, abbreviation_alias: 0.28 } },
  relevance_level: { score: 3.4, probabilities: { '3': 0.27, '4': 0.62 } },
  block_misspelling: { noul: 0.15 },
  quality_spelling: { score: 2.29 },      // → 4.29
  quality_reasonability: { score: 1.29 }, // → 2.29
};

const iNuTokenData = { symbol: 'iNu', name: 'iNu', raw_api_data: { name: 'iNu' } };

const iNuTwitter = {
  type: 'tweet',
  text: '@Mikesi30 @iNuApple $INU',
  in_reply_to: { text: "iPhone, iPad, now iNu. I think @iNuApple is undervalued at <$10m MC. $INU complements $AI." },
};

function makeContext(answers, twitterInfo) {
  return {
    tokenData: iNuTokenData,
    includeBrandHijack: false,
    tweetClassification: null,
    twitterInfo,
    callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  };
}

async function main() {
  const { mapStandardAnswers } = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const { detectCorpusCashtag } = await import('../src/narrative/analyzer/utils/narrative-utils.mjs');

  console.log('\n── A. detectCorpusCashtag 纯函数 ──');
  const hit1 = detectCorpusCashtag(iNuTokenData, iNuTwitter);
  check('A1 直接推文 $INU 命中（iNu 归一化全等）', hit1?.cashtag === '$INU' && hit1?.inReplyTo === false, hit1);

  const hit2 = detectCorpusCashtag(iNuTokenData, { text: 'gm ser', in_reply_to: { text: 'love $inu here' } });
  check('A2 仅父推命中（inReplyTo=true，大小写不敏感）', hit2?.cashtag === '$inu' && hit2?.inReplyTo === true, hit2);

  check('A3 全等非包含：$BANANA 不命中 symbol=BAN', detectCorpusCashtag({ symbol: 'BAN' }, { text: '$BANANA pumping' }) === null);
  check('A4 无 cashtag → null', detectCorpusCashtag(iNuTokenData, { text: 'iPhone iPad now iNu' }) === null);
  check('A5 价格串不误配：$10m ≠ iNu', detectCorpusCashtag({ symbol: 'INU' }, { text: 'mc $10m now' }) === null);
  check('A6 name 走 raw_api_data 回退', detectCorpusCashtag({ symbol: '', name: '', raw_api_data: { name: 'iNu' } }, { text: '$INU' })?.cashtag === '$INU');
  check('A7 短名（<2 字符）保守不改道', detectCorpusCashtag({ symbol: 'o' }, { text: '$O is the one' }) === null);
  check('A8 twitterInfo=null → null', detectCorpusCashtag(iNuTokenData, null) === null);
  check('A9 两文本均空 → null', detectCorpusCashtag(iNuTokenData, { text: '' }) === null);

  console.log('\n── B. mapStandardAnswers 路由矩阵 ──');
  // B1 iNu 复现：cashtag 命中 → 强制 W → W 数学拦截
  const m1 = mapStandardAnswers(iNuAnswers, makeContext(iNuAnswers, iNuTwitter));
  check('B1a stage1 类别改写为 W + 原概率保留', m1.stage1DataToSave.category === 'W' && m1.stage1DataToSave.parsed_output.jev.probabilities.event_category.C === 0.52, m1.stage1DataToSave.parsed_output.jev);
  check('B1b stage1 审计标记 categoryForced/cashtagMatched', m1.stage1DataToSave.parsed_output.jev.categoryForced === 'cashtag_w' && m1.stage1DataToSave.parsed_output.jev.cashtagMatched === '$INU');
  check('B1c stage2 走 W 数学：25.97<60 拦截', m1.stage2DataToSave.parsed_output.scoringResult.category === 'W' && m1.stage2DataToSave.parsed_output.scoringResult.totalScore === 25.97 && m1.stage2DataToSave.parsed_output.pass === false, m1.stage2DataToSave.parsed_output.scoringResult);
  check('B1d reason 标注 cashtag 改道来源', typeof m1.stage2DataToSave.parsed_output.reason === 'string' && m1.stage2DataToSave.parsed_output.reason.includes('cashtag改道W类($INU)'), m1.stage2DataToSave.parsed_output.reason);
  check('B1e 拦截链：stage2 low + stage3 清空 + rating low', m1.stage2DataToSave.category === 'low' && m1.stage3DataToSave.__clear === true && m1.llmResult.rating === 'low' && m1.llmResult.pass === false && m1.llmResult.analysis_stage === 2);
  check('B1f promptType 版本+类别随改道更新', m1.promptType.includes('J1.17') && m1.promptType.includes('W类'), m1.promptType);

  // B2 同一答案、无 cashtag 语料 → 原 C 类路径放行（改道前后行为对照）
  const m2 = mapStandardAnswers(iNuAnswers, makeContext(iNuAnswers, null));
  check('B2a 无 cashtag 不改道：类别 C、无审计标记', m2.stage1DataToSave.category === 'C' && m2.stage1DataToSave.parsed_output.jev.categoryForced === null);
  check('B2b C 类数学 27+26.5+15=68.5 放行', m2.stage2DataToSave.parsed_output.scoringResult.category === 'C' && m2.stage2DataToSave.parsed_output.scoringResult.totalScore === 68.5 && m2.stage2DataToSave.parsed_output.pass === true, m2.stage2DataToSave.parsed_output.scoringResult);
  check('B2c 终评 high 放行（改道前 75.68）', m2.llmResult.pass === true && m2.llmResult.rating === 'high' && m2.llmResult.score === 75.68, m2.llmResult);

  // B3 Jev 原生 W + cashtag 命中：不标改道（避免语义混乱），照常 W 数学
  const wNative = { ...iNuAnswers, event_category: { choice: 'W', probabilities: { W: 0.9, C: 0.1 } } };
  const m3 = mapStandardAnswers(wNative, makeContext(wNative, iNuTwitter));
  check('B3 原生 W 不标 cashtagForced，reason 为纯 W类', m3.stage1DataToSave.parsed_output.jev.categoryForced === null && m3.stage2DataToSave.parsed_output.reason.startsWith('W类'), m3.stage2DataToSave.parsed_output.reason);

  // B4 非匹配 cashtag（$BTC ≠ iNu）→ 不改道，C 类路径
  const m4 = mapStandardAnswers(iNuAnswers, makeContext(iNuAnswers, { text: '$BTC ETF approved today' }));
  check('B4 非匹配 cashtag 不改道（类别 C）', m4.stage1DataToSave.category === 'C' && m4.llmResult.pass === true);

  // B5 高影响力被骑资产：W 数学可放行（改道≠必拦，W 高分照过）
  const bigAsset = {
    ...iNuAnswers,
    w_product_score: { score: 3.2, probabilities: { '3': 0.9 } },  // → 27+0.2×8=28.6
    w_binance_interaction: { score: 2.5, probabilities: { '2': 0.9 } }, // → 20+0.5×10=25
  };
  const m5 = mapStandardAnswers(bigAsset, makeContext(bigAsset, iNuTwitter));
  check('B5 被骑资产影响力极高时 W 数学放行（28.6+24.5+25=78.1）', m5.stage2DataToSave.parsed_output.pass === true && m5.stage2DataToSave.parsed_output.scoringResult.totalScore === 78.1, m5.stage2DataToSave.parsed_output.scoringResult);

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
