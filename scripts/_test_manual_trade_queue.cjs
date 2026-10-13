#!/usr/bin/env node
/**
 * 手工交易命令队列（P0-C 实盘前置批）零 DB 零网络单测
 *
 * 覆盖 FourMemeWssTradingEngine._consumeManualTrades / _processManualTradeRequest /
 * _executeManualBuy / _executeManualSell / _buyAmountFor：
 *   1. TTL 滞留分归因：pending>10min→expired（排队超时）/ executing>10min→failed
 *      （进程崩溃残留）——TTL 判定必须先于 status 判断（顺序 bug 事故反证）
 *   2. executing 未超时 skip（本进程上一轮执行中，防 interval 异步并发重复消费）
 *   3. CAS 抢占：status 已非 pending → claimed 空 → 不执行（防双进程）
 *   4. 策略互斥：_buyingTokens/_sellingTokens 命中 → 留 pending 下轮（不 CAS 不判失败）
 *   5. 手工买 fail-closed 双门：FA 无价拒（L1 锚缺失）/ pool 无票拒（状态无法推进）
 *   6. 买成功：manualAmountBnb 显式金额传递 + 状态推进三件套
 *      （markAsBought/updateTokenStatus/setBuyState）+ 终态 result 写回
 *   7. 卖成功：sell_pct 无效归 1 + 终态 qtySold/bnbReceived 写回
 *   8. 毕业票路由：FA graduated → _ensurePcsTrader（PCS V2 外盘）+ traderOverride 透传
 *   9. 手工卖无价容忍（与买不对称有意设计）：price=0 仍执行（应急清仓）
 *  10. _buyAmountFor 三分支：manualAmountBnb 最高优先（不经卡牌/tradeAmount）
 *  11. 源码口径断言（红线 13）：TTL-before-status 顺序 / 卡账本跳过条件 /
 *      interval 挂载形状（5s、live-only、_intervals.manualTrade）
 *
 * 执行原语（_executeBuyLive/_executeSell）在此打桩捕获入参——它们是策略路径
 * 同一执行原语（有自己的链路测试），本测聚焦队列/互斥/门/写回语义。
 * trades 落库经 _executeBuyLive 内 Trade.save（打桩后不经过，meta 的
 * isManualTrade/manualRequestId 断言覆盖传递链）。
 *
 * 运行：node scripts/_test_manual_trade_queue.cjs
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

// ═══════════════ dbManager 单例打桩（必须在被测模块 require 前完成）═══════════════
const { dbManager } = require(path.join(ROOT, 'src/services/dbManager'));

/**
 * manual_trade_requests 表 mock（真 CAS 语义：update 谓词不匹配 → data:[]）
 * 链式形状与生产用法一一对应：select/eq/in/order/limit/update(+.select)/insert
 */
class MockQuery {
    constructor(db, table) {
        this.db = db; this.table = table;
        this._eqs = {}; this._ins = {}; this._lim = null;
        this._upd = null; this._insertRows = null;
    }
    select() { return this; }
    eq(col, v) { this._eqs[col] = v; return this; }
    in(col, vals) { this._ins[col] = vals; return this; }
    order() { return this; } // 单测逐行注入，顺序无关
    limit(n) { this._lim = n; return this; }
    update(payload) { this._upd = payload; return this; }
    insert(rows) { this._insertRows = rows; return this; }
    then(resolve) { resolve(this._exec()); }
    _match() {
        let rows = this.db.tables[this.table] || [];
        for (const [c, v] of Object.entries(this._eqs)) rows = rows.filter(r => r[c] === v);
        for (const [c, vals] of Object.entries(this._ins)) rows = rows.filter(r => vals.includes(r[c]));
        if (this._lim != null) rows = rows.slice(0, this._lim);
        return rows;
    }
    _exec() {
        if (this._insertRows) {
            this.db.inserts.push({ table: this.table, rows: this._insertRows });
            return { data: this._insertRows, error: null };
        }
        if (this._upd) {
            const matched = this._match(); // CAS：谓词不匹配 = 空 data
            for (const r of matched) Object.assign(r, this._upd);
            this.db.updates.push({ table: this.table, payload: this._upd, matchedIds: matched.map(r => r.id) });
            return { data: matched.map(r => ({ id: r.id })), error: null };
        }
        return { data: this._match(), error: null };
    }
}

const db = {
    tables: { manual_trade_requests: [] },
    inserts: [], updates: [],
};
db.client = { from: (t) => new MockQuery(db, t) };
dbManager.isInitialized = true;
dbManager.client = db.client;

// ═══════════════ traders 工厂打桩（_ensurePcsTrader 懒加载路径）═══════════════
const pcsCreated = [];
const TRADERS_PATH = require.resolve(path.join(ROOT, 'src/trading-engine/traders'));
require.cache[TRADERS_PATH] = {
    id: TRADERS_PATH, filename: TRADERS_PATH, loaded: true,
    exports: {
        createTrader: (type, config) => {
            const t = {
                _type: type, _config: config, wallet: null,
                async setWallet(pk) { this.wallet = { address: '0xPCS' + String(pk).slice(-4), privateKey: pk }; },
            };
            pcsCreated.push(t);
            return t;
        },
    },
};

const { FourMemeWssTradingEngine } = require(path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine'));

// ═══════════════ 测试基建 ═══════════════
let passed = 0, failed = 0;
function ok(cond, label, detail) {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.error(`  ❌ ${label}${detail ? ` | ${detail}` : ''}`); }
}
const silentLogger = { info() {}, warn() {}, error() {}, debug() {}, setExperimentId() {} };

const TOKEN = '0xabc0000000000000000000000000000000000001';

/** 行工厂 */
function mkRow(overrides = {}) {
    return {
        id: `row-${db.tables.manual_trade_requests.length + 1}-${Math.random().toString(36).slice(2, 6)}`,
        experiment_id: 'exp-manual',
        token_address: TOKEN,
        direction: 'buy',
        amount_bnb: 0.05,
        sell_pct: 1,
        status: 'pending',
        requested_at: new Date().toISOString(),
        ...overrides,
    };
}

/**
 * 构造 live 引擎（只走构造器，不 initialize——手工交易方法组不依赖初始化组件），
 * 注入打桩 trader/FA/pool/dataService；execute 原语按需替换捕获。
 */
function mkEngine({ faPrice = 0, faGraduated = false, poolHasToken = true } = {}) {
    const engine = new FourMemeWssTradingEngine({ tradingMode: 'live', initialBalance: 100 });
    engine.logger = silentLogger;
    engine._experimentId = 'exp-manual';
    engine._isStopped = false;

    const calls = { markAsBought: [], updateTokenStatus: [], setBuyState: [], buyLive: [], sell: [] };
    engine._trader = { wallet: { address: '0xmain', privateKey: '0xPKMAIN' }, network: { rpcUrl: 'https://rpc.test' } };
    engine._factorAggregator = {
        buildFactorMap: () => (faPrice > 0 ? { currentPrice: faPrice } : null),
        getTokenState: () => ({
            symbol: 'MTT', graduated: faGraduated, currentPriceBnb: 0.001,
        }),
        setBuyState: (addr, s) => calls.setBuyState.push({ addr, ...s }),
    };
    engine._tokenPool = {
        getToken: (addr) => (poolHasToken ? { token: addr, symbol: 'MTT', status: 'monitoring', chain: 'bsc' } : null),
        markAsBought: (addr, chain, info) => calls.markAsBought.push({ addr, chain, ...info }),
    };
    engine.dataService = {
        updateTokenStatus: async (expId, addr, st) => calls.updateTokenStatus.push({ expId, addr, st }),
    };

    // 执行原语打桩（策略路径同一原语，本测聚焦队列语义）
    engine._executeBuyLive = async (signal, signalId, meta) => {
        calls.buyLive.push({ signal: { ...signal }, signalId, meta: { ...meta } });
        if (engine._buyLiveResult) return engine._buyLiveResult;
        return { success: true, tradeId: 'trade-1', txHash: '0xtx1', priceUsd: 0.000123 };
    };
    engine._executeSell = async (signal, signalId, meta, traderOverride) => {
        calls.sell.push({ signal: { ...signal }, signalId, meta: { ...meta }, traderOverride });
        if (engine._sellResult) return engine._sellResult;
        return { success: true, tradeId: 'trade-2', txHash: '0xtx2', qtySold: 12345.6, bnbReceived: 0.04, priceUsd: 0.00011 };
    };
    return { engine, calls };
}

/** 重置表 */
function resetTable() {
    db.tables.manual_trade_requests = [];
    db.updates = [];
    db.inserts = [];
    pcsCreated.length = 0;
}

async function main() {
    // ═══════════════ 1. TTL 滞留分归因 ═══════════════
    console.log('\n[1] TTL 滞留清理分归因');
    {
        resetTable();
        const { engine } = mkEngine();
        const stale = new Date(Date.now() - 11 * 60 * 1000).toISOString();
        db.tables.manual_trade_requests.push(mkRow({ id: 'r-pending-stale', status: 'pending', requested_at: stale }));
        db.tables.manual_trade_requests.push(mkRow({ id: 'r-exec-stale', status: 'executing', requested_at: stale }));

        await engine._consumeManualTrades();
        const rows = db.tables.manual_trade_requests;
        const p = rows.find(r => r.id === 'r-pending-stale');
        const e = rows.find(r => r.id === 'r-exec-stale');
        ok(p.status === 'expired' && p.error.includes('排队超时'), 'pending>10min → expired（排队超时归因）', JSON.stringify(p));
        ok(e.status === 'failed' && e.error.includes('执行中断'), 'executing>10min → failed（崩溃残留归因）', JSON.stringify(e));
        ok(engine._buyingTokens.size === 0, 'TTL 清理不进入执行路径');
    }

    // ═══════════════ 2. executing 未超时 skip ═══════════════
    console.log('\n[2] executing 未超时（本进程执行中）');
    {
        resetTable();
        const { engine, calls } = mkEngine();
        db.tables.manual_trade_requests.push(mkRow({ id: 'r-exec', status: 'executing' }));
        await engine._consumeManualTrades();
        const row = db.tables.manual_trade_requests[0];
        ok(row.status === 'executing', 'executing 未超时不清理不消费（保持 executing）');
        ok(calls.buyLive.length === 0, 'executing 行不重复执行');
    }

    // ═══════════════ 3. CAS 抢占防双进程 ═══════════════
    console.log('\n[3] CAS 抢占（防双进程消费）');
    {
        resetTable();
        const { engine, calls } = mkEngine({ faPrice: 0.001, poolHasToken: true });
        // 模拟他进程已抢：status 已是 executing（CAS eq('status','pending') 不匹配）
        db.tables.manual_trade_requests.push(mkRow({ id: 'r-claimed', status: 'executing' }));
        await engine._processManualTradeRequest(db.tables.manual_trade_requests[0], db.client);
        ok(calls.buyLive.length === 0, 'claimed 空 → 不执行（他进程已抢）');
        ok(db.tables.manual_trade_requests[0].status === 'executing', '行状态不被覆写');
    }

    // ═══════════════ 4. 策略互斥留 pending ═══════════════
    console.log('\n[4] 策略执行互斥（留 pending 下轮）');
    {
        resetTable();
        const { engine, calls } = mkEngine({ faPrice: 0.001 });
        engine._buyingTokens.add(TOKEN); // 策略买执行中
        const row = mkRow({ id: 'r-mutex' });
        db.tables.manual_trade_requests.push(row);
        await engine._processManualTradeRequest(row, db.client);
        ok(calls.buyLive.length === 0, '互斥命中不执行');
        ok(row.status === 'pending', '未 CAS 未判失败（留 pending 下轮重试）');

        // 卖互斥同构
        resetTable();
        const s = mkEngine({ faPrice: 0.001 });
        s.engine._sellingTokens.add(TOKEN);
        const sellRow = mkRow({ id: 'r-mutex-s', direction: 'sell' });
        db.tables.manual_trade_requests.push(sellRow);
        await s.engine._processManualTradeRequest(sellRow, db.client);
        ok(s.calls.sell.length === 0 && sellRow.status === 'pending', '卖互斥同构（留 pending）');
    }

    // ═══════════════ 5. 手工买 fail-closed 双门 ═══════════════
    console.log('\n[5] 手工买 fail-closed 双门');
    {
        // 门 1：FA 无价
        resetTable();
        {
            const { engine, calls } = mkEngine({ faPrice: 0 }); // FA 无价
            const row = mkRow({ id: 'r-noprice' });
            db.tables.manual_trade_requests.push(row);
            await engine._processManualTradeRequest(row, db.client);
            ok(row.status === 'failed' && row.error.includes('FA 无该 token 价格状态'), 'FA 无价拒绝（L1 预成交锚缺失）', row.error);
            ok(calls.buyLive.length === 0, '无价不进执行原语');
        }
        // 门 2：pool 无票
        resetTable();
        {
            const { engine, calls } = mkEngine({ faPrice: 0.001, poolHasToken: false });
            const row = mkRow({ id: 'r-nopool' });
            db.tables.manual_trade_requests.push(row);
            await engine._processManualTradeRequest(row, db.client);
            ok(row.status === 'failed' && row.error.includes('不在本实验监控池'), 'pool 无票拒绝（买后状态无法推进）', row.error);
            ok(calls.buyLive.length === 0, 'pool 无票不进执行原语');
        }
    }

    // ═══════════════ 6. 买成功：金额传递 + 状态推进 + 终态写回 ═══════════════
    console.log('\n[6] 手工买成功链');
    {
        resetTable();
        const { engine, calls } = mkEngine({ faPrice: 0.0001 });
        const row = mkRow({ id: 'r-buy', amount_bnb: 0.077 });
        db.tables.manual_trade_requests.push(row);
        await engine._processManualTradeRequest(row, db.client);

        ok(calls.buyLive.length === 1, '执行原语被调一次');
        const buy = calls.buyLive[0];
        ok(buy.signal.manualAmountBnb === 0.077, 'manualAmountBnb 显式金额传递（不经卡牌/tradeAmount）');
        ok(buy.meta.isManualTrade === true && buy.meta.manualRequestId === 'r-buy',
            'meta 带 isManualTrade/manualRequestId（trades metadata 链）');
        ok(buy.signal.strategyId === null && buy.signal.strategyName === '手工交易', '手工信号无策略标记');

        ok(row.status === 'success', '终态 success');
        ok(row.result.tradeId === 'trade-1' && row.result.txHash === '0xtx1' && row.result.priceUsd === 0.000123,
            'result 写回 tradeId/txHash/priceUsd');
        ok(calls.markAsBought.length === 1 && calls.markAsBought[0].buyPrice === 0.000123,
            '状态推进① markAsBought（实际成交价）');
        ok(calls.updateTokenStatus.length === 1 && calls.updateTokenStatus[0].st === 'bought',
            '状态推进② updateTokenStatus(bought)');
        ok(calls.setBuyState.length === 1 && calls.setBuyState[0].buyPriceUsd === 0.000123
            && calls.setBuyState[0].buyPriceBnb === 0.001, '状态推进③ FA setBuyState（成交价+BNB 锚）');
        ok(engine._buyingTokens.size === 0, '互斥 finally 释放');
    }

    // 买失败写回 error
    {
        resetTable();
        const { engine } = mkEngine({ faPrice: 0.0001 });
        engine._buyLiveResult = { success: false, reason: '链上余额不足' };
        const row = mkRow({ id: 'r-buyfail' });
        db.tables.manual_trade_requests.push(row);
        await engine._processManualTradeRequest(row, db.client);
        ok(row.status === 'failed' && row.error === '链上余额不足', '买失败写回 error');
        ok(row.result === undefined, '失败不写 result');
    }

    // ═══════════════ 7. 卖成功：sell_pct 归一 + 终态写回 ═══════════════
    console.log('\n[7] 手工卖成功链');
    {
        resetTable();
        const { engine, calls } = mkEngine({ faPrice: 0.0001 });
        const row = mkRow({ id: 'r-sell', direction: 'sell', amount_bnb: null, sell_pct: 0.5 });
        db.tables.manual_trade_requests.push(row);
        await engine._processManualTradeRequest(row, db.client);
        ok(calls.sell.length === 1, '卖执行原语被调');
        ok(calls.sell[0].signal.sellPercentage === 0.5, 'sell_pct 透传（0.5 余仓）');
        ok(row.status === 'success' && row.result.qtySold === 12345.6 && row.result.bnbReceived === 0.04,
            'result 写回 qtySold/bnbReceived');
        ok(calls.sell[0].traderOverride === null, '未毕业票不路由 PCS（traderOverride=null）');

        // sell_pct 脏值归 1
        resetTable();
        const s2 = mkEngine({ faPrice: 0.0001 });
        const row2 = mkRow({ id: 'r-sell-dirty', direction: 'sell', sell_pct: 'abc' });
        db.tables.manual_trade_requests.push(row2);
        await s2.engine._processManualTradeRequest(row2, db.client);
        ok(s2.calls.sell[0].signal.sellPercentage === 1, 'sell_pct 脏值归 1（全清兜底语义）');
    }

    // ═══════════════ 8. 毕业票路由 PCS ═══════════════
    console.log('\n[8] 毕业票手工卖路由 PCS V2 外盘');
    {
        resetTable();
        const { engine, calls } = mkEngine({ faPrice: 0, faGraduated: true }); // 断流毕业票：FA 无价
        const row = mkRow({ id: 'r-grad', direction: 'sell' });
        db.tables.manual_trade_requests.push(row);
        await engine._processManualTradeRequest(row, db.client);

        ok(pcsCreated.length === 1 && pcsCreated[0]._type === 'pancakeswap-v2',
            '_ensurePcsTrader 创建 PCS V2 trader（懒加载一次）');
        ok(pcsCreated[0]._config && pcsCreated[0]._config.network && pcsCreated[0]._config.network.rpcUrl === 'https://rpc.test',
            'PCS trader 继承主 trader 发单 RPC');
        ok(pcsCreated[0].wallet && pcsCreated[0].wallet.privateKey === '0xPKMAIN',
            'PCS trader 同钱包（私钥从既有 wallet 对象取）');
        ok(calls.sell.length === 1 && calls.sell[0].traderOverride === pcsCreated[0],
            'traderOverride = PCS trader 透传 _executeSell');

        // 懒加载缓存：同一引擎第二笔不再创建（引用复用）
        const firstPcs = pcsCreated[0];
        resetTable();
        db.tables.manual_trade_requests.push(mkRow({ id: 'r-grad2', direction: 'sell' }));
        await engine._processManualTradeRequest(db.tables.manual_trade_requests[0], db.client);
        ok(pcsCreated.length === 0 && engine._pcsTrader === firstPcs,
            '懒加载缓存（第二笔不再建 trader，_pcsTrader 引用复用）');
    }

    // ═══════════════ 9. 手工卖无价容忍（与买不对称=有意设计）═══════════════
    console.log('\n[9] 手工卖无价容忍（应急清仓不能因无价拒绝）');
    {
        resetTable();
        const { engine, calls } = mkEngine({ faPrice: 0, faGraduated: false });
        const row = mkRow({ id: 'r-sell-noprice', direction: 'sell' });
        db.tables.manual_trade_requests.push(row);
        await engine._processManualTradeRequest(row, db.client);
        ok(calls.sell.length === 1, '无价卖照常进执行原语');
        ok(calls.sell[0].signal.price === 0, 'signal.price=0（expectedNativeOut=null 走相对滑点锚降级）');
        ok(row.status === 'success', '无价卖不被拒');
    }

    // ═══════════════ 10. _buyAmountFor 三分支 ═══════════════
    console.log('\n[10] _buyAmountFor 金额优先级');
    {
        const { engine } = mkEngine();
        ok(engine._buyAmountFor({ manualAmountBnb: 0.033, cards: 5 }) === 0.033,
            'manualAmountBnb 最高优先（无视卡牌）');
        engine._cardsEnabled = true;
        engine._perCardBNB = 0.02;
        ok(engine._buyAmountFor({ cards: 3 }) === 0.06, '卡牌模式 = perCardBNB×张数');
        ok(engine._buyAmountFor({}) === 0.02, '卡牌模式无 cards 默认 1 张');
        engine._cardsEnabled = false;
        engine._tradeAmount = 0.1;
        ok(engine._buyAmountFor({}) === 0.1, '旧模式 = tradeAmount');
        // 手工金额非法（0/负/NaN）不进最高优先分支
        ok(engine._buyAmountFor({ manualAmountBnb: 0 }) === 0.1, 'manualAmountBnb=0 不劫持（回落 tradeAmount）');
        ok(engine._buyAmountFor({ manualAmountBnb: -1 }) === 0.1, 'manualAmountBnb<0 不劫持');
    }

    // ═══════════════ 11. 源码口径断言（红线 13：事故防线锁定）═══════════════
    console.log('\n[11] 源码口径断言');
    {
        const src = fs.readFileSync(path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');

        // 11.1 TTL 判定必须先于 status 判断（顺序 bug 反证：反了 executing 滞留行永远走不到清理）
        const ttlIdx = src.indexOf("Date.now() - new Date(row.requested_at).getTime() > TTL_MS");
        const statusIdx = src.indexOf("if (row.status !== 'pending') continue;");
        ok(ttlIdx > 0 && statusIdx > 0 && ttlIdx < statusIdx,
            'TTL 判定在 status 判断之前（executing 滞留清理可达）');

        // 11.2 卡账本跳过条件（手工显式金额不记卡）
        ok(src.includes('this._cardsEnabled && signal.manualAmountBnb == null'),
            '_executeBuyLive 卡账本条件含 manualAmountBnb==null（手工金额不记卡）');

        // 11.3 interval 挂载形状：live-only + 5s + _intervals.manualTrade（stop 统一清理）
        ok(src.includes('this._intervals.manualTrade = setInterval(') && src.includes('}, 5000);'),
            'manualTrade interval 挂 _intervals（stop 统一清理）+ 5s 周期');
        const liveSyncIdx = src.indexOf('this._intervals.liveSync = setInterval(');
        const manualIdx = src.indexOf('this._intervals.manualTrade = setInterval(');
        ok(liveSyncIdx > 0 && manualIdx > liveSyncIdx, 'interval 在 live 分支内（virtual 不消费队列）');

        // 11.4 CAS 抢占形状：update().eq(id).eq(status,pending)
        const casIdx = src.indexOf(".update({ status: 'executing' })");
        ok(casIdx > 0 && src.slice(casIdx, casIdx + 300).includes(".eq('status', 'pending')"),
            'CAS 抢占形状 update+eq(status,pending)（防双进程）');

        // 11.5 手工买卖不对称是刻意的：买拒无价、卖容忍无价（注释锁定语义）
        const buyGate = src.includes('L1 预成交锚缺失');
        const sellTolerant = src.includes('应急清仓');
        ok(buyGate && sellTolerant, '买卖不对称语义注释在源码（防未来"修复"成对称）');

        // 11.6 毕业票路由参数链：定义第 4 参默认 null + 手工卖显式透传（既有 3 参调用零影响）
        ok(src.includes('async _executeSell(signal, signalId = null, metadata = {}, traderOverride = null)'),
            '_executeSell 定义含 traderOverride 第 4 参（默认 null）');
        ok(src.includes('this._executeSell(signal, null, meta, traderOverride)'),
            '手工卖调用显式透传 traderOverride');
        ok(src.includes('this._executeSell(signal, signalId, metadata)'),
            '策略路径 3 参调用形状不变（默认 null 零影响）');
    }

    // ═══════════════ 12. 外部处置熔断分流（P1）═══════════════
    console.log('\n[12] 外部处置不计熔断连败');
    {
        // 走真 _executeSell（熔断分支在它内部）——只桩 _executeSellLive 与 holding
        const { engine } = mkEngine();
        engine._executeSell = FourMemeWssTradingEngine.prototype._executeSell;
        engine._applyWsConfig({}); // 初始化熔断参数默认值（阈值 5 / 长冷却 30min）
        engine._getHolding = (addr) => ({ tokenAddress: addr, amount: 100 });
        const alerts = [];
        engine._notifyLiveAlert = (title, msg) => alerts.push({ title, msg });

        const signal = { tokenAddress: '0xext1', symbol: 'EXT', chain: 'bsc', price: 0.001, sellPercentage: 1 };

        // 12a. externalDisposal → 不计连败 + 长冷却 + 告警
        engine._executeSellLive = async () => ({
            success: false, reason: '链上余额为 0（可能已外部处置），账面 100', externalDisposal: true,
        });
        let r = await engine._executeSell(signal);
        ok(r.success === false && r.externalDisposal === true, '外部处置失败原样返回');
        ok(!engine._sellFailStreak.has('0xext1'), '不计熔断连败（streak 无该 token）');
        const cd = engine._sellCooldownUntil.get('0xext1');
        ok(cd > Date.now() + 25 * 60 * 1000, `长冷却 ≥25min（熔断级静音，实际至 ${new Date(cd).toISOString()}）`);
        ok(alerts.length === 1 && /外部处置/.test(alerts[0].title), 'Telegram 告警「外部处置仓位」');

        // 12b. 对照：普通失败照常计连败（分流不误伤真熔断防线）
        alerts.length = 0;
        engine._executeSellLive = async () => ({ success: false, reason: 'execution reverted: K' });
        await engine._executeSell(signal);
        ok(engine._sellFailStreak.get('0xext1') === 1, '普通失败照常 +1 连败（真故障熔断防线不变）');
        ok(engine._sellCooldownUntil.get('0xext1') <= Date.now() + 2 * 60 * 1000, '普通失败短冷却 60s（非长冷却）');
        ok(alerts.length === 0, '连败 1/5 未到阈值不告警');

        // 12c. 源码口径：标记在 _executeSellLive 返回点 + 分流分支在连败计数之前
        const src = fs.readFileSync(path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');
        ok(src.includes(`reason: \`链上余额为 0（可能已外部处置），账面 \${amountToSell}\`, externalDisposal: true`),
            '_executeSellLive 链上 0 返回携带 externalDisposal 标记');
        const branchIdx = src.indexOf('if (result?.externalDisposal)');
        const streakIdx = src.indexOf('const streak = (this._sellFailStreak.get');
        ok(branchIdx > 0 && streakIdx > branchIdx, '分流分支在连败计数之前（事故防线：顺序错则分流失效）');
    }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('测试执行异常:', err);
    process.exit(1);
});
