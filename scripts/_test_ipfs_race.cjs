#!/usr/bin/env node
/**
 * N2 IPFS 网关竞速单测（2026-10-13 叙事提速案）——本地零 DB 零网络
 *
 *   A. 行为级（globalThis.fetch 打桩 + CachedFetcher 打桩直透真析）：
 *      A1 快成功网关胜出不等慢网关（原串行轮询 8s×N → first-success）
 *      A2 全网关失败（500/null JSON）→ warn + null（上层按无 metadata 继续）
 *      A3 网络层异常（fetch throw）同样归入 any reject → null
 *      A4 无效 JSON / 超长文本 → 该网关 reject，不影响成功网关
 *   B. 源码口径：Promise.any + 网关清单 4 个 + 全失败 warn 保原语义
 *   C. C106 j7tracker 直链（bit 不回归）+ C112 任意 http(s) meta 直链
 *      （CRO 现场形状）：normalize 透传 + 单点直抓（不轮询网关）+ 非 JSON
 *      内容判定 null 回落 website 路径 + host 卡位退役（打地鼠防线源码断言）
 *
 * 用法：node scripts/_test_ipfs_race.cjs
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function assert(cond, label, extra) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.error(`  ❌ ${label}${extra ? ` | ${extra}` : ''}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const { fetchIpfsMetadata, isIpfsUrl, normalizeIpfsRef } = await import('../src/narrative/utils/ipfs-metadata-fetcher.mjs');
  const { CachedFetcher } = await import('../src/narrative/db/ExternalResourceCache.mjs');

  // 缓存层直透：绕过 DB 只测 fetchIpfsMetadata 的真析闭包（Promise.any 语义）
  const origFwc = CachedFetcher.fetchWithCache;
  CachedFetcher.fetchWithCache = (_url, _rt, fn) => fn();

  const realFetch = globalThis.fetch;
  const metaUrl = 'https://gateway.pinata.cloud/ipfs/bafkreigawtest';

  // 网关按 URL 前缀分派：{ 前缀: handler }
  const stubFetch = (routes) => async (url) => {
    for (const [prefix, handler] of Object.entries(routes)) {
      if (String(url).startsWith(prefix)) return handler(url);
    }
    throw new Error(`unexpected url: ${url}`);
  };

  console.log('══ A. 行为级网关竞速 ═══');
  {
    // A1 快网关成功、慢网关悬空 → 取快者，不等慢者
    const ok = { ok: true, text: async () => JSON.stringify({ name: 'meta', twitter: 'https://x.com/a' }) };
    globalThis.fetch = stubFetch({
      'https://gateway.pinata.cloud/': async () => { await sleep(400); return ok; }, // 慢
      'https://ipfs.io/': async () => { await sleep(10); return ok; },               // 快
      'https://4everland.io/': async () => { await sleep(10); return { ok: false, status: 500 }; },
      'https://w3s.link/': async () => { throw new Error('network down'); },
    });
    const t0 = Date.now();
    const r = await fetchIpfsMetadata(metaUrl);
    assert(r && r.name === 'meta', 'A1 first-success 网关胜出');
    assert(Date.now() - t0 < 200, 'A1b 不等慢网关（400ms 网关悬空仍返回）', `${Date.now() - t0}ms`);
  }
  {
    // A2 全部失败（非 ok / 空文本）→ null
    globalThis.fetch = stubFetch({
      'https://': async () => ({ ok: false, status: 429 }),
    });
    const r = await fetchIpfsMetadata(metaUrl);
    assert(r === null, 'A2 全网关失败 → null（上层按无 metadata 原流程）');
  }
  {
    // A3 网络层全异常 → null
    globalThis.fetch = async () => { throw new Error('network down'); };
    const r = await fetchIpfsMetadata(metaUrl);
    assert(r === null, 'A3 网络异常全 reject → null');
  }
  {
    // A4 无效 JSON / 超长文本网关 reject，成功网关照常胜出
    globalThis.fetch = stubFetch({
      'https://gateway.pinata.cloud/': async () => ({ ok: true, text: async () => 'not-json{' }),
      'https://ipfs.io/': async () => ({ ok: true, text: async () => 'x'.repeat(65 * 1024) }),
      'https://4everland.io/': async () => ({ ok: true, text: async () => JSON.stringify({ via: '4ever' }) }),
      'https://w3s.link/': async () => ({ ok: false, status: 500 }),
    });
    const r = await fetchIpfsMetadata(metaUrl);
    assert(r && r.via === '4ever', 'A4 无效/超长网关 reject 不影响成功网关');
  }
  globalThis.fetch = realFetch;
  CachedFetcher.fetchWithCache = origFwc;

  // ═══ B. 源码口径 ═══
  console.log('══ B. 源码口径 ═══');
  {
    const ipfs = fs.readFileSync(path.join(ROOT, 'src/narrative/utils/ipfs-metadata-fetcher.mjs'), 'utf8');
    assert(ipfs.includes('await Promise.any(IPFS_GATEWAYS.map(async (gateway)'), 'B1 Promise.any 竞速形状');
    assert((ipfs.match(/'https:\/\//g) || []).length === 4, 'B2 4 网关清单');
    assert(ipfs.includes('metadata 所有网关均失败'), 'B2b 全失败 warn 保原语义');
    assert(isIpfsUrl('https://gw.io/ipfs/QmX') === true
      && normalizeIpfsRef('baf' + 'a'.repeat(20)) === 'https://gateway.pinata.cloud/ipfs/baf' + 'a'.repeat(20)
      && normalizeIpfsRef('https://gw.io/ipfs/QmX') === 'https://gw.io/ipfs/QmX',
      'B3 归一化助手行为不回归');
  }

  // ═══ C. C106 j7tracker 直链（bit 不回归）+ C112 任意 http(s) meta 直链 ═══
  console.log('══ C. C106 j7tracker 直链 + C112 任意 http(s) meta 直链 ═══');
  {
    // C1 normalize 透传：任意 http(s) URL（C112）；j7tracker/裸 CID/IPFS 形状 bit 不回归
    const j7 = 'https://metadata.j7tracker.io/metadata/1fc6571ba6bb4827.json';
    const cro = 'https://mil3jetlf7mwwhkea9cu.xyz/m/e6ada90384f4497afbf381eece34b380.json'; // C112 现场（随机子域网关）
    assert(normalizeIpfsRef(j7) === j7, 'C1 j7tracker 直链透传（C106 bit 不回归）');
    assert(normalizeIpfsRef(cro) === cro, 'C1b CRO 随机网关域直链透传（C112 现场形状）');
    assert(normalizeIpfsRef('http://meta-7777.s3.amazonaws.com/metadata/x.json')
      === 'http://meta-7777.s3.amazonaws.com/metadata/x.json', 'C1c S3 http 直链透传');
    assert(normalizeIpfsRef('ftp://example.com/m.json') === null
      && normalizeIpfsRef('ipfs://bafkreigawtest') === null
      && normalizeIpfsRef('not a url') === null
      && normalizeIpfsRef('https://x.com/a b') === null,
      'C1d 非 http(s)/含空白引用不透传（解包门槛=scheme 白名单非 host）');

    // C2 CRO 现场直抓：解包出锁在 JSON 里的 twitter；stub 未匹配即 throw → 若碰任何 IPFS 网关即失败
    CachedFetcher.fetchWithCache = (_url, _rt, fn) => fn();
    const croJson = { name: 'CHIEF RISK OFFICER', symbol: 'CRO',
      twitter: 'https://x.com/BinanceDesi/status/2112144227757178894', website: '' };
    globalThis.fetch = stubFetch({ [cro]: async () => ({ ok: true, text: async () => JSON.stringify(croJson) }) });
    const r2 = await fetchIpfsMetadata(cro);
    assert(r2 && r2.twitter === croJson.twitter, 'C2 任意直链单点直抓成功（不轮询 IPFS 网关）');

    // C3 内容判定：非 JSON（HTML 网页 / 推文 URL 填进 meta）→ null → 回落「meta 链接按 website 处理」
    globalThis.fetch = stubFetch({
      'https://example.com/': async () => ({ ok: true, text: async () => '<html>hi</html>' }),
      'https://x.com/': async () => ({ ok: true, text: async () => '<html>tweet</html>' }),
    });
    assert(await fetchIpfsMetadata('https://example.com/') === null, 'C3a HTML 非 JSON → null');
    assert(await fetchIpfsMetadata('https://x.com/BinanceDesi/status/2112144227757178894') === null,
      'C3b 推文 URL 填 meta → 非 JSON null（回落 allUrls twitter 桶，与改前行为一致）');

    // C4 j7tracker 直抓异常（403 形状）→ null（C106 bit 不回归）
    globalThis.fetch = stubFetch({ 'https://metadata.j7tracker.io/': async () => { throw new Error('403'); } });
    const r4 = await fetchIpfsMetadata(j7);
    assert(r4 === null, 'C4 直链异常 → null');
    globalThis.fetch = realFetch;
    CachedFetcher.fetchWithCache = origFwc;

    // C5 源码口径：host 卡位退役（打地鼠防线）+ CID 网关分支与直链分支并存
    const src = fs.readFileSync(path.join(ROOT, 'src/narrative/utils/ipfs-metadata-fetcher.mjs'), 'utf8');
    assert(!src.includes('DIRECT_METADATA_URL_RE') && !src.includes('metadata\\.j7tracker\\.io'),
      'C5 host 卡位正则已退役（任意 http(s) 直链，新网关形状零维护）');
    assert(src.includes('const cid = extractCid(metaUrl)') && src.includes('直链 metadata 获取异常'),
      'C5b CID 网关竞速分支与无 CID 直链分支并存');
  }

  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}：${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
