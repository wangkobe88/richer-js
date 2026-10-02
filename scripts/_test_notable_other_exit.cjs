#!/usr/bin/env node
/**
 * J1.26 notable_other 全域退出 name_referent 阻断侧（A2）——本地零 DB 单测
 * （2026-10-02 用户裁定 C54 狮鹫案 0xcb808ef1…7777，两步演化：①「超级IP就那么
 * 几个，名字不是它们就不行吗」→ B 类退出；②「CONVICTION/YAYA 案的核心问题
 * 并不是实体不够知名，而是实体根本没有被接纳为 Web3 meme 币的可能」→ 知名度
 * 梯度（notable_other「知名但非超级IP」）是错误的判定轴，全域退出阻断侧。
 * 正确的轴 = Web3 meme 可接纳性，已由 web3_fit unfit 负门（J1.19 全域）承载：
 * 狮鹫 strong_fit 0.96 放、严肃词汇/普通人名 unfit 拦。真有独立拦截信息的只有
 * minor_other（无名对象，YAYA 案）与 common_word（纯截词，CONVICTION 案）。
 *
 * 改动：nameReferentBlock 阻断质量在所有类别（C/D/F/G/B/W + superIP 通道）
 * 只累计 minor_other+common_word。审计字段 stage1.jev.nrNotableExempt（全域）
 * 记录「旧拦新放」形状 {minorCommon, notable}。
 *
 * 实测影响面（2026-10-02 库扫）：B 143 票 98 拦 → 52 拦 + 46 翻案候选；
 * W 88→60（28 放，含 Manus 骑乘家族）；F 26→20（6 放）；市场实证错过成本：
 * 狮鹫 7.8 分钟毕业、首→峰 12.3x。
 *
 * 覆盖：
 *   A. 狮鹫案实测 answers 快照复现：name 门解除 → 事件分 67.5 pass；
 *      exact_match 全链 high(78.7)；partial_match 关联性 2 分截断仍拦（豁免≠放行）
 *   B. 全域作用域矩阵：C/W/D 类 notable 主导均不再由 name 门拦（进各自数学）/
 *      C 类 CONVICTION 形状保护移交 web3_fit unfit 负门 / minor(common) 主导
 *      仍拦 / 三项全低不拦 / superIP 通道同样解除 + YAYA 边缘形状兜底
 *   C. 审计字段矩阵：旧拦新放形状落 {minorCommon, notable}（全域含 C 类）；
 *      新口径也拦 → null
 *   D. 源码接线 + 版本断言（mapper-only 切分，题集 J1.25 不动）
 *
 * 用法：node scripts/_test_notable_other_exit.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

// ── 狮鹫案实测 answers 快照（2026-10-02 02:08 J1.25 run，DB 实证；relevance
// 未落库按语义取 exact/partial 两形）──────────────────────────────────────────
function griffinAnswers({ relevance = 'exact_match' } = {}) {
  return {
    event_category: { choice: 'B', probabilities: { A: 0.02, B: 0.71, D: 0.14, E: 0.1, G: 0.01, W: 0.02 } },
    event_magnitude: { score: 2.8, probabilities: { '1': 0.03, '2': 0.15, '3': 0.65, '4': 0.16, '5': 0.01 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.95 } },
    dimension2: { score: 3.5, probabilities: { '3': 0.5, '4': 0.45 } },
    block_reason: { choice: 'none', probabilities: { none: 0.81, marketing_gimmick: 0.03, subject_unqualified: 0.04, low_quality_derivative: 0.05, routine_content_product: 0.03 } },
    name_referent: { choice: 'notable_other', probabilities: { super_ip: 0.14, common_word: 0.03, minor_other: 0.08, none_related: 0.01, subject_self: 0.29, notable_other: 0.45 } },
    web3_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.96, fit: 0.04 } },
    relevance_type: { choice: relevance, probabilities: relevance === 'exact_match' ? { exact_match: 0.85 } : { partial_match: 0.6, exact_match: 0.3 } },
    relevance_level: { score: 3, probabilities: { '3': 0.7 } },
    block_misspelling: { noul: 0.1 },
    quality_spelling: { score: 5, probabilities: { '4': 0.8 } },
    quality_reasonability: { score: 2.2, probabilities: { '2': 0.8 } },
  };
}

function makeContext({ twitterText = '新模型Griffin的翻译刚好还是狮鹫，完美符合bsc的两字大金定律' } = {}) {
  return {
    tokenData: { symbol: '狮鹫', name: 'Griffin', raw_api_data: { name: 'Griffin', symbol: '狮鹫' } },
    twitterInfo: { text: twitterText, in_reply_to: null },
    includeBrandHijack: false,
    credibleEventAnchor: false,
    tweetClassification: null,
    callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  };
}

function stage1Of(mapped) { return mapped?.stage1DataToSave?.parsed_output || {}; }
function stage2Of(mapped) { return mapped?.stage2DataToSave?.parsed_output || {}; }
function stage3Of(mapped) { return mapped?.stage3DataToSave?.parsed_output || {}; }

async function main() {
  const { mapStandardAnswers, mapSuperIPAnswers } = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const { JEV_QUESTIONS_VERSION } = await import('../src/narrative/analyzer/llm/jev-questions.mjs');

  console.log('\n── A. 狮鹫案数值复现（B 0.71 / tierB 3:0.65 / notable 0.45 / strong_fit 0.96）──');

  const m1 = mapStandardAnswers(griffinAnswers(), makeContext());
  const s2 = stage2Of(m1);
  check('A1 name 门解除：nameReferentBlockMass null + 事件分 67.5 pass（27+25.5+15）',
    s2.pass === true && s2.jev?.nameReferentBlockMass === null && s2.scoringResult.totalScore === 67.5,
    { pass: s2.pass, nrMass: s2.jev?.nameReferentBlockMass, total: s2.scoringResult?.totalScore });
  check('A1b 旧口径对照：minor 0.08+common 0.03+notable 0.45=0.56 曾拦（notable 唯一抬过门槛项）',
    s2.jev?.nameReferent === 'notable_other' && s2.jev?.nameReferentProbability === 0.45);
  check('A2 审计落位：stage1.jev.nrNotableExempt = {minorCommon 0.11, notable 0.45}',
    stage1Of(m1).jev?.nrNotableExempt?.minorCommon === 0.11
      && stage1Of(m1).jev?.nrNotableExempt?.notable === 0.45,
    stage1Of(m1).jev?.nrNotableExempt);
  check('A3 翻案主线（关联 exact）：总分 78.7 → high',
    stage3Of(m1).category_agg === 'high' && m1.llmResult?.rating === 'high',
    { agg: stage3Of(m1).category_agg, rating: m1.llmResult?.rating, reason: m1.llmResult?.reason });

  const m2 = mapStandardAnswers(griffinAnswers({ relevance: 'partial_match' }), makeContext());
  check('A4 豁免≠放行：关联 partial_match 2 分截断仍 low（下游门兜底，关联弱本质仍拦）',
    m2.llmResult?.rating === 'low' && /关联性不足/.test(m2.llmResult?.reason || ''),
    { rating: m2.llmResult?.rating, reason: m2.llmResult?.reason });

  console.log('\n── B. 全域作用域矩阵（A2：notable 全域退出阻断侧）──');

  // B1 C 类（旧 CONVICTION 截词语义域）：notable 主导不再由 name 门拦
  const cAnswers = griffinAnswers();
  cAnswers.event_category = { choice: 'C', probabilities: { C: 0.75, B: 0.2 } };
  cAnswers.name_referent = { choice: 'notable_other', probabilities: { notable_other: 0.62, minor_other: 0.06, common_word: 0, subject_self: 0.3 } };
  const mc = mapStandardAnswers(cAnswers, makeContext());
  check('B1a C 类 notable 0.62 主导：name 门不再拦 + 审计落位（全域）',
    stage2Of(mc).jev?.nameReferentBlockMass === null
      && stage1Of(mc).jev?.nrNotableExempt?.notable === 0.62
      && stage1Of(mc).jev?.nrNotableExempt?.minorCommon === 0.06,
    { mass: stage2Of(mc).jev?.nameReferentBlockMass, audit: stage1Of(mc).jev?.nrNotableExempt });
  check('B1b C 类放行后走标准数学：27+25.5+15=67.5 pass（量级/传播/时效自行把关）',
    stage2Of(mc).pass === true && stage2Of(mc).scoringResult?.totalScore === 67.5,
    { pass: stage2Of(mc).pass, total: stage2Of(mc).scoringResult?.totalScore });

  // B1c CONVICTION 保护移交（裁定第②步：拦截轴=可接纳性非知名度）：同形状 +
  // web3_fit unfit 0.62 → unfit 负门拦截（J1.19 全域，不依赖类别）
  const cvAnswers = { ...cAnswers, web3_fit: { choice: 'unfit', probabilities: { unfit: 0.62, marginal: 0.2, fit: 0.12, strong_fit: 0.06 } } };
  const mcv = mapStandardAnswers(cvAnswers, makeContext());
  check('B1c CONVICTION 形状新兜底：web3_fit unfit 0.62 负门拦截（拦截判据=可接纳性非知名度）',
    mcv.llmResult?.rating === 'low' && /Web3用户偏好不合/.test(mcv.llmResult?.reason || ''),
    { rating: mcv.llmResult?.rating, reason: mcv.llmResult?.reason });

  // B2 W 类（旧 ChainPulse 补位语义域）：notable 主导不再由 name 门拦 → 进 W 数学
  const wAnswers = griffinAnswers();
  wAnswers.event_category = { choice: 'W', probabilities: { W: 0.8, B: 0.15 } };
  wAnswers.name_referent = { choice: 'notable_other', probabilities: { notable_other: 0.55, minor_other: 0.13, common_word: 0.05, super_ip: 0.2 } };
  const mw = mapStandardAnswers(wAnswers, makeContext());
  check('B2 W 类 notable 0.55 主导：name 门不再拦，改由 W 数学把关（fixture 无 w_product → 产品0+时效25=25 总分不足拦）',
    stage2Of(mw).jev?.nameReferentBlockMass === null && stage2Of(mw).pass === false
      && /W类总分不足（25<60）/.test(mw.llmResult?.reason || ''),
    { mass: stage2Of(mw).jev?.nameReferentBlockMass, pass: stage2Of(mw).pass, reason: mw.llmResult?.reason });

  // B3 D 类抽查：notable 旧合计 0.77 → 不再拦，走标准数学
  const dAnswers = griffinAnswers();
  dAnswers.event_category = { choice: 'D', probabilities: { D: 0.7, B: 0.25 } };
  dAnswers.name_referent = { choice: 'notable_other', probabilities: { notable_other: 0.7, minor_other: 0.05, common_word: 0.02 } };
  const md = mapStandardAnswers(dAnswers, makeContext());
  check('B3 D 类 notable 0.77 旧合计：name 门不再拦 + 标准数学 67.5 pass + 审计落位',
    stage2Of(md).jev?.nameReferentBlockMass === null && stage2Of(md).pass === true
      && stage1Of(md).jev?.nrNotableExempt?.notable === 0.7,
    { mass: stage2Of(md).jev?.nameReferentBlockMass, pass: stage2Of(md).pass, audit: stage1Of(md).jev?.nrNotableExempt });

  // B4 minor_other 主导（YAYA 无名对象语义）：全域仍拦
  const yAnswers = griffinAnswers();
  yAnswers.name_referent = { choice: 'minor_other', probabilities: { minor_other: 0.55, notable_other: 0.1, common_word: 0.02, subject_self: 0.3 } };
  const my = mapStandardAnswers(yAnswers, makeContext());
  check('B4 minor 0.55 主导：仍拦（无名对象语义保持，有独立拦截信息）',
    stage2Of(my).pass === false && /名字指向无名对象/.test(my.llmResult?.reason || ''),
    my.llmResult?.reason);

  // B5 common_word 主导（CONVICTION 纯截词语义）：全域仍拦
  const kAnswers = griffinAnswers();
  kAnswers.name_referent = { choice: 'common_word', probabilities: { common_word: 0.52, minor_other: 0.03, notable_other: 0.2, super_ip: 0.2 } };
  const mk = mapStandardAnswers(kAnswers, makeContext());
  check('B5 common 0.52 主导：仍拦（纯截词语义保持，有独立拦截信息）',
    stage2Of(mk).pass === false && /截词/.test(mk.llmResult?.reason || ''),
    mk.llmResult?.reason);

  // B6 三项全低：不拦（普通票零影响）
  const nAnswers = griffinAnswers();
  nAnswers.name_referent = { choice: 'super_ip', probabilities: { super_ip: 0.55, subject_self: 0.2, minor_other: 0.1, common_word: 0.05, notable_other: 0.1 } };
  const mn = mapStandardAnswers(nAnswers, makeContext());
  check('B6 三项全低（super_ip 0.55 主）：不拦 + 无审计字段',
    stage2Of(mn).jev?.nameReferentBlockMass === null && stage1Of(mn).jev?.nrNotableExempt === null);

  // B7 superIP 通道（person→C 域）同样解除：notable 主导不再拦，走评分管线
  const spAnswers = griffinAnswers();
  spAnswers.name_referent = { choice: 'notable_other', probabilities: { notable_other: 0.6, minor_other: 0.05, common_word: 0.02 } };
  const msp = mapSuperIPAnswers(spAnswers, {
    ...makeContext(),
    superIPInfo: { name: 'CZ', type: 'person', tier: 'S' },
    preScores: { tierScore: 39, timeliness: 25, baseEventScore: 59 },
  });
  const spPrestage = msp?.prestageDataToSave?.parsed_output || {};
  check('B7 superIP 通道（person→C 域）notable 0.67 旧合计：name 门不再拦 + 评分管线走通',
    spPrestage.jev?.nameReferentBlockMass == null && spPrestage.pass === true,
    { mass: spPrestage.jev?.nameReferentBlockMass, pass: spPrestage.pass, reason: msp?.llmResult?.reason });

  // B7b YAYA 边缘形状（minor 0.41+notable 0.14，旧合计 0.55 曾拦；A2 后 minor
  // 单项不过线 → name 门放）：新兜底 = web3_fit unfit 负门拦截
  const yayaAnswers = griffinAnswers();
  yayaAnswers.name_referent = { choice: 'minor_other', probabilities: { minor_other: 0.41, notable_other: 0.14, common_word: 0, subject_self: 0.3 } };
  yayaAnswers.web3_fit = { choice: 'unfit', probabilities: { unfit: 0.58, marginal: 0.22, fit: 0.14, strong_fit: 0.06 } };
  const myaya = mapStandardAnswers(yayaAnswers, makeContext());
  check('B7b YAYA 边缘形状（minor 0.41+notable 0.14 旧拦新放）：unfit 0.58 负门兜底拦截',
    myaya.llmResult?.rating === 'low' && /Web3用户偏好不合/.test(myaya.llmResult?.reason || ''),
    { rating: myaya.llmResult?.rating, reason: myaya.llmResult?.reason });

  console.log('\n── C. 审计字段矩阵 ──');

  // C1 边界恰好压线：minor+common 0.11 + notable 0.39 = 0.50 → 记审计
  const eAnswers = griffinAnswers();
  eAnswers.name_referent = { choice: 'notable_other', probabilities: { notable_other: 0.39, minor_other: 0.11, common_word: 0 } };
  const me = mapStandardAnswers(eAnswers, makeContext());
  check('C1 边界：minor+common 0.11 + notable 0.39 = 0.50 恰过门槛 → 记审计',
    stage1Of(me).jev?.nrNotableExempt?.notable === 0.39 && stage1Of(me).jev?.nrNotableExempt?.minorCommon === 0.11,
    stage1Of(me).jev?.nrNotableExempt);

  // C2 新口径也拦（minor+common 自身 ≥0.5）：不是翻案形状 → null
  const fAnswers = griffinAnswers();
  fAnswers.name_referent = { choice: 'minor_other', probabilities: { minor_other: 0.45, common_word: 0.1, notable_other: 0.3 } };
  const mf = mapStandardAnswers(fAnswers, makeContext());
  check('C2 minor+common 0.55 自身过门槛（新口径也拦）：nrNotableExempt null',
    stage2Of(mf).jev?.nameReferentBlockMass === 0.55 && stage1Of(mf).jev?.nrNotableExempt === null,
    { mass: stage2Of(mf).jev?.nameReferentBlockMass, audit: stage1Of(mf).jev?.nrNotableExempt });

  // C3 全域审计（A2 升级点）：C 类 notable 拦截票审计同样落位（不再限 B 类）
  check('C3 C 类 notable 翻案票：nrNotableExempt 落位（A2 全域，B1a 的机器复核）',
    stage1Of(mc).jev?.nrNotableExempt?.notable === 0.62,
    stage1Of(mc).jev?.nrNotableExempt);

  console.log('\n── D. 源码接线 + 版本 ──');

  const fs = require('fs');
  const src = fs.readFileSync('src/narrative/analyzer/llm/jev-result-mapper.mjs', 'utf8');
  check('D1 nameReferentBlock：blockKeys 无条件只含 minor_other+common_word（无类别三元）',
    /const blockKeys = \['minor_other', 'common_word'\];/.test(src)
      && !/const blockKeys = category === 'B'/.test(src)
      && /for \(const k of blockKeys\)/.test(src));
  check('D1b 阻断标签表无 notable_other 键（label 仅存历史行 reason 展示注释）',
    !/notable_other: '名字指向知名但非超级IP'/.test(src));
  check('D2 注释含 J1.26 裁定说明 + 审计字段无条件接线（无 category === \'B\' 包裹）',
    /J1\.26（2026-10-02 用户裁定，C54 狮鹫案/.test(src)
      && /nrNotableExempt,/.test(src)
      && /let nrNotableExempt = null;/.test(src)
      && !/if \(category === 'B'\) \{\s*\n\s*const nrProbs/.test(src));
  check('D3 题集版本 J1.25 不动（J1.26 为 mapper-only 切分，题面零改动）',
    JEV_QUESTIONS_VERSION === 'J1.25', JEV_QUESTIONS_VERSION);

  console.log(`\n═══════ ${passed} passed, ${failed} failed ═══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('SUITE ERROR', e); process.exit(1); });
