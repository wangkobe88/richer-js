#!/usr/bin/env node
/**
 * T116 GMGN 进场验证卖臂单测（2026-11-04 用户裁定「持仓 3 分钟无聪明钱/鲸鱼/KOL
 * 进场全部卖出」）——本地零 DB 零网络。
 *
 * 链路：start() 10s interval → _gmgnEntryScan 遍历持仓 → realHoldDuration ≥
 * holdSec（180s）→ GmgnEntryCheckService.checkEntry（GMGN getTokenInfo
 * wallet_tags_stat：smart/whale/renowned 三类在场数）→ FA setGmgnEntryFactors
 * 五键投影 → 卖臂 `gmgnEntryChecked == 1 AND gmgnEntryPresent == 0` 全清。
 * unknown fail-open（不投影不误卖）；write-once per 持仓轮；清仓自清理+再买入重置。
 *
 * 覆盖：
 *   A. Service 三态判定（entered 三变体/none/not_indexed/tags_missing/
 *      tags_malformed 反证——缺失键当 0=误卖方向必须 unknown）+ inflight join
 *      + 失败冷却 + 无 key
 *   B. FA 五键投影（getFactorKeys 收键=三防线真相源 / none / entered /
 *      未回填 fail-open 条件实评恒 false / clear）
 *   C. 引擎扫描（到点检查/write-once/unknown 重试节流/清仓自清理/竞态防线/
 *      再买入重置/卖执行中跳过）
 *   D. 源码口径（默认关物化/stop 清理/买入成功点双保险/回测零接线/
 *      FactorBuilder 透传/default.json 段形状）
 *
 * 零 DB 零网络：GMGNTokenAPI require.cache 预污染（母版 _test_gmgn_check_layer）
 * + dbManager 预污染（母版 _test_account_recheck_engine）。
 * 用法：node scripts/_test_gmgn_entry_check.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ══ 打桩 1：GMGN API（先污染 gmgn-api 模块，service 惰性 require 拿 stub）══
const gmgnMod = require('../src/core/gmgn-api');
const apiCalls = [];
let stubBehavior = null; // { response } | { error }
class StubGMGNTokenAPI {
  constructor(opts) { this.opts = opts; }
  async getTokenInfo(chain, address) {
    apiCalls.push({ chain, address, timeout: this.opts.timeout });
    if (stubBehavior && stubBehavior.error) throw stubBehavior.error;
    return stubBehavior ? stubBehavior.response : null;
  }
}
gmgnMod.GMGNTokenAPI = StubGMGNTokenAPI;

// ══ 打桩 2：dbManager（先于引擎模块加载）══
const DB_PATH = require.resolve(path.join(ROOT, 'src/services/dbManager'));
require.cache[DB_PATH] = {
  id: DB_PATH, filename: DB_PATH, loaded: true,
  exports: { dbManager: { getClient() { throw new Error('单测禁 DB'); } } },
};

const { GmgnEntryCheckService } = require('../src/trading-engine/core/GmgnEntryCheckService');
const { FourMemeWssTradingEngine } =
  require('../src/trading-engine/implementations/FourMemeWssTradingEngine');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${detail ? ` | ${detail}` : ''}`); }
}
const settle = () => new Promise(r => setImmediate(() => setImmediate(r)));
const ADDR = '0xt116aaa111222333444555666777888999aat116';

function tags(o) { return { wallet_tags_stat: { top_wallets: 5, creator_wallets: 1, ...o } }; }
const SAVED_KEY = process.env.GMGN_API_KEY;
async function withKey(fn) {
  process.env.GMGN_API_KEY = 'test-key';
  try { return await fn(); } finally { process.env.GMGN_API_KEY = SAVED_KEY; }
}

// ══════════ A. Service 三态判定 ══════════
(async () => {
  console.log('A. GmgnEntryCheckService');

  await withKey(async () => {
    const svc = () => new GmgnEntryCheckService({ timeoutMs: 1200, failCooldownMs: 60000 });

    stubBehavior = { response: tags({ smart_wallets: 2, whale_wallets: 0, renowned_wallets: 0 }) };
    let r = await svc().checkEntry(ADDR);
    check('A1 smart>0 → entered', r.state === 'entered' && r.smartWallets === 2
      && r.failReason === null);
    stubBehavior = { response: tags({ smart_wallets: 0, whale_wallets: 1, renowned_wallets: 0 }) };
    r = await svc().checkEntry(ADDR);
    check('A2 whale>0 → entered（三类任一即进场）', r.state === 'entered' && r.whaleWallets === 1);
    stubBehavior = { response: tags({ smart_wallets: 0, whale_wallets: 0, renowned_wallets: 1 }) };
    r = await svc().checkEntry(ADDR);
    check('A3 renowned>0 → entered', r.state === 'entered' && r.renownedWallets === 1);
    stubBehavior = { response: tags({ smart_wallets: 0, whale_wallets: 0, renowned_wallets: 0,
      fresh_wallets: 3, creator_wallets: 1, sniper_wallets: 2 }) };
    r = await svc().checkEntry(ADDR);
    check('A4 三类全零 → none（无人接力=卖臂信号）',
      r.state === 'none' && r.smartWallets === 0 && r.whaleWallets === 0 && r.renownedWallets === 0);
    check('A4b 事故反证：fresh/creator/sniper 在场不算进场（三类以外的标签不参与）',
      r.state === 'none');

    stubBehavior = null; // stub 无响应 → getTokenInfo 返回 null
    r = await svc().checkEntry(ADDR);
    check('A5 info=null（未索引）→ unknown 不误卖', r.state === 'unknown' && r.failReason === 'not_indexed');
    stubBehavior = { response: { holder_count: 10 } };
    r = await svc().checkEntry(ADDR);
    check('A6 wallet_tags_stat 缺失 → unknown tags_missing', r.state === 'unknown' && r.failReason === 'tags_missing');
    stubBehavior = { response: { wallet_tags_stat: { whale_wallets: 1, renowned_wallets: 0 } } };
    r = await svc().checkEntry(ADDR);
    check('A7 三键残缺（smart 缺失）→ unknown tags_malformed（缺失键当 0=误卖方向，宁可不判定）',
      r.state === 'unknown' && r.failReason === 'tags_malformed');

    const s = svc();
    apiCalls.length = 0;
    stubBehavior = { error: new Error('HTTP 429 RATE_LIMIT') };
    r = await s.checkEntry(ADDR);
    check('A8 API throw → unknown', r.state === 'unknown' && /error:/.test(r.failReason));
    r = await s.checkEntry(ADDR);
    check('A8b 失败冷却期内 → unknown cooldown 且零 API 调用',
      r.failReason === 'cooldown' && apiCalls.length === 1);

    // failCooldownMs=0 → 冷却不拦重试且成功清冷却
    stubBehavior = { error: new Error('x') };
    const s2 = new GmgnEntryCheckService({ timeoutMs: 1200, failCooldownMs: 0 });
    await s2.checkEntry(ADDR); // error → unknown
    stubBehavior = { response: tags({ smart_wallets: 1, whale_wallets: 0, renowned_wallets: 0 }) };
    r = await s2.checkEntry(ADDR);
    check('A9 failCooldownMs=0 → 立即重试成功', r.state === 'entered');

    const s3 = svc();
    apiCalls.length = 0;
    stubBehavior = { response: tags({ smart_wallets: 1, whale_wallets: 0, renowned_wallets: 0 }) };
    const [r1, r2] = await Promise.all([s3.checkEntry(ADDR), s3.checkEntry(ADDR)]);
    check('A10 inflight join：并发两调合一次请求且结果一致',
      apiCalls.length === 1 && r1.state === r2.state && r1.state === 'entered');

    stubBehavior = { response: tags({ smart_wallets: 0, whale_wallets: 0, renowned_wallets: 0 }) };
    delete process.env.GMGN_API_KEY;
    r = await svc().checkEntry(ADDR);
    check('A11 无 GMGN_API_KEY → unknown no_api_key（fail-open 不误卖）',
      r.state === 'unknown' && r.failReason === 'no_api_key');
  });

  // ══════════ B. FA 五键投影 ══════════
  console.log('B. FA 投影');
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  const keys = fa.getFactorKeys();
  const need = ['gmgnEntryChecked', 'gmgnEntryPresent', 'gmgnEntrySmartWallets',
    'gmgnEntryWhaleWallets', 'gmgnEntryRenownedWallets'];
  check('B1 getFactorKeys 探针收五键（三防线真相源）',
    need.every(k => keys.has(k)), need.filter(k => !keys.has(k)).join(','));

  FourMemeFactorAggregator.clearGmgnEntryFactors(ADDR);
  let snap = FourMemeFactorAggregator.getGmgnEntryFactors(ADDR);
  check('B2 未回填 → getGmgnEntryFactors null', snap === null);

  FourMemeFactorAggregator.setGmgnEntryFactors(ADDR,
    { state: 'none', smartWallets: 0, whaleWallets: 0, renownedWallets: 0, checkedAt: 1 });
  snap = FourMemeFactorAggregator.getGmgnEntryFactors(ADDR);
  check('B3 set none → 整包可读', snap && snap.state === 'none' && snap.smartWallets === 0);

  // 条件实评（卖臂条件形状）：none → true / entered → false / 未回填 → false
  const ev = new ConditionEvaluator();
  const SELL_COND = 'realHoldDuration >= 180 AND gmgnEntryChecked == 1 AND gmgnEntryPresent == 0';
  const ast = ev.parseCondition(SELL_COND);
  const evalWith = (ge) => {
    if (ge === undefined) FourMemeFactorAggregator.clearGmgnEntryFactors(ADDR);
    else FourMemeFactorAggregator.setGmgnEntryFactors(ADDR, ge);
    const st = fa._createEmptyState(ADDR, Date.now());
    const f = fa._buildFactorMap(st, Date.now());
    f.realHoldDuration = 200;
    return ev.evaluate(ast, f) === true;
  };
  check('B4 checked=1 present=0（none）→ 卖臂条件真',
    evalWith({ state: 'none', smartWallets: 0, whaleWallets: 0, renownedWallets: 0 }) === true);
  check('B5 present=1（entered）→ 条件假（留仓）',
    evalWith({ state: 'entered', smartWallets: 2, whaleWallets: 0, renownedWallets: 0 }) === false);
  check('B6 未回填（null/present null）→ 条件恒假不误卖（fail-open 方向反证）',
    evalWith(undefined) === false);
  // unknown 刻意不投影：state='unknown' 若被误写也必须翻 checked=0
  check('B7 state=unknown 误投影防护 → checked=0/present=null 条件假',
    evalWith({ state: 'unknown' }) === false);
  FourMemeFactorAggregator.clearGmgnEntryFactors(ADDR);

  // ══════════ C. 引擎扫描（prototype 借调）══
  console.log('C. _gmgnEntryScan');
  function makeEng({ svc } = {}) {
    const eng = Object.create(FourMemeWssTradingEngine.prototype);
    eng._experimentId = 'exp-t116-test';
    eng.logs = [];
    eng.logger = {
      info: (...a) => eng.logs.push(['info', ...a]),
      warn: (...a) => eng.logs.push(['warn', ...a]),
      error: (...a) => eng.logs.push(['error', ...a]),
      debug: () => {},
    };
    eng._gmgnEntryEnabled = true;
    eng._gmgnEntryService = svc || {
      calls: [],
      next: { state: 'none', smartWallets: 0, whaleWallets: 0, renownedWallets: 0,
        topWallets: 3, checkedAt: Date.now(), durationMs: 10, fromCache: false, failReason: null },
      checkEntry(addr, chain) { this.calls.push({ addr, chain }); return Promise.resolve({ ...this.next }); },
      destroy() {},
    };
    eng._gmgnEntryStates = new Map();
    eng._gmgnEntryHoldMs = 180 * 1000;
    eng._gmgnEntryRetryMs = 30 * 1000;
    eng.holdings = [{ tokenAddress: ADDR }];
    eng._getAllHoldings = function () { return this.holdings; };
    eng._sellingTokens = new Set();
    eng._buyingTokens = new Set();
    eng._tokenPool = {
      getToken: (addr) => ({ token: addr, symbol: 'TEST', status: 'bought' }),
    };
    eng._factorAggregator = {
      buildFactorMap: () => ({ realHoldDuration: 200 }),
    };
    return eng;
  }

  FourMemeFactorAggregator.clearGmgnEntryFactors(ADDR);
  let eng = makeEng();
  eng._factorAggregator = { buildFactorMap: () => ({ realHoldDuration: 100 }) };
  await eng._gmgnEntryScan();
  check('C1 未到 holdSec（100s<180s）→ 零调用零状态',
    eng._gmgnEntryService.calls.length === 0 && eng._gmgnEntryStates.size === 0);

  eng = makeEng();
  await eng._gmgnEntryScan(); await settle();
  check('C2 到点（200s≥180s）→ 检查恰一次 + none 回填 FA + warn 留审计',
    eng._gmgnEntryService.calls.length === 1
      && FourMemeFactorAggregator.getGmgnEntryFactors(ADDR)?.state === 'none'
      && eng.logs.some(l => l[0] === 'warn' && String(l[3]).includes('无聪明钱')));

  await eng._gmgnEntryScan(); await settle();
  check('C3 write-once：done 后不再重查（同轮持仓不翻案）',
    eng._gmgnEntryService.calls.length === 1);

  FourMemeFactorAggregator.clearGmgnEntryFactors(ADDR);
  eng = makeEng();
  eng._gmgnEntryService.next = { state: 'unknown', smartWallets: null, whaleWallets: null,
    renownedWallets: null, topWallets: null, checkedAt: Date.now(), durationMs: 5,
    fromCache: false, failReason: 'error: x' };
  await eng._gmgnEntryScan(); await settle();
  check('C4 unknown → 不投影不置 done',
    FourMemeFactorAggregator.getGmgnEntryFactors(ADDR) === null
      && !eng._gmgnEntryStates.get(ADDR)?.done);
  await eng._gmgnEntryScan(); await settle();
  check('C4b retryIntervalMs（30s）内不重试', eng._gmgnEntryService.calls.length === 1);
  eng._gmgnEntryStates.get(ADDR).lastAttemptAt = Date.now() - 31 * 1000;
  eng._gmgnEntryService.next = { state: 'entered', smartWallets: 0, whaleWallets: 1,
    renownedWallets: 0, topWallets: 4, checkedAt: Date.now(), durationMs: 5,
    fromCache: false, failReason: null };
  await eng._gmgnEntryScan(); await settle();
  check('C4c 到期重试成功 → entered 回填 + info 留仓日志',
    FourMemeFactorAggregator.getGmgnEntryFactors(ADDR)?.state === 'entered'
      && eng.logs.some(l => l[0] === 'info' && String(l[3]).includes('在场留仓')));

  FourMemeFactorAggregator.setGmgnEntryFactors(ADDR, { state: 'none' });
  eng.holdings = [];
  await eng._gmgnEntryScan();
  check('C5 清仓自清理：检查态删 + FA 注入清',
    eng._gmgnEntryStates.size === 0 && FourMemeFactorAggregator.getGmgnEntryFactors(ADDR) === null);

  eng = makeEng();
  const eng2 = eng;
  eng._gmgnEntryService.checkEntry = () => new Promise(resolve => {
    // 慢 promise：resolve 前完成再买入重置
    setImmediate(() => {
      eng2._resetGmgnEntryFor(ADDR);
      resolve({ state: 'none', smartWallets: 0, whaleWallets: 0, renownedWallets: 0,
        topWallets: 2, checkedAt: Date.now(), durationMs: 1, fromCache: false, failReason: null });
    });
  });
  await eng._gmgnEntryScan(); await settle(); await settle();
  check('C6 竞态防线：重置后旧结果不回填（不冒充新轮）',
    FourMemeFactorAggregator.getGmgnEntryFactors(ADDR) === null);

  eng = makeEng();
  eng._sellingTokens.add(ADDR);
  await eng._gmgnEntryScan(); await settle();
  check('C7 卖执行中跳过（不重入）', eng._gmgnEntryService.calls.length === 0);

  eng = makeEng();
  eng._gmgnEntryStates.set(ADDR, { done: true, checkedAt: 1 });
  FourMemeFactorAggregator.setGmgnEntryFactors(ADDR, { state: 'none' });
  eng._resetGmgnEntryFor(ADDR);
  check('C8 _resetGmgnEntryFor：state 删 + FA 清（sold→rebu 陈旧 none 误卖防线）',
    eng._gmgnEntryStates.size === 0 && FourMemeFactorAggregator.getGmgnEntryFactors(ADDR) === null);

  // ── T116b 买点进场观察（2026-11-05 用户指令：买点也调一次，纯观察不设条件）──
  eng = makeEng();
  eng.metaWrites = [];
  eng._updateSignalMetadata = async (sid, meta) => { eng.metaWrites.push({ sid, meta }); };
  eng._recordGmgnEntryBuyObs('sig-1', ADDR); await settle(); await settle();
  check('C9 买点观察：checkEntry 恰一次 + gmgnEntryObs 落 signal metadata（含计数）',
    eng._gmgnEntryService.calls.length === 1
      && eng.metaWrites.length === 1 && eng.metaWrites[0].sid === 'sig-1'
      && eng.metaWrites[0].meta.gmgnEntryObs.state === 'none'
      && eng.metaWrites[0].meta.gmgnEntryObs.smartWallets === 0);

  eng = makeEng();
  eng.metaWrites = [];
  eng._updateSignalMetadata = async (sid, meta) => { eng.metaWrites.push({ sid, meta }); };
  eng._gmgnEntryService.next = { state: 'entered', smartWallets: 0, whaleWallets: 0,
    renownedWallets: 2, topWallets: 6, checkedAt: Date.now(), durationMs: 5,
    fromCache: false, failReason: null };
  eng._recordGmgnEntryBuyObs('sig-2', ADDR); await settle(); await settle();
  check('C9b entered 帧：metadata 落 entered + info 日志留审计（KOL 在场）',
    eng.metaWrites[0]?.meta?.gmgnEntryObs?.state === 'entered'
      && eng.metaWrites[0].meta.gmgnEntryObs.renownedWallets === 2
      && eng.logs.some(l => l[0] === 'info' && String(l[3]).includes('买点观察')));

  eng = makeEng();
  eng.metaWrites = [];
  eng._updateSignalMetadata = async (sid, meta) => { eng.metaWrites.push({ sid, meta }); };
  eng._gmgnEntryEnabled = false;
  eng._recordGmgnEntryBuyObs('sig-3', ADDR);
  eng._gmgnEntryEnabled = true;
  eng._recordGmgnEntryBuyObs(null, ADDR);
  await settle(); await settle();
  check('C10 机制关/无 signalId → 零调用零落库（观察随 enabled 同开关）',
    eng._gmgnEntryService.calls.length === 0 && eng.metaWrites.length === 0);

  // ══════════ D. 源码口径 ══════════
  console.log('D. 源码口径');
  const ENG_SRC = read('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
  const BT_SRC = read('src/trading-engine/implementations/BacktestEngine.js');
  const FB_SRC = read('src/trading-engine/core/FactorBuilder.js');
  const FA_SRC = read('src/services/FourMemeFactorAggregator.js');
  const DEF = JSON.parse(read('config/default.json'));

  check('D1 默认关物化：enabled === true 才开（源码锁死）',
    /this\._gmgnEntryEnabled = gecCfg\.enabled === true/.test(ENG_SRC));
  check('D2 default.json 段形状（enabled:false + holdSec 180 默认）',
    DEF.fourmemeWs.gmgnEntryCheck && DEF.fourmemeWs.gmgnEntryCheck.enabled === false
      && DEF.fourmemeWs.gmgnEntryCheck.holdSec === 180);
  check('D3 stop 清理：FA 注入逐清 + states.clear + service.destroy',
    /_gmgnEntryStates[\s\S]{0,200}clearGmgnEntryFactors[\s\S]{0,120}_gmgnEntryStates\.clear\(\);[\s\S]{0,160}_gmgnEntryService\.destroy\(\)/.test(ENG_SRC));
  check('D4 买入成功点双保险（策略买+手工买两处 _resetGmgnEntryFor）',
      (ENG_SRC.match(/this\._resetGmgnEntryFor\(tokenAddress\)/g) || []).length === 2);
  check('D5 回测零接线（BacktestEngine 无 gmgnEntry 引用=因子恒 null 时序穿越防线）',
    !/gmgnEntry/i.test(BT_SRC));
  check('D6 FactorBuilder 快照透传五键',
    ['gmgnEntryChecked', 'gmgnEntryPresent', 'gmgnEntrySmartWallets',
      'gmgnEntryWhaleWallets', 'gmgnEntryRenownedWallets']
      .every(k => FB_SRC.includes(`${k}: factorResults.`)));
  const d7 = new ConditionEvaluator().validateCondition(
    new ConditionEvaluator().parseCondition(SELL_COND), keys);
  check('D7 卖臂条件过三防线（FA 因子域校验 valid 且 errors 空）',
    d7 && d7.valid === true && d7.errors.length === 0,
    JSON.stringify(d7 && d7.errors));
  check('D8 FA 投影 unknown 刻意不投影语义在源码（引擎 unknown return 不 set）',
    /if \(res\.state === 'unknown'\) return; \/\/ fail-open：不投影，retryIntervalMs 后重试/.test(ENG_SRC));
  check('D9 FA 模块级单例 Map 母版对齐（_gmgnEntryOverrides 声明+三访问器）',
    /let _gmgnEntryOverrides = null;/.test(FA_SRC)
      && /static setGmgnEntryFactors/.test(FA_SRC)
      && /static clearGmgnEntryFactors/.test(FA_SRC));
  check('D10 T116b 买点观察双挂点（策略买+手工买两处 _recordGmgnEntryBuyObs）',
    (ENG_SRC.match(/this\._recordGmgnEntryBuyObs\(signalId, tokenAddress\)/g) || []).length === 2);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
