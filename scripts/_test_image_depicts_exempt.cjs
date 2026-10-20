#!/usr/bin/env node
/**
 * C118 载体豁免演绎臂单测（image_depicts_name 条件题 + mapper 扩臂）——零 DB 零网络
 * （2026-10-19 DND 案二轮，用户裁定「载体豁免认演绎关系，立 case 修」）
 *
 * 案发（0x4dbcb10e68626b6f663bd596905d41cdc6b07777「DND」二轮）：C114 修掉
 * event_empty_content 误拦后，DND 落载体门拦死——name_entity_carrier no_visual 0.40-0.51
 * 掷骰 + C109 豁免不触发（name_image_consistency unrelated 0.85：DND 是概念，
 * 猫是实体，字面不同实体）。但「猫拉窗帘视频=do not disturb 的画面演绎」
 * 本身就是载体存在的事实证据——载体豁免应认演绎关系。
 *
 * 改动形状：
 *   题集（J1.49）：新条件题 image_depicts_name 三档（depicts_name/decorative/
 *     unclear），仅 imageConsistency 时问；与 10.7 正交（10.7=实体同一/同类，
 *     本题=含义演绎）。
 *   mapper：imgCarrierOverride = imageEvidence ∧ (nicMatchP≥0.5 ∨ depictP≥0.5)；
 *     审计键带 via:'match'|'depicts' 臂来源。J1.30 imgNameExempt 刻意不消费
 *     本题（演绎≠名实一致，两豁免面不互扩）。
 *
 * 覆盖：
 *   A. 事故现场反证（DND 形状：unrelated 0.85+depicts 0.8 → 载体门翻过 →
 *      D 档量级门拦=理由干净；审计键 via:'depicts' 落 stage2）
 *   B. 阈值边界（depicts 0.5 恰过 / 0.49 载体门照拦）
 *   C. 未问/答案缺失（depictP=0 → 只剩 nicMatch 臂=存量零影响 fail-safe）
 *   D. J1.30 零污染（演绎臂触发时 imgNameExempt 仍 null；match 臂不受本题影响）
 *   E. 门链接管（演绎臂触发 + not_meme_name → 名字门照拦）
 *   F. decorative 不豁（配图纯装饰 → 载体门照拦）
 *   G. C109 原臂回归（交易猫形状 nicMatch≥0.5 → via:'match' 照旧）
 *   H. 源码口径（mapper 臂/J1.49 版本/题面锚三反证）
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
 * DND 案现场形状（J1.43+ 题集）：D 类 0.7 / magnitude 1.2（D 档）/ carrier
 * no_visual 0.5 掷骰 / name_form meme_name / 名图一致 unrelated 0.85（概念 vs
 * 猫=不同实体）/ 演绎 depicts 0.8（猫拉窗帘=别打扰的画面演绎）/ semantic 13
 */
function dndAnswers(overrides = {}) {
  return {
    event_category: { choice: 'D', probabilities: { D: 0.7, G: 0.2 } },
    event_magnitude: { score: 1.2, probabilities: { '1': 0.6, '2': 0.3 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.9 } },
    dimension2: { score: 12, probabilities: { '2': 0.5, '3': 0.3 } },
    event_token_block_reason: { choice: 'none', probabilities: { none: 0.5, event_empty_content: 0.2 } },
    web3_user_name_entity_acceptance: { choice: 'no_entity', probabilities: { no_entity: 0.6, unknown: 0.2 } },
    name_entity_memeability: { score: 2.5, probabilities: {} },
    web3_user_event_fit: { choice: 'fit', probabilities: { fit: 0.5, strong_fit: 0.3 } },
    name_entity_carrier: { choice: 'no_visual_entity', probabilities: { no_visual_entity: 0.5, existing_entity: 0.4 } },
    event_subject_entity: { choice: 'other_entity', probabilities: { other_entity: 0.7 } },
    name_event_relevance: { choice: 'semantic_clear', probabilities: { semantic_clear: 0.5, none: 0.2 } },
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

const s2jev = (r) => r.stage2DataToSave.parsed_output.jev;

async function main() {
  const mapperPath = join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-result-mapper.mjs');
  const qPath = join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-questions.mjs');
  const { mapStandardAnswers } = await import(mapperPath);

  // ═══ A. 事故现场反证（DND 形状，演绎臂触发）═══
  console.log('\n── A. 事故现场反证 ──');
  const rA = mapStandardAnswers(dndAnswers(), dndCtx(true));
  check('A1 演绎臂触发：不再被「无形象载体」拦（reason 不含载体 label）',
    rA.llmResult.rating === 'low' && !(rA.llmResult.reason || '').includes('形象载体'),
    rA.llmResult.reason);
  check('A2 fallthrough 到 D 档量级门=拦截理由干净（量级轴成立，载体轴让位）',
    (rA.llmResult.reason || '').includes('量级不足') && (rA.llmResult.reason || '').includes('D档'),
    rA.llmResult.reason);
  check('A3 审计键落 stage2 且 via=depicts（演绎臂来源可归因）',
    s2jev(rA).subjectCarrierImgOverride != null
      && s2jev(rA).subjectCarrierImgOverride.via === 'depicts'
      && s2jev(rA).subjectCarrierImgOverride.depictP === 0.8
      && s2jev(rA).subjectCarrierImgOverride.carrier === 'no_visual_entity',
    s2jev(rA).subjectCarrierImgOverride);

  // ═══ B. 阈值边界 ═══
  console.log('\n── B. 阈值边界 ──');
  const rB1 = mapStandardAnswers(dndAnswers({
    image_depicts_name: { choice: 'depicts_name', probabilities: { depicts_name: 0.5, decorative: 0.4 } },
  }), dndCtx(true));
  check('B1 depicts 0.5 恰过阈（≥0. 与 C109/nicMatch 同阈惯例）',
    !(rB1.llmResult.reason || '').includes('形象载体'), rB1.llmResult.reason);
  const rB2 = mapStandardAnswers(dndAnswers({
    image_depicts_name: { choice: 'depicts_name', probabilities: { depicts_name: 0.49, decorative: 0.45 } },
  }), dndCtx(true));
  check('B2 depicts 0.49 不过阈 → 载体门照拦（掷骰低置信演绎证据不覆盖）',
    rB2.llmResult.rating === 'low' && (rB2.llmResult.reason || '').includes('形象载体'),
    rB2.llmResult.reason);

  // ═══ C. 未问/答案缺失（存量零影响）═══
  console.log('\n── C. 未问/答案缺失 ──');
  const { image_depicts_name: _drop, ...noDepict } = dndAnswers();
  const rC1 = mapStandardAnswers(noDepict, dndCtx(true));
  check('C1 答案缺失（旧缓存行/未问）：depictP=0 只剩 nicMatch 臂 → 载体门照拦',
    rC1.llmResult.rating === 'low' && (rC1.llmResult.reason || '').includes('形象载体'),
    rC1.llmResult.reason);
  check('C2 缺失臂审计键=null（未触发不落键）',
    s2jev(rC1).subjectCarrierImgOverride === null, s2jev(rC1).subjectCarrierImgOverride);
  const rC2 = mapStandardAnswers(noDepict, dndCtx(false));
  check('C3 无图证 + 缺答案：原 C109 行为 bit 一致（载体门拦）',
    rC2.llmResult.rating === 'low' && (rC2.llmResult.reason || '').includes('形象载体'),
    rC2.llmResult.reason);

  // ═══ D. J1.30 零污染（两豁免面不互扩）═══
  console.log('\n── D. J1.30 零污染 ──');
  // 行为级对照（A 档票绕开载体/量级门，直击 Stage3 关联截断豁免位）：relevance 5
  // （0<rel≤10 截断窗内）——J1.30 若错消费 depictP 会豁免 Stage3 截断放行
  const passTier = {
    event_category: { choice: 'A', probabilities: { A: 0.7, G: 0.2 } },
    event_magnitude: { score: 3.9, probabilities: { '4': 0.6, '3': 0.3 } },
    // semantic_weak=9 落 Stage3 截断窗（0<rel≤10）——J1.30 真触发才豁免该截断
    name_event_relevance: { choice: 'semantic_weak', probabilities: { semantic_weak: 0.6, semantic_clear: 0.3 } },
  };
  const rD1 = mapStandardAnswers(dndAnswers({ ...passTier }), dndCtx(true));
  check('D1 演绎臂触发（depicts 0.8）但 matchP 0.1 → Stage3 关联截断照拦（J1.30 不消费演绎题）',
    rD1.llmResult.rating === 'low' && (rD1.llmResult.reason || '').includes('截断')
      && !(rD1.llmResult.reason || '').includes('名图一致豁免'),
    rD1.llmResult.reason);
  const rD2 = mapStandardAnswers(dndAnswers({
    ...passTier,
    name_image_consistency: { choice: 'same_entity', probabilities: { same_entity: 0.7, unrelated: 0.2 } },
    image_depicts_name: { choice: 'decorative', probabilities: { decorative: 0.85, depicts_name: 0.1 } },
  }), dndCtx(true));
  check('D2 反向：match 臂 0.7 触发（depicts 仅 0.1 不拖累）→ J1.30 豁免照常生效放行',
    rD2.llmResult.rating !== 'low' && (rD2.llmResult.reason || '').includes('名图一致豁免(J1.30)'),
    rD2.llmResult.reason);

  // ═══ E. 门链接管（豁载体 ≠ 免检）═══
  console.log('\n── E. 门链接管 ──');
  const rE = mapStandardAnswers(dndAnswers({
    name_form: { choice: 'not_meme_name', probabilities: { not_meme_name: 0.66, meme_name: 0.2 } },
  }), dndCtx(true));
  check('E1 演绎臂触发但 not_meme_name（CRO+演绎图形状）→ 名字门照拦',
    rE.llmResult.rating === 'low' && (rE.llmResult.reason || '').includes('名字'),
    rE.llmResult.reason);
  check('E2 名字门拦截票两审计键各自可追溯（演绎豁免+名字门）',
    s2jev(rE).subjectCarrierImgOverride?.via === 'depicts' && s2jev(rE).web3UserAcceptabilityBlock != null,
    { sc: s2jev(rE).subjectCarrierImgOverride, nf: s2jev(rE).web3UserAcceptabilityBlock });

  // ═══ F. decorative 不豁 ═══
  console.log('\n── F. decorative 不豁 ──');
  const rF = mapStandardAnswers(dndAnswers({
    image_depicts_name: { choice: 'decorative', probabilities: { decorative: 0.8, depicts_name: 0.15 } },
  }), dndCtx(true));
  check('F1 装饰配图（depicts 0.15）→ 载体门照拦（纯装饰非演绎=不构成载体证据）',
    rF.llmResult.rating === 'low' && (rF.llmResult.reason || '').includes('形象载体'),
    rF.llmResult.reason);

  // ═══ G. C109 原臂回归（交易猫形状）═══
  console.log('\n── G. C109 原臂回归 ──');
  const rG = mapStandardAnswers(dndAnswers({
    name_image_consistency: { choice: 'same_entity', probabilities: { same_entity: 0.73, unrelated: 0.15 } },
    image_depicts_name: { choice: 'unclear', probabilities: { unclear: 0.6, depicts_name: 0.2 } },
  }), dndCtx(true));
  check('G1 nicMatch 0.78≥0.5 原臂照旧（via=match；unclear 演绎不拖累）',
    s2jev(rG).subjectCarrierImgOverride?.via === 'match'
      && !(rG.llmResult.reason || '').includes('形象载体'),
    { sc: s2jev(rG).subjectCarrierImgOverride, reason: rG.llmResult.reason });

  // ═══ H. 源码口径（回潮防线）═══
  console.log('\n── H. 源码口径 ──');
  const mapperSrc = readFileSync(mapperPath, 'utf8');
  const qSrc = readFileSync(qPath, 'utf8');
  check('H1 mapper 扩臂形状（nicMatchP ∨ depictP 双臂）',
    mapperSrc.includes('(nicMatchP >= 0.5 || depictP >= 0.5)'), null);
  check('H2 depictP 缺失回落 0（答案缺失=只剩 nicMatch 臂）',
    mapperSrc.includes("answers.image_depicts_name?.probabilities?.depicts_name ?? 0"), null);
  check('H3 审计键 via 臂来源字段',
    mapperSrc.includes("via: nicMatchP >= 0.5 ? 'match' : 'depicts'"), null);
  check('H4 imgNameExempt 赋值行不含 depictP（J1.30 零污染源码口径，行级）',
    !mapperSrc.split('\n').some(l => /imgNameExempt\s*=/.test(l) && l.includes('depictP')), null);
  check('H4b stage2 段同形豁免键（拦截票唯一落库位，DND fallthrough 可归因）',
    mapperSrc.split('\n').filter(l => l.trim().startsWith('subjectCarrierImgOverride:')).length === 2, null);
  const { JEV_QUESTIONS_VERSION } = await import(qPath);
  check('H5 JEV_QUESTIONS_VERSION=J1.74（J1.74=C134 W 交互臂→BSC 用户吸引力；J1.72=C133 实体题新增 new_entity；bump 纪律；J1.55=C124 web3_user_name_entity_acceptance 圈内符号级锚（super_ip=被当符号使用证据级；发布者指代分支/三前提/配图臂保留）；J1.54=C123 门名/题键语义化（event_magnitude→web3_user_event_impact / dimension2→web3_user_event_spread + 门函数/审计键改名，判据零改动）；J1.53=C122 门名断代；J1.52=C121 用户视角批次一：w_product_score 用户兴奋度锚+niche_subculture 认知可达性锚；J1.51=C119 批内修正 dim2 镜头；J1.50=C119 用户视角统一+name_form 键名断代——mapper 兼容 Set 收旧键，本测试旧 choice 形状=存量行重放）', JEV_QUESTIONS_VERSION === 'J1.75', JEV_QUESTIONS_VERSION);
  check('H6 题面 DND/CRO 对照锚在',
    qSrc.includes('猫拉上窗帘正是「别打扰」的画面演绎') && qSrc.includes('名字 CRO 配一张猫图'), null);
  check('H7 题面正交分工声明（unrelated 与 depicts 可同票共存）',
    qSrc.includes('unrelated 与 depicts_name 可以同票共存'), null);

  // ═══ 汇总 ═══
  console.log(`\n══════ _test_image_depicts_exempt: ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('单测异常:', e); process.exit(1); });
