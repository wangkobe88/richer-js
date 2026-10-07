#!/usr/bin/env node
/**
 * C59 指代载体在图豁免（superIP 通道 Stage3 关联≤10 截断 × 配图视觉证据）
 * ——本地零 DB 单测（2026-10-07 现金猫案 0x56dc26bd…7777 用户裁定「我认为
 * 关联应该很强了」，mapper-only 不 bump 题集）
 *
 * 案形：binance「POV: TradersLeague 排行榜」语料簇，token 名 cashcat/现金猫与
 * 推文文字零交集——指代映射唯一载体是配图（白猫举金币）。C58 图片分析开启后
 * Jev 拿到真图证据判 cultural 10 分（exact_match 字面语义不允许更强档），同时
 * referent_memeability 3.47 高置信认定指代对象有 meme 生命力，三门全中豁免
 * 关联≤10 截断（relevance 分照常计入总分——J1.24 同款计分语义）。
 *
 * 三门：① imageEvidence（analyzer 传 = twitterInfo.image_analysis 存在——精确
 * 限定「指代载体在配图」子形状，无此门会误放 182 扫描实证的 8 行文化词蹭票）
 * ② 0 < relevance ≤ 10（只救会被拦的票；纯零关联不救）③ meme ≥ 3（J1.21 阈）
 *
 * 覆盖：
 *   A. 三门全中：现金猫数值锚定（84×0.6+10+15.63 = 76.03 high）+ reason 前缀
 *      + 审计 imgReferentExempt {relType, relScore, memeScore}
 *   B. 缺图门：同 answers 无 imageEvidence → 截断 low（牛马/HODL 蹭票形状）
 *   C. relevance=0（none/lv0）→ 不救（截断维持）
 *   D. relevance>10 → 本就不触截断，豁免不落键（命中才落的审计口径）
 *   E. meme 缺失/<3 → 不豁免（fail-closed）
 *   F. blocked 分支不受影响：web3 unfit 照拦（豁免不绕任何阻断门）
 *   G. J1.21 叠加：nrBlock 命中 + meme≥3 先放行，C59 再救关联截断（两豁免正交）
 *   H. 源码口径：截断链条件 / analyzer 传递点 / 标准路径零触达 / jsdoc
 *
 * 用法：node scripts/_test_superip_relevance_exempt.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

// ── 现金猫案真实形状（182 DB 实证 prestage_raw_output + preScores）──────────
// binance（S 级 institution）排行榜推文带图；带图后 relevance 0→10：
// relevance_type cultural × relevance_level 1.54（round=2 → cultural[2]=10）
// name_referent none_related 0.43 argmax，阻断侧 minor+common=0.48 < 0.5
// referent_memeability 3.47 / web3_fit strong_fit 0.96 / dim2 29 / symbol 现金猫
function cashcatAnswers(over = {}) {
  return {
    event_category: { choice: 'D', probabilities: { D: 0.52, C: 0.28, E: 0.1 } },
    event_magnitude: { score: 4.8, probabilities: { '5': 0.7, '4': 0.2 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.98 } },
    dimension2: { score: 4.75, probabilities: { '5': 0.62, '4': 0.25 } },
    block_reason: { choice: 'none', probabilities: { none: 0.9, institution_routine: 0.05 } },
    name_referent: { choice: 'none_related', probabilities: { none_related: 0.43, common_word: 0.43, minor_other: 0.05, super_ip: 0.06, notable_other: 0.02, subject_self: 0.01 } },
    web3_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.96, fit: 0.03, marginal: 0.01, unfit: 0 } },
    relevance_type: { choice: 'cultural', probabilities: { cultural: 0.44, semantic: 0.32, none: 0.18 } },
    relevance_level: { score: 1.54, probabilities: { '2': 0.4, '1': 0.3 } },
    referent_memeability: { score: 3.47, probabilities: { '4': 0.4, '3': 0.35 } },
    block_misspelling: { noul: 0.01 },
    quality_spelling: { score: 2.78 },
    quality_reasonability: { score: 1.85 },
    ...over,
  };
}

function superCtx(imageEvidence) {
  const ctx = {
    superIPInfo: { name: 'binance', type: 'institution', tier: 'S', desc: 'Binance official' },
    preScores: { tierScore: 40, timeliness: 15, baseEventScore: 55 },
    symbol: '现金猫',
    includeBrandHijack: false,
    callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  };
  if (imageEvidence !== undefined) ctx.imageEvidence = imageEvidence;
  return ctx;
}

async function main() {
  const { mapSuperIPAnswers, mapStandardAnswers } = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');

  // ═══ A. 三门全中：现金猫数值锚定 ═══
  console.log('\n── A. 三门全中（现金猫 0x56dc26bd…7777 数值锚定）──');
  const rA = mapSuperIPAnswers(cashcatAnswers(), superCtx(true));
  const jevA = rA.prestageDataToSave.parsed_output.jev;
  // eventTotal = 55 + 29(dim2 bandInterpolate 4.75 → [26,30] 内 26+0.75×4=29) = 84
  // eventWeighted = 84×0.6 = 50.4；quality = 8(3汉字) + 4.78(拼) + 2.85(合) = 15.63
  // total = 50.4 + 10 + 15.63 = 76.03 → high
  check('A1 豁免生效：low 截断 → high 76.03', rA.llmResult.rating === 'high' && rA.llmResult.score === 76.03, rA.llmResult);
  check('A2 reason 前缀「指代载体在图豁免(C59)」且关联 10 照计',
    rA.llmResult.reason.includes('指代载体在图豁免(C59)') && rA.llmResult.reason.includes('关联10(cultural)'), rA.llmResult.reason);
  check('A3 审计 imgReferentExempt {relType, relScore, memeScore}',
    JSON.stringify(jevA.imgReferentExempt) === JSON.stringify({ relType: 'cultural', relScore: 10, memeScore: 3.47 }), jevA.imgReferentExempt);
  check('A4 stageFinalData 全量落值（totalScore/relevanceScore/qualityScore）',
    rA.stageFinalData.totalScore === 76.03 && rA.stageFinalData.relevanceScore === 10 && rA.stageFinalData.qualityScore === 15.63, rA.stageFinalData);

  // ═══ B. 缺图门：牛马/HODL 蹭票形状（文化词蹭 superIP 语料无图承载）═══
  console.log('\n── B. 缺图门（imageEvidence 缺失/false）──');
  const rB1 = mapSuperIPAnswers(cashcatAnswers(), superCtx(undefined));
  check('B1 未传 imageEvidence → 截断「关联性不足（10分）」low',
    rB1.llmResult.rating === 'low' && rB1.llmResult.reason.includes('关联性不足（10分）'), rB1.llmResult.reason);
  const rB2 = mapSuperIPAnswers(cashcatAnswers(), superCtx(false));
  check('B2 imageEvidence=false → 同截断', rB2.llmResult.rating === 'low' && rB2.llmResult.reason.includes('截断'), rB2.llmResult.reason);
  check('B3 缺图门票审计 imgReferentExempt=null（命中才落）',
    rB1.prestageDataToSave.parsed_output.jev.imgReferentExempt === null && rB2.prestageDataToSave.parsed_output.jev.imgReferentExempt === null, null);

  // ═══ C. relevance=0 不救 ═══
  console.log('\n── C. 纯零关联（none/lv0 → 0 分）──');
  const zeroRel = cashcatAnswers({
    relevance_type: { choice: 'none', probabilities: { none: 0.85, cultural: 0.1 } },
    relevance_level: { score: 0.2, probabilities: { '0': 0.8, '1': 0.15 } },
  });
  const rC = mapSuperIPAnswers(zeroRel, superCtx(true));
  check('C1 图证据 + meme 3.47 但零关联 → 截断维持 low',
    rC.llmResult.rating === 'low' && rC.llmResult.reason.includes('关联性不足（0分）'), rC.llmResult.reason);

  // ═══ D. relevance>10：本就不触截断，豁免不落键 ═══
  console.log('\n── D. 关联 >10（cultural lv3 → 14 分）──');
  const highRel = cashcatAnswers({
    relevance_level: { score: 2.6, probabilities: { '3': 0.5, '2': 0.3 } },
  });
  const rD = mapSuperIPAnswers(highRel, superCtx(true));
  check('D1 14 分票照常计分（无截断无豁免语义）',
    rD.llmResult.pass === true && rD.llmResult.score != null && rD.llmResult.reason.includes('关联14'), rD.llmResult.reason);
  check('D2 审计 imgReferentExempt=null（>10 不属「会被拦」域）',
    rD.prestageDataToSave.parsed_output.jev.imgReferentExempt === null, rD.prestageDataToSave.parsed_output.jev.imgReferentExempt);

  // ═══ E. meme 门 fail-closed ═══
  console.log('\n── E. referent_memeability 缺失/<3 ──');
  const { referent_memeability: _drop, ...noMeme } = cashcatAnswers();
  const rE1 = mapSuperIPAnswers(noMeme, superCtx(true));
  check('E1 分缺失（条件题未答形状）→ 截断维持', rE1.llmResult.rating === 'low' && rE1.llmResult.reason.includes('关联性不足（10分）'), rE1.llmResult.reason);
  const rE2 = mapSuperIPAnswers(cashcatAnswers({ referent_memeability: { score: 2.9, probabilities: {} } }), superCtx(true));
  check('E2 meme 2.9（玩味弱/圈外档）→ 截断维持', rE2.llmResult.rating === 'low', rE2.llmResult.rating);
  const rE3 = mapSuperIPAnswers(cashcatAnswers({ referent_memeability: { score: 3, probabilities: {} } }), superCtx(true));
  check('E3 meme 3（J1.21 AND 下限）→ 豁免（边界 ≥3）', rE3.llmResult.rating === 'high', rE3.llmResult.rating);

  // ═══ F. blocked 分支不受影响 ═══
  console.log('\n── F. 阻断门不受豁免影响（web3 unfit 照拦）──');
  const unfit = cashcatAnswers({
    web3_fit: { choice: 'unfit', probabilities: { unfit: 0.72, marginal: 0.2 } },
  });
  const rF = mapSuperIPAnswers(unfit, superCtx(true));
  check('F1 三门全中 + web3 unfit≥0.5 → 仍 blockedByWeb3Unfit low',
    rF.llmResult.rating === 'low' && rF.llmResult.reason.includes('Web3用户偏好不合'), rF.llmResult.reason);

  // ═══ G. J1.21 叠加（两豁免正交）═══
  console.log('\n── G. nrBlock 命中 × meme≥3（J1.21 放行 + C59 救关联）──');
  const nrHit = cashcatAnswers({
    name_referent: { choice: 'common_word', probabilities: { common_word: 0.58, none_related: 0.3, minor_other: 0.06 } },
  });
  const rG1 = mapSuperIPAnswers(nrHit, superCtx(true));
  check('G1 J1.21 放行（nameReferentExempt）+ C59 救关联 → high 76.03',
    rG1.llmResult.rating === 'high' && rG1.llmResult.score === 76.03
      && rG1.prestageDataToSave.parsed_output.jev.nameReferentExempt === true, rG1.llmResult);
  const rG2 = mapSuperIPAnswers(nrHit, superCtx(false));
  check('G2 同票缺图门 → J1.21 放行后仍死关联截断（C59 是唯一差分）',
    rG2.llmResult.rating === 'low' && rG2.llmResult.reason.includes('关联性不足（10分）'), rG2.llmResult.reason);

  // ═══ H. 源码口径 ═══
  console.log('\n── H. 源码口径 ──');
  const { readFileSync } = await import('fs');
  const { join } = await import('path');
  const root = join(__dirname, '..');
  const mapperSrc = readFileSync(join(root, 'src', 'narrative', 'analyzer', 'llm', 'jev-result-mapper.mjs'), 'utf8');
  const superipSeg = mapperSrc.slice(mapperSrc.indexOf('export function mapSuperIPAnswers'));
  const stdSeg = mapperSrc.slice(mapperSrc.indexOf('export function mapStandardAnswers'), mapperSrc.indexOf('export function mapSuperIPAnswers'));
  check('H1 截断链条件 = relevance.score <= 10 && !imgReferentExempt（superIP 段）',
    superipSeg.includes('relevance.score <= 10 && !imgReferentExempt'), null);
  check('H2 三门条件齐备（imageEvidence / 0<relevance / meme≥REFERENT_MEME_EXEMPT_MIN）',
    /const imgReferentExempt = !!context\.imageEvidence/.test(superipSrc2(mapperSrc))
      && superipSeg.includes('relevance.score > 0 && relevance.score <= 10')
      && superipSeg.includes('referentMemeScore >= REFERENT_MEME_EXEMPT_MIN'), null);
  check('H3 标准路径零触达（imgReferentExempt 不在 mapStandardAnswers 域）',
    !stdSeg.includes('imgReferentExempt'), null);
  check('H4 标准路径关联截断无豁免子句（旧语义不变）', stdSeg.includes('relevance.score <= 10 && !punExempt'), null);
  const analyzerSrc = readFileSync(join(root, 'src', 'narrative', 'analyzer', 'NarrativeAnalyzer.mjs'), 'utf8');
  check('H5 analyzer superIP 分支传递 imageEvidence = !!twitterInfo?.image_analysis',
    /imageEvidence: !!twitterInfo\?\.image_analysis/.test(analyzerSrc), null);
  const analyzerSuperipSeg = analyzerSrc.slice(analyzerSrc.indexOf('mapSuperIPAnswers(result.answers'), analyzerSrc.indexOf('mapSuperIPAnswers(result.answers') + 700);
  check('H6 传递点在 superIP 调用 context 内（非全局）', analyzerSuperipSeg.includes('imageEvidence'), null);
  check('H7 jsdoc 补 context.imageEvidence（C59 条件①）', mapperSrc.includes('@param {boolean} [context.imageEvidence]'), null);

  console.log(`\n══════ _test_superip_relevance_exempt: ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

// H2 辅助：从 imgReferentExempt 声明起截取（superipSeg 上面已从函数头截，这里取条件体域）
function superipSrc2(src) {
  const i = src.indexOf('const imgReferentExempt');
  return i >= 0 ? src.slice(i, i + 400) : '';
}

main().catch(e => { console.error('单测异常:', e); process.exit(1); });
