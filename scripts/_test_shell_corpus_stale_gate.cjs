#!/usr/bin/env node
/**
 * 借壳语料陈旧门（C250）——零 DB 零网络单测
 *
 * 2026-10-27 用户裁定（自由之钱 0x2c048d9c02fccba7cc5c07adeb37070da9a2ffff）：
 * 「叙事能过简直扯淡，是个明显的叙事模块漏洞」——部署者把 CZ 主页塞进 meta
 * twitterUrl（账号级语料无宣告推），全部实义语料=193 天前第三方 square 旧文
 * （CZ 出书《Freedom of Money》书评，作者 @youcancallmeJo 非 CZ），币名抄文章
 * 标题反成 exact_match/fit strong 正向证据链 → high 放行，实盘对倒盘 -37.5%。
 * 门=两腿全真才拦：①无推文级语料 ②全部语料源距创建锚 >30d（「所有的语料都是
 * 老的才行」——square 新文=照放，对照 0x26a0「金钱的自由」有新鲜主推=照放）。
 * 时间源含**账号注册时间 created_at**（2026-10-27 追裁定「代币只提供大V地址
 * （大V账号肯定是老账号）应也能拦」——纯裸账号形状补源；账号推文时间刻意
 * 不入源：活跃大 V 永远有新推）。
 *
 * 覆盖：
 *   A. mapper 集成：本案形状拦 / 新语料放 / 有主推放 / fail-open 双臂 /
 *      max 语义（任一新即放）/ 未来源 / 阈值边界 / 全域 / 审计键 /
 *      裸账号形状拦（追裁定）/ created_at 缺失放 / 新注册账号放
 *   B. 源码口径：门链序（蓝筹首臂→shellStale→chinaPolitics）/ 函数私有 /
 *      analyzer 传参接线 / prestage 不接 / created_at 源码锚
 *
 * 用法：node scripts/_test_shell_corpus_stale_gate.cjs
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
 * 不被本门拦时应评 high（门单独翻转语义的正确性前提） */
function shellAnswers(cat = 'E') {
  return {
    event_category: { choice: cat, probabilities: { [cat]: 0.7 } },
    event_timing: { choice: 'older', probabilities: { older: 0.94 } },
    bsc_meme_user_event_impact: { choice: 'none', probabilities: { none: 0.7 } },
    bsc_meme_user_think_event_too_trivial_for_meme: { choice: 'not_too_trivial', probabilities: { not_too_trivial: 0.87 } },
    bsc_meme_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.53, fit: 0.11, marginal: 0.15, unfit: 0.21 } },
    bsc_meme_user_web3_project_acceptance_and_impact: { choice: 'low', probabilities: { low: 0.7, mid: 0.14, high: 0.16 } },
    bsc_meme_user_name_event_acceptance: { choice: 'exact_match', probabilities: { exact_match: 0.78, acceptable: 0.16, unacceptable: 0.06 } },
    bsc_meme_user_name_entity_acceptance: { choice: 'accepted', probabilities: { accepted: 0.65, wrong_entity: 0.11, entity_event_mismatch: 0.12, not_entity: 0.08 } },
    bsc_meme_user_phrase_acceptability: { choice: 'bsc_meme_user_not_acceptable', probabilities: { 'bsc_meme_user_not_acceptable': 0.63, 'bsc_meme_user_acceptable': 0.32 } },
    token_name_quality: { score: 2.79, probabilities: {} },
    quality_spelling: { score: 3 },
    quality_reasonability: { score: 3 },
  };
}

const ANCHOR_SEC = 1793098161; // 2026-10-27 10:49:21Z（本案 fire 时刻附近）
const DAY = 86400;
const iso = (sec) => new Date(sec * 1000).toISOString();

function makeContext(extra = {}) {
  return {
    // 本案形状：账号级 twitterInfo（type=account，零推文槽位；created_at=账号
    // 注册时间，CZ 2017 真实形状 9 年老号——追裁定后为纯裸账号形状唯一时间源）
    tokenData: {
      symbol: '自由之钱', name: '自由之钱',
      tokenCreatedAtSec: ANCHOR_SEC,
      raw_api_data: { name: '自由之钱', created_at: ANCHOR_SEC },
    },
    twitterInfo: { type: 'account', screen_name: 'cz_binance', followers_count: 10987790, created_at: iso(ANCHOR_SEC - 9 * 365 * DAY) },
    // 193 天前的 square 旧文（本案实测 lag）
    binanceSquareInfo: { postId: '313115584541441', publishedAt: iso(ANCHOR_SEC - 193 * DAY), title: "From Nothing to Millions: Inside CZ's \"Freedom of Money\"" },
    websiteInfo: null,
    tweetClassification: null,
    callInfo: { model: 'stub', questions: {}, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
    ...extra,
  };
}

const stage2Of = (m) => m?.stage2DataToSave?.parsed_output || {};

async function main() {
  const mapper = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const mapperSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/analyzer/llm/jev-result-mapper.mjs'), 'utf8');
  const analyzerSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/analyzer/NarrativeAnalyzer.mjs'), 'utf8');
  const prestageSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/analyzer/llm/jev-prestage-mapper.mjs'), 'utf8');

  console.log('\n── A. mapper 集成（两腿全真才拦）──');

  const mHit = mapper.mapStandardAnswers(shellAnswers(), makeContext());
  const blkHit = stage2Of(mHit).blockReason || '';
  check('A1 本案形状（账号级语料+square 193d 旧文）→ low + label 命中',
    mHit.llmResult.rating === 'low' && blkHit.includes('借壳语料陈旧') && blkHit.includes('无宣告推'),
    { rating: mHit.llmResult.rating, blkHit });
  check('A2 审计键 shellCorpusStale 命中落值（lagSec≈193d、sources=[binance_square]）',
    stage2Of(mHit).jev?.shellCorpusStale != null
    && stage2Of(mHit).jev.shellCorpusStale.lagSec > 192 * DAY
    && stage2Of(mHit).jev.shellCorpusStale.staleSec === 30 * DAY
    && Array.isArray(stage2Of(mHit).jev.shellCorpusStale.sources)
    && stage2Of(mHit).jev.shellCorpusStale.sources.includes('binance_square'),
    stage2Of(mHit).jev?.shellCorpusStale);

  const mFresh = mapper.mapStandardAnswers(shellAnswers(), makeContext({
    binanceSquareInfo: { postId: 'p1', publishedAt: iso(ANCHOR_SEC - 2 * DAY) },
  }));
  check('A2b square 新文（2 天前）→ 放行不拦（用户裁定「报告是新的不该被时效拦」）',
    !(stage2Of(mFresh).blockReason || '').includes('借壳语料陈旧'),
    stage2Of(mFresh).blockReason);

  const mMain = mapper.mapStandardAnswers(shellAnswers(), makeContext({
    twitterInfo: { type: 'tweet', text: 'CZ 在 BNC 纳斯达克敲钟仪式上称这就是「金钱的自由」', created_at: iso(ANCHOR_SEC - 3600) },
    binanceSquareInfo: { postId: 'p2', publishedAt: iso(ANCHOR_SEC - 200 * DAY) },
  }));
  check('A3 有新鲜主推（0x26a0「金钱的自由」对照）→ 腿①假放行',
    !(stage2Of(mMain).blockReason || '').includes('借壳语料陈旧'),
    stage2Of(mMain).blockReason);

  const mMinimal = mapper.mapStandardAnswers(shellAnswers(), makeContext({
    twitterInfo: { type: 'account', screen_name: 'cz_binance', followers_count: 10987790 }, // 无 created_at
    binanceSquareInfo: { postId: 'p3', fetchMethod: 'minimal' }, // WAF minimal：无 publishedAt
  }));
  check('A4 时间源真·全缺失（账号无 created_at+square minimal）→ fail-open 放',
    !(stage2Of(mMinimal).blockReason || '').includes('借壳语料陈旧')
    && stage2Of(mMinimal).jev?.shellCorpusStale == null,
    { blk: stage2Of(mMinimal).blockReason, audit: stage2Of(mMinimal).jev?.shellCorpusStale });

  // 追裁定 2026-10-27「代币只提供大V地址（大V账号肯定是老账号）应也能拦」：
  // 纯裸账号形状（无 square/website）以账号注册时间为唯一源
  const mBare = mapper.mapStandardAnswers(shellAnswers(), makeContext({
    binanceSquareInfo: null, websiteInfo: null,
  }));
  check('A4b 纯裸大V账号（9 年老号，无 square/website）→ 拦+审计 sources=[twitter_account]',
    mBare.llmResult.rating === 'low'
    && (stage2Of(mBare).blockReason || '').includes('借壳语料陈旧')
    && stage2Of(mBare).jev?.shellCorpusStale?.sources?.includes('twitter_account')
    && stage2Of(mBare).jev.shellCorpusStale.lagSec > 8 * 365 * DAY,
    { blk: stage2Of(mBare).blockReason, audit: stage2Of(mBare).jev?.shellCorpusStale });

  const mBareNoTs = mapper.mapStandardAnswers(shellAnswers(), makeContext({
    twitterInfo: { type: 'account', screen_name: 'x', created_at: '' }, // 空串不可解析
    binanceSquareInfo: null, websiteInfo: null,
  }));
  check('A4c created_at 空串（不可解析）→ 该源跳过 fail-open 放',
    !(stage2Of(mBareNoTs).blockReason || '').includes('借壳语料陈旧'),
    stage2Of(mBareNoTs).blockReason);

  const mFreshAcct = mapper.mapStandardAnswers(shellAnswers(), makeContext({
    twitterInfo: { type: 'account', screen_name: 'newdev', created_at: iso(ANCHOR_SEC - 7 * DAY) },
    binanceSquareInfo: null, websiteInfo: null,
  }));
  check('A4d 新注册账号（7 天前）裸账号 → <30d 照放（新号发自己的票不误伤）',
    !(stage2Of(mFreshAcct).blockReason || '').includes('借壳语料陈旧'),
    stage2Of(mFreshAcct).blockReason);

  const mNoAnchor = mapper.mapStandardAnswers(shellAnswers(), makeContext({
    tokenData: { symbol: '自由之钱', name: '自由之钱', raw_api_data: {} },
  }));
  check('A5 创建锚缺失 → fail-open 放（C75 缺锚同语义）',
    !(stage2Of(mNoAnchor).blockReason || '').includes('借壳语料陈旧'),
    stage2Of(mNoAnchor).blockReason);

  const mNoTw = mapper.mapStandardAnswers(shellAnswers(), makeContext({ twitterInfo: null }));
  check('A6 twitterInfo null + square 旧文 → 拦（无 twitter 语料同形状：零宣告动作）',
    mNoTw.llmResult.rating === 'low' && (stage2Of(mNoTw).blockReason || '').includes('借壳语料陈旧'),
    stage2Of(mNoTw).blockReason);

  const mMix = mapper.mapStandardAnswers(shellAnswers(), makeContext({
    websiteInfo: { type: 'website', publishedTime: iso(ANCHOR_SEC - DAY) }, // website 1 天前新
  }));
  check('A7 双源取 max（website 1 天前新 + square 193 天前旧）→ 任一新即放',
    !(stage2Of(mMix).blockReason || '').includes('借壳语料陈旧'),
    stage2Of(mMix).blockReason);

  const mFuture = mapper.mapStandardAnswers(shellAnswers(), makeContext({
    binanceSquareInfo: { postId: 'p4', publishedAt: iso(ANCHOR_SEC + DAY) }, // 时钟偏移未来源
  }));
  check('A8 未来时间源（晚于创建锚）→ lag 负不拦',
    !(stage2Of(mFuture).blockReason || '').includes('借壳语料陈旧'),
    stage2Of(mFuture).blockReason);

  const mEdgeOut = mapper.mapStandardAnswers(shellAnswers(), makeContext({
    binanceSquareInfo: { postId: 'p5', publishedAt: iso(ANCHOR_SEC - (30 * DAY + 1)) },
  }));
  const mEdgeIn = mapper.mapStandardAnswers(shellAnswers(), makeContext({
    binanceSquareInfo: { postId: 'p6', publishedAt: iso(ANCHOR_SEC - 30 * DAY) },
  }));
  check('A9 阈值边界：>30d 拦 / =30d 不拦（`<=` 语义，对齐 C75）',
    (stage2Of(mEdgeOut).blockReason || '').includes('借壳语料陈旧')
    && !(stage2Of(mEdgeIn).blockReason || '').includes('借壳语料陈旧'),
    { out: stage2Of(mEdgeOut).blockReason, in: stage2Of(mEdgeIn).blockReason });

  for (const cat of ['W', 'B', 'D']) {
    const m = mapper.mapStandardAnswers(shellAnswers(cat), makeContext());
    check(`A10.${cat} 全域拦截（category=${cat}，资格层与分类正交）`,
      m.llmResult.rating === 'low' && (stage2Of(m).blockReason || '').includes('借壳语料陈旧'),
      stage2Of(m).blockReason);
  }

  // 不传新 context（存量调用形状）→ 账号注册时间在场照拦（裸账号形状=追裁定
  // 后正行为；「缺新键不炸」的 fail-open 面由 A4c 覆盖）
  const mLegacyCtx = mapper.mapStandardAnswers(shellAnswers(), (() => {
    const c = makeContext();
    delete c.binanceSquareInfo; delete c.websiteInfo;
    return c;
  })());
  check('A11 context 不带 square/website（存量调用形状）+老账号 created_at → 裸账号照拦',
    mLegacyCtx.llmResult.rating === 'low' && (stage2Of(mLegacyCtx).blockReason || '').includes('借壳语料陈旧'),
    stage2Of(mLegacyCtx).blockReason);

  console.log('\n── B. 源码口径 ──');
  const dedupIdx = mapperSrc.indexOf("if (context.duplicateNarrative && !dedupNewStatement && !dedupNewEvent) {");
  const shellIdx = mapperSrc.indexOf('} else if ((shellStaleBlock = shellCorpusStaleBlock(');
  const cpIdx = mapperSrc.indexOf('} else if ((cpBlock = chinaPoliticsBlock(answers))) {');
  check('B1 门链序：蓝筹去重首臂 → 借壳语料陈旧 → 中国政治（资格层链序，curated 库证据居首）',
    dedupIdx > 0 && shellIdx > dedupIdx && cpIdx > shellIdx, { dedupIdx, shellIdx, cpIdx });
  check('B2 函数私有不导出（防复活面=只有 veto 链一个消费点）',
    mapper.shellCorpusStaleBlock === undefined && mapper.__shellCorpusStaleBlock === undefined
    && mapper.hasTweetLevelCorpus === undefined && mapper.collectCorpusSourceTsMs === undefined);
  check('B3 analyzer 接线：mapStandardAnswers 调用点直传 binanceSquareInfo, websiteInfo',
    /mapStandardAnswers\(result\.answers,\s*\{[\s\S]*?twitterInfo,[\s\S]*?binanceSquareInfo,\s*websiteInfo,/.test(analyzerSrc));
  check('B4 prestage 不接（prestage mapper 零本门字样；账号社区票走 prestage 评估不触达）',
    !prestageSrc.includes('shellCorpusStale') && !prestageSrc.includes('SHELL_CORPUS_STALE_SEC'));
  check('B5 时间窗常量=30d 对齐 C75 刻度（SOURCE_STALE_SEC 同值互独立）',
    mapperSrc.includes('const SHELL_CORPUS_STALE_SEC = 30 * 86400;')
    && mapperSrc.includes('const SOURCE_STALE_SEC = 30 * 86400;'));
  check('B7 账号注册时间源码锚：collectCorpusSourceTsMs 收 created_at+sources 含 twitter_account（防复活）',
    /push\(twitterInfo\?\.created_at\);\s*\n\s*push\(binanceSquareInfo/.test(mapperSrc)
    && mapperSrc.includes("sources.push('twitter_account')"));
  check('B6 mapper-only：题集版本不动（JEV_QUESTIONS_VERSION 无 C250 bump）',
    !/C250/.test(fs.readFileSync(path.join(__dirname, '../src/narrative/analyzer/llm/jev-questions.mjs'), 'utf8')));

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
