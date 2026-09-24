#!/usr/bin/env node
/**
 * watcher 架构本地零 DB 单测（打桩 dbManager 单例 client，不连任何真实服务）：
 *
 *  1. SharedTickConsumer：首水位对齐不吃启动前行 / 先 events 后 ticks / 本地 platform
 *     过滤且水位推进含异平台行 / 水位延迟一周期 + 去重集（FA tick 不翻倍）/ minTickBnb
 *     门 / priceOutlier 回写 / heartbeat 只推水位 / 空轮不回退 / 单行错误跳过 / stop 幂等
 *  2. collector dryRun 语义：dryRun=true 丢缓冲零 upsert；缺省 upsert 收 experiment_id:null
 *  3. BacktestEngine._loadWssTicks：token 集合 + platform 口径、分块乱序 id 全局归并、时间窗过滤
 *  4. 引擎接线冒烟：_initializeDataSources 建 consumer（平台正确）→ mock DB 行驱动
 *     _pollLoop → saveToken（发现）/ FA factorsUpdated（tick）/ graduation 链路
 *
 * 用法：node scripts/_test_watcher_architecture.cjs
 */

'use strict';

// ═══════════════ dbManager 单例打桩（必须在被测模块 require 前完成）═══════════════
const { dbManager } = require('../src/services/dbManager');

/** 通用链式 mock 查询：thenable，_exec 按 gt/eq/in 过滤 + id 升序 + range/limit 切片 */
class MockQuery {
    constructor(db, table) {
        this.db = db;
        this.table = table;
        this._gt = {};
        this._gte = {};
        this._eqs = {};
        this._ins = {};
        this._rng = null;
        this._lim = null;
        this._asc = true;
        this._upd = null;
        this._upsertRows = null;
    }
    select() { return this; }
    gt(col, v) { this._gt[col] = v; return this; }
    gte(col, v) { this._gte[col] = v; return this; }
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
        tables: { wss_events: [], wss_price_ticks: [], wallets: [] },
        updates: [],
        upserts: [],
        inserts: [],
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

function tickRow(id, token, platform = 'fourmeme', overrides = {}) {
    return {
        id, token_address: token, tx_hash: `0xtx${id}`, log_index: 0,
        trade_type: 'buy', trader_address: '0xtrader',
        price_bnb: 1e-9, price_usd: 0.001, bnb_amount: 0.01, token_amount: 1e6,
        price_outlier: false, block_number: 100,
        block_time: new Date(1700000000000 + id).toISOString(),
        received_at: new Date(1700000000000 + id).toISOString(),
        platform, ...overrides,
    };
}

function evCreateRow(id, token, platform = 'fourmeme') {
    return {
        id, kind: 'token_create', platform, token_address: token,
        payload: {
            creator: '0xcreator', token, name: `T${id}`, symbol: `T${id}`,
            totalSupply: 1e9, blockNumber: 1,
            blockTimeMs: 1700000000000 + id, txHash: `0xev${id}`,
        },
        block_time: null, created_at: new Date().toISOString(),
    };
}

/** 事件+tick 双路观测的 FA mock（register/processTick 调用序进 orderLog） */
function mockFa(orderLog) {
    return {
        registerToken: (token, info) => orderLog.push(['fa_register', token]),
        processTick: (t) => {
            orderLog.push(['fa_tick', t.token_address]);
            return { factors: {}, priceAccepted: true, priceOutlier: t.tx_hash === '0xOUT' };
        },
        markGraduated: (token) => orderLog.push(['fa_graduated', token]),
    };
}

/** 手动注入 supabase + startedAt 的 consumer（绕过 start() 的 interval，专注 _pollLoop 逻辑） */
function manualConsumer(db, deps) {
    const { SharedTickConsumer } = require('../src/trading-engine/core/SharedTickConsumer');
    const consumer = new SharedTickConsumer({
        platform: 'fourmeme', pollIntervalMs: 20, minTickBnb: 0.001,
        logger: silentLogger, experimentId: 'test', ...deps,
    });
    consumer._supabase = db.client;
    consumer.stats.startedAt = Date.now();
    return consumer;
}

// ═══════════════ 1. SharedTickConsumer ═══════════════

async function testSharedTickConsumer() {
    console.log('\n━━━ 1. SharedTickConsumer ━━━');
    const { SharedTickConsumer } = require('../src/trading-engine/core/SharedTickConsumer');

    // ── 1.1 首水位对齐：不吃启动前行，只消费启动后新行 ──
    {
        const db = freshDb();
        db.tables.wss_events = [evCreateRow(1, '0xOLD')];
        db.tables.wss_price_ticks = [tickRow(1, '0xOLD'), tickRow(2, '0xOLD')];
        const orderLog = [];
        const consumer = manualConsumer(db, { factorAggregator: mockFa(orderLog), onTokenCreate: (i) => orderLog.push(['engine_new', i.token]) });
        await consumer._pollLoop();
        check('1.1a 首轮对齐后不吃启动前行', orderLog.length === 0, JSON.stringify(orderLog));
        db.tables.wss_events.push(evCreateRow(2, '0xNEW'));
        db.tables.wss_price_ticks.push(tickRow(3, '0xNEW'));
        await consumer._pollLoop();
        check('1.1b 启动后新 token_create 被消费',
            orderLog.some(e => e[0] === 'engine_new' && e[1] === '0xNEW'));
        check('1.1c 启动后新 tick 被消费', orderLog.some(e => e[0] === 'fa_tick' && e[1] === '0xNEW'));
    }

    // ── 1.2 先 events 后 ticks（同周期 create 先于 tick 应用）──
    {
        const db = freshDb();
        const orderLog = [];
        const consumer = manualConsumer(db, { factorAggregator: mockFa(orderLog), onTokenCreate: (i) => orderLog.push(['engine_new', i.token]) });
        await consumer._pollLoop(); // 对齐
        db.tables.wss_events.push(evCreateRow(1, '0xX'));
        db.tables.wss_price_ticks.push(tickRow(1, '0xX'));
        await consumer._pollLoop();
        const iReg = orderLog.findIndex(e => e[0] === 'fa_register' && e[1] === '0xX');
        const iTick = orderLog.findIndex(e => e[0] === 'fa_tick' && e[1] === '0xX');
        check('1.2 同周期 token_create 先于 tick 应用', iReg !== -1 && iTick !== -1 && iReg < iTick, JSON.stringify(orderLog));
    }

    // ── 1.3 本地 platform 过滤 + 水位推进含异平台行 + 延迟一周期 + 去重集 ──
    {
        const db = freshDb();
        const orderLog = [];
        const consumer = manualConsumer(db, { factorAggregator: mockFa(orderLog) });
        await consumer._pollLoop(); // 轮0：对齐 committed=pendingMax=0（空表）
        db.tables.wss_price_ticks.push(
            tickRow(11, '0xFM', 'fourmeme'),
            tickRow(12, '0xFL', 'flap'),      // 异平台行：必须进结果集推水位
            tickRow(13, '0xFM2', 'fourmeme'),
        );
        await consumer._pollLoop(); // 轮1：应用 11/13，skip 12；轮末 committed=轮0 pendingMax=0
        check('1.3a 轮1 应用本平台 2 tick（去重集前）', consumer.stats.ticksApplied === 2, `applied=${consumer.stats.ticksApplied}`);
        check('1.3b 轮1 过滤异平台 1 行', consumer.stats.ticksSkippedPlatform === 1);
        check('1.3c 轮1 后水位延迟未提交（committed=对齐值 0）', consumer.getWatermarks().ticks === 0, `w=${consumer.getWatermarks().ticks}`);
        await consumer._pollLoop(); // 轮2：重叠重读 11-13（去重集吸收），轮末 committed=13
        check('1.3d 轮2 重叠重读被去重集吸收（FA 调用不翻倍）',
            orderLog.filter(e => e[0] === 'fa_tick').length === 2, `faTicks=${orderLog.filter(e => e[0] === 'fa_tick').length}`);
        check('1.3e 轮2 后水位推进到全局 max（含异平台行 13）', consumer.getWatermarks().ticks === 13, `w=${consumer.getWatermarks().ticks}`);
        await consumer._pollLoop(); // 轮3：无新行，不重读不回退
        check('1.3f 空轮 FA 调用不再增加', orderLog.filter(e => e[0] === 'fa_tick').length === 2);
        check('1.3g 空轮水位不回退', consumer.getWatermarks().ticks === 13);
    }

    // ── 1.4 minTickBnb 门：尘 tick 不进 FA，水位照推 ──
    {
        const db = freshDb();
        const orderLog = [];
        const consumer = manualConsumer(db, { factorAggregator: mockFa(orderLog) });
        await consumer._pollLoop(); // 对齐
        db.tables.wss_price_ticks.push(tickRow(1, '0xDUST', 'fourmeme', { bnb_amount: 0.0001 }));
        await consumer._pollLoop();
        await consumer._pollLoop();
        check('1.4a 尘 tick 不进 FA', !orderLog.some(e => e[0] === 'fa_tick' && e[1] === '0xDUST'));
        check('1.4b 尘 tick 计入 skippedDust', consumer.stats.ticksSkippedDust >= 1);
        check('1.4c 尘 tick 水位照推', consumer.getWatermarks().ticks === 1, `w=${consumer.getWatermarks().ticks}`);
    }

    // ── 1.5 priceOutlier 回写：正确 id 批量 UPDATE ──
    {
        const db = freshDb();
        const orderLog = [];
        const consumer = manualConsumer(db, { factorAggregator: mockFa(orderLog) });
        await consumer._pollLoop(); // 对齐
        db.tables.wss_price_ticks.push(tickRow(1, '0xA'), tickRow(2, '0xB', 'fourmeme', { tx_hash: '0xOUT' }));
        await consumer._pollLoop();
        const upd = db.updates.find(u => u.table === 'wss_price_ticks');
        check('1.5 离群价行批量回写 price_outlier=true（仅命中行）',
            upd && upd.payload.price_outlier === true && upd.ids.length === 1 && upd.ids[0] === 2,
            JSON.stringify(db.updates));
    }

    // ── 1.6 heartbeat：只推水位不派发，lastIngestAt 刷新 ──
    {
        const db = freshDb();
        const orderLog = [];
        const consumer = manualConsumer(db, { factorAggregator: mockFa(orderLog), onTokenCreate: (i) => orderLog.push(['engine_new', i.token]) });
        await consumer._pollLoop(); // 对齐
        db.tables.wss_events.push({ id: 1, kind: 'heartbeat', platform: 'watcher', token_address: null, payload: { at: 1 }, block_time: null, created_at: new Date().toISOString() });
        await consumer._pollLoop();
        await consumer._pollLoop(); // 延迟一周期：第二应用轮后再一轮才提交水位
        check('1.6a heartbeat 不派发 token_create', !orderLog.some(e => e[0] === 'engine_new'));
        check('1.6b heartbeat 刷新 lastIngestAt（断供判据）', consumer.getLastIngestAt() !== null);
        check('1.6c heartbeat 推进 events 水位', consumer.getWatermarks().events === 1, `w=${consumer.getWatermarks().events}`);
    }

    // ── 1.7 单行应用错误：log 跳过、水位照推、后续行不受影响 ──
    {
        const db = freshDb();
        const orderLog = [];
        const consumer = manualConsumer(db, {
            factorAggregator: mockFa(orderLog),
            onTokenCreate: (i) => { if (i.token === '0xBAD') throw new Error('boom'); orderLog.push(['engine_new', i.token]); },
        });
        await consumer._pollLoop(); // 对齐
        db.tables.wss_events.push(evCreateRow(1, '0xBAD'), evCreateRow(2, '0xOK'));
        await consumer._pollLoop();
        await consumer._pollLoop();
        check('1.7a 坏行不中断（引擎回调收到但抛错被跳过）',
            orderLog.some(e => e[0] === 'engine_new' && e[1] === '0xOK'));
        check('1.7b 坏行后水位照推（不卡死重扫）', consumer.getWatermarks().events === 2, `w=${consumer.getWatermarks().events}`);
    }

    // ── 1.8 start/stop 生命周期：stop 幂等、interval 清理 ──
    {
        const db = freshDb();
        const consumer = new SharedTickConsumer({
            platform: 'fourmeme', pollIntervalMs: 20, minTickBnb: 0.001,
            factorAggregator: mockFa([]), logger: silentLogger, experimentId: 'test',
        });
        await consumer.start(); // dbManager 已打桩 → mock client
        await new Promise(r => setTimeout(r, 80));
        const loopsAfterRun = consumer.stats.pollLoops + consumer.stats.pollErrors;
        check('1.8a start 后轮询在跑', loopsAfterRun > 0, `loops=${loopsAfterRun}`);
        await consumer.stop();
        await consumer.stop(); // 幂等
        const loopsAtStop = consumer.stats.pollLoops + consumer.stats.pollErrors;
        await new Promise(r => setTimeout(r, 80));
        check('1.8b stop 后轮询停止（幂等）',
            consumer.stats.pollLoops + consumer.stats.pollErrors === loopsAtStop);
    }
}

// ═══════════════ 2. collector dryRun 语义 ═══════════════

async function testCollectorDryRun() {
    console.log('\n━━━ 2. collector dryRun ━━━');
    const { FourMemeAnkrWsCollector } = require('../src/collectors/fourmeme-ankr-ws-collector');

    const mkRow = (id) => ({
        experiment_id: null, token_address: `0xt${id}`, tx_hash: `0xh${id}`, log_index: 0,
        trade_type: 'buy', trader_address: '0xtr', price_bnb: 1e-9, price_usd: 0.001,
        bnb_amount: 0.01, token_amount: 1e6, price_outlier: false, block_number: 1,
        block_time: new Date().toISOString(), received_at: new Date().toISOString(), platform: 'fourmeme',
    });

    // dryRun=true：丢缓冲零 upsert
    {
        const db = freshDb();
        dbManager.client = db.client; // collector _flushTickBuffer 惰性取 dbManager.getClient()
        const col = new FourMemeAnkrWsCollector({ fourmemeWs: { dryRun: true } }, silentLogger, null, null, {});
        col._tickBuffer.push(mkRow(1), mkRow(2));
        await col._flushTickBuffer();
        check('2a dryRun=true 缓冲丢弃且零 upsert', col._tickBuffer.length === 0 && db.upserts.length === 0);
    }

    // 缺省（watcher 模式）：upsert 收到 experiment_id:null
    {
        const db = freshDb();
        dbManager.client = db.client;
        const col = new FourMemeAnkrWsCollector({ fourmemeWs: {} }, silentLogger, null, null, {});
        col._tickBuffer.push(mkRow(1));
        await col._flushTickBuffer();
        const up = db.upserts[0];
        check('2b 缺省模式写库且 experiment_id=null',
            up && up.table === 'wss_price_ticks' && up.rows.length === 1 && up.rows[0].experiment_id === null,
            JSON.stringify(db.upserts.map(u => u.rows.map(r => r.experiment_id))));
    }
}

// ═══════════════ 3. BacktestEngine._loadWssTicks ═══════════════

async function testBacktestLoadTicks() {
    console.log('\n━━━ 3. BacktestEngine._loadWssTicks ━━━');
    const { BacktestEngine } = require('../src/trading-engine/implementations/BacktestEngine');

    // 250 token → 3 批（100/100/50）；tick id 跨批交错（批1 token 的 id 与批2 交错）→ 归并验证
    const tokens = [];
    for (let i = 0; i < 250; i++) tokens.push(`0xtok${String(i).padStart(3, '0')}`);
    const db = freshDb();
    for (let i = 0; i < tokens.length; i++) {
        // id 与批序反着排：批 2（i=100..199）的 id 反而小 → 各批内部升序但块间乱序
        db.tables.wss_price_ticks.push(tickRow(1000 - i * 2, tokens[i], 'fourmeme'));
    }
    // 异平台行（同 token 不同 platform——flap 不应被 fourmeme 回测捞入）
    db.tables.wss_price_ticks.push(tickRow(2001, tokens[0], 'flap'));
    db.tables.wss_price_ticks.push(tickRow(2002, tokens[249], 'flap'));

    const be = Object.create(BacktestEngine.prototype);
    be._tokenMeta = new Map(tokens.map(t => [t, {}]));
    be._ticks = [];
    be._platform = 'fourmeme';
    be._startTimeFilter = null;
    be._endTimeFilter = null;
    be.metrics = { processedDataPoints: 0 };
    be._getClient = () => db.client;
    await be._loadWssTicks();

    const ids = be._ticks.map(t => Number(t.tx_hash.replace('0xtx', '')));
    const sorted = [...ids].sort((a, b) => a - b);
    check('3a 分块乱序 id → 全局 id 升序', JSON.stringify(ids) === JSON.stringify(sorted),
        `head=${ids.slice(0, 5)} tail=${ids.slice(-5)}`);
    check('3b platform 过滤（flap 行不入）', be._ticks.length === 250, `n=${be._ticks.length}`);
    check('3c processedDataPoints = 查询返回行数（服务端 platform 过滤后 250）',
        be.metrics.processedDataPoints === 250, `p=${be.metrics.processedDataPoints}`);

    // 时间窗内存过滤（id=1000-2i，i=0..249 → 1000..502；ts=1700000000000+id，起点 800 → id≥800 即前 101 行）
    const be2 = Object.create(BacktestEngine.prototype);
    be2._tokenMeta = new Map(tokens.map(t => [t, {}]));
    be2._ticks = [];
    be2._platform = 'fourmeme';
    be2._startTimeFilter = 1700000000800;
    be2._endTimeFilter = null;
    be2.metrics = { processedDataPoints: 0 };
    be2._getClient = () => db.client;
    await be2._loadWssTicks();
    check('3d 时间窗内存过滤生效', be2._ticks.every(t => t.timestamp >= be2._startTimeFilter) && be2._ticks.length === 101,
        `n=${be2._ticks.length}`);
}

// ═══════════════ 4. 引擎接线冒烟 ═══════════════

async function testEngineWiring() {
    console.log('\n━━━ 4. 引擎接线冒烟（FourMemeWssTradingEngine + SharedTickConsumer）━━━');
    const entities = require('../src/trading-engine/entities');
    entities.TradeSignal.prototype.save = async function () { this.id = `mock-sig-${this.id || 'x'}`; return this.id; };
    entities.Trade.prototype.save = async function () { this.id = `mock-trade-${this.id || 'x'}`; return this.id; };

    const { FourMemeWssTradingEngine } = require('../src/trading-engine/implementations/FourMemeWssTradingEngine');
    const engine = new FourMemeWssTradingEngine({ tradingMode: 'virtual', initialBalance: 1 });
    engine._experiment = {
        id: 'wiring-test',
        config: {
            platform: 'fourmeme',
            strategiesConfig: {
                buyStrategies: [{ priority: 1, condition: 'earlyReturn > 100 AND age < 10' }],
                sellStrategies: [{ priority: 1, condition: 'profitPercent > 40' }],
            },
            tradeAmount: 0.1,
            fourmemeWs: { corpusEnrich: { enabled: false } }, // 关语料补采（零网络）
        },
    };
    engine._experimentId = 'wiring-test';
    engine.logger = silentLogger;
    engine._logger = silentLogger;
    const savedTokens = [];
    engine.dataService = {
        saveToken: async (expId, t) => { savedTokens.push({ expId, token: t.token, platform: t.platform }); return true; },
        updateTokenStatus: async () => true,
        getTrades: async () => [],
    };
    engine._updateSignalStatus = async () => {};
    engine._updateSignalMetadata = async () => {};

    await engine._initializeComponents();
    await engine._initializeDataSources(); // 建 consumer（dbManager 已打桩 → wallets 空名单）

    check('4a 引擎持有 consumer（collector 已删）', !!engine._consumer && !engine._collector);
    check('4b consumer 平台=引擎平台', engine._consumer._platform === 'fourmeme');

    // 用真实引擎 FA 的 factorsUpdated 计数观测 tick 链路
    const faTicksBefore = engine.metrics.factorsUpdatedCount;
    const consumer = engine._consumer;
    consumer._supabase = activeDb.client;

    // 空表对齐一轮（首拉 max(id) 对齐语义：对齐后到达的行才算「新行」）
    await consumer._pollLoop();

    // 驱动一轮：token_create + tick + graduation + heartbeat
    activeDb.tables.wss_events.push(
        evCreateRow(101, '0xWIRE'),
        { id: 102, kind: 'graduation', platform: 'fourmeme', token_address: '0xWIRE',
          payload: { token: '0xWIRE', fundsBnb: 5, blockNumber: 9, blockTimeMs: 1700000000000, txHash: '0xgrad' },
          block_time: null, created_at: new Date().toISOString() },
        { id: 103, kind: 'heartbeat', platform: 'watcher', token_address: null, payload: {}, block_time: null, created_at: new Date().toISOString() },
    );
    activeDb.tables.wss_price_ticks.push(tickRow(201, '0xWIRE'));
    await consumer._pollLoop();
    await consumer._pollLoop();

    check('4c token_create → 引擎 _handleNewToken → saveToken(platform=fourmeme)',
        savedTokens.some(t => t.token === '0xWIRE' && t.platform === 'fourmeme' && t.expId === 'wiring-test'),
        JSON.stringify(savedTokens));
    check('4d tick → FA.processTick → factorsUpdated（引擎链路通）',
        engine.metrics.factorsUpdatedCount > faTicksBefore, `before=${faTicksBefore} after=${engine.metrics.factorsUpdatedCount}`);
    const gradState = engine._factorAggregator.getTokenState('0xWIRE');
    check('4e graduation → FA.markGraduated', gradState && gradState.graduated === true, JSON.stringify({ graduated: gradState?.graduated }));

    // base 构造器 _isStopped=true、start() 才置 false；冒烟未走 start()，手动放开以测 stop 全链
    engine._isStopped = false;
    await engine.stop(); // consumer.stop + intervals 清理（stop 全链不抛错即过）
    check('4f engine.stop() 清理完成（consumer 停止）', consumer._stopped);
}

// ═══════════════ main ═══════════════

(async () => {
    await testSharedTickConsumer();
    await testCollectorDryRun();
    await testBacktestLoadTicks();
    await testEngineWiring();
    console.log(`\n━━━ 结果: ${passed} 通过 / ${failed} 失败 ━━━`);
    process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
    console.error('❌ 测试脚本异常:', err.stack || err);
    process.exit(1);
});
