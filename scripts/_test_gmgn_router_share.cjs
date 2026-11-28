#!/usr/bin/env node
/**
 * T251b gmgnRouterBuySharePct 单测（2026-11-28 用户裁定「=100 纯 GMGN 的干掉」）
 * ——零 DB 零网络。
 *
 * 键：GMGN 主路由买入额 ÷ AGGREGATOR_ROUTER_ADDRS 全集买入额 ×100（fire 前全史
 * 累计，trader 层，只计买腿）。null=无 router 买入 fail-open 放行；0=有 router 买
 * 零 GMGN 有证据零值；100=router 买入全走 GMGN（单一入口包场）。
 *
 * 覆盖：
 *   A. 写点：router 买累计/GMGN 分子/非 router 买不累计/卖腿不累计
 *   B. 发射：100/0/null 三态 + 小数比精确值
 *   C. 探针+白名单（FactorBuilder ?? null）
 *
 * 用法：node scripts/_test_gmgn_router_share.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FourMemeFactorAggregator = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'));
const FactorBuilder = require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));
const { GMGN_ROUTER_ADDR, AGGREGATOR_ROUTER_ADDRS } = require(path.join(ROOT, 'src', 'trading-engine', 'pre-check', 'aggregator-routers.js'));

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const T0 = 1790802000000;
let _li = 0;
const mkTick = (o) => Object.assign({
    token_address: '0xtoken', trade_type: 'buy', trader_address: '0xsomeone', sender_address: null,
    price_bnb: 0.000001, price_usd: 0.0006, bnb_amount: 0.1, token_amount: 100000,
    block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: _li++,
}, o);
function newFA() {
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    return fa;
}
const otherRouter = [...AGGREGATOR_ROUTER_ADDRS].find(a => a !== GMGN_ROUTER_ADDR);
const valOf = (fa, asOf) => fa.buildFactorMap('0xtoken', asOf).gmgnRouterBuySharePct;

console.log('A. 写点口径');
{
    check('A1 纯 GMGN：router 买全走 GMGN → 100', () => {
        const fa = newFA();
        fa.processTick(mkTick({ trader_address: GMGN_ROUTER_ADDR, bnb_amount: 0.3 }));
        fa.processTick(mkTick({ trader_address: GMGN_ROUTER_ADDR, bnb_amount: 0.2 }));
        assert.strictEqual(valOf(fa, T0 + 5000), 100);
    });
    check('A2 零 GMGN：router 买全走其它路由 → 0 有证据零值', () => {
        const fa = newFA();
        fa.processTick(mkTick({ trader_address: otherRouter, bnb_amount: 0.3 }));
        assert.strictEqual(valOf(fa, T0 + 5000), 0);
    });
    check('A3 混合：GMGN 0.3 / 其它 0.2 → 60', () => {
        const fa = newFA();
        fa.processTick(mkTick({ trader_address: GMGN_ROUTER_ADDR, bnb_amount: 0.3 }));
        fa.processTick(mkTick({ trader_address: otherRouter, bnb_amount: 0.2 }));
        assert.strictEqual(valOf(fa, T0 + 5000), 60);
    });
    check('A4 无 router 买 → null fail-open；非 router 买不累计；卖腿不累计', () => {
        const fa = newFA();
        assert.strictEqual(valOf(fa, T0 + 5000), null, '空链 null');
        fa.processTick(mkTick({ trader_address: '0xsomeone', bnb_amount: 0.5 }));
        assert.strictEqual(valOf(fa, T0 + 6000), null, '非 router 买不累计仍 null');
        const fa2 = newFA();
        fa2.processTick(mkTick({ trader_address: GMGN_ROUTER_ADDR, trade_type: 'sell', bnb_amount: 0.3 }));
        assert.strictEqual(valOf(fa2, T0 + 5000), null, 'router 卖腿不累计');
    });
}

console.log('B. 探针+白名单');
{
    check('B1 getFactorKeys 含键', () => {
        const fa = newFA();
        assert.ok(fa.getFactorKeys().has('gmgnRouterBuySharePct'));
    });
    check('B2 FactorBuilder ?? null（缺键 null 在位）', () => {
        const snap = FactorBuilder.buildFactorValuesForTimeSeries({});
        assert.strictEqual(snap.gmgnRouterBuySharePct, null);
        const withV = FactorBuilder.buildFactorValuesForTimeSeries({ gmgnRouterBuySharePct: 60 });
        assert.strictEqual(withV.gmgnRouterBuySharePct, 60);
    });
    check('B3 GMGN_ROUTER_ADDR 在路由集内（单一真相源）', () => {
        assert.ok(AGGREGATOR_ROUTER_ADDRS.has(GMGN_ROUTER_ADDR));
    });
}

console.log(`\n${failed === 0 ? '✅' : '❌'} gmgnRouterBuySharePct 单测：${passed} 通过，${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
