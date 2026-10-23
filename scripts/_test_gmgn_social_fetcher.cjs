#!/usr/bin/env node
/**
 * GMGN 社媒补源 fetcher 单测（CRO 案 2026-10-19 裁定）——零 DB 零网络
 *
 *   A. 行为级（GMGNTokenAPI 打桩 + CachedFetcher.fetchWithCache 打桩捕获）：
 *      A1 全量 raw payload 随行落库（raw === info 原对象；派生不消费字段如
 *         geckoterminal 保留在 raw 里）+ 派生三键照常（twitterUrl/websiteUrl/risk）
 *      A2 C51 推文路径形状：twitter_username 带完整 path → x.com 拼接原样保留
 *      A3 CRO 现场形状：link 全空串 + risk 在 → twitterUrl/websiteUrl null、
 *         raw 照落（晚到归因场景=当时 link 聚合空，事后靠 raw 复核）
 *      A4 website_url 非 http 形状 → websiteUrl null
 *      A5 GMGN 无社媒且无 risk → null（真链路进 markFailed 1h 冷却）
 *      A6 未配置 GMGN_API_KEY → null 且 API 零调用
 *   B. TTL 接线（2026-10-19 裁定：缓存 5s=买前新鲜语义）：
 *      B1 fetchWithCache 收到 options {maxAge:5, ttl:5}（getCacheTTL 真值）
 *      B2 源码口径：gmgn_token_info 行为 { maxAge: 5, ttl: 5 }——原
 *         {maxAge:1d, ttl:90d} 命中公式下命中窗 ≈91 天，把「无社媒」结论冻结
 *         三个月（CRO 现场 link 聚合晚到永远吃不到），回潮形状直接失败
 *      B3 cache key 形状 gmgn:token:bsc:<addr 小写>
 *   C. hasTwitterLink 判据矩阵（C181 必要门单一真相，2026-10-23）
 *   D. 失败封顶（C181 用户裁定「抓不成功最多再尝试一次，就往下走」）：
 *      D1 同 token 连续 2 次真失败 → 第 3 次调用入口直接 null、零 API 调用
 *         （进程内封死；ban 窗口「每轮重打续封」恶性循环的斩断点）
 *      D2 成功即清零：fail→success→fail→fail 后封顶（计数不跨成功累计）
 *      D3 GMGN 正常返回空数据（null 结果）不算失败（API 健康空形状不计数）
 *      D4 源码口径：GMGN_MAX_FAILS=2 + 入口封顶检查（防回潮）
 *   E. 链路接线源码口径（C181）：data-fetch 必要门在位 / NarrativeAnalyzer
 *      缓存命中补调块退役不回潮
 *
 * 用法：node scripts/_test_gmgn_social_fetcher.cjs
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function assert(cond, label, extra) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.error(`  ❌ ${label}${extra !== undefined ? ` | ${JSON.stringify(extra)}` : ''}`); }
}

const ADDR = '0xF58D7BB1A74192D615A710C5F2D5E6234DFB7777'; // 大写进、小写出（cache key）

// GMGN stub payload（字段映射源=src/core/gmgn-api/risk-fields.js）
function makePayload(overrides = {}) {
  return {
    dev: {
      twitter_create_token_count: 16,
      creator_address: '0xcreator0000000000000000000000000000000000001',
      creator_token_status: 'creator_close',
      fund_from: null,
      creator_created_count: 1,
    },
    wallet_tags_stat: { bundler_wallets: 35, sniper_wallets: 2, fresh_wallets: 20, renowned_wallets: 0, smart_wallets: 1, whale_wallets: 0, top_wallets: 46 },
    image_dup_count: 0,
    visiting_count: 7,
    ...overrides,
  };
}

async function main() {
  // 打桩顺序（先例 _test_gmgn_check_layer）：先 require CJS 模块改写
  // module.exports.GMGNTokenAPI，fetcher 闭包内 dynamic import 拿到的即是 stub
  let apiCalls = 0;
  let nextPayload = null;
  let nextError = null; // D 组：置非 null 时 getTokenInfo throw（真失败形状）
  class StubGMGNTokenAPI {
    constructor(_opts) {}
    async getTokenInfo(_chain, _address) {
      apiCalls++;
      if (nextError) throw nextError;
      return nextPayload;
    }
  }
  const gmgnMod = require('../src/core/gmgn-api');
  const OrigGMGNTokenAPI = gmgnMod.GMGNTokenAPI;
  gmgnMod.GMGNTokenAPI = StubGMGNTokenAPI;

  // fetchWithCache 打桩：捕获 options + 直透真析（不触 DB/markFailed）
  const { CachedFetcher } = await import(path.join(ROOT, 'src/narrative/db/ExternalResourceCache.mjs'));
  const origFwc = CachedFetcher.fetchWithCache;
  let captured = null;
  CachedFetcher.fetchWithCache = async (url, resourceType, fn, options) => {
    captured = { url, resourceType, options };
    return fn();
  };

  const { fetchGmgnSocialLinks, hasTwitterLink } = await import(path.join(ROOT, 'src/narrative/utils/gmgn-social-fetcher.mjs'));
  const prevKey = process.env.GMGN_API_KEY;
  process.env.GMGN_API_KEY = 'test-key';

  try {
    console.log('══ A. 行为级 ══');
    // A1 全量落库 + 派生三键
    {
      const payload = makePayload({ link: { twitter_username: 'bitgetfundbsc', website_url: 'https://brf-site.io', geckoterminal: 'https://gecko.io/brf', telegram: '' } });
      nextPayload = payload;
      const r = await fetchGmgnSocialLinks('bsc', ADDR);
      assert(r?.twitterUrl === 'https://x.com/bitgetfundbsc', 'A1 twitterUrl=handle 拼接', r);
      assert(r?.websiteUrl === 'https://brf-site.io', 'A1b websiteUrl 直传');
      assert(r?.risk?.issuerTokenCount === 16 && r?.risk?.bundlerWallets === 35 && r?.risk?.topWallets === 46, 'A1c risk 提取照常（共享 extractGmgnRisk）', r?.risk);
      assert(r?.raw === payload, 'A1d raw=info 原对象全量落库（同引用）');
      assert(r?.raw?.link?.geckoterminal === 'https://gecko.io/brf', 'A1e 派生不消费字段保留在 raw（审计可见）');
    }
    // A2 C51 推文路径形状
    {
      nextPayload = makePayload({ link: { twitter_username: 'BinanceDesi/status/2112144227757178894', website_url: '' } });
      const r = await fetchGmgnSocialLinks('bsc', ADDR);
      assert(r?.twitterUrl === 'https://x.com/BinanceDesi/status/2112144227757178894', 'A2 推文路径 twitter_username 原样拼接（C51）', r?.twitterUrl);
      assert(r?.websiteUrl === null, 'A2b 空串 website_url 不当有效值');
    }
    // A3 CRO 现场形状：link 聚合空 + risk 在
    {
      nextPayload = makePayload({ link: { twitter_username: '', website_url: '', telegram: '' } });
      const r = await fetchGmgnSocialLinks('bsc', ADDR);
      assert(r?.twitterUrl === null && r?.websiteUrl === null, 'A3 link 空串 → 社媒两键 null（CRO 现场形状）', r);
      assert(r?.risk !== null, 'A3b risk 照常提取（无社媒但有 risk=成功缓存形状）');
      assert(r?.raw?.link?.twitter_username === '', 'A3c raw 照落（晚到归因场景事后可复核原始 link）');
    }
    // A4 website_url 非 http
    {
      nextPayload = makePayload({ link: { twitter_username: 'a', website_url: 'not-a-url' } });
      const r = await fetchGmgnSocialLinks('bsc', ADDR);
      assert(r?.websiteUrl === null, 'A4 非 http(s) website_url → null');
    }
    // A5 无社媒且无 risk → null
    {
      nextPayload = { link: { twitter_username: '', website_url: '' } };
      const r = await fetchGmgnSocialLinks('bsc', ADDR);
      assert(r === null, 'A5 GMGN 无社媒/无风险 → null（真链路进 1h 失败冷却）');
    }
    // A6 无 key → null 且 API 零调用
    {
      delete process.env.GMGN_API_KEY;
      const before = apiCalls;
      const r = await fetchGmgnSocialLinks('bsc', ADDR);
      assert(r === null && apiCalls === before, 'A6 GMGN_API_KEY 缺失 → null 且零 API 调用');
    }
    process.env.GMGN_API_KEY = 'test-key';

    console.log('══ B. TTL 接线与源码口径 ══');
    {
      // B1 行为级：A1 的 captured 即最新一次调用
      assert(captured?.options?.maxAge === 5 && captured?.options?.ttl === 5, 'B1 fetchWithCache options={maxAge:5, ttl:5}（买前新鲜语义）', captured?.options);
      assert(captured?.resourceType === 'gmgn_token_info', 'B1b resourceType 不变');
      assert(captured?.url === `gmgn:token:bsc:${ADDR.toLowerCase()}`, 'B3 cache key=链:地址小写', captured?.url);

      // B2 源码口径（回潮防线）
      const ttlSrc = fs.readFileSync(path.join(ROOT, 'src/narrative/db/cache-ttl-config.mjs'), 'utf8');
      const m = ttlSrc.match(/gmgn_token_info:\s*\{[^}]*\}/);
      assert(m && /maxAge:\s*5/.test(m[0]) && /ttl:\s*5/.test(m[0]), 'B2 源码 gmgn_token_info={maxAge:5, ttl:5}（91 天冻结窗形状不得回潮）', m?.[0]);

      const { getCacheTTL } = await import(path.join(ROOT, 'src/narrative/db/cache-ttl-config.mjs'));
      const t = getCacheTTL('gmgn_token_info');
      assert(t.maxAge === 5 && t.ttl === 5, 'B2b getCacheTTL 真值断言', t);

      const fetcherSrc = fs.readFileSync(path.join(ROOT, 'src/narrative/utils/gmgn-social-fetcher.mjs'), 'utf8');
      assert(fetcherSrc.includes('return { twitterUrl, websiteUrl, risk, raw: info };'), 'B4 源码 raw 落库形状（全量 payload 不落即丢防线）');
    }

    console.log('══ C. hasTwitterLink 判据矩阵（C181 必要门）══');
    {
      assert(hasTwitterLink(['https://x.com/somecoin']) === true, 'C1 x.com 账号链接 → true');
      assert(hasTwitterLink(['https://twitter.com/somecoin?s=20']) === true, 'C2 twitter.com 带尾参 → true');
      assert(hasTwitterLink(['https://mobile.twitter.com/somecoin/status/123']) === true, 'C3 子域名 → true');
      assert(hasTwitterLink(['https://t.co/abc123', 'https://brf-site.io']) === false, 'C4 t.co/官网（非 twitter 域）→ false');
      assert(hasTwitterLink(['https://ex.com/x.com/fake']) === false, 'C5 path 里出现 x.com 非域头 → false');
      assert(hasTwitterLink([]) === false && hasTwitterLink(null) === false, 'C6 空数组/null → false');
    }

    console.log('══ D. 失败封顶（C181：连续 2 次真失败 → 进程内封死）══');
    const D1 = '0xD1FAIL0000000000000000000000000000777777';
    {
      nextError = new Error('HTTP 429 code=429 error=RATE_LIMIT_BANNED');
      nextPayload = null;
      let r1 = null;
      try { await fetchGmgnSocialLinks('bsc', D1); } catch (e) { r1 = e; }
      let r2 = null;
      try { await fetchGmgnSocialLinks('bsc', D1); } catch (e) { r2 = e; }
      const callsAfterTwo = apiCalls;
      const r3 = await fetchGmgnSocialLinks('bsc', D1); // 第 3 次：入口封顶直接 null
      assert(r1 && r2, 'D1 前两次真失败照常 throw（调用方 catch 按无补源继续）', { r1: !!r1, r2: !!r2 });
      assert(r3 === null && apiCalls === callsAfterTwo, 'D1b 第 3 次调用入口直接 null 且零 API 调用（进程内封死）', { r3, apiCalls, callsAfterTwo });
      // 第 4 次仍封死（重复验证稳定性）
      const r4 = await fetchGmgnSocialLinks('bsc', D1);
      assert(r4 === null && apiCalls === callsAfterTwo, 'D1c 封死后持续 null（ban 窗口续封循环斩断）');
    }
    {
      const D2 = '0xD2RESET00000000000000000000000000007777';
      // fail(1) → success（清零）→ fail(1) → fail(2) → 封死：计数不跨成功累计
      nextError = new Error('timeout');
      try { await fetchGmgnSocialLinks('bsc', D2); } catch (_) {}
      nextError = null;
      nextPayload = makePayload({ link: { twitter_username: 'ok', website_url: '' } });
      const ok = await fetchGmgnSocialLinks('bsc', D2);
      assert(ok?.twitterUrl === 'https://x.com/ok', 'D2 成功照常返回（清零前）', ok);
      nextError = new Error('timeout');
      try { await fetchGmgnSocialLinks('bsc', D2); } catch (_) {}
      try { await fetchGmgnSocialLinks('bsc', D2); } catch (_) {}
      const calls = apiCalls;
      const blocked = await fetchGmgnSocialLinks('bsc', D2);
      assert(blocked === null && apiCalls === calls, 'D2b 成功清零后须再连续 2 败才封顶（第 5 次调用入口 null）', { blocked, apiCalls, calls });
    }
    {
      const D3 = '0xD3EMPTY00000000000000000000000000007777';
      // GMGN 正常返回空数据（null 结果）不算失败：null → 再 1 次失败 → 仍未封顶
      nextError = null;
      nextPayload = { link: { twitter_username: '', website_url: '' } };
      const empty = await fetchGmgnSocialLinks('bsc', D3);
      assert(empty === null, 'D3 空数据形状 → null（既有语义）');
      nextError = new Error('timeout');
      try { await fetchGmgnSocialLinks('bsc', D3); } catch (_) {}
      nextError = null;
      nextPayload = makePayload({ link: { twitter_username: 'after', website_url: '' } });
      const after = await fetchGmgnSocialLinks('bsc', D3);
      assert(after?.twitterUrl === 'https://x.com/after', 'D3b 空数据不计失败：1 次失败后未封顶、后续成功照常到达', after);
    }
    {
      const src = fs.readFileSync(path.join(ROOT, 'src/narrative/utils/gmgn-social-fetcher.mjs'), 'utf8');
      assert(/GMGN_MAX_FAILS\s*=\s*2/.test(src), 'D4 源码 GMGN_MAX_FAILS=2（裁定值，防回潮）');
      assert(/gmgnFailCounts\.get\(strikeKey\).*>=\s*GMGN_MAX_FAILS/.test(src.replace(/\n/g, ' ')), 'D4b 入口封顶检查在位');
    }

    console.log('══ E. 链路接线源码口径（C181）══');
    {
      const dfs = fs.readFileSync(path.join(ROOT, 'src/narrative/analyzer/services/data-fetch-service.mjs'), 'utf8');
      assert(/const gmgnNeeded = options\.enrichSocialByGmgn && !hasTwitterLink\(allUrls\)/.test(dfs),
        'E1 data-fetch 必要门在位（enrichSocialByGmgn ∧ AVE URL 集无 twitter 才调）');
      assert(/gmgnNeeded\s*\?\s*timing\.wrap\('gmgn'/.test(dfs), 'E1b GMGN 分支消费 gmgnNeeded（门实际接线）');
      assert(!/options\.enrichSocialByGmgn\s*\?\s*timing\.wrap\('gmgn'/.test(dfs), 'E1c 「总是调用」旧形状不得回潮');
      const na = fs.readFileSync(path.join(ROOT, 'src/narrative/analyzer/NarrativeAnalyzer.mjs'), 'utf8');
      assert(!/enrichSocialByGmgn && !cached\.gmgn_info/.test(na), 'E2 NarrativeAnalyzer 缓存命中补调块退役（x-0 补调不回潮）');
    }
  } finally {
    CachedFetcher.fetchWithCache = origFwc;
    gmgnMod.GMGNTokenAPI = OrigGMGNTokenAPI;
    if (prevKey === undefined) delete process.env.GMGN_API_KEY;
    else process.env.GMGN_API_KEY = prevKey;
  }

  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}：${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
