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
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.9 } },
    web3_user_event_spread: { score: 25, probabilities: { '5': 0.6, '4': 0.3 } },
    web3_user_event_impact: { choice: 'none', probabilities: { none: 0.92 } }, // J1.110/C181 键名断代（J1.79 旧 score 题同键名已删，不得再喂 score 形状——撞名会遮蔽 veto）
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

  console.log('\n── C. 实体类型接纳门（J1.113/C184 恢复拦截：unknown 认知度轴断代 unacceptable_type 类型轴）──');

  for (const cat of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'W']) {
    const m = mapStandardAnswers(baseAnswers(cat, { choice: 'unacceptable_type', probabilities: { unacceptable_type: 0.6 } }), makeContext());
    check(`C1-${cat} unacceptable_type 0.6 → 拦（类型不合，可乐/银行/犬种学名类；C184b 全域——含 ${cat}）+ 审计 nameEntityTypeUnfitMass=0.6`,
      /币名实体类型不被 BSC meme 用户接纳/.test(stage2Of(m).blockReason || '')
      && stage2Of(m).jev?.nameEntityTypeUnfitMass === 0.6,
      { blockReason: stage2Of(m).blockReason, mass: stage2Of(m).jev?.nameEntityTypeUnfitMass });
  }
  // 断代反证：旧 unknown（认知度轴桶值）不归一读——历史缓存行零翻转，重析后自然更新
  for (const cat of ['B', 'C']) {
    const m = mapStandardAnswers(baseAnswers(cat, { choice: 'unknown', probabilities: { unknown: 0.6 } }), makeContext());
    check(`C1b-${cat} 旧 unknown 0.6 → 不拦（不归一读旧桶，J1.113 断代防线）`,
      stage2Of(m).jev?.nameEntityTypeUnfitMass === null && !/币名实体类型不被/.test(stage2Of(m).blockReason || ''),
      { blockReason: stage2Of(m).blockReason, mass: stage2Of(m).jev?.nameEntityTypeUnfitMass });
  }
  // C184b（2026-10-23 用户裁定方案一）快狗打车案事故现场反证：实体题 unacceptable_type
  // 0.9 但 event_category 掷骰 E（置信 0.32）→ 旧域 B/C/D/F/G/W 不含 E → miss 放行
  // high 86.57。类型不合与事件分类正交 → 去域限制全域拦（对齐 wrong_entity）
  for (const cat of ['A', 'E']) {
    const m = mapStandardAnswers(baseAnswers(cat, { choice: 'unacceptable_type', probabilities: { unacceptable_type: 0.9 } }), makeContext());
    check(`C2-${cat} 快狗案形状：unacceptable_type 0.9 → 拦（C184b 全域化——${cat} 不再域外豁免）+ 审计 mass=0.9`,
      /币名实体类型不被 BSC meme 用户接纳/.test(stage2Of(m).blockReason || '')
      && stage2Of(m).jev?.nameEntityTypeUnfitMass === 0.9,
      { blockReason: stage2Of(m).blockReason, mass: stage2Of(m).jev?.nameEntityTypeUnfitMass });
  }
  const m049 = mapStandardAnswers(baseAnswers('C', { choice: 'unacceptable_type', probabilities: { unacceptable_type: 0.49 } }), makeContext());
  check('C3 unacceptable_type 0.49 <0.5 → 不拦（概率门槛）',
    stage2Of(m049).jev?.nameEntityTypeUnfitMass === null, stage2Of(m049).jev?.nameEntityTypeUnfitMass);
  const mNone = mapStandardAnswers(baseAnswers('C', { choice: 'no_entity', probabilities: { no_entity: 0.9 } }), makeContext());
  check('C4 no_entity 中性：不拦（J1.81 断代改名 not_entity；此处旧 choice 形状=存量行重放；问候语/截词责任交词句门）',
    stage2Of(mNone).jev?.nameEntityTypeUnfitMass === null && stage2Of(mNone).jev?.nameEntityAcceptance === 'no_entity',
    { mass: stage2Of(mNone).jev?.nameEntityTypeUnfitMass, choice: stage2Of(mNone).jev?.nameEntityAcceptance });
  // J1.113/C184 删 new_entity 桶（类型不因新旧而变——性质没问题即可）——历史缓存行
  // 兼容反证：new_entity argmax 时概率和为 1，unacceptable_type 必 <0.5 天然不触门
  const mNew = mapStandardAnswers(baseAnswers('C', { choice: 'new_entity', probabilities: { new_entity: 0.62, unacceptable_type: 0.25 } }), makeContext());
  check('C4b 历史行 new_entity 0.62 → 不触类型门（桶已删 J1.113；argmax 时 unacceptable_type 必<0.5）',
    stage2Of(mNew).jev?.nameEntityTypeUnfitMass === null && stage2Of(mNew).jev?.nameEntityAcceptance === 'new_entity'
    && !/币名实体类型不被/.test(stage2Of(mNew).blockReason || ''),
    { mass: stage2Of(mNew).jev?.nameEntityTypeUnfitMass, choice: stage2Of(mNew).jev?.nameEntityAcceptance, blockReason: stage2Of(mNew).blockReason });

  console.log('\n── C2. J1.58 empty_content 作者在册豁免 ──');

  const mkEmpty = () => {
    const a = baseAnswers('C', { choice: 'no_entity', probabilities: { no_entity: 0.9 } });
    a.web3_user_event_impact = { choice: 'event_empty_content', probabilities: { event_empty_content: 0.36, none: 0.16 } };
    return a;
  };
  const mEmptyPlain = mapStandardAnswers(mkEmpty(), makeContext());
  check('C5 empty_content 无作者事实 → 照拦（空洞内容）',
    stage2Of(mEmptyPlain).pass === false && /空洞内容/.test(stage2Of(mEmptyPlain).blockReason || '')
    && stage2Of(mEmptyPlain).jev?.emptyContentAuthorOverride === null,
    { blockReason: stage2Of(mEmptyPlain).blockReason });
  // 三键归一读：旧缓存行（J1.82-J1.109 时代）只有 event_quality_veto 键，须照拦
  const aLegacy = mkEmpty(); delete aLegacy.web3_user_event_impact;
  aLegacy.event_quality_veto = { choice: 'event_empty_content', probabilities: { event_empty_content: 0.36, none: 0.16 } };
  const mLegacy = mapStandardAnswers(aLegacy, makeContext());
  check('C5b 旧键 event_quality_veto 缓存行回落照拦（J1.110 三键归一读）',
    stage2Of(mLegacy).pass === false && /空洞内容/.test(stage2Of(mLegacy).blockReason || ''),
    { blockReason: stage2Of(mLegacy).blockReason });
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
  check('E5 not_entity 票 + 词句 not_acceptable → 拦（C189 恢复：C96 币安上电视追裁「要不被实体拒绝，要不被口号拒绝」）+ 审计 choice 照落',
    /词句接纳度门/.test(stage2Of(mNeP).blockReason || '')
    && stage2Of(mNeP).jev?.web3UserAcceptabilityBlock?.choice === 'web3_user_not_acceptable',
    { blockReason: stage2Of(mNeP).blockReason, audit: stage2Of(mNeP).jev?.web3UserAcceptabilityBlock });
  const oldRow = baseAnswers('C', { choice: 'no_entity', probabilities: { no_entity: 0.9 } });
  oldRow.web3_user_name_acceptability = { choice: 'not_meme_name', probabilities: { not_meme_name: 0.9 } }; // J1.50 前更旧键
  const mOldRow = mapStandardAnswers(oldRow, makeContext());
  check('E6 旧缓存行（no_entity + 旧键 not_meme_name）→ 拦（C189 恢复同判）+ 审计 choice 照落（兼容读不变）',
    /词句接纳度门/.test(stage2Of(mOldRow).blockReason || '')
    && stage2Of(mOldRow).jev?.web3UserAcceptabilityBlock?.choice === 'not_meme_name',
    { blockReason: stage2Of(mOldRow).blockReason, audit: stage2Of(mOldRow).jev?.web3UserAcceptabilityBlock });
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
  check('D2 实体类型门函数（C184b 全域：无域常量/category 参数——类型不合与事件分类正交；unacceptable_type≥0.5；不归一读旧 unknown）——J1.113/C184 恢复拦截+C184b 方案一全域化',
    /function nameEntityTypeUnfitBlock\(answers\)\s*\{/.test(mapperSrc)
    && /const neBlock = nameEntityTypeUnfitBlock\(answers\);/.test(mapperSrc)
    && !/NAME_ENTITY_TYPE_UNFIT_SCOPE/.test(mapperSrc.replace(/ \* .*/g, ''))
    && /probabilities\?\.unacceptable_type \?\? 0/.test(mapperSrc)
    && !/nameEntityLowBlock\(/.test(mapperSrc.replace(/ \* .*/g, ''))); // 旧函数名仅存于注释史档
  check('D10 门链形状：类型门恢复拦截（pubProxyActive 豁免随拦截恢复）+ 词句门 C189 恢复拦截（weBlock 后量级门前，全域无豁免）+ wrong_entity 臂保留',
    /!pubProxyActive && neBlock != null/.test(mapperSrc)
    && /else if \(uaBlock\) \{/.test(mapperSrc)
    && /\(weBlock = wrongEntityBlock/.test(mapperSrc)
    && /const neBlock = nameEntityTypeUnfitBlock/.test(mapperSrc)
    && /const uaBlock = web3UserAcceptabilityBlock/.test(mapperSrc)
    && mapperSrc.indexOf('(weBlock = wrongEntityBlock') < mapperSrc.indexOf('else if (uaBlock) {')
    && mapperSrc.indexOf('else if (uaBlock) {') < mapperSrc.indexOf("effTier === 'E' || effTier === 'D'")
    && !/!pubProxyActive && uaBlock/.test(mapperSrc)); // 全域无豁免（8d63253 前史形状：superIpSlogan 五腿不豁）
  check('D3 骑乘改道退役反证（rideDetourMass 不存在）',
    !/function rideDetourMass\(answers, category\)/.test(mapperSrc));
  check('D4 state 作者侧键名 corpus_author_identity（与币名题彻底分开）',
    stateSrc.includes('corpus_author_identity:') && stateSrc.includes('corpus_author_identity_note:')
    && !stateSrc.includes('super_ip_hit:'));
  const entSeg = qsSrc.slice(qsSrc.indexOf('bsc_meme_user_name_entity_acceptance: {'), qsSrc.indexOf('bsc_meme_user_phrase_acceptability: {')); // 切片终点=紧邻词句题（visuality 题 C171 已删，旧终点键是死键取到文件尾）
  check('D5 题集实体题五桶（J1.124/C194 加 entity_event_mismatch 实体-事件影响力脱节；J1.113/C184：unknown 认知度轴桶断代 unacceptable_type 类型轴——可乐/银行/犬种学名类无论著名；new_entity 删桶——性质没问题即可新旧无关；J1.103/C172 brand_mismatch 已删；no_entity 断代退役）+ 作者身份不升档红线 + 不评认知度锚 + 专名即实体锚（J1.121）+ 版本 J1.121（J1.121=C190 混混猫案用户裁定「not_entity 是『不是实体』，自创社区 mascot 名也是实体名字，不应该因为这个理由拦截；看的是性质，所以退役了 new_entity 门」：专名即实体锚（性质轴延伸）——名字被用作特定主体称谓（社区名/mascot 名/角色名/外号，「XX社区」式专名搭配在场）即映射该主体按类型轴评，无论自创/知名/语料是否陈述命名行为；not_entity 只留给泛称词无专名搭配+无 C174 命名故事陈述；案发=混混猫官方 recap 以「混混猫社区」称谓在场却判 not_entity 0.66 落词句臂拦；J1.120=C189 全量回归六裁定批：C96 币安上电视追裁「先实体门再 phrase 门，要不被实体拒绝要不被口号拒绝」——事件陈述句名=口号类落词句题按三因素评（J1.118 归实体门域措辞修正）+事件承载臂重要度门槛（民族级/全球级重大事件才够格，平台级/媒体级露出不够——用户裁定「事件的重要度明显不够」）+ip_reuse 原生热点锚（C129 彪弟案：原生热点梗/人物主体自身代币化不选本项，复用=反复换皮多处收割）+mapper 同批恢复词句门拦截；J1.119=C188 ①有来由补事件承载臂（影响力巨大/情感触动极强的事件本身承载口号——中国人能飞箭体五大字）；J1.118=C188 事件陈述臂退役（币安上电视=具体事件形状归实体门域，词句题不先验拦）+J1.117=C188 主体符号锚（こんにちは 对日本群体喊话非客套）；J1.117=C187 对拍修复：词句题②臂补主体符号锚（C126 何一こんにちは正样本被「礼貌套话」臂误伤翻面，①②打架消除）；J1.116=C187 词句题三因素重构（①有来由门槛：普通用户喊的口号不能接纳 ②有感染力：Early 有/我要去滑雪无 ③名字形态；CRO 判例翻案=机构职位缩写臂退役）；J1.115=C186 演绎题同域非演绎反锚 ATM 案；J1.114=C185 题面精炼去重：类型清单/认知度判据/C151/C162 各归单一宿主）',
    qsSrc.includes("bsc_meme_user_name_entity_acceptance: {")
    && /accepted:/.test(entSeg) && /unacceptable_type:/.test(entSeg)
    && /wrong_entity:/.test(entSeg) && /not_entity:/.test(entSeg) && /entity_event_mismatch:/.test(entSeg) && !/no_entity:/.test(entSeg)
    && !/brand_mismatch:/.test(entSeg) && !/new_entity:/.test(entSeg) && !/unknown:/.test(entSeg)
    && entSeg.includes('指歪') && entSeg.includes('本项是拦截位（全域）')
    && entSeg.includes('不评认知度')
    && entSeg.includes('判据=类型/性质不合，不是认知度')
    && qsSrc.includes('作者身份本身不是映射')
    // J1.121/C190 专名即实体锚（题面三处：instructions ⚠️ 段+accepted 臂+not_entity 反锚）
    && entSeg.includes('专名即实体（J1.121/C190，混混猫案')
    && entSeg.includes('被用作特定主体称谓的自创专名（J1.121/C190')
    && entSeg.includes('混混猫=自创社区 mascot 专名不落本项')
    && /JEV_QUESTIONS_VERSION = 'J1\.134'/.test(qsSrc));
  check('D5b block reason 选项按对象前缀化（event_* / token_*，J1.59）+ J1.87/C145 删 routine + J1.88/C150 删 institution + J1.101/C170 删 nhn + J1.110/C181 键名断代 event_quality_veto → web3_user_event_impact；J1.112/C183 再断代 → bsc_meme_user_event_impact',
    qsSrc.includes('bsc_meme_user_event_impact:')
    && qsSrc.includes('event_empty_content:') && !qsSrc.includes('event_institution_routine:')
    && !qsSrc.includes('event_negative_hard_news:') && !qsSrc.includes('event_routine_content_product:')
    && !qsSrc.includes('event_quality_veto: {')
    && qsSrc.includes('token_ip_reuse:') && !qsSrc.includes('token_circle_reachability: {')); // J1.82/C140 圈层桶退役（并行会话同批）
  check('D6 键名断代：词句题 bsc_meme_user_phrase_acceptability 在册（J1.112/C183 web3_user_* 全族断代；J1.81 收窄前名 web3_user_phrase_acceptability）；载体题 web3_user_entity_visuality 已随 C171 形象轴退役（题删除）；旧键 name_form:/web3_user_name_acceptability:/name_entity_carrier: 退役',
    /bsc_meme_user_phrase_acceptability: \{/.test(qsSrc) && !/web3_user_entity_visuality: \{/.test(qsSrc)
    && !/^ {4}(name_form|web3_user_name_acceptability|name_entity_carrier): \{/m.test(qsSrc));
  // D7（J1.104/C174，TREE 0xd50e11204f7f3d63598b0118ee4151bf95917777 案）：
  // 「被命名+被讲故事的故事主体」锚在场——J1.113/C184 落点随 new_entity 删桶迁
  // accepted（性质可接纳即归，新旧无关）；含逃逸门（语料无命名行为的蹭名票不适用）。
  // 修复面：Jev 曾判 TREE not_entity 0.47 → 触发词句题 not_acceptable 0.59 拦 low；
  // 锚正后归可接纳桶 → 词句题跳过 → ≈81 high
  check('D7 J1.104/C174 故事主体锚在场（instructions ⚠️ 段+accepted 桶主锚+not_entity 反锚）+逃逸门',
    qsSrc.includes('被命名+被讲故事的故事主体（J1.104/C174')
    && qsSrc.includes('不因名字字面是普通词（树/猫/橙子）判 not_entity')
    && qsSrc.includes('语料已陈述命名行为/已讲故事的主体（有明确所指，如 BNB Tree）不属本项')
    && qsSrc.includes('无命名行为的普通词蹭名票不适用，仍走 not_entity'),
    null);

  // D8（J1.105/C175，京小安 0xcb98accaa8040a7e839c305b8aca08e113c87777 案）：
  // 用户裁定「『首款AI警犬』给实体定了性质，能被 web3 用户接受是根本的，而不是
  // 知名/广泛报道」——性质定义优先于认知度：三锚在场+逃逸门（空泛自称不适用）
  check('D8 J1.105/C175 性质定义优先于认知度锚三点在场（instructions ⚠️ 段+accepted 主锚+unknown 反锚）+逃逸门',
    qsSrc.includes('性质定义优先（J1.105/C175，京小安案）')
    && qsSrc.includes('不以知名/被广泛报道为前提')
    && qsSrc.includes('含语料已明确定义可接纳性质的角色（J1.105/C175')
    && qsSrc.includes('「首款AI警犬」——不以知名为前提')
    && qsSrc.includes('语料已给出明确可接纳性质定义的（如「首款AI警犬」）不属本项（→ accepted，J1.105/C175）')
    && qsSrc.includes('空泛自称（「官方币/年度最强」式口号）不满足明确定义'),
    null);

  // D9（J1.106/C175b，C96 币安上电视 0xc6d089d749409f7646de440d637ac9db0e047777 案）：
  // C175 上线回归 C96 稳定翻 high 实锤（实体题 accepted 0.40/not_entity 0.33 近 tie
  // 掷 accepted → J1.139 词句题只评 not_entity 票 → 「Web3 用户不接纳该名字」拦截位
  // 失效放行）——性质定义锚补陈述句反锚：陈述句/事件描述式名字不构成性质定义，
  // 句中提及著名实体不因此 accepted，仍归 not_entity 由词句题接管
  check('D9 J1.106/C175b 陈述句反锚在场（性质定义=定身份非说事 + 提及著名实体不因此 accepted + 仍归 not_entity 词句题接管）',
    qsSrc.includes('反锚（J1.106/C175b，币安上电视案）')
    && qsSrc.includes('（「XX上电视」「XX要来了」式说事非命名）不构成性质定义')
    && qsSrc.includes('即便句中提及著名实体也不因此 accepted')
    && qsSrc.includes('仍归 not_entity 由词句题接管'),
    null);

  console.log(`\n══════ ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('SUITE ERROR', e); process.exit(1); });
