#!/usr/bin/env node
/**
 * T244 burst 波五键单测（活跃度 pointType 原料，2026-11-26）——零 DB 零网络。
 *
 * 五键（FourMemeFactorAggregator，静默阈 30s 独立状态机）：
 *   - burstStallMs：最近完成的 ≥30s 静默段时长 ms（值域 {0}∪[30000,∞)，0=从无静默证据）
 *   - burstWaveSec：当前波已持续秒数（now=buildFactorMap 入参；从未开波 null）
 *   - burstWaveBuyBnb / burstWaveSellBnb / burstWaveBuyN：当前波累计买额 / 卖额 / 买笔数
 *     （新静默段开新波时清零；苏醒第一笔即计入）
 *
 * 覆盖：
 *   A. 状态机：边界恰阈值 / 29999 不触发 / 苏醒笔计入 / 卖出不计入买额 / 二次静默重开波清零
 *      / burstWaveSec asOf 推进 / 从未开波 null / stall 不被短 gap 覆盖
 *   B. 与 t7 quiet 族（阈 60s）互不干扰：30~60s 静默只开 burst 波不动 quiet 族；
 *      ≥60s 静默两族各自定格；quietThresholdMs 调低不改 burst 族
 *   C. 迟到 guard（defer 乱序晚到旧行不污染新波）
 *   D. getFactorKeys 探针含五键 / FactorBuilder 快照透传（缺键 → null 不掩盖）
 *   E. 源码口径（判 gap 在 lastTickAt 更新前 / burstWaveSec 用 now 入参 / 阈值常量 30000）
 *
 * 用法：node scripts/_test_burst_wave_factors.cjs
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
let _li = 0;
const mkTick = (o) => Object.assign({
    token_address: '0xtoken', trade_type: 'buy', trader_address: '0xa', sender_address: null,
    price_bnb: 0.000001, price_usd: 0.0006, bnb_amount: 0.1, token_amount: 100000,
    block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: _li++,
}, o);
function newFA(factorParams) {
    const cfg = factorParams ? { fourmemeWs: { factorParams } } : {};
    const fa = new FourMemeFactorAggregator(cfg, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    return fa;
}
const B = (f) => ({ stall: f.burstStallMs, sec: f.burstWaveSec, buy: f.burstWaveBuyBnb, sell: f.burstWaveSellBnb, n: f.burstWaveBuyN });

console.log('A. burst 波状态机（静默阈 30s）');
{
    const fa = newFA();
    // 从未开波：stall 0 / sec null / 累计 0
    fa.processTick(mkTick({ timestamp: T0 + 1000 }));
    let f = fa.buildFactorMap('0xtoken', T0 + 1000);
    check('A1 从无静默：burstStallMs=0、burstWaveSec=null、累计 0', () => assert.deepStrictEqual(B(f), { stall: 0, sec: null, buy: 0, sell: 0, n: 0 }));

    // gap 29999ms（< 30s）不触发
    fa.processTick(mkTick({ timestamp: T0 + 1000 + 29999, bnb_amount: 0.2 }));
    f = fa.buildFactorMap('0xtoken', T0 + 1000 + 29999);
    check('A2 gap 29999ms 不开波（阈值严格 ≥）', () => assert.deepStrictEqual(B(f), { stall: 0, sec: null, buy: 0, sell: 0, n: 0 }));

    // gap 恰 30000ms 触发：定格 stall、开波、苏醒笔即计入
    fa.processTick(mkTick({ timestamp: T0 + 1000 + 29999 + 30000, bnb_amount: 0.12, block_number: 101 }));
    f = fa.buildFactorMap('0xtoken', T0 + 1000 + 29999 + 30000);
    check('A3 gap 恰 30000ms 触发：stall=30000、苏醒买笔即计入（buy 0.12 / n 1）、sec=0', () => assert.deepStrictEqual(B(f), { stall: 30000, sec: 0, buy: 0.12, sell: 0, n: 1 }));

    // 波内后续：买 2 笔 + 卖 1 笔
    const t2 = T0 + 1000 + 29999 + 30000;
    fa.processTick(mkTick({ timestamp: t2 + 2000, bnb_amount: 0.1, block_number: 102 }));
    fa.processTick(mkTick({ timestamp: t2 + 3500, bnb_amount: 0.3, trade_type: 'sell', block_number: 102, log_index: 7 }));
    fa.processTick(mkTick({ timestamp: t2 + 4000, bnb_amount: 0.08, block_number: 103 }));
    f = fa.buildFactorMap('0xtoken', t2 + 4000);
    check('A4 波内累计：买额 0.12+0.1+0.08 / 买 3 笔 / 卖额 0.3（卖不计入买额与笔数）/ sec=4', () => assert.deepStrictEqual(B(f), { stall: 30000, sec: 4, buy: 0.3, sell: 0.3, n: 3 }));

    // burstWaveSec 随 asOf 推进（now 入参）
    f = fa.buildFactorMap('0xtoken', t2 + 4000 + 26000);
    check('A5 burstWaveSec 随 asOf 推进到 30（now 入参，不读墙钟）', () => assert.strictEqual(f.burstWaveSec, 30));

    // 二次静默（41s）重开波清零、stall 更新
    fa.processTick(mkTick({ timestamp: t2 + 4000 + 41000, bnb_amount: 0.05, block_number: 104 }));
    f = fa.buildFactorMap('0xtoken', t2 + 4000 + 41000);
    check('A6 二次静默 41s：stall 更新 41000、波清零重开（苏醒笔 0.05/1 笔）', () => assert.deepStrictEqual(B(f), { stall: 41000, sec: 0, buy: 0.05, sell: 0, n: 1 }));

    // 短 gap 不覆盖 stall 证据（沉寂过的票隔几笔小活动再评仍可见最近一次长静默段）
    fa.processTick(mkTick({ timestamp: t2 + 4000 + 41000 + 3000, bnb_amount: 0.02, block_number: 105 }));
    f = fa.buildFactorMap('0xtoken', t2 + 4000 + 41000 + 3000);
    check('A7 短 gap（3s）不覆盖 stall（仍 41000）且波不重置', () => assert.deepStrictEqual(B(f), { stall: 41000, sec: 3, buy: 0.07, sell: 0, n: 2 }));
}

console.log('B. 与 t7 quiet 族（阈 60s）互不干扰');
{
    const fa = newFA();
    fa.processTick(mkTick({ timestamp: T0 + 1000 }));
    fa.processTick(mkTick({ timestamp: T0 + 1000 + 45000, bnb_amount: 0.2, block_number: 101 })); // 45s 静默：只开 burst 波
    let f = fa.buildFactorMap('0xtoken', T0 + 1000 + 45000);
    check('B1 30~60s 静默：burst 族开波（stall 45000），quiet 族不动（quietSpanMs 0 / quietSurgeSec null）', () => {
        assert.strictEqual(f.burstStallMs, 45000); assert.strictEqual(f.burstWaveBuyBnb, 0.2); assert.strictEqual(f.burstWaveBuyN, 1);
        assert.strictEqual(f.quietSpanMs, 0); assert.strictEqual(f.quietSurgeSec, null);
    });
    fa.processTick(mkTick({ timestamp: T0 + 1000 + 45000 + 70000, bnb_amount: 0.3, block_number: 102 })); // 70s 静默：两族各自定格
    f = fa.buildFactorMap('0xtoken', T0 + 1000 + 45000 + 70000);
    check('B2 ≥60s 静默：两族各自定格（quiet stall 70000 / burst stall 70000，波都从本笔重开）', () => {
        assert.strictEqual(f.quietSpanMs, 70000); assert.strictEqual(f.quietSurgeBuyBnb, 0.3); assert.strictEqual(f.quietSurgeSec, 0);
        assert.strictEqual(f.burstStallMs, 70000); assert.strictEqual(f.burstWaveBuyBnb, 0.3); assert.strictEqual(f.burstWaveBuyN, 1);
    });
    // quietThresholdMs 调到 30s：quiet 族在 31s 静默时也重置——burst 族读数不变
    const fa2 = newFA({ quietThresholdMs: 30000 });
    fa2.processTick(mkTick({ timestamp: T0 + 1000 }));
    fa2.processTick(mkTick({ timestamp: T0 + 1000 + 31000, bnb_amount: 0.11, block_number: 101 }));
    const g = fa2.buildFactorMap('0xtoken', T0 + 1000 + 31000);
    check('B3 quietThresholdMs 调低只影响 quiet 族，burst 族读数与缺省配置下同形（stall 31000 / buy 0.11）', () => {
        assert.strictEqual(g.quietSpanMs, 31000); assert.strictEqual(g.burstStallMs, 31000); assert.strictEqual(g.burstWaveBuyBnb, 0.11); assert.strictEqual(g.burstWaveBuyN, 1);
    });
}

console.log('C. 迟到 guard（defer 乱序晚到旧行不污染新波）');
{
    const fa = newFA();
    fa.processTick(mkTick({ timestamp: T0 + 1000 }));
    fa.processTick(mkTick({ timestamp: T0 + 1000 + 40000, bnb_amount: 0.1, block_number: 101 })); // 开波 @ T0+41000
    fa.processTick(mkTick({ timestamp: T0 + 1000 + 5000, bnb_amount: 9, block_number: 99 })); // 晚到旧行（ts < 波起点）
    const f = fa.buildFactorMap('0xtoken', T0 + 1000 + 40000);
    check('C1 晚到旧行（ts 早于波起点 9 BNB 买）不计入新波', () => assert.deepStrictEqual(B(f), { stall: 40000, sec: 0, buy: 0.1, sell: 0, n: 1 }));
}

console.log('D. getFactorKeys 探针 / FactorBuilder 快照透传');
{
    const keys = [...newFA().getFactorKeys()];
    check('D1 getFactorKeys 含 burst 五键', () => ['burstStallMs', 'burstWaveSec', 'burstWaveBuyBnb', 'burstWaveSellBnb', 'burstWaveBuyN'].forEach((k) => assert.ok(keys.includes(k), `缺 ${k}`)));
    const snapObj = FactorBuilder.buildFactorValuesForTimeSeries({});
    check('D2 FactorBuilder 快照透传：旧 FA 无键 → null 不掩盖（五键在位且值 null）', () => {
        ['burstStallMs', 'burstWaveSec', 'burstWaveBuyBnb', 'burstWaveSellBnb', 'burstWaveBuyN']
            .forEach((k) => assert.ok(k in snapObj && snapObj[k] === null, `快照缺 ${k} 或未回落 null`));
    });
    const live = FactorBuilder.buildFactorValuesForTimeSeries({ burstStallMs: 45000, burstWaveSec: 3, burstWaveBuyBnb: 0.31, burstWaveSellBnb: 0, burstWaveBuyN: 3 });
    check('D2b 快照原值透传（分类因子快照 / 回测留痕用）', () => assert.deepStrictEqual(
        { s: live.burstStallMs, w: live.burstWaveSec, b: live.burstWaveBuyBnb, sl: live.burstWaveSellBnb, n: live.burstWaveBuyN },
        { s: 45000, w: 3, b: 0.31, sl: 0, n: 3 }));
    const src = fs.readFileSync(path.join(ROOT, 'src/trading-engine/core/FactorBuilder.js'), 'utf8');
    check('D3 源码口径：快照白名单五键逐键 `?? null`', () => ['burstStallMs', 'burstWaveSec', 'burstWaveBuyBnb', 'burstWaveSellBnb', 'burstWaveBuyN'].every((k) => src.includes(`${k}: factorResults.${k} ?? null`)));
}

console.log('E. 源码口径（FA）');
{
    const src = fs.readFileSync(path.join(ROOT, 'src/services/FourMemeFactorAggregator.js'), 'utf8');
    const iStall = src.indexOf('ts - state.lastTickAt >= BURST_STALL_GAP_MS');
    const iLast = src.indexOf('state.lastTickAt = state.lastTickAt === null ? ts : Math.max(state.lastTickAt, ts);');
    check('E1 判 gap 在 lastTickAt 更新前（更新后 ts−max 恒 ≤0 永不触发——前次会话顺序 bug 现场反证）', () => assert.ok(iStall > 0 && iLast > iStall, `${iStall} vs ${iLast}`));
    check('E2 burstWaveSec 用 now 入参（禁 Date.now——回测虚拟时钟同源）', () => /burstWaveSec: state\._burstWaveStartTs !== null\s*\?\s*Math\.max\(0, \(now - state\._burstWaveStartTs\) \/ 1000\) : null/.test(src));
    check('E3 静默阈常量 30000（CD422 burst 族同线）', () => /const BURST_STALL_GAP_MS = 30000;/.test(src));
    const iQuiet = src.indexOf('if (state._quietSurgeStartTs !== null && ts >= state._quietSurgeStartTs) {');
    const iBurst = src.indexOf('if (state._burstWaveStartTs !== null && ts >= state._burstWaveStartTs) {');
    check('E4 波累计带 ts guard（与 quiet 族同构）且紧随其后', () => iQuiet > 0 && iBurst > iQuiet && iBurst - iQuiet < 1600);
}

console.log(`\n============================================================`);
console.log(`T244 burst 波五键单测：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
