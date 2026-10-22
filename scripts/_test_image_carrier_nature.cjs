#!/usr/bin/env node
/**
 * C167 图证豁免载体性质第四臂——**J1.102/C171 退役反证单测**（零 DB 零网络，
 * 2026-10-22 改写）
 *
 * 案史：C167（2026-10-22 梗王大乱斗案 0x4ded0c77fcaa9bec730e450d48abb4192a
 * 647777）立 image_carrier_nature 第四臂（carrier_visual 才豁免；所指物实录=
 * 同义反复不产生形象信息）。臂的宿主是 J1.29 载体门图证豁免——C171 形象轴
 * 整轴退役（用户裁定「有形象接纳度会高，但不是没有形象就不行，一切看情况」）
 * 后该臂无宿主随门删除：题退役（死题不白烧 fan-out token）、mapper 计算
 * （carrierNatureOk/subjectCarrierReferentVeto）删除、审计键停产出。
 *
 * 案票终态变化：梗王大乱斗原值形状 C167 时被载体门拦（修复后 low），C171 后
 * 载体门整体不存在 → E 类 strong_fit 0.92 事件分 92 直接放行——game/产品类
 * 「实录图」票不再因无形象载体被拦（避亏责任移交 web3Fit/量级门，回归观察）。
 *
 * 覆盖：
 *   A. 案票终态：梗王大乱斗原值形状（nicMatch 0.87+depict 0.98+nature
 *      referent_itself）→ 放行（rating 非 low、reason 无载体 label）
 *   B. 题退役：image_carrier_nature 任何形状（含 imageConsistency）不再产出
 *   C. 源码口径：mapper 无 carrierNature/imgCarrierOverride 计算、无
 *      subjectCarrierReferentVeto 产出位
 *   D. 审计键：subjectCarrierReferentVeto 不再产出（历史行保留展示）
 *   E. 版本：J1.102+（C171）
 *
 * 用法：node scripts/_test_image_carrier_nature.cjs
 */
'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

/** 梗王大乱斗案现场形状（J1.100 题集 stage2 真值回填；nature/visuality 键作旧缓存行形状在场 mapper 不读） */
function gwdAnswers(overrides = {}) {
  return {
    event_category: { choice: 'E', probabilities: { E: 0.48, B: 0.44, A: 0.04, W: 0.04 } },
    event_magnitude: { score: 3.9, probabilities: { '4': 0.6, '3': 0.3 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.96 } },
    dimension2: { score: 28, probabilities: { '3': 0.5, '4': 0.3 } },
    event_quality_veto: { choice: 'none', probabilities: { none: 0.81, token_ip_reuse: 0.16, event_baseless_speculation: 0.02, event_empty_content: 0.01 } },
    web3_user_name_entity_acceptance: { choice: 'new_entity', probabilities: { new_entity: 0.51, unknown: 0.18, not_entity: 0.26, wrong_entity: 0.04 } },
    name_entity_memeability: { score: 2.5, probabilities: {} },
    web3_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.79, fit: 0.13, marginal: 0.05, unfit: 0.03 } },
    web3_user_entity_visuality: { choice: 'no_visual_entity', probabilities: { no_visual_entity: 0.85, existing_entity: 0.14, improvised_entity: 0.01 } },
    event_subject_entity: { choice: 'other_entity', probabilities: { other_entity: 0.7 } },
    name_event_relevance: { choice: 'exact_match', probabilities: { exact_match: 0.6, semantic_clear: 0.3 } },
    token_name_quality: { score: 3, probabilities: {} },
    name_form: { choice: 'meme_name', probabilities: { meme_name: 0.7, not_meme_name: 0.2 } },
    event_finding_vs_recap: { choice: 'news_recap', probabilities: { news_recap: 0.96 } },
    name_image_consistency: { choice: 'same_entity', probabilities: { same_entity: 0.65, same_visual_category: 0.22, unrelated: 0.13 } },
    image_depicts_name: { choice: 'depicts_name', probabilities: { depicts_name: 0.98, decorative: 0.02 } },
    image_carrier_nature: { choice: 'referent_itself', probabilities: { referent_itself: 0.88, carrier_visual: 0.10, unclear: 0.02 } },
    ...overrides,
  };
}

const gwdCtx = (imageEvidence) => ({
  tokenData: { symbol: '梗王大乱斗', name: '梗王大乱斗', raw_api_data: { name: '梗王大乱斗' } },
  includeBrandHijack: false,
  tweetClassification: null,
  twitterInfo: { author_screen_name: 'kenyarafiki', author_followers_count: 225, text: '所有的meme都在大乱斗！网友手搓神级网址' },
  imageEvidence,
  callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
});

const s2jev = (r) => r.stage2DataToSave.parsed_output.jev;

async function main() {
  const mapperPath = join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-result-mapper.mjs');
  const qPath = join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-questions.mjs');
  const { mapStandardAnswers } = await import(mapperPath);
  const { JEV_QUESTIONS_VERSION, buildStandardQuestions } = await import(qPath);

  // ═══ A. 案票终态（C167 拦截形状 → C171 放行）═══
  console.log('\n── A. 案票终态 ──');
  const rA = mapStandardAnswers(gwdAnswers(), gwdCtx(true));
  check('A1 梗王大乱斗原值形状（C167 时被载体门拦）→ C171 放行：rating 非 low、无载体 label',
    rA.llmResult.rating !== 'low' && !(rA.llmResult.reason || '').includes('形象载体'),
    rA.llmResult.reason);
  const rA2 = mapStandardAnswers(gwdAnswers(), gwdCtx(false));
  check('A2 无图证同形状 → 放行（门整体不存在，图证与否都不再触发载体拦截）',
    rA2.llmResult.rating !== 'low', rA2.llmResult.reason);

  // ═══ B. 题退役 ═══
  console.log('\n── B. 题退役 ──');
  check('B1 image_carrier_nature 任何形状不再产出（含 imageConsistency）',
    !('image_carrier_nature' in buildStandardQuestions())
    && !('image_carrier_nature' in buildStandardQuestions({ imageConsistency: true })), null);

  // ═══ C. 源码口径（防复活）═══
  console.log('\n── C. 源码口径 ──');
  const mapperSrc = readFileSync(mapperPath, 'utf8');
  check('C1 mapper 无 carrierNature 计算（题退役后不读残留键）',
    !/const carrierNature\b/.test(mapperSrc) && !/carrierNatureOk/.test(mapperSrc), null);
  check('C2 mapper 无 imgCarrierOverride 豁免计算（宿主门已删）',
    !/const imgCarrierOverride/.test(mapperSrc), null);
  check('C3 无 subjectCarrierReferentVeto 产出位（第四臂审计随臂删除）',
    !/subjectCarrierReferentVeto\s*:/.test(mapperSrc), null);

  // ═══ D. 审计键 ═══
  console.log('\n── D. 审计键 ──');
  check('D1 stage2 段 subjectCarrierReferentVeto/subjectCarrierImgOverride 不产出（历史行保留展示）',
    !('subjectCarrierReferentVeto' in s2jev(rA)) && !('subjectCarrierImgOverride' in s2jev(rA)),
    { v: s2jev(rA).subjectCarrierReferentVeto, o: s2jev(rA).subjectCarrierImgOverride });

  // ═══ E. 版本 ═══
  console.log('\n── E. 版本 ──');
  check('E1 JEV_QUESTIONS_VERSION ≥ J1.102（C171 形象轴整退役，第四臂随删）',
    parseInt(JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 102, JEV_QUESTIONS_VERSION);

  // ═══ 汇总 ═══
  console.log(`\n═══ C167 image_carrier_nature 退役反证：${passed} 通过 / ${failed} 失败 ═══`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('单测异常:', e); process.exit(1); });
