#!/usr/bin/env node
/**
 * T84 市值量纲切换单测（2026-10-28 用户裁定：市值全域 USD→BNB，BNB 价漂移使
 * USD 阈值失真）——本地零 DB 零网络。
 *
 * 切换面：FA marketCap/fdv/peakMarketCapSinceLastBuy 三键由 price×supply×bnbUsd
 * （USD 域）改为 priceBnb×totalSupply（BNB 域）；观察信号默认阈值 12000→16 同批
 * （B8 段在 _test_observation_signals.cjs）。
 *
 * 覆盖：
 *   A. marketCap = priceBnb × totalSupply 精确值（price_usd 扰动不改——USD 域
 *      旧形状依赖 price_usd 推 bnbUsd，同价不同汇率曾得不同市值）
 *   B. price_usd 缺失/为 0（bnbUsd=0）时 marketCap 仍有值——USD 域旧形状该场景
 *      恒 0（currentPrice=0 短路），新域免疫 = 量纲切换核心收益反证
 *   C. fdv == marketCap 镜像不变
 *   D. peakMarketCapSinceLastBuy = highestPriceSinceBuyBnb × totalSupply（BNB 域；
 *      旧 USD 形状 bnbUsd=0 → null fail-closed 死臂，新域零汇率依赖）
 *   E. getFactorKeys 探针含三键（键集自证，防手维护清单漂移）
 *   F. 源码口径断言：marketCap/peakMarketCapSinceLastBuy 两行源码禁含 bnbUsd 乘子
 *      （防复活反证——回归 USD 域=全部 BNB 阈值条件静默恒死/恒活）
 *
 * 用法：node scripts/_test_mcap_bnb_domain.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const FourMemeFactorAggregator = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'));

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

function newFA() {
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: SUPPLY, symbol: 'T', creatorAddress: null });
    return fa;
}

const factorsAt = (fa, now) => fa.buildFactorMap('0xtoken', now);

// ═══════════════ A. 精确公式：priceBnb × totalSupply ═══════════════
console.log('A. marketCap = priceBnb × totalSupply（price_usd 扰动无关）');
{
    const now = T0 + 60000;
    // 同 price_bnb、不同 price_usd（745 vs 731 两套隐含汇率）→ marketCap 必须恒等
    const f1 = newFA(); f1.processTick(mkTick({ price_bnb: 0.0000065, price_usd: 0.0048425 }));
    const f2 = newFA(); f2.processTick(mkTick({ price_bnb: 0.0000065, price_usd: 0.0047515 }));
    check('A1 汇率扰动恒等（6.5e-6×1e9=6500）', factorsAt(f1, now).marketCap, 0.0000065 * SUPPLY);
    check('A2 两套 price_usd 同市值', factorsAt(f1, now).marketCap, factorsAt(f2, now).marketCap);
    check('A3 非整值精确（6.71e-6）', (() => {
        const f = newFA(); f.processTick(mkTick({ price_bnb: 0.00000671 }));
        return factorsAt(f, now).marketCap;
    })(), 0.00000671 * SUPPLY);
}

// ═══════════════ B. bnbUsd=0 免疫（旧 USD 域恒 0 场景）═══════════════
console.log('B. price_usd 缺失/为 0 时 marketCap 仍有值');
{
    const now = T0 + 60000;
    const f1 = newFA(); f1.processTick(mkTick({ price_bnb: 0.0000065, price_usd: 0 }));
    const f2 = newFA(); f2.processTick(mkTick({ price_bnb: 0.0000065, price_usd: null }));
    check('B1 price_usd=0 → 6500（旧 USD 域=0）', factorsAt(f1, now).marketCap, 0.0000065 * SUPPLY);
    check('B2 price_usd=null → 6500', factorsAt(f2, now).marketCap, 0.0000065 * SUPPLY);
}

// ═══════════════ C. fdv 镜像 ═══════════════
console.log('C. fdv == marketCap');
{
    const f = newFA(); f.processTick(mkTick({ price_bnb: 0.00000604 }));
    const m = factorsAt(f, T0 + 60000);
    check('C1 fdv 镜像', m.fdv, m.marketCap);
}

// ═══════════════ D. peakMarketCapSinceLastBuy BNB 域 ═══════════════
console.log('D. peakMarketCapSinceLastBuy = 最高价×总量（零汇率依赖）');
{
    const f = newFA();
    f.processTick(mkTick({ price_bnb: 0.0000065, price_usd: 0, timestamp: T0 + 1000 })); // bnbUsd=0
    f.setBuyState('0xtoken', { buyPriceBnb: 0.0000065, buyTime: T0 + 2000, buySignalAt: T0 + 2000 });
    // 渐进冲高（单跳 23% 会被离群剔除链拒——peak 只吃接受价，逐级小步推到 8e-6；
    // log_index 逐 tick 递增防同位重复行被 chainLate 迟到拦截跳价）
    f.processTick(mkTick({ price_bnb: 0.0000070, price_usd: 0, timestamp: T0 + 2100, log_index: 1 }));
    f.processTick(mkTick({ price_bnb: 0.0000075, price_usd: 0, timestamp: T0 + 2200, log_index: 2 }));
    f.processTick(mkTick({ price_bnb: 0.0000080, price_usd: 0, timestamp: T0 + 2300, log_index: 3 }));
    const m = factorsAt(f, T0 + 60000);
    check('D1 峰值市值=8e-6×1e9=8000（旧 USD 域 bnbUsd=0 → null 死臂）',
        m.peakMarketCapSinceLastBuy, 0.0000080 * SUPPLY);
}

// ═══════════════ E. getFactorKeys 探针 ═══════════════
console.log('E. 键集探针');
{
    const fa = newFA();
    const keys = fa.getFactorKeys();
    check('E1 marketCap 在键集', keys.has('marketCap'), true);
    check('E2 peakMarketCapSinceLastBuy 在键集', keys.has('peakMarketCapSinceLastBuy'), true);
    check('E3 entryMarketCap 在键集（T84 新键）', keys.has('entryMarketCap'), true);
}

// ═══════════════ F. 源码口径断言（防复活反证）═══════════════
console.log('F. 源码禁 bnbUsd 乘子（回归 USD 域=BNB 阈值条件静默漂移）');
{
    const src = read('src/services/FourMemeFactorAggregator.js');
    const capLine = src.split('\n').find(l => l.includes('marketCap: state.totalSupply > 0 && currentPriceBnb > 0'));
    check('F1 marketCap 行存在且走 currentPriceBnb', !!capLine, true);
    check('F2 marketCap 行无 bnbUsd/currentPrice(USD) 乘子', /bnbUsd|currentPrice \*/.test(capLine || ''), false);
    const peakLines = src.split('\n').filter(l => l.includes('pos.highestPriceSinceBuyBnb * state.totalSupply'));
    check('F3 peakMarketCapSinceLastBuy 乘式=最高价×总量（恰一处）', peakLines.length, 1);
    check('F4 peak 乘式无 bnbUsd 残留', peakLines.every(l => !l.includes('bnbUsd')), true);
}

console.log(`\n${'='.repeat(50)}`);
console.log(`通过 ${passed} / 失败 ${failed}`);
process.exit(failed ? 1 : 0);
