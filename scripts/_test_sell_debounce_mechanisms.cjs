#!/usr/bin/env node
/**
 * pumpfun 回迁批 2 卖腿机制测试（零 DB）
 *
 * 1) SellConfirmDebouncer 单测（real/virtual 双模式）：
 *    首真起计不重置 / advance 到期 fire（携带首真 tick）/ clear 取消 /
 *    多 token 独立起算 / debounceMs<=0 touch 即 fire
 * 2) StrategyEngine 卖腿机制字段透传（bypassDebounce/lockTokenAfterSell/
 *    cumulativeLossLockPct，含非数值/缺省归一）
 *
 * 用法：node scripts/_test_sell_debounce_mechanisms.cjs
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { SellConfirmDebouncer } = require(path.join(ROOT, 'src/trading-engine/core/SellConfirmDebouncer'));

let passed = 0;
let failed = 0;
const failures = [];
function ok(cond, msg, got) {
    if (cond) { passed++; return; }
    failed++;
    const line = `  ✗ ${msg}${got !== undefined ? ` | got=${JSON.stringify(got)}` : ''}`;
    failures.push(line);
    console.error(line);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function testVirtualMode() {
    const fired = [];
    const d = new SellConfirmDebouncer({
        debounceMs: 10000, mode: 'virtual',
        onFire: (t, tick, fireTs) => fired.push({ t, tick, fireTs }),
    });

    const tick1 = { timestamp: 1000 };
    const tick2 = { timestamp: 6000 };
    d.touch('TOK_A', tick1);
    ok(d.size === 1, 'virtual：touch → pending=1', d.size);
    d.touch('TOK_A', tick2);
    ok(d.stats.suppressed === 1, 'virtual：二触不重置（suppressed 计数）', d.stats.suppressed);
    d.advance(1000 + 9999);
    ok(fired.length === 0, 'virtual：advance 至首真+9999ms 未到期不 fire', fired.length);
    d.advance(1000 + 10000);
    ok(fired.length === 1, 'virtual：advance 至首真+10s fire', fired.length);
    ok(fired[0].tick === tick1, 'virtual：fire 携带首真 tick（非最近 tick）');
    ok(fired[0].fireTs === 11000, 'virtual：fireTs=虚拟推进时刻', fired[0].fireTs);
    ok(d.size === 0, 'virtual：fire 后 pending 清空', d.size);

    // clear（条件恢复路径）
    d.touch('TOK_B', { timestamp: 5000 });
    d.clear('TOK_B');
    d.advance(999999);
    ok(fired.length === 1, 'virtual：clear 后永不 fire', fired.length);

    // 多 token 独立起算
    d.touch('T_C', { timestamp: 100 });
    d.touch('T_D', { timestamp: 200 });
    d.advance(100 + 10000);
    ok(fired.some(f => f.t === 'T_C') && !fired.some(f => f.t === 'T_D'),
        'virtual：多 token 独立起算（C 到期 D 未到）');
    d.advance(200 + 10000);
    ok(fired.some(f => f.t === 'T_D'), 'virtual：D 随后到期');

    // debounceMs<=0 → touch 即 fire（引擎分流下不会走到，兜底语义仍需正确）
    const fired0 = [];
    const d0 = new SellConfirmDebouncer({
        debounceMs: 0, mode: 'virtual',
        onFire: (t, tick, fireTs) => fired0.push({ t, tick, fireTs }),
    });
    d0.touch('T_E', { timestamp: 7777 });
    ok(fired0.length === 1 && fired0[0].fireTs === 7777,
        'debounceMs=0：touch 即 fire（virtual fireTs=tick.timestamp）', fired0);
}

async function testRealMode() {
    const fired = [];
    const d = new SellConfirmDebouncer({
        debounceMs: 40, mode: 'real',
        onFire: (t, tick) => fired.push({ t, tick }),
    });
    const tick1 = { timestamp: 1 };
    d.touch('T_R', tick1);
    d.touch('T_R', { timestamp: 2 });
    ok(d.stats.suppressed === 1, 'real：二触不重置', d.stats.suppressed);
    await sleep(20);
    ok(fired.length === 0, 'real：未到期不 fire', fired.length);
    await sleep(60);
    ok(fired.length === 1, 'real：timer 到期 fire', fired.length);
    ok(fired[0].tick === tick1, 'real：fire 携带首真 tick');

    // clear 取消 timer
    const fired2 = [];
    const d2 = new SellConfirmDebouncer({ debounceMs: 40, mode: 'real', onFire: t => fired2.push(t) });
    d2.touch('T_R2', {});
    d2.clear('T_R2');
    await sleep(80);
    ok(fired2.length === 0, 'real：clear 取消 timer', fired2.length);

    // clearAll
    const fired3 = [];
    const d3 = new SellConfirmDebouncer({ debounceMs: 40, mode: 'real', onFire: t => fired3.push(t) });
    d3.touch('X', {});
    d3.touch('Y', {});
    d3.clearAll();
    ok(d3.size === 0, 'real：clearAll 清空', d3.size);
    await sleep(80);
    ok(fired3.length === 0, 'real：clearAll 后无 fire', fired3.length);
}

// ── 双门槛确认（2026-10-16 蓝筹蛙/RIBBIT 断流案：minTicks + maxWaitMs）──────────

function testMinTicksDualGateVirtual() {
    // 时间到 ticks 不足不 fire；凑齐后 advance fire
    const fired = [];
    const d = new SellConfirmDebouncer({
        debounceMs: 10000, minTicks: 2, maxWaitMs: 60000, mode: 'virtual',
        onFire: (t, tick, fireTs) => fired.push({ t, fireTs }),
    });
    d.touch('T_V1', { timestamp: 1000 });   // 首真起计
    d.touch('T_V1', { timestamp: 5000 });   // ticks=1
    d.advance(12000);                        // 时间窗过，ticks=1 < 2
    ok(fired.length === 0, 'virtual 双门：时间到 ticks 不足不 fire', fired.length);
    d.touch('T_V1', { timestamp: 12500 });  // ticks=2（virtual touch 只凑数不即时 fire）
    d.advance(13000);
    ok(fired.length === 1, 'virtual 双门：凑齐后 advance fire', fired.length);
    ok(d.stats.forceFired === 0, 'virtual 双门：凑齐 fire 非 force', d.stats.forceFired);

    // maxWait 强制逃生（时钟推进到上限才触发——死票时钟静止永不 fire，见头注）
    const fired2 = [];
    const d2 = new SellConfirmDebouncer({
        debounceMs: 10000, minTicks: 5, maxWaitMs: 30000, mode: 'virtual',
        onFire: t => fired2.push(t),
    });
    d2.touch('T_V2', { timestamp: 0 });
    d2.touch('T_V2', { timestamp: 5000 });  // ticks=1
    d2.advance(20000);                       // 时间过 ticks 不足，未到上限
    ok(fired2.length === 0, 'virtual maxWait：上限前不 fire', fired2.length);
    d2.advance(31000);                       // 越过 maxWait 30s
    ok(fired2.length === 1 && d2.stats.forceFired === 1,
        'virtual maxWait：到上限强制 fire + forceFired 计数',
        { n: fired2.length, f: d2.stats.forceFired });

    // minTicks=0（缺省）：纯时间语义存量行为不变
    const fired3 = [];
    const d3 = new SellConfirmDebouncer({
        debounceMs: 10000, mode: 'virtual',
        onFire: () => fired3.push(1),
    });
    d3.touch('T_V3', { timestamp: 0 });
    d3.advance(9999);
    ok(fired3.length === 0, 'virtual minTicks=0：窗口内不 fire', fired3.length);
    d3.advance(10000);
    ok(fired3.length === 1 && d3.stats.forceFired === 0,
        'virtual minTicks=0：到点 fire 非 force',
        { n: fired3.length, f: d3.stats.forceFired });
}

async function testMinTicksDualGateReal() {
    // 时间窗到 ticks 不足 → 转等待；后续 touch 凑齐 → 即时 fire
    const fired = [];
    const d = new SellConfirmDebouncer({
        debounceMs: 200, minTicks: 3, maxWaitMs: 5000, mode: 'real',
        onFire: (t, tick) => fired.push({ t, tick }),
    });
    const tick1 = { timestamp: 1 };
    d.touch('T_G', tick1);
    d.touch('T_G', { timestamp: 2 });        // ticks=1
    d.touch('T_G', { timestamp: 3 });        // ticks=2（同步块内 <200ms，不即时 fire）
    await sleep(260);                         // debounce timer 到点：时间过 ticks=2<3 → 转等待
    ok(fired.length === 0, 'real 双门：时间到 ticks 不足转等待不 fire', fired.length);
    d.touch('T_G', { timestamp: 4 });        // ticks=3 → 即时 fire
    ok(fired.length === 1, 'real 双门：后续 touch 凑齐即时 fire', fired.length);
    ok(fired[0].tick === tick1, 'real 双门：fire 携带首真 tick');
    ok(d.stats.forceFired === 0, 'real 双门：凑齐 fire 非 force', d.stats.forceFired);

    // 时间未到 ticks 已凑齐 → 不提前 fire（AND 语义非 OR）
    const fired2 = [];
    const d2 = new SellConfirmDebouncer({
        debounceMs: 200, minTicks: 1, maxWaitMs: 5000, mode: 'real',
        onFire: t => fired2.push(t),
    });
    d2.touch('T_H', { timestamp: 1 });
    d2.touch('T_H', { timestamp: 2 });       // ticks 已凑齐但时间未到
    ok(fired2.length === 0, 'real 双门：时间未到 ticks 凑齐不提前 fire', fired2.length);
    await sleep(300);
    ok(fired2.length === 1, 'real 双门：timer 到点 ticks 已凑齐 → fire', fired2.length);

    // maxWait 强制逃生：长时间凑不齐到上限强制 fire
    const fired3 = [];
    const d3 = new SellConfirmDebouncer({
        debounceMs: 30, minTicks: 5, maxWaitMs: 150, mode: 'real',
        onFire: t => fired3.push(t),
    });
    d3.touch('T_I', { timestamp: 1 });
    d3.touch('T_I', { timestamp: 2 });       // ticks=1 < 5，此后断流
    await sleep(60);                          // debounce timer 到点转等待
    ok(fired3.length === 0, 'real maxWait：转等待中不 fire', fired3.length);
    await sleep(150);                         // 越 maxWait 150ms
    ok(fired3.length === 1, 'real maxWait：凑不齐到上限强制 fire', fired3.length);
    ok(d3.stats.forceFired === 1, 'real maxWait：forceFired 计数', d3.stats.forceFired);

    // clear 取消转等待项：两 timer 全清，maxWait 不再触发
    const fired4 = [];
    const d4 = new SellConfirmDebouncer({
        debounceMs: 30, minTicks: 5, maxWaitMs: 150, mode: 'real',
        onFire: t => fired4.push(t),
    });
    d4.touch('T_J', {});
    await sleep(60);                          // 转等待中
    d4.clear('T_J');
    await sleep(150);                         // 原 maxWait 时刻已过
    ok(fired4.length === 0, 'real clear：转等待项清除后 maxWait 不触发', fired4.length);
    ok(d4.size === 0, 'real clear：pending 已删', d4.size);

    // minTicks=0（缺省）：纯时间语义存量行为 bit-identical（零后续 tick 到点即 fire）
    const fired5 = [];
    const d5 = new SellConfirmDebouncer({
        debounceMs: 40, mode: 'real',
        onFire: t => fired5.push(t),
    });
    d5.touch('T_K', {});
    await sleep(90);
    ok(fired5.length === 1 && d5.stats.forceFired === 0,
        'real minTicks=0：纯时间语义存量行为不变（非 force）',
        { n: fired5.length, f: d5.stats.forceFired });
}

function testStrategyEnginePassthrough() {
    const { StrategyEngine } = require(path.join(ROOT, 'src/strategies/StrategyEngine'));
    const se = new StrategyEngine({
        strategies: [
            { id: 'sell_0_10', name: '趋势失去', action: 'sell', condition: 'profitPercent < -20', priority: 10,
              bypassDebounce: true, lockTokenAfterSell: false, cumulativeLossLockPct: -30 },
            { id: 'sell_1_20', name: '止损', action: 'sell', condition: 'profitPercent < -50', priority: 20,
              lockTokenAfterSell: true, cumulativeLossLockPct: 'bad-value' },
            { id: 'buy_0_5', name: '买入', action: 'buy', condition: 'earlyReturn > 80', priority: 5 },
        ],
    });

    const s0 = se.getStrategy('sell_0_10');
    ok(s0.bypassDebounce === true && s0.lockTokenAfterSell === false && s0.cumulativeLossLockPct === -30,
        '策略透传：数值字段原样（bypass=true/lock=false/cumLock=-30）',
        { b: s0.bypassDebounce, l: s0.lockTokenAfterSell, c: s0.cumulativeLossLockPct });
    const s1 = se.getStrategy('sell_1_20');
    ok(s1.bypassDebounce === false && s1.lockTokenAfterSell === true && s1.cumulativeLossLockPct === null,
        '策略透传：非数值 cumulativeLossLockPct → null；布尔缺省 false',
        { b: s1.bypassDebounce, l: s1.lockTokenAfterSell, c: s1.cumulativeLossLockPct });
    const b0 = se.getStrategy('buy_0_5');
    ok(b0.bypassDebounce === false && b0.lockTokenAfterSell === false && b0.cumulativeLossLockPct === null,
        '策略透传：未配置腿缺省 false/false/null',
        { b: b0.bypassDebounce, l: b0.lockTokenAfterSell, c: b0.cumulativeLossLockPct });

    // 新字段不影响分腿评估
    const hit = se.evaluate({ profitPercent: -30 }, 'T', Date.now(), null, 'sell');
    ok(!!hit && hit.id === 'sell_0_10', '分腿评估不受新字段影响', hit && hit.id);
}

async function main() {
    console.log('═'.repeat(72));
    console.log('pumpfun 回迁批 2 卖腿机制测试');
    console.log('═'.repeat(72));

    testVirtualMode();
    console.log('  ✓ virtual 模式（首真起计/advance/clear/多 token/零窗口）');
    await testRealMode();
    console.log('  ✓ real 模式（timer fire/首真 tick/clear/clearAll）');
    testMinTicksDualGateVirtual();
    console.log('  ✓ 双门 virtual（时间 AND ticks/maxWait 强制/minTicks=0 存量）');
    await testMinTicksDualGateReal();
    console.log('  ✓ 双门 real（转等待/凑齐即时 fire/maxWait 逃生/clear/minTicks=0 存量）');
    testStrategyEnginePassthrough();
    console.log('  ✓ StrategyEngine 腿字段透传');

    console.log('\n' + '═'.repeat(72));
    console.log(`结果：${passed} 通过 / ${failed} 失败`);
    if (failed > 0) process.exit(1);
    console.log('全部通过 ✅');
}

main().catch(e => { console.error(e); process.exit(1); });
