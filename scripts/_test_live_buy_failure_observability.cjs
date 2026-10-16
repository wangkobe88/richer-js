#!/usr/bin/env node
/**
 * live 买入失败可观测性 零 DB 零网络单测（2026-10-16 蓝蛙 0x9499…7777 案）
 *
 * 事故：live revert 失败只在熔断阈值才打行——蓝蛙首笔 revert（0xef02db4d，
 * 8.6s WSS 盲区等回执）静默期实验日志零行，定位全靠 DB execution_reason 考古；
 * 且旧 tradeResult 形状只有 execution_reason（成功才有 trade 字段），signals 页
 * 失败卡片无从展示 revert 现场。修复两件：
 *   A. _executeBuyLive 失败分支单次必打 warn 行（含 symbol/地址/error 前 300 字）
 *   B. _updateSignalStatus 的 tradeResult 构造补 reason 键（与 execution_reason
 *      同源双口径，前端按 tradeResult.reason || execution_reason 链取）
 *
 *   1. trader 失败臂：warn 行必打（experimentId/_executeBuyLive/❌ live 买入失败/
 *      token 地址/error 摘要）+ 返回 reason 透传 + _registerBuyFailure 前置 +
 *      expectedTokenOut 按信号价×bnbUsd 推导仍传（L1 契约锚不因失败路径缺失）
 *   2. 余额不足早退臂：同样有 reason 且不打 swap（零 trader 调用）
 *   3. _updateSignalStatus：tradeResult.reason 落库形状 + execution_reason 同步 +
 *      executed=false + execution_status=failed + 终态缓存 delete
 *   4. 成功结果臂（result.success=true, trade 字段）：reason=null 形状不炸
 *
 * 打桩：dbManager 单例（引擎 require 前；update 链捕获 updateData）+ traders
 * 工厂 require.cache 桩（buyToken 失败注入）。真实引擎构造（live 模式）。
 *
 * 运行：node scripts/_test_live_buy_failure_observability.cjs
 */

const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

for (const k of ['ANKR_HTTP_RPC_URL', 'ANKR_API_KEY', 'ANKR_WS_URL']) delete process.env[k];

// ═══════════════ dbManager 单例打桩（引擎 require 前）═══════════════
const { dbManager } = require(path.join(ROOT, 'src/services/dbManager'));

const dbState = { updates: [] };
class MockQuery {
    constructor(table) { this.table = table; this._eqs = {}; this._single = false; }
    select() { return this; }
    eq(col, v) { this._eqs[col] = v; return this; }
    single() { this._single = true; return this; }
    update(data) { this._update = data; return this; }
    then(resolve) {
        if (this._update !== undefined) {
            dbState.updates.push({ table: this.table, data: this._update, eqs: { ...this._eqs } });
            resolve({ data: null, error: null });
            return;
        }
        resolve({ data: null, error: this._single ? { code: 'PGRST116', message: '行不存在' } : null });
    }
}
dbManager.isInitialized = true;
dbManager.client = { from: (t) => new MockQuery(t) };

// ═══════════════ traders 工厂打桩（buyToken 失败注入）═══════════════
let lastBuyCall = null;
const TRADERS_PATH = require.resolve(path.join(ROOT, 'src/trading-engine/traders'));
require.cache[TRADERS_PATH] = {
    id: TRADERS_PATH, filename: TRADERS_PATH, loaded: true,
    exports: {
        createTrader: () => ({
            async setWallet() {},
            async getNativeBalance() { return '10'; },
            async buyToken(tokenAddress, amountInWei, options) {
                lastBuyCall = { tokenAddress, amountInWei: amountInWei.toString(), options };
                return { success: false, error: 'swapExactInput revert: minOutputAmount not reached（事故现场形状）' };
            },
        }),
    },
};

const { FourMemeWssTradingEngine } = require(path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine'));

let passed = 0;
function ok(cond, label, detail) {
    if (!cond) throw new Error(`FAIL: ${label}${detail ? ` | ${detail}` : ''}`);
    passed++;
    console.log(`  ✅ ${label}`);
}

function mkEngine() {
    const engine = new FourMemeWssTradingEngine({ tradingMode: 'live', initialBalance: 100 });
    const rows = [];
    engine.logger = {
        info: (...a) => rows.push(['info', ...a]),
        warn: (...a) => rows.push(['warn', ...a]),
        error: (...a) => rows.push(['error', ...a]),
        debug: () => {},
    };
    engine._logger = engine.logger; // AbstractTradingEngine 侧同源（_updateSignalStatus 读 _logger）
    engine._experimentId = 'exp-obs';
    engine._buyAmountFor = () => 0.001;
    engine._cardsEnabled = false;
    engine._tokenCards = new Map();
    engine._liveMaxPositionTokens = 0;
    engine._reserveNative = 0.01;
    engine._liveSlippagePct = 5;
    engine._liveMaxGasPriceGwei = 10;
    engine._liveMinOutRatio = 0.5;
    engine._getBnbUsd = () => 600;
    engine._getHolding = () => null;
    engine._getAllHoldings = () => [];
    const registered = [];
    engine._registerBuyFailure = (sig, err) => registered.push({ sig, err });
    engine._registeredRef = registered;
    engine._rowsRef = rows;
    return engine;
}

const SIGNAL = {
    symbol: 'BLUEFROG',
    tokenAddress: '0x94995372faa9fa949ca11c1c2f0724cd89ae7777',
    price: 5.27e-6, // USD/token（事故票信号价量级）
};

async function main() {
    // ============ 1. trader 失败臂 ============
    console.log('\n[1] _executeBuyLive trader 失败：warn 行 + reason 透传');
    {
        const engine = mkEngine();
        const fakeTrader = require.cache[TRADERS_PATH].exports.createTrader('fourmeme', {});
        engine._trader = fakeTrader; // 链上资金检查读 this._trader
        engine._liveTraderFor = () => fakeTrader;

        const res = await engine._executeBuyLive(SIGNAL, 'sig-1', {});

        ok(res.success === false, '返回 success=false');
        ok(res.reason === 'swapExactInput revert: minOutputAmount not reached（事故现场形状）',
            `reason 透传 trader error（实际 ${JSON.stringify(res.reason)}）`);

        const warnRows = engine._rowsRef.filter(r => r[0] === 'warn');
        const failRow = warnRows.find(r => typeof r[3] === 'string' && r[3].includes('❌ live 买入失败'));
        ok(!!failRow, '❌ live 买入失败 warn 行必打（不再只在熔断阈值）');
        ok(failRow && failRow[1] === 'exp-obs' && failRow[2] === '_executeBuyLive',
            'warn 行三参形状（experimentId, module, message）');
        ok(failRow && failRow[3].includes(SIGNAL.tokenAddress) && failRow[3].includes('BLUEFROG'),
            'warn 行含 token 地址与 symbol');
        ok(failRow && failRow[3].includes('minOutputAmount not reached'), 'warn 行含 error 摘要');

        ok(engine._registeredRef.length === 1, '_registerBuyFailure 前置（熔断计数照走）');

        ok(lastBuyCall && lastBuyCall.options.expectedTokenOut > 0,
          `expectedTokenOut 按信号价推导传入（实际 ${lastBuyCall && lastBuyCall.options.expectedTokenOut}）`);
        const expectApprox = 0.001 * 600 / 5.27e-6;
        ok(lastBuyCall && Math.abs(lastBuyCall.options.expectedTokenOut - expectApprox) / expectApprox < 1e-9,
            '推导口径 amountIn×bnbUsd/price（蓝蛙事故反推锚）');
        ok(lastBuyCall && lastBuyCall.options.slippageTolerance === 5, 'slippageTolerance 透传');
    }

    // ============ 2. 余额不足早退臂 ============
    console.log('\n[2] 链上余额不足早退：reason + 零 trader 调用');
    {
        const engine = mkEngine();
        engine._trader = { getNativeBalance: async () => '0.001' };
        lastBuyCall = null;
        engine._liveTraderFor = () => { throw new Error('MUST NOT REACH'); };
        const res = await engine._executeBuyLive(SIGNAL, 'sig-2', {});
        ok(res.success === false && /链上余额不足/.test(res.reason), `早退 reason（实际 ${res.reason}）`);
        ok(lastBuyCall === null, '零 buyToken 调用');
    }

    // ============ 3. _updateSignalStatus tradeResult.reason ============
    console.log('\n[3] _updateSignalStatus：tradeResult.reason 落库形状');
    {
        const engine = mkEngine();
        engine._eventRecordingConfig = { enabled: false }; // 通知链自然短路
        engine._signalRowCache = new Map([['sig-9', {
            id: 'sig-9', metadata: { strategyName: 'buy-v2' }, action: 'buy', executed: false,
            token_address: SIGNAL.tokenAddress, token_symbol: 'BLUEFROG', chain: 'bsc',
            experiment_id: 'exp-obs', created_at: '2026-10-16T00:00:00Z',
        }]]);
        dbState.updates.length = 0;
        await engine._updateSignalStatus('sig-9', 'failed',
            { success: false, reason: 'swapExactInput revert: minOutputAmount not reached' });

        ok(dbState.updates.length === 1, '恰一次 UPDATE');
        const upd = dbState.updates[0];
        ok(upd.table === 'strategy_signals' && upd.eqs.id === 'sig-9', 'UPDATE 目标表/行正确');
        ok(upd.data.executed === false, 'executed=false');
        const meta = upd.data.metadata;
        ok(meta.execution_status === 'failed', 'execution_status=failed');
        ok(meta.execution_reason === 'swapExactInput revert: minOutputAmount not reached',
            'execution_reason 同步（旧键保留）');
        ok(meta.tradeResult && meta.tradeResult.reason === 'swapExactInput revert: minOutputAmount not reached',
            'tradeResult.reason 落库（本次修复键）');
        ok(meta.tradeResult.success === false, 'tradeResult.success=false');
        ok(meta.tradeResult.trade === null, '无 trade 字段 → null');
        ok(meta.strategyName === 'buy-v2', '原 metadata 基底不丢');
        ok(!engine._signalRowCache.has('sig-9'), '终态缓存 delete');
    }

    // ============ 4. 成功结果臂 reason=null 形状 ============
    console.log('\n[4] 成功结果臂：reason 缺省 null 不炸');
    {
        const engine = mkEngine();
        engine._eventRecordingConfig = { enabled: false };
        engine._signalRowCache = new Map([['sig-10', {
            id: 'sig-10', metadata: {}, action: 'sell', executed: false,
            token_address: SIGNAL.tokenAddress, token_symbol: 'BLUEFROG', chain: 'bsc',
            experiment_id: 'exp-obs', created_at: '2026-10-16T00:00:00Z',
        }]]);
        dbState.updates.length = 0;
        await engine._updateSignalStatus('sig-10', 'executed', {
            success: true, tradeId: 't-1',
            trade: { id: 't-1', tokenSymbol: 'BLUEFROG', tradeDirection: 'sell', inputAmount: '1', outputAmount: '0.002', unitPrice: '5e-6', success: true },
        });
        const meta = dbState.updates[0].data.metadata;
        ok(meta.tradeResult.reason === null, '无 reason → null（非 undefined 键缺失）');
        ok(meta.tradeResult.success === true && meta.tradeResult.trade.tokenSymbol === 'BLUEFROG',
            '成功 trade 字段照旧');
    }

    console.log(`\n✅ 全部通过（${passed} 断言）`);
}

main().catch((err) => {
    console.error(`\n❌ ${err.message}`);
    console.error(err.stack);
    process.exit(1);
});
