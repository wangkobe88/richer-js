#!/usr/bin/env node
/**
 * Web3 偏好量级锚（web3FitAnchored）——本地零 DB 单测（J1.23，2026-10-01 用户裁定，
 * C38 久留美案续 0xfedf19759ba9c45b1a8345a2bde916b38acc7777）
 *
 * 覆盖：
 *   A. 锚矩阵（mapStandardAnswers 路由）：久留美 J1.23 实测 answers 数值复现
 *      （A类 + C档0.94 + strong_fit 0.88 → 锚B → 61.12 过线 high + 审计标记）/
 *      strong_fit 0.49 贴线不锚 / 非 A 类不锚 / B/A/S 原判不动 / D/E 档锚后放行 /
 *      web3_fit 缺失 fail-closed
 *   B. 负门正锚共存：unfit 0.88 拦截维持（对称负门不被正锚干扰）
 *   C. 审计与 reason：magnitudeTier 原判保留 / reason 带「Web3偏好锚」/
 *      stage1 jev.web3FitAnchored 落位
 *
 * 用法：node scripts/_test_web3_fit_anchor.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

// ── C38 久留美 J1.23 实测 answers 快照（182 重析 2026-10-01T05:52Z，DB 实证）──────
// category A 0.80 / magnitude 档2(C) 0.94 / web3_fit strong_fit 0.88 /
// rcp 0.63（A类豁免）/ subject_self 0.44 / dim2 2.14 → 19.12 / within_7d
const kurumiTokenData = { symbol: '久留美', name: 'FX战士久留美', raw_api_data: { name: 'FX战士久留美' } };

function kurumiAnswers({ tier = 2, tierProbs = { '2': 0.94 }, strongFit = 0.88, unfit = 0.01, web3Fit = null } = {}) {
  const w3 = web3Fit === null
    ? { choice: 'strong_fit', probabilities: { strong_fit: strongFit, fit: 0.09, marginal: 0.02, unfit } }
    : web3Fit;
  return {
    event_category: { choice: 'A', probabilities: { A: 0.80, D: 0.13, W: 0.06 } },
    event_magnitude: { score: tier, probabilities: tierProbs },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.95 } },
    dimension2: { score: 2.14, probabilities: { '2': 0.6, '3': 0.3 } },
    block_reason: {
      choice: 'routine_content_product',
      probabilities: { routine_content_product: 0.63, none: 0.22, institution_routine: 0.07 },
    },
    name_referent: { choice: 'subject_self', probabilities: { subject_self: 0.44, notable_other: 0.40, minor_other: 0.14 } },
    web3_fit: w3,
    relevance_type: { choice: 'translation_match', probabilities: { translation_match: 0.7, exact_match: 0.15, semantic: 0.1 } },
    relevance_level: { score: 3.3, probabilities: { '3': 0.4, '4': 0.5 } },
    block_misspelling: { noul: 0.1 },
    quality_spelling: { score: 2.82 },
    quality_reasonability: { score: 1.69 },
  };
}

function makeContext(tokenData, answers) {
  return {
    tokenData,
    includeBrandHijack: false,
    tweetClassification: null,
    twitterInfo: null,
    callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  };
}

async function main() {
  const { mapStandardAnswers } = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');

  console.log('\n── A. 锚矩阵 ──');

  // A1 久留美数值复现：锚 B → 27+19.12+15=61.12 过线
  const m1 = mapStandardAnswers(kurumiAnswers(), makeContext(kurumiTokenData, kurumiAnswers()));
  const s2 = m1?.stage2DataToSave?.parsed_output || {};
  check('A1 久留美：A类+C档+strong_fit 0.88 → 锚B 事件分 61.12 过线',
    s2.scoringResult?.totalScore === 61.12 && s2.scoringResult?.tierScore === 27 && !s2.pass === false,
    s2.scoringResult);

  // A2 strong_fit 0.49 贴线 → 不锚（fail-closed；C 档仍计分 56.12<60 事件分不足拦）
  const m2 = mapStandardAnswers(kurumiAnswers({ strongFit: 0.49, unfit: 0.3 }), makeContext(kurumiTokenData, kurumiAnswers()));
  const s2b = m2?.stage2DataToSave?.parsed_output || {};
  check('A2 strong_fit 0.49 贴线不锚：事件分不足拦截维持（56.12）',
    s2b.pass === false && /事件分不足/.test(s2b.blockReason || '') && s2b.scoringResult?.tierScore === 22,
    { r: s2b.blockReason, t: s2b.scoringResult?.tierScore });

  // A3 非 A 类（B 类同形状）→ 不锚
  const bAnswers = { ...kurumiAnswers(), event_category: { choice: 'B', probabilities: { B: 0.6, A: 0.2 } } };
  const m3 = mapStandardAnswers(bAnswers, makeContext(kurumiTokenData, bAnswers));
  const j3 = m3?.stage1DataToSave?.parsed_output?.jev || {};
  check('A3 B 类不锚（作用域仅 A）', j3.web3FitAnchored == null, j3.web3FitAnchored);

  // A4 原判 B 档 → 不锚（原判即 B，无审计标记）
  const bTierAnswers = kurumiAnswers({ tier: 3, tierProbs: { '3': 0.6 } });
  const m4 = mapStandardAnswers(bTierAnswers, makeContext(kurumiTokenData, bTierAnswers));
  const j4 = m4?.stage1DataToSave?.parsed_output?.jev || {};
  const s4 = m4?.stage2DataToSave?.parsed_output || {};
  check('A4 原判 B 档不锚（无审计标记、B 档分原样）', j4.web3FitAnchored == null && s4.scoringResult?.tierScore === 27, { a: j4.web3FitAnchored, t: s4.scoringResult?.tierScore });

  // A5 原判 A/S 档 → 不锚（不越权降档也不重复标）
  const aTierAnswers = kurumiAnswers({ tier: 4, tierProbs: { '4': 0.6 } });
  const m5 = mapStandardAnswers(aTierAnswers, makeContext(kurumiTokenData, aTierAnswers));
  const j5 = m5?.stage1DataToSave?.parsed_output?.jev || {};
  const s5 = m5?.stage2DataToSave?.parsed_output || {};
  check('A5 原判 A 档不动（34 分无锚标记）', j5.web3FitAnchored == null && s5.scoringResult?.tierScore === 34, { a: j5.web3FitAnchored, t: s5.scoringResult?.tierScore });

  // A6 D/E 档 + A 类 + strong_fit 0.88 → 锚 B → 「量级不足」阻断分支放行
  const dTierAnswers = kurumiAnswers({ tier: 1, tierProbs: { '1': 0.7 } });
  const m6 = mapStandardAnswers(dTierAnswers, makeContext(kurumiTokenData, dTierAnswers));
  const s6 = m6?.stage2DataToSave?.parsed_output || {};
  check('A6 D 档锚 B：量级不足阻断不触发、按 B 档计分', !/量级不足/.test(s6.blockReason || '无') && s6.scoringResult?.tierScore === 27,
    { r: s6.blockReason, t: s6.scoringResult?.tierScore });

  // A7 web3_fit 整题缺失 / 概率缺失 → 不锚 fail-closed（C 档计分 56.12<60 拦）
  const noFit = kurumiAnswers({ web3Fit: undefined });
  delete noFit.web3_fit;
  const m7 = mapStandardAnswers(noFit, makeContext(kurumiTokenData, noFit));
  const s7 = m7?.stage2DataToSave?.parsed_output || {};
  check('A7 web3_fit 缺失不锚（事件分不足拦截维持）', s7.pass === false && /事件分不足/.test(s7.blockReason || '') && s7.scoringResult?.tierScore === 22,
    { r: s7.blockReason, t: s7.scoringResult?.tierScore });

  // A8 W 类（cashtag 改道等）不受锚影响：A 类被改写为 W 时 category!=='A'
  const wAnswers = { ...kurumiAnswers(), event_category: { choice: 'W', probabilities: { W: 0.7, A: 0.2 } } };
  const m8 = mapStandardAnswers(wAnswers, makeContext(kurumiTokenData, wAnswers));
  const s8 = m8?.stage2DataToSave?.parsed_output || {};
  check('A8 W 类不走锚（W 数学）', s8.scoringResult?.tierScore == null, s8.scoringResult);

  console.log('\n── B. 负门正锚共存 ──');

  // B1 unfit 0.88 → 负门拦截维持（正锚对称面：Web3 用户不喜欢，量级锚不救）
  const unfitAnswers = kurumiAnswers({ strongFit: 0.02, unfit: 0.88, web3Fit: { choice: 'unfit', probabilities: { unfit: 0.88, marginal: 0.06, fit: 0.03, strong_fit: 0.02 } } });
  const mb = mapStandardAnswers(unfitAnswers, makeContext(kurumiTokenData, unfitAnswers));
  const sb = mb?.stage2DataToSave?.parsed_output || {};
  check('B1 unfit 0.88 负门拦截维持（偏好不合）', sb.pass === false && sb.blockReason === 'Web3用户偏好不合', sb.blockReason);

  // B2 正负不可同时 ≥0.5（概率和为 1 的天然不变式，代码防御性写法验证：unfit 门先挂）
  const both = kurumiAnswers({ strongFit: 0.6, unfit: 0.5, web3Fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.6, unfit: 0.5, fit: 0, marginal: 0 } } });
  const mb2 = mapStandardAnswers(both, makeContext(kurumiTokenData, both));
  const sb2 = mb2?.stage2DataToSave?.parsed_output || {};
  check('B2 双过半形状（脏数据）：unfit 负门先拦（w3Block 挂在量级分支前）', sb2.pass === false && sb2.blockReason === 'Web3用户偏好不合', sb2.blockReason);

  console.log('\n── C. 审计与 reason ──');

  // C1 magnitudeTier 原判 C 保留 + web3FitAnchored 落位
  const j1 = m1?.stage1DataToSave?.parsed_output?.jev || {};
  check('C1 审计标记：magnitudeTier=C 原判保留 + web3FitAnchored=B + strongP 0.88',
    j1.magnitudeTier === 'C' && j1.web3FitAnchored === 'B' && j1.web3FitStrongP === 0.88,
    { t: j1.magnitudeTier, a: j1.web3FitAnchored, p: j1.web3FitStrongP });

  // C2 reason 带 Web3偏好锚说明
  check('C2 reason 展示锚来源（原判档+strong_fit 百分比）', /Web3偏好锚\(原判C档,strong_fit 88%\)/.test(s2.reason || ''), s2.reason);

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
