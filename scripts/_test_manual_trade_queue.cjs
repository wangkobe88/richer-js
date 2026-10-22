#!/usr/bin/env node
/**
 * 手工交易命令队列零 DB 零网络单测（P0-C 实盘前置批；2026-10-22 双支持批扩）
 *
 * 覆盖 FourMemeWssTradingEngine._consumeManualTrades / _processManualTradeRequest /
 * _executeManualBuy / _executeManualSell / _saveManualSignal / _finalizeManualSignal /
 * _refreshManualSellLocks / _manualTradePriceUsd / _buyAmountFor / 卖出锁拦截：
 *   1. TTL 滞留分归因：pending>10min→expired（排队超时）/ executing>10min→failed
 *      （进程崩溃残留）——TTL 判定必须先于 status 判断（顺序 bug 事故反证）
 *   2. executing 未超时 skip（本进程上一轮执行中，防 interval 异步并发重复消费）
 *   3. CAS 抢占：status 已非 pending → claimed 空 → 不执行（防双进程）
 *   4. 策略互斥：_buyingTokens/_sellingTokens 命中 → 留 pending 下轮（不 CAS 不判失败）
 *   5. 手工买 fail-closed 双门：FA 无价拒（L1 锚缺失）/ pool 无票拒（状态无法推进）
 *   6. 买成功：manualAmountBnb 显式金额传递 + 状态推进三件套 + setBuyState 双口径键
 *      + strategy_signals 落行（isManualTrade/manualRequestId）+ 终态 executed 写回
 *   7. 卖成功：sell_pct 无效归 1 + 终态 qtySold/bnbReceived 写回
 *   8. 毕业票路由：FA graduated → _ensurePcsTrader（PCS V2 外盘）+ traderOverride 透传
 *   9. 手工卖无价容忍（live-only 有意设计）：live price=0 仍执行（应急清仓）；
 *      virtual 无价 fail-closed 拒（0 价卖出记 0 所得=脏数据）——双支持批翻转
 *  10. _buyAmountFor 三分支：manualAmountBnb 最高优先（不经卡牌/tradeAmount）
 *  11. 源码口径断言（红线 13）：TTL-before-status / 卡账本跳过条件 / interval 挂载
 *      形状（2s、双平台、_intervals.manualTrade）/ CAS 形状 / 买卖不对称注释
 *  12. 外部处置熔断分流：externalDisposal 不计连败
 *  13. virtual 引擎消费（_trader=null 不静默 return——双支持批）
 *  14. cards 买：signal.cards 透传无 manualAmountBnb（经卡牌计价）/ 未启用卡牌拒
 *  15. cards 卖 sizing：4卡卖1→0.25+cardTrade{1,4,3}；卖≥余卡→1+after=0；0 卡拒
 *  16. virtual 无价卖拒 + virtual 毕业票不路由 PCS（_trader 恒 null 防 TypeError）
 *  17. signal 终态 failed：执行失败 signal 行 executed=false + execution_status=failed
 *  18. 停止卖出锁：_refreshManualSellLocks 全量重建（增删票）/ _evaluateSellPath 与
 *      _emitSellSignal 双拦截点 / 手动队列卖不受锁（手动意志最高）
 *  19. _manualTradePriceUsd state 级回退：preFilter 出窗票 buildFactorMap=null 时
 *      读 getTokenState().currentPriceBnb×bnbUsd（手动买目标=引擎见过但策略窗已出）
 *
 * 执行原语（_executeBuyLive/_executeSell）在此打桩捕获入参——它们是策略路径
 * 同一执行原语（有自己的链路测试），本测聚焦队列/互斥/门/写回/signal 语义。
 * strategy_signals 落库经 TradeSignal.save()（mock insert 注入 id + 表持久化，
 * _updateSignalStatus UPDATE/缓存链全真走）。
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
 * manual_trade_requests / strategy_signals / experiment_tokens 表 mock
 * （真 CAS 语义：update 谓词不匹配 → data:[]；insert 注入 id 并持久化进表——
 * signal 落库→终态 UPDATE 链依赖同一表可见）
 * 链式形状与生产用法一一对应：select/eq/in/order/limit/update(+.select)/insert/single
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
    insert(rows) { this._insertRows = Array.isArray(rows) ? rows : [rows]; return this; }
    then(resolve) { resolve(this._exec()); }
    /** supabase .single()：select 场景取首行；0 行=PGRST116 error（生产语义，
     * 让 _updateSignalStatus 缓存 miss 兜底分支走 fetchError return） */
    async single() {
        const r = this._exec();
        const first = (r.data && r.data[0]) || null;
        return first
            ? { data: first, error: null }
            : { data: null, error: { message: 'PGRST116: 0 rows' } };
    }
    _match() {
        let rows = this.db.tables[this.table] || [];
        for (const [c, v] of Object.entries(this._eqs)) rows = rows.filter(r => r[c] === v);
        for (const [c, vals] of Object.entries(this._ins)) rows = rows.filter(r => vals.includes(r[c]));
        if (this._lim != null) rows = rows.slice(0, this._lim);
        return rows;
    }
    _exec() {
        if (this._insertRows) {
            for (const r of this._insertRows) {
                if (!r.id) r.id = this.db.nextId(this.table);
                (this.db.tables[this.table] = this.db.tables[this.table] || []).push(r);
            }
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
    tables: { manual_trade_requests: [], strategy_signals: [], experiment_tokens: [] },
    inserts: [], updates: [],
    _seq: 0,
    nextId(table) { return `${table === 'strategy_signals' ? 'sig' : 'row'}-${++this._seq}`; },
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
        cards: null,
        status: 'pending',
        requested_at: new Date().toISOString(),
        ...overrides,
    };
}

/**
 * 构造引擎（只走构造器，不 initialize——手工交易方法组不依赖初始化组件），
 * 注入打桩 trader/FA/pool/dataService；execute 原语按需替换捕获。
 * live=true（默认）：注入 _trader + 打桩 _executeBuyLive（统一入口分派到它）；
 * live=false（virtual）：不设 _trader + 打桩 _executeBuy（覆盖虚拟记账本体）。
 * bnbUsd 默认 0 = state 级回退失效（旧「FA 无价」语义）；>0 触发 T19 回退路径。
 */
function mkEngine({ live = true, faPrice = 0, faGraduated = false, poolHasToken = true, bnbUsd = 0 } = {}) {
    const engine = new FourMemeWssTradingEngine({
        tradingMode: live ? 'live' : 'virtual', initialBalance: 100,
    });
    engine.logger = silentLogger;
    engine._logger = silentLogger;
    engine._eventRecordingConfig.enabled = false; // 短路终态通知链（零网络）
    engine._experimentId = 'exp-manual';
    engine._isStopped = false;
    engine._getBnbUsd = () => bnbUsd;

    const calls = { markAsBought: [], updateTokenStatus: [], setBuyState: [], buyLive: [], buyVirtual: [], sell: [] };
    if (live) {
        engine._trader = { wallet: { address: '0xmain', privateKey: '0xPKMAIN' }, network: { rpcUrl: 'https://rpc.test' } };
    }
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

    // 执行原语打桩（策略路径同一原语，本测聚焦队列/signal 语义）。
    // live：保留真 _executeBuy 统一入口（顶部 _isLive 分派到打桩的 _executeBuyLive——
    // 分派形状本身是被测对象）；virtual：打桩 _executeBuy 覆盖虚拟记账本体
    engine._executeBuyLive = async (signal, signalId, meta) => {
        calls.buyLive.push({ signal: { ...signal }, signalId, meta: { ...meta } });
        if (engine._buyLiveResult) return engine._buyLiveResult;
        return { success: true, tradeId: 'trade-1', txHash: '0xtx1', priceUsd: 0.000123 };
    };
    if (!live) {
        engine._executeBuy = async (signal, signalId, meta) => {
            calls.buyVirtual.push({ signal: { ...signal }, signalId, meta: { ...meta } });
            if (engine._buyVirtualResult) return engine._buyVirtualResult;
            return { success: true, tradeId: 'trade-v', txHash: '0xtxv', priceUsd: 0.000123, priceBnb: 0.001 };
        };
    }
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
    db.tables.strategy_signals = [];
    db.tables.experiment_tokens = [];
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
        // 门 1：FA 无价（两级全 miss：factors null + bnbUsd=0 使 state 回退失效）
        resetTable();
        {
            const { engine, calls } = mkEngine({ faPrice: 0 }); // FA 无价
            const row = mkRow({ id: 'r-noprice' });
            db.tables.manual_trade_requests.push(row);
            await engine._processManualTradeRequest(row, db.client);
            ok(row.status === 'failed' && row.error.includes('FA 无该 token 价格状态'), 'FA 无价拒绝（L1 预成交锚缺失）', row.error);
            ok(calls.buyLive.length === 0, '无价不进执行原语');
            ok(db.tables.strategy_signals.length === 0, '门拒不留孤儿 signal 行（落库后置）');
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
            ok(db.tables.strategy_signals.length === 0, '门拒不留孤儿 signal 行');
        }
    }

    // ═══════════════ 6. 买成功：金额传递 + 状态推进 + signal 落行 + 终态 ═══════════════
    console.log('\n[6] 手工买成功链（live）');
    {
        resetTable();
        const { engine, calls } = mkEngine({ faPrice: 0.0001 });
        const row = mkRow({ id: 'r-buy', amount_bnb: 0.077 });
        db.tables.manual_trade_requests.push(row);
        await engine._processManualTradeRequest(row, db.client);

        ok(calls.buyLive.length === 1, '执行原语被调一次');
        const buy = calls.buyLive[0];
        ok(buy.signal.manualAmountBnb === 0.077, 'manualAmountBnb 显式金额传递（不经卡牌/tradeAmount）');
        ok(buy.meta.isManualTrade === true && buy.meta.manualRequestId === 'r-buy' && buy.meta.cards === null,
            'meta 带 isManualTrade/manualRequestId/cards（trades metadata 链）');
        ok(buy.meta.signalId === buy.signalId && buy.signalId === db.tables.strategy_signals[0].id,
            'signalId 透传 meta 并与落库行 id 一致（trades.signal_id 关联）');
        ok(buy.signal.strategyId === null && buy.signal.strategyName === '手工交易', '手工信号无策略标记');

        // signal 落行 + 终态 executed
        const sigs = db.tables.strategy_signals;
        ok(sigs.length === 1, 'strategy_signals 落一行');
        ok(sigs[0].reason === '手动买入（显式金额）' && sigs[0].metadata.isManualTrade === true
            && sigs[0].metadata.manualRequestId === 'r-buy' && sigs[0].metadata.cards === null,
            'signal 行 reason/metadata（isManualTrade/manualRequestId/cards）');
        ok(sigs[0].executed === true && sigs[0].metadata.execution_status === 'executed'
            && sigs[0].metadata.tradeResult.success === true,
            'signal 终态 executed（executed+execution_status+tradeResult）');

        ok(row.status === 'success', '终态 success');
        ok(row.result.tradeId === 'trade-1' && row.result.txHash === '0xtx1' && row.result.priceUsd === 0.000123,
            'result 写回 tradeId/txHash/priceUsd');
        ok(calls.markAsBought.length === 1 && calls.markAsBought[0].buyPrice === 0.000123,
            '状态推进① markAsBought（实际成交价）');
        ok(calls.updateTokenStatus.length === 1 && calls.updateTokenStatus[0].st === 'bought',
            '状态推进② updateTokenStatus(bought)');
        ok(calls.setBuyState.length === 1 && calls.setBuyState[0].buyPriceUsd === 0.000123
            && calls.setBuyState[0].buyPriceBnb === 0.001, '状态推进③ FA setBuyState（成交价+BNB 锚）');
        ok(Number.isFinite(calls.setBuyState[0].buySignalAt) && calls.setBuyState[0].buyExecutedPriceBnb === null,
            'setBuyState 双口径键（buySignalAt=signal 时间戳 / buyExecutedPriceBnb 缺省 null）');
        ok(engine._buyingTokens.size === 0, '互斥 finally 释放');
        ok(engine._signalRowCache.size === 0, 'signal 终态后进程内缓存 delete（有界）');
    }

    // 买失败写回 error（signal 终态 failed）
    {
        resetTable();
        const { engine } = mkEngine({ faPrice: 0.0001 });
        engine._buyLiveResult = { success: false, reason: '链上余额不足' };
        const row = mkRow({ id: 'r-buyfail' });
        db.tables.manual_trade_requests.push(row);
        await engine._processManualTradeRequest(row, db.client);
        ok(row.status === 'failed' && row.error === '链上余额不足', '买失败写回 error');
        ok(row.result === undefined, '失败不写 result');
        const sig = db.tables.strategy_signals[0];
        ok(sig && sig.executed === false && sig.metadata.execution_status === 'failed',
            '[17] 买失败 signal 终态 failed（executed=false+execution_status）');
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
        const sig = db.tables.strategy_signals[0];
        ok(sig && sig.reason === '手动卖出 100% 余仓' && sig.signal_type === 'SELL'
            && sig.metadata.execution_status === 'executed', '卖 signal 行 reason/类型/终态');

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

    // ═══════════════ 9. 手工卖无价容忍（live-only 刻意设计）═══════════════
    console.log('\n[9] 手工卖无价容忍 = live-only（virtual 已翻转为拒，见 [16]）');
    {
        resetTable();
        const { engine, calls } = mkEngine({ faPrice: 0, faGraduated: false }); // live 引擎
        const row = mkRow({ id: 'r-sell-noprice', direction: 'sell' });
        db.tables.manual_trade_requests.push(row);
        await engine._processManualTradeRequest(row, db.client);
        ok(calls.sell.length === 1, 'live 无价卖照常进执行原语（链上事实记账）');
        ok(calls.sell[0].signal.price === 0, 'signal.price=0（expectedNativeOut=null 走相对滑点锚降级）');
        ok(row.status === 'success', 'live 无价卖不被拒');
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

        // 11.2 卡账本跳过条件（手工显式金额不记卡；live/virtual 双分支同款）
        const liveSkipCount = (src.match(/this\._cardsEnabled && signal\.manualAmountBnb == null/g) || []).length;
        ok(liveSkipCount >= 2,
            `_executeBuyLive+virtual _executeBuy 卡账本条件均含 manualAmountBnb==null（实际 ${liveSkipCount} 处）`);

        // 11.3 interval 挂载形状（双支持批）：2s 周期 + 移出 live-only 块（virtual 同消费）
        ok(src.includes('this._intervals.manualTrade = setInterval(') && src.includes('}, 2000);'),
            'manualTrade interval 挂 _intervals（stop 统一清理）+ 2s 周期');
        const liveSyncIdx = src.indexOf('this._intervals.liveSync = setInterval(');
        const manualIdx = src.indexOf('this._intervals.manualTrade = setInterval(');
        ok(liveSyncIdx > 0 && manualIdx > liveSyncIdx
            && src.slice(liveSyncIdx, manualIdx).includes('\n    }\n'),
            'manualTrade 注册点在 liveSync 的 if(_isLive) 块闭合之后=已移出 live-only 块');
        ok(src.includes('if (this._isStopped || (this._isLive && !this._trader)) return;'),
            '_consumeManualTrades 守卫收窄 live-only（virtual 无 trader 不静默 return）');

        // 11.4 CAS 抢占形状：update().eq(id).eq(status,pending)
        const casIdx = src.indexOf(".update({ status: 'executing' })");
        ok(casIdx > 0 && src.slice(casIdx, casIdx + 300).includes(".eq('status', 'pending')"),
            'CAS 抢占形状 update+eq(status,pending)（防双进程）');

        // 11.5 手工买卖不对称是刻意的：买拒无价、live 卖容忍无价/virtual 卖拒（注释锁定语义）
        const buyGate = src.includes('L1 预成交锚缺失');
        const sellTolerant = src.includes('应急清仓');
        const virtualSellGate = src.includes('virtual 无有效价格');
        ok(buyGate && sellTolerant && virtualSellGate, '买卖不对称语义注释在源码（防未来"修复"成对称）');

        // 11.6 毕业票路由参数链：定义第 4 参默认 null + 手工卖显式透传（既有 3 参调用零影响）
        ok(src.includes('async _executeSell(signal, signalId = null, metadata = {}, traderOverride = null)'),
            '_executeSell 定义含 traderOverride 第 4 参（默认 null）');
        ok(src.includes('this._executeSell(signal, signalId, { ...meta, signalId }, traderOverride)'),
            '手工卖调用显式透传 traderOverride + signalId');
        ok(src.includes('this._executeSell(signal, signalId, metadata)'),
            '策略路径 3 参调用形状不变（默认 null 零影响）');

        // 11.7 毕业路由 live-only 门（virtual _trader 恒 null，_ensurePcsTrader 读
        // _trader.network 是 TypeError——事故形状反证）
        const routeIdx = src.indexOf('if (this._isLive) {\n      const st = this._factorAggregator.getTokenState(tokenAddress);\n      if (st?.graduated)');
        ok(routeIdx > 0, '毕业票 PCS 路由包在 _isLive 门内（virtual 不路由）');

        // 11.8 停止卖出锁双拦截点：唯一卖漏斗 _emitSellSignal + 卖腿评估 _evaluateSellPath
        const evalPathIdx = src.indexOf('async _evaluateSellPath(tokenAddress, factors, tick)');
        const evalLockIdx = src.indexOf("if (this._manualSellLocks.has(tokenAddress)) return { success: false, reason: '手动卖出锁定中（停止卖出）' };");
        ok(evalPathIdx > 0 && evalLockIdx > evalPathIdx && evalLockIdx < evalPathIdx + 600,
            '_evaluateSellPath 入口锁拦截（提前 return 不 touch 去抖器防 pending 积累）');
        const emitIdx = src.indexOf('async _emitSellSignal(token, strategy, factors, tick)');
        const emitLockIdx = src.indexOf('this._manualSellLocks.has(tokenAddress)', emitIdx);
        ok(emitIdx > 0 && emitLockIdx > emitIdx && emitLockIdx < emitIdx + 800,
            '_emitSellSignal 唯一卖漏斗锁拦截（策略卖腿/止损/毕业卖/去抖 fire 全经此）');

        // 11.9 手动 signal 落库后置（门全过后才 save——拒绝不留孤儿 signal 行）
        const saveDefIdx = src.indexOf('async _saveManualSignal(signal, row)');
        const manualBuySaveIdx = src.indexOf('await this._saveManualSignal(signal, row)', src.indexOf('async _executeManualBuy'));
        const cardsGateIdx = src.indexOf('卡牌机制未启用', src.indexOf('async _executeManualBuy'));
        ok(saveDefIdx > 0 && cardsGateIdx > 0 && manualBuySaveIdx > cardsGateIdx,
            '_executeManualBuy cards 门在 _saveManualSignal 之前（门拒不落 signal 行）');
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

    // ═══════════════ 13. virtual 引擎消费队列（双支持批）═══════════════
    console.log('\n[13] virtual 引擎消费（_trader=null 不静默 return）');
    {
        resetTable();
        const { engine, calls } = mkEngine({ live: false, faPrice: 0.0001 });
        ok(engine._trader === null, 'virtual 无 _trader（构造器初值 null；前置：旧守卫会静默 return）');
        const row = mkRow({ id: 'r-vbuy', amount_bnb: 0.05 });
        db.tables.manual_trade_requests.push(row);
        await engine._consumeManualTrades();
        ok(calls.buyVirtual.length === 1, 'virtual 统一入口 _executeBuy 被调（虚拟记账路径）');
        ok(calls.buyLive.length === 0, '不分派 _executeBuyLive');
        ok(row.status === 'success', 'virtual 命令终态 success');
        ok(calls.setBuyState.length === 1 && calls.setBuyState[0].buyExecutedPriceBnb === 0.001,
            'virtual setBuyState 双口径键（buyExecutedPriceBnb=result.priceBnb）');
    }

    // ═══════════════ 14. cards 买（按卡计价走卡牌账本）═══════════════
    console.log('\n[14] cards 手工买');
    {
        // 成功：signal.cards 透传、无 manualAmountBnb（经 _buyAmountFor 卡牌计价+记卡）
        resetTable();
        const { engine, calls } = mkEngine({ faPrice: 0.0001 });
        engine._cardsEnabled = true;
        engine._perCardBNB = 0.001;
        const row = mkRow({ id: 'r-cardsbuy', amount_bnb: null, cards: 2 });
        db.tables.manual_trade_requests.push(row);
        await engine._processManualTradeRequest(row, db.client);
        ok(calls.buyLive.length === 1, 'cards 买进执行原语');
        const sig = calls.buyLive[0].signal;
        ok(sig.cards === 2 && sig.manualAmountBnb === undefined,
            'cards 透传且不带 manualAmountBnb（带会绕过 perCard 计价不记卡）');
        ok(sig.reason === '手动买入 2卡', 'reason=手动买入 2卡');
        const sigRow = db.tables.strategy_signals[0];
        ok(sigRow && sigRow.metadata.cards === 2 && sigRow.metadata.manualRequestId === 'r-cardsbuy',
            'signal 行 metadata.cards=2（命令载体留痕）');
        ok(row.status === 'success', 'cards 买终态 success');

        // 门：卡牌未启用拒（不落 signal 行）
        resetTable();
        const e2 = mkEngine({ faPrice: 0.0001 }); // _cardsEnabled=false
        const row2 = mkRow({ id: 'r-cardsbuy-off', amount_bnb: null, cards: 1 });
        db.tables.manual_trade_requests.push(row2);
        await e2.engine._processManualTradeRequest(row2, db.client);
        ok(row2.status === 'failed' && row2.error.includes('卡牌机制未启用'), '卡牌未启用 cards 买拒');
        ok(db.tables.strategy_signals.length === 0, '门拒不留孤儿 signal 行');
    }

    // ═══════════════ 15. cards 卖 sizing（镜像 _emitSellSignal 卡牌语义）═══════════════
    console.log('\n[15] cards 手工卖 sizing');
    {
        // 4 卡卖 1 → sellPct=0.25 + cardTrade{1,4,3}
        resetTable();
        const { engine, calls } = mkEngine({ faPrice: 0.0001 });
        engine._cardsEnabled = true;
        engine._tokenCards.set(TOKEN, 4);
        const row = mkRow({ id: 'r-cardssell', direction: 'sell', sell_pct: null, cards: 1 });
        db.tables.manual_trade_requests.push(row);
        await engine._processManualTradeRequest(row, db.client);
        ok(calls.sell.length === 1, 'cards 卖进执行原语');
        ok(calls.sell[0].signal.sellPercentage === 0.25, '4卡卖1 → sellPct=0.25（余卡比例）');
        ok(JSON.stringify(calls.sell[0].signal.cardTrade) === JSON.stringify({ cards: 1, before: 4, after: 3 }),
            'cardTrade={cards:1,before:4,after:3}（随 trade 落库由 _executeSell 写回卡账本）');
        ok(db.tables.strategy_signals[0].reason === '手动卖出 1卡（余卡 4）', 'reason 带余卡数');

        // 卖 ≥ 余卡 → 钳制全清 sellPct=1 + after=0
        resetTable();
        const s2 = mkEngine({ faPrice: 0.0001 });
        s2.engine._cardsEnabled = true;
        s2.engine._tokenCards.set(TOKEN, 4);
        const row2 = mkRow({ id: 'r-cardssell-all', direction: 'sell', sell_pct: null, cards: 9 });
        db.tables.manual_trade_requests.push(row2);
        await s2.engine._processManualTradeRequest(row2, db.client);
        ok(s2.calls.sell[0].signal.sellPercentage === 1, '卖 9>4 卡 → 钳制 sellPct=1（全清恒精确 1，PM 删仓判据）');
        ok(s2.calls.sell[0].signal.cardTrade.after === 0 && s2.calls.sell[0].signal.cardTrade.cards === 4,
            'cardTrade={cards:4,before:4,after:0}（钳到余卡）');

        // 0 卡拒
        resetTable();
        const s3 = mkEngine({ faPrice: 0.0001 });
        s3.engine._cardsEnabled = true; // _tokenCards 无该票 = 0 卡
        const row3 = mkRow({ id: 'r-cardssell-0', direction: 'sell', sell_pct: null, cards: 1 });
        db.tables.manual_trade_requests.push(row3);
        await s3.engine._processManualTradeRequest(row3, db.client);
        ok(row3.status === 'failed' && row3.error.includes('卡账本为 0'), '0 卡 cards 卖拒（卡账本为 0）');
        ok(db.tables.strategy_signals.length === 0, '0 卡拒不留孤儿 signal 行');
    }

    // ═══════════════ 16. virtual 无价卖拒 + virtual 毕业票不路由 PCS ═══════════════
    console.log('\n[16] virtual 卖双门');
    {
        // 无价拒（0 价卖出记 0 所得=脏数据；live 对照见 [9]）
        resetTable();
        const { engine, calls } = mkEngine({ live: false, faPrice: 0 }); // bnbUsd=0 → 两级全 miss
        const row = mkRow({ id: 'r-vsell-noprice', direction: 'sell' });
        db.tables.manual_trade_requests.push(row);
        await engine._processManualTradeRequest(row, db.client);
        ok(row.status === 'failed' && row.error.includes('virtual 无有效价格'), 'virtual 无价卖 fail-closed 拒', row.error);
        ok(calls.sell.length === 0, 'virtual 无价不进执行原语');

        // 毕业票不路由 PCS（virtual _trader 恒 null，旧代码 _ensurePcsTrader 读
        // _trader.network 是 TypeError——事故形状反证）
        resetTable();
        const s2 = mkEngine({ live: false, faPrice: 0.0001, faGraduated: true });
        const row2 = mkRow({ id: 'r-vsell-grad', direction: 'sell' });
        db.tables.manual_trade_requests.push(row2);
        await s2.engine._processManualTradeRequest(row2, db.client);
        ok(s2.calls.sell.length === 1 && s2.calls.sell[0].traderOverride === null,
            'virtual 毕业票不路由 PCS（traderOverride=null，虚拟记账不需要 trader）');
        ok(pcsCreated.length === 0, 'virtual 全程不创建 PCS trader（TypeError 防线）');
        ok(row2.status === 'success', 'virtual 毕业票有价卖照常成功');
    }

    // ═══════════════ 18. 停止卖出锁 ═══════════════
    console.log('\n[18] 停止卖出锁（web 写 experiment_tokens，引擎 2s 轮询镜像）');
    {
        // 18a. _refreshManualSellLocks 全量重建（增删票）
        resetTable();
        const { engine, calls } = mkEngine({ faPrice: 0.0001 });
        engine._manualSellLocks.add('0xstale'); // 模拟解锁后的旧镜像残留
        db.tables.experiment_tokens.push(
            { experiment_id: 'exp-manual', token_address: TOKEN, manual_sell_locked: true },
            { experiment_id: 'exp-manual', token_address: '0xother', manual_sell_locked: false },
            { experiment_id: 'exp-other', token_address: '0xnope', manual_sell_locked: true }, // 他实验
        );
        await engine._refreshManualSellLocks(db.client);
        ok(engine._manualSellLocks.size === 1 && engine._manualSellLocks.has(TOKEN),
            '全量重建：只留本实验 locked=true 行（旧镜像/他实验/locked=false 全部收敛）');

        // 18b. 解锁（行删除）→ 下轮重建为空
        db.tables.experiment_tokens = db.tables.experiment_tokens.filter(r => r.token_address !== TOKEN);
        await engine._refreshManualSellLocks(db.client);
        ok(engine._manualSellLocks.size === 0, '解锁后重建为空 Set');

        // 18c. _evaluateSellPath 入口拦截（不 touch 去抖器=提前 return）
        engine._manualSellLocks.add(TOKEN);
        const r = await engine._evaluateSellPath(TOKEN, {}, {});
        ok(r.success === false && r.reason === '手动卖出锁定中（停止卖出）',
            '_evaluateSellPath 锁命中返回拦截 reason（卖腿完全不评估）');

        // 18d. _emitSellSignal 唯一漏斗拦截（策略卖腿/止损/毕业卖/去抖 fire 全经此）
        const r2 = await engine._emitSellSignal({ token: TOKEN, symbol: 'MTT' }, { name: 'test-leg' }, {}, null);
        ok(r2.success === false && r2.reason === '手动卖出锁定中（停止卖出）',
            '_emitSellSignal 锁命中拦截（含策略名日志）');

        // 18e. 手动队列卖不受锁（手动意志最高）：锁在场 cards 卖照常执行
        engine._cardsEnabled = true;
        engine._tokenCards.set(TOKEN, 2);
        const row = mkRow({ id: 'r-locked-sell', direction: 'sell', sell_pct: null, cards: 1 });
        db.tables.manual_trade_requests.push(row);
        await engine._processManualTradeRequest(row, db.client);
        ok(calls.sell.length === 1 && row.status === 'success',
            '锁在场手动卖照常执行（_executeSell 直调不经锁）');
    }

    // ═══════════════ 19. _manualTradePriceUsd state 级回退 ═══════════════
    console.log('\n[19] 手工买价格 state 级回退（出窗票）');
    {
        // preFilter 出窗未持仓票：buildFactorMap=null 但 FA state 有链上最近价
        resetTable();
        const { engine, calls } = mkEngine({ faPrice: 0, bnbUsd: 600 }); // state.currentPriceBnb=0.001
        const row = mkRow({ id: 'r-outofwin' });
        db.tables.manual_trade_requests.push(row);
        await engine._processManualTradeRequest(row, db.client);
        ok(calls.buyLive.length === 1, '两级价格（factors→state×bnbUsd）命中 → 买放行（旧引擎此形状误拒）');
        ok(calls.buyLive[0].signal.price === 0.6, 'signal.price=0.001×600=0.6（FA fire 价同式）');
        ok(row.status === 'success', '出窗票手工买成功');
    }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('测试执行异常:', err);
    process.exit(1);
});
