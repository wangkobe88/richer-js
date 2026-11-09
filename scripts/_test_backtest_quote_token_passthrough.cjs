#!/usr/bin/env node
/**
 * T127 quote_token 透传断链事故单测（2026-11-09）——本地零 DB 零网络。
 *
 * 事故：TICK_SELECT_COLUMNS 加了 quote_token 列、FA state.quoteToken write-once
 * 捕获点（processTick tick.quote_token）也在，但两处上游组装对象都漏传该键——
 *   ① BacktestEngine._loadWssTicks 的 this._ticks.push({...}) 组装
 *   ② flap-ankr-ws-collector._feedFa 的 FA.processTick({...}) 组装
 * → flap quote 盘票 state.quoteToken 恒 null → resolveLaunchPriceBnb('flap', null)
 * 误判 BNB 盘用 FL 常量分母（正确=quote 盘无常量锚→旧口径首可靠价）。bt-v85
 * 回测 128/162 信号 token（79%）curVs 失真、cheat 门（CD 侧 DB 行自带 quote_token
 * 判对）与 FA/腿门/BP 门分母分裂。
 *
 * 覆盖：
 *   A. 功能锁：FA quote 盘三态判定——flap+quote_token → 首可靠价旧口径；
 *      flap 无 quote_token → FL 常量；fourmeme → FM 常量（三者数值互异可分辨）
 *   B. 源码锁①：BacktestEngine tick 组装对象透传 quote_token（防再删）
 *   C. 源码锁②：flap collector _feedFa 喂 FA 对象透传 quote_token
 *   D. write-once：quote_token 后到不覆盖首值（BNB→quote 误标行不污染）
 *
 * 用法：node scripts/_test_backtest_quote_token_passthrough.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const FourMemeFactorAggregator = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'));
const { FLAP_LAUNCH_PRICE_BNB, FOURMEME_LAUNCH_PRICE_BNB } = require(path.join(ROOT, 'src', 'market-analysis', 'launch-price.js'));

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const T0 = 1790802000000;
let _li = 0;
const mkTick = (o) => Object.assign({
    token_address: '0xtoken', trade_type: 'buy', trader_address: '0xa', sender_address: null,
    price_bnb: 6.0 * 1e-9, price_usd: 0.0036, bnb_amount: 1, token_amount: 1000000,
    block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: _li++,
}, o);

function newFA(platform) {
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null, platform });
    return fa;
}

// ═══════════════ A. FA quote 盘三态判定 ═══════════════
console.log('A. FA quote 盘三态判定（currentVsLaunchPct 分母）');
{
    // 首可靠价 6.0e-9、现价 6.6e-9
    const fa = newFA('flap');
    fa.processTick(mkTick({ price_bnb: 6.0e-9, quote_token: '0xquote'.padEnd(42, '0') }));
    fa.processTick(mkTick({ price_bnb: 6.6e-9, quote_token: '0xquote'.padEnd(42, '0') }));
    const got = fa.buildFactorMap('0xtoken', T0 + 2000).currentVsLaunchPct;
    check('flap+quote_token → 旧口径首可靠价分母 = +10（事故时误 FL=+19）', () =>
        assert.strictEqual(got, 10));

    const faBnb = newFA('flap');
    faBnb.processTick(mkTick({ price_bnb: 6.0e-9 }));
    faBnb.processTick(mkTick({ price_bnb: 6.6e-9 }));
    const gotBnb = faBnb.buildFactorMap('0xtoken', T0 + 2000).currentVsLaunchPct;
    const wantBnb = parseFloat((100 * (6.6e-9 / FLAP_LAUNCH_PRICE_BNB - 1)).toFixed(2));
    check(`flap 无 quote_token → FL 常量分母 = +${wantBnb}（三态互异可分辨）`, () =>
        assert.strictEqual(gotBnb, wantBnb));

    const faFm = newFA('fourmeme');
    faFm.processTick(mkTick({ price_bnb: FOURMEME_LAUNCH_PRICE_BNB * 1.0 }));
    faFm.processTick(mkTick({ price_bnb: FOURMEME_LAUNCH_PRICE_BNB * 1.5 }));
    check('fourmeme → FM 常量分母 = +50', () =>
        assert.strictEqual(faFm.buildFactorMap('0xtoken', T0 + 2000).currentVsLaunchPct, 50));

    check('三态数值互异（quote 旧口径 ≠ FL ≠ FM，事故=三态塌缩成两态）', () => {
        assert.notStrictEqual(got, gotBnb);
        assert.notStrictEqual(gotBnb, 50);
    });
}

// ═══════════════ B. 源码锁①：回测 tick 组装透传 ═══════════════
console.log('B. 源码锁① BacktestEngine._loadWssTicks tick 组装');
{
    const src = read('src/trading-engine/implementations/BacktestEngine.js');
    check('TICK_SELECT_COLUMNS 含 quote_token 列（拉取侧）', () =>
        assert.ok(/TICK_SELECT_COLUMNS = '[^']*quote_token/.test(src)));
    check('this._ticks.push 组装对象含 quote_token: row.quote_token（透传侧，事故断点）', () =>
        assert.ok(/quote_token:\s*row\.quote_token\s*\|\|\s*null/.test(src)));
}

// ═══════════════ C. 源码锁②：collector _feedFa 透传 ═══════════════
console.log('C. 源码锁② flap collector _feedFa 喂 FA 对象');
{
    const src = read('src/collectors/flap-ankr-ws-collector.js');
    check('_feedFa 的 processTick 对象含 quote_token: decoded.quoteToken（透传侧，事故断点）', () =>
        assert.ok(/quote_token:\s*decoded\.quoteToken\s*\|\|\s*null/.test(src)));
}

// ═══════════════ D. write-once ═══════════════
console.log('D. quoteToken write-once（首个非空捕获）');
{
    const fa = newFA('flap');
    fa.processTick(mkTick({ price_bnb: 6.0e-9 }));                       // 首 tick 无标记（异常序/竞态）
    fa.processTick(mkTick({ price_bnb: 6.6e-9, quote_token: '0xq'.padEnd(42, '0') })); // 后到 quote 标记
    // FA 实现语义=首个非空 quote_token 捕获（`tick.quote_token && !state.quoteToken`）：
    // 后到标记把口径补正为 quote 盘旧口径——比永远误判 BNB 盘用 FL 更正确（该票
    // 实际是 quote 盘）；一旦捕获不再翻转（BNB↔quote 异常抖动不产生口径漂移）
    const got = fa.buildFactorMap('0xtoken', T0 + 2000).currentVsLaunchPct;
    check('首 tick 无标记 → 后到标记补正为 quote 盘旧口径 = +10', () =>
        assert.strictEqual(got, 10));

    const fa2 = newFA('flap');
    fa2.processTick(mkTick({ price_bnb: 6.0e-9, quote_token: '0xq'.padEnd(42, '0') }));
    fa2.processTick(mkTick({ price_bnb: 6.6e-9, quote_token: null }));   // 后到标记消失
    check('已捕获 quote 后 → 标记消失不翻转回 BNB 盘口径（write-once）', () =>
        assert.strictEqual(fa2.buildFactorMap('0xtoken', T0 + 2000).currentVsLaunchPct, 10));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
