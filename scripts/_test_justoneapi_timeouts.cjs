#!/usr/bin/env node
/**
 * _test_justoneapi_timeouts — 3c（2026-10-13 叙事提速第二批）4 fetcher 超时防线
 *
 * 零 DB 零网络：fetch 桩只在收到 abort 时 reject（模拟挂死上游）；setTimeout
 * 包装立即触发（零真实等待）→ timer→controller.abort()→fetch reject→既有 catch
 * 全链走通。断言：各调用点优雅返 null 不挂死 / fetch 带 AbortSignal / 超时值
 * 逐点锁定（weixin×2+amazon+bilibili JustOneAPI=15s；b23.tv+github×2=10s）/
 * 源码 finally clearTimeout 口径。
 */

const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
function assert(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

async function main() {
  // setTimeout 包装：记录 ms 并立即触发（timeout 线立即走 abort）
  const origSetTimeout = globalThis.setTimeout;
  const firedTimeouts = [];
  globalThis.setTimeout = (fn, ms, ...rest) => {
    firedTimeouts.push(ms);
    return origSetTimeout(fn, 0, ...rest);
  };

  // fetch 桩：永不 resolve，signal abort 时以 AbortError reject（挂死上游形状）
  const origFetch = globalThis.fetch;
  const fetchCalls = [];
  globalThis.fetch = async (url, opts = {}) => {
    fetchCalls.push({ url: String(url), hasSignal: !!(opts.signal && opts.signal.aborted !== undefined) });
    return new Promise((resolve, reject) => {
      if (opts.signal) {
        opts.signal.addEventListener('abort', () => {
          const e = new Error('This operation was aborted');
          e.name = 'AbortError';
          reject(e);
        });
      }
      // 无 signal 的调用挂死由测试超时兜出（不应出现——所有点位都该带 signal）
    });
  };

  const { WeixinFetcher } = await import(
    path.join(__dirname, '../src/narrative/utils/weixin-fetcher.mjs'));
  const amazon = await import(
    path.join(__dirname, '../src/narrative/utils/amazon-fetcher.mjs'));
  const { BilibiliFetcher } = await import(
    path.join(__dirname, '../src/narrative/utils/bilibili-fetcher.mjs'));
  const { GithubFetcher } = await import(
    path.join(__dirname, '../src/narrative/utils/github-fetcher.mjs'));
  const { CachedFetcher } = await import(
    path.join(__dirname, '../src/narrative/db/ExternalResourceCache.mjs'));
  // amazon 只导出缓存包装版 fetchProductInfo——桩直透内部函数
  const origFetchWithCache = CachedFetcher.fetchWithCache;
  CachedFetcher.fetchWithCache = async (_url, _type, fn) => fn();

  try {
    // ── A：微信两 API（15s）──
    console.log('[A] weixin 15s × 2');
    {
      firedTimeouts.length = 0; fetchCalls.length = 0;
      const t0 = Date.now();
      const r1 = await WeixinFetcher.fetchArticleDetail('https://mp.weixin.qq.com/s/abc123');
      assert(r1 === null, 'fetchArticleDetail 挂死上游 → 优雅 null');
      assert(firedTimeouts.includes(15000), `超时 15000（实际 ${firedTimeouts}）`);
      assert(fetchCalls[0].url.includes('get-article-detail'), '打的是文章详情端点');
      assert(Date.now() - t0 < 3000, '不挂死（<3s 返回）');

      firedTimeouts.length = 0; fetchCalls.length = 0;
      const r2 = await WeixinFetcher.fetchArticleFeedback('https://mp.weixin.qq.com/s/abc123');
      assert(r2 === null, 'fetchArticleFeedback 挂死上游 → 优雅 null');
      assert(firedTimeouts.includes(15000), `超时 15000（实际 ${firedTimeouts}）`);
      assert(fetchCalls[0].url.includes('get-article-feedback'), '打的是文章反馈端点');
    }

    // ── B：Amazon（15s）──
    console.log('[B] amazon 15s');
    {
      firedTimeouts.length = 0; fetchCalls.length = 0;
      const r = await amazon.fetchProductInfo('https://www.amazon.com/dp/B08N5WRWNW');
      assert(r === null, 'fetchProductInfo 挂死上游 → 优雅 null');
      assert(firedTimeouts.includes(15000), `超时 15000（实际 ${firedTimeouts}）`);
      assert(fetchCalls[0].url.includes('asin=B08N5WRWNW'), 'URL 带 ASIN');
    }

    // ── C：Bilibili b23.tv 短链（10s）+ JustOneAPI（15s）──
    console.log('[C] bilibili 10s + 15s');
    {
      firedTimeouts.length = 0; fetchCalls.length = 0;
      const r1 = await BilibiliFetcher.extractVideoId('https://b23.tv/xyz789');
      assert(r1 === null, 'b23.tv 短链挂死 → 优雅 null');
      assert(firedTimeouts.includes(10000), `超时 10000（实际 ${firedTimeouts}）`);
      assert(fetchCalls[0].url.includes('b23.tv'), '打的是短链');

      firedTimeouts.length = 0; fetchCalls.length = 0;
      const r2 = await BilibiliFetcher.fetchViaJustOneAPI('BV1xx411c7mD');
      assert(r2 === null, 'JustOneAPI 挂死 → 优雅 null');
      assert(firedTimeouts.includes(15000), `超时 15000（实际 ${firedTimeouts}）`);
      assert(fetchCalls[0].url.includes('bvid=BV1xx411c7mD'), 'URL 带 bvid');
    }

    // ── D：GitHub API（10s）→ 回退网页解析（10s）双段 ──
    console.log('[D] github 10s × 2（API→网页回退）');
    {
      firedTimeouts.length = 0; fetchCalls.length = 0;
      const r = await GithubFetcher.fetchRepoInfo('https://github.com/someowner/somerepo');
      assert(r === null, 'API+网页双挂死 → 优雅 null');
      assert(firedTimeouts.length === 2 && firedTimeouts[0] === 10000 && firedTimeouts[1] === 10000,
        `两段各 10000（实际 ${firedTimeouts}）`);
      assert(fetchCalls.length === 2 && fetchCalls[0].url.includes('api.github.com') && fetchCalls[1].url.includes('github.com/someowner'),
        '首段 API 域名，回退段原 URL');
    }

    // ── E：fetch 全点位带 AbortSignal ──
    console.log('[E] signal 接线');
    {
      assert(fetchCalls.every(c => c.hasSignal), `${fetchCalls.length} 次 fetch 全带 AbortSignal`);
    }

    // ── F：源码口径（finally clearTimeout + signal 逐文件）──
    console.log('[F] 源码口径');
    {
      const files = [
        'weixin-fetcher.mjs', 'amazon-fetcher.mjs',
        'bilibili-fetcher.mjs', 'github-fetcher.mjs',
      ];
      for (const f of files) {
        const src = fs.readFileSync(path.join(__dirname, '../src/narrative/utils/', f), 'utf8');
        const signalCount = (src.match(/signal: controller\.signal/g) || []).length;
        const finallyCount = (src.match(/finally \{\s*clearTimeout\(timer\);/g) || []).length;
        assert(signalCount > 0 && signalCount === finallyCount,
          `${f}: signal ${signalCount} 处 = finally clearTimeout ${finallyCount} 处`);
      }
    }
  } finally {
    globalThis.setTimeout = origSetTimeout;
    globalThis.fetch = origFetch;
    CachedFetcher.fetchWithCache = origFetchWithCache;
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

// 测试级兜底：任何 fetcher 意外挂死（漏 signal 的点位）30s 杀出并判失败
const killTimer = setTimeout(() => {
  console.error('测试挂死 30s——存在漏 signal/漏超时的调用点');
  process.exit(1);
}, 30000);
killTimer.unref?.();

main().catch(e => {
  console.error('测试运行失败:', e);
  process.exit(1);
});
