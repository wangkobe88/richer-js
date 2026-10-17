#!/usr/bin/env node
/**
 * 买腿第三层 GMGN 条件（FAKER 0xc6ee6bd2049e5643a2283def7a79b2e68bb07777
 * 团伙盘案，2026-10-14 用户裁定）——本地零 DB 零网络单测
 *
 * 三层买腿条件：触发（fire + narrativeCallCondition）→ 预检查（preBuy/repeat）
 * → GMGN（gmgnCheckCondition）。第三层因子在前两层全过后才构建（=此时才真调
 * GMGN getTokenInfo）；fail-closed：调不到数据=拒买，机制硬保证。
 *
 *   A. evaluateFactors 纯评估：FAKER 事故现场反证（bundler 7/8=87.5>75 拒）/
 *      阈值内过 / covered=0 fail-closed / 空条件
 *   B. service check()：成功映射 / 未索引 / API 错 / 无 key；inflight join /
 *      TTL 复用 / TTL=0 每次硬调 / 失败冷却
 *   C. BacktestEngine 挂点（prototype.call(stub)）：快照口径拒/过、直调未触发
 *      → no_data 拒、无 gmgnCheckCondition 零调用（存量兼容）、拒买 metadata 轨迹
 *   D. 实时引擎源码口径：挂点顺序（预检查拒买 return 后、processSignal 前）、
 *      两路径 metadata、构造点配置接线
 *   E. 校验链：loadStrategies 第四键集 unknown throw / validateLegs 同口径 /
 *      不传集跳过（存量兼容）
 *   F. FAKER 端到端反证：直调快照真值（bundler 7/top 8）→ mapGmgnRiskFactors
 *      → evaluateFactors 拒——事故现场锁防线
 *
 * 用法：node scripts/_test_gmgn_check_layer.cjs
 */

'use strict';

// ── 打桩准备：先污染 gmgn-api 模块再加载 service（惰性 require 拿 stub）──
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

const { GmgnRiskCheckService, GMGN_CONDITION_FACTOR_KEYS } =
  require('../src/trading-engine/pre-check/GmgnRiskCheckService');
const { mapGmgnRiskFactors } = require('../src/trading-engine/pre-check/NarrativeDirectCaller');
const { StrategyEngine } = require('../src/strategies/StrategyEngine');
const { validateLegs } = require('../src/web/services/StrategyLibraryService');
const { BacktestEngine } = require('../src/trading-engine/implementations/BacktestEngine');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${detail ? ` | ${detail}` : ''}`); }
}

// FAKER 0xc6ee…7777 直调快照真值（signal 5992f358 narrativeCall.gmgnRisk，2026-10-14 13:59:56）
const FAKER_RISK = {
  fundFrom: null, topWallets: 8, freshWallets: 1, imageDupCount: 3,
  sniperWallets: 7, bundlerWallets: 7,
  creatorAddress: '0xe2617c0f3ce660e5ef5f592e99aa3ca179637b09',
  issuerTokenCount: 0, creatorTokenStatus: 'creator_hold',
};
// GMGN getTokenInfo 响应形状（extractGmgnRisk 消费层）
const FAKER_INFO = {
  dev: { twitter_create_token_count: 0, creator_address: FAKER_RISK.creatorAddress,
    creator_token_status: 'creator_hold', fund_from: null },
  wallet_tags_stat: { bundler_wallets: 7, top_wallets: 8, sniper_wallets: 7, fresh_wallets: 1 },
  image_dup_count: 3,
  visiting_count: 3,
};

const savedKey = process.env.GMGN_API_KEY;
async function withKey(fn) {
  process.env.GMGN_API_KEY = 'test-key';
  try { return await fn(); } finally {
    if (savedKey === undefined) delete process.env.GMGN_API_KEY;
    else process.env.GMGN_API_KEY = savedKey;
  }
}

function freshSvc(config = {}) { return new GmgnRiskCheckService(config, { info() {}, warn() {}, error() {} }); }

// Nightshift 案分档门条件串（2026-10-17 用户裁定终稿形状，A/C 段共用）：
// 适用集内 issuerTokenCount<=1，IS NULL 臂保 null 放行，bundler 现行门并联前置
const NS_COND = 'gmgnBundlerWalletRatio <= 75 AND ((narrativeCategory IS NULL OR '
  + "(narrativeCategory != 'project' AND narrativeCategory != 'account_based_meme' "
  + "AND narrativeCategory != 'web3_native_ip_early' AND narrativeCategory != 'event:W')) "
  + 'OR gmgnIssuerTokenCount <= 1)';

async function main() {
  console.log('A. evaluateFactors 纯评估');
  {
    const verdict87 = GmgnRiskCheckService.evaluateFactors(
      { gmgnRiskCovered: 1, gmgnIssuerTokenCount: 0, gmgnBundlerWalletRatio: 87.5 },
      'gmgnBundlerWalletRatio <= 75');
    check('FAKER 87.5 > 75 → 拒', verdict87.passed === false && verdict87.evaluated === true, JSON.stringify(verdict87));

    const verdict60 = GmgnRiskCheckService.evaluateFactors(
      { gmgnRiskCovered: 1, gmgnIssuerTokenCount: 0, gmgnBundlerWalletRatio: 60 },
      'gmgnBundlerWalletRatio <= 75');
    check('60 <= 75 → 过', verdict60.passed === true, JSON.stringify(verdict60));

    const noData = GmgnRiskCheckService.evaluateFactors(
      { gmgnRiskCovered: 0, gmgnIssuerTokenCount: 0, gmgnBundlerWalletRatio: 0, failReason: 'error: timeout' },
      'gmgnBundlerWalletRatio <= 75');
    check('covered=0 → fail-closed 拒（不评估表达式）',
      noData.passed === false && noData.evaluated === false && noData.reason.includes('no_data') && noData.reason.includes('timeout'),
      JSON.stringify(noData));

    const noCond = GmgnRiskCheckService.evaluateFactors({ gmgnRiskCovered: 1 }, '');
    check('空条件 → passed 且 evaluated=false', noCond.passed === true && noCond.evaluated === false);

    const unknownKey = GmgnRiskCheckService.evaluateFactors(
      { gmgnRiskCovered: 1, gmgnBundlerWalletRatio: 0 }, 'bundlerWalletRatio <= 75');
    check('未知因子（键集外）→ 评估 false → 拒（fail-closed 方向）',
      unknownKey.passed === false && unknownKey.evaluated === true, JSON.stringify(unknownKey));

    // gmgnVisitingCount（2026-10-15 加键：「流动性跟注意力背离」观测，用户裁定）
    const visit4 = GmgnRiskCheckService.evaluateFactors(
      { gmgnRiskCovered: 1, gmgnIssuerTokenCount: 0, gmgnBundlerWalletRatio: 0, gmgnVisitingCount: 4 },
      'gmgnVisitingCount >= 1');
    check('visiting=4 → 注意力门过', visit4.passed === true && visit4.evaluated === true, JSON.stringify(visit4));
    const visit0 = GmgnRiskCheckService.evaluateFactors(
      { gmgnRiskCovered: 1, gmgnIssuerTokenCount: 0, gmgnBundlerWalletRatio: 0, gmgnVisitingCount: 0 },
      'gmgnVisitingCount >= 1');
    check('visiting=0（无人看）→ 注意力门拦', visit0.passed === false, JSON.stringify(visit0));

    check('键集=固定五键（含 gmgnVisitingCount + narrativeCategory）',
      JSON.stringify(GmgnRiskCheckService.getConditionFactorKeys()) === JSON.stringify(GMGN_CONDITION_FACTOR_KEYS)
      && GMGN_CONDITION_FACTOR_KEYS.includes('gmgnBundlerWalletRatio')
      && GMGN_CONDITION_FACTOR_KEYS.includes('gmgnVisitingCount')
      && GMGN_CONDITION_FACTOR_KEYS.includes('narrativeCategory'));

    // ── Nightshift 案分档门（2026-10-17 用户裁定）：叙事类型 × issuerTokenCount ──
    // 适用集 {project, account_based_meme, web3_native_ip_early, event:W} 内发币数
    // 须 <=1；事件/梗/名人类（event:A-E/F/G）不适用；null（未分类/legacy）放行
    // fail-open。IS NULL 前置臂是 null 放行的必要条件——ConditionEvaluator 对左值
    // null 的任何比较（含 !=）恒 false，裸 != 链在 null+issuer>1 时误拒
    const nsEval = (category, issuer, bundler = 30.3) => GmgnRiskCheckService.evaluateFactors(
      { gmgnRiskCovered: 1, gmgnIssuerTokenCount: issuer, gmgnBundlerWalletRatio: bundler,
        narrativeCategory: category }, NS_COND).passed;
    check('Nightshift 反证：project+issuer=6+bundler=30.3 → 拒（0x3ff9…ffff 事故现场：serial issuer 拦截面）',
      nsEval('project', 6) === false);
    check('project+issuer=0 → 放（fire 时 GMGN 索引未填充 fail-open，用户裁定）',
      nsEval('project', 0) === true);
    check('account_based_meme+issuer=2 → 拒（适用集第二类）',
      nsEval('account_based_meme', 2) === false);
    check('web3_native_ip_early+issuer=2 → 拒（适用集第三类——W3 原生项目早期）',
      nsEval('web3_native_ip_early', 2) === false);
    check('event:W+issuer=3 → 拒（适用集第四类——同一项目号被反复发盘同样可疑）',
      nsEval('event:W', 3) === false);
    check('event:C+issuer=6 → 放（事件类不适用——事件源账号被多方蹭发多币是常态）',
      nsEval('event:C', 6) === true);
    check('event:A+issuer=6+bundler=87.5 → 拒（bundler 现行门不受新臂影响）',
      nsEval('event:A', 6, 87.5) === false);
    check('适用集内 issuer=1 → 放（首币合规）',
      nsEval('project', 1) === true);
    const nsNullPass = nsEval(null, 6);
    check('null+issuer=6 → 放（未分类/legacy 腿 IS NULL 臂 fail-open）', nsNullPass === true);
    // ★锁死防线：剥掉 IS NULL 臂的旧形状在 null+issuer>1 处=拒（null 短路误拒事故
    // 形状反证——防未来把条件串「简化」回裸 != 链）
    const noNullArmCond = 'gmgnBundlerWalletRatio <= 75 AND ((narrativeCategory != \'project\' '
      + "AND narrativeCategory != 'account_based_meme' AND narrativeCategory != 'web3_native_ip_early' "
      + "AND narrativeCategory != 'event:W') OR gmgnIssuerTokenCount <= 1)";
    const noNullArm = GmgnRiskCheckService.evaluateFactors(
      { gmgnRiskCovered: 1, gmgnIssuerTokenCount: 6, gmgnBundlerWalletRatio: 30.3,
        narrativeCategory: null }, noNullArmCond).passed;
    check('反证：无 IS NULL 臂的形状在 null+6 处=拒（ConditionEvaluator null 短路——IS NULL 臂不可省）',
      noNullArm === false);
  }

  console.log('B. service check()（打桩 GMGNTokenAPI，零网络）');
  await withKey(async () => {
    // 成功映射（FAKER 形状 7/8=87.5）
    {
      apiCalls.length = 0; stubBehavior = { response: FAKER_INFO };
      const r = await freshSvc().check('0xABC', 'bsc');
      check('成功 → covered=1 bundler=87.5 visiting=3（mapGmgnRiskFactors 单点映射）',
        r.covered === 1 && r.gmgnBundlerWalletRatio === 87.5 && r.gmgnRiskCovered === 1 && r.gmgnVisitingCount === 3 && r.failReason === null,
        JSON.stringify(r));
    }
    // 未索引（info 无 dev/tags → extractGmgnRisk null）
    {
      stubBehavior = { response: {} };
      const r = await freshSvc().check('0xABC', 'bsc');
      check('未索引 → covered=0 not_indexed', r.covered === 0 && r.failReason === 'not_indexed', JSON.stringify(r));
    }
    // 仅 visiting_count 有值（dev/tags 全缺）：covered 语义零漂移防线——注意力计数
    // 不参与 hasAny，「仅注意力可观测」的票不得翻 covered=1（否则 issuerCount=0 /
    // ratio=0 的 0 值会被当作可信数据消费）
    {
      stubBehavior = { response: { visiting_count: 5 } };
      const r = await freshSvc().check('0xVISITONLY', 'bsc');
      check('仅 visiting_count 有值 → 仍 not_indexed（covered 语义防漂移）',
        r.covered === 0 && r.failReason === 'not_indexed', JSON.stringify(r));
    }
    // API 抛错
    {
      stubBehavior = { error: new Error('rate limit') };
      const r = await freshSvc().check('0xABC', 'bsc');
      check('API 错 → covered=0 error（不抛出）', r.covered === 0 && String(r.failReason).includes('error'), JSON.stringify(r));
    }
    // inflight join：并发同 token 合一次请求
    {
      apiCalls.length = 0; stubBehavior = { response: FAKER_INFO };
      const svc = freshSvc();
      const [a, b] = await Promise.all([svc.check('0xJOIN', 'bsc'), svc.check('0xjoin', 'bsc')]);
      check('并发 join → getTokenInfo 恰 1 次（大小写同 token）',
        apiCalls.length === 1 && a.covered === 1 && b.covered === 1, `calls=${apiCalls.length}`);
    }
    // TTL 复用 / TTL=0 每次硬调
    {
      apiCalls.length = 0; stubBehavior = { response: FAKER_INFO };
      const svc = freshSvc({ perTokenTtlMs: 60000 });
      await svc.check('0xTTL', 'bsc');
      const r2 = await svc.check('0xTTL', 'bsc');
      check('TTL 内复用 → 第 2 次 fromCache 且零新调用', apiCalls.length === 1 && r2.fromCache === true, `calls=${apiCalls.length}`);
    }
    {
      apiCalls.length = 0; stubBehavior = { response: FAKER_INFO };
      const svc = freshSvc({ perTokenTtlMs: 0 });
      await svc.check('0xHARD', 'bsc');
      await svc.check('0xHARD', 'bsc');
      check('perTokenTtlMs=0 → 每次硬调（字面「每次都调」）', apiCalls.length === 2, `calls=${apiCalls.length}`);
    }
    // 失败冷却：冷却期内不重打；到期重试
    {
      apiCalls.length = 0; stubBehavior = { error: new Error('boom') };
      const svc = freshSvc({ failCooldownMs: 60000 });
      await svc.check('0xCD', 'bsc');
      const r2 = await svc.check('0xCD', 'bsc');
      check('失败冷却期内 → covered=0 cooldown 且不重打', apiCalls.length === 1 && r2.failReason === 'cooldown', `calls=${apiCalls.length} r=${JSON.stringify(r2)}`);
      const svc2 = freshSvc({ failCooldownMs: 0 });
      const rFail = await svc2.check('0xCD3', 'bsc'); // stubBehavior 仍=boom → 失败进 svc2 cache
      stubBehavior = { response: FAKER_INFO };
      const r4 = await svc2.check('0xCD3', 'bsc');
      check('failCooldownMs=0 → 失败后立即重试成功翻正',
        rFail.covered === 0 && r4.covered === 1 && r4.gmgnBundlerWalletRatio === 87.5,
        `rFail=${JSON.stringify(rFail)} r4=${JSON.stringify(r4)}`);
    }
    // checkAndEvaluate 拼装
    {
      apiCalls.length = 0; stubBehavior = { response: FAKER_INFO };
      const v = await freshSvc().checkAndEvaluate('0xCE', 'bsc', 'gmgnBundlerWalletRatio <= 75');
      check('checkAndEvaluate：FAKER 形状 → passed=false + factors 携带',
        v.passed === false && v.factors.gmgnBundlerWalletRatio === 87.5 && v.condition === 'gmgnBundlerWalletRatio <= 75',
        JSON.stringify(v));
    }
    // checkAndEvaluate 第四参 narrativeCategory（Nightshift 案 2026-10-17）：合并进
    // context 供条件评估 + factors 返回携带（拒单复盘可见）；缺省 null 同形
    {
      apiCalls.length = 0;
      stubBehavior = { response: { ...FAKER_INFO, dev: { ...FAKER_INFO.dev, twitter_create_token_count: 6 } } };
      const v = await freshSvc().checkAndEvaluate('0xCE2', 'bsc', NS_COND, 'project');
      check('第四参 project + issuer=6 → 拒且 factors.narrativeCategory 留痕',
        v.passed === false && v.factors.narrativeCategory === 'project' && v.factors.gmgnIssuerTokenCount === 6,
        JSON.stringify(v));
      const v2 = await freshSvc().checkAndEvaluate('0xCE3', 'bsc', NS_COND);
      check('缺省第四参 → narrativeCategory=null 进 context（IS NULL 臂放行）',
        v2.factors.narrativeCategory === null, JSON.stringify(v2.factors.narrativeCategory));
    }
  });
  // 无 key
  {
    delete process.env.GMGN_API_KEY;
    const r = await freshSvc().check('0xNOKEY', 'bsc');
    check('GMGN_API_KEY 缺失 → covered=0 no_api_key（fail-closed）', r.covered === 0 && r.failReason === 'no_api_key', JSON.stringify(r));
    if (savedKey !== undefined) process.env.GMGN_API_KEY = savedKey;
  }

  console.log('C. BacktestEngine 挂点（快照口径，不真调 API）');
  {
    const gmgnUpdates = [];
    function makeStub(opts) {
      return {
        _experimentId: 'test-exp',
        _buyingTokens: new Set(),
        _narrativeBlockedTokens: new Set(),
        _shouldBlockOnNarrative: () => false,
        _strategyEngine: {
          evaluate: () => opts.strategy,
          evaluateCondition: () => true,
          getAllStrategies: () => [],
        },
        _tokenPool: {
          initStrategyExecutions: () => {},
          getCurrentRound: () => 0,
          getLastPairReturnRate: () => 0,
        },
        _factorAggregator: { getTokenState: () => null, markBuyFire: () => {}, clearBuyFire: () => {} },
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        _narrativeCaller: {
          async getRating() {
            return Object.assign({
              numericRating: 9, rating: 'unrated', reason: null, fromCache: false,
              durationMs: 1, timedOut: false, error: null,
              sourceTweetId: null, gmgnRisk: opts.gmgnRisk ?? null, precheckStage: null,
            }, opts.ratingOver || {});
          },
        },
        _sameNarrativeLeaderService: { check: async () => { throw new Error('不应触达'); } },
        _preBuyCheckService: null,
        _tokenBlacklist: new Map(),
        _permanentBlockCondition: null,
        _tokenMeta: new Map(),
        _writeBufferEnabled: true,
        _writeBuffer: { signalInserts: 0, addSignalInsert() { this.signalInserts++; } },
        metrics: { totalSignals: 0, executedSignals: 0 },
        _loopCount: 0,
        _calculateBuyAmount: () => 0.1,
        _executeBuy: opts.executeBuy || (async () => ({ success: false, reason: 'stub-no-buy' })),
        _bufferSignalUpdate(id, patch) { gmgnUpdates.push({ id, patch }); },
        // 真实现（与生产同源）：直调快照 → 三键映射
        _mapGmgnRiskFactors: mapGmgnRiskFactors,
      };
    }
    const STRAT = (gmgn) => ({
      id: 'buy_0_1', name: '测试买腿', priority: 1,
      narrativeCallCondition: 'age > 1',
      preBuyCheckCondition: null, repeatBuyCheckCondition: null,
      gmgnCheckCondition: gmgn || null,
    });
    const TOKEN_OBJ = { token: '0xT1', chain: 'bsc', symbol: 'TST', strategyExecutions: { preset: 1 } };
    const runPath = (stub) => BacktestEngine.prototype._evaluateBuyPath.call(
      stub, TOKEN_OBJ, { currentPrice: 1e-6, age: 10 }, { platform: 'fourmeme' }, Date.now());
    // 带 narrativeCategory 的 fire 因子表变体（Nightshift 案：因子表 → GMGN 层透传）
    const runPathCat = (stub, category) => BacktestEngine.prototype._evaluateBuyPath.call(
      stub, TOKEN_OBJ, { currentPrice: 1e-6, age: 10, narrativeCategory: category }, { platform: 'fourmeme' }, Date.now());

    apiCalls.length = 0; stubBehavior = null;

    // C1. 直调快照 FAKER 形状 → 拒
    {
      gmgnUpdates.length = 0;
      const stub = makeStub({ strategy: STRAT('gmgnBundlerWalletRatio <= 75'), gmgnRisk: FAKER_RISK });
      const r = await runPath(stub);
      check('快照 87.5 → 拒 gmgn_check_failed', r.success === false && String(r.reason).includes('gmgn_check_failed'), JSON.stringify(r));
      check('拒买轨迹落 buffer（gmgnCheck metadata + failed）',
        gmgnUpdates.some(u => u.patch?.metadata?.gmgnCheck?.passed === false), JSON.stringify(gmgnUpdates.map(u => u.patch?.metadata?.gmgnCheck)));
    }
    // C2. 直调未触发（gmgnRisk null）→ fail-closed no_data 拒
    {
      const stub = makeStub({ strategy: STRAT('gmgnBundlerWalletRatio <= 75'), gmgnRisk: null });
      const r = await runPath(stub);
      check('直调未拿到 GMGN → 拒 gmgn_check_no_data（fail-closed 同构实时）',
        r.success === false && String(r.reason).includes('gmgn_check_no_data'), JSON.stringify(r));
    }
    // C3. 快照低 bundler → 过层，下单触达
    {
      const lowRisk = { ...FAKER_RISK, bundlerWallets: 3, topWallets: 60 };
      let executed = 0;
      const stub = makeStub({
        strategy: STRAT('gmgnBundlerWalletRatio <= 75'), gmgnRisk: lowRisk,
        executeBuy: async () => { executed++; return { success: false, reason: 'stub-no-buy' }; },
      });
      const r = await runPath(stub);
      check('快照 5.0 → 过层且触达下单（3/60）', executed === 1 && r.reason === 'stub-no-buy', `executed=${executed} r=${JSON.stringify(r)}`);
    }
    // C4. 无 gmgnCheckCondition → 零调用（存量兼容）
    {
      let executed = 0;
      const stub = makeStub({
        strategy: STRAT(null), gmgnRisk: null,
        executeBuy: async () => { executed++; return { success: false, reason: 'stub-no-buy' }; },
      });
      const r = await runPath(stub);
      check('无 gmgnCheckCondition → 不经第三层直达下单', executed === 1 && r.reason === 'stub-no-buy');
    }
    // C4b. 回测 narrativeCategory 透传（Nightshift 案）：fire 因子表 → evaluateFactors
    // spread 同刻同源；快照 issuer=6 + 因子表 project → 拒；因子表 null → 放
    {
      const nsRisk = { ...FAKER_RISK, issuerTokenCount: 6, bundlerWallets: 3, topWallets: 60 };
      const stubP = makeStub({ strategy: STRAT(NS_COND), gmgnRisk: nsRisk });
      const rP = await runPathCat(stubP, 'project');
      check('回测透传：project+issuer=6+bundler 5% → 拒（spread 生效）',
        rP.success === false && String(rP.reason).includes('gmgn_check_failed'), JSON.stringify(rP));
      const stubN = makeStub({ strategy: STRAT(NS_COND), gmgnRisk: nsRisk });
      const rN = await runPathCat(stubN, null);
      check('回测透传：null+issuer=6 → 放（IS NULL 臂 fail-open 同实时）',
        rN.success === false && rN.reason === 'stub-no-buy', JSON.stringify(rN));
    }
    // C5. 回测不真调 API：源码口径
    {
      const fs = require('fs');
      const src = fs.readFileSync('src/trading-engine/implementations/BacktestEngine.js', 'utf8');
      check('源码口径：回测仅静态 evaluateFactors 消费（无 new GmgnRiskCheckService / 无 service 成员 / 无 check 调用）',
        src.includes('GmgnRiskCheckService.evaluateFactors') && !src.includes('new GmgnRiskCheckService') && !src.includes('_gmgnRiskCheckService'));
      check('源码口径：零真实 getTokenInfo 调用（测试全期 apiCalls=0）', apiCalls.length === 0, `calls=${apiCalls.length}`);
    }
  }

  console.log('D. 实时引擎源码口径（FourMemeWssTradingEngine）');
  {
    const fs = require('fs');
    const src = fs.readFileSync('src/trading-engine/implementations/FourMemeWssTradingEngine.js', 'utf8');
    const iPreBuyReject = src.indexOf('预检查失败: ${blockReason}');
    const iGmgnLayer = src.indexOf('第三层：GMGN 条件');
    const iPass = src.indexOf('预检查通过：补全信号元数据后执行');
    const iOrder = src.indexOf('const result = await this.processSignal(signal, signalId)');
    check('挂点顺序：预检查拒买 return → GMGN 层 → 通过路径 metadata → processSignal',
      iPreBuyReject !== -1 && iGmgnLayer > iPreBuyReject && iPass > iGmgnLayer && iOrder > iPass,
      [iPreBuyReject, iGmgnLayer, iPass, iOrder].join(','));
    check('消费点=checkAndEvaluate（service 单点）', src.includes('checkAndEvaluate'));
    check('拒买路径：signal 置 failed + reason 透传', src.includes(`GMGN 条件未过: ${'${gmgnCheckInfo.reason}'}`));
    check('两路径 metadata 均落 gmgnCheck 轨迹', (src.match(/gmgnCheck: gmgnCheckInfo/g) || []).length === 2);
    check('构造点接线 _mergedWsConfig().gmgnCheck',
      src.includes('new GmgnRiskCheckService(\n      this._mergedWsConfig().gmgnCheck') || src.includes("new GmgnRiskCheckService(this._mergedWsConfig().gmgnCheck") || src.includes('new GmgnRiskCheckService(\n'));
    check('实时引擎 loadStrategies 传第四键集（GMGN 四键）',
      src.includes('new Set(_GmgnRiskCheckService.getConditionFactorKeys())'));
    // ★v15 事故现场反证（2026-10-15）：两引擎 _initializeDataSources 的买腿映射是
    // 字段白名单，漏透传 gmgnCheckCondition → 运行时第三层静默跳过、GMGN 门整体
    // 失效（v15 起跑 9h 三笔已执行买入全都没过 GMGN 检查、metadata.gmgnCheck 恒 null）
    const iBuyMap = src.indexOf('strategiesConfig.buyStrategies.forEach');
    const iSellMap = src.indexOf('strategiesConfig.sellStrategies.forEach');
    check('实时引擎买腿映射白名单透传 gmgnCheckCondition（事故现场反证）',
      iBuyMap !== -1 && iSellMap > iBuyMap
      && src.slice(iBuyMap, iSellMap).includes('gmgnCheckCondition: s.gmgnCheckCondition || null'),
      `iBuyMap=${iBuyMap} iSellMap=${iSellMap}`);
    const btsrc = fs.readFileSync('src/trading-engine/implementations/BacktestEngine.js', 'utf8');
    const iBtMap = btsrc.indexOf('.forEach((s, idx) => {');
    check('回测引擎策略映射白名单透传 gmgnCheckCondition（同坑同锁）',
      iBtMap !== -1 && btsrc.slice(iBtMap, iBtMap + 3000).includes('gmgnCheckCondition: s.gmgnCheckCondition || null'),
      `iBtMap=${iBtMap}`);
    // Nightshift 案（2026-10-17）：narrativeCategory 从 fire 因子表透传进 GMGN 层——
    // 与单一买条件同刻同源（防 Pingus 案式两门错位：状态机投影 → FA → fire 因子表）
    check('实时引擎挂点传第四参（fire 因子表 narrativeCategory）',
      /checkAndEvaluate\(\s*token\.token,\s*token\.chain \|\| 'bsc',\s*gmgnCheckCondition,\s*[^)]*factorResults\?\.narrativeCategory/s.test(src),
      '实时引擎 checkAndEvaluate 未透传 factorResults?.narrativeCategory');
    check('回测挂点 spread narrativeCategory（fire 因子表同源）',
      btsrc.includes('narrativeCategory: factorResults?.narrativeCategory ?? null'),
      '回测 evaluateFactors 因子表未 spread narrativeCategory');
  }

  console.log('E. 校验链（未知因子 fail-fast）');
  {
    const se = new StrategyEngine();
    const legs = [{
      id: 'b1', name: 'n', action: 'buy', priority: 1, condition: 'age > 1',
      gmgnCheckCondition: 'gmgnBundlerWalletRatio <= 75',
    }];
    se.loadStrategies(structuredClone(legs), new Set(['age']), new Set(['narrativeRating']), new Set(GMGN_CONDITION_FACTOR_KEYS));
    check('合法 gmgnCheckCondition → 透传进 strategy 对象',
      se.getAllStrategies()[0].gmgnCheckCondition === 'gmgnBundlerWalletRatio <= 75');

    let threw = false;
    try {
      new StrategyEngine().loadStrategies(
        [{ id: 'b1', name: 'n', action: 'buy', priority: 1, condition: 'age > 1',
           gmgnCheckCondition: 'bundlerRatio <= 75' }],
        new Set(['age']), null, new Set(GMGN_CONDITION_FACTOR_KEYS));
    } catch (e) { threw = /gmgnCheckCondition 引用未知因子/.test(e.message); }
    check('未知因子 → throw 拒启', threw);

    const seNoSet = new StrategyEngine();
    seNoSet.loadStrategies(structuredClone(legs), new Set(['age']));
    check('不传第四键集 → 跳过校验（存量调用形状零影响）',
      seNoSet.getAllStrategies()[0].gmgnCheckCondition === 'gmgnBundlerWalletRatio <= 75');

    const bad = validateLegs('buy', [{ ...legs[0] }]);
    check('validateLegs 合法 → valid', bad.valid === true, JSON.stringify(bad));
    const bad2 = validateLegs('buy', [{ ...legs[0], gmgnCheckCondition: 'bundlerRatio <= 75' }]);
    check('validateLegs 未知因子 → invalid（入库 400 同口径）', bad2.valid === false, JSON.stringify(bad2));
  }

  console.log('F. FAKER 端到端反证（直调快照真值 → 新层拒）');
  {
    const factors = mapGmgnRiskFactors(FAKER_RISK);
    const verdict = GmgnRiskCheckService.evaluateFactors(factors, 'gmgnBundlerWalletRatio <= 75');
    check('FAKER 0xc6ee6bd2049e5643a2283def7a79b2e68bb07777：bundler 7/8=87.5 → 新层拒（17 秒 -66% 案锁防线）',
      factors.gmgnBundlerWalletRatio === 87.5 && verdict.passed === false,
      `factors=${JSON.stringify(factors)} verdict=${JSON.stringify(verdict)}`);
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('测试异常:', e); process.exit(1); });
