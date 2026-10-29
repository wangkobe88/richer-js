#!/usr/bin/env node
/**
 * 蓝筹账号借壳门（C256）——零 DB 零网络单测
 *
 * 2026-10-29 用户裁定（超级牛来 0xb3d4d7faf25bec37960be028fbc40bf500957777）：
 * 「直接借用蓝筹币的主推账号发币不成立的」。案发：flap 票 symbol「超级牛来」，
 * meta twitterUrl=蓝筹「牛来」（b:0xbeea…7777，ATH $163M 本系统评 high）官方
 * 账号 @niulai_on_bnb 10-27 09:42 自宣视频推「dope from every angle 😎 ~ just
 * Niu Lai (牛来) things」——早于创建 2 天、零提及本票；C168 只拦 name_exact
 * （超级牛来⊃牛来=变体漏放）、C250 腿①假（有推文级语料）、时效 direct 豁免
 * （粉 8655≥5000 且 lag 2d<24h）→ 知识库注入段+同名账号语料把 Jev 带偏
 * （strong_fit 0.48/tier A/关联 exact_match 20）→ high 76.49，v59 实盘
 * 07:55 买 0.006 BNB 07:59 全清 0.00549（-8.4%）。
 *
 * 门=三腿联立才拦（analyzer 侧 detectBorrowedBluechipCorpus 纯代码事实）：
 *   ① symbol 名变体撞蓝筹（b:，name_exact/name_substring，symbol-only C252 口径）
 *   ② 主推语料作者=该蓝筹条目注册 twitter 账号（handle 归一化全等）
 *   ③ 语料文本无本案宣告（不含本票 symbol/name——同账号真续作/新陈述推必提
 *      新币名，C173「4」案 CZ 新推含「4」即宣告腿③自愈放行）
 *
 * 覆盖：
 *   A. mapper 集成：本案形状拦 / 证据缺位放 / C168 首臂优先 / 全域 / 审计键
 *   B. 检测器直测：事故现场反证 / 宣告腿 / 作者腿 / 名变体腿 / 自排除 /
 *      fail-open 双臂 / handle 归一化 / quasi 不算 / C173「4」对照
 *   C. 源码口径：门链序（dedup→borrowed→shellStale→chinaPolitics）/
 *      analyzer 接线 / prestage 不接 / mapper-only 不 bump 题集版本
 *
 * 用法：node scripts/_test_borrowed_bluechip_corpus_gate.cjs
 */

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

/** 本案高分配置：E 类 + fit strong + 实体 accepted + 关联 exact_match——
 * 不被本门拦时应评 high（门单独翻转语义的正确性前提；镜像 C250 测试 fixture） */
function borrowAnswers(cat = 'E') {
  return {
    event_category: { choice: cat, probabilities: { [cat]: 0.7 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 0.98 } },
    bsc_meme_user_event_impact: { choice: 'none', probabilities: { none: 0.7 } },
    bsc_meme_user_think_event_too_trivial_for_meme: { choice: 'not_too_trivial', probabilities: { not_too_trivial: 0.87 } },
    bsc_meme_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.48, fit: 0.24, marginal: 0.23, unfit: 0.04 } },
    bsc_meme_user_web3_project_acceptance_and_impact: { choice: 'low', probabilities: { low: 0.45, mid: 0.28, high: 0.27 } },
    bsc_meme_user_name_event_acceptance: { choice: 'exact_match', probabilities: { exact_match: 0.78, acceptable: 0.16, unacceptable: 0.06 } },
    bsc_meme_user_name_entity_acceptance: { choice: 'accepted', probabilities: { accepted: 0.65, wrong_entity: 0.11, entity_event_mismatch: 0.12, not_entity: 0.08 } },
    bsc_meme_user_phrase_acceptability: { choice: 'bsc_meme_user_not_acceptable', probabilities: { 'bsc_meme_user_not_acceptable': 0.79, 'bsc_meme_user_acceptable': 0.12 } },
    token_name_quality: { score: 2.79, probabilities: {} },
    quality_spelling: { score: 3 },
    quality_reasonability: { score: 3 },
  };
}

/** 事故现场反证原料（token_narrative/twitter_info + bluechips.json 原文形状） */
const INCIDENT = {
  token: {
    symbol: '超级牛来',
    name: '超级牛来',
    address: '0xb3d4d7faf25bec37960be028fbc40bf500957777',
  },
  // twitter_info 原文关键字段（2026-10-27 09:42 推文，作者=蓝筹注册账号）
  twitter: {
    type: 'tweet',
    text: 'dope from every angle 😎\n\n~ just  Niu Lai (牛来) things https://t.co/PbXioFURoA',
    author_screen_name: 'niulai_on_bnb',
    author_followers_count: 8655,
  },
  // config/knowledge/bluechips.json 牛来条目原文关键字段
  bluechip: {
    id: 'b:0xbeea1d618e533a387d941f58a7d4c9b7bd377777',
    kind: 'bluechip',
    name: '牛来',
    symbol: '牛来',
    aliases: [],
    address: '0xbeea1d618e533a387d941f58a7d4c9b7bd377777',
    twitter: 'https://x.com/niulai_on_bnb',
    corpusTrigger: true,
  },
};

const FACT = {
  rule: 'name_substring',
  matchedOn: '牛来',
  entryId: INCIDENT.bluechip.id,
  entryName: '牛来',
  handle: 'niulai_on_bnb',
};

function makeContext(extra = {}) {
  return {
    tokenData: { symbol: INCIDENT.token.symbol, name: INCIDENT.token.name, raw_api_data: { name: INCIDENT.token.name } },
    twitterInfo: INCIDENT.twitter,
    tweetClassification: null,
    callInfo: { model: 'stub', questions: {}, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
    ...extra,
  };
}

const stage2Of = (m) => m?.stage2DataToSave?.parsed_output || {};

async function main() {
  const mapper = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const km = await import('../src/narrative/analyzer/knowledge/knowledge-matcher.mjs');
  const mapperSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/analyzer/llm/jev-result-mapper.mjs'), 'utf8');
  const analyzerSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/analyzer/NarrativeAnalyzer.mjs'), 'utf8');
  const prestageSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/analyzer/llm/jev-prestage-mapper.mjs'), 'utf8');
  const questionsSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/analyzer/llm/jev-questions.mjs'), 'utf8');

  console.log('\n── A. mapper 集成 ──');

  const mHit = mapper.mapStandardAnswers(borrowAnswers(), makeContext({ borrowedBluechipCorpus: FACT }));
  const blkHit = stage2Of(mHit).blockReason || '';
  check('A1 事故形状（超级牛来+借@niulai_on_bnb 自宣推）→ low + label 命中蓝筹名+账号',
    mHit.llmResult.rating === 'low' && blkHit.includes('蓝筹账号借壳') && blkHit.includes('牛来') && blkHit.includes('niulai_on_bnb'),
    { rating: mHit.llmResult.rating, blkHit });
  check('A2 审计键 borrowedBluechipCorpus 命中落值（rule/entry/handle 可追溯）',
    stage2Of(mHit).jev?.borrowedBluechipCorpus?.rule === 'name_substring'
    && stage2Of(mHit).jev.borrowedBluechipCorpus.entry === '牛来'
    && stage2Of(mHit).jev.borrowedBluechipCorpus.handle === 'niulai_on_bnb'
    && stage2Of(mHit).jev.borrowedBluechipCorpus.entryId === INCIDENT.bluechip.id,
    stage2Of(mHit).jev?.borrowedBluechipCorpus);

  const mNoFact = mapper.mapStandardAnswers(borrowAnswers(), makeContext());
  check('A2b 证据缺位（存量调用形状无 borrowedBluechipCorpus 键）→ 不拦评 high',
    mNoFact.llmResult.rating !== 'low' && !(stage2Of(mNoFact).blockReason || '').includes('蓝筹账号借壳')
    && stage2Of(mNoFact).jev?.borrowedBluechipCorpus == null,
    { rating: mNoFact.llmResult.rating, blk: stage2Of(mNoFact).blockReason });

  const mDedupFirst = mapper.mapStandardAnswers(borrowAnswers(), makeContext({
    borrowedBluechipCorpus: FACT,
    duplicateNarrative: { rule: 'name_exact', matchedOn: '牛来', entryId: INCIDENT.bluechip.id, entryName: '牛来', entryAddress: INCIDENT.bluechip.address },
  }));
  check('A3 C168 首臂优先：duplicateNarrative 同在场 → 蓝筹去重 label 抢先（else-if 链序）',
    (stage2Of(mDedupFirst).blockReason || '').includes('蓝筹去重')
    && !(stage2Of(mDedupFirst).blockReason || '').includes('蓝筹账号借壳'),
    stage2Of(mDedupFirst).blockReason);

  for (const cat of ['W', 'B', 'D']) {
    const m = mapper.mapStandardAnswers(borrowAnswers(cat), makeContext({ borrowedBluechipCorpus: FACT }));
    check(`A4.${cat} 全域拦截（category=${cat}，资格层与分类正交）`,
      m.llmResult.rating === 'low' && (stage2Of(m).blockReason || '').includes('蓝筹账号借壳'),
      stage2Of(m).blockReason);
  }

  console.log('\n── B. 检测器直测（detectBorrowedBluechipCorpus）──');

  const index = km.buildKnowledgeIndex([
    INCIDENT.bluechip,
    // C173「4」对照：CZ 新陈述票撞名蓝筹「4」（ATH $306M 案）
    { id: 'b:0x0a43c0f0e2b1a9d3c5e7f9a1b3d5e7f9a1b3c5d7', kind: 'bluechip', name: '4', symbol: '4', aliases: [], address: '0x0a43c0f0e2b1a9d3c5e7f9a1b3d5e7f9a1b3c5d7', twitter: 'https://x.com/cz_binance', corpusTrigger: false },
    // quasi 小票同名：同叙事连发是常态（C168 同口径不拦）
    { id: 'q:niulai-2', kind: 'quasi', name: '牛来2号', aliases: [], address: '0x1111111111111111111111111111111111111111', twitter: 'https://x.com/niulai_on_bnb', corpusTrigger: true },
  ]);

  const detect = (over = {}) => km.detectBorrowedBluechipCorpus({
    symbol: INCIDENT.token.symbol,
    name: INCIDENT.token.name,
    address: INCIDENT.token.address,
    corpusText: INCIDENT.twitter.text,
    corpusAuthorHandle: INCIDENT.twitter.author_screen_name,
    ...over,
  }, index, { selfAddress: INCIDENT.token.address });

  const b1 = detect();
  check('B1 事故现场反证：超级牛来+@niulai_on_bnb 自宣推（零提及本票）→ 命中 name_substring',
    b1?.rule === 'name_substring' && b1?.entryName === '牛来' && b1?.handle === 'niulai_on_bnb',
    b1);

  const b2 = detect({ corpusText: '超级牛来 $超级牛来 launching now on flap! 🚀' });
  check('B2 宣告腿：语料提到本票 symbol（同账号真续作形状）→ 放行 null',
    b2 === null, b2);

  const b2b = detect({ corpusText: '超级 牛来 🚀 launching now（symbol 带空格/emoji 间隔写法）' });
  check('B2b 宣告腿=归一化包含（剥空白/emoji）：间隔写法照算宣告',
    b2b === null, b2b);

  const b3 = detect({ corpusAuthorHandle: 'someone_else' });
  check('B3 作者腿：语料作者≠蓝筹注册账号（第三方转述牛来视频）→ 放行',
    b3 === null, b3);

  const b4 = detect({ symbol: 'PEIPEI' });
  check('B4 名变体腿：无名碰撞（纯借大 V 语料=C168 撤臂裁定辖区）→ 放行',
    b4 === null, b4);

  const b5 = detect({ corpusText: '', corpusAuthorHandle: INCIDENT.twitter.author_screen_name });
  check('B5 fail-open：纯图推无文本（宣告可能在图里，图判归 Jev）→ 放行',
    b5 === null, b5);

  const b6 = detect({ corpusAuthorHandle: null });
  check('B6 fail-open：语料作者缺失（twitterInfo 无 author_screen_name）→ 放行',
    b6 === null, b6);

  const b7 = km.detectBorrowedBluechipCorpus({
    symbol: '牛来', name: '牛来', address: INCIDENT.bluechip.address,
    corpusText: INCIDENT.twitter.text, corpusAuthorHandle: INCIDENT.twitter.author_screen_name,
  }, index, { selfAddress: INCIDENT.bluechip.address });
  check('B7 自地址排除：蓝筹本体票重析（selfAddress=条目地址）→ 放行',
    b7 === null, b7);

  const b8 = km.normalizeTwitterHandle('https://twitter.com/NiuLai_On_BNB/?lang=zh')
    + '|' + km.normalizeTwitterHandle('@niulai_on_bnb')
    + '|' + km.normalizeTwitterHandle('niulai_on_bnb/');
  const b8hit = detect({ corpusAuthorHandle: 'NiuLai_On_BNB' });
  check('B8 handle 归一化：URL/带查询串/@前缀/大小写/尾斜杠全等；作者大小写变体照命中',
    b8 === 'niulai_on_bnb|niulai_on_bnb|niulai_on_bnb' && b8hit?.entryName === '牛来',
    { b8, b8hit });

  const b9 = km.detectBorrowedBluechipCorpus({
    symbol: '4', name: '4', address: '0x9999999999999999999999999999999999999999',
    corpusText: "A large part of the internet was encrypted by '4'", corpusAuthorHandle: 'cz_binance',
  }, index, { selfAddress: '0x9999999999999999999999999999999999999999' });
  check('B9 C173「4」案对照：CZ 新陈述推含「4」（宣告在场）→ 放行（豁免链语义不回退）',
    b9 === null, b9);

  const b10 = km.detectBorrowedBluechipCorpus({
    symbol: '4', name: '4', address: '0x9999999999999999999999999999999999999999',
    corpusText: 'gm binance super chain 🚀', corpusAuthorHandle: 'cz_binance',
  }, index, { selfAddress: '0x9999999999999999999999999999999999999999' });
  check('B10 name_exact 无宣告臂：撞名「4」+借@cz_binance 语料零提及 → 拦（C168 豁免后兜位）',
    b10?.rule === 'name_exact' && b10?.entryName === '4', b10);

  const b11 = km.detectBorrowedBluechipCorpus({
    symbol: '超级飞天小猪', name: '超级飞天小猪', address: '0x2222222222222222222222222222222222222222',
    corpusText: 'dope from every angle ~ just Niu Lai (牛来) things', corpusAuthorHandle: 'niulai_on_bnb',
  }, km.buildKnowledgeIndex([
    INCIDENT.bluechip,
    // 只撞 quasi 小票（无蓝结名碰撞）：同叙事连发是常态
    { id: 'q:pig', kind: 'quasi', name: '飞天小猪', aliases: [], address: '0x3333333333333333333333333333333333333333', twitter: 'https://x.com/niulai_on_bnb', corpusTrigger: true },
  ]), { selfAddress: '0x2222222222222222222222222222222222222222' });
  check('B11 quasi 不算：只撞 quasi 小票名（飞天小猪）同账号 → 放行（同叙事连发常态）',
    b11 === null, b11);

  const b12 = detect({ name: '随便写的描述' });
  check('B12 name 字段全不消费（C252 symbol-only：撞名腿+宣告腿均只看 symbol）→ symbol 超级牛来照判变体',
    b12?.rule === 'name_substring', b12);

  const b13 = detect({ name: '牛来' });
  check('B13 反塞名反制防线：部署者把 token.name 塞成蓝筹名「牛来」（借来的自宣推天然含「牛来」）→ 宣告腿不看 name 照拦',
    b13?.rule === 'name_substring', b13);

  console.log('\n── C. 源码口径 ──');
  const dedupIdx = mapperSrc.indexOf('if (context.duplicateNarrative && !dedupNewStatement && !dedupNewEvent) {');
  const borrowIdx = mapperSrc.indexOf('} else if (context.borrowedBluechipCorpus) {');
  const shellIdx = mapperSrc.indexOf('} else if ((shellStaleBlock = shellCorpusStaleBlock(');
  const cpIdx = mapperSrc.indexOf('} else if ((cpBlock = chinaPoliticsBlock(answers))) {');
  check('C1 门链序：蓝筹去重首臂 → 蓝筹账号借壳 → 借壳语料陈旧 → 中国政治（curated 库证据居首，账号借壳补全等外变体）',
    dedupIdx > 0 && borrowIdx > dedupIdx && shellIdx > borrowIdx && cpIdx > shellIdx,
    { dedupIdx, borrowIdx, shellIdx, cpIdx });
  check('C2 analyzer 接线：检测调用（主推文本/bio 单源+author_screen_name）+ mapStandardAnswers 传参',
    /detectBorrowedBluechipCorpus\(\{\s*symbol: tokenData\.symbol,[\s\S]*?corpusText: twitterInfo\?\.text \|\| twitterInfo\?\.full_text \|\| twitterInfo\?\.description \|\| '',[\s\S]*?corpusAuthorHandle: twitterInfo\?\.author_screen_name \|\| twitterInfo\?\.screen_name \|\| null,/.test(analyzerSrc)
    && /borrowedBluechipCorpus,/.test(analyzerSrc));
  check('C3 prestage 不接（prestage mapper 零本门字样）',
    !prestageSrc.includes('borrowedBluechipCorpus'));
  check('C4 mapper-only：题集版本不动（jev-questions 无 C256 字样=不 bump 版本）',
    !questionsSrc.includes('C256'));
  check('C5 检测器导出面：knowledge-matcher 导出 detect+normalize，mapper 不导出（veto 链唯一消费点）',
    typeof km.detectBorrowedBluechipCorpus === 'function' && typeof km.normalizeTwitterHandle === 'function'
    && mapper.detectBorrowedBluechipCorpus === undefined);

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
