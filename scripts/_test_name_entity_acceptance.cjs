#!/usr/bin/env node
/**
 * J1.56（C126 何一「こんにちは」案）币名映射实体接受度轴 + 作者原话票
 * ——本地零 DB 零网络单测
 *
 * 用户裁定（2026-10-20）：
 *   ①「super_ip 本来就应该使用语料作者身份」——作者在册 ∧ 币名逐字出自主推
 *      → 作者原话票（authorUtterance），C88 第一腿补位；不要求 Jev 在币名实体题
 *      里因作者身份升档（问候语如实 no_entity）。
 *   ②「name_referent 改成『币名映射实体对 Web3 用户的接受度/影响力』」——
 *      三选项 accepted / unknown / no_entity；unknown ≥0.5 开确定性拦截门
 *      （旧 J1.10 nrBlock 规格：B/C/D/F/G/W），no_entity 中性不拦。
 *   ③命名从用户视角出发：题/门/审计键随对象显式化（本测试锁新键名）。
 *
 * 覆盖：
 *   A. detectAuthorUtterance：CJK 问候语命中 / 只认主推不认父推 / ASCII 词边界 /
 *      symbol 兜底 / 单字符与空文本不命中
 *   B. C88 第一腿双源：accepted≥0.5 / authorUtterance=true（no_entity 问候语票）
 *   C. unknown 实体低影响力门：B/C/D/F/G/W 域拦、A/E 域不拦、0.49 不拦、
 *      no_entity 中性、审计 nameEntityLowMass 恒落
 *   D. 源码口径：谓词/门/作用域/state 作者侧键名（防回潮）
 *
 * 用法：node scripts/_test_name_entity_acceptance.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

function baseAnswers(cat, entity) {
  return {
    event_category: { choice: cat, probabilities: { [cat]: 0.7 } },
    web3_user_event_impact: { score: 4.6, probabilities: { '4': 0.5, '5': 0.3 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.9 } },
    web3_user_event_spread: { score: 25, probabilities: { '5': 0.6, '4': 0.3 } },
    event_token_block_reason: { choice: 'none', probabilities: { none: 0.92 } },
    web3_user_name_entity_acceptance: entity,
    name_entity_memeability: { score: 3, probabilities: {} },
    web3_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.85, fit: 0.1 } },
    event_subject_entity: { choice: 'other_entity', probabilities: { other_entity: 0.7 } },
    name_event_relevance: { choice: 'exact_match', probabilities: { exact_match: 0.8 } },
    name_entity_carrier: { choice: 'existing_entity', probabilities: { existing_entity: 0.8 } },
    token_name_quality: { score: 3, probabilities: {} },
  };
}

function makeContext(extra = {}) {
  return {
    tokenData: { symbol: 'TST', name: 'TST', raw_api_data: { name: 'TST' } },
    twitterInfo: { text: 'test tweet', in_reply_to: null },
    includeBrandHijack: false,
    credibleEventAnchor: true,
    tweetClassification: null,
    callInfo: { model: 'stub', questions: {}, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
    ...extra,
  };
}

function stage2Of(mapped) { return mapped?.stage2DataToSave?.parsed_output || {}; }
function stage3Of(mapped) { return mapped?.stage3DataToSave?.parsed_output || {}; }

async function main() {
  const { detectAuthorUtterance } = await import('../src/narrative/analyzer/utils/narrative-utils.mjs');
  const { mapStandardAnswers } = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const fs = require('fs');
  const path = require('path');

  console.log('\n── A. detectAuthorUtterance（作者原话票代码事实）──');

  const cjkTok = { symbol: 'こんにちは', name: 'こんにちは' };
  const cjkTw = { text: 'こんにちは💛.', in_reply_to: null };
  const hitCjk = detectAuthorUtterance(cjkTok, cjkTw);
  check('A1 CJK 问候语逐字出自主推 → hit（symbol/name 双候选）',
    hitCjk?.hit === true && hitCjk.matchedName === 'こんにちは' && hitCjk.source === 'main_tweet',
    hitCjk);
  check('A2 只认主推：词只出现在父推（in_reply_to.text）→ 不命中（他人文本不构成作者原话）',
    detectAuthorUtterance(cjkTok, { text: 'hello', in_reply_to: { text: 'こんにちは' } }) === null);
  check('A3 币名不在主推文本 → null',
    detectAuthorUtterance(cjkTok, { text: '今日はいい天気' }) === null);
  check('A4 ASCII 词边界：cat 命中 "my cat is cute"，不命中 "concatenate"',
    detectAuthorUtterance({ symbol: 'cat', name: 'cat' }, { text: 'my cat is cute' })?.hit === true
    && detectAuthorUtterance({ symbol: 'cat', name: 'cat' }, { text: 'concatenate strings' }) === null);
  check('A5 symbol 兜底：name 不匹配但 symbol 逐字命中',
    detectAuthorUtterance({ symbol: 'lfg', name: 'Long Flow' }, { text: 'LFG 🚀' })?.hit === true);
  check('A6 单字符名不做逐字匹配（C11 哦案变体拦截维持）',
    detectAuthorUtterance({ symbol: 'o', name: 'o' }, { text: 'o' }) === null);
  check('A7 空文本/twitterInfo null → null',
    detectAuthorUtterance(cjkTok, { text: '' }) === null
    && detectAuthorUtterance(cjkTok, null) === null);

  console.log('\n── B. C88 第一腿双源（accepted≥0.5 ∨ authorUtterance）──');

  // 五腿其余四腿由 baseAnswers 天然满足：relPositive exact 0.8 / relNone 缺省 1?
  // ——exact 0.8 且有 none 键缺失时 relNoneMass=none??1；需补 none 0 才 <0.5
  const mk = (entity) => {
    const a = baseAnswers('C', entity);
    a.name_event_relevance = { choice: 'exact_match', probabilities: { exact_match: 0.8, none: 0.02 } };
    return a;
  };
  const mAcc = mapStandardAnswers(mk({ choice: 'accepted', probabilities: { accepted: 0.8 } }), makeContext());
  check('B1 accepted 0.8 → recognizedEntitySlogan.hit=true（accepted 腿）',
    stage2Of(mAcc).jev?.recognizedEntitySlogan?.hit === true
    && stage2Of(mAcc).jev?.recognizedEntitySlogan?.accepted === 0.8
    && stage2Of(mAcc).jev?.recognizedEntitySlogan?.authorUtterance === false,
    stage2Of(mAcc).jev?.recognizedEntitySlogan);

  const mUtter = mapStandardAnswers(mk({ choice: 'no_entity', probabilities: { no_entity: 0.9 } }), makeContext({ authorUtterance: true }));
  check('B2 no_entity 问候语票 + authorUtterance=true → hit=true（作者身份补位，C126 核心）',
    stage2Of(mUtter).jev?.recognizedEntitySlogan?.hit === true
    && stage2Of(mUtter).jev?.recognizedEntitySlogan?.accepted === 0
    && stage2Of(mUtter).jev?.recognizedEntitySlogan?.authorUtterance === true,
    stage2Of(mUtter).jev?.recognizedEntitySlogan);

  const mNoUtter = mapStandardAnswers(mk({ choice: 'no_entity', probabilities: { no_entity: 0.9 } }), makeContext());
  check('B3 no_entity 且无作者原话事实 → hit=false（不靠 Jev 升档）',
    stage2Of(mNoUtter).jev?.recognizedEntitySlogan?.hit === false
    && stage2Of(mNoUtter).jev?.recognizedEntitySlogan?.authorUtterance === false,
    stage2Of(mNoUtter).jev?.recognizedEntitySlogan);

  console.log('\n── C. unknown 实体低影响力门（规格=旧 J1.10 nrBlock）──');

  for (const cat of ['B', 'C', 'D', 'F', 'G', 'W']) {
    const m = mapStandardAnswers(baseAnswers(cat, { choice: 'unknown', probabilities: { unknown: 0.6 } }), makeContext());
    check(`C1-${cat} unknown 0.6 → 实体门拦（${cat} 在域内）`,
      stage2Of(m).pass === false && /币名映射实体在 Web3 用户侧无名/.test(stage2Of(m).blockReason || '')
      && stage2Of(m).jev?.nameEntityLowMass === 0.6,
      { blockReason: stage2Of(m).blockReason });
  }
  for (const cat of ['A', 'E']) {
    const m = mapStandardAnswers(baseAnswers(cat, { choice: 'unknown', probabilities: { unknown: 0.6 } }), makeContext());
    check(`C2-${cat} unknown 0.6 → 不拦（${cat} 刻意不在实体门域）`,
      stage2Of(m).jev?.nameEntityLowMass === null,
      { blockReason: stage2Of(m).blockReason, mass: stage2Of(m).jev?.nameEntityLowMass });
  }
  const m049 = mapStandardAnswers(baseAnswers('C', { choice: 'unknown', probabilities: { unknown: 0.49 } }), makeContext());
  check('C3 unknown 0.49 <0.5 → 不拦（概率门槛）',
    stage2Of(m049).jev?.nameEntityLowMass === null, stage2Of(m049).jev?.nameEntityLowMass);
  const mNone = mapStandardAnswers(baseAnswers('C', { choice: 'no_entity', probabilities: { no_entity: 0.9 } }), makeContext());
  check('C4 no_entity 中性：不拦（问候语/截词责任交名字形态门）',
    stage2Of(mNone).jev?.nameEntityLowMass === null && stage2Of(mNone).jev?.nameEntityAcceptance === 'no_entity',
    { mass: stage2Of(mNone).jev?.nameEntityLowMass, choice: stage2Of(mNone).jev?.nameEntityAcceptance });
  // C133（股城案用户裁定）：新项目/新品牌等刚诞生且已在 BSC 用户群发出信息的新实体
  // → new_entity，不按「用户不认得」拦（与已存在但无认知的 unknown 区分）
  const mNew = mapStandardAnswers(baseAnswers('C', { choice: 'new_entity', probabilities: { new_entity: 0.62, unknown: 0.25 } }), makeContext());
  check('C4b new_entity 0.62 → 不触实体门（新实体不是无名老实体，C133）',
    stage2Of(mNew).jev?.nameEntityLowMass === null && stage2Of(mNew).jev?.nameEntityAcceptance === 'new_entity'
    && !/币名映射实体在 Web3 用户侧无名/.test(stage2Of(mNew).blockReason || ''),
    { mass: stage2Of(mNew).jev?.nameEntityLowMass, choice: stage2Of(mNew).jev?.nameEntityAcceptance, blockReason: stage2Of(mNew).blockReason });
  const mNewSplit = mapStandardAnswers(baseAnswers('C', { choice: 'new_entity', probabilities: { new_entity: 0.46, unknown: 0.4 } }), makeContext());
  check('C4c new_entity argmax + unknown 0.40 <0.5 → 不拦（概率门槛不变）',
    stage2Of(mNewSplit).jev?.nameEntityLowMass === null, stage2Of(mNewSplit).jev?.nameEntityLowMass);

  console.log('\n── C2. J1.58 empty_content 作者在册豁免 ──');

  const mkEmpty = () => {
    const a = baseAnswers('C', { choice: 'no_entity', probabilities: { no_entity: 0.9 } });
    a.event_token_block_reason = { choice: 'event_empty_content', probabilities: { event_empty_content: 0.36, none: 0.16 } };
    return a;
  };
  const mEmptyPlain = mapStandardAnswers(mkEmpty(), makeContext());
  check('C5 empty_content 无作者事实 → 照拦（空洞内容）',
    stage2Of(mEmptyPlain).pass === false && /空洞内容/.test(stage2Of(mEmptyPlain).blockReason || '')
    && stage2Of(mEmptyPlain).jev?.emptyContentAuthorOverride === null,
    { blockReason: stage2Of(mEmptyPlain).blockReason });
  const mEmptyAuthor = mapStandardAnswers(mkEmpty(), makeContext({ corpusAuthorInRegistry: true }));
  check('C6 empty_content + 作者在册 → 豁免（J1.58 高影响力主体问候=事件素材）',
    stage2Of(mEmptyAuthor).jev?.emptyContentAuthorOverride != null
    && !/空洞内容/.test(stage2Of(mEmptyAuthor).blockReason || ''),
    { blockReason: stage2Of(mEmptyAuthor).blockReason, audit: stage2Of(mEmptyAuthor).jev?.emptyContentAuthorOverride });

  console.log('\n── D. 源码口径（防回潮）──');

  const mapperSrc = fs.readFileSync(path.join(__dirname, '..', 'src/narrative/analyzer/llm/jev-result-mapper.mjs'), 'utf8');
  const stateSrc = fs.readFileSync(path.join(__dirname, '..', 'src/narrative/analyzer/llm/jev-state-builder.mjs'), 'utf8');
  const qsSrc = fs.readFileSync(path.join(__dirname, '..', 'src/narrative/analyzer/llm/jev-questions.mjs'), 'utf8');
  check('D1 五腿第一腿=accepted ∨ authorUtterance',
    /const recognizedEntitySlogan = \(entityAcceptedProb >= 0\.5 \|\| authorUtterance\)/.test(mapperSrc));
  check('D2 实体门函数与作用域常量（B/C/D/F/G/W；unknown≥0.5）',
    /function nameEntityLowBlock\(answers, category\)/.test(mapperSrc)
    && /NAME_ENTITY_LOW_BLOCK_SCOPE = \['B', 'C', 'D', 'F', 'G', 'W'\]/.test(mapperSrc)
    && /probabilities\?\.unknown \?\? 0/.test(mapperSrc));
  check('D3 骑乘改道退役反证（rideDetourMass 不存在）',
    !/function rideDetourMass\(answers, category\)/.test(mapperSrc));
  check('D4 state 作者侧键名 corpus_author_identity（与币名题彻底分开）',
    stateSrc.includes('corpus_author_identity:') && stateSrc.includes('corpus_author_identity_note:')
    && !stateSrc.includes('super_ip_hit:'));
  check('D5c J1.65-J1.67 名字门超IP词句臂（模拟 BSC 链 Meme 玩家、不套词表）+ 版本词反锚（C126/C105）',
    qsSrc.includes('对 BSC 链 Meme 币用户有特殊影响力的主体本人说出的、玩家会当符号用的词句')
    && qsSrc.includes('即便逐字出自高影响力主体的原话也不接纳')
    && qsSrc.includes('模拟 BSC 链 Meme 币买家看到这句话的反应，不是套词表') && qsSrc.includes('BSC 链 Meme 币玩家群体里的特殊影响力') && qsSrc.includes('日常陈述、个人行动、礼貌套话'), null);
  check('D5b block reason 选项按对象前缀化（event_* / token_*，J1.59）',
    qsSrc.includes('event_token_block_reason:')
    && qsSrc.includes('event_empty_content:') && qsSrc.includes('event_institution_routine:')
    && qsSrc.includes('event_negative_hard_news:') && qsSrc.includes('event_routine_content_product:')
    && qsSrc.includes('token_ip_reuse:') && qsSrc.includes('token_circle_reachability:'));
  check('D5 题集四选项（含 new_entity）+ 作者身份不升档红线 + 版本 J1.72（C133 新实体批次）',
    qsSrc.includes("web3_user_name_entity_acceptance: {")
    && /accepted:/.test(qsSrc) && /unknown:/.test(qsSrc) && /new_entity:/.test(qsSrc) && /no_entity:/.test(qsSrc)
    && qsSrc.includes('作者身份本身不是映射')
    && qsSrc.includes('新实体 ≠ 无名实体')
    && /JEV_QUESTIONS_VERSION = 'J1\.72'/.test(qsSrc));

  console.log(`\n══════ ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('SUITE ERROR', e); process.exit(1); });
