#!/usr/bin/env node
/**
 * C96 / J1.37 F→E 改道 + 名字门单测——event_finding_vs_recap（改道）+ name_form
 * （C96 陈述句门 → C105 版本词门 → C107/J1.41 收敛为单一合格度判断
 * 「是否合适作为 meme 币」）——本地零 DB 零网络单测（2026-10-18 C96 双立项；
 * 2026-10-19 C105 追加；同日 C107 用户裁定收敛）
 *
 * 案发一（0xc6d089d749409f7646de440d637ac9db0e047777「币安上电视」）：CZ 转发
 * 「BNB 上越南国家电视」1 秒后快枪发币，J1.32 判 F 类（Discovery「author-
 * discovered」被 spotted 目击语气满足）A 档 77 分 high 放行，买入 22 秒 -33.4%。
 * 分类逃逸是过关钥匙：no_visual_entity 0.97 若按语义判 E/D 会被 J1.29 载体门
 * 当场拦死，逃进 F 不吃载体门不吃折损。三借壳（量级/mem/web3_user_event_fit）全是事件
 * 成分属性，无一轴衡量名字本身作为 meme 载体。
 *
 * 案发二（0xe156aa3f3e89ded51ef0b980018ef15ae0517777「日本語版」，C105）：
 * CZ 01:47:24 发推《Freedom of Money》日本語版本日发售，同秒蹭票（symbol/name
 * 逐字=推文元词）。Jev 感知正确无臂表达（stage3 translation_match 0.62 知道是
 * 版本词，name_form 只能判 entity_phrase 0.96）→ 五腿全中豁载体门+block 臂 →
 * S 档 81.44 high（0 信号 0 交易，high 进全局缓存）。裁定「日本語版根本不能
 * 作为 meme 名字，事件本身在 web3 影响力并不小」——量级轴不背锅，洞=名字资格。
 *
 * 案发三（C107 收敛，2026-10-19 用户裁定）：「其实我觉得可以不加新维度，就
 * 使用『是否合适作为 meme 币』这个维度就好」——逐形态加臂是打地鼠（C96 陈述
 * 句→C105 版本词→序号→……），名字资格本质是一个判断不是一套语言学分类。
 * J1.41 起 name_form 三选 meme_name/not_meme_name/unclear，mapper 两门合并为
 * web3UserAcceptabilityBlock 单门；J1.37-J1.40 旧缓存行 choice statement/functional_label
 * 兼容映射继续拦、entity_phrase 放行（存量行为 bit 不变）。
 *
 * 覆盖：
 *   A. 问卷形状：J1.42 版本 / 恒带题态数 / F 档澄清 / 题面判别锚（四分支+
 *      三对照锚+不限列举锚+核心词修饰锚+探针题删除）
 *   B. F→E 改道真值表：F+news_recap→categoryForced='f_recap_e'+category=E；
 *      finding/unclear/缺失→维持 F；非 F+news_recap→不消费（观察键照落）
 *   C. 名字门全域真值表（J1.42 唯一名字位）：not_meme_name 全类别拦；
 *      meme_name/unclear/缺失→不拦；五腿全中不豁
 *   C2. 旧 choice 兼容映射（断代 bit 兼容红线）：statement/functional_label
 *      （J1.37-J1.40 存量行）→ 照拦；entity_phrase → 放行
 *   D. 事故现场反证（币安上电视 J1.32 快照实测值 + 日本語版 J1.39 快照实测值）
 *   G. C108 统一门真值表：EARLY 翻案位（common_word 0.92 原拦截值+meme_name
 *      →放行）/ 四分支（YAYA 无名实体拦、滑雪拦、拼写变体并入）/ nr/rm/
 *      memFloor 退役位移交正反证 / block_misspelling 探针死键不拦
 *   E. 审计字段：stage1 categoryForced/nameForm/findingVsRecap 恒落；
 *      stage2 findingVsRecap 双写/web3UserAcceptabilityBlock 命中才落（form=Jev 原 choice）
 *   F. 源码口径：门链序（nf→sc，rm/memFloor 退役）/ 五腿刻意不豁 / 兼容 Set
 *      形状 / cashtag 改道优先 / 旧缓存行 fail-open（无失效脚本需求）/ C108
 *      退役位源码反证（nrBlock/rmBlock/memFloor/探针全清+保留链完好）
 *
 * 用法：node scripts/_test_jev_finding_recap_statement_gate.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

// J1.81：label 随题改名（web3_user_name_acceptability→phrase）改「词句接纳度门」
const NF_LABEL = 'Web3 用户不接纳该名字（词句接纳度门）';
const CARRIER_LABEL = '叙事主体无形象载体';

/**
 * 通过型基础形状（全部前置门不命中，A 档量级，Stage3 不拦）——专测名字门。
 * 与 _test_subject_carrier 的 baseAnswers 同族但 J1.37 起带两新题。name_form
 * 默认 entity_phrase=J1.37-J1.40 旧缓存行兼容放行臂（J1.41 新形状=meme_name，
 * C 段放行臂两者都验）。
 */
function baseAnswers(cat, overrides = {}) {
  const answers = {
    event_category: { choice: cat, probabilities: { [cat]: 0.7 } },
    event_magnitude: { score: 4.6, probabilities: { '4': 0.5, '5': 0.3 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.9 } },
    dimension2: { score: 25, probabilities: { '5': 0.6, '4': 0.3 } },
    event_quality_veto: { choice: 'none', probabilities: { none: 0.92 } },
    // J1.81：基底切 not_entity——名字门（词句门）测试形状需实体票分流放行基底；
    // 五腿/著名专项逐 fixture 显式覆盖（C 专项走 ctx.authorUtterance）
    web3_user_name_entity_acceptance: { choice: 'not_entity', probabilities: { not_entity: 0.9, unknown: 0.05 } },
    name_entity_memeability: { score: 3, probabilities: {} },
    web3_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.85, fit: 0.1 } },
    name_entity_carrier: { choice: 'existing_entity', probabilities: { existing_entity: 0.8 } },
    event_subject_entity: { choice: 'character_ip', probabilities: { character_ip: 0.7 } },
    // probabilities 带 none 低占位：relNoneMass = none ?? 1，缺键默认 1 会让
    // C88 五腿 miss（relNone<0.5 腿）——C-专项五腿全中形状依赖此键
    name_event_relevance: { choice: 'exact_match', probabilities: { exact_match: 0.8, none: 0.05 } },
    relevance_level: { score: 4.5, probabilities: { '4': 0.6, '5': 0.3 } },
    block_misspelling: { noul: 0.02 },
    quality_spelling: { score: 6.5 },
    quality_reasonability: { score: 4.5 },
    // J1.37 两新题默认值（不触发名字门）
    event_finding_vs_recap: { choice: 'narrative_finding', probabilities: { narrative_finding: 0.8, news_recap: 0.15 } },
    name_form: { choice: 'entity_phrase', probabilities: { entity_phrase: 0.85 } },
  };
  return Object.assign(answers, overrides);
}

const stdCtx = (symbol, name) => ({
  tokenData: { symbol, name: name || symbol, raw_api_data: { name: name || symbol } },
  includeBrandHijack: false,
  tweetClassification: null,
  twitterInfo: null,
  callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
});

function blockedBy(r, label) {
  return r.llmResult.rating === 'low' && (r.llmResult.reason || '').includes(label);
}

/**
 * 事故快照形状（0xc6d0…7777「币安上电视」token_narrative J1.32 行实测值）：
 * F 类 / super_ip 0.6 / mem 1.72 / strong_fit 0.93 / no_visual_entity 0.97 /
 * product_functional 0.61 / exact 0.44+translation 0.3 / within_7d / A 档
 * （34+28+15=77）。J1.37 两新题答案由参数注入（线上 J1.32 行无此两题；
 * nameForm 默认 statement=J1.37-J1.40 存量行兼容臂形状）。
 */
function incidentAnswers({ recap = 'news_recap', nameForm = 'statement', mem = 1.72 } = {}) {
  return {
    event_category: { choice: 'F', probabilities: { F: 0.55, E: 0.25, D: 0.12 } },
    event_magnitude: { score: 8.2, probabilities: { '5': 0.62, '4': 0.25 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.9 } },
    dimension2: { score: 28, probabilities: { '5': 0.6, '4': 0.3 } },
    event_quality_veto: { choice: 'none', probabilities: { none: 0.92 } },
    // J1.81 形状调参：choice 迁 not_entity（statement 陈述句名不映射实体——词句门
    // 可达），accepted 0.6 概率保留（五腿第一腿+著名资格——原 C88 载体豁免臂由
    // 著名资格接管，D1/D4 免载体门路径不变）
    web3_user_name_entity_acceptance: { choice: 'not_entity', probabilities: { not_entity: 0.25, accepted: 0.6, unknown: 0.12 } },
    name_entity_memeability: { score: mem, probabilities: {} },
    web3_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.93, fit: 0.04 } },
    name_entity_carrier: { choice: 'no_visual_entity', probabilities: { no_visual_entity: 0.97, improvised_entity: 0.02 } },
    event_subject_entity: { choice: 'product_functional', probabilities: { product_functional: 0.61 } },
    name_event_relevance: { choice: 'exact_match', probabilities: { exact_match: 0.44, translation_match: 0.3, none: 0.08 } },
    relevance_level: { score: 4.5, probabilities: { '4': 0.6, '5': 0.3 } },
    block_misspelling: { noul: 0.02 },
    quality_spelling: { score: 6.5 },
    quality_reasonability: { score: 4.5 },
    event_finding_vs_recap: { choice: recap, probabilities: { [recap]: 0.8 } },
    name_form: { choice: nameForm, probabilities: { [nameForm]: 0.85 } },
  };
}

/**
 * C105 事故快照形状（0xe156…7777「日本語版」token_narrative J1.39 行实测值）：
 * C 类 0.5 / magnitude 5 档 0.9（S） / dim2 5 档 0.8 / super_ip 0.53 / mem 2.5 /
 * strong_fit 0.73 / no_visual_entity 0.97 / product_functional 0.75 /
 * translation_match 0.62（none 0.08） / within_7d / blockChoice
 * event_routine_content_product 0.82（argmax——被五腿豁，线上实况）/ relPositive 0.9。
 * name_form 答案由参数注入：线上 J1.39 行实况=entity_phrase 0.96（无臂可选），
 * J1.41 起新答案=not_meme_name；functional_label/statement=J1.37-J1.40 存量行
 * 兼容臂形状。
 */
function jpEditionAnswers({ nameForm = 'not_meme_name' } = {}) {
  return {
    event_category: { choice: 'C', probabilities: { C: 0.5, B: 0.47 } },
    event_magnitude: { score: 8.6, probabilities: { '5': 0.9, '4': 0.04 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 1.0 } },
    dimension2: { score: 27, probabilities: { '5': 0.8, '4': 0.06 } },
    event_quality_veto: { choice: 'event_routine_content_product', probabilities: { event_routine_content_product: 0.82, none: 0.14 } },
    // J1.81 形状调参：choice 迁 not_entity（版本残片名——J1.81 真实判读归 wrong_entity
    // 全域拦，见 _test_name_entity_acceptance E 组；此处快照重放走 name_form 兼容臂，
    // choice not_entity 保词句门可达），accepted 0.53 保留（五腿第一腿+著名资格——
    // D6 no_visual 载体豁免路径不回退）
    web3_user_name_entity_acceptance: { choice: 'not_entity', probabilities: { not_entity: 0.3, accepted: 0.53, unknown: 0.14 } },
    name_entity_memeability: { score: 2.5, probabilities: {} },
    web3_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.73, marginal: 0.16, fit: 0.08 } },
    name_entity_carrier: { choice: 'no_visual_entity', probabilities: { no_visual_entity: 0.97, existing_entity: 0.03 } },
    event_subject_entity: { choice: 'product_functional', probabilities: { product_functional: 0.75, event_hotspot: 0.13 } },
    name_event_relevance: { choice: 'translation_match', probabilities: { translation_match: 0.62, exact_match: 0.2, none: 0.08 } },
    relevance_level: { score: 2.5, probabilities: { '4': 0.33, '1': 0.27, '0': 0.23 } },
    block_misspelling: { noul: 0.12 },
    quality_spelling: { score: 4.64 },
    quality_reasonability: { score: 2.74 },
    event_finding_vs_recap: { choice: 'news_recap', probabilities: { news_recap: 1.0 } },
    name_form: { choice: nameForm, probabilities: { [nameForm]: 0.85 } },
  };
}

async function main() {
  const mapper = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const { mapStandardAnswers } = mapper;
  const { buildStandardQuestions, JEV_QUESTIONS_VERSION } = await import('../src/narrative/analyzer/llm/jev-questions.mjs');

  // ═══ A. 问卷形状 ═══
  console.log('\n── A. 问卷形状（J1.37 两新题恒带；J1.42 name_form 四分支统一门）──');
  check('A1 版本号 = J1.90（J1.102=C171 形象载体轴整轴退役（删 web3_user_entity_visuality/event_influence 题集 12→10）；J1.90=C152 MEMES fit 锚；J1.90=C152 MEMES fit 锚；J1.89=C151 哭哭奶龙 wrong_entity 修正；J1.88=C150 删 event_institution_routine 桶；J1.87=C145 删 routine 桶；J1.86=C143 校准（题面锚点）；J1.85=C143 品牌劫持并入实体轴；J1.84=C142 W 双轴合并单轴；J1.83=C141 event_subject_entity 题退役（判据并入 event_fit unfit 桶+门一般化 web3FitMassBlock：sf+fit<0.5 全域拦）；J1.82=C140 圈层可达性桶退役并入 event_fit unfit 档（并行会话同批）；J1.81=C139 名字三轴重构（实体题五桶 wrong_entity/词句题改 phrase 收窄/载体题改 visuality）；J1.79=事件分改 fit 质量+删 web3_user_event_impact 题；J1.74=C134 W 交互臂→BSC 用户吸引力；J1.72=C133 实体题新增 new_entity；J1.71=事件侧三合一 Web3 用户影响力；J1.70=C130 审计键语义化；J1.69=C130 名字门判定对象收敛为链上 Symbol（币名）；J1.57=C126 概念清理：实体轴归位；J1.55=C124 web3_user_name_entity_acceptance 圈内符号级锚（super_ip=被当符号使用证据级；发布者指代分支/三前提/配图臂保留）；J1.54=C123 门名/题键语义化（event_magnitude→web3_user_event_impact / dimension2→web3_user_event_spread + 门函数/审计键改名，判据零改动）；J1.53=C122 门名断代；J1.52=C121 用户视角批次一：w_product_score 用户兴奋度锚+niche_subculture 认知可达性锚；J1.51=C119 批内修正 dim2 镜头（认知面非实测互动，C113 哭哭奶龙回归修复）；C96 两新题；C98 扩边界；J1.39=C103 条件题；J1.40=C105 第四选；J1.41=C107 收敛；J1.42=C108 名字门统一；J1.43=C109 题集收敛；J1.44=C110 合桶+mem 瘦身；J1.45=C110 扫描后裁定；J1.46=C113 找角度判轴+token_ip_reuse 边界；J1.47=C114 name_form 通用梗缩写锚；J1.48=C116 name_form 整句情绪姿态分界；J1.49=C118 image_depicts_name 条件题；J1.50=C119 用户视角统一——name_form 三态键改名 web3_user_acceptable/web3_user_not_acceptable/unclear + name_event_relevance/event_magnitude/dimension2 判定主轴换用户侧）', parseInt(JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 102, JEV_QUESTIONS_VERSION);
  const qs = buildStandardQuestions();
  check('A2 event_finding_vs_recap 恒带（默认题集）', 'event_finding_vs_recap' in qs, Object.keys(qs).length);
  check('A3 web3_user_phrase_acceptability 恒带（默认题集；J1.81 由 web3_user_name_acceptability 改名收窄）',
    'bsc_meme_user_phrase_acceptability' in qs && !('web3_user_name_acceptability' in qs), null);
  const fvr = qs.event_finding_vs_recap;
  check('A4 event_finding_vs_recap type=choice 三态', fvr.type === 'choice'
    && ['narrative_finding', 'news_recap', 'unclear'].every(k => k in fvr.criteria), null);
  check('A5 event_finding_vs_recap 关键判别锚：发现语气不构成发现（大V报道→news_recap）',
    fvr.instructions.includes('不构成发现') && fvr.instructions.includes('目击动作'), null);
  const nf = qs.bsc_meme_user_phrase_acceptability;
  check('A6 web3_user_phrase_acceptability type=choice 三态（J1.81 改名收窄=只评 not_entity 形状；J1.55 C122 题键 name_form→web3_user_name_acceptability；J1.50 键名断代：web3_user_acceptable/web3_user_not_acceptable/unclear（J1.112/C183 桶值随族断代 bsc_meme_user_*）；J1.37-J1.48 旧键 meme_name/not_meme_name 与 C107 前旧四分类 id 全部退役——旧行经 mapper 兼容 Set 照拦/照放）', nf.type === 'choice'
    && ['bsc_meme_user_acceptable', 'bsc_meme_user_not_acceptable', 'unclear'].every(k => k in nf.criteria)
    && !['meme_name', 'not_meme_name', 'entity_phrase', 'statement', 'functional_label'].some(k => k in nf.criteria), Object.keys(nf.criteria));
  check('A7 web3_user_phrase_acceptability 判词句本身不判指向对象（J1.81 措辞→J1.116/C187 三因素框架下保留：划界句实体认知度归实体题；C171 形象轴退役后题面不再引用 web3_user_entity_visuality 题）',
    nf.instructions.includes('实体本身认不认得/有没有影响力由实体题判') && nf.instructions.includes('本题只判「词句本身」') && !nf.instructions.includes('web3_user_entity_visuality'), null);
  check('A7b 三因素缺一不可锚（J1.116/C187 用户裁定重构：单一「名字形态可接纳性」→①有来由②有感染力③名字形态综合；「能否接纳」唯一问法句随重构退役）',
    nf.instructions.includes('三因素缺一不可，任一不满足 → 不能接纳') && nf.instructions.includes('完全从 BSC meme 币用户角度出发'), null);
  check('A8 口号/宣言形态 → 强影响力主体说出才有来由（J1.116/C187：①臂门槛化——普通用户喊的口号不能接纳）',
    nf.instructions.includes('问候、口号/宣言、自创口头禅、简短情绪表达都算') && nf.instructions.includes('普通用户（无强影响力的主体）喊出的梗/口号/宣言 → 完全无来由，不能接纳'), null);
  check('A9 name_form 判定对象=链上 Symbol（C130 裁定「币名应该看 Symbol」；Name 不作判据；J1.116 ③因素内保留）',
    nf.instructions.includes('仅就链上 Symbol（币名/ticker') && nf.instructions.includes('链上 Name 是全名/描述句不作判据')
    && !nf.instructions.includes('取更完整的一个判'), null);
  check('A10 event_category F 档澄清（目击/报道新闻≠发现→判 E/D，spotted 语气不满足 F；J1.125 题面中文重写锚词同步）',
    /F:\s*'发现型：[^']*不是作者只是目击\/报道的公开新闻事件/.test(
      (await readQuestionsSrc()).replace(/\n/g, ' ')), null);
  check('A11 两新题不受条件开关影响（includeBrandHijack 臂同带）',
    'event_finding_vs_recap' in buildStandardQuestions({ includeBrandHijack: true })
    && 'bsc_meme_user_phrase_acceptability' in buildStandardQuestions({ includeBrandHijack: true }), null);
  // C107 收敛锚 + C108 统一门锚
  check('A12 不限列举锚（三因素总则兜底任意形态——反打地鼠；J1.116 措辞迁移）',
    nf.criteria.bsc_meme_user_not_acceptable.includes('三因素任一缺失即拦') && nf.criteria.bsc_meme_user_not_acceptable.includes('以下只是典型佐证形态'), null);
  check('A13 name_form 核心词修饰锚（「XX 完整版」核心是 XX → 合格，防误伤）',
    nf.instructions.includes('（「XX 完整版」核心是 XX）'), null);
  check('A14 事故词锚（C189/J1.120：币安上电视追裁「先走实体门，然后走 phrase 门——要不被实体拒绝，要不被口号拒绝」——事件陈述句名=口号类落本题按三因素评+事件承载臂重要度门槛（民族级/全球级重大事件才够格，平台级/媒体级露出不够——用户裁定「事件的重要度明显不够」）；日本語版 C105 版本词留实体题 wrong_entity 轴全域拦）',
    nf.instructions.includes('属口号类落本题按三因素评')
    && nf.instructions.includes('民族级/全球级的重大事件')
    && nf.instructions.includes('「币安上电视」=媒体级露出，喊出者还非币安本人 → 无来由')
    && nf.criteria.bsc_meme_user_not_acceptable.includes('版本词/拼写错不在本条')
    && qs.bsc_meme_user_name_entity_acceptance.criteria.wrong_entity.includes('日本語版'), null);
  // C108 三轮裁定锚（EARLY 案触发：总判据=用户侧感知；J1.50 措辞「能不能」→「能否」）
  check('A15 词句题总判据锚（用户视角问法：web3 用户能否接纳这个词句 + 用户侧感知）',
    nf.instructions.includes('BSC meme 币用户能否接纳这个词句作为 meme 币的名字') && nf.instructions.includes('用户侧对它有没有感知'), null);
  check('A16 对照锚进题面（Early 能接纳 / 我要去滑雪不能接纳——分界=用户侧感知与反应；J1.116 三因素版）',
    nf.instructions.includes('「Early」能接纳') && nf.instructions.includes('「我要去滑雪」毫无感染力')
    && nf.instructions.includes('不是词出自谁、也不是是否截自语料'), null);
  check('A17 J1.57 划界：实体票移出词句门（指回实体题类型轴 unacceptable_type，J1.113/C184 断代）+ J1.116/C187 实体臂优先路由（强调/提及/陈述实体的名字——heyi.ai 域名形——先实体臂，实体臂不接受判 not_entity 才落本题）',
    nf.instructions.includes('实体票不在本题')
    && nf.instructions.includes('unacceptable_type 轴') && nf.instructions.includes('wrong_entity 轴全域拦')
    && nf.instructions.includes('先走实体臂按实体评估')
    && !nf.instructions.includes('如币安普通员工的花名'), null);
  check('A18 拼写变体锚 J1.81 迁移（无背景拼写错误→实体题 wrong_entity①；有文化来源变体不算——dogwifhat）',
    qs.bsc_meme_user_name_entity_acceptance.criteria.wrong_entity.includes('无背景拼写错误')
    && qs.bsc_meme_user_name_entity_acceptance.criteria.wrong_entity.includes('dogwifhat'), null);
  check('A19 block_misspelling 探针题已删（C108 退役——判据并入 name_form 分支④；C109 题集收敛 18→16；J1.79 删 web3_user_event_impact→13；J1.83 删 event_subject_entity→12；J1.84 删 w_product_score→11；J1.102 删 visuality/event_influence→10）',
    !('block_misspelling' in qs) && Object.keys(qs).length === 10
    && !('block_misspelling' in buildStandardQuestions({ includeBrandHijack: true })), Object.keys(qs).length);

  // ═══ B. F→E 改道真值表 ═══
  console.log('\n── B. F→E 改道真值表（event_category × event_finding_vs_recap）──');
  // B1 F+news_recap → 改道 E（categoryForced='f_recap_e'，category=E）
  const rB1 = mapStandardAnswers(baseAnswers('F', {
    event_finding_vs_recap: { choice: 'news_recap', probabilities: { news_recap: 0.8 } },
  }), stdCtx('TST', 'TST'));
  check('B1 F+news_recap → category=E', rB1.stage1DataToSave.category === 'E', rB1.stage1DataToSave.category);
  check('B1b categoryForced=f_recap_e（改道来源可追溯）',
    rB1.stage1DataToSave.parsed_output.jev.categoryForced === 'f_recap_e',
    rB1.stage1DataToSave.parsed_output.jev.categoryForced);
  check('B1c Jev 原 choice=F 在 probabilities 可追溯',
    rB1.stage1DataToSave.parsed_output.jev.probabilities.event_category.F === 0.7, null);
  // B2 维持 F 臂
  const keepFArms = [['narrative_finding', '发现（真 F 内容）'], ['unclear', 'unclear（fail-open）'], [null, '缺失（旧缓存行 fail-open）']];
  for (const [recap, note] of keepFArms) {
    const a = baseAnswers('F');
    if (recap) a.event_finding_vs_recap = { choice: recap, probabilities: { [recap]: 0.7 } };
    else delete a.event_finding_vs_recap;
    const r = mapStandardAnswers(a, stdCtx('TST', 'TST'));
    check(`B2 ${note} → 维持 F 零变化（categoryForced=null）`,
      r.stage1DataToSave.category === 'F' && r.stage1DataToSave.parsed_output.jev.categoryForced === null,
      { category: r.stage1DataToSave.category, forced: r.stage1DataToSave.parsed_output.jev.categoryForced });
  }
  // B3 非 F+news_recap → 不消费（观察键照落）
  const rB3 = mapStandardAnswers(baseAnswers('C', {
    event_finding_vs_recap: { choice: 'news_recap', probabilities: { news_recap: 0.8 } },
  }), stdCtx('TST', 'TST'));
  check('B3 非 F+news_recap → 不改道（category=C，findingVsRecap 观察键照落）',
    rB3.stage1DataToSave.category === 'C'
    && rB3.stage1DataToSave.parsed_output.jev.categoryForced === null
    && rB3.stage1DataToSave.parsed_output.jev.findingVsRecap === 'news_recap',
    rB3.stage1DataToSave.parsed_output.jev.findingVsRecap);
  // B4 C171 前改道后由载体门接管拦（改道=换考官）；形象载体轴退役后无此拦截位
  // ——E 类标准链（fit/量级/名字门）全部放行本形状。fixture 用 mem 2.5+super_ip
  // 0.3（破五腿 sipProb 臂）保留原隔离变量
  const rB4 = mapStandardAnswers(baseAnswers('F', {
    event_finding_vs_recap: { choice: 'news_recap', probabilities: { news_recap: 0.8 } },
    name_entity_carrier: { choice: 'no_visual_entity', probabilities: { no_visual_entity: 0.9 } },
    name_entity_memeability: { score: 2.5, probabilities: {} },
    web3_user_name_entity_acceptance: { choice: 'unknown', probabilities: { unknown: 0.5, accepted: 0.3 } },
  }), stdCtx('TST', 'TST'));
  check('B4 F+news_recap+no_visual（mem≥2 破五腿）→ 改道 E 放行（C171 载体门退役——避亏责任移交 fit/量级门，回归观察）',
    rB4.llmResult.rating !== 'low' && !blockedBy(rB4, CARRIER_LABEL), rB4.llmResult.reason);

  // ═══ C. 词句门全域真值表（C189 恢复拦截——not_meme_name 全域拦，审计 choice 照落）═══
  console.log('\n── C. 词句门全域真值表（C189：not_meme_name 不限类别拦 + 审计 choice 照落）──');
  for (const cat of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'W']) {
    const r = mapStandardAnswers(baseAnswers(cat, {
      name_form: { choice: 'not_meme_name', probabilities: { not_meme_name: 0.9 } },
    }), stdCtx('TST', 'TST'));
    check(`C ${cat} 类+not_meme_name → 拦（C189 恢复）+ 审计照落`, blockedBy(r, NF_LABEL)
      && r.stage2DataToSave.parsed_output.jev.web3UserAcceptabilityBlock?.choice === 'not_meme_name',
      r.llmResult.reason);
  }
  // 放行臂：J1.50 新形状 web3_user_acceptable + J1.41-J1.48 旧形状 meme_name
  // （兼容放行）+ fail-open 臂 + 兼容形状 entity_phrase（旧缓存行）
  const passArms = [['web3_user_acceptable', 'web3_user_acceptable（J1.50 新键·能接纳）'], ['meme_name', 'meme_name（J1.41-J1.48 旧键兼容放行）'], ['entity_phrase', 'entity_phrase（J1.37-J1.40 旧缓存行兼容放行）'], ['unclear', 'unclear（fail-open）'], [null, '缺失（旧缓存行 fail-open）']];
  for (const [form, note] of passArms) {
    const a = baseAnswers('D');
    if (form) a.name_form = { choice: form, probabilities: { [form]: 0.8 } };
    else delete a.name_form;
    const r = mapStandardAnswers(a, stdCtx('TST', 'TST'));
    check(`C ${note} → 不拦（rating 非 low 或 reason 无名字门）`, !blockedBy(r, NF_LABEL), r.llmResult.reason);
  }
  // C0 J1.50 新键臂：web3_user_not_acceptable 判定值照算不拦（键名断代正证；C180 拦截退役）
  const rNewKey = mapStandardAnswers(baseAnswers('D', {
    name_form: { choice: 'web3_user_not_acceptable', probabilities: { web3_user_not_acceptable: 0.9 } },
  }), stdCtx('TST', 'TST'));
  check('C0 J1.50 新键 web3_user_not_acceptable → 拦（C189 恢复；键名断代正证）+ stage1 web3UserAcceptability 原样透传 + 审计照落',
    blockedBy(rNewKey, NF_LABEL)
    && rNewKey.stage1DataToSave.parsed_output.jev.web3UserAcceptability === 'web3_user_not_acceptable'
    && JSON.stringify(rNewKey.stage2DataToSave.parsed_output.jev.web3UserAcceptabilityBlock) === '{"choice":"web3_user_not_acceptable"}',
    rNewKey.stage1DataToSave.parsed_output.jev.web3UserAcceptability);
  // C 专项：五腿全中（recognizedEntitySlogan=true）也不豁——mem 3≥2 五腿命中，not_meme_name 仍拦
  const rFive = mapStandardAnswers(baseAnswers('C', {
    name_form: { choice: 'not_meme_name', probabilities: { not_meme_name: 0.9 } },
    // J1.81：五腿第一腿改走 authorUtterance 臂（accepted 票已被实体票分流跳过
    // 词句门，五腿+词句门并存的现实形状=作者原话票 C126 こんにちは型）；
    // 其余四腿 relPositive 0.8≥0.3 / relNone 0<0.5 / within_7d / strong_fit 0.85≥0.5
  }), { ...stdCtx('TST', 'TST'), authorUtterance: true });
  check('C 专项 五腿全中（recognizedEntitySlogan hit）→ 仍拦（C189 恢复：五腿刻意不豁；判定值照落档）',
    blockedBy(rFive, NF_LABEL)
    && rFive.stage2DataToSave.parsed_output.jev.recognizedEntitySlogan.hit === true
    && rFive.stage2DataToSave.parsed_output.jev.web3UserAcceptabilityBlock?.choice === 'not_meme_name',
    rFive.stage2DataToSave.parsed_output.jev.recognizedEntitySlogan);

  // ═══ C2. 旧 choice 兼容映射（断代 bit 兼容红线——C189 恢复后照拦，判定值兼容读不变）═══
  console.log('\n── C2. 旧 choice 兼容映射（J1.37-J1.40 存量缓存行：照拦，判定值照算）──');
  // statement（C96 时代拦截臂）→ 恢复后照拦，choice 归因保留
  for (const cat of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'W']) {
    const r = mapStandardAnswers(baseAnswers(cat, {
      name_form: { choice: 'statement', probabilities: { statement: 0.9 } },
    }), stdCtx('TST', 'TST'));
    check(`C2 ${cat} 类+statement（旧缓存行）→ 照拦（C189 恢复兼容臂判定值照算）`, blockedBy(r, NF_LABEL)
      && r.stage2DataToSave.parsed_output.jev.web3UserAcceptabilityBlock?.choice === 'statement', r.llmResult.reason);
  }
  // functional_label（C105 时代拦截臂）→ 恢复后照拦
  for (const cat of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'W']) {
    const r = mapStandardAnswers(baseAnswers(cat, {
      name_form: { choice: 'functional_label', probabilities: { functional_label: 0.9 } },
    }), stdCtx('TST', 'TST'));
    check(`C2 ${cat} 类+functional_label（旧缓存行）→ 照拦（C189 恢复兼容臂判定值照算）`, blockedBy(r, NF_LABEL)
      && r.stage2DataToSave.parsed_output.jev.web3UserAcceptabilityBlock?.choice === 'functional_label', r.llmResult.reason);
  }
  // 兼容臂审计归因可分：form=Jev 原 choice（statement/functional_label ≠ not_meme_name）
  const rC2st = mapStandardAnswers(baseAnswers('D', {
    name_form: { choice: 'statement', probabilities: { statement: 0.9 } },
  }), stdCtx('TST', 'TST'));
  check('C2 statement 兼容臂 → web3UserAcceptabilityBlock.choice=statement（归因可分）',
    rC2st.stage2DataToSave.parsed_output.jev.web3UserAcceptabilityBlock.choice === 'statement',
    rC2st.stage2DataToSave.parsed_output.jev.web3UserAcceptabilityBlock);
  const rC2fl = mapStandardAnswers(baseAnswers('D', {
    name_form: { choice: 'functional_label', probabilities: { functional_label: 0.9 } },
  }), stdCtx('TST', 'TST'));
  check('C2 functional_label 兼容臂 → web3UserAcceptabilityBlock.choice=functional_label（归因可分）',
    rC2fl.stage2DataToSave.parsed_output.jev.web3UserAcceptabilityBlock.choice === 'functional_label',
    rC2fl.stage2DataToSave.parsed_output.jev.web3UserAcceptabilityBlock);

  // ═══ D. 事故现场反证 ═══
  console.log('\n── D. 事故现场反证（币安上电视 0xc6d0…7777 J1.32 快照）──');
  const ctxBnbTv = stdCtx('币安上电视', '币安上电视');
  // D1 双门命中：news_recap 改道 E + statement（兼容臂）——词句门拦（C189 恢复），改道照常生效
  const rD1 = mapStandardAnswers(incidentAnswers(), ctxBnbTv);
  check('D1 双门命中（news_recap+statement）→ 词句门拦（C189 恢复；审计 choice=statement 照落）',
    blockedBy(rD1, NF_LABEL) && !blockedBy(rD1, CARRIER_LABEL)
    && rD1.stage2DataToSave.parsed_output.jev.web3UserAcceptabilityBlock?.choice === 'statement', rD1.llmResult.reason);
  check('D1b 改道同时生效（categoryForced=f_recap_e）',
    rD1.stage1DataToSave.parsed_output.jev.categoryForced === 'f_recap_e'
    && rD1.stage1DataToSave.category === 'E', rD1.stage1DataToSave.category);
  // D2 name_form=entity → 名字门不拦（兼容放行）；C171 前改道 E 后由载体门接住，
  // 载体门退役后无拦截位 → 放行。fixture 同 B4 变体：mem 2.5（案值 1.72<2 会先
  // 被 C88 mem 地板拦）+ super_ip 0.4 破五腿。no_visual 0.97 案值保留（旧缓存行
  // 形状，mapper 不读）
  const d2Answers = incidentAnswers({ nameForm: 'entity_phrase', mem: 2.5 });
  d2Answers.web3_user_name_entity_acceptance = { choice: 'unknown', probabilities: { unknown: 0.45, accepted: 0.4 } };
  const rD2b = mapStandardAnswers(d2Answers, ctxBnbTv);
  check('D2 name_form=entity+破五腿 → 改道 E 放行（C171 载体门退役，no_visual 0.97 残留键零影响）',
    rD2b.llmResult.rating !== 'low' && !blockedBy(rD2b, CARRIER_LABEL) && !blockedBy(rD2b, NF_LABEL), rD2b.llmResult.reason);
  // D2b J1.61 断代：name_entity_memeability 题删除、C88 去 mem 腿后，同形状
  // （entity_phrase 可接纳 + 其余四腿通过）由 C88 口号票救援 → high；名字形态/
  // 玩味责任归名字门（本 fixture entity_phrase=可接纳，故不拦）。原「mem<2 断
  // 五腿→载体门接管」形状已随轴删除。
  const rD2c = mapStandardAnswers(incidentAnswers({ nameForm: 'entity_phrase' }), ctxBnbTv);
  check('D2b J1.61：四腿全中 → C88 救援（high），名字责任归名字门',
    rD2c.llmResult?.rating === 'high' && /超级IP口号票豁免\(C88\)/.test(rD2c.llmResult?.reason || ''),
    rD2c.llmResult.reason);
  // D3 finding=narrative_finding → 维持 F（不改道），statement 兼容臂拦（改道独立形状照验）
  const rD3 = mapStandardAnswers(incidentAnswers({ recap: 'narrative_finding' }), ctxBnbTv);
  check('D3 finding（维持 F）+ statement → 词句门拦（C189 恢复；类别维持 F 照验）',
    blockedBy(rD3, NF_LABEL) && rD3.stage1DataToSave.category === 'F'
    && rD3.stage1DataToSave.parsed_output.jev.categoryForced === null, rD3.llmResult.reason);
  // D4 唯一拦截位反证：mem≥2（J1.34 后币安指代按对象 web3 影响力评）+五腿全中
  //    → 载体门被五腿豁免 → 名字门是唯一拦截位（C88 mem 地板 C108 退役后更是
  //    结构性唯一）
  const rD4 = mapStandardAnswers(incidentAnswers({ mem: 2.5 }), ctxBnbTv);
  check('D4 mem 2.5+五腿全中 → 拦（C189 恢复：五腿刻意不豁——名字资格独立于事件成分；审计 hit 照落）',
    blockedBy(rD4, NF_LABEL)
    && rD4.stage2DataToSave.parsed_output.jev.recognizedEntitySlogan.hit === true, rD4.llmResult.reason);
  // D5 对照：同 D4 形状但 name_form=meme_name → 名字门/载体门全放（mem 地板
  //    已退役；该形状真实可过——名字门必要性正证）
  const rD5 = mapStandardAnswers(incidentAnswers({ mem: 2.5, nameForm: 'meme_name' }), ctxBnbTv);
  check('D5 对照 mem 2.5+五腿全中+meme_name → 全放行（pass=true，名字门必要性正证）',
    rD5.llmResult.pass === true && !blockedBy(rD5, NF_LABEL) && !blockedBy(rD5, CARRIER_LABEL),
    { pass: rD5.llmResult.pass, reason: rD5.llmResult.reason });

  // ═══ D2 段：C105 日本語版案快照反证（J1.39 行实测值）═══
  console.log('\n── D2. 日本語版 0xe156…7777 J1.39 快照反证 ──');
  const ctxJp = stdCtx('日本語版', '日本語版');
  // D6 线上实况复现：name_form=entity_phrase（J1.39 无臂可选，兼容放行臂）→
  //    五腿全中豁掉 block 臂+载体门+mem 地板（2.5≥2）+S 档标准数学 → pass=true
  //    （high 放行，线上 80.24 过线的形状）——名字门必要性正证
  const rD6 = mapStandardAnswers(jpEditionAnswers({ nameForm: 'entity_phrase' }), ctxJp);
  check('D6 J1.39 实况（entity_phrase）→ 五腿全中高分放行（pass=true 线上 high 形状复现）',
    rD6.llmResult.pass === true
    && rD6.stage2DataToSave.parsed_output.jev.recognizedEntitySlogan.hit === true
    && !blockedBy(rD6, CARRIER_LABEL),
    { pass: rD6.llmResult.pass, reason: rD6.llmResult.reason });
  // D7 J1.41 形状：同快照 name_form=not_meme_name → 拦（C189 恢复；五腿照常工作）
  const rD7 = mapStandardAnswers(jpEditionAnswers(), ctxJp);
  check('D7 J1.41 形状（not_meme_name）→ 拦（C189 恢复；五腿 hit 照落、载体门退役不拦）',
    blockedBy(rD7, NF_LABEL) && !blockedBy(rD7, CARRIER_LABEL)
    && rD7.stage2DataToSave.parsed_output.jev.recognizedEntitySlogan.hit === true,
    rD7.llmResult.reason);
  check('D7b stage1 nameForm=not_meme_name 恒落',
    rD7.stage1DataToSave.parsed_output.jev.web3UserAcceptability === 'not_meme_name',
    rD7.stage1DataToSave.parsed_output.jev.web3UserAcceptability);
  // D8 兼容臂判定值照算：statement/functional_label 旧 choice 与 not_meme_name
  //    收敛同一函数（C189 恢复后同拦，form 归因可分）
  const rD8st = mapStandardAnswers(jpEditionAnswers({ nameForm: 'statement' }), ctxJp);
  const rD8fl = mapStandardAnswers(jpEditionAnswers({ nameForm: 'functional_label' }), ctxJp);
  check('D8 同快照 statement/functional_label 兼容臂 → 照拦（C189 恢复；form 归因可分）',
    blockedBy(rD8st, NF_LABEL) && blockedBy(rD8fl, NF_LABEL)
    && rD8st.stage2DataToSave.parsed_output.jev.web3UserAcceptabilityBlock.choice === 'statement'
    && rD8fl.stage2DataToSave.parsed_output.jev.web3UserAcceptabilityBlock.choice === 'functional_label',
    { st: rD8st.llmResult.reason, fl: rD8fl.llmResult.reason });

  // ═══ G. C108 统一门行为真值表（EARLY 案翻案位+四分支+退役位移交）═══
  console.log('\n── G. C108 统一门真值表（EARLY 0xc8a5…7777 翻案位 + 四分支 + nr/rm/memFloor 移交）──');
  const ctxEarly = stdCtx('Early', 'Early');
  // G1 EARLY 案翻案位：web3_user_name_entity_acceptance common_word 0.92（J1.10 原拦截值原样）+
  //    name_form=meme_name（J1.42 题面锚「Early 合格」）→ 放行——nr 退役+分支②
  const g1 = Object.assign(baseAnswers('A'), {
    web3_user_name_entity_acceptance: { choice: 'no_entity', probabilities: { no_entity: 0.92, unknown: 0.04, accepted: 0.02 } },
    name_form: { choice: 'meme_name', probabilities: { meme_name: 0.85 } },
  });
  const rG1 = mapStandardAnswers(g1, ctxEarly);
  check('G1 EARLY 翻案位：common_word 0.92（原拦截值）+meme_name → 放行（nr 退役+分支②圈内深意）',
    rG1.llmResult.pass === true, { pass: rG1.llmResult.pass, reason: rG1.llmResult.reason });
  // G1b 对照：同形状 name_form=not_meme_name → 名字门拦（Jev 判不合格时新门承载）
  const rG1b = mapStandardAnswers(Object.assign({}, g1, {
    name_form: { choice: 'not_meme_name', probabilities: { not_meme_name: 0.85 } },
  }), ctxEarly);
  check('G1b 对照：common_word 0.92+not_meme_name → 拦（C189 恢复：词句门承载；判定值照落档）',
    blockedBy(rG1b, NF_LABEL)
    && rG1b.stage2DataToSave.parsed_output.jev.web3UserAcceptabilityBlock?.choice === 'not_meme_name', rG1b.llmResult.reason);
  // G1c nr 概率退役转纯观察：G1 票 nameEntityAcceptanceProbability=0.92 恒落（不再拦截）
  check('G1c nr 概率退役转纯观察（nameEntityAcceptanceProbability 恒落审计）',
    rG1.stage1DataToSave.parsed_output.jev.nameEntityAcceptanceProbability === 0.92
    || rG1.stage2DataToSave.parsed_output.jev.nameEntityAcceptanceProbability === 0.92, null);
  // G2 滑雪/我要去型（分支②）：B 类不触载体门，not_meme_name → 拦
  const rG2 = mapStandardAnswers(baseAnswers('B', {
    name_form: { choice: 'not_meme_name', probabilities: { not_meme_name: 0.9 } },
  }), stdCtx('滑雪', '滑雪'));
  check('G2 滑雪型（分支②无圈内感知）→ 拦（C189 恢复）',
    blockedBy(rG2, NF_LABEL), rG2.llmResult.reason);
  // G3 YAYA 型（分支①无名实体）：J1.81 三轴重构后 unknown 实体票归实体轴——
  //    词句门分流跳过（entity choice ∈ {accepted,unknown,new_entity,wrong_entity}
  //    不经词句题）；ne 门域 B/C/D/F/G/W（J1.56 裁定沿用，A 刻意不在域）。A 类+
  //    unknown 五五开（0.41<0.5 ne 门不拦）+not_meme_name → 三轴全放（原 C108 靠
  //    名字门拦的 A 类无名实体票在 J1.81 放行——分流边界效应观察位）；对照：
  //    C 类 unknown≥0.5 → ne 门拦（无名实体票由实体轴正门承载）
  const yayaNr = { choice: 'unknown', probabilities: { unknown: 0.41, accepted: 0.43, no_entity: 0.05 } };
  const rG3 = mapStandardAnswers(baseAnswers('A', {
    web3_user_name_entity_acceptance: yayaNr,
    name_form: { choice: 'not_meme_name', probabilities: { not_meme_name: 0.9 } },
  }), stdCtx('YAYA', 'YAYA'));
  const rG3b = mapStandardAnswers(baseAnswers('A', {
    web3_user_name_entity_acceptance: yayaNr,
    name_form: { choice: 'meme_name', probabilities: { meme_name: 0.9 } },
  }), stdCtx('YAYA', 'YAYA'));
  check('G3 YAYA 型 A 类 unknown 五五开 → not_meme_name/meme_name 双放（J1.81 实体票分流：词句门跳过+A 域 ne 门刻意不拦——边界效应观察位）',
    rG3.llmResult.pass === true && rG3b.llmResult.pass === true && !blockedBy(rG3, NF_LABEL),
    { pass: rG3.llmResult.pass, reason: rG3.llmResult.reason });
  const rG3c = mapStandardAnswers(baseAnswers('C', {
    web3_user_name_entity_acceptance: { choice: 'unknown', probabilities: { unknown: 0.62 } },
    name_form: { choice: 'not_meme_name', probabilities: { not_meme_name: 0.9 } },
  }), stdCtx('YAYA', 'YAYA'));
  check('G3b 对照：C 类 unknown 0.62 → 实体类型门不拦（J1.113/C184 断代：不归一读旧 unknown，历史缓存行零翻转；两审计键均停产出/无 unacceptable_type 概率=null）',
    !/币名映射实体在 Web3 用户侧无名/.test(rG3c.llmResult.reason || '')
    && !/币名实体类型不被 BSC meme 用户接纳/.test(rG3c.llmResult.reason || '')
    && rG3c.stage2DataToSave.parsed_output.jev.nameEntityLowMass == null
    && rG3c.stage2DataToSave.parsed_output.jev.nameEntityTypeUnfitMass == null,
    rG3c.llmResult.reason);
  // G4 rm 退役位移交：mem=1（原 rmBlock mem≤1 拦）+A 类+meme_name → 放行；
  //    同形状 not_meme_name → 名字门拦（票型责任移交）
  const rG4 = mapStandardAnswers(baseAnswers('A', {
    name_entity_memeability: { score: 1, probabilities: {} },
    name_form: { choice: 'meme_name', probabilities: { meme_name: 0.9 } },
  }), stdCtx('TST', 'TST'));
  const rG4b = mapStandardAnswers(baseAnswers('A', {
    name_entity_memeability: { score: 1, probabilities: {} },
    name_form: { choice: 'not_meme_name', probabilities: { not_meme_name: 0.9 } },
  }), stdCtx('TST', 'TST'));
  check('G4 rm 退役（mem=1）：meme_name 放行 / not_meme_name 词句门拦（C189 恢复：票型责任移交名字门）',
    rG4.llmResult.pass === true && blockedBy(rG4b, NF_LABEL),
    { pass: rG4.llmResult.pass, blocked: rG4b.llmResult.reason });
  // G5 memFloor 退役位：mem=1.72（原 C88 mem∈(1,2) 地板拦）+fresh+A 类+meme_name
  //    → 放行；referentMemeabilityScore 恒落照旧（G6）
  const rG5 = mapStandardAnswers(baseAnswers('A', {
    name_entity_memeability: { score: 1.72, probabilities: {} },
    name_form: { choice: 'meme_name', probabilities: { meme_name: 0.9 } },
  }), stdCtx('TST', 'TST'));
  check('G5 memFloor 退役（mem 1.72 死区）：meme_name+A 类 → 放行（名字有圈内感知的票不再被地板拦）',
    rG5.llmResult.pass === true, { pass: rG5.llmResult.pass, reason: rG5.llmResult.reason });
  check('G6 J1.61：referentMemeabilityScore 停止产出（题已删，历史行保留）',
    rG5.stage2DataToSave.parsed_output.jev.referentMemeabilityScore === undefined, null);
  // G7 block_misspelling 探针退役行为臂：旧缓存行带 noul 0.9（极端高）+meme_name
  //    → 放行（C78 实证死键；图文对照 C78 代码门独立保留）
  const rG7 = mapStandardAnswers(baseAnswers('A', {
    block_misspelling: { noul: 0.9 },
    name_form: { choice: 'meme_name', probabilities: { meme_name: 0.9 } },
  }), stdCtx('TST', 'TST'));
  check('G7 block_misspelling 探针退役（noul 0.9 极端高）+meme_name → 放行（死键不再拦）',
    rG7.llmResult.pass === true, { pass: rG7.llmResult.pass, reason: rG7.llmResult.reason });

  // ═══ E. 审计字段 ═══
  console.log('\n── E. 审计字段（恒落/命中才落/双写/probabilities）──');
  const rE = mapStandardAnswers(incidentAnswers(), ctxBnbTv);
  const s1 = rE.stage1DataToSave.parsed_output.jev;
  check('E1 stage1 web3UserAcceptability 恒落（statement）', s1.web3UserAcceptability === 'statement', s1.web3UserAcceptability);
  check('E2 stage1 findingVsRecap 恒落（news_recap）', s1.findingVsRecap === 'news_recap', s1.findingVsRecap);
  const s2 = rE.stage2DataToSave.parsed_output.jev;
  check('E3 stage2 findingVsRecap 双写（信号页/校准脚本消费位）', s2.findingVsRecap === 'news_recap', s2.findingVsRecap);
  check('E4 stage2 web3UserAcceptabilityBlock 命中才落 {choice:statement}（兼容臂 form=Jev 原 choice）',
    JSON.stringify(s2.web3UserAcceptabilityBlock) === '{"choice":"statement"}', s2.web3UserAcceptabilityBlock);
  check('E4b stage2 web3UserAcceptabilityBlock 新判/not_meme_name/未命中三形状（C107 统一键）',
    (() => {
      const rNew = mapStandardAnswers(jpEditionAnswers(), ctxJp);
      const j2 = rNew.stage2DataToSave.parsed_output.jev;
      return JSON.stringify(j2.web3UserAcceptabilityBlock) === '{"choice":"not_meme_name"}'
        // 未命中臂（meme_name 快照）→ null
        && (() => {
          const r2 = mapStandardAnswers(jpEditionAnswers({ nameForm: 'meme_name' }), ctxJp);
          return r2.stage2DataToSave.parsed_output.jev.web3UserAcceptabilityBlock === null;
        })();
    })(), null);
  check('E5 stage2 probabilities.bsc_meme_user_phrase_acceptability / event_finding_vs_recap 落库（J1.112 dump 键断代）',
    s2.probabilities.bsc_meme_user_phrase_acceptability != null && s2.probabilities.event_finding_vs_recap != null, null);
  // 未命中臂：meme_name/finding → web3UserAcceptabilityBlock=null + 恒落键照落
  const rEm = mapStandardAnswers(baseAnswers('D'), stdCtx('TST', 'TST'));
  check('E6 未命中 web3UserAcceptabilityBlock=null（门形状事后校准免重跑）',
    rEm.stage2DataToSave.parsed_output.jev.web3UserAcceptabilityBlock === null, null);
  check('E7 旧缓存行（两题缺失）恒落键=null 可识别',
    (() => {
      const a = baseAnswers('D'); delete a.event_finding_vs_recap; delete a.name_form;
      const r = mapStandardAnswers(a, stdCtx('TST', 'TST'));
      const j1 = r.stage1DataToSave.parsed_output.jev;
      return j1.web3UserAcceptability === null && j1.findingVsRecap === null
        && r.stage2DataToSave.parsed_output.jev.findingVsRecap === null
        && r.llmResult.pass === true; // fail-open 不拦
    })(), null);

  // ═══ F. 源码口径 ═══
  console.log('\n── F. 源码口径（门链序/不豁/兼容 Set/优先级/失效语义）──');
  const { readFileSync } = await import('fs');
  const { join } = await import('path');
  const mapperSrc = readFileSync(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-result-mapper.mjs'), 'utf8');
  check('F1 门函数 web3UserAcceptabilityBlock（J1.81 收窄=entityChoice 分流 not_entity/no_entity/缺失才评；Set 成员判定非成员短路 null）',
    /function web3UserAcceptabilityBlock\(answers\) \{\s*\n\s*\/\/ J1\.81\/C139 词句门收窄[\s\S]*?const entityChoice = q\(answers, 'bsc_meme_user_name_entity_acceptance', 'web3_user_name_entity_acceptance'\)\?\.choice;\s*\n\s*if \(entityChoice && entityChoice !== 'not_entity' && entityChoice !== 'no_entity'\) return null;\s*\n\s*const choice = web3UserAcceptabilityChoice\(answers\);\s*\n\s*if \(!WEB3_USER_NOT_ACCEPTABLE_CHOICES\.has\(choice\)\) return null;\s*\n\s*return \{ label: 'Web3 用户不接纳该名字（词句接纳度门）', choice \};/.test(mapperSrc), null);
  check('F1c 题键断代三键读（J1.81 phrase 优先、web3_user_name_acceptability/name_form 存量兼容）',
    /answers\?\.bsc_meme_user_phrase_acceptability\?\.choice\s*\n\s*\?\? answers\?\.web3_user_phrase_acceptability\?\.choice\s*\n\s*\?\? answers\?\.web3_user_name_acceptability\?\.choice\s*\n\s*\?\? answers\?\.name_form\?\.choice;/.test(mapperSrc), null);
  check('F1b 兼容 Set 四值锁死（web3_user_not_acceptable 新键 + not_meme_name/statement/functional_label 旧键——J1.50 键名断代 bit 兼容红线，存量缓存行照拦）',
    /const WEB3_USER_NOT_ACCEPTABLE_CHOICES = new Set\(\[\s*\n\s*'bsc_meme_user_not_acceptable',[^\]]*?'web3_user_not_acceptable',[^]*?'not_meme_name', 'statement', 'functional_label',[^]*?\]\);/.test(mapperSrc), null);
  check('F2 C189 门链恢复拦截：ua 臂在门链（else if (uaBlock)），sc 形象门臂维持退役（C171）', (() => {
    const uaArm = mapperSrc.indexOf('else if (uaBlock) {');
    const scIdx = mapperSrc.indexOf('entityVisualBlock(answers, category');
    const uaObs = mapperSrc.indexOf('const uaBlock = web3UserAcceptabilityBlock(answers)');
    return uaArm > 0 && scIdx === -1 && uaObs > 0 && uaObs < uaArm ? true : { uaArm, scIdx, uaObs };
  })());
  check('F3 C189 恢复链序：词句门在 wrong_entity 臂后、量级门 D/E 档臂前（全域无豁免）',
    mapperSrc.indexOf('(weBlock = wrongEntityBlock') < mapperSrc.indexOf('else if (uaBlock) {')
    && mapperSrc.indexOf('else if (uaBlock) {') < mapperSrc.indexOf("effTier === 'E' || effTier === 'D'")
    && !/!pubProxyActive && uaBlock/.test(mapperSrc), null);
  check('F4 改道公式：cashtagForced 优先、recapForced 次之（互斥无竞争）',
    mapperSrc.includes("const category = cashtagForced ? 'W' : (recapForced ? 'E' : (answers.event_category?.choice || null));"), null);
  check('F5 改道判据锁死 F+news_recap 组合（choice 恒等）',
    mapperSrc.includes("const recapForced = !!(answers.event_category?.choice === 'F'\n    && answers.event_finding_vs_recap?.choice === 'news_recap');"), null);
  check('F6 题集头部含 J1.37 changelog（C96 案档案）',
    (await readQuestionsSrc()).includes('* J1.37（2026-10-18') && (await readQuestionsSrc()).includes('0xc6d089d749409f7646de440d637ac9db0e047777'), null);
  check('F6b 题集头部含 J1.40 changelog（C105 案档案：0xe156 地址+裁定原话）',
    (await readQuestionsSrc()).includes('* J1.40（2026-10-19')
    && (await readQuestionsSrc()).includes('0xe156aa3f3e89ded51ef0b980018ef15ae0517777')
    && (await readQuestionsSrc()).includes('根本不能作为 meme 名字'), null);
  check('F6c 题集头部含 J1.41 changelog（C107 收敛裁定原话+两门合并去向）',
    (await readQuestionsSrc()).includes('* J1.41（2026-10-19')
    && (await readQuestionsSrc()).includes('可以不加新维度')
    && (await readQuestionsSrc()).includes('web3UserAcceptabilityBlock'), null);
  check('F6d 题集头部含 J1.42 changelog（C108 统一：三轮裁定原话+四拦截位退役去向+block_misspelling 删题）',
    (await readQuestionsSrc()).includes('* J1.42（2026-10-19')
    && (await readQuestionsSrc()).includes('合不合适作为 meme 币')
    && (await readQuestionsSrc()).includes('early 并不是一个实体')
    && (await readQuestionsSrc()).includes('YAYA')
    && (await readQuestionsSrc()).includes('block_misspelling 题删除'), null);
  check('F7 存量行不重评=观察期语义，name_form 答案缺失 fail-open（E7 已验行为臂）',
    mapperSrc.includes('unclear/答案缺失 fail-open 不拦（生产链 JevClient 缺\n * 答案 throw）'), null);
  // C108 退役位源码反证：四拦截位调用形状全部不存在（注释并档除外）
  check('F8 C108 退役位源码反证：nrBlock/rmBlock/memFloor 调用形状不存在', (() => {
    const calls = [
      'nameReferentBlock(answers', '= referentMemeabilityLowBlock(',
      'memFloorFired', 'nrNotableExempt =',
    ];
    const residue = calls.filter(c => mapperSrc.includes(c));
    return residue.length === 0 ? true : residue;
  })());
  check('F9 J1.61：memScoreC88 已从 mapper 移除（C88 四腿，无 mem 腿）',
    !mapperSrc.includes('memScoreC88'), null);
  check('F10 misspellingP/block_misspelling 探针全清（C78 代码门 spellingMismatch 保留单判据）',
    !mapperSrc.includes('misspellingP') && !mapperSrc.includes('answers.block_misspelling')
    && mapperSrc.includes('spellingMismatch.hit'), null);
  check('F11 实体题保留只喂豁免链（accepted+authorUtterance）；玩味题已删并入名字门（J1.61）',
    mapperSrc.includes("q(answers, 'bsc_meme_user_name_entity_acceptance', 'web3_user_name_entity_acceptance')?.probabilities?.accepted") && mapperSrc.includes('authorUtterance')
    && !mapperSrc.includes('answers.name_entity_memeability'), null);

  // ═══ 汇总 ═══
  console.log(`\n══════ _test_jev_finding_recap_statement_gate: ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

// 题集源码缓存读（A10/F6 双消费）
let _qsSrc = null;
async function readQuestionsSrc() {
  if (_qsSrc === null) {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    _qsSrc = readFileSync(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-questions.mjs'), 'utf8');
  }
  return _qsSrc;
}

main().catch(e => { console.error('单测异常:', e); process.exit(1); });
