#!/usr/bin/env node
/**
 * J1.26 notable_other 全域退出 web3_user_name_entity_acceptance 阻断侧（A2）——本地零 DB 单测
 * （2026-10-02 用户裁定 C54 狮鹫案 0xcb808ef1…7777，两步演化：①「超级IP就那么
 * 几个，名字不是它们就不行吗」→ B 类退出；②「CONVICTION/YAYA 案的核心问题
 * 并不是实体不够知名，而是实体根本没有被接纳为 Web3 meme 币的可能」→ 知名度
 * 梯度（notable_other「知名但非超级IP」）是错误的判定轴，全域退出阻断侧。
 * 正确的轴 = Web3 meme 可接纳性，已由 web3_user_event_fit unfit 负门（J1.19 全域）承载。
 *
 * 【C108 断代（2026-10-19）】：nr 阻断位（nameReferentBlock）连同审计键
 * nrNotableExempt/nameReferentBlockMass 整体退役——名字拦截责任全部移交
 * name_form 单门（J1.42「合不合适作为 meme 币」，EARLY 案触发）。minor_other
 * （YAYA 无名对象）/common_word（纯截词）的拦截语义按 C108 四分支由
 * name_form 判：无名实体→分支①、无圈内感知句片段→分支②。旧 J1.25 快照
 * fixture（无 name_form 键）= 旧缓存行形状 fail-open 放行。
 *
 * 覆盖（C108 后语义）：
 *   A. 狮鹫案实测 answers 快照复现：nr 门退役 → 事件分 67.5 pass；
 *      exact_match 全链 high(78.7)；partial_match 关联性 2 分截断仍拦（豁免≠放行）
 *   B. 全域作用域矩阵：C/W/D 类 notable 主导放行（进各自数学）/ C 类
 *      CONVICTION 形状保护移交 web3_user_event_fit unfit 负门 / minor(common) 主导
 *      拦截移交 name_form（旧快照无键放行）/ YAYA 边缘形状 unfit 兜底
 *   C. 审计字段矩阵：nr 概率纯观察（nameReferent/Probability 保留），
 *      退役审计键不落（undefined）
 *   D. 源码接线 + 版本断言（nameReferentBlock 函数/审计键退役反证）
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
    event_token_block_reason: { choice: 'none', probabilities: { none: 0.81, event_marketing_gimmick: 0.03, subject_unqualified: 0.04, low_quality_derivative: 0.05, event_routine_content_product: 0.03 } },
    web3_user_name_entity_acceptance: { choice: 'unknown', probabilities: { accepted: 0.14, no_entity: 0.04, unknown: 0.82 } },
    web3_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.96, fit: 0.04 } },
    name_event_relevance: { choice: relevance, probabilities: relevance === 'exact_match' ? { exact_match: 0.85 } : { partial_match: 0.6, exact_match: 0.3 } },
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
  const { mapStandardAnswers } = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const { JEV_QUESTIONS_VERSION } = await import('../src/narrative/analyzer/llm/jev-questions.mjs');

  console.log('\n── A. 狮鹫案数值复现（B 0.71 / tierB 3:0.65 / notable 0.45 / strong_fit 0.96）──');

  const m1 = mapStandardAnswers(griffinAnswers(), makeContext());
  const s2 = stage2Of(m1);
  // J1.56（C126）：旧 notable_other「知名但非超级IP」退出后，新轴=实体在 Web3
  // 用户侧的接受度；狮鹫 fixture 的旧 notable/minor 迁移后 unknown 0.82≥0.5 →
  // 实体低影响力门拦（C54「知名度是错轴」语义被 Web3 接受度轴取代）
  check('A1 unknown 0.82≥0.5 + B 类 → 实体低影响力门拦（C126 新轴）',
    s2.pass === false && /币名映射实体在 Web3 用户侧无名/.test(s2.blockReason || '') && s2.scoringResult.eventCompositeScore === null,
    { pass: s2.pass, blockReason: s2.blockReason, total: s2.scoringResult?.eventCompositeScore });
  check('A1b 审计：nameEntityAcceptance=unknown + 概率 0.82 + nameEntityLowMass=0.82',
    s2.jev?.nameEntityAcceptance === 'unknown' && s2.jev?.nameEntityAcceptanceProbability === 0.82
    && s2.jev?.nameEntityLowMass === 0.82);
  check('A2 退役审计键不落：nrNotableExempt undefined（C108 随阻断位退役）',
    stage1Of(m1).jev?.nrNotableExempt === undefined,
    stage1Of(m1).jev?.nrNotableExempt);
  check('A3 J1.56 断代：实体门先于关联分（unknown 0.82 → low，不再进入 78.7 数学）',
    m1.llmResult?.rating === 'low' && /币名映射实体在 Web3 用户侧无名/.test(m1.llmResult?.reason || ''),
    { rating: m1.llmResult?.rating, reason: m1.llmResult?.reason });

  const m2 = mapStandardAnswers(griffinAnswers({ relevance: 'partial_match' }), makeContext());
  check('A4 同形状 partial_match：实体门同位先拦（拦截理由更干净）',
    m2.llmResult?.rating === 'low' && /币名映射实体在 Web3 用户侧无名/.test(m2.llmResult?.reason || ''),
    { rating: m2.llmResult?.rating, reason: m2.llmResult?.reason });

  console.log('\n── B. 全域作用域矩阵（A2：notable 全域退出阻断侧）──');

  // B1 C 类（旧 CONVICTION 截词语义域）：notable 主导放行
  const cAnswers = griffinAnswers();
  cAnswers.event_category = { choice: 'C', probabilities: { C: 0.75, B: 0.2 } };
  cAnswers.web3_user_name_entity_acceptance = { choice: 'unknown', probabilities: { unknown: 0.98, no_entity: 0.0 } };
  const mc = mapStandardAnswers(cAnswers, makeContext());
  check('B1a C 类 unknown 0.98≥0.5：实体低影响力门拦（C 在域内）',
    stage2Of(mc).pass === false && /币名映射实体在 Web3 用户侧无名/.test(stage2Of(mc).blockReason || '')
      && stage2Of(mc).jev?.nameEntityLowMass === 0.98
      && stage1Of(mc).jev?.nrNotableExempt === undefined,
    { blockReason: stage2Of(mc).blockReason, mass: stage2Of(mc).jev?.nameEntityLowMass });
  check('B1b 同形状改 accepted 0.8：实体门不拦；J1.79 fit 事件分 100（strong 0.96+fit 0.04）放行',
    (() => { const x = { ...cAnswers, web3_user_name_entity_acceptance: { choice: 'accepted', probabilities: { accepted: 0.8 } } };
      const mx = mapStandardAnswers(x, makeContext());
      return stage2Of(mx).pass === true && stage2Of(mx).scoringResult?.eventCompositeScore === 100; })(),
    null);

  // B1c CONVICTION 保护移交（裁定第②步：拦截轴=可接纳性非知名度）：同形状 +
  // web3_user_event_fit unfit 0.62 → unfit 负门拦截（J1.19 全域，不依赖类别）
  const cvAnswers = { ...cAnswers, web3_user_name_entity_acceptance: { choice: 'accepted', probabilities: { accepted: 0.8 } }, web3_user_event_fit: { choice: 'unfit', probabilities: { unfit: 0.62, marginal: 0.2, fit: 0.12, strong_fit: 0.06 } } };
  const mcv = mapStandardAnswers(cvAnswers, makeContext());
  check('B1c CONVICTION 形状新兜底：web3_user_event_fit unfit 0.62 负门拦截（拦截判据=可接纳性非知名度）',
    mcv.llmResult?.rating === 'low' && /Web3用户偏好不合/.test(mcv.llmResult?.reason || ''),
    { rating: mcv.llmResult?.rating, reason: mcv.llmResult?.reason });

  // B2 W 类（旧 ChainPulse 补位语义域）：notable 主导放行 → 进 W 数学
  const wAnswers = griffinAnswers();
  wAnswers.event_category = { choice: 'W', probabilities: { W: 0.8, B: 0.15 } };
  wAnswers.web3_user_name_entity_acceptance = { choice: 'unknown', probabilities: { unknown: 0.68, no_entity: 0.05, accepted: 0.2 } };
  const mw = mapStandardAnswers(wAnswers, makeContext());
  check('B2 W 类 unknown 0.68≥0.5：实体低影响力门拦（W 在域内；W 数学不触达）',
    stage2Of(mw).pass === false && /币名映射实体在 Web3 用户侧无名/.test(stage2Of(mw).blockReason || ''),
    { blockReason: stage2Of(mw).blockReason, pass: stage2Of(mw).pass });

  // B3 D 类抽查：notable 旧合计 0.77 → 放行，走标准数学
  const dAnswers = griffinAnswers();
  dAnswers.event_category = { choice: 'D', probabilities: { D: 0.7, B: 0.25 } };
  dAnswers.web3_user_name_entity_acceptance = { choice: 'unknown', probabilities: { unknown: 0.75, no_entity: 0.02 } };
  const md = mapStandardAnswers(dAnswers, makeContext());
  check('B3 D 类 unknown 0.75≥0.5：实体低影响力门拦',
    stage2Of(md).pass === false && /币名映射实体在 Web3 用户侧无名/.test(stage2Of(md).blockReason || ''),
    { blockReason: stage2Of(md).blockReason, pass: stage2Of(md).pass });

  // B4 minor_other 主导（YAYA 无名对象语义）：拦截移交 name_form 分支①——旧快照
  // 形状（无 name_form 键=fail-open）放行；name_form 判 not_meme_name 时由名字门接住
  const yAnswers = griffinAnswers();
  yAnswers.web3_user_name_entity_acceptance = { choice: 'accepted', probabilities: { accepted: 0.8 } };
  const my = mapStandardAnswers(yAnswers, makeContext());
  const myNf = mapStandardAnswers({ ...yAnswers, name_form: { choice: 'not_meme_name', probabilities: { not_meme_name: 0.85 } } }, makeContext());
  check('B4 minor 0.55 主导：旧快照无 name_form 键 fail-open 放行（J1.79 fit 事件分 100）/ name_form=not_meme_name 名字门接住',
    my.llmResult?.rating !== 'low' && !/Web3 用户不接纳该名字/.test(my.llmResult?.reason || '') && /Web3 用户不接纳该名字/.test(myNf.llmResult?.reason || ''),
    { legacy: my.llmResult?.rating, nf: myNf.llmResult?.reason });

  // B5 common_word 主导（CONVICTION 纯截词语义）：拦截移交 name_form 分支②
  // ——圈内词（EARLY 型）meme_name 放行=翻案位；无感知句片段 not_meme_name 拦
  const kAnswers = griffinAnswers();
  kAnswers.web3_user_name_entity_acceptance = { choice: 'no_entity', probabilities: { no_entity: 0.52, unknown: 0.23, accepted: 0.2 } };
  const mk = mapStandardAnswers(kAnswers, makeContext());
  const mkNf = mapStandardAnswers({ ...kAnswers, name_form: { choice: 'not_meme_name', probabilities: { not_meme_name: 0.85 } } }, makeContext());
  const mkMeme = mapStandardAnswers({ ...kAnswers, name_form: { choice: 'meme_name', probabilities: { meme_name: 0.85 } } }, makeContext());
  check('B5 common 0.52 主导：旧快照无 name_form 键 fail-open 放行（J1.79 fit 事件分 100）/ not_meme_name 名字门拦 / meme_name 躲过名字门',
    mk.llmResult?.rating !== 'low' && /Web3 用户不接纳该名字/.test(mkNf.llmResult?.reason || '')
      && !/Web3 用户不接纳该名字/.test(mkMeme.llmResult?.reason || ''),
    { legacy: mk.llmResult?.rating, nf: mkNf.llmResult?.reason });

  // B6 三项全低：不拦（普通票零影响；退役审计键不落）
  const nAnswers = griffinAnswers();
  nAnswers.web3_user_name_entity_acceptance = { choice: 'accepted', probabilities: { accepted: 0.55, unknown: 0.4, no_entity: 0.05 } };
  const mn = mapStandardAnswers(nAnswers, makeContext());
  check('B6 三项全低（super_ip 0.55 主）：不拦 + 退役审计键不落',
    stage2Of(mn).jev?.nameReferentBlockMass === undefined && stage1Of(mn).jev?.nrNotableExempt === undefined);

  // B7 已删（C83）：superIP 快车道（person→C 域）随通道删除——notable 甄别终结
  // 由 B1a/D1 的标准路径等价物锁定，superIP 语料票同走 mapStandardAnswers

  // B7b YAYA 边缘形状（minor 0.41+notable 0.14，旧合计 0.55 曾拦；A2 后 minor
  // 单项不过线 → name 门放）：新兜底 = web3_user_event_fit unfit 负门拦截
  const yayaAnswers = griffinAnswers();
  yayaAnswers.web3_user_name_entity_acceptance = { choice: 'unknown', probabilities: { unknown: 0.85, no_entity: 0.0 } };
  yayaAnswers.web3_user_event_fit = { choice: 'unfit', probabilities: { unfit: 0.58, marginal: 0.22, fit: 0.14, strong_fit: 0.06 } };
  const myaya = mapStandardAnswers(yayaAnswers, makeContext());
  check('B7b YAYA 边缘形状：unfit 负门先于实体门拦截（两门同向，拦截理由=偏好不合）',
    myaya.llmResult?.rating === 'low' && /Web3用户偏好不合/.test(myaya.llmResult?.reason || ''),
    { rating: myaya.llmResult?.rating, reason: myaya.llmResult?.reason });

  console.log('\n── C. 审计字段矩阵（C108 后：nr 概率纯观察，退役键不落）──');

  // C1 边界形状（原 0.50 恰过门槛审计位）：审计键退役不落，nr 概率纯观察保留
  const eAnswers = griffinAnswers();
  eAnswers.web3_user_name_entity_acceptance = { choice: 'unknown', probabilities: { unknown: 0.5, no_entity: 0.0 } };
  const me = mapStandardAnswers(eAnswers, makeContext());
  check('C1 边界形状：unknown=0.5 恰过门槛 → 实体门拦 + nameEntityAcceptanceProbability=0.5 审计',
    stage1Of(me).jev?.nrNotableExempt === undefined
      && stage2Of(me).jev?.nameEntityAcceptance === 'unknown'
      && stage2Of(me).jev?.nameEntityAcceptanceProbability === 0.5
      && stage2Of(me).jev?.nameEntityLowMass === 0.5,
    { audit: stage1Of(me).jev?.nrNotableExempt, prob: stage2Of(me).jev?.nameEntityAcceptanceProbability });

  // C2 新口径 minor+common 自身 ≥0.5 形状：阻断位退役不落
  const fAnswers = griffinAnswers();
  fAnswers.web3_user_name_entity_acceptance = { choice: 'unknown', probabilities: { unknown: 0.75, no_entity: 0.1 } };
  const mf = mapStandardAnswers(fAnswers, makeContext());
  check('C2 unknown 0.75：实体门拦 + 退役键不落',
    stage2Of(mf).pass === false && /币名映射实体在 Web3 用户侧无名/.test(stage2Of(mf).blockReason || '')
      && stage1Of(mf).jev?.nrNotableExempt === undefined,
    { blockReason: stage2Of(mf).blockReason, audit: stage1Of(mf).jev?.nrNotableExempt });

  // C3 全域（A2 升级点）：C 类 notable 票同形状（B1a 的机器复核）
  check('C3 C 类票：退役键全域不落（实体门接手）',
    stage1Of(mc).jev?.nrNotableExempt === undefined && stage2Of(mc).jev?.nameEntityLowMass === 0.98,
    { audit: stage1Of(mc).jev?.nrNotableExempt, mass: stage2Of(mc).jev?.nameEntityLowMass });

  console.log('\n── D. 源码接线 + 版本 ──');

  const fs = require('fs');
  const src = fs.readFileSync('src/narrative/analyzer/llm/jev-result-mapper.mjs', 'utf8');
  check('D1 nameReferentBlock 退役反证 + J1.56 实体低影响力门接线（nameEntityLowBlock / unknown≥0.5 / scope 常量）',
    !/const blockKeys = /.test(src) && !/nameReferentBlock\(answers/.test(src)
    && /function nameEntityLowBlock\(answers, category\)/.test(src)
    && /NAME_ENTITY_LOW_BLOCK_SCOPE = \['B', 'C', 'D', 'F', 'G', 'W'\]/.test(src)
    && /neBlock = nameEntityLowBlock\(answers, category\)/.test(src));
  check('D1b 阻断标签表无 notable_other 键（label 仅存历史行 reason 展示注释）',
    !/unknown: '名字指向知名但非超级IP'/.test(src));
  check('D2 并档注释含 J1.26 案史（C54 狮鹫案「知名度梯度是错轴」）+ nrNotableExempt 计算形状不存在',
    /J1\.26 notable_other 全域退出\n \* （知名度梯度是错轴/.test(src)
      && !/nrNotableExempt,/.test(src)
      && !/let nrNotableExempt = null;/.test(src));
  check('D3 题集版本 ≥J1.26（J1.26 mapper-only；现 J1.42=C108 名字门统一）',
    parseInt(JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 26, JEV_QUESTIONS_VERSION);

  console.log(`\n═══════ ${passed} passed, ${failed} failed ═══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('SUITE ERROR', e); process.exit(1); });
