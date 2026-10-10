#!/usr/bin/env node
/**
 * TokenPositionAnalyzer 单测（pumpfun 回迁批 4；零 DB）
 *
 * 打桩方式（_getClient 遮蔽 + 内存 Map 喂数，_analyze 全链真实代码）：
 *   - tpa._getClient = () => fakeClient（from() 即 throw —— 任何意外 DB 触碰直接炸测试）
 *   - _offlineProfilePreloaded Map（_fetchOfflineProfileBatch 内存路径，真实代码）
 *   - setHistoricalTicks（_fetchWalletTicksBatch 注入索引路径，真实代码）
 *   - _queryTokenProfileChunk 实例覆写（token_profiles 打桩；_fetchTokenProfiles 缓存逻辑真实）
 *   - persistSink 收集（_persist sink 分支在 _getClient 之前，零 DB）
 *   - FA 联动用真实 FourMemeFactorAggregator 实例（registerToken/processTick/buildFactorMap）
 *
 * 覆盖（plan 条目 18）：
 *   1) mergeConfig/构造期 fail-fast：trigger 缺失/双时间门/全无/非数字/负数/zhuangCondition 非法因子
 *   2) checkAndTrigger 门序：blocks 时间门（fail-closed 无块证据）/tradeCount/buyBnb/minHolders + ageSeconds 模式
 *   3) write-once（二次调用 null）+ TRIGGER_NOT_USED 路径 throw + getVerdict pending
 *   4) 三路径分流：fresh(≤data_through 零 tick 查询)/stale(增量 merge)/miss(realtime 全量)
 *   5) _analyze 端到端：17 键齐/walletHoldingPct 分母(totalSupply=0→null)/verdict 双向/
 *      ∞ sanitization/retention 峰值枚举(清仓大户)/approve 冻结 asofMs(幂等)/enforce 落表
 *   6) 防前视 _alignClassifiedAsOf：category_visible_at>asOf → 视为未分类（bad_action 不计）
 *   7) FA 联动：setHoldingFactors→buildFactorMap TPAAnalyzed 0→1、setRetentionBasis→retention 随 tick 重算、
 *      setAsofMs 冻结 asofRelFirst、getFactorKeys 含全部 TPA 键
 *   8) live 缓冲三件套（直连架构 2026-10-09 回迁）：init/ingest 守卫与分组、preload 窗口形状
 *      （-1 关闭/fail-fast/显式分钟/auto 对齐 offline+30min margin+clamp/空表）、id 倒序分页 +
 *      block_time 升序灌入、_fetchWalletTicksBatch 缺口计数（回测路径 inert）、MAX_PAGES 护栏口径
 *   9) wallet 口径（二期 2026-10-10 与画像库同批切）：mkFaState 双 map=_walletNetTokens/
 *      _walletMaxNetTokens；ingestLiveTick 分组键 sender||trader（sender 优先）；现算 SQL
 *      .or() COALESCE 形状（PostgREST 无 COALESCE：旧行 sender NULL 回退 trader）与
 *      _fetchWalletTicksBatch DB 路径按 sender||trader 分组
 *
 * 用法：node scripts/_test_tpa.cjs
 */

const {
    TokenPositionAnalyzer, TRIGGER_NOT_USED, mergeConfig, zhuangScoreGatesToCondition,
} = require('../src/services/TokenPositionAnalyzer');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
const { HOLDING_FACTOR_KEYS, FA_TPA_KEYS } = require('../src/services/tpa-factor-keys');
const { classifyHolder } = require('../src/services/wallet-scorer');

let passed = 0, failed = 0;
const failures = [];
function ok(cond, msg, got) {
    if (cond) { passed++; return; }
    failed++;
    const line = `  ✗ ${msg}${got !== undefined ? ` | got=${typeof got === 'number' ? got : JSON.stringify(got)}` : ''}`;
    failures.push(line);
    console.error(line);
}
function eq(actual, expected, msg) { ok(actual === expected, `${msg}（期望 ${expected}）`, actual); }
function approx(a, b, eps, msg) { ok(Math.abs(a - b) <= eps, `${msg}（期望 ${b}±${eps}）`, a); }

const T0 = 1758500000000;
const QUIET = { info() { }, warn() { }, error() { } };
const TRIGGER = { blocks: 1, tradeCount: 10, buyBnb: 6, minHolders: 4 };
const HOUR = 3600000;

// ─────────── 工厂 ───────────
// offline profile（builder 产出形状；mergeOfflineProfile 哨兵要求 aggregatedTradeCount 在）
function mkOffline(o = {}) {
    return Object.assign({
        tokenCount: 10, rawTotal: 10, tickCount: 100, totalBnb: 80, aggregatedTradeCount: 20,
        avgBnb: 4, buyCount: 60, sellCount: 40, largeTradeCount: 10, effectiveTradeCount: 50,
        badCount14d: 0, earlyLargeBuyCount: 0, crashLargeSellCount: 0, badBuyCount: 0, badSellCount: 0,
        tier2CrashBlockSellCount: 0, tier2Ratio: null,
        buckets: { total: 10, dust: 0, tiny: 0, small: 5, medium: 5, big: 0 },
        dustRatio: 0, lowRatio: 0.5, lowTinyRatio: 0,
        avgHoldSeconds: 100, medianHoldSeconds: 90, firstSeenMs: T0 - 30 * 86400000, badAction: false,
    }, o);
}
// TPA 消费的 wss_price_ticks 行（builder 读 token_address/bnb_amount/price_usd/trade_type/block_time/block_number；
// setHistoricalTicks 索引按 wallet=sender||trader 分组——二期 2026-10-10；sender 缺省 null=旧行回退 trader）
let txSeq = 0;
function wtick(trader, token, btMs, isBuy, bnb, block, sender) {
    return {
        id: ++txSeq, trader_address: trader, sender_address: sender || null, token_address: token,
        trade_type: isBuy ? 'buy' : 'sell', bnb_amount: bnb, price_usd: 1,
        block_time: btMs, block_number: block, tx_hash: '0x' + txSeq.toString(16), log_index: 0,
    };
}
// FA tick（_test_fourmeme_fa_factors.cjs 先例形状）
function faTick(token, ts, isBuy, priceBnb, bnbAmount, trader, block, tokenAmount) {
    return {
        token_address: token, trade_type: isBuy ? 'buy' : 'sell', trader_address: trader,
        price_bnb: priceBnb, price_usd: priceBnb * 600, bnb_amount: bnbAmount, token_amount: tokenAmount,
        block_number: block, timestamp: ts, tx_hash: '0xf' + (++txSeq).toString(16), log_index: 0,
    };
}
// faState（checkAndTrigger/_analyze 消费的字段）。双 map 用 wallet 口径键（二期 2026-10-10：
// TPA 触发门/top20/retention 全链与画像库同批切 sender——GMGN 路由行按真实买家 EOA 归户）
function mkFaState(o = {}) {
    return Object.assign({
        tradeCount: 20, totalBuyBnb: 10, totalBuyTokens: 900, totalSellTokens: 100,
        totalSupply: 1000, firstBlockNumber: 100, firstTickAt: T0, creatorAddress: null,
        _walletNetTokens: new Map([['0xA', 500], ['0xB', 300], ['0xC', 200], ['0xD', 100]]),
        _walletMaxNetTokens: new Map([['0xA', 600], ['0xB', 300], ['0xC', 200], ['0xD', 100]]),
    }, o);
}
const FAKE_CLIENT = { from() { throw new Error('测试禁止触碰 DB'); } };
function ctor(overrides = {}, deps = {}) {
    const tpa = new TokenPositionAnalyzer({ trigger: TRIGGER, ...overrides }, { logger: QUIET, ...deps });
    tpa._getClient = () => FAKE_CLIENT;
    // 内存桩：构造期两 Preloaded Map 是 null，不喂桩则 miss 路径会撞 FAKE_CLIENT。
    // setHistoricalTicks 空数组会置回 null（:470），须给一笔无关钱包 tick 建索引。
    tpa._offlineProfilePreloaded = new Map();
    tpa.setHistoricalTicks([wtick('0xNOPE', 'TOK_NONE', T0 - 60000, true, 0.5, 50)]);
    tpa._queryTokenProfileChunk = async () => new Map();
    return tpa;
}

// ═══════════════ 1. 构造期 fail-fast + mergeConfig ═══════════════
(async () => {
{
    const throws = (fn, needle, msg) => {
        let m = null;
        try { fn(); } catch (e) { m = e.message; }
        ok(m != null && m.includes(needle), msg, m);
    };
    throws(() => new TokenPositionAnalyzer({}, { logger: QUIET }), '缺 tokenPositionAnalyzer.trigger', '无 trigger 段 → 构造期 throw');
    throws(() => new TokenPositionAnalyzer({ trigger: { tradeCount: 10, buyBnb: 6, minHolders: 4 } }, { logger: QUIET }),
        '时间基准门必须恰好提供一个', '无时间门 → throw');
    throws(() => new TokenPositionAnalyzer({ trigger: { blocks: 1, ageSeconds: 5, tradeCount: 10, buyBnb: 6, minHolders: 4 } }, { logger: QUIET }),
        '时间基准门必须恰好提供一个', 'blocks+ageSeconds 并存 → throw');
    throws(() => new TokenPositionAnalyzer({ trigger: { blocks: 'abc', tradeCount: 10, buyBnb: 6, minHolders: 4 } }, { logger: QUIET }),
        '缺失或非法', 'blocks 非数字 → throw');
    throws(() => new TokenPositionAnalyzer({ trigger: { blocks: -1, tradeCount: 10, buyBnb: 6, minHolders: 4 } }, { logger: QUIET }),
        '缺失或非法', 'blocks 负数 → throw');
    throws(() => new TokenPositionAnalyzer({ trigger: TRIGGER, zhuangCondition: 'TPAPre_tokenScor > 2' }, { logger: QUIET }),
        '校验失败', 'zhuangCondition 非法因子名 → 构造期 throw');
    throws(() => new TokenPositionAnalyzer({ trigger: TRIGGER, zhuangCondition: 'TPAPre_tokenScore >' }, { logger: QUIET }),
        '解析失败', 'zhuangCondition 语法错 → 构造期 throw');

    // TRIGGER_NOT_USED：构造 OK，checkAndTrigger 显式 throw
    const web = new TokenPositionAnalyzer({ walletScore: { enabled: true }, trigger: TRIGGER_NOT_USED }, { logger: QUIET });
    eq(web._trigger, null, 'TRIGGER_NOT_USED → _trigger=null');
    throws(() => web.checkAndTrigger('0xT', {}, mkFaState(), { block_number: 101 }, T0), 'trigger 未配置', 'TRIGGER_NOT_USED 调 checkAndTrigger → throw');

    // mergeConfig：zhuangScoreGates 老格式确定性转换 / zhuangCondition 新格式优先 / walletScore 显式 null
    eq(zhuangScoreGatesToCondition({ scoreThr: 3, ratioThr: 0.5 }), 'TPAPre_tokenScore > 3 AND TPAPre_zhuangRetailRatio > 0.5', '老格式→条件串');
    const mc = mergeConfig({ trigger: TRIGGER, zhuangScoreGates: { scoreThr: 3 } });
    eq(mc.zhuangCondition, 'TPAPre_tokenScore > 3 AND TPAPre_zhuangRetailRatio > 0.3', 'zhuangScoreGates 与默认 gates 合并转换');
    eq(mergeConfig({ trigger: TRIGGER, zhuangCondition: 'TPAPre_tokenScore > 1' }).zhuangCondition, 'TPAPre_tokenScore > 1', 'zhuangCondition 新格式优先');
    eq(mergeConfig({ trigger: TRIGGER }).zhuangCondition, 'TPAPre_tokenScore > 2 AND TPAPre_zhuangRetailRatio > 0.3', '默认条件');
    eq(mergeConfig({ trigger: TRIGGER, walletScore: null }).walletScore, null, 'walletScore:null 显式关闭');
    eq(mergeConfig({ trigger: TRIGGER }).enforce, false, 'enforce 默认 false（shadow）');

    // enabled:false → checkAndTrigger 短路 null
    const off = ctor({ enabled: false });
    eq(off.isEnabled(), false, 'isEnabled false');
    eq(off.checkAndTrigger('0xT', {}, mkFaState(), { block_number: 101 }, T0 + 6000), null, 'enabled=false → null 短路');
}

// ═══════════════ 2. checkAndTrigger 门序（手工 faState，_persist 由 experimentId=null 短路）═══════════════
{
    const tpa = ctor();
    const tick = { block_number: 101, block_time: T0 + 6000 };
    const factors = { currentPriceBnb: 0.000000005 };

    eq(tpa.checkAndTrigger('0xT1', factors, mkFaState({ firstBlockNumber: null }), tick, T0 + 6000), null,
        'blocks 门：faState.firstBlockNumber=null 无块证据 → fail-closed 不触发');
    eq(tpa.checkAndTrigger('0xT1', factors, mkFaState(), { block_number: null, block_time: T0 + 6000 }, T0 + 6000), null,
        'blocks 门：tick.block_number=null → fail-closed 不触发');
    eq(tpa.checkAndTrigger('0xT1', factors, mkFaState(), { block_number: 100, block_time: T0 + 6000 }, T0 + 6000), null,
        'blocks 门：blockDiff=0 < 1 → 不触发');
    eq(tpa.checkAndTrigger('0xT1', factors, mkFaState({ tradeCount: 10 }), tick, T0 + 6000), null,
        'tradeCount 门：10 ≤ 10（严格 >）→ 不触发');
    eq(tpa.checkAndTrigger('0xT1', factors, mkFaState({ totalBuyBnb: 6 }), tick, T0 + 6000), null,
        'buyBnb 门：6 ≤ 6 → 不触发');
    eq(tpa.checkAndTrigger('0xT1', factors, mkFaState({ _walletNetTokens: new Map([['0xA', 500], ['0xB', 300], ['0xC', 0], ['0xD', 100]]) }), tick, T0 + 6000), null,
        'minHolders 门：net>0 仅 3 < 4 → 不触发');
    eq(tpa.getVerdict('0xT1').verdict, 'pending', '未触发 → pending');

    // 命中（_analyze 会跑：无 offline/ticks → miss 空画像；experimentId=null → _persist 短路零 DB）
    const p = tpa.checkAndTrigger('0xT1', factors, mkFaState(), tick, T0 + 6000);
    ok(p != null && typeof p.then === 'function', '全门过 → 返回 promise', p);
    await_eq: {
        // 异步等待完成（空 miss 路径无 DB 依赖，直查 _getClient 遮蔽已防外溢）
    }
    // write-once：二次调用 null
    eq(tpa.checkAndTrigger('0xT1', factors, mkFaState(), tick, T0 + 7000), null, 'write-once：同 token 二次 → null');

    // ageSeconds 模式
    const tpa2 = ctor({ trigger: { ageSeconds: 10, tradeCount: 10, buyBnb: 6, minHolders: 4 } });
    eq(tpa2.checkAndTrigger('0xT2', factors, mkFaState(), { block_number: null }, T0 + 9000), null, 'ageSeconds 门：9s ≤ 10 → 不触发');
    const p2 = tpa2.checkAndTrigger('0xT2', factors, mkFaState(), { block_number: null }, T0 + 10001);
    ok(p2 != null, 'ageSeconds 门：>10s → 触发（无 block 证据亦可）', p2);
    await p2;
    await p;
    eq(tpa.getVerdict('0xT1').verdict !== 'pending', true, '触发分析完成后 verdict 非 pending');
}

// ═══════════════ 3. 三路径分流（_fetchAndBuildProfile 直测）═══════════════
{
    const tpa = new TokenPositionAnalyzer({ walletScore: { enabled: true }, trigger: TRIGGER_NOT_USED }, { logger: QUIET });
    tpa._getClient = () => FAKE_CLIENT;
    // 单钱包版 _fetchWalletTicks 只走 DB（batch 版才读 _walletTicksPreloaded 索引）——
    // 覆写为同语义内存过滤（gt since / lt asOf，ms 严格比较，mimic DB 查询）
    tpa._fetchWalletTicks = async (_sup, addr, sinceIso, asOfIso) => {
        const idx = tpa._walletTicksPreloaded;
        if (!idx) throw new Error('单钱包 fetch 桩要求先 setHistoricalTicks');
        const s = new Date(sinceIso).getTime(), a = new Date(asOfIso).getTime();
        return (idx.get(addr) || []).filter(t => {
            const ms = new Date(t.block_time).getTime();
            return ms > s && ms < a;
        });
    };

    const AS_OF = T0 + 6000;
    // offline 表：FRESH（dataThrough ≥ asOf）/ STALE（dataThrough 早 1h）
    tpa._offlineProfilePreloaded = new Map([
        ['0xFRESH', { dataThroughMs: AS_OF, dataThroughIso: new Date(AS_OF).toISOString(), profile: mkOffline({ tickCount: 100, totalBnb: 80 }) }],
        ['0xSTALE', { dataThroughMs: AS_OF - HOUR, dataThroughIso: new Date(AS_OF - HOUR).toISOString(), profile: mkOffline({ tickCount: 100, totalBnb: 80, tokenCount: 5, rawTotal: 5 }) }],
    ]);
    // 注入 ticks：FRESH 窗口内也有 ticks（若误取增量会暴露为 tickCount 变化）；STALE 增量 2 笔；MISS 3 笔（2 token）
    tpa.setHistoricalTicks([
        wtick('0xFRESH', 'TOK_F', AS_OF - 1000, true, 0.5, 90),
        wtick('0xFRESH', 'TOK_F', AS_OF - 500, false, 0.5, 91),
        wtick('0xSTALE', 'TOK_S1', AS_OF - HOUR + 1000, true, 0.6, 80),
        wtick('0xSTALE', 'TOK_S1', AS_OF - HOUR + 2000, true, 0.6, 81),
        wtick('0xFRESH', 'TOK_F', AS_OF - HOUR - 5000, true, 0.5, 70),  // data_through 之前（stale 窗口外）
        wtick('0xMISS', 'TOK_M1', AS_OF - 86400000, true, 0.7, 60),
        wtick('0xMISS', 'TOK_M1', AS_OF - 86300000, false, 0.7, 61),
        wtick('0xMISS', 'TOK_M2', AS_OF - 86200000, true, 0.8, 62),
        wtick('0xMISS', 'TOK_M3', AS_OF - 20 * 86400000, true, 0.9, 50), // lookback(14d) 外 → 不进 miss 窗口
    ]);
    // token_profiles 打桩（全 miss → null；记录被查 token）
    const queried = [];
    tpa._queryTokenProfileChunk = async (batch) => { queried.push(...batch); return new Map(); };

    // fresh：直接用 offline（零 tick 消费）
    const fresh = await tpa._fetchAndBuildProfile('0xFRESH', AS_OF);
    eq(fresh.source, 'offline', 'fresh(≤data_through) → source=offline');
    eq(fresh.tickCount, 100, 'fresh 不消费窗口内 ticks（tickCount 保持 offline 值）');
    eq(fresh.totalBnb, 80, 'fresh totalBnb=offline 值');

    // stale：offline + 增量 merge
    const stale = await tpa._fetchAndBuildProfile('0xSTALE', AS_OF);
    eq(stale.source, 'offline+inc', 'stale(>data_through) → source=offline+inc');
    eq(stale.tickCount, 102, 'stale tickCount=100+2（增量窗口仅 2 笔，data_through 前的 1 笔不计）');
    approx(stale.totalBnb, 81.2, 1e-9, 'stale totalBnb=80+0.6+0.6');
    eq(stale.tokenCount, 5, 'stale tokenCount 用 offline 值（merge 语义）');
    ok(stale.lowLevelBadAction != null, 'stale merge 三特性 lowLevelBadAction 在');
    ok(stale.goodAction != null, 'stale merge 三特性 goodAction 在');
    ok(stale.tinyLevelBadAction != null, 'stale merge 三特性 tinyLevelBadAction 在');

    // miss：realtime 全量 [asOf-14d, asOf]
    const miss = await tpa._fetchAndBuildProfile('0xMISS', AS_OF);
    eq(miss.source, 'realtime', 'miss(无 offline 行) → source=realtime');
    eq(miss.tickCount, 3, 'miss tickCount=窗口内 3 笔（lookback 外 1 笔不计）');
    eq(miss.tokenCount, 2, 'miss tokenCount=distinct 2 token');
    ok(miss.lowLevelBadAction != null, 'miss 三特性 lowLevelBadAction 在');

    // token_profiles 只查了 miss/stale 涉及 token（fresh 无 tick 查询 → 其 token 不查）
    ok(!queried.includes('TOK_F'), 'fresh 路径零 token_profiles 查询', queried);
    ok(queried.includes('TOK_S1') && queried.includes('TOK_M1') && queried.includes('TOK_M2'), 'miss/stale token 均查', queried);

    // TTL 缓存（_computeWalletProfile 包装）：直测 _fetchAndBuildProfile 不写 cache；
    // 三钱包各过一次包装（miss→跑路径→回填）。FRESH 二次调前删掉 offline 行——
    // TTL 命中则不重跑路径（数据源消失仍返回原值 100；未命中会走 miss 路径得 tickCount=2）
    const c1 = await tpa._computeWalletProfile('0xFRESH', AS_OF + 1000);
    eq(c1.tickCount, 100, '_computeWalletProfile 首调（miss→跑 fresh 路径）');
    eq(c1.address, '0xFRESH', 'profile 带 address');
    await tpa._computeWalletProfile('0xSTALE', AS_OF + 1000);
    await tpa._computeWalletProfile('0xMISS', AS_OF + 1000);
    eq(tpa._walletProfileCache.size, 3, 'cache 收录 3 钱包');
    tpa._offlineProfilePreloaded.delete('0xFRESH');
    const cached = await tpa._computeWalletProfile('0xFRESH', AS_OF + 2000);
    eq(cached.tickCount, 100, 'TTL 内二次调用命中 cache（offline 行已删仍返回原值）');
}

// ═══════════════ 4. _analyze 端到端（真实 FA + persistSink + 17 键）═══════════════
{
    const FA = FourMemeFactorAggregator;
    const persisted = [];
    const fa = new FA({});
    const tpa = new TokenPositionAnalyzer({ trigger: TRIGGER }, {
        logger: QUIET, experimentId: 'exp-test', factorAggregator: fa,
        persistSink: (row) => persisted.push(row),
    });
    tpa._getClient = () => FAKE_CLIENT;

    const AS_OF = T0 + 6000;
    const TOK = '0xTOKEN1';
    fa.registerToken(TOK, { createdAtMs: T0 - 1000, totalSupply: 1000, symbol: 'T1' });
    fa.processTick(faTick(TOK, T0, true, 5, 1.0, '0xA', 100, 500), { emitFactors: false });
    fa.processTick(faTick(TOK, T0 + 3000, true, 6, 1.0, '0xB', 101, 100), { emitFactors: false }); // _relPriceBnb=6

    // 画像数据：A=zhuang(lowTiny 0.6)/B=retail(tc300)/C=new_wallet(rawTotal2)/D=neutral + GONE=zhuang 清仓大户
    tpa._offlineProfilePreloaded = new Map([
        ['0xA', { dataThroughMs: AS_OF, dataThroughIso: new Date(AS_OF).toISOString(), profile: mkOffline({ lowTinyRatio: 0.6 }) }],
        ['0xB', { dataThroughMs: AS_OF, dataThroughIso: new Date(AS_OF).toISOString(), profile: mkOffline({ tokenCount: 300, rawTotal: 300 }) }],
        ['0xC', { dataThroughMs: AS_OF, dataThroughIso: new Date(AS_OF).toISOString(), profile: mkOffline({ tokenCount: 2, rawTotal: 2 }) }],
        ['0xD', { dataThroughMs: AS_OF, dataThroughIso: new Date(AS_OF).toISOString(), profile: mkOffline() }],
        ['0xGONE', { dataThroughMs: AS_OF, dataThroughIso: new Date(AS_OF).toISOString(), profile: mkOffline({ lowTinyRatio: 0.6, totalBnb: 3, avgBnb: 0.05 }) }],
    ]);
    // 喂一笔无关钱包 tick 保住内存索引（空数组会置回 null → TOK2/3 asOf>dataThrough 走 stale
    // 增量查询时撞 FAKE_CLIENT）；TOK1 asOf=dataThrough 为 fresh、TOK2/3 stale 增量均为空
    tpa.setHistoricalTicks([wtick('0xNOPE', 'TOK_NONE', T0 - 60000, true, 0.5, 50)]);
    tpa._queryTokenProfileChunk = async () => new Map();

    const faState = mkFaState({
        _walletMaxNetTokens: new Map([['0xA', 600], ['0xB', 300], ['0xC', 200], ['0xD', 100], ['0xGONE', 400]]),
    });
    const tick = { block_number: 101, block_time: AS_OF };
    await tpa.checkAndTrigger(TOK, { currentPriceBnb: 6 }, faState, tick, AS_OF);

    // ── 落表行 ──
    eq(persisted.length, 1, 'persistSink 收到 1 行');
    const row = persisted[0];
    eq(row.experiment_id, 'exp-test', 'experiment_id');
    eq(row.token_address, TOK, 'token_address');
    eq(row.trigger_no, 1, 'trigger_no=1');
    eq(row.as_of, new Date(AS_OF).toISOString(), 'as_of ISO');
    eq(row.verdict, 'approve', 'verdict=approve（tokenScore 4.25>2 且 庄散比 2.334>0.3）');
    eq(row.enforce, false, 'enforce=false（shadow）');
    eq(row.block_reasons.length, 0, 'approve 无 blockReasons');
    eq(row.trigger_snapshot.blockDiff, 1, 'snapshot.blockDiff=1');
    eq(row.trigger_snapshot.tradeCount, 20, 'snapshot.tradeCount');
    approx(row.trigger_snapshot.buyBnb, 10, 1e-9, 'snapshot.buyBnb');
    eq(row.trigger_snapshot.currentPriceBnb, 6, 'snapshot.currentPriceBnb');

    // ── holding_factors 17 键齐（HOLDING_FACTOR_KEYS 全集）──
    const hfKeys = Object.keys(row.holding_factors).sort();
    eq(JSON.stringify(hfKeys), JSON.stringify([...HOLDING_FACTOR_KEYS].sort()), 'holding_factors 键集=HOLDING_FACTOR_KEYS 17 键');

    // ── 因子值 ──
    eq(row.holding_factors.TPAPre_walletHoldingPct, 80, 'walletHoldingPct=(900-100)/1000×100=80');
    approx(row.holding_factors.TPAPre_tokenScore, 4.25, 1e-9, 'tokenScore=4×4.25 floatPct 加权（whp=80≥12 无 lowFloat）');
    approx(row.holding_factors.TPAPre_zhuangPct, 45.45, 0.01, 'zhuangPct=500/1100');
    approx(row.holding_factors.TPAPre_retailPct, 27.27, 0.01, 'retailPct');
    approx(row.holding_factors.TPAPre_newWalletPct, 18.18, 0.01, 'newWalletPct');
    approx(row.holding_factors.TPAPre_zhuangRetailRatio, 2.334, 1e-3, 'zhuangRetailRatio=(45.45+18.18)/27.27');
    eq(row.holding_factors.TPAPre_zhuangRetailRatioInfinite, false, '非∞');
    eq(row.holding_factors.TPAPre_zhuangHolderCount, 4, 'zhuangHolderCount=4（floatPct>0 且有分）');
    ok(row.holding_factors.TPAPre_analyzeDurationMs >= 0, 'analyzeDurationMs 在');
    ok(row.holding_factors.TPAPre_analyzedAgeSec >= 6, 'analyzedAgeSec≥触发年龄 6s');

    // ── FA 回填 ──
    const injected = FA.getHoldingFactors(TOK);
    ok(injected === row.holding_factors || JSON.stringify(injected) === JSON.stringify(row.holding_factors),
        'setHoldingFactors 回填=落表 holding_factors');
    const st = fa.getTokenState(TOK);
    eq(st._asofMs, AS_OF, 'approve → setAsofMs 冻结 asOf');
    eq(st._asofRelFirst, 20, 'asofRelFirst=(6-5)/5×100=20（可靠价链）');

    // ── retention 基准：峰值枚举含清仓大户 GONE ──
    const basis = FA.getRetentionBasis(TOK);
    ok(basis != null, 'setRetentionBasis 已冻结');
    ok(basis.zhuangAddresses.includes('0xA') && basis.zhuangAddresses.includes('0xGONE'),
        '庄集含 A 与清仓大户 GONE（maxNet>0 枚举）', basis.zhuangAddresses);
    eq(basis.netZAtDecision, 1000, 'netZAtDecision=ΣmaxNet(A600+GONE400，峰值非当前净持仓)');
    eq(basis.zhuangAddresses.includes('0xC'), false, 'new_wallet 不进庄集');

    // FA 联动读数：buildFactorMap 出全部 TPA 键
    const f = fa.buildFactorMap(TOK, AS_OF + 1);
    eq(f.TPAAnalyzed, 1, 'TPAAnalyzed=1');
    eq(f.TPAPre_walletHoldingPct, 80, 'factorMap 读 holdingCache whp');
    approx(f.TPAPre_tokenScore, 4.25, 1e-9, 'factorMap 读 tokenScore');
    eq(f.TPAPre_asofRelFirst, 20, 'factorMap TPAPre_asofRelFirst=20');
    approx(f.TPAPre_retention, 0.5, 1e-9, 'retention=netZ@T/netZ@D=(500+0)/1000（FA running netTokens 里 GONE 无 tick=0，触发即反映清仓）');
    // A 卖 300 → 净 200 → retention=(200+0)/1000=0.2（随 tick 重算）
    fa.processTick(faTick(TOK, AS_OF + 4000, false, 6, 1.0, '0xA', 102, 300), { emitFactors: false });
    const f2 = fa.buildFactorMap(TOK, AS_OF + 5000);
    approx(f2.TPAPre_retention, 0.2, 1e-9, 'retention 随 tick 重算（A 减仓）');
    eq(f2.TPAAnalyzed, 1, 'TPAAnalyzed 保持 1');

    // setAsofMs 幂等（再调不重算 relFirst）
    fa.setAsofMs(TOK, AS_OF + 9000);
    fa.processTick(faTick(TOK, AS_OF + 9500, true, 12, 1.0, '0xB', 103, 50), { emitFactors: false });
    eq(fa.buildFactorMap(TOK, AS_OF + 9600).TPAPre_asofRelFirst, 20, 'asofRelFirst 幂等冻结（价走 12 不漂移）');

    // getVerdict 缓存
    eq(tpa.getVerdict(TOK).verdict, 'approve', 'getVerdict approve');
    eq(tpa.getVerdict(TOK).factors.TPAPre_tokenScore, row.holding_factors.TPAPre_tokenScore, 'getVerdict factors 同源');
    eq(tpa.getStats().analyzedCount, 1, 'getStats analyzedCount');

    // ── block 方向 + walletHoldingPct null 分母（totalSupply=0）──
    // ★钱包画像是钱包属性：同实例跨 token 共享 _walletProfileCache（TTL 10min）——
    // TOK1 已缓存 A/B/C/D 的 4.25 分画像，此处须 clear 才能喂入低分画像（跨 token 复用是设计行为）
    tpa._walletProfileCache.clear();
    const TOK2 = '0xTOKEN2';
    fa.registerToken(TOK2, { createdAtMs: T0 - 1000, totalSupply: 1e9, symbol: 'T2' });
    tpa._offlineProfilePreloaded = new Map([
        ['0xA', { dataThroughMs: AS_OF, dataThroughIso: new Date(AS_OF).toISOString(), profile: mkOffline({ totalBnb: 0, avgBnb: 0 }) }],
        ['0xB', { dataThroughMs: AS_OF, dataThroughIso: new Date(AS_OF).toISOString(), profile: mkOffline({ tokenCount: 300, rawTotal: 300, totalBnb: 0, avgBnb: 0 }) }],
        ['0xC', { dataThroughMs: AS_OF, dataThroughIso: new Date(AS_OF).toISOString(), profile: mkOffline({ tokenCount: 2, rawTotal: 2, totalBnb: 0, avgBnb: 0 }) }],
        ['0xD', { dataThroughMs: AS_OF, dataThroughIso: new Date(AS_OF).toISOString(), profile: mkOffline({ totalBnb: 0, avgBnb: 0 }) }],
    ]);
    await tpa.checkAndTrigger(TOK2, { currentPriceBnb: 1 }, mkFaState({ totalSupply: 0, firstBlockNumber: 100 }), { block_number: 105, block_time: AS_OF + 1000 }, AS_OF + 1000);
    const row2 = persisted[1];
    eq(row2.verdict, 'block', '低分 → verdict=block');
    eq(row2.holding_factors.TPAPre_walletHoldingPct, null, 'totalSupply=0 → walletHoldingPct=null fail-closed');
    ok(row2.block_reasons.some(r => String(r).includes('TPAPre_tokenScore > 2')), 'blockReasons 自描述（tokenScore 未过）', row2.block_reasons);
    // null 因子 fail-closed：whp=null 且 tokenScore≈0.25 → 条件 false
    approx(row2.holding_factors.TPAPre_tokenScore, 0.25, 1e-9, 'tokenScore≈0.25（空画像仅 hold flat）');

    // ── ∞ sanitization：无 retail → ratio=null + Infinite=true（0xE 凑 minHolders=4，neutral 不影响）──
    tpa._walletProfileCache.clear(); // 同上：隔离 TOK2 喂入的 0.25 分缓存
    const TOK3 = '0xTOKEN3';
    fa.registerToken(TOK3, { createdAtMs: T0 - 1000, totalSupply: 1000, symbol: 'T3' });
    tpa._offlineProfilePreloaded = new Map([
        ['0xA', { dataThroughMs: AS_OF, dataThroughIso: new Date(AS_OF).toISOString(), profile: mkOffline({ lowTinyRatio: 0.6 }) }],
        ['0xC', { dataThroughMs: AS_OF, dataThroughIso: new Date(AS_OF).toISOString(), profile: mkOffline({ tokenCount: 2, rawTotal: 2 }) }],
        ['0xD', { dataThroughMs: AS_OF, dataThroughIso: new Date(AS_OF).toISOString(), profile: mkOffline({ lowTinyRatio: 0.7 }) }],
        ['0xE', { dataThroughMs: AS_OF, dataThroughIso: new Date(AS_OF).toISOString(), profile: mkOffline() }],
    ]);
    await tpa.checkAndTrigger(TOK3, { currentPriceBnb: 1 }, mkFaState({
        _walletNetTokens: new Map([['0xA', 500], ['0xC', 200], ['0xD', 100], ['0xE', 50]]),
        _walletMaxNetTokens: new Map([['0xA', 600], ['0xC', 200], ['0xD', 100], ['0xE', 50]]),
    }), { block_number: 106, block_time: AS_OF + 2000 }, AS_OF + 2000);
    const row3 = persisted[2];
    eq(row3.holding_factors.TPAPre_retailPct, 0, 'retailPct=0');
    eq(row3.holding_factors.TPAPre_zhuangRetailRatio, null, '∞ → ratio 落 null（JSON sanitization）');
    eq(row3.holding_factors.TPAPre_zhuangRetailRatioInfinite, true, '∞ → Infinite=true 标记');
    eq(row3.verdict, 'approve', '∞ 视为满足 ratio 门（tokenScore 4.25>2）→ approve');
    ok(JSON.stringify(row3).indexOf('Infinity') === -1, '落表 JSON 无裸 Infinity');

    // destroy
    tpa.destroy();
    eq(tpa.isEnabled(), false, 'destroy 后 disabled');
}

// ═══════════════ 5. 防前视 _alignClassifiedAsOf ═══════════════
{
    const mk = (align) => {
        const t = new TokenPositionAnalyzer({ walletScore: { enabled: true }, trigger: TRIGGER_NOT_USED },
            { logger: QUIET, alignClassifiedAsOf: align });
        t._getClient = () => FAKE_CLIENT;
        return t;
    };
    const AS_OF = T0 + 100000;
    // TOK_W：wash + firstTickTime=T0；early bad buy（age 1s、1.5 BNB）
    const ticks = [wtick('0xBAD', 'TOK_W', T0 + 1000, true, 1.5, 10)];
    const dbRow = (visibleAtMs) => ({
        token_address: 'TOK_W', category: 'wash',
        classified_at: new Date(T0 + 50000).toISOString(),
        category_visible_at: visibleAtMs != null ? new Date(visibleAtMs).toISOString() : null,
        profile: { category: 'wash', first_tick_time: T0, flash_crash_period: null, violent_crash_blocks: [] },
    });

    // 未对齐（live/web 默认）：分类可见即用 → badBuy 计入
    const t1 = mk(false);
    t1._queryTokenProfileChunk = async () => new Map([['TOK_W', dbRow(AS_OF + 999999)]]);
    const p1 = await t1._buildProfileFromTicks(ticks, null, AS_OF);
    eq(p1.badBuyCount, 1, 'align=false：事后分类仍计 bad_buy');

    // 对齐（回测）：category_visible_at > asOf → 视为未分类 → 不计
    const t2 = mk(true);
    t2._queryTokenProfileChunk = async () => new Map([['TOK_W', dbRow(AS_OF + 1)]]);
    const p2 = await t2._buildProfileFromTicks(ticks, null, AS_OF);
    eq(p2.badBuyCount, 0, 'align=true：可见时刻晚于 asOf → 不计 bad_buy（防前视）');

    // 可见时刻早于 asOf → 正常计
    const t3 = mk(true);
    t3._queryTokenProfileChunk = async () => new Map([['TOK_W', dbRow(AS_OF - 1)]]);
    const p3 = await t3._buildProfileFromTicks(ticks, null, AS_OF);
    eq(p3.badBuyCount, 1, 'align=true：可见时刻≤asOf → 正常计');

    // 老数据无 category_visible_at → 回退 classified_at 判（classified_at=T0+50s < asOf=T0+100s → 可见 → 计入）
    const t4 = mk(true);
    t4._queryTokenProfileChunk = async () => new Map([['TOK_W', dbRow(null)]]);
    const p4 = await t4._buildProfileFromTicks(ticks, null, AS_OF);
    eq(p4.badBuyCount, 1, '无 category_visible_at 回退 classified_at 早于 asOf → 计入');
}

// ═══════════════ 6. FA 联动（独立 token，静态注入直测 + getFactorKeys）═══════════════
{
    const FA = FourMemeFactorAggregator;
    const fa = new FA({});
    const TOK = '0xTFA';
    fa.registerToken(TOK, { createdAtMs: T0 - 1000, totalSupply: 1e6, symbol: 'TF' });
    fa.processTick(faTick(TOK, T0, true, 10, 1.0, '0xA', 100, 500), { emitFactors: false });

    // 触发前：TPAAnalyzed=0、retention/asofRelFirst null（fail-closed）
    const f0 = fa.buildFactorMap(TOK, T0 + 1000);
    eq(f0.TPAAnalyzed, 0, '触发前 TPAAnalyzed=0');
    eq(f0.TPAPre_retention, null, '触发前 retention=null');
    eq(f0.TPAPre_asofRelFirst, null, '触发前 asofRelFirst=null');
    eq(f0.TPAPre_walletHoldingPct, undefined, '触发前 holdingCache 键不出现（spread 空注入）');

    // setHoldingFactors 后：TPAAnalyzed 0→1 + spread 键可读
    FA.setHoldingFactors(TOK, { TPAPre_walletHoldingPct: 12.5, TPAPre_tokenScore: 3.3 });
    const f1 = fa.buildFactorMap(TOK, T0 + 2000);
    eq(f1.TPAAnalyzed, 1, 'setHoldingFactors 后 TPAAnalyzed=1');
    eq(f1.TPAPre_walletHoldingPct, 12.5, 'factorMap 读注入 whp');
    eq(f1.TPAPre_tokenScore, 3.3, 'factorMap 读注入 tokenScore');

    // setRetentionBasis 后 retention 随 tick 重算
    FA.setRetentionBasis(TOK, { zhuangAddresses: ['0xA'], netZAtDecision: 500 });
    eq(fa.buildFactorMap(TOK, T0 + 3000).TPAPre_retention, 1, 'retention=500/500=1');
    fa.processTick(faTick(TOK, T0 + 4000, false, 10, 1.0, '0xA', 101, 200), { emitFactors: false });
    eq(fa.buildFactorMap(TOK, T0 + 5000).TPAPre_retention, 0.6, 'A 减仓 300 → retention=0.6');
    // 庄集清空（全卖）→ 0 而非 null（zhuangAddresses 非空）
    fa.processTick(faTick(TOK, T0 + 6000, false, 10, 1.0, '0xA', 102, 300), { emitFactors: false });
    eq(fa.buildFactorMap(TOK, T0 + 7000).TPAPre_retention, 0, '庄集清空 → retention=0（走没走实锤）');

    // getFactorKeys 含全部 TPA 键（17+3，Set 去重）
    const keys = fa.getFactorKeys();
    for (const k of [...HOLDING_FACTOR_KEYS, ...FA_TPA_KEYS]) {
        ok(keys.has(k), `getFactorKeys 含 ${k}`);
    }
}

// ═══════════════ 7. 买信号 TPA 快照（buildTpaFactorSnapshot；signals 页复盘用）═══════════════
{
    const { buildTpaFactorSnapshot } = require('../src/trading-engine/core/FactorBuilder');
    const FA = FourMemeFactorAggregator;
    const fa = new FA({});
    const TOK = '0xTSNAP';
    fa.registerToken(TOK, { createdAtMs: T0 - 1000, totalSupply: 1e6, symbol: 'TS' });
    fa.processTick(faTick(TOK, T0, true, 10, 1.0, '0xA', 100, 500), { emitFactors: false });

    // 触发前：fire 时刻 factorMap 无 TPA 注入 → 快照全 null（显式未就绪，不掩盖），
    // 但键集完整（HOLDING_FACTOR_KEYS + FA_TPA_KEYS 全集，前端按键渲染不缺列）
    const f0 = fa.buildFactorMap(TOK, T0 + 500) || {};
    const s0 = buildTpaFactorSnapshot(f0);
    const expectedKeys = [...HOLDING_FACTOR_KEYS, ...FA_TPA_KEYS];
    eq(Object.keys(s0).length, expectedKeys.length, '快照键数 = TPA 键清单全集');
    for (const k of expectedKeys) ok(k in s0, `快照含键 ${k}`);
    eq(s0.TPAAnalyzed, 0, '触发前快照 TPAAnalyzed=0');
    eq(s0.TPAPre_tokenScore, null, '触发前快照 tokenScore=null（undefined 显式化）');
    eq(s0.TPAPre_walletHoldingPct, null, '触发前快照 whp=null');

    // 触发后：fire 时刻注入值原样进快照（买腿 condition 用的同一份因子）
    FA.setHoldingFactors(TOK, {
        TPAPre_walletHoldingPct: 12.5, TPAPre_tokenScore: 3.482,
        TPAPre_zhuangRetailRatio: 29.387, TPAPre_zhuangRetailRatioInfinite: false,
    });
    FA.setRetentionBasis(TOK, { zhuangAddresses: ['0xA'], netZAtDecision: 500 });
    const f1 = fa.buildFactorMap(TOK, T0 + 1000) || {};
    const s1 = buildTpaFactorSnapshot(f1);
    eq(s1.TPAAnalyzed, 1, '触发后快照 TPAAnalyzed=1');
    eq(s1.TPAPre_tokenScore, 3.482, '快照读注入 tokenScore');
    eq(s1.TPAPre_zhuangRetailRatio, 29.387, '快照读注入庄散比');
    eq(s1.TPAPre_walletHoldingPct, 12.5, '快照读注入 whp');
    eq(s1.TPAPre_retention, 1, '快照读 FA retention');

    // 输入 null/空对象防御：不 throw，全键 null
    const s2 = buildTpaFactorSnapshot(null);
    eq(s2.TPAPre_tokenScore, null, 'null 输入 → 全 null 不炸');
    eq(Object.keys(s2).length, expectedKeys.length, 'null 输入键集仍完整');
}

// ═══════════════ 8. live 缓冲三件套（initLiveTicksBuffer / ingestLiveTick / preloadRecentTicks）═══════════════
{
    // —— 8a init + ingest 守卫/分组 ——
    const tpa = ctor();
    ok(tpa._liveTicksBufferStartMs === null, '8a1 ctor 默认 startMs=null（回测/web 路径缺口计数 inert 的前提）');
    const t1 = wtick('0xLW', '0xLT', T0, true, 1, 100);
    tpa._walletTicksPreloaded = null; // 模拟 web 路径（从未 init）
    tpa.ingestLiveTick(t1);
    ok(tpa._walletTicksPreloaded === null, '8a2 未 init ingest no-op 不炸（不建 Map）');
    tpa.initLiveTicksBuffer();
    ok(tpa._walletTicksPreloaded instanceof Map && typeof tpa._liveTicksBufferStartMs === 'number'
        && Math.abs(tpa._liveTicksBufferStartMs - Date.now()) < 5000, '8a3 init 置空 Map + startMs=启动时刻');
    tpa.ingestLiveTick(null);
    tpa.ingestLiveTick({ ...t1, trader_address: null });        // wtick 缺省 sender=null → 双空
    tpa.ingestLiveTick({ ...t1, trader_address: undefined });   // 同上（spread 展开后仍 null）
    ok(tpa._walletTicksPreloaded.size === 0, '8a4 null tick / 缺钱包（sender+trader 双空）全 no-op');
    // sender 优先（二期 wallet 口径）：trader=GMGN 路由壳 + sender=真实买家 EOA → 归 EOA 名下
    tpa.ingestLiveTick(wtick('0x1de460f363af910f51726def188f9004276bf4bc', '0xLROUTER', T0, true, 1, 100, '0xE1'));
    ok(tpa._walletTicksPreloaded.has('0xE1') && !tpa._walletTicksPreloaded.has('0x1de460f363af910f51726def188f9004276bf4bc'),
        '8a4b sender 优先分组：路由壳 tick 归真实买家 EOA（GMGN 合并像不出现）');
    tpa._walletTicksPreloaded.clear(); // 隔离后续到达序断言
    tpa.ingestLiveTick(t1);
    tpa.ingestLiveTick(wtick('0xLW', '0xLT2', T0 + 1000, false, 0.5, 101));
    tpa.ingestLiveTick(wtick('0xLW2', '0xLT', T0 + 2000, true, 2, 102));
    const lw = tpa._walletTicksPreloaded.get('0xLW');
    ok(lw && lw.length === 2 && lw[0].token_address === '0xLT' && lw[1].token_address === '0xLT2',
        '8a5 按 wallet（sender||trader，无 sender 回退 trader）分组且保到达序');

    // —— 8b preload 窗口形状 ——
    // preload 读的是 DB 行形状（block_time ISO 字符串），与 wtick 的数字毫秒区分
    const dbTick = (id, trader, btMs, isBuy, bnb) => ({
        id, trader_address: trader, token_address: `0xPT${id}`,
        trade_type: isBuy ? 'buy' : 'sell', bnb_amount: bnb, price_usd: 1,
        block_time: new Date(btMs).toISOString(), block_number: 100,
    });
    /** 语义桩：select('id') 首查出 max id；select(COLS)+lt 倒序分页（真代码同款游标） */
    const mkClient = (allRows) => {
        const cli = { calls: 0 };
        const chain = () => {
            const c = {
                _cols: null, _lt: Infinity, _lim: Infinity,
                select(x) { c._cols = x; return c; },
                order() { return c; },
                lt(_col, v) { c._lt = v; return c; },
                limit(n) { c._lim = n; return c; },
                then(resolve) {
                    const rows = allRows.filter(r => r.id < c._lt).sort((a, b) => b.id - a.id).slice(0, c._lim);
                    resolve({ data: c._cols === 'id' ? (rows.length ? [{ id: rows[0].id }] : []) : rows, error: null });
                },
            };
            return c;
        };
        cli.from = () => { cli.calls++; return chain(); };
        return cli;
    };

    let m = null;
    try { await new TokenPositionAnalyzer({ trigger: TRIGGER }, { logger: QUIET }).preloadRecentTicks(mkClient([])); }
    catch (e) { m = e.message; }
    ok(m != null && m.includes('未初始化'), '8b1 未 init → throw fail-fast', m);
    const t2 = ctor(); t2.initLiveTicksBuffer();
    m = null; try { await t2.preloadRecentTicks(null); } catch (e) { m = e.message; }
    ok(m != null && m.includes('supabase'), '8b2 无 supabase → throw', m);

    const cli3 = mkClient([dbTick(1, '0xA', Date.now(), true, 1)]);
    const t3 = ctor({ liveTicksPreloadMinutes: -1 }); t3.initLiveTicksBuffer();
    const r3 = await t3.preloadRecentTicks(cli3);
    ok(r3 === null && cli3.calls === 0, '8b3 liveTicksPreloadMinutes=-1 → null 零查询（关闭）');

    const t4 = ctor(); t4.initLiveTicksBuffer();
    const r4 = await t4.preloadRecentTicks(mkClient([]));
    ok(r4 != null && r4.rows === 0 && r4.pages === 0, '8b4 空表 → rows:0/pages:0 不炸', r4);

    const t5 = ctor({ liveTicksPreloadMinutes: 10 }); t5.initLiveTicksBuffer();
    const startAt5 = t5._liveTicksBufferStartMs;
    const now5 = Date.now();
    const r5 = await t5.preloadRecentTicks(mkClient([
        dbTick(1, '0xA', now5 - 5 * 60000, true, 1),
        dbTick(2, '0xB', now5 - 8 * 60000, true, 2),
        dbTick(3, '0xC', now5 - 15 * 60000, true, 3), // 窗外
    ]));
    ok(r5 != null && r5.rows === 2, '8b5 显式 10min 窗只灌窗内 2 行', r5);
    ok(t5._walletTicksPreloaded.size === 2 && !t5._walletTicksPreloaded.has('0xC'), '8b5b 窗外行不进缓冲');
    ok(t5._liveTicksBufferStartMs < startAt5
        && Math.abs(t5._liveTicksBufferStartMs - (now5 - 10 * 60000)) < 2000,
        '8b5c startMs 前扩到窗口起点（Math.min 向前）', t5._liveTicksBufferStartMs - (now5 - 10 * 60000));

    const t6 = ctor({ liveTicksPreloadMaxMinutes: 60 }); t6.initLiveTicksBuffer();
    const r6 = await t6.preloadRecentTicks(mkClient([dbTick(1, '0xA', Date.now() - 60000, true, 1)]));
    ok(r6 != null && Date.now() - Date.parse(r6.sinceIso) > 59 * 60000,
        '8b6 auto + offline 空 → 回退 maxMinutes 窗', r6 && r6.sinceIso);

    const t7 = ctor(); t7.initLiveTicksBuffer();
    const through7 = Date.now() - 2 * HOUR;
    t7._offlineProfilePreloaded.set('0xW', { dataThroughMs: through7, profile: mkOffline() });
    const r7 = await t7.preloadRecentTicks(mkClient([dbTick(1, '0xA', Date.now() - 60000, true, 1)]));
    ok(r7 != null && Math.abs(Date.parse(r7.sinceIso) - (through7 - 30 * 60000)) < 2000,
        '8b7 auto + offline 预载 → 窗起点 = data_through − 30min margin', r7 && r7.sinceIso);

    const t8 = ctor({ liveTicksPreloadMaxMinutes: 60 }); t8.initLiveTicksBuffer();
    t8._offlineProfilePreloaded.set('0xW', { dataThroughMs: Date.now() - 5 * 24 * HOUR, profile: mkOffline() });
    const r8 = await t8.preloadRecentTicks(mkClient([dbTick(1, '0xA', Date.now() - 60000, true, 1)]));
    ok(r8 != null && Date.now() - Date.parse(r8.sinceIso) < 61 * 60000,
        '8b8 offline 陈旧超上限 → clamp 到 maxMinutes', r8 && r8.sinceIso);

    // —— 8c id 倒序分页 + block_time 升序灌入 ——
    // 1002 行窗内（id 与时间倒挂：id 大时间新）+ 1 行窗外（id 在页 1 范围内，走窗口过滤路径）
    const t9 = ctor({ liveTicksPreloadMinutes: 30 }); t9.initLiveTicksBuffer();
    const n9 = 1002, base9 = Date.now();
    const rows9 = [];
    for (let i = 0; i < n9; i++) rows9.push(dbTick(n9 - i, '0xPAGE', base9 - i * 1000, true, 0.1));
    rows9.push(dbTick(1500, '0xOLDPAGE', base9 - 40 * 60000, true, 0.1));
    const r9 = await t9.preloadRecentTicks(mkClient(rows9));
    ok(r9 != null && r9.pages === 2, '8c1 1003 行 → 2 页（1000/页游标 + 空页 break）', r9);
    const arr9 = t9._walletTicksPreloaded.get('0xPAGE');
    ok(arr9 != null && arr9.length === n9, '8c2 窗内 1002 行全灌（id 倒挂行不丢）', arr9 && arr9.length);
    let ascOk = true;
    for (let i = 1; i < arr9.length; i++) {
        if (new Date(arr9[i].block_time).getTime() < new Date(arr9[i - 1].block_time).getTime()) { ascOk = false; break; }
    }
    ok(ascOk, '8c3 per-trader 数组按 block_time 升序（预载排序后灌入，非 id 序）');
    ok(!t9._walletTicksPreloaded.has('0xOLDPAGE'), '8c4 越窗行不进缓冲（bt < sinceMs 过滤）');

    // —— 8d _fetchWalletTicksBatch 缺口计数（live 生效 / 回测 inert）——
    const t10 = ctor(); t10.initLiveTicksBuffer();
    const bufStart = t10._liveTicksBufferStartMs;
    t10.ingestLiveTick(wtick('0xA', '0xT', bufStart + 60000, true, 1, 100));
    await t10._fetchWalletTicksBatch(null, ['0xA'], new Date(bufStart - 10 * 60000).toISOString(), new Date(bufStart + 120000).toISOString());
    eq(t10._fetchTicksPreBufferN, 1, '8d1 请求窗口早于缓冲起点 → 计数 1（缺口暴露不静默）');
    await t10._fetchWalletTicksBatch(null, ['0xA'], new Date(bufStart + 30000).toISOString(), new Date(bufStart + 120000).toISOString());
    eq(t10._fetchTicksPreBufferN, 1, '8d2 窗口在缓冲内 → 不计数');
    const byAddr = await t10._fetchWalletTicksBatch(null, ['0xA'], new Date(bufStart + 30000).toISOString(), new Date(bufStart + 120000).toISOString());
    ok(byAddr != null && byAddr.get('0xA') != null && byAddr.get('0xA').length === 1,
        '8d3 内存路径窗口过滤照常（起点严格 > sinceMs）');
    const t11 = ctor(); // 回测路径：setHistoricalTicks 不调 init → startMs=null
    ok(t11._liveTicksBufferStartMs === null, '8d4 回测路径 startMs=null');
    await t11._fetchWalletTicksBatch(null, ['0xNOPE'], new Date(T0 - 100 * HOUR).toISOString(), new Date(T0).toISOString());
    ok(!t11._fetchTicksPreBufferN, '8d5 回测路径缺口计数 inert（null 不计数不 warn）');

    // —— 8e MAX_PAGES 护栏（源码口径；400 万行不实跑）——
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'services', 'TokenPositionAnalyzer.js'), 'utf8');
    ok(/MAX_PAGES = 4000/.test(src), '8e1 MAX_PAGES=4000 护栏常量在位');
    ok(/sinceMs = oldestCoveredMs;/.test(src)
        && /this\._liveTicksBufferStartMs = Math\.min\(this\._liveTicksBufferStartMs, sinceMs\)/.test(src),
        '8e2 触顶收缩 oldestCoveredMs + startMs Math.min 前扩口径');

    // —— 8f wallet 口径现算 SQL 形状（二期 2026-10-10；PostgREST 无 COALESCE 用 .or() 表达）——
    // 链式桩：select→or→gt→lt→gt→order→limit→then（真代码同链）；首页 data<1000 即 break 单页返回
    const mkOrStub = (rows = []) => {
        const cap = { cols: null, or: null, gts: [], lt: null, ord: null, lim: null };
        const c = {
            select(x) { cap.cols = x; return c; },
            or(x) { cap.or = x; return c; },
            gt(k, v) { cap.gts.push([k, v]); return c; },
            lt(k, v) { cap.lt = v; return c; },
            order(k, o) { cap.ord = [k, o]; return c; },
            limit(n) { cap.lim = n; return c; },
            then(resolve) { resolve({ data: rows, error: null }); },
        };
        return { cap, from: () => c };
    };
    const SINCE_ISO = new Date(T0).toISOString(), ASOF_ISO = new Date(T0 + HOUR).toISOString();

    // 单钱包 _fetchWalletTicks：.or() 精确表达 + COLS 无地址列（归户由 or 谓词在 DB 侧承载）
    const stub1 = mkOrStub([]);
    const rows1 = await ctor()._fetchWalletTicks(stub1, '0xW', SINCE_ISO, ASOF_ISO);
    eq(rows1.length, 0, '8f1 空首页单页返回');
    eq(stub1.cap.or, 'and(sender_address.is.null,trader_address.eq.0xW),sender_address.eq.0xW',
        '8f2 单钱包 .or() COALESCE 表达（旧行 sender NULL → 回退 trader 命中）', stub1.cap.or);
    eq(stub1.cap.cols, 'id,token_address,bnb_amount,price_usd,trade_type,block_time,block_number',
        '8f3 单钱包 COLS 无地址列');
    ok(JSON.stringify(stub1.cap.gts) === JSON.stringify([['block_time', SINCE_ISO], ['id', 0]])
        && stub1.cap.lt === ASOF_ISO, '8f3b block_time 窗 + id 游标（首页 gt id 0 起全量）');

    // 批量 _fetchWalletTicksBatch DB 分支：裸构造（无索引）走 DB；.or() 嵌套 in 形状 + 分组行为
    const tB = new TokenPositionAnalyzer({ trigger: TRIGGER }, { logger: QUIET });
    eq(tB._walletTicksPreloaded, null, '8f4 裸构造无索引（DB 分支前提）');
    const GMGN = '0x1de460f363af910f51726def188f9004276bf4bc';
    const stub2 = mkOrStub([
        { id: 1, sender_address: '0xS1', trader_address: GMGN, token_address: '0xT', bnb_amount: 1, trade_type: 'buy', block_time: SINCE_ISO, block_number: 100 },
        { id: 2, sender_address: null, trader_address: '0xT2', token_address: '0xT', bnb_amount: 2, trade_type: 'sell', block_time: SINCE_ISO, block_number: 101 },
    ]);
    const byAddr8f = await tB._fetchWalletTicksBatch(stub2, ['0xS1', '0xT2'], SINCE_ISO, ASOF_ISO);
    ok(byAddr8f.get('0xS1')?.length === 1 && byAddr8f.get('0xT2')?.length === 1 && !byAddr8f.has(GMGN),
        '8f5 批量分组：sender 行归 sender、旧行（sender NULL）回退 trader，GMGN 壳键不出现');
    eq(stub2.cap.or, 'and(sender_address.is.null,trader_address.in.(0xS1,0xT2)),sender_address.in.(0xS1,0xT2)',
        '8f6 批量 .or() COALESCE 表达（嵌套 in）', stub2.cap.or);
    ok(stub2.cap.cols.includes('sender_address') && stub2.cap.cols.includes('trader_address'),
        '8f7 批量 COLS 含双地址列（DB 行分组键原料）');
}

// ═══════════════ 汇总 ═══════════════
console.log(`\n_tpa: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error(failures.join('\n')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
