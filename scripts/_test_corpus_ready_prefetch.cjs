#!/usr/bin/env node
/**
 * 语料就绪即评门（提速②a）+ IPFS 缓存共用（提速②b）单测——零 DB 零网络
 *
 * 事故背景（뮤오23 案 0x176c…7777，2026-10-15）：
 *   ②a 数据预取门发起仅比 fire 早 0.29s——根因=语料补采 resolve 后要等下一
 *      factorsUpdated tick 才评门，fire 前空窗全浪费；语料就绪刻（queueMicrotask）
 *      直接评，门条件在补采完成时已满足则预取立刻发起
 *   ②b 引擎侧补采 IPFS 解包出 metadata 后即丢弃，叙事直调 ipfs 段对同一 URL
 *      重新解包（miss 时实测 309-8051ms）——补采结果写 external_resource_cache
 *      （键=normalizeIpfsRef 与读侧一致），直调塌缩为 DB 读
 *
 *   A. ②a 行为级（引擎 prototype 直挂，_test_data_prefetch B 节先例）：
 *      补采完成回调即刻评门（不等 tick）/ buildFactorMap null 跳过不标 done /
 *      三重门（池 miss/bought/buying）跳过 / service null 零异常
 *   B. ②b 行为级（enricher 打桩 axios + IpfsCacheWriter 打桩 ESM 静态方法）：
 *      flap IPFS 分支调 writer 且 await 先于返回 / S3 直链不调 / fourmeme 不调 /
 *      writer 缺失不炸 / 键归一三分支（网关原样/裸 CID 转 pinata/S3 null 不写）/
 *      set 形状（resourceType/ttl 730 天）/ set throw 自 catch 返回 false
 *   C. 源码口径：_enrichCorpus 回调钩子 / _dataPrefetchOnCorpusReady 三重门 /
 *      引擎注入 ipfsCacheWriter / S3 分支无 writer 调用
 *
 * 用法：node scripts/_test_corpus_ready_prefetch.cjs
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { FourMemeWssTradingEngine } = require('../src/trading-engine/implementations/FourMemeWssTradingEngine');
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
const CORPUS_FIELDS = { twitterUrl: 'https://x.com/foo/status/123456', description: 'x', corpus: { provider: 'flap_ipfs' } };
const FACTORS = { __hit: true, buyVolumeBnb: 1 };

// ── ②a 引擎桩（prototype 直挂）──
function makeEngine(fields = {}) {
  // 真 DataPrefetchService（fetchers 打桩）——过门真发起，便于断言发起时序
  const { DataPrefetchService } = require('../src/trading-engine/pre-check/DataPrefetchService');
  const calls = { fetchTweet: [] };
  const svc = new DataPrefetchService({
    condition: 'buyVolumeBnb >= 0.5',
    evaluate: (cond, factors) => factors.__hit === true,
    fetchersProvider: async () => ({
      fetchTweet: async (url) => { calls.fetchTweet.push({ url, at: Date.now() }); return null; },
      analyzeImage: async () => false,
    }),
    logger: makeLogger(),
    experimentId: 't-exp',
  });
  return Object.assign(Object.create(FourMemeWssTradingEngine.prototype), {
    _experimentId: 'test-exp',
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    _dataPrefetchService: svc,
    _tokenCorpusMap: new Map(),
    _tokenPool: { getToken: () => ({ status: 'monitoring' }) },
    _buyingTokens: new Set(),
    _factorAggregator: { buildFactorMap: () => ({ ...FACTORS }) },
    __prefetchCalls: calls,
    ...fields,
  });
}

async function main() {
  // ═══ A. ②a 语料就绪即评门 ═══
  console.log('══ A. ②a 语料就绪即评门（行为级）══');

  // A1 事故反证：补采完成回调刻发起预取，不等下一 factorsUpdated tick
  {
    const eng = makeEngine({
      _corpusEnricher: { enrich: async () => ({ ...CORPUS_FIELDS }) },
      dataService: { updateTokenCorpus: async () => true },
    });
    const t0 = Date.now();
    await eng._enrichCorpus({ token: ADDR, symbol: 'T', meta: null }, 'flap');
    // queueMicrotask 在 await 链内执行；fetchTweet 由 service 后台发起
    await sleep(30);
    check('补采完成即刻发起预取（fetchTweet 恰一次）', eng.__prefetchCalls.fetchTweet.length === 1,
      eng.__prefetchCalls.fetchTweet);
    check('发起时刻≈补采回调刻（<30ms，不等 tick）',
      eng.__prefetchCalls.fetchTweet[0] && eng.__prefetchCalls.fetchTweet[0].at - t0 < 30,
      eng.__prefetchCalls.fetchTweet[0] ? eng.__prefetchCalls.fetchTweet[0].at - t0 : null);
    check('语料镜像已入 Map', eng._tokenCorpusMap.get(ADDR)?.twitterUrl === CORPUS_FIELDS.twitterUrl);
  }

  // A2 buildFactorMap null（state 缺失/faPreFilter 出窗）→ 跳过不标 done（下 tick 兜底）
  {
    const eng = makeEngine({ _factorAggregator: { buildFactorMap: () => null } });
    eng._dataPrefetchOnCorpusReady(ADDR);
    await sleep(20);
    check('buildFactorMap null 零发起', eng.__prefetchCalls.fetchTweet.length === 0);
    check('不标 write-once（isDone=false 下 tick 兜底）', eng._dataPrefetchService.isDone(ADDR) === false);
  }

  // A3 三重门：池 miss / bought / buying → 零发起
  for (const [name, fields] of [
    ['池 miss', { _tokenPool: { getToken: () => null } }],
    ['已持仓 bought', { _tokenPool: { getToken: () => ({ status: 'bought' }) } }],
    ['买入中 buying', { _buyingTokens: new Set([ADDR]) }],
  ]) {
    const eng = makeEngine(fields);
    eng._dataPrefetchOnCorpusReady(ADDR);
    await sleep(20);
    check(`三重门 ${name} 零发起`, eng.__prefetchCalls.fetchTweet.length === 0);
  }

  // A4 service 未配置（dataPrefetch.enabled=false）→ 零调用零异常
  {
    const eng = makeEngine({ _dataPrefetchService: null });
    eng._dataPrefetchOnCorpusReady(ADDR);  // 不炸
    check('service null 零异常零调用', true);
  }

  // A5 评门抛错不阻断落库链（warn 可见）
  {
    const log = makeLogger();
    const eng = makeEngine({
      logger: { info: () => {}, warn: (...a) => log.warn(...a), error: () => {}, debug: () => {} },
      _factorAggregator: { buildFactorMap: () => { throw new Error('FA boom'); } },
      _corpusEnricher: { enrich: async () => ({ ...CORPUS_FIELDS }) },
      dataService: { updateTokenCorpus: async () => true },
    });
    let corpusSaved = false;
    eng.dataService.updateTokenCorpus = async () => { corpusSaved = true; return true; };
    await eng._enrichCorpus({ token: ADDR, symbol: 'T' }, 'flap');
    await sleep(20);
    check('评门异常 warn 落日志不静默', log.lines.some(l => l[0] === 'warn' && l.join(' ').includes('语料就绪预取评门异常')));
    check('评门异常不阻断语料落库链', corpusSaved === true);
  }

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
    check('writer await 先于 enrich 返回（缓存先于 fire 可见）', seen[0]?.at >= doneAt && enrichResolvedAt >= seen[0].at + 9);
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
    check('_enrichCorpus 回调含 queueMicrotask 评门钩子',
      /_tokenCorpusMap\.set\(info\.token, corpusFields\);[\s\S]{0,400}queueMicrotask\(\(\) => \{[\s\S]{0,300}_dataPrefetchOnCorpusReady\(info\.token\)/.test(engine));
    check('钩子 try/catch 解耦（异常不阻断落库）', engine.includes('语料就绪预取评门异常'));
    check('_dataPrefetchOnCorpusReady 三重门+null 容忍',
      engine.includes("if (!token || token.status === 'bought' || this._buyingTokens.has(tokenAddress)) return;")
      && /_dataPrefetchOnCorpusReady[\s\S]{0,500}if \(!factors\) return;/.test(engine));
    check('引擎注入 ipfsCacheWriter（无条件）', engine.includes('ipfsCacheWriter = createIpfsCacheWriter(this.logger).write'));
    check('引擎 require createIpfsCacheWriter', engine.includes("require('../core/IpfsCacheWriter.js')"));

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
