#!/usr/bin/env node
/**
 * 消灭引擎侧 unrated（2026-09-27 用户裁定）——本地零网络零 DB 单测
 *
 * 裁定：叙事分析引擎除"直调失败/超时/未触发"（NarrativeDirectCaller 归 9）外
 * 不要有 unrated——过与不过总归要有结论。本测覆盖产出侧全部改动点：
 *
 *   1. prestage mapper（P1.4；P1.9 web3ip 年龄门豁免）：
 *      - abm 双条件满足 unrated→mid；不满足 low（不变）
 *      - web3_native_ip_early 复用 rateProject 粉丝带；P1.9（C46 MarsCoin 案）
 *        不吃 P1.3 年龄降档（账号随币而生/社区后建是 web3 原生 IP 常态），
 *        推文 <5 拦截保留；project 路径年龄门语义不变
 *      - project 评级回归不受影响
 *   2. pre-check 高影响力门槛（9 处 unrated→mid + pass:true）：
 *      - 抖音爆款视频（64.8 万赞 C4 案形态）→ mid + pass:true
 *      - 小红书高粉 → mid + pass:true
 *      - 低数据不触发门槛（交给 LLM，不再出 unrated）
 *   3. resolveFinalRating 历史兼容：存量 unrated 行仍解析 unrated；
 *      新 mid 行（pass:true）解析 mid
 *
 * 用法：node scripts/_test_unrated_elimination.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(desc, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  ✓ ${desc}`); }
  else { failed++; console.error(`  ✗ ${desc}\n      期望: ${e}\n      实际: ${a}`); }
}

(async () => {
  const { mapPrestageAnswers } = await import('../src/narrative/analyzer/llm/jev-prestage-mapper.mjs');
  const { JEV_PRESTAGE_QUESTIONS_VERSION } = await import('../src/narrative/analyzer/llm/jev-prestage-questions.mjs');
  const { performPreCheck } = await import('../src/narrative/analyzer/services/pre-check-service.mjs');
  const { resolveFinalRating } = await import('../src/narrative/utils/rating-utils.mjs');

  console.log('== 0. 版本 bump ==');
  check('P1.9', JEV_PRESTAGE_QUESTIONS_VERSION, 'P1.9');

  // ── mapper 测试基础设施 ────────────────────────────────────────────
  const callInfo = {
    model: 'test', questions: { q1: { type: 'choice' } }, stateStats: { totalChars: 10 },
    state: 'test-state', usage: {}, startedAt: '2026-09-27T00:00:00Z', finishedAt: '2026-09-27T00:00:01Z',
  };
  const TOKEN_CREATED_SEC = Math.floor(Date.parse('2026-09-27T00:00:00Z') / 1000);
  // 老号（2020 注册）多推文——P1.3 降档两臂都不触发
  const account = (over = {}) => ({
    type: 'account', screen_name: 'acct', followers_count: 168, statuses_count: 200,
    created_at: '2020-01-01T00:00:00Z', ...over,
  });
  const ctx = (data, answers, over = {}) => ({
    fullAccountOrCommunityData: data, addressVerified: true, rulesResult: null,
    tokenCreatedAtSec: TOKEN_CREATED_SEC, callInfo, ...over,
  });
  const ans = (fields) => ({
    prestage_token_type: { choice: 'project', probabilities: { project: 0.7 } },
    prestage_abm_name_link: { choice: 'exact', probabilities: { exact: 0.9 } },
    prestage_abm_web3_traffic: { choice: 'has_traffic', probabilities: { has_traffic: 0.8 } },
    prestage_community_activity: { choice: 'high', probabilities: { high: 0.6 } },
    ...fields,
  });

  console.log('== 1. abm 双条件（addressVerified=false 分支）==');
  const abmOk = mapPrestageAnswers(ans(), ctx(account(), {}, { addressVerified: false }));
  check('双条件满足 → mid', abmOk.rating, 'mid');
  check('双条件满足 pass=true', abmOk.prestageDataToSave.pass, true);
  check('category=account_based_meme', abmOk.tokenType, 'account_based_meme');

  const abmNameFail = mapPrestageAnswers(
    ans({ prestage_abm_name_link: { choice: 'none', probabilities: { none: 0.9 } } }),
    ctx(account(), {}, { addressVerified: false }));
  check('名称关联不成立 → low', abmNameFail.rating, 'low');

  const abmTrafficFail = mapPrestageAnswers(
    ans({ prestage_abm_web3_traffic: { choice: 'no_traffic', probabilities: { has_traffic: 0.2 } } }),
    ctx(account(), {}, { addressVerified: false }));
  check('无 Web3 流量 → low', abmTrafficFail.rating, 'low');

  console.log('== 2. web3_native_ip_early（复用 rateProject 粉丝带；P1.9 不吃年龄门）==');
  const web3ip = (data, tokenCreatedAtSec = TOKEN_CREATED_SEC) => mapPrestageAnswers(
    ans({ prestage_token_type: { choice: 'web3_native_ip_early', probabilities: { web3_native_ip_early: 0.8 } } }),
    ctx(data, {}, { ...(tokenCreatedAtSec !== TOKEN_CREATED_SEC ? { tokenCreatedAtSec } : {}) }));

  const wl = web3ip(account()); // 蝴蝶轮回形态：168 粉老号多推文
  check('168 粉老号 → mid（蝴蝶轮回"可过可不过"落 mid）', wl.rating, 'mid');
  check('mid 带 pass=true', wl.prestageDataToSave.pass, true);
  check('baselineMet=true', wl.baselineMet, true);
  check('category=web3_native_ip_early', wl.tokenType, 'web3_native_ip_early');
  check('promptType 带 P1.9', wl.promptType, `prestage-jev(P1.9/web3_native_ip_early)`);
  check('reason 前缀 = 账号基本面评级（P1.9 标签）',
    wl.reasoning.startsWith('Web3原生IP早期（币本身即IP') && wl.reasoning.includes('账号基本面评级'), true);

  check('7 粉 → low（底线 20）',
    web3ip(account({ followers_count: 7 })).rating, 'low');
  check('500 粉老号 → high',
    web3ip(account({ followers_count: 500 })).rating, 'high');
  check('168 粉但 1 推文 → low（推文<5 拦截保留，C15 x-0 防线）',
    web3ip(account({ statuses_count: 1 })).rating, 'low');
  // P1.9（C46 MarsCoin 案，2026-10-01 用户裁定「很多 meme 币一出生就有账号，一般
  // 算是 web3 原生IP」）：web3ip 不吃 P1.3 年龄降档——账号随币而生/社区后建是常态
  check('168 粉 10 天新号 → mid（P1.9：web3ip 不吃年龄门，走粉丝带）',
    web3ip(account({ created_at: '2026-09-17T00:00:00Z' })).rating, 'mid');
  check('MarsCoin 形状：3817 粉/118 推/账号晚于 token 创建（负年龄）→ high',
    web3ip(account({ followers_count: 3817, statuses_count: 118, created_at: '2026-09-28T00:00:00Z' })).rating, 'high');
  check('无创建时间锚 → mid（年龄门关闭后锚缺失同样不降档）',
    web3ip(account({ created_at: '2026-09-17T00:00:00Z' }), null).rating, 'mid');
  // 对照：project 路径年龄门语义不变（同形状 10 天新号 + 实度缺分 → low）
  check('同形状 project → 仍 low（年龄门只在 web3ip 关闭）',
    mapPrestageAnswers(ans(), ctx(account({ created_at: '2026-09-17T00:00:00Z' }))).rating, 'low');

  console.log('== 3. project 评级回归（P1.4 不改动）==');
  const pj = mapPrestageAnswers(ans(), ctx(account()));
  check('project 168 粉 → mid', pj.rating, 'mid');
  check('project 168 粉 → mid（老号不降档）', pj.jevDetails.downgrade, undefined);
  const pj300 = mapPrestageAnswers(ans(), ctx(account({ followers_count: 300 })));
  check('project 300 粉 → high', pj300.rating, 'high');
  const pj15 = mapPrestageAnswers(ans(), ctx(account({ followers_count: 15 })));
  check('project 15 粉 → low', pj15.rating, 'low');

  console.log('== 4. pre-check 高影响力门槛（unrated→mid+pass:true）==');
  const cleanToken = { symbol: 'TEST', name: '测试', address: '0xabc', raw_api_data: {} };
  const recentVideoTime = new Date(Date.now() - 7 * 86400000).toISOString();

  // C4 案形态：抖音视频 64.8 万赞、播放隐藏为 0
  const douyinViral = await performPreCheck(cleanToken, null, {}, null,
    { douyin: [{ url: 'https://v.douyin.com/x' }] },
    { douyinInfo: { view_count: 0, like_count: 648000, create_time: recentVideoTime } });
  check('抖音爆款 64.8 万赞 → mid', douyinViral?.rating, 'mid');
  check('抖音爆款 pass=true（通过）', douyinViral?.pass, true);
  check('抖音爆款 ruleName 保留 video_unrated（检索键不变）',
    douyinViral?.details?.ruleName, 'video_unrated');

  const xhsHigh = await performPreCheck(cleanToken, null, {}, null,
    { xiaohongshu: [{ url: 'https://xhs.link/x' }] },
    { xiaohongshuInfo: { type: 'user_profile', nickname: '博主', fans: 35000, liked: 5000 } });
  check('小红书 3.5 万粉 → mid', xhsHigh?.rating, 'mid');
  check('小红书高粉 pass=true', xhsHigh?.pass, true);

  // 低数据：不再触发门槛（无 unrated 产出；后续规则接管，此处断言非 mid/unrated 即可）
  const douyinLow = await performPreCheck(cleanToken, null, {}, null,
    { douyin: [{ url: 'https://v.douyin.com/x' }] },
    { douyinInfo: { view_count: 100, like_count: 50, create_time: recentVideoTime } });
  check('抖音低数据不触发爆款门（rating ≠ mid/unrated）',
    ['mid', 'unrated'].includes(douyinLow?.rating), false);

  console.log('== 5. resolveFinalRating 历史兼容（rating-utils 未动）==');
  check('存量 unrated 行仍解析 unrated',
    resolveFinalRating({ pre_check_result: { rating: 'unrated', pass: false } }), 'unrated');
  check('新 mid 行（pass:true）解析 mid',
    resolveFinalRating({ pre_check_result: { rating: 'mid', pass: true } }), 'mid');
  check('prestage mid 行解析 mid',
    resolveFinalRating({ prestage_result: { rating: 'mid', pass: true } }), 'mid');

  console.log(`\n${passed + failed}/${passed + failed}${failed ? `（✗ ${failed}）` : ''}`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
