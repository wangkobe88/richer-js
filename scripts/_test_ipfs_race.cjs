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

  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}：${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
