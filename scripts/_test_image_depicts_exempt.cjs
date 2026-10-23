#!/usr/bin/env node
/**
 * C118 演绎臂测试（image_depicts_name 条件题 + mapper imgNameExempt 扩臂）——零 DB 零网络
 * （2026-10-19 DND 案二轮立题；J1.102/C171 挂点迁移改写）
 *
 * 案史：C118（2026-10-19）立 image_depicts_name 题（DND 案：猫拉窗帘视频=do not
 * disturb 的画面演绎——载体存在的事实证据），原挂载体门图证豁免演绎臂。
 * J1.102/C171（2026-10-22 用户裁定「image_depicts_name 需要保留吗？这我觉得是事/
 * 币关联的一个维度」）：形象载体轴整轴退役后，演绎臂**从载体豁免迁入 J1.30
 * imgNameExempt 关联豁免第二臂**——配图在演绎名字含义=币名↔叙事的关联证据，
 * 与主体有无形象正交。判据：imageEvidence ∧ (nicMatchP≥0.5 ∨ depictP≥0.5) ∧
 * 0<relevance≤10 → 豁免 Stage3 关联≤10 截断；magExempt 聚合自然继承（量级门
 * D/E 臂+事件分<60 臂）。
 *
 * 覆盖：
 *   A. DND 形状（unrelated 0.85+depicts 0.8+rel 窗内）→ J1.30 演绎臂豁免 Stage3
 *      截断放行；审计 imgNameExempt.via='depicts' 臂来源可归因
 *   B. 阈值边界（depicts 0.5 恰过 / 0.49 截断照拦）
 *   C. 未问/答案缺失（depictP=0 → 只剩 nicMatch 臂=存量零影响 fail-safe）；
 *      无图证 → 不豁免
 *   D. match 臂回归（交易猫形状 nicMatch≥0.5 → via='match' 照旧）
 *   E. relevance 窗边界（rel=0 纯零关联不救；rel>10 窗外不救——豁免只救弱关联
 *      截断票，同 C59/J1.30 原臂窗）
 *   F. 豁免≠免检（演绎臂触发 + not_meme_name → 名字门照拦）
 *   G. magExempt 聚合（演绎臂触发 + D 档 → 量级门放行，reason 落豁免标注）
 *   H. 源码口径（扩臂形状/版本/题面锚三反证）
 *
 * 用法：node scripts/_test_image_depicts_exempt.cjs
 */
'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

/**
 * DND 案现场形状（J1.43+ 题集）：D 类 0.7 / magnitude 1.2（D 档）/ 名图一致
 * unrelated 0.85（概念 vs 猫=不同实体——match 臂天然吃不到）/ 演绎 depicts 0.8
 * （猫拉窗帘=别打扰的画面演绎）/ semantic 弱关联 9 分（0<rel≤10 截断窗内）。
 * J1.102 后 visuality/nature 键仅作旧缓存行形状在场（mapper 不读）。
 */
function dndAnswers(overrides = {}) {
  return {
    event_category: { choice: 'D', probabilities: { D: 0.7, G: 0.2 } },
    event_magnitude: { score: 1.2, probabilities: { '1': 0.6, '2': 0.3 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.9 } },
    dimension2: { score: 12, probabilities: { '2': 0.5, '3': 0.3 } },
    event_quality_veto: { choice: 'none', probabilities: { none: 0.5, event_empty_content: 0.2 } },
    web3_user_name_entity_acceptance: { choice: 'no_entity', probabilities: { no_entity: 0.6, unknown: 0.2 } },
    name_entity_memeability: { score: 2.5, probabilities: {} },
    web3_user_event_fit: { choice: 'fit', probabilities: { strong_fit: 0.55, fit: 0.15, marginal: 0.25, unfit: 0.05 } },
    name_entity_carrier: { choice: 'no_visual_entity', probabilities: { no_visual_entity: 0.5, existing_entity: 0.4 } },
    event_subject_entity: { choice: 'other_entity', probabilities: { other_entity: 0.7 } },
    // semantic_weak=9 落 Stage3 截断窗（0<rel≤10）——演绎臂真触发才豁免该截断
    // （无 relevance_level 键=J1.43 新形状走融合单值表：semantic_weak=9）
    name_event_relevance: { choice: 'semantic_weak', probabilities: { semantic_weak: 0.6, semantic_clear: 0.3 } },
    token_name_quality: { score: 10, probabilities: {} },
    name_form: { choice: 'meme_name', probabilities: { meme_name: 0.7, not_meme_name: 0.2 } },
    event_finding_vs_recap: { choice: 'finding', probabilities: { finding: 0.7 } },
    name_image_consistency: { choice: 'unrelated', probabilities: { unrelated: 0.85, same_entity: 0.05, same_visual_category: 0.05 } },
    image_depicts_name: { choice: 'depicts_name', probabilities: { depicts_name: 0.8, decorative: 0.15 } },
    ...overrides,
  };
}

const dndCtx = (imageEvidence) => ({
  tokenData: { symbol: 'DND', name: 'DND', raw_api_data: { name: 'DND' } },
  includeBrandHijack: false,
  tweetClassification: null,
  twitterInfo: { author_screen_name: 'BinancePk', author_followers_count: 800000, text: 'DND 😾' },
  imageEvidence,
  callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
});

const s3jev = (r) => r.stage3DataToSave?.parsed_output?.jev || {};

async function main() {
  const mapperPath = join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-result-mapper.mjs');
  const qPath = join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-questions.mjs');
  const { mapStandardAnswers } = await import(mapperPath);

  // ═══ A. DND 形状：演绎臂豁免 Stage3 截断 ═══
  console.log('\n── A. DND 形状（depicts 0.8 / nicMatch 0.1 / rel 9 截断窗内）──');
  const rA = mapStandardAnswers(dndAnswers(), dndCtx(true));
  check('A1 演绎臂触发：Stage3 关联截断豁免放行（reason 落名图一致豁免标注）',
    rA.llmResult.rating !== 'low' && (rA.llmResult.reason || '').includes('名图一致豁免(J1.30)'),
    rA.llmResult.reason);
  check('A2 审计 imgNameExempt 命中且 via=depicts（臂来源可归因）',
    s3jev(rA).imgNameExempt?.via === 'depicts' && s3jev(rA).imgNameExempt?.depictP === 0.8,
    s3jev(rA).imgNameExempt);

  // ═══ B. 阈值边界 ═══
  console.log('\n── B. 阈值边界 ──');
  const rB1 = mapStandardAnswers(dndAnswers({
    image_depicts_name: { choice: 'depicts_name', probabilities: { depicts_name: 0.5, decorative: 0.4 } },
  }), dndCtx(true));
  check('B1 depicts 0.5 恰过阈（≥0.5 与 nicMatch 同阈惯例）',
    rB1.llmResult.rating !== 'low' && (rB1.llmResult.reason || '').includes('名图一致豁免(J1.30)'),
    rB1.llmResult.reason);
  const rB2 = mapStandardAnswers(dndAnswers({
    image_depicts_name: { choice: 'depicts_name', probabilities: { depicts_name: 0.49, decorative: 0.45 } },
  }), dndCtx(true));
  check('B2 depicts 0.49 不过阈 → Stage3 截断照拦（低置信演绎证据不构成关联证据）',
    rB2.llmResult.rating === 'low' && (rB2.llmResult.reason || '').includes('截断'),
    rB2.llmResult.reason);

  // ═══ C. 未问/答案缺失（存量零影响）═══
  console.log('\n── C. 未问/答案缺失 ──');
  const { image_depicts_name: _drop, ...noDepict0 } = dndAnswers();
  const noDepict = { ...noDepict0 };
  const rC1 = mapStandardAnswers(noDepict, dndCtx(true));
  check('C1 答案缺失（旧缓存行/未问）：depictP=0 只剩 nicMatch 臂 → 截断照拦（fail-safe）',
    rC1.llmResult.rating === 'low' && (rC1.llmResult.reason || '').includes('截断'),
    rC1.llmResult.reason);
  check('C2 缺失臂审计 imgNameExempt=null（未触发不落键）', s3jev(rC1).imgNameExempt == null, s3jev(rC1).imgNameExempt);
  const rC2 = mapStandardAnswers(dndAnswers(), dndCtx(false));
  check('C3 无图证（imageEvidence=false）→ 两臂都不豁免、截断照拦（图证是开关）',
    rC2.llmResult.rating === 'low' && (rC2.llmResult.reason || '').includes('截断'),
    rC2.llmResult.reason);

  // ═══ D. match 臂回归（交易猫形状）═══
  console.log('\n── D. match 臂回归 ──');
  const rD = mapStandardAnswers(dndAnswers({
    name_image_consistency: { choice: 'same_entity', probabilities: { same_entity: 0.73, unrelated: 0.15 } },
    image_depicts_name: { choice: 'unclear', probabilities: { unclear: 0.6, depicts_name: 0.2 } },
  }), dndCtx(true));
  check('D1 nicMatch 0.78≥0.5 原臂照旧（via=match；unclear 演绎不拖累）',
    s3jev(rD).imgNameExempt?.via === 'match' && rD.llmResult.rating !== 'low',
    { i: s3jev(rD).imgNameExempt, reason: rD.llmResult.reason });

  // ═══ E. relevance 窗边界 ═══
  console.log('\n── E. relevance 窗边界（豁免只救弱关联截断票）──');
  const rE1 = mapStandardAnswers(dndAnswers({
    name_event_relevance: { choice: 'none', probabilities: { none: 0.8 } },
  }), dndCtx(true));
  check('E1 rel=0（纯零关联）→ 不救（图再演绎也救不了与事件毫无关系的名字，C59 同）',
    rE1.llmResult.rating === 'low', rE1.llmResult.reason);
  const rE2 = mapStandardAnswers(dndAnswers({
    name_event_relevance: { choice: 'semantic_clear', probabilities: { semantic_clear: 0.7 } },
  }), dndCtx(true));
  check('E2 rel>10（semantic_clear 65）→ 窗外不触发豁免（照常计分不拦）',
    rE2.llmResult.rating !== 'low' && s3jev(rE2).imgNameExempt == null,
    { reason: rE2.llmResult.reason, i: s3jev(rE2).imgNameExempt });

  // ═══ F. 豁免≠免检 ═══
  console.log('\n── F. 豁免≠免检 ──');
  const rF = mapStandardAnswers(dndAnswers({
    name_form: { choice: 'not_meme_name', probabilities: { not_meme_name: 0.66, meme_name: 0.2 } },
  }), dndCtx(true));
  check('F1 演绎臂触发但 not_meme_name（CRO+演绎图形状）→ 词句门不再拦（C180；演绎豁免只翻关联截断不变）',
    !/Web3 用户不接纳该名字|词句/.test(rF.llmResult.reason || ''),
    rF.llmResult.reason);

  // ═══ G. magExempt 聚合继承 ═══
  console.log('\n── G. magExempt 聚合（演绎臂 → 事件分<60 臂放行）──');
  // J1.79 后 tier 由 fit 派生：likedMass≥0.5（过契合证据门）则档位≥B，D/E 臂只对
  // 豁免票可达；magExempt 的可达面=事件分<60 臂（likedMass 0.55 → 事件分 55<60，
  // 无豁免时被「事件分不足」拦，演绎臂触发 imgNameExempt → magExempt 放行）
  const rG0 = mapStandardAnswers(dndAnswers({
    web3_user_event_fit: { choice: 'fit', probabilities: { strong_fit: 0.1, fit: 0.45, marginal: 0.35, unfit: 0.1 } },
    image_depicts_name: { choice: 'decorative', probabilities: { decorative: 0.8, depicts_name: 0.15 } },
  }), dndCtx(true));
  check('G0 对照：同 fit（likedMass 0.55 事件分 55<60）演绎臂不触发 → 事件分不足拦',
    rG0.llmResult.rating === 'low' && (rG0.llmResult.reason || '').includes('事件分不足'),
    rG0.llmResult.reason);
  const rA2 = mapStandardAnswers(dndAnswers({
    web3_user_event_fit: { choice: 'fit', probabilities: { strong_fit: 0.1, fit: 0.45, marginal: 0.35, unfit: 0.1 } },
  }), dndCtx(true));
  // （magExemptRescuedPass 的「量级门豁免」标注在 Stage2 eventScoreReason——仅拦截
  //  形状外显；mid 票 reason 用 Stage3 模板带豁免前缀，G0/G1 对照即完整证明）
  check('G1 演绎臂触发（depicts 0.8）→ magExempt 聚合放行（G0 同形状不触发则拦）',
    rA2.llmResult.rating !== 'low' && (rA2.llmResult.reason || '').includes('名图一致豁免(J1.30)'),
    rA2.llmResult.reason);

  // ═══ H. 源码口径（回潮防线）═══
  console.log('\n── H. 源码口径 ──');
  const mapperSrc = readFileSync(mapperPath, 'utf8');
  const qSrc = readFileSync(qPath, 'utf8');
  check('H1 mapper 扩臂形状（imgNameExempt 判据行 nicMatchP ∨ depictP 双臂）',
    /\(nicMatchP >= 0\.5 \|\| depictP >= 0\.5\)/.test(mapperSrc), null);
  check('H2 depictP 缺失回落 0（答案缺失=只剩 nicMatch 臂）',
    mapperSrc.includes("answers.image_depicts_name?.probabilities?.depicts_name ?? 0"), null);
  check('H3 审计 imgNameExempt.via 臂来源字段（stage3 段）',
    mapperSrc.includes("via: nicMatchP >= 0.5 ? 'match' : 'depicts'"), null);
  const { JEV_QUESTIONS_VERSION } = await import(qPath);
  check('H4 JEV_QUESTIONS_VERSION ≥ J1.102（C171 挂点迁移：演绎臂从载体豁免迁 J1.30 关联豁免）',
    parseInt(JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 102, JEV_QUESTIONS_VERSION);
  check('H5 题面 DND/CRO 对照锚在',
    qSrc.includes('猫拉上窗帘正是「别打扰」的画面演绎') && qSrc.includes('名字 CRO 配一张猫图'), null);
  check('H6 题面正交分工声明（unrelated 与 depicts 可同票共存）',
    qSrc.includes('unrelated 与 depicts_name 可以同票共存'), null);
  check('H7 题面注释声明消费链=J1.30 关联豁免（防复活回载体门）',
    qSrc.includes('改挂 J1.30 imgNameExempt 关联豁免第二'), null);

  // ═══ 汇总 ═══
  console.log(`\n══════ _test_image_depicts_exempt: ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('单测异常:', e); process.exit(1); });
