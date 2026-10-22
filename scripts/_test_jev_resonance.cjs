#!/usr/bin/env node
/**
 * J1.36 E 类Web3偏好折损判据源迁移（web3_user_event_fit 替代 event_resonance）——本地零 DB 单测
 * （2026-10-18 用户裁定 B 案，C93：原话「meme 币发币哪里有什么圈内圈外一说，
 * web3 用户喜欢就行了。event_resonance 是不是可以被替换为 web3_user_event_fit？」；
 * C80 蝙蝠侠摇案 0x4547dae7757fb4043e034d27ed02dfabe9aa7777 折损机制保留）
 *
 * 覆盖：
 *   A. 双案反证：①蝙蝠侠摇（J1.30 历史行重放新逻辑）真实 web3_user_event_fit
 *      strong 0.38+fit 0.38=0.76 ≥0.5 不折 → 60→69.27 high 放行（用户明示
 *      接受：当年 -12.4% 归盘面非叙事错判）；②유과 강아지形状 strong_fit 0.97
 *      同数学不折（本案 mild×0.5=35.64 误拦的修复）；③marginal 占优
 *      fitMass<0.5 → ×0.5：(27+28.68)×0.5+15=30 拦（C80 数字沿用）
 *   B. 边界：web3_user_event_fit 答案整体缺失（J1.19 前旧缓存行）fail-open 不折 /
 *      fitMass 恰 0.5 边界不折（<0.5 严格）
 *   C. 作用域：A 类 marginal 不折（裁定域=E 类）/ W 类走 W 数学不触达 /
 *      E 类 D 档量级票折损前后同为拦（归因=量级门）
 *   D. 审计与源码口径：web3FitDampMass 恒落数值 / web3FitDamp {fitMass,coef}
 *      命中才落 / eventResonance 档位字段随题删除退役 / probabilities 无
 *      event_resonance 键 / 题集 17 题无 event_resonance（源码锁）
 *
 * 用法：node scripts/_test_jev_resonance.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

// ── C80 蝙蝠侠摇 J1.30 实测 answers 快照（DB token_narrative 2026-10-16T12:29:53Z）──
// event_category E 0.99 / magnitude 档3(B) 0.97 / dim2 5.34→28.68 / within_7d /
// none 0.57 / exact_match 0.82 → 关联 20 / quality 4字length6+拼2.8→4.8+合1.47→2.47=13.27
// web3_user_event_fit strong 0.38 + fit 0.38 = 0.76（J1.36 判据源——历史行重放新逻辑的实证形状）
// （DB breakdown 落的是 bandInterpolate 换算后值；原始分反解：SPELLING/REASONABILITY
//  BANDS 按 floor(score) 取带，2.8→[4,5]带 4.8、1.47→[2,3]带 2.47）
const bianfuTokenData = { symbol: '蝙蝠侠摇', name: '蝙蝠侠式蹦迪', raw_api_data: { name: '蝙蝠侠式蹦迪' } };

const BIANFU_WEB3FIT = { strong_fit: 0.38, fit: 0.38, marginal: 0.16, unfit: 0.08 };

function bianfuAnswers({ web3fit = BIANFU_WEB3FIT, category = 'E', tierScore = 3, tierProbs = { '3': 0.97 } } = {}) {
  const a = {
    event_category: { choice: category, probabilities: { [category]: 0.99 } },
    event_magnitude: { score: tierScore, probabilities: tierProbs },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.95 } },
    dimension2: { score: 5.34, probabilities: { '5': 0.6, '4': 0.3 } },
    event_quality_veto: { choice: 'none', probabilities: { none: 0.57, event_marketing_gimmick: 0.19 } },
    web3_user_name_entity_acceptance: { choice: 'accepted', probabilities: { accepted: 0.43, no_entity: 0.38 } },
    web3_user_event_fit: { choice: 'strong_fit', probabilities: web3fit },
    event_subject_entity: { choice: 'meme_word', probabilities: { meme_word: 0.67, character_ip: 0.14 } },
    name_entity_carrier: { choice: 'existing_entity', probabilities: { existing_entity: 0.5 } },
    name_entity_memeability: { score: 3.5, probabilities: { '3': 0.5 } },
    name_event_relevance: { choice: 'exact_match', probabilities: { exact_match: 0.82 } },
    relevance_level: { score: 3.2, probabilities: { '4': 0.71, '3': 0.15 } },
    block_misspelling: { noul: 0.14 },
    quality_spelling: { score: 2.8 },
    quality_reasonability: { score: 1.47 },
  };
  return a;
}

function makeContext(tokenData) {
  return {
    tokenData,
    includeBrandHijack: false,
    tweetClassification: null,
    twitterInfo: null,
    callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  };
}

function run(answers, tokenData = bianfuTokenData) {
  // 动态 import 缓存：mapStandardAnswers 是纯函数，重复调用安全
  return import('../src/narrative/analyzer/llm/jev-result-mapper.mjs').then(m => m.mapStandardAnswers(answers, makeContext(tokenData)));
}

// J1.83/C141 折损臂收窄为豁免路径：非豁免低 fitMass 票被契合证据门先拦
//（门域 [0,0.5) ⊃ 折损域），折损数学对豁免票照常工作——币安语料 ctx 保路径可达
const bianfuBinanceTokenData = { symbol: '币安蝙蝠侠摇', name: '币安蝙蝠侠摇', raw_api_data: { name: '币安蝙蝠侠摇' } };

async function main() {
  console.log('\n── A. 双案反证（J1.36 判据源=web3_user_event_fit）──');

  // A1 蝙蝠侠摇重放：真实 web3_user_event_fit 0.76 ≥0.5 不折 → J1.79 事件分=76 → 78.87 high（放行裁定）
  const m1 = await run(bianfuAnswers());
  const s1 = m1?.stage2DataToSave?.parsed_output || {};
  const f1 = m1?.stageFinalData || {};
  check('A1 蝙蝠侠摇 0.76 不折：J1.79 fit 事件分 76 → 总分 78.87 high（放行裁定，J1.30 历史行重放新逻辑）',
    s1.scoringResult?.eventCompositeScore === 76 && f1.totalScore === 78.87 && f1.category === 'high',
    { s2: s1.scoringResult?.eventCompositeScore, fin: f1.totalScore, cat: f1.category });

  // A2 유과 강아지形状：strong_fit 0.97 → 不折（本案 J1.31 mild×0.5=35.64 误拦的修复）
  const m2 = await run(bianfuAnswers({ web3fit: { strong_fit: 0.97, fit: 0.02, marginal: 0.01, unfit: 0 } }));
  const s2 = m2?.stage2DataToSave?.parsed_output || {};
  const f2 = m2?.stageFinalData || {};
  check('A2 유과形状 0.99 不折：J1.79 fit 事件分 99 → 92.67 high（同款数学不再被Web3偏好折损误拦）',
    s2.scoringResult?.eventCompositeScore === 99 && f2.totalScore === 92.67 && f2.category === 'high',
    { t: s2.scoringResult?.eventCompositeScore, fin: f2.totalScore });

  // A3 marginal 占优：fitMass=0.3 <0.5 → ×0.5：J1.79 fit 事件分 30×0.5=15 <60 事件分不足拦
  // J1.83/C141：币安语料豁契合证据门（非豁免低 fit 票先被门拦）——折损数学对豁免票照常
  const m3 = await run(bianfuAnswers({ web3fit: { strong_fit: 0.15, fit: 0.15, marginal: 0.6, unfit: 0.1 } }), bianfuBinanceTokenData);
  const s3 = m3?.stage2DataToSave?.parsed_output || {};
  const r3 = m3?.llmResult || {};
  check('A3 marginal 0.3 → ×0.5：J1.79 fit 事件分 30×0.5=15 拦（C80 折损数学沿用；J1.83 起折损臂=豁免路径，币安语料保路径）',
    s3.scoringResult?.eventCompositeScore === 15 && s3.pass === false && /事件分不足（15<60）/.test(s3.blockReason || '') && r3.rating === 'low',
    { t: s3.scoringResult?.eventCompositeScore, r: s3.blockReason, rating: r3.rating });

  console.log('\n── B. 边界 ──');

  // B1 web3_user_event_fit 答案整体缺失（J1.19 前旧缓存行）→ 无数可折（审计 null）；
  // J1.79 事件分=fit 质量 → 缺失=fitMass 0，J1.83 起被契合证据门拦（原 E 档量级门
  // 同轴遮蔽——门域 [0,0.5) 覆盖缺失态，fail-closed 无静默放行不变）
  const noFit = bianfuAnswers();
  delete noFit.web3_user_event_fit;
  const m4 = await run(noFit);
  const s4 = m4?.stage2DataToSave?.parsed_output || {};
  const j4 = m4?.stage2DataToSave?.parsed_output?.jev || {};
  check('B1 fit 缺失：折损审计 null（无数不折）且缺失态被契合证据门拦（fail-closed，无静默放行）',
    s4.pass === false && /Web3用户契合证据不足/.test(s4.blockReason || '')
      && j4.web3FitDampMass === null && j4.web3FitDamp === null,
    { t: s4.scoringResult?.eventCompositeScore, m: j4.web3FitDampMass, blk: s4.blockReason });

  // B2 fitMass 恰 0.5 边界：不折（<0.5 严格——与 J1.19/J1.23/J1.27 的 ≥0.5 线同侧）
  // J1.79 事件分=min(1, fitMass)×100 → 恰 0.5 = 50（旧口径 60×0.5 的 60 基线已随题删除）
  const m5 = await run(bianfuAnswers({ web3fit: { strong_fit: 0.25, fit: 0.25, marginal: 0.4, unfit: 0.1 } }));
  const s5 = m5?.stage2DataToSave?.parsed_output || {};
  const j5 = m5?.stage2DataToSave?.parsed_output?.jev || {};
  check('B2 fitMass 恰 0.5 不折（严格 <）+ 审计恒落 0.5 + J1.79 fit 事件分 50',
    s5.scoringResult?.eventCompositeScore === 50 && j5.web3FitDampMass === 0.5 && j5.web3FitDamp === null,
    { t: s5.scoringResult?.eventCompositeScore, m: j5.web3FitDampMass });

  console.log('\n── C. 作用域 ──');

  // C1 A 类不折：裁定域=E 类。J1.83/C141 后 A 类低 fitMass 票被契合门先拦
  //（「A 类 marginal 不折」的行为面已随门收敛）——0.5 恰过线形状保「A 类与
  // 折损无交面」验证（<0.5 严格边界 + fitMass 审计照落）
  const m6 = await run(bianfuAnswers({ web3fit: { strong_fit: 0.25, fit: 0.25, marginal: 0.4, unfit: 0.1 }, category: 'A' }));
  const s6 = m6?.stage2DataToSave?.parsed_output || {};
  const j6 = m6?.stage2DataToSave?.parsed_output?.jev || {};
  check('C1 A 类不折（恰 0.5 过线：事件分 50 原样无折损段；fitMass 审计照落）',
    s6.scoringResult?.eventCompositeScore === 50 && j6.web3FitDampMass === 0.5 && j6.web3FitDamp === null,
    { t: s6.scoringResult?.eventCompositeScore, d: j6.web3FitDamp });

  // C2 W 类：W 数学分支，折损不触达（tierScore null）
  const m7 = await run(bianfuAnswers({ category: 'W' }));
  const s7 = m7?.stage2DataToSave?.parsed_output || {};
  check('C2 W 类走 W 数学不触达（tierScore=null）', s7.scoringResult?.impactTierScore == null,
    s7.scoringResult);

  // C3 E 类 D 档量级票：J1.83 前量级门拦；J1.83 后 D 档域 fitMass[0.1,0.3) ⊂ 契合门
  // 域 [0,0.5)——同轴遮蔽，归因迁移至契合证据门（折损数学不触达，结论仍拦不变）
  // J1.79：档位由 fit 派生（mass 0.2 → influenceScore 1 → D 档），旧 magnitude 题已删
  const m8 = await run(bianfuAnswers({ web3fit: { strong_fit: 0.1, fit: 0.1, marginal: 0.7, unfit: 0.1 } }));
  const s8 = m8?.stage2DataToSave?.parsed_output || {};
  check('C3 E 类 D 档（fit 派生）：契合证据门先拦（J1.83 同轴遮蔽，归因=契合证据不足非折损）',
    s8.pass === false && /Web3用户契合证据不足/.test(s8.blockReason || ''),
    s8.blockReason);

  console.log('\n── D. 审计与源码口径 ──');

  const j3 = m3?.stage2DataToSave?.parsed_output?.jev || {};
  const j1 = m1?.stage2DataToSave?.parsed_output?.jev || {};

  // D1 审计：web3FitDampMass 恒落数值（不折也落）+ web3FitDamp 命中才落 {fitMass, coef}
  check('D1 审计：蝙蝠侠摇 fitMass=0.76 damp=null / marginal 落 {fitMass:0.3, coef:0.5}',
    j1.web3FitDampMass === 0.76 && j1.web3FitDamp === null
      && j3.web3FitDampMass === 0.3 && j3.web3FitDamp?.coef === 0.5 && j3.web3FitDamp?.fitMass === 0.3,
    { j1: { m: j1.web3FitDampMass, d: j1.web3FitDamp }, j3: j3.web3FitDamp });

  // D2 reason 带「Web3偏好折损×0.5(web3_user_event_fit契合30%<50)」段（判据源可追溯）
  check('D2 reason 展示折损来源（web3_user_event_fit 契合度）', /Web3偏好折损×0.5\(web3_user_event_fit契合30%<50\)/.test(s3.reason || ''),
    { r3: s3.reason });

  // D3 不折 reason 无折损段（bit-identical 的 reason 层验证）
  check('D3 不折 reason 不带折损段', !/Web3偏好折损/.test(s1.reason || '') && !/Web3偏好折损/.test(s2.reason || ''),
    { r1: s1.reason, r2: s2.reason });

  // D4 旧档位审计退役：eventResonance 字段不再产生 / probabilities 无 event_resonance 键
  check('D4 eventResonance 档位字段退役 / probabilities 无 event_resonance 键',
    !('eventResonance' in j1) && !('event_resonance' in (j1.probabilities || {})),
    { keys: Object.keys(j1), pkeys: Object.keys(j1.probabilities || {}) });

  // D5 题集源码锁：event_resonance 题已删；J1.79 删 web3_user_event_impact（事件分改由
  // web3_user_event_fit 单一来源）+ J1.83 删 event_subject_entity → 默认 12 题 /
  // J1.84/C142 删 w_product_score → 11 题；J1.97/C161 增 event_influence → 12 题
  // 开 parent_relationship 13 题
  const qm = await import('../src/narrative/analyzer/llm/jev-questions.mjs');
  const qs = qm.buildStandardQuestions({});
  const qKeys = Object.keys(qs);
  const qsRel = qm.buildStandardQuestions({ parentRelationship: true });
  check('D5 题集 12 题无 event_resonance/block_misspelling/web3_user_event_impact/event_subject_entity/w_product_score + JEV_QUESTIONS_VERSION=J1.98（J1.90=C152 MEMES fit 锚；J1.90=C152 MEMES fit 锚；J1.89=C151 哭哭奶龙 wrong_entity 修正；J1.88=C150 删 event_institution_routine 桶；J1.87=C145 删 routine 桶；J1.86=C143 校准（题面锚点）；J1.85=C143 品牌劫持并入实体轴；J1.84=C142 W 双轴合并单轴；J1.83=C141 event_subject_entity 题退役（判据并入 event_fit unfit 桶+门一般化 web3FitMassBlock：sf+fit<0.5 全域拦）；J1.82=C140 圈层并入 fit；J1.81=C139 名字三轴重构；J1.80=C138 超IP来源判据；fit 单一事件分来源）',
    qKeys.length === 12 && qKeys.includes('event_influence') && !qKeys.includes('event_resonance') && !qKeys.includes('block_misspelling') && !qKeys.includes('w_product_score')
      && !qKeys.includes('web3_user_event_impact') && !qKeys.includes('event_magnitude') && !qKeys.includes('dimension2')
      && !qKeys.includes('event_subject_entity')
      && qm.JEV_QUESTIONS_VERSION === 'J1.98'
      && !qKeys.includes('parent_relationship') && Object.keys(qsRel).length === 13 && qsRel.parent_relationship != null,
    { n: qKeys.length, has: qKeys.includes('event_resonance'), v: qm.JEV_QUESTIONS_VERSION, nRel: Object.keys(qsRel).length });

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
