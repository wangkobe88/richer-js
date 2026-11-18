#!/usr/bin/env node
/**
 * T184 聪明钱涌入状态机三键单测（2026-11-18 smart-inflow 备选策略）——本地零 DB 零网络。
 *
 * 三键：smartInflowReady / smartInflowChainSize / smartInflowChainBnb。
 * 判据（2026-11-18 涌入研究事件定义 bit 复现）：
 *   - 实体 = famous∪smartmoney 名单钱包首笔 ≥0.05B 买入（行价）；
 *     同块 ∧ 金额相对差 <1% 的后来钱包并入首见实体（镜像簇：链额相加、
 *     首买价/时刻=首见者——0x3472+0x95b9 同秒同额对倒并为一实体）；
 *   - 事件 = ≥3 实体、链尾前全部 600s 窗内、相邻实体价 ≥ 前者 ×0.98（strict
 *     接力）、链额 ≤5B；首个达标链 write-once 锁存；
 *   - ready = 事件后 60s 保持窗内为 1（now=buildFactorMap 入参，禁 Date.now）。
 *
 * 覆盖：
 *   A. 研究核心形状（3 实体递增价 → 事件锁存+ready 窗边界+chainSize/chainBnb 精确值）
 *   B. 镜像合并（同块同额=1 实体链额相加；非同块同额=2 实体；合并进首见者价/时刻）
 *   C. 判负分支（2 实体/价断崖>2%/链额超帽/窗外实体/首买<门额/名单外/卖出行）
 *   D. 首事件锁存（第 4 实体不刷新 chainSize）
 *   E. 无事件（chainSize/chainBnb=null 与 ready=0）
 *   F. getFactorKeys 探针含三键（未知因子三防线）
 *   G. 名单双缺失 → 恒 0（宁漏不冒充）
 *   H. 源码口径断言（事件时刻=链尾首买秒、readiness 用 now 入参、写点双段防双计）
 *
 * 用法：node scripts/_test_smart_inflow_factors.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const FourMemeFactorAggregator = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'));

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const T0 = 1790802000000;
let _li = 0;
const mkTick = (o) => Object.assign({
    token_address: '0xtoken', trade_type: 'buy', trader_address: '0xa', sender_address: null,
    price_bnb: 0.000001, price_usd: 0.0006, bnb_amount: 1, token_amount: 1000000,
    block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: _li++,
}, o);

const FAM = ['0xfamaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'];
const SM = ['0xsmbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'];
const OUTSIDER = '0xoutccccccccccccccccccccccccccccccccccccc';

/** 标准构造：名单注入（famous∪sm）+ 注册 token */
function newFA() {
    FourMemeFactorAggregator.setFamousCopyWalletsForTest(FAM);
    FourMemeFactorAggregator.setSmartMoneyWalletsForTest(SM);
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    return fa;
}

/** 三实体接力标准序列：w1@1000 价1.0 → w2@200000 价1.01 → w3@400000 价1.02（全部 0.1B） */
function feedRelay3(fa, over = {}) {
    fa.processTick(mkTick(Object.assign({ sender_address: SM[0], block_number: 100, price_bnb: 1.0e-9, bnb_amount: 0.1, timestamp: T0 + 1000 }, over.w1 || {})));
    fa.processTick(mkTick(Object.assign({ sender_address: FAM[0], block_number: 101, price_bnb: 1.01e-9, bnb_amount: 0.1, timestamp: T0 + 200000 }, over.w2 || {})));
    fa.processTick(mkTick(Object.assign({ sender_address: '0xw3ddddddddddddddddddddddddddddddddddddddd', block_number: 102, price_bnb: 1.02e-9, bnb_amount: 0.1, timestamp: T0 + 400000 }, over.w3 || {})));
}

// 名单准备：w3 也须在名单内（famous 扩一位）
const FAM3 = [...FAM, '0xw3ddddddddddddddddddddddddddddddddddddddd'];

// ═══════════════ A. 研究核心形状 ═══════════════
console.log('A. 三实体 600s 接力 → 事件锁存 + ready 窗');
{
    FourMemeFactorAggregator.setFamousCopyWalletsForTest(FAM3);
    FourMemeFactorAggregator.setSmartMoneyWalletsForTest(SM);
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    fa.processTick(mkTick({ sender_address: SM[0], block_number: 100, price_bnb: 1.0e-9, bnb_amount: 0.1, timestamp: T0 + 1000 }));
    const f0 = fa.buildFactorMap('0xtoken', T0 + 1000);
    check('两实体前 ready=0 / 链键 null', () => {
        assert.strictEqual(f0.smartInflowReady, 0);
        assert.strictEqual(f0.smartInflowChainSize, null);
        assert.strictEqual(f0.smartInflowChainBnb, null);
    });
    fa.processTick(mkTick({ sender_address: FAM3[0], block_number: 101, price_bnb: 1.01e-9, bnb_amount: 0.1, timestamp: T0 + 200000 }));
    const f1 = fa.buildFactorMap('0xtoken', T0 + 200000);
    check('第三实体前（2 实体）ready=0', () => assert.strictEqual(f1.smartInflowReady, 0));
    fa.processTick(mkTick({ sender_address: FAM3[1], block_number: 102, price_bnb: 1.02e-9, bnb_amount: 0.1, timestamp: T0 + 400000 }));
    const f2 = fa.buildFactorMap('0xtoken', T0 + 400000);
    check('事件秒 ready=1 / chainSize=3 / chainBnb=0.3', () => {
        assert.strictEqual(f2.smartInflowReady, 1);
        assert.strictEqual(f2.smartInflowChainSize, 3);
        assert.strictEqual(f2.smartInflowChainBnb, 0.3);
    });
    const f59 = fa.buildFactorMap('0xtoken', T0 + 400000 + 59999);
    check('事件后 59.999s ready 仍 1', () => assert.strictEqual(f59.smartInflowReady, 1));
    const f61 = fa.buildFactorMap('0xtoken', T0 + 400000 + 60001);
    check('事件后 60.001s ready 归 0（链键仍留档）', () => {
        assert.strictEqual(f61.smartInflowReady, 0);
        assert.strictEqual(f61.smartInflowChainSize, 3);
    });
}

// ═══════════════ B. 镜像合并 ═══════════════
console.log('B. 同块同额镜像并入首见实体（0x3472+0x95b9 形状）');
{
    FourMemeFactorAggregator.setFamousCopyWalletsForTest(FAM3);
    FourMemeFactorAggregator.setSmartMoneyWalletsForTest([...SM, '0xmirrbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']);
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    // w1 0.2459 与镜像 w1' 0.2459 同块 → 1 实体 amt 0.4918
    fa.processTick(mkTick({ sender_address: SM[0], block_number: 100, price_bnb: 5.0e-9, bnb_amount: 0.2459, timestamp: T0 + 1000 }));
    fa.processTick(mkTick({ sender_address: '0xmirrbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', block_number: 100, price_bnb: 5.05e-9, bnb_amount: 0.2459, timestamp: T0 + 1050 }));
    // w2、w3 独立块
    fa.processTick(mkTick({ sender_address: FAM3[0], block_number: 101, price_bnb: 5.1e-9, bnb_amount: 0.1, timestamp: T0 + 200000 }));
    fa.processTick(mkTick({ sender_address: FAM3[1], block_number: 102, price_bnb: 5.2e-9, bnb_amount: 0.1, timestamp: T0 + 400000 }));
    const f = fa.buildFactorMap('0xtoken', T0 + 400000);
    check('镜像并一实体：chainSize=3 / chainBnb=0.2459×2+0.1+0.1=0.6918', () => {
        assert.strictEqual(f.smartInflowChainSize, 3);
        assert.strictEqual(f.smartInflowChainBnb, 0.6918);
        assert.strictEqual(f.smartInflowReady, 1);
    });
    // 非同块同额 = 2 实体（不合并）
    const fa2 = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa2.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    fa2.processTick(mkTick({ sender_address: SM[0], block_number: 100, price_bnb: 5.0e-9, bnb_amount: 0.2459, timestamp: T0 + 1000 }));
    fa2.processTick(mkTick({ sender_address: '0xmirrbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', block_number: 103, price_bnb: 5.05e-9, bnb_amount: 0.2459, timestamp: T0 + 1100 }));
    fa2.processTick(mkTick({ sender_address: FAM3[0], block_number: 101, price_bnb: 5.1e-9, bnb_amount: 0.1, timestamp: T0 + 200000 }));
    fa2.processTick(mkTick({ sender_address: FAM3[1], block_number: 102, price_bnb: 5.2e-9, bnb_amount: 0.1, timestamp: T0 + 400000 }));
    const f2 = fa2.buildFactorMap('0xtoken', T0 + 400000);
    check('非同块同额不合并：事件在 w2 时刻触发 chain=[w1,w1\'w2] size=3', () => {
        assert.strictEqual(f2.smartInflowChainSize, 3);
        assert.strictEqual(f2.smartInflowChainBnb, 0.5918);
    });
    // 金额差 2%（>1% 容差）不合并
    const fa3 = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa3.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    fa3.processTick(mkTick({ sender_address: SM[0], block_number: 100, price_bnb: 5.0e-9, bnb_amount: 0.2459, timestamp: T0 + 1000 }));
    fa3.processTick(mkTick({ sender_address: '0xmirrbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', block_number: 100, price_bnb: 5.05e-9, bnb_amount: 0.2508, timestamp: T0 + 1050 })); // 相对差 0.0107 > 0.01
    fa3.processTick(mkTick({ sender_address: FAM3[0], block_number: 101, price_bnb: 5.1e-9, bnb_amount: 0.1, timestamp: T0 + 200000 }));
    fa3.processTick(mkTick({ sender_address: FAM3[1], block_number: 102, price_bnb: 5.2e-9, bnb_amount: 0.1, timestamp: T0 + 400000 }));
    const f3 = fa3.buildFactorMap('0xtoken', T0 + 400000);
    check('同块金额差 1.07% 不合并：事件在 w2 时刻触发 size=3 bnb=0.5967', () => {
        assert.strictEqual(f3.smartInflowChainSize, 3);
        assert.strictEqual(f3.smartInflowChainBnb, 0.5967);
    });
}

// ═══════════════ C. 判负分支 ═══════════════
console.log('C. 判负分支（全部不触发 ready）');
{
    // 价断崖：w3 价 < w2×0.98
    FourMemeFactorAggregator.setFamousCopyWalletsForTest(FAM3);
    FourMemeFactorAggregator.setSmartMoneyWalletsForTest(SM);
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    feedRelay3(fa, { w3: { price_bnb: 0.98e-9 } }); // 1.01×0.98=0.9898 > 0.98 → 断崖
    check('价断崖 >2% 不触发', () => assert.strictEqual(fa.buildFactorMap('0xtoken', T0 + 400000).smartInflowReady, 0));
}
{
    FourMemeFactorAggregator.setFamousCopyWalletsForTest(FAM3);
    FourMemeFactorAggregator.setSmartMoneyWalletsForTest(SM);
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    feedRelay3(fa, { w3: { price_bnb: 0.99e-9 } }); // 0.99 ≥ 0.9898 恰过容差
    check('价恰在 2% 容差内（0.99 ≥ 0.9898）触发', () => assert.strictEqual(fa.buildFactorMap('0xtoken', T0 + 400000).smartInflowReady, 1));
}
{
    // 链额超帽 5B
    FourMemeFactorAggregator.setFamousCopyWalletsForTest(FAM3);
    FourMemeFactorAggregator.setSmartMoneyWalletsForTest(SM);
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    feedRelay3(fa, { w1: { bnb_amount: 2 }, w2: { bnb_amount: 2 }, w3: { bnb_amount: 2 } }); // 6 > 5
    check('链额 6B 超帽不触发', () => assert.strictEqual(fa.buildFactorMap('0xtoken', T0 + 400000).smartInflowReady, 0));
    // 恰 5B（3×1.666…）触发
    const fa5 = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa5.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    feedRelay3(fa5, { w1: { bnb_amount: 5 / 3 }, w2: { bnb_amount: 5 / 3 }, w3: { bnb_amount: 5 / 3 } });
    check('链额恰 5B 不超帽触发', () => assert.strictEqual(fa5.buildFactorMap('0xtoken', T0 + 400000).smartInflowReady, 1));
}
{
    // 600s 窗外：w1 在 700s 前（链尾 w3 只见 w2）
    FourMemeFactorAggregator.setFamousCopyWalletsForTest(FAM3);
    FourMemeFactorAggregator.setSmartMoneyWalletsForTest(SM);
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    feedRelay3(fa, { w1: { timestamp: T0 + 1 } }); // w3@T0+400000 - w1@T0+1 = 399999ms 内？
    // 400000-1 = 399999 < 600000 → 在窗内。改 w1 更早：
    const faW = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    faW.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    faW.processTick(mkTick({ sender_address: SM[0], block_number: 100, price_bnb: 1.0e-9, bnb_amount: 0.1, timestamp: T0 + 1000 }));
    faW.processTick(mkTick({ sender_address: FAM3[0], block_number: 101, price_bnb: 1.01e-9, bnb_amount: 0.1, timestamp: T0 + 200000 }));
    faW.processTick(mkTick({ sender_address: FAM3[1], block_number: 102, price_bnb: 1.02e-9, bnb_amount: 0.1, timestamp: T0 + 620000 })); // 距 w1 619s>600s → prior 只剩 w2
    check('链尾距首实体 >600s：prior 不足 2 不触发', () => assert.strictEqual(faW.buildFactorMap('0xtoken', T0 + 620000).smartInflowReady, 0));
}
{
    // 首买 <0.05 不建实体；同钱包后续 0.06 才建
    FourMemeFactorAggregator.setFamousCopyWalletsForTest(FAM3);
    FourMemeFactorAggregator.setSmartMoneyWalletsForTest(SM);
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    fa.processTick(mkTick({ sender_address: SM[0], block_number: 100, price_bnb: 1.0e-9, bnb_amount: 0.03, timestamp: T0 + 1000 }));
    fa.processTick(mkTick({ sender_address: SM[0], block_number: 103, price_bnb: 1.0e-9, bnb_amount: 0.06, timestamp: T0 + 3000 })); // 实体建于此（ts=T0+3000）
    fa.processTick(mkTick({ sender_address: FAM3[0], block_number: 101, price_bnb: 1.01e-9, bnb_amount: 0.1, timestamp: T0 + 200000 }));
    fa.processTick(mkTick({ sender_address: FAM3[1], block_number: 102, price_bnb: 1.02e-9, bnb_amount: 0.1, timestamp: T0 + 400000 }));
    const f = fa.buildFactorMap('0xtoken', T0 + 400000);
    check('首买<门额不建实体，后续过线笔才建：chainSize=3 chainBnb=0.26', () => {
        assert.strictEqual(f.smartInflowChainSize, 3);
        assert.strictEqual(f.smartInflowChainBnb, 0.26);
    });
}
{
    // 名单外钱包 + 卖出行
    FourMemeFactorAggregator.setFamousCopyWalletsForTest(FAM3);
    FourMemeFactorAggregator.setSmartMoneyWalletsForTest(SM);
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    fa.processTick(mkTick({ sender_address: OUTSIDER, block_number: 100, price_bnb: 1.0e-9, bnb_amount: 0.5, timestamp: T0 + 1000 }));
    fa.processTick(mkTick({ sender_address: FAM3[0], block_number: 101, price_bnb: 1.01e-9, bnb_amount: 0.1, timestamp: T0 + 200000 }));
    fa.processTick(mkTick({ sender_address: FAM3[1], block_number: 102, price_bnb: 1.02e-9, bnb_amount: 0.1, timestamp: T0 + 400000 }));
    check('名单外大买不建实体：2 实体不触发', () => assert.strictEqual(fa.buildFactorMap('0xtoken', T0 + 400000).smartInflowReady, 0));
    fa.processTick(mkTick({ sender_address: SM[0], trade_type: 'sell', block_number: 103, price_bnb: 1.02e-9, bnb_amount: 0.1, timestamp: T0 + 400100 }));
    check('卖出行不建实体不破坏', () => assert.strictEqual(fa.buildFactorMap('0xtoken', T0 + 400100).smartInflowReady, 0));
}

// ═══════════════ D. 首事件锁存 ═══════════════
console.log('D. 首事件 write-once 锁存');
{
    FourMemeFactorAggregator.setFamousCopyWalletsForTest(FAM3);
    FourMemeFactorAggregator.setSmartMoneyWalletsForTest(SM);
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    feedRelay3(fa);
    const at = T0 + 400000;
    // 第 4 实体（更高价更大额）到来：chainSize/chainBnb/eventAt 不刷新
    fa.processTick(mkTick({ sender_address: '0xw4eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', block_number: 104, price_bnb: 1.05e-9, bnb_amount: 0.3, timestamp: T0 + 500000 }));
    const f = fa.buildFactorMap('0xtoken', T0 + 500000);
    check('第 4 实体后事件快照不刷新（chainSize 仍 3/Bnb 仍 0.3）', () => {
        assert.strictEqual(f.smartInflowChainSize, 3);
        assert.strictEqual(f.smartInflowChainBnb, 0.3);
    });
    check('事件时刻仍=原链尾首买秒（500000 距 400000=100s>60s → ready 0）', () => {
        assert.strictEqual(f.smartInflowReady, 0);
    });
}

// ═══════════════ F. 探针 ═══════════════
console.log('F. getFactorKeys 探针含三键');
{
    const _fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    const keys = _fa.getFactorKeys();
    check('三键在 FA 键集', () => {
        assert.ok(keys.has('smartInflowReady'), 'smartInflowReady');
        assert.ok(keys.has('smartInflowChainSize'), 'smartInflowChainSize');
        assert.ok(keys.has('smartInflowChainBnb'), 'smartInflowChainBnb');
    });
}

// ═══════════════ G. 名单双缺失 ═══════════════
console.log('G. 名单双缺失 → 恒 0');
{
    FourMemeFactorAggregator.setFamousCopyWalletsForTest(null);
    FourMemeFactorAggregator.setSmartMoneyWalletsForTest(null);
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    feedRelay3(fa);
    const f = fa.buildFactorMap('0xtoken', T0 + 400000);
    check('名单缺失：三实体喂入零实体，ready=0 链键 null', () => {
        assert.strictEqual(f.smartInflowReady, 0);
        assert.strictEqual(f.smartInflowChainSize, null);
        assert.strictEqual(f.smartInflowChainBnb, null);
    });
}

// ═══════════════ H. 源码口径断言 ═══════════════
console.log('H. 源码口径断言');
{
    const src = read('src/services/FourMemeFactorAggregator.js');
    check('事件时刻=链尾实体首买 ts（_inflowEventAt = e.ts）', () => {
        assert.ok(/state\._inflowEventAt = e\.ts;/.test(src));
    });
    check('ready 判定用 now 入参（无 Date.now）', () => {
        const seg = src.match(/smartInflowReady:[\s\S]*?inflowReadyHoldMs \? 1 : 0/);
        assert.ok(seg && !/Date\.now/.test(seg[0]));
    });
    check('写点①在 chainLate 域外（迟到行照建实体——不依赖价格可靠链）', () => {
        const seg = src.match(/chainLate = true;[\s\S]{0,900}?_noteSmartInflow/);
        assert.ok(seg, '写点①应在 chainLate 判定后的独立位置');
    });
    check('写点双段（价格段 !deferWallet + 补跑段 smartBotEligible）', () => {
        const w1 = src.match(/if \(!deferWallet && isBuy && blockNumber !== null[\s\S]*?_noteSmartInflow/);
        const w2 = src.match(/if \(vars\.smartBotEligible === true && isBuy && vars\.blockNumber != null[\s\S]*?_noteSmartInflow/);
        assert.ok(w1 && w2);
    });
    check('镜像合并进首见实体（e.amt += bnbAmount 不建新实体）', () => {
        assert.ok(/e\.amt \+= bnbAmount;/.test(src));
    });
    check('研究参数默认值（0.05/600000/0.02/5/60000/0.01）', () => {
        assert.ok(/inflowMinFirstBnb: 0\.05/.test(src));
        assert.ok(/inflowWindowMs: 600000/.test(src));
        assert.ok(/inflowPriceTol: 0\.02/.test(src));
        assert.ok(/inflowMaxChainBnb: 5,/.test(src));
        assert.ok(/inflowReadyHoldMs: 60000/.test(src));
        assert.ok(/inflowMirrorAmtTol: 0\.01/.test(src));
    });
}

console.log(`\n结果: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
