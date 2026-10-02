#!/usr/bin/env node
/**
 * rating=null 落库 bug 修复单测（C53，2026-10-02）
 *
 * bug 六环链：apidance 空 stub「成功」返回 → TwitterFetcher 判空穿透 → account 路径
 * data_fetch_failed 早退无落库载体（preCheckData/prestageData 皆无）→ 消费侧 else 分支
 * prestageDataToSave=undefined → 六 stage 字段全空 → rating 表推导 null → is_valid=true
 * 缓存固化（18 行实证）。
 *
 * 修复四处：
 *   B1 new-apis.js getUserByScreenName 源头判空骨架 throw（三调用方全 catch）
 *   B2 twitter-fetcher.mjs fetchAccountInfo 缓存出口拦截旧空壳毒行 + invalidate
 *   A  account-analysis-service.mjs data_fetch_failed 早退补 preCheckData 载体
 *   A2 NarrativeAnalyzer.mjs no_data 分支补 preCheckDataToSave 载体（B 修复后落点）
 *
 * 零 DB 零网络：B1 打桩 globalThis.fetch（fixture=本案实证响应形状）；A/A2 用
 * resolveFinalRating 落库形状闭环 + 源码口径断言（项目惯例）。
 *
 * 运行：node scripts/_test_data_fetch_failed_rating.cjs
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;

function assert(cond, label, extra) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}${extra ? ` | ${extra}` : ''}`); }
}

function assertEq(actual, expected, label) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} | 期望=${JSON.stringify(expected)} 实际=${JSON.stringify(actual)}`); }
}

function src(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

// ═══════════════════════════════════════════════════════════════════════════
// 第一节 B1 行为级：getUserByScreenName 空 stub 判定（打桩 globalThis.fetch）
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══ 一、B1 getUserByScreenName 空 stub 源头判定（行为级）══');
(async () => {
  const { getUserByScreenName } = require(path.join(ROOT, 'src/utils/twitter-validation/new-apis.js'));

  // 三张票实证形状：code:0 + user.result 存在但 core/legacy 全空（apidance 对
  // 不存在/停封账号的返回）——修复前组装出全空 userInfo 且打印「✅ 成功获取」
  const EMPTY_STUB_RESPONSE = {
    data: {
      user: {
        result: {
          rest_id: '',
          core: {},
          legacy: {},
          verification: {},
          avatar: {},
          location: {}
        }
      }
    }
  };
  const REAL_USER_RESPONSE = {
    data: {
      user: {
        result: {
          rest_id: '12345',
          core: { screen_name: 'RealUser', name: 'Real', created_at: '2020-01-01T00:00:00Z' },
          legacy: { description: 'bio', followers_count: 100, statuses_count: 50, url: '' },
          verification: { verified: false },
          avatar: {},
          location: {},
          is_blue_verified: false
        }
      }
    }
  };

  const realFetch = globalThis.fetch;
  const stubFetch = (body) => async () => ({ ok: true, json: async () => body });

  // 1. 空 stub → throw（不再穿透当成功）
  globalThis.fetch = stubFetch(JSON.parse(JSON.stringify(EMPTY_STUB_RESPONSE)));
  let threw = null;
  try { await getUserByScreenName('FlapVault0822'); } catch (e) { threw = e; }
  assert(!!threw, '空骨架响应 → throw（不再返回空 stub）');
  assert(threw && /用户不存在/.test(threw.message), 'throw 信息含「用户不存在」语义', threw && threw.message);

  // 2. 真用户 → 正常返回（screen_name 非空）
  globalThis.fetch = stubFetch(JSON.parse(JSON.stringify(REAL_USER_RESPONSE)));
  const real = await getUserByScreenName('RealUser');
  assertEq(real && real.screen_name, 'RealUser', '真用户响应 → screen_name 正常返回');
  assertEq(real && real.type, undefined, 'getUserByScreenName 形状未动（type 字段由 fetcher 层组装）');

  // 3. user 整缺 → 既有「用户信息获取失败」throw（回归）
  globalThis.fetch = stubFetch({ data: {} });
  threw = null;
  try { await getUserByScreenName('ghost'); } catch (e) { threw = e; }
  assert(!!threw && /用户信息获取失败/.test(threw.message), 'user 整缺 → 既有 throw 语义回归');

  // 4. 空骨架判定的判定键唯一性：screen_name 非空但其余字段空 → 不拦（宁按真数据处理）
  const sparse = JSON.parse(JSON.stringify(EMPTY_STUB_RESPONSE));
  sparse.data.user.result.core.screen_name = 'SparseButReal';
  globalThis.fetch = stubFetch(sparse);
  const sp = await getUserByScreenName('SparseButReal');
  assertEq(sp && sp.screen_name, 'SparseButReal', 'screen_name 非空但其余空 → 放行（单键判定不扩大化）');

  globalThis.fetch = realFetch;

  // ═══════════════════════════════════════════════════════════════════════
  // 第二节 B1/B2 行为级：_fetchAccountInternal 对空 stub 输入返回 null
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n══ 二、B1+B2 _fetchAccountInternal 空输入 → null（行为级）══');
  const { TwitterFetcher } = await import(path.join(ROOT, 'src/narrative/utils/twitter-fetcher.mjs'));

  globalThis.fetch = stubFetch(JSON.parse(JSON.stringify(EMPTY_STUB_RESPONSE)));
  const nullInfo = await TwitterFetcher._fetchAccountInternal('finder_bnb');
  assertEq(nullInfo, null, '空骨架 → _fetchAccountInternal catch → null（fetchWithCache 将走 markFailed 不落成功缓存）');

  globalThis.fetch = stubFetch(JSON.parse(JSON.stringify(REAL_USER_RESPONSE)));
  const okInfo = await TwitterFetcher._fetchAccountInternal('RealUser');
  assertEq(okInfo && okInfo.screen_name, 'RealUser', '真用户 → _fetchAccountInternal 正常组装（type=account）');
  assertEq(okInfo && okInfo.type, 'account', '真用户形状 type=account（hasValidDataForAnalysis 既有判定不回归）');

  globalThis.fetch = realFetch;

  // ═══════════════════════════════════════════════════════════════════════
  // 第三节 A/A2 落库形状闭环：resolveFinalRating（修复前 null vs 修复后 low）
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n══ 三、A/A2 resolveFinalRating 落库形状闭环 ══');
  const { resolveFinalRating } = await import(path.join(ROOT, 'src/narrative/utils/rating-utils.mjs'));

  // 3.1 bug 复现：修复前形状（六 stage 字段全空，18 行实证）→ null
  assertEq(resolveFinalRating({}), null, '修复前形状（六字段全空）→ null（bug 复现）');
  assertEq(resolveFinalRating({ pre_check_result: null, prestage_result: null, stage1_result: null, stage2_result: null, stage3_result: null, stage_final_result: null }), null, '六字段显式 null → null');

  // 3.2 修复 A：data_fetch_failed 早退 → 消费分支构造的 pre_check_result → low
  // 消费分支（NarrativeAnalyzer）：preCheckDataToSave = { rating: pcd.rating || 'low',
  // pass: false, reason: pcd.reason || reasoning, category: null, score: null,
  // details: pcd.result || {} }
  const dataFetchFailedRecord = {
    pre_check_result: {
      rating: 'low',
      pass: false,
      reason: '无法获取账号/社区完整数据（用于规则验证）',
      category: null,
      score: null,
      details: { addressVerified: null, nameMatch: null, details: { category: 'data_fetch_failed' }, validationStage: 'data_fetch_failed' }
    }
  };
  assertEq(resolveFinalRating(dataFetchFailedRecord), 'low', '修复 A：data_fetch_failed 早退形状 → low（不再 null）');

  // 3.3 修复 A2：no_data 分支载体 → low
  const noDataRecord = {
    pre_check_result: { rating: 'low', pass: false, reason: '没有可用的数据进行分析（所有推文/内容获取失败），无语料不构成叙事', category: null, score: null, details: { category: 'no_data' } }
  };
  assertEq(resolveFinalRating(noDataRecord), 'low', '修复 A2：no_data 载体形状 → low');

  // 3.4 回归：既有形状不受影响
  const rulesValidationRecord = {
    pre_check_result: { rating: 'low', pass: false, reason: '名称不匹配', details: { validationStage: 'name_mismatch' } }
  };
  assertEq(resolveFinalRating(rulesValidationRecord), 'low', '回归：rules_validation 形状 → low');
  const stageFinalRecord = { stage_final_result: { rating: 'high', pass: true, score: 77.39 } };
  assertEq(resolveFinalRating(stageFinalRecord), 'high', '回归：stage_final high → high');
  const prestagePassRecord = { prestage_result: { rating: 'mid', pass: true } };
  assertEq(resolveFinalRating(prestagePassRecord), 'mid', '回归：prestage 显式 rating → 直取');
  assertEq(resolveFinalRating({ prestage_result: { pass: true } }), null, '回归：pass=true 无后续阶段 → null（既有语义）');

  // ═══════════════════════════════════════════════════════════════════════
  // 第四节 源码口径：四处修复点接线断言
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n══ 四、源码口径四连 ══');

  // B1 源头判定
  const newApis = src('src/utils/twitter-validation/new-apis.js');
  assert(newApis.includes("if (!userInfo.screen_name)"), 'B1：getUserByScreenName 源头含 screen_name 判空');
  assert(newApis.includes('用户不存在'), 'B1：throw 信息含「用户不存在」');

  // B2 缓存出口
  const fetcher = src('src/narrative/utils/twitter-fetcher.mjs');
  assert(fetcher.includes('if (result && !result.screen_name)'), 'B2：fetchAccountInfo 出口判定空壳');
  assert(fetcher.includes("ExternalResourceCache.invalidate(cacheKey, 'twitter_account')"), 'B2：出口 invalidate 毒缓存行');
  assert(/static async fetchAccountInfo[\s\S]*?if \(result && !result\.screen_name\)[\s\S]*?return null;/.test(fetcher), 'B2：出口判定在 fetchAccountInfo 内且 return null');
  assert(fetcher.includes("import { CachedFetcher, ExternalResourceCache } from '../db/ExternalResourceCache.mjs'"), 'B2：ExternalResourceCache named import 接线');

  // A 早退载体
  const aas = src('src/narrative/analyzer/services/account-analysis-service.mjs');
  assert(/category: 'data_fetch_failed',[\s\S]*?preCheckData: \{[\s\S]*?rating: 'low',[\s\S]*?validationStage: 'data_fetch_failed'/.test(aas), 'A：data_fetch_failed 早退含 preCheckData 载体（rating low + validationStage）');
  assert(/addressVerified: null,\s*\n\s*nameMatch: null/.test(aas), 'A：addressVerified/nameMatch=null（验证未执行不冒充 false）');

  // A2 no_data 载体
  const analyzer = src('src/narrative/analyzer/NarrativeAnalyzer.mjs');
  assert(/promptType = 'no_data';[\s\S]*?preCheckDataToSave = \{[\s\S]*?rating: 'low',[\s\S]*?details: \{ category: 'no_data' \}/.test(analyzer), 'A2：no_data 分支赋 preCheckDataToSave 载体');

  // 消费分支（既有，不回归）：preCheckData → precheck 落库
  assert(analyzer.includes('if (analysisResult.preCheckData)'), '消费分支：preCheckData 命中判存在');
  assert(analyzer.includes('pre_check_result: preCheckDataToSave || null'), 'save：pre_check_result 落库点存在');

  // ═══════════════════════════════════════════════════════════════════════
  // 第五节 B1 三调用方穿透安全（源码口径）
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n══ 五、B1 三调用方 catch 穿透安全 ══');
  // ① twitter-fetcher（行为级已测 null）
  // ② account-community-rules getAccountWithFullTweets：try/catch → return null
  const rules = src('src/narrative/analyzer/prompts/account/account-community-rules.mjs');
  assert(/getAccountWithFullTweets[\s\S]*?catch \(error\) \{[\s\S]*?return null;\s*\n\s*\}/.test(rules.replace(/\r/g, '')), '② getAccountWithFullTweets catch → null（throw 不外泄）');
  // ③ TwitterService.getUserInfo：catch → success:false
  const twSvc = src('src/services/TwitterService.js');
  assert(/getUserInfo\(screenName\)[\s\S]*?catch \(error\)[\s\S]*?success: false/.test(twSvc), '③ TwitterService.getUserInfo catch → success:false');

  // ═══════════════════════════════════════════════════════════════════════
  console.log(`\n══ 结果：${pass} 通过 / ${fail} 失败 ══`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('单测异常:', e); process.exit(1); });
