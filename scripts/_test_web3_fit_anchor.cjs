#!/usr/bin/env node
/**
 * Web3 偏好量级锚（web3FitAnchoredTier）断代 + fit 派生态——本地零 DB 单测
 * （J1.79，2026-10-20；前身 J1.23/C38 久留美案、C94 京小安案）
 *
 * J1.79 变化：旧 `web3_user_event_impact` 题删除，标准事件分改为 fit 质量——
 *   eventCompositeScore = round2(min(1, strong_fit + fit) * 100)，
 *   tier = impactTierOf(round2(mass * 5)) 仅服务既有豁免/审计。
 * 结构性后果：strong_fit ≥ 0.5 ⇒ mass ≥ 0.5 ⇒ influenceScore ≥ 2.5 ⇒
 * Math.round(2.5)=3 ⇒ tier ≥ B——`web3FitAnchored`（要求 tier ∉ {S,A,B}）在
 * 新口径下**数学上不可达**（锚即使触发也只会把 B 锚成 B，是恒等操作）。
 * 审计键 web3FitAnchoredTier / web3FitStrongPAnchored 保留在源码但恒 null。
 * C94「B 类 web3 用户喜欢就无所谓发布主体」的裁定由 fit 派生态结构性承接：
 * 偏好强 = tier 自动 A/S = 量级门天然不触达，不再需要独立锚臂。
 *
 * 覆盖：
 *   A. fit 派生态矩阵：久留美快照 → 97/S 过线（reason 精确串）/
 *      strong_fit 0.49 贴线无特殊语义（事件分 58 照拦）/
 *      锚的数学不可达性（A/B 类 strong_fit∈{0.5,0.6,0.7,0.88,1.0} → tier 恒 ≥B、
 *      锚审计恒 null、reason 无「Web3偏好锚」）/
 *      event_magnitude 答案不再参与计分（0 档 vs 5 档同分）/
 *      C 类同 fit 同分（J1.79 无类别不对称）/
 *      低 fit A 类由 D/E 档臂拦（档位来源=fit，锚不可救）/
 *      fit 题缺失 → mass 0 → E 档 fail-closed 拦 /
 *      W 类走 W 数学（fit 答案不参与，无 influenceTier/influenceFloor）
 *   B. 负门共存：unfit 0.88 拦截维持 / 脏数据双过半 unfit 门先挂
 *   C. 审计：jevImpactTier=fit 派生档（原 magnitude 档不再保留任何影响）/
 *      web3FitAnchoredTier + web3FitStrongPAnchored 恒 null / 概率证据照落
 *   D. 京小安案（C94 现场）新口径：B 类 strong 0.57+fit 0.21 → 78/A 过线
 *      （原 D 档+双锚 60 路径退役）/ mem/dim2 答案不再参与计分 /
 *      strong_fit 0.49 且总 mass 0.54 → 事件分不足拦 / C 类同 fit 同分 /
 *      unfit 负门 B 类共存
 *
 * 用法：node scripts/_test_web3_fit_anchor.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}
function round2(n) { return Math.round(n * 100) / 100; }

// ── C38 久留美 J1.23 实测 answers 快照（182 重析 2026-10-01T05:52Z，DB 实证）──────
// category A 0.80 / magnitude 档2(C) 0.94 / web3_user_event_fit strong_fit 0.88 /
// rcp 0.63（A类豁免）/ subject_self 0.44 / dim2 2.14 → 19.12 / within_7d
// J1.79：magnitude/dim2 不再计分——同快照 fit mass 0.88+0.09=0.97 → 97/S。
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
    event_quality_veto: {
      choice: 'event_routine_content_product',
      probabilities: { event_routine_content_product: 0.63, none: 0.22, event_institution_routine: 0.07 },
    },
    web3_user_name_entity_acceptance: { choice: 'no_entity', probabilities: { no_entity: 0.98 } },
    web3_user_event_fit: w3,
    name_event_relevance: { choice: 'translation_match', probabilities: { translation_match: 0.7, exact_match: 0.15, semantic: 0.1 } },
    relevance_level: { score: 3.3, probabilities: { '3': 0.4, '4': 0.5 } },
    block_misspelling: { noul: 0.1 },
    quality_spelling: { score: 2.82 },
    quality_reasonability: { score: 1.69 },
  };
}

// fit 派生态通用形状：除 fit 外全部干净（无 block/实体/载体/名字门干扰），
// 用于隔离「分与档只由 strong_fit+fit 决定」这一被测轴。
function fitShape({ category = 'A', strong = 0.88, fit = 0.09, magnitudeScore = 3, dimension2Score = 2.1 } = {}) {
  const rest = Math.max(0, round2(1 - strong - fit));
  return {
    event_category: { choice: category, probabilities: { [category]: 0.9 } },
    // 旧题答案仍随快照存在——J1.79 起刻意不参与计分（A4 反证）
    event_magnitude: { score: magnitudeScore, probabilities: { [String(Math.round(magnitudeScore))]: 0.9 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.95 } },
    dimension2: { score: dimension2Score, probabilities: { [String(Math.round(dimension2Score))]: 0.8 } },
    event_quality_veto: { choice: 'none', probabilities: { none: 0.9, event_empty_content: 0.1 } },
    web3_user_name_entity_acceptance: { choice: 'no_entity', probabilities: { no_entity: 0.95 } },
    web3_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: strong, fit, marginal: rest, unfit: 0 } },
    name_entity_carrier: { choice: 'existing_entity', probabilities: { existing_entity: 0.7, improvised_entity: 0.2, no_visual_entity: 0.1 } },
    name_event_relevance: { choice: 'exact_match', probabilities: { exact_match: 0.9, semantic: 0.1 } },
    relevance_level: { score: 3.5, probabilities: { '3': 0.4, '4': 0.5 } },
    block_misspelling: { noul: 0.1 },
    quality_spelling: { score: 2.82 },
    quality_reasonability: { score: 1.69 },
  };
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

async function main() {
  const { mapStandardAnswers } = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');

  const map = (answers, tokenData = kurumiTokenData) => mapStandardAnswers(answers, makeContext(tokenData));
  const stage2 = (m) => m?.stage2DataToSave?.parsed_output || {};
  const stage1Jev = (m) => m?.stage1DataToSave?.parsed_output?.jev || {};

  console.log('\n── A. fit 派生态矩阵（J1.79 标准） ──');

  // A1 久留美数值复现：mass 0.88+0.09=0.97 → 影响力 4.85 → 事件分 97 / S 档过线。
  // 锚键（web3FitAnchoredTier/influenceFloor）恒 null——见 C 段。
  const m1 = map(kurumiAnswers());
  const s1 = stage2(m1);
  check('A1 久留美：strong_fit 0.88+fit 0.09 → 事件分 97、S 档、无影响力下限、过线',
    s1.scoringResult?.eventCompositeScore === 97 && s1.scoringResult?.influenceScore === 4.85
      && s1.scoringResult?.influenceTier === 'S' && s1.scoringResult?.influenceFloor === null
      && s1.pass === true,
    s1.scoringResult);

  // A2 strong_fit 0.49（旧锚阈值下界）+fit 0.09 → mass 0.58 → 事件分 58，事件分不足照拦。
  // J1.79 无「贴线锚」语义：阈值以下只是普通低分，不再有档位/下限特判。
  const m2 = map(kurumiAnswers({ strongFit: 0.49, unfit: 0.3 }));
  const s2b = stage2(m2);
  check('A2 strong_fit 0.49：mass 0.58 → 事件分 58、B 档、无下限，事件分不足（58<60）拦',
    s2b.pass === false && /事件分不足（58<60）/.test(s2b.blockReason || '')
      && s2b.scoringResult?.eventCompositeScore === 58 && s2b.scoringResult?.influenceFloor === null,
    { r: s2b.blockReason, s: s2b.scoringResult });

  // A3 锚的数学不可达性：strong_fit ≥0.5 ⇒ mass ≥0.5 ⇒ round(2.5)=3 ⇒ tier≥B，
  // 而 web3FitAnchored 要求 tier∉{S,A,B}——永假。A/B 两域逐一反证：
  //   0.5 → 50/B（事件分不足拦，非量级门）/ 0.6 → 60/B 过线 / 0.7 → 70/A 过线 /
  //   0.88+0.09 → 97/S 过线 / 1.0 → 100/S 过线。
  for (const [category, strong, fit, expectedScore, expectedTier, expectedPass] of [
    ['A', 0.5, 0, 50, 'B', false],
    ['B', 0.6, 0, 60, 'B', true],
    ['A', 0.7, 0, 70, 'A', true],
    ['B', 0.88, 0.09, 97, 'S', true],
    ['A', 1.0, 0, 100, 'S', true],
  ]) {
    const answers = fitShape({ category, strong, fit });
    const r = stage2(map(answers));
    check(`A3 ${category}类 strong_fit ${strong}+fit ${fit} → ${expectedScore}/${expectedTier}：tier 恒 ≥B、锚键 null、reason 无「Web3偏好锚」`,
      r.scoringResult?.eventCompositeScore === expectedScore
        && r.scoringResult?.influenceTier === expectedTier
        && r.scoringResult?.influenceFloor === null
        && stage1Jev(map(answers)).web3FitAnchoredTier === null
        && !/Web3偏好锚/.test(r.reason || '')
        && r.pass === expectedPass,
      { s: r.scoringResult, r: r.reason, pass: r.pass });
  }
  const half = stage2(map(fitShape({ category: 'A', strong: 0.5, fit: 0 })));
  check('A3b 阈值边界 0.5：档位已是 B（锚无操作空间），拦截归事件分不足而非量级门',
    half.pass === false && /事件分不足（50<60）/.test(half.blockReason || '') && half.scoringResult?.influenceTier === 'B',
    { r: half.blockReason, t: half.scoringResult?.influenceTier });

  // A4 event_magnitude 答案不再参与计分：同 fit 下旧题 0 档 vs 5 档 → 完全相同结果。
  const mag0 = stage2(map(fitShape({ magnitudeScore: 0 })));
  const mag5 = stage2(map(fitShape({ magnitudeScore: 5 })));
  check('A4 event_magnitude 0 档 vs 5 档同分同档（旧题答案已被忽略）',
    mag0.scoringResult?.eventCompositeScore === 97
      && mag0.scoringResult?.eventCompositeScore === mag5.scoringResult?.eventCompositeScore
      && mag0.scoringResult?.influenceTier === mag5.scoringResult?.influenceTier
      && mag0.pass === mag5.pass,
    { mag0: mag0.scoringResult, mag5: mag5.scoringResult });

  // A5 C 类无类别不对称：同 fit → 同分同档（旧「A/B 才可锚」的类别分流随锚退役；
  // 身份/载体等类别门在 fitShape 干净的形状下不触达）。
  const cHigh = stage2(map(fitShape({ category: 'C', strong: 0.88, fit: 0.09 })));
  check('A5 C 类同 fit 同分（97/S；J1.79 计分无类别不对称、无锚）',
    cHigh.scoringResult?.eventCompositeScore === 97 && cHigh.scoringResult?.influenceTier === 'S'
      && cHigh.scoringResult?.influenceFloor === null && cHigh.pass === true,
    cHigh.scoringResult);

  // A6 低 fit A 类：mass 0.02+0.04=0.06 → 影响力 0.3 → E 档。J1.83/C141 前被 D/E
  // 量级门拦；J1.83 契合证据门（sf+fit<0.5 全域，挂量级门前）接管同轴拦截位
  //（E 档域 ⊂ 门域），无锚可救语义不变——tier 派生在门链前，档位审计照落。
  const lowFit = stage2(map(fitShape({ category: 'A', strong: 0.02, fit: 0.04 })));
  check('A6 A 类低 fit（mass 0.06→E 档）：契合证据门拦（J1.83 同轴遮蔽量级门，无锚可救）',
    lowFit.pass === false && /Web3用户契合证据不足/.test(lowFit.blockReason || '')
      && lowFit.scoringResult?.eventCompositeScore === null && lowFit.scoringResult?.influenceTier === 'E',
    { r: lowFit.blockReason, s: lowFit.scoringResult });

  // A7 fit 题缺失：mass 0 → E 档 fail-closed（先于计分分支，composite=null）。
  const noFit = fitShape();
  delete noFit.web3_user_event_fit;
  const mNoFit = map(noFit);
  const sNoFit = stage2(mNoFit);
  check('A7 web3_user_event_fit 缺失：mass 0 → 契合证据门 fail-closed 拦（0%<50%，composite=null，锚键 null）',
    sNoFit.pass === false && /Web3用户契合证据不足/.test(sNoFit.blockReason || '')
      && sNoFit.scoringResult?.eventCompositeScore === null
      && stage1Jev(mNoFit).web3FitAnchoredTier === null,
    { r: sNoFit.blockReason, s: sNoFit.scoringResult });

  // A8 W 类不走标准数学：fit 答案在场也不参与（w_* 三轴不变），无 influenceTier/下限。
  const wAnswers = {
    ...fitShape(),
    event_category: { choice: 'W', probabilities: { W: 0.9, A: 0.1 } },
    // J1.84/C142：w_product_score 已退役——残留键仅证明零消费
    w_product_score: { score: 3, probabilities: { '3': 0.8 } },
    w_bsc_user_appeal: { score: 2.5, probabilities: { '2': 0.8 } },
  };
  const sW = stage2(map(wAnswers));
  check('A8 W 类走 W 数学：fit 不参与（无 influenceTier/influenceScore/下限），单轴和=事件分',
    sW.scoringResult?.influenceTier === null && sW.scoringResult?.influenceScore === null
      && sW.scoringResult?.influenceFloor === null
      && sW.scoringResult?.wProductScore === undefined
      && sW.scoringResult?.eventCompositeScore === round2(sW.scoringResult?.wAppealScore + sW.scoringResult?.timingScore)
      && !/Web3口味契合/.test(sW.reason || ''),
    { s: sW.scoringResult, r: sW.reason });

  console.log('\n── B. 负门共存 ──');

  // B1 unfit 0.88 → 负门拦截维持（偏好不合先于任何量级/计分考量）
  const unfitAnswers = kurumiAnswers({ strongFit: 0.02, unfit: 0.88, web3Fit: { choice: 'unfit', probabilities: { unfit: 0.88, marginal: 0.06, fit: 0.03, strong_fit: 0.02 } } });
  const mb = map(unfitAnswers);
  const sb = stage2(mb);
  check('B1 unfit 0.88 负门拦截维持（偏好不合）', sb.pass === false && sb.blockReason === 'Web3用户偏好不合', sb.blockReason);

  // B2 正负不可同时 ≥0.5（概率和为 1 的天然不变式，代码防御性写法验证：unfit 门先挂）
  const both = kurumiAnswers({ strongFit: 0.6, unfit: 0.5, web3Fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.6, unfit: 0.5, fit: 0, marginal: 0 } } });
  const mb2 = map(both);
  const sb2 = stage2(mb2);
  check('B2 双过半形状（脏数据）：unfit 负门先拦（w3Block 挂在量级分支前）', sb2.pass === false && sb2.blockReason === 'Web3用户偏好不合', sb2.blockReason);

  console.log('\n── C. 审计与 reason ──');

  // C1 jevImpactTier 现为 fit 派生档（不再保留旧 magnitude 原判）；锚审计键恒 null。
  const j1 = stage1Jev(m1);
  check('C1 审计：jevImpactTier=S（fit 派生；旧 magnitude C 档无影响）+ 锚键恒 null',
    j1.jevImpactTier === 'S' && j1.effectiveImpactTier === 'S'
      && j1.web3FitAnchoredTier === null && j1.web3FitStrongPAnchored === null
      && j1.anchoredTier === null,
    { t: j1.jevImpactTier, e: j1.effectiveImpactTier, a: j1.web3FitAnchoredTier, p: j1.web3FitStrongPAnchored });
  check('C1b 概率证据照落：probabilities.web3_user_event_fit.strong_fit=0.88',
    j1.probabilities?.web3_user_event_fit?.strong_fit === 0.88, j1.probabilities?.web3_user_event_fit);

  // C2 reason 精确串：Web3口味契合X%(strong Y%+fit Z%)→分(档)（pass线60）
  check('C2 reason 精确串（fit 来源可追溯，无锚标注）',
    s1.reason === 'Web3口味契合97%(strong 88%+fit 9%)→97(S档)（pass线60）', s1.reason);

  console.log('\n── D. 京小安案（C94 现场）新口径 ──');

  // 京小安 DB 实测 answers 快照（token_narrative 2026-10-17T14:41 分析行，
  // stage1_raw_output 原样：B 0.52 / magnitude 1.35(D档 0.75) / strong_fit 0.57 /
  // dim2 0.7→7 / mem 1.88 / minor_other 0.40 / none 0.66 / within_7d）
  // J1.79：mass 0.57+0.21=0.78 → 78/A 过线——C94「web3 用户喜欢则发布主体无所谓」
  // 由 fit 派生档结构性承接，原「D 档+双锚恰 60」路径退役。
  const jxaTokenData = { symbol: '京小安', name: '首款AI警犬', raw_api_data: { name: '首款AI警犬' } };
  function jxaAnswers({ memScore = 1.88, strongFit = 0.57, dim2Score = 0.7, category = 'B', fitRest = 0.21 } = {}) {
    return {
      event_category: { choice: category, probabilities: { [category]: 0.52, A: 0.2, W: 0.1, D: 0.08, E: 0.05, C: 0.04, F: 0.01 } },
      event_magnitude: { score: 1.35, probabilities: { '0': 0.01, '1': 0.75, '2': 0.16, '3': 0.05, '4': 0.03, '5': 0 } },
      event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.96, within_30d: 0.01, older: 0.01, unknown: 0.01 } },
      dimension2: { score: dim2Score, probabilities: { '0': 0.45, '1': 0.48, '2': 0.03, '3': 0.02, '4': 0.02, '5': 0 } },
      event_quality_veto: { choice: 'none', probabilities: { none: 0.66, subject_unqualified: 0.15, regional_event: 0.1, event_marketing_gimmick: 0.05, event_routine_content_product: 0.02, event_institution_routine: 0.01, low_quality_derivative: 0.01 } },
      web3_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: strongFit, fit: fitRest, marginal: 0.21, unfit: 0.01 } },
      event_subject_entity: { choice: 'product_character', probabilities: { product_character: 0.53, product_functional: 0.34, character_ip: 0.11, event_hotspot: 0.01 } },
      web3_user_name_entity_acceptance: { choice: 'no_entity', probabilities: { no_entity: 0.93, accepted: 0.04, unknown: 0.03 } },
      name_entity_memeability: { score: memScore, probabilities: { '2': 0.88, '0': 0.03, '1': 0.08, '3': 0.01 } },
      name_entity_carrier: { choice: 'existing_entity', probabilities: { existing_entity: 0.49, improvised_entity: 0.42, no_visual_entity: 0.09 } },
      name_event_relevance: { choice: 'exact_match', probabilities: { exact_match: 0.96, semantic: 0.04 } },
      relevance_level: { score: 3.55, probabilities: { '4': 0.75, '3': 0.13, '1': 0.05, '2': 0.04, '0': 0.03 } },
      block_misspelling: { noul: 0.1 },
      quality_spelling: { score: 2.88 },
      quality_reasonability: { score: 1.88 },
    };
  }
  const mapJxa = (answers) => {
    const m = map(answers, jxaTokenData);
    return { m, s: stage2(m), j: stage1Jev(m) };
  };

  // D1 实测快照：fit 0.78 → 78/A 过线；mem 1.88 不再参与（J1.61 题删除）
  const d1 = mapJxa(jxaAnswers());
  check('D1 京小安实测：mass 0.78 → 事件分 78、A 档、过线（原 D 档+双锚路径退役）',
    d1.s.pass === true && d1.s.blockReason == null
      && d1.s.scoringResult?.eventCompositeScore === 78 && d1.s.scoringResult?.influenceTier === 'A'
      && d1.s.scoringResult?.influenceFloor === null,
    { r: d1.s.blockReason, s: d1.s.scoringResult });
  check('D1b reason 精确串：Web3口味契合78%(strong 57%+fit 21%)→78(A档)',
    d1.s.reason === 'Web3口味契合78%(strong 57%+fit 21%)→78(A档)（pass线60）', d1.s.reason);
  check('D1c 审计：jevImpactTier=A + 锚键 null（web3FitAnchoredTier/web3FitStrongPAnchored）',
    d1.j.jevImpactTier === 'A' && d1.j.web3FitAnchoredTier === null
      && d1.j.web3FitStrongPAnchored === null && d1.j.anchoredTier === null,
    { t: d1.j.jevImpactTier, a: d1.j.web3FitAnchoredTier, p: d1.j.web3FitStrongPAnchored });

  // D2 mem 2.2 与 mem 1.88 同结果：mem 题已删，不得再影响任何结果
  const d2 = mapJxa(jxaAnswers({ memScore: 2.2 }));
  check('D2 mem 1.88 vs 2.2 同分同档同判定（mem 题已删、无地板门）',
    d2.s.pass === d1.s.pass && d2.s.scoringResult?.eventCompositeScore === d1.s.scoringResult?.eventCompositeScore
      && d2.s.scoringResult?.influenceTier === d1.s.scoringResult?.influenceTier,
    { d1: d1.s.scoringResult, d2: d2.s.scoringResult });
  check('D2b 传播锚键缺席：spreadScore/web3FitSpreadAnchor 不再产出',
    d2.s.scoringResult?.spreadScore === undefined && d2.s.jev?.web3FitSpreadAnchor === undefined,
    { spreadScore: d2.s.scoringResult?.spreadScore, anchor: d2.s.jev?.web3FitSpreadAnchor });

  // D3 strong_fit 0.49 贴线 + fit 0.05 → mass 0.54 → 事件分 54 拦（阈值以下无锚特判）
  const d3 = mapJxa(jxaAnswers({ strongFit: 0.49, fitRest: 0.05 }));
  check('D3 B 类 strong_fit 0.49+fit 0.05 (mass 0.54)：事件分 54、B 档、事件分不足拦、无下限',
    d3.s.pass === false && /事件分不足（54<60）/.test(d3.s.blockReason || '')
      && d3.s.scoringResult?.eventCompositeScore === 54 && d3.s.scoringResult?.influenceTier === 'B'
      && d3.s.scoringResult?.influenceFloor === null,
    { r: d3.s.blockReason, s: d3.s.scoringResult });

  // D4 dim2 只影响旧题、不影响计分：0.7 vs 5.0 同分
  const d4 = mapJxa(jxaAnswers({ dim2Score: 5.0 }));
  check('D4 dim2 0.7 vs 5.0 同分同档（dim2 不参与 J1.79 计分）',
    d4.s.scoringResult?.eventCompositeScore === 78
      && d4.s.scoringResult?.eventCompositeScore === d1.s.scoringResult?.eventCompositeScore
      && d4.s.jev?.web3FitSpreadAnchor === undefined,
    { t: d4.s.scoringResult?.eventCompositeScore, a: d4.s.jev?.web3FitSpreadAnchor });

  // D5 C 类同 fit 同分：档位不因类别改写（旧「C 类不豁」在 fit 派生下无对象；
  // 保留断言=锚键恒 null、分数照 fit 计）
  const d5 = mapJxa(jxaAnswers({ category: 'C' }));
  check('D5 C 类同 fit：78/A 照 fit 计分、锚键 null（无类别豁免/锚定）',
    d5.s.scoringResult?.eventCompositeScore === 78 && d5.s.scoringResult?.influenceTier === 'A'
      && d5.j.web3FitAnchoredTier === null && d5.s.jev?.web3FitSpreadAnchor == null,
    { s: d5.s.scoringResult, a: d5.j.web3FitAnchoredTier });

  // D6 unfit 负门 B 类共存：Web3 用户不喜欢 → 任何量级/计分不救（对称负门）
  const d6a = jxaAnswers();
  d6a.web3_user_event_fit = { choice: 'unfit', probabilities: { unfit: 0.88, marginal: 0.06, fit: 0.03, strong_fit: 0.02 } };
  const d6 = mapJxa(d6a);
  check('D6 B 类 unfit 0.88 负门拦截维持（偏好不合先于计分）',
    d6.s.pass === false && d6.s.blockReason === 'Web3用户偏好不合', d6.s.blockReason);

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
