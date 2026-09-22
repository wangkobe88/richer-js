#!/usr/bin/env node
/**
 * pumpfun 回迁批 2.6 市场截面 regime 测试（零 DB，合成 tick；对照母版 _test_marketregime.cjs）
 *
 * S0 键注册 + 未 feed 5 键全 null；feed 后 newborn 数值
 * S1 截面一致性（同分钟跨 token 恒同值=分钟桶 memo 冻结）+ memo 对象同一 + 跨 FA 实例共享（模块级单例）
 * S2 warmup null 过 ConditionEvaluator 恒 false（含 null<0.5 防隐式 0 误触——richer-js 评估器 L304-308 显式守卫）
 * S3 出生去重（prune 复活不重计）+ 老票（首 tick 距 birth>40m）不入册
 * S4 cohort 成熟边界（<10m 不进分母）+ minCohort 门槛（29 null / 30 出值）+ 分钟回退重算（无前视）
 * S5 断流死（BSC 540s：尘 tick 续命 90s<540s 存活；尘假价不进 lastRel → meanRet 精确 0）
 * S6 流向环（11 分钟槽滑出 / Σsell<1 BNB null / 同分钟 memo 下分钟可见全量）
 * S7 FIFO 上界（birth>65m 写时裁剪出册）
 * S8 可靠价守卫（尘 tick / 局部离群价不动 registry 价格链——minCohort=1 覆盖探针）
 * S9 跨 token 交错序快照恒等（两 FA 实例分流累积，截面=和，交换律）
 *
 * BSC 参数与母版差异：death idle 180s→540s、flow 门槛 5 SOL→1 BNB、尘门 0.005→0.002 BNB、
 * 出生锚=registerToken createdAtMs（母版 firstTickAt 墓碑链语义对齐）。
 *
 * 用法：node scripts/_test_market_regime.cjs
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FA = require(path.join(ROOT, 'src/services/FourMemeFactorAggregator'));

let passed = 0;
let failed = 0;
const failures = [];
function ok(cond, msg, got) {
    if (cond) { passed++; return; }
    failed++;
    const line = `  ✗ ${msg}${got !== undefined ? ` | got=${typeof got === 'number' ? got : JSON.stringify(got)}` : ''}`;
    failures.push(line);
    console.error(line);
}
function approx(a, b, eps, msg) {
    ok(Math.abs(a - b) <= eps, `${msg} (期望 ${b}±${eps})`, a);
}

let txSeq = 0;
let blkSeq = 900000;
function mkTick(token, ts, isBuy, priceBnb, bnbAmount, trader) {
    return {
        token_address: token,
        trade_type: isBuy ? 'buy' : 'sell',
        trader_address: trader,
        price_bnb: priceBnb,
        price_usd: null,
        bnb_amount: bnbAmount,
        token_amount: 100,
        block_number: ++blkSeq,
        timestamp: ts,
        tx_hash: '0x' + (++txSeq).toString(16).padStart(8, '0'),
        log_index: 0,
    };
}

/** 出生 + tick 序列（[dtMs, isBuy, price, bnb]；首 tick 触发 registry 注册） */
function birthToken(fa, name, birth, ticks) {
    fa.registerToken(name, { createdAtMs: birth, totalSupply: 1e9 });
    for (const [dt, isBuy, price, bnb] of ticks) {
        fa.processTick(mkTick(name, birth + dt, isBuy, price, bnb, '0xM'), { emitFactors: false });
    }
}

/** 关-开复位模块级单例（场景隔离） */
function resetFeed() {
    FA.setMarketFeedEnabled(false);
    FA.setMarketFeedEnabled(true);
}

const T0 = 1758900000000; // 分钟对齐（/60000 整除）
const MIN = 60 * 1000;

function s0_keysAndFeedOff() {
    FA.setMarketFeedEnabled(false);
    const fa = new FA({});
    ok(FA.isMarketFeedEnabled() === false, 'S0 未 feed：isMarketFeedEnabled=false');
    ok(FA.getMarketRegistrySize() === 0, 'S0 未 feed：registry 空');
    birthToken(fa, 'MK0', T0, [[0, true, 1, 0.01]]);
    const f = fa.buildFactorMap('MK0', T0);
    ok(f.marketNewbornCount1h === null && f.marketRocketRate30m === null && f.marketYoungMeanRet30m === null
        && f.marketDeathRate30m === null && f.marketFlowBsRatio10m === null,
        'S0 未 feed：5 键全 null（web 裸 FA 零污染）', {
            a: f.marketNewbornCount1h, b: f.marketRocketRate30m, c: f.marketYoungMeanRet30m,
            d: f.marketDeathRate30m, e: f.marketFlowBsRatio10m,
        });
    ok(fa.computeMarketSnapshot(T0) === null, 'S0 未 feed：computeMarketSnapshot 返回 null');

    resetFeed();
    const fa2 = new FA({});
    ok(FA.isMarketFeedEnabled() === true && FA.getMarketRegistrySize() === 0, 'S0 开 feed：单例重建');
    birthToken(fa2, 'MK0B', T0, [[0, true, 1, 0.01]]);
    const f2 = fa2.buildFactorMap('MK0B', T0);
    ok(f2.marketNewbornCount1h === 1, 'S0 fed：newborn1h=1（无 null 态计数键）', f2.marketNewbornCount1h);
    ok(f2.marketRocketRate30m === null, 'S0 fed：cohort 0<30 → 率 null', f2.marketRocketRate30m);
    ok(f2.marketFlowBsRatio10m === null, 'S0 fed：Σsell=0<1 BNB → ratio null', f2.marketFlowBsRatio10m);
}

function s1_crossTokenConsistency() {
    resetFeed();
    const fa = new FA({});
    const tA = T0 + 10 * MIN, tB = tA + 1000; // 同分钟
    birthToken(fa, 'S1A', tA, [[0, true, 1, 0.01]]);
    const fA = fa.buildFactorMap('S1A', tA);
    ok(fA.marketNewbornCount1h === 1, 'S1 A 首读 newborn=1', fA.marketNewbornCount1h);
    birthToken(fa, 'S1B', tB - 2000, [[2000, true, 1, 0.01]]); // 同分钟内 B 出生（registry 现 2）
    const fB = fa.buildFactorMap('S1B', tB);
    ok(fB.marketNewbornCount1h === 1, 'S1 分钟桶 memo：同分钟截面冻结，B 读到 1（非 2）', fB.marketNewbornCount1h);
    const snapNextMin = fa.computeMarketSnapshot(tA + MIN + 1000);
    ok(snapNextMin.newborn1h === 2, 'S1 下分钟截面：newborn=2（memo 解冻）', snapNextMin.newborn1h);
    // memo 对象同一 + 跨 FA 实例共享（模块级单例）
    const fa2 = new FA({});
    ok(fa.computeMarketSnapshot(tA + MIN + 1000) === snapNextMin
        && fa2.computeMarketSnapshot(tA + MIN + 1000) === snapNextMin,
        'S1 memo 对象同一（同分钟重复读 + 跨 FA 实例）');
}

function s2_nullConditionSemantics() {
    const { ConditionEvaluator } = require(path.join(ROOT, 'src/strategies/ConditionEvaluator'));
    const ev = new ConditionEvaluator();
    ok(ev.evaluate('marketDeathRate30m < 0.5', { marketDeathRate30m: null }) === false,
        'S2 null<0.5 → false（防隐式 0 误触）');
    ok(ev.evaluate('marketFlowBsRatio10m > 0', { marketFlowBsRatio10m: null }) === false,
        'S2 null>0 → false');
    ok(ev.evaluate('marketNewbornCount1h >= 0', { marketNewbornCount1h: null }) === false,
        'S2 null>=0 → false（计数键 null 态也封死）');
    ok(ev.evaluate('marketDeathRate30m < 0.5 OR marketNewbornCount1h >= 1',
        { marketDeathRate30m: null, marketNewbornCount1h: null }) === false, 'S2 OR 全 null → false');
}

function s3_birthDedup() {
    resetFeed();
    const fa = new FA({});
    const birth = T0;
    fa.registerToken('S3R', { createdAtMs: birth, totalSupply: 1e9 });
    fa.processTick(mkTick('S3R', birth + 1000, true, 1, 0.01, '0x3'), { emitFactors: false });
    ok(FA.getMarketRegistrySize() === 1, 'S3 首注册 → registry=1', FA.getMarketRegistrySize());
    // prune 删 state（合成 ts 早于墙钟 → 必删）→ 复活 tick 重建 state，registry.has 不重计
    fa.pruneStaleTokens(60 * MIN, new Set());
    ok(fa.getTokenState('S3R') === null, 'S3 prune 已删 state');
    fa.processTick(mkTick('S3R', birth + 5000, true, 1, 0.01, '0x3'), { emitFactors: false });
    ok(fa.getTokenState('S3R') !== null, 'S3 复活 tick 重建 state');
    ok(FA.getMarketRegistrySize() === 1, 'S3 复活不重计（write-once）', FA.getMarketRegistrySize());
    // 老票：首 tick 距 birth 50m > 40m → 不入册（TokenCreate 见过但迟到的存量票）
    fa.registerToken('S3OLD', { createdAtMs: birth - 50 * MIN, totalSupply: 1e9 });
    fa.processTick(mkTick('S3OLD', T0 + 1000, true, 1, 0.01, '0x3'), { emitFactors: false });
    ok(FA.getMarketRegistrySize() === 1, 'S3 老票（>40m）不入册', FA.getMarketRegistrySize());
}

function s4_cohortBoundaries() {
    resetFeed();
    const fa = new FA({});
    const T = T0 + 40 * MIN;
    const birth = T - 20 * MIN; // cohort 带内 [10m, 40m]
    // 29 个 cohort 票：1 火箭（10→20）、1 半程（10→15）、其余横盘 10
    for (let i = 1; i <= 29; i++) {
        const ticks = [[1000, true, 10, 0.01]];
        if (i === 1) ticks.push([2000, true, 20, 0.01]);
        if (i === 2) ticks.push([2000, true, 15, 0.01]);
        birthToken(fa, `S4C${i}`, birth, ticks);
    }
    // 未成熟票（born T-5m，若入分母会污染三率）：10→50 假火箭
    birthToken(fa, 'S4YOUNG', T - 5 * MIN, [[1000, true, 10, 0.01], [2000, true, 50, 0.01]]);
    // null 检查读在 T-90s（前一分钟）：minute(T) 不落 memo，30 票补齐后 T 读到重算截面
    let f = fa.buildFactorMap('S4C1', T - 90 * 1000);
    ok(f.marketRocketRate30m === null && f.marketYoungMeanRet30m === null && f.marketDeathRate30m === null,
        'S4 分母 29<30 → 三率全 null fail-closed', f.marketRocketRate30m);
    // 存活者（S4C2 于 T-60s 再 tick，防 S4 全员死亡）——先补再加分母第 30 票
    fa.processTick(mkTick('S4C2', T - 60 * 1000, true, 15, 0.01, '0x4'), { emitFactors: false });
    birthToken(fa, 'S4C30', birth, [[1000, true, 10, 0.01]]);
    const snap = fa.computeMarketSnapshot(T);
    ok(snap.cohortN === 30, 'S4 cohortN=30（<10m 未成熟票不进分母）', snap.cohortN);
    approx(snap.rocketRate, 1 / 30, 1e-12, 'S4 rocketRate=1/30（仅 10→20 的 +100% 票）');
    approx(snap.youngMeanRetPct, 5, 1e-9, 'S4 meanRet=(100+50+0×28)/30=5');
    approx(snap.deathRate, 29 / 30, 1e-12, 'S4 deathRate=29/30（T-60s 存活者除外）');
    ok(snap.newborn1h === 31, 'S4 newborn1h=31（30 cohort + 1 未成熟）', snap.newborn1h);
    // 分钟回退重算（回测时钟回退/跨 token 乱序到达：memo 不返回未来分钟快照）
    const snapBack = fa.computeMarketSnapshot(T - 120 * 1000);
    ok(snapBack !== snap && snapBack.minuteKey === Math.floor((T - 120 * 1000) / 60000),
        'S4 分钟回退 → 重算新快照（非未来分钟 memo）', snapBack.minuteKey);
}

function s5_deathIdle() {
    resetFeed();
    const fa = new FA({});
    const T = T0 + 70 * MIN;
    const birth = T - 20 * MIN;
    for (let i = 1; i <= 30; i++) {
        birthToken(fa, `S5C${i}`, birth, [[1000, true, 10, 0.01]]);
    }
    // 幸存者：尘 tick（0.0001 BNB < 0.002 尘门）@T-90s 续命，假价 500 不得进 lastRel
    fa.processTick(mkTick('S5C1', T - 90 * 1000, true, 500, 0.0001, '0x5'), { emitFactors: false });
    const snap = fa.computeMarketSnapshot(T);
    ok(snap.cohortN === 30, 'S5 cohortN=30', snap.cohortN);
    approx(snap.deathRate, 29 / 30, 1e-12, 'S5 deathRate=29/30（尘 tick 续命 90s<540s 存活）');
    approx(snap.youngMeanRetPct, 0, 1e-12, 'S5 meanRet 精确 0（尘假价 500 不进 lastRel——泄漏则 ≈163）');
}

function s6_flowRing() {
    resetFeed();
    const fa = new FA({});
    const m0 = T0 / 60000;
    // 出生 tick 用 0 量（只建 state 不污染流向账）
    birthToken(fa, 'S6F', T0, [[0, true, 1, 0]]);
    // 远古买 5 BNB @m0-10 分钟槽
    fa.processTick(mkTick('S6F', (m0 - 10) * 60000 + 500, true, 1, 5, '0x6'), { emitFactors: false });
    let snap = fa.computeMarketSnapshot((m0 - 10) * 60000 + 60000); // m0-9 分钟读：远古在窗（差 1）
    approx(snap.flowBuyBnb, 5, 1e-9, 'S6 远古槽在窗内可见（差 1<11）');
    // m0 分钟：买 0.6 + 卖 0.6
    fa.processTick(mkTick('S6F', m0 * 60000 + 1000, true, 1, 0.6, '0x6'), { emitFactors: false });
    fa.processTick(mkTick('S6F', m0 * 60000 + 2000, false, 1, 0.6, '0x6'), { emitFactors: false });
    snap = fa.computeMarketSnapshot(m0 * 60000 + 3000);
    approx(snap.flowBuyBnb, 5.6, 1e-9, 'S6 m0 读：远古（差 10<11）+ 当分钟 0.6');
    ok(snap.flowBsRatio === null, 'S6 Σsell=0.6 < 1 BNB → ratio null', snap.flowBsRatio);
    // 同分钟再卖 0.6（同分钟 memo：本分钟读已冻结，下分钟才可见全量）
    fa.processTick(mkTick('S6F', m0 * 60000 + 30000, false, 1, 0.6, '0x6'), { emitFactors: false });
    snap = fa.computeMarketSnapshot((m0 + 1) * 60000 + 1000);
    approx(snap.flowBuyBnb, 0.6, 1e-9, 'S6 下分钟读：远古槽滑出（差 11 不<11）');
    approx(snap.flowSellBnb, 1.2, 1e-9, 'S6 下分钟读：同分钟累计 Σsell=1.2 全量可见');
    approx(snap.flowBsRatio, 0.5, 1e-12, 'S6 ratio=0.6/1.2=0.5（Σsell 过 1 BNB 门槛）');
}

function s7_fifoPrune() {
    resetFeed();
    const fa = new FA({});
    const T = T0 + 100 * MIN;
    const birth = T - 66 * MIN;
    fa.registerToken('S7F', { createdAtMs: birth, totalSupply: 1e9 });
    fa.processTick(mkTick('S7F', birth + 1000, true, 1, 0.01, '0x7'), { emitFactors: false });
    ok(FA.getMarketRegistrySize() === 1, 'S7 出生注册（首 tick 距 birth 1s）', FA.getMarketRegistrySize());
    fa.processTick(mkTick('S7F', T, true, 1, 0.01, '0x7'), { emitFactors: false });
    ok(FA.getMarketRegistrySize() === 0, 'S7 birth 龄 66m>65m → 写时裁剪出册（FIFO）', FA.getMarketRegistrySize());
}

function s8_reliablePriceGuard() {
    resetFeed();
    // minCohort=1 覆盖探针（cohort 三参数走 factorParams 覆盖路径）
    const fa = new FA({ fourmemeWs: { factorParams: { marketMinCohort: 1 } } });
    const T = T0 + 130 * MIN;
    const birth = T - 20 * MIN;
    fa.registerToken('S8P', { createdAtMs: birth, totalSupply: 1e9 });
    // 3 个可靠基准价 1（离群检测需 ≥3 已接受中位）
    for (let i = 1; i <= 3; i++) {
        fa.processTick(mkTick('S8P', birth + i * 1000, true, 1, 0.01, '0x8'), { emitFactors: false });
    }
    // 局部离群毒价 2000（>中位 1×1000）→ _acceptPrice 拒 → priceReliable=false
    fa.processTick(mkTick('S8P', birth + 4000, true, 2000, 0.01, '0x8'), { emitFactors: false });
    // 尘 tick 假价 500（0.0001<0.002 尘门）→ priceReliable=false
    fa.processTick(mkTick('S8P', birth + 5000, true, 500, 0.0001, '0x8'), { emitFactors: false });
    // 合法可靠价 2 → lastRel=peak=+100%（火箭）
    fa.processTick(mkTick('S8P', birth + 6000, true, 2, 0.01, '0x8'), { emitFactors: false });
    const snap = fa.computeMarketSnapshot(T);
    ok(snap.cohortN === 1, 'S8 cohortN=1（minCohort 覆盖生效）', snap.cohortN);
    approx(snap.rocketRate, 1, 1e-12, 'S8 rocket=1（合法 2/1=+100%；毒价泄漏则 peak=+199900%）');
    approx(snap.youngMeanRetPct, 100, 1e-9, 'S8 lastRel=+100%（尘/离群价均不进价格链）');
}

function s9_interleavedAccumulation() {
    resetFeed();
    const fa1 = new FA({});
    const fa2 = new FA({}); // 跨 FA 实例分流累积（同模块单例）
    const T = T0 + 160 * MIN;
    birthToken(fa1, 'S9A', T, [[0, true, 1, 0.4]]);
    birthToken(fa2, 'S9B', T, [[1000, false, 1, 0.8]]);
    const s1 = fa1.computeMarketSnapshot(T + 2000);
    const s2 = fa2.computeMarketSnapshot(T + 2000);
    ok(s1 === s2, 'S9 两实例读同一快照对象（模块级单例）');
    ok(s1.newborn1h === 2, 'S9 newborn=2（A+B 交错注册）', s1.newborn1h);
    approx(s1.flowBuyBnb, 0.4, 1e-12, 'S9 Σ买=0.4（fa1 侧）');
    approx(s1.flowSellBnb, 0.8, 1e-12, 'S9 Σ卖=0.8（fa2 侧）');
}

function main() {
    console.log('═'.repeat(72));
    console.log('pumpfun 回迁批 2.6 市场截面 regime 测试');
    console.log('═'.repeat(72));

    s0_keysAndFeedOff();  console.log('  ✓ S0 键注册 + 未 feed null / fed newborn');
    s1_crossTokenConsistency(); console.log('  ✓ S1 截面一致性 + memo + 跨实例共享');
    s2_nullConditionSemantics(); console.log('  ✓ S2 null 过 ConditionEvaluator 恒 false');
    s3_birthDedup(); console.log('  ✓ S3 出生去重 + 老票不入册');
    s4_cohortBoundaries(); console.log('  ✓ S4 cohort 边界 + minCohort 门槛 + 分钟回退');
    s5_deathIdle(); console.log('  ✓ S5 断流死（尘续命/尘假价隔离）');
    s6_flowRing(); console.log('  ✓ S6 流向环（滑出/门槛/同分钟 memo）');
    s7_fifoPrune(); console.log('  ✓ S7 FIFO 写时裁剪');
    s8_reliablePriceGuard(); console.log('  ✓ S8 可靠价守卫（尘/离群）');
    s9_interleavedAccumulation(); console.log('  ✓ S9 交错序累积交换律');

    FA.setMarketFeedEnabled(false); // 复位模块态，不影响后续 require 此模块的进程内测试

    console.log('\n' + '═'.repeat(72));
    console.log(`结果：${passed} 通过 / ${failed} 失败`);
    if (failed > 0) process.exit(1);
    console.log('全部通过 ✅');
}

main();
