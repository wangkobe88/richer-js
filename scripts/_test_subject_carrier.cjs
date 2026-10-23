#!/usr/bin/env node
/**
 * J1.102/C171 实体形象轴（web3_user_entity_visuality）整体退役反证单测
 * ——本地零 DB 单测（2026-10-22 用户裁定改写）
 *
 * 案史：C61（2026-10-09）立门 +4.42 BNB 回测（C/D 亏损票共同病根=叙事主体无
 * 形象/梗载体）；此后 13 天九连打洞未止（C88/C109/C118/C138/C139/C159/C160/
 * C161/C167）。C171 终审裁定退役：用户哲学定性「实体的可视化有形象，其实也是
 * 实体的 web3 用户接纳度的一部分（web3_user_name_entity_acceptance），有形象
 * 接纳度会高，但也不是说没有形象就不行，一切看情况」——形象载体=用户偏好轴
 * 非资格轴。三票结构卡死实证：股城（web3 项目 no_visual 0.91）、TREE（三桶
 * 0.44/0.35/0.21 argmax 无置信门槛）、Heyi.ai（accepted choice 但 0.25<0.5
 * 著名豁免线）。
 *
 * 本测试锁退役后形状（反证=防复活）：
 *   A. 题集：visuality/image_carrier_nature/event_influence 三题不再产出；
 *      image_depicts_name 保留（迁 J1.30 关联豁免演绎臂，仅 imageConsistency）；
 *      acceptance 题面含形象考量锚句（有形象=加分考量、无形象不否决）
 *   B. 判定矩阵反证：原 M2 全部拦截档位（C/D+improvised/no_visual、E+no_visual）
 *      现在照放——无形象实体不再构成拦截理由
 *   C. 旧缓存行 visuality 键在场也不再拦（mapper 不再读）
 *   D. 门链序：ne → we → ua → 量级门（sc 分支消失）
 *   E. 审计：subjectCarrier* / eventInfluence 键不再产出（历史行保留展示）
 *   F. bddd 案形状锚定：BNC/通透人生/Ants 放行（退役代价如实——避亏功能改由
 *      web3FitMassBlock/量级门/实体门接棒，无机器证明等效）
 *   G. 源码口径：entityVisualBlock/CARRIER_LABELS/isAnimalRescueMemorialStory
 *      函数不存在；mapper 无 subjectCarrierImgOverride 计算链；题集版本 J1.102+
 *
 * 用法：node scripts/_test_subject_carrier.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

const GATE_LABEL = '叙事主体无形象载体';

/**
 * 标准路径基础形状：前置门（w3fit/pe/argmax/ne/we/ua）不命中，量级 A 档避开
 * 量级门，Stage3 不拦——专测形象轴退役后的放行行为。实体=new_entity（非著名）。
 */
function baseAnswers(cat, carrier) {
  const answers = {
    event_category: { choice: cat, probabilities: { [cat]: 0.7 } },
    event_magnitude: { score: 4.6, probabilities: { '4': 0.5, '5': 0.3 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.9 } },
    dimension2: { score: 25, probabilities: { '5': 0.6, '4': 0.3 } },
    event_quality_veto: { choice: 'none', probabilities: { none: 0.92 } },
    web3_user_name_entity_acceptance: { choice: 'new_entity', probabilities: { new_entity: 0.7, accepted: 0.2, unknown: 0.05 } },
    name_entity_memeability: { score: 3, probabilities: {} },
    web3_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.85, fit: 0.1 } },
    event_subject_entity: { choice: 'character_ip', probabilities: { character_ip: 0.7 } },
    name_event_relevance: { choice: 'exact_match', probabilities: { exact_match: 0.8 } },
    relevance_level: { score: 4.5, probabilities: { '4': 0.6, '5': 0.3 } },
    block_misspelling: { noul: 0.02 },
    quality_spelling: { score: 6.5 },
    quality_reasonability: { score: 4.5 },
  };
  if (carrier !== undefined) {
    // 旧缓存行形状：visuality 键仍在答案里（退役后 mapper 不读）
    answers.web3_user_entity_visuality = { choice: carrier, probabilities: carrier ? { [carrier]: 0.8 } : {} };
  }
  return answers;
}

const stdCtx = (symbol, name, imageEvidence) => ({
  tokenData: { symbol, name: name || symbol, raw_api_data: { name: name || symbol } },
  includeBrandHijack: false,
  tweetClassification: null,
  twitterInfo: null,
  ...(imageEvidence ? { imageEvidence: true } : {}),
  callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
});

function blockedByCarrier(r) {
  return r.llmResult.rating === 'low' && (r.llmResult.reason || '').includes(GATE_LABEL);
}

async function main() {
  const mapper = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const { mapStandardAnswers } = mapper;
  const { buildStandardQuestions, JEV_QUESTIONS_VERSION } = await import('../src/narrative/analyzer/llm/jev-questions.mjs');

  // ═══ A. 题集形状 ═══
  console.log('\n── A. 题集形状（J1.102/C171：三题退役、演绎题保留迁挂、锚句并入）──');
  check('A1 版本号 ≥ J1.102（C171 形象轴退役）', parseInt(JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 102, JEV_QUESTIONS_VERSION);
  const qsDefault = buildStandardQuestions();
  check('A2 visuality 题不再产出（任何形状）',
    !('web3_user_entity_visuality' in qsDefault) && !('web3_user_entity_visuality' in buildStandardQuestions({ carrier: true }))
    && !('name_entity_carrier' in qsDefault), Object.keys(qsDefault).length);
  check('A3 image_carrier_nature / event_influence 不再产出（imageConsistency 形状同）',
    !('image_carrier_nature' in buildStandardQuestions({ imageConsistency: true }))
    && !('event_influence' in qsDefault), null);
  const qsImg = buildStandardQuestions({ imageConsistency: true });
  check('A4 image_depicts_name 保留（用户裁定「演绎关系是事/币关联的一个维度」——迁 J1.30 关联豁免第二臂，仅 imageConsistency 时问）',
    'image_depicts_name' in qsImg && !('image_depicts_name' in qsDefault), null);
  check('A5 acceptance 题面含形象考量锚句（有形象=加分考量；无形象不否决）',
    qsDefault.web3_user_name_entity_acceptance.instructions.includes('⚠️ 形象考量：实体是否具有可视觉化的形象')
    && qsDefault.web3_user_name_entity_acceptance.instructions.includes('无形象本身不构成否决'), null);
  check('A6 phrase 题面不再引用 visuality 轴', !qsDefault.web3_user_phrase_acceptability.instructions.includes('visuality'), null);
  check('A7 J1.30 name_image_consistency 保留（量级/关联豁免仍消费）', 'name_image_consistency' in qsImg, null);

  // ═══ B. 判定矩阵反证 ═══
  console.log('\n── B. 判定矩阵反证（原 M2 拦截档位全部放行——无形象不再是拦截理由）──');
  const cases = [
    ['C', 'improvised_entity', 'C+improvised'],
    ['C', 'no_visual_entity', 'C+no_visual'],
    ['D', 'improvised_entity', 'D+improvised'],
    ['D', 'no_visual_entity', 'D+no_visual'],
    ['E', 'no_visual_entity', 'E+no_visual'],
  ];
  for (const [cat, carrier, note] of cases) {
    const r = mapStandardAnswers(baseAnswers(cat, carrier), stdCtx('TST', 'TST'));
    check(`B ${note} → 放行（门退役）`, !blockedByCarrier(r) && r.llmResult.rating !== 'low', r.llmResult.reason);
  }
  const rCImg = mapStandardAnswers(baseAnswers('C', 'improvised_entity'), stdCtx('TST', 'TST', true));
  check('B6 图证在场同样放行（imgCarrierOverride 豁免链随门退役——无门则无豁免）', !blockedByCarrier(rCImg), rCImg.llmResult.reason);

  // ═══ C. 旧缓存行 ═══
  console.log('\n── C. 旧缓存行（visuality/name_entity_carrier 键在场 mapper 不读）──');
  const oldKey = baseAnswers('D', 'improvised_entity');
  oldKey.name_entity_carrier = oldKey.web3_user_entity_visuality;
  delete oldKey.web3_user_entity_visuality;
  const rOldKey = mapStandardAnswers(oldKey, stdCtx('TST', 'TST'));
  check('C1 旧键 name_entity_carrier 行（J1.80 缓存）→ 不拦（双键读已删）', !blockedByCarrier(rOldKey), rOldKey.llmResult.reason);
  const rNewKey = mapStandardAnswers(baseAnswers('D', 'improvised_entity'), stdCtx('TST', 'TST'));
  check('C2 新键 visuality 行 → 不拦（mapper 不再消费）', !blockedByCarrier(rNewKey), rNewKey.llmResult.reason);

  // ═══ D. 门链序 ═══
  console.log('\n── D. 门链序（C180 后：we → 量级门；ne/ua 拦截臂退役）──');
  const nrFirst = baseAnswers('C', 'improvised_entity');
  nrFirst.web3_user_name_entity_acceptance = { choice: 'unknown', probabilities: { unknown: 0.85 } };
  const rNr = mapStandardAnswers(nrFirst, stdCtx('TST', 'TST'));
  check('D1 unknown 0.85 → 实体门不再拦（C180）+ 审计 nameEntityLowMass 照落 0.85',
    !/币名映射实体在 Web3 用户侧无名/.test(rNr.llmResult.reason || '')
    && rNr.stage2DataToSave.parsed_output.jev.nameEntityLowMass === 0.85, rNr.llmResult.reason);
  const famousWrong = baseAnswers('D', 'improvised_entity');
  famousWrong.web3_user_name_entity_acceptance = { choice: 'wrong_entity', probabilities: { wrong_entity: 0.8, accepted: 0.15 } };
  const rFW = mapStandardAnswers(famousWrong, stdCtx('TST', 'TST'));
  check('D2 指歪票照拦（wrong_entity 0.8 → we 门——著名/形象豁免全退役不救）',
    rFW.llmResult.rating === 'low' && /指歪|指残/.test(rFW.llmResult.reason || ''), rFW.llmResult.reason);
  const lowTier = baseAnswers('D', 'existing_entity');
  lowTier.web3_user_event_fit = { choice: 'marginal', probabilities: { strong_fit: 0.03, fit: 0.03, marginal: 0.84, unfit: 0.1 } };
  lowTier.web3_user_name_entity_acceptance = { choice: 'accepted', probabilities: { accepted: 0.9 } };
  const rTier = mapStandardAnswers(lowTier, stdCtx('币安TST', '币安TST'));
  check('D3 低量级（fit 派生 E 档）票照走量级门（ua 门后直接量级门，sc 位已删）',
    rTier.llmResult.rating === 'low' && (rTier.llmResult.reason || '').includes('量级不足'), rTier.llmResult.reason);

  // ═══ E. 审计字段 ═══
  console.log('\n── E. 审计（subjectCarrier* / eventInfluence 新行不产出——历史行保留展示）──');
  const rE = mapStandardAnswers(baseAnswers('D', 'improvised_entity'), stdCtx('TST', 'TST'));
  const jE = rE.stage2DataToSave.parsed_output.jev;
  const retiredKeys = ['subjectCarrier', 'subjectCarrierBlock', 'subjectCarrierFamousExempt',
    'subjectCarrierImgOverride', 'subjectCarrierReferentVeto', 'subjectCarrierEmptyImgOverride',
    'subjectCarrierEmotionalImpactExempt', 'eventInfluence', 'subjectCarrierMassiveInfluenceExempt',
    'subjectCarrierAuthorOverride'];
  const leaked = retiredKeys.filter(k => k in jE);
  check('E1 stage2 段 10 个退役键全部不产出', leaked.length === 0, leaked);
  check('E1b probabilities 不再落 name_entity_carrier 双源键', !('name_entity_carrier' in jE.probabilities), Object.keys(jE.probabilities));
  check('E2 stage3 段 subjectCarrierImgOverride/ReferentVeto/AuthorOverride 不产出',
    !(('subjectCarrierImgOverride' in (rE.stage3DataToSave?.parsed_output?.jev || {})))
    && !(('subjectCarrierReferentVeto' in (rE.stage3DataToSave?.parsed_output?.jev || {})))
    && !(('subjectCarrierAuthorOverride' in (rE.stage3DataToSave?.parsed_output?.jev || {}))), null);

  // ═══ F. bddd 案形状锚定 ═══
  console.log('\n── F. bddd 案形状锚定（退役代价如实——C61 立门时 BNC/通透人生为拦截样本）──');
  const rBnc = mapStandardAnswers(baseAnswers('D', 'improvised_entity'), stdCtx('BNC', 'Binance Cat'));
  check('F1 BNC 案（D+improvised，曾 +4.42 避亏样本）→ 现放行（避亏责任移交 web3Fit/量级门）', !blockedByCarrier(rBnc), rBnc.llmResult.reason);
  const rTyrs = mapStandardAnswers(baseAnswers('E', 'no_visual_entity'), stdCtx('通透人生', '通透人生'));
  check('F2 通透人生案（E+no_visual，M2 已知误伤样本）→ 现放行（退役收益面）', !blockedByCarrier(rTyrs), rTyrs.llmResult.reason);
  const rAnts = mapStandardAnswers(baseAnswers('E', 'improvised_entity'), stdCtx('Ants', 'Ants'));
  check('F3 Ants 案（E+improvised +1.42 戏谑票）→ 放行（行为不变）', !blockedByCarrier(rAnts), rAnts.llmResult.reason);

  // ═══ G. 源码口径 ═══
  console.log('\n── G. 源码口径（防复活）──');
  const { readFileSync } = await import('fs');
  const { join } = await import('path');
  const mapperSrc = readFileSync(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-result-mapper.mjs'), 'utf8');
  check('G1 entityVisualBlock 函数不存在（整链删除非空转）', !/function entityVisualBlock/.test(mapperSrc), null);
  check('G2 CARRIER_LABELS / isAnimalRescueMemorialStory / famousEntity 不存在（豁免链辅助全删）',
    !/CARRIER_LABELS/.test(mapperSrc) && !/isAnimalRescueMemorialStory/.test(mapperSrc) && !/const famousEntity/.test(mapperSrc), null);
  check('G3 形象门分支变量不存在（门链分支真删，留档注释外无引用）', !/let scBlock|scBlock =|gateBlockReason = scBlock/.test(mapperSrc), null);
  check('G4 门链序：C180 后 we 直向量级门（ne/ua 拦截臂退役，sc 位已删）', (() => {
    const weIdx = mapperSrc.indexOf('(weBlock = wrongEntityBlock(answers))');
    const tierIdx = mapperSrc.indexOf("} else if (!isW && (effTier === 'E' || effTier === 'D')");
    const neRetired = mapperSrc.indexOf('(neBlock = nameEntityLowBlock');
    const uaRetired = mapperSrc.indexOf('(uaBlock = web3UserAcceptabilityBlock');
    return weIdx > 0 && tierIdx > weIdx && neRetired === -1 && uaRetired === -1 ? true : { weIdx, tierIdx, neRetired, uaRetired };
  })());
  const qsSrc = readFileSync(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-questions.mjs'), 'utf8');
  check('G5 题集头部含 J1.102/C171 条目（案史档案）', qsSrc.includes('J1.102') && qsSrc.includes('C171'), null);
  check('G6 imgNameExempt 演绎臂在场（depictP≥0.5 或 nicMatchP≥0.5 → 关联豁免）',
    /\(nicMatchP >= 0\.5 \|\| depictP >= 0\.5\)/.test(mapperSrc), null);

  // ═══ 汇总 ═══
  console.log(`\n══════ _test_subject_carrier: ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('单测异常:', e); process.exit(1); });
