#!/usr/bin/env node
/**
 * J1.31 E 类情绪感染力折损（event_resonance）——本地零 DB 单测
 * （2026-10-16 用户裁定，C80 蝙蝠侠摇案 0x4547dae7757fb4043e034d27ed02dfabe9aa7777）
 *
 * 覆盖：
 *   A. 事故现场反证（蝙蝠侠摇数值复现）：E 类 B 档 27+传播 28.68+时效 15=70.68
 *      → high 75.68（DB 实证值 bit-identical 复现）；同一形状下
 *      mild_amusement ×0.5 → 42.84 事件分不足拦 / indifferent ×0.25 → 28.92 拦
 *      ——「观众≠买家」的数学化
 *   B. 系数边界：strong_reaction ×1 原样（圈内情绪不折）/ 无 event_resonance
 *      答案（旧缓存行）fail-open 原样 / 未知档位值不折（防脏数据打崩）
 *   C. 作用域：A 类同形状不折（裁定域=E 类）/ W 类走 W 数学不触达 /
 *      E 类 D 档量级票折损前后同为拦（量级门先拦，折损不改变结论）
 *   D. 审计与 reason：stage2 jev.eventResonance 恒落 / resonanceDamp 命中才落 /
 *      reason 带「感染力折损×系数(档)」/ probabilities.event_resonance 落库
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
// （DB breakdown 落的是 bandInterpolate 换算后值；原始分反解：SPELLING/REASONABILITY
//  BANDS 按 floor(score) 取带，2.8→[4,5]带 4.8、1.47→[2,3]带 2.47）
const bianfuTokenData = { symbol: '蝙蝠侠摇', name: '蝙蝠侠式蹦迪', raw_api_data: { name: '蝙蝠侠式蹦迪' } };

function bianfuAnswers({ resonance, category = 'E', tierScore = 3, tierProbs = { '3': 0.97 } } = {}) {
  const a = {
    event_category: { choice: category, probabilities: { [category]: 0.99 } },
    event_magnitude: { score: tierScore, probabilities: tierProbs },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.95 } },
    dimension2: { score: 5.34, probabilities: { '5': 0.6, '4': 0.3 } },
    block_reason: { choice: 'none', probabilities: { none: 0.57, marketing_gimmick: 0.19 } },
    name_referent: { choice: 'super_ip', probabilities: { super_ip: 0.43, common_word: 0.38 } },
    web3_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.38, fit: 0.38, marginal: 0.16, unfit: 0.08 } },
    subject_entity: { choice: 'meme_word', probabilities: { meme_word: 0.67, character_ip: 0.14 } },
    subject_carrier: { choice: 'existing_entity', probabilities: { existing_entity: 0.5 } },
    referent_memeability: { score: 3.5, probabilities: { '3': 0.5 } },
    relevance_type: { choice: 'exact_match', probabilities: { exact_match: 0.82 } },
    relevance_level: { score: 3.2, probabilities: { '4': 0.71, '3': 0.15 } },
    block_misspelling: { noul: 0.14 },
    quality_spelling: { score: 2.8 },
    quality_reasonability: { score: 1.47 },
  };
  if (resonance !== undefined) {
    a.event_resonance = { choice: resonance, probabilities: { [resonance]: 0.7 } };
  }
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
  console.log('\n── A. 事故现场反证（蝙蝠侠摇数值复现）──');

  // A1 基线（无 event_resonance 键 = J1.30 旧题集形状）：70.68 → 75.68 high
  const m1 = await run(bianfuAnswers());
  const s1 = m1?.stage2DataToSave?.parsed_output || {};
  const f1 = m1?.stageFinalData || {};
  check('A1 基线复现：事件分 70.68 → 总分 75.68 high（DB 实证 bit-identical）',
    s1.scoringResult?.totalScore === 70.68 && f1.totalScore === 75.68 && f1.category === 'high',
    { s2: s1.scoringResult?.totalScore, fin: f1.totalScore, cat: f1.category });

  // A2 mild_amusement ×0.5：(27+28.68)×0.5+15=42.84 <60 事件分不足拦
  const m2 = await run(bianfuAnswers({ resonance: 'mild_amusement' }));
  const s2 = m2?.stage2DataToSave?.parsed_output || {};
  const r2 = m2?.llmResult || {};
  check('A2 mild ×0.5：事件分 42.84 → 事件分不足拦截 rating low',
    s2.scoringResult?.totalScore === 42.84 && s2.pass === false && /事件分不足（42.84<60）/.test(s2.blockReason || '') && r2.rating === 'low',
    { t: s2.scoringResult?.totalScore, r: s2.blockReason, rating: r2.rating });

  // A3 indifferent ×0.25：(27+28.68)×0.25+15=28.92 <60 拦（本案应判形状：Web3 用户纯旁观）
  const m3 = await run(bianfuAnswers({ resonance: 'indifferent' }));
  const s3 = m3?.stage2DataToSave?.parsed_output || {};
  check('A3 indifferent ×0.25：事件分 28.92 拦（蝙蝠侠摇救回形状）',
    s3.scoringResult?.totalScore === 28.92 && s3.pass === false && /事件分不足（28.92<60）/.test(s3.blockReason || ''),
    { t: s3.scoringResult?.totalScore, r: s3.blockReason });

  console.log('\n── B. 系数边界 ──');

  // B1 strong_reaction ×1：bit-identical 原公式（圈内情绪不折）
  const m4 = await run(bianfuAnswers({ resonance: 'strong_reaction' }));
  const s4 = m4?.stage2DataToSave?.parsed_output || {};
  const f4 = m4?.stageFinalData || {};
  check('B1 strong ×1：70.68/75.68 high 与基线 bit-identical',
    s4.scoringResult?.totalScore === 70.68 && f4.totalScore === 75.68 && f4.category === 'high',
    { t: s4.scoringResult?.totalScore, fin: f4.totalScore });

  // B2 旧缓存行（无 event_resonance 答案）fail-open：不折原样（A1 同 shape 已验，
  // 此处补审计键断言：eventResonance=null / resonanceDamp=null）
  const j1 = m1?.stage2DataToSave?.parsed_output?.jev || {};
  check('B2 旧缓存行 fail-open：eventResonance=null / resonanceDamp=null',
    j1.eventResonance === null && j1.resonanceDamp === null,
    { r: j1.eventResonance, d: j1.resonanceDamp });

  // B3 未知档位值（脏数据）不折：原公式 + 系数不生效
  const m5 = await run(bianfuAnswers({ resonance: 'whatever' }));
  const s5 = m5?.stage2DataToSave?.parsed_output || {};
  check('B3 未知档位值不折（fail-open 原样 70.68）', s5.scoringResult?.totalScore === 70.68,
    s5.scoringResult?.totalScore);

  console.log('\n── C. 作用域 ──');

  // C1 A 类同形状 + indifferent → 不折（裁定域=E 类；蝙蝠侠若被 Jev 判形象 IP 也不受本门）
  const m6 = await run(bianfuAnswers({ resonance: 'indifferent', category: 'A' }));
  const s6 = m6?.stage2DataToSave?.parsed_output || {};
  const j6 = m6?.stage2DataToSave?.parsed_output?.jev || {};
  check('C1 A 类不折（70.68 原样，审计档位照落）',
    s6.scoringResult?.totalScore === 70.68 && j6.eventResonance === 'indifferent' && j6.resonanceDamp === null,
    { t: s6.scoringResult?.totalScore, d: j6.resonanceDamp });

  // C2 W 类：W 数学分支，resonance 不触达（tierScore null）
  const m7 = await run(bianfuAnswers({ resonance: 'indifferent', category: 'W' }));
  const s7 = m7?.stage2DataToSave?.parsed_output || {};
  check('C2 W 类走 W 数学不触达（tierScore=null）', s7.scoringResult?.tierScore == null,
    s7.scoringResult);

  // C3 E 类 D 档量级票：量级门先拦（折损前结论不变，blockReason 归量级门）
  const m8 = await run(bianfuAnswers({ resonance: 'indifferent', tierScore: 1, tierProbs: { '1': 0.8 } }));
  const s8 = m8?.stage2DataToSave?.parsed_output || {};
  check('C3 E 类 D 档：量级门先拦（归因=量级不足非折损）',
    s8.pass === false && /量级不足/.test(s8.blockReason || ''),
    s8.blockReason);

  console.log('\n── D. 审计与 reason ──');

  // D1 审计键：档位恒落 + resonanceDamp 命中才落（系数与档可追溯）
  const j2 = m2?.stage2DataToSave?.parsed_output?.jev || {};
  const j3 = m3?.stage2DataToSave?.parsed_output?.jev || {};
  const j4 = m4?.stage2DataToSave?.parsed_output?.jev || {};
  check('D1 审计：mild 落 {resonance, coef:0.5} / indifferent 落 {coef:0.25} / strong 不落 damp',
    j2.eventResonance === 'mild_amusement' && j2.resonanceDamp?.coef === 0.5
      && j3.resonanceDamp?.coef === 0.25 && j4.resonanceDamp === null,
    { j2: j2.resonanceDamp, j3: j3.resonanceDamp, j4: j4.resonanceDamp });

  // D2 reason 带「感染力折损×系数(档)」段（stage2Reason 拼在事件分行）
  check('D2 reason 展示折损来源', /感染力折损×0.25\(无感\)/.test(s3.reason || '') && /感染力折损×0.5\(轻度有趣\)/.test(s2.reason || ''),
    { r3: s3.reason, r2: s2.reason });

  // D3 strong/基线 reason 无折损段（bit-identical 的 reason 层验证）
  check('D3 strong/缺答案 reason 不带折损段', !/感染力折损/.test(s4.reason || '') && !/感染力折损/.test(s1.reason || ''),
    { r4: s4.reason, r1: s1.reason });

  // D4 probabilities.event_resonance 落库（档间梯度可观察）
  check('D4 probabilities.event_resonance 落库', j3.probabilities?.event_resonance?.indifferent === 0.7,
    j3.probabilities?.event_resonance);

  // D5 系数表锁定（阈值事后校准的改点单源）
  const src = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  check('D5 mapStandardAnswers 导出完整（ESM 加载无语法错误）', typeof src.mapStandardAnswers === 'function');

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
