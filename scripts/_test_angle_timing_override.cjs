#!/usr/bin/env node
/**
 * C68 找角度推文时效门（제로案 0x0a27c1232ffe46f296af9afb68448dff7ad37777）——本地零 DB 零网络单测
 * （2026-10-14 用户裁定「找角度推文都是发出来后立马发币的」：angle_seeking/
 * interpretative_reply 语料的时效锚=载体推文发布时间，不是叙事首次发生时间）
 *
 * 修复①（pre-check-service 规则2 锚回退）：raw_api_data.created_at 缺失时回退
 *   tokenCreatedAtSec（fetchTokenData 的 wss_events token_create 回退锚）——本案
 *   IPFS 语料行无平台 created_at，过期检查静默跳过=11.5 天 lag 找角度票漏网拿 high
 * 修复②（mapper timing override）：angle_seeking/interpretive_reply 且载体推文
 *   lag > 6h（与 precheck expiredTweetMinutesThreshold 同窗）→ 时效归 older=0 分
 *   （mapper-only，题集版本不动——时效分本来就是代码查表）
 *
 * 覆盖：
 *   A. mapper override 矩阵：事故现场反证（lag 993367s → stage2 62→52 翻不过线）/
 *      窗内 1h 不干预 / direct_tweet 不干预 / interpretive_reply 命中 / 锚缺失
 *      fail-open / 载体时间缺失 fail-open / 主推老+quoted 新（任一新即活，与
 *      precheck tweetSources 同集对称）/ 6h 边界 21601|21599 / rawTiming 审计
 *   B. precheck 修复①：tokenCreatedAtSec 回退生效拦 expired_tweet / 窗内放行 /
 *      两锚皆缺跳过（现状回归）/ raw created_at 在仍拦（原行为不变）
 *   C. 源码口径：pre-check-service 规则2 含 tokenCreatedAtSec 回退链 / mapper
 *      ANGLE_TWEET_STALE_SEC 与 precheck 360min 同窗共存
 *
 * 用法：node scripts/_test_angle_timing_override.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

// ── 事故现场数值（DB 实证）：主推 2026-10-03 02:04:41Z，发币 2026-10-14 ~14:00Z ──
const ANCHOR_SEC = 1791986448;            // token 创建锚（= 1790993081 + 993367）
const TWEET_SEC = 1790993081;             // 主推 created_at（Sat Oct 03 02:04:41 +0000 2026）
const LAG_SEC = ANCHOR_SEC - TWEET_SEC;   // 993367s ≈ 11.5 天

/** Twitter API 原格式时间串（生产 twitter_info.created_at 同格式，V8 可解析） */
function twitterDate(sec) {
  const d = new Date(sec * 1000);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n) => String(n).padStart(2, '0');
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000 ${d.getUTCFullYear()}`;
}

// ── 제로案 Jev 原判形状（DB stage1_raw_output 实证）：A 类 B 档 3.4 + dim2 4.1 + within_30d ──
function makeZeroAnswers(timingChoice = 'within_30d') {
  return {
    event_category: { choice: 'A', probabilities: { A: 0.76, E: 0.23 } },
    event_magnitude: { score: 3.4, probabilities: { '3': 0.5, '4': 0.3 } },  // B 档 → 27 分
    event_timing: { choice: timingChoice, probabilities: { within_30d: 0.96 } },
    dimension2: { score: 4.1, probabilities: { '4': 0.5, '5': 0.54 } },
    block_reason: { choice: 'none', probabilities: { none: 0.88, empty_content: 0.12 } },
    name_referent: { choice: 'minor_other', probabilities: { minor_other: 0.43 } },
    subject_entity: { choice: 'character_ip', probabilities: { character_ip: 0.99 } },
    relevance_type: { choice: 'semantic', probabilities: { semantic: 0.9 } },
    relevance_level: { score: 3.6, probabilities: { '3': 0.4, '4': 0.5 } },
    web3_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.97 } },
    block_misspelling: { noul: 0.13 },
    quality_spelling: { score: 2.8 },
    quality_reasonability: { score: 1.7 },
  };
}

function makeContext(td, twitterInfo, tweetType) {
  return {
    tokenData: td,
    includeBrandHijack: false,
    tweetClassification: tweetType ? { type: tweetType, confidence: 'high', reason: 'stub' } : null,
    twitterInfo,
    callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  };
}

async function main() {
  // helper 自检：Twitter 原格式可解析且往返精确
  check('H1 twitterDate 往返精确（V8 解析 Twitter 原格式）',
    new Date(twitterDate(TWEET_SEC)).getTime() === TWEET_SEC * 1000, twitterDate(TWEET_SEC));

  const { mapStandardAnswers } = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const { performPreCheck } = await import('../src/narrative/analyzer/services/pre-check-service.mjs');

  // ═══ A. mapper override 矩阵 ═══
  console.log('\n── A. C68 找角度时效 override（mapper 层）──');
  const zeroToken = {
    symbol: '제로', name: 'Zero',
    tokenCreatedAtSec: ANCHOR_SEC,
    raw_api_data: { name: 'Zero' },  // IPFS 语料行：无平台 created_at（事故形态）
  };
  const staleTwitter = {
    type: 'tweet', text: '近期韩国虚拟男团小猫最魔性网红小猫——Zero！2.8亿播放',
    created_at: twitterDate(TWEET_SEC), formatted_created_at: '2026年10月3日 02:04',
  };

  // A1 事故现场反证：angle_seeking + lag 993367 → override older → stage2 62→52 翻不过线
  const a1 = mapStandardAnswers(makeZeroAnswers(), makeContext(zeroToken, staleTwitter, 'angle_seeking'));
  const j1 = a1.stage1DataToSave.parsed_output.jev;
  check('A1a override 命中：angleTimingOverride.lagSec=993367', j1.angleTimingOverride?.lagSec === LAG_SEC, j1.angleTimingOverride);
  check('A1b Jev 原判档保留审计：rawTiming=within_30d', j1.angleTimingOverride?.rawTiming === 'within_30d', j1.angleTimingOverride);
  check('A1c timing 归 older', j1.timing === 'older', j1.timing);
  check('A1d stage2 被翻转：pass=false（62→52 < 60）', a1.stage2DataToSave.parsed_output.pass === false, a1.stage2DataToSave.parsed_output);
  check('A1e 终评不再 high', a1.stageFinalData.rating !== 'high' && a1.stageFinalData.category !== 'high', { rating: a1.stageFinalData.rating });

  // 对照组：同形状但非找角度形态（tweetClassification=null=unknown）→ 不 override、压线过（62）
  const a1c = mapStandardAnswers(makeZeroAnswers(), makeContext(zeroToken, staleTwitter, null));
  check('A1f 对照（非找角度形态）：override 未触发且 stage2 过线（62>60）',
    a1c.stage1DataToSave.parsed_output.jev.angleTimingOverride === null
    && a1c.stage2DataToSave.parsed_output.pass === true,
    { o: a1c.stage1DataToSave.parsed_output.jev.angleTimingOverride, p: a1c.stage2DataToSave.parsed_output.pass });

  // A2 窗内（1h）：不干预，保持 Jev 原判
  const freshTwitter = { ...staleTwitter, created_at: twitterDate(ANCHOR_SEC - 3600) };
  const a2 = mapStandardAnswers(makeZeroAnswers(), makeContext(zeroToken, freshTwitter, 'angle_seeking'));
  check('A2 窗内 1h：不 override + timing 保持 within_30d',
    a2.stage1DataToSave.parsed_output.jev.angleTimingOverride === null
    && a2.stage1DataToSave.parsed_output.jev.timing === 'within_30d',
    a2.stage1DataToSave.parsed_output.jev);

  // A3 direct_tweet 同 lag：不干预（推文即事件，event_timing 锚事件时间语义本就对）
  const a3 = mapStandardAnswers(makeZeroAnswers(), makeContext(zeroToken, staleTwitter, 'direct_tweet'));
  check('A3 direct_tweet 不干预', a3.stage1DataToSave.parsed_output.jev.angleTimingOverride === null, a3.stage1DataToSave.parsed_output.jev.angleTimingOverride);

  // A4 interpretive_reply：命中（蹭大IP事件窗口同构，与 angle_seeking 同门）
  const a4 = mapStandardAnswers(makeZeroAnswers(), makeContext(zeroToken, staleTwitter, 'interpretive_reply'));
  check('A4 interpretive_reply 命中 override', a4.stage1DataToSave.parsed_output.jev.angleTimingOverride?.lagSec === LAG_SEC, a4.stage1DataToSave.parsed_output.jev.angleTimingOverride);

  // A5 锚缺失（无 tokenCreatedAtSec/raw created_at）：fail-open 不干预（与 precheck 跳过对称）
  const noAnchorToken = { symbol: '제로', name: 'Zero', raw_api_data: { name: 'Zero' } };
  const a5 = mapStandardAnswers(makeZeroAnswers(), makeContext(noAnchorToken, staleTwitter, 'angle_seeking'));
  check('A5 锚缺失 fail-open', a5.stage1DataToSave.parsed_output.jev.angleTimingOverride === null, a5.stage1DataToSave.parsed_output.jev.angleTimingOverride);

  // A6 载体推文时间缺失：fail-open
  const noDateTwitter = { type: 'tweet', text: '无时间戳语料' };
  const a6 = mapStandardAnswers(makeZeroAnswers(), makeContext(zeroToken, noDateTwitter, 'angle_seeking'));
  check('A6 载体时间缺失 fail-open', a6.stage1DataToSave.parsed_output.jev.angleTimingOverride === null, a6.stage1DataToSave.parsed_output.jev.angleTimingOverride);

  // A7 主推 11.5 天前 + quoted 2h 前：最新载体活 → 不 override（与 precheck tweetSources 任一新即放对称）
  const mixedTwitter = { ...staleTwitter, quoted_tweet: { created_at: twitterDate(ANCHOR_SEC - 7200) } };
  const a7 = mapStandardAnswers(makeZeroAnswers(), makeContext(zeroToken, mixedTwitter, 'angle_seeking'));
  check('A7 主推老+quoted 新（任一新即活）', a7.stage1DataToSave.parsed_output.jev.angleTimingOverride === null, a7.stage1DataToSave.parsed_output.jev.angleTimingOverride);

  // A8 6h 边界：21601 命中 / 21599 不命中
  const b1 = mapStandardAnswers(makeZeroAnswers(), makeContext(zeroToken, { ...staleTwitter, created_at: twitterDate(ANCHOR_SEC - 21601) }, 'angle_seeking'));
  const b2 = mapStandardAnswers(makeZeroAnswers(), makeContext(zeroToken, { ...staleTwitter, created_at: twitterDate(ANCHOR_SEC - 21599) }, 'angle_seeking'));
  check('A8 边界 lag=21601 命中 / 21599 放',
    b1.stage1DataToSave.parsed_output.jev.angleTimingOverride !== null
    && b2.stage1DataToSave.parsed_output.jev.angleTimingOverride === null,
    { hi: b1.stage1DataToSave.parsed_output.jev.angleTimingOverride, lo: b2.stage1DataToSave.parsed_output.jev.angleTimingOverride });

  // ═══ B. precheck 修复①（锚回退）═══
  console.log('\n── B. precheck 规则2 锚回退（IPFS 语料行无平台 created_at）──');
  const precheckArgs = (token, twitter) => [
    token, twitter,
    { twitter_url: 'https://x.com/rega_sport/status/2106203757654798505' },
    null,
    { twitter: [{ url: 'https://x.com/rega_sport/status/2106203757654798505', type: 'tweet', platform: 'twitter', priority: 1 }] },
    {}, null, null, {},
  ];

  // B1 事故现场：tokenCreatedAtSec 回退生效 → 11.5 天 lag 拦 expired_tweet
  const b1r = await performPreCheck(...precheckArgs(zeroToken, staleTwitter));
  check('B1 tokenCreatedAtSec 回退：拦 expired_tweet（low）',
    b1r?.rating === 'low' && b1r.details?.ruleName === 'expired_tweet', b1r);

  // B2 窗内 1h：放行（null=过预检）
  const b2r = await performPreCheck(...precheckArgs(zeroToken, freshTwitter));
  check('B2 窗内 1h 放行（不再误杀）', b2r === null, b2r);

  // B3 两锚皆缺：跳过过期检查（现状回归，不因缺锚拦）
  const b3r = await performPreCheck(...precheckArgs(noAnchorToken, staleTwitter));
  check('B3 两锚皆缺跳过（不误杀，现状语义）',
    b3r === null || b3r.details?.ruleName !== 'expired_tweet', b3r);

  // B4 raw_api_data.created_at 在（老路径）：仍拦（原行为不变）
  const rawAnchorToken = { symbol: '제로', name: 'Zero', raw_api_data: { name: 'Zero', created_at: ANCHOR_SEC } };
  const b4r = await performPreCheck(...precheckArgs(rawAnchorToken, staleTwitter));
  check('B4 raw created_at 在仍拦（原行为不变）',
    b4r?.rating === 'low' && b4r.details?.ruleName === 'expired_tweet', b4r);

  // ═══ C. 源码口径（防线锁定）═══
  console.log('\n── C. 源码口径 ──');
  const { readFileSync } = await import('fs');
  const { join, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const precheckSrc = readFileSync(join(__dirname, '../src/narrative/analyzer/services/pre-check-service.mjs'), 'utf8');
  const mapperSrc = readFileSync(join(__dirname, '../src/narrative/analyzer/llm/jev-result-mapper.mjs'), 'utf8');
  const rule2Idx = precheckSrc.indexOf('过期内容检查');
  const rule2Seg = precheckSrc.slice(rule2Idx, rule2Idx + 1200);
  check('C1 precheck 规则2 锚链含 tokenCreatedAtSec 回退（防回退链被删）',
    rule2Idx > 0 && rule2Seg.includes('tokenData.tokenCreatedAtSec || tokenData.raw_api_data?.created_at'), null);
  check('C2 两窗同源共存：mapper 6*3600 ↔ precheck 360min 默认',
    mapperSrc.includes('ANGLE_TWEET_STALE_SEC = 6 * 3600')
    && precheckSrc.includes('expiredTweetMinutesThreshold: 360'), null);

  console.log(`\n结果: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
