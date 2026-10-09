#!/usr/bin/env node
/**
 * 内嵌 collector 直连架构单测（2026-10-09 watcher 废除回迁；零 DB 零网络）
 *
 * 打桩 dbManager 单例 client（手法与 _test_watcher_architecture.cjs 同源），真引擎 +
 * 真 collector 实例（不 start——不建 WSS 连接/interval），直接驱动回调/内部方法。
 *
 *  A  _createCollectors 接线：平台集合/构造类/共享 senderResolver+eventWriter/实验级 collector
 *     配置覆盖恢复生效（watcher 时代失效的反转）
 *  B  事件双投：onTokenCreate/onGraduation → wss_events 行（WssEventWriter 打桩 DB 落 inserts）
 *     + 引擎句柄（saveToken/markGraduated）；flap onQuoteSet → token_quote_set 行；fourmeme 无
 *  C  tick 链端到端：_emitTick → 真 FA factorsUpdated + _tickBuffer 行 experiment_id=null
 *     （08-27 防线）+ TPA _onTickBuffered 钩子（启用挂/未启用不挂）
 *  D  TPA live 三件套引擎接线：initLiveTicksBuffer 已调 / preloadRecentTicks fail-open 不阻启动
 *  E  双平台 + Flap 子类功能回归（自 _test_watcher_architecture 第 4.5/4.6 节迁移，驱动方式
 *     从 consumer 轮询改为 collector 回调直调，断言语义逐字保留）：
 *     per-token 分派落库 payload 黄金字段 / _buildTokenInfo _fl/_fo / live fail-fast
 *  F  源码口径防回归：guard 判据 getLastMessageAt + forceReconnect / stop 顺序
 *     eventWriter→senderResolver→collectors / 主循环启动 collectors / getStats /
 *     引擎无 SharedTickConsumer 引用 / 不调 setExperimentId
 *
 * 用法：node scripts/_test_embedded_collector_architecture.cjs
 */

'use strict';

// ═══════════════ dbManager 单例打桩（必须在被测模块 require 前完成）═══════════════
const { dbManager } = require('../src/services/dbManager');

class MockQuery {
    constructor(db, table) {
        this.db = db; this.table = table;
        this._gt = {}; this._gte = {}; this._lt = {}; this._eqs = {}; this._ins = {};
        this._rng = null; this._lim = null; this._asc = true;
        this._upd = null; this._upsertRows = null; this._insertRows = null;
    }
    select() { return this; }
    gt(col, v) { this._gt[col] = v; return this; }
    gte(col, v) { this._gte[col] = v; return this; }
    lt(col, v) { this._lt[col] = v; return this; }
    eq(col, v) { this._eqs[col] = v; return this; }
    in(col, vals) { this._ins[col] = vals; return this; }
    order(col, opts) { this._asc = opts ? !!opts.ascending : true; return this; }
    range(a, b) { this._rng = [a, b]; return this; }
    limit(n) { this._lim = n; return this; }
    update(payload) { this._upd = payload; return this; }
    upsert(rows) { this._upsertRows = rows; return this; }
    insert(rows) { this._insertRows = rows; return this; }
    then(resolve) { resolve(this._exec()); }
    _exec() {
        if (this.db.failTable === this.table) return { data: null, error: { message: 'mock table down' } };
        if (this._insertRows) {
            this.db.inserts.push({ table: this.table, rows: this._insertRows });
            return { data: null, error: null };
        }
        if (this._upsertRows) {
            this.db.upserts.push({ table: this.table, rows: this._upsertRows });
            return { data: null, error: null };
        }
        if (this._upd) {
            this.db.updates.push({ table: this.table, payload: this._upd, ids: this._ins.id || [] });
            return { error: null };
        }
        let rows = this.db.tables[this.table] || [];
        for (const [col, v] of Object.entries(this._gt)) rows = rows.filter(r => r[col] > v);
        for (const [col, v] of Object.entries(this._gte)) rows = rows.filter(r => r[col] >= v);
        for (const [col, v] of Object.entries(this._lt)) rows = rows.filter(r => r[col] < v);
        for (const [col, v] of Object.entries(this._eqs)) rows = rows.filter(r => r[col] === v);
        for (const [col, vals] of Object.entries(this._ins)) rows = rows.filter(r => vals.includes(r[col]));
        rows = [...rows].sort((a, b) => (this._asc ? a.id - b.id : b.id - a.id));
        if (this._lim != null) rows = rows.slice(0, this._lim);
        if (this._rng) rows = rows.slice(this._rng[0], this._rng[1] + 1);
        return { data: rows, error: null };
    }
}

function freshDb() {
    const db = {
        tables: { wss_events: [], wss_price_ticks: [], wallets: [], wallet_offline_profiles: [], token_profiles: [] },
        updates: [], upserts: [], inserts: [],
        failTable: null,
    };
    db.client = { from: (t) => new MockQuery(db, t) };
    return db;
}

const activeDb = freshDb();
dbManager.isInitialized = true;
dbManager.client = activeDb.client;

// ═══════════════ 测试基建 ═══════════════

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` | ${detail}` : ''}`); }
}

const silentLogger = {
    info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
    setExperimentId: () => {},
};

/** 构造真引擎并完成 _initializeComponents + _initializeDataSources（打桩 dataService/dbManager） */
async function makeEngine(platform, extraConfig = {}) {
    const { FourMemeWssTradingEngine } = require('../src/trading-engine/implementations/FourMemeWssTradingEngine');
    const engine = new FourMemeWssTradingEngine({ tradingMode: 'virtual', initialBalance: 1 });
    engine._experiment = {
        id: `arch-${platform}`,
        config: {
            platform,
            strategiesConfig: {
                buyStrategies: [{ priority: 1, condition: 'earlyReturn > 100 AND age < 10' }],
                sellStrategies: [{ priority: 1, condition: 'profitPercent > 40' }],
            },
            tradeAmount: 0.1,
            fourmemeWs: { corpusEnrich: { enabled: false } }, // 关语料补采（零网络）
            flapWs: { corpusEnrich: { enabled: false } },
            ...extraConfig,
        },
    };
    engine._experimentId = `arch-${platform}`;
    engine.logger = silentLogger;
    engine._logger = silentLogger;
    engine._savedTokens = [];
    engine.dataService = {
        saveToken: async (expId, t) => { engine._savedTokens.push({ expId, token: t.token, platform: t.platform, raw: t.raw_api_data }); return true; },
        updateTokenStatus: async () => true,
        getTrades: async () => [],
    };
    engine._updateSignalStatus = async () => {};
    engine._updateSignalMetadata = async () => {};

    await engine._initializeComponents();
    await engine._initializeDataSources(); // 建 collectors（dbManager 已打桩）
    return engine;
}

/** fourmeme TokenTrade 解码形状（对齐 _test_sender_resolver decodedFm） */
const decodedFm = (tx, token = '0xtoken') => ({
    token, tradeType: 'buy', trader: '0xtrader', priceBnb: 0.001,
    tokenAmount: 1000, bnbAmount: 1, offers: 10, fundsBnb: 5,
    blockNumber: 100, blockTimeMs: 1700000000000, txHash: tx, logIndex: 0,
});

const fmCreateInfo = (token = '0xNEW1') => ({
    creator: '0xcreator', token, name: 'NewOne', symbol: 'N1',
    totalSupply: 1e9, blockNumber: 10, blockTimeMs: 1700000000000, txHash: '0xev1',
});

const flapCreateInfo = (token = '0xFLAP1') => ({
    creator: '0xflapcreator', token, name: 'FlapOne', symbol: 'F1',
    blockNumber: 11, blockTimeMs: 1700000000000, txHash: '0xevf1',
    nonce: 7, eventTsSec: 1700000099, meta: 'ipfs://QmX', taxToken: '0xtax7777',
});

const TPA_CONFIG = {
    enabled: true, enforce: false,
    trigger: { blocks: 1, tradeCount: 10, buyBnb: 6, minHolders: 4 },
};

async function stopQuietly(engine) {
    engine._isStopped = false;
    try { await engine.stop(); } catch { /* 打桩环境下允许子步骤 warn */ }
}

// ═══════════════ A 节：_createCollectors 接线 ═══════════════

async function testA() {
    console.log('\n━━━ A. _createCollectors 接线 ━━━');
    const { FourMemeAnkrWsCollector } = require('../src/collectors/fourmeme-ankr-ws-collector.js');
    const { FlapAnkrWsCollector } = require('../src/collectors/flap-ankr-ws-collector.js');
    const { SenderResolver } = require('../src/collectors/sender-resolver.js');
    const { WssEventWriter } = require('../src/collectors/wss-event-writer.js');

    // A1 fourmeme 单平台
    const e1 = await makeEngine('fourmeme');
    check('A1a 引擎持 collectors 不持 consumer（直连架构）',
        Array.isArray(e1._collectors) && e1._collectors.length === 1 && e1._consumer == null);
    check('A1b fourmeme 实验构造 FourMemeAnkrWsCollector',
        e1._collectors[0] instanceof FourMemeAnkrWsCollector && e1._collectors[0]._platformLabel === 'fourmeme');
    check('A1c 共享 senderResolver（default.json senderResolve.enabled=true）',
        e1._senderResolver instanceof SenderResolver);
    check('A1d eventWriter 构造且 start（重试定时器已挂）',
        e1._eventWriter instanceof WssEventWriter && e1._eventWriter._retryTimer != null);

    // A2 both 双平台 = 双 collector
    const e2 = await makeEngine('both');
    check('A2a both 实验双 collector（fourmeme + flap 各一）',
        e2._collectors.length === 2
        && e2._collectors.some(c => c instanceof FourMemeAnkrWsCollector && c._platformLabel === 'fourmeme')
        && e2._collectors.some(c => c instanceof FlapAnkrWsCollector && c._platformLabel === 'flap'));
    check('A2b 双 collector 共享同一 resolver/eventWriter 实例',
        e2._collectors.every(c => c._senderResolver === e2._senderResolver));

    // A3 flap 子类单 collector
    const { FlapWssTradingEngine } = require('../src/trading-engine/implementations/FlapWssTradingEngine');
    const e3 = new FlapWssTradingEngine({ tradingMode: 'virtual', initialBalance: 1 });
    e3._experiment = {
        id: 'arch-flap',
        config: {
            platform: 'flap',
            strategiesConfig: {
                buyStrategies: [{ priority: 1, condition: 'earlyReturn > 100 AND age < 10' }],
                sellStrategies: [{ priority: 1, condition: 'profitPercent > 40' }],
            },
            tradeAmount: 0.1,
            flapWs: { corpusEnrich: { enabled: false } },
        },
    };
    e3._experimentId = 'arch-flap';
    e3.logger = silentLogger; e3._logger = silentLogger;
    e3.dataService = { saveToken: async () => true, updateTokenStatus: async () => true, getTrades: async () => [] };
    e3._updateSignalStatus = async () => {};
    e3._updateSignalMetadata = async () => {};
    await e3._initializeComponents();
    await e3._initializeDataSources();
    check('A3a flap 引擎单 FlapAnkrWsCollector',
        e3._collectors.length === 1 && e3._collectors[0] instanceof FlapAnkrWsCollector);
    check('A3b flap 引擎身份保留（_liveTraderType=flap / 配置段 flapWs）',
        e3._liveTraderType() === 'flap' && e3._wsConfigSectionName() === 'flapWs');

    // A4 实验级 collector 配置覆盖恢复生效（watcher 时代失效的反转）：实验级 minTickBnb 进 collector
    const e4 = await makeEngine('fourmeme', { fourmemeWs: { minTickBnb: 0.777, corpusEnrich: { enabled: false } } });
    check('A4 实验级 collector 配置覆盖生效（minTickBnb 浅合并进 collector 段）',
        e4._collectors[0]._minTickBnb === 0.777, `实际 ${e4._collectors[0]._minTickBnb}`);

    await stopQuietly(e1); await stopQuietly(e2); await stopQuietly(e3); await stopQuietly(e4);
}

// ═══════════════ B 节：事件双投 ═══════════════

async function testB() {
    console.log('\n━━━ B. 事件双投（wss_events 持久化 + 引擎句柄）━━━');
    const e = await makeEngine('fourmeme');
    const collector = e._collectors[0];

    // B1 token_create 双投：collector 内部（FA.registerToken platform 键 + pool.addToken）→ 回调双投
    const insertsBefore = activeDb.inserts.length;
    await collector._handleTokenCreate(fmCreateInfo('0xB1TOK'));
    const evInsert = activeDb.inserts.slice(insertsBefore).find(i => i.table === 'wss_events');
    check('B1a onTokenCreate → WssEventWriter 落 wss_events（kind=token_create/platform/token/payload/block_time）',
        !!evInsert && evInsert.rows.length === 1
        && evInsert.rows[0].kind === 'token_create' && evInsert.rows[0].platform === 'fourmeme'
        && evInsert.rows[0].token_address === '0xB1TOK'
        && evInsert.rows[0].payload.token === '0xB1TOK'
        && evInsert.rows[0].block_time === new Date(1700000000000).toISOString(),
        JSON.stringify(evInsert && evInsert.rows[0]));
    check('B1b onTokenCreate → 引擎 _handleNewToken 落 experiment_tokens（platform=fourmeme）',
        e._savedTokens.some(t => t.token === '0xB1TOK' && t.platform === 'fourmeme' && t.expId === 'arch-fourmeme'));
    const st = e._factorAggregator.getTokenState('0xB1TOK');
    check('B1c FA state.platform=fourmeme（collector registerToken meta 平台键）',
        st && st.platform === 'fourmeme');

    // B2 graduation 双投（enqueue 内 insert 是 promise 微任务——回调后等一拍再断言）
    const insertsBefore2 = activeDb.inserts.length;
    collector._callbacks.onGraduation({ token: '0xB1TOK', fundsBnb: 5, blockNumber: 20, blockTimeMs: 1700000001000, txHash: '0xgrad' });
    await new Promise(r => setTimeout(r, 10));
    const evGrad = activeDb.inserts.slice(insertsBefore2).find(i => i.table === 'wss_events');
    check('B2a onGraduation → wss_events kind=graduation',
        !!evGrad && evGrad.rows[0].kind === 'graduation' && evGrad.rows[0].token_address === '0xB1TOK');
    const gSt = e._factorAggregator.getTokenState('0xB1TOK');
    check('B2b onGraduation → 引擎 _handleGraduation → FA.markGraduated（无持仓不触发毕业卖出）',
        gSt && gSt.graduated === true);

    // B3 flap onQuoteSet → token_quote_set 行；fourmeme collector 无该回调
    const ef = await makeEngine('both');
    const fmC = ef._collectors.find(c => c._platformLabel === 'fourmeme');
    const flC = ef._collectors.find(c => c._platformLabel === 'flap');
    check('B3a fourmeme collector 无 onQuoteSet 回调', fmC._callbacks.onQuoteSet == null);
    const insertsBefore3 = activeDb.inserts.length;
    flC._callbacks.onQuoteSet({ token: '0xQTOK', quote: '0xquote', blockNumber: 30, logIndex: 1, txHash: '0xq' });
    await new Promise(r => setTimeout(r, 10));
    const evQ = activeDb.inserts.slice(insertsBefore3).find(i => i.table === 'wss_events');
    check('B3b flap onQuoteSet → wss_events kind=token_quote_set platform=flap',
        !!evQ && evQ.rows[0].kind === 'token_quote_set' && evQ.rows[0].platform === 'flap');

    // B4 WssEventWriter 失败进重试队列（不丢 create 行）：打桩 wss_events 表故障 → 入队 → 恢复 → 30s 定时器或 stop 冲刷
    activeDb.failTable = 'wss_events';
    const qBefore = ef._eventWriter._queue.length;
    fmC._callbacks.onTokenCreate({ ...fmCreateInfo('0xQFAIL'), blockTimeMs: null });
    await new Promise(r => setTimeout(r, 20));
    check('B4 wss_events 写失败进重试队列（create 行绝不 fire-and-forget）',
        ef._eventWriter._queue.length === qBefore + 1);
    activeDb.failTable = null;
    await ef._eventWriter._flush();
    check('B4b 恢复后手动冲刷清空队列', ef._eventWriter._queue.length === qBefore);

    await stopQuietly(e); await stopQuietly(ef);
}

// ═══════════════ C 节：tick 链端到端 ═══════════════

async function testC() {
    console.log('\n━━━ C. tick 链端到端（真引擎 FA）━━━');

    // C1 无 TPA 实验：tick → FA factorsUpdated + buffer 行 experiment_id=null + 无钩子。
    //   resolver 生产主路径 = EOA kind 缓存命中同步回推（零延迟零 RPC）——预填缓存走真链路
    const e = await makeEngine('fourmeme');
    const collector = e._collectors[0];
    check('C1a TPA 未启用 → collector 无 _onTickBuffered 钩子', collector._onTickBuffered == null);
    e._senderResolver._kindCache.set('0xtrader', 'eoa');
    await collector._handleTokenCreate(fmCreateInfo('0xCTOK'));
    const faBefore = e.metrics.factorsUpdatedCount;
    collector._emitTick(decodedFm('0xct1', '0xCTOK'));
    check('C1b tick → FA.processTick → factorsUpdated（引擎链路通）',
        e.metrics.factorsUpdatedCount > faBefore, `before=${faBefore} after=${e.metrics.factorsUpdatedCount}`);
    check('C1c tick 行 experiment_id=null（08-27 防线：不调 setExperimentId）',
        collector._tickBuffer.length >= 1 && collector._tickBuffer[collector._tickBuffer.length - 1].experiment_id === null,
        JSON.stringify(collector._tickBuffer[collector._tickBuffer.length - 1] && collector._tickBuffer[collector._tickBuffer.length - 1].experiment_id));
    await stopQuietly(e);

    // C2 TPA 启用实验：钩子挂载 + ingestLiveTick 收到 buffer 行（kindCache 预填同 C1：EOA 快路）
    const e2 = await makeEngine('fourmeme', { tokenPositionAnalyzer: TPA_CONFIG });
    const collector2 = e2._collectors[0];
    check('C2a TPA 启用 → collector._onTickBuffered 挂载', typeof collector2._onTickBuffered === 'function');
    e2._senderResolver._kindCache.set('0xtrader', 'eoa');
    await collector2._handleTokenCreate(fmCreateInfo('0xCTOK2'));
    collector2._emitTick(decodedFm('0xct2', '0xCTOK2'));
    const tpaTicks = e2._tokenPositionAnalyzer._walletTicksPreloaded.get('0xtrader');
    check('C2b _onTickBuffered → TPA.ingestLiveTick 收 buffer 行（trader 口径 + EOA 快路 sender 定值）',
        tpaTicks && tpaTicks.length === 1 && tpaTicks[0].tx_hash === '0xct2' && tpaTicks[0].token_address === '0xCTOK2'
        && tpaTicks[0].sender_address === '0xtrader');
    await stopQuietly(e2);
}

// ═══════════════ D 节：TPA live 三件套引擎接线 ═══════════════

async function testD() {
    console.log('\n━━━ D. TPA live 三件套引擎接线 ━━━');

    // D1 正常链路：initLiveTicksBuffer 已调（空表 DB → preload 0 行不炸）
    const e = await makeEngine('fourmeme', { tokenPositionAnalyzer: TPA_CONFIG });
    check('D1a initLiveTicksBuffer 已调（_walletTicksPreloaded 为 Map）',
        e._tokenPositionAnalyzer._walletTicksPreloaded instanceof Map);
    check('D1b _liveTicksBufferStartMs 已置（缓冲起点非 null）',
        typeof e._tokenPositionAnalyzer._liveTicksBufferStartMs === 'number');
    await stopQuietly(e);

    // D2 preloadRecentTicks 失败 fail-open：打桩 wss_price_ticks 故障 → 启动不被阻断、缓冲仍是 Map
    activeDb.failTable = 'wss_price_ticks';
    let e2 = null;
    let bootOk = true;
    try {
        e2 = await makeEngine('fourmeme', { tokenPositionAnalyzer: TPA_CONFIG });
    } catch (err) {
        bootOk = false;
    }
    check('D2a preloadRecentTicks 失败不阻断启动（fail-open 性能退化）', bootOk);
    check('D2b 失败后缓冲仍初始化（init 先于 preload）',
        e2 && e2._tokenPositionAnalyzer._walletTicksPreloaded instanceof Map);
    activeDb.failTable = null;
    if (e2) await stopQuietly(e2);
}

// ═══════════════ E 节：双平台 + Flap 子类功能回归（自 watcher 测试 4.5/4.6 迁移）═══════════════

async function testE() {
    console.log('\n━━━ E. 双平台 / Flap 子类功能回归 ━━━');

    // E1 both：per-token 分派落库 payload 黄金字段（驱动改为 collector 回调直调）
    const e2 = await makeEngine('both');
    const fmC = e2._collectors.find(c => c._platformLabel === 'fourmeme');
    const flC = e2._collectors.find(c => c._platformLabel === 'flap');
    await fmC._handleTokenCreate({ ...fmCreateInfo('0xEDFM'), requestId: 'r-123' });
    await flC._handleTokenCreate(flapCreateInfo('0xEDFL'));
    const fmRec = e2._savedTokens.find(t => t.token === '0xEDFM');
    const flRec = e2._savedTokens.find(t => t.token === '0xEDFL');
    check('E1a fourmeme 行落库 platform=fourmeme（totalSupply 存档）',
        fmRec && fmRec.platform === 'fourmeme' && fmRec.raw.totalSupply === 1e9,
        JSON.stringify(fmRec && fmRec.raw));
    check('E1b flap 行落库 platform=flap（nonce/eventTs/meta/taxToken 存档，totalSupply 恒 1e9）',
        flRec && flRec.platform === 'flap' && flRec.raw.nonce === 7
        && flRec.raw.eventTs === 1700000099 && flRec.raw.meta === 'ipfs://QmX'
        && flRec.raw.taxToken === '0xtax7777' && flRec.raw.totalSupply === 1e9,
        JSON.stringify(flRec && flRec.raw));
    check('E1c FA state 平台正确（fourmeme/flap 各自）',
        e2._factorAggregator.getTokenState('0xEDFM')?.platform === 'fourmeme'
        && e2._factorAggregator.getTokenState('0xEDFL')?.platform === 'flap');

    // E2 _buildTokenInfo per-token 分派（_fl/_fo）
    const flTok = e2._tokenPool.getToken('0xEDFL', 'bsc');
    const fmTok = e2._tokenPool.getToken('0xEDFM', 'bsc');
    check('E2 _buildTokenInfo 按行平台分派（innerPair _fl/_fo）',
        flTok && e2._buildTokenInfo(flTok).innerPair.endsWith('_fl')
        && e2._buildTokenInfo(flTok).platform === 'flap'
        && fmTok && e2._buildTokenInfo(fmTok).innerPair.endsWith('_fo'));

    // E3 双平台 live fail-fast（防线三：trader 引擎级单例无法承载双平台）
    let liveThrew = false;
    try { await e2._initializeLiveTrader(); } catch { liveThrew = true; }
    check('E3 双平台 live fail-fast throw', liveThrew);
    await stopQuietly(e2);

    // E4 Flap 子类黄金回归（落库 payload + _buildTokenInfo 无 name + live throw）
    const { FlapWssTradingEngine } = require('../src/trading-engine/implementations/FlapWssTradingEngine');
    const e3 = new FlapWssTradingEngine({ tradingMode: 'virtual', initialBalance: 1 });
    e3._experiment = {
        id: 'arch-flap2',
        config: {
            platform: 'flap',
            strategiesConfig: {
                buyStrategies: [{ priority: 1, condition: 'earlyReturn > 100 AND age < 10' }],
                sellStrategies: [{ priority: 1, condition: 'profitPercent > 40' }],
            },
            tradeAmount: 0.1,
            flapWs: { corpusEnrich: { enabled: false } },
        },
    };
    e3._experimentId = 'arch-flap2';
    e3.logger = silentLogger; e3._logger = silentLogger;
    const flapSaved = [];
    e3.dataService = {
        saveToken: async (expId, t) => { flapSaved.push(t); return true; },
        updateTokenStatus: async () => true,
        getTrades: async () => [],
    };
    e3._updateSignalStatus = async () => {};
    e3._updateSignalMetadata = async () => {};
    await e3._initializeComponents();
    await e3._initializeDataSources();
    await e3._collectors[0]._handleTokenCreate({ ...flapCreateInfo('0xGFL'), nonce: 3, eventTsSec: 1700000123, meta: 'ipfs://QmY', taxToken: '0xtax27777' });
    const gRec = flapSaved.find(t => t.token === '0xGFL');
    check('E4a flap token 落库黄金字段（platform/source/nonce/eventTs/meta/taxToken/totalSupply=1e9）',
        gRec && gRec.platform === 'flap' && gRec.raw_api_data.source === 'wss_token_create'
        && gRec.raw_api_data.nonce === 3 && gRec.raw_api_data.eventTs === 1700000123
        && gRec.raw_api_data.meta === 'ipfs://QmY' && gRec.raw_api_data.taxToken === '0xtax27777'
        && gRec.raw_api_data.totalSupply === 1e9,
        JSON.stringify(gRec && gRec.raw_api_data));
    const gTok = e3._tokenPool.getToken('0xGFL', 'bsc');
    check('E4b _buildTokenInfo 保持无 name 字段（flap 版）',
        gTok && !('name' in e3._buildTokenInfo(gTok)));
    let flapLiveThrew = false;
    try { await e3._initializeLiveTrader(); } catch { flapLiveThrew = true; }
    check('E4c flap live 无钱包配置 throw', flapLiveThrew);
    await stopQuietly(e3);
}

// ═══════════════ F 节：源码口径防回归 ═══════════════

function testF() {
    console.log('\n━━━ F. 源码口径防回归（grep 断言）━━━');
    const fs = require('fs');
    const path = require('path');
    const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
    const eng = read('src/trading-engine/implementations/FourMemeWssTradingEngine.js');

    check('F1 guard 判据=collector.getLastMessageAt（消息心跳）+ forceReconnect 自愈',
        /c\.getLastMessageAt\(\)/.test(eng) && /c\.forceReconnect\(\)/.test(eng)
        && /downGuardSelfHealMs/.test(eng));
    check('F2 无 lastIngestAt/consumer 残留（watcher 时代判据已除）',
        !/lastIngestAt/.test(eng) && !/SharedTickConsumer/.test(eng));

    const stopIdx = eng.indexOf('await this._eventWriter.stop()');
    const resolverIdx = eng.indexOf('await this._senderResolver.stop()');
    const collStopIdx = eng.indexOf('await c.stop()');
    check('F3 stop 顺序：eventWriter → senderResolver → collectors（create 行优先冲刷）',
        stopIdx > 0 && resolverIdx > stopIdx && collStopIdx > resolverIdx);

    check('F4 _runMainLoop 启动 collectors（订阅随实验起停）',
        /for \(const c of this\._collectors\) \{\s*\n\s*c\.start\(\);/.test(eng));

    // F5 计数口径：引擎里 setExperimentId 的唯一合法出现是 _updateComponentLoggers 的
    // this.logger.setExperimentId（logger 方法，非 collector 归属注入）——两者计数相等
    // 即除 logger 上下文外无 collector.setExperimentId 调用（08-27 防线：tick 行 experiment_id 恒 NULL）
    const setExpCalls = eng.match(/\.setExperimentId\(/g) || [];
    const loggerCalls = eng.match(/logger\.setExperimentId\(/g) || [];
    check('F5 不调 collector.setExperimentId（08-27 防线：tick 行 experiment_id 恒 NULL）',
        setExpCalls.length === loggerCalls.length,
        `setExperimentId×${setExpCalls.length} vs logger×${loggerCalls.length}`);

    check('F6 TPA live 三件套接线（init + await preload + prewarm）',
        /initLiveTicksBuffer\(\)/.test(eng) && /await this\._tokenPositionAnalyzer\.preloadRecentTicks\(supabase\)/.test(eng)
        && /prewarmLiveTokenProfiles\(supabase\)/.test(eng));

    // getStats collectors 段
    const statsMatch = eng.match(/getStats\(\)[\s\S]{0,2000}/);
    check('F7 getStats 带 collectors/senderResolver/eventWriter',
        !!statsMatch && /_collectors/.test(statsMatch[0]) && /_senderResolver/.test(statsMatch[0]) && /_eventWriter/.test(statsMatch[0]));
}

(async () => {
    await testA();
    await testB();
    await testC();
    await testD();
    await testE();
    testF();
    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed ? 1 : 0);
})().catch((err) => {
    console.error(`\n❌ 测试脚本异常（已过 ${passed} 断言）:`, err);
    process.exit(1);
});
