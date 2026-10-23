#!/usr/bin/env node
/**
 * J1.84（C142）W 类数学：双轴合并为单轴——本地零 DB 零网络单测
 *
 * 用户裁定（2026-10-21「方案A」）：`w_product_score` 与 `w_bsc_user_appeal`
 * 语义/统计双重重叠（J1.79 实跑 W 票 Spearman 0.847 / R² 0.711 / 两轴合计
 * 独立方差仅 ~9.6%；product 系统性高 0.28 带，残差=已退役 C42 形态先验），
 * 合并为单一「项目对 BSC 用户吸引力」轴：
 *   - w_product_score 题/0-35 带/W_PRODUCT_BANDS/scoringResult.wProductScore 退役
 *   - w_bsc_user_appeal 0-40 → 0-75（四带 [0,18]/[19,37]/[38,56]/[57,75]）
 *   - J1.91/C154（2026-10-21 用户裁定「时效体系冗余机制可删」）：删除
 *     TIMING_SCORES_W 正向表——W 数学 = wAppeal（0-75）单轴，pass 线 32
 *     （=57-25，保持 fresh 通过集）；时效仅对 older/unknown/override 封顶 30。
 *     原 25=within_7d / 15=within_30d / 0=older|unknown 表删除。
 *
 * 覆盖：
 *   A. 单轴数学：高/低吸引力、时效两档、product 答案在场但零消费
 *   B. product 不能救低 appeal（旧 C42 形状）——合并后单轴语义
 *   C. 题集形状：w_bsc_user_appeal 0-75 在场 / w_product_score 退役 / 12 题
 *   D. 源码口径反证：无 wProduct/W_PRODUCT_BANDS/wProductScore/w_product_score 消费
 *   E. 版本 J1.107（J1.107=W 三档 Choice；J1.84=C142 本轴合并；J1.85=C143 品牌题并入实体轴随 bump）
 *   F. J1.107 Choice 三档映射：weak 15/moderate 47/strong 66、双形状消费、legacy 等值锚
 *
 * 用法：node scripts/_test_w_bsc_user_appeal.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

function wAnswers({ appeal = 2.5, timing = 'within_7d', product = null, appealChoice = null } = {}) {
  const a = {
    event_category: { choice: 'W', probabilities: { W: 0.9, D: 0.1 } },
    event_timing: { choice: timing, probabilities: { within_7d: 0.9, older: 0.1 } },
    event_quality_veto: { choice: 'none', probabilities: { none: 0.9 } },
    web3_user_name_entity_acceptance: { choice: 'accepted', probabilities: { accepted: 0.9 } },
    web3_user_event_fit: { choice: 'fit', probabilities: { fit: 0.5, strong_fit: 0.2 } },
    event_subject_entity: { choice: 'product_entity', probabilities: { product_entity: 0.9 } },
    name_event_relevance: { choice: 'exact_match', probabilities: { exact_match: 0.9, none: 0.01 } },
    name_entity_carrier: { choice: 'existing_entity', probabilities: { existing_entity: 0.9 } },
    web3_user_name_acceptability: { choice: 'web3_user_acceptable', probabilities: { web3_user_acceptable: 0.9 } },
    token_name_quality: { score: 3, probabilities: {} },
    // J1.107：题改 Choice 三桶——新答案 choice 形状；旧缓存行 score 形状走
    // legacy bandInterpolate（双形状兼容，C123 门名断代先例）
    w_bsc_user_appeal: appealChoice != null
      ? { choice: appealChoice, probabilities: { [appealChoice]: 0.9 } }
      : { score: appeal, probabilities: { '0': 0.1, '1': 0.1, '2': 0.6, '3': 0.2 } },
  };
  // J1.84：旧答案的 w_product_score 键仍可能存在（历史行/重放）——mapper 必须忽略
  if (product != null) {
    a.w_product_score = { score: product, probabilities: { '0': 0.1, '1': 0.1, '2': 0.6, '3': 0.2 } };
  }
  return a;
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

  console.log('\n── A. W 单轴数学（吸引力 + 时效）──');

  // 吸引力 2.5 → 38+0.5×18=47；时效 within_7d → 25；总 72 ≥57 → pass
  const mHigh = mapStandardAnswers(wAnswers(), makeContext());
  const s2High = stage2Of(mHigh);
  check('A1 高吸引力票：47 → pass（pass线32，时效不再给正分）',
    s2High.pass === true && s2High.scoringResult?.eventCompositeScore === 47,
    { pass: s2High.pass, scoring: s2High.scoringResult });
  check('A2 scoringResult：吸引力 47 / timingScore=null / wProductScore 退役',
    s2High.scoringResult?.wAppealScore === 47
    && s2High.scoringResult?.timingScore === null
    && s2High.scoringResult?.wProductScore === undefined,
    s2High.scoringResult);
  check('A3 reason 文案=「W类 BSC用户吸引力47=47（pass线32）」',
    /W类 BSC用户吸引力47=47（pass线32）/.test(s2High.reason || ''),
    s2High.reason);

  // 低吸引力：0.1 → 0+0.1×18=1.8；1.8+25=26.8 <57 → 拦
  const mLow = mapStandardAnswers(wAnswers({ appeal: 0.1 }), makeContext());
  const s2Low = stage2Of(mLow);
  check('A4 低吸引力票：1.8<32 → 拦（reason=W类总分不足）',
    s2Low.pass === false && s2Low.scoringResult?.eventCompositeScore === 1.8
    && s2Low.blockReason === 'W类总分不足（1.8<32）',
    { pass: s2Low.pass, score: s2Low.scoringResult?.eventCompositeScore, blockReason: s2Low.blockReason });

  // 时效 cap：within_30d 不封顶（仅 older/unknown/override 封顶 30）
  const m30 = mapStandardAnswers(wAnswers({ timing: 'within_30d' }), makeContext());
  const s230 = stage2Of(m30);
  check('A5 within_30d 不封顶：47 → pass（仅 older/unknown/override cap）',
    s230.pass === true && s230.scoringResult?.eventCompositeScore === 47,
    { pass: s230.pass, score: s230.scoringResult?.eventCompositeScore });
  const mStale = mapStandardAnswers(wAnswers({ timing: 'older' }), makeContext());
  const s2Stale = stage2Of(mStale);
  check('A5b older 封顶 30：30<32 → 拦 + timingPenalty=30',
    s2Stale.pass === false && s2Stale.scoringResult?.eventCompositeScore === 30
    && s2Stale.scoringResult?.timingPenalty === 30,
    { pass: s2Stale.pass, score: s2Stale.scoringResult?.eventCompositeScore, penalty: s2Stale.scoringResult?.timingPenalty });

  // product 答案在场但零消费：同一 appeal，product 0.01 / 3.0 结果逐位相同
  const mP0 = mapStandardAnswers(wAnswers({ product: 0.01 }), makeContext());
  const mP3 = mapStandardAnswers(wAnswers({ product: 3.0 }), makeContext());
  check('A6 w_product_score 残留答案零消费（product 0.01 vs 3.0 同分 47，无 wProductScore）',
    stage2Of(mP0).scoringResult?.eventCompositeScore === 47
    && stage2Of(mP3).scoringResult?.eventCompositeScore === 47
    && stage2Of(mP0).scoringResult?.wProductScore === undefined
    && stage2Of(mP3).scoringResult?.wProductScore === undefined,
    { p0: stage2Of(mP0).scoringResult, p3: stage2Of(mP3).scoringResult });

  console.log('\n── B. product 不能救低 appeal（旧 C42 形状）──');

  // 旧 C42 形状：高产品 + 低吸引力。合并后产品轴不存在 → 26.8 拦，不再归一化。
  const mOldC42 = mapStandardAnswers(wAnswers({ appeal: 0.1, product: 3.0 }), makeContext());
  const s2OldC42 = stage2Of(mOldC42);
  check('B1 高 product + 低 appeal → 1.8 拦（单轴；wInteractionExempt/wProductScore 均无）',
    s2OldC42.pass === false && s2OldC42.scoringResult?.eventCompositeScore === 1.8
    && s2OldC42.jev?.wInteractionExempt === undefined
    && s2OldC42.scoringResult?.wProductScore === undefined,
    { pass: s2OldC42.pass, score: s2OldC42.scoringResult?.eventCompositeScore, exempt: s2OldC42.jev?.wInteractionExempt });

  console.log('\n── C. 题集形状 ──');

  const qs = buildStandardQuestions();
  check('C1 w_bsc_user_appeal Choice 三桶（J1.107 弱/中/强——用户裁定「给弱中强三档」）',
    qs.w_bsc_user_appeal?.type === 'choice'
    && Object.keys(qs.w_bsc_user_appeal.criteria).length === 3
    && 'weak' in qs.w_bsc_user_appeal.criteria
    && 'moderate' in qs.w_bsc_user_appeal.criteria
    && 'strong' in qs.w_bsc_user_appeal.criteria
    && qs.w_bsc_user_appeal.instructions.includes('弱/中/强三档'),
    qs.w_bsc_user_appeal?.criteria);
  check('C2 w_product_score 已退役（J1.84/C142 双轴合并）', !('w_product_score' in qs));
  check('C3 w_binance_interaction 已退役（J1.74/C134）', !('w_binance_interaction' in qs));
  check('C4 题面保留「不评币安官方交互/刚发布不可能有、不扣分」锚句',
    qs.w_bsc_user_appeal.instructions.includes('不评与币安官方的交互')
    && qs.w_bsc_user_appeal.instructions.includes('刚发布的 BSC 项目本来就不可能有币安交互')
    && qs.w_bsc_user_appeal.instructions.includes('不是项目的吸引力证据，也不因此扣分'));
  check('C5 基础题数 10（J1.102/C171 删 web3_user_entity_visuality/event_influence；J1.84 删 w_product_score；J1.83 删 event_subject_entity）', Object.keys(qs).length === 10 && !('web3_user_entity_visuality' in qs) && !('event_influence' in qs), Object.keys(qs).length);

  console.log('\n── D. 源码口径反证（防回潮）──');

  const mapperSrc = fs.readFileSync('src/narrative/analyzer/llm/jev-result-mapper.mjs', 'utf8');
  const qsSrc = fs.readFileSync('src/narrative/analyzer/llm/jev-questions.mjs', 'utf8');
  check('D1 mapper 无 product 轴残留（answers.w_product_score / W_PRODUCT_BANDS / wProductScore:）',
    !mapperSrc.includes('answers.w_product_score')
    && !mapperSrc.includes('W_PRODUCT_BANDS')
    && !mapperSrc.includes('wProductScore:'));
  check('D2 W 数学=wAppeal 单轴，pass 线 32，无 TIMING_SCORES_W/wProduct 求和',
    /eventCompositeScore = round2\(wAppeal\)/.test(mapperSrc)
    && /eventScoreBlocked = eventCompositeScore < 32;/.test(mapperSrc)
    && !/TIMING_SCORES_W/.test(mapperSrc)
    && !/round2\(wProduct \+ wAppeal \+ timingScore\)/.test(mapperSrc));
  check('D3 scoringResult 落 wAppealScore；题集源码无 product 题定义',
    /wAppealScore: isW \? wAppeal : null/.test(mapperSrc)
    && !/w_product_score: \{/.test(qsSrc)
    && /w_bsc_user_appeal: \{/.test(qsSrc));
  check('D4 答案概率审计键=w_bsc_user_appeal（w_product_score 已删）',
    /w_bsc_user_appeal: answers\.w_bsc_user_appeal\?\.probabilities/.test(mapperSrc)
    && !/w_product_score: answers\.w_product_score/.test(mapperSrc));
  check('D5 吸引力带 0-75 四分带 [[0,18],[19,37],[38,56],[57,75]]（legacy band，旧缓存行 score 形状消费）',
    /const W_APPEAL_BANDS = \[\[0, 18\], \[19, 37\], \[38, 56\], \[57, 75\]\];/.test(mapperSrc));

  console.log('\n── F. J1.107 Choice 三档映射 ──');

  const mFStrong = mapStandardAnswers(wAnswers({ appealChoice: 'strong' }), makeContext());
  const s2FStrong = stage2Of(mFStrong);
  check('F1 strong=66 → pass（强=旧 57-75 带中点）',
    s2FStrong.pass === true && s2FStrong.scoringResult?.eventCompositeScore === 66
    && s2FStrong.scoringResult?.wAppealScore === 66,
    { pass: s2FStrong.pass, score: s2FStrong.scoringResult?.eventCompositeScore });
  const mFMod = mapStandardAnswers(wAnswers({ appealChoice: 'moderate' }), makeContext());
  const s2FMod = stage2Of(mFMod);
  check('F2 moderate=47 → pass（中=旧 38-56 带中点，与 legacy 2.5 等值）',
    s2FMod.pass === true && s2FMod.scoringResult?.eventCompositeScore === 47,
    { pass: s2FMod.pass, score: s2FMod.scoringResult?.eventCompositeScore });
  const mFWeak = mapStandardAnswers(wAnswers({ appealChoice: 'weak' }), makeContext());
  const s2FWeak = stage2Of(mFWeak);
  check('F3 weak=15<32 → 拦（弱合并旧 0-18/19-37 两档保守代表，无时效救不回）',
    s2FWeak.pass === false && s2FWeak.scoringResult?.eventCompositeScore === 15
    && s2FWeak.blockReason === 'W类总分不足（15<32）',
    { pass: s2FWeak.pass, score: s2FWeak.scoringResult?.eventCompositeScore, blockReason: s2FWeak.blockReason });
  const mFDual = mapStandardAnswers(wAnswers({ appeal: 0.1, appealChoice: 'strong' }), makeContext());
  check('F4 双形状：choice 在场优先于残留 score（0.1+strong → 66 非 1.8）',
    stage2Of(mFDual).scoringResult?.eventCompositeScore === 66,
    stage2Of(mFDual).scoringResult?.eventCompositeScore);
  const mFLegacy = mapStandardAnswers(wAnswers({ appeal: 2.5 }), makeContext());
  check('F5 legacy score 2.5 → 47 与 moderate 同值（档位语义对齐锚）',
    stage2Of(mFLegacy).scoringResult?.eventCompositeScore === 47
    && stage2Of(mFLegacy).scoringResult?.eventCompositeScore === s2FMod.scoringResult?.eventCompositeScore,
    { legacy: stage2Of(mFLegacy).scoringResult?.eventCompositeScore, choice: s2FMod.scoringResult?.eventCompositeScore });
  check('F6 分值表源码 W_APPEAL_CHOICE_SCORES={weak:15,moderate:47,strong:66}',
    /const W_APPEAL_CHOICE_SCORES = \{ weak: 15, moderate: 47, strong: 66 \};/.test(mapperSrc));
  check('F7 双形状消费源码（choice 先、bandInterpolate 兜底）',
    /answers\.w_bsc_user_appeal\?\.choice != null/.test(mapperSrc)
    && /bandInterpolate\(answers\.w_bsc_user_appeal\?\.score \?\? 0, W_APPEAL_BANDS\)/.test(mapperSrc));

  console.log('\n── E. 版本 ──');
  check('E1 JEV_QUESTIONS_VERSION ≥ J1.107（J1.107=W 三档 Choice weak/moderate/strong；J1.102=C171 形象载体轴整轴退役；J1.91=C154 时效体系清理；J1.84=C142 W 双轴合并）',
    parseInt(JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 107, JEV_QUESTIONS_VERSION);

  console.log(`\n══════ ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('SUITE ERROR', e); process.exit(1); });
