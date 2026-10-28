#!/usr/bin/env node
/**
 * T84 入场市值锚单测（2026-10-28 早期叙事臂卖腿适配）——本地零 DB 零网络。
 *
 * 机制：FA.setBuyState 时记 entryMarketCapBnb = 首买 fire 价（anchorBnb）×
 * totalSupply（BNB 域，与 marketCap 同批 T84 量纲切换）；补买不覆盖（臂身份=首买
 * 锚定），clearBuyState 全清重置；锚/总量缺失 → null fail-closed。消费侧=卖腿条件
 * 键 entryMarketCap：豁免臂 `>= 7.4`（T79 地板/衰竭腿免误杀早期仓）与早期臂专属腿
 * `< 7.4` 域限定（600s 止损/protect20/上位离场）。
 *
 * 覆盖：
 *   A. 首买锚精确值（fire 价×总量）
 *   B. 补买不覆盖（先 6.5 带内买、后 9 带外补 → 锚仍 6.5；再反向验证主腿先开仓
 *      不被低带补买改判）
 *   C. 全清后重置（clearBuyState → 再买取新锚）
 *   D. null fail-closed（buyPriceBnb=0 / totalSupply 缺失）
 *   E. factor map / getHolderFactors 暴露；无仓 → null
 *   F. T79 豁免腿真值表（marketCap<7.4 AND realHoldDuration>10 AND
 *      (entryMarketCap>=7.4 OR realHoldDuration>1800)）
 *   G. 早期臂专属腿真值表（entryMarketCap<7.4 AND holdDuration>600 AND
 *      profitPercent<=0；null 锚恒 false）
 *   H. 快照白名单透传（FactorBuilder 缺键 → null 不掩盖）
 *
 * 用法：node scripts/_test_entry_market_cap.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FourMemeFactorAggregator = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'));
const { StrategyEngine } = require(path.join(ROOT, 'src', 'strategies', 'StrategyEngine.js'));
const FactorBuilder = require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));

let passed = 0, failed = 0;
function check(name, actual, expected) {
    try {
        assert.deepStrictEqual(actual, expected);
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        failed++;
        console.error(`  ❌ ${name}\n     ${e.message.split('\n').join('\n     ')}`);
    }
}

const T0 = 1790802000000;
const SUPPLY = 1e9;
const mkTick = (o) => Object.assign({
    token_address: '0xtoken', trade_type: 'buy', trader_address: '0xa', sender_address: null,
    price_bnb: 0.0000065, price_usd: 5, bnb_amount: 1, token_amount: 1000,
    block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: 0,
}, o);

function newFA(supply = SUPPLY) {
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: supply, symbol: 'T', creatorAddress: null });
    return fa;
}
const factorsAt = (fa, now) => fa.buildFactorMap('0xtoken', now);

// ═══════════════ A. 首买锚精确值 ═══════════════
console.log('A. 首买锚 = fire 价 × totalSupply');
{
    const f = newFA();
    f.processTick(mkTick({}));
    f.setBuyState('0xtoken', { buyPriceBnb: 0.0000065, buyTime: T0 + 2000, buySignalAt: T0 + 2000 });
    check('A1 锚=6.5e-6×1e9=6500（BNB 域）', factorsAt(f, T0 + 60000).entryMarketCap, 0.0000065 * SUPPLY);
    check('A2 getHolderFactors 同源', f.getHolderFactors('0xtoken', 'default', T0 + 60000).entryMarketCap, 0.0000065 * SUPPLY);
}

// ═══════════════ B. 补买不覆盖 ═══════════════
console.log('B. 补买不覆盖（臂身份=首买锚定）');
{
    const f = newFA();
    f.processTick(mkTick({ price_bnb: 0.0000065 }));
    f.setBuyState('0xtoken', { buyPriceBnb: 0.0000065, buyTime: T0 + 2000, buySignalAt: T0 + 2000 }); // 早期臂首买
    f.processTick(mkTick({ price_bnb: 0.0000090, timestamp: T0 + 400000 }));
    f.setBuyState('0xtoken', { buyPriceBnb: 0.0000090, buyTime: T0 + 400000, buySignalAt: T0 + 400000 }); // 主腿带外补买
    check('B1 补买后锚仍 6500（不随 buyPriceBnb 漂移）', factorsAt(f, T0 + 500000).entryMarketCap, 0.0000065 * SUPPLY);

    const g = newFA();
    g.processTick(mkTick({ price_bnb: 0.0000090 }));
    g.setBuyState('0xtoken', { buyPriceBnb: 0.0000090, buyTime: T0 + 2000, buySignalAt: T0 + 2000 }); // 主腿先开仓
    g.processTick(mkTick({ price_bnb: 0.0000065, timestamp: T0 + 400000 }));
    g.setBuyState('0xtoken', { buyPriceBnb: 0.0000065, buyTime: T0 + 400000, buySignalAt: T0 + 400000 }); // 回落带内补买
    check('B2 主腿先开仓不被改判（锚仍 9000）', factorsAt(g, T0 + 500000).entryMarketCap, 0.0000090 * SUPPLY);
}

// ═══════════════ C. 全清后重置 ═══════════════
console.log('C. clearBuyState 全清重置');
{
    const f = newFA();
    f.processTick(mkTick({}));
    f.setBuyState('0xtoken', { buyPriceBnb: 0.0000065, buyTime: T0 + 2000, buySignalAt: T0 + 2000 });
    f.clearBuyState('0xtoken');
    check('C1 全清后无仓 → null', factorsAt(f, T0 + 60000).entryMarketCap, null);
    f.processTick(mkTick({ price_bnb: 0.0000090, timestamp: T0 + 700000 }));
    f.setBuyState('0xtoken', { buyPriceBnb: 0.0000090, buyTime: T0 + 700000, buySignalAt: T0 + 700000 });
    check('C2 再入仓取新锚（9000）', factorsAt(f, T0 + 800000).entryMarketCap, 0.0000090 * SUPPLY);
}

// ═══════════════ D. null fail-closed ═══════════════
console.log('D. 锚/总量缺失 → null');
{
    const f1 = newFA();
    f1.processTick(mkTick({}));
    f1.setBuyState('0xtoken', { buyPriceBnb: 0, buyTime: T0 + 2000 }); // 锚缺失（fire 价缺失形状）
    check('D1 buyPriceBnb=0 → null（≠0 冒充带内）', factorsAt(f1, T0 + 60000).entryMarketCap, null);

    const f2 = newFA(0); // totalSupply 缺失
    f2.processTick(mkTick({}));
    f2.setBuyState('0xtoken', { buyPriceBnb: 0.0000065, buyTime: T0 + 2000 });
    check('D2 totalSupply=0 → null', factorsAt(f2, T0 + 60000).entryMarketCap, null);
}

// ═══════════════ E. 条件真值表 ═══════════════
console.log('E. T79 豁免腿真值表');
{
    const se = new StrategyEngine({});
    const T79 = 'marketCap > 0 AND marketCap < 7.4 AND realHoldDuration > 10 AND (entryMarketCap >= 7.4 OR realHoldDuration > 1800)';
    const mk = (mc, rhd, emc) => ({ marketCap: mc, realHoldDuration: rhd, entryMarketCap: emc });
    check('E1 主腿仓（entry 9）10s → 卖（原 T79 语义）', se.evaluateCondition(T79, mk(6.5, 11, 9)), true);
    check('E2 早期仓（entry 6.5）10s → 不卖（豁免）', se.evaluateCondition(T79, mk(6.5, 11, 6.5)), false);
    check('E3 早期仓 1801s → 卖（地板回归兜底）', se.evaluateCondition(T79, mk(6.5, 1801, 6.5)), true);
    check('E4 早期仓 1800s 恰等 → 不卖（严格大于）', se.evaluateCondition(T79, mk(6.5, 1800, 6.5)), false);
    check('E5 锚 null → 不卖（fail-closed 退通用腿）', se.evaluateCondition(T79, mk(6.5, 11, null)), false);
    check('E6 市值 7.4 恰等 → 不卖（严格小于）', se.evaluateCondition(T79, mk(7.4, 11, 9)), false);
    check('E7 市值 0 → 不卖（防 0 假触发）', se.evaluateCondition(T79, mk(0, 11, 9)), false);
}

console.log('F. 早期臂专属腿真值表');
{
    const se = new StrategyEngine({});
    const ARM_STOP = 'entryMarketCap < 7.4 AND holdDuration > 600 AND profitPercent <= 0';
    const mk = (emc, hd, pp) => ({ entryMarketCap: emc, holdDuration: hd, profitPercent: pp });
    check('F1 早期仓 601s 无利润 → 卖', se.evaluateCondition(ARM_STOP, mk(6.5, 601, -3)), true);
    check('F2 早期仓 600s 恰等 → 不卖', se.evaluateCondition(ARM_STOP, mk(6.5, 600, -3)), false);
    check('F3 早期仓有利润 → 不卖（protect 接管）', se.evaluateCondition(ARM_STOP, mk(6.5, 700, 5)), false);
    check('F4 主腿仓（entry 9）→ 恒不卖（域限定）', se.evaluateCondition(ARM_STOP, mk(9, 700, -3)), false);
    check('F5 锚 null → 不卖（fail-closed）', se.evaluateCondition(ARM_STOP, mk(null, 700, -3)), false);

    const PROTECT = 'entryMarketCap < 7.4 AND peakProfitPct >= 20 AND profitPercent <= 0';
    check('F6 protect20：曾 +20 回落 ≤0 → 卖', se.evaluateCondition(PROTECT, { entryMarketCap: 6.5, peakProfitPct: 25, profitPercent: -1 }), true);
    check('F7 protect20：峰值恰 20 → 卖（≥）', se.evaluateCondition(PROTECT, { entryMarketCap: 6.5, peakProfitPct: 20, profitPercent: 0 }), true);
    check('F8 protect20：主腿仓不触发', se.evaluateCondition(PROTECT, { entryMarketCap: 9, peakProfitPct: 25, profitPercent: -1 }), false);

    const UPPER = 'entryMarketCap < 7.4 AND marketCap >= 27';
    check('F9 上位离场：涨到 27 → 卖', se.evaluateCondition(UPPER, { entryMarketCap: 6.5, marketCap: 27 }), true);
    check('F10 上位离场：主腿仓不触发', se.evaluateCondition(UPPER, { entryMarketCap: 9, marketCap: 30 }), false);
}

// ═══════════════ G. 快照白名单透传 ═══════════════
console.log('G. FactorBuilder 快照透传');
{
    const snap = FactorBuilder.buildFactorValuesForTimeSeries({
        marketCap: 6.5, entryMarketCap: 6.5, peakMarketCapSinceLastBuy: 8.0,
    });
    check('G1 快照含 entryMarketCap', snap.entryMarketCap, 6.5);
    const snapOld = FactorBuilder.buildFactorValuesForTimeSeries({ marketCap: 6.5 });
    check('G2 旧因子结果无键 → null 不掩盖', snapOld.entryMarketCap, null);
}

// ═══════════════ H. getFactorKeys 探针 ═══════════════
console.log('H. 键集探针（未知因子三防线自动认得）');
{
    check('H1 entryMarketCap 在键集', newFA().getFactorKeys().has('entryMarketCap'), true);
}

console.log(`\n${'='.repeat(50)}`);
console.log(`通过 ${passed} / 失败 ${failed}`);
process.exit(failed ? 1 : 0);
