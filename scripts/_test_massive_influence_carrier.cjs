#!/usr/bin/env node
/**
 * C161/J1.97 巨大影响力事件载体门豁免单测（2026-10-21 80억분의1 网站案）——零 DB 零网络
 *
 * 用户裁定：「需要形象载体是大部分情况，某则 meme 币没有一个落脚点。但是对于
 * 影响力巨大的事件（这个网站确实爆火），是应该可以豁免的」。
 *
 * 口径：event_influence=massive（全球/全网/跨平台/主流报道）→ 载体门不拦
 * （C/D/E 三类载体门；审计 subjectCarrierMassiveInfluenceExempt）。
 * notable/limited/旧缓存缺失 → 不豁免（fail-closed，存量行为不变）。
 *
 * 节：
 *   A. E + massive + no_visual → pass + 审计
 *   B. E + notable / 缺失 → 载体门照拦
 *   C. D + massive + no_visual → pass（覆盖 C/D 门域）
 *   D. C + massive + improvised → pass（覆盖 improvised 档）
 *   E. 题集/源码口径锁
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

  console.log('── A. E + massive + no_visual ──');
  const rA = mapStandardAnswers(answers(), ctx(VIRAL_TEXT));
  check('A1 pass（载体门豁免）', rA.llmResult.pass === true, rA.llmResult.reason);
  check('A2 audit subjectCarrierMassiveInfluenceExempt',
    s2jev(rA).subjectCarrierMassiveInfluenceExempt?.influence === 'massive'
      && s2jev(rA).subjectCarrierMassiveInfluenceExempt?.carrier === 'no_visual_entity',
    s2jev(rA).subjectCarrierMassiveInfluenceExempt);
  check('A3 eventInfluence 恒落观察', s2jev(rA).eventInfluence === 'massive', s2jev(rA).eventInfluence);

  console.log('── B. E + notable / 缺失 ──');
  const rB = mapStandardAnswers(answers({
    event_influence: { choice: 'notable', probabilities: { massive: 0.1, notable: 0.85, limited: 0.05 } },
  }), ctx(VIRAL_TEXT));
  check('B1 notable → 载体门照拦', rB.llmResult.rating === 'low' && (rB.llmResult.reason || '').includes('无形象载体'), rB.llmResult.reason);
  check('B2 audit null', s2jev(rB).subjectCarrierMassiveInfluenceExempt === null, s2jev(rB).subjectCarrierMassiveInfluenceExempt);
  const rB2 = mapStandardAnswers(answers({ event_influence: undefined }), ctx(VIRAL_TEXT));
  check('B3 旧缓存行缺 event_influence → 不豁免（fail-closed）',
    rB2.llmResult.rating === 'low' && s2jev(rB2).subjectCarrierMassiveInfluenceExempt === null,
    { reason: rB2.llmResult.reason, audit: s2jev(rB2).subjectCarrierMassiveInfluenceExempt });

  console.log('── C. D + massive + no_visual ──');
  const rC = mapStandardAnswers(answers({
    event_category: { choice: 'D', probabilities: { D: 0.8 } },
    web3_user_name_entity_acceptance: { choice: 'accepted', probabilities: { accepted: 0.9 } },
  }), ctx(VIRAL_TEXT));
  check('C1 pass（C/D 门域覆盖）', rC.llmResult.pass === true, rC.llmResult.reason);
  check('C2 audit 命中', s2jev(rC).subjectCarrierMassiveInfluenceExempt?.influence === 'massive', s2jev(rC).subjectCarrierMassiveInfluenceExempt);

  console.log('── D. C + massive + improvised ──');
  const rD = mapStandardAnswers(answers({
    event_category: { choice: 'C', probabilities: { C: 0.8 } },
    web3_user_name_entity_acceptance: { choice: 'accepted', probabilities: { accepted: 0.9 } },
    web3_user_entity_visuality: { choice: 'improvised_entity', probabilities: { improvised_entity: 0.9 } },
  }), ctx(VIRAL_TEXT));
  check('D1 pass（improvised 档覆盖）', rD.llmResult.pass === true, rD.llmResult.reason);
  check('D2 audit carrier=improvised', s2jev(rD).subjectCarrierMassiveInfluenceExempt?.carrier === 'improvised_entity', s2jev(rD).subjectCarrierMassiveInfluenceExempt);

  console.log('── E. 题集/源码口径 ──');
  const qm = await import(qPath);
  const qs = qm.buildStandardQuestions({});
  check('E1 event_influence 题在册（3 档）',
    qs.event_influence?.type === 'choice'
      && (qs.event_influence?.criteria?.massive || '').includes('全球级')
      && (qs.event_influence?.criteria?.notable || '').includes('单一平台')
      && (qs.event_influence?.criteria?.limited || '').includes('小范围'), Object.keys(qs));
  const instr = qs.event_influence?.instructions || '';
  check('E2 判据区分全球/跨平台 vs 单一平台热搜 + 明确锚',
    instr.includes('全球级/全网级爆火') && instr.includes('单一平台热搜') && instr.includes('明确锚（J1.97/C161）'), null);
  const src = readFileSync(mapperPath, 'utf8');
  check('E3 mapper massive 早退 + 审计键 + 选项接线',
    src.includes('if (opts?.massiveInfluenceCarrierExempt) return null;')
      && src.includes('subjectCarrierMassiveInfluenceExempt')
      && src.includes('massiveInfluenceCarrierExempt,'), null);

  console.log(`\n结果: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
