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
 * J1.81/C139（2026-10-21 用户裁定三轴重构）：
 *   ①实体题加第五桶 wrong_entity（指歪/指残：无背景拼写错/不忠实呈现/版本残片）
 *     ——全域拦截位（wrongEntityBlock，prob≥0.5，A/E 域也拦）；no_entity 断代改名
 *     not_entity（中性不拦）。C105 版本词臂+C108 拼写臂拦截责任从词句题迁入。
 *   ②词句题改名 web3_user_phrase_acceptability 并收窄：只评 not_entity 形状
 *     （entity choice ∈ {accepted,unknown,new_entity,wrong_entity} → 跳过；
 *     no_entity 旧行/缺失照评=存量 bit 不变）。
 *   ③载体题改名 web3_user_entity_visuality（本测试只锁实体轴，载体轴见
 *     _test_subject_carrier.cjs）。
 *
 * 覆盖：
 *   A. detectAuthorUtterance：CJK 问候语命中 / 只认主推不认父推 / ASCII 词边界 /
 *      symbol 兜底 / 单字符与空文本不命中
 *   B. C88 第一腿双源：accepted≥0.5 / authorUtterance=true（no_entity 问候语票）
 *   C. unknown 实体低影响力门：B/C/D/F/G/W 域拦、A/E 域不拦、0.49 不拦、
 *      no_entity 中性、审计 nameEntityLowMass 恒落
 *   E. J1.81 wrong_entity 全域拦截位 + 词句门收窄分流 + 审计 nameWrongEntityMass
 *   D. 源码口径：谓词/门/作用域/state 作者侧键名（防回潮）/题集五桶键名断代
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
    event_quality_veto: { choice: 'none', probabilities: { none: 0.92 } },
    web3_user_name_entity_acceptance: entity,
    name_entity_memeability: { score: 3, probabilities: {} },
    web3_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.85, fit: 0.1 } },
    event_subject_entity: { choice: 'other_entity', probabilities: { other_entity: 0.7 } },
    name_event_relevance: { choice: 'exact_match', probabilities: { exact_match: 0.8 } },
    web3_user_entity_visuality: { choice: 'existing_entity', probabilities: { existing_entity: 0.8 } }, // J1.81 新键（mapper 双键读旧行）
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
  check('C4 no_entity 中性：不拦（J1.81 断代改名 not_entity；此处旧 choice 形状=存量行重放；问候语/截词责任交词句门）',
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
    a.event_quality_veto = { choice: 'event_empty_content', probabilities: { event_empty_content: 0.36, none: 0.16 } };
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

  console.log('\n── E. J1.81/C139 三轴重构行为 ──');

  // wrong_entity 全域拦截位（prob≥0.5，A/E 域也拦——与 ne 门（B/C/D/F/G/W）刻意不同）
  const we = (cat, p) => {
    const a = baseAnswers(cat, { choice: 'wrong_entity', probabilities: { wrong_entity: p } });
    return a;
  };
  const mWeC = mapStandardAnswers(we('C', 0.6), makeContext());
  check('E1 wrong_entity 0.6（C 类）→ 拦 + reason 指歪/指残 + 审计 nameWrongEntityMass=0.6',
    stage2Of(mWeC).pass === false && /指歪|指残/.test(stage2Of(mWeC).blockReason || '')
    && stage2Of(mWeC).jev?.nameWrongEntityMass === 0.6,
    { blockReason: stage2Of(mWeC).blockReason, mass: stage2Of(mWeC).jev?.nameWrongEntityMass });
  const mWeA = mapStandardAnswers(we('A', 0.6), makeContext());
  check('E2 wrong_entity 0.6（A 类）→ 照拦（全域拦截位，不随类别放行——ne 门 A/E 不拦的对照）',
    stage2Of(mWeA).pass === false && /指歪|指残/.test(stage2Of(mWeA).blockReason || ''),
    stage2Of(mWeA).blockReason);
  const mWeE = mapStandardAnswers(we('E', 0.6), makeContext());
  check('E2b wrong_entity 0.6（E 类）→ 照拦（全域）',
    stage2Of(mWeE).pass === false && /指歪|指残/.test(stage2Of(mWeE).blockReason || ''),
    stage2Of(mWeE).blockReason);
  const mWe045 = mapStandardAnswers(we('C', 0.45), makeContext());
  check('E3 wrong_entity 0.45 <0.5 → 不拦（概率门槛）+ nameWrongEntityMass=null',
    stage2Of(mWe045).jev?.nameWrongEntityMass === null, stage2Of(mWe045).jev?.nameWrongEntityMass);

  // 词句门收窄分流：实体票不经词句门
  const na = { choice: 'web3_user_not_acceptable', probabilities: { web3_user_not_acceptable: 0.9 } };
  const accPhrase = baseAnswers('C', { choice: 'accepted', probabilities: { accepted: 0.8 } });
  accPhrase.web3_user_phrase_acceptability = na;
  const mAccP = mapStandardAnswers(accPhrase, makeContext());
  check('E4 实体票（accepted）+ 词句答案 not_acceptable → 词句门跳过不拦（收窄：实体票名字质量归实体/形象轴）',
    !/词句接纳度门/.test(stage2Of(mAccP).blockReason || ''), stage2Of(mAccP).blockReason);
  const nePhrase = baseAnswers('C', { choice: 'not_entity', probabilities: { not_entity: 0.8 } });
  nePhrase.web3_user_phrase_acceptability = na;
  const mNeP = mapStandardAnswers(nePhrase, makeContext());
  check('E5 not_entity 票 + 词句 not_acceptable → 词句门拦（本题唯一管辖形状）',
    stage2Of(mNeP).pass === false && /词句接纳度门/.test(stage2Of(mNeP).blockReason || ''),
    stage2Of(mNeP).blockReason);
  const oldRow = baseAnswers('C', { choice: 'no_entity', probabilities: { no_entity: 0.9 } });
  oldRow.web3_user_name_acceptability = { choice: 'not_meme_name', probabilities: { not_meme_name: 0.9 } }; // J1.50 前更旧键
  const mOldRow = mapStandardAnswers(oldRow, makeContext());
  check('E6 旧缓存行（entity choice=no_entity + 旧键 name_form 系 not_meme_name）→ 照拦（旧行 bit 不变：no_entity/缺失才评）',
    stage2Of(mOldRow).pass === false && /接纳度门|词句/.test(stage2Of(mOldRow).blockReason || ''),
    stage2Of(mOldRow).blockReason);
  const wrongPhrase = baseAnswers('C', { choice: 'wrong_entity', probabilities: { wrong_entity: 0.3, accepted: 0.5 } });
  wrongPhrase.web3_user_phrase_acceptability = na;
  const mWP = mapStandardAnswers(wrongPhrase, makeContext());
  check('E7 wrong_entity choice（prob<0.5 未拦）+ 词句 not_acceptable → 词句门跳过（choice 分流不看 prob）',
    !/词句接纳度门/.test(stage2Of(mWP).blockReason || ''), stage2Of(mWP).blockReason);

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
  check('D5c J1.65-J1.67 名字门超IP词句臂（模拟 BSC 链 Meme 玩家、不套词表）+ 版本词反锚（C126/C105）+ J1.80/C138 超IP来源判据段',
    qsSrc.includes('对 BSC 链 Meme 币用户有特殊影响力的主体本人说出的、玩家会当符号用的词句')
    && qsSrc.includes('即便逐字出自高影响力主体的原话也不接纳')
    && qsSrc.includes('模拟 BSC 链 Meme 币买家看到这句话的反应，不是套词表') && qsSrc.includes('BSC 链 Meme 币玩家群体里的特殊影响力') && qsSrc.includes('日常陈述、个人行动、礼貌套话')
    && qsSrc.includes('超级IP来源判据（J1.80/C138）')
    && qsSrc.includes('即使是超级IP即影响力超大的用户讲的话，也完全当不了符号，完全不适合作为 meme 币，不会产生购买意愿')
    && qsSrc.includes('币名「heyi.ai」=其代称「heyi」+.ai 概念后缀')
    && qsSrc.includes('官方措辞引用臂（J1.94/C157）')
    && qsSrc.includes('采信该陈述、不要求验证来源/页面'), null);
  check('D5d J1.89/C151 有意义的错版/二创造型不选 wrong_entity（哭哭奶龙案锚）',
    qsSrc.includes('有独立背景故事/文化来源的**有意义变形不选 wrong_entity**')
    && qsSrc.includes('错版奶龙→哭哭奶龙')
    && qsSrc.includes('不选本项（J1.89/C151）'), null);
  check('D5b block reason 选项按对象前缀化（event_* / token_*，J1.59）+ J1.87/C145 删 routine + J1.88/C150 删 institution + J1.101/C170 删 nhn',
    qsSrc.includes('event_quality_veto:')
    && qsSrc.includes('event_empty_content:') && !qsSrc.includes('event_institution_routine:')
    && !qsSrc.includes('event_negative_hard_news:') && !qsSrc.includes('event_routine_content_product:')
    && qsSrc.includes('token_ip_reuse:') && !qsSrc.includes('token_circle_reachability: {')); // J1.82/C140 圈层桶退役（并行会话同批）
  const entSeg = qsSrc.slice(qsSrc.indexOf('web3_user_name_entity_acceptance: {'), qsSrc.indexOf('web3_user_entity_visuality: {'));
  check('D5 题集实体题六桶（J1.94/C157 官方措辞引用臂；J1.93/C156 题键改名；J1.92/C155 name_event_relevance 3 桶；J1.91/C154 时效体系清理；J1.90/C152 MEMES fit 锚；J1.89/C151 哭哭奶龙 wrong_entity 修正；J1.88/C150 删 institution 桶；J1.87/C145 删 routine 桶；J1.86/C143 校准：accepted/unknown/new_entity/wrong_entity/brand_mismatch/not_entity；no_entity 断代退役）+ 作者身份不升档红线 + 版本 J1.99（C162/C163 批）；J1.84=C142 W 双轴合并单轴；J1.83=C141 event_subject_entity 题退役（判据并入 event_fit unfit 桶+门一般化 web3FitMassBlock：sf+fit<0.5 全域拦）；J1.82=C140 圈层可达性并入 event_fit（并行会话同批）；J1.81=C139 三轴重构；J1.80=C138 超IP来源判据追加段）',
    qsSrc.includes("web3_user_name_entity_acceptance: {")
    && /accepted:/.test(entSeg) && /unknown:/.test(entSeg) && /new_entity:/.test(entSeg)
    && /wrong_entity:/.test(entSeg) && /not_entity:/.test(entSeg) && !/no_entity:/.test(entSeg)
    && !/brand_mismatch:/.test(entSeg)
    && entSeg.includes('指歪') && entSeg.includes('这是拦截位（全域）')
    && qsSrc.includes('作者身份本身不是映射')
    && qsSrc.includes('新实体 ≠ 无名实体')
    && /JEV_QUESTIONS_VERSION = 'J1\.106'/.test(qsSrc));
  check('D6 J1.81 键名断代：词句题 web3_user_phrase_acceptability 在册；载体题 web3_user_entity_visuality 已随 C171 形象轴退役（题删除）；旧键 name_form:/web3_user_name_acceptability:/name_entity_carrier: 退役',
    /web3_user_phrase_acceptability: \{/.test(qsSrc) && !/web3_user_entity_visuality: \{/.test(qsSrc)
    && !/^ {4}(name_form|web3_user_name_acceptability|name_entity_carrier): \{/m.test(qsSrc));
  // D7（J1.104/C174，TREE 0xd50e11204f7f3d63598b0118ee4151bf95917777 案）：
  // 「被命名+被讲故事的故事主体」三锚在场——instructions ⚠️ 段+new_entity criteria
  // 主锚（含逃逸门：语料无命名行为的普通词蹭名票不适用）+not_entity criteria 反锚。
  // 修复面：Jev 曾判 TREE not_entity 0.47（new_entity 0.09）→ J1.139 结构下 not_entity
  // 触发词句题 not_acceptable 0.59 拦 low；锚正后 new_entity → 词句题跳过 → ≈81 high
  check('D7 J1.104/C174 故事主体锚三点在场（instructions ⚠️ 段+new_entity 主锚+not_entity 反锚）+逃逸门',
    qsSrc.includes('被命名+被讲故事的故事主体是新实体（J1.104/C174')
    && qsSrc.includes('不因名字字面是普通词（树/猫/橙子）判 not_entity')
    && qsSrc.includes('语料已陈述命名行为/已讲故事的主体（有明确所指，如 BNB Tree）不属本项')
    && qsSrc.includes('币名=普通词而语料无命名行为的蹭名票不满足本锚') && qsSrc.includes('语料无命名行为的普通词蹭名票不适用本锚'),
    null);

  // D8（J1.105/C175，京小安 0xcb98accaa8040a7e839c305b8aca08e113c87777 案）：
  // 用户裁定「『首款AI警犬』给实体定了性质，能被 web3 用户接受是根本的，而不是
  // 知名/广泛报道」——性质定义优先于认知度：三锚在场+逃逸门（空泛自称不适用）
  check('D8 J1.105/C175 性质定义优先于认知度锚三点在场（instructions ⚠️ 段+accepted 主锚+unknown 反锚）+逃逸门',
    qsSrc.includes('性质定义优先于认知度（J1.105/C175，京小安案）')
    && qsSrc.includes('不以「实体是否知名/被广泛报道/评估者是否听说过该实体」为前提')
    && qsSrc.includes('性质定义即接纳证据（J1.105/C175）')
    && qsSrc.includes('不以知名/被广泛报道为前提（判据=可接纳性非认知度）')
    && qsSrc.includes('name/语料已给出明确可接纳的性质定义（如「首款AI警犬」）的不属本项（→ accepted，J1.105/C175）')
    && qsSrc.includes('空泛自称（无具体角色内容的「官方币/年度最强」式口号）不满足「明确定义性质」'),
    null);

  // D9（J1.106/C175b，C96 币安上电视 0xc6d089d749409f7646de440d637ac9db0e047777 案）：
  // C175 上线回归 C96 稳定翻 high 实锤（实体题 accepted 0.40/not_entity 0.33 近 tie
  // 掷 accepted → J1.139 词句题只评 not_entity 票 → 「Web3 用户不接纳该名字」拦截位
  // 失效放行）——性质定义锚补陈述句反锚：陈述句/事件描述式名字不构成性质定义，
  // 句中提及著名实体不因此 accepted，仍归 not_entity 由词句题接管
  check('D9 J1.106/C175b 陈述句反锚在场（性质定义=定身份非说事 + 提及著名实体不因此 accepted + 仍归 not_entity 词句题接管）',
    qsSrc.includes('反锚（J1.106/C175b，币安上电视案）')
    && qsSrc.includes('「性质定义」是**给币名主体定身份**')
    && qsSrc.includes('名字是**陈述句/事件描述**')
    && qsSrc.includes('不构成性质定义，即便句中提及著名实体也**不因此 accepted**')
    && qsSrc.includes('陈述句名字仍归 not_entity（名字不构成对该实体的命名），由词句题接管接纳判定'),
    null);

  console.log(`\n══════ ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('SUITE ERROR', e); process.exit(1); });
