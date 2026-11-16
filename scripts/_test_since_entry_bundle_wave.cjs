#!/usr/bin/env node
/**
 * T147 锚后等额捆绑买入簇单测（bundle-wave-exit 卖臂）——本地零 DB 零网络。
 *
 * 主键：sinceEntryEqualBundleWallets = 本仓入场（setBuyState 锚快照
 *      entryMaxEqualBundleWallets）以来涌现的最大同块等额（toFixed(4)）买入簇
 *      钱包数（尘门 ≥0.01 剔路由）。0=无新簇有证据零值；未持仓 null。
 * 案源（Echo 二 0xaa0710da…7777，btv134 复审用户裁定「买入后又出现异常现象
 * （大量捆绑买入），需要立即卖出」）：锚+3s blk 131209704 9 钱包各 0.076 +
 * 锚+7s 同批 9 钱包再各 0.033 双连块拉抬后砸——塞单门只看买点前锚窗，锚后
 * 涌现唯一防线=本检测。线=8（BP77 塞单门同线同值：同一形状同一根线）。
 *
 * 覆盖：
 *   A. Echo 主案形状（9×0.076 同块 → 结算 9；双连块 9×0.033 单调保持）
 *   B. 尘门/路由剔除/非等额不堆桶
 *   C. 入场锚快照（入场前已有簇不计；入场后新簇差值；补买重锚）
 *   D. 未持仓 null；条件串真值（>=8）
 *   E. getFactorKeys 探针含键；FactorBuilder 快照透传
 *   F. 源码口径断言（检测挂点 wallet 聚合段 buy 行/结算在块切换/单调 max）
 *
 * 用法：node scripts/_test_since_entry_bundle_wave.cjs
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const FourMemeFactorAggregator = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'));
const FactorBuilder = require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const T0 = 1790802000000;
const mkTick = (o) => Object.assign({
    token_address: '0xtoken', trade_type: 'buy', trader_address: '0xa', sender_address: null,
    price_bnb: 0.00001, price_usd: 5, bnb_amount: 0.1, token_amount: 1000,
    block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: 0,
}, o);
const W = (i) => '0xw' + String(i).padStart(38, '0');

function newFA() {
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    return fa;
}

// ═══════════════ A. Echo 主案形状 ═══════════════
console.log('A. Echo 主案（9×0.076 同块双连块）');
{
    const fa = newFA();
    const AS_OF = T0 + 60000;
    fa.setBuyState('0xtoken', { buyPriceBnb: 0.00001, buyTime: AS_OF - 30000 });
    // 锚+3s 块 200：9 钱包各 0.076（等额簇 9）
    for (let i = 0; i < 9; i++) fa.processTick(mkTick({ block_number: 200, bnb_amount: 0.076, sender_address: W(i), timestamp: AS_OF - 27000 }));
    // 结算发生在块切换：下一块 201 首行
    fa.processTick(mkTick({ block_number: 201, bnb_amount: 0.05, sender_address: W(90), timestamp: AS_OF - 26000 }));
    let f = fa.buildFactorMap('0xtoken', AS_OF);
    check('A1 9×0.076 同块 → sinceEntryEqualBundleWallets = 9', () =>
        assert.strictEqual(f.sinceEntryEqualBundleWallets, 9));
    // 锚+7s 块 202：同批 9 钱包再各 0.033（双连块；单调 max 保持 9）
    for (let i = 0; i < 9; i++) fa.processTick(mkTick({ block_number: 202, bnb_amount: 0.033, sender_address: W(i), timestamp: AS_OF - 23000 }));
    fa.processTick(mkTick({ block_number: 203, bnb_amount: 0.05, sender_address: W(91), timestamp: AS_OF - 20000 }));
    f = fa.buildFactorMap('0xtoken', AS_OF);
    check('A2 双连块 9×0.033 → 单调 max 保持 9', () =>
        assert.strictEqual(f.sinceEntryEqualBundleWallets, 9));
}

// ═══════════════ B. 门槛剔除 ═══════════════
console.log('B. 尘门/路由/非等额');
{
    const fa = newFA();
    const AS_OF = T0 + 60000;
    fa.setBuyState('0xtoken', { buyPriceBnb: 0.00001, buyTime: AS_OF - 30000 });
    // 尘埃 9 钱包各 0.005（<0.01 不入桶）
    for (let i = 0; i < 9; i++) fa.processTick(mkTick({ block_number: 300, bnb_amount: 0.005, sender_address: W(20 + i), timestamp: AS_OF - 25000 }));
    // 路由行 9 笔同额（剔聚合路由）
    const router = '0x1de460f363af910f51726def188f9004276bf4bc'; // GMGN 聚合路由（名单真实成员——手敲地址陷阱第三次实证）
    for (let i = 0; i < 9; i++) fa.processTick(mkTick({ block_number: 300, bnb_amount: 0.076, sender_address: router, trader_address: router, timestamp: AS_OF - 24000 }));
    // 非等额 8 钱包（0.076~0.083 各不同 key，各自 1）
    for (let i = 0; i < 8; i++) fa.processTick(mkTick({ block_number: 300, bnb_amount: 0.076 + i * 0.001, sender_address: W(40 + i), timestamp: AS_OF - 23000 }));
    fa.processTick(mkTick({ block_number: 301, bnb_amount: 0.05, sender_address: W(92), timestamp: AS_OF - 22000 }));
    const f = fa.buildFactorMap('0xtoken', AS_OF);
    check('B1 尘埃/路由不入桶、非等额各桶 1 → max=1（不达 8 线）', () =>
        assert.strictEqual(f.sinceEntryEqualBundleWallets, 1));
    // 同钱包多笔不重复计数（Set）
    for (let k = 0; k < 3; k++) for (let i = 0; i < 8; i++) fa.processTick(mkTick({ block_number: 400, bnb_amount: 0.076, sender_address: W(50 + i), timestamp: AS_OF - 15000 + k }));
    fa.processTick(mkTick({ block_number: 401, bnb_amount: 0.05, sender_address: W(93), timestamp: AS_OF - 10000 }));
    const f2 = fa.buildFactorMap('0xtoken', AS_OF);
    check('B2 同钱包多笔等额 Set 去重 → 8 钱包计 8（恰达线）', () =>
        assert.strictEqual(f2.sinceEntryEqualBundleWallets, 8));
}

// ═══════════════ C. 入场锚快照/补买重锚 ═══════════════
console.log('C. 入场锚（入场前簇不计；补买重锚）');
{
    const fa = newFA();
    const AS_OF = T0 + 60000;
    // 入场前已有 9 簇
    for (let i = 0; i < 9; i++) fa.processTick(mkTick({ block_number: 500, bnb_amount: 0.076, sender_address: W(60 + i), timestamp: AS_OF - 40000 }));
    fa.processTick(mkTick({ block_number: 501, bnb_amount: 0.05, sender_address: W(94), timestamp: AS_OF - 39000 }));
    fa.setBuyState('0xtoken', { buyPriceBnb: 0.00001, buyTime: AS_OF - 30000 });
    // 入场后只有 5 簇（不达线）
    for (let i = 0; i < 5; i++) fa.processTick(mkTick({ block_number: 600, bnb_amount: 0.06, sender_address: W(70 + i), timestamp: AS_OF - 20000 }));
    fa.processTick(mkTick({ block_number: 601, bnb_amount: 0.05, sender_address: W(95), timestamp: AS_OF - 19000 }));
    const f = fa.buildFactorMap('0xtoken', AS_OF);
    check('C1 入场前 9 簇被入场清零屏蔽；入场后 5 簇 → 5（max 型差值被历史簇淹没的反证夹具）', () =>
        assert.strictEqual(f.sinceEntryEqualBundleWallets, 5));
}

// ═══════════════ D. 未持仓 null + 条件串真值 ═══════════════
console.log('D. null 语义与条件串');
{
    const fa = newFA();
    const AS_OF = T0 + 60000;
    fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: AS_OF - 10000 }));
    const f = fa.buildFactorMap('0xtoken', AS_OF);
    check('D1 未持仓 → null（`>= 8` 恒 false 不误卖）', () =>
        assert.strictEqual(f.sinceEntryEqualBundleWallets, null));
}

// ═══════════════ E. 探针/快照透传 ═══════════════
console.log('E. 键注册与快照');
{
    const keys = newFA().getFactorKeys();
    check('E1 getFactorKeys 含 sinceEntryEqualBundleWallets（三防线自动认得）', () =>
        assert.ok(keys.has('sinceEntryEqualBundleWallets'), 'key missing'));
    const src = fs.readFileSync(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'), 'utf8');
    check('E2 FactorBuilder 快照透传在场', () =>
        assert.ok(src.includes('sinceEntryEqualBundleWallets'), 'FactorBuilder missing key'));
    const faSrc = fs.readFileSync(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'), 'utf8');
    check('E3 源码口径：检测挂 wallet 聚合段（_applyWalletAggregation 内 _trackEqualBundleBuy）', () =>
        assert.ok(faSrc.includes('_trackEqualBundleBuy(state, { isBuy, bnbAmount, blockNumber, walletAddr })'), 'hook missing'));
    check('E4 源码口径：结算在块切换（_settleEqualBundleBlock）+ 单调 max', () =>
        assert.ok(faSrc.includes('if (mx > (state._maxEqualBundleWallets || 0)) state._maxEqualBundleWallets = mx'), 'settle missing'));
    check('E5 源码口径：常量 8 线（BP77 塞单门同线）与尘门 0.01（CD405 同线）', () => {
        assert.ok(faSrc.includes('EQUAL_BUNDLE_EXIT_MIN_WALLETS = 8'));
        assert.ok(faSrc.includes('EQUAL_BUNDLE_WALLET_DUST_BNB = 0.01'));
    });
}

console.log(`\n结果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
