#!/usr/bin/env node
/**
 * J1.30 名图一致豁免（name_image_consistency 条件题 + imgNameExempt 三门）
 * ——本地零 DB 单测（2026-10-14 用户裁定「都做」，C64 巴巴鸡案）
 *
 * 病根（0x1ea2152c68a3cba1cd3ffe68abd97d95f9ac7777）：stage1 A 类
 * （character_ip 0.84 / strong_fit 0.92→web3FitAnchored B）、stage2 66.32 过线，
 * stage3 关联 cultural lv1=5 分 ≤10 截断 low。梗名「巴巴鸡」只在配图（抖音截图）
 * 的图内文字里（搜索框「巴巴鸡给鸡给巴巴视频」），推文正文未写名；旧版图分析
 * （img-v2）无文字转写指令且 maxTokens 1500 截断，字面证据没进 Jev state →
 * Jev 只剩「名字含鸡+图是鸡形角色」弱证据判 cultural。用户裁定原话：「这种情况，
 * 如果名字是一只鸡，图片也是一只鸡，恐怕认为这俩有关联就好了，因为给的信息
 * 可能很难判断。」
 *
 * 两改动（P1 根因修复 + P2 兜底豁免）：
 *   P1 image-analysis-service img-v3（visible_text 逐字转写 + maxTokens 2500）
 *   P2 第 17 题name_image_consistency（条件题，仅配图分析挂载时问）+ mapper
 *      imgNameExempt 三门豁免 Stage3 关联≤10 截断（relevance 分照常计入）
 *
 * 覆盖：
 *   A. 问卷形状：J1.30 条件题（无图不含/有图含、三档、题面锚定、与 brand_hijack 独立）
 *   B. 巴巴鸡事故现场反证：cultural lv1=5 分被豁免救回（rating 翻正/审计/reason
 *      前缀/relevance 分照常计入总分）
 *   C. 三门防线逐门 fail-closed：无图 / 旧缓存无答案 / 一致性<0.5 / 纯零关联
 *   D. 边界：>10 不触发 / 品牌劫持与拼写门不受豁免 / 恰 0.5 过线 / 单档过线
 *   E. 审计字段：命中才落 / probabilities 条件落
 *   F. 源码口径：截断链形状 / analyzer 接线两处 / superIP 不消费 / P1 配套
 *      （img-v3 + visible_text + maxTokens 2500 + config 同步）
 *
 * 用法：node scripts/_test_name_image_consistency.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

const TOKEN_ADDR = '0x1ea2152c68a3cba1cd3ffe68abd97d95f9ac7777';

/**
 * 巴巴鸡案基础形状：A 类过 stage1/2（量级 A 档 / dim2 25 / strong_fit /
 * referent_memeability 3 / carrier existing 全部避开前置门），relevance 刻意
 * cultural lv1=5 分（RELEVANCE_TABLE.cultural[1]，线上真实档位）——专测
 * Stage3 关联截断与豁免。nic 可传答案或 undefined（旧缓存行形状）。
 */
function babaJiAnswers(nic, over = {}) {
  const answers = {
    event_category: { choice: 'A', probabilities: { A: 0.7 } },
    event_magnitude: { score: 4.6, probabilities: { '4': 0.5, '5': 0.3 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.9 } },
    dimension2: { score: 25, probabilities: { '5': 0.6, '4': 0.3 } },
    block_reason: { choice: 'none', probabilities: { none: 0.92 } },
    name_referent: { choice: 'super_ip', probabilities: { super_ip: 0.9, notable_other: 0.08 } },
    referent_memeability: { score: 3, probabilities: {} },
    web3_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.85, fit: 0.1 } },
    subject_entity: { choice: 'character_ip', probabilities: { character_ip: 0.84 } },
    subject_carrier: { choice: 'existing_entity', probabilities: { existing_entity: 0.8 } },
    // 线上真实形状：cultural（弱字面证据）lv1 → 5 分
    relevance_type: { choice: 'cultural', probabilities: { cultural: 0.29, exact_match: 0.14 } },
    relevance_level: { score: 1.4, probabilities: { '1': 0.6 } },
    block_misspelling: { noul: 0.23 },
    quality_spelling: { score: 6.5 },
    quality_reasonability: { score: 4.5 },
  };
  if (nic !== undefined) {
    answers.name_image_consistency = nic;
  }
  return { ...answers, ...over };
}

const stdCtx = (over = {}) => ({
  tokenData: { symbol: '巴巴鸡', name: '巴巴鸡', raw_api_data: { name: '巴巴鸡' } },
  includeBrandHijack: false,
  imageEvidence: true, // 主推配图分析已挂载（线上真形状）
  tweetClassification: null,
  twitterInfo: null,
  callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  ...over,
});

/** 同一个/similar 同类视觉主体 + 少量 unrelated 抖动（线上常见分布形状） */
const NIC_MATCH = { choice: 'same_visual_category', probabilities: { same_entity: 0.38, same_visual_category: 0.44, unrelated: 0.18 } };
const NIC_STRONG = { choice: 'same_entity', probabilities: { same_entity: 0.72, same_visual_category: 0.2, unrelated: 0.08 } };
const NIC_UNRELATED = { choice: 'unrelated', probabilities: { same_entity: 0.05, same_visual_category: 0.1, unrelated: 0.85 } };

function stage3Jev(r) { return r.stage3DataToSave?.parsed_output?.jev; }

async function main() {
  const mapper = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const { mapStandardAnswers } = mapper;
  const { buildStandardQuestions, JEV_QUESTIONS_VERSION } = await import('../src/narrative/analyzer/llm/jev-questions.mjs');

  // ═══ A. 问卷形状 ═══
  console.log('\n── A. 问卷形状（J1.30 条件题）──');
  check('A1 版本号 = J1.53（J1.53=C122 门名断代（name_form→web3_user_acceptability / niche_subculture→web3_circle_reachability，零行为意图）；J1.52=C121 用户视角批次一：w_product_score 用户兴奋度锚+niche_subculture 认知可达性锚；J1.51=C119 批内修正 dim2 镜头；J1.50=C119 用户视角统一+name_form 键名断代 web3_user_acceptable/web3_user_not_acceptable/unclear；J1.49=C118 image_depicts_name 演绎题（与 name_image_consistency 同携带条件）；J1.48=C116 name_form 整句情绪姿态分界；J1.47=C114 name_form 通用梗缩写锚+ mapper empty_content 图证在场豁免；J1.46=C113 找角度判轴+ip_reuse 边界；J1.45=C110 扫描后裁定 dim2 同轴锚删除+gimmick 扩全域；J1.44=C110 合桶+mem 瘦身；J1.43=C109 题集收敛；J1.42=C108 名字门统一四分支；J1.41=C107 收敛三选；J1.40=C105 第四选（兼容 Set 继续拦）；J1.39=C103 条件题；J1.38=C98 题面扩边界；J1.37=C96 两新题；名图一致豁免本身仍是 J1.30 引入）', JEV_QUESTIONS_VERSION === 'J1.53', JEV_QUESTIONS_VERSION);
  const qsNoImg = buildStandardQuestions();
  check('A2 无图（默认）不含 name_image_consistency（条件题，无图不问防幻觉作答）',
    !('name_image_consistency' in qsNoImg), null);
  const qsImg = buildStandardQuestions({ imageConsistency: true });
  const nic = qsImg.name_image_consistency;
  check('A3 imageConsistency:true 含题，choice 三档（same_entity/same_visual_category/unrelated）',
    nic?.type === 'choice' && Object.keys(nic.criteria).length === 3
      && ['same_entity', 'same_visual_category', 'unrelated'].every(k => k in nic.criteria), null);
  check('A4 题面钉死：事实性对应判断非质量判断', nic.instructions.includes('事实性对应判断，不是质量判断'), null);
  check('A5 题面钉死：meme 盘惯例锚（名字含鸡、图就是鸡形角色）',
    nic.instructions.includes('名字含鸡、图就是鸡形角色'), null);
  check('A6 题面钉死：图内文字计入（梗名可能只写在图里——巴巴鸡案根因）',
    nic.instructions.includes('图内文字') && nic.instructions.includes('梗名可能只写在图里'), null);
  check('A7 与 brand_hijack 条件题独立（可同时携带）',
    !('brand_hijack' in qsImg) && 'name_image_consistency' in buildStandardQuestions({ includeBrandHijack: true, imageConsistency: true }), null);

  // ═══ B. 巴巴鸡事故现场反证 ═══
  console.log('\n── B. 巴巴鸡事故现场反证（cultural lv1=5 分）──');
  // 对照臂：豁免缺席（无图）= 修正前行为——Stage3 关联截断 low
  const rBefore = mapStandardAnswers(babaJiAnswers(NIC_MATCH), stdCtx({ imageEvidence: false }));
  check('B1 修正前行为：无图票 cultural 5 分 → 截断 low（关联性不足）',
    rBefore.llmResult.rating === 'low' && (rBefore.llmResult.reason || '').includes('关联性不足（5分/cultural）'),
    rBefore.llmResult.reason);
  // 豁免臂：三门全中 → 不截断，rating 由分数决（事件分+关联+质量总分过线）
  const rAfter = mapStandardAnswers(babaJiAnswers(NIC_MATCH), stdCtx());
  check('B2 修正后行为：同票+图证据+一致性 0.82 → 豁免截断，rating 非 low',
    rAfter.llmResult.rating !== 'low' && rAfter.llmResult.pass === true, rAfter.llmResult.reason);
  check('B3 reason 含名图一致豁免(J1.30) 前缀', (rAfter.llmResult.reason || '').includes('名图一致豁免(J1.30)｜'), rAfter.llmResult.reason);
  check('B4 reason 关联分照常展示 5 分（弱字面关联代价在分数上体现，J1.24/C59 同款）',
    (rAfter.llmResult.reason || '').includes('关联5(cultural/lv1)'), rAfter.llmResult.reason);
  const jAfter = stage3Jev(rAfter);
  check('B5 审计 imgNameExempt 命中详情（relType/relScore/matchP 可追溯）',
    jAfter?.imgNameExempt?.relType === 'cultural' && jAfter?.imgNameExempt?.relScore === 5 && jAfter?.imgNameExempt?.matchP === 0.82,
    jAfter?.imgNameExempt);
  // relevance 分照常计入总分：总分 = 事件分 + 5 + quality（而非 +20 exact_match 满分）
  const stage2Total = rAfter.stageFinalData.stage2TotalScore;
  const expectTotal = Math.round((Math.round(stage2Total * 0.6 * 100) / 100 + 5 + rAfter.jevDetails.quality.total) * 100) / 100;
  check('B6 relevance 5 分照常计入总分（豁免只免截断不免分）',
    rAfter.llmResult.score === expectTotal, { score: rAfter.llmResult.score, expectTotal });

  // ═══ C. 三门防线逐门 fail-closed ═══
  console.log('\n── C. 三门防线（任一缺失 → 不豁免照常截断）──');
  const rNoImg = mapStandardAnswers(babaJiAnswers(NIC_STRONG), stdCtx({ imageEvidence: false }));
  check('C1 门①图证据缺失（无图票）→ 不豁免照拦', rNoImg.llmResult.rating === 'low'
    && (rNoImg.llmResult.reason || '').includes('关联性不足'), rNoImg.llmResult.reason);
  const rOldCache = mapStandardAnswers(babaJiAnswers(undefined), stdCtx());
  check('C2 门①旧缓存行（imageEvidence 有但无答案键）→ nicMatchP=0 不豁免 fail-closed',
    rOldCache.llmResult.rating === 'low' && (rOldCache.llmResult.reason || '').includes('关联性不足')
    && stage3Jev(rOldCache)?.imgNameExempt === null, rOldCache.llmResult.reason);
  const rLowP = mapStandardAnswers(babaJiAnswers(NIC_UNRELATED), stdCtx());
  check('C3 门②一致性<0.5（unrelated 0.85）→ 不豁免照拦',
    rLowP.llmResult.rating === 'low' && (rLowP.llmResult.reason || '').includes('关联性不足'), rLowP.llmResult.reason);
  const noneRel = babaJiAnswers(NIC_STRONG);
  noneRel.relevance_type = { choice: 'none', probabilities: { none: 0.7 } };
  noneRel.relevance_level = { score: 0.3, probabilities: { '0': 0.6 } }; // round→0：none lv0 = 0 分
  const rNoneRel = mapStandardAnswers(noneRel, stdCtx());
  check('C4 门③纯零关联（none lv0=0 分，0<rel 下界）→ 图再像也不救（C59 条件②同款）',
    rNoneRel.llmResult.rating === 'low' && (rNoneRel.llmResult.reason || '').includes('关联性不足（0分/none）'),
    rNoneRel.llmResult.reason);

  // ═══ D. 边界 ═══
  console.log('\n── D. 边界 ──');
  const midRel = babaJiAnswers(NIC_MATCH);
  midRel.relevance_level = { score: 2.4, probabilities: { '2': 0.6 } }; // round→2：cultural lv2 = 10 分
  const rMid = mapStandardAnswers(midRel, stdCtx());
  check('D1 cultural lv2=10 分（窗内上界）仍可豁免', rMid.llmResult.rating !== 'low'
    && (rMid.llmResult.reason || '').includes('关联10(cultural/lv2)') && (rMid.llmResult.reason || '').includes('名图一致豁免(J1.30)｜'), rMid.llmResult.reason);
  const highRel = babaJiAnswers(NIC_MATCH);
  highRel.relevance_type = { choice: 'exact_match', probabilities: { exact_match: 0.8 } };
  const rHigh = mapStandardAnswers(highRel, stdCtx());
  check('D2 relevance>10（exact_match 20 分，本就不拦）→ 豁免不触发（审计 null、reason 无前缀）',
    rHigh.llmResult.rating !== 'low' && stage3Jev(rHigh)?.imgNameExempt === null
    && !(rHigh.llmResult.reason || '').includes('名图一致豁免'), rHigh.llmResult.reason);
  // 品牌劫持门不受豁免（豁免只挂在关联截断分支）
  const hijackAnswers = babaJiAnswers(NIC_STRONG);
  hijackAnswers.brand_hijack = { noul: 0.8 };
  const rHijack = mapStandardAnswers(hijackAnswers, stdCtx({ includeBrandHijack: true }));
  check('D3 品牌劫持门（P=0.8）不受名图豁免（正交并存，劫持照拦）',
    rHijack.llmResult.rating === 'low' && (rHijack.llmResult.reason || '').includes('品牌劫持'), rHijack.llmResult.reason);
  const typoAnswers = babaJiAnswers(NIC_STRONG);
  typoAnswers.block_misspelling = { noul: 0.7 };
  const rTypo = mapStandardAnswers(typoAnswers, stdCtx());
  check('D4 拼写探针（P=0.7）C108 退役不再拦（无背景拼写判据并入 name_form 分支④）', rTypo.llmResult.rating !== 'low', rTypo.llmResult.reason);
  const edgeP = mapStandardAnswers(babaJiAnswers(
    { choice: 'same_visual_category', probabilities: { same_entity: 0.25, same_visual_category: 0.25, unrelated: 0.5 } }
  ), stdCtx());
  check('D5 合并质量恰 0.5 → 过线豁免（>=0.5 含边界）', edgeP.llmResult.rating !== 'low'
    && stage3Jev(edgeP)?.imgNameExempt?.matchP === 0.5, stage3Jev(edgeP)?.imgNameExempt);
  const singleP = mapStandardAnswers(babaJiAnswers(
    { choice: 'same_entity', probabilities: { same_entity: 0.55, unrelated: 0.45 } }
  ), stdCtx());
  check('D6 same_entity 单档 0.55（无 svc 概率）→ 合并过线豁免', singleP.llmResult.rating !== 'low'
    && (singleP.llmResult.reason || '').includes('名图一致豁免(J1.30)｜'), singleP.llmResult.reason);

  // ═══ E. 审计字段 ═══
  console.log('\n── E. 审计字段 ──');
  check('E1 命中：probabilities.name_image_consistency 落库（题已问）',
    stage3Jev(rAfter)?.probabilities?.name_image_consistency != null,
    stage3Jev(rAfter)?.probabilities);
  check('E2 未问（旧缓存行）：probabilities 无键（条件落，brand_hijack 同款）',
    !('name_image_consistency' in (stage3Jev(rOldCache)?.probabilities ?? {})), null);
  check('E3 Stage2 审计段不受本题影响（subjectCarrier 等恒带键照落）',
    rAfter.stage2DataToSave?.parsed_output?.jev?.subjectCarrier != null, null);

  // ═══ F. 源码口径 ═══
  console.log('\n── F. 源码口径 ──');
  const { readFileSync } = await import('fs');
  const { join } = await import('path');
  const mapperSrc = readFileSync(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-result-mapper.mjs'), 'utf8');
  check('F1 mapper 截断链形状（!imgNameExempt 锁定）',
    mapperSrc.includes('relevance.score <= 10 && !punExempt && !imgNameExempt'), null);
  // C83：mapSuperIPAnswers 快车道删除——J1.30 名图一致豁免对 superIP 语料票
  // 经标准路径真实可达（旧「一期不挂」欠账终结），不存在性断言锁定
  check('F2 mapSuperIPAnswers 快车道已删（J1.30 对 superIP 语料经标准路径可达）',
    !mapperSrc.includes('mapSuperIPAnswers'), null);
  const analyzerSrc = readFileSync(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'NarrativeAnalyzer.mjs'), 'utf8');
  // C72 vision 预判门：布尔前缀 !visionSkipped &&（门跳过=确定性无图语义，J1.30 不问）
  check('F3 analyzer 标准分支接线：buildStandardQuestions imageConsistency 条件',
    analyzerSrc.includes('imageConsistency: !visionSkipped && !!twitterInfo?.image_analysis'), null);
  check('F4 analyzer 标准分支接线：mapStandardAnswers imageEvidence（题集与证据同源）',
    /imageEvidence: !visionSkipped && !!twitterInfo\?\.image_analysis,\s*\n\s*tweetClassification/.test(analyzerSrc), null);
  const qsSrc = readFileSync(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-questions.mjs'), 'utf8');
  check('F5 题集头部含 J1.30 条目（巴巴鸡案档案+地址）',
    qsSrc.includes('* J1.30（2026-10-14') && qsSrc.includes(TOKEN_ADDR), null);
  // P1 配套：img-v3 + visible_text + maxTokens 2500 + config 显式覆盖同步
  const svcSrc = readFileSync(join(__dirname, '..', 'src', 'narrative', 'analyzer', 'services', 'image-analysis-service.mjs'), 'utf8');
  check('F6 P1 根因修复：版本 img-v3', svcSrc.includes("const IMAGE_PROMPT_VERSION = 'img-v3'"), null);
  check('F7 P1：prompt 含 visible_text 逐字转写指令', svcSrc.includes('"visible_text"') && svcSrc.includes('图内可见文字逐字转写'), null);
  check('F8 P1：_callVision 默认 maxTokens 2500（1500 截断根因）', svcSrc.includes('vision.maxTokens || 2500'), null);
  const cfg = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'narrative-engine.json'), 'utf8'));
  check('F9 P1：config vision.maxTokens 显式覆盖同步 2500（不改会被旧值 1500 压回）',
    cfg.vision?.maxTokens === 2500, cfg.vision?.maxTokens);
  check('F10 窗口缓存失效脚本配套（J1.28/J1.29 模式）',
    readFileSync(join(__dirname, '..', 'scripts', 'narrative', 'invalidate-nameimage-window.cjs'), 'utf8').length > 0, null);

  // ═══ G. C86 D-1 量级门豁免贯穿（D/E 档臂，2026-10-17 用户裁定「豁免应贯穿」）═══
  // 病根：量级门 D/E 档臂在门链中先于 Stage3 豁免执行——J1.30 豁免无 tier 前置
  // （图证据+一致性+弱关联三门），主体量级弱但名图视觉一致的票在到达豁免前被
  // 「事件主体量级不足」拦死 = 遗漏。修复：豁免票落入标准数学按 tierScore=0 计分
  // （弱量级代价在总分），punExempt 臂（要求 S/A）结构性死守保留=防定义漂移
  console.log('\n── G. D-1 量级门 D/E 档臂豁免贯穿 ──');

  // G1 事故反证：D 档（magnitude 1）+ 全条件名图票 → 修复前 事件主体量级不足（D档）
  // 拦死；修复后流入标准数学 tierScore=0：0+28+15=43<60 再被事件分臂豁免放行。
  // web3_fit 刻意置 undefined 摘掉巴巴鸡夹具的 strong_fit 锚（锚上会把 D 档抬成
  // effTier B，绕不进 D/E 臂——锚救票是 J1.23 机制，与本节正交）
  const rG1 = mapStandardAnswers(babaJiAnswers(NIC_MATCH, {
    event_magnitude: { score: 1, probabilities: { '1': 0.7 } },
    web3_fit: undefined,
  }), stdCtx());
  const s2G1 = rG1.stage2DataToSave?.parsed_output || {};
  check('G1a D 档名图票：stage2 放行（pass=true + totalScore=43 + tierScore=0 精确值）',
    s2G1.pass === true && s2G1.scoringResult?.totalScore === 43 && s2G1.scoringResult?.tierScore === 0,
    { pass: s2G1.pass, totalScore: s2G1.scoringResult?.totalScore, tierScore: s2G1.scoringResult?.tierScore });
  check('G1b stage2 reason 双臂救援标注（J1.30名图：D档臂与事件分<60臂不拦）',
    /量级门豁免\(J1\.30名图：D档臂与事件分<60臂不拦，弱量级代价在总分\)/.test(s2G1.reason || ''),
    s2G1.reason);
  check('G1c 放行后正常计分：stage3 pass + imgNameExempt 审计 + 关联 5 分照常计入',
    rG1.stage3DataToSave?.parsed_output?.pass === true
      && !!stage3Jev(rG1)?.imgNameExempt
      && rG1.stage3DataToSave?.parsed_output?.relevanceScore === 5,
    { pass: rG1.stage3DataToSave?.parsed_output?.pass, imgNameExempt: stage3Jev(rG1)?.imgNameExempt });

  // G2 对照：无图证据（imageEvidence=false）同 D 档 → 量级门照拦（豁免三门 fail-closed）
  const rG2 = mapStandardAnswers(babaJiAnswers(NIC_MATCH, {
    event_magnitude: { score: 1, probabilities: { '1': 0.7 } },
    web3_fit: undefined,
  }), stdCtx({ imageEvidence: false }));
  const s2G2 = rG2.stage2DataToSave?.parsed_output || {};
  check('G2 无图 D 档：仍拦 事件主体量级不足（D档）+ stage3 清段',
    s2G2.pass === false && s2G2.blockReason === '事件主体量级不足（D档）'
      && rG2.stage3DataToSave?.__clear === true,
    { pass: s2G2.pass, blockReason: s2G2.blockReason });

  // G3 对照：E 档 + 图证据在但一致性不足（unrelated 0.15<0.5）→ 量级门照拦
  const rG3 = mapStandardAnswers(babaJiAnswers(NIC_UNRELATED, {
    event_magnitude: { score: 0, probabilities: { '0': 0.8 } },
    web3_fit: undefined,
  }), stdCtx());
  const s2G3 = rG3.stage2DataToSave?.parsed_output || {};
  check('G3 E 档一致性 0.15<0.5：仍拦 事件主体量级不足（E档）',
    s2G3.pass === false && s2G3.blockReason === '事件主体量级不足（E档）',
    { blockReason: s2G3.blockReason });

  // ═══ 汇总 ═══
  console.log(`\n══════ _test_name_image_consistency: ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('单测异常:', e); process.exit(1); });
