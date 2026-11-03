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

// ── T109（2026-11-03 0x89e4 flap 止损臂案）：tick 去重 + 腿级 sellDebounce 覆盖 ──

/** 实时 collector 形状 tick（camelCase） */
function liveTick(txHash, logIndex, ts) {
    return { txHash, logIndex, timestamp: ts, priceBnb: 1e-9 };
}

function testTickDedupVirtual() {
    // 事故现场反证：3 真笔 tick × 两段喂食双投递（FA processTick 价格段 +
    // applyWalletTick wallet 段各 emit 一次 factorsUpdated）——旧实现 ticksSeen
    // 双计 3×2-1=5 恰好凑满 minTicks=5 提前 fire；修复后同一笔链上 tick 只算
    // 一份证据，3 笔只攒 2，不 fire
    const fired = [];
    const d = new SellConfirmDebouncer({
        debounceMs: 10000, minTicks: 5, maxWaitMs: 60000, mode: 'virtual',
        onFire: t => fired.push(t),
    });
    const t1 = liveTick('0xaaa', 10, 1000);
    const t2 = liveTick('0xbbb', 20, 5000);
    const t3 = liveTick('0xccc', 30, 9000);
    d.touch('DEDUP', t1); d.touch('DEDUP', t1);   // 价格段 + wallet 段
    d.touch('DEDUP', t2); d.touch('DEDUP', t2);
    d.touch('DEDUP', t3); d.touch('DEDUP', t3);
    ok(d.stats.deduped === 3, 'tick 去重：3 笔双投递 deduped=3', d.stats.deduped);
    ok(d.stats.suppressed === 2, 'tick 去重：去重后仅 2 笔后续真 tick 计 suppressed', d.stats.suppressed);
    d.advance(1000 + 10000);                       // 时间窗过，证据 2 < 5
    ok(fired.length === 0, '事故现场反证：3 真笔 tick×双投递凑不满 minTicks=5 不 fire（旧实现此处 fire）', fired.length);
    d.touch('DEDUP', liveTick('0xddd', 40, 12000)); // 3
    d.touch('DEDUP', liveTick('0xeee', 50, 13000)); // 4
    d.touch('DEDUP', liveTick('0xfff', 60, 14000)); // 5
    d.advance(15000);
    ok(fired.length === 1, 'tick 去重：真实第 4-6 笔新 tick 凑满 5 才 fire', fired.length);

    // 同 txHash 不同 logIndex（聚合交易多事件）= 不同 tick 各自计证据
    const fired2 = [];
    const d2 = new SellConfirmDebouncer({
        debounceMs: 100, minTicks: 1, mode: 'virtual', onFire: t => fired2.push(t),
    });
    d2.touch('AGG', liveTick('0xsame', 1, 0));
    d2.touch('AGG', liveTick('0xsame', 2, 50));    // 同 tx 第二事件=独立证据
    d2.advance(200);
    ok(fired2.length === 1, 'tick 去重：同 txHash 不同 logIndex 各计一份（聚合交易两事件）', fired2.length);

    // 回测形状（snake_case，wss_price_ticks 行）同样去重
    const fired3 = [];
    const d3 = new SellConfirmDebouncer({
        debounceMs: 100, minTicks: 1, mode: 'virtual', onFire: t => fired3.push(t),
    });
    const btTick = { tx_hash: '0xzzz', log_index: 7, timestamp: 0, token_address: 'T' };
    d3.touch('BT', btTick);
    d3.touch('BT', { tx_hash: '0xzzz', log_index: 7, timestamp: 50 });
    ok(d3.stats.deduped === 1, 'tick 去重：snake_case 键同 tx:logIndex 双投递去重', d3.stats.deduped);
    d3.advance(50);
    ok(fired3.length === 0, 'tick 去重：snake_case 重复投递不凑证据', fired3.length);
    d3.touch('BT', { tx_hash: '0xzzz', log_index: 8, timestamp: 60 });
    d3.advance(200);
    ok(fired3.length === 1, 'tick 去重：snake_case 新 logIndex 才是证据', fired3.length);

    // 无链上键 tick 对象（identity null）按独立证据计（旧语义兼容——
    // touch(null) 才是非证据扫描路径，见 testNullTickScan）
    const fired4 = [];
    const d4 = new SellConfirmDebouncer({
        debounceMs: 100, minTicks: 2, mode: 'virtual', onFire: t => fired4.push(t),
    });
    d4.touch('NOKEY', { timestamp: 0 });
    d4.touch('NOKEY', { timestamp: 50 });
    d4.touch('NOKEY', { timestamp: 60 });
    d4.advance(300);
    ok(fired4.length === 1, 'tick 去重：无链上键 tick 按独立证据计（存量单测形状兼容）', fired4.length);
}

async function testNullTickScan() {
    // 扫描兜底路径 tick=null（快照评估，非新 tick 证据 T109）：可起 pending，
    // 但不凑 ticksSeen——断流票只能等回流真 tick 或 maxWait 强制逃生
    const fired = [];
    const d = new SellConfirmDebouncer({
        debounceMs: 40, minTicks: 2, maxWaitMs: 5000, mode: 'real',
        onFire: t => fired.push(t),
    });
    d.touch('SCAN', null);                          // 无 pending：快照评估起窗（maxWait 起点）
    ok(d.size === 1, 'null tick：扫描评估可起 pending', d.size);
    d.touch('SCAN', null);
    d.touch('SCAN', null);                          // 已 pending：不再凑证据（旧实现 ticksSeen++）
    await sleep(120);                               // debounce timer 到点
    ok(fired.length === 0 && d.size === 1, 'null tick：扫描快照不凑 ticksSeen（时间过证据 0<2 转等待）',
        { fired: fired.length, size: d.size });
    d.touch('SCAN', liveTick('0xrt', 1, 200));      // 回流真 tick=证据 1
    d.touch('SCAN', liveTick('0xrt2', 2, 210));     // 证据 2 → 即时 fire
    ok(fired.length === 1, 'null tick：回流真 tick 才凑齐证据 fire', fired.length);
}

function testLegOverrideVirtual() {
    // 腿级 minTicks 覆盖（T109）：首真起算固化腿门；窗口内后续 touch 带不同腿参数不改门
    const fired = [];
    const d = new SellConfirmDebouncer({
        debounceMs: 100, minTicks: 2, maxWaitMs: 60000, mode: 'virtual',
        onFire: t => fired.push(t),
    });
    d.touch('LEG_A', liveTick('0x1', 1, 0), { minTicks: 4 });   // 止损臂：单独加严证据门
    d.touch('LEG_A', liveTick('0x2', 1, 10), { minTicks: 1 });  // 窗口内低门腿命中不改门
    d.touch('LEG_A', liveTick('0x3', 1, 20));                    // 不带 legOpts=引擎级缺省 2
    d.advance(200);                                             // 时间过，证据 2 < 腿门 4
    ok(fired.length === 0, '腿级覆盖：minTicks=4 首真固化，低门腿 touch 不改门（证据 2<4 不 fire）', fired.length);
    d.touch('LEG_A', liveTick('0x4', 1, 300));                  // 3
    d.touch('LEG_A', liveTick('0x5', 1, 310));                  // 4 → 凑齐
    d.advance(400);
    ok(fired.length === 1, '腿级覆盖：凑满腿门 4 才 fire', fired.length);

    // 不带 legOpts 的 token 用引擎级门（缺省回落；独立实例——onFire 构造期绑定）
    const firedB = [];
    const dB = new SellConfirmDebouncer({
        debounceMs: 100, minTicks: 2, mode: 'virtual', onFire: t => firedB.push(t),
    });
    dB.touch('LEG_B', liveTick('0xa', 1, 1000));
    dB.touch('LEG_B', liveTick('0xb', 1, 1010));                 // 证据 1
    dB.touch('LEG_B', liveTick('0xc', 1, 1020));                 // 证据 2 =引擎门 → advance fire
    dB.advance(2000);
    ok(firedB.length === 1, '腿级覆盖：未带 legOpts 回落构造门（2 凑齐 fire）', firedB.length);

    // 腿级 debounceMs 覆盖：延长确认窗
    const firedC = [];
    const dC = new SellConfirmDebouncer({
        debounceMs: 100, mode: 'virtual', onFire: t => firedC.push(t),
    });
    dC.touch('LEG_C', liveTick('0xd', 1, 0), { debounceMs: 300 });
    dC.advance(250);                                             // 越过引擎级 100，未到腿级 300
    ok(firedC.length === 0, '腿级覆盖：debounceMs=300 延长窗口（250ms 不 fire）', firedC.length);
    dC.advance(301);
    ok(firedC.length === 1, '腿级覆盖：到腿级窗口才 fire', firedC.length);

    // 腿级 maxWaitMs 覆盖：virtual 强制逃生门用 entry 值
    const firedD = [];
    const dD = new SellConfirmDebouncer({
        debounceMs: 10000, minTicks: 5, maxWaitMs: 60000, mode: 'virtual',
        onFire: t => firedD.push(t),
    });
    dD.touch('LEG_D', liveTick('0xe', 1, 0), { maxWaitMs: 5000 });
    dD.advance(4999);
    ok(firedD.length === 0 && dD.stats.forceFired === 0, '腿级覆盖：maxWaitMs=5000 上限前不强制', firedD.length);
    dD.advance(5001);
    ok(firedD.length === 1 && dD.stats.forceFired === 1, '腿级覆盖：到腿级 maxWait 强制 fire',
        { n: firedD.length, f: dD.stats.forceFired });
}

async function testLegOverrideReal() {
    // real 模式：腿级 debounceMs=0 → touch 即 fire（引擎分流条件等价 bypass）
    const fired = [];
    const d = new SellConfirmDebouncer({
        debounceMs: 5000, mode: 'real', onFire: t => fired.push(t),
    });
    d.touch('LEG_R', liveTick('0xf', 1, 1), { debounceMs: 0 });
    ok(fired.length === 1, 'real 腿级：debounceMs=0 touch 即 fire（等价 bypass 语义）', fired.length);

    // real 模式：腿级 minTicks 覆盖 + 即时补 fire 路径
    const fired2 = [];
    const d2 = new SellConfirmDebouncer({
        debounceMs: 30, minTicks: 1, maxWaitMs: 5000, mode: 'real',
        onFire: t => fired2.push(t),
    });
    d2.touch('LEG_R2', liveTick('0xg', 1, 1), { minTicks: 3 });
    d2.touch('LEG_R2', liveTick('0xg2', 1, 2));                  // 证据 1（引擎门腿 1 已过但腿门 3）
    d2.touch('LEG_R2', liveTick('0xg3', 1, 3));                  // 证据 2
    await sleep(80);                                             // debounce timer 到点：证据 2<3 转等待
    ok(fired2.length === 0, 'real 腿级：时间到腿门 3 未凑齐转等待', fired2.length);
    d2.touch('LEG_R2', liveTick('0xg4', 1, 100));                // 证据 3 → 即时 fire
    ok(fired2.length === 1, 'real 腿级：凑齐腿门即时 fire', fired2.length);
}

function testStrategyEngineSellDebounce() {
    const { StrategyEngine } = require(path.join(ROOT, 'src/strategies/StrategyEngine'));

    // 合法装载 + 归一化（字符串数字归 Number；null 值键剔除；空段=null 等价未配）
    const se = new StrategyEngine({
        strategies: [
            { id: 'sell_p2', name: '止损', action: 'sell', condition: 'profitPercent <= -35', priority: 2,
              cards: 'all', sellDebounce: { minTicks: '8', debounceMs: null } },
            { id: 'sell_plain', name: '默认腿', action: 'sell', condition: 'profitPercent >= 50', priority: 3,
              cards: 'all', sellDebounce: {} },
        ],
    });
    const p2 = se.getStrategy('sell_p2');
    ok(p2.sellDebounce && p2.sellDebounce.minTicks === 8 && !('debounceMs' in p2.sellDebounce),
        'sellDebounce 装载：字符串归 Number + null 值键剔除',
        p2.sellDebounce);
    ok(se.getStrategy('sell_plain').sellDebounce === null,
        'sellDebounce 装载：空段 {} → null（等价未配，引擎级缺省）',
        se.getStrategy('sell_plain').sellDebounce);

    // 拒启形状（buyPhase T100 同款 fail-fast）
    const rejects = [
        [{ id: 'b1', name: '买', action: 'buy', condition: 'profitPercent > 0', priority: 1,
           sellDebounce: { minTicks: 5 } }, '非卖腿携带'],
        [{ id: 's1', name: '卖', action: 'sell', condition: 'profitPercent > 0', priority: 1, cards: 'all',
           sellDebounce: { minTicks: 5, unknownKey: 1 } }, '未知键'],
        [{ id: 's2', name: '卖', action: 'sell', condition: 'profitPercent > 0', priority: 1, cards: 'all',
           sellDebounce: { minTicks: 1.5 } }, 'minTicks 小数'],
        [{ id: 's3', name: '卖', action: 'sell', condition: 'profitPercent > 0', priority: 1, cards: 'all',
           sellDebounce: { minTicks: -1 } }, 'minTicks 负数'],
        [{ id: 's4', name: '卖', action: 'sell', condition: 'profitPercent > 0', priority: 1, cards: 'all',
           sellDebounce: { debounceMs: 999999 } }, 'debounceMs 越界'],
        [{ id: 's5', name: '卖', action: 'sell', condition: 'profitPercent > 0', priority: 1, cards: 'all',
           sellDebounce: 'minTicks=5' }, '非对象'],
    ];
    for (const [leg, label] of rejects) {
        let threw = null;
        try { new StrategyEngine({ strategies: [leg] }); } catch (e) { threw = e.message; }
        ok(!!threw && threw.includes('T109'), `sellDebounce 校验拒启：${label}`, threw);
    }

    // validateLegs 同口径（web 入库 400；与引擎 loadStrategies 共享 normalizeSellDebounce）
    const { validateLegs } = require(path.join(ROOT, 'src/web/services/StrategyLibraryService'));
    const okSell = validateLegs('sell', [
        { condition: 'profitPercent <= -35', priority: 2, cards: 'all', sellDebounce: { minTicks: 8 } },
    ]);
    ok(okSell.valid, 'validateLegs：合法 sellDebounce 段放行', okSell.errors);
    const badCases = [
        ['sell', [{ condition: 'profitPercent <= -35', priority: 2, cards: 'all', sellDebounce: { minTicks: 9999 } }], 'minTicks 越界'],
        ['buy', [{ condition: 'profitPercent > 0', priority: 1, sellDebounce: { minTicks: 5 } }], '非卖腿携带'],
        ['sell', [{ condition: 'profitPercent > 0', priority: 1, cards: 'all', sellDebounce: { foo: 1 } }], '未知键'],
    ];
    for (const [side, legs, label] of badCases) {
        const r = validateLegs(side, legs);
        ok(!r.valid && r.errors.some(e => e.includes('T109')), `validateLegs 拒绝：${label}`, r.errors);
    }
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
    testTickDedupVirtual();
    console.log('  ✓ T109 tick 去重（双投递零效应/事故现场反证/snake_case/聚合交易）');
    await testNullTickScan();
    console.log('  ✓ T109 null tick 扫描（快照评估不凑证据，回流真 tick 才计）');
    testLegOverrideVirtual();
    console.log('  ✓ T109 腿级覆盖 virtual（minTicks 固化/debounceMs/maxWaitMs/缺省回落）');
    await testLegOverrideReal();
    console.log('  ✓ T109 腿级覆盖 real（debounceMs=0 即 fire/腿门即时补 fire）');
    testStrategyEngineSellDebounce();
    console.log('  ✓ T109 sellDebounce 装载校验（归一化/拒启六形状/validateLegs 同口径）');
    testStrategyEnginePassthrough();
    console.log('  ✓ StrategyEngine 腿字段透传');

    console.log('\n' + '═'.repeat(72));
    console.log(`结果：${passed} 通过 / ${failed} 失败`);
    if (failed > 0) process.exit(1);
    console.log('全部通过 ✅');
}

main().catch(e => { console.error(e); process.exit(1); });
