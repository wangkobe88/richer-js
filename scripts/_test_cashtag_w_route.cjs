#!/usr/bin/env node
/**
 * cashtag 分类判据——本地零 DB 单测
 *
 * J1.17（2026-09-28 C28 iNu 案）硬改道已于 J1.152/C261（2026-11-02 用户裁定
 * 「去掉这个硬规则，然后在分类规则里说明」）退役：cashtag 不再代码强制
 * category='W'，判据移入 event_category 题面由 Jev 判（骑乘已存在资产→W /
 * 宣告推自喊单→按内容本体分类）。
 *
 * 覆盖：
 *   A. detectCorpusCashtag 纯函数（保留不动——审计 cashtagMatched 与 pubProxy
 *      压制仍消费）：直接推文/父推命中、大小写、全等非包含、价格串不误配、
 *      短名保守、name 回退、空输入
 *   B. mapStandardAnswers 路由矩阵（C261 新行为）：cashtag 命中不再强制改道
 *      （类别=Jev 原答案/审计保留/C 类数学放行）/ 原生 W 照走 W 数学 /
 *      非匹配 cashtag 不影响 / 高 appeal 原生 W 放行
 *   C. 源码口径锁：mapper 无 cashtagForced 强制改道残留；题面含 cashtag 判据
 *      句；pubProxy 压制条件在；版本 J1.152
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
  event_magnitude: { score: 3.4, probabilities: { '0': 0.05, '1': 0.03, '2': 0.26, '3': 0.54, '4': 0.09, '5': 0.03 } }, // → B 档（旧口径；J1.79 tier 由 fit 派生）
  // J1.79：事件分=fit 质量；fit 0.68 复现旧 magnitude 3.4 的 68 分/C 档（strong_fit 0
  // 避免 C88 实体口号票五腿与 Web3 偏好锚污染路由矩阵）
  web3_user_event_fit: { choice: 'fit', probabilities: { strong_fit: 0, fit: 0.68 } },
  event_timing: { choice: 'within_7d', probabilities: { within_7d: 1 } },
  dimension2: { score: 3.7, probabilities: { '3': 0.48, '4': 0.41 } }, // → 26.5
  event_quality_veto: {
    choice: 'none',
    probabilities: { none: 0.65, token_ip_reuse: 0.02, event_empty_content: 0.01, regional_event: 0, niche_subculture: 0.01, event_marketing_gimmick: 0.12, event_negative_hard_news: 0, event_institution_routine: 0.14, subject_unqualified: 0, event_baseless_speculation: 0.01, low_quality_derivative: 0.04, event_routine_content_product: 0 },
  },
  web3_user_name_entity_acceptance: { choice: 'accepted', probabilities: { accepted: 0.54, no_entity: 0.04, unknown: 0.42 } },
  // J1.84/C142：w_product_score 已退役——保留快照键仅证明 mapper 对旧行答案零消费
  w_product_score: { score: 0.11, probabilities: { '0': 0.96, '1': 0.02, '2': 0.01, '3': 0.01 } },
  w_bsc_user_appeal: { score: 0.01, probabilities: { '0': 0.99, '1': 0.01 } },                    // → 0+0.01×18=0.18
  name_event_relevance: { choice: 'exact_match', probabilities: { exact_match: 0.5, abbreviation_alias: 0.28 } },
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
  const { JEV_QUESTIONS_VERSION } = await import('../src/narrative/analyzer/llm/jev-questions.mjs');

  console.log('\n── A. detectCorpusCashtag 纯函数（保留：审计+pubProxy 压制消费） ──');
  const hit1 = detectCorpusCashtag(iNuTokenData, iNuTwitter);
  check('A1 直接推文 $INU 命中（iNu 归一化全等）', hit1?.cashtag === '$INU' && hit1?.inReplyTo === false, hit1);

  const hit2 = detectCorpusCashtag(iNuTokenData, { text: 'gm ser', in_reply_to: { text: 'love $inu here' } });
  check('A2 仅父推命中（inReplyTo=true，大小写不敏感）', hit2?.cashtag === '$inu' && hit2?.inReplyTo === true, hit2);

  check('A3 全等非包含：$BANANA 不命中 symbol=BAN', detectCorpusCashtag({ symbol: 'BAN' }, { text: '$BANANA pumping' }) === null);
  check('A4 无 cashtag → null', detectCorpusCashtag(iNuTokenData, { text: 'iPhone iPad now iNu' }) === null);
  check('A5 价格串不误配：$10m ≠ iNu', detectCorpusCashtag({ symbol: 'INU' }, { text: 'mc $10m now' }) === null);
  check('A6 name 走 raw_api_data 回退', detectCorpusCashtag({ symbol: '', name: '', raw_api_data: { name: 'iNu' } }, { text: '$INU' })?.cashtag === '$INU');
  check('A7 短名（<2 字符）保守不命中', detectCorpusCashtag({ symbol: 'o' }, { text: '$O is the one' }) === null);
  check('A8 twitterInfo=null → null', detectCorpusCashtag(iNuTokenData, null) === null);
  check('A9 两文本均空 → null', detectCorpusCashtag(iNuTokenData, { text: '' }) === null);

  console.log('\n── B. mapStandardAnswers 路由矩阵（J1.152/C261：Jev 说了算） ──');
  // B1 iNu 形状复现：cashtag 命中但不再强制改道——类别=Jev 原答案 C，走 C 类数学
  const m1 = mapStandardAnswers(iNuAnswers, makeContext(iNuAnswers, iNuTwitter));
  check('B1a cashtag 命中不再强制改道：类别=C（Jev 原答案）+ 原概率保留', m1.stage1DataToSave.category === 'C' && m1.stage1DataToSave.parsed_output.jev.probabilities.event_category.C === 0.52, m1.stage1DataToSave.parsed_output.jev);
  check('B1b categoryForced=null（硬改道退役）+ cashtagMatched 审计保留', m1.stage1DataToSave.parsed_output.jev.categoryForced === null && m1.stage1DataToSave.parsed_output.jev.cashtagMatched === '$INU');
  check('B1c 走 C 类数学（J1.79 fit 68）放行——旧 25.97 W 拦截退役', m1.stage2DataToSave.parsed_output.scoringResult.category === 'C' && m1.stage2DataToSave.parsed_output.scoringResult.eventCompositeScore === 68 && m1.stage2DataToSave.parsed_output.pass === true, m1.stage2DataToSave.parsed_output.scoringResult);
  check('B1d reason 无 cashtag 改道标注（纯 C 类）', typeof m1.stage2DataToSave.parsed_output.reason === 'string' && !m1.stage2DataToSave.parsed_output.reason.includes('cashtag'), m1.stage2DataToSave.parsed_output.reason);
  check('B1e 终评 high 放行（线上拦截交还 Jev 新判据：J1.152 题面判 W 则照拦）', m1.llmResult.pass === true && m1.llmResult.rating === 'high', m1.llmResult);

  // B2 无 cashtag 语料同答案 → 同样 C 类路径（行为一致）
  const m2 = mapStandardAnswers(iNuAnswers, makeContext(iNuAnswers, null));
  check('B2a 无 cashtag：类别 C、无审计标记（与 B1 路由一致=改道退役后两形状收敛）', m2.stage1DataToSave.category === 'C' && m2.stage1DataToSave.parsed_output.jev.categoryForced === null && m2.stage1DataToSave.parsed_output.jev.cashtagMatched === null);
  check('B2b C 类数学 68 放行', m2.stage2DataToSave.parsed_output.scoringResult.eventCompositeScore === 68 && m2.llmResult.pass === true, m2.stage2DataToSave.parsed_output.scoringResult);

  // B3 Jev 原生 W + cashtag 命中：照常 W 数学（新判据下 Jev 判 W 的骑乘票=线上主防线）
  const wNative = { ...iNuAnswers, event_category: { choice: 'W', probabilities: { W: 0.9, C: 0.1 } } };
  const m3 = mapStandardAnswers(wNative, makeContext(wNative, iNuTwitter));
  check('B3 原生 W 走 W 数学：appeal 0.18<32 拦截', m3.stage2DataToSave.parsed_output.scoringResult.category === 'W' && m3.stage2DataToSave.parsed_output.scoringResult.eventCompositeScore === 0.18 && m3.stage2DataToSave.parsed_output.pass === false, m3.stage2DataToSave.parsed_output.scoringResult);
  check('B3b reason 为纯 W类（无改道标签）', typeof m3.stage2DataToSave.parsed_output.reason === 'string' && m3.stage2DataToSave.parsed_output.reason.startsWith('W类'), m3.stage2DataToSave.parsed_output.reason);
  check('B3c 终评 low', m3.llmResult.rating === 'low' && m3.llmResult.pass === false);

  // B4 非匹配 cashtag（$BTC ≠ iNu）→ 不影响，C 类路径
  const m4 = mapStandardAnswers(iNuAnswers, makeContext(iNuAnswers, { text: '$BTC ETF approved today' }));
  check('B4 非匹配 cashtag 不影响（类别 C 放行）', m4.stage1DataToSave.category === 'C' && m4.llmResult.pass === true);

  // B5 原生 W + 高 appeal（被骑/项目资产影响力高）：W 数学可放行（改道≠必拦的旧行为在新判据下同构）
  const bigAsset = {
    ...iNuAnswers,
    event_category: { choice: 'W', probabilities: { W: 0.85, C: 0.1 } },
    w_product_score: { score: 3.2, probabilities: { '3': 0.9 } },  // J1.84 起零消费
    w_bsc_user_appeal: { score: 2.5, probabilities: { '2': 0.9 } }, // → 38+0.5×18=47（J1.91 后 appeal-only 不再 +timing 25）
  };
  const m5 = mapStandardAnswers(bigAsset, makeContext(bigAsset, iNuTwitter));
  check('B5 原生 W 高 appeal 放行（47≥32）', m5.stage2DataToSave.parsed_output.pass === true && m5.stage2DataToSave.parsed_output.scoringResult.eventCompositeScore === 47, m5.stage2DataToSave.parsed_output.scoringResult);

  console.log('\n── C. 源码口径锁（硬改道退役防线） ──');
  const fs = await import('node:fs');
  const mapperSrc = fs.readFileSync('src/narrative/analyzer/llm/jev-result-mapper.mjs', 'utf8');
  const qSrc = fs.readFileSync('src/narrative/analyzer/llm/jev-questions.mjs', 'utf8');
  check('C1 mapper 无 cashtagForced 强制改道（标识符绝迹，注释存史记档除外）', !/cashtagForced\s*=\s|category\s*=\s*cashtagForced/.test(mapperSrc));
  check('C2 题面含 cashtag 判据（event_category instructions：指向别处已存在资产→W）', qSrc.includes('已在别处存在的 web3 资产') && qSrc.includes('宣告推自己的喊单句'));
  check('C3 pubProxy 压制条件保留（!cashtagHit）', /pubProxy\s*=\s*detectPublisherProxy[\s\S]{0,200}!cashtagHit/.test(mapperSrc));
  check('C4 版本 bump J1.155（C264/J1.155 baseless 桶退役，同跟）', JEV_QUESTIONS_VERSION === 'J1.155', JEV_QUESTIONS_VERSION);
  check('C5 审计 cashtagMatched 保留', mapperSrc.includes('cashtagMatched: cashtagHit?.cashtag'));

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
