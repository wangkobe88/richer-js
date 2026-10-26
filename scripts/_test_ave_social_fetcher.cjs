#!/usr/bin/env node
/**
 * AVE 社媒补源 fetcher 单测（C238 股城案 2026-10-26 裁定）——零 DB 零网络
 *
 *   A. 行为级（AveTokenAPI 打桩 + CachedFetcher.fetchWithCache 打桩捕获）：
 *      A1 股城现场形状：appendix JSON 的 twitter/website 为完整 URL 原样返回
 *         （与 GMGN 裸 handle 拼接不同——AVE 不拼接）+ appendix 原文随 raw 落库
 *      A2 website 非 http 形状 → websiteUrl null（twitter 在则仍返回）
 *      A3 appendix 坏 JSON / 空串 → 无社媒形状 → null
 *      A4 无社媒（twitter/website 全空）→ null（真链路进 1h 失败冷却）
 *      A5 未配置 AVE_API_KEY → null 且 API 零调用
 *   B. TTL 接线与源码口径：
 *      B1 fetchWithCache options={maxAge:60, ttl:90d}（付费 key 省着烧；一轮
 *         retry 补轮内不重打）/ resourceType=ave_token_detail
 *      B2 源码口径 ave_token_detail 行（回潮防线）
 *      B3 cache key 形状 ave:token:bsc:<addr 小写>
 *   C. 源优先级链接线（C238：meta→IPFS→AVE→GMGN→C77 搜索最后手段）：
 *      C1 data-fetch aveNeeded 判据在位（!hasTwitterLink）
 *      C2 AVE 与 IPFS 在同一 Promise.all 并行
 *      C3 AVE 并入段在 IPFS 并入段之后（IPFS 补出 twitter → AVE 结果弃用）
 *      C4 GMGN 串行在 AVE 之后（gmgnNeeded 在 AVE 并入段之后计算）
 *      C5 enrichSocialByGmgn 默认 true（NarrativeAnalyzer 解构默认翻转）
 *      C6 hasTwitterLink 从 gmgn-social-fetcher 导入（判据单一真相）
 *      C7 C77 搜索兜底保留（narrative-engine.json searchFallback.enabled）
 *   D. 事故现场反证：
 *      D1 股城 appendix 实测原文重放 → twitterUrl=https://x.com/STOCK__OPOLIS
 *      D2 AVE 层不产生推文 URL（MEJ50749 宣告推归 GMGN link——AVE/AVE 分工锚）
 *
 * 用法：node scripts/_test_ave_social_fetcher.cjs
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

const ADDR = '0xAACBC156435DBAB7815A61BCCBA1C827E52A7777'; // 大写进、小写出（cache key）

// 股城现场 appendix 原文（2026-10-26 curl prod.ave-api.com/v2/tokens/<addr>-bsc）
const GUCHENG_APPENDIX = JSON.stringify({
  contractAddress: '', tokenName: '', symbol: '', divisor: '', tokenType: '',
  totalSupply: '', blueCheckmark: '', description: '',
  website: 'https://utter.cash/bnb/0xaacbc156435dbab7815a61bccba1c827e52a7777/taxinfo?lang=zh',
  email: '', blog: '', reddit: '', slack: '', facebook: '',
  twitter: 'https://x.com/STOCK__OPOLIS',
  btok: '', debox: '', goldhouse: '', bitcointalk: '', github: '', telegram: '',
});

function makeDetail(appendix, overrides = {}) {
  return { token: { address: ADDR.toLowerCase(), symbol: '股城', name: 'STOCKOPOLIS', appendix, ...overrides }, pairs: [] };
}

async function main() {
  // 打桩顺序（先例 _test_gmgn_social_fetcher）：先 require CJS 模块改写
  // module.exports.AveTokenAPI，fetcher 闭包内 dynamic import 拿到的即是 stub
  let apiCalls = 0;
  let lastTokenId = null;
  let nextDetail = null;
  let nextError = null;
  class StubAveTokenAPI {
    constructor(_base, _timeout, _key) {}
    async getTokenDetail(tokenId) {
      apiCalls++;
      lastTokenId = tokenId;
      if (nextError) throw nextError;
      return nextDetail;
    }
  }
  const aveMod = require('../src/core/ave-api/token-api.js');
  const OrigAveTokenAPI = aveMod.AveTokenAPI;
  aveMod.AveTokenAPI = StubAveTokenAPI;

  // fetchWithCache 打桩：捕获 options + 直透真析（不触 DB/markFailed）
  const { CachedFetcher } = await import(path.join(ROOT, 'src/narrative/db/ExternalResourceCache.mjs'));
  const origFwc = CachedFetcher.fetchWithCache;
  let captured = null;
  CachedFetcher.fetchWithCache = async (url, resourceType, fn, options) => {
    captured = { url, resourceType, options };
    return fn();
  };

  const { fetchAveSocialLinks } = await import(path.join(ROOT, 'src/narrative/utils/ave-social-fetcher.mjs'));
  const prevKey = process.env.AVE_API_KEY;
  process.env.AVE_API_KEY = 'test-key';

  try {
    console.log('══ A. 行为级 ══');
    // A1 股城现场：完整 URL 原样返回 + raw 落库
    {
      nextDetail = makeDetail(GUCHENG_APPENDIX);
      const r = await fetchAveSocialLinks('bsc', ADDR);
      assert(r?.twitterUrl === 'https://x.com/STOCK__OPOLIS', 'A1 twitterUrl=appendix 完整 URL 原样（不拼接 handle）', r);
      assert(r?.websiteUrl === 'https://utter.cash/bnb/0xaacbc156435dbab7815a61bccba1c827e52a7777/taxinfo?lang=zh', 'A1b websiteUrl 直传', r);
      assert(r?.raw?.appendix === GUCHENG_APPENDIX, 'A1c appendix 原文随 raw 落库（晚到归因审计）');
      assert(lastTokenId === `${ADDR}-bsc`, 'A1d tokenId 形状 <addr>-<chain>', lastTokenId);
    }
    // A2 website 非 http
    {
      nextDetail = makeDetail(JSON.stringify({ twitter: 'https://x.com/okcoin', website: 'not-a-url' }));
      const r = await fetchAveSocialLinks('bsc', ADDR);
      assert(r?.websiteUrl === null && r?.twitterUrl === 'https://x.com/okcoin', 'A2 非 http(s) website → null（twitter 照常）', r);
    }
    // A3 appendix 坏 JSON / 空串
    {
      nextDetail = makeDetail('{"twitter": "https://x.com/broken'); // 坏 JSON
      const r1 = await fetchAveSocialLinks('bsc', ADDR);
      assert(r1 === null, 'A3 appendix 坏 JSON → null（无社媒形状）', r1);
      nextDetail = makeDetail('');
      const r2 = await fetchAveSocialLinks('bsc', ADDR);
      assert(r2 === null, 'A3b appendix 空串 → null');
      nextDetail = makeDetail(JSON.stringify({ twitter: '', website: '', telegram: '' }));
      const r3 = await fetchAveSocialLinks('bsc', ADDR);
      assert(r3 === null, 'A3c appendix 字段全空串 → null（空串不当有效值，BRF 同款坑）');
    }
    // A5 无 key → null 且 API 零调用
    {
      delete process.env.AVE_API_KEY;
      const before = apiCalls;
      const r = await fetchAveSocialLinks('bsc', ADDR);
      assert(r === null && apiCalls === before, 'A5 AVE_API_KEY 缺失 → null 且零 API 调用');
    }
    process.env.AVE_API_KEY = 'test-key';

    console.log('══ B. TTL 接线与源码口径 ══');
    {
      // A1 的 captured 即最新一次成功调用
      assert(captured?.options?.maxAge === 60, 'B1 fetchWithCache options.maxAge=60（一轮 retry 补轮内不重打）', captured?.options);
      assert(captured?.options?.ttl === 90 * 86400, 'B1b options.ttl=90d', captured?.options);
      assert(captured?.resourceType === 'ave_token_detail', 'B1c resourceType=ave_token_detail');
      assert(captured?.url === `ave:token:bsc:${ADDR.toLowerCase()}`, 'B3 cache key=ave:token:链:地址小写', captured?.url);

      const ttlSrc = fs.readFileSync(path.join(ROOT, 'src/narrative/db/cache-ttl-config.mjs'), 'utf8');
      const m = ttlSrc.match(/ave_token_detail:\s*\{[^}]*\}/);
      assert(m && /maxAge:\s*60/.test(m[0]), 'B2 源码 ave_token_detail={maxAge:60, ttl:90d}（付费 key 配额口径）', m?.[0]);
      const { getCacheTTL } = await import(path.join(ROOT, 'src/narrative/db/cache-ttl-config.mjs'));
      const t = getCacheTTL('ave_token_detail');
      assert(t.maxAge === 60, 'B2b getCacheTTL 真值断言', t);

      const fetcherSrc = fs.readFileSync(path.join(ROOT, 'src/narrative/utils/ave-social-fetcher.mjs'), 'utf8');
      assert(fetcherSrc.includes('raw: token'), 'B4 源码 raw 落库形状（appendix 原文不落即丢防线）');
    }

    console.log('══ C. 源优先级链接线（C238：meta→IPFS→AVE→GMGN→C77 搜索最后）══');
    {
      const dfs = fs.readFileSync(path.join(ROOT, 'src/narrative/analyzer/services/data-fetch-service.mjs'), 'utf8');
      assert(/const aveNeeded = !hasTwitterLink\(allUrls\);/.test(dfs), 'C1 data-fetch AVE 必要门在位（!hasTwitterLink）');
      const parIdx = dfs.indexOf('const [metadata, aveSocials] = await Promise.all(');
      assert(parIdx > 0 && /timing\.wrap\('ave'/.test(dfs.slice(parIdx, parIdx + 900)), 'C2 AVE 与 IPFS 在同一 Promise.all 并行');
      const aveMergeIdx = dfs.indexOf('AVE 社媒补源新增');
      const ipfsMergeIdx = dfs.indexOf('IPFS metadata 解包新增');
      assert(aveMergeIdx > ipfsMergeIdx && ipfsMergeIdx > 0, 'C3 AVE 并入段在 IPFS 并入段之后（IPFS 补出 twitter → AVE 弃用）', { ipfsMergeIdx, aveMergeIdx });
      const gmgnNeededIdx = dfs.indexOf('const gmgnNeeded = options.enrichSocialByGmgn && !hasTwitterLink(allUrls)');
      assert(gmgnNeededIdx > aveMergeIdx, 'C4 GMGN 串行在 AVE 之后（gmgnNeeded 在 AVE 并入段之后计算——所有前置源失效才走 GMGN）', { aveMergeIdx, gmgnNeededIdx });
      assert((dfs.match(/fetchGmgnSocialLinks\('bsc'/g) || []).length === 1, 'C4b GMGN 调用点唯一（IPFS∥GMGN 并行旧形状不得回潮）');
      assert((dfs.match(/fetchAveSocialLinks\('bsc'/g) || []).length === 1, 'C4c AVE 调用点唯一');

      const na = fs.readFileSync(path.join(ROOT, 'src/narrative/analyzer/NarrativeAnalyzer.mjs'), 'utf8');
      assert(/enrichSocialByGmgn = true, rowCache/.test(na), 'C5 NarrativeAnalyzer enrichSocialByGmgn 默认 true（C238 全链路放开）');

      const aveSrc = fs.readFileSync(path.join(ROOT, 'src/narrative/utils/ave-social-fetcher.mjs'), 'utf8');
      assert(/import \{ hasTwitterLink \} from '\.\/gmgn-social-fetcher\.mjs';/.test(aveSrc), 'C6 hasTwitterLink 从 gmgn-social-fetcher 导入（判据单一真相）');

      const neCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/narrative-engine.json'), 'utf8'));
      assert(neCfg.searchFallback?.enabled === true, 'C7 C77 搜索兜底保留为最后手段（searchFallback.enabled=true）');
    }

    console.log('══ D. 事故现场反证（股城 0xaacbc156435dbab7815a61bccba1c827e52a7777）══');
    {
      // D1 完整 URL 不经拼接处理：STOCK__OPOLIS 官方号原样可达（_ 双下划线不被改写）
      nextDetail = makeDetail(GUCHENG_APPENDIX);
      const r = await fetchAveSocialLinks('bsc', ADDR);
      assert(r?.twitterUrl === 'https://x.com/STOCK__OPOLIS' && /^https:\/\/x\.com\//.test(r.twitterUrl), 'D1 股城官方号 URL 原样（W 资格轴证据入口=官方账号页）', r);
      // D2 AVE/AVE 分工：AVE 层不产生推文 URL（MEJ50749/status/… 宣告推归 GMGN link）
      const aveSrc = fs.readFileSync(path.join(ROOT, 'src/narrative/utils/ave-social-fetcher.mjs'), 'utf8');
      assert(!aveSrc.includes('twitter_username') && !/x\.com\/\$\{/.test(aveSrc),
        'D2 AVE 层无 handle 消费/无 x.com 拼接逻辑（链接 pickHttp 直传；宣告推 URL 归 GMGN link 层——2026-10-26 实测分工锚）');
      // D3 附录原文里的 MEJ50749 宣告推不是 AVE 提供的（股城 appendix 无该推——GMGN 独有）
      assert(!GUCHENG_APPENDIX.includes('MEJ50749'), 'D3 股城 AVE appendix 不含 MEJ50749 宣告推（GMGN link 独有形状实证）');
    }
  } finally {
    CachedFetcher.fetchWithCache = origFwc;
    aveMod.AveTokenAPI = OrigAveTokenAPI;
    if (prevKey === undefined) delete process.env.AVE_API_KEY;
    else process.env.AVE_API_KEY = prevKey;
  }

  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}：${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
