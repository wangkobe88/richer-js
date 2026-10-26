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
 *   C. 题集形状：bsc_meme_user_web3_project_acceptance_and_impact 0-75 在场 / w_product_score 退役 / 10 题
 *   D. 源码口径反证：无 wProduct/W_PRODUCT_BANDS/wProductScore/w_product_score 消费
 *   E. 版本 J1.125（J1.125=C230 AIFLY 案键名断代+资格轴；J1.107=W 三档 Choice；
 *     J1.84=C142 本轴合并）
 *   F. J1.107 Choice 三档映射=旧缓存行（J1.107-J1.128）重放锚：weak 15/moderate 47/
 *     strong 66 双形状消费、legacy 等值锚；J1.129/C233 桶 id 断代 low/mid/high 后
 *     分值表双键同分=旧行重放零翻转
 *   G. J1.125（C230 AIFLY 案 0x0baecc80…7777）键名断代：新键归一读（choice/score
 *     双形状）、双键共存新键优先、资格轴题面锚（dev 无名+无 CA 背书 → low）；
 *     J1.129/C233 新桶名 low/mid/high（与评级词汇统一）
 *
 * 用法：node scripts/_test_w_bsc_user_appeal.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

function wAnswers({ appeal = 2.5, timing = 'within_7d', product = null, appealChoice = null, newKey = false } = {}) {
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
  };
  // J1.107：题改 Choice 三桶——新答案 choice 形状；旧缓存行 score 形状走
  // legacy bandInterpolate（双形状兼容，C123 门名断代先例）。
  // J1.125/C230：题键断代 w_bsc_user_appeal → bsc_meme_user_web3_project_acceptance_and_impact，
  // mapper q() 归一读（新键 miss 回落旧键）——本 helper 以 newKey 开关切换键名，
  // 同一形状双键各自喂入验证断代读两臂
  const appealShape = appealChoice != null
    ? { choice: appealChoice, probabilities: { [appealChoice]: 0.9 } }
    : { score: appeal, probabilities: { '0': 0.1, '1': 0.1, '2': 0.6, '3': 0.2 } };
  a[newKey ? 'bsc_meme_user_web3_project_acceptance_and_impact' : 'w_bsc_user_appeal'] = appealShape;
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
  check('A3 reason 文案=「W类 BSC用户接纳度与影响力47=47（pass线32）」（J1.125 键名断代随改文案）',
    /W类 BSC用户接纳度与影响力47=47（pass线32）/.test(s2High.reason || ''),
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
  check('C1 bsc_meme_user_web3_project_acceptance_and_impact Choice 三桶（J1.129/C233 桶 id 断代 low/mid/high——用户裁定「W 臂也用 low/mid/high」与评级词汇统一；J1.107 原立弱/中/强；J1.125/C230 键名断代自 w_bsc_user_appeal）',
    qs.bsc_meme_user_web3_project_acceptance_and_impact?.type === 'choice'
    && Object.keys(qs.bsc_meme_user_web3_project_acceptance_and_impact.criteria).length === 3
    && 'low' in qs.bsc_meme_user_web3_project_acceptance_and_impact.criteria
    && 'mid' in qs.bsc_meme_user_web3_project_acceptance_and_impact.criteria
    && 'high' in qs.bsc_meme_user_web3_project_acceptance_and_impact.criteria
    && !('weak' in qs.bsc_meme_user_web3_project_acceptance_and_impact.criteria)
    && qs.bsc_meme_user_web3_project_acceptance_and_impact.instructions.includes('低/中/高三档'),
    qs.bsc_meme_user_web3_project_acceptance_and_impact?.criteria);
  check('C1b 旧键 w_bsc_user_appeal 题集不再提供（J1.125/C230 断代；mapper 归一读兜旧缓存行）',
    !('w_bsc_user_appeal' in qs));
  check('C2 w_product_score 已退役（J1.84/C142 双轴合并）', !('w_product_score' in qs));
  check('C3 w_binance_interaction 已退役（J1.74/C134）', !('w_binance_interaction' in qs));
  check('C4 题面保留「不评币安官方交互/刚发布不可能有、不扣分」锚句',
    qs.bsc_meme_user_web3_project_acceptance_and_impact.instructions.includes('不评与币安官方的交互')
    && qs.bsc_meme_user_web3_project_acceptance_and_impact.instructions.includes('刚发布的 BSC 项目本来就不可能有币安交互')
    && qs.bsc_meme_user_web3_project_acceptance_and_impact.instructions.includes('不是项目的吸引力证据，也不因此扣分'));
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
  check('D3 scoringResult 落 wAppealScore；题集源码无 product 题定义、新键题在（J1.125 断代）',
    /wAppealScore: isW \? wAppeal : null/.test(mapperSrc)
    && !/w_product_score: \{/.test(qsSrc)
    && /bsc_meme_user_web3_project_acceptance_and_impact: \{/.test(qsSrc));
  check('D4 答案概率审计键投影 w_bsc_user_appeal（键名保留=审计形状不变，值归一读新键；w_product_score 已删）',
    /w_bsc_user_appeal: q\(answers, 'bsc_meme_user_web3_project_acceptance_and_impact', 'w_bsc_user_appeal'\)\?\.probabilities/.test(mapperSrc)
    && !/w_product_score: answers\.w_product_score/.test(mapperSrc));
  check('D5 吸引力带 0-75 四分带 [[0,18],[19,37],[38,56],[57,75]]（legacy band，旧缓存行 score 形状消费）',
    /const W_APPEAL_BANDS = \[\[0, 18\], \[19, 37\], \[38, 56\], \[57, 75\]\];/.test(mapperSrc));

  console.log('\n── F. J1.107 旧桶名 choice 重放（J1.107-J1.128 旧缓存行；J1.129/C233 分值表双键同分=零翻转）──');

  const mFStrong = mapStandardAnswers(wAnswers({ appealChoice: 'strong' }), makeContext());
  const s2FStrong = stage2Of(mFStrong);
  check('F1 旧桶 strong=66 → pass（旧行重放；强=旧 57-75 带中点）',
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
  check('F3 旧桶 weak=15<32 → 拦（旧行重放；弱合并旧 0-18/19-37 两档保守代表，无时效救不回）',
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
  check('F6 分值表源码 W_APPEAL_CHOICE_SCORES 双键同分（J1.129/C233：新桶 low/mid/high + 旧桶 weak/moderate/strong 各 15/47/66——旧行重放零分支归一读）',
    /const W_APPEAL_CHOICE_SCORES = \{ low: 15, mid: 47, high: 66, weak: 15, moderate: 47, strong: 66 \};/.test(mapperSrc));
  check('F7 双形状消费源码（断代读：q(answers, 新键, 旧键) 单点；choice 先、bandInterpolate 兜底）',
    /const appealAnswer = q\(answers, 'bsc_meme_user_web3_project_acceptance_and_impact', 'w_bsc_user_appeal'\);/.test(mapperSrc)
    && /appealAnswer\?\.choice != null/.test(mapperSrc)
    && /bandInterpolate\(appealAnswer\?\.score \?\? 0, W_APPEAL_BANDS\)/.test(mapperSrc)
    && !/answers\.w_bsc_user_appeal\?\.choice/.test(mapperSrc));

  console.log('\n── G. J1.125/C230 键名断代归一读 + 资格轴 ──');

  // 新键 choice 形状（J1.129 断代后线上新答案=新桶名）：high 66 / low 15 与旧桶等值
  const mGStrong = mapStandardAnswers(wAnswers({ appealChoice: 'high', newKey: true }), makeContext());
  check('G1 新键 bsc_meme_user_web3_project_acceptance_and_impact choice high → 66（断代读新键臂；J1.129 新桶名与旧桶 strong 同分）',
    stage2Of(mGStrong).scoringResult?.eventCompositeScore === 66
    && stage2Of(mGStrong).pass === true,
    stage2Of(mGStrong).scoringResult);
  const mGWeak = mapStandardAnswers(wAnswers({ appealChoice: 'low', newKey: true }), makeContext());
  const s2GWeak = stage2Of(mGWeak);
  check('G2 新键 choice low → 15<32 拦（AIFLY 案现场锚：dev 无名+无 CA 背书=资格轴不合格直接 low，无时效可救；J1.129 桶名断代随 C232 资格轴语义）',
    s2GWeak.pass === false && s2GWeak.scoringResult?.eventCompositeScore === 15
    && s2GWeak.blockReason === 'W类总分不足（15<32）',
    { pass: s2GWeak.pass, score: s2GWeak.scoringResult?.eventCompositeScore, blockReason: s2GWeak.blockReason });
  // 新键 score 形状（legacy band 路径也走归一读）：2.5 → 47
  const mGScore = mapStandardAnswers(wAnswers({ appeal: 2.5, newKey: true }), makeContext());
  check('G3 新键 score 2.5 → 47（断代读两形状双臂：choice/score 均经 q() 归一）',
    stage2Of(mGScore).scoringResult?.eventCompositeScore === 47,
    stage2Of(mGScore).scoringResult);
  // 双键共存（断代过渡期：新键在场优先，旧键残留不覆盖）
  const aDual = wAnswers({ appealChoice: 'low', newKey: true });
  aDual.w_bsc_user_appeal = { score: 3.0, probabilities: {} };
  const mGDual = mapStandardAnswers(aDual, makeContext());
  check('G4 双键共存新键优先（新键 low + 旧键残留 score 3.0 → 15 非 47）',
    stage2Of(mGDual).scoringResult?.eventCompositeScore === 15,
    stage2Of(mGDual).scoringResult);
  // 审计投影：新键 probabilities 经旧投影键落档
  check('G5 审计投影键名保留 w_bsc_user_appeal（值=新键 probabilities；跨版本前端/审计形状不变）',
    mGStrong.stage2DataToSave?.parsed_output?.jev?.probabilities?.w_bsc_user_appeal?.high === 0.9,
    mGStrong.stage2DataToSave?.parsed_output?.jev?.probabilities?.w_bsc_user_appeal);

  // 资格轴题面锚（源码口径反证，防回潮）
  const appealInstructions = qs.bsc_meme_user_web3_project_acceptance_and_impact.instructions;
  check('G6 资格轴两形态判据（J1.130/C234+J1.133/C236 门槛降档）：机制前提=本题票全无 CA 背书；形态一=BSC 链特色项目（可社区发币）Dev 有一定发帖粉丝+身份自证即可（新项目传播/讨论只是预期不得作资格判据）；形态二=Web2/Web3 涌现项目项目主体（创建者）须较为知名、找角度账号不卡；直接 low=Dev 零发帖零粉匿名∨主体不知名',
    appealInstructions.includes('没有提供代币合约地址（CA）背书')
    && appealInstructions.includes('走更靠前的账号判断逻辑')
    && appealInstructions.includes('本题不假设任何票有地址背书')
    && appealInstructions.includes('形态一：极有特色的 BSC 链项目')
    && appealInstructions.includes('BSC 社区自己发的（不是 Dev 发的）')
    && appealInstructions.includes('项目 Dev（项目的构建者）有一定的发帖数、粉丝量')
    && appealInstructions.includes('介绍中说明了自己的身份——不是完全匿名无名即可')
    && appealInstructions.includes('不得以「零传播/无第三方讨论」为由判资格不合格')
    && appealInstructions.includes('找角度推文/发币账号无影响力没关系')
    && appealInstructions.includes('人生K线——BSC 社区自己发的、已成 BSC 蓝筹')
    && appealInstructions.includes('形态二：Web2/Web3 领域里特别有影响力/有趣味/有梗的项目涌现')
    && appealInstructions.includes('项目主体（项目的创建者，不是找角度账号）')
    && appealInstructions.includes('需要是较为知名的组织或人（高影响力门槛只在形态二）')
    && appealInstructions.includes('不因陈述者无名判 low')
    && appealInstructions.includes('形态一**项目 Dev 完全无名**')
    && appealInstructions.includes('零发帖零粉的匿名账号、介绍中无任何身份说明')
    && appealInstructions.includes('形态二**项目主体不知名**')
    && !appealInstructions.includes('股城')
    && !appealInstructions.includes('不能完全是无名之辈，至少是一个看起来不错的 Dev')
    && !appealInstructions.includes('dev 视角臂（资格轴唯一看发布者的形状）')
    && !appealInstructions.includes('正经项目方行为，资格过线'),
    appealInstructions.slice(0, 200));
  check('G6b C234 例证锚在场（NMS 纳斯达克案=形态二原型、326 粉陈述者不卡；人生K线=形态一蓝筹实证）+ 股城例证已撤（C236：争议票不作例证锚）+ 陈述账号豁免随 criteria 落档',
    appealInstructions.includes('纳斯达克官网放出示例 tokenized stock')
    && appealInstructions.includes('326 粉小号发现报道——NMS 案')
    && !appealInstructions.includes('股城')
    && qs.bsc_meme_user_web3_project_acceptance_and_impact.criteria.low.includes('找角度/陈述账号无名不是资格缺陷'),
    null);
  check('G7 low criteria 含「资格不合格」（C234 两形态+C236 形态一降档：Dev 零发帖零粉匿名/主体须高影响力；mid/high 含「资格过线」）',
    qs.bsc_meme_user_web3_project_acceptance_and_impact.criteria.low.includes('资格不合格')
    && qs.bsc_meme_user_web3_project_acceptance_and_impact.criteria.low.includes('形态一项目 Dev 完全无名')
    && qs.bsc_meme_user_web3_project_acceptance_and_impact.criteria.low.includes('新项目不要求传播/讨论已落地')
    && qs.bsc_meme_user_web3_project_acceptance_and_impact.criteria.low.includes('须高影响力的知名组织或人')
    && qs.bsc_meme_user_web3_project_acceptance_and_impact.criteria.low.includes('形态二项目主体不知名')
    && qs.bsc_meme_user_web3_project_acceptance_and_impact.criteria.mid.includes('资格过线')
    && qs.bsc_meme_user_web3_project_acceptance_and_impact.criteria.high.includes('资格过线'),
    qs.bsc_meme_user_web3_project_acceptance_and_impact.criteria);
  // state-builder 主体归属修正（AIFLY 案第二漏点：angle_seeking 标签不得改判事件主体）
  const sbSrc = fs.readFileSync('src/narrative/analyzer/llm/jev-state-builder.mjs', 'utf8');
  check('G8 state-builder tweet_type_note2：tweet_type 仅时效分桶不判主体；项目陈述推主体=项目本身走 W 类',
    sbSrc.includes('tweet_type_note2')
    && /推文陈述\/宣告一个 Web3 项目时/.test(sbSrc)
    && /事件主体=项目本身/.test(sbSrc),
    null);
  // event_category 题面主体归属修正（AIFLY 案第一漏点：项目陈述推主体=项目）
  const catInstr = qs.event_category.instructions;
  check('G9 event_category 主体归属锚：项目陈述推主体=项目本身→W；低粉作者宣告自己项目≠找角度；C 不吃项目宣告',
    catInstr.includes('主体=该项目本身')
    && catInstr.includes('低粉丝/低互动的作者宣告自己的项目不是找角度')
    && qs.event_category.criteria.C.includes('宣告/陈述 crypto 项目本身归 W 不归本类')
    && qs.event_category.criteria.W.includes('个人/小团队自发项目与第三方陈述的项目同样归本类'),
    null);

  console.log('\n── E. 版本 ──');
  check('E1 JEV_QUESTIONS_VERSION ≥ J1.130（J1.130=C234 W 资格轴两形态判据（形态一 BSC 链项目发布者须像样/形态二项目主体须知名）+无 CA 机制前提全局化；J1.129=C233 W 臂桶 id 断代 low/mid/high 与评级词汇统一；J1.128=C232 资格轴适用域修正：第三方视角不看陈述者影响力按主体评；J1.127=C231 impact 题加 event_trivial 桶；J1.126=C230 追裁键名再调整加 web3_project 域限定+资格轴第一锚改写 dev 视角按无地址处理；J1.125=C230 AIFLY 案键名断代+资格轴+分类题中文重写；J1.107=W 三档 Choice；J1.84=C142 W 双轴合并）',
    parseInt(JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 130, JEV_QUESTIONS_VERSION);

  console.log(`\n══════ ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('SUITE ERROR', e); process.exit(1); });
