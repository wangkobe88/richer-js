#!/usr/bin/env node
/**
 * live 非 BNB 计价盘买入防线零 DB 零网络单测（우땅이 案 2026-10-14）
 *
 * 事故：flap 非 BNB 计价盘（quote=SKHYB 垃圾币）live 买入成交（Portal BNB→quote→token
 * 多跳当时有流动性，「天然 fail-closed」假设实证破产），quote 池死后卖出双向 revert，
 * 0.01 BNB 持仓归零 + 卖出连败熔断。
 *
 * 防线：_executeBuyLive 开头按平台分派——flap 票查 FlapAnkrWsCollector
 * getNonBnbQuoteToken，非 BNB 计价拒买 fail-closed；map miss=BNB 盘常态放行；
 * four.meme 票不查（TokenManager2 语义维持既有天然拦截）。
 *
 * 1. collector.getNonBnbQuoteToken：BNB 盘 miss→null / 非 BNB 命中→lowercase 地址 /
 *    大小写不敏感查询 / QuoteSet 翻转 BNB 后清标记
 * 2. 引擎防线行为：flap 票非 BNB → 拒买（reason 含 quote 地址）+ write-once 拉黑登记；
 *    flap 票 BNB 盘 → 穿透防线落到金额关（reason=tradeAmount 未配置）；fourmeme 票 →
 *    不查 collector 穿透
 * 2.5 拒买拉黑评估层短路（元宝拒买风暴案 2026-10-14）：拉黑票 live 模式 _runBuyEvaluation
 *    静默短路（_evaluateBuyPath 不被调）；virtual 模式不拦（仍被调）
 * 3. 双平台分派：both 引擎 _platformForToken 走 token 池 record.platform
 * 4. 源码口径：防线块在 _executeBuyLive 首位（fail-earliest，先于金额/卡牌/余额关）；
 *    短路检查在 _runBuyEvaluation 内 _evaluateBuyPath 调用前 + live-only 守卫
 *
 * 运行：node scripts/_test_live_nonbnb_quote_guard.cjs
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
for (const k of ['ANKR_HTTP_RPC_URL', 'ANKR_API_KEY', 'ANKR_WS_URL']) delete process.env[k];

let passed = 0, failed = 0;
function ok(cond, label, detail) {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.error(`  ❌ ${label}${detail ? ` | ${detail}` : ''}`); }
}
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

const ZERO = '0x0000000000000000000000000000000000000000';
const TOKEN = '0x14ea81254dd8f14774f71a7278a91156f2027777';
const QUOTE = '0xca750ef65f295bbecd685abf54e82caf297bdb61';

function mkCollector() {
    const { FlapAnkrWsCollector } = require(path.join(ROOT, 'src/collectors/flap-ankr-ws-collector.js'));
    return new FlapAnkrWsCollector({ flapWs: {} }, silentLogger, null, null, {});
}

function mkEngine(EngineCls, mode = 'live') {
    const engine = new EngineCls({ tradingMode: mode, initialBalance: 100 });
    engine.logger = silentLogger;
    engine._experiment = { config: { platform: 'both' } };
    engine._applyWsConfig({});
    // token 池桩：record.platform 唯一来源（_runBuyEvaluation 还需 token/chain 字段）
    engine._tokenPool = {
        getToken: (addr) => (addr === TOKEN
            ? { token: TOKEN, chain: 'bsc', symbol: '元宝', platform: 'flap' }
            : { token: addr, chain: 'bsc', symbol: '四妹票', platform: 'fourmeme' }),
    };
    engine._factorAggregator = { getTokenState: () => null, buildFactorMap: () => ({}) };
    return engine;
}

async function main() {
    // ═══════════════ 1. collector getNonBnbQuoteToken ═══════════════
    console.log('\n[1] FlapAnkrWsCollector.getNonBnbQuoteToken');
    {
        const c = mkCollector();
        ok(c.getNonBnbQuoteToken(TOKEN) === null, 'BNB 盘（map miss）→ null');

        ok(c._applyQuoteSet(TOKEN, QUOTE, 100, 1) === true, 'QuoteSet 非 BNB 应用成功');
        ok(c.getNonBnbQuoteToken(TOKEN) === QUOTE, '非 BNB 盘 → 返回 quote 地址');
        ok(c.getNonBnbQuoteToken(TOKEN.toUpperCase()) === QUOTE, '查询大小写不敏感');
        ok(c.getNonBnbQuoteToken('0xdeadbeef00000000000000000000000000000001') === null, '未知 token → null');

        ok(c._applyQuoteSet(TOKEN, ZERO, 101, 1) === true, 'QuoteSet 翻回 BNB 应用成功');
        ok(c.getNonBnbQuoteToken(TOKEN) === null, '翻回 BNB 计价后标记清除 → null');
    }

    // ═══════════════ 2. 引擎防线行为 ═══════════════
    console.log('\n[2] _executeBuyLive 非 BNB 计价拒买');
    const { FourMemeWssTradingEngine } = require(path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine'));
    const { FlapAnkrWsCollector } = require(path.join(ROOT, 'src/collectors/flap-ankr-ws-collector.js'));
    {
        // flap 票 + 非 BNB 计价 → 拒买 + write-once 拉黑登记
        const engine = mkEngine(FourMemeWssTradingEngine);
        const flapCollector = mkCollector();
        flapCollector._applyQuoteSet(TOKEN, QUOTE, 100, 1);
        engine._collectors = [flapCollector];
        const r1 = await engine._executeBuyLive({ tokenAddress: TOKEN, symbol: '우땅이' });
        ok(r1.success === false && r1.reason.includes('非 BNB 计价盘拒买') && r1.reason.includes(QUOTE),
            'flap 票非 BNB → 拒买 reason 含 quote 地址', JSON.stringify(r1));
        ok(engine._nonBnbQuoteBlockedTokens.has(TOKEN),
            '防线命中 → _nonBnbQuoteBlockedTokens write-once 登记');

        // flap 票 + BNB 盘（map miss）→ 穿透防线落到金额关
        const engine2 = mkEngine(FourMemeWssTradingEngine);
        engine2._collectors = [mkCollector()];
        const r2 = await engine2._executeBuyLive({ tokenAddress: TOKEN, symbol: 'BNB盘票' });
        ok(r2.success === false && r2.reason.includes('tradeAmount 未配置'),
            'flap 票 BNB 盘 → 穿透防线落到金额关（防线不拦正常票）', JSON.stringify(r2));

        // fourmeme 票 → 不查 collector（collector 未装也穿透）
        const engine3 = mkEngine(FourMemeWssTradingEngine);
        engine3._collectors = []; // fourmeme 票不触碰 flap collector
        const r3 = await engine3._executeBuyLive({ tokenAddress: '0xother', symbol: '四妹票' });
        ok(r3.success === false && r3.reason.includes('tradeAmount 未配置'),
            'fourmeme 票 → 不查 quote 直接过（TokenManager2 既有语义）', JSON.stringify(r3));

        // collectors 空数组 + flap 票（collector 未起的极端态）→ 穿透（防线依赖 collector 在场）
        const engine4 = mkEngine(FourMemeWssTradingEngine);
        engine4._collectors = [];
        const r4 = await engine4._executeBuyLive({ tokenAddress: TOKEN, symbol: '无采集票' });
        ok(r4.success === false && r4.reason.includes('tradeAmount 未配置'),
            'flap 票无 collector 在场 → miss 放行（不因防线阻断正常路径）', JSON.stringify(r4));
    }

    // ═══════════════ 2.5 拒买拉黑评估层短路（元宝拒买风暴案） ═══════════════
    console.log('\n[2.5] _runBuyEvaluation 拉黑短路');
    {
        // _runBuyEvaluation 早退门依赖（_tokenBlacklist 在 _initializeDataSources 初始化，
        // 桩引擎未跑——补 Map 与生产同形）
        const stubEvalDeps = (e) => { e._tokenBlacklist = new Map(); };
        // live + 拉黑 → 策略评估前静默短路（_evaluateBuyPath 不被调）
        const engine = mkEngine(FourMemeWssTradingEngine, 'live');
        stubEvalDeps(engine);
        engine._nonBnbQuoteBlockedTokens.add(TOKEN);
        let evalCalls = 0;
        engine._evaluateBuyPath = async () => { evalCalls++; return { success: false }; };
        engine._runBuyEvaluation(TOKEN, { timestamp: Date.now() });
        await new Promise(r => setTimeout(r, 20));
        ok(evalCalls === 0, 'live 拉黑票 → fire 静默短路（不进 _evaluateBuyPath，不落 signal 行）');

        // virtual + 拉黑 → 不拦（虚拟不真买，保留实验观察数据）
        const vEngine = mkEngine(FourMemeWssTradingEngine, 'virtual');
        stubEvalDeps(vEngine);
        vEngine._nonBnbQuoteBlockedTokens.add(TOKEN);
        let vEvalCalls = 0;
        vEngine._evaluateBuyPath = async () => { vEvalCalls++; return { success: false }; };
        vEngine._runBuyEvaluation(TOKEN, { timestamp: Date.now() });
        await new Promise(r => setTimeout(r, 20));
        ok(vEvalCalls === 1, 'virtual 拉黑票 → 不拦（live-only 守卫，仍走评估）');

        // live + 未拉黑 → 正常进评估（短路不误伤正常票）
        const nEngine = mkEngine(FourMemeWssTradingEngine, 'live');
        stubEvalDeps(nEngine);
        let nEvalCalls = 0;
        nEngine._evaluateBuyPath = async () => { nEvalCalls++; return { success: false }; };
        nEngine._runBuyEvaluation(TOKEN, { timestamp: Date.now() });
        await new Promise(r => setTimeout(r, 20));
        ok(nEvalCalls === 1, 'live 未拉黑票 → 正常进 _evaluateBuyPath');
    }

    // ═══════════════ 3. 源码口径 ═══════════════
    console.log('\n[3] 源码口径（防线形状锁定）');
    {
        const src = fs.readFileSync(path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');
        const m = src.match(/async _executeBuyLive\(signal, signalId = null, metadata = \{\}\) \{\s*\n\s*try \{\s*\n([\s\S]*?)\n\s*\/\/ 卡牌模式/);
        ok(!!m, '_executeBuyLive try 首块存在（防线定位锚）');
        if (m) {
            const head = m[1];
            ok(head.includes('getNonBnbQuoteToken') && head.includes('_platformForToken') && head.includes('非 BNB 计价盘拒买'),
                '防线=try 首块（fail-earliest，先于金额/卡牌/余额关）');
            ok(head.indexOf('getNonBnbQuoteToken') < head.indexOf('_buyAmountFor') || !head.includes('_buyAmountFor'),
                '防线先于 _buyAmountFor 金额关');
        }
        const colSrc = fs.readFileSync(path.join(ROOT, 'src/collectors/flap-ankr-ws-collector.js'), 'utf8');
        ok(colSrc.includes('getNonBnbQuoteToken(tokenAddress) {') && colSrc.includes('lowerAddr(tokenAddress)'),
            'collector getter 统一 lowerAddr 口径（map key 与查询一致）');
        const runEval = src.match(/_runBuyEvaluation\(tokenAddress, tick\) \{\s*\n([\s\S]*?)\n\s*this\._evaluateBuyPath/);
        ok(!!runEval, '_runBuyEvaluation 存在（短路定位锚）');
        if (runEval) {
            const body = runEval[1];
            ok(body.includes('this._isLive && this._nonBnbQuoteBlockedTokens.has(tokenAddress)'),
                '短路检查在 _runBuyEvaluation 内、_evaluateBuyPath 调用前（live-only 守卫）');
        }
        const buyLive = src.match(/async _executeBuyLive[\s\S]*?nonBnbQuoteBlockedTokens\.add/);
        ok(!!buyLive, '_executeBuyLive 防线命中处登记拉黑（write-once）');
    }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
