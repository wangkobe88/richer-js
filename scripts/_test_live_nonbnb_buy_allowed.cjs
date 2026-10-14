#!/usr/bin/env node
/**
 * live 非 BNB 计价盘可买（零 DB 零网络单测，2026-10-14 用户裁定）
 *
 * 裁定原文「所有的非BNB盘都可以买（只要能正常买入）」——推翻同日早些的
 * BNB-only 拒买防线（712efe7 执行点拒买 + bf58295 评估层短路）。买入可行性
 * 由 estimateGas 天然保证：多跳路径不通 estimate 失败即买入失败，不发垃圾 tx。
 *
 * 1. 行为：flap 票非 BNB 计价（QuoteSet 已标记）→ _executeBuyLive 穿透旧防线
 *    位置落到金额关（reason=tradeAmount 未配置），不再拒买
 * 2. 拉黑基建已删：引擎无 _nonBnbQuoteBlockedTokens 属性（write-once Set 与
 *    短路一并移除，防僵尸态半删除）
 * 3. 源码口径（防回流）：引擎源码零防线形状（无 getNonBnbQuoteToken 调用/
 *    无 _nonBnbQuoteBlockedTokens/无「非 BNB 计价盘拒买」）；collector
 *    getNonBnbQuoteToken getter 已删而 QuoteSet 换算机制（_applyQuoteSet/
 *    _nonBnbQuoteTokens map）保留——价格换算链不受本裁定影响
 *
 * 运行：node scripts/_test_live_nonbnb_buy_allowed.cjs
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
const TOKEN = '0xba5dd6b869512f7f3acaf565e5c6dde076727777';
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
    engine._tokenPool = {
        getToken: (addr) => (addr === TOKEN
            ? { token: TOKEN, chain: 'bsc', symbol: '元宝', platform: 'flap' }
            : { token: addr, chain: 'bsc', symbol: '四妹票', platform: 'fourmeme' }),
    };
    engine._factorAggregator = { getTokenState: () => null, buildFactorMap: () => ({}) };
    return engine;
}

async function main() {
    // ═══════════════ 1. 行为：非 BNB 盘穿透到金额关 ═══════════════
    console.log('\n[1] _executeBuyLive 非 BNB 计价盘可买');
    const { FourMemeWssTradingEngine } = require(path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine'));
    {
        // flap 票 + 非 BNB 计价（collector QuoteSet 已标记）→ 不拒买，落到金额关
        const engine = mkEngine(FourMemeWssTradingEngine);
        const flapCollector = mkCollector();
        flapCollector._applyQuoteSet(TOKEN, QUOTE, 100, 1);
        engine._collectors = [flapCollector];
        const r = await engine._executeBuyLive({ tokenAddress: TOKEN, symbol: '元宝' });
        ok(r.success === false && (r.reason || '').includes('tradeAmount 未配置'),
            'flap 票非 BNB → 穿透旧防线位置落到金额关（不再拒买）', JSON.stringify(r));

        // QuoteSet 标记确实在场（穿透不是 map miss 的假象）
        ok(flapCollector._nonBnbQuoteTokens.get(TOKEN) === QUOTE,
            'QuoteSet 非 BNB 标记在场（穿透是真实放行非 miss）');

        // fourmeme 票同形状（本来就不拦）
        const engine2 = mkEngine(FourMemeWssTradingEngine);
        engine2._collectors = [];
        const r2 = await engine2._executeBuyLive({ tokenAddress: '0xother', symbol: '四妹票' });
        ok(r2.success === false && (r2.reason || '').includes('tradeAmount 未配置'),
            'fourmeme 票 → 同落金额关', JSON.stringify(r2));
    }

    // ═══════════════ 2. 拉黑基建已删 ═══════════════
    console.log('\n[2] 拉黑基建移除');
    {
        const engine = mkEngine(FourMemeWssTradingEngine);
        ok(!('_nonBnbQuoteBlockedTokens' in engine),
            '引擎无 _nonBnbQuoteBlockedTokens 属性（Set 与短路一并移除）');
    }

    // ═══════════════ 3. 源码口径（防回流） ═══════════════
    console.log('\n[3] 源码口径（防线零残留）');
    {
        const src = fs.readFileSync(path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');
        ok(!src.includes('getNonBnbQuoteToken'), '引擎源码无 getNonBnbQuoteToken 调用');
        ok(!src.includes('_nonBnbQuoteBlockedTokens'), '引擎源码无 _nonBnbQuoteBlockedTokens');
        ok(!src.includes('非 BNB 计价盘拒买'), '引擎源码无拒买话术（防线块整体移除）');

        const colSrc = fs.readFileSync(path.join(ROOT, 'src/collectors/flap-ankr-ws-collector.js'), 'utf8');
        ok(!colSrc.includes('getNonBnbQuoteToken'), 'collector 公开 getter 已删');
        ok(colSrc.includes('_applyQuoteSet') && colSrc.includes('_nonBnbQuoteTokens'),
            'collector QuoteSet 换算机制保留（价格链不受裁定影响）');

        const flapSrc = fs.readFileSync(path.join(ROOT, 'src/trading-engine/implementations/FlapWssTradingEngine.js'), 'utf8');
        ok(!flapSrc.includes('getNonBnbQuoteToken') && !flapSrc.includes('BNB 计价盘买入'),
            'Flap 子类头注释不再声称 BNB-only 收窄口径');
    }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
