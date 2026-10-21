#!/usr/bin/env node
/**
 * J1.61（C126 收口）name_entity_memeability 删除并并入 web3_user_name_acceptability
 * ——本地零 DB 零网络单测
 *
 * 用户裁定（2026-10-20）：「name_entity_memeability 合并到
 * web3_user_name_acceptability 然后删除」——独立 0-5 分玩味题删除（题数 17→16→
 * 现基础 15），「内容载体/二创潜力」判断并入名字门：能接纳新增「所指对象有
 * 可玩/可二创的内容」臂、不能接纳新增「所指对象没有任何可玩内容」臂；C88 五腿
 * 去掉 mem≥2 腿（四腿）。
 *
 * 覆盖：
 *   A. 题集形状：name_entity_memeability 不存在；基础题数 15；名字门含玩味并入臂
 *   B. 门消费：acceptability=not_acceptable → 名字门拦（J1.61 唯一名字拦截位）；
 *      acceptable → 不拦（放行到后续门）
 *   C. 源码口径：mapper 无 answers.name_entity_memeability 读取；无 memScoreC88；
 *      live 行不再产出 referentMemeabilityScore；C88 四腿谓词
 *
 * 用法：node scripts/_test_referent_memeability.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

function baseAnswers(cat, acceptability) {
  return {
    event_category: { choice: cat, probabilities: { [cat]: 0.7 } },
    web3_user_event_impact: { score: 4.6, probabilities: { '4': 0.5, '5': 0.3 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.9 } },
    web3_user_event_spread: { score: 25, probabilities: { '5': 0.6, '4': 0.3 } },
    event_quality_veto: { choice: 'none', probabilities: { none: 0.92 } },
    // J1.81：词句门只评 not_entity 形状——基底刻意 not_entity（accepted 0.9 会被
    // 实体票分流跳过词句门 + 触发著名资格豁形象门，B1 专项形状失真）
    web3_user_name_entity_acceptance: { choice: 'not_entity', probabilities: { not_entity: 0.9, unknown: 0.05 } },
    web3_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.85, fit: 0.1 } },
    event_subject_entity: { choice: 'other_entity', probabilities: { other_entity: 0.9 } },
    name_event_relevance: { choice: 'exact_match', probabilities: { exact_match: 0.8, none: 0.02 } },
    name_entity_carrier: { choice: 'existing_entity', probabilities: { existing_entity: 0.8 } },
    web3_user_name_acceptability: acceptability,
    token_name_quality: { score: 3, probabilities: {} },
  };
}
function makeContext() {
  return {
    tokenData: { symbol: 'TST', name: 'TST', raw_api_data: { name: 'TST' } },
    twitterInfo: { text: 'test tweet', in_reply_to: null },
    includeBrandHijack: false,
    credibleEventAnchor: true,
    tweetClassification: null,
    callInfo: { model: 'stub', questions: {}, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  };
}

async function main() {
  const { buildStandardQuestions, JEV_QUESTIONS_VERSION } = await import('../src/narrative/analyzer/llm/jev-questions.mjs');
  const { mapStandardAnswers } = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const fs = require('fs');

  console.log('\n── A. 题集形状（J1.61）──');
  const qs = buildStandardQuestions();
  check('A1 基础题数 12（J1.84 删 w_product_score；J1.83 删 event_subject_entity；J1.79 删 web3_user_event_impact；J1.71 删 web3_user_event_spread；删 name_entity_memeability）', Object.keys(qs).length === 12, Object.keys(qs).length);
  check('A2 name_entity_memeability 已删除', !('name_entity_memeability' in qs));
  check('A3 词句题（J1.81 改名 web3_user_phrase_acceptability）含玩味并入臂（可玩/可二创 + 没有任何可玩）',
    qs.web3_user_phrase_acceptability.instructions.includes('可玩/可二创')
    && qs.web3_user_phrase_acceptability.criteria.web3_user_acceptable.includes('有可玩')
    && qs.web3_user_phrase_acceptability.criteria.web3_user_not_acceptable.includes('没有任何可玩'), null);
  check('A4 版本 J1.90（J1.90=C152 MEMES fit 锚；J1.90=C152 MEMES fit 锚；J1.89=C151 哭哭奶龙 wrong_entity 修正；J1.88=C150 删 event_institution_routine 桶；J1.87=C145 删 routine 桶；J1.86=C143 校准（题面锚点）；J1.85=C143 品牌劫持并入实体轴；J1.84=C142 W 双轴合并单轴；J1.83=C141 event_subject_entity 题退役（判据并入 event_fit unfit 桶+门一般化 web3FitMassBlock：sf+fit<0.5 全域拦）；J1.82=C140 圈层可达性并入 event_fit（并行会话同批）；J1.81=C139 名字三轴重构；J1.80=C138 名字门超IP来源判据（追加段，原判据零改动）；J1.79 事件分改 fit 单一来源，删 impact 题）', JEV_QUESTIONS_VERSION === 'J1.97', JEV_QUESTIONS_VERSION);

  console.log('\n── B. 名字门消费（J1.61 唯一名字拦截位）──');
  const mNo = mapStandardAnswers(baseAnswers('C', { choice: 'web3_user_not_acceptable', probabilities: { web3_user_not_acceptable: 0.85 } }), makeContext());
  const s2No = mNo.stage2DataToSave.parsed_output;
  check('B1 not_acceptable → 名字门拦', s2No.pass === false && /Web3 用户不接纳该名字/.test(s2No.blockReason || ''), { blockReason: s2No.blockReason });
  const mOk = mapStandardAnswers(baseAnswers('C', { choice: 'web3_user_acceptable', probabilities: { web3_user_acceptable: 0.85 } }), makeContext());
  const s2Ok = mOk.stage2DataToSave.parsed_output;
  check('B2 acceptable → 不拦（后续门/数学接管）', !/Web3 用户不接纳该名字/.test(s2Ok.blockReason || ''), { blockReason: s2Ok.blockReason });

  console.log('\n── C. 源码口径（J1.61）──');
  const mapperSrc = fs.readFileSync('src/narrative/analyzer/llm/jev-result-mapper.mjs', 'utf8');
  const qsSrc = fs.readFileSync('src/narrative/analyzer/llm/jev-questions.mjs', 'utf8');
  check('C1 mapper 无 answers.name_entity_memeability 读取', !mapperSrc.includes('answers.name_entity_memeability'));
  check('C2 mapper 无 memScoreC88（C88 四腿）', !mapperSrc.includes('memScoreC88')
    && /const recognizedEntitySlogan = \(entityAcceptedProb >= 0\.5 \|\| authorUtterance\)/.test(mapperSrc));
  check('C3 题集源码已无 name_entity_memeability 题定义', !/name_entity_memeability: \{/.test(qsSrc));

  console.log(`\n══════ ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('SUITE ERROR', e); process.exit(1); });
