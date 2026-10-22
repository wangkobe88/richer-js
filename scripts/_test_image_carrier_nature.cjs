#!/usr/bin/env node
/**
 * C167 图证豁免载体性质第四臂单测（image_carrier_nature 条件题 + mapper 第四臂）——
 * 零 DB 零网络（2026-10-22 梗王大乱斗案，用户裁定「没有一个可视化的形象IP跟它
 * 匹配，配图也是游戏」「这是叙事本身的问题」「那就 A 吧」）
 *
 * 案发（0x4ded0c77fcaa9bec730e450d48abb4192a647777「梗王大乱斗」）：名字=抖音
 * 手搓网页游戏标题，载体题如实判 no_visual 0.85；但配图=该游戏界面截图（图内
 * 文字恰含 #梗王大乱斗# hashtag）→ name_image_consistency 按题面字面判
 * same_entity 0.65+same_visual_category 0.22=0.87（match 臂）∧ image_depicts_name
 * 0.98（演绎臂）→ C109/C118 图证豁免救回载体门 → S 档 92 high 放行。洞=豁免把
 * 「名-图所指对应」当「载体存在」：所指物=游戏（非形象事物）时配图=所指物实录，
 * 同一是同义反复不产生形象信息（E 类事件分已在量所指存在）。
 *
 * 改动形状：
 *   题集（J1.100）：新条件题 image_carrier_nature 三档（carrier_visual/
 *     referent_itself/unclear），仅 imageConsistency 时问；题面锚=事物自我实录
 *     不算演绎（真香蕉锚升格）+图内第三方 IP 不成本币载体。
 *   mapper：imgCarrierOverride 与 emptyContentImgCarrierOverride（C159 近 tie 臂）
 *     统一加第四臂 carrierNature==='carrier_visual' 才豁免；referent_itself/
 *     unclear/答案缺失 fail-closed 不豁免；审计键 subjectCarrierReferentVeto
 *     命中才落。J1.30 imgNameExempt 关联豁免不消费本题（豁免面不互扩）。
 *
 * 覆盖：
 *   A. 事故现场反证（梗王大乱斗原值：nicMatch 0.87+depict 0.98 两臂够阈 +
 *      nature=referent_itself → 载体门照拦 low；两审计键互斥可辨）
 *   B. 奠基票回归（nature=carrier_visual → 豁免照旧 via=match；交易猫/DND 形状）
 *   C. 答案缺失 fail-closed（旧缓存行防御形状：两臂够阈但无 nature → 拦）
 *   D. unclear fail-closed（同 C；veto 键 nature='unclear' 可归因）
 *   E. C159 近 tie 臂同受管（emptyP≥0.4+none argmax：nature=referent_itself 拦 /
 *      carrier_visual 豁——DND 掷骰防抖语义保留给形象票）
 *   F. J1.30 零污染（nature=referent_itself 不影响 Stage3 关联豁免 imgNameExempt）
 *   G. 无图票 bit 一致（imageEvidence=false → 载体门照拦，nature 无关）
 *   H. 源码口径（版本/题面/双消费点/审计键四反证）
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

/**
 * 梗王大乱斗案现场形状（J1.100 题集，stage2 真值回填）：E 类 0.48 / fit
 * strong 0.79+fit 0.13（sf+fit=0.92 过契合证据门，事件分 92 S 档）/ acceptance
 * new_entity 0.51 / 载体 no_visual 0.85 / 名图一致 same_entity 0.65+同类 0.22
 * / 演绎 depicts 0.98 / timing within_7d / veto none 0.81
 */
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
  const { JEV_QUESTIONS_VERSION } = await import(qPath);

  // ═══ A. 事故现场反证（梗王大乱斗原值形状）═══
  console.log('\n── A. 事故现场反证 ──');
  const rA = mapStandardAnswers(gwdAnswers(), gwdCtx(true));
  check('A1 载体门照拦：rating low + reason 含「形象载体」（修复前=豁免救回 S 档 92 high）',
    rA.llmResult.rating === 'low' && (rA.llmResult.reason || '').includes('形象载体'),
    rA.llmResult.reason);
  check('A2 两臂够阈（nicMatch 0.87+depict 0.98）但豁免不触发：subjectCarrierImgOverride=null',
    s2jev(rA).subjectCarrierImgOverride === null, s2jev(rA).subjectCarrierImgOverride);
  check('A3 否决审计键可归因（carrier+nature 落 stage2 主段=拦截票唯一落库位）',
    JSON.stringify(s2jev(rA).subjectCarrierReferentVeto) === JSON.stringify({ carrier: 'no_visual_entity', nature: 'referent_itself' }),
    s2jev(rA).subjectCarrierReferentVeto);

  // ═══ B. 奠基票回归（形象票照旧豁免：交易猫/DND/短尾猫形状）═══
  console.log('\n── B. 奠基票回归 ──');
  const rB = mapStandardAnswers(gwdAnswers({
    image_carrier_nature: { choice: 'carrier_visual', probabilities: { carrier_visual: 0.8, referent_itself: 0.15 } },
  }), gwdCtx(true));
  check('B1 nature=carrier_visual → 豁免照旧（不因载体门拦）',
    !(rB.llmResult.reason || '').includes('形象载体'), rB.llmResult.reason);
  check('B2 审计键 via=match/matchP=0.87 保留臂来源可归因',
    s2jev(rB).subjectCarrierImgOverride?.via === 'match' && s2jev(rB).subjectCarrierImgOverride?.matchP === 0.87,
    s2jev(rB).subjectCarrierImgOverride);
  check('B3 否决键=null（未否决不落键）',
    s2jev(rB).subjectCarrierReferentVeto === null, s2jev(rB).subjectCarrierReferentVeto);
  check('B4 全链放行非 low（E 类 S 档 92+exact 关联）',
    rB.llmResult.rating !== 'low', rB.llmResult.rating);

  // ═══ C. 答案缺失 fail-closed ═══
  console.log('\n── C. 答案缺失 fail-closed ──');
  const { image_carrier_nature: _drop, ...noNature0 } = gwdAnswers();
  const noNature = { ...noNature0 };
  const rC = mapStandardAnswers(noNature, gwdCtx(true));
  check('C1 无 nature 答案（异常/防御形状）+ 两臂够阈 → 载体门照拦（fail-closed）',
    rC.llmResult.rating === 'low' && (rC.llmResult.reason || '').includes('形象载体'),
    rC.llmResult.reason);
  check('C2 豁免/否决两键均 null（nature=null 不冒充否决也不放行）',
    s2jev(rC).subjectCarrierImgOverride === null && s2jev(rC).subjectCarrierReferentVeto === null,
    { sc: s2jev(rC).subjectCarrierImgOverride, veto: s2jev(rC).subjectCarrierReferentVeto });

  // ═══ D. unclear fail-closed ═══
  console.log('\n── D. unclear fail-closed ──');
  const rD = mapStandardAnswers(gwdAnswers({
    image_carrier_nature: { choice: 'unclear', probabilities: { unclear: 0.55, carrier_visual: 0.25, referent_itself: 0.2 } },
  }), gwdCtx(true));
  check('D1 unclear → 载体门照拦（判不清按无形象处理，fail-closed 方向）',
    rD.llmResult.rating === 'low' && (rD.llmResult.reason || '').includes('形象载体'),
    rD.llmResult.reason);
  check('D2 否决键 nature=unclear 可归因',
    s2jev(rD).subjectCarrierReferentVeto?.nature === 'unclear', s2jev(rD).subjectCarrierReferentVeto);

  // ═══ E. C159 近 tie 臂同受第四臂管 ═══
  console.log('\n── E. C159 近 tie 臂同受管 ──');
  const nearTie = {
    event_quality_veto: { choice: 'none', probabilities: { none: 0.45, event_empty_content: 0.42 } },
    // 两臂均不够阈（unrelated 0.8 / decorative 0.85）：豁免只能来自 C159 近 tie 臂
    name_image_consistency: { choice: 'unrelated', probabilities: { unrelated: 0.8, same_entity: 0.1 } },
    image_depicts_name: { choice: 'decorative', probabilities: { decorative: 0.85, depicts_name: 0.1 } },
  };
  const rE1 = mapStandardAnswers(gwdAnswers(nearTie), gwdCtx(true));
  check('E1 近 tie + nature=referent_itself → 载体门照拦（实录图不因 argmax 抖动防抖豁免）',
    rE1.llmResult.rating === 'low' && (rE1.llmResult.reason || '').includes('形象载体'),
    rE1.llmResult.reason);
  check('E2 近 tie 形状恒落观察键不受影响（subjectCarrierEmptyImgOverride 照记）',
    s2jev(rE1).subjectCarrierEmptyImgOverride != null, s2jev(rE1).subjectCarrierEmptyImgOverride);
  const rE2 = mapStandardAnswers(gwdAnswers({
    ...nearTie,
    image_carrier_nature: { choice: 'carrier_visual', probabilities: { carrier_visual: 0.75, referent_itself: 0.2 } },
  }), gwdCtx(true));
  check('E3 近 tie + nature=carrier_visual → C159 臂照旧豁免（DND 掷骰防抖语义保留给形象票）',
    !(rE2.llmResult.reason || '').includes('形象载体'), rE2.llmResult.reason);

  // ═══ F. J1.30 零污染（关联豁免不消费本题）═══
  console.log('\n── F. J1.30 零污染 ──');
  // 行为级对照（A 档票绕开载体门，直击 Stage3 关联截断豁免位）：relevance 9
  // （0<rel≤10 截断窗内）+ match 臂 0.7——J1.30 若错消费 nature 会丢掉关联豁免
  const passTier = {
    event_category: { choice: 'A', probabilities: { A: 0.7, G: 0.2 } },
    event_magnitude: { score: 3.9, probabilities: { '4': 0.6, '3': 0.3 } },
    web3_user_event_fit: { choice: 'fit', probabilities: { strong_fit: 0, fit: 0.78 } },
    name_event_relevance: { choice: 'semantic_weak', probabilities: { semantic_weak: 0.6, semantic_clear: 0.3 } },
    name_image_consistency: { choice: 'same_entity', probabilities: { same_entity: 0.7, unrelated: 0.2 } },
    image_depicts_name: { choice: 'decorative', probabilities: { decorative: 0.8, depicts_name: 0.15 } },
  };
  const rF = mapStandardAnswers(gwdAnswers(passTier), gwdCtx(true));
  check('F1 nature=referent_itself 但 J1.30 名图一致关联豁免照常生效（Stage3 截断被豁免放行）',
    rF.llmResult.rating !== 'low' && (rF.llmResult.reason || '').includes('名图一致豁免'),
    rF.llmResult.reason);

  // ═══ G. 无图票 bit 一致 ═══
  console.log('\n── G. 无图票 bit 一致 ──');
  const { image_carrier_nature: _d2, image_depicts_name: _d3, name_image_consistency: _d4, ...noImg0 } = gwdAnswers();
  const rG = mapStandardAnswers(noImg0, gwdCtx(false));
  check('G1 imageEvidence=false（题不问/豁免无源）→ 载体门照拦（C167 前后 bit 一致）',
    rG.llmResult.rating === 'low' && (rG.llmResult.reason || '').includes('形象载体'),
    rG.llmResult.reason);

  // ═══ H. 源码口径（回潮防线）═══
  console.log('\n── H. 源码口径 ──');
  const mapperSrc = readFileSync(mapperPath, 'utf8');
  const qSrc = readFileSync(qPath, 'utf8');
  check('H1 版本已 bump J1.100（题面改动版本红线）', JEV_QUESTIONS_VERSION === 'J1.101', JEV_QUESTIONS_VERSION);
  check('H2 题在 imageConsistency 条件块内（无图不问防幻觉）',
    qSrc.includes('...(imageConsistency ? {\n      image_carrier_nature:'));
  check('H3 题面带两锚（事物自我实录不算演绎 / 第三方 IP 不成本币载体）',
    qSrc.includes('事物自我实录不算演绎') && qSrc.includes('第三方角色不算本币载体'));
  check('H4 mapper 第四臂挂主豁免（imgArmsQualified && carrierNatureOk）',
    mapperSrc.includes('const imgCarrierOverride = !!context.imageEvidence && imgArmsQualified && carrierNatureOk;'));
  check('H5 C159 近 tie 臂同受管（emptyContentImgLike && carrierNatureOk）',
    mapperSrc.includes('emptyContentImgCarrierOverride: emptyContentImgLike && carrierNatureOk'));
  check('H6 否决审计键双段同形（stage2 主段+stage3 段）',
    mapperSrc.split('subjectCarrierReferentVeto:').length - 1 === 2);

  console.log(`\n═══ C167 image_carrier_nature：${passed} 通过 / ${failed} 失败 ═══`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
