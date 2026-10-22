#!/usr/bin/env node
/**
 * C161 巨大影响力事件载体豁免——**J1.102/C171 退役反证单测**（零 DB 零网络，
 * 2026-10-22 改写）
 *
 * 案史：C161（2026-10-21 80억분의1 案，用户裁定「如果事件本身是一个巨大影响力
 * 事件，是全球爆火的，是应该可以豁免的」）立 event_influence 三档题（massive/
 * notable/limited）+ massiveInfluenceCarrierExempt 臂（massive → 豁免载体门）。
 * 臂的宿主是 J1.29 载体门——C171 形象轴整轴退役后无宿主随门删除：题退役
 * （唯一消费点=载体豁免，死题不白烧 fan-out token）、mapper 计算（eventInfluence/
 * massiveInfluenceCarrierExempt/carrierWouldBlock）删除、审计键（eventInfluence/
 * subjectCarrierMassiveInfluenceExempt）停产出。
 *
 * 案票终态变化：80억분의1（E 类 massive+no_visual）C161 时靠豁免臂放行，C171 后
 * 载体门整体不存在 → strong_fit 0.9 事件分高直接放行（豁免需求消失）。泛影响力
 * 票的「事件分」本身就在量影响力，massive 不再单独豁免任何门。
 *
 * 覆盖：
 *   A. 案票终态：80억분의1 形状（massive+no_visual）→ 放行（无需豁免臂）
 *   B. 题退役：event_influence 任何形状不再产出；旧缓存行残留键 mapper 不读
 *   C. 源码口径：mapper 无 massiveInfluenceCarrierExempt/eventInfluence 活代码
 *      （防复活）
 *   D. 审计键：eventInfluence/subjectCarrierMassiveInfluenceExempt 不产出
 *      （历史行保留展示）
 *   E. 版本：J1.102+（C171）
 *
 * 用法：node scripts/_test_massive_influence_carrier.cjs
 */
'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

const mapperPath = join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-result-mapper.mjs');
const qPath = join(__dirname, '..', 'src', 'narrative', 'analyzer', 'llm', 'jev-questions.mjs');

function answers(overrides = {}) {
  return {
    event_category: { choice: 'E', probabilities: { E: 0.78, B: 0.22 } },
    event_finding_vs_recap: { choice: 'news_recap', probabilities: { news_recap: 1 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.98 } },
    event_quality_veto: { choice: 'none', probabilities: { none: 0.99 } },
    // 旧缓存行形状：event_influence 键在场（J1.102 后 mapper 不读）
    event_influence: { choice: 'massive', probabilities: { massive: 0.8, notable: 0.15, limited: 0.05 } },
    web3_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.6, fit: 0.3, marginal: 0.05, unfit: 0.05 } },
    web3_user_name_event_acceptance: { choice: 'exact_match', probabilities: { exact_match: 0.98 } },
    web3_user_name_entity_acceptance: { choice: 'unknown', probabilities: { unknown: 0.54, new_entity: 0.27 } },
    web3_user_entity_visuality: { choice: 'no_visual_entity', probabilities: { no_visual_entity: 0.99 } },
    web3_user_phrase_acceptability: { choice: 'web3_user_not_acceptable', probabilities: { web3_user_not_acceptable: 0.56 } },
    token_name_quality: { score: 2.74, probabilities: {} },
    ...overrides,
  };
}

function ctx(text, overrides = {}) {
  return {
    tokenData: { symbol: '80억분의1', name: '80억분의1', raw_api_data: { name: '80억분의1' } },
    includeBrandHijack: false,
    tweetClassification: null,
    twitterInfo: { author_screen_name: 'M_M_GA', author_followers_count: 571, text },
    imageEvidence: false,
    callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
    ...overrides,
  };
}

const VIRAL_TEXT = '这两天韩国爆火的一个人生模拟网站：80亿分之1，一经推出全球爆火，官网和维基百科都有报道';
const s2jev = (r) => r.stage2DataToSave?.parsed_output?.jev;

async function main() {
  const { mapStandardAnswers } = await import(mapperPath);

  // ═══ A. 案票终态（豁免需求消失）═══
  console.log('\n── A. 案票终态 ──');
  const rA = mapStandardAnswers(answers(), ctx(VIRAL_TEXT));
  check('A1 80억분의1 形状（E+massive+no_visual，C161 时靠豁免臂放行）→ C171 直接放行（载体门不存在）',
    rA.llmResult.rating !== 'low' && !(rA.llmResult.reason || '').includes('形象载体'),
    rA.llmResult.reason);
  check('A2 旧缓存行 event_influence 键在场无副作用（mapper 不读）',
    rA.llmResult.rating !== 'low', null);

  // ═══ B. 题退役 ═══
  console.log('\n── B. 题退役 ──');
  const { buildStandardQuestions } = await import(qPath);
  check('B1 event_influence 任何形状不再产出',
    !('event_influence' in buildStandardQuestions())
    && !('event_influence' in buildStandardQuestions({ imageConsistency: true })), null);

  // ═══ C. 源码口径（防复活）═══
  console.log('\n── C. 源码口径 ──');
  const mapperSrc = readFileSync(mapperPath, 'utf8');
  check('C1 mapper 无 eventInfluence/massiveInfluenceCarrierExempt 活代码（留档注释外零引用）',
    !/const eventInfluence/.test(mapperSrc) && !/const massiveInfluenceCarrierExempt/.test(mapperSrc)
    && !/massiveInfluenceCarrierExempt,/.test(mapperSrc), null);
  check('C2 mapper 无 carrierWouldBlock/carrierChoiceForAudit（审计辅助随门删）',
    !/const carrierWouldBlock/.test(mapperSrc) && !/const carrierChoiceForAudit/.test(mapperSrc), null);

  // ═══ D. 审计键 ═══
  console.log('\n── D. 审计键 ──');
  check('D1 stage2 段 eventInfluence/subjectCarrierMassiveInfluenceExempt 不产出（历史行保留展示）',
    !('eventInfluence' in s2jev(rA)) && !('subjectCarrierMassiveInfluenceExempt' in s2jev(rA)),
    { i: s2jev(rA).eventInfluence, m: s2jev(rA).subjectCarrierMassiveInfluenceExempt });

  // ═══ E. 版本 ═══
  console.log('\n── E. 版本 ──');
  const { JEV_QUESTIONS_VERSION } = await import(qPath);
  check('E1 JEV_QUESTIONS_VERSION ≥ J1.102（C171 形象轴整退役，massive 豁免臂随删）',
    parseInt(JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 102, JEV_QUESTIONS_VERSION);

  console.log(`\n结果: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('单测异常:', e); process.exit(1); });
