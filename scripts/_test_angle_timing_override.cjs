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
 *   lag > 6h → 时效归 older=0 分（mapper-only，题集版本不动——时效分本来就是
 *   代码查表）。C74（2026-10-16）后与 precheck 不再同窗：precheck 规则 2.1 已
 *   分桶（非豁免桶 300s / direct_tweet 豁免），本 override 降级为 Jev 层纵深
 *   防御（覆盖 ignoreExpired 穿透/锚缺失跳过/缓存残例）
 *
 * 覆盖：
 *   A. mapper override 矩阵：事故现场反证（lag 993367s → stage2 62→52 翻不过线）/
 *      窗内 1h 不干预 / direct_tweet 不干预 / interpretive_reply 命中 / 锚缺失
 *      fail-open / 载体时间缺失 fail-open / 主推老+quoted 新（任一新即活，与
 *      precheck tweetSources 同集对称）/ 6h 边界 21601|21599 / rawTiming 审计
 *   B. precheck 修复①：tokenCreatedAtSec 回退生效拦 expired_tweet / 窗内放行 /
 *      两锚皆缺跳过（现状回归）/ raw created_at 在仍拦（原行为不变）
 *   D. C75 叙事源头陈旧 override：direct_tweet 主推>30d（FLY 案）
 *   E. C102 借壳语料父推源头窗：binanceCorpus 票 in_reply_to 父推>24h（BAI 案
 *      0x11efcbd0…27777——binancezh 活动 3 天后第二波蹭，78.78 high→载体门接管拦；
 *      不限 type / 帕鲁贴线 88835s / 86400 边界 / 非借壳 bit-identical / 父推
 *      时间与锚缺失 fail-open / 载体不救 / 与 C75 并存双 override 各落）
 *   F. C103 载体↔父推关系源头窗（J1.39 条件题判关系+代码 24h 窗）：Jean Phil 翻译
 *      洗白案 0x6915bec6…7777——主推位 Dexerto 原生新闻推 20 天老+website_tweet 位
 *      小号翻译推 token 前 2s 洗白，63.65 压线过→翻译/二手解读臂归 older 53.65 拦；
 *      new_angle 豁免臂照放 / 86400 边界 / 槽位覆盖（主推位=BAI 形状）/ 父推窗内
 *      放 / 旧缓存行+unclear fail-open / 与 C102 并存双落 / hasReplyParent 四槽位
 *   C. 源码口径：pre-check-service 规则2 含 tokenCreatedAtSec 回退链 / mapper
 *      6h 纵深防御与 precheck 300s 分桶（C74）共存 / C103 三点锁（题面门控+接线+窗）
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
    event_token_block_reason: { choice: 'none', probabilities: { none: 0.88, event_empty_content: 0.12 } },
    web3_user_name_entity_acceptance: { choice: 'unknown', probabilities: { unknown: 0.43 } },
    event_subject_entity: { choice: 'character_ip', probabilities: { character_ip: 0.99 } },
    name_event_relevance: { choice: 'semantic', probabilities: { semantic: 0.9 } },
    relevance_level: { score: 3.6, probabilities: { '3': 0.4, '4': 0.5 } },
    web3_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.97 } },
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
  check('A1c timing 归 older', j1.effectiveTiming === 'older', j1.effectiveTiming);
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
    && a2.stage1DataToSave.parsed_output.jev.effectiveTiming === 'within_30d',
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
  // C86 幽灵字段修复：夹具改用生产真实键 quoted_status（twitter-fetcher 产出）——
  // 修复前 mapper 读 quoted_tweet 时本用例自洽掩盖（夹具错名=断言照样过），现在
  // 键名即生产形状，引用推作为「最新载体」真实可见是本案事故反证
  const mixedTwitter = { ...staleTwitter, quoted_status: { created_at: twitterDate(ANCHOR_SEC - 7200) } };
  const a7 = mapStandardAnswers(makeZeroAnswers(), makeContext(zeroToken, mixedTwitter, 'angle_seeking'));
  check('A7 主推老+quoted 新（任一新即活，quoted_status 生产形状）', a7.stage1DataToSave.parsed_output.jev.angleTimingOverride === null, a7.stage1DataToSave.parsed_output.jev.angleTimingOverride);

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

  // B2 窗内 60s：放行（null=过预检）。C74（2026-10-16）后非豁免桶窗 6h→300s——
  // 旧 fixture 1h 在旧 6h 窗内放行、新窗已拦（301s~6h 从「precheck 放、买门拦」
  // 变「评级直接 low」=本案配套语义变化），故改 60s 表窗内
  const freshTwitter60 = { ...staleTwitter, created_at: twitterDate(ANCHOR_SEC - 60) };
  const b2r = await performPreCheck(...precheckArgs(zeroToken, freshTwitter60));
  check('B2 窗内 60s 放行（不再误杀；C74 后非豁免窗=300s）', b2r === null, b2r);

  // B4 C86 引用推反证：主推 11.5 天老 + 引用推 60s 新（quoted_status=生产形状）→
  // 「任一新即放」必须把引用推算进语料源（修复前读 quoted_tweet 恒 undefined，
  // 引用推新不算数 → 误拦 expired_tweet）
  const b4Twitter = { ...staleTwitter, quoted_status: { created_at: twitterDate(ANCHOR_SEC - 60) } };
  const b4r = await performPreCheck(...precheckArgs(zeroToken, b4Twitter));
  check('B4 主推老+引用推新：引用推算进「任一新即放」→ 放行', b4r === null, b4r);

  // B3 两锚皆缺：跳过过期检查（现状回归，不因缺锚拦）
  const b3r = await performPreCheck(...precheckArgs(noAnchorToken, staleTwitter));
  check('B3 两锚皆缺跳过（不误杀，现状语义）',
    b3r === null || b3r.details?.ruleName !== 'expired_tweet', b3r);

  // B5 raw_api_data.created_at 在（老路径）：仍拦（原行为不变）
  const rawAnchorToken = { symbol: '제로', name: 'Zero', raw_api_data: { name: 'Zero', created_at: ANCHOR_SEC } };
  const b5r = await performPreCheck(...precheckArgs(rawAnchorToken, staleTwitter));
  check('B5 raw created_at 在仍拦（原行为不变）',
    b5r?.rating === 'low' && b5r.details?.ruleName === 'expired_tweet', b5r);

  // ═══ D. C75 叙事源头陈旧 override（mapper 层，FLY 案 0x4ec2…7777）═══
  console.log('\n── D. C75 叙事源头陈旧 override（direct_tweet 主推>30d）──');
  // FLY 事故现场形状：主推=币安 2025-06-08 公告（lag 495d），website_tweet=gapJ
  // 当天宣告推（lag 10s）——宣告推刻意不进判定集合（不构成事件新鲜证据）
  const FLY_LAG_SEC = 495 * 86400;
  const flyTwitter = {
    type: 'tweet', text: 'Binance is the first platform to feature fly. trade (FLY)',
    created_at: twitterDate(ANCHOR_SEC - FLY_LAG_SEC),
    website_tweet: { created_at: twitterDate(ANCHOR_SEC - 10) },  // 当天宣告推：救不了
  };
  const flyToken = { symbol: 'FLY', name: 'FLY token', tokenCreatedAtSec: ANCHOR_SEC, raw_api_data: { name: 'FLY token' } };

  // D1 事故现场反证：direct_tweet + lag 495d + 宣告推当天 → override 命中翻 low（对照 71.54 high）
  const d1 = mapStandardAnswers(makeZeroAnswers('within_7d'), makeContext(flyToken, flyTwitter, 'direct_tweet'));
  const d1j = d1.stage1DataToSave.parsed_output.jev;
  check('D1a override 命中：lagSec=42768000 (495d)', d1j.staleSourceOverride?.lagSec === FLY_LAG_SEC, d1j.staleSourceOverride);
  check('D1b Jev 原判档保留审计：rawTiming=within_7d', d1j.staleSourceOverride?.rawTiming === 'within_7d', d1j.staleSourceOverride);
  check('D1c 宣告推（website_tweet 当天）不救：timing 归 older', d1j.effectiveTiming === 'older', d1j.effectiveTiming);
  check('D1d 翻 low：影响力 2.5→50、时效override-18 后 50<60 拦', d1.stage2DataToSave.parsed_output.pass === false
    && d1.stageFinalData.eventCompositeScore === 50
    && d1.stageFinalData.category === 'low',
    { pass: d1.stage2DataToSave.parsed_output.pass, total: d1.stageFinalData.eventCompositeScore, cat: d1.stageFinalData.category });
  // 对照：同形状 unknown type（新门刻意不触达）→ 71.54 high（事故复现：门上线前放行）
  const d1c = mapStandardAnswers(makeZeroAnswers('within_7d'), makeContext(flyToken, flyTwitter, null));
  check('D1e 对照（unknown 不触达）：71.3 high（门上线前事故形态；J1.71 单题口径）',
    d1c.stageFinalData.totalScore === 71.3 && d1c.stageFinalData.category === 'high'
    && d1c.stage1DataToSave.parsed_output.jev.staleSourceOverride === null,
    { total: d1c.stageFinalData.totalScore, cat: d1c.stageFinalData.category });

  // D2 30d 边界：2592001 命中 / 2591999 放
  const d2a = mapStandardAnswers(makeZeroAnswers('within_7d'), makeContext(flyToken, { ...flyTwitter, created_at: twitterDate(ANCHOR_SEC - 2592001) }, 'direct_tweet'));
  const d2b = mapStandardAnswers(makeZeroAnswers('within_7d'), makeContext(flyToken, { ...flyTwitter, created_at: twitterDate(ANCHOR_SEC - 2591999) }, 'direct_tweet'));
  check('D2 边界 lag=2592001 命中 / 2591999 放',
    d2a.stage1DataToSave.parsed_output.jev.staleSourceOverride !== null
    && d2b.stage1DataToSave.parsed_output.jev.staleSourceOverride === null,
    { hi: d2a.stage1DataToSave.parsed_output.jev.staleSourceOverride, lo: d2b.stage1DataToSave.parsed_output.jev.staleSourceOverride });

  // D3 type 互斥：angle_seeking 同 lag 不触新门（C68 域），由 angle 门接管（载体集合
  // 另算——本案 website_tweet 当天=最新载体活，angle 门也不拦=angle 语义保留）
  const d3 = mapStandardAnswers(makeZeroAnswers('within_7d'), makeContext(flyToken, flyTwitter, 'angle_seeking'));
  check('D3 angle_seeking 不触 staleSource（C68 域 type 互斥）且 angle 门载体集不含宣告救活形状不拦',
    d3.stage1DataToSave.parsed_output.jev.staleSourceOverride === null
    && d3.stage1DataToSave.parsed_output.jev.angleTimingOverride === null
    && d3.stage1DataToSave.parsed_output.jev.effectiveTiming === 'within_7d',
    d3.stage1DataToSave.parsed_output.jev);

  // D4 锚缺失：fail-open 不干预（与 C68 A5 对称）
  const d4 = mapStandardAnswers(makeZeroAnswers('within_7d'), makeContext(noAnchorToken, flyTwitter, 'direct_tweet'));
  check('D4 锚缺失 fail-open', d4.stage1DataToSave.parsed_output.jev.staleSourceOverride === null, d4.stage1DataToSave.parsed_output.jev.staleSourceOverride);

  // D5 主推时间缺失：fail-open
  const d5 = mapStandardAnswers(makeZeroAnswers('within_7d'), makeContext(flyToken, { type: 'tweet', text: '无时间戳' }, 'direct_tweet'));
  check('D5 主推时间缺失 fail-open', d5.stage1DataToSave.parsed_output.jev.staleSourceOverride === null, d5.stage1DataToSave.parsed_output.jev.staleSourceOverride);

  // D6 Jev 已答 older：审计仍落（可追溯），结果不变（零分轴本就是 0）
  const d6 = mapStandardAnswers(makeZeroAnswers('older'), makeContext(flyToken, flyTwitter, 'direct_tweet'));
  check('D6 Jev 已答 older：审计落 + timing 仍 older',
    d6.stage1DataToSave.parsed_output.jev.staleSourceOverride?.lagSec === FLY_LAG_SEC
    && d6.stage1DataToSave.parsed_output.jev.effectiveTiming === 'older',
    d6.stage1DataToSave.parsed_output.jev);

  // ═══ E. C102 借壳语料父推源头窗（mapper 层，BAI 案 0x11efcbd0…27777）═══
  console.log('\n── E. C102 借壳语料父推源头窗（binanceCorpus 父推>24h → older）──');
  // BAI 事故现场（DB 实证）：binancezh 活动推 2026-10-15T12:15:25Z → 帕鲁 10-16
  // 第一波蹭 → zhuifei008 参赛推 10-18 09:05:10 → 50 秒后发币（锚=eventTsSec
  // 1792314360）。Jev 判 within_7d + 五腿全中（super_ip 0.94/关联 0.74/mem 3.2/
  // fresh/strong_fit 0.99）→ C88 豁免 J1.29 载体门 → 78.78 high 放行。
  // 时效三件套全盲：C74 锚主推 50s+粉豁免 / C75 只锚主推 / C97 只查主推作者
  // ——父推位（binancezh）全盲。答案=stage1_raw_output 全 17 题逐字抄录。
  const BAI_ANCHOR = 1792314360;            // 2026-10-18T09:06:00Z token 创建
  const BAI_PARENT_SEC = BAI_ANCHOR - 247835; // 2026-10-15T12:15:25Z 父推（lag=2d20h50m35s）
  const makeBaiAnswers = () => JSON.parse(JSON.stringify({
    event_category: { choice: 'D', probabilities: { A: 0, W: 0, B: 0, F: 0, G: 0, C: 0, D: 0.68, E: 0.32 } },
    event_magnitude: { score: 3.87, probabilities: { '0': 0, '1': 0.01, '2': 0.06, '3': 0.37, '4': 0.15, '5': 0.41 } },
    event_timing: { choice: 'within_7d', probabilities: { within_7d: 1, within_30d: 0, older: 0, expected_within_30d: 0, expected_beyond_30d: 0, unknown: 0 } },
    dimension2: { score: 4.02, probabilities: { '0': 0.01, '1': 0.01, '2': 0.03, '3': 0.21, '4': 0.4, '5': 0.34 } },
    event_token_block_reason: { choice: 'low_quality_derivative', probabilities: { none: 0.09, subject_unqualified: 0, niche_subculture: 0, event_empty_content: 0.02, event_institution_routine: 0.18, low_quality_derivative: 0.56, event_marketing_gimmick: 0.1, event_baseless_speculation: 0, token_ip_reuse: 0.04, regional_event: 0, event_negative_hard_news: 0, event_routine_content_product: 0 } },
    web3_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.99, fit: 0.01, marginal: 0, unfit: 0 } },
    event_subject_entity: { choice: 'product_functional', probabilities: { company: 0.12, product_functional: 0.65, product_character: 0.01, character_ip: 0, person: 0, event_hotspot: 0.22 } },
    w_product_score: { score: 0.17, probabilities: { '0': 0.87, '1': 0.09, '2': 0.03, '3': 0.01 } },
    w_bsc_user_appeal: { score: 2.26, probabilities: { '0': 0.14, '1': 0.05, '2': 0.22, '3': 0.59 } },
    name_event_relevance: { choice: 'exact_match', probabilities: { exact_match: 0.55, translation_match: 0.01, abbreviation_alias: 0.07, semantic: 0.11, cultural: 0, generic_content: 0, none: 0.06 } },
    relevance_level: { score: 2.69, probabilities: { '0': 0.03, '1': 0.12, '2': 0.21, '3': 0.41, '4': 0.23 } },
    web3_user_name_entity_acceptance: { choice: 'accepted', probabilities: { unknown: 0.04, accepted: 0.94, no_entity: 0.02 } },
    name_entity_memeability: { score: 3.2, probabilities: { '0': 0.05, '1': 0.03, '2': 0.02, '3': 0.54, '4': 0.26, '5': 0.1 } },
    name_entity_carrier: { choice: 'no_visual_entity', probabilities: { existing_entity: 0, improvised_entity: 0, no_visual_entity: 1 } },
    block_misspelling: { noul: 0.16 },
    quality_spelling: { score: 2.77, probabilities: { '0': 0.03, '1': 0.04, '2': 0.06, '3': 0.87 } },
    quality_reasonability: { score: 0.96, probabilities: { '0': 0.36, '1': 0.31, '2': 0.33 } },
  }));
  const baiToken = { symbol: 'BAI', name: 'BAI', tokenCreatedAtSec: BAI_ANCHOR, raw_api_data: { name: 'BAI' } };
  const makeBaiTwitter = (parentSec, extra = {}) => ({
    type: 'tweet', text: '币安ai\n币安ai\n币安ai https://t.co/PXr89964YI',
    created_at: twitterDate(BAI_ANCHOR - 50),  // 载体 50s 新鲜（洗白路径本体）
    author_screen_name: 'zhuifei008', author_followers_count: 12905,
    in_reply_to: {
      text: 'bStocks 不用卖不用卖！……参与「创意广告大赛」，赢iPhone Duo与BNB……宣传任意币安产品，包括但不限于 Binance AI、bStocks等',
      created_at: twitterDate(parentSec),
      author_screen_name: 'binancezh', author_followers_count: 464326,
    },
    ...extra,
  });

  // E1 事故现场反证：fixture 逐位重现 78.78 high（门上线前形态=父推换成 1h 新鲜）
  const e1before = mapStandardAnswers(makeBaiAnswers(), makeContext(baiToken, makeBaiTwitter(BAI_ANCHOR - 3600), 'direct_tweet'));
  check('E1a fixture 逐位重现事故：80.17 high pass=true（父推新鲜=门不触；J1.71 单题口径）',
    e1before.stageFinalData.totalScore === 80.17
    && e1before.stageFinalData.category === 'high'
    && e1before.stage1DataToSave.parsed_output.jev.staleParentOverride === null,
    { total: e1before.stageFinalData.totalScore, cat: e1before.stageFinalData.category });
  const e1 = mapStandardAnswers(makeBaiAnswers(), makeContext(baiToken, makeBaiTwitter(BAI_PARENT_SEC), 'direct_tweet'));
  const e1j = e1.stage1DataToSave.parsed_output.jev;
  check('E1b override 命中：lagSec=247835（2d20h50m35s）staleSec=86400 rawTiming=within_7d',
    e1j.staleParentOverride?.lagSec === 247835
    && e1j.staleParentOverride?.staleSec === 86400
    && e1j.staleParentOverride?.rawTiming === 'within_7d',
    e1j.staleParentOverride);
  check('E1c timing 归 older + C75 不触（主推 50s 新鲜——载体洗白路径正是事故根因）',
    e1j.effectiveTiming === 'older' && e1j.staleSourceOverride === null,
    { timing: e1j.effectiveTiming, staleSource: e1j.staleSourceOverride });
  check('E1d 翻 low：C88 五腿第四腿（FRESH_TIMING）断 → J1.29 载体门接管拦截',
    e1.stage2DataToSave.parsed_output.pass === false
    && e1.stage2DataToSave.parsed_output.blockReason === '叙事主体无形象载体（无形象实体）',
    { pass: e1.stage2DataToSave.parsed_output.pass, block: e1.stage2DataToSave.parsed_output.blockReason });

  // E2 帕鲁案贴线形状：同活动推 10-16 12:56 蹭（lag=1d40m35s=88835s>86400）也拦
  const PALU_LAG_SEC = 88835;
  const e2 = mapStandardAnswers(makeBaiAnswers(), makeContext(
    { ...baiToken, tokenCreatedAtSec: BAI_PARENT_SEC + PALU_LAG_SEC }, makeBaiTwitter(BAI_PARENT_SEC), 'direct_tweet'));
  check('E2 帕鲁形状（父推 lag=88835s 第一波蹭）命中',
    e2.stage1DataToSave.parsed_output.jev.staleParentOverride?.lagSec === PALU_LAG_SEC,
    e2.stage1DataToSave.parsed_output.jev.staleParentOverride);

  // E3 24h 边界：86401 命中 / 86400 严格 > 不命中
  const e3a = mapStandardAnswers(makeBaiAnswers(), makeContext(baiToken, makeBaiTwitter(BAI_ANCHOR - 86401), 'direct_tweet'));
  const e3b = mapStandardAnswers(makeBaiAnswers(), makeContext(baiToken, makeBaiTwitter(BAI_ANCHOR - 86400), 'direct_tweet'));
  check('E3 边界 lag=86401 命中 / 86400 放',
    e3a.stage1DataToSave.parsed_output.jev.staleParentOverride !== null
    && e3b.stage1DataToSave.parsed_output.jev.staleParentOverride === null,
    { hi: e3a.stage1DataToSave.parsed_output.jev.staleParentOverride, lo: e3b.stage1DataToSave.parsed_output.jev.staleParentOverride });

  // E4 非借壳对照（bit-identical 防线）：语料/币名全无 binance/币安 → 同 3d 父推形状不触
  const e4Twitter = makeBaiTwitter(BAI_PARENT_SEC);
  e4Twitter.text = '某游戏活动参与推'; e4Twitter.in_reply_to.text = '某游戏官方活动推';
  const e4 = mapStandardAnswers(makeBaiAnswers(), makeContext(
    { ...baiToken, symbol: 'GAME', name: 'Game token', raw_api_data: { name: 'Game token' } }, e4Twitter, 'direct_tweet'));
  check('E4 非借壳语料同形状不触（宽判据是前置门，误伤零）',
    e4.stage1DataToSave.parsed_output.jev.staleParentOverride === null
    && e4.stage1DataToSave.parsed_output.jev.effectiveTiming === 'within_7d',
    e4.stage1DataToSave.parsed_output.jev);

  // E5 父推时间缺失：fail-open 不干预（与 C68 A6/C75 D5 对称）
  const e5Twitter = makeBaiTwitter(BAI_PARENT_SEC);
  delete e5Twitter.in_reply_to.created_at;
  const e5 = mapStandardAnswers(makeBaiAnswers(), makeContext(baiToken, e5Twitter, 'direct_tweet'));
  check('E5 父推时间缺失 fail-open', e5.stage1DataToSave.parsed_output.jev.staleParentOverride === null,
    e5.stage1DataToSave.parsed_output.jev.staleParentOverride);

  // E6 无 in_reply_to（主推非回复形态）：fail-open
  const e6Twitter = makeBaiTwitter(BAI_PARENT_SEC);
  delete e6Twitter.in_reply_to;
  const e6 = mapStandardAnswers(makeBaiAnswers(), makeContext(baiToken, e6Twitter, 'direct_tweet'));
  check('E6 无 in_reply_to fail-open', e6.stage1DataToSave.parsed_output.jev.staleParentOverride === null,
    e6.stage1DataToSave.parsed_output.jev.staleParentOverride);

  // E7 载体不救：主推+quoted 都 50s 新鲜仍拦（载体不构成源头新鲜证据，C75 同理）
  const e7 = mapStandardAnswers(makeBaiAnswers(), makeContext(baiToken,
    makeBaiTwitter(BAI_PARENT_SEC, { quoted_status: { created_at: twitterDate(BAI_ANCHOR - 50) } }), 'direct_tweet'));
  check('E7 载体（主推/quoted）新鲜不救：仍 override',
    e7.stage1DataToSave.parsed_output.jev.staleParentOverride?.lagSec === 247835,
    e7.stage1DataToSave.parsed_output.jev.staleParentOverride);

  // E8 不限 type：angle_seeking 载体 50s（C68 窗内不拦）+ 父推 3d → 本门单拦
  const e8 = mapStandardAnswers(makeBaiAnswers(), makeContext(baiToken, makeBaiTwitter(BAI_PARENT_SEC), 'angle_seeking'));
  check('E8 angle_seeking 同形状也拦（判据轴=源头事件年龄非载体行为）+ C68 不双拦（载体 50s 窗内）',
    e8.stage1DataToSave.parsed_output.jev.staleParentOverride?.lagSec === 247835
    && e8.stage1DataToSave.parsed_output.jev.angleTimingOverride === null,
    { p: e8.stage1DataToSave.parsed_output.jev.staleParentOverride, a: e8.stage1DataToSave.parsed_output.jev.angleTimingOverride });

  // E9 与 C75 并存：主推 495d（FLY 形状）+ 父推 25h → 双 override 各落审计键，同归 older
  const e9Twitter = {
    ...makeBaiTwitter(BAI_ANCHOR - 86400 - 3600),
    created_at: twitterDate(BAI_ANCHOR - FLY_LAG_SEC),
  };
  const e9 = mapStandardAnswers(makeBaiAnswers(), makeContext(baiToken, e9Twitter, 'direct_tweet'));
  check('E9 C75+C102 并存：双 override 各落（495d 主推 + 25h 父推），timing older',
    e9.stage1DataToSave.parsed_output.jev.staleSourceOverride?.lagSec === FLY_LAG_SEC
    && e9.stage1DataToSave.parsed_output.jev.staleParentOverride?.lagSec === 90000
    && e9.stage1DataToSave.parsed_output.jev.effectiveTiming === 'older',
    { s: e9.stage1DataToSave.parsed_output.jev.staleSourceOverride, p: e9.stage1DataToSave.parsed_output.jev.staleParentOverride });

  // E10 锚缺失：fail-open 不干预（与 C68 A5/C75 D4 对称）
  const e10 = mapStandardAnswers(makeBaiAnswers(), makeContext(
    { symbol: 'BAI', name: 'BAI', raw_api_data: { name: 'BAI' } }, makeBaiTwitter(BAI_PARENT_SEC), 'direct_tweet'));
  check('E10 锚缺失 fail-open', e10.stage1DataToSave.parsed_output.jev.staleParentOverride === null,
    e10.stage1DataToSave.parsed_output.jev.staleParentOverride);

  // ═══ F. C103 载体↔父推关系源头窗（Jean Phil 翻译洗白案 0x6915bec6…7777）═══
  console.log('\n── F. C103 载体↔父推关系源头窗（J1.39 条件题 + mapper 24h 窗）──');
  // 事故现场（DB stage1_raw_output 实证，J1.36 17 题原答案逐字段转录）：
  // 主推位=Dexerto 原生新闻推（145 万粉，9-28 报道 Jean Phil 币 $8M=20 天老）+
  // website_tweet 位=229 粉「热点挖掘机」token 前 2s 的中文翻译推（reply Dexerto）
  const JP_ANCHOR = 1792306117;            // token 创建锚（raw_api_data.eventTs）
  const JP_PARENT_SEC = 1790587807;        // Dexerto 父推 created_at（Sep 28 09:30:07Z）
  const JP_PARENT_LAG = 1718310;           // 20 天老源头（19.89d）——C75 30d 窗内漏过
  function makeJeanPhilAnswers(relChoice) {
    const base = {
      event_category: { choice: 'A', probabilities: { A: 0.8, W: 0.1, B: 0, F: 0, G: 0, C: 0, D: 0, E: 0.1 } },
      event_magnitude: { score: 3.04, probabilities: { '0': 0, '1': 0.01, '2': 0.05, '3': 0.81, '4': 0.12, '5': 0 } },
      event_timing: { choice: 'within_30d', probabilities: { within_7d: 0.03, within_30d: 0.96, older: 0.01, expected_within_30d: 0, expected_beyond_30d: 0, unknown: 0 } },
      dimension2: { score: 3.73, probabilities: { '0': 0.01, '1': 0.03, '2': 0.04, '3': 0.19, '4': 0.63, '5': 0.1 } },
      event_token_block_reason: { choice: 'none', probabilities: { none: 0.97, subject_unqualified: 0.01, niche_subculture: 0, event_empty_content: 0, event_institution_routine: 0, low_quality_derivative: 0.02, event_marketing_gimmick: 0, event_baseless_speculation: 0, token_ip_reuse: 0, regional_event: 0, event_negative_hard_news: 0, event_routine_content_product: 0 } },
      web3_user_event_fit: { choice: 'strong_fit', probabilities: { strong_fit: 0.98, fit: 0.02, marginal: 0, unfit: 0 } },
      event_subject_entity: { choice: 'character_ip', probabilities: { company: 0, product_functional: 0, product_character: 0, character_ip: 0.96, person: 0, event_hotspot: 0.04, meme_word: 0, none_of_above: 0 } },
      w_product_score: { score: 0.66, probabilities: { '0': 0.66, '1': 0.09, '2': 0.19, '3': 0.06 } },
      w_bsc_user_appeal: { score: 0, probabilities: { '0': 1, '1': 0, '2': 0, '3': 0 } },
      name_event_relevance: { choice: 'exact_match', probabilities: { exact_match: 0.93, translation_match: 0.01, abbreviation_alias: 0.03, semantic: 0.03, cultural: 0, generic_concept: 0, none: 0 } },
      relevance_level: { score: 3.79, probabilities: { '0': 0, '1': 0.01, '2': 0.02, '3': 0.13, '4': 0.84 } },
      web3_user_name_entity_acceptance: { choice: 'unknown', probabilities: { unknown: 0.99, accepted: 0.01, no_entity: 0 } },
      name_entity_memeability: { score: 3.61, probabilities: { '0': 0.02, '1': 0, '2': 0.03, '3': 0.39, '4': 0.41, '5': 0.15 } },
      name_entity_carrier: { choice: 'existing_entity', probabilities: { existing_entity: 0.99, improvised_entity: 0, no_visual_entity: 0.01 } },
      block_misspelling: { noul: 0.12 },
      quality_spelling: { score: 2.5, probabilities: { '0': 0.11, '1': 0.05, '2': 0.07, '3': 0.77 } },
      quality_reasonability: { score: 1.73, probabilities: { '0': 0.05, '1': 0.17, '2': 0.78 } },
    };
    return relChoice ? { ...base, parent_relationship: { choice: relChoice } } : base;
  }
  const jpToken = { symbol: 'Jean Phil', name: 'Jean Phil', tokenCreatedAtSec: JP_ANCHOR, raw_api_data: { name: 'Jean Phil' } };
  const makeJeanPhilTwitter = (parentSec, extra = {}) => ({
    type: 'tweet',
    text: 'AI-generated influencer Jean Phil has spawned a meme coin valued at over $8 million\n\nNow copycat AI characters are emerging with their own fake rivalries and crypto tokens https://t.co/iXvhcuzPmm',
    created_at: twitterDate(parentSec),  // 主推位=Dexerto 原推本体（20 天老，非 binance 语料）
    author_screen_name: 'Dexerto', author_followers_count: 1450108,
    metrics: { retweet_count: 108, favorite_count: 3449 },
    website_tweet: {
      text: 'AI 生成的虚拟爆红网红 Jean Phil，靠一段巴黎街头打空气拳的视频爆火，身后催生出一枚市值超 800 万美元的 meme 币。',
      created_at: twitterDate(JP_ANCHOR - 2),  // 翻译推 token 前 2s（洗白载体本体）
      author_screen_name: 'rega_sport', author_followers_count: 229,
      in_reply_to: {
        text: 'AI-generated influencer Jean Phil has spawned a meme coin valued at over $8 million\n\nNow copycat AI characters are emerging with their own fake rivalries and crypto tokens',
        created_at: twitterDate(parentSec),
        author_screen_name: 'Dexerto', author_followers_count: 1450108,
      },
    },
    ...extra,
  });

  // F1 事故现场反证：fixture 逐位重现 63.65 压线过（J1.38- 旧答案无 parent_relationship
  // = 门上线前形态；主推 20d<30d C75 不触、载体集 website_tweet 2s 新鲜 C68 不触）
  const f1before = mapStandardAnswers(makeJeanPhilAnswers(), makeContext(jpToken, makeJeanPhilTwitter(JP_PARENT_SEC), 'direct_tweet'));
  check('F1a fixture 逐位重现事故：stage2 60.8 压线过（翻译推洗白 20 天源头，三时效门全盲；J1.71 单题口径）',
    f1before.stage2DataToSave.parsed_output.scoringResult.eventCompositeScore === 60.8
    && f1before.stage2DataToSave.parsed_output.pass === true
    && f1before.stage1DataToSave.parsed_output.jev.staleRelParentOverride === null
    && f1before.stage1DataToSave.parsed_output.jev.effectiveTiming === 'within_30d',
    { t: f1before.stage2DataToSave.parsed_output.scoringResult.eventCompositeScore, o: f1before.stage1DataToSave.parsed_output.jev.staleRelParentOverride });
  const f1 = mapStandardAnswers(makeJeanPhilAnswers('translation_or_repost'), makeContext(jpToken, makeJeanPhilTwitter(JP_PARENT_SEC), 'direct_tweet'));
  const f1j = f1.stage1DataToSave.parsed_output.jev;
  check('F1b override 命中：lagSec=1718310（19.89d）staleSec=86400 choice=translation_or_repost rawTiming=within_30d',
    f1j.staleRelParentOverride?.lagSec === JP_PARENT_LAG
    && f1j.staleRelParentOverride?.staleSec === 86400
    && f1j.staleRelParentOverride?.choice === 'translation_or_repost'
    && f1j.staleRelParentOverride?.rawTiming === 'within_30d',
    f1j.staleRelParentOverride);
  check('F1c 翻转：时效 override → 60.8−18=42.8<60 拦（J1.71 合并扣分）',
    f1j.effectiveTiming === 'older'
    && f1.stage2DataToSave.parsed_output.pass === false
    && f1.stage2DataToSave.parsed_output.blockReason === '事件分不足（42.8<60）'
    && f1.stage2DataToSave.category === 'low',
    { pass: f1.stage2DataToSave.parsed_output.pass, block: f1.stage2DataToSave.parsed_output.blockReason });
  // F1d 用户裁定豁免臂：新角度解读原生父推 → 父推可老，不 override（63.65 原样）
  const f1d = mapStandardAnswers(makeJeanPhilAnswers('new_angle_on_original'), makeContext(jpToken, makeJeanPhilTwitter(JP_PARENT_SEC), 'direct_tweet'));
  check('F1d 豁免臂：new_angle_on_original（找角度推文解释原生推文）父推 20 天照放',
    f1d.stage1DataToSave.parsed_output.jev.staleRelParentOverride === null
    && f1d.stage2DataToSave.parsed_output.pass === true
    && f1d.stage2DataToSave.parsed_output.scoringResult.eventCompositeScore === 60.8,
    { o: f1d.stage1DataToSave.parsed_output.jev.staleRelParentOverride, t: f1d.stage2DataToSave.parsed_output.scoringResult.eventCompositeScore });

  // F2 解释二手找角度推臂：与翻译臂同拦（用户裁定两臂并列）
  const f2 = mapStandardAnswers(makeJeanPhilAnswers('explains_derivative'), makeContext(jpToken, makeJeanPhilTwitter(JP_PARENT_SEC), 'direct_tweet'));
  check('F2 explains_derivative（解释另一个找角度推文）同拦 lagSec=1718310',
    f2.stage1DataToSave.parsed_output.jev.staleRelParentOverride?.lagSec === JP_PARENT_LAG
    && f2.stage1DataToSave.parsed_output.jev.effectiveTiming === 'older',
    f2.stage1DataToSave.parsed_output.jev.staleRelParentOverride);

  // F3 24h 边界：86401 命中 / 86400 严格 > 不命中
  const f3a = mapStandardAnswers(makeJeanPhilAnswers('translation_or_repost'), makeContext(jpToken, makeJeanPhilTwitter(JP_ANCHOR - 86401), 'direct_tweet'));
  const f3b = mapStandardAnswers(makeJeanPhilAnswers('translation_or_repost'), makeContext(jpToken, makeJeanPhilTwitter(JP_ANCHOR - 86400), 'direct_tweet'));
  check('F3 边界 lag=86401 命中 / 86400 放',
    f3a.stage1DataToSave.parsed_output.jev.staleRelParentOverride !== null
    && f3b.stage1DataToSave.parsed_output.jev.staleRelParentOverride === null,
    { hi: f3a.stage1DataToSave.parsed_output.jev.staleRelParentOverride, lo: f3b.stage1DataToSave.parsed_output.jev.staleRelParentOverride });

  // F4 槽位覆盖：父推在主推位（BAI 案形状）同拦——两案实证全集扫描必要性
  const f4Twitter = makeJeanPhilTwitter(JP_PARENT_SEC);
  f4Twitter.in_reply_to = { ...f4Twitter.website_tweet.in_reply_to };
  delete f4Twitter.website_tweet;
  const f4 = mapStandardAnswers(makeJeanPhilAnswers('translation_or_repost'), makeContext(jpToken, f4Twitter, 'direct_tweet'));
  check('F4 槽位覆盖：父推在主推位（无 website_tweet）同拦',
    f4.stage1DataToSave.parsed_output.jev.staleRelParentOverride?.lagSec === JP_PARENT_LAG,
    f4.stage1DataToSave.parsed_output.jev.staleRelParentOverride);

  // F5 父推新鲜（1h）：关系差但源头新 → 不干预（24h 窗内=用户裁定「时效性足够」）
  const f5 = mapStandardAnswers(makeJeanPhilAnswers('translation_or_repost'), makeContext(jpToken, makeJeanPhilTwitter(JP_ANCHOR - 3600), 'direct_tweet'));
  check('F5 父推 1h 新鲜：翻译关系也不拦（24h 窗内放行）',
    f5.stage1DataToSave.parsed_output.jev.staleRelParentOverride === null
    && f5.stage2DataToSave.parsed_output.pass === true,
    f5.stage1DataToSave.parsed_output.jev.staleRelParentOverride);

  // F6 答案缺失（J1.38- 旧缓存行 fail-open）：F1a 已证（同形状无答案=不干预）；
  // F7 unclear fail-open：与 C96 name_form/event_finding_vs_recap 同语义
  const f7 = mapStandardAnswers(makeJeanPhilAnswers('unclear'), makeContext(jpToken, makeJeanPhilTwitter(JP_PARENT_SEC), 'direct_tweet'));
  check('F7 unclear fail-open（语料不足以区分三者不干预）',
    f7.stage1DataToSave.parsed_output.jev.staleRelParentOverride === null
    && f7.stage2DataToSave.parsed_output.pass === true,
    f7.stage1DataToSave.parsed_output.jev.staleRelParentOverride);

  // F8 与 C102 并存：币安借壳票（C102 无条件拦）+ 关系答案同票 → 双 override 各落审计键
  const f8 = mapStandardAnswers(
    { ...makeBaiAnswers(), parent_relationship: { choice: 'translation_or_repost' } },
    makeContext(baiToken, makeBaiTwitter(BAI_PARENT_SEC), 'direct_tweet'));
  check('F8 C102+C103 并存：binanceCorpus 无条件 + 关系臂双落，timing older',
    f8.stage1DataToSave.parsed_output.jev.staleParentOverride?.lagSec === 247835
    && f8.stage1DataToSave.parsed_output.jev.staleRelParentOverride?.lagSec === 247835
    && f8.stage1DataToSave.parsed_output.jev.effectiveTiming === 'older',
    { c102: f8.stage1DataToSave.parsed_output.jev.staleParentOverride, c103: f8.stage1DataToSave.parsed_output.jev.staleRelParentOverride });

  // F9 锚缺失：fail-open（与 C68 A5/C75 D4/C102 E10 对称）
  const f9 = mapStandardAnswers(makeJeanPhilAnswers('translation_or_repost'), makeContext(
    { symbol: 'Jean Phil', name: 'Jean Phil', raw_api_data: { name: 'Jean Phil' } }, makeJeanPhilTwitter(JP_PARENT_SEC), 'direct_tweet'));
  check('F9 锚缺失 fail-open', f9.stage1DataToSave.parsed_output.jev.staleRelParentOverride === null,
    f9.stage1DataToSave.parsed_output.jev.staleRelParentOverride);

  // F10 hasReplyParent 导出闸（J1.39 条件题问出判据，analyzer/mapper 共用防漂移）
  const { hasReplyParent } = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  check('F10 hasReplyParent 四槽位判定（主推/website/quoted/retweeted 任一有父推=true，无=false）',
    hasReplyParent(makeJeanPhilTwitter(JP_PARENT_SEC)) === true
    && hasReplyParent({ in_reply_to: { created_at: 'x' } }) === true
    && hasReplyParent({ quoted_status: { in_reply_to: {} } }) === true
    && hasReplyParent({ retweeted_status: { in_reply_to: {} } }) === true
    && hasReplyParent({ type: 'tweet', text: '无父推' }) === false
    && hasReplyParent(null) === false,
    { a: hasReplyParent(makeJeanPhilTwitter(JP_PARENT_SEC)), b: hasReplyParent({ type: 'tweet' }) });

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
  check('C2 mapper 6h 纵深防御 + precheck 300s 分桶共存（C74 后不再同窗：上游 300s 吞主力拦截，6h 兜 ignoreExpired 穿透/锚缺失/缓存残例）',
    mapperSrc.includes('ANGLE_TWEET_STALE_SEC = 6 * 3600')
    && precheckSrc.includes('NON_EXEMPT_TWEET_FRESH_SEC = 300')
    && precheckSrc.includes('classifyTweetType(twitterInfo)'), null);
  check('C3 C75 源头陈旧窗常量与互斥锁定（30d 对齐 within_30d/older 档边界；仅 direct_tweet 域）',
    mapperSrc.includes('SOURCE_STALE_SEC = 30 * 86400')
    && mapperSrc.includes("tweetClassification.type !== 'direct_tweet'"), null);
  check('C4 C102 借壳语料父推源头窗锁定（24h 窗常量 + in_reply_to 判定轴 + binanceCorpus 前置门）',
    mapperSrc.includes('BINANCE_PARENT_STALE_SEC = 24 * 3600')
    && mapperSrc.includes('twitterInfo?.in_reply_to?.created_at')
    && mapperSrc.includes('function overrideStaleParentTiming(binanceCorpus'), null);
  const questionsSrc = readFileSync(join(__dirname, '../src/narrative/analyzer/llm/jev-questions.mjs'), 'utf8');
  const analyzerSrc = readFileSync(join(__dirname, '../src/narrative/analyzer/NarrativeAnalyzer.mjs'), 'utf8');
  check('C5 C103 源码口径（题面/门控/接线三点锁）：版本 bump（J1.53=C122 门名断代号；J1.52=C121 用户视角批次一；J1.47=C114 名字门通用梗缩写锚；J1.46=C113 找角度判轴+token_ip_reuse 边界；J1.45=C110 扫描后裁定 dim2 同轴锚删除+gimmick 扩全域；J1.44=C110 合桶+mem 瘦身；J1.43=C109 题集收敛）+ 条件题 parentRelationship 门 + analyzer hasReplyParent 接线 + mapper 24h 窗与审计键',
    questionsSrc.includes("JEV_QUESTIONS_VERSION = 'J1.74'")
    && questionsSrc.includes('...(parentRelationship ? {')
    && questionsSrc.includes('parent_relationship:')
    && analyzerSrc.includes('parentRelationship: hasReplyParent(twitterInfo)')
    && mapperSrc.includes('PARENT_REL_STALE_SEC = 24 * 3600')
    && mapperSrc.includes('function overrideStaleRelParentTiming(answers')
    && mapperSrc.includes('staleRelParentOverride,'), null);

  console.log(`\n结果: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
