#!/usr/bin/env node
/**
 * 数据预取门单测（2026-10-15 立项，YOYO号案 0xa16c…7777）——本地零 DB 零网络
 *
 *   A. DataPrefetchService 行为级（fetchers/evaluate/logger 全打桩）：
 *      构造校验三连 throw（condition/evaluate/fetchersProvider 缺失）/
 *      门不满足不发起且不标 write-once（后续满足可发起）/ 门满足发起一次
 *      （write-once 二次 false）/ corpus 缺失与无 twitterUrl 不发起不标记 /
 *      账号 URL（无 /status）标 done 跳过零调用 / fetchTweet null 结束不调
 *      analyzeImage / 有图调 analyzeImage / 无图不调 / 未知因子 evaluate
 *      fail-closed false 不发起 / fetchersProvider 抛错后台 catch 不炸
 *   B. 引擎接线行为级（prototype 直挂同 _test_narrative_prefetch 先例）：
 *      _dataPrefetchCheck 语料 miss 早退 / 语料就绪透传 corpus 调
 *      maybePrefetch / write-once 后零 Map 读
 *   C. 源码口径（锁防线）：引擎构造段 dataPrefetch 读段 + DataPrefetchService
 *      构造 + _tokenCorpusMap 初始化 / 启动校验块（loadStrategies 后 FA 因子集
 *      throw）/ _onFactorsUpdated 买腿分支挂点在 _scheduleDebouncedBuy 前 /
 *      _enrichCorpus 存内存镜像 / stop 清 Map / ESM import 双模块路径 /
 *      BacktestEngine 零接线 / web-server route 校验 + flapWs 透传 /
 *      scan 脚本扫描键 / 创建页 UI（dp-enabled/dp-condition/按平台选段/回测剥离）
 *   D. vision TTL 口径：service 三处默认 730 天 + config cacheTtlSec 63072000
 *      （2026-10-15 用户裁定 90 天→730 天；版本不符判 miss 机制保升版重析）
 *
 * 用法：node scripts/_test_data_prefetch.cjs
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { FourMemeWssTradingEngine } = require('../src/trading-engine/implementations/FourMemeWssTradingEngine');
const { DataPrefetchService } = require('../src/trading-engine/pre-check/DataPrefetchService');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.error(`  ❌ ${name}${detail !== undefined ? ` | ${JSON.stringify(detail)}` : ''}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ── 打桩件 ──
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
function makeService(overrides = {}) {
  const calls = { fetchTweet: [], analyzeImage: [] };
  const svc = new DataPrefetchService({
    condition: 'buyVolumeBnb >= 0.5',
    evaluate: (cond, factors) => factors.__hit === true,
    fetchersProvider: async () => ({
      fetchTweet: async (url) => { calls.fetchTweet.push(url); return overrides.tweet ?? null; },
      analyzeImage: async (ti) => { calls.analyzeImage.push(ti); return true; },
    }),
    logger: makeLogger(),
    experimentId: 't-exp',
    ...overrides.ctor,
  });
  return { svc, calls };
}
const CORPUS = { twitterUrl: 'https://x.com/foo/status/123456', webUrl: null, description: 'x' };
const TWEET_WITH_IMG = { type: 'tweet', text: 'hi', author_screen_name: 'foo', media: { images: [{ url: 'https://pbs.twimg.com/media/abc.jpg' }] } };
const TWEET_NO_IMG = { type: 'tweet', text: 'hi', media: {} };

async function main() {
  const ADDR = '0xabc0000000000000000000000000000000000d1';

  // ═══ A. DataPrefetchService 行为级 ═══
  console.log('══ A. DataPrefetchService 行为级 ══');

  // A1 构造校验
  for (const [name, ctor] of [
    ['condition 缺失 throw', { evaluate: () => true, fetchersProvider: async () => ({}) }],
    ['evaluate 缺失 throw', { condition: 'age < 5', fetchersProvider: async () => ({}) }],
    ['fetchersProvider 缺失 throw', { condition: 'age < 5', evaluate: () => true }],
  ]) {
    let threw = false;
    try { new DataPrefetchService({ logger: makeLogger(), ...ctor }); } catch (e) { threw = true; }
    check(name, threw);
  }

  // A2 门不满足：不发起、不标 write-once（后续 tick 满足可发起）
  {
    const { svc, calls } = makeService();
    check('门不满足不发起', svc.maybePrefetch(ADDR, { __hit: false }, CORPUS) === false);
    check('门不满足零 fetch 调用', calls.fetchTweet.length === 0);
    check('门不满足不标 write-once（isDone=false）', svc.isDone(ADDR) === false);
    // 后续满足 → 发起（重试语义）
    check('后续满足可发起', svc.maybePrefetch(ADDR, { __hit: true }, CORPUS) === true);
    await sleep(10);
    check('发起后 fetchTweet 恰一次', calls.fetchTweet.length === 1);
  }

  // A3 write-once：二次调用直接 false 零调用
  {
    const { svc, calls } = makeService();
    check('门满足发起', svc.maybePrefetch(ADDR, { __hit: true }, CORPUS) === true);
    check('write-once 二次 false', svc.maybePrefetch(ADDR, { __hit: true }, CORPUS) === false);
    await sleep(10);
    check('fetchTweet 恰一次', calls.fetchTweet.length === 1);
  }

  // A4 corpus 缺失 / 无 twitterUrl：不发起不标记
  {
    const { svc } = makeService();
    check('corpus null 不发起不标记', svc.maybePrefetch(ADDR, { __hit: true }, null) === false && svc.isDone(ADDR) === false);
    check('无 twitterUrl 不发起不标记', svc.maybePrefetch(ADDR, { __hit: true }, {}) === false && svc.isDone(ADDR) === false);
    check('twitterUrl 空串不发起', svc.maybePrefetch(ADDR, { __hit: true }, { twitterUrl: '  ' }) === false);
  }

  // A5 账号 URL（无 /status）：标 done 跳过、零网络调用（防 fetchFromUrl markFailed 污染冷却行）
  {
    const { svc, calls } = makeService();
    check('账号 URL 不发起', svc.maybePrefetch(ADDR, { __hit: true }, { twitterUrl: 'https://x.com/foo' }) === false);
    check('账号 URL 标 done（不再重试）', svc.isDone(ADDR) === true);
    await sleep(10);
    check('账号 URL 零 fetch 调用', calls.fetchTweet.length === 0 && calls.analyzeImage.length === 0);
  }

  // A6 fetchTweet null：结束不调 analyzeImage（不炸）
  {
    const { svc, calls } = makeService({ tweet: null });
    svc.maybePrefetch(ADDR, { __hit: true }, CORPUS);
    await sleep(10);
    check('fetchTweet null 结束零 analyzeImage', calls.analyzeImage.length === 0);
    check('fetchTweet null 后已标 done', svc.isDone(ADDR) === true);
  }

  // A7 有图 → analyzeImage 恰一次；A8 无图 → 不调
  {
    const { svc, calls } = makeService({ tweet: TWEET_WITH_IMG });
    svc.maybePrefetch(ADDR, { __hit: true }, CORPUS);
    await sleep(10);
    check('有图 analyzeImage 恰一次', calls.analyzeImage.length === 1 && calls.analyzeImage[0] === TWEET_WITH_IMG);
  }
  {
    const { svc, calls } = makeService({ tweet: TWEET_NO_IMG });
    svc.maybePrefetch(ADDR, { __hit: true }, CORPUS);
    await sleep(10);
    check('无图不调 analyzeImage', calls.analyzeImage.length === 0);
  }

  // A9 未知因子：evaluate fail-closed false（引擎 evaluateCondition 同语义）→ 永不发起
  {
    const { svc, calls } = makeService();
    check('evaluate false（未知因子 fail-closed）不发起',
      svc.maybePrefetch(ADDR, { notARealFactor: 1 }, CORPUS) === false);
    await sleep(10);
    check('未知因子零调用', calls.fetchTweet.length === 0);
  }

  // A10 fetchersProvider 抛错：发起返回 true，后台 catch 不炸（无 unhandled rejection）
  {
    const log = makeLogger();
    const svc = new DataPrefetchService({
      condition: 'age < 5', evaluate: () => true,
      fetchersProvider: async () => { throw new Error('ESM import 失败'); },
      logger: log, experimentId: 't-exp',
    });
    check('provider 抛错仍返回 true（发起）', svc.maybePrefetch(ADDR, {}, CORPUS) === true);
    await sleep(10);
    check('provider 抛错 warn 落日志不崩',
      log.lines.some(l => l[0] === 'warn' && l.join(' ').includes('ESM import 失败')));
  }

  // A11 过门日志带 tokenAgeSec
  {
    const log = makeLogger();
    const svc = new DataPrefetchService({
      condition: 'age < 5', evaluate: () => true,
      fetchersProvider: async () => ({ fetchTweet: async () => null, analyzeImage: async () => false }),
      logger: log, experimentId: 't-exp',
    });
    svc.maybePrefetch(ADDR, { tokenAgeSec: 6.8 }, CORPUS);
    await sleep(10);
    check('过门日志含 tokenAge≈7s', log.lines.some(l => l[0] === 'info' && l.join(' ').includes('tokenAge≈7s')));
  }

  // ═══ B. 引擎接线行为级 ═══
  console.log('══ B. 引擎接线行为级 ══');
  const { calls: engCalls } = (() => {
    const c = { fetchTweet: [], analyzeImage: [] };
    return { calls: c };
  })();

  function makeEngine(fields = {}) {
    const inner = makeService();
    return Object.assign(Object.create(FourMemeWssTradingEngine.prototype), {
      _experimentId: 'test-exp',
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      _dataPrefetchService: inner.svc,
      _tokenCorpusMap: new Map(),
      _dataPrefetchProbeCalls: inner.calls,
      ...fields,
    });
  }

  // B1 语料 miss（补采未完成）早退：不触 service
  {
    const eng = makeEngine();
    eng._dataPrefetchCheck(ADDR, { __hit: true });
    check('语料 miss 早退零发起', eng._dataPrefetchProbeCalls.fetchTweet.length === 0);
  }
  // B2 语料就绪 → 透传 corpus 发起
  {
    const eng = makeEngine();
    eng._tokenCorpusMap.set(ADDR, CORPUS);
    eng._dataPrefetchCheck(ADDR, { __hit: true });
    await sleep(10);
    check('语料就绪发起预取', eng._dataPrefetchProbeCalls.fetchTweet.length === 1);
    // B3 write-once 后：_dataPrefetchCheck 首行 isDone 早退，零 Map 读也零调用
    eng._dataPrefetchCheck(ADDR, { __hit: true });
    await sleep(10);
    check('write-once 后不再发起', eng._dataPrefetchProbeCalls.fetchTweet.length === 1);
  }

  // ═══ C. 源码口径（锁防线） ═══
  console.log('══ C. 源码口径 ══');
  const ENG = src('src/trading-engine/implementations/FourMemeWssTradingEngine.js');

  // C1 构造段
  check('C1 构造段读 dataPrefetch 段',
    ENG.includes("(this._mergedWsConfig().dataPrefetch || {}).enabled === true"));
  check('C1 构造 DataPrefetchService（evaluate 绑 strategyEngine）',
    ENG.includes("new DataPrefetchService({") && ENG.includes("evaluate: (cond, factors) => this._strategyEngine.evaluateCondition(cond, factors)"));
  check('C1 _tokenCorpusMap 初始化', ENG.includes('this._tokenCorpusMap = new Map()'));

  // C2 启动校验块（loadStrategies 后、FA 因子集、throw）
  {
    const iLoad = ENG.indexOf('this._strategyEngine.loadStrategies(');
    const iVal = ENG.indexOf('fourmemeWs.dataPrefetch.condition 引用未知因子');
    check('C2 启动校验块位于 loadStrategies 之后', iLoad !== -1 && iVal !== -1 && iVal > iLoad);
    const block = ENG.slice(iLoad, iVal);
    check('C2 校验用 ConditionEvaluator + availableFactorIds + throw',
      block.includes('ConditionEvaluator') && block.includes('availableFactorIds'));
  }

  // C3 挂点：买腿分支 _narrativePrefetchCheck 之后、_scheduleDebouncedBuy 之前
  {
    const iBranch = ENG.indexOf("if (!this._buyingTokens.has(tokenAddress) && token.status !== 'bought')");
    const iN3 = ENG.indexOf('this._narrativePrefetchCheck(tokenAddress, factors, token);', iBranch);
    const iDp = ENG.indexOf('this._dataPrefetchCheck(tokenAddress, factors);', iBranch);
    const iDeb = ENG.indexOf('this._scheduleDebouncedBuy(tokenAddress, tick);', iBranch);
    check('C3 挂点在买腿分支 N3 后、去抖前', iBranch !== -1 && iN3 !== -1 && iDp > iN3 && iDeb > iDp);
    check('C3 挂点前有 enabled 早退守卫', ENG.slice(iN3, iDp).includes('if (this._dataPrefetchService)'));
  }

  // C4 _enrichCorpus 内存镜像
  {
    const iEnrich = ENG.indexOf('_enrichCorpus(info, platform) {');
    const iSet = ENG.indexOf('this._tokenCorpusMap.set(info.token, corpusFields);', iEnrich);
    const iDb = ENG.indexOf('updateTokenCorpus', iEnrich);
    check('C4 语料镜像在落库前写入', iEnrich !== -1 && iSet !== -1 && iDb !== -1 && iSet < iDb);
  }

  // C5 stop 清 Map
  check('C5 stop 清 _tokenCorpusMap', ENG.includes('this._tokenCorpusMap.clear()'));

  // C6 ESM import 双模块（CJS→ESM 边界，dynamic import 先例）
  check('C6 fetchers dynamic import twitter-fetcher + image-analysis',
    ENG.includes("import('../../narrative/utils/twitter-fetcher.mjs')") &&
    ENG.includes("import('../../narrative/analyzer/services/image-analysis-service.mjs')"));

  // C7 BacktestEngine 零接线
  const BT = src('src/trading-engine/implementations/BacktestEngine.js');
  check('C7 BacktestEngine 零接线', !BT.includes('dataPrefetch') && !BT.includes('DataPrefetchService'));

  // C8 web-server：route 校验 + flapWs 透传
  const WEB = src('src/web-server.js');
  check('C8 web route dataPrefetch 因子校验 400',
    WEB.includes("dataPrefetch.condition 引用未知因子") && WEB.includes('getAvailableFactorIds'));
  check('C8 web route advancedSections 加 flapWs 透传',
    WEB.includes('const advancedSections = { stopLoss, tokenPositionAnalyzer, fourmemeWs, flapWs };'));

  // C9 scan 脚本扫描键
  const SCAN = src('scripts/scan-unknown-factor-conditions.cjs');
  check('C9 scan 脚本扫 dataPrefetch.condition（FA 集）',
    SCAN.includes("dataPrefetch") && SCAN.includes("for (const secKey of ['fourmemeWs', 'flapWs'])"));

  // C10 创建页 UI：控件 + 按平台选段 + 回测剥离 + 复制回填 + flapWs 暂存
  const HTML = src('src/web/templates/create_experiment.html');
  check('C10 UI 控件 dp-enabled/dp-condition',
    HTML.includes('id="dp-enabled"') && HTML.includes('id="dp-condition"'));
  check('C10 按平台选段（flap→flapWs）', HTML.includes("(_plat === 'flap') ? 'flapWs' : 'fourmemeWs'"));
  check('C10 选段后另一段 dataPrefetch 剥离（防双段死配置）',
    HTML.includes("const other = (sec === 'flapWs') ? 'fourmemeWs' : 'flapWs';"));
  check('C10 回测模式剥离', HTML.includes("tradingMode !== 'backtest'"));
  check('C10 复制回填（fourmemeWs/flapWs 任一带）',
    HTML.includes("copyData.fourmemeWs?.dataPrefetch || copyData.flapWs?.dataPrefetch"));
  check('C10 UI 关显式删段', HTML.includes('delete adv[k].dataPrefetch'));
  check('C10 复制暂存携带 flapWs', HTML.includes("...(copyData.flapWs ? { flapWs: copyData.flapWs } : {}),"));

  // ═══ D. vision TTL 口径 ═══
  console.log('══ D. vision TTL 口径 ══');
  const IMG = src('src/narrative/analyzer/services/image-analysis-service.mjs');
  check('D service 三处默认 730 天', (IMG.match(/730 \* 24 \* 60 \* 60/g) || []).length === 3);
  check('D service 零残留 90 天默认', !IMG.includes('vision.cacheTtlSec || 90 * 24 * 60 * 60'));
  const NCFG = JSON.parse(src('config/narrative-engine.json'));
  check('D config cacheTtlSec=63072000（730 天）', NCFG.vision.cacheTtlSec === 63072000);
  check('D 头注释记录裁定', IMG.includes('90 天→730 天'));

  console.log(`\n══ 结果：${pass} pass / ${fail} fail ══`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
