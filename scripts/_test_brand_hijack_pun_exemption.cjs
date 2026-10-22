#!/usr/bin/env node
/**
 * J1.24 戏谑关联豁免（punExempt）——本地零 DB 单测（2026-10-01 用户裁定，C40
 * Binance Inu 案 0xcaf66eb2c00d206d741a654face34768cf2a7777）
 *
 * 裁定原话：「这里我觉得不是『劫持』，而是一种web3用户特有的戏谑/趣味性关联。
 * 当然它也必须得是当前的热门新鲜事，否则就成了无病呻吟了」
 *
 * J1.85/C143（2026-10-21 用户裁定「C」）：品牌劫持题 name_brand_hijack 整题退役，
 * 判据并入 web3_user_name_entity_acceptance.brand_mismatch 桶。punExempt 信号
 * 改吃 brandMismatchP（实体题 brand_mismatch 概率）；keyword 预检
 * （shouldIncludeBrandHijackCheck）保留为门开关——非品牌关键词票恒不启用。
 *
 * 豁免条件（全中才豁免）：includeBrandHijack（关键词预检）且 brandMismatchP≥0.5 +
 * timing within_7d（当前）+ effTier S/A（热门）+ credibleEventAnchor（可信事件源）
 * 豁免范围：品牌劫持截断 + relevance≤10 截断（弱字面关联是戏谑关联固有属性）；
 * 计分照常。misspelling/quality 门不豁免；brandMismatchP<0.5 的普通弱关联票不豁免。
 *
 * 覆盖：
 *   A. 豁免矩阵：C40 BI Inu 实测 answers 数值复现（D类+A档+within_7d+0.72 →
 *      豁免 → 不截断正常计分）/ timing 缺 / tier 缺 / anchor 缺 / P<0.5 / 预检未命中
 *   B. relevance 二层接力豁免：全条件+semantic lv1（10分）不拦 /
 *      P<0.5 的普通弱关联票仍拦 / misspelling 不豁免
 *   C. 审计与 reason：stage3 jev.punExempt/brandMismatchP 落位 / reason 前缀
 *   D. 源码接线：mapper punExempt / entity brand_mismatch 桶 / analyzer credibleEventAnchor /
 *      旧题彻底退役 / 预检开关
 *   E. 版本断言 J1.87
 *
 * 用法：node scripts/_test_brand_hijack_pun_exemption.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

// ── C40 BI Inu 实测 answers 快照（造行实验 2026-10-01，DB 实证）────────────────
// category D 0.78 / magnitude 4档带(A) / within_7d 0.96 / entity accepted 0.79 +
// brand_mismatch 0.72（J1.85 前为 name_brand_hijack noul 0.72）/ relevance
// semantic lv1（10分，压 ≤10 截断线）。J1.79：事件分/tier 改由 web3_user_event_fit
// 派生——fixture 以 fit=magnitude/5 复现原事件分（magnitude 4→fit 0.8→80 分 A 档；
// 3→0.6→60 分 B 档），strong_fit 刻意 0 避免 C88 实体口号票五腿顺手豁免劫持门
// 污染豁免矩阵。
const biTokenData = { symbol: 'BI', name: 'Binance Inu', raw_api_data: { name: 'Binance Inu' } };

function biAnswers({ timing = 'within_7d', magnitude = 4, brandMismatchP = 0.72, relType = 'semantic', relLevel = 1.2, misspell = 0.1, dim2Score = 3.5 } = {}) {
  return {
    event_category: { choice: 'D', probabilities: { D: 0.78, W: 0.19, B: 0.02 } },
    event_magnitude: { score: magnitude, probabilities: { '5': 0.43, '4': 0.25 } },
    web3_user_event_fit: { choice: 'fit', probabilities: { strong_fit: 0, fit: magnitude / 5 } },
    event_timing: { choice: timing, probabilities: { [timing]: 0.96 } },
    dimension2: { score: dim2Score, probabilities: { '4': 0.5, '3': 0.3 } },
    event_quality_veto: { choice: 'none', probabilities: { none: 0.37, low_quality_derivative: 0.18 } },
    // J1.85/C143：品牌信号改落实体题 brand_mismatch 概率（choice 仍 accepted——
    // 本 fixture 的品牌本身是圈内符号级；门只看 brand_mismatch 概率）
    web3_user_name_entity_acceptance: { choice: 'accepted', probabilities: { accepted: 0.79, brand_mismatch: brandMismatchP } },
    name_event_relevance: { choice: relType, probabilities: { [relType]: 0.47, none: 0.2, exact_match: 0.12 } },
    relevance_level: { score: relLevel, probabilities: { '1': 0.57, '0': 0.22 } },
    block_misspelling: { noul: misspell },
    quality_spelling: { score: 6 },
    quality_reasonability: { score: 4 },
  };
}

function makeContext({ includeBrandHijack = true, credibleEventAnchor = true, tokenData = biTokenData } = {}) {
  return {
    tokenData,
    includeBrandHijack,
    credibleEventAnchor,
    tweetClassification: null,
    twitterInfo: null,
    callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  };
}

function stage3Of(mapped) {
  return mapped?.stage3DataToSave?.parsed_output || {};
}

async function main() {
  const { mapStandardAnswers } = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const { JEV_QUESTIONS_VERSION, shouldIncludeBrandHijackCheck } = await import('../src/narrative/analyzer/llm/jev-questions.mjs');

  console.log('\n── A. 豁免矩阵（品牌劫持门） ──');

  // A1 C40 数值复现：全条件命中 → 豁免 → 不截断正常计分
  const m1 = mapStandardAnswers(biAnswers(), makeContext());
  const s1 = stage3Of(m1);
  check('A1 全条件命中：豁免劫持截断（pass + blockReason null + punExempt 审计落位）',
    s1.pass === true && s1.blockReason === null && !!s1.jev?.punExempt,
    { pass: s1.pass, blockReason: s1.blockReason, punExempt: s1.jev?.punExempt });
  check('A1b 正常计分：category mid/high（relevance 10 分照常计入）',
    s1.category_agg === 'mid' || s1.category_agg === 'high',
    s1.category_agg);

  // A2 timing 非 within_7d（within_30d）→ 无病呻吟方向，维持拦截
  const m2 = mapStandardAnswers(biAnswers({ timing: 'within_30d' }), makeContext());
  const s2 = stage3Of(m2);
  check('A2 timing=within_30d：不豁免，维持「品牌劫持」拦截',
    s2.pass === false && s2.blockReason === '品牌劫持' && !s2.jev?.punExempt,
    { pass: s2.pass, blockReason: s2.blockReason });

  // A3 量级不足（B 档）→ 不豁免
  const m3 = mapStandardAnswers(biAnswers({ magnitude: 3 }), makeContext());
  const s3 = stage3Of(m3);
  check('A3 tier=B（事件不够热门）：不豁免，维持拦截',
    s3.pass === false && s3.blockReason === '品牌劫持',
    { blockReason: s3.blockReason });

  // A4 可信事件源缺（小道消息语料）→ 不豁免
  const m4 = mapStandardAnswers(biAnswers(), makeContext({ credibleEventAnchor: false }));
  const s4 = stage3Of(m4);
  check('A4 credibleEventAnchor=false：不豁免，维持拦截',
    s4.pass === false && s4.blockReason === '品牌劫持',
    { blockReason: s4.blockReason });

  // A5 brandMismatchP 0.49 <0.5 → 本就不拦，punExempt 不生效（审计 null）
  const m5 = mapStandardAnswers(biAnswers({ brandMismatchP: 0.49 }), makeContext());
  const s5 = stage3Of(m5);
  check('A5 P=0.49：不被劫持门拦，punExempt 审计 null',
    s5.blockReason !== '品牌劫持' && !s5.jev?.punExempt,
    { blockReason: s5.blockReason, punExempt: s5.jev?.punExempt });

  // A6 预检未命中（无品牌关键词）→ 门开关关闭，punExempt 恒 false
  const m6 = mapStandardAnswers(biAnswers(), makeContext({ includeBrandHijack: false }));
  const s6 = stage3Of(m6);
  check('A6 includeBrandHijack=false：jev.brandMismatchP null + punExempt null + 品牌门不触发',
    s6.jev?.brandMismatchP === null && !s6.jev?.punExempt && s6.blockReason !== '品牌劫持',
    { brandMismatchP: s6.jev?.brandMismatchP, punExempt: s6.jev?.punExempt, blockReason: s6.blockReason });

  console.log('\n── B. relevance 二层接力豁免 ──');

  // B1 全条件豁免 + semantic lv1（10 分压线）→ 不被「关联性不足」接力拦
  check('B1 豁免票拦截点非关联性（relevance=10 计分照常）',
    s1.pass === true && s1.relevanceScore === 10,
    { pass: s1.pass, relevanceScore: s1.relevanceScore });

  // B2 brandMismatchP<0.5 的普通弱关联票 → 仍被关联性截断（豁免不吃 widen）
  const m7 = mapStandardAnswers(biAnswers({ brandMismatchP: 0.3 }), makeContext());
  const s7 = stage3Of(m7);
  check('B2 P=0.3 + relevance 10：普通弱关联票仍被「关联性不足」拦',
    s7.pass === false && /关联性不足/.test(s7.blockReason || ''),
    { blockReason: s7.blockReason });

  // B3 misspelling 高 → C108 探针臂退役不拦（C78 实证死键；无背景拼写判据并入
  // name_form 分支④，图文对照 C78 代码门独立保留）
  const m8 = mapStandardAnswers(biAnswers({ misspell: 0.8 }), makeContext());
  const s8 = stage3Of(m8);
  check('B3 misspellingP=0.8：C108 探针退役不再拦（豁免票照过；拼写判据并入 name_form）',
    s8.pass === true && s8.blockReason == null,
    { blockReason: s8.blockReason });

  console.log('\n── C. 审计与 reason ──');

  check('C1 punExempt 审计含 timing/tier（实体题 brand_mismatch 概率保留在 brandMismatchP）',
    s1.jev?.punExempt?.timing === 'within_7d' && s1.jev?.punExempt?.tier === 'A'
      && s1.jev?.brandMismatchP === 0.72,
    s1.jev);
  check('C2 llmResult.reason 带「戏谑关联豁免」标记',
    /戏谑关联豁免\(J1\.24\)/.test(m1.llmResult?.reason || ''),
    m1.llmResult?.reason);

  console.log('\n── D. 源码接线 ──');

  const fs = require('fs');
  const mapperSrc = fs.readFileSync('src/narrative/analyzer/llm/jev-result-mapper.mjs', 'utf8');
  const analyzerSrc = fs.readFileSync('src/narrative/analyzer/NarrativeAnalyzer.mjs', 'utf8');
  const questionsSrc = fs.readFileSync('src/narrative/analyzer/llm/jev-questions.mjs', 'utf8');

  check('D1 mapper：punExempt 定义 + 两处截断链放行（brand_mismatch 与 relevance）',
    /const punExempt = /.test(mapperSrc)
      && /brandMismatchP >= 0\.5 && !punExempt/.test(mapperSrc)
      && /relevance\.score <= 10 && !punExempt/.test(mapperSrc));
  check('D2 analyzer：credibleEventAnchor 三来源（superIP/issuer/官方认证）传入 mapper',
    /credibleEventAnchor: !!\(superIPInfo \|\| issuerDetected \|\| binanceSquareInfo\?\.authorVerified\)/.test(analyzerSrc));
  check('D3 品牌劫持题已整题退役（题集无 name_brand_hijack；实体题含 brand_mismatch 桶）',
    !questionsSrc.includes('name_brand_hijack: {')
      && questionsSrc.includes('brand_mismatch:')
      && !/brandHijackP\s*:/.test(mapperSrc)
      && !/answers\.name_brand_hijack/.test(mapperSrc));
  // C83：mapSuperIPAnswers 快车道删除——J1.24 戏谑豁免对 superIP 语料票经标准
  // 路径 credibleEventAnchor（superIPInfo 项真实可达）终结「一期不挂」欠账
  check('D4 superIP 快车道已删（punExempt 经标准路径对 superIP 语料可达）',
    !mapperSrc.includes('mapSuperIPAnswers'));
  check('D5 预检函数对 C40 票命中（Binance Inu 含 binance 关键词）',
    shouldIncludeBrandHijackCheck('BI', 'Binance Inu') === true);

  console.log('\n── E. 版本断言 ──');
  check('E1 JEV_QUESTIONS_VERSION = J1.90（J1.90=C152 MEMES fit 锚；J1.90=C152 MEMES fit 锚；J1.89=C151 哭哭奶龙 wrong_entity 修正；J1.88=C150 删 event_institution_routine 桶；J1.87=C145 删 routine 桶；J1.86=C143 校准；J1.85=C143 品牌劫持并入实体轴）',
    JEV_QUESTIONS_VERSION === 'J1.100', JEV_QUESTIONS_VERSION);

  // ═══ F. C86 D-1 量级门豁免贯穿（2026-10-17 用户裁定「豁免应贯穿」）═══
  // 病根：Stage2 量级门在 else-if 门链中先于 Stage3 豁免语义执行——全条件戏谑票
  // 若事件分<60 会在到达豁免前被「事件分不足」拦死（豁免只挂 Stage3 截断=遗漏）。
  // 修复：豁免判定前移至门链前，事件分不足臂对 magExempt 票放行；弱量级代价照常
  // 在总分（0.6×低事件分）上体现——与豁免「relevance 10 分照常计入」同款计分语义
  console.log('\n── F. D-1 量级门豁免贯穿 ──');

  // F1 事故反证：全条件戏谑票 + J1.79 fit 0.8→80（A 档）——修复前 事件分不足（59<60）拦死；修复后放行计分
  const mF1 = mapStandardAnswers(biAnswers({ dim2Score: 1 }), makeContext());
  const s2F1 = mF1.stage2DataToSave?.parsed_output || {};
  check('F1a J1.79 fit 口径：全条件戏谑票事件分 strong0+fit80→80（A 档≥70，<60 臂结构性不可达）stage2 放行',
    s2F1.pass === true && s2F1.scoringResult?.eventCompositeScore === 80,
    { pass: s2F1.pass, totalScore: s2F1.scoringResult?.eventCompositeScore });
  check('F1b J1.79：事件分≥60 不落量级门豁免标注（<60 臂由 imgNameExempt 在 G1a 覆盖）',
    !/量级门豁免/.test(s2F1.reason || ''),
    s2F1.reason);
  check('F1c 放行后正常计分：stage3 pass + punExempt 审计 + rating 非 stage2 拦截形状',
    stage3Of(mF1).pass === true && !!stage3Of(mF1).jev?.punExempt
      && mF1.llmResult.pass === true && mF1.llmResult.analysis_stage === 3,
    { pass: stage3Of(mF1).pass, stage: mF1.llmResult.analysis_stage });

  // F2 对照：anchor 缺（punExempt 关）同分数 → stage2 放行、stage3 品牌劫持截断
  const mF2 = mapStandardAnswers(biAnswers({ dim2Score: 1 }), makeContext({ credibleEventAnchor: false }));
  const s2F2 = mF2.stage2DataToSave?.parsed_output || {};
  check('F2 无锚同分数：J1.79 fit 80 直接过线（stage2 pass；stage3 仍被品牌劫持截断）',
    s2F2.pass === true && s2F2.scoringResult?.eventCompositeScore === 80
      && mF2.llmResult.rating === 'low',
    { pass: s2F2.pass, rating: mF2.llmResult.rating, blockReason: stage3Of(mF2).blockReason });

  // F3 W 数学 pass 线刻意不豁免（设计锁定）：W 类戏谑票 W 总分不足照拦——W 有
  // 自己的 cashtag 改道拦截语义，量级门不属于 W 数学。J1.84/C142 起 W 为单轴
  // （吸引力 0-75 + 时效 25，pass 57）：夹具吸引力 1.0 → 19，+25=44<57 拦。
  const wAns = {
    ...biAnswers(),
    event_category: { choice: 'W', probabilities: { W: 0.9 } },
    w_product_score: { score: 0.5, probabilities: {} }, // J1.84 起零消费
    w_bsc_user_appeal: { score: 1.0, probabilities: {} },
  };
  const mF3 = mapStandardAnswers(wAns, makeContext());
  const s2F3 = mF3.stage2DataToSave?.parsed_output || {};
  check('F3 W 类戏谑票（吸引力19<32）：W 总分不足照拦（豁免不贯穿 W 数学）',
    s2F3.pass === false && s2F3.blockReason === 'W类总分不足（19<32）'
      && !/量级门豁免/.test(s2F3.reason || ''),
    { pass: s2F3.pass, blockReason: s2F3.blockReason });

  // F4 源码口径：D/E 臂守卫 + 事件分不足臂守卫 + W pass 线保持裸线（各恰好一处）
  const mapperSrcF = require('fs').readFileSync('src/narrative/analyzer/llm/jev-result-mapper.mjs', 'utf8');
  check('F4a D/E 量级臂带双豁免守卫（punExempt 臂结构性死守=防定义漂移）',
    /\(effTier === 'E' \|\| effTier === 'D'\) && !punExempt && !imgNameExempt/.test(mapperSrcF));
  check('F4b 事件分不足臂 = eventCompositeScore < 60 && !magExempt',
    /eventScoreBlocked = eventCompositeScore < 60 && !magExempt;/.test(mapperSrcF));
  check('F4c W 数学 pass 线保持裸线（J1.91 起 eventScoreBlocked = eventCompositeScore < 32; 恰好一处=W 分支）',
    mapperSrcF.split('eventScoreBlocked = eventCompositeScore < 32;').length - 1 === 1);

  console.log(`\n═══════ ${passed} passed, ${failed} failed ═══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('SUITE ERROR', e); process.exit(1); });
