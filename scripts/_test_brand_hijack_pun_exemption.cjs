#!/usr/bin/env node
/**
 * J1.24 戏谑关联豁免（punExempt）——本地零 DB 单测（2026-10-01 用户裁定，C40
 * Binance Inu 案 0xcaf66eb2c00d206d741a654face34768cf2a7777）
 *
 * 裁定原话：「这里我觉得不是『劫持』，而是一种web3用户特有的戏谑/趣味性关联。
 * 当然它也必须得是当前的热门新鲜事，否则就成了无病呻吟了」
 *
 * 豁免条件（全中才豁免）：includeBrandHijack 且 brandHijackP≥0.5 +
 * timing within_7d（当前）+ effTier S/A（热门）+ credibleEventAnchor（可信事件源）
 * 豁免范围：品牌劫持截断 + relevance≤10 截断（弱字面关联是戏谑关联固有属性）；
 * 计分照常。misspelling/quality 门不豁免；brandHijackP<0.5 的普通弱关联票不豁免。
 *
 * 覆盖：
 *   A. 豁免矩阵：C40 BI Inu 实测 answers 数值复现（D类+A档+within_7d+0.72 →
 *      豁免 → 不截断正常计分）/ timing 缺 / tier 缺 / anchor 缺 / P<0.5 / 预检未命中
 *   B. relevance 二层接力豁免：全条件+semantic lv1（10分）不拦 /
 *      P<0.5 的普通弱关联票仍拦 / misspelling 不豁免
 *   C. 审计与 reason：stage3 jev.punExempt 落位 / reason 前缀
 *   D. 源码接线：mapper punExempt / analyzer credibleEventAnchor / 题面豁免③ /
 *      superIP 路径一期不挂豁免
 *   E. 版本断言 J1.24
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
// category D 0.78 / magnitude 4档带(A) / within_7d 0.96 / brand_hijack noul 0.72 /
// name_referent super_ip 0.79 / relevance semantic lv1（10分，压 ≤10 截断线）
const biTokenData = { symbol: 'BI', name: 'Binance Inu', raw_api_data: { name: 'Binance Inu' } };

function biAnswers({ timing = 'within_7d', magnitude = 4, hijackP = 0.72, relType = 'semantic', relLevel = 1.2, misspell = 0.1 } = {}) {
  return {
    event_category: { choice: 'D', probabilities: { D: 0.78, W: 0.19, B: 0.02 } },
    event_magnitude: { score: magnitude, probabilities: { '5': 0.43, '4': 0.25 } },
    event_timing: { choice: timing, probabilities: { [timing]: 0.96 } },
    dimension2: { score: 3.5, probabilities: { '4': 0.5, '3': 0.3 } },
    block_reason: { choice: 'none', probabilities: { none: 0.37, low_quality_derivative: 0.18 } },
    name_referent: { choice: 'super_ip', probabilities: { super_ip: 0.79 } },
    relevance_type: { choice: relType, probabilities: { [relType]: 0.47, none: 0.2, exact_match: 0.12 } },
    relevance_level: { score: relLevel, probabilities: { '1': 0.57, '0': 0.22 } },
    brand_hijack: { noul: hijackP },
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

  // A5 brandHijackP 0.49 <0.5 → 本就不拦，punExempt 不生效（审计 null）
  const m5 = mapStandardAnswers(biAnswers({ hijackP: 0.49 }), makeContext());
  const s5 = stage3Of(m5);
  check('A5 P=0.49：不被劫持门拦，punExempt 审计 null',
    s5.blockReason !== '品牌劫持' && !s5.jev?.punExempt,
    { blockReason: s5.blockReason, punExempt: s5.jev?.punExempt });

  // A6 预检未命中（无品牌关键词）→ 根本没有 brand_hijack 题，punExempt 恒 false
  const m6 = mapStandardAnswers(biAnswers(), makeContext({ includeBrandHijack: false }));
  const s6 = stage3Of(m6);
  check('A6 includeBrandHijack=false：jev.brandHijackP null + punExempt null',
    s6.jev?.brandHijackP === null && !s6.jev?.punExempt,
    { brandHijackP: s6.jev?.brandHijackP, punExempt: s6.jev?.punExempt });

  console.log('\n── B. relevance 二层接力豁免 ──');

  // B1 全条件豁免 + semantic lv1（10 分压线）→ 不被「关联性不足」接力拦
  // （A1 已覆盖，此处显式断言拦截点不是关联性）
  check('B1 豁免票拦截点非关联性（relevance=10 计分照常）',
    s1.pass === true && s1.relevanceScore === 10,
    { pass: s1.pass, relevanceScore: s1.relevanceScore });

  // B2 brandHijackP<0.5 的普通弱关联票 → 仍被关联性截断（豁免不吃 widen）
  const m7 = mapStandardAnswers(biAnswers({ hijackP: 0.3 }), makeContext());
  const s7 = stage3Of(m7);
  check('B2 P=0.3 + relevance 10：普通弱关联票仍被「关联性不足」拦',
    s7.pass === false && /关联性不足/.test(s7.blockReason || ''),
    { blockReason: s7.blockReason });

  // B3 misspelling 高 → 豁免票仍拦（不豁免范围）
  const m8 = mapStandardAnswers(biAnswers({ misspell: 0.8 }), makeContext());
  const s8 = stage3Of(m8);
  check('B3 misspellingP=0.8：豁免票仍被「无背景拼写错误」拦',
    s8.pass === false && s8.blockReason === '无背景拼写错误',
    { blockReason: s8.blockReason });

  console.log('\n── C. 审计与 reason ──');

  check('C1 punExempt 审计含 timing/tier（Jev 原判 P 保留在 brandHijackP）',
    s1.jev?.punExempt?.timing === 'within_7d' && s1.jev?.punExempt?.tier === 'A'
      && s1.jev?.brandHijackP === 0.72,
    s1.jev);
  check('C2 llmResult.reason 带「戏谑关联豁免」标记',
    /戏谑关联豁免\(J1\.24\)/.test(m1.llmResult?.reason || ''),
    m1.llmResult?.reason);

  console.log('\n── D. 源码接线 ──');

  const fs = require('fs');
  const mapperSrc = fs.readFileSync('src/narrative/analyzer/llm/jev-result-mapper.mjs', 'utf8');
  const analyzerSrc = fs.readFileSync('src/narrative/analyzer/NarrativeAnalyzer.mjs', 'utf8');
  const questionsSrc = fs.readFileSync('src/narrative/analyzer/llm/jev-questions.mjs', 'utf8');

  check('D1 mapper：punExempt 定义 + 两处截断链放行（brand_hijack 与 relevance）',
    /const punExempt = /.test(mapperSrc)
      && /brandHijackP >= 0\.5 && !punExempt/.test(mapperSrc)
      && /relevance\.score <= 10 && !punExempt/.test(mapperSrc));
  check('D2 analyzer：credibleEventAnchor 三来源（superIP/issuer/官方认证）传入 mapper',
    /credibleEventAnchor: !!\(superIPInfo \|\| issuerDetected \|\| binanceSquareInfo\?\.authorVerified\)/.test(analyzerSrc));
  check('D3 题面：豁免③含戏谑关联语义 + 新鲜事锚条件',
    /戏谑性关联是meme创作手法而非劫持/.test(questionsSrc) && /无新鲜事件锚时纯玩品牌词根才是劫持/.test(questionsSrc));
  // D4 superIP 快车道（mapSuperIPAnswers）一期不挂豁免——范围断言
  const superipSeg = mapperSrc.slice(mapperSrc.indexOf('mapSuperIPAnswers'));
  check('D4 superIP 路径一期不挂 punExempt（版本注释+台账记观察点）',
    !superipSeg.includes('punExempt'));
  check('D5 预检函数对 C40 票命中（Binance Inu 含 binance 关键词）',
    shouldIncludeBrandHijackCheck('BI', 'Binance Inu') === true);

  console.log('\n── E. 版本断言 ──');
  check('E1 JEV_QUESTIONS_VERSION === J1.25（J1.24 裁定仍在 mapper；题集 J1.25 = subject_unqualified 主体口径修正）', JEV_QUESTIONS_VERSION === 'J1.25', JEV_QUESTIONS_VERSION);

  console.log(`\n═══════ ${passed} passed, ${failed} failed ═══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('SUITE ERROR', e); process.exit(1); });
