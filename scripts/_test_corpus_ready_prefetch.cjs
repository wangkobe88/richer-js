#!/usr/bin/env node
/**
 * IPFS 缓存共用（提速②b）单测——零 DB 零网络
 *
 * 事故背景（뮤오23 案 0x176c…7777，2026-10-15）：
 *   ②b 引擎侧补采 IPFS 解包出 metadata 后即丢弃，叙事直调 ipfs 段对同一 URL
 *      重新解包（miss 时实测 309-8051ms）——补采结果写 external_resource_cache
 *      （键=normalizeIpfsRef 与读侧一致），直调塌缩为 DB 读
 *
 *   （②a 语料就绪即评门已随 dataPrefetch 机制退役删除，C84 2026-10-17：
 *    分析提前到叙事发起条件触发时刻，预取链路整体退役——本文件裁剪只留 ②b）
 *
 *   B. ②b 行为级（enricher 打桩 axios + IpfsCacheWriter 打桩 ESM 静态方法）：
 *      flap IPFS 分支调 writer 且 await 先于返回 / S3 直链不调 / fourmeme 不调 /
 *      writer 缺失不炸 / 键归一三分支（网关原样/裸 CID 转 pinata/S3 null 不写）/
 *      set 形状（resourceType/ttl 730 天）/ set throw 自 catch 返回 false
 *   C. 源码口径：引擎注入 ipfsCacheWriter / S3 分支无 writer 调用 /
 *      dataPrefetch 退役反证（引擎源码零残留）
 *
 * 用法：node scripts/_test_corpus_ready_prefetch.cjs
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { TokenCorpusEnricher } = require('../src/trading-engine/core/TokenCorpusEnricher');
const { createIpfsCacheWriter } = require('../src/trading-engine/core/IpfsCacheWriter');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.error(`  ❌ ${name}${detail !== undefined ? ` | ${JSON.stringify(detail)}` : ''}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function makeLogger() {
  const lines = [];
  return {
    lines,
    info: (...a) => lines.push(['info', ...a]),
    warn: (...a) => lines.push(['warn', ...a]),
    error: (...a) => lines.push(['error', ...a]),
    debug: () => {},
  };
}

const ADDR = '0xabc0000000000000000000000000000000000d1';

async function main() {
  // ═══ B. ②b IPFS 缓存共用 ═══
  console.log('══ B. ②b IPFS 缓存共用（行为级）══');

  const METADATA = { name: '뮤오23', twitter: 'https://x.com/foo/status/999', description: 'hi' };
  const GW_URL = 'https://gateway.pinata.cloud/ipfs/bafyabc123def456ghi789jkl'; // flap meta 网关 URL 形态

  function makeEnricher(writer) {
    const e = new TokenCorpusEnricher({ ipfsGateways: ['https://gateway.pinata.cloud/ipfs/'] }, null, 't');
    e._ipfsClient = { get: async () => ({ data: { ...METADATA } }) };  // 打桩网络层
    e.ipfsCacheWriter = writer;
    return e;
  }

  // B1 flap IPFS 分支：writer 收到 metaUrl 原串 + metadata，且 await 先于 enrich 返回
  {
    const seen = [];
    const doneAt = Date.now();
    let enrichResolvedAt = 0;
    const e = makeEnricher(async (metaUrl, metadata) => {
      seen.push({ metaUrl, metadata, at: Date.now() }); await sleep(10); return true;
    });
    const p = e.enrich(ADDR, 'flap', GW_URL).then(r => { enrichResolvedAt = Date.now(); return r; });
    const fields = await p;
    check('flap IPFS 分支 writer 恰一次', seen.length === 1);
    check('writer 收到 metaUrl 原串', seen[0]?.metaUrl === GW_URL);
    check('writer 收到 metadata 对象（同 fetch 产物）', seen[0]?.metadata?.twitter === METADATA.twitter);
    check('writer await 先于 enrich 返回（缓存先于 fire 可见）', seen[0]?.at >= doneAt && enrichResolvedAt >= seen[0]?.at + 9);
    check('corpusFields 正常返回（补采不受影响）', fields?.twitterUrl === METADATA.twitter && fields?.corpus?.provider === 'flap_ipfs');
  }

  // B2 S3 直链分支：不调 writer（叙事侧 normalizeIpfsRef null 不读此缓存）
  {
    const seen = [];
    const e = makeEnricher(async (...a) => { seen.push(a); return true; });
    const fields = await e.enrich(ADDR, 'flap', 'https://meta-7777.s3.amazonaws.com/metadata/x.json');
    check('S3 直链零 writer 调用', seen.length === 0 && fields?.corpus?.provider === 'flap_meta_url');
  }

  // B3 fourmeme 分支：不调 writer
  {
    const seen = [];
    const e = makeEnricher(async (...a) => { seen.push(a); return true; });
    e._fourMemeApi = { getTokenInfo: async () => ({ raw: { twitterUrl: 'https://x.com/a', descr: 'd' } }) };
    const fields = await e.enrich(ADDR, 'fourmeme', null);
    check('fourmeme 分支零 writer 调用', seen.length === 0 && fields?.corpus?.provider === 'fourmeme_api');
  }

  // B4 writer 缺失（未注入）→ 不炸、corpusFields 正常
  {
    const e = makeEnricher(null);
    const fields = await e.enrich(ADDR, 'flap', GW_URL);
    check('writer 缺失不炸且语料正常', fields?.twitterUrl === METADATA.twitter);
  }

  // B5 IpfsCacheWriter：键归一三分支 + set 形状（打桩 ESM 静态方法）
  {
    const writer = createIpfsCacheWriter(makeLogger());
    // 首次调用触发 _loadEsm（拿到真模块引用后才能 monkey-patch 静态方法）
    const setCalls = [];
    const { ExternalResourceCache } = await import(path.join(ROOT, 'src/narrative/db/ExternalResourceCache.mjs'));
    const origSet = ExternalResourceCache.set;
    ExternalResourceCache.set = async (url, resourceType, content, options = {}) => {
      setCalls.push({ url, resourceType, content, ttl: options.ttl });
      return true;
    };
    try {
      // 网关 URL 原样为键
      check('网关 URL 写入成功', await writer.write(GW_URL, METADATA) === true);
      check('网关 URL 键=原串', setCalls[0]?.url === GW_URL, setCalls[0]);
      check("resourceType='ipfs_metadata'", setCalls[0]?.resourceType === 'ipfs_metadata');
      check('content=metadata 原对象', setCalls[0]?.content === METADATA);
      check('ttl=730 天（63072000s，2026-10-15 用户裁定）', setCalls[0]?.ttl === 730 * 86400, setCalls[0]?.ttl);
      // 裸 CID → pinata 网关形态键（与叙事侧读键同函数）
      await writer.write('bafyabc123def456ghi789jkl', METADATA);
      check('裸 CID 键=normalizeIpfsRef 产物（pinata 网关形态）',
        setCalls[1]?.url === 'https://gateway.pinata.cloud/ipfs/bafyabc123def456ghi789jkl', setCalls[1]?.url);
      // S3 直链 → null 不写
      const n0 = setCalls.length;
      check('S3 直链不写返回 false', await writer.write('https://meta-7777.s3.amazonaws.com/metadata/x.json', METADATA) === false);
      check('S3 直链零 set 调用', setCalls.length === n0);
      // set throw → 自 catch 返回 false（不 reject 不影响补采）
      ExternalResourceCache.set = async () => { throw new Error('DB down'); };
      check('set throw 自 catch 返回 false', await writer.write(GW_URL, METADATA) === false);
      // set 返回 false → write false
      ExternalResourceCache.set = async () => false;
      check('set false → write false', await writer.write(GW_URL, METADATA) === false);
    } finally {
      ExternalResourceCache.set = origSet;  // 还原（防污染同进程其他测试）
    }
  }

  // ═══ C. 源码口径 ═══
  console.log('══ C. 源码口径（接线形状锁定）══');
  {
    const engine = src('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
    check('引擎注入 ipfsCacheWriter（无条件）', engine.includes('ipfsCacheWriter = createIpfsCacheWriter(this.logger).write'));
    check('引擎 require createIpfsCacheWriter', engine.includes("require('../core/IpfsCacheWriter.js')"));
    // C84 退役反证：dataPrefetch/visionPrefetch 机制在引擎源码零残留（防回流）
    check('dataPrefetch/visionPrefetch 引擎零残留（C84 退役）',
      !engine.includes('_dataPrefetch') && !engine.includes('visionPrefetch'));

    const enr = src('src/trading-engine/core/TokenCorpusEnricher.js');
    const ipfsBranch = enr.slice(enr.indexOf("provider: 'flap_ipfs'"), enr.indexOf("provider: 'flap_meta_url'"));
    check('IPFS 分支含 await writer 调用', ipfsBranch.includes('await this.ipfsCacheWriter?.(metaUrl, metadata)'));
    const s3Branch = enr.slice(enr.indexOf("provider: 'flap_meta_url'"), enr.indexOf('const fields = {};'));
    check('S3 分支无 writer 调用', !s3Branch.includes('ipfsCacheWriter'));

    const writer = src('src/trading-engine/core/IpfsCacheWriter.js');
    check('writer 键=normalizeIpfsRef（与读侧同函数）', writer.includes('normalizeIpfsRef(metaUrl)'));
    check('writer 只写成功值不 markFailed', !writer.includes('markFailed('));
    check('writer 失败自 catch', /catch \(error\)[\s\S]{0,200}return false;/.test(writer));
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
