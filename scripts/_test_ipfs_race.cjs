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
 *   C. C106 迁移直链（j7tracker.io）：形状卡位 + normalize 透传 + 单点直抓
 *      （不轮询网关）+ 失败 null + 源码口径（直链分支先于 CID 提取）
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
  const { fetchIpfsMetadata, isIpfsUrl, normalizeIpfsRef, isDirectMetadataUrl } = await import('../src/narrative/utils/ipfs-metadata-fetcher.mjs');
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

  // ═══ C. C106 迁移直链（j7tracker.io）═══
  console.log('══ C. C106 迁移直链（j7tracker.io）═══');
  {
    // C1 形状卡位：host+路径双卡（https、allowlist host、/metadata/<id>.json）
    assert(isDirectMetadataUrl('https://metadata.j7tracker.io/metadata/1fc6571ba6bb4827.json') === true
      && isDirectMetadataUrl('  https://metadata.j7tracker.io/metadata/abc_1.json ') === true,
      'C1 直链形状命中（含首尾空白）');
    assert(isDirectMetadataUrl('http://metadata.j7tracker.io/metadata/x.json') === false
      && isDirectMetadataUrl('https://evil.io/metadata/x.json') === false
      && isDirectMetadataUrl('https://metadata.j7tracker.io/other/x.json') === false
      && isDirectMetadataUrl('https://metadata.j7tracker.io/metadata/x') === false
      && isDirectMetadataUrl('https://metadata.j7tracker.io/metadata/a/b.json') === false,
      'C1b 非 allowlist 形状不命中');
    assert(normalizeIpfsRef('https://metadata.j7tracker.io/metadata/1fc6571ba6bb4827.json')
      === 'https://metadata.j7tracker.io/metadata/1fc6571ba6bb4827.json',
      'C2 normalizeIpfsRef 直链原样透传');

    // C3 直抓成功：TREE 现场形状；stub 未匹配即 throw → 若碰任何 IPFS 网关即失败
    CachedFetcher.fetchWithCache = (_url, _rt, fn) => fn();
    const treeJson = { createdOn: 'pump.fun', name: 'BNB Tree', symbol: 'TREE',
      twitter: 'https://x.com/TCryptochicks/status/2111911894772576530', website: '' };
    globalThis.fetch = stubFetch({
      'https://metadata.j7tracker.io/': async () => ({ ok: true, text: async () => JSON.stringify(treeJson) }),
    });
    const r3 = await fetchIpfsMetadata('https://metadata.j7tracker.io/metadata/1fc6571ba6bb4827.json');
    assert(r3 && r3.twitter === treeJson.twitter, 'C3 直链单点直抓成功（不轮询 IPFS 网关）');

    // C4 直抓失败（非 ok / 异常）→ null（上层按「解包失败，meta 作 website」原流程）
    globalThis.fetch = stubFetch({
      'https://metadata.j7tracker.io/': async () => { throw new Error('403'); },
    });
    const r4 = await fetchIpfsMetadata('https://metadata.j7tracker.io/metadata/1fc6571ba6bb4827.json');
    assert(r4 === null, 'C4 直链异常 → null');
    globalThis.fetch = realFetch;
    CachedFetcher.fetchWithCache = origFwc;

    // C5 源码口径：直链分支先于 CID 提取 + host 卡位在源码
    const c106 = fs.readFileSync(path.join(ROOT, 'src/narrative/utils/ipfs-metadata-fetcher.mjs'), 'utf8');
    const directIdx = c106.indexOf('if (isDirectMetadataUrl(metaUrl))');
    const cidIdx = c106.indexOf('const cid = extractCid(metaUrl)');
    assert(directIdx > 0 && cidIdx > directIdx, 'C5 直链分支先于 CID 提取');
    assert(c106.includes('metadata\\.j7tracker\\.io'), 'C5b host 卡位在源码');
  }

  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}：${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
