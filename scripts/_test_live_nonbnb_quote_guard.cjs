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
 * 2. 引擎防线行为：flap 票非 BNB → 拒买（reason 含 quote 地址）；flap 票 BNB 盘 →
 *    穿透防线落到金额关（reason=tradeAmount 未配置）；fourmeme 票 → 不查 collector 穿透
 * 3. 双平台分派：both 引擎 _platformForToken 走 token 池 record.platform
 * 4. 源码口径：防线块在 _executeBuyLive 首位（fail-earliest，先于金额/卡牌/余额关）
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

function mkEngine(EngineCls) {
    const engine = new EngineCls({ tradingMode: 'live', initialBalance: 100 });
    engine.logger = silentLogger;
    engine._experiment = { config: { platform: 'both' } };
    engine._applyWsConfig({});
    // token 池桩：record.platform 唯一来源
    engine._tokenPool = {
        getToken: (addr) => (addr === TOKEN ? { platform: 'flap' } : { platform: 'fourmeme' }),
    };
    engine._factorAggregator = { getTokenState: () => null };
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
        // flap 票 + 非 BNB 计价 → 拒买
        const engine = mkEngine(FourMemeWssTradingEngine);
        const flapCollector = mkCollector();
        flapCollector._applyQuoteSet(TOKEN, QUOTE, 100, 1);
        engine._collectors = [flapCollector];
        const r1 = await engine._executeBuyLive({ tokenAddress: TOKEN, symbol: '우땅이' });
        ok(r1.success === false && r1.reason.includes('非 BNB 计价盘拒买') && r1.reason.includes(QUOTE),
            'flap 票非 BNB → 拒买 reason 含 quote 地址', JSON.stringify(r1));

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
    }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
