#!/usr/bin/env node
/**
 * J1.74（C134 股城案）W 类数学：币安交互臂退役，改为项目对 BSC 用户吸引力
 * ——本地零 DB 零网络单测
 *
 * 用户裁定（2026-10-20）：「发在 BSC 链的项目，一开始刚发出，基本上不可能有
 * 币安交互，把币安交互这一臂去掉，改为分析项目本身对 BSC Web3 用户的吸引力」。
 *
 * 改动：删除 w_binance_interaction（题/分带/审计键/评分），新增
 * w_bsc_user_appeal（0-40，同权重）；W 数学 = 产品(0-35) + BSC用户吸引力(0-40)
 * + 时效(0-25)，pass 线 60；C42「世界级主体产品豁免币安交互」随被豁免的轴退役
 * （不再有两轴归一）。
 *
 * 覆盖：
 *   A. 三轴数学：高吸引力放行 / 低吸引力拦截（精确分值 + reason 文案）
 *   B. C42 退役：S/A 新产品低吸引力不再被归一化救回（三轴照算）
 *   C. 题集形状：w_bsc_user_appeal 在场 / w_binance_interaction 删除 / 14 题
 *   D. 源码口径反证：无 wInteractionExempt/wInteractionScore/w_binance_interaction、
 *      scoringResult.wAppealScore、reason「BSC用户吸引力」
 *   E. 版本 J1.74
 *
 * 用法：node scripts/_test_w_bsc_user_appeal.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

function wAnswers({ product = 1.92, appeal = 3.5, timing = 'within_7d' } = {}) {
  return {
    event_category: { choice: 'W', probabilities: { W: 0.9, D: 0.1 } },
    event_timing: { choice: timing, probabilities: { within_7d: 0.9, older: 0.1 } },
    event_token_block_reason: { choice: 'none', probabilities: { none: 0.9 } },
    web3_user_name_entity_acceptance: { choice: 'accepted', probabilities: { accepted: 0.9 } },
    web3_user_event_fit: { choice: 'fit', probabilities: { fit: 0.5, strong_fit: 0.2 } },
    event_subject_entity: { choice: 'product_entity', probabilities: { product_entity: 0.9 } },
    name_event_relevance: { choice: 'exact_match', probabilities: { exact_match: 0.9, none: 0.01 } },
    name_entity_carrier: { choice: 'existing_entity', probabilities: { existing_entity: 0.9 } },
    web3_user_name_acceptability: { choice: 'web3_user_acceptable', probabilities: { web3_user_acceptable: 0.9 } },
    token_name_quality: { score: 3, probabilities: {} },
    w_product_score: { score: product, probabilities: { '1': 0.6, '2': 0.4 } },
    w_bsc_user_appeal: { score: appeal, probabilities: { '3': 0.8, '2': 0.2 } },
  };
}

function makeContext() {
  return {
    tokenData: { symbol: 'RedCoin', name: 'RedCoin', raw_api_data: { name: 'RedCoin' } },
    twitterInfo: null,
    includeBrandHijack: false,
    credibleEventAnchor: false,
    tweetClassification: null,
    callInfo: { model: 'stub', questions: {}, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  };
}

function stage2Of(mapped) { return mapped?.stage2DataToSave?.parsed_output || {}; }

async function main() {
  const { mapStandardAnswers } = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const { buildStandardQuestions, JEV_QUESTIONS_VERSION } = await import('../src/narrative/analyzer/llm/jev-questions.mjs');
  const fs = require('fs');

  console.log('\n── A. W 三轴数学（产品 + BSC用户吸引力 + 时效）──');

  // 产品 1.92 → 16.36；吸引力 3.5 → 35；时效 within_7d → 25
  const mHigh = mapStandardAnswers(wAnswers(), makeContext());
  const s2High = stage2Of(mHigh);
  check('A1 高吸引力票：16.36+35+25=76.36 → pass',
    s2High.pass === true && s2High.scoringResult?.eventCompositeScore === 76.36,
    { pass: s2High.pass, scoring: s2High.scoringResult });
  check('A2 scoringResult 三轴键：产品 16.36 / 吸引力 35 / 时效 25',
    s2High.scoringResult?.wProductScore === 16.36
    && s2High.scoringResult?.wAppealScore === 35
    && s2High.scoringResult?.timingScore === 25,
    s2High.scoringResult);
  check('A3 reason 文案=「W类 产品…+BSC用户吸引力…+时效…」',
    /W类 产品16\.36\+BSC用户吸引力35\+时效25=76\.36（pass线60）/.test(s2High.reason || ''),
    s2High.reason);

  // 低吸引力：0.1 → 0.9；16.36+0.9+25=42.26 <60 → 拦
  const mLow = mapStandardAnswers(wAnswers({ appeal: 0.1 }), makeContext());
  const s2Low = stage2Of(mLow);
  check('A4 低吸引力票：16.36+0.9+25=42.26<60 → 拦（reason=W类总分不足）',
    s2Low.pass === false && s2Low.scoringResult?.eventCompositeScore === 42.26
    && s2Low.blockReason === 'W类总分不足（42.26<60）',
    { pass: s2Low.pass, score: s2Low.scoringResult?.eventCompositeScore, blockReason: s2Low.blockReason });

  // 时效轴照常：within_30d=15 → 16.36+35+15=66.36 过；older=0 → 51.36 拦
  const mOlder = mapStandardAnswers(wAnswers({ timing: 'within_30d' }), makeContext());
  const s2Older = stage2Of(mOlder);
  check('A5 时效 within_30d=15：16.36+35+15=66.36 过（时效轴保留）',
    s2Older.pass === true && s2Older.scoringResult?.eventCompositeScore === 66.36,
    { pass: s2Older.pass, score: s2Older.scoringResult?.eventCompositeScore });
  const mStale = mapStandardAnswers(wAnswers({ timing: 'older' }), makeContext());
  const s2Stale = stage2Of(mStale);
  check('A5b 时效 older=0：16.36+35+0=51.36 → 拦',
    s2Stale.pass === false && s2Stale.scoringResult?.eventCompositeScore === 51.36,
    { pass: s2Stale.pass, score: s2Stale.scoringResult?.eventCompositeScore });

  console.log('\n── B. C42 退役：世界级新产品低吸引力不再归一化 ===');

  // 旧 C42 形状：S/A 新产品 + 无交互。现在吸引力低 → 三轴照算拦截。
  // 产品 2.9 → 18+0.9*8=25.2；吸引力 0.1→0.9；时效25 → 51.1
  const mOldC42 = mapStandardAnswers(wAnswers({ product: 2.9, appeal: 0.1 }), makeContext());
  const s2OldC42 = stage2Of(mOldC42);
  check('B1 旧 C42 形状（高产品+无币安交互）→ 不再两轴归一，按吸引力 0.9 计 51.1 拦',
    s2OldC42.pass === false && s2OldC42.scoringResult?.eventCompositeScore === 51.1
    && s2OldC42.jev?.wInteractionExempt === undefined,
    { pass: s2OldC42.pass, score: s2OldC42.scoringResult?.eventCompositeScore, exempt: s2OldC42.jev?.wInteractionExempt });

  console.log('\n── C. 题集形状 ──');

  const qs = buildStandardQuestions();
  check('C1 w_bsc_user_appeal 在场（score 0-40 四分带）',
    qs.w_bsc_user_appeal?.type === 'score' && qs.w_bsc_user_appeal.criteria.length === 4
    && qs.w_bsc_user_appeal.criteria[3].includes('强吸引力'),
    qs.w_bsc_user_appeal?.criteria);
  check('C2 w_binance_interaction 已删除',
    !('w_binance_interaction' in qs));
  check('C3 题面明确「不评币安官方交互/刚发布不可能有、不扣分」',
    qs.w_bsc_user_appeal.instructions.includes('不评与币安官方的交互')
    && qs.w_bsc_user_appeal.instructions.includes('刚发布的 BSC 项目本来就不可能有币安交互')
    && qs.w_bsc_user_appeal.instructions.includes('不是项目的吸引力证据，也不因此扣分'));
  check('C4 基础题数仍 14（替换不增减）', Object.keys(qs).length === 14, Object.keys(qs).length);

  console.log('\n── D. 源码口径反证（防回潮）──');

  const mapperSrc = fs.readFileSync('src/narrative/analyzer/llm/jev-result-mapper.mjs', 'utf8');
  const qsSrc = fs.readFileSync('src/narrative/analyzer/llm/jev-questions.mjs', 'utf8');
  check('D1 mapper 无交互臂残留（w_binance_interaction/wInteractionScore/wInteractionExempt 声明）',
    !mapperSrc.includes('answers.w_binance_interaction')
    && !mapperSrc.includes('wInteractionScore:')
    && !mapperSrc.includes('wInteractionExempt ='));
  check('D2 W 数学三轴=wProduct+wAppeal+timingScore，无归一化分支',
    /eventCompositeScore = round2\(wProduct \+ wAppeal \+ timingScore\)/.test(mapperSrc)
    && !/\(wProduct \+ timingScore\) \/ 60 \* 100/.test(mapperSrc));
  check('D3 scoringResult 落 wAppealScore；题集源码无旧题定义',
    /wAppealScore: isW \? wAppeal : null/.test(mapperSrc)
    && !/w_binance_interaction: \{/.test(qsSrc)
    && /w_bsc_user_appeal: \{/.test(qsSrc));
  check('D4 答案概率审计键=w_bsc_user_appeal',
    /w_bsc_user_appeal: answers\.w_bsc_user_appeal\?\.probabilities/.test(mapperSrc));

  console.log('\n── E. 版本 ──');
  check('E1 JEV_QUESTIONS_VERSION = J1.74（C134 吸引力臂替换）',
    JEV_QUESTIONS_VERSION === 'J1.76', JEV_QUESTIONS_VERSION);

  console.log(`\n══════ ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('SUITE ERROR', e); process.exit(1); });
