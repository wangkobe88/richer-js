#!/usr/bin/env node
/**
 * 买入连续失败熔断（2026-10-14 龙龙币二 0x2831fdfa revert 死循环案，用户裁定连败 3 拉黑）
 * 零 DB 零网络单测
 *
 * 覆盖 FourMemeWssTradingEngine._registerBuyFailure / _executeBuyLive 计数点 /
 * _runBuyEvaluation 拉黑短路 / _buyCbFailures 配置默认：
 *   1. 连败 3 → 拉黑 _buyBlockedTokens + streak Map 清空 + 告警恰一次
 *   2. 「2 败 1 成」翻正清零不拉黑（喝水小猴/龙龙币一竞争型 revert 实证模式——
 *      竞争失败在 2 次内翻正，3 连败才是死池/确定性拒绝）
 *   3. 前置拒绝不计（链上余额不足早退 → streak 不变）——资金问题不是 token 买不进
 *   4. 拉黑后手工买仍可执行（检查在买评估层不在执行层，人工指令绕过）
 *   5. 默认阈值 3（liveConfig.buyCircuitBreakerFailures 缺省）
 *   6. 源码口径断言（红线 13）：计数点只在发单后失败与 catch 两处 / 前置拒绝三分支
 *      （金额 0/持仓上限/余额不足）早退无计数 / 成功清零在 return success 前 /
 *      拉黑短路检查点位于叙事否决短路之后
 *
 * 运行：node scripts/_test_buy_circuit_breaker.cjs
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

// dbManager 打桩（构造器 ExperimentDataService 初始化需要 getClient；本测主链路不落库）
const { dbManager } = require(path.join(ROOT, 'src/services/dbManager'));
const stubChain = { select() { return stubChain; }, eq() { return stubChain; }, order() { return stubChain; },
    limit() { return stubChain; }, then(resolve) { resolve({ data: [], error: null }); } };
dbManager.getClient = () => stubChain;

const ENGINE_PATH = path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine.js');
const { FourMemeWssTradingEngine } = require(ENGINE_PATH);
const entities = require(path.join(ROOT, 'src/trading-engine/entities'));

// ═══════════════ 测试基建 ═══════════════
let passed = 0, failed = 0;
function ok(cond, label, detail) {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.error(`  ❌ ${label}${detail ? ` | ${detail}` : ''}`); }
}
const silentLogger = { info() {}, warn() {}, error() {}, debug() {}, setExperimentId() {} };

const TOKEN = '0xBuyCb0000000000000000000000000000000def1';

/** 构造 live 引擎（只走构造器）+ mock trader/告警捕获 */
function mkEngine({ failTimes = 0, nativeBalance = 10 } = {}) {
    const engine = new FourMemeWssTradingEngine({ tradingMode: 'live', initialBalance: 100 });
    engine.logger = silentLogger;
    engine._experimentId = 'exp-buycb';
    engine._isStopped = false;

    const state = { buyCalls: 0, alerts: [] };
    engine._notifyLiveAlert = async (title, message) => { state.alerts.push({ title, message }); };
    engine._getBnbUsd = () => 600;
    engine._liveRecordTrade = async () => {};
    engine._reserveNative = 0; // 余额门只看金额本体

    const mockTrader = {
        wallet: { address: '0xmain', privateKey: '0xPK' },
        network: { rpcUrl: 'https://rpc.test' },
        async getNativeBalance() { return nativeBalance; },
        async buyToken(addr, amountWei, options) {
            state.buyCalls++;
            if (state.buyCalls <= failTimes) {
                return { success: false, error: `execution reverted (mock #${state.buyCalls})` };
            }
            return { success: true, actualAmountOut: '12345.6', transactionHash: '0xok' + state.buyCalls };
        },
    };
    engine._liveTraderFor = () => mockTrader;
    engine._trader = mockTrader; // 链上余额检查（_executeBuyLive 内 this._trader.getNativeBalance）
    return { engine, state };
}

/** Trade 打桩（成功路径 _executeBuyLive 内 `const { Trade } = require('../entities')`
 * 运行时解构——patch 模块导出生效；save 返回 id 不落库 */
function patchTrade() {
    const realTrade = entities.Trade;
    entities.Trade = class {
        constructor(d) { Object.assign(this, d); this.txHash = d.txHash; }
        async save() { return 'trade-mock'; }
    };
    return () => { entities.Trade = realTrade; };
}

const SIG = (overrides = {}) => ({
    action: 'buy', symbol: '龙龙币二', tokenAddress: TOKEN, chain: 'bsc',
    price: 7e-6, manualAmountBnb: 0.01, // 显式金额绕过卡牌/_buyAmountFor 配置依赖
    ...overrides,
});

async function main() {
    // ═══════════════ 1. 连败 3 拉黑 ═══════════════
    console.log('\n[1] 连败 3 → 拉黑 + Map 清 + 告警恰一次');
    {
        const { engine, state } = mkEngine({ failTimes: 3 });
        const r1 = await engine._executeBuyLive(SIG());
        const r2 = await engine._executeBuyLive(SIG());
        ok(!r1.success && !r2.success, '前两败 success:false');
        ok(engine._buyFailStreak.get(TOKEN) === 2 && !engine._buyBlockedTokens.has(TOKEN),
            '2 败后 streak=2 未拉黑', `streak=${engine._buyFailStreak.get(TOKEN)}`);
        ok(state.alerts.length === 0, '未达阈值无告警');

        const r3 = await engine._executeBuyLive(SIG());
        ok(!r3.success, '第三败 success:false');
        ok(engine._buyBlockedTokens.has(TOKEN), '3 连败拉黑 _buyBlockedTokens');
        ok(!engine._buyFailStreak.has(TOKEN), '拉黑后 streak Map 清空');
        ok(state.alerts.length === 1 && state.alerts[0].title === '🛑 买入熔断',
            '告警恰一次', JSON.stringify(state.alerts.map(a => a.title)));
        ok(/连续买入失败 3 次/.test(state.alerts[0].message) && state.alerts[0].message.includes(TOKEN),
            '告警文案含次数与地址');

        // 拉黑后手工买（_executeBuyLive 直调）不短路——检查在买评估层
        const unpatch = patchTrade();
        const r5 = await engine._executeBuyLive(SIG()); // failTimes=3 已耗尽 → 这次成功
        unpatch();
        ok(r5.success === true, '拉黑后手工买路径仍执行（trader 成功即成功）');
        ok(engine._buyBlockedTokens.has(TOKEN), '拉黑集合不自动解除（内存态至进程重启）');
    }

    // ═══════════════ 2. 2 败 1 成清零 ═══════════════
    console.log('\n[2] 竞争型「2 败 1 成」翻正清零（喝水小猴模式）');
    {
        const { engine, state } = mkEngine({ failTimes: 2 });
        const unpatch = patchTrade();
        await engine._executeBuyLive(SIG()); // 败1
        await engine._executeBuyLive(SIG()); // 败2
        ok(engine._buyFailStreak.get(TOKEN) === 2, '两败 streak=2');
        const r3 = await engine._executeBuyLive(SIG()); // 成
        unpatch();
        ok(r3.success === true, '第三笔成功');
        ok(!engine._buyFailStreak.has(TOKEN), '成功清零连败');
        ok(!engine._buyBlockedTokens.has(TOKEN) && state.alerts.length === 0, '未拉黑未告警');
    }

    // ═══════════════ 3. 前置拒绝不计 ═══════════════
    console.log('\n[3] 前置拒绝（链上余额不足）不计连败');
    {
        const { engine } = mkEngine({ failTimes: 99, nativeBalance: 0.001 });
        const r = await engine._executeBuyLive(SIG()); // manualAmountBnb 0.01 > 余额 → 早退
        ok(!r.success && /余额不足/.test(r.reason), '余额不足早退');
        ok(!engine._buyFailStreak.has(TOKEN), '前置拒绝不计数（资金问题≠token 买不进）');
    }

    // ═══════════════ 4. 默认阈值 3 ═══════════════
    console.log('\n[4] 配置默认与读点');
    {
        const { engine } = mkEngine();
        ok(engine._buyCbFailures === 3, 'buyCircuitBreakerFailures 缺省 3');
        ok(engine._buyBlockedTokens instanceof Set && engine._buyFailStreak instanceof Map,
            '状态容器形状 Set/Map（与 _narrativeBlockedTokens 同款内存语义）');
    }

    // ═══════════════ 5. 源码口径断言（红线 13）═══════════════
    console.log('\n[5] 源码口径');
    {
        const src = fs.readFileSync(ENGINE_PATH, 'utf8');

        const calls = (src.match(/\._registerBuyFailure\(/g) || []).length;
        ok(calls === 2, `_registerBuyFailure 调用恰 2 处（发单后失败 + catch），实际 ${calls}`);

        const failCall = src.indexOf('this._registerBuyFailure(signal, buyResult.error)');
        const catchCall = src.indexOf('this._registerBuyFailure(signal, error.message)');
        ok(failCall > 0 && catchCall > failCall, '计数点=buyResult 失败在先 catch 在后');

        const balGate = src.indexOf('链上余额不足: 实际');
        const posGate = src.indexOf('持仓数已达上限');
        ok(balGate > 0 && posGate > 0 && posGate < failCall && balGate < failCall,
            '前置拒绝分支（余额/持仓上限）位于计数点之前（早退不计）');

        const clearLine = src.indexOf('this._buyFailStreak.delete(signal.tokenAddress);');
        const successRet = src.indexOf('return { success: true, tradeId, txHash: trade.txHash');
        ok(clearLine > 0 && clearLine < successRet, '成功清零位于 success return 前');

        const shortCircuit = src.indexOf("买入熔断短路（连续链上买入失败已拉黑）");
        const narrativeGate = src.indexOf("叙事否决短路（评级 low 终态，不再生成信号）");
        ok(shortCircuit > 0 && narrativeGate > 0 && shortCircuit > narrativeGate,
            '拉黑短路检查点位于叙事否决短路之后（_runBuyEvaluation）');

        ok(src.includes('buyCircuitBreakerFailures ?? 3'), '阈值读点 liveConfig.buyCircuitBreakerFailures ?? 3');
    }

    console.log(`\n═══ 结果: ${passed} 通过 / ${failed} 失败 ═══`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
