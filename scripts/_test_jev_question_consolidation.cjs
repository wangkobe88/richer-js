#!/usr/bin/env node
/**
 * C109 题集收敛（J1.43）——本地零 DB 单测（2026-10-19 交易猫 0xc929…7777 案）
 *
 * 收敛清单（用户裁定「合并题/桶」）：
 *   - relevance_type+relevance_level 两题合一（9 融合桶，分值 RELEVANCE_FUSED_SCORES）
 *   - quality_spelling+quality_reasonability 合并 token_quality（band 索引 0-3）
 *   - name_referent 6→3（other_referent 并四桶+配图形象指代源）
 *   - subject_entity 8→2（product_entity/other_entity，J1.27 兼容集）
 *   - block_reason 删 regional_event（死桶 0 拦截）/subject_unqualified（三重冗余）
 *   - subject_carrier 锚修正（M1 图证覆盖在 _test_subject_carrier.cjs H 段）
 *
 * 覆盖：
 *   A. 问卷形状：16 题/桶数/版本 J1.43/旧题不存在
 *   B. 融合关联分：9 桶精确分值 + reason 模板无 lv 段 + 截断线两侧（weak 9 拦/clear 13 过）
 *   C. legacy 关联形状 bit 不变（semantic/lv 查表原样）
 *   D. token_quality 四档映射 + legacy 双题路径 bit 不变
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
    block_reason: { choice: 'none', probabilities: { none: 0.92 } },
    name_referent: { choice: 'super_ip', probabilities: { super_ip: 0.9, subject_self: 0.08 } },
    referent_memeability: { score: 3, probabilities: {} },
    web3_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.85, fit: 0.1 } },
    subject_entity: { choice: 'other_entity', probabilities: { other_entity: 0.7 } },
    subject_carrier: { choice: 'existing_entity', probabilities: { existing_entity: 0.8 } },
    name_form: { choice: 'meme_name', probabilities: { meme_name: 0.85 } },
    finding_vs_recap: { choice: 'new_finding', probabilities: { new_finding: 0.8 } },
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
  check('A1 版本 J1.53（J1.54=C123 门名/题键语义化（event_magnitude→web3_user_impact / dimension2→web3_user_spread + 门函数/审计键改名，判据零改动）；J1.53=C122 门名断代；J1.52=C121 用户视角批次一：w_product_score 用户兴奋度锚（C42 形态词保留）+niche_subculture 认知可达性锚（35 行全 A 类活桶改锚非退役）；J1.51=C119 批内修正 dim2 镜头（认知面非实测互动）；J1.50=C119 用户视角统一；J1.44=C110 合桶+mem 瘦身；J1.45=C110 扫描后裁定 dim2 同轴锚删除+gimmick 扩全域；J1.46=C113 找角度判轴+ip_reuse 边界；J1.47=C114 name_form 通用梗缩写锚；J1.48=C116 整句情绪姿态分界；J1.49=C118 image_depicts_name 条件题；本测试 J1.48/J1.49 两轮漏 bump 存量修复）', JEV_QUESTIONS_VERSION === 'J1.54', JEV_QUESTIONS_VERSION);
  const qs = buildStandardQuestions();
  check('A2 基础 16 题', Object.keys(qs).length === 16, Object.keys(qs).length);
  check('A3 旧题已删（relevance_level/quality_spelling/quality_reasonability 不存在）',
    !('relevance_level' in qs) && !('quality_spelling' in qs) && !('quality_reasonability' in qs), null);
  check('A4 token_quality 在（0-3 四档）', qs.token_quality?.type === 'score' && qs.token_quality.criteria.length === 4, qs.token_quality?.criteria?.length);
  check('A5 relevance_type 9 融合桶',
    Object.keys(qs.relevance_type.criteria).length === 9
    && ['exact_match', 'translation_match', 'abbreviation_alias', 'semantic_clear', 'semantic_weak', 'cultural_rich', 'cultural_thin', 'generic_concept', 'none'].every(k => k in qs.relevance_type.criteria), null);
  check('A6 name_referent 3 桶（subject_self/super_ip/other_referent）',
    Object.keys(qs.name_referent.criteria).length === 3 && 'other_referent' in qs.name_referent.criteria, null);
  check('A6b other_referent 含配图形象指代源（交易猫断链修复点）',
    qs.name_referent.criteria.other_referent.includes('配图中出现的形象'), null);
  check('A7 subject_entity 2 桶（product_entity/other_entity）',
    Object.keys(qs.subject_entity.criteria).length === 2 && 'product_entity' in qs.subject_entity.criteria, null);
  check('A8 block_reason 9 桶（C109 退役 regional/subject_unqualified + C110 退役 low_quality_derivative）',
    Object.keys(qs.block_reason.criteria).length === 9
    && !('regional_event' in qs.block_reason.criteria) && !('subject_unqualified' in qs.block_reason.criteria)
    && !('low_quality_derivative' in qs.block_reason.criteria), null);
  check('A8b C113 ip_reuse 边界重写：仅拦纯蹭名+无意义修改两形状，有意义的修改/变形不拦（用户裁定「合理即可」）',
    qs.block_reason.criteria.ip_reuse.includes('纯蹭名') && qs.block_reason.criteria.ip_reuse.includes('无意义修改')
    && qs.block_reason.criteria.ip_reuse.includes('有意义的修改/变形不选本项') === true, null);
  // A8c 行为级退役证明（legacy 形状行/旧缓存重放）：A 类票 argmax=low_quality_derivative
  // （none<0.5 域内）不再拦——C109 教训的机器证明：scope 显式空数组才是真退役；
  // 同形状 argmax=ip_reuse 照拦（合并不外溢）
  {
    const aRetired = baseAnswers();
    aRetired.event_category = { choice: 'A', probabilities: { A: 0.8 } };
    aRetired.block_reason = { choice: 'low_quality_derivative', probabilities: { none: 0.1, low_quality_derivative: 0.7 } };
    const rRetired = mapStandardAnswers(aRetired, stdCtx('TST', 'TST'));
    check('A8c 退役桶行为：A 类 argmax=low_quality_derivative 不再拦（显式空域）',
      !(rRetired.llmResult.reason || '').includes('低质衍生'), rRetired.llmResult.reason);
    const aActive = baseAnswers();
    aActive.event_category = { choice: 'A', probabilities: { A: 0.8 } };
    aActive.block_reason = { choice: 'ip_reuse', probabilities: { none: 0.1, ip_reuse: 0.7 } };
    const rActive = mapStandardAnswers(aActive, stdCtx('TST', 'TST'));
    check('A8d 活桶对照：A 类 argmax=ip_reuse 照拦（合并不外溢）',
      (rActive.llmResult.reason || '').includes('IP低质复用') && rActive.llmResult.rating === 'low', rActive.llmResult.reason);
  }

  // A8e J1.45（C110 扫描后裁定）gimmick 扩全域行为证明：E 类票 argmax=
  // marketing_gimmick 原跨类空洞不拦 → 现拦（261 行空洞面的机器证明）
  {
    const aHole = baseAnswers();
    aHole.event_category = { choice: 'E', probabilities: { E: 0.8 } };
    aHole.block_reason = { choice: 'marketing_gimmick', probabilities: { none: 0.2, marketing_gimmick: 0.6 } };
    const rHole = mapStandardAnswers(aHole, stdCtx('TST', 'TST'));
    check('A8e gimmick 扩全域：E 类 argmax=marketing_gimmick 拦（J1.45 前跨类空洞）',
      rHole.llmResult.rating === 'low' && (rHole.llmResult.reason || '').includes('营销噱头'), rHole.llmResult.reason);
  }

  // A9 J1.45 dim2 同轴锚删除：题面不再要求「档位应基本一致」（0.85 同轴实证=
  // 同一判断问两遍），改「同档主体传播面强弱细分」镜头 + 明确允许与档位不一致
  {
    const dq = qs.web3_user_spread;
    check('A9 dim2 题面瘦身：删同轴锚 + 传播面细分镜头 + 允许与档位不一致',
      !dq.instructions.includes('档位应基本一致') && dq.instructions.includes('传播面的强弱细分')
      && dq.instructions.includes('不同镜头') && dq.instructions.includes('按本题自己的证据如实评')
      && dq.instructions.includes('两形状分流（J1.20）') && dq.instructions.includes('J1.23') && dq.instructions.includes('J1.35'),
      dq.instructions.slice(0, 200));
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
    check('A10a event_magnitude A 类找角度锚：主体=被借势 IP 本身、世界知识可判、载体账号数据不参与',
      qs.web3_user_impact.instructions.includes('找角度/借势语料（形状②，J1.46）')
      && qs.web3_user_impact.instructions.includes('不代表IP量级、不参与定档'),
      qs.web3_user_impact.instructions.slice(0, 100));
    check('A10b dimension2 A 类找角度锚：IP 方权重按被借势 IP 知名度判、载体推文数据不参与',
      qs.web3_user_spread.instructions.includes('载体推文账号的粉丝/赞/转不是IP知名度证据、不参与判分')
      && qs.web3_user_spread.instructions.includes('不因「语料里只有小号提及」降档'),
      qs.web3_user_spread.instructions.slice(0, 100));
    // J1.51 事故现场反证：J1.50 版「实际被调动/多少人注意到」措辞把 dim2 镜头导向
    // 语料实测互动 → 全量对拍 C113 哭哭奶龙回归（档位稳 B 但 dim2 28.2→13.2 塌档，
    // 138 粉载体形状 probs 落 0-1 带 0.72）。修正锚锁死：镜头=用户侧认知面非实测互动
    check('A10b-J51 dimension2 镜头=用户侧认知面非语料实测互动（C113 回归反证锁定）',
      qs.web3_user_spread.instructions.includes('不是语料推文账号的实测互动量')
      && qs.web3_user_spread.instructions.includes('小号载体≠小事件')
      && !qs.web3_user_spread.instructions.includes('实际被调动起来的传播面'),
      qs.web3_user_spread.instructions.slice(0, 120));
    check('A10c state builder PRECOMPUTED 消毒行：tweet_type_note 划定载体数据用途边界（仅时效分桶）',
      sbSrc.includes('tweet_type_note:') && sbSrc.includes('不是事件传播数据') && sbSrc.includes('J1.20形状②/J1.46'),
      '缺消毒行');
    check('A10d 源码版本常量与模块导出一致（防只 bump 文件头注释不 bump 常量的漂移）',
      qsSrc.includes("JEV_QUESTIONS_VERSION = 'J1.54'"), 'J1.53 常量缺失');

    // A11 J1.53（C121 用户视角批次一）锚句锁定：
    // w_product_score 主轴=用户兴奋度（客观创新性降参考锚+显式否定实测读法——
    // J1.51 教训同款：用户侧轴题面必须显式否定观测数据读法）；各带形态词保形
    // （C42 wNewProductP=1−P(0)−P(1) 依赖 0/1=小改进、2/3=产品发布带结构）；
    // niche_subculture 判据从大众出圈视角（与用户原则相反）切认知可达性，
    // BLOCK_SCOPE ['A'] 不变（35 行全 A 类活桶改锚非退役，mapper 零改动）
    {
      const wp = qs.w_product_score;
      check('A11a w_product_score 主轴=web3 用户关注与兴奋度+显式否定实测读法',
        wp.instructions.includes('关注与兴奋度') && wp.instructions.includes('当话题讨论')
        && wp.instructions.includes('不是发布后实测数据') && wp.instructions.includes('参考锚，不是定死映射'),
        wp.instructions.slice(0, 120));
      check('A11b w_product_score 四带形态词保形（C42 带结构反证：0/1=小改进 2/3=产品发布）',
        wp.criteria[0].includes('版本更新') && wp.criteria[1].includes('新功能')
        && wp.criteria[2].includes('新产品') && wp.criteria[3].includes('创新产品'),
        wp.criteria.join(' | ').slice(0, 160));
      const ns = qs.block_reason.criteria.web3_circle_reachability;
      check('A11c 圈层可达性桶锚（桶名 Web3 用户圈层可达性+get 不到梗+crypto 圈内梗≠小圈子反误伤+显式否定出圈读法）',
        ns.includes('Web3 用户圈层可达性不足') && ns.includes('get 不到梗')
        && ns.includes('crypto 圈内梗/黑话≠小圈子') && ns.includes('不是大众出圈前景')
        && !ns.includes('圈外人无法理解') && !ns.includes('无出圈可能'),
        ns.slice(0, 120));
      // A11c2 品牌营销边界（C110 币安菠萝 A/B 归因：不加此界=gimmick argmax
      // 100%→47%，币安品牌物料被当圈内梗放行）
      check('A11c2 圈层可达性桶品牌营销边界（社区自发梗≠品牌物料，带币安品牌≠圈内契合）',
        ns.includes('社区自发形成的文化梗') && ns.includes('品牌营销物料')
        && ns.includes('官方周边') && ns.includes('不等于圈内契合')
        && ns.includes('仍归营销噱头'),
        ns.slice(-200));
      // 源码口径断言（BLOCK_SCOPE 模块私有未导出，A10d 同款先例；注意 BLOCK_SCOPE
      // 在 mapper 文件非题集文件——qsSrc 是题集文件源码）：
      const mapperSrc = readFileSync(join(__dirname, '../src/narrative/analyzer/llm/jev-result-mapper.mjs'), 'utf8');
      const scopeMatch = mapperSrc.match(/BLOCK_SCOPE = \{[\s\S]*?\n\};/);
      check('A11d BLOCK_SCOPE.web3_circle_reachability 仍 ["A"]（改锚不改域，改锚前 182 扫描 35 行全 A 类）',
        !!scopeMatch && /web3_circle_reachability:\s*\['A'\],/.test(scopeMatch[0]),
        'mapper BLOCK_SCOPE 圈层可达性行非 ["A"]');

      // A12 J1.53（C122 门名断代，零行为意图）：题键/桶键改名——name_form →
      // web3_user_acceptability、niche_subculture → web3_circle_reachability。
      // 断言：①题集新键在场且旧键不提供 ②mapper 双键读（旧键=存量缓存行/旧
      // fixture 兼容）③新键行为=旧键（拦/放同语义）④新桶域内拦、域外不拦
      {
        check('A12a 题集题键=web3_user_acceptability（旧 name_form 不再提供）',
          qs.web3_user_acceptability != null && qs.name_form === undefined,
          Object.keys(qs).filter(k => k.includes('accept') || k.includes('name')));
        check('A12b 题集桶键=web3_circle_reachability（旧 niche_subculture 不再提供）',
          qs.block_reason.criteria.web3_circle_reachability != null
          && qs.block_reason.criteria.niche_subculture === undefined,
          Object.keys(qs.block_reason.criteria));
        // 新键行为=旧键（拦）
        const aNew = baseAnswers();
        aNew.web3_user_acceptability = { choice: 'web3_user_not_acceptable', probabilities: { web3_user_not_acceptable: 0.8 } };
        delete aNew.name_form;
        const rNew = mapStandardAnswers(aNew, stdCtx('TST', 'TST'));
        check('A12c 新题键 web3_user_not_acceptable → 用户接纳度门拦（label 含「Web3 用户不接纳该名字」）',
          rNew.llmResult.rating === 'low' && (rNew.llmResult.reason || '').includes('Web3 用户不接纳该名字'),
          rNew.llmResult.reason);
        // 旧键仍走同一门（存量缓存行/fixture 兼容）
        const aOld = baseAnswers();
        aOld.name_form = { choice: 'not_meme_name', probabilities: { not_meme_name: 0.8 } };
        delete aOld.web3_user_acceptability;
        const rOld = mapStandardAnswers(aOld, stdCtx('TST', 'TST'));
        check('A12d 旧题键 name_form 仍走同一门（断代兼容：存量缓存行/旧 fixture 形状）',
          rOld.llmResult.rating === 'low' && (rOld.llmResult.reason || '').includes('Web3 用户不接纳该名字'),
          rOld.llmResult.reason);
        // 新桶键：A 域拦 / B 域不拦；label 新名
        const aBucket = baseAnswers();
        aBucket.event_category = { choice: 'A', probabilities: { A: 0.8 } };
        aBucket.block_reason = { choice: 'web3_circle_reachability', probabilities: { none: 0.1, web3_circle_reachability: 0.7 } };
        const rBucket = mapStandardAnswers(aBucket, stdCtx('TST', 'TST'));
        check('A12e 新桶键 web3_circle_reachability A 域拦（label=Web3 用户圈层可达性不足）',
          rBucket.llmResult.rating === 'low' && (rBucket.llmResult.reason || '').includes('Web3 用户圈层可达性不足'),
          rBucket.llmResult.reason);
        const bBucket = baseAnswers();
        bBucket.event_category = { choice: 'B', probabilities: { B: 0.8 } };
        bBucket.block_reason = { choice: 'web3_circle_reachability', probabilities: { none: 0.1, web3_circle_reachability: 0.7 } };
        const rBucketB = mapStandardAnswers(bBucket, stdCtx('TST', 'TST'));
        check('A12f 新桶键域外不拦（B 类同 choice 不构成阻断=改锚不改域）',
          !(rBucketB.llmResult.reason || '').includes('圈层可达性'),
          rBucketB.llmResult.reason);
        check('A12g 审计键改名（stage1 web3UserAcceptability / stage2 web3UserAcceptabilityBlock，旧名不落）',
          rNew.stage1DataToSave.parsed_output.jev.web3UserAcceptability === 'web3_user_not_acceptable'
          && rNew.stage1DataToSave.parsed_output.jev.nameForm === undefined
          && rNew.stage2DataToSave.parsed_output.jev.web3UserAcceptabilityBlock?.choice === 'web3_user_not_acceptable',
          rNew.stage1DataToSave.parsed_output.jev.web3UserAcceptability);
      }

      // A13 J1.54（C123 门名/题键语义化，零判据改动）：event_magnitude →
      // web3_user_impact、dimension2 → web3_user_spread + 门函数/审计键改名。
      // 断代兼容红线：mapper 双读（旧形状 answers 结果与新形状逐位一致）。
      {
        check('A13a 题键改名：web3_user_impact/web3_user_spread 在场，event_magnitude/dimension2 缺席',
          qs.web3_user_impact?.type === 'score' && qs.web3_user_spread?.type === 'score'
          && qs.event_magnitude === undefined && qs.dimension2 === undefined,
          Object.keys(qs).filter(k => k.includes('impact') || k.includes('spread') || k.includes('magnitude') || k.includes('dimension')));
        check('A13b 题面跨题引用同步（web3_user_spread 引 web3_user_impact、无旧键名）',
          qs.web3_user_spread.instructions.includes('web3_user_impact')
          && !qs.web3_user_spread.instructions.includes('event_magnitude')
          && qs.subject_entity.instructions.includes('web3_user_impact'),
          null);
        // 双读等价：旧形状 vs 新形状（移键）逐位对拍
        const oldShape = baseAnswers();
        const newShape = { ...baseAnswers() };
        newShape.web3_user_impact = oldShape.event_magnitude;
        newShape.web3_user_spread = oldShape.dimension2;
        delete newShape.event_magnitude;
        delete newShape.dimension2;
        const rOldShape = mapStandardAnswers(oldShape, stdCtx('TST', 'TST'));
        const rNewShape = mapStandardAnswers(newShape, stdCtx('TST', 'TST'));
        const s2Old = rOldShape.stage2DataToSave.parsed_output;
        const s2New = rNewShape.stage2DataToSave.parsed_output;
        check('A13c 双读等价：旧形状 answers 与新形状 answers 评级/总分/传播分/档位全等',
          rOldShape.llmResult.rating === rNewShape.llmResult.rating
          && s2Old.scoringResult.totalScore === s2New.scoringResult.totalScore
          && s2Old.scoringResult.spreadScore === s2New.scoringResult.spreadScore
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
        check('A13f 概率键/评分键改名：probabilities 新键在场旧键缺席，scoringResult.spreadScore 在场、dimension2 缺席',
          s1j.probabilities.web3_user_impact != null && s1j.probabilities.event_magnitude === undefined
          && s2New.jev.probabilities.web3_user_spread != null && s2New.jev.probabilities.dimension2 === undefined
          && s2New.scoringResult.spreadScore != null && s2New.scoringResult.dimension2 === undefined,
          { s1: Object.keys(s1j.probabilities), s2: Object.keys(s2New.jev.probabilities) });
        check('A13g 折损审计键改名：web3UnfitMass 恒落（可 null）、web3FitMass 缺席',
          'web3UnfitMass' in s2New.jev && s2New.jev.web3FitMass === undefined,
          Object.keys(s2New.jev).filter(k => k.toLowerCase().includes('fitmass')));
        // E 类 + web3_fit 正向质量<0.5 → Web3偏好折损（原感染力折损）
        const eAns = baseAnswers();
        eAns.event_category = { choice: 'E', probabilities: { E: 0.9 } };
        eAns.web3_fit = { choice: 'marginal', probabilities: { marginal: 0.6, unfit: 0.2, fit: 0.1 } };
        const rE = mapStandardAnswers(eAns, stdCtx('TST', 'TST'));
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
        check('A13i B 类传播锚审计键改名：web3FitSpreadAnchor 命中、instagramSpreadAnchor 为空、旧键缺席',
          s2B.jev.web3FitSpreadAnchor?.from === 10
          && s2B.jev.web3FitDim2Anchor === undefined
          && s2B.jev.instagramDim2Anchor === undefined,
          s2B.jev.web3FitSpreadAnchor);
        // 源码口径：门函数/常量改名（防回潮）
        const mapperSrc2 = readFileSync(join(__dirname, '../src/narrative/analyzer/llm/jev-result-mapper.mjs'), 'utf8');
        check('A13j 门函数/常量源码改名（web3UserAcceptabilityBlock/Choice、WEB3_USER_NOT_ACCEPTABLE_CHOICES、web3UnfitBlock、rideDetourMass、WEB3_FIT_DAMP_COEF）',
          /function web3UserAcceptabilityBlock\(answers\)/.test(mapperSrc2)
          && /function web3UserAcceptabilityChoice\(answers\)/.test(mapperSrc2)
          && /WEB3_USER_NOT_ACCEPTABLE_CHOICES = new Set\(/.test(mapperSrc2)
          && /function web3UnfitBlock\(answers\)/.test(mapperSrc2)
          && /function rideDetourMass\(answers, category\)/.test(mapperSrc2)
          && /WEB3_FIT_DAMP_COEF = 0\.5/.test(mapperSrc2)
          && !/function notMemeNameBlock/.test(mapperSrc2)
          && !/function nameFormChoice/.test(mapperSrc2)
          && !/function rideDetourBelow/.test(mapperSrc2),
          null);
      }
    }
  }

  // ═══ B. 融合关联分 ═══
  console.log('\n── B. 融合关联分（RELEVANCE_FUSED_SCORES 单值直查）──');
  const fusedScores = { exact_match: 20, translation_match: 18, abbreviation_alias: 17, semantic_clear: 13, semantic_weak: 9, cultural_rich: 12, cultural_thin: 3, generic_concept: 5, none: 0 };
  for (const [bin, want] of Object.entries(fusedScores)) {
    const a = baseAnswers();
    a.relevance_type = { choice: bin, probabilities: { [bin]: 0.8 } };
    const r = mapStandardAnswers(a, stdCtx('TST', 'TST'));
    const rs = r.stage3DataToSave?.parsed_output?.relevanceScore;
    check(`B ${bin} → ${want}`, rs === want, { rs, reason: r.llmResult.reason });
  }
  // reason 模板：融合形状无 lv 段
  const aClear = baseAnswers();
  aClear.relevance_type = { choice: 'semantic_clear', probabilities: { semantic_clear: 0.8 } };
  aClear.token_quality = { score: 3, probabilities: {} };
  const rClear = mapStandardAnswers(aClear, stdCtx('TST', 'TST'));
  check('B10 reason 模板融合形状：关联13(semantic_clear) 无 lv 段 + 质量(长8+名10)',
    (rClear.llmResult.reason || '').includes('关联13(semantic_clear)') && (rClear.llmResult.reason || '').includes('质量18(长8+名10)'),
    rClear.llmResult.reason);
  // 截断线两侧：weak 9 仍被关联截断拦；clear 13 不因截断拦
  const aWeak = baseAnswers();
  aWeak.relevance_type = { choice: 'semantic_weak', probabilities: { semantic_weak: 0.8 } };
  const rWeak = mapStandardAnswers(aWeak, stdCtx('TST', 'TST'));
  check('B11 semantic_weak 9 ≤10 → 关联性不足截断（对齐旧 lv0-1）',
    rWeak.llmResult.rating === 'low' && (rWeak.llmResult.reason || '').includes('关联性不足'), rWeak.llmResult.reason);
  check('B12 semantic_clear 13 >10 → 不因截断拦（对齐旧 lv2-4）',
    rClear.llmResult.rating !== 'low' || !(rClear.llmResult.reason || '').includes('关联性不足'), rClear.llmResult.reason);
  // none=0 锚：保 imgNameExempt relevance.score>0 语义
  const aNone = baseAnswers();
  aNone.relevance_type = { choice: 'none', probabilities: { none: 0.8 } };
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
    a.relevance_type = { choice: type, probabilities: { [type]: 0.8 } };
    a.relevance_level = { score: lv, probabilities: {} };
    a.token_quality = undefined; // legacy 形状不带新题
    const r = mapStandardAnswers(a, stdCtx('TST', 'TST'));
    const j = r.stage3DataToSave?.parsed_output;
    const okScore = j?.relevanceScore === wantScore;
    const okLv = j?.jev?.relevanceLevelIdx === wantLv;
    check(`C ${type}/lv${lv} → ${wantScore}(lv${wantLv})`, okScore && okLv, { score: j?.relevanceScore, lv: j?.jev?.relevanceLevelIdx });
  }

  // ═══ D. token_quality 映射 + legacy 双题 bit 不变 ═══
  console.log('\n── D. token_quality（band 索引 0-3 → 联合量纲 0-12）──');
  const tqCases = [[0, 0], [1, 3], [2, 6], [3, 10], [2.5, 7.5], [0.5, 1]];
  for (const [score, want] of tqCases) {
    const a = baseAnswers();
    a.relevance_type = { choice: 'exact_match', probabilities: { exact_match: 0.8 } };
    a.token_quality = { score, probabilities: {} };
    const r = mapStandardAnswers(a, stdCtx('TST', 'TST'));
    const j = r.stage3DataToSave.parsed_output;
    // TST 1 词 → length 8；total = 8 + want
    check(`D token_quality ${score} → 名${want}（total=${8 + want}）`,
      j.jev === undefined || (j.breakdown.name === want && j.qualityScore === 8 + want && j.breakdown.spelling === null),
      { name: j.breakdown?.name, total: j.qualityScore });
  }
  // legacy 双题：spelling 6.5 → band[3] 6.5；reasonability 4.5 → band[2] 4.5
  const aLeg = baseAnswers();
  aLeg.relevance_type = { choice: 'exact_match', probabilities: { exact_match: 0.8 } };
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
    a.relevance_type = { choice: Object.keys(relProbs)[0], probabilities: relProbs };
    a.name_referent = { choice: 'super_ip', probabilities: { super_ip: 0.8, subject_self: 0.15 } };
    a.referent_memeability = { score: 3, probabilities: {} };
    a.web3_fit = { choice: 'strong_fit', probabilities: { strong_fit: 0.8, fit: 0.1 } };
    a.event_timing = { choice: 'within_7d', probabilities: { within_7d: 0.9 } };
    return a;
  }
  // 新桶全量形状：semantic_clear 0.35 + cultural_rich 0.2 → relPositive 0.55
  const rNew = mapStandardAnswers(c88Answers({ semantic_clear: 0.35, cultural_rich: 0.2, none: 0.3 }), stdCtx('暗号', '暗号資産の覹者'));
  const s2New = rNew.stage2DataToSave.parsed_output.jev.superIpSlogan;
  check('E1 新桶名求和：relPositive=0.55（semantic_clear+cultural_rich）→ 五腿 hit',
    s2New.hit === true && s2New.relPositive === 0.55, s2New);
  // 旧桶名 legacy 形状照 hit（求和保留旧名防回放工具）
  const rOld = mapStandardAnswers(c88Answers({ semantic: 0.35, cultural: 0.2, none: 0.3 }), stdCtx('暗号', '暗号資産の覹者'));
  const s2Old = rOld.stage2DataToSave.parsed_output.jev.superIpSlogan;
  check('E2 旧桶名照求和（legacy 形状 bit 不变）', s2Old.hit === true && s2Old.relPositive === 0.55, s2Old);
  // 薄关联不救：thin 0.35 不足以过 mem 腿以外的五腿（relPositive 0.35≥0.3 但 none 0.65 主导 → relNoneMass 0.65 ≥0.5 断腿）
  const rThin = mapStandardAnswers(c88Answers({ cultural_thin: 0.35, none: 0.65 }), stdCtx('TST', 'TST'));
  const s2Thin = rThin.stage2DataToSave.parsed_output.jev.superIpSlogan;
  check('E3 none 主导（0.65≥0.5）→ 五腿断（relNone 腿锁死）', s2Thin.hit === false, s2Thin);

  // ═══ F. J1.27 产品实体门兼容集 ═══
  console.log('\n── F. J1.27 产品实体门（subject_entity 8→2 兼容）──');
  function peAnswers(se) {
    const a = baseAnswers();
    a.subject_entity = { choice: se, probabilities: { [se]: 0.7 } };
    // marginal 主导：unfit=0 不触 J1.19 负门，fitMass=strong_fit+fit=0.2<0.5 → J1.27 拦
    a.web3_fit = { choice: 'marginal', probabilities: { marginal: 0.6, fit: 0.2 } };
    return a;
  }
  for (const [se, wantBlock, wantLabel] of [
    ['product_entity', true, '产品实体'],
    ['product_functional', true, '功能产品'],
    ['product_character', true, '产品形象'],
    ['other_entity', false, null],
  ]) {
    const r = mapStandardAnswers(peAnswers(se), stdCtx('TST', 'TST'));
    const blocked = r.llmResult.rating === 'low' && (r.llmResult.reason || '').includes('产品实体未被web3买家接纳');
    check(`F ${se} → ${wantBlock ? `拦（${wantLabel}）` : '不拦'}`, blocked === wantBlock, r.llmResult.reason);
  }

  // ═══ G. 退役阻断桶空域 ═══
  console.log('\n── G. 退役阻断桶（regional_event/subject_unqualified 空域不拦）──');
  for (const [bin, cat] of [['subject_unqualified', 'C'], ['subject_unqualified', 'D'], ['regional_event', 'E']]) {
    const a = baseAnswers();
    a.event_category = { choice: cat, probabilities: { [cat]: 0.7 } };
    a.block_reason = { choice: bin, probabilities: { [bin]: 0.55, none: 0.4 } }; // 旧形状域内拦截实测档位
    const r = mapStandardAnswers(a, stdCtx('TST', 'TST'));
    check(`G ${bin}+${cat}（旧形状原拦）→ 退役后不再拦`, r.llmResult.rating !== 'low' || !(r.llmResult.reason || '').includes('阻断:'),
      r.llmResult.reason);
  }
  // 对照：活桶照拦（empty_content 全域）
  const aEc = baseAnswers();
  aEc.block_reason = { choice: 'empty_content', probabilities: { empty_content: 0.55, none: 0.4 } };
  const rEc = mapStandardAnswers(aEc, stdCtx('TST', 'TST'));
  check('G4 活桶对照：empty_content 照拦（删除不外溢）',
    rEc.llmResult.rating === 'low' && (rEc.llmResult.reason || '').includes('空洞内容'), rEc.llmResult.reason);

  // ═══ 汇总 ═══
  console.log(`\n══════ _test_jev_question_consolidation: ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('单测异常:', e); process.exit(1); });
