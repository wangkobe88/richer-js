#!/usr/bin/env node
/**
 * FA launch* 出生锚定捆绑簇 6 键单测（2026-10-17 Agentum 案方向 C；T141 2026-11-15
 * 增首两波两键）——本地零 DB 零网络。
 *
 * launchBundleClusterSize / launchBundleClusterSharePct / launchEqualClusterWallets /
 * launchEqualClusterBnb：出生窗（firstTickAt+launchBundleWinMs=90s）累计 + 出窗冻结。
 * launchFirstBlockWallets / launchFirstWaveWallets（T141）：首块首买钱包数 f0 /
 * f0+首块后 ≤2s（LAUNCH_FIRST_WAVE_MS）内第一个有交易块（buy/sell 都算活跃）的
 * 首买钱包数——「狙击小队先头在首块+同波续单在下一块」合并计数；两键纯事实计数，
 * f0≥2 提纯由门串组合表达（用户拍板形状 X=2s ∧ f0≥2）。
 *
 * 覆盖（Agentum 现场反证为本案核心）：
 *   A. Agentum 现场精确值：簇 A 同块 4 笔不等额（创建块）+ 中段散户 + 簇 B 跨块等额
 *      0.1485×3；fire 时刻（+61.5s 簇 B 第三笔未到）launchEqualClusterWallets=0
 *      （2<3 归零——「fire 早于簇完成=快枪形状天然不拦」事实断言）、簇 A 出生锚定
 *      可见（size=4，与 10s 滑窗漏创建块的关键差异）；全量+冻结后 wallets=3/0.4455
 *   B. Konasu 形状：3 钱包同块等额 → wallets=3（同块等额同样抓）
 *   C. defer 乱序收敛：价格段先行 + wallet 段乱序回推 → 与正序同值
 *   D. 尘埃等额（<0.01）不聚簇；E. 2 钱包等额不触发（FLY 形状归 10s 臂）
 *   F. 出窗冻结恒定 + 触发出窗行不入窗；G. 源码口径反证（禁 Date.now）
 *   H. getFactorKeys 探针收键 + FactorBuilder 快照透传
 *   I-Q. T141 首两波两键：I 精确值（Agentum 形状 f0=4/wave=5）/ J X=2s 边界（≤2000
 *      算 2001 不算）/ K 纯 sell 块算活跃且不跳过 / L f0<2 照发真值+首买跨块去重 /
 *      M defer 乱序收敛 / N 出窗冻结+触发行不入 map / O 首块锚缺失→0、null wallet
 *      入 map 不入首买 / P 源码口径反证 / Q v20 门串求值（挡/放全分支+装载）
 *
 * 用法：node scripts/_test_launch_bundle_factors.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'), 'utf8');
const FourMemeFactorAggregator = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'));
const FactorBuilder = require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder'));

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const T0 = 1790802000000;
const ADDR = '0xtok_launch';
const ROUTER = '0x1de460f363af910f51726def188f9004276bf4bc'; // GMGN 聚合路由

function newFA() {
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  fa.registerToken(ADDR, { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  return fa;
}
function mkTick(over) {
  return Object.assign({
    token_address: ADDR, trade_type: 'buy', trader_address: null, sender_address: null,
    price_bnb: 0.00001, price_usd: 5, bnb_amount: 1, token_amount: 1000,
    block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: 0,
  }, over);
}
function feed(fa, ticks, opts) {
  for (const t of ticks) fa.processTick(mkTick(t), opts || {});
}
function F(fa, now) { return fa.buildFactorMap(ADDR, now == null ? T0 + 5000 : now); }
const pick = (f) => ({
  size: f.launchBundleClusterSize, share: f.launchBundleClusterSharePct,
  eqW: f.launchEqualClusterWallets, eqBnb: f.launchEqualClusterBnb,
});

// Agentum 现场形状（链序简化保真）：簇 A 创建块 4 笔不等额（trader=creator 合约+GMGN×3）
// + 中段散户 4 笔分散块 + 簇 B 跨块等额 0.1485×3（+60/+70s）
const AGENTUM = [
  { timestamp: T0 + 1000,  block_number: 347, log_index: 44,  sender_address: 'wA1', trader_address: '0xcreator', bnb_amount: 0.12 },
  { timestamp: T0 + 1000,  block_number: 347, log_index: 67,  sender_address: 'wA2', trader_address: ROUTER, bnb_amount: 0.2178 },
  { timestamp: T0 + 1000,  block_number: 347, log_index: 90,  sender_address: 'wA3', trader_address: ROUTER, bnb_amount: 0.1881 },
  { timestamp: T0 + 1000,  block_number: 347, log_index: 113, sender_address: 'wA4', trader_address: ROUTER, bnb_amount: 0.198 },
  { timestamp: T0 + 2000,  block_number: 348, log_index: 10,  sender_address: 'wD1', trader_address: '0xeoaD1', bnb_amount: 0.2082 },
  { timestamp: T0 + 2000,  block_number: 349, log_index: 20,  sender_address: 'wD2', trader_address: '0xeoaD2', bnb_amount: 0.1 },
  { timestamp: T0 + 2000,  block_number: 349, log_index: 30,  sender_address: 'wD3', trader_address: '0xeoaD3', bnb_amount: 0.2277 },
  { timestamp: T0 + 3000,  block_number: 350, log_index: 40,  sender_address: 'wD4', trader_address: '0xeoaD4', bnb_amount: 0.099 },
  { timestamp: T0 + 60000, block_number: 481, log_index: 651, sender_address: 'wB1', trader_address: ROUTER, bnb_amount: 0.1485 },
  { timestamp: T0 + 60000, block_number: 481, log_index: 674, sender_address: 'wB2', trader_address: ROUTER, bnb_amount: 0.1485 },
  { timestamp: T0 + 70000, block_number: 503, log_index: 3670, sender_address: 'wB3', trader_address: ROUTER, bnb_amount: 0.1485 },
];

// ═══════════════ A. Agentum 现场反证 ═══════════════
console.log('A. Agentum 现场反证');
{
  const fa = newFA();
  feed(fa, AGENTUM.slice(0, 10)); // 只喂到簇 B 前两笔（fire=+61.5s 第三笔未到）
  const at = pick(F(fa, T0 + 61500));
  // fire 前总买入 = 0.7239(簇A) + 0.6349(散户) + 0.297(簇B前2) = 1.6558
  check('A1 fire 时刻簇 A 出生锚定可见：size=4（10s 滑窗此值=0 的关键差异）', () => {
    assert.strictEqual(at.size, 4);
  });
  check('A2 share=0.7239/1.6558=43.7', () => {
    assert.strictEqual(at.share, 43.7);
  });
  check('A3 fire 早于簇完整：等额簇 2 钱包 <3 归零（快枪形状天然不拦——事实断言）', () => {
    assert.strictEqual(at.eqW, 0);
    assert.strictEqual(at.eqBnb, 0);
  });
  // 簇 B 第三笔到齐 + 出窗行触发冻结
  feed(fa, AGENTUM.slice(10));
  feed(fa, [{ timestamp: T0 + 100000, block_number: 600, sender_address: 'wX', trader_address: '0xeoaX', bnb_amount: 5.0 }]);
  const fro = pick(F(fa, T0 + 105000));
  // 全量总买入 = 1.6558 + 0.1485 = 1.8043；触发行 5.0 出窗不入分母
  check('A4 冻结后等额簇完整可见：wallets=3 / bnb=0.4455（Konasu/鲸元卷形状在此拦）', () => {
    assert.strictEqual(fro.eqW, 3);
    assert.strictEqual(fro.eqBnb, 0.4455);
  });
  check('A5 冻结快照 share=0.7239/1.8043=40.1（触发出窗行 5.0 不入分母）', () => {
    assert.strictEqual(fro.share, 40.1);
    assert.strictEqual(fro.size, 4);
  });
  feed(fa, [{ timestamp: T0 + 200000, block_number: 700, sender_address: 'wY', trader_address: '0xeoaY', bnb_amount: 100 }]);
  const late = pick(F(fa, T0 + 205000));
  check('A6 冻结后恒返回快照（晚到行不改值）', () => {
    assert.deepStrictEqual(late, fro);
  });
}

// ═══════════════ B. Konasu 形状（同块等额） ═══════════════
console.log('B. Konasu 同块等额');
{
  const fa = newFA();
  feed(fa, [
    { timestamp: T0 + 10000, block_number: 200, log_index: 5, sender_address: 'wK1', trader_address: '0xeoaK1', bnb_amount: 0.2 },
    { timestamp: T0 + 10000, block_number: 200, log_index: 15, sender_address: 'wK2', trader_address: '0xeoaK2', bnb_amount: 0.2 },
    { timestamp: T0 + 10000, block_number: 200, log_index: 25, sender_address: 'wK3', trader_address: '0xeoaK3', bnb_amount: 0.2 },
    { timestamp: T0 + 50000, block_number: 300, log_index: 1, sender_address: 'wR1', trader_address: '0xeoaR1', bnb_amount: 0.55 },
  ]);
  const p = pick(F(fa, T0 + 55000));
  check('B1 同块等额 3 钱包 → eqW=3 / eqBnb=0.6', () => {
    assert.strictEqual(p.eqW, 3);
    assert.strictEqual(p.eqBnb, 0.6);
  });
  check('B2 同块臂照抓：size=3 share=0.6/1.15=52.2', () => {
    assert.strictEqual(p.size, 3);
    assert.strictEqual(p.share, 52.2);
  });
}

// ═══════════════ C. defer 乱序收敛 ═══════════════
console.log('C. defer 两阶段乱序');
{
  const fa = newFA();
  const rows = [
    mkTick({ timestamp: T0 + 1000, block_number: 347, log_index: 10, sender_address: 'wE1', trader_address: '0xeoaE1', bnb_amount: 0.25 }),
    mkTick({ timestamp: T0 + 1000, block_number: 347, log_index: 20, sender_address: 'wE2', trader_address: '0xeoaE2', bnb_amount: 0.25 }),
    mkTick({ timestamp: T0 + 1000, block_number: 347, log_index: 30, sender_address: 'wE3', trader_address: '0xeoaE3', bnb_amount: 0.25 }),
    mkTick({ timestamp: T0 + 5000, block_number: 360, log_index: 1, sender_address: 'wD1', trader_address: '0xeoaD1', bnb_amount: 0.5 }),
  ];
  for (const t of rows) fa.processTick(t, { deferWallet: true });
  const mid = pick(F(fa, T0 + 6000));
  check('C1 wallet 段未回推：launch 族全 0（fire 若落在此刻=竞速缝隙——Agentum 第二根因）', () => {
    assert.strictEqual(mid.size, 0);
    assert.strictEqual(mid.share, 0);
  });
  // 乱序回推：D1 先、同块 E3/E1/E2 乱序
  fa.applyWalletTick(rows[3]);
  fa.applyWalletTick(rows[2]);
  fa.applyWalletTick(rows[0]);
  fa.applyWalletTick(rows[1]);
  const p = pick(F(fa, T0 + 7000));
  check('C2 乱序回推收敛：size=3（blk347 等额簇）eqW=3 share=0.75/1.25=60', () => {
    assert.strictEqual(p.size, 3);
    assert.strictEqual(p.eqW, 3);
    assert.strictEqual(p.share, 60);
  });
}

// ═══════════════ D/E. 门限边界 ═══════════════
console.log('D/E. 尘埃与 2 钱包等额');
{
  const fa = newFA();
  feed(fa, [
    { timestamp: T0 + 1000, block_number: 100, sender_address: 'wP1', trader_address: '0xeoaP1', bnb_amount: 0.005 },
    { timestamp: T0 + 2000, block_number: 110, sender_address: 'wP2', trader_address: '0xeoaP2', bnb_amount: 0.005 },
    { timestamp: T0 + 3000, block_number: 120, sender_address: 'wP3', trader_address: '0xeoaP3', bnb_amount: 0.005 },
    { timestamp: T0 + 4000, block_number: 130, sender_address: 'wQ1', trader_address: '0xeoaQ1', bnb_amount: 0.3705 },
    { timestamp: T0 + 5000, block_number: 140, sender_address: 'wQ2', trader_address: '0xeoaQ2', bnb_amount: 0.3705 },
  ]);
  const p = pick(F(fa, T0 + 6000));
  check('D1 尘埃等额（<0.01）不聚簇：eqW=0', () => {
    assert.strictEqual(p.eqW, 0);
    assert.strictEqual(p.eqBnb, 0);
  });
  check('E1 FLY 形状 2 钱包等额不触发（归现行 10s 臂管）：eqW=0', () => {
    assert.strictEqual(p.eqW, 0);
  });
  check('E2 尘埃行仍进同块分母/首买（照计语义：share 分母含 0.015）', () => {
    // 最大同块簇：各块 size=1；best=单行最大 0.3705 → share=0.3705/(0.015+0.741)=49
    assert.strictEqual(p.share, 49);
  });
}

// ═══════════════ G. 源码口径反证 ═══════════════
console.log('G. 源码口径');
{
  check('G1 _launchBundleFactors/_launchWindowAdvance 函数体禁 Date.now（防前视红线）', () => {
    const m = src.match(/_launchWindowAdvance\(state, ts\) \{[\s\S]*?\n    \}/)
        || src.match(/_launchWindowAdvance\(state, ts\) \{[\s\S]*?\n    _launchBundleFactors\(state\);[\s\S]*?\n    \}/);
    const m2 = src.match(/_launchBundleFactors\(state\) \{[\s\S]*?\n    \}/);
    assert.ok(m, '_launchWindowAdvance 源码段未找到');
    assert.ok(m2, '_launchBundleFactors 源码段未找到');
    assert.ok(!/Date\.now/.test(m[0]), '_launchWindowAdvance 含 Date.now');
    assert.ok(!/Date\.now/.test(m2[0]), '_launchBundleFactors 含 Date.now');
  });
  check('G2 分母口径=出生窗总买入（null wallet 行照计）', () => {
    const fa = newFA();
    feed(fa, [
      { timestamp: T0 + 1000, block_number: 100, sender_address: 'wA', trader_address: '0xeoaA', bnb_amount: 0.3 },
      { timestamp: T0 + 2000, block_number: 100, sender_address: null, trader_address: null, bnb_amount: 0.7 }, // null wallet
    ]);
    const p = pick(F(fa, T0 + 3000));
    // null wallet 行入分母不入簇 → share=0.3/1.0=30
    assert.strictEqual(p.share, 30);
    assert.strictEqual(p.size, 1);
  });
}

// ═══════════════ H. 探针收键 + FactorBuilder 透传 ═══════════════
console.log('H. 键集与快照');
{
  const fa = newFA();
  const keys = fa.getFactorKeys();
  check('H1 getFactorKeys 探针自动收 4 键', () => {
    for (const k of ['launchBundleClusterSize', 'launchBundleClusterSharePct',
      'launchEqualClusterWallets', 'launchEqualClusterBnb']) {
      assert.ok(keys.has(k), `缺键 ${k}`);
    }
  });
  check('H2 FactorBuilder 快照透传（有值/缺键 null 不掩盖）', () => {
    const snap = FactorBuilder.buildFactorValuesForTimeSeries({ launchEqualClusterWallets: 3, launchBundleClusterSharePct: 40.1 });
    assert.strictEqual(snap.launchEqualClusterWallets, 3);
    assert.strictEqual(snap.launchBundleClusterSharePct, 40.1);
    assert.strictEqual(snap.launchBundleClusterSize, null);
  });
}

// ═══════════════ I-Q. T141 首两波两键（2026-11-15：首块首买数 + 首块+≤2s 首个活跃块
//     首买数；用户拍板形状 X=2s ∧ f0≥2，两键纯事实计数、f0≥2 提纯由门串组合表达）═══════════════
console.log('I. 首两波精确值（Agentum 现场形状复用）');
{
  const fa = newFA();
  feed(fa, AGENTUM.slice(0, 10));
  const f = F(fa, T0 + 61500); // fire 时刻活值
  const fw = (m) => ({ f0: m.launchFirstBlockWallets, wave: m.launchFirstWaveWallets });
  check('I1 f0=4（首块 347 首买 wA1-wA4）', () => {
    assert.deepStrictEqual(fw(f), { f0: 4, wave: 5 });
  });
  feed(fa, AGENTUM.slice(10)); // 簇 B 第三笔 + 后续
  feed(fa, [{ timestamp: T0 + 100000, block_number: 600, sender_address: 'wX', trader_address: '0xeoaX', bnb_amount: 5.0 }]);
  const fro = F(fa, T0 + 105000);
  check('I2 出窗冻结后两键恒定（wave=5：348 是 ≤2s 最小块，其首买 wD1 一个——349 同刻但块号更大、350 gap=2000 恰界但块号更大）', () => {
    assert.deepStrictEqual(fw(fro), { f0: 4, wave: 5 });
  });
}

console.log('J. X=2s 块首时间差边界（≤2000 算 / 2001 不算）');
{
  const base = [
    { timestamp: T0 + 1000, block_number: 100, log_index: 1, sender_address: 'w1', trader_address: '0xe1', bnb_amount: 0.2 },
    { timestamp: T0 + 1000, block_number: 100, log_index: 2, sender_address: 'w2', trader_address: '0xe2', bnb_amount: 0.2 },
  ];
  const nxt = (ts, blk) => ([
    { timestamp: T0 + ts, block_number: blk, log_index: 3, sender_address: 'w3', trader_address: '0xe3', bnb_amount: 0.2 },
    { timestamp: T0 + ts, block_number: blk, log_index: 4, sender_address: 'w4', trader_address: '0xe4', bnb_amount: 0.2 },
  ]);
  const fw = (fa, now) => {
    const m = F(fa, now);
    return [m.launchFirstBlockWallets, m.launchFirstWaveWallets];
  };
  {
    const fa = newFA();
    feed(fa, base); feed(fa, nxt(3000, 101)); // gap=2000 恰界 → 算
    check('J1 gap 恰 2000ms（≤）计入：f0=2 wave=4', () =>
      assert.deepStrictEqual(fw(fa, T0 + 5000), [2, 4]));
  }
  {
    const fa = newFA();
    feed(fa, base); feed(fa, nxt(3001, 101)); // gap=2001 出局
    check('J2 gap=2001ms 不计：f0=2 wave=2（首两波臂对慢一拍的续单盲——设计内，簇臂仍管）', () =>
      assert.deepStrictEqual(fw(fa, T0 + 5000), [2, 2]));
  }
}

console.log('K. 纯 sell 块算「有交易块」且不跳过（第一个语义）');
{
  const fa = newFA();
  feed(fa, [
    { timestamp: T0 + 1000, block_number: 100, log_index: 1, sender_address: 'w1', trader_address: '0xe1', bnb_amount: 0.2 },
    { timestamp: T0 + 1500, block_number: 101, log_index: 2, trade_type: 'sell', sender_address: 'wS', trader_address: '0xeS', bnb_amount: 0.3 },
    { timestamp: T0 + 1800, block_number: 102, log_index: 3, sender_address: 'w2', trader_address: '0xe2', bnb_amount: 0.2 },
    { timestamp: T0 + 1800, block_number: 102, log_index: 4, sender_address: 'w3', trader_address: '0xe3', bnb_amount: 0.2 },
  ]);
  check('K1 首块后第一个活跃块=101（纯卖）：f0=1 wave=1（101 零首买 fNext=0；若纯卖不算活跃则 wave=3——反证锁死）', () => {
    const m = F(fa, T0 + 5000);
    assert.deepStrictEqual([m.launchFirstBlockWallets, m.launchFirstWaveWallets], [1, 1]);
  });
}

console.log('L. f0<2 形状键发真值（提纯归门串不归键）+ 首买跨块去重');
{
  const fa = newFA();
  feed(fa, [
    { timestamp: T0 + 1000, block_number: 100, log_index: 1, sender_address: 'w1', trader_address: '0xe1', bnb_amount: 0.2 },
    // w1 次块复买：首买 map 只记首块 → fNext 不重复计 w1
    { timestamp: T0 + 1500, block_number: 101, log_index: 2, sender_address: 'w1', trader_address: '0xe1', bnb_amount: 0.2 },
    { timestamp: T0 + 1500, block_number: 101, log_index: 3, sender_address: 'w2', trader_address: '0xe2', bnb_amount: 0.2 },
    { timestamp: T0 + 1500, block_number: 101, log_index: 4, sender_address: 'w3', trader_address: '0xe3', bnb_amount: 0.2 },
  ]);
  check('L1 f0=1（孤人首块）wave=3（次块新首买 w2/w3 两个，w1 复买不重计）——键照发真值，f0≥2 提纯由门串表达', () => {
    const m = F(fa, T0 + 5000);
    assert.deepStrictEqual([m.launchFirstBlockWallets, m.launchFirstWaveWallets], [1, 3]);
  });
}

console.log('M. defer 乱序收敛（首两波两键）');
{
  const rows = [
    mkTick({ timestamp: T0 + 1000, block_number: 347, log_index: 10, sender_address: 'wE1', trader_address: '0xeoaE1', bnb_amount: 0.25 }),
    mkTick({ timestamp: T0 + 1000, block_number: 347, log_index: 20, sender_address: 'wE2', trader_address: '0xeoaE2', bnb_amount: 0.25 }),
    mkTick({ timestamp: T0 + 2500, block_number: 348, log_index: 1, sender_address: 'wD1', trader_address: '0xeoaD1', bnb_amount: 0.5 }),
    mkTick({ timestamp: T0 + 4000, block_number: 360, log_index: 2, sender_address: 'wF1', trader_address: '0xeoaF1', bnb_amount: 0.3 }),
  ];
  const seq = newFA();
  feed(seq, rows.map(r => ({ ...r })));
  const expected = F(seq, T0 + 6000);
  const fa = newFA();
  for (const t of rows) fa.processTick(t, { deferWallet: true });
  fa.applyWalletTick(rows[2]); fa.applyWalletTick(rows[0]); fa.applyWalletTick(rows[3]); fa.applyWalletTick(rows[1]);
  const got = F(fa, T0 + 7000);
  check('M1 乱序回推 == 链序：f0=2 wave=3（348 gap=1500 计入，360 gap=3000 出局）', () => {
    assert.deepStrictEqual(
      [got.launchFirstBlockWallets, got.launchFirstWaveWallets],
      [expected.launchFirstBlockWallets, expected.launchFirstWaveWallets]);
    assert.deepStrictEqual([got.launchFirstBlockWallets, got.launchFirstWaveWallets], [2, 3]);
  });
}

console.log('N. 出窗冻结 + 触发行不入活跃块 map');
{
  const fa = newFA();
  feed(fa, [
    { timestamp: T0 + 1000, block_number: 100, log_index: 1, sender_address: 'w1', trader_address: '0xe1', bnb_amount: 0.2 },
    { timestamp: T0 + 1000, block_number: 100, log_index: 2, sender_address: 'w2', trader_address: '0xe2', bnb_amount: 0.2 },
    { timestamp: T0 + 1500, block_number: 101, log_index: 3, sender_address: 'w3', trader_address: '0xe3', bnb_amount: 0.2 },
  ]);
  const before = F(fa, T0 + 5000);
  // 触发出窗行（新块 200）+ 冻结后假晚到头 2s 行（defer 极晚回推）
  feed(fa, [{ timestamp: T0 + 100000, block_number: 200, sender_address: 'wX', trader_address: '0xeX', bnb_amount: 1 }]);
  const st = fa._states.get(ADDR);
  check('N1 触发出窗行不入活跃块 map（map 不含块 200）', () =>
    assert.ok(!st._launchBlkFirstTs.has(200), `map=${[...st._launchBlkFirstTs.keys()]}`));
  const fro = F(fa, T0 + 110000);
  feed(fa, [{ timestamp: T0 + 1600, block_number: 102, sender_address: 'w9', trader_address: '0xe9', bnb_amount: 0.2 }]);
  const after = F(fa, T0 + 120000);
  check('N2 冻结快照恒返回：f0=2 wave=3，窗关闭后晚到头 2s 行不改值', () => {
    assert.strictEqual(before.launchFirstWaveWallets, 3);
    assert.deepStrictEqual(
      [fro.launchFirstBlockWallets, fro.launchFirstWaveWallets],
      [after.launchFirstBlockWallets, after.launchFirstWaveWallets]);
  });
}

console.log('O. 首块锚缺失 / null wallet 行');
{
  const fa = newFA();
  feed(fa, [
    { timestamp: T0 + 1000, block_number: null, log_index: 1, sender_address: 'w1', trader_address: '0xe1', bnb_amount: 0.2 },
    { timestamp: T0 + 2000, block_number: null, log_index: 2, sender_address: 'w2', trader_address: '0xe2', bnb_amount: 0.2 },
  ]);
  const m = F(fa, T0 + 5000);
  check('O1 全窗 block null → firstBlockNumber null → 两键 0（fail-open 放行，与 cluster 空窗 0 同向）', () => {
    assert.deepStrictEqual([m.launchFirstBlockWallets, m.launchFirstWaveWallets], [0, 0]);
  });
  const fa2 = newFA();
  feed(fa2, [
    { timestamp: T0 + 1000, block_number: 100, log_index: 1, sender_address: null, trader_address: null, bnb_amount: 0.5 },
    { timestamp: T0 + 1500, block_number: 101, log_index: 2, sender_address: 'w2', trader_address: '0xe2', bnb_amount: 0.2 },
  ]);
  const m2 = F(fa2, T0 + 5000);
  check('O2 null wallet 行入活跃块 map 不入首买 → f0=0，但 w2 首买在活跃块 101 → wave=1（首块证据缺席、次块事实照计）', () => {
    assert.deepStrictEqual([m2.launchFirstBlockWallets, m2.launchFirstWaveWallets], [0, 1]);
  });
}

console.log('P. 源码口径反证（T141）');
{
  check('P1 LAUNCH_FIRST_WAVE_MS=2000 常量在场（X=2s 用户裁定形状）', () => {
    assert.ok(/const LAUNCH_FIRST_WAVE_MS = 2000;/.test(src), '常量缺失或值漂移');
  });
  check('P2 活跃块写点守卫=窗未关 ∧ blockNumber 非 null（触发行不入窗）', () => {
    const m = src.match(/if \(!state\._launchWindowClosed && blockNumber !== null\) \{\s*const _lt = state\._launchBlkFirstTs\.get\(blockNumber\);[\s\S]*?\n        \}/);
    assert.ok(m, '写点守卫段未找到');
  });
  check('P3 次活跃块判定=blk>首块 ∧ 块首时间差≤2000 ∧ 最小 blk（min 更新乱序收敛）', () => {
    assert.ok(/if \(blk <= fb \|\| ts - fbTs > LAUNCH_FIRST_WAVE_MS\) continue;/.test(src), '判定行缺失');
    assert.ok(/if \(nextBlk === null \|\| blk < nextBlk\) nextBlk = blk;/.test(src), '最小块选取行缺失');
  });
  check('P4 FactorBuilder 快照含两键', () => {
    const fbSrc = fs.readFileSync(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'), 'utf8');
    assert.ok(/launchFirstBlockWallets: factorResults\.launchFirstBlockWallets \?\? null/.test(fbSrc));
    assert.ok(/launchFirstWaveWallets: factorResults\.launchFirstWaveWallets \?\? null/.test(fbSrc));
  });
  check('P5 getFactorKeys 探针收两键', () => {
    const fa = newFA();
    const keys = fa.getFactorKeys();
    assert.ok(keys.has('launchFirstBlockWallets'));
    assert.ok(keys.has('launchFirstWaveWallets'));
  });
}

console.log('Q. v20 门串求值（提纯=门串组合表达）');
{
  const { ConditionEvaluator } = require(path.join(ROOT, 'src', 'strategies', 'ConditionEvaluator.js'));
  const { getAvailableFactorIds } = require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));
  const gate = '(launchBundleClusterSize < 3 AND (launchFirstBlockWallets < 2 OR launchFirstWaveWallets < 3)) OR tokenAgeSec > 60';
  const ev = new ConditionEvaluator();
  check('Q1 挡：f0≥2 ∧ wave≥3 ∧ cluster<3 ∧ age≤60（狙击小队先头+同波续单）', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 2, launchFirstBlockWallets: 2, launchFirstWaveWallets: 3, tokenAgeSec: 30 }), false));
  check('Q2 挡：簇臂独立命中（cluster≥3 ∧ age≤60，首两波无关）', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 4, launchFirstBlockWallets: 0, launchFirstWaveWallets: 0, tokenAgeSec: 30 }), false));
  check('Q3 放：f0=1 ∧ wave=3（孤人首块形状——f0≥2 提纯，误伤面全在此）', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 2, launchFirstBlockWallets: 1, launchFirstWaveWallets: 3, tokenAgeSec: 30 }), true));
  check('Q4 放：f0=2 ∧ wave=2（首块 2 人后无紧邻续单）', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 1, launchFirstBlockWallets: 2, launchFirstWaveWallets: 2, tokenAgeSec: 40 }), true));
  check('Q5 放：age>60（筹码已换手）', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 9, launchFirstBlockWallets: 4, launchFirstWaveWallets: 5, tokenAgeSec: 90 }), true));
  check('Q6 放：新票全 0（有证据零值非 null）', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 0, launchFirstBlockWallets: 0, launchFirstWaveWallets: 0, tokenAgeSec: 20 }), true));
  check('Q7 StrategyEngine 装载门串成功（新键进 FA 因子集）', () => {
    const { StrategyEngine } = require(path.join(ROOT, 'src', 'strategies', 'StrategyEngine.js'));
    const se = new StrategyEngine();
    se.loadStrategies([{
      id: 's1', name: 'wave-leg', action: 'buy', priority: 1,
      condition: `tradeCount >= 6 AND ${gate}`,
    }], getAvailableFactorIds());
    assert.strictEqual(se._strategies.length, 1);
  });
}

console.log('R. v22 门串求值（T145 双修：豁免臂换历史锚 launchMinVsFloorPct<0 + 首两波挡臂 OR 化）');
{
  const { ConditionEvaluator } = require(path.join(ROOT, 'src', 'strategies', 'ConditionEvaluator.js'));
  const gate = '(launchBundleClusterSize < 3 AND launchFirstBlockWallets < 2 AND launchFirstWaveWallets < 3) OR tokenAgeSec > 60 OR launchMinVsFloorPct < 0';
  const ev = new ConditionEvaluator();
  check('R1 ASTER 形状豁免放行：f0=2 ∧ wave=3 ∧ age≤60 ∧ 经历过破发（minVsFloor=−48.4）', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 2, launchFirstBlockWallets: 2, launchFirstWaveWallets: 3,
      tokenAgeSec: 22, launchMinVsFloorPct: -48.4 }), true));
  check('R2 同形状未经历过破发仍挡（minVsFloor=+18.98）', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 2, launchFirstBlockWallets: 2, launchFirstWaveWallets: 3,
      tokenAgeSec: 22, launchMinVsFloorPct: 18.98 }), false));
  check('R3 簇臂命中+经历过破发同豁免（clu≥3 ∧ minVsFloor<0——豁免臂对簇门部分同放）', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 4, launchFirstBlockWallets: 0, launchFirstWaveWallets: 0,
      tokenAgeSec: 30, launchMinVsFloorPct: -5 }), true));
  check('R4 簇臂命中+未破发仍挡', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 4, launchFirstBlockWallets: 0, launchFirstWaveWallets: 0,
      tokenAgeSec: 30, launchMinVsFloorPct: 21.8 }), false));
  check('R5 age>60 照放（原 60s 界语义不变）', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 9, launchFirstBlockWallets: 4, launchFirstWaveWallets: 5,
      tokenAgeSec: 90, launchMinVsFloorPct: 40 }), true));
  check('R6 minVsFloor null（未知平台/无可靠价）恒 false 不豁免=宁拦不冒充', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 4, launchFirstBlockWallets: 2, launchFirstWaveWallets: 3,
      tokenAgeSec: 30, launchMinVsFloorPct: null }), false));
  check('R7 边界 0 不豁免（严格 <0——首笔即最低从未破位不算「经历过破发」）', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 4, launchFirstBlockWallets: 0, launchFirstWaveWallets: 0,
      tokenAgeSec: 30, launchMinVsFloorPct: 0 }), false));
  check('R8 T145 实例 0x6e3a 形状被新挡（f0=1 ∧ wave=7 ∧ clu<3 ∧ age≤60 未破发——OR 臂放行形状收口）', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 1, launchFirstBlockWallets: 1, launchFirstWaveWallets: 7,
      tokenAgeSec: 23, launchMinVsFloorPct: 14.35 }), false));
  check('R9 f0=2 ∧ wave=2 被新挡（AND 化另一臂：首块 2 钱包无续单也拦）', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 2, launchFirstBlockWallets: 2, launchFirstWaveWallets: 2,
      tokenAgeSec: 34, launchMinVsFloorPct: 10 }), false));
  check('R10 XOR 差集形状+经历过破发 → 豁免放行（豁免臂对新挡臂同放）', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 1, launchFirstBlockWallets: 1, launchFirstWaveWallets: 7,
      tokenAgeSec: 23, launchMinVsFloorPct: -3 }), true));
}

console.log('S. launchConstVsPct 键（纯常量锚，刻意不吃 T130/T134 地板）');
{
  const CONST = 4496173469e-18;
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  fa.registerToken(ADDR, { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null, platform: 'fourmeme' });
  // ASTER 现场简化形状：开盘拉高 +31% → 砸穿 −24%（滚动最低）→ 买点反弹 −16.8%
  feed(fa, [
    { timestamp: T0 + 1000, block_number: 100, log_index: 0, sender_address: 'w1', trader_address: '0xe1', bnb_amount: 1.2, price_bnb: CONST * 1.313, price_usd: 5 },
    { timestamp: T0 + 21000, block_number: 220, log_index: 0, sender_address: 'w1', trader_address: '0xe1', trade_type: 'sell', bnb_amount: 0.63, price_bnb: CONST * 0.76, price_usd: 5 },
    { timestamp: T0 + 22000, block_number: 222, log_index: 0, sender_address: 'w2', trader_address: '0xe2', bnb_amount: 0.175, price_bnb: CONST * 0.832, price_usd: 5 },
  ]);
  const f = F(fa, T0 + 22000);
  check('S1 ASTER 形状：launchConstVsPct=−16.8（现价 vs 纯常量，破发可见）', () =>
    assert.strictEqual(f.launchConstVsPct, -16.8));
  check('S2 同刻 currentVsLaunchPct=+9.47（地板锚=滚动最低 0.76 常量——破发被反弹掩盖，两键分离）', () =>
    assert.strictEqual(f.currentVsLaunchPct, 9.47));
  const fa2 = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  fa2.registerToken(ADDR, { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null }); // 无 platform
  feed(fa2, [{ timestamp: T0 + 1000, block_number: 100, sender_address: 'w1', trader_address: '0xe1', bnb_amount: 1.2, price_bnb: CONST, price_usd: 5 }]);
  check('S3 未知平台无常量 → null（裸比较恒 false 不豁免）', () =>
    assert.strictEqual(F(fa2, T0 + 5000).launchConstVsPct, null));
  const fa3 = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  fa3.registerToken(ADDR, { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null, platform: 'fourmeme' });
  check('S4 未见任何可靠价 → null', () =>
    assert.strictEqual(F(fa3, T0 + 5000).launchConstVsPct, null));
  check('S5 源码锁：发射块不吃 _floorLaunchPriceBnb（纯常量直比）', () => {
    const m = src.match(/launchConstVsPct: \(\(\) => \{[\s\S]*?\}\)\(\),/);
    assert.ok(m, '发射块缺失');
    assert.ok(!/_floorLaunchPriceBnb/.test(m[0]), '豁免锚不得吃地板');
    assert.ok(/_resolveLaunchPriceBnb\(state\.platform, state\.quoteToken\)/.test(m[0]), '常量源行缺失');
  });
  check('S6 FactorBuilder 快照透传', () => {
    const fbSrc = fs.readFileSync(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'), 'utf8');
    assert.ok(/launchConstVsPct: factorResults\.launchConstVsPct \?\? null/.test(fbSrc));
  });
  check('S7 getFactorKeys 探针收键', () => {
    assert.ok(newFA().getFactorKeys().has('launchConstVsPct'));
  });
}

console.log('T. launchMinVsFloorPct 键（T145「经历过破发」历史锚：滚动最低 vs min(常量, 首买价)）');
{
  const CONST = 4496173469e-18;
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  fa.registerToken(ADDR, { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null, platform: 'fourmeme' });
  // ASTER 现场简化形状（同 S 段）：首买 1.313 常量（>常量 → floor=常量）→
  // 滚动最低 0.76 常量（sell 砸出）→ 买点反弹 0.832——历史锚不随反弹漂移
  feed(fa, [
    { timestamp: T0 + 1000, block_number: 100, log_index: 0, sender_address: 'w1', trader_address: '0xe1', bnb_amount: 1.2, price_bnb: CONST * 1.313, price_usd: 5 },
    { timestamp: T0 + 21000, block_number: 220, log_index: 0, sender_address: 'w1', trader_address: '0xe1', trade_type: 'sell', bnb_amount: 0.63, price_bnb: CONST * 0.76, price_usd: 5 },
    { timestamp: T0 + 22000, block_number: 222, log_index: 0, sender_address: 'w2', trader_address: '0xe2', bnb_amount: 0.175, price_bnb: CONST * 0.832, price_usd: 5 },
  ]);
  const f = F(fa, T0 + 22000);
  check('T1 ASTER 形状：launchMinVsFloorPct=−24（滚动最低 0.76 vs floor=常量——v21 现价口径 −16.8 反弹漂移被历史锚钉死）', () =>
    assert.strictEqual(f.launchMinVsFloorPct, -24));
  check('T2 同刻 launchConstVsPct=−16.8 vs minVsFloor=−24（两键分离：当下状态 vs 历史事实）', () =>
    assert.notStrictEqual(f.launchConstVsPct, f.launchMinVsFloorPct));
  // 低开票：首买 0.9 常量（<常量 → floor=首买价）未创新低 → 键=0 不豁免
  const faL = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  faL.registerToken(ADDR, { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null, platform: 'fourmeme' });
  feed(faL, [
    { timestamp: T0 + 1000, block_number: 100, log_index: 0, sender_address: 'w1', trader_address: '0xe1', bnb_amount: 0.2, price_bnb: CONST * 0.9, price_usd: 5 },
    { timestamp: T0 + 5000, block_number: 150, log_index: 0, sender_address: 'w2', trader_address: '0xe2', bnb_amount: 0.1, price_bnb: CONST * 0.95, price_usd: 5 },
  ]);
  check('T3 低开票首笔即最低未创新低 → 0（floor=首买价，minRel==floor 从未破位不豁免）', () =>
    assert.strictEqual(F(faL, T0 + 5000).launchMinVsFloorPct, 0));
  // 低开票盘中创新低 → 负值豁免
  const faL2 = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  faL2.registerToken(ADDR, { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null, platform: 'fourmeme' });
  feed(faL2, [
    { timestamp: T0 + 1000, block_number: 100, log_index: 0, sender_address: 'w1', trader_address: '0xe1', bnb_amount: 0.2, price_bnb: CONST * 0.9, price_usd: 5 },
    { timestamp: T0 + 5000, block_number: 150, log_index: 0, sender_address: 'w2', trader_address: '0xe2', trade_type: 'sell', bnb_amount: 0.1, price_bnb: CONST * 0.8, price_usd: 5 },
  ]);
  check('T4 低开票盘中创新低 → −11.11（floor=首买价 0.9，minRel=0.8——首买者被套离场）', () =>
    assert.strictEqual(F(faL2, T0 + 5000).launchMinVsFloorPct, -11.11));
  const faT5 = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  faT5.registerToken(ADDR, { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null }); // 无 platform
  feed(faT5, [{ timestamp: T0 + 1000, block_number: 100, log_index: 0, sender_address: 'w1', trader_address: '0xe1', bnb_amount: 1.2, price_bnb: CONST, price_usd: 5 }]);
  check('T5 未知平台 → null（宁拦不冒充）', () =>
    assert.strictEqual(F(faT5, T0 + 5000).launchMinVsFloorPct, null));
  const faT6 = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  faT6.registerToken(ADDR, { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null, platform: 'fourmeme' });
  check('T6 未见任何可靠价 → null', () =>
    assert.strictEqual(F(faT6, T0 + 5000).launchMinVsFloorPct, null));
  check('T7 源码锁：分母=首买价（T130 口径），不得含滚动最低（含则 ≤0 恒真废门）', () => {
    const m = src.match(/launchMinVsFloorPct: \(\(\) => \{[\s\S]*?\}\)\(\),/);
    assert.ok(m, '发射块缺失');
    assert.ok(/_floorLaunchPriceBnb\(\s*_resolveLaunchPriceBnb\(state\.platform, state\.quoteToken\),\s*state\._firstBuyPriceBnb,?\s*\)/.test(m[0]), '分母必须=常量×首买价地板');
    const assign = m[0].match(/const floor = _floorLaunchPriceBnb\([\s\S]*?\);/);
    assert.ok(assign, 'floor 赋值行缺失');
    assert.ok(!/state\._minRelPriceBnb/.test(assign[0]), '分母不得消费滚动最低');
    assert.ok(/state\._minRelPriceBnb \/ floor/.test(m[0]), '分子必须=滚动最低');
  });
  check('T8 FactorBuilder 快照透传', () => {
    const fbSrc = fs.readFileSync(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'), 'utf8');
    assert.ok(/launchMinVsFloorPct: factorResults\.launchMinVsFloorPct \?\? null/.test(fbSrc));
  });
  check('T9 getFactorKeys 探针收键', () => {
    assert.ok(newFA().getFactorKeys().has('launchMinVsFloorPct'));
  });
}

console.log('U. v24 门串求值（T149 二修：年龄放行臂=(tokenAgeSec>60 AND sinceFirstTradeSec>45) 双门 AND——v23 误整臂替换已纠正）');
{
  const { ConditionEvaluator } = require(path.join(ROOT, 'src', 'strategies', 'ConditionEvaluator.js'));
  const gate = '(launchBundleClusterSize < 3 AND launchFirstBlockWallets < 2 AND launchFirstWaveWallets < 3) OR (tokenAgeSec > 60 AND sinceFirstTradeSec > 45) OR launchMinVsFloorPct < 0';
  const ev = new ConditionEvaluator();
  check('U1 事故反证（bt-v135 0x3441cc2a 案）：创建后 50s 才开交易、首两波满员、tokenAgeSec=72>60 过旧门但 sinceFirstTradeSec=22<45 → 双门 AND 拦', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 2, launchFirstBlockWallets: 2, launchFirstWaveWallets: 3,
      tokenAgeSec: 72, sinceFirstTradeSec: 22, launchMinVsFloorPct: 5 }), false));
  check('U2 原门独立拦截面保留：tokenAgeSec=22<60（早开盘首两波满员）即使 sinceFirstTrade=22 也无老化——两门全 false 拦（v22 语义不变）', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 2, launchFirstBlockWallets: 2, launchFirstWaveWallets: 3,
      tokenAgeSec: 22, sinceFirstTradeSec: 22, launchMinVsFloorPct: 5 }), false));
  check('U3 反向缺口（v23 误换锚引入的真实回归面）：正常即开交易票 age=50（sinceFirstTrade=50>45 过新门）但 <60 旧门未过 → 仍拦（v23 单门会提前 10s 放行；物理约束 sinceFirstTrade ≤ tokenAgeSec）', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 2, launchFirstBlockWallets: 2, launchFirstWaveWallets: 3,
      tokenAgeSec: 50, sinceFirstTradeSec: 50, launchMinVsFloorPct: 5 }), false));
  check('U4 双门同过才放：tokenAgeSec=105 ∧ sinceFirstTrade=55（晚开交易票，放行时刻=max(创建+60, 首买+45)）', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 9, launchFirstBlockWallets: 4, launchFirstWaveWallets: 5,
      tokenAgeSec: 105, sinceFirstTradeSec: 55, launchMinVsFloorPct: 40 }), true));
  check('U5 未见首买 null 恒 false=宁拦不冒充（晚开交易票在首买前一律拦）', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 3, launchFirstBlockWallets: 2, launchFirstWaveWallets: 3,
      tokenAgeSec: 300, sinceFirstTradeSec: null, launchMinVsFloorPct: 40 }), false));
  check('U6 经历过破发豁免臂对双门同放（minVsFloor<0 → 放行）', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 2, launchFirstBlockWallets: 2, launchFirstWaveWallets: 3,
      tokenAgeSec: 72, sinceFirstTradeSec: 22, launchMinVsFloorPct: -38.4 }), true));
  check('U7 deploy 脚本门串与本段逐字一致（防漂移）', () => {
    const deploySrc = fs.readFileSync(path.join(ROOT, 'scripts', 'deploy-signal-source-strategies.cjs'), 'utf8');
    const m = deploySrc.match(/const CLUSTER_GATE = '((?:[^'\\]|\\.)*)'/);
    assert.ok(m, 'CLUSTER_GATE 常量缺失');
    const deployGate = m[1].replace(/^ AND \(/, '').replace(/\)$/, '');
    assert.strictEqual(deployGate, gate);
  });
}

console.log(`\n结果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
