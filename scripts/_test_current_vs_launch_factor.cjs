#!/usr/bin/env node
/**
 * T122 currentVsLaunchPct（现价较发行价涨幅）单测（2026-11-07 接近发行价臂）——
 * 本地零 DB 零网络。
 *
 * 键语义（用户裁定「参考购买前检测中『接近发布价』的判断」）：BP
 * currentVsLaunchPct 同口径——分子分母同可靠价链（_relPriceBnb/_relFirstPriceBnb
 * = BP snapshot 的 arc.last/rel[0]），near_launch 判据=≤+50% 含破发；null=未见
 * 可靠价 fail-closed（裸比较恒 false 不触发=宁拦不冒充）。与 TPAPre_asofRelFirst
 * （TPA 审批时刻冻结快照）语义刻意分开——本键实时。
 *
 * 覆盖：
 *   A. 精确值（+50 恰界/+150/破发 -50/toFixed 舍入）
 *   B. 首可靠价冻结基准（多笔上涨后仍按首笔）
 *   C. 无可靠价 null（零 tick / 仅尘 tick 不进价链）
 *   D. getFactorKeys 探针含键（未知因子三防线）
 *   E. FactorBuilder 快照透传（缺键 → null 不掩盖）
 *   F. TPA asofRelFirst 冻结键与实时键分开（setAsofMs 后价再涨两键分叉）
 *   G. 源码口径锁（发射公式形状=可靠价链双哨兵；与 marketCap 任意价轨分开）
 *
 * 用法：node scripts/_test_current_vs_launch_factor.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const FourMemeFactorAggregator = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'));
const FactorBuilder = require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const T0 = 1790802000000;
let _li = 0;
const mkTick = (o) => Object.assign({
    token_address: '0xtoken', trade_type: 'buy', trader_address: '0xa', sender_address: null,
    price_bnb: 1.0 * 1e-9, price_usd: 0.0006, bnb_amount: 1, token_amount: 1000000,
    block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: _li++,
}, o);

function newFA() {
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    return fa;
}

// ═══════════════ A. 精确值 ═══════════════
console.log('A. 精确值（可靠价链 现价/首可靠价−1）');
{
    const fa = newFA();
    fa.processTick(mkTick({ price_bnb: 1.0 * 1e-9, timestamp: T0 + 1000, block_number: 100 }));
    fa.processTick(mkTick({ price_bnb: 1.5 * 1e-9, timestamp: T0 + 2000, block_number: 101 }));
    check('1.0→1.5 = +50 恰界（near_launch 判据 ≤50 含边界）', () =>
        assert.strictEqual(fa.buildFactorMap('0xtoken', T0 + 2000).currentVsLaunchPct, 50));

    const faUp = newFA();
    faUp.processTick(mkTick({ price_bnb: 1.0 * 1e-9, timestamp: T0 + 1000 }));
    faUp.processTick(mkTick({ price_bnb: 2.5 * 1e-9, timestamp: T0 + 2000 }));
    check('1.0→2.5 = +150（已脱离发行价区）', () =>
        assert.strictEqual(faUp.buildFactorMap('0xtoken', T0 + 2000).currentVsLaunchPct, 150));

    const faDn = newFA();
    faDn.processTick(mkTick({ price_bnb: 1.0 * 1e-9, timestamp: T0 + 1000 }));
    faDn.processTick(mkTick({ price_bnb: 0.5 * 1e-9, timestamp: T0 + 2000 }));
    check('破发 1.0→0.5 = -50（含破发=贴发行价区）', () =>
        assert.strictEqual(faDn.buildFactorMap('0xtoken', T0 + 2000).currentVsLaunchPct, -50));

    const faR = newFA();
    faR.processTick(mkTick({ price_bnb: 1.0 * 1e-9, timestamp: T0 + 1000 }));
    faR.processTick(mkTick({ price_bnb: 1.1234 * 1e-9, timestamp: T0 + 2000 }));
    check('toFixed(2) 舍入 12.34', () =>
        assert.strictEqual(faR.buildFactorMap('0xtoken', T0 + 2000).currentVsLaunchPct, 12.34));

    const faFlat = newFA();
    faFlat.processTick(mkTick({ price_bnb: 1.0 * 1e-9, timestamp: T0 + 1000 }));
    check('恰首价 → 0（有证据零值）', () =>
        assert.strictEqual(faFlat.buildFactorMap('0xtoken', T0 + 1000).currentVsLaunchPct, 0));
}

// ═══════════════ B. 首可靠价冻结 ═══════════════
console.log('B. 基准=首个可靠价（T98 尘门同源 _relFirstPriceBnb 冻结语义）');
{
    const fa = newFA();
    fa.processTick(mkTick({ price_bnb: 2.0 * 1e-9, timestamp: T0 + 1000 }));
    fa.processTick(mkTick({ price_bnb: 3.0 * 1e-9, timestamp: T0 + 2000 }));
    fa.processTick(mkTick({ price_bnb: 4.0 * 1e-9, timestamp: T0 + 3000 }));
    check('三笔上涨后仍按首笔 2.0（4/2−1=+100）', () =>
        assert.strictEqual(fa.buildFactorMap('0xtoken', T0 + 3000).currentVsLaunchPct, 100));
}

// ═══════════════ C. 无可靠价 null ═══════════════
console.log('C. 未见可靠价 → null fail-closed（裸比较恒 false 不触发）');
{
    const fa0 = newFA();
    check('零 tick → null', () =>
        assert.strictEqual(fa0.buildFactorMap('0xtoken', T0 + 1000).currentVsLaunchPct, null));

    const faDust = newFA();
    faDust.processTick(mkTick({ bnb_amount: 0.00001, timestamp: T0 + 1000 }));
    check('仅尘 tick（不进价链）→ null', () =>
        assert.strictEqual(faDust.buildFactorMap('0xtoken', T0 + 1000).currentVsLaunchPct, null));
}

// ═══════════════ D. getFactorKeys 探针 ═══════════════
console.log('D. getFactorKeys 探针含键（未知因子三防线自动认得）');
{
    const fa = newFA();
    check('探针收键', () => assert.ok(fa.getFactorKeys().has('currentVsLaunchPct')));
}

// ═══════════════ E. FactorBuilder 快照透传 ═══════════════
console.log('E. FactorBuilder 快照透传（缺键 → null 不掩盖）');
{
    const snap = FactorBuilder.buildFactorValuesForTimeSeries({ currentVsLaunchPct: 35.2 });
    check('透传 35.2', () => assert.strictEqual(snap.currentVsLaunchPct, 35.2));
    const snapOld = FactorBuilder.buildFactorValuesForTimeSeries({});
    check('旧 FA 缺键 → null', () => assert.strictEqual(snapOld.currentVsLaunchPct, null));
}

// ═══════════════ F. TPA 冻结键与实时键分开 ═══════════════
console.log('F. TPAPre_asofRelFirst（冻结）与 currentVsLaunchPct（实时）语义分开');
{
    const fa = newFA();
    fa.processTick(mkTick({ price_bnb: 1.0 * 1e-9, timestamp: T0 + 1000 }));
    fa.processTick(mkTick({ price_bnb: 1.2 * 1e-9, timestamp: T0 + 2000 }));
    fa.setAsofMs('0xtoken', T0 + 2000); // TPA 审批时刻冻结 +20%
    fa.processTick(mkTick({ price_bnb: 1.5 * 1e-9, timestamp: T0 + 3000 }));
    const f = fa.buildFactorMap('0xtoken', T0 + 3000);
    check('冻结键停在 +20 / 实时键推进 +50', () => {
        assert.ok(Math.abs(f.TPAPre_asofRelFirst - 20) < 1e-9, `asofRelFirst=${f.TPAPre_asofRelFirst}`); // 冻结值未舍入（浮点原值）
        assert.strictEqual(f.currentVsLaunchPct, 50); // 实时键 toFixed(2)
    });
}

// ═══════════════ G. 源码口径锁 ═══════════════
console.log('G. 源码口径断言');
{
    const src = read('src/services/FourMemeFactorAggregator.js');
    ok('G 发射公式=可靠价链双哨兵（_relPriceBnb>0 ∧ _relFirstPriceBnb>0——不用任意价轨 currentPriceBnb）',
        src.includes('currentVsLaunchPct: (state._relPriceBnb > 0 && state._relFirstPriceBnb > 0)'));
    ok('G 回测同源（as-of 冻结键 _asofRelFirst 同分母首可靠价——BP 对拍口径一致）',
        src.includes('_asofRelFirst = ((state._relPriceBnb - state._relFirstPriceBnb) / state._relFirstPriceBnb) * 100'));
    const fb = read('src/trading-engine/core/FactorBuilder.js');
    ok('G 快照白名单透传（?? null 不掩盖）', fb.includes('currentVsLaunchPct: factorResults.currentVsLaunchPct ?? null'));
}
function ok(name, cond) {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.log(`  ✗ ${name}`); }
}

console.log(`\n${passed} 通过, ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
