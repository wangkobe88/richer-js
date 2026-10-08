#!/usr/bin/env node
/**
 * C42 世界级主体产品豁免币安交互（wInteractionExempt）——本地零 DB 单测
 * （2026-10-01 用户裁定「世界级主体发布产品（不是版本更新），可以豁免跟币安交互」，
 * RedCoin 案 0xe2881a7ac454c473a8b4c858732402154e107777：HSBC 官宣港元稳定币
 * RedCoin——W 类数学 41.45 < 60 被拦，唯交互轴 0.09（HSBC≠币安系，事实正确的
 * 0 分）压死总分；机构本身的量级才是叙事价值，交互轴为币安生态叙事票设计）
 *
 * 豁免条件（全中才豁免）：原生 W 类（改道票不豁免）+ effTier S/A（世界级/头部
 * 主体）+ 新产品带 P(2)+P(3)≥0.5（发布产品，排除版本更新/一般新功能）+ 交互已落
 * 无交互带（<10 分；交互 ≥10 的票三轴照算）。效果：产品+时效两轴归一化百分制
 * （÷60×100），pass 线 60 不变；wInteraction 照常落库审计但不参与总分。
 *
 * 覆盖：
 *   A. RedCoin 实测 answers 数值复现：豁免命中 → 41.45 → 68.93 pass → high
 *   B. 豁免矩阵：tier 不足 / 版本更新形状 / 交互≥10 / 非 W 类 / 骑乘改道 / cashtag 改道
 *   C. 高交互票不受豁免影响（三轴照算，剔除反而亏分）
 *   D. 审计与 reason：stage2 jev.wInteractionExempt 落位 / reason 前缀 / 交互分照常落库
 *   E. 源码接线 + 版本断言（mapper-only 切分，C42 落地时题集 J1.24 不动；
 *      现 J1.25 = C43 subject_unqualified 修正，W 类题零改动）
 *
 * 用法：node scripts/_test_w_interaction_exempt.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

// ── RedCoin 实测 answers 快照（2026-10-01 J1.24 run，DB 实证）──────────────────
// category W 0.68 / magnitude 3.81（A 档带 4:0.72） / within_7d 0.95 / dimension2 4.49 /
// block none 0.91 / name_referent super_ip 0.70 / web3_fit fit 0.45 /
// w_product_score 1.92（18-26 带 0.77） / w_binance_interaction 0.01（0 档 1.00 置信 0.99） /
// relevance exact_match 0.91 / misspelling 0.13 / reasonability 1.87
const redcoinTokenData = { symbol: 'RedCoin', name: 'RedCoin', raw_api_data: { name: 'RedCoin' } };

function redcoinAnswers({
  category = 'W',
  magnitude = 3.81,
  wProductScore = 1.92,
  wProductProbs = { '0': 0.05, '1': 0.08, '2': 0.77, '3': 0.1 },
  wInteractionScore = 0.01,
} = {}) {
  return {
    event_category: { choice: category, probabilities: { W: 0.68, D: 0.31, B: 0.01 } },
    event_magnitude: { score: magnitude, probabilities: { '3': 0.16, '4': 0.72, '5': 0.08 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.95 } },
    dimension2: { score: 4.49, probabilities: { '4': 0.42, '5': 0.56 } },
    block_reason: { choice: 'none', probabilities: { none: 0.91 } },
    name_referent: { choice: 'super_ip', probabilities: { super_ip: 0.7, subject_self: 0.07 } },
    web3_fit: { choice: 'fit', probabilities: { fit: 0.45, strong_fit: 0.18 } },
    w_product_score: { score: wProductScore, probabilities: wProductProbs },
    w_binance_interaction: { score: wInteractionScore, probabilities: { '0': 1, '1': 0, '2': 0, '3': 0 } },
    relevance_type: { choice: 'exact_match', probabilities: { exact_match: 0.91 } },
    relevance_level: { score: 4, probabilities: { '4': 0.9 } },
    block_misspelling: { noul: 0.13 },
    quality_spelling: { score: 6, probabilities: { '3': 0.9 } },
    quality_reasonability: { score: 1.87, probabilities: { '2': 0.88 } },
  };
}

function makeContext({ tokenData = redcoinTokenData, twitterInfo = null } = {}) {
  return {
    tokenData,
    twitterInfo,
    includeBrandHijack: false,
    credibleEventAnchor: false,
    tweetClassification: null,
    callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  };
}

function stage2Of(mapped) {
  return mapped?.stage2DataToSave?.parsed_output || {};
}
function stage3Of(mapped) {
  return mapped?.stage3DataToSave?.parsed_output || {};
}

async function main() {
  const { mapStandardAnswers } = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const { JEV_QUESTIONS_VERSION } = await import('../src/narrative/analyzer/llm/jev-questions.mjs');

  console.log('\n── A. RedCoin 实测 answers 数值复现 ──');

  const m1 = mapStandardAnswers(redcoinAnswers(), makeContext());
  const s2 = stage2Of(m1);
  check('A1 豁免命中：产品 16.36+时效 25 两轴归一 = 68.93（<60 拦截 → pass）',
    s2.pass === true && s2.scoringResult.totalScore === 68.93,
    { pass: s2.pass, totalScore: s2.scoringResult.totalScore });
  check('A1b 旧口径对照：三轴 16.36+0.09+25=41.45 曾拦——wInteraction 照常计算 0.09',
    s2.scoringResult.wInteractionScore === 0.09 && s2.scoringResult.wProductScore === 16.36,
    s2.scoringResult);
  check('A2 审计落位：jev.wInteractionExempt = {tier A, newProductP 0.87}',
    s2.jev?.wInteractionExempt?.tier === 'A' && s2.jev?.wInteractionExempt?.newProductP === 0.87,
    s2.jev?.wInteractionExempt);
  check('A3 stage3 全链：relevance 20 + 质量 16.87 → 总分 78.23 high',
    stage3Of(m1).category_agg === 'high' && m1.stageFinalData.totalScore === 78.23,
    { agg: stage3Of(m1).category_agg, total: m1.stageFinalData.totalScore });
  check('A4 reason 前缀「世界级主体产品豁免币安交互(C42)」+ 两轴归一标注',
    /世界级主体产品豁免币安交互\(C42\)/.test(m1.llmResult?.reason || '')
      && /两轴归一/.test(s2.reason || ''),
    { reason: m1.llmResult?.reason, stage2: s2.reason });

  console.log('\n── B. 豁免矩阵（任一条件不中即维持三轴） ──');

  // B1 量级不足：C 档主体（普通项目发产品）不豁免，三轴 41.45 拦
  const m2 = mapStandardAnswers(redcoinAnswers({ magnitude: 2.4 }), makeContext());
  const s2b = stage2Of(m2);
  check('B1 tier=C：不豁免，三轴 41.45 维持拦截',
    s2b.pass === false && s2b.scoringResult.totalScore === 41.45 && !s2b.jev?.wInteractionExempt,
    { total: s2b.scoringResult.totalScore, exempt: s2b.jev?.wInteractionExempt });

  // B2 版本更新形状：P(0) 高（小改进/边缘更新带 0.7）→ newProductP 0.3 < 0.5 不豁免
  const m3 = mapStandardAnswers(redcoinAnswers({
    wProductScore: 0.2,
    wProductProbs: { '0': 0.7, '1': 0.2, '2': 0.1, '3': 0 },
  }), makeContext());
  const s2c = stage2Of(m3);
  check('B2 版本更新（P(0)=0.7）：不豁免（裁定「不是版本更新」条件）',
    s2c.jev?.wInteractionExempt === null,
    s2c.jev?.wInteractionExempt);

  // B3 交互 ≥10（生态热度档）：不豁免，三轴照算 55.86 拦（豁免只在无交互带生效）
  const m4 = mapStandardAnswers(redcoinAnswers({ wInteractionScore: 1.5 }), makeContext());
  const s2d = stage2Of(m4);
  check('B3 交互 14.5（≥10 生态热度带）：不豁免，三轴 16.36+14.5+25=55.86 拦',
    s2d.pass === false && s2d.scoringResult.totalScore === 55.86 && !s2d.jev?.wInteractionExempt,
    { total: s2d.scoringResult.totalScore, exempt: s2d.jev?.wInteractionExempt });

  // B4 非 W 类（D）：走标准数学，豁免机制不触达
  const m5 = mapStandardAnswers(redcoinAnswers({ category: 'D' }), makeContext());
  const s2e = stage2Of(m5);
  check('B4 D 类走标准数学（A 档 34+传播+时效），wInteractionExempt null',
    s2e.scoringResult.category === 'D' && s2e.jev?.wInteractionExempt === null,
    { cat: s2e.scoringResult.category, exempt: s2e.jev?.wInteractionExempt });

  // B5 骑乘改道：B 类 + subject_self 0.62/super_ip 0.05 → rideDetour 改道 W 数学，
  // 但非原生 W（isW false）→ 不豁免——改道票有各自的拦截语义（豁免范围限定原生 W）
  const rideAnswers = redcoinAnswers({
    category: 'B',
    wProductScore: 2.9,
    wProductProbs: { '0': 0.03, '1': 0.05, '2': 0.8, '3': 0.12 },
  });
  rideAnswers.name_referent = { choice: 'subject_self', probabilities: { subject_self: 0.62, super_ip: 0.05 } };
  const m6 = mapStandardAnswers(rideAnswers, makeContext());
  const s2f = stage2Of(m6);
  check('B5 骑乘改道票（B 类 subject_self 0.62）：进 W 数学但不豁免（三轴照算）',
    s2f.scoringResult.category === 'W' && s2f.jev?.wInteractionExempt === null,
    { cat: s2f.scoringResult.category, exempt: s2f.jev?.wInteractionExempt });

  // B6 cashtag 改道：语料含 $RED与币名匹配 + Jev 原判 D → 强制 W 数学（iNu 案拦截
  // 语义），cashtagForced=true → 不豁免
  const cashtagCtx = makeContext({
    twitterInfo: { text: 'just bought $RedCoin , next 100x', in_reply_to: null },
  });
  const m7 = mapStandardAnswers(redcoinAnswers({ category: 'D' }), cashtagCtx);
  const s2g = stage2Of(m7);
  check('B6 cashtag 改道票（$RedCoin 命中 + 原判 D）：强制 W 数学但不豁免',
    s2g.scoringResult.category === 'W' && s2g.jev?.wInteractionExempt === null,
    { cat: s2g.scoringResult.category, exempt: s2g.jev?.wInteractionExempt });

  console.log('\n── C. 高交互票不受豁免影响 ──');

  // C1 S 档主体 + 新产品 + 交互 35（深度交互）：豁免条件 ④ 不中 → 三轴照算高分
  const m8 = mapStandardAnswers(redcoinAnswers({
    magnitude: 4.6,
    wProductScore: 2.9,
    wProductProbs: { '0': 0.03, '1': 0.05, '2': 0.8, '3': 0.12 },
    wInteractionScore: 3.9,
  }), makeContext());
  const s2h = stage2Of(m8);
  // wProduct = 18+0.9×8 = 25.2; wInteraction = 30+0.9×10 = 39; timeliness 25
  check('C1 深度交互 39 分票：三轴照算 25.2+39+25=89.2（剔除反而亏，豁免正确不触）',
    s2h.pass === true && s2h.scoringResult.totalScore === 89.2 && s2h.jev?.wInteractionExempt === null,
    { total: s2h.scoringResult.totalScore, exempt: s2h.jev?.wInteractionExempt });

  console.log('\n── D. 审计与 reason ──');

  check('D1 豁免命中时 stage2Total 不含交互轴（68.93 ≠ 三轴 41.45）',
    s2.scoringResult.totalScore === 68.93 && s2.scoringResult.wInteractionScore === 0.09,
    s2.scoringResult);
  check('D2 llmResult.reason 完整链（豁免前缀 + 事件分 41.36）',
    /豁免币安交互\(C42\).*事件分41\.36/.test(m1.llmResult?.reason || ''),
    m1.llmResult?.reason);

  console.log('\n── E. 源码接线 + 版本 ──');

  const fs = require('fs');
  const src = fs.readFileSync('src/narrative/analyzer/llm/jev-result-mapper.mjs', 'utf8');
  check('E1 mapper：wInteractionExempt 四条件（原生W/S-A档/新产品带/无交互带）',
    /const wInteractionExempt = /.test(src) === false // 声明是 let
    && /wInteractionExempt = isW && rideMass == null && !cashtagForced/.test(src)
    && /\(effTier === 'S' \|\| effTier === 'A'\)/.test(src)
    && /wNewProductP >= 0\.5/.test(src)
    && /wInteraction < 10/.test(src));
  check('E2 归一化计分 + 审计字段落位',
    /\(wProduct \+ timeliness\) \/ 60 \* 100/.test(src)
      && /wInteractionExempt: wInteractionExempt \? \{ tier: effTier, newProductP: wNewProductP \} : null/.test(src));
  // C42 本体是 mapper-only 切分（落地时题集 J1.24 不动）；后续 J1.25 = C43
  // subject_unqualified 主体口径修正（不触 W 类题），版本随之推进
  check('E3 题集版本 ≥J1.24（C42 mapper-only 落地；现 J1.28=referent_memeability 恒带 bump）',
    parseInt(JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 24, JEV_QUESTIONS_VERSION);

  console.log(`\n═══════ ${passed} passed, ${failed} failed ═════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('SUITE ERROR', e); process.exit(1); });
