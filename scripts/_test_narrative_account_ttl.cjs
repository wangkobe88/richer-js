#!/usr/bin/env node
/**
 * 账号型未过缓存 10s TTL 穿透重析（2026-10-14 用户裁定，Virusking 案
 * 0xa25cad99…7777：宣告推开盘 45s 后才发，直调 35 轮全程消费 address-fail
 * 缓存行，worker PrecheckFailRetry 重析 resolved:true 时买窗已走完）——本地零 DB 单测
 *
 *   A. isAccountOnlySource 纯函数：account-only / tweet / 混合 / 空 / null
 *   B. 默认关（无参构造零行为变化）：TTL 老 + low + account → 不穿透
 *   C. 回测形状事故反证（memoryCacheResults 构造不带开关）：历史行 analyzed_at
 *      恒早于墙钟也不穿透——开了=用「现在」推文重评历史时点=语料前视
 *   D. TTL 未到（行龄 5s）→ 不穿透，返回缓存 low
 *   E. TTL 到（行龄 11s）→ 当次穿透：第 2 次 analyze 带 ignoreCache:true，
 *      返回重析结果（翻正 3）+ ttlReanalyze 观测标记
 *   F. 计数封顶：命中-穿透循环至本进程第 3 次分析后不再穿透
 *   F2. 首析计入上限：首析(1)+穿透(2)+穿透(3) 后封顶（穿透仅 2 次）
 *   G. rating 2/3 / tweet 型语料 → 不穿透
 *   H. 并发穿透 join：两个并发 getRating 同 token → analyze 恰 2 次（!ttl inflight 共享）
 *   I. Virusking 事故现场反证：首析 address-fail low（真跑不判穿透）→ 次轮命中
 *      旧行穿透拉到翻正 3 → shouldBlockOnNarrative 不拉黑
 *   J. C70 参数化生效：accountFailTtlMs/maxAnalysesPerToken 实验级注入（31s 行龄
 *      11s 不穿透 / 11s 行龄 31s 穿透 / 封顶 2 / 非法值回落默认）
 *   K. 穿透 options 断言：ignoreCache && invalidateAccountCorpus 双真（bunker 根因
 *      修复=数据层缓存同失效），常规轮 undefined
 *   L. bunker 事故现场反证（0x2ec1e08c…7777）：首析 address-fail（发币后 5s 的
 *      2 粉快照）→ 次轮穿透带失效重取 → P1.10 粉丝带只定档翻正 mid
 *   M. shouldBlockOnNarrative windowSec 第 4 参矩阵（C70 实验级豁免窗）
 *
 * 用法：node scripts/_test_narrative_account_ttl.cjs
 */

'use strict';

const {
  NarrativeDirectCaller, shouldBlockOnNarrative, isAccountOnlySource,
} = require('../src/trading-engine/pre-check/NarrativeDirectCaller');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${detail ? ` | ${detail}` : ''}`); }
}

/** 打桩 _getAnalyzer：记录每次调用的 options，行为由 fn 决定 */
function stubAnalyzer(caller, fn) {
  const calls = [];
  caller._getAnalyzer = async () => ({
    analyze: async (addr, options) => {
      calls.push({ addr, options });
      return fn(calls.length, options);
    },
  });
  return {
    count: () => calls.length,
    reanalyzeCalls: () => calls.filter(c => c.options?.ignoreCache === true).length,
    lastOptions: () => calls[calls.length - 1]?.options,
  };
}

const ACCOUNT_URLS = { twitter: [{ url: 'https://x.com/Virusking_bsc', type: 'account', platform: 'twitter', priority: 2 }] };
const TWEET_URLS = { twitter: [{ url: 'https://x.com/Foo/status/123', type: 'tweet', platform: 'twitter', priority: 1 }] };
const MIXED_URLS = { twitter: [
  { url: 'https://x.com/Foo', type: 'account', platform: 'twitter', priority: 2 },
  { url: 'https://x.com/Foo/status/123', type: 'tweet', platform: 'twitter', priority: 1 },
] };
/** 缓存命中形状：账号型 low 旧行 */
const cachedLow = (ageMs, urls = ACCOUNT_URLS) => ({
  numericRating: 1, rating: 'low', reason: '未在账号简介或推文中找到完整代币地址',
  meta: { fromCache: true, analyzedAt: new Date(Date.now() - ageMs).toISOString() },
  classifiedUrls: urls, gmgnRisk: null, llmAnalysis: null, twitter: null,
});
/** 真跑仍是 low 的形状（重析未翻正；ignoreCache 穿透不可能返回缓存命中） */
const freshLow = (urls = ACCOUNT_URLS) => ({
  numericRating: 1, rating: 'low', reason: '重析仍未翻正',
  meta: { fromCache: false }, classifiedUrls: urls, gmgnRisk: null,
  llmAnalysis: null, twitter: null,
});
/** 真跑形状（重析翻正） */
const freshPass = () => ({
  numericRating: 3, rating: 'high', reason: null,
  meta: { fromCache: false }, classifiedUrls: ACCOUNT_URLS, gmgnRisk: null,
  llmAnalysis: null, twitter: { created_at: new Date().toUTCString() },
});

async function main() {
  console.log('A. isAccountOnlySource 纯函数');
  check('account-only → true', isAccountOnlySource(ACCOUNT_URLS) === true);
  check('tweet 型 → false', isAccountOnlySource(TWEET_URLS) === false);
  check('账号+推文混合 → false', isAccountOnlySource(MIXED_URLS) === false);
  check('空 twitter 桶 → false', isAccountOnlySource({ twitter: [] }) === false);
  check('null → false', isAccountOnlySource(null) === false);

  console.log('B. 默认关（无参构造零行为变化）');
  {
    const caller = new NarrativeDirectCaller();
    const s = stubAnalyzer(caller, () => cachedLow(60000));
    const r = await caller.getRating('0xAbC');
    check('TTL 老 + low + account 不穿透（analyze 1 次）', s.count() === 1);
    check('返回缓存 low', r.numericRating === 1 && r.fromCache === true);
    check('无穿透标记', r.ttlReanalyze === undefined);
  }

  console.log('C. 回测形状事故反证（memoryCacheResults 不带开关）');
  {
    const caller = new NarrativeDirectCaller({ memoryCacheResults: true });
    const s = stubAnalyzer(caller, () => cachedLow(3600_000)); // 历史行 analyzed_at 恒老
    await caller.getRating('0xabc');
    await caller.getRating('0xabc');
    check('两轮均缓存命中路径、零穿透（防语料前视）', s.count() === 2 && s.reanalyzeCalls() === 0);
  }

  console.log('D. TTL 未到（行龄 5s）');
  {
    const caller = new NarrativeDirectCaller({ accountFailTtlReanalyze: true });
    const s = stubAnalyzer(caller, () => cachedLow(5000));
    const r = await caller.getRating('0xabc');
    check('不穿透（analyze 1 次）', s.count() === 1 && s.reanalyzeCalls() === 0);
    check('返回缓存 low', r.numericRating === 1);
  }

  console.log('E. TTL 到（行龄 11s）当次穿透');
  {
    const caller = new NarrativeDirectCaller({ accountFailTtlReanalyze: true });
    const s = stubAnalyzer(caller, (i, options) => (options?.ignoreCache ? freshPass() : cachedLow(11000)));
    const r = await caller.getRating('0xabc');
    check('analyze 2 次（常规命中 + 穿透）', s.count() === 2);
    check('穿透调用带 ignoreCache:true', s.reanalyzeCalls() === 1);
    check('穿透调用保留 enrichSocialByGmgn', (() => {
      const opts = s.lastOptions();
      return opts?.ignoreCache === true && opts?.enrichSocialByGmgn === true && opts?.skipIntermediateSave === true;
    })());
    check('返回重析翻正 3', r.numericRating === 3 && r.fromCache === false);
    check('带 ttlReanalyze 观测标记', r.ttlReanalyze === true);
  }

  console.log('F. 计数封顶（命中-穿透循环至第 3 次真跑）');
  {
    const caller = new NarrativeDirectCaller({ accountFailTtlReanalyze: true });
    const s = stubAnalyzer(caller, (i, options) => (options?.ignoreCache ? freshLow() : cachedLow(11000)));
    for (let i = 0; i < 5; i++) await caller.getRating('0xabc');
    check('穿透恰 3 次（第 4/5 轮封顶回缓存行为）', s.reanalyzeCalls() === 3, `实际 ${s.reanalyzeCalls()}`);
    const r6 = await caller.getRating('0xabc');
    check('封顶后第 6 轮常规命中照走返回 low', r6.numericRating === 1 && r6.fromCache === true && r6.ttlReanalyze === undefined);
    check('封顶后零新增穿透（常规调用不烧预算）', s.reanalyzeCalls() === 3 && s.count() === 9, `reanalyze=${s.reanalyzeCalls()} analyze=${s.count()}`);
    check('真跑计数=3（缓存命中不计）', caller._analysisCounts.get('0xabc') === 3);
  }

  console.log('F2. 首析计入上限（首析 1 + 穿透 2 = 3 封顶）');
  {
    const caller = new NarrativeDirectCaller({ accountFailTtlReanalyze: true });
    let first = true;
    const s = stubAnalyzer(caller, (i, options) => {
      if (first && !options?.ignoreCache) { first = false; return freshPass(); } // 首析真跑（rating 3）
      return options?.ignoreCache ? freshPass() : cachedLow(11000);
    });
    const r1 = await caller.getRating('0xdef'); // 首析 count=1（真跑）
    for (let i = 0; i < 4; i++) await caller.getRating('0xdef'); // 各轮命中旧行→穿透
    check('首析返回 3', r1.numericRating === 3);
    check('穿透仅 2 次（首析占 1 个名额）', s.reanalyzeCalls() === 2, `实际 ${s.reanalyzeCalls()}`);
  }

  console.log('G. 非目标形状不穿透');
  {
    const caller = new NarrativeDirectCaller({ accountFailTtlReanalyze: true });
    const s = stubAnalyzer(caller, () => ({ ...cachedLow(60000), numericRating: 2, rating: 'medium' }));
    await caller.getRating('0xrt2');
    check('rating=2 命中不穿透', s.reanalyzeCalls() === 0);
  }
  {
    const caller = new NarrativeDirectCaller({ accountFailTtlReanalyze: true });
    const s = stubAnalyzer(caller, () => cachedLow(60000, TWEET_URLS));
    await caller.getRating('0xrtw');
    check('tweet 型语料 low 不穿透', s.reanalyzeCalls() === 0);
  }
  {
    const caller = new NarrativeDirectCaller({ accountFailTtlReanalyze: true });
    const s = stubAnalyzer(caller, () => ({ ...cachedLow(60000), meta: { fromCache: true } }));
    await caller.getRating('0xnoat');
    check('analyzedAt 缺失不穿透（保守）', s.reanalyzeCalls() === 0);
  }

  console.log('H. 并发穿透 join（!ttl inflight 共享）');
  {
    const caller = new NarrativeDirectCaller({ accountFailTtlReanalyze: true });
    const s = stubAnalyzer(caller, (i, options) => (options?.ignoreCache ? freshPass() : cachedLow(11000)));
    const [r1, r2] = await Promise.all([caller.getRating('0xccc'), caller.getRating('0xccc')]);
    check('analyze 恰 2 次（常规 1 + 穿透 1）', s.count() === 2, `实际 ${s.count()}`);
    check('两个调用都拿到翻正 3', r1.numericRating === 3 && r2.numericRating === 3);
    check('并发穿透 join 只计一次真跑（常规命中不计）', caller._analysisCounts.get('0xccc') === 1);
  }

  console.log('I. Virusking 事故现场反证（首析 fail → 次轮穿透翻正）');
  {
    const caller = new NarrativeDirectCaller({ accountFailTtlReanalyze: true });
    let announcementPosted = false;
    const s = stubAnalyzer(caller, (i, options) => {
      if (options?.ignoreCache) {
        // 穿透=重新抓取账号时间线：宣告推已发 → address 验证过 → 翻正
        announcementPosted = true;
        return freshPass();
      }
      if (i === 1) {
        // 首析（真跑）：宣告推未发 → address fail low
        return {
          numericRating: 1, rating: 'low', reason: '未在账号简介或推文中找到完整代币地址',
          meta: { fromCache: false }, classifiedUrls: ACCOUNT_URLS, gmgnRisk: null,
          llmAnalysis: { preCheck: { details: { validationStage: 'address' } } }, twitter: null,
        };
      }
      // 次轮起：命中首析落的旧行（upsert 行 analyzed_at=首析时刻，早已过 10s）
      return cachedLow(12000);
    });
    const r1 = await caller.getRating('0xa25c');
    check('首析=address fail low（真跑不判穿透）', r1.numericRating === 1 && r1.fromCache === false && s.count() === 1);
    const r2 = await caller.getRating('0xa25c');
    check('次轮命中旧行 → 穿透拉到翻正 3', r2.numericRating === 3 && r2.ttlReanalyze === true);
    check('穿透确实发生（ignoreCache 1 次）', s.reanalyzeCalls() === 1);
    check('翻正后不拉黑（宣告竞态豁免链闭环）', announcementPosted
      && shouldBlockOnNarrative(r2.numericRating, r2.precheckStage, 1) === false);
  }

  console.log('J. C70 参数化生效（accountFailTtlMs / maxAnalysesPerToken 实验级注入）');
  {
    // TTL 参数化上调：31s 窗口下行龄 11s 不再穿透（默认 10s 会——D/E 节对照）
    const caller = new NarrativeDirectCaller({ accountFailTtlReanalyze: true, accountFailTtlMs: 31000 });
    const s = stubAnalyzer(caller, () => cachedLow(11000));
    const r = await caller.getRating('0xp11');
    check('accountFailTtlMs=31s 行龄 11s → 不穿透（实例字段生效）',
      s.reanalyzeCalls() === 0 && r.numericRating === 1);
  }
  {
    // TTL 参数化下调：11s 窗口下行龄 31s 穿透
    const caller = new NarrativeDirectCaller({ accountFailTtlReanalyze: true, accountFailTtlMs: 11000 });
    const s = stubAnalyzer(caller, (i, options) => (options?.ignoreCache ? freshPass() : cachedLow(31000)));
    const r = await caller.getRating('0xp12');
    check('accountFailTtlMs=11s 行龄 31s → 穿透（降 TTL 提频）',
      s.reanalyzeCalls() === 1 && r.numericRating === 3);
  }
  {
    // maxAnalyses 封顶 2：命中-穿透循环第 3 次起封顶（默认 3——F 节对照）
    const caller = new NarrativeDirectCaller({ accountFailTtlReanalyze: true, maxAnalysesPerToken: 2 });
    const s = stubAnalyzer(caller, (i, options) => (options?.ignoreCache ? freshLow() : cachedLow(11000)));
    for (let i = 0; i < 5; i++) await caller.getRating('0xp13');
    check('maxAnalysesPerToken=2 → 穿透恰 2 次（提前封顶）', s.reanalyzeCalls() === 2, `实际 ${s.reanalyzeCalls()}`);
    check('真跑计数=2', caller._analysisCounts.get('0xp13') === 2);
  }
  {
    // 非法值回落默认常量（Number.isInteger 正值校验）
    const caller = new NarrativeDirectCaller({ accountFailTtlReanalyze: true, accountFailTtlMs: 0, maxAnalysesPerToken: '3' });
    check('非法参数回落默认（TTL=10000 / 上限=3）',
      caller._accountFailTtlMs === 10000 && caller._maxAnalysesPerToken === 3);
    const s = stubAnalyzer(caller, (i, options) => (options?.ignoreCache ? freshPass() : cachedLow(11000)));
    const r = await caller.getRating('0xp14');
    check('回落后行龄 11s 正常穿透', s.reanalyzeCalls() === 1 && r.numericRating === 3);
  }

  console.log('K. 穿透 options 断言（invalidateAccountCorpus 双真，常规轮 undefined）');
  {
    const caller = new NarrativeDirectCaller({ accountFailTtlReanalyze: true });
    const s = stubAnalyzer(caller, (i, options) => (options?.ignoreCache ? freshPass() : cachedLow(11000)));
    await caller.getRating('0xki');
    const last = s.lastOptions();
    check('穿透轮 ignoreCache && invalidateAccountCorpus 双真（bunker 根因：数据层缓存同失效）',
      last?.ignoreCache === true && last?.invalidateAccountCorpus === true);
  }
  {
    const caller = new NarrativeDirectCaller({ accountFailTtlReanalyze: true });
    const s = stubAnalyzer(caller, () => cachedLow(5000)); // TTL 未到 → 仅常规轮
    await caller.getRating('0xki2');
    const last = s.lastOptions();
    check('常规轮两键均 undefined（存量零变化）',
      last?.invalidateAccountCorpus === undefined && last?.ignoreCache === undefined);
  }

  console.log('L. bunker 事故现场反证（0x2ec1e08c…7777：穿透不带失效=吃首析旧快照）');
  {
    const caller = new NarrativeDirectCaller({ accountFailTtlReanalyze: true });
    const s = stubAnalyzer(caller, (i, options) => {
      if (options?.ignoreCache) {
        // 穿透带 invalidateAccountCorpus → twitter_user_info（30 天缓存）失效 → 重取
        // 实时数据 → P1.10 粉丝带只定档（0-299 mid）→ 翻正
        return { numericRating: 2, rating: 'medium', reason: null, meta: { fromCache: false },
          classifiedUrls: ACCOUNT_URLS, gmgnRisk: null, llmAnalysis: null, twitter: null };
      }
      if (i === 1) {
        // 首析（发币后 5s）：@bunkeronbnb 快照 2 粉 4 推当天号 → CA 未公示 address fail
        return {
          numericRating: 1, rating: 'low', reason: '未在账号简介或推文中找到完整代币地址',
          meta: { fromCache: false }, classifiedUrls: ACCOUNT_URLS, gmgnRisk: null,
          llmAnalysis: { preCheck: { details: { validationStage: 'address' } } }, twitter: null,
        };
      }
      if (i === 2) return cachedLow(12000); // 次轮命中首析旧行（行龄 > 10s）
      // 翻正后的 mid 缓存行
      return { numericRating: 2, rating: 'medium', reason: null,
        meta: { fromCache: true, analyzedAt: new Date().toISOString() },
        classifiedUrls: ACCOUNT_URLS, gmgnRisk: null, llmAnalysis: null, twitter: null };
    });
    const r1 = await caller.getRating('0x2ec1');
    check('首析=address fail low（真跑，宣告推未发）',
      r1.numericRating === 1 && r1.precheckStage === 'address' && r1.fromCache === false);
    const r2 = await caller.getRating('0x2ec1');
    check('次轮穿透翻正 mid（失效重取 + P1.10 粉丝带只定档）',
      r2.numericRating === 2 && r2.ttlReanalyze === true);
    const last = s.lastOptions();
    check('穿透带 invalidateAccountCorpus（若不带=重析吃 30 天 userInfo 旧行=bunker 事故）',
      last?.ignoreCache === true && last?.invalidateAccountCorpus === true);
    const r3 = await caller.getRating('0x2ec1');
    check('翻正后命中 mid 行零新增穿透', r3.numericRating === 2 && s.reanalyzeCalls() === 1);
  }

  console.log('M. shouldBlockOnNarrative windowSec 第 4 参矩阵（C70 实验级豁免窗）');
  check('默认窗（无第 4 参）age 2min 豁免', shouldBlockOnNarrative(1, 'address', 2) === false);
  check('默认窗 age 6min 拉黑', shouldBlockOnNarrative(1, 'address', 6) === true);
  check('windowSec=120 age 2min 恰出窗拉黑（>= 语义）', shouldBlockOnNarrative(1, 'address', 2, 120) === true);
  check('windowSec=120 age 1min 豁免', shouldBlockOnNarrative(1, 'address', 1, 120) === false);
  check('windowSec=7200 age 60min 仍豁免', shouldBlockOnNarrative(1, 'address', 60, 7200) === false);
  check('windowSec=7200 age 121min 拉黑', shouldBlockOnNarrative(1, 'address', 121, 7200) === true);
  check('非豁免形状不受 windowSec 影响（stage=null）', shouldBlockOnNarrative(1, null, 1, 7200) === true);
  check('年龄缺失按出窗（fail-closed 对齐 worker 无锚不重试）', shouldBlockOnNarrative(1, 'address', null, 7200) === true);
  check('rating 3 恒不拉黑', shouldBlockOnNarrative(3, 'address', 1, 120) === false);

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
