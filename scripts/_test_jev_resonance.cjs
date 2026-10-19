#!/usr/bin/env node
/**
 * J1.36 E 类感染力折损判据源迁移（web3_fit 替代 event_resonance）——本地零 DB 单测
 * （2026-10-18 用户裁定 B 案，C93：原话「meme 币发币哪里有什么圈内圈外一说，
 * web3 用户喜欢就行了。event_resonance 是不是可以被替换为 web3_fit？」；
 * C80 蝙蝠侠摇案 0x4547dae7757fb4043e034d27ed02dfabe9aa7777 折损机制保留）
 *
 * 覆盖：
 *   A. 双案反证：①蝙蝠侠摇（J1.30 历史行重放新逻辑）真实 web3_fit
 *      strong 0.38+fit 0.38=0.76 ≥0.5 不折 → 70.68→75.68 high 放行（用户明示
 *      接受：当年 -12.4% 归盘面非叙事错判）；②유과 강아지形状 strong_fit 0.97
 *      同数学不折（本案 mild×0.5=35.64 误拦的修复）；③marginal 占优
 *      fitMass<0.5 → ×0.5：(27+28.68)×0.5+15=42.84 拦（C80 数字沿用）
 *   B. 边界：web3_fit 答案整体缺失（J1.19 前旧缓存行）fail-open 不折 /
 *      fitMass 恰 0.5 边界不折（<0.5 严格）
 *   C. 作用域：A 类 marginal 不折（裁定域=E 类）/ W 类走 W 数学不触达 /
 *      E 类 D 档量级票折损前后同为拦（归因=量级门）
 *   D. 审计与源码口径：resonanceFitMass 恒落数值 / resonanceDamp {fitMass,coef}
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
// web3_fit strong 0.38 + fit 0.38 = 0.76（J1.36 判据源——历史行重放新逻辑的实证形状）
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
    block_reason: { choice: 'none', probabilities: { none: 0.57, marketing_gimmick: 0.19 } },
    name_referent: { choice: 'super_ip', probabilities: { super_ip: 0.43, common_word: 0.38 } },
    web3_fit: { choice: 'strong_fit', probabilities: web3fit },
    subject_entity: { choice: 'meme_word', probabilities: { meme_word: 0.67, character_ip: 0.14 } },
    subject_carrier: { choice: 'existing_entity', probabilities: { existing_entity: 0.5 } },
    referent_memeability: { score: 3.5, probabilities: { '3': 0.5 } },
    relevance_type: { choice: 'exact_match', probabilities: { exact_match: 0.82 } },
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

function run(answers) {
  // 动态 import 缓存：mapStandardAnswers 是纯函数，重复调用安全
  return import('../src/narrative/analyzer/llm/jev-result-mapper.mjs').then(m => m.mapStandardAnswers(answers, makeContext(bianfuTokenData)));
}

async function main() {
  console.log('\n── A. 双案反证（J1.36 判据源=web3_fit）──');

  // A1 蝙蝠侠摇重放：真实 web3_fit 0.76 ≥0.5 不折 → 70.68 → 75.68 high（放行裁定）
  const m1 = await run(bianfuAnswers());
  const s1 = m1?.stage2DataToSave?.parsed_output || {};
  const f1 = m1?.stageFinalData || {};
  check('A1 蝙蝠侠摇 0.76 不折：事件分 70.68 → 总分 75.68 high（放行裁定，J1.30 历史行重放新逻辑）',
    s1.scoringResult?.totalScore === 70.68 && f1.totalScore === 75.68 && f1.category === 'high',
    { s2: s1.scoringResult?.totalScore, fin: f1.totalScore, cat: f1.category });

  // A2 유과 강아지形状：strong_fit 0.97 → 不折（本案 J1.31 mild×0.5=35.64 误拦的修复）
  const m2 = await run(bianfuAnswers({ web3fit: { strong_fit: 0.97, fit: 0.02, marginal: 0.01, unfit: 0 } }));
  const s2 = m2?.stage2DataToSave?.parsed_output || {};
  const f2 = m2?.stageFinalData || {};
  check('A2 유과形状 0.97 不折：70.68/75.68 high（同款数学不再被感染力折损误拦）',
    s2.scoringResult?.totalScore === 70.68 && f2.totalScore === 75.68 && f2.category === 'high',
    { t: s2.scoringResult?.totalScore, fin: f2.totalScore });

  // A3 marginal 占优：fitMass=0.3 <0.5 → ×0.5：(27+28.68)×0.5+15=42.84 <60 事件分不足拦
  const m3 = await run(bianfuAnswers({ web3fit: { strong_fit: 0.15, fit: 0.15, marginal: 0.6, unfit: 0.1 } }));
  const s3 = m3?.stage2DataToSave?.parsed_output || {};
  const r3 = m3?.llmResult || {};
  check('A3 marginal 0.3 → ×0.5：事件分 42.84 拦（C80 数字沿用，「web3 用户不太喜欢」的数学化）',
    s3.scoringResult?.totalScore === 42.84 && s3.pass === false && /事件分不足（42.84<60）/.test(s3.blockReason || '') && r3.rating === 'low',
    { t: s3.scoringResult?.totalScore, r: s3.blockReason, rating: r3.rating });

  console.log('\n── B. 边界 ──');

  // B1 web3_fit 答案整体缺失（J1.19 前旧缓存行）→ fail-open 不折 + fitMass null
  const noFit = bianfuAnswers();
  delete noFit.web3_fit;
  const m4 = await run(noFit);
  const s4 = m4?.stage2DataToSave?.parsed_output || {};
  const j4 = m4?.stage2DataToSave?.parsed_output?.jev || {};
  check('B1 web3_fit 缺失 fail-open：70.68 原样不折 / resonanceFitMass=null',
    s4.scoringResult?.totalScore === 70.68 && j4.resonanceFitMass === null && j4.resonanceDamp === null,
    { t: s4.scoringResult?.totalScore, m: j4.resonanceFitMass });

  // B2 fitMass 恰 0.5 边界：不折（<0.5 严格——与 J1.19/J1.23/J1.27 的 ≥0.5 线同侧）
  const m5 = await run(bianfuAnswers({ web3fit: { strong_fit: 0.25, fit: 0.25, marginal: 0.4, unfit: 0.1 } }));
  const s5 = m5?.stage2DataToSave?.parsed_output || {};
  const j5 = m5?.stage2DataToSave?.parsed_output?.jev || {};
  check('B2 fitMass 恰 0.5 不折（严格 <）+ 审计恒落 0.5', s5.scoringResult?.totalScore === 70.68 && j5.resonanceFitMass === 0.5 && j5.resonanceDamp === null,
    { t: s5.scoringResult?.totalScore, m: j5.resonanceFitMass });

  console.log('\n── C. 作用域 ──');

  // C1 A 类 + marginal 0.3 → 不折（裁定域=E 类）
  const m6 = await run(bianfuAnswers({ web3fit: { strong_fit: 0.15, fit: 0.15, marginal: 0.6, unfit: 0.1 }, category: 'A' }));
  const s6 = m6?.stage2DataToSave?.parsed_output || {};
  const j6 = m6?.stage2DataToSave?.parsed_output?.jev || {};
  check('C1 A 类不折（70.68 原样；fitMass 审计照落）',
    s6.scoringResult?.totalScore === 70.68 && j6.resonanceFitMass === 0.3 && j6.resonanceDamp === null,
    { t: s6.scoringResult?.totalScore, d: j6.resonanceDamp });

  // C2 W 类：W 数学分支，折损不触达（tierScore null）
  const m7 = await run(bianfuAnswers({ category: 'W' }));
  const s7 = m7?.stage2DataToSave?.parsed_output || {};
  check('C2 W 类走 W 数学不触达（tierScore=null）', s7.scoringResult?.tierScore == null,
    s7.scoringResult);

  // C3 E 类 D 档量级票：量级门先拦（折损前结论不变，blockReason 归量级门）
  const m8 = await run(bianfuAnswers({ tierScore: 1, tierProbs: { '1': 0.8 } }));
  const s8 = m8?.stage2DataToSave?.parsed_output || {};
  check('C3 E 类 D 档：量级门先拦（归因=量级不足非折损）',
    s8.pass === false && /量级不足/.test(s8.blockReason || ''),
    s8.blockReason);

  console.log('\n── D. 审计与源码口径 ──');

  const j3 = m3?.stage2DataToSave?.parsed_output?.jev || {};
  const j1 = m1?.stage2DataToSave?.parsed_output?.jev || {};

  // D1 审计：resonanceFitMass 恒落数值（不折也落）+ resonanceDamp 命中才落 {fitMass, coef}
  check('D1 审计：蝙蝠侠摇 fitMass=0.76 damp=null / marginal 落 {fitMass:0.3, coef:0.5}',
    j1.resonanceFitMass === 0.76 && j1.resonanceDamp === null
      && j3.resonanceFitMass === 0.3 && j3.resonanceDamp?.coef === 0.5 && j3.resonanceDamp?.fitMass === 0.3,
    { j1: { m: j1.resonanceFitMass, d: j1.resonanceDamp }, j3: j3.resonanceDamp });

  // D2 reason 带「感染力折损×0.5(web3_fit契合30%<50)」段（判据源可追溯）
  check('D2 reason 展示折损来源（web3_fit 契合度）', /感染力折损×0.5\(web3_fit契合30%<50\)/.test(s3.reason || ''),
    { r3: s3.reason });

  // D3 不折 reason 无折损段（bit-identical 的 reason 层验证）
  check('D3 不折 reason 不带折损段', !/感染力折损/.test(s1.reason || '') && !/感染力折损/.test(s2.reason || ''),
    { r1: s1.reason, r2: s2.reason });

  // D4 旧档位审计退役：eventResonance 字段不再产生 / probabilities 无 event_resonance 键
  check('D4 eventResonance 档位字段退役 / probabilities 无 event_resonance 键',
    !('eventResonance' in j1) && !('event_resonance' in (j1.probabilities || {})),
    { keys: Object.keys(j1), pkeys: Object.keys(j1.probabilities || {}) });

  // D5 题集源码锁：event_resonance 题已删（C93 18→17；C96 再 +2 新题 17→19；C108
  // 删 block_misspelling 19→18）+ 版本 J1.42（C98 起题面版；J1.39=C103 条件题
  // parent_relationship——默认关 18 题开 19；J1.42=C108 名字门统一+删探针题）
  const qm = await import('../src/narrative/analyzer/llm/jev-questions.mjs');
  const qs = qm.buildStandardQuestions({});
  const qKeys = Object.keys(qs);
  const qsRel = qm.buildStandardQuestions({ parentRelationship: true });
  check('D5 题集 16 题无 event_resonance/block_misspelling + JEV_QUESTIONS_VERSION=J1.44（C108 删探针题 19→18；C109 收敛两对题 18→16；C110 合桶删 low_quality_derivative；C103 条件题默认关 16/开 17）',
    qKeys.length === 16 && !qKeys.includes('event_resonance') && !qKeys.includes('block_misspelling') && qm.JEV_QUESTIONS_VERSION === 'J1.44'
    && !qKeys.includes('parent_relationship') && Object.keys(qsRel).length === 17 && qsRel.parent_relationship != null,
    { n: qKeys.length, has: qKeys.includes('event_resonance'), v: qm.JEV_QUESTIONS_VERSION, nRel: Object.keys(qsRel).length });

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
