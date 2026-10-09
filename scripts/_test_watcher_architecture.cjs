#!/usr/bin/env node
/**
 * watcher 架构本地零 DB 单测（打桩 dbManager 单例 client，不连任何真实服务）：
 *
 *  1. SharedTickConsumer：首水位对齐不吃启动前行 / 先 events 后 ticks / 本地 platform
 *     过滤且水位推进含异平台行 / 水位延迟一周期 + 去重集（FA tick 不翻倍）/ minTickBnb
 *     门 / priceOutlier 回写 / heartbeat 只推水位 / 空轮不回退 / 单行错误跳过 / stop 幂等 /
 *     双平台集合（两平台行都派发 onTokenCreate(info, platform)，flap totalSupply 特判）
 *  2. collector dryRun 语义：dryRun=true 丢缓冲零 upsert；缺省 upsert 收 experiment_id:null
 *  3. BacktestEngine._loadWssTicks：token 集合 + platform 口径、分块乱序 id 全局归并、时间窗过滤、
 *     双平台并集（resolvePlatforms('both') → .in 并集回捞 flap 行）
 *
 * 2026-10-09 watcher 废除回迁：原第 4 节（引擎接线冒烟）断言的 consumer 接线已废除，
 * 功能断言（双平台分派/Flap 子类黄金字段/live fail-fast）已迁
 * _test_embedded_collector_architecture.cjs E 节；本文件随 watcher 退役倒计时（Phase 4 整文件删）
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

/** flap TokenCreated 事件行（payload 含 flap 特有存档字段：nonce/eventTsSec/meta/taxToken） */
function evFlapCreateRow(id, token) {
    return {
        id, kind: 'token_create', platform: 'flap', token_address: token,
        payload: {
            creator: '0xflapcreator', token, name: `F${id}`, symbol: `F${id}`,
            blockNumber: 1,
            blockTimeMs: 1700000000000 + id, txHash: `0xevf${id}`,
            nonce: id, eventTsSec: 1700000000 + id, meta: `ipfs://Qm${id}`,
            taxToken: `0xtax${id}7777`,
        },
        block_time: null, created_at: new Date().toISOString(),
    };
}

/** 事件+tick 双路观测的 FA mock（register/processTick 调用序进 orderLog；register 记录 info 供 totalSupply 断言） */
function mockFa(orderLog) {
    return {
        registerToken: (token, info) => orderLog.push(['fa_register', token, info]),
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

    // ── 1.9 双平台消费：两平台行都派发（onTokenCreate 第二参=行平台）；单平台集合回归 ──
    {
        const db = freshDb();
        const orderLog = [];
        const poolAdds = [];
        const consumer = manualConsumer(db, {
            platforms: ['fourmeme', 'flap'],
            factorAggregator: mockFa(orderLog),
            tokenPool: { getToken: () => null, addToken: (t) => poolAdds.push(t) },
            onTokenCreate: (info, platform) => orderLog.push(['engine_new', info.token, platform]),
        });
        await consumer._pollLoop(); // 对齐
        const fmEv = evCreateRow(1, '0xFM');
        fmEv.payload.totalSupply = 5e8; // 与 flap 固定 1e9 区分，验证特判分支
        db.tables.wss_events.push(fmEv, evFlapCreateRow(2, '0xFL'));
        db.tables.wss_price_ticks.push(tickRow(1, '0xFM', 'fourmeme'), tickRow(2, '0xFL', 'flap'));
        await consumer._pollLoop();
        check('1.9a 双平台 token_create 均派发（第二参=行平台）',
            orderLog.some(e => e[0] === 'engine_new' && e[1] === '0xFM' && e[2] === 'fourmeme')
            && orderLog.some(e => e[0] === 'engine_new' && e[1] === '0xFL' && e[2] === 'flap'),
            JSON.stringify(orderLog.filter(e => e[0] === 'engine_new')));
        const fmReg = orderLog.find(e => e[0] === 'fa_register' && e[1] === '0xFM');
        const flReg = orderLog.find(e => e[0] === 'fa_register' && e[1] === '0xFL');
        check('1.9b registerToken totalSupply：fourmeme 用 payload 值，flap 恒 1e9（固定总量）',
            fmReg?.[2]?.totalSupply === 5e8 && flReg?.[2]?.totalSupply === 1e9,
            JSON.stringify({ fm: fmReg?.[2]?.totalSupply, fl: flReg?.[2]?.totalSupply }));
        check('1.9c tokenPool.addToken platform 按事件行',
            poolAdds.find(t => t.token === '0xFM')?.platform === 'fourmeme'
            && poolAdds.find(t => t.token === '0xFL')?.platform === 'flap');
        check('1.9d 双平台 tick 均应用', consumer.stats.ticksApplied === 2, `applied=${consumer.stats.ticksApplied}`);

        // 单平台回归：platforms:['flap'] 时 fourmeme 行 skip 不派发
        const db2 = freshDb();
        const orderLog2 = [];
        const consumer2 = manualConsumer(db2, {
            platforms: ['flap'],
            factorAggregator: mockFa(orderLog2),
            onTokenCreate: (info, platform) => orderLog2.push(['engine_new', info.token, platform]),
        });
        await consumer2._pollLoop();
        db2.tables.wss_events.push(evCreateRow(1, '0xFM'), evFlapCreateRow(2, '0xFL'));
        db2.tables.wss_price_ticks.push(tickRow(1, '0xFM', 'fourmeme'), tickRow(2, '0xFL', 'flap'));
        await consumer2._pollLoop();
        check('1.9e flap-only：fourmeme 行 skip 不派发',
            !orderLog2.some(e => e[1] === '0xFM') && orderLog2.some(e => e[0] === 'engine_new' && e[1] === '0xFL' && e[2] === 'flap'),
            JSON.stringify(orderLog2.filter(e => e[0] === 'engine_new')));
        check('1.9f flap-only：skip 计数（event+tick 各 1）',
            consumer2.stats.eventsSkippedPlatform === 1 && consumer2.stats.ticksSkippedPlatform === 1,
            JSON.stringify(consumer2.stats));
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
    be._platforms = ['fourmeme'];
    be._startTimeFilter = null;
    be._endTimeFilter = null;
    be._experiment = { config: { backtest: { cacheEnabled: false } } }; // 本节测直拉装载逻辑
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
    be2._platforms = ['fourmeme'];
    be2._startTimeFilter = 1700000000800;
    be2._endTimeFilter = null;
    be2._experiment = { config: { backtest: { cacheEnabled: false } } };
    be2.metrics = { processedDataPoints: 0 };
    be2._getClient = () => db.client;
    await be2._loadWssTicks();
    check('3d 时间窗内存过滤生效', be2._ticks.every(t => t.timestamp >= be2._startTimeFilter) && be2._ticks.length === 101,
        `n=${be2._ticks.length}`);

    // 双平台并集（resolvePlatforms 归一化 + 'both' → .in 并集回捞 flap 行）
    const { resolvePlatforms } = require('../src/trading-engine/core/platforms');
    check('3e resolvePlatforms 归一化（both/flap/缺省）',
        JSON.stringify(resolvePlatforms('both')) === '["fourmeme","flap"]'
        && JSON.stringify(resolvePlatforms('flap')) === '["flap"]'
        && JSON.stringify(resolvePlatforms(undefined)) === '["fourmeme"]'
        && JSON.stringify(resolvePlatforms('fourmeme')) === '["fourmeme"]');
    const be3 = Object.create(BacktestEngine.prototype);
    be3._tokenMeta = new Map(tokens.map(t => [t, {}]));
    be3._ticks = [];
    be3._platforms = resolvePlatforms('both');
    be3._startTimeFilter = null;
    be3._endTimeFilter = null;
    be3._experiment = { config: { backtest: { cacheEnabled: false } } };
    be3.metrics = { processedDataPoints: 0 };
    be3._getClient = () => db.client;
    await be3._loadWssTicks();
    const ids3 = be3._ticks.map(t => Number(t.tx_hash.replace('0xtx', '')));
    const sorted3 = [...ids3].sort((a, b) => a - b);
    check('3f 双平台并集（250 fourmeme + 2 flap 全入，全局 id 归并）',
        be3._ticks.length === 252 && JSON.stringify(ids3) === JSON.stringify(sorted3),
        `n=${be3._ticks.length}`);
    check('3g tick 行带 platform（flap 2 行可辨）',
        be3._ticks.filter(t => t.platform === 'flap').length === 2
        && be3._ticks.filter(t => t.platform === 'fourmeme').length === 250);
}

// ═══════════════ 2.5 flap quoteRate 三级换算源（V2 → V3/WBNB → V3/USDT 中转）═══════════════

async function testFlapQuoteRateFallback() {
    console.log('\n━━━ 2.5 flap quoteRate 三级换算源 ━━━');
    const { FlapAnkrWsCollector } = require('../src/collectors/flap-ankr-ws-collector');
    const { ethers } = require('ethers');
    const coder = ethers.AbiCoder.defaultAbiCoder();

    const QUOTE = '0x41333df9e7639188bbfca5522dc4844398af9f9e';
    const V2F = '0xca143ce32fe78f1f7019d7d551a6402fc5350c73';
    const V3F = '0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865';
    const POOL_V2 = '0x' + 'aa'.repeat(20);
    const POOL_V3_WBNB_500 = '0x' + 'bb'.repeat(20);
    const POOL_V3_WBNB_2500 = '0x' + 'cc'.repeat(20);
    const POOL_V3_USDT_2500 = '0x' + 'dd'.repeat(20);

    const sel = (sig) => ethers.id(sig).slice(0, 10);
    const S = {
        getPair: sel('getPair(address,address)'),
        getPool: sel('getPool(address,address,uint24)'),
        getReserves: sel('getReserves()'),
        token0: sel('token0()'),
        slot0: sel('slot0()'),
        liquidity: sel('liquidity()'),
    };
    const encAddr = (a) => coder.encode(['address'], [a]);
    const sqrtOf = (raw) => BigInt(Math.round(Math.sqrt(raw) * 1e12)) * (2n ** 96n) / (10n ** 12n);

    /**
     * 构造打桩 collector：真实 ethers.Contract + 假 provider.send。
     * 路由按 (to, match(data)) 匹配——getPool 同 selector 四 fee 档靠 calldata 的
     * other 地址参数与 fee 尾缀区分。未打桩的调用直接 throw——天然验证
     * 「不该发生的源不被触碰」。
     */
    const mk = (routes, bnbUsd) => {
        const col = new FlapAnkrWsCollector({ flapWs: {} }, silentLogger, null, null, {});
        col._pcsProvider = {
            // ethers v6 Contract staticCall 走 provider.call(tx)（AbstractProvider.call 接口）
            call: async (tx) => {
                const to = (tx.to || '').toLowerCase();
                const data = (tx.data || '').toLowerCase();
                const r = routes.find((x) => x.to === to && x.match(data));
                if (!r) throw new Error(`unstubbed eth_call to=${to} data=${data.slice(0, 10)}`);
                return r.enc;
            },
        };
        col._pcsFactoryContract = new ethers.Contract(V2F,
            ['function getPair(address,address) view returns (address)'], col._pcsProvider);
        col._pcsV3FactoryContract = new ethers.Contract(V3F,
            ['function getPool(address,address,uint24) view returns (address)'], col._pcsProvider);
        col._quoteDecimalsCache.set(QUOTE, 18);
        col._bnbUsd = bnbUsd;
        return col;
    };
    const R = (to, match, enc) => ({ to: to.toLowerCase(), match, enc });
    const bySel = (s) => (data) => data.startsWith(s);
    const feePad = (fee) => fee.toString(16).padStart(64, '0');
    // getPool(quote, other, fee) 的 calldata 谓词（other 地址去 0x 小写包含匹配 + fee 尾缀全等）
    const getPoolOf = (other, fee) => (data) =>
        data.startsWith(S.getPool) && data.includes(other.toLowerCase().slice(2)) && data.endsWith(feePad(fee));
    const ZERO_POOL = encAddr(ethers.ZeroAddress);

    // 2.5a V2 命中：不触 V3（V3 factory 无路由，触碰即 throw）
    {
        const col = mk([
            R(V2F, bySel(S.getPair), encAddr(POOL_V2)),
            R(POOL_V2, bySel(S.getReserves), coder.encode(['uint112', 'uint112', 'uint32'], [1n * 10n ** 18n, 2n * 10n ** 17n, 0])),
            R(POOL_V2, bySel(S.token0), encAddr(QUOTE)),
        ], 600);
        const rate = await col._fetchQuoteRateFromRpc(QUOTE);
        check('2.5a V2 命中 rate=0.2 且不触 V3', Math.abs(rate - 0.2) < 1e-12, `rate=${rate}`);
    }

    // 2.5b wTCENTx 案复刻：V2 miss + V3/WBNB2500 零流动性挂价（不可信）+ V3/USDT2500 深池 → USDT 中转
    {
        const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
        const USDT = '0x55d398326f99059ff775485246999027b3197955';
        const col = mk([
            R(V2F, bySel(S.getPair), ZERO_POOL),
            R(V3F, getPoolOf(WBNB, 100), ZERO_POOL),
            R(V3F, getPoolOf(WBNB, 500), ZERO_POOL),
            R(V3F, getPoolOf(WBNB, 2500), encAddr(POOL_V3_WBNB_2500)),
            R(V3F, getPoolOf(WBNB, 10000), ZERO_POOL),
            R(POOL_V3_WBNB_2500, bySel(S.liquidity), coder.encode(['uint128'], [0n])), // 零流动性 → 挂价池被门槛拦下
            R(V3F, getPoolOf(USDT, 100), ZERO_POOL),
            R(V3F, getPoolOf(USDT, 500), ZERO_POOL),
            R(V3F, getPoolOf(USDT, 2500), encAddr(POOL_V3_USDT_2500)),
            R(V3F, getPoolOf(USDT, 10000), ZERO_POOL),
            R(POOL_V3_USDT_2500, bySel(S.liquidity), coder.encode(['uint128'], [1336541629862019616428216n])),
            R(POOL_V3_USDT_2500, bySel(S.slot0), coder.encode(
                ['uint160', 'int24', 'uint16', 'uint16', 'uint16', 'uint8', 'bool'],
                [sqrtOf(54), 0, 0, 0, 0, 0, true])),
            R(POOL_V3_USDT_2500, bySel(S.token0), encAddr(QUOTE)),
        ], 600);
        const rate = await col._fetchQuoteRateFromRpc(QUOTE);
        check('2.5b V3/USDT 中转 rate=54/600=0.09（WBNB 零流动性挂价被门槛拦下）',
            rate != null && Math.abs(rate - 0.09) < 1e-12, `rate=${rate}`);
    }

    // 2.5c V3/WBNB 命中（token0=other 方向）：rate=1/raw；USDT 档不被触碰（无路由即 throw）
    {
        const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
        const col = mk([
            R(V2F, bySel(S.getPair), ZERO_POOL),
            R(V3F, getPoolOf(WBNB, 100), ZERO_POOL),
            R(V3F, getPoolOf(WBNB, 500), ZERO_POOL),
            R(V3F, getPoolOf(WBNB, 2500), encAddr(POOL_V3_WBNB_2500)),
            R(V3F, getPoolOf(WBNB, 10000), ZERO_POOL),
            R(POOL_V3_WBNB_2500, bySel(S.liquidity), coder.encode(['uint128'], [1n * 10n ** 18n])),
            R(POOL_V3_WBNB_2500, bySel(S.slot0), coder.encode(
                ['uint160', 'int24', 'uint16', 'uint16', 'uint16', 'uint8', 'bool'],
                [sqrtOf(0.5), 0, 0, 0, 0, 0, true])),
            R(POOL_V3_WBNB_2500, bySel(S.token0), encAddr(ethers.ZeroAddress)), // token0=WBNB(other)
        ], 600);
        const rate = await col._fetchQuoteRateFromRpc(QUOTE);
        // raw=(sqrtP/2^96)^2=0.5=quote_raw/WBNB_raw（18/18）→ WBNB per quote=1/0.5=2
        check('2.5c V3/WBNB token0=other 方向 rate=1/0.5=2', rate != null && Math.abs(rate - 2) < 1e-9, `rate=${rate}`);
    }

    // 2.5d 全 miss → null（上游负缓存路径语义）
    {
        const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
        const USDT = '0x55d398326f99059ff775485246999027b3197955';
        const routes = [R(V2F, bySel(S.getPair), ZERO_POOL)];
        for (const o of [WBNB, USDT]) for (const f of [100, 500, 2500, 10000]) routes.push(R(V3F, getPoolOf(o, f), ZERO_POOL));
        const col = mk(routes, 600);
        const rate = await col._fetchQuoteRateFromRpc(QUOTE);
        check('2.5d 三级全 miss → null', rate == null);
    }

    // 2.5e bnbUsd 未就绪：V2/V3-WBNB miss 时 USDT 中转不点火 → null（负缓存下周期重试）
    {
        const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
        const col = mk([
            R(V2F, bySel(S.getPair), ZERO_POOL),
            R(V3F, getPoolOf(WBNB, 100), ZERO_POOL),
            R(V3F, getPoolOf(WBNB, 500), ZERO_POOL),
            R(V3F, getPoolOf(WBNB, 2500), ZERO_POOL),
            R(V3F, getPoolOf(WBNB, 10000), ZERO_POOL),
        ], 0);
        const rate = await col._fetchQuoteRateFromRpc(QUOTE);
        check('2.5e bnbUsd=0 时 USDT 中转让位 → null', rate == null);
    }
}

// ═══════════════ main ═══════════════

(async () => {
    await testSharedTickConsumer();
    await testCollectorDryRun();
    await testFlapQuoteRateFallback();
    await testBacktestLoadTicks();
    console.log(`\n━━━ 结果: ${passed} 通过 / ${failed} 失败 ━━━`);
    process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
    console.error('❌ 测试脚本异常:', err.stack || err);
    process.exit(1);
});
