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
 * 官方梗票。同案 CRO（工牌 CHIEF RISK OFFICER→CRO）原=名字门对照票
 * （J1.47 机构职位缩写锚）——2026-10-24 C187/J1.116 用户裁定翻案：
 * 「Chief Risk Officer 是玩梗呢，可以接受」，机构职位缩写不合格臂整条
 * 退役（DND 正样本保留），题面不再含 CRO/机构职位缩写文本。
 *
 * 口径①（mapper）：block 门 event_empty_content 臂 ∧ context.imageEvidence →
 *   不拦（fallthrough 名字门/载体门/量级门照常接管）；审计键
 *   emptyContentImgOverride 命中才落（stage2 jev——拦截票 stage1 段被
 *   __clear，本键必须落 stage2 才可追溯）。
 * 口径②（题集 J1.47→J1.116）：通用网络梗/文化缩写（DND/FOMO/LFG）
 *   合格锚保留；机构职位/品牌内部缩写（CRO）不合格臂已随 CRO 判例翻案
 *   退役（C187/J1.116 三因素重构：①有来由②有感染力③名字形态）。
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
    event_quality_veto: { choice: 'event_empty_content', probabilities: { event_empty_content: 0.36, none: 0.31, event_institution_routine: 0.15 } },
    web3_user_name_entity_acceptance: { choice: 'no_entity', probabilities: { no_entity: 0.6, unknown: 0.2 } },
    name_entity_memeability: { score: 2.5, probabilities: {} },
    web3_user_event_fit: { choice: 'marginal', probabilities: { strong_fit: 0.1, fit: 0.05, marginal: 0.7, unfit: 0.15 } },
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
  check('A2 fallthrough 到契合证据门=拦截理由干净（J1.83/C141 同轴遮蔽：J1.79 后 D 档量级域 fitMass[0.1,0.3) ⊂ 门域 [0,0.5)，量级轴拦截位语义等价迁移至契合门——sf+fit 15%<50% 地域小号无借壳照拦）',
    (rA.llmResult.reason || '').includes('Web3用户契合证据不足') && (rA.llmResult.reason || '').includes('15%'),
    rA.llmResult.reason);
  check('A3 审计键落 stage2 jev（拦截票 stage1 段被 __clear，本键必须在此）',
    s2jev(rA).emptyContentImgOverride != null
      && s2jev(rA).emptyContentImgOverride.emptyP === 0.36
      && s2jev(rA).emptyContentImgOverride.noneP === 0.31,
    s2jev(rA).emptyContentImgOverride);

  // ═══ B. 无图票照拦（纯文字空洞票语义不变）═══
  // J1.83/C141：DND 实测 fitMass 15% 形状先被契合证据门拦（A2 同轴遮蔽），
  // 无图/有图的 empty_content 门差别在实测形状下不可见——本段起 fit 提过线
  //（0.65，B 档量级 65 分），豁免链验证目标（argmax 臂/审计键/接管门）不变
  console.log('\n── B. 无图票照拦 ──');
  const fitOk = { choice: 'fit', probabilities: { strong_fit: 0.55, fit: 0.1, marginal: 0.3, unfit: 0.05 } };
  const rB1 = mapStandardAnswers(dndAnswers({ web3_user_event_fit: fitOk }), dndCtx(false));
  check('B1 图证 false：event_empty_content argmax 照拦（掷骰边缘=原行为）',
    rB1.llmResult.rating === 'low' && (rB1.llmResult.reason || '').includes('空洞内容'),
    rB1.llmResult.reason);
  check('B1b 无图票审计键不落（event_empty_content 拦截零歧义）',
    s2jev(rB1).emptyContentImgOverride === null, s2jev(rB1).emptyContentImgOverride);
  const rB2 = mapStandardAnswers(dndAnswers({ web3_user_event_fit: fitOk }), dndCtx(undefined));
  check('B2 context 键缺失（旧调用方形状）：fail-safe 回落原行为照拦',
    rB2.llmResult.rating === 'low' && (rB2.llmResult.reason || '').includes('空洞内容'),
    rB2.llmResult.reason);

  // ═══ C. 误伤面正证（真·大号梗票被救回）═══
  // ═══ C. C114b 收窄（RichardTeng 0x007f5ddb…7777 案，J1.111/C181b）═══
  // J1.111 事件层优先后 veto 判 empty_content 0.95/none 0.01，但仍 high 71.11
  // ——C114 图证豁免吞掉拦截；该票配图 Jev 自判 decorative 0.93（装饰图与币名
  // 无关）≠「图就是内容」假设 → 收窄：decorative≥0.5 明确时豁免失效照拦
  console.log('\n── C114b. decorative 收窄（RichardTeng 0x007f5ddb…7777 反证）──');
  const rtFit = { choice: 'strong_fit', probabilities: { strong_fit: 0.46, fit: 0.17, marginal: 0.26, unfit: 0.11 } };
  const rtBase = {
    web3_user_event_impact: { choice: 'event_empty_content', probabilities: { event_empty_content: 0.95, none: 0.01, token_ip_reuse: 0.04 } },
    image_depicts_name: { choice: 'decorative', probabilities: { decorative: 0.93, depicts_name: 0.04, unclear: 0.03 } },
  };
  const rtCtx = (ev) => ({ ...dndCtx(ev), tokenData: { symbol: 'RichardTeng', name: 'RichardTeng', raw_api_data: { name: 'RichardTeng' } } });
  const rtR1 = mapStandardAnswers(dndAnswers({ ...rtBase, web3_user_event_fit: rtFit }), rtCtx(true));
  check('C1 图证在场+decorative 0.93：豁免失效照拦（空洞内容）',
    rtR1.llmResult.rating === 'low' && (rtR1.llmResult.reason || '').includes('空洞内容'),
    rtR1.llmResult.reason);
  check('C1b decorative 收窄后审计键不落（emptyContentImgOverride=豁免命中才落）',
    s2jev(rtR1).emptyContentImgOverride === null, s2jev(rtR1).emptyContentImgOverride);
  const rtR2 = mapStandardAnswers(dndAnswers({
    ...rtBase,
    web3_user_event_fit: rtFit,
    image_depicts_name: { choice: 'depicts_name', probabilities: { depicts_name: 0.9, decorative: 0.06, unclear: 0.04 } },
  }), rtCtx(true));
  check('C2 图描绘币名（depicts_name 0.9）：豁免照旧（图=内容假设成立，C114 原语义保留）',
    !(rtR2.llmResult.reason || '').includes('空洞内容') || s2jev(rtR2).emptyContentImgOverride != null,
    rtR2.llmResult.reason);
  // 答案缺失臂（删除 image_depicts_name）：fail-open 照旧豁免（存量历史行零翻转）
  const aC3 = dndAnswers({ ...rtBase, web3_user_event_fit: rtFit }); delete aC3.image_depicts_name;
  const rtR3b = mapStandardAnswers(aC3, rtCtx(true));
  check('C3 image_depicts_name 缺失（旧缓存行/无图不问）：豁免照旧（fail-open，存量零翻转）',
    !(rtR3b.llmResult.reason || '').includes('空洞内容'),
    rtR3b.llmResult.reason);

  console.log('\n── C. 误伤面正证 ──');
  const bigAcct = dndAnswers({
    event_magnitude: { score: 4.2, probabilities: { '5': 0.47, '3': 0.42 } }, // 旧 A 档形状
    web3_user_event_fit: { choice: 'fit', probabilities: { strong_fit: 0, fit: 0.8 } }, // J1.79 事件分 80/A 档
    dimension2: { score: 20, probabilities: { '4': 0.5, '5': 0.3 } },        // 48+13+18=79≥60
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
    web3_user_event_fit: fitOk, // 过线（同 B 段）：豁免链验证不混入契合门
    name_form: { choice: 'not_meme_name', probabilities: { not_meme_name: 0.66, meme_name: 0.2 } }, // CRO 对照形状
  }), dndCtx(true));
  check('D1 图证在场但 name_form=not_meme_name（CRO 机构职位缩写形状）→ 词句门拦（C189 恢复：图证豁免只翻 empty_content 本门，名字门接管照拦）',
    /词句接纳度门/.test(rD.llmResult.reason || ''),
    rD.llmResult.reason);
  check('D2 词句门纯观察落档照旧（被豁的 event_empty_content 与词句判定值各自可追溯）',
    s2jev(rD).emptyContentImgOverride != null && s2jev(rD).web3UserAcceptabilityBlock?.choice === 'not_meme_name',
    { ec: s2jev(rD).emptyContentImgOverride, nf: s2jev(rD).web3UserAcceptabilityBlock });

  // ═══ E. 桶特异性（豁免只对 event_empty_content）═══
  console.log('\n── E. 桶特异性 ──');
  const rE = mapStandardAnswers(dndAnswers({
    web3_user_event_fit: fitOk, // 过线（同 B 段）：豁免链验证不混入契合门
    event_quality_veto: { choice: 'event_institution_routine', probabilities: { event_institution_routine: 0.55, none: 0.3 } },
  }), dndCtx(true));
  check('E1 event_institution_routine 已退役（J1.88/C150）：旧 choice 不再拦（无「机构日常运营」reason）',
    !(rE.llmResult.reason || '').includes('机构日常运营'),
    rE.llmResult.reason);
  check('E2 非 event_empty_content 臂审计键=null', s2jev(rE).emptyContentImgOverride === null, null);

  // ═══ F. 概率门对照（none≥0.5 本就不拦，与图证豁免正交）═══
  console.log('\n── F. 概率门对照 ──');
  const rF = mapStandardAnswers(dndAnswers({
    event_quality_veto: { choice: 'event_empty_content', probabilities: { event_empty_content: 0.2, none: 0.6 } },
    event_magnitude: { score: 4.2, probabilities: { '5': 0.47, '3': 0.42 } },
    web3_user_event_fit: { choice: 'fit', probabilities: { strong_fit: 0, fit: 0.8 } }, // J1.79 事件分 80（pass 线另判）
    dimension2: { score: 20, probabilities: { '4': 0.5, '5': 0.3 } },
  }), dndCtx(false));
  check('F1 none 0.6≥0.5：无图证也不拦（原概率门语义不变，pass 线另判）',
    rF.llmResult.pass === true, rF.llmResult.reason);
  check('F2 概率门放行≠豁免触发：审计键=null（无图证不落键）',
    s2jev(rF).emptyContentImgOverride === null, null);

  // ═══ G. 审计键细节 ═══
  console.log('\n── G. 审计键细节 ──');
  const rG = mapStandardAnswers(dndAnswers({
    event_quality_veto: { choice: 'event_empty_content', probabilities: { event_empty_content: 0.44, none: 0.28 } },
  }), dndCtx(true));
  check('G1 emptyP/noneP 随现场值（round2 可追溯）',
    s2jev(rG).emptyContentImgOverride.emptyP === 0.44 && s2jev(rG).emptyContentImgOverride.noneP === 0.28,
    s2jev(rG).emptyContentImgOverride);
  check('G2 blockChoice 保留原判（豁免不改 Jev 答案，归因可分）',
    s2jev(rG).blockChoice === 'event_empty_content', s2jev(rG).blockChoice);

  // ═══ I. C159 近 tie：none argmax 但 emptyP≥0.4 + 图证 → 载体门仍按「图就是内容」═══
  console.log('\n── I. C159 empty_content 近 tie 载体门 ──');
  const nearTieAnswers = dndAnswers({
    event_quality_veto: { choice: 'none', probabilities: { none: 0.47, event_empty_content: 0.46 } },
    web3_user_event_fit: fitOk,
    web3_user_name_entity_acceptance: { choice: 'not_entity', probabilities: { not_entity: 0.8 } },
    web3_user_entity_visuality: { choice: 'no_visual_entity', probabilities: { no_visual_entity: 0.75, existing_entity: 0.2 } },
    web3_user_phrase_acceptability: { choice: 'web3_user_acceptable', probabilities: { web3_user_acceptable: 0.9 } },
    web3_user_name_event_acceptance: { choice: 'exact_match', probabilities: { exact_match: 0.9 } },
    name_image_consistency: { choice: 'unrelated', probabilities: { unrelated: 0.9 } },
    image_depicts_name: { choice: 'decorative', probabilities: { decorative: 0.8 } },
    // J1.100/C167：DND 猫=形象票补第四臂（近 tie 防抖豁免保留给形象票；实录图
    // 否决形状由 _test_image_carrier_nature E 段锁）
    image_carrier_nature: { choice: 'carrier_visual', probabilities: { carrier_visual: 0.8, referent_itself: 0.15 } },
    token_name_quality: { score: 12, probabilities: {} },
  });
  const rI = mapStandardAnswers(nearTieAnswers, dndCtx(true));
  check('I1 none argmax + emptyP 0.46 + 图证 → 放行（J1.102/C171 后载体门整轴已退役；empty_content 近 tie 防抖臂随门删除，票不再有载体拦截位）',
    rI.llmResult.pass === true, rI.llmResult.reason);
  check('I2 审计键 subjectCarrierEmptyImgOverride 不再产出（C159 载体近 tie 臂随门退役——历史行键保留展示）',
    !('subjectCarrierEmptyImgOverride' in s2jev(rI)),
    s2jev(rI).subjectCarrierEmptyImgOverride);
  check('I3 观察键 emptyContentMass 恒落（虚假叙事未来观察，不参与门）',
    s2jev(rI).emptyContentMass === 0.46, s2jev(rI).emptyContentMass);

  // ═══ H. 源码口径（回潮防线）═══
  console.log('\n── H. 源码口径 ──');
  const mapperSrc = readFileSync(mapperPath, 'utf8');
  const qSrc = readFileSync(qPath, 'utf8');
  // H5/H7 反证切片=词句题题面本体（instructions/criteria）——J1.116 注释段含翻案史实
  // 文本（记录 CRO 旧臂名），全文件切片会误伤反证
  const qAll = qSrc;
  const phraseSrc = qAll.slice(qAll.indexOf('bsc_meme_user_phrase_acceptability: {'), qAll.indexOf('10.7 名字与配图主体一致性'));
  check('H1 mapper 臂形状（blockChoice event_empty_content ∧ imageEvidence）',
    mapperSrc.includes("&& !(blockChoice === 'event_empty_content' && !!context.imageEvidence && !imgDecorative)"), null);
  check('H2 审计键在 stage2 jev 段（拦截票可追溯位）',
    /const stage2DataToSave = \{[\s\S]{0,3000}emptyContentImgOverride/.test(mapperSrc), null);
  const { JEV_QUESTIONS_VERSION } = await import(qPath);
  check('H3 JEV_QUESTIONS_VERSION=J1.99（J1.90=C152 MEMES fit 锚；J1.90=C152 MEMES fit 锚；J1.89=C151 哭哭奶龙 wrong_entity 修正；J1.88=C150 删 event_institution_routine 桶；J1.87=C145 删 routine 桶；J1.86=C143 校准（题面锚点）；J1.85=C143 品牌劫持并入实体轴；J1.84=C142 W 双轴合并单轴；J1.83=C141 event_subject_entity 题退役+门一般化 web3FitMassBlock；J1.81=C139 名字三轴重构（实体题五桶 wrong_entity/词句题改 phrase 收窄/载体题改 visuality）；J1.79=事件分改 fit 质量+删 web3_user_event_impact 题；J1.74=C134 W 交互臂→BSC 用户吸引力；J1.72=C133 实体题新增 new_entity；bump 纪律；J1.55=C124 web3_user_name_entity_acceptance 圈内符号级锚（super_ip=被当符号使用证据级；发布者指代分支/三前提/配图臂保留）；J1.54=C123 门名/题键语义化（event_magnitude→web3_user_event_impact / dimension2→web3_user_event_spread + 门函数/审计键改名，判据零改动）；J1.53=C122 门名断代；J1.52=C121 用户视角批次一：w_product_score 用户兴奋度锚+niche_subculture 认知可达性锚；J1.51=C119 批内修正 dim2 镜头（认知面非实测互动）；J1.47=C114 通用梗缩写锚，J1.48=C116 整句情绪姿态分界，J1.49=C118 image_depicts_name 演绎题，J1.50=C119 用户视角统一+name_form 键名断代 web3_user_acceptable/web3_user_not_acceptable/unclear；J1.100=C167 image_carrier_nature 载体性质第四臂；J1.102=C171 形象轴整退役+演绎臂迁 J1.30 关联豁免）', parseInt(JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 102, JEV_QUESTIONS_VERSION);
  check('H4 题面含通用网络梗缩写锚（J1.116 三因素框架内：词句本身已流通=有来由①）',
    qSrc.includes('通用网络梗/文化缩写（DND=do not disturb）'), null);
  check('H5 CRO 判例翻案反证（C187/J1.116：工牌 Chief Risk Officer=玩梗可接受——机构职位/品牌内部缩写不合格臂整条退役防复活；切片=词句题题面本体，注释史实文本不计）',
    !phraseSrc.includes('机构职位/品牌内部缩写') && !phraseSrc.includes('Chief Risk Officer') && !phraseSrc.includes('「CRO」不能接纳'), null);
  check('H6 对照锚含 DND 能接纳（J1.116：官方主体+通用梗缩写流通）；CRO 反例已随翻案退役',
    qSrc.includes('「DND」能接纳') && !qSrc.includes('「CRO」不能接纳'), null);
  check('H7 criteria 同步（acceptable 含三因素+通用梗缩写；CRO 翻案反证=不含机构职位缩写）',
    /通用梗缩写/.test(phraseSrc) && !/机构职位/.test(phraseSrc), null);
  check('H8 J1.95/C159 短句点名具体 meme/梗主体不算空洞（chinese nubcat? 矛盾修正；J1.110/C181 措辞收窄「实体」→「梗主体」+句式限定防吃掉无名喊话形状）',
    qSrc.includes('短句/疑问句但点名具体 meme、梗主体或已知 IP')
    && qSrc.includes('chinese nubcat?')
    && qSrc.includes('是否为低质 IP 复用由 token_ip_reuse 另判')
    && qSrc.includes('本项只留完全没有可辨识主体/指代的内容'), null);
  // J1.110/C181（RichardTeng 0x007f5ddb6b5d2377f17089a7835bc61beee97777 案）：
  // 无名口号臂——C175 fit 锚判据前移 veto 层：无名作者单条口号/喊话/宣言/许愿对
  // Web3 用户不构成影响力事件。题面四点在场：②臂主句（点名知名对象也算）+
  // 三排除锚（J1.58 作者层级 / C159 梗主体 / C175b 成型叙事）
  check('H9 J1.110/C181 无名口号臂四点在场（②臂主句含点名知名对象也算 + J1.58 作者层级排除 + C159 收窄 + C175b 成型叙事排除）',
    qSrc.includes('无名作者的单条口号/喊话/宣言/许愿（J1.110/C181）')
    && qSrc.includes('即使点名 Richard Teng/币安等知名对象')
    && qSrc.includes('影响力看作者层级，不看句子本身')
    && qSrc.includes('成型叙事——有情节的故事、持续的行为记录、被命名主体的来历'), null);
  // J1.111/C181b：两层缺陷同时命中时事件层优先——案发 RichardTeng J1.110 跑
  // token_ip_reuse 0.52 / empty_content 0.31 分票，token_ip_reuse 域仅 A、
  // 票 category=C → argmax 域外放行 71.11 high。划界=无名口号式提及（含套
  // 人物/机构名）归 empty_content，token_ip_reuse 只管 meme IP/形象/梗换皮
  check('H10 J1.111/C181b 事件层优先三点在场（instructions 优先序 + token_ip_reuse 划界句 + Richard Teng 例）',
    qSrc.includes('两层缺陷同时命中时**事件层优先（J1.111/C181）**')
    && qSrc.includes('票的根基是没有事件，选 event_empty_content')
    && qSrc.includes('仅套用真实人物/机构名（如 CZ、Richard Teng、币安）而无 meme IP/形象/梗的复用，且事件本体=无名作者一句话')
    && qSrc.includes('本项只管 meme IP/形象/梗的换皮复用'), null);

  // ═══ 汇总 ═══
  console.log(`\n══════ _test_empty_content_img_exempt: ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('单测异常:', e); process.exit(1); });
