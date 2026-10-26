#!/usr/bin/env node
/**
 * C109 题集收敛（J1.43）——本地零 DB 单测（2026-10-19 交易猫 0xc929…7777 案）
 *
 * 收敛清单（用户裁定「合并题/桶」）：
 *   - name_event_relevance+relevance_level 两题合一（9 融合桶，分值 RELEVANCE_FUSED_SCORES）
 *   - quality_spelling+quality_reasonability 合并 token_name_quality（band 索引 0-3）
 *   - web3_user_name_entity_acceptance 6→3（other_referent 并四桶+配图形象指代源）
 *   - event_subject_entity 8→2（product_entity/other_entity，J1.27 兼容集）
 *   - event_token_block_reason 删 regional_event（死桶 0 拦截）/subject_unqualified（三重冗余）
 *   - name_entity_carrier 锚修正（M1 图证覆盖在 _test_subject_carrier.cjs H 段）
 *
 * 覆盖：
 *   A. 问卷形状：16 题/桶数/版本 J1.43/旧题不存在
 *   B. 融合关联分：9 桶精确分值 + reason 模板无 lv 段 + 截断线两侧（weak 9 拦/clear 13 过）
 *   C. legacy 关联形状 bit 不变（semantic/lv 查表原样）
 *   D. token_name_quality 四档映射 + legacy 双题路径 bit 不变
 *   E. C88 relPositiveMass 融合桶名求和（新桶全量形状 hit / 旧桶名 legacy 形状照 hit）
 *   F. J1.27 产品实体门：product_entity 新桶拦 + 旧两桶名兼容拦 + other_entity 不拦
 *   G. 退役阻断桶：subject_unqualified/regional_event choice 空域不拦（blockInScope
 *      未知选项按通用拦的坑——显式空数组封死）
 *
 * 用法：node scripts/_test_jev_question_consolidation.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

/** 干净不拦形状：A 档量级、exact 关联、superIP 指代、无 carrier（可注入） */
function baseAnswers() {
  return {
    event_category: { choice: 'C', probabilities: { C: 0.7 } },
    event_magnitude: { score: 4.6, probabilities: { '4': 0.5, '5': 0.3 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.9 } },
    dimension2: { score: 25, probabilities: { '5': 0.6, '4': 0.3 } },
    event_quality_veto: { choice: 'none', probabilities: { none: 0.92 } },
    web3_user_name_entity_acceptance: { choice: 'accepted', probabilities: { accepted: 0.9, unknown: 0.08 } },
    name_entity_memeability: { score: 3, probabilities: {} },
    web3_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.85, fit: 0.1 } },
    event_subject_entity: { choice: 'other_entity', probabilities: { other_entity: 0.7 } },
    name_entity_carrier: { choice: 'existing_entity', probabilities: { existing_entity: 0.8 } },
    name_form: { choice: 'meme_name', probabilities: { meme_name: 0.85 } },
    event_finding_vs_recap: { choice: 'new_finding', probabilities: { new_finding: 0.8 } },
  };
}

const stdCtx = (symbol, name) => ({
  tokenData: { symbol, name: name || symbol, raw_api_data: { name: name || symbol } },
  includeBrandHijack: false,
  tweetClassification: null,
  twitterInfo: null,
  callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
});

async function main() {
  const mapper = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const { mapStandardAnswers } = mapper;
  const { buildStandardQuestions, JEV_QUESTIONS_VERSION } = await import('../src/narrative/analyzer/llm/jev-questions.mjs');

  // ═══ A. 问卷形状 ═══
  console.log('\n── A. 问卷形状（J1.43）──');
  check('A1 版本 J1.93（J1.102=C171 形象载体轴整轴退役（删 web3_user_entity_visuality/event_influence 题集 12→10）；J1.93=C156 name_event_relevance→web3_user_name_event_acceptance；J1.92=C155 3 桶；J1.91=C154 时效体系清理；J1.90=C152 MEMES fit 锚；J1.90=C152 MEMES fit 锚；J1.89=C151 哭哭奶龙 wrong_entity 修正；J1.88=C150 删 event_institution_routine 桶（机构日常交 web3_user_event_fit）；J1.87=C145 删 routine 桶；J1.86=C143 校准（题面锚点）；J1.85=C143 品牌劫持并入实体轴——name_brand_hijack 题退役、实体题加 brand_mismatch 桶；J1.84=C142 W 数学双轴合并单轴——w_product_score 退役、w_bsc_user_appeal 0-75、pass 57；J1.83=C141 event_subject_entity 题退役——判据并入 event_fit unfit 桶+门一般化 web3FitMassBlock；J1.82=C140 圈层可达性桶退役；J1.81=C139 名字三轴重构（实体题五桶 wrong_entity/词句题改 phrase 收窄/载体题改 visuality）；J1.79=事件分改 fit 质量+删 web3_user_event_impact 题；J1.74=C134 W 交互臂→BSC 用户吸引力；J1.72=C133 实体题新增 new_entity（新实体）；J1.71=事件侧三合一 Web3 用户影响力；J1.70=C130 审计键语义化；J1.69=C130 名字门判定对象收敛为链上 Symbol（币名）；J1.57=C126 概念清理；J1.56=C126 命名批次+实体题重构；J1.55=C124 web3_user_name_entity_acceptance 圈内符号级锚（super_ip=被当符号使用证据级；发布者指代分支/三前提/配图臂保留）；J1.54=C123 门名/题键语义化（event_magnitude→web3_user_event_impact / dimension2→web3_user_event_spread + 门函数/审计键改名，判据零改动）；J1.53=C122 门名断代；J1.52=C121 用户视角批次一：w_product_score 用户兴奋度锚（C42 形态词保留）+niche_subculture 认知可达性锚（35 行全 A 类活桶改锚非退役）；J1.51=C119 批内修正 dim2 镜头（认知面非实测互动）；J1.50=C119 用户视角统一；J1.44=C110 合桶+mem 瘦身；J1.45=C110 扫描后裁定 dim2 同轴锚删除+gimmick 扩全域；J1.46=C113 找角度判轴+token_ip_reuse 边界；J1.47=C114 name_form 通用梗缩写锚；J1.48=C116 整句情绪姿态分界；J1.49=C118 image_depicts_name 条件题；本测试 J1.48/J1.49 两轮漏 bump 存量修复）', parseInt(JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 102, JEV_QUESTIONS_VERSION);
  const qs = buildStandardQuestions();
  check('A2 基础 10 题（J1.102/C171 删 web3_user_entity_visuality/event_influence；J1.84 删 w_product_score；J1.83 删 event_subject_entity；J1.79 删 web3_user_event_impact；J1.71 删 web3_user_event_spread）', Object.keys(qs).length === 10 && !('web3_user_entity_visuality' in qs) && !('event_influence' in qs), Object.keys(qs).length);
  check('A3 旧题已删（relevance_level/quality_spelling/quality_reasonability 不存在）',
    !('relevance_level' in qs) && !('quality_spelling' in qs) && !('quality_reasonability' in qs), null);
  check('A4 token_name_quality 在（0-3 四档）', qs.token_name_quality?.type === 'score' && qs.token_name_quality.criteria.length === 4, qs.token_name_quality?.criteria?.length);
  check('A5 web3_user_name_event_acceptance 3 用户视角桶（J1.93/C156 改名；J1.92/C155：exact_match/acceptable/unacceptable）',
    Object.keys(qs.bsc_meme_user_name_event_acceptance.criteria).length === 3
    && ['exact_match', 'acceptable', 'unacceptable'].every(k => k in qs.bsc_meme_user_name_event_acceptance.criteria), Object.keys(qs.bsc_meme_user_name_event_acceptance.criteria));
  // J1.109/C179：豁免段挪判轴级（用户裁定「挂在被限制桶下=逻辑冲突」）+ J1.108/C178 措辞强化
  // 事故反证——防豁免段回挂③桶、防旧明示措辞与 semantic 残留句复活
  const relIns = qs.bsc_meme_user_name_event_acceptance.instructions;
  const relBucketStart = relIns.indexOf('① **exact_match');
  const relExempt = relIns.indexOf('⚠️ 宣告采信豁免（判轴级规则，先于分桶判定）');
  check('A5b 豁免判轴级（J1.109：豁免段在①②③分桶之前=先立规则再列桶，不挂在被限制桶下；J1.108 措辞：发币+宣告并置即币名承载不要求点名/明说；反臂=名字是另一个词不豁免；桶内 unacceptable 无自相注释）',
    relExempt !== -1 && relBucketStart !== -1 && relExempt < relBucketStart
      && relIns.indexOf('宣告采信豁免', relBucketStart) === -1
      && relIns.includes('不要求宣告点名说出名字')
      && relIns.includes('不得要求语料再明说「币名=该名字」')
      && relIns.includes('另一个词（≠币名）')
      && !relIns.includes('且币名正是承载该名字的代币')
      && !relIns.includes('semantic_clear')
      && qs.bsc_meme_user_name_event_acceptance.criteria.acceptable.includes('宣告采信豁免适用 → 本桶起步')
      && !qs.bsc_meme_user_name_event_acceptance.criteria.unacceptable.includes('宣告采信豁免')
      && !qs.bsc_meme_user_name_event_acceptance.criteria.unacceptable.includes('不适用本桶'),
    '豁免判轴级位置/措辞/反臂/防回挂四缺一');
  const qsBrand = buildStandardQuestions({ brandMismatch: true });
  check('A6 实体题五桶恒形（J1.124/C194 加 entity_event_mismatch 实体-事件影响力脱节；J1.113/C184：unknown 断代 unacceptable_type 类型轴+new_entity 删桶——性质可接纳即 accepted，新旧不是维度；brand_mismatch 桶 J1.103/C172 随品牌劫持轴退役；J1.81/C139 wrong_entity 拦截位+no_entity 断代改名 not_entity）',
    Object.keys(qsBrand.bsc_meme_user_name_entity_acceptance.criteria).length === 5
    && ['accepted', 'unacceptable_type', 'wrong_entity', 'not_entity', 'entity_event_mismatch'].every(k => k in qsBrand.bsc_meme_user_name_entity_acceptance.criteria)
    && !('brand_mismatch' in qsBrand.bsc_meme_user_name_entity_acceptance.criteria)
    && !('no_entity' in qsBrand.bsc_meme_user_name_entity_acceptance.criteria)
    && !('new_entity' in qsBrand.bsc_meme_user_name_entity_acceptance.criteria)
    && !('unknown' in qsBrand.bsc_meme_user_name_entity_acceptance.criteria), null);
  check('A6b 非品牌票实体题保持 5 桶恒形（J1.124/C194 五桶；品牌票与非品牌票同形，不稀释 accepted 概率）',
    Object.keys(qs.bsc_meme_user_name_entity_acceptance.criteria).length === 5
    && !('brand_mismatch' in qs.bsc_meme_user_name_entity_acceptance.criteria)
    && !qs.bsc_meme_user_name_entity_acceptance.instructions.includes('brand_mismatch'), null);
  check('A6c unacceptable_type 判据=类型/性质轴（J1.113/C184：不评认知度；新实体类型不合照样归本项）',
    qs.bsc_meme_user_name_entity_acceptance.criteria.unacceptable_type.includes('类型/性质不合，不是认知度')
    && qs.bsc_meme_user_name_entity_acceptance.criteria.unacceptable_type.includes('不是维度')
    && qs.bsc_meme_user_name_entity_acceptance.instructions.includes('只看实体的类型/性质'), null);
  check('A6b not_entity 中性声明（J1.81 断代改名）+ 配图形象指代源（交易猫断链修复点）',
    qs.bsc_meme_user_name_entity_acceptance.criteria.not_entity.includes('中性')
    && qs.bsc_meme_user_name_entity_acceptance.instructions.includes('配图中真实出现的形象'), null);
  check('A7 event_subject_entity 题已退役（J1.83/C141——判据并入 web3_user_event_fit unfit 桶产品实体臂，题集 -1；旧缓存行残留键 mapper 不再消费）',
    qs.event_subject_entity === undefined
    && qs.bsc_meme_user_event_fit.criteria.unfit.includes('公司产品实体不被接纳'), null);
  check('A8 event_token_block_reason 5 桶（J1.127/C231 加 event_trivial=事件意义太小——事件真实成立但对 BSC meme 用户意义太小/看一眼就划过（黄仁勋名誉黑带案），BLOCK_SCOPE 全域拦，与 empty_content 划界=有事件但太小 vs 没有事件）（J1.110/C181 键名断代 event_quality_veto → web3_user_event_impact——mapper 三键归一读旧行）（J1.101/C170 退役 event_negative_hard_news（负面事件交 web3_user_event_fit 口径层判）；J1.88/C150 退役 event_institution_routine（机构日常交 web3_user_event_fit）；J1.87/C145 退役 event_routine_content_product（日常产品/内容宣传交 web3_user_event_fit）；J1.82/C140 退役 token_circle_reachability（圈层可达性并入 event_fit unfit 档）；C109 退役 regional/subject_unqualified + C110 退役 low_quality_derivative + J1.64 退役 event_marketing_gimmick）',
    Object.keys(qs.bsc_meme_user_event_impact.criteria).length === 5
    && 'event_trivial' in qs.bsc_meme_user_event_impact.criteria
    && !('regional_event' in qs.bsc_meme_user_event_impact.criteria) && !('subject_unqualified' in qs.bsc_meme_user_event_impact.criteria)
    && !('low_quality_derivative' in qs.bsc_meme_user_event_impact.criteria)
    && !('event_marketing_gimmick' in qs.bsc_meme_user_event_impact.criteria)
    && !('event_routine_content_product' in qs.bsc_meme_user_event_impact.criteria)
    && !('event_institution_routine' in qs.bsc_meme_user_event_impact.criteria)
    && !('token_circle_reachability' in qs.bsc_meme_user_event_impact.criteria)
    && !('event_negative_hard_news' in qs.bsc_meme_user_event_impact.criteria), null);
  check('A8b C113 token_ip_reuse 边界重写：仅拦纯蹭名+无意义修改两形状，有意义的修改/变形不拦（用户裁定「合理即可」）',
    qs.bsc_meme_user_event_impact.criteria.token_ip_reuse.includes('纯蹭名') && qs.bsc_meme_user_event_impact.criteria.token_ip_reuse.includes('无意义修改')
    && qs.bsc_meme_user_event_impact.criteria.token_ip_reuse.includes('有意义的修改/变形不选本项') === true, null);
  // A8c 行为级退役证明（legacy 形状行/旧缓存重放）：A 类票 argmax=low_quality_derivative
  // （none<0.5 域内）不再拦——C109 教训的机器证明：scope 显式空数组才是真退役；
  // 同形状 argmax=token_ip_reuse 照拦（合并不外溢）
  {
    const aRetired = baseAnswers();
    aRetired.event_category = { choice: 'A', probabilities: { A: 0.8 } };
    aRetired.event_quality_veto = { choice: 'low_quality_derivative', probabilities: { none: 0.1, low_quality_derivative: 0.7 } };
    const rRetired = mapStandardAnswers(aRetired, stdCtx('TST', 'TST'));
    check('A8c 退役桶行为：A 类 argmax=low_quality_derivative 不再拦（显式空域）',
      !(rRetired.llmResult.reason || '').includes('低质衍生'), rRetired.llmResult.reason);
    const aActive = baseAnswers();
    aActive.event_category = { choice: 'A', probabilities: { A: 0.8 } };
    aActive.event_quality_veto = { choice: 'token_ip_reuse', probabilities: { none: 0.1, token_ip_reuse: 0.7 } };
    const rActive = mapStandardAnswers(aActive, stdCtx('TST', 'TST'));
    check('A8d 活桶对照：A 类 argmax=token_ip_reuse 照拦（合并不外溢）',
      (rActive.llmResult.reason || '').includes('IP低质复用') && rActive.llmResult.rating === 'low', rActive.llmResult.reason);
  }

  // A8e J1.64：marketing_gimmick 选项已删除（噱头并入影响力轴）——argmax 用
  // 存活桶 event_baseless_speculation 验证全域 argmax 机制仍在
  {
    const aHole = baseAnswers();
    aHole.event_category = { choice: 'E', probabilities: { E: 0.8 } };
    aHole.event_quality_veto = { choice: 'event_empty_content', probabilities: { none: 0.2, event_empty_content: 0.6 } };
    const rHole = mapStandardAnswers(aHole, stdCtx('TST', 'TST'));
    check('A8e 全域 argmax 机制（J1.64 gimmick 删后以 event_empty_content 验证）：E 类照拦',
      rHole.llmResult.rating === 'low' && (rHole.llmResult.reason || '').includes('空洞内容'), rHole.llmResult.reason);
  }

  // A9 J1.71 事件侧三合一：web3_user_event_spread 题删除，影响力只由 impact 题给分
  {
    check('A9 J1.79 事件价值题单源：spread 题删除；J1.110/C181 impact 键复活为 choice 否决题（非旧 score 事件分题）；fit 题声明事件分=strong_fit+fit 质量（非影响力大小）',
      qs.web3_user_event_spread === undefined
      && qs.bsc_meme_user_event_impact?.type === 'choice'
      && qs.bsc_meme_user_event_fit.instructions.includes('事件分=本题 strong_fit+fit 质量')
      && qs.bsc_meme_user_event_fit.instructions.includes('不是事件影响力大小'),
      Object.keys(qs).filter(k => k.includes('spread') || k.includes('impact') || k.includes('fit')));
  }

  // A10 J1.46（C113 哭哭奶龙案）事故现场反证：找角度语料传播力判轴=事件本身
  // 非载体推文数据（用户 C32 正龟裁定重申「强调一万遍」）——现场：dim2 8.2 按载体
  // 138 粉判了奶龙 IP 方权重、magnitude D 档按「仅个别人提及」判。三处防线源码锚：
  // ①event_magnitude A 类找角度锚 ②dimension2 A 类同款 ③state builder PRECOMPUTED
  // 载体数据消毒行（C74 时效分桶产物顶着「直接采信」帽子污染判断现场）
  {
    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    const qsSrc = readFileSync(join(__dirname, '../src/narrative/analyzer/llm/jev-questions.mjs'), 'utf8');
    const sbSrc = readFileSync(join(__dirname, '../src/narrative/analyzer/llm/jev-state-builder.mjs'), 'utf8');
    check('A10a event_subject_entity 题退役反证（J1.83/C141）：题集无此键；主体实体分类钩子随题删除（母公司影响力≠产品接纳判据已迁 event_fit unfit 桶）',
      qs.event_subject_entity === undefined
      && qs.bsc_meme_user_event_fit.criteria.unfit.includes('华为发布麒麟芯片≠链上用户接纳麒麟'), null);
    check('A10c state builder PRECOMPUTED 消毒行：tweet_type_note 划定载体数据用途边界（仅时效分桶）',
      sbSrc.includes('tweet_type_note:') && sbSrc.includes('不是事件传播数据') && sbSrc.includes('J1.20形状②/J1.46'),
      '缺消毒行');
    check('A10d 源码版本常量与模块导出一致（防只 bump 文件头注释不 bump 常量的漂移；J1.121=C190 混混猫案实体题补专名即实体锚（用户裁定「not_entity 是『不是实体』，自创社区 mascot 名也是实体名字，不应该因为这个理由拦截；看的是性质，所以退役了 new_entity 门」：名字被用作特定主体称谓/专名（社区名/mascot 名/角色名/外号，「XX社区」式搭配在场）即映射该主体按类型轴评，无论自创/知名/语料是否陈述命名行为；not_entity 只留给泛称词无专名搭配+无 C174 命名故事陈述；mapper 零改动）；J1.120=C189 全量回归六裁定批（C96 币安上电视追裁「先实体门再 phrase 门，要不被实体拒绝要不被口号拒绝」：事件陈述句名=口号类落词句题按三因素评（J1.118 归实体门域措辞修正）+事件承载臂重要度门槛（民族级/全球级重大事件才够格，平台级/媒体级露出不够——用户裁定「事件的重要度明显不够」）+ip_reuse 原生热点锚（C129 彪弟案：原生热点梗/人物主体自身代币化不选本项，复用=反复换皮多处收割）+mapper 恢复词句门拦截）；J1.119=C188 ①有来由补事件承载臂（影响力巨大/情感触动极强的事件本身承载口号——中国人能飞箭体五大字）；J1.118=C188 事件陈述臂退役（币安上电视=具体事件形状归实体门域，词句题不先验拦）+J1.117=C188 主体符号锚（こんにちは 对日本群体喊话非客套）；J1.117=C187 对拍修复：词句题②臂补主体符号锚（C126 何一こんにちは正样本被「礼貌套话」臂误伤翻面，①②打架消除）；J1.116=C187 词句题三因素重构（①有来由门槛：普通用户喊的口号不能接纳 ②有感染力：Early 有/我要去滑雪无 ③名字形态；CRO 判例翻案=机构职位缩写臂退役）；J1.115=C186 演绎题 image_depicts_name 同域非演绎反锚（ATM 案）；J1.114=C185 实体题题面精炼（去重：类型清单/认知度判据/C151/C162 各归单一宿主，判据轴不变）；J1.113=C184 实体题类型轴重构 unknown 断代 unacceptable_type+new_entity 删桶+门恢复拦截；J1.112=C183 web3_user_* 全族键名断代 bsc_meme_user_*+评估主体收窄 BSC meme 币用户；J1.111=C181b veto 题事件层优先划界；J1.110=C181 键名断代 event_quality_veto → web3_user_event_impact+empty_content 无名口号臂；J1.109=C179 豁免挪判轴级+残留噪声清理；J1.108=C178 宣告采信豁免措辞强化+删 semantic 残留句；J1.107=W 吸引力题三桶；J1.106=C175b 双锚边界收口；J1.105=C175 实体性质定义锚+fit 事件分量锚）',
      qsSrc.includes("JEV_QUESTIONS_VERSION = 'J1.138'"), 'J1.122 常量缺失');

    // A11 J1.84（C142 W 数学双轴合并单轴）锚句锁定：
    // w_product_score 整题退役（与 appeal 语义/统计双重重叠；旧 C42 形态词锁随题
    // 删除）；w_bsc_user_appeal 0-40→0-75 四带、语义档位不变；W 数学单轴=
    // 吸引力+时效、pass 57。圈层可达性锚句 J1.82/C140 随桶退役迁 unfit 档
    // （桶不再提供，锚句防漂移断言改指新宿主）
    {
      const wa = qs.bsc_meme_user_web3_project_acceptance_and_impact;
      check('A11a w_product_score 题退役（J1.84/C142 双轴合并；题集不再提供）',
        qs.w_product_score === undefined, Object.keys(qs));
      check('A11b bsc_meme_user_web3_project_acceptance_and_impact Choice 三桶（J1.107 立弱/中/强；J1.125/C230 键名断代 w_bsc_user_appeal → 本键 + 发布者影响力资格轴并入；J1.129/C233 桶 id 断代 low/mid/high 与评级词汇统一；J1.130/C234 资格轴两形态判据——low 桶含「资格不合格」+「形态一项目 Dev 完全无名」）',
        wa?.type === 'choice' && Object.keys(wa.criteria).length === 3
        && wa.criteria.low.includes('资格不合格') && wa.criteria.low.includes('形态一项目 Dev 完全无名')
        && wa.criteria.mid.includes('资格过线')
        && wa.criteria.high.includes('资格过线')
        && wa.instructions.includes('低/中/高三档'),
        wa?.criteria);
      // J1.82/C140（并行会话同批）：圈层可达性桶退役——判据并入 web3_user_event_fit
      // unfit 档（圈外亚文化 get 不到梗=unfit；crypto 圈内口径；品牌营销边界句随迁）
      check('A11c 圈层可达性桶退役反证（J1.82/C140 并入 event_fit unfit 档）',
        qs.bsc_meme_user_event_impact.criteria.token_circle_reachability === undefined
        && qs.bsc_meme_user_event_fit.criteria.unfit.includes('圈外')
        && qs.bsc_meme_user_event_fit.criteria.unfit.includes('品牌营销物料'), null);
      // A11c2 品牌营销边界（C110 币安菠萝 A/B 归因：不加此界=gimmick argmax
      // 100%→47%，币安品牌物料被当圈内梗放行）
      check('A11c2 品牌营销边界句迁址（J1.82/C140：社区自发梗≠品牌物料随 unfit 档承接）',
        qs.bsc_meme_user_event_fit.criteria.unfit.includes('品牌营销物料'), null);
      // 源码口径断言（BLOCK_SCOPE 模块私有未导出，A10d 同款先例；注意 BLOCK_SCOPE
      // 在 mapper 文件非题集文件——qsSrc 是题集文件源码）：
      const mapperSrc = readFileSync(join(__dirname, '../src/narrative/analyzer/llm/jev-result-mapper.mjs'), 'utf8');
      const scopeMatch = mapperSrc.match(/BLOCK_SCOPE = \{[\s\S]*?\n\};/);
      check('A11d BLOCK_SCOPE.token_circle_reachability 空域退役（J1.82/C140：\[\] 显式空域——J1.43 先例；拦截责任并入 unfit 全域概率门）',
        !!scopeMatch && /token_circle_reachability:\s*\[\],/.test(scopeMatch[0]) && /niche_subculture:\s*\[\],/.test(scopeMatch[0]),
        'mapper BLOCK_SCOPE 圈层可达性行非空域');
      // marginal 圈外臂删除（逃逸洞封死：原圈外落 marginal 不拦 → J1.82 起判 unfit；
      // 不删此臂=圈外票继续落 marginal 逃逸，删桶白删）
      check('A11e marginal 圈外臂删除（收窄为圈内能 get 但玩味空间有限；圈外=unfit 划界句在场）',
        qs.bsc_meme_user_event_fit.criteria.marginal.includes('圈内能 get')
        && qs.bsc_meme_user_event_fit.criteria.marginal.includes('get 不到梗=unfit')
        && !qs.bsc_meme_user_event_fit.criteria.marginal.includes('不重叠的小众领域'),
        qs.bsc_meme_user_event_fit.criteria.marginal.slice(0, 160));

      // A12 J1.53（C122 门名断代，零行为意图）：题键/桶键改名——name_form →
      // web3_user_name_acceptability、niche_subculture → token_circle_reachability。
      // 断言：①题集新键在场且旧键不提供 ②mapper 双键读（旧键=存量缓存行/旧
      // fixture 兼容）③新键行为=旧键（拦/放同语义）④新桶域内拦、域外不拦
      {
        check('A12a 题集题键=web3_user_phrase_acceptability（J1.81 由 web3_user_name_acceptability 改名；旧 name_form 不再提供）',
          qs.bsc_meme_user_phrase_acceptability != null && qs.web3_user_name_acceptability === undefined && qs.name_form === undefined,
          Object.keys(qs).filter(k => k.includes('accept') || k.includes('name')));
        check('A12b 题集桶键 J1.82/C140 退役反证（token_circle_reachability/niche_subcultuab 双不存在；label 保留防 fallback 裸键名）',
          qs.bsc_meme_user_event_impact.criteria.token_circle_reachability === undefined
          && qs.bsc_meme_user_event_impact.criteria.niche_subculture === undefined,
          Object.keys(qs.bsc_meme_user_event_impact.criteria));
        // 新键行为=旧键（拦）
        const aNew = baseAnswers();
        aNew.web3_user_name_acceptability = { choice: 'web3_user_not_acceptable', probabilities: { web3_user_not_acceptable: 0.8 } };
        delete aNew.name_form;
        // J1.81：词句门只评 not_entity 形状——fixture 实体切 not_entity（accepted 0.9 会被实体票分流跳过）
        aNew.web3_user_name_entity_acceptance = { choice: 'not_entity', probabilities: { not_entity: 0.9 } };
        const rNew = mapStandardAnswers(aNew, stdCtx('TST', 'TST'));
        check('A12c 新题键 web3_user_not_acceptable → 拦（C189 恢复）+ 审计 choice 照落',
          /Web3 用户不接纳该名字/.test(rNew.llmResult.reason || '')
            && rNew.stage2DataToSave.parsed_output.jev.web3UserAcceptabilityBlock?.choice === 'web3_user_not_acceptable',
          rNew.llmResult.reason);
        // 旧键判定值仍照算（存量缓存行/fixture 兼容，C189 恢复照拦）
        const aOld = baseAnswers();
        aOld.name_form = { choice: 'not_meme_name', probabilities: { not_meme_name: 0.8 } };
        delete aOld.web3_user_name_acceptability;
        // J1.81：J1.50 时代旧行无实体题答案（J1.56 才立题）——删键重放（缺失→照评）
        delete aOld.web3_user_name_entity_acceptance;
        const rOld = mapStandardAnswers(aOld, stdCtx('TST', 'TST'));
        check('A12d 旧题键 name_form 判定值照算照拦（C189 恢复；断代兼容读不变）',
          /Web3 用户不接纳该名字/.test(rOld.llmResult.reason || '')
            && rOld.stage2DataToSave.parsed_output.jev.web3UserAcceptabilityBlock?.choice === 'not_meme_name',
          rOld.llmResult.reason);
        // J1.82/C140：圈层不可达=unfit 档（全域概率门 web3UnfitBlock，unfit≥0.5 拦）
        // ——原 A 域 argmax 桶语义升级全域；B 域不拦语义随之消失（拦截面扩大=刻意）
        const aBucket = baseAnswers();
        aBucket.event_category = { choice: 'A', probabilities: { A: 0.8 } };
        aBucket.web3_user_event_fit = { choice: 'unfit', probabilities: { unfit: 0.62, marginal: 0.2 } };
        const rBucket = mapStandardAnswers(aBucket, stdCtx('TST', 'TST'));
        check('A12e 圈层不可达形状（unfit 0.62）A 域拦（J1.82/C140 并入 unfit 负门，label=Web3用户偏好不合）',
          rBucket.llmResult.rating === 'low' && (rBucket.llmResult.reason || '').includes('BSC meme 用户偏好不合'),
          rBucket.llmResult.reason);
        const bBucket = baseAnswers();
        bBucket.event_category = { choice: 'B', probabilities: { B: 0.8 } };
        bBucket.web3_user_event_fit = { choice: 'unfit', probabilities: { unfit: 0.62, marginal: 0.2 } };
        const rBucketB = mapStandardAnswers(bBucket, stdCtx('TST', 'TST'));
        check('A12f unfit 全域（B 类同形状同拦——原 A-only 圈层桶语义升级，拦截面扩大=刻意）',
          rBucketB.llmResult.rating === 'low' && (rBucketB.llmResult.reason || '').includes('BSC meme 用户偏好不合'),
          rBucketB.llmResult.reason);
        check('A12g 审计键改名（stage1 web3UserAcceptability / stage2 web3UserAcceptabilityBlock，旧名不落）',
          rNew.stage1DataToSave.parsed_output.jev.web3UserAcceptability === 'web3_user_not_acceptable'
          && rNew.stage1DataToSave.parsed_output.jev.nameForm === undefined
          && rNew.stage2DataToSave.parsed_output.jev.web3UserAcceptabilityBlock?.choice === 'web3_user_not_acceptable',
          rNew.stage1DataToSave.parsed_output.jev.web3UserAcceptability);
      }

      // A13 J1.55（C123 门名/题键语义化，零判据改动）：event_magnitude →
      // web3_user_event_impact、dimension2 → web3_user_event_spread + 门函数/审计键改名。
      // 断代兼容红线：mapper 双读（旧形状 answers 结果与新形状逐位一致）。
      {
        check('A13a 事件价值题键收敛：web3_user_event_impact 复活为 choice 否决题（J1.110，事件分源仍是 fit 唯一）；event_magnitude/dimension2 缺席',
          qs.bsc_meme_user_event_impact?.type === 'choice'
          && qs.bsc_meme_user_event_fit?.type === 'choice'
          && qs.web3_user_event_spread === undefined
          && qs.event_magnitude === undefined && qs.dimension2 === undefined,
          Object.keys(qs).filter(k => k.includes('impact') || k.includes('spread') || k.includes('magnitude') || k.includes('dimension') || k.includes('fit')));
        check('A13b 主体判定规则自洽（event_subject_entity 已退役 J1.83；事件价值由 fit 题声明——产品实体判据并入 unfit 桶）',
          qs.event_subject_entity === undefined
          && qs.bsc_meme_user_event_fit.instructions.includes('标准路径的事件价值题'),
          null);
        // 单源等价：旧形状事件题（magnitude/dim2）与 impact 形状同 fit → 评分/tier 逐位全等
        const oldShape = baseAnswers();
        const newShape = { ...baseAnswers() };
        newShape.web3_user_event_impact = oldShape.event_magnitude;
        delete newShape.event_magnitude;
        delete newShape.dimension2;
        const rOldShape = mapStandardAnswers(oldShape, stdCtx('TST', 'TST'));
        const rNewShape = mapStandardAnswers(newShape, stdCtx('TST', 'TST'));
        const s2Old = rOldShape.stage2DataToSave.parsed_output;
        const s2New = rNewShape.stage2DataToSave.parsed_output;
        check('A13c fit 单源：旧事件题（magnitude/dim2/impact）不参与标准事件分——同 fit → 评级/事件分/档位全等',
          rOldShape.llmResult.rating === rNewShape.llmResult.rating
          && s2Old.scoringResult.eventCompositeScore === s2New.scoringResult.eventCompositeScore
          && s2Old.jev.jevImpactTier === s2New.jev.jevImpactTier,
          { old: s2Old.scoringResult, new: s2New.scoringResult });
        // 审计键新名落、旧名不落（mapper 只写新键）
        const s1j = rNewShape.stage1DataToSave.parsed_output.jev;
        check('A13d P1 审计键改名：jevImpactTier/effectiveImpactTier/effectiveTiming/anchoredTier/web3FitAnchoredTier 在场，旧名缺席',
          s1j.jevImpactTier != null && s1j.effectiveImpactTier != null && s1j.effectiveTiming != null
          && s1j.magnitudeTier === undefined && s1j.timing === undefined
          && s1j.tierAnchored === undefined && s1j.web3FitAnchored === undefined,
          Object.keys(s1j));
        check('A13e P1 审计键值形态：anchoredTier=原判档位字符串（非布尔）；effectiveImpactTier=锚后档',
          s1j.anchoredTier === null || typeof s1j.anchoredTier === 'string',
          s1j.anchoredTier);
        check('A13f 概率键/评分键：stage1 概率键=fit（impact/event_magnitude 缺席）；J1.71 后 scoringResult 无 spreadScore/dimension2',
          s1j.probabilities.bsc_meme_user_event_fit != null
          && s1j.probabilities.event_magnitude === undefined
          && s2New.jev.probabilities.web3_user_event_spread === undefined && s2New.jev.probabilities.dimension2 === undefined
          && s2New.scoringResult.spreadScore === undefined && s2New.scoringResult.dimension2 === undefined,
          { s1: Object.keys(s1j.probabilities), s2: Object.keys(s2New.jev.probabilities) });
        check('A13g 折损审计键改名：web3UnfitMass 恒落（可 null）、web3FitMass 缺席',
          'web3UnfitMass' in s2New.jev && s2New.jev.web3FitMass === undefined,
          Object.keys(s2New.jev).filter(k => k.toLowerCase().includes('fitmass')));
        // E 类 + web3_user_event_fit 正向质量<0.5 → Web3偏好折损（原感染力折损）
        const eAns = baseAnswers();
        eAns.event_category = { choice: 'E', probabilities: { E: 0.9 } };
        // fit 0.4 → influenceScore 2 → tier C（避开 D/E 档量级门先手拦截），fitMass<0.5 触折损。
        // J1.83/C141 后非豁免低 fit 票被契合证据门先拦（折损臂收窄为豁免路径）——
        // 币安语料豁免新门，保折损路径可达（断言语义：折损数学对豁免票照常工作）
        eAns.web3_user_event_fit = { choice: 'fit', probabilities: { fit: 0.4, marginal: 0.5, unfit: 0.1 } };
        const rE = mapStandardAnswers(eAns, stdCtx('币安折损', '币安折损'));
        const s2E = rE.stage2DataToSave.parsed_output;
        check('A13h E 类折损改名：reason 含「Web3偏好折损」、web3FitDamp.coef=0.5、旧 resonanceDamp 缺席',
          String(s2E.reason).includes('Web3偏好折损')
          && s2E.jev.web3FitDamp?.coef === 0.5
          && s2E.jev.resonanceDamp === undefined
          && !String(s2E.reason).includes('感染力折损'),
          s2E.reason);
        // B 类传播轴锚审计键改名
        const bAns = baseAnswers();
        bAns.event_category = { choice: 'B', probabilities: { B: 0.9 } };
        bAns.event_magnitude = { score: 1.5, probabilities: { '1': 0.8 } };
        bAns.dimension2 = { score: 1, probabilities: { '1': 0.8 } };
        const rB = mapStandardAnswers(bAns, stdCtx('TST', 'TST'));
        const s2B = rB.stage2DataToSave.parsed_output;
        check('A13i J1.79 fit 派生 tier 后 B 类偏好锚结构性不可达（strong_fit≥0.5 ⇒ tier≥B）：高 fit→tier S/floor null；旧传播锚键缺席',
          s2B.scoringResult.influenceFloor === null
          && s2B.scoringResult.influenceTier === 'S'
          && s2B.jev.web3FitSpreadAnchor === undefined
          && s2B.jev.web3FitDim2Anchor === undefined
          && s2B.jev.instagramDim2Anchor === undefined,
          { floor: s2B.scoringResult.influenceFloor, tier: s2B.scoringResult.influenceTier, keys: Object.keys(s2B.jev).filter(k => k.includes('Spread') || k.includes('Dim2')) });
        // 源码口径：门函数/常量改名（防回潮）
        const mapperSrc2 = readFileSync(join(__dirname, '../src/narrative/analyzer/llm/jev-result-mapper.mjs'), 'utf8');
        check('A13j 门函数/常量源码口径（web3UserAcceptabilityBlock/Choice、WEB3_USER_NOT_ACCEPTABLE_CHOICES、web3UnfitBlock、WEB3_FIT_DAMP_COEF；J1.56 骑乘改道退役）',
          /function web3UserAcceptabilityBlock\(answers\)/.test(mapperSrc2)
          && /function web3UserAcceptabilityChoice\(answers\)/.test(mapperSrc2)
          && /WEB3_USER_NOT_ACCEPTABLE_CHOICES = new Set\(/.test(mapperSrc2)
          && /function web3UnfitBlock\(answers\)/.test(mapperSrc2)
          && /WEB3_FIT_DAMP_COEF = 0\.5/.test(mapperSrc2)
          && !/function notMemeNameBlock/.test(mapperSrc2)
          && !/function nameFormChoice/.test(mapperSrc2)
          && !/function rideDetourMass\(answers, category\)/.test(mapperSrc2)
          && !/function rideDetourBelow/.test(mapperSrc2),
          null);
      }

      // A14 J1.56（C126）实体接受度轴：币名映射实体 + 实体在 web3 用户侧的
      // 接受度/影响力；作者身份不升档（原话票由代码侧 authorUtterance 承担）；
      // no_entity 中性（问候语/截词不拦）；发布者指代/官方口号/配图形象保留。
      {
        const nr = qs.bsc_meme_user_name_entity_acceptance;
        check('A14a 主轴=实体类型/性质（J1.113/C184：不评认知度/知名度/影响力——知晓由事件+关联度保证；非事件热度/陈述者量级/大众知名度）',
          nr.instructions.includes('币名映射实体的类型/性质能否被 BSC meme 币用户接纳为 meme 币名')
          && nr.instructions.includes('只看实体的类型/性质')
          && nr.instructions.includes('不评认知度/知名度/影响力')
          && nr.instructions.includes('知晓由事件与关联度保证')
          && nr.instructions.includes('不是事件整体热度')
          && nr.instructions.includes('也不是大众媒体知名度'),
          nr.instructions.slice(0, 120));
        check('A14b accepted=类型可接纳实体（性质没问题即可、新旧不是维度；不评认知度；著名不救类型不合）',
          nr.criteria.accepted.includes('类型/性质可被 BSC meme 币用户接纳为 meme 币名')
          && nr.criteria.accepted.includes('新旧不是维度，认知度不是判据')
          && nr.instructions.includes('著名只让类型更明确，不改变类型不可接纳'),
          nr.criteria.accepted.slice(0, 160));
        check('A14c 保留：发布者指代 + 官方口号/品牌主张（货币自由）',
          nr.instructions.includes('领域知名发布者的独立新产品')
          && nr.instructions.includes('官方口号')
          && nr.instructions.includes('货币自由'),
          null);
        check('A14d unacceptable_type=类型轴拦截桶（J1.113/C184：圈外品牌/银行/犬种学名例证锚——C183-C187 五案票；判据=类型不合非认知度、再著名不救）',
          nr.criteria.unacceptable_type.includes('圈外商业品牌/消费品（可乐、快狗打车）')
          && nr.criteria.unacceptable_type.includes('金融机构/银行（浙商银行）')
          && nr.criteria.unacceptable_type.includes('犬种学名 TAIGAN')
          && nr.criteria.unacceptable_type.includes('判据=类型/性质不合，不是认知度')
          && nr.criteria.unacceptable_type.includes('实体再著名也不改变类型不可接纳')
          && !('unknown' in nr.criteria) && !('new_entity' in nr.criteria),
          nr.criteria.unacceptable_type.slice(0, 160));
        check('A14e not_entity 中性（J1.81 断代改名；问候语/截词/陈述句）+ 词句形态责任移交 phrase 题',
          nr.criteria.not_entity.includes('中性')
          && nr.criteria.not_entity.includes('问候语')
          && nr.criteria.not_entity.includes('bsc_meme_user_phrase_acceptability'),
          nr.criteria.not_entity.slice(0, 160));
        check('A14f 作者身份不升档（C126 红线）+ 配图形象映射源保留',
          nr.instructions.includes('作者身份本身不是映射')
          && nr.instructions.includes('不得因作者是超级 IP 而升档')
          && nr.instructions.includes('配图中真实出现的形象'),
          null);
      }
    }
  }

  // ═══ B. 融合关联分 ═══
  console.log('\n── B. 融合关联分（RELEVANCE_FUSED_SCORES 单值直查）──');
  const fusedScores = { exact_match: 20, translation_match: 18, abbreviation_alias: 17, semantic_clear: 13, semantic_weak: 9, cultural_rich: 12, cultural_thin: 3, generic_concept: 5, none: 0 };
  for (const [bin, want] of Object.entries(fusedScores)) {
    const a = baseAnswers();
    a.name_event_relevance = { choice: bin, probabilities: { [bin]: 0.8 } };
    const r = mapStandardAnswers(a, stdCtx('TST', 'TST'));
    const rs = r.stage3DataToSave?.parsed_output?.relevanceScore;
    check(`B ${bin} → ${want}`, rs === want, { rs, reason: r.llmResult.reason });
  }
  // reason 模板：融合形状无 lv 段
  const aClear = baseAnswers();
  aClear.name_event_relevance = { choice: 'semantic_clear', probabilities: { semantic_clear: 0.8 } };
  aClear.token_name_quality = { score: 3, probabilities: {} };
  const rClear = mapStandardAnswers(aClear, stdCtx('TST', 'TST'));
  check('B10 reason 模板融合形状：关联13(semantic_clear) 无 lv 段 + 质量(长8+名10)',
    (rClear.llmResult.reason || '').includes('关联13(semantic_clear)') && (rClear.llmResult.reason || '').includes('质量18(长8+名10)'),
    rClear.llmResult.reason);
  // 截断线两侧：weak 9 仍被关联截断拦；clear 13 不因截断拦
  const aWeak = baseAnswers();
  aWeak.name_event_relevance = { choice: 'semantic_weak', probabilities: { semantic_weak: 0.8 } };
  const rWeak = mapStandardAnswers(aWeak, stdCtx('TST', 'TST'));
  check('B11 semantic_weak 9 ≤10 → 关联性不足截断（对齐旧 lv0-1）',
    rWeak.llmResult.rating === 'low' && (rWeak.llmResult.reason || '').includes('关联性不足'), rWeak.llmResult.reason);
  check('B12 semantic_clear 13 >10 → 不因截断拦（对齐旧 lv2-4）',
    rClear.llmResult.rating !== 'low' || !(rClear.llmResult.reason || '').includes('关联性不足'), rClear.llmResult.reason);
  // none=0 锚：保 imgNameExempt relevance.score>0 语义
  const aNone = baseAnswers();
  aNone.name_event_relevance = { choice: 'none', probabilities: { none: 0.8 } };
  const rNone = mapStandardAnswers(aNone, stdCtx('TST', 'TST'));
  check('B13 none → 0 分（旧 lv0 同语义，截断线内）',
    rNone.stage3DataToSave.parsed_output.relevanceScore === 0
    && rNone.llmResult.rating === 'low' && (rNone.llmResult.reason || '').includes('关联性不足'), rNone.llmResult.reason);

  // ═══ C. legacy 关联形状 bit 不变 ═══
  console.log('\n── C. legacy 关联形状（旧桶名+relevance_level 查表原样）──');
  // levelIdx=round(level) 钳 0-4 直查 RELEVANCE_TABLE（旧代码口径）
  const legacyCases = [
    // [type, levelScore, wantScore, wantLv]
    ['semantic', 2.6, 15, 3],
    ['semantic', 0.4, 8, 0],
    ['cultural', 3.5, 15, 4],
    ['exact_match', 1, 20, 1],
    ['generic_concept', 2.4, 6, 2],
    // 同名桶防劫持反证：这三桶新旧表分值不同，legacy 形状必须走旧表
    ['abbreviation_alias', 0, 16, 0], // 融合表 17——旧形状不得被劫持
    ['none', 4, 2, 4],                // 融合表 0——旧形状不得被劫持
  ];
  for (const [type, lv, wantScore, wantLv] of legacyCases) {
    const a = baseAnswers();
    a.name_event_relevance = { choice: type, probabilities: { [type]: 0.8 } };
    a.relevance_level = { score: lv, probabilities: {} };
    a.token_name_quality = undefined; // legacy 形状不带新题
    const r = mapStandardAnswers(a, stdCtx('TST', 'TST'));
    const j = r.stage3DataToSave?.parsed_output;
    const okScore = j?.relevanceScore === wantScore;
    const okLv = j?.jev?.relevanceLevelIdx === wantLv;
    check(`C ${type}/lv${lv} → ${wantScore}(lv${wantLv})`, okScore && okLv, { score: j?.relevanceScore, lv: j?.jev?.relevanceLevelIdx });
  }

  // ═══ D. token_name_quality 映射 + legacy 双题 bit 不变 ═══
  console.log('\n── D. token_name_quality（band 索引 0-3 → 联合量纲 0-12）──');
  const tqCases = [[0, 0], [1, 3], [2, 6], [3, 10], [2.5, 7.5], [0.5, 1]];
  for (const [score, want] of tqCases) {
    const a = baseAnswers();
    a.name_event_relevance = { choice: 'exact_match', probabilities: { exact_match: 0.8 } };
    a.token_name_quality = { score, probabilities: {} };
    const r = mapStandardAnswers(a, stdCtx('TST', 'TST'));
    const j = r.stage3DataToSave.parsed_output;
    // TST 1 词 → length 8；total = 8 + want
    check(`D token_name_quality ${score} → 名${want}（total=${8 + want}）`,
      j.jev === undefined || (j.breakdown.name === want && j.qualityScore === 8 + want && j.breakdown.spelling === null),
      { name: j.breakdown?.name, total: j.qualityScore });
  }
  // legacy 双题：spelling 6.5 → band[3] 6.5；reasonability 4.5 → band[2] 4.5
  const aLeg = baseAnswers();
  aLeg.name_event_relevance = { choice: 'exact_match', probabilities: { exact_match: 0.8 } };
  aLeg.quality_spelling = { score: 6.5, probabilities: {} };
  aLeg.quality_reasonability = { score: 4.5, probabilities: {} };
  const rLeg = mapStandardAnswers(aLeg, stdCtx('TST', 'TST'));
  const jLeg = rLeg.stage3DataToSave.parsed_output;
  check('D7 legacy 拼合双题 bit 不变（拼6.5+合4.5，total=19，name=null）',
    jLeg.qualityScore === 19 && jLeg.breakdown.spelling === 6.5 && jLeg.breakdown.reasonability === 4.5 && jLeg.breakdown.name === null,
    jLeg.breakdown);
  check('D8 legacy reason 模板保持 长+拼+合 原样',
    (rLeg.llmResult.reason || '').includes('质量19(长8+拼6.5+合4.5)'), rLeg.llmResult.reason);

  // ═══ E. C88 relPositiveMass 融合桶求和 ═══
  console.log('\n── E. C88 五腿·关联腿融合桶名──');
  function c88Answers(relProbs) {
    const a = baseAnswers();
    a.name_event_relevance = { choice: Object.keys(relProbs)[0], probabilities: relProbs };
    a.web3_user_name_entity_acceptance = { choice: 'accepted', probabilities: { accepted: 0.8, unknown: 0.15 } };
    a.name_entity_memeability = { score: 3, probabilities: {} };
    a.web3_user_event_fit = { choice: 'strong_fit', probabilities: { strong_fit: 0.8, fit: 0.1 } };
    a.event_timing = { choice: 'within_7d', probabilities: { within_7d: 0.9 } };
    return a;
  }
  // 新桶全量形状：semantic_clear 0.35 + cultural_rich 0.2 → relPositive 0.55
  const rNew = mapStandardAnswers(c88Answers({ semantic_clear: 0.35, cultural_rich: 0.2, none: 0.3 }), stdCtx('暗号', '暗号資産の覹者'));
  const s2New = rNew.stage2DataToSave.parsed_output.jev.recognizedEntitySlogan;
  check('E1 新桶名求和：relPositive=0.55（semantic_clear+cultural_rich）→ 五腿 hit',
    s2New.hit === true && s2New.relPositive === 0.55, s2New);
  // 旧桶名 legacy 形状照 hit（求和保留旧名防回放工具）
  const rOld = mapStandardAnswers(c88Answers({ semantic: 0.35, cultural: 0.2, none: 0.3 }), stdCtx('暗号', '暗号資産の覹者'));
  const s2Old = rOld.stage2DataToSave.parsed_output.jev.recognizedEntitySlogan;
  check('E2 旧桶名照求和（legacy 形状 bit 不变）', s2Old.hit === true && s2Old.relPositive === 0.55, s2Old);
  // 薄关联不救：thin 0.35 不足以过 mem 腿以外的五腿（relPositive 0.35≥0.3 但 none 0.65 主导 → relNoneMass 0.65 ≥0.5 断腿）
  const rThin = mapStandardAnswers(c88Answers({ cultural_thin: 0.35, none: 0.65 }), stdCtx('TST', 'TST'));
  const s2Thin = rThin.stage2DataToSave.parsed_output.jev.recognizedEntitySlogan;
  check('E3 none 主导（0.65≥0.5）→ 五腿断（relNone 腿锁死）', s2Thin.hit === false, s2Thin);

  // ═══ F. J1.83 契合证据门（前身=J1.27 产品实体门，C141 一般化）═══
  console.log('\n── F. J1.83 契合证据门（se 标注退役、fitMass 驱动全域拦）──');
  function peAnswers(se) {
    const a = baseAnswers();
    a.event_subject_entity = { choice: se, probabilities: { [se]: 0.7 } };
    // marginal 主导：unfit=0 不触 J1.19 负门，fitMass=strong_fit+fit=0.2<0.5 → J1.83 拦
    a.web3_user_event_fit = { choice: 'marginal', probabilities: { marginal: 0.6, fit: 0.2 } };
    return a;
  }
  // C141 行为锁定：拦截不再由 se 标注驱动（旧 other_entity 放行形状翻转），
  // 四形状统一落「Web3用户契合证据不足(J1.83)」——题退役后 se 键只是存量行残留
  for (const se of ['product_entity', 'product_functional', 'product_character', 'other_entity']) {
    const r = mapStandardAnswers(peAnswers(se), stdCtx('TST', 'TST'));
    const blocked = r.llmResult.rating === 'low' && (r.llmResult.reason || '').includes('Web3用户契合证据不足(J1.83)');
    check(`F ${se} → 拦（fitMass 20%<50%，se 零参与）`, blocked, r.llmResult.reason);
  }
  // 对照：fitMass 过线（sf+fit=70%）other_entity 形状照放（门只看 fitMass）
  {
    const a = peAnswers('other_entity');
    a.web3_user_event_fit = { choice: 'strong_fit', probabilities: { strong_fit: 0.6, fit: 0.1, marginal: 0.25 } };
    const r = mapStandardAnswers(a, stdCtx('TST', 'TST'));
    check('F5 对照：fitMass 70% 过线放行（无 se 标注不拦）',
      !(r.llmResult.reason || '').includes('Web3用户契合证据不足'), r.llmResult.reason);
  }

  // ═══ G. 退役阻断桶空域 ═══
  console.log('\n── G. 退役阻断桶（regional_event/subject_unqualified 空域不拦）──');
  for (const [bin, cat] of [['subject_unqualified', 'C'], ['subject_unqualified', 'D'], ['regional_event', 'E']]) {
    const a = baseAnswers();
    a.event_category = { choice: cat, probabilities: { [cat]: 0.7 } };
    a.event_quality_veto = { choice: bin, probabilities: { [bin]: 0.55, none: 0.4 } }; // 旧形状域内拦截实测档位
    const r = mapStandardAnswers(a, stdCtx('TST', 'TST'));
    check(`G ${bin}+${cat}（旧形状原拦）→ 退役后不再拦`, r.llmResult.rating !== 'low' || !(r.llmResult.reason || '').includes('阻断:'),
      r.llmResult.reason);
  }
  // 对照：活桶照拦（event_empty_content 全域）
  const aEc = baseAnswers();
  aEc.event_quality_veto = { choice: 'event_empty_content', probabilities: { event_empty_content: 0.55, none: 0.4 } };
  const rEc = mapStandardAnswers(aEc, stdCtx('TST', 'TST'));
  check('G4 活桶对照：event_empty_content 照拦（删除不外溢）',
    rEc.llmResult.rating === 'low' && (rEc.llmResult.reason || '').includes('空洞内容'), rEc.llmResult.reason);

  // ═══ G5. J1.82 键名断代双键读（C123 改名先例：旧行 bit 不变防线）═══
  // 存量 token_narrative 行仍是旧键 event_token_block_reason——blockAnswers 归一
  // 后旧键行必须与新键行判读 bit 一致（否则 J1.82 上线后未重析行拦截丢失）
  const aOldKey = baseAnswers();
  delete aOldKey.event_quality_veto; // 存量旧行无新键（有新键时归一新键优先）
  aOldKey.event_token_block_reason = { choice: 'event_empty_content', probabilities: { event_empty_content: 0.55, none: 0.4 } };
  const rOldKey = mapStandardAnswers(aOldKey, stdCtx('TST', 'TST'));
  check('G5 旧键行（event_token_block_reason）照拦=双键归一生效',
    rOldKey.llmResult.rating === 'low' && (rOldKey.llmResult.reason || '').includes('空洞内容')
    && rOldKey.llmResult.reason === rEc.llmResult.reason, rOldKey.llmResult.reason);

  // ═══ 汇总 ═══
  console.log(`\n══════ _test_jev_question_consolidation: ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('单测异常:', e); process.exit(1); });
