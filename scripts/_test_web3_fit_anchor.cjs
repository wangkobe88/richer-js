#!/usr/bin/env node
/**
 * Web3 偏好量级锚（web3FitAnchoredTier）——本地零 DB 单测（J1.23，2026-10-01 用户裁定，
 * C38 久留美案续 0xfedf19759ba9c45b1a8345a2bde916b38acc7777）
 *
 * 覆盖：
 *   A. 锚矩阵（mapStandardAnswers 路由）：久留美 J1.23 实测 answers 数值复现
 *      （A类 + C档0.94 + strong_fit 0.88 → 锚B → 61.12 过线 high + 审计标记）/
 *      strong_fit 0.49 贴线不锚 / C-D-E 类不锚（作用域 A/B）/ B/A/S 原判不动 /
 *      D/E 档锚后放行 / web3_fit 缺失 fail-closed
 *   B. 负门正锚共存：unfit 0.88 拦截维持（对称负门不被正锚干扰）
 *   C. 审计与 reason：jevImpactTier 原判保留 / reason 带「Web3偏好锚」/
 *      stage1 jev.web3FitAnchoredTier 落位
 *   D. C94 B 类双锚（2026-10-18 用户裁定，京小安案 0xcb98accaa8040a7e839c30
 *      5b8aca08e113c87777「web3 用户喜欢是根本判据，发布主体无所谓」）：
 *      B 类 + strong_fit≥0.5 → effTier 锚 B + dim2<18 锚 18 双锚；京小安 DB 实测
 *      answers 快照复现（mem 1.88<2 仍被 C88 mem 地板拦=「维持拦」裁定反证；
 *      mem≥2 形状 27+18+15=60 恰过线）/ 贴线不锚 / dim2 只升不降 /
 *      C 类维持不豁 / unfit 负门 B 类共存
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

  // A3 非 A/B 类（C 类同形状）→ 不锚（C94 扩展后作用域 A/B，C/D/E 维持）
  const cCatAnswers = { ...kurumiAnswers(), event_category: { choice: 'C', probabilities: { C: 0.6, A: 0.2 } } };
  const m3 = mapStandardAnswers(cCatAnswers, makeContext(kurumiTokenData, cCatAnswers));
  const j3 = m3?.stage1DataToSave?.parsed_output?.jev || {};
  check('A3 C 类不锚（作用域 A/B，C/D/E 维持客观规模口径）', j3.web3FitAnchoredTier == null, j3.web3FitAnchoredTier);

  // A4 原判 B 档 → 不锚（原判即 B，无审计标记）
  const bTierAnswers = kurumiAnswers({ tier: 3, tierProbs: { '3': 0.6 } });
  const m4 = mapStandardAnswers(bTierAnswers, makeContext(kurumiTokenData, bTierAnswers));
  const j4 = m4?.stage1DataToSave?.parsed_output?.jev || {};
  const s4 = m4?.stage2DataToSave?.parsed_output || {};
  check('A4 原判 B 档不锚（无审计标记、B 档分原样）', j4.web3FitAnchoredTier == null && s4.scoringResult?.tierScore === 27, { a: j4.web3FitAnchoredTier, t: s4.scoringResult?.tierScore });

  // A5 原判 A/S 档 → 不锚（不越权降档也不重复标）
  const aTierAnswers = kurumiAnswers({ tier: 4, tierProbs: { '4': 0.6 } });
  const m5 = mapStandardAnswers(aTierAnswers, makeContext(kurumiTokenData, aTierAnswers));
  const j5 = m5?.stage1DataToSave?.parsed_output?.jev || {};
  const s5 = m5?.stage2DataToSave?.parsed_output || {};
  check('A5 原判 A 档不动（34 分无锚标记）', j5.web3FitAnchoredTier == null && s5.scoringResult?.tierScore === 34, { a: j5.web3FitAnchoredTier, t: s5.scoringResult?.tierScore });

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

  // C1 jevImpactTier 原判 C 保留 + web3FitAnchoredTier 落位
  const j1 = m1?.stage1DataToSave?.parsed_output?.jev || {};
  check('C1 审计标记：jevImpactTier=C 原判保留 + web3FitAnchoredTier=B + strongP 0.88',
    j1.jevImpactTier === 'C' && j1.web3FitAnchoredTier === 'B' && j1.web3FitStrongPAnchored === 0.88,
    { t: j1.jevImpactTier, a: j1.web3FitAnchoredTier, p: j1.web3FitStrongPAnchored });

  // C2 reason 带 Web3偏好锚说明
  check('C2 reason 展示锚来源（原判档+strong_fit 百分比）', /Web3偏好锚\(原判C档,strong_fit 88%\)/.test(s2.reason || ''), s2.reason);

  console.log('\n── D. C94 B 类双锚（京小安案现场） ──');

  // 京小安 DB 实测 answers 快照（token_narrative 2026-10-17T14:41 分析行，
  // stage1_raw_output 原样：B 0.52 / magnitude 1.35(D档 0.75) / strong_fit 0.57 /
  // dim2 0.7→7 / mem 1.88 / minor_other 0.40 / none 0.66 / within_7d
  const jxaTokenData = { symbol: '京小安', name: '首款AI警犬', raw_api_data: { name: '首款AI警犬' } };
  function jxaAnswers({ memScore = 1.88, strongFit = 0.57, dim2Score = 0.7, category = 'B' } = {}) {
    return {
      event_category: { choice: category, probabilities: { [category]: 0.52, A: 0.2, W: 0.1, D: 0.08, E: 0.05, C: 0.04, F: 0.01 } },
      event_magnitude: { score: 1.35, probabilities: { '0': 0.01, '1': 0.75, '2': 0.16, '3': 0.05, '4': 0.03, '5': 0 } },
      event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.96, within_30d: 0.01, older: 0.01, unknown: 0.01 } },
      dimension2: { score: dim2Score, probabilities: { '0': 0.45, '1': 0.48, '2': 0.03, '3': 0.02, '4': 0.02, '5': 0 } },
      block_reason: { choice: 'none', probabilities: { none: 0.66, subject_unqualified: 0.15, regional_event: 0.1, marketing_gimmick: 0.05, routine_content_product: 0.02, institution_routine: 0.01, low_quality_derivative: 0.01 } },
      web3_fit: { choice: 'strong_fit', probabilities: { strong_fit: strongFit, fit: 0.21, marginal: 0.21, unfit: 0.01 } },
      subject_entity: { choice: 'product_character', probabilities: { product_character: 0.53, product_functional: 0.34, character_ip: 0.11, event_hotspot: 0.01 } },
      name_referent: { choice: 'minor_other', probabilities: { minor_other: 0.39999999999999997, subject_self: 0.33999999999999997, notable_other: 0.19, super_ip: 0.04, common_word: 0.02, none_related: 0.01 } },
      referent_memeability: { score: memScore, probabilities: { '2': 0.88, '0': 0.03, '1': 0.08, '3': 0.01 } },
      subject_carrier: { choice: 'existing_entity', probabilities: { existing_entity: 0.49, improvised_entity: 0.42, no_visual_entity: 0.09 } },
      relevance_type: { choice: 'exact_match', probabilities: { exact_match: 0.96, semantic: 0.04 } },
      relevance_level: { score: 3.55, probabilities: { '4': 0.75, '3': 0.13, '1': 0.05, '2': 0.04, '0': 0.03 } },
      block_misspelling: { noul: 0.1 },
      quality_spelling: { score: 2.88 },
      quality_reasonability: { score: 1.88 },
    };
  }

  // D1 京小安实测形状（mem 1.88<2）：C108 memFloor 退役断代——2026-10-18「维持拦」
  // 裁定随位退役（名字玩味轴移交 name_form 判：J1.42 下重析按四分支判）。
  // 旧快照形状（无 name_form 键 fail-open）→ 双锚 60 恰过线 pass
  const d1a = jxaAnswers();
  const md1 = mapStandardAnswers(d1a, makeContext(jxaTokenData, d1a));
  const sd1 = md1?.stage2DataToSave?.parsed_output || {};
  check('D1 京小安 mem 1.88<2：memFloor C108 退役不再拦（双锚 60 恰过线 pass；名字玩味轴移交 name_form）',
    sd1.pass === true && sd1.blockReason == null, sd1.blockReason);

  // D2 同形状 mem 2.2（过地板）：D 档 → 量级锚 B + dim2 锚 18 双锚 →
  // 27+18+15=60 恰过线 pass + reason 双锚标注 + 审计键
  const d2a = jxaAnswers({ memScore: 2.2 });
  const md2 = mapStandardAnswers(d2a, makeContext(jxaTokenData, d2a));
  const sd2 = md2?.stage2DataToSave?.parsed_output || {};
  const jd2 = md2?.stage1DataToSave?.parsed_output?.jev || {};
  check('D2 B类 D档+strong_fit 0.57 双锚：27+18+15=60 恰过线 pass',
    sd2.pass === true && sd2.scoringResult?.totalScore === 60
      && sd2.scoringResult?.tierScore === 27 && sd2.scoringResult?.spreadScore === 18,
    sd2.scoringResult);
  check('D2 审计：jevImpactTier=D 原判保留 + web3FitAnchoredTier=B + web3FitSpreadAnchor={from:7}',
    jd2.jevImpactTier === 'D' && jd2.web3FitAnchoredTier === 'B'
      && sd2.jev?.web3FitSpreadAnchor?.from === 7,
    { t: jd2.jevImpactTier, a: jd2.web3FitAnchoredTier, d: sd2.jev?.web3FitSpreadAnchor });
  check('D2 reason 双锚标注（Web3偏好锚 + Web3偏好传播豁免）',
    /Web3偏好锚\(原判D档,strong_fit 57%\)/.test(sd2.reason || '')
      && /Web3偏好传播豁免\(原7\)/.test(sd2.reason || ''), sd2.reason);

  // D3 strong_fit 0.49 贴线（B 类）→ 不锚不豁：量级门 D 档拦截维持（fail-closed）
  const d3a = jxaAnswers({ strongFit: 0.49, memScore: 2.2 });
  const md3 = mapStandardAnswers(d3a, makeContext(jxaTokenData, d3a));
  const sd3 = md3?.stage2DataToSave?.parsed_output || {};
  check('D3 strong_fit 0.49 贴线不锚：量级不足拦截维持',
    sd3.pass === false && /量级不足/.test(sd3.blockReason || ''), sd3.blockReason);

  // D4 dim2≥18 只升不降：锚不触发（审计 null），量级锚照常生效
  const d4a = jxaAnswers({ memScore: 2.2, dim2Score: 3.0 });
  const md4 = mapStandardAnswers(d4a, makeContext(jxaTokenData, d4a));
  const sd4 = md4?.stage2DataToSave?.parsed_output || {};
  check('D4 dim2 高带不锚（只升不降）：量级锚照常、传播锚审计 null',
    sd4.scoringResult?.tierScore === 27 && sd4.jev?.web3FitSpreadAnchor == null
      && sd4.scoringResult?.spreadScore > 18,
    { t: sd4.scoringResult?.tierScore, d: sd4.scoringResult?.spreadScore, a: sd4.jev?.web3FitSpreadAnchor });

  // D5 C 类维持不豁（裁定「C/D/E 类量级是客观规模」）：同形状 category C → 无双锚
  const d5a = jxaAnswers({ memScore: 2.2, category: 'C' });
  const md5 = mapStandardAnswers(d5a, makeContext(jxaTokenData, d5a));
  const jd5 = md5?.stage1DataToSave?.parsed_output?.jev || {};
  const sd5 = md5?.stage2DataToSave?.parsed_output || {};
  check('D5 C 类不豁：量级/传播双锚均不触达',
    jd5.web3FitAnchoredTier == null && sd5.jev?.web3FitSpreadAnchor == null,
    { a: jd5.web3FitAnchoredTier, d: sd5.jev?.web3FitSpreadAnchor });

  // D6 unfit 负门 B 类共存：Web3 用户不喜欢 → 量级/传播锚不救（对称负门）
  const d6a = jxaAnswers({ memScore: 2.2, strongFit: 0.02 });
  d6a.web3_fit = { choice: 'unfit', probabilities: { unfit: 0.88, marginal: 0.06, fit: 0.03, strong_fit: 0.02 } };
  const md6 = mapStandardAnswers(d6a, makeContext(jxaTokenData, d6a));
  const sd6 = md6?.stage2DataToSave?.parsed_output || {};
  check('D6 B 类 unfit 0.88 负门拦截维持（偏好不合先于锚）',
    sd6.pass === false && sd6.blockReason === 'Web3用户偏好不合', sd6.blockReason);

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
