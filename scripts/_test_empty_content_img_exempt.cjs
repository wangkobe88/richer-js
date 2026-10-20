#!/usr/bin/env node
/**
 * C114 DND 案两条口径单测（mapper 代码臂 + J1.47 题面锚）——零 DB 零网络
 * （2026-10-19 用户裁定「dev 侧不管，只管叙事分析。选1」）
 *
 * 案发（0x4dbcb10e68626b6f663bd596905d41cdc6b07777「DND」）：币安地域子账号
 * 发推「DND 😾」+猫拉窗帘视频，token=同名缩写票。Jev 判 event_empty_content 0.36
 * vs none 0.31 掷骰边缘拦截（argmax 臂）——结论 low 碰巧对但理由不干净：
 * 图/视频在场时「空洞内容」不成立（图就是内容），该票的正确拦截轴是
 * D 档量级（地域子账号无借壳），叙事层用站不住的维度拦会误伤真·大号
 * 官方梗票。同案 CRO（工牌 CHIEF RISK OFFICER→CRO）=名字门对照票：
 * 机构职位缩写用户无 meme 感知，not_meme_name 照拦（J1.47 锚）。
 *
 * 口径①（mapper）：block 门 event_empty_content 臂 ∧ context.imageEvidence →
 *   不拦（fallthrough 名字门/载体门/量级门照常接管）；审计键
 *   emptyContentImgOverride 命中才落（stage2 jev——拦截票 stage1 段被
 *   __clear，本键必须落 stage2 才可追溯）。
 * 口径②（题集 J1.47）：name_form 合格分支②扩通用网络梗/文化缩写
 *   （DND/FOMO/LFG），不合格分支加机构职位/品牌内部缩写（CRO）。
 *
 * 覆盖：
 *   A. 事故现场反证（DND 全值形状：图证在场翻过 event_empty_content → D 档量级门
 *      拦=理由干净；审计键落 stage2）
 *   B. 无图票照拦（图证 false / context 键缺失两臂=纯文字空洞票语义不变）
 *   C. 误伤面正证（同形状升 A 档大号梗票 → pass=true=C114 救的面）
 *   D. 门链接管正证（图证在场但 name_form=not_meme_name → 名字门照拦，
 *      豁的是 event_empty_content 不是免检）
 *   E. 桶特异性（图证在场 event_institution_routine 照拦=豁免只对 event_empty_content）
 *   F. 概率门对照（none≥0.5 本就不拦，与图证豁免正交）
 *   G. 审计键细节（emptyP/noneP 可追溯；非命中臂=null）
 *   H. 源码口径（mapper 臂形状/审计键/J1.47 版本/题面锚四反证）
 *
 * 用法：node scripts/_test_empty_content_img_exempt.cjs
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
 * DND 案现场形状（token_narrative 重析实测值的简化版，J1.43+ 新题集形状）：
 * D 类 0.7 / magnitude 1.2（round→1=D 档）/ event_empty_content 0.36 vs none 0.31
 * 掷骰 / name_form=meme_name（J1.47 后 DND=通用梗缩写合格）/ 载体 existing
 * （猫拉窗帘视频=形象在场）/ semantic_clear 13 分（>10 不触发 Stage3 截断）
 */
function dndAnswers(overrides = {}) {
  return {
    event_category: { choice: 'D', probabilities: { D: 0.7, G: 0.2 } },
    event_magnitude: { score: 1.2, probabilities: { '1': 0.6, '2': 0.3 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.9 } },
    dimension2: { score: 12, probabilities: { '2': 0.5, '3': 0.3 } },
    event_token_block_reason: { choice: 'event_empty_content', probabilities: { event_empty_content: 0.36, none: 0.31, event_institution_routine: 0.15 } },
    web3_user_name_entity_acceptance: { choice: 'no_entity', probabilities: { no_entity: 0.6, unknown: 0.2 } },
    name_entity_memeability: { score: 2.5, probabilities: {} },
    web3_user_event_fit: { choice: 'fit', probabilities: { fit: 0.5, strong_fit: 0.3 } },
    name_entity_carrier: { choice: 'existing_entity', probabilities: { existing_entity: 0.6, no_visual_entity: 0.3 } },
    event_subject_entity: { choice: 'other_entity', probabilities: { other_entity: 0.7 } },
    name_event_relevance: { choice: 'semantic_clear', probabilities: { semantic_clear: 0.5, none: 0.2 } },
    token_name_quality: { score: 10, probabilities: {} },
    name_form: { choice: 'meme_name', probabilities: { meme_name: 0.7, not_meme_name: 0.2 } },
    event_finding_vs_recap: { choice: 'finding', probabilities: { finding: 0.7 } },
    ...overrides,
  };
}

const dndCtx = (imageEvidence) => ({
  tokenData: { symbol: 'DND', name: 'DND', raw_api_data: { name: 'DND' } },
  includeBrandHijack: false,
  tweetClassification: null,
  twitterInfo: { author_screen_name: 'BinancePk', author_followers_count: 800000, text: 'DND 😾' },
  ...(imageEvidence === undefined ? {} : { imageEvidence }),
  callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
});

const s2jev = (r) => r.stage2DataToSave.parsed_output.jev;

async function main() {
  const mapperPath = join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-result-mapper.mjs');
  const qPath = join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-questions.mjs');
  const { mapStandardAnswers } = await import(mapperPath);

  // ═══ A. 事故现场反证（DND 全值形状）═══
  console.log('\n── A. 事故现场反证 ──');
  const rA = mapStandardAnswers(dndAnswers(), dndCtx(true));
  check('A1 图证在场：不再被「空洞内容」拦（reason 不含 event_empty_content label）',
    rA.llmResult.rating === 'low' && !(rA.llmResult.reason || '').includes('空洞内容'),
    rA.llmResult.reason);
  check('A2 fallthrough 到 D 档量级门=拦截理由干净（地域小号无借壳，量级轴成立）',
    (rA.llmResult.reason || '').includes('量级不足') && (rA.llmResult.reason || '').includes('D档'),
    rA.llmResult.reason);
  check('A3 审计键落 stage2 jev（拦截票 stage1 段被 __clear，本键必须在此）',
    s2jev(rA).emptyContentImgOverride != null
      && s2jev(rA).emptyContentImgOverride.emptyP === 0.36
      && s2jev(rA).emptyContentImgOverride.noneP === 0.31,
    s2jev(rA).emptyContentImgOverride);

  // ═══ B. 无图票照拦（纯文字空洞票语义不变）═══
  console.log('\n── B. 无图票照拦 ──');
  const rB1 = mapStandardAnswers(dndAnswers(), dndCtx(false));
  check('B1 图证 false：event_empty_content argmax 照拦（掷骰边缘=原行为）',
    rB1.llmResult.rating === 'low' && (rB1.llmResult.reason || '').includes('空洞内容'),
    rB1.llmResult.reason);
  check('B1b 无图票审计键不落（event_empty_content 拦截零歧义）',
    s2jev(rB1).emptyContentImgOverride === null, s2jev(rB1).emptyContentImgOverride);
  const rB2 = mapStandardAnswers(dndAnswers(), dndCtx(undefined));
  check('B2 context 键缺失（旧调用方形状）：fail-safe 回落原行为照拦',
    rB2.llmResult.rating === 'low' && (rB2.llmResult.reason || '').includes('空洞内容'),
    rB2.llmResult.reason);

  // ═══ C. 误伤面正证（真·大号梗票被救回）═══
  console.log('\n── C. 误伤面正证 ──');
  const bigAcct = dndAnswers({
    event_magnitude: { score: 4.2, probabilities: { '5': 0.47, '3': 0.42 } }, // A 档
    dimension2: { score: 20, probabilities: { '4': 0.5, '5': 0.3 } },        // 34+20+15=69≥60
  });
  const rC = mapStandardAnswers(bigAcct, dndCtx(true));
  check('C1 同形状升 A 档（大号官方梗票）→ pass=true（C114 修的误伤面）',
    rC.llmResult.pass === true, rC.llmResult.reason);
  check('C2 pass 票审计键照落（豁免轨迹可追溯）',
    s2jev(rC).emptyContentImgOverride?.emptyP === 0.36, s2jev(rC).emptyContentImgOverride);
  const rC2 = mapStandardAnswers(bigAcct, dndCtx(false));
  check('C3 对照：同票无图证 → 仍被 event_empty_content 拦（图证是豁免的唯一钥匙）',
    rC2.llmResult.rating === 'low' && (rC2.llmResult.reason || '').includes('空洞内容'),
    rC2.llmResult.reason);

  // ═══ D. 门链接管正证（豁 event_empty_content ≠ 免检）═══
  console.log('\n── D. 门链接管正证 ──');
  const rD = mapStandardAnswers(dndAnswers({
    name_form: { choice: 'not_meme_name', probabilities: { not_meme_name: 0.66, meme_name: 0.2 } }, // CRO 对照形状
  }), dndCtx(true));
  check('D1 图证在场但 name_form=not_meme_name（CRO 机构职位缩写形状）→ 名字门照拦',
    rD.llmResult.rating === 'low' && (rD.llmResult.reason || '').includes('名字'),
    rD.llmResult.reason);
  check('D2 名字门拦截票审计键照落（被豁的 event_empty_content 与接管门各自可追溯）',
    s2jev(rD).emptyContentImgOverride != null && s2jev(rD).web3UserAcceptabilityBlock != null,
    { ec: s2jev(rD).emptyContentImgOverride, nf: s2jev(rD).web3UserAcceptabilityBlock });

  // ═══ E. 桶特异性（豁免只对 event_empty_content）═══
  console.log('\n── E. 桶特异性 ──');
  const rE = mapStandardAnswers(dndAnswers({
    event_token_block_reason: { choice: 'event_institution_routine', probabilities: { event_institution_routine: 0.55, none: 0.3 } },
  }), dndCtx(true));
  check('E1 图证在场 event_institution_routine 照拦（D 类域内，豁免不外溢）',
    rE.llmResult.rating === 'low' && (rE.llmResult.reason || '').includes('机构日常运营'),
    rE.llmResult.reason);
  check('E2 非 event_empty_content 臂审计键=null', s2jev(rE).emptyContentImgOverride === null, null);

  // ═══ F. 概率门对照（none≥0.5 本就不拦，与图证豁免正交）═══
  console.log('\n── F. 概率门对照 ──');
  const rF = mapStandardAnswers(dndAnswers({
    event_token_block_reason: { choice: 'event_empty_content', probabilities: { event_empty_content: 0.2, none: 0.6 } },
    event_magnitude: { score: 4.2, probabilities: { '5': 0.47, '3': 0.42 } },
    dimension2: { score: 20, probabilities: { '4': 0.5, '5': 0.3 } },
  }), dndCtx(false));
  check('F1 none 0.6≥0.5：无图证也不拦（原概率门语义不变，pass 线另判）',
    rF.llmResult.pass === true, rF.llmResult.reason);
  check('F2 概率门放行≠豁免触发：审计键=null（无图证不落键）',
    s2jev(rF).emptyContentImgOverride === null, null);

  // ═══ G. 审计键细节 ═══
  console.log('\n── G. 审计键细节 ──');
  const rG = mapStandardAnswers(dndAnswers({
    event_token_block_reason: { choice: 'event_empty_content', probabilities: { event_empty_content: 0.44, none: 0.28 } },
  }), dndCtx(true));
  check('G1 emptyP/noneP 随现场值（round2 可追溯）',
    s2jev(rG).emptyContentImgOverride.emptyP === 0.44 && s2jev(rG).emptyContentImgOverride.noneP === 0.28,
    s2jev(rG).emptyContentImgOverride);
  check('G2 blockChoice 保留原判（豁免不改 Jev 答案，归因可分）',
    s2jev(rG).blockChoice === 'event_empty_content', s2jev(rG).blockChoice);

  // ═══ H. 源码口径（回潮防线）═══
  console.log('\n── H. 源码口径 ──');
  const mapperSrc = readFileSync(mapperPath, 'utf8');
  const qSrc = readFileSync(qPath, 'utf8');
  check('H1 mapper 臂形状（blockChoice event_empty_content ∧ imageEvidence）',
    mapperSrc.includes("&& !(blockChoice === 'event_empty_content' && !!context.imageEvidence)"), null);
  check('H2 审计键在 stage2 jev 段（拦截票可追溯位）',
    /const stage2DataToSave = \{[\s\S]{0,3000}emptyContentImgOverride/.test(mapperSrc), null);
  const { JEV_QUESTIONS_VERSION } = await import(qPath);
  check('H3 JEV_QUESTIONS_VERSION=J1.74（J1.74=C134 W 交互臂→BSC 用户吸引力；J1.72=C133 实体题新增 new_entity；bump 纪律；J1.55=C124 web3_user_name_entity_acceptance 圈内符号级锚（super_ip=被当符号使用证据级；发布者指代分支/三前提/配图臂保留）；J1.54=C123 门名/题键语义化（event_magnitude→web3_user_event_impact / dimension2→web3_user_event_spread + 门函数/审计键改名，判据零改动）；J1.53=C122 门名断代；J1.52=C121 用户视角批次一：w_product_score 用户兴奋度锚+niche_subculture 认知可达性锚；J1.51=C119 批内修正 dim2 镜头（认知面非实测互动）；J1.47=C114 通用梗缩写锚，J1.48=C116 整句情绪姿态分界，J1.49=C118 image_depicts_name 演绎题，J1.50=C119 用户视角统一+name_form 键名断代 web3_user_acceptable/web3_user_not_acceptable/unclear）', JEV_QUESTIONS_VERSION === 'J1.75', JEV_QUESTIONS_VERSION);
  check('H4 题面合格分支②含通用网络梗缩写锚（DND/FOMO/LFG）',
    qSrc.includes('通用网络梗/文化缩写同构（如 DND=do not disturb、FOMO、LFG）'), null);
  check('H5 题面不合格分支含机构职位缩写（工牌 Chief Risk Officer→CRO）',
    qSrc.includes('机构职位/品牌内部缩写（如工牌上的 Chief Risk Officer→CRO）'), null);
  check('H6 对照锚含 DND/CRO 缩写对（J1.50 措辞：能接纳/不能接纳；分界=用户侧感知）',
    qSrc.includes('「DND」能接纳') && qSrc.includes('「CRO」不能接纳'), null);
  check('H7 criteria 同步（web3_user_acceptable 含通用网络梗缩写 / web3_user_not_acceptable 含机构职位缩写）',
    /通用网络梗\/文化缩写（DND\/FOMO\/LFG）/.test(qSrc) && /机构职位\/品牌内部缩写（工牌 Chief Risk Officer→CRO）/.test(qSrc), null);

  // ═══ 汇总 ═══
  console.log(`\n══════ _test_empty_content_img_exempt: ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('单测异常:', e); process.exit(1); });
