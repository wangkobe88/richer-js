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
 *   Y. T177 同块卖出簇键 + ≥10 捆绑绝对 veto（0x6510…7777 案）
 *   Z. T178 两波捆绑买入波数两键（launchBuyBundleWaves/DominancePct，raw 含复购波
 *      ——G3 首买簇键结构性看不见的形状）+ ladder v31 G4 绝对 veto（0xa025…7777 案）
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
  const t = Object.assign({
    token_address: ADDR, trade_type: 'buy', trader_address: null, sender_address: null,
    price_bnb: 0.00001, price_usd: 5, bnb_amount: 1, token_amount: null,
    block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: 0,
  }, over);
  // T162：买入额尘线（holderDustBnb=0.015 BNB）参与 f0/wave/clu 计数；token_amount
  // 仍按 bnb/price 真实化（holders 族/等额簇键照用真实持仓量纲）
  if (t.token_amount == null) t.token_amount = t.bnb_amount / t.price_bnb;
  return t;
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
  check('E2 尘埃行仍进同块分母（T150：分母照计全量买入；尘埃钱包已不入簇计数——此处各块 size=1 同形，best=0.3705 块 → share=0.3705/(0.015+0.741)=49）', () => {
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
      'launchEqualClusterWallets', 'launchEqualClusterBnb', 'launchBigBuyBnb']) {
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
  check('I1 f0=4（首块 347 首买 wA1-wA4）wave=8（T150 波窗扩 2s 全部块：348/349 gap=1000 + 350 gap=2000 恰界全计——wD1+wD2+wD3+wD4 四个）', () => {
    assert.deepStrictEqual(fw(f), { f0: 4, wave: 8 });
  });
  feed(fa, AGENTUM.slice(10)); // 簇 B 第三笔 + 后续
  feed(fa, [{ timestamp: T0 + 100000, block_number: 600, sender_address: 'wX', trader_address: '0xeoaX', bnb_amount: 5.0 }]);
  const fro = F(fa, T0 + 105000);
  check('I2 出窗冻结后两键恒定（T150 语义：wave=8=4+348/349/350 三块全部首买）', () => {
    assert.deepStrictEqual(fw(fro), { f0: 4, wave: 8 });
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

console.log('K. 纯 sell 块算「有交易块」且不跳过（T150 波窗全块语义）');
{
  const fa = newFA();
  feed(fa, [
    { timestamp: T0 + 1000, block_number: 100, log_index: 1, sender_address: 'w1', trader_address: '0xe1', bnb_amount: 0.2 },
    { timestamp: T0 + 1500, block_number: 101, log_index: 2, trade_type: 'sell', sender_address: 'wS', trader_address: '0xeS', bnb_amount: 0.3 },
    { timestamp: T0 + 1800, block_number: 102, log_index: 3, sender_address: 'w2', trader_address: '0xe2', bnb_amount: 0.2 },
    { timestamp: T0 + 1800, block_number: 102, log_index: 4, sender_address: 'w3', trader_address: '0xe3', bnb_amount: 0.2 },
  ]);
  check('K1 首块后 2s 内全部块计入（101 纯卖块零首买+102 两首买）：f0=1 wave=3（T141 旧「只数第一个块」=wave 1 已被 T150 波窗全块立法替换）', () => {
    const m = F(fa, T0 + 5000);
    assert.deepStrictEqual([m.launchFirstBlockWallets, m.launchFirstWaveWallets], [1, 3]);
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
  check('P3 波窗判定=blk>首块 ∧ 块首时间差≤2000 **全部块**入集（T150 替换旧「最小 blk 单块」实现）∧ T162 买入额过滤在计数前（源码锁：_launchWalletBuys 累计 ≥ holderDustBnb，禁 _walletNetTokens 净持仓口径回流）', () => {
    assert.ok(/if \(blk > fb && ts - fbTs <= LAUNCH_FIRST_WAVE_MS\) waveBlks\.add\(blk\);/.test(src), '波窗判定行缺失');
    assert.ok(/for \(const e of sized\) if \(waveBlks\.has\(e\.blk\)\) fNext\+\+;/.test(src), '买入额过滤计数行缺失');
    const seg = src.match(/const buyDust = this\._fp\.holderDustBnb \|\| 0;[\s\S]*?\n\s*: rows;/);
    assert.ok(seg, '买入额过滤段缺失');
    assert.ok(/_launchWalletBuys\.get\(e\.w\)/.test(seg[0]), '判据不是 _launchWalletBuys 累计口径');
    assert.ok(!/_walletNetTokens/.test(seg[0]), '净持仓口径回流（T162 已否证）');
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
  const gate = '(launchBundleClusterSize < 3 AND launchFirstBlockWallets < 2 AND launchFirstWaveWallets < 3) OR (tokenAgeSec > 60 AND sinceFirstTradeSec > 45) OR launchMinVsFloorPct < -10';
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
  check('U6 深破发豁免臂对双门同放（minVsFloor=-38.4 < -10 → 放行；v29 起线 <0→<-10，ASTER 形状保持豁免）', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 2, launchFirstBlockWallets: 2, launchFirstWaveWallets: 3,
      tokenAgeSec: 72, sinceFirstTradeSec: 22, launchMinVsFloorPct: -38.4 }), true));
  check('U6b 浅回落不再豁免（Ardot 0x683165bf…7777 案反证：minVsFloor=-0.96 为大额首买抬高锚的噪声非真破发——旧 <0 线误豁免，v29 −10 线起三臂全 false 拦）', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 2, launchFirstBlockWallets: 2, launchFirstWaveWallets: 2,
      tokenAgeSec: 21, sinceFirstTradeSec: 21, launchMinVsFloorPct: -0.96 }), false));
  check('U6c 驴来案（0x531ddef1…7777 案 3：−8.75 落 −5~−10 带不豁免——G1 clu=3 接住，22s fire 拦；首裁 −5 线被豁免放行引出用户深化 −10）', () =>
    assert.strictEqual(ev.evaluate(gate, {
      launchBundleClusterSize: 3, launchFirstBlockWallets: 1, launchFirstWaveWallets: 1,
      tokenAgeSec: 22, sinceFirstTradeSec: 22, launchMinVsFloorPct: -8.75 }), false));
  check('U7 deploy 脚本门串与本段逐字一致（防漂移）', () => {
    const deploySrc = fs.readFileSync(path.join(ROOT, 'scripts', 'deploy-signal-source-strategies.cjs'), 'utf8');
    const m = deploySrc.match(/const CLUSTER_GATE = '((?:[^'\\]|\\.)*)'/);
    assert.ok(m, 'CLUSTER_GATE 常量缺失');
    const deployGate = m[1].replace(/^ AND \(/, '').replace(/\)$/, '');
    assert.strictEqual(deployGate, gate);
  });
}

console.log('V. T162 买入额过滤修正（2026-11-17 用户修正 T150：「小额持仓」应为「小额买入」；净持仓口径否证——清仓=抛压已砸、盘面已坏，仍需冷却不回落）');
{
  const gateOf = (m) => (m.launchBundleClusterSize < 3 && m.launchFirstBlockWallets < 2 && m.launchFirstWaveWallets < 3);
  // V1 0x6e3a/0x1dc9 形状：组织小队三块齐进（1+2+3）后全清仓 → 买入额过滤不随卖出回落 → 仍挡（冷却）
  {
    const fa = newFA();
    const buys = [
      { timestamp: T0 + 1000, block_number: 100, log_index: 1, sender_address: 'wL', trader_address: '0xeL', bnb_amount: 0.101 },
      { timestamp: T0 + 2000, block_number: 101, log_index: 1, sender_address: 'wA', trader_address: '0xeA', bnb_amount: 0.05 },
      { timestamp: T0 + 2000, block_number: 101, log_index: 2, sender_address: 'wB', trader_address: '0xeB', bnb_amount: 0.009 },
      { timestamp: T0 + 3000, block_number: 102, log_index: 1, sender_address: 'wX', trader_address: '0xeX', bnb_amount: 0.0385 },
      { timestamp: T0 + 3000, block_number: 102, log_index: 2, sender_address: 'wY', trader_address: '0xeY', bnb_amount: 0.0385 },
      { timestamp: T0 + 3000, block_number: 102, log_index: 3, sender_address: 'wZ', trader_address: '0xeZ', bnb_amount: 0.0385 },
    ];
    feed(fa, buys);
    const before = F(fa, T0 + 6000);
    check('V1a 清仓前：f0=1 wave=5（2s 全块 101/102 全计，wB 0.009<0.015 尘买剔除——「前期小额买入不计」在清仓前已生效）clu=3 → 门挡', () => {
      assert.deepStrictEqual([before.launchFirstBlockWallets, before.launchFirstWaveWallets, before.launchBundleClusterSize], [1, 5, 3]);
      assert.strictEqual(gateOf(before), false);
    });
    // 全员清仓（原额卖出）——T162 修正核心断言：计数不回落（0x1dc9 案现场反证）
    for (const b of buys) {
      feed(fa, [{ timestamp: T0 + 15000, block_number: 500, log_index: 1, trade_type: 'sell', sender_address: b.sender_address, trader_address: b.trader_address, bnb_amount: b.bnb_amount }]);
    }
    const after = F(fa, T0 + 20000);
    check('V1b 全清仓后（T162）：f0/wave/clu 逐位不变=1/5/3 → 门仍挡（清仓=抛压已砸给接盘方、盘面已坏，需冷却非放行）', () => {
      assert.deepStrictEqual([after.launchFirstBlockWallets, after.launchFirstWaveWallets, after.launchBundleClusterSize], [1, 5, 3]);
      assert.strictEqual(gateOf(after), false);
    });
    check('V1c 等额簇键不滤尘（0.0385×3 出货后金额指纹仍在）', () => {
      assert.strictEqual(after.launchEqualClusterWallets, 3);
    });
  }
  // V2 虚拟猫咪形状：同结构持有 → 计数保持 → 门仍挡
  {
    const fa = newFA();
    feed(fa, [
      { timestamp: T0 + 1000, block_number: 100, log_index: 1, sender_address: 'wL', trader_address: '0xeL', bnb_amount: 0.101 },
      { timestamp: T0 + 2000, block_number: 101, log_index: 1, sender_address: 'wA', trader_address: '0xeA', bnb_amount: 0.05 },
      { timestamp: T0 + 2000, block_number: 101, log_index: 2, sender_address: 'wB', trader_address: '0xeB', bnb_amount: 0.009 },
      { timestamp: T0 + 3000, block_number: 102, log_index: 1, sender_address: 'wX', trader_address: '0xeX', bnb_amount: 0.0385 },
      { timestamp: T0 + 3000, block_number: 102, log_index: 2, sender_address: 'wY', trader_address: '0xeY', bnb_amount: 0.0385 },
      { timestamp: T0 + 3000, block_number: 102, log_index: 3, sender_address: 'wZ', trader_address: '0xeZ', bnb_amount: 0.0385 },
    ]);
    const m = F(fa, T0 + 20000);
    check('V2 大额买入保持：wave=5/clu=3 → 门仍挡', () => {
      assert.strictEqual(gateOf(m), false);
    });
  }
  // V3 BINANCE 形状（T150 原立法动机票）：wQ 尘买剔除，wS 已清仓**照计** → wave=3 达线 → 门挡（T162 知情代价：用户裁定清仓=盘已坏仍需冷却）
  {
    const fa = newFA();
    feed(fa, [
      { timestamp: T0 + 1000, block_number: 100, log_index: 1, sender_address: 'wP', trader_address: '0xeP', bnb_amount: 0.066 },
      { timestamp: T0 + 1000, block_number: 100, log_index: 2, sender_address: 'wQ', trader_address: '0xeQ', bnb_amount: 0.010 }, // 尘买（0.010B<0.015 尘线）
      { timestamp: T0 + 1600, block_number: 101, log_index: 1, sender_address: 'wR', trader_address: '0xeR', bnb_amount: 0.020 },
      { timestamp: T0 + 1600, block_number: 101, log_index: 2, sender_address: 'wS', trader_address: '0xeS', bnb_amount: 0.049 },
    ]);
    feed(fa, [{ timestamp: T0 + 3000, block_number: 102, log_index: 1, trade_type: 'sell', sender_address: 'wS', trader_address: '0xeS', bnb_amount: 0.049 }]); // wS 清仓
    const m = F(fa, T0 + 10000);
    check('V3 BINANCE 修正后回挡：wQ 尘买出列、wS 清仓照计 → f0=1（wP）wave=3（+wR+wS）clu=2 → 门挡（T150 救回语义随净持仓口径一并否证）', () => {
      assert.deepStrictEqual([m.launchFirstBlockWallets, m.launchFirstWaveWallets, m.launchBundleClusterSize], [1, 3, 2]);
      assert.strictEqual(gateOf(m), false);
    });
  }
  // V4 clu 鲸单劫持修复（0x6e3a 案 0.594 鲸买 vs 0.0385×3 簇）
  {
    const fa = newFA();
    feed(fa, [
      { timestamp: T0 + 1000, block_number: 100, log_index: 1, sender_address: 'wX', trader_address: '0xeX', bnb_amount: 0.0385 },
      { timestamp: T0 + 1000, block_number: 100, log_index: 2, sender_address: 'wY', trader_address: '0xeY', bnb_amount: 0.0385 },
      { timestamp: T0 + 1000, block_number: 100, log_index: 3, sender_address: 'wZ', trader_address: '0xeZ', bnb_amount: 0.0385 },
      { timestamp: T0 + 5000, block_number: 105, log_index: 1, sender_address: 'wW', trader_address: '0xeW', bnb_amount: 0.594 },
    ]);
    const m = F(fa, T0 + 10000);
    check('V4 簇选优钱包数优先：size=3（旧 BNB 选优=鲸单 n=1 退化）', () => {
      assert.strictEqual(m.launchBundleClusterSize, 3);
    });
  }
  // V5 无可靠价独立性（price_bnb=0）：T162 过滤在 BNB 域直接可比——尘买 wA 剔除、已清仓 wB 照计（T150 净持仓口径需 _holderDustTokens 价格换算在此退化）
  {
    const fa = newFA();
    feed(fa, [
      { timestamp: T0 + 1000, block_number: 100, log_index: 1, sender_address: 'wA', trader_address: '0xeA', bnb_amount: 0.005, price_bnb: 0, token_amount: 500 }, // 尘买（<0.015）
      { timestamp: T0 + 1000, block_number: 100, log_index: 2, sender_address: 'wB', trader_address: '0xeB', bnb_amount: 0.02, price_bnb: 0, token_amount: 2000 },
    ]);
    feed(fa, [{ timestamp: T0 + 3000, block_number: 101, log_index: 1, trade_type: 'sell', sender_address: 'wB', trader_address: '0xeB', bnb_amount: 0.02, price_bnb: 0, token_amount: 2000 }]); // wB 清仓
    const m = F(fa, T0 + 10000);
    check('V5 无可靠价不退化：wA 尘买剔除、wB 清仓照计 f0=1（BNB 域过滤无价格依赖）', () => {
      assert.strictEqual(m.launchFirstBlockWallets, 1);
    });
  }
  // V6 清仓不回落（T162 核心语义：冻结前每次读取现算，卖出不影响计数）
  {
    const fa = newFA();
    feed(fa, [
      { timestamp: T0 + 1000, block_number: 100, log_index: 1, sender_address: 'wA', trader_address: '0xeA', bnb_amount: 0.05 },
      { timestamp: T0 + 1000, block_number: 100, log_index: 2, sender_address: 'wB', trader_address: '0xeB', bnb_amount: 0.05 },
    ]);
    const t1 = F(fa, T0 + 5000);
    feed(fa, [{ timestamp: T0 + 8000, block_number: 103, log_index: 1, trade_type: 'sell', sender_address: 'wB', trader_address: '0xeB', bnb_amount: 0.05 }]);
    const t2 = F(fa, T0 + 10000);
    check('V6 小队半数清仓：f0=2 → 2 不回落（卖出不改变计数=冷却语义，T150 回落语义否证）', () => {
      assert.strictEqual(t1.launchFirstBlockWallets, 2);
      assert.strictEqual(t2.launchFirstBlockWallets, 2);
    });
  }
}

console.log('W. T151 launchBigBuyBnb（前期买入太多载体）+ 推迟门（v34/T201 迁 FP32 臂）');
{
  const fa = newFA();
  feed(fa, [
    { timestamp: T0 + 1000, block_number: 100, log_index: 1, sender_address: 'wA', trader_address: '0xeA', bnb_amount: 0.6 },
    { timestamp: T0 + 1000, block_number: 100, log_index: 2, sender_address: 'wB', trader_address: '0xeB', bnb_amount: 0.5 },
    { timestamp: T0 + 2000, block_number: 101, log_index: 1, sender_address: 'wC', trader_address: '0xeC', bnb_amount: 0.05 }, // 尘额不计
    { timestamp: T0 + 3000, block_number: 102, log_index: 1, sender_address: 'wD', trader_address: '0xeD', bnb_amount: 0.3 },
  ]);
  const m = F(fa, T0 + 5000);
  check('W1 launchBigBuyBnb=大户(累计≥0.2B)合计 0.6+0.5+0.3=1.4（0.05 尘不计）', () =>
    assert.strictEqual(m.launchBigBuyBnb, 1.4));
  // 分单小队：0.15+0.15 累计 0.3 过线（首买 only 口径漏——T151 累计口径核心差异）
  const fa2 = newFA();
  feed(fa2, [
    { timestamp: T0 + 1000, block_number: 100, log_index: 1, sender_address: 'wS1', trader_address: '0xeS1', bnb_amount: 0.15 },
    { timestamp: T0 + 2000, block_number: 101, log_index: 1, sender_address: 'wS1', trader_address: '0xeS1', bnb_amount: 0.15 },
    { timestamp: T0 + 3000, block_number: 102, log_index: 1, sender_address: 'wS2', trader_address: '0xeS2', bnb_amount: 0.4 },
  ]);
  check('W1b 分单小队 0.15+0.15=0.3 计入（累计口径）→ 0.3+0.4=0.7', () =>
    assert.strictEqual(F(fa2, T0 + 5000).launchBigBuyBnb, 0.7));
  // T169 大户线 0.2→0.19（0.19~0.2 视同 0.2 级，BP19 同惯例；案源 0x6fc2…7777
  // 边界钱包 0.1973 在 0.2 线下漏计致合计 0.86<1 推迟门放行、0.19 口径 1.06≥1 推迟）
  const fa3 = newFA();
  feed(fa3, [
    { timestamp: T0 + 1000, block_number: 100, log_index: 1, sender_address: 'wB1', trader_address: '0xeB1', bnb_amount: 0.5911 },
    { timestamp: T0 + 3000, block_number: 102, log_index: 1, sender_address: 'wB2', trader_address: '0xeB2', bnb_amount: 0.1973 },
    { timestamp: T0 + 4000, block_number: 103, log_index: 1, sender_address: 'wB3', trader_address: '0xeB3', bnb_amount: 0.1899 },
  ]);
  check('W1c 大户线 0.19：0.1973 计入（视同 0.2 级）、0.1899 门外 → 0.5911+0.1973=0.7884', () =>
    assert.strictEqual(F(fa3, T0 + 5000).launchBigBuyBnb, 0.7884));
  // 推迟门求值：heavy(<60s 挡/60s 后放) vs mid(0.79 档 45s) vs light
  // v34/T201 迁移：门串自 ladder 条件串整段撤出，判定语义迁 FP32 armBigBuyDefer
  // （返回 true=推迟拦；旧门串 evaluate true=放行——方向翻转，案例矩阵逐条对拍）
  const { armBigBuyDefer } = require(path.join(ROOT, 'src', 'market-analysis', 'factor-pre-buy-check.js'));
  const mkLd = (bigBuyBnb, sinceFirstTradeSec, minVsFloorPct = null) =>
    ({ launchDefer: { bigBuyBnb, sinceFirstTradeSec, minVsFloorPct } });
  check('W2 heavy@+30s → 挡（1.4≥1 ∧ 30≤60）', () =>
    assert.strictEqual(armBigBuyDefer(mkLd(1.4, 30)), true));
  check('W3 heavy@+61s → 放（抛压释放窗）', () =>
    assert.strictEqual(armBigBuyDefer(mkLd(1.4, 61)), false));
  check('W4 mid@+20s → 挡（v29/T173 0.79 档：0.9∈[0.79,1) ∧ 20≤45——旧门串 0.9<1 放行）', () =>
    assert.strictEqual(armBigBuyDefer(mkLd(0.9, 20)), true));
  check('W4b mid@+46s → 放（45s 档释放）', () =>
    assert.strictEqual(armBigBuyDefer(mkLd(0.9, 46)), false));
  check('W4c light@+20s → 放（0.78<0.79 线下无推迟）', () =>
    assert.strictEqual(armBigBuyDefer(mkLd(0.78, 20)), false));
  check('W4d 驴党案反证（0xf37fe6de…7777：bigBuy=0.7934 贴线视同 0.8 级 T169 惯例 ∧ 36s fire → 拦）', () =>
    assert.strictEqual(armBigBuyDefer(mkLd(0.7934, 36)), true));
  check('W4e Ardot 案反证（T172 合并后 bigBuy=1.1177 ≥1 ∧ 21s ∧ 浅破发 -0.96 不豁免 → 拦；旧门串豁免臂 <0 放行）', () =>
    assert.strictEqual(armBigBuyDefer(mkLd(1.1177, 21, -0.96)), true));
  check('W4f 油宝案反证（−6.3 落 −5~−10 带 v29 不豁免——T172 合并 bigBuy 1.1644≥1 ∧ 20s → 拦；首裁 −5 线曾豁免放行引出深化 −10）', () =>
    assert.strictEqual(armBigBuyDefer(mkLd(1.1644, 20, -6.3)), true));
  check('W4f2 深破发豁免同享两档（−11 < −10 → mid 档照豁免放行；ASTER 类形状）', () =>
    assert.strictEqual(armBigBuyDefer(mkLd(0.9, 20, -11)), false));
  check('W4g 豁免边界 -10（-9.9 不豁免拦 / -10.1 豁免放）', () => {
    assert.strictEqual(armBigBuyDefer(mkLd(1.4, 30, -9.9)), true);
    assert.strictEqual(armBigBuyDefer(mkLd(1.4, 30, -10.1)), false);
  });
  check('W4h 键缺席不评=放行（launchDefer null/键 null——截窗未覆盖出生段=老票 sFT>60 域语义等价，T180 同约定）', () => {
    assert.strictEqual(armBigBuyDefer({ launchDefer: null }), false);
    assert.strictEqual(armBigBuyDefer({}), false);
    assert.strictEqual(armBigBuyDefer(null), false);
    assert.strictEqual(armBigBuyDefer({ launchDefer: { bigBuyBnb: 1.4, sinceFirstTradeSec: null } }), false);
    assert.strictEqual(armBigBuyDefer({ launchDefer: { bigBuyBnb: 1.4, sinceFirstTradeSec: 30, minVsFloorPct: null } }), true, 'floor null=豁免证据缺席照拦（FA null 语义同向）');
  });
  check('W5 v34/T201 迁出锁：deploy 无 DELAY_GATE 残留；FP32 臂在位；条件串不再引用 launchBigBuyBnb', () => {
    const deploySrc = fs.readFileSync(path.join(ROOT, 'scripts', 'deploy-signal-source-strategies.cjs'), 'utf8');
    assert.ok(!deploySrc.includes('DELAY_GATE'), 'DELAY_GATE 残留——迁移未完成（T180/WAVE_DOM_VETO_GATE 同款删净）');
    assert.ok(!/"condition":[^"]*launchBigBuyBnb/.test(deploySrc), '条件串仍引用 launchBigBuyBnb');
    const fpSrc = fs.readFileSync(path.join(ROOT, 'src', 'market-analysis', 'factor-pre-buy-check.js'), 'utf8');
    assert.ok(fpSrc.includes("arms.push('big_buy_defer')"), 'FP32 big_buy_defer 臂不在位');
    assert.ok(fpSrc.includes('armBigBuyDefer'), '臂函数缺失');
  });
}

// ═══════════════ X. T172 同块等额首买=单用户（2026-11-18 bt-v143 案 0x683165bf…7777：
//     blk 两钱包 0.13582946/0.13580056 四位归一同为 0.1358，单钱包均在 0.19 线下漏计
//     → bigBuy 0.846<1 推迟门放行 21s 买入 40s 断流止损；合并 0.2716 过线 → 1.1177≥1）═══
console.log('X. T172 同块等额首买=单用户（launchBigBuyBnb 合并口径）');
{
  // X1 案源现场形状（事故现场反证）：三笔大户 0.8460 + 等额对（同块第五块）
  const fa = newFA();
  feed(fa, [
    { timestamp: T0 + 1000,  block_number: 211, log_index: 1, sender_address: 'wF1', trader_address: '0xeF1', bnb_amount: 0.40082013 },
    { timestamp: T0 + 1000,  block_number: 211, log_index: 2, sender_address: 'wF2', trader_address: '0xeF2', bnb_amount: 0.24697901 },
    { timestamp: T0 + 12000, block_number: 227, log_index: 1, sender_address: 'wF3', trader_address: '0xeF3', bnb_amount: 0.00991243 }, // 尘
    { timestamp: T0 + 15000, block_number: 236, log_index: 1, sender_address: 'wF4', trader_address: '0xeF4', bnb_amount: 0.19822347 },
    { timestamp: T0 + 18000, block_number: 251, log_index: 1, sender_address: 'wF5', trader_address: '0xeF5', bnb_amount: 0.13582946 },
    { timestamp: T0 + 18000, block_number: 251, log_index: 2, sender_address: 'wF6', trader_address: '0xeF6', bnb_amount: 0.13580056 },
  ]);
  check('X1 案源形状：等额对合并 0.2716 过 0.19 线 → bigBuy=0.846+0.2716=1.1177（旧口径 0.846 漏计）', () =>
    assert.strictEqual(F(fa, T0 + 21000).launchBigBuyBnb, 1.1177));
  // X2 非同块等额不合并：同额不同块=两独立散户巧合
  const fa2 = newFA();
  feed(fa2, [
    { timestamp: T0 + 1000, block_number: 100, log_index: 1, sender_address: 'wG1', trader_address: '0xeG1', bnb_amount: 0.13582946 },
    { timestamp: T0 + 9000, block_number: 150, log_index: 1, sender_address: 'wG2', trader_address: '0xeG2', bnb_amount: 0.13580056 },
    { timestamp: T0 + 9000, block_number: 150, log_index: 2, sender_address: 'wG3', trader_address: '0xeG3', bnb_amount: 0.4 },
  ]);
  check('X2 非同块等额不合并：0.1358×2 各自线下不计 → bigBuy=0.4', () =>
    assert.strictEqual(F(fa2, T0 + 12000).launchBigBuyBnb, 0.4));
  // X3 同块不等额不合并（案源首块形状 0.4008/0.2470）：各自 ≥0.19 各计各的
  const fa3 = newFA();
  feed(fa3, [
    { timestamp: T0 + 1000, block_number: 100, log_index: 1, sender_address: 'wH1', trader_address: '0xeH1', bnb_amount: 0.40082013 },
    { timestamp: T0 + 1000, block_number: 100, log_index: 2, sender_address: 'wH2', trader_address: '0xeH2', bnb_amount: 0.24697901 },
  ]);
  check('X3 同块不等额不合并：0.4008+0.2470=0.6478（与旧口径一致）', () =>
    assert.strictEqual(F(fa3, T0 + 5000).launchBigBuyBnb, 0.6478));
  // X4 组内单钱包本身 ≥0.19：合并计一次不重复（0.25+0.25 同块等额 → 0.5 非 1.0）
  const fa4 = newFA();
  feed(fa4, [
    { timestamp: T0 + 1000, block_number: 100, log_index: 1, sender_address: 'wI1', trader_address: '0xeI1', bnb_amount: 0.25 },
    { timestamp: T0 + 1000, block_number: 100, log_index: 2, sender_address: 'wI2', trader_address: '0xeI2', bnb_amount: 0.25 },
  ]);
  check('X4 组钱包不重复计：合并 0.5 恰一次（单独计 0.25+0.25 同值、防四倍形状）', () =>
    assert.strictEqual(F(fa4, T0 + 5000).launchBigBuyBnb, 0.5));
  // X5 等额尘门（earlyUniformDustBnb=0.001）：尘埃等额对不构成分仓指纹
  const fa5 = newFA();
  feed(fa5, [
    { timestamp: T0 + 1000, block_number: 100, log_index: 1, sender_address: 'wJ1', trader_address: '0xeJ1', bnb_amount: 0.0005 },
    { timestamp: T0 + 1000, block_number: 100, log_index: 2, sender_address: 'wJ2', trader_address: '0xeJ2', bnb_amount: 0.0005 },
    { timestamp: T0 + 2000, block_number: 101, log_index: 1, sender_address: 'wJ3', trader_address: '0xeJ3', bnb_amount: 0.3 },
  ]);
  check('X5 尘门下等额不参与：0.0005×2 不合并 → bigBuy=0.3', () =>
    assert.strictEqual(F(fa5, T0 + 5000).launchBigBuyBnb, 0.3));
  // X6 组合并不足 0.19：合并后仍在线下不计
  const fa6 = newFA();
  feed(fa6, [
    { timestamp: T0 + 1000, block_number: 100, log_index: 1, sender_address: 'wK1', trader_address: '0xeK1', bnb_amount: 0.01 },
    { timestamp: T0 + 1000, block_number: 100, log_index: 2, sender_address: 'wK2', trader_address: '0xeK2', bnb_amount: 0.01 },
    { timestamp: T0 + 2000, block_number: 101, log_index: 1, sender_address: 'wK3', trader_address: '0xeK3', bnb_amount: 0.2 },
  ]);
  check('X6 合并 0.02 仍 <0.19 不计 → bigBuy=0.2', () =>
    assert.strictEqual(F(fa6, T0 + 5000).launchBigBuyBnb, 0.2));
  // X7 组指纹=首买行、金额=累计（T151 分单不漏保留）：等额对首买后同钱包续单累计入组
  const fa7 = newFA();
  feed(fa7, [
    { timestamp: T0 + 1000, block_number: 100, log_index: 1, sender_address: 'wL1', trader_address: '0xeL1', bnb_amount: 0.1 },
    { timestamp: T0 + 1000, block_number: 100, log_index: 2, sender_address: 'wL2', trader_address: '0xeL2', bnb_amount: 0.1 },
    { timestamp: T0 + 5000, block_number: 105, log_index: 1, sender_address: 'wL2', trader_address: '0xeL2', bnb_amount: 0.1 }, // wL2 续单
  ]);
  check('X7 组金额=累计口径：0.1+0.1 首买等额成组、合并累计 0.1+0.2=0.3 过线计入', () =>
    assert.strictEqual(F(fa7, T0 + 8000).launchBigBuyBnb, 0.3));
  // X8 defer 乱序收敛（两段喂食：价格段先行+wallet 段乱序回推 → 组构成与累计终态确定）
  const fa8 = newFA();
  const legs = [
    { timestamp: T0 + 1000, block_number: 100, log_index: 1, sender_address: 'wM1', trader_address: '0xeM1', bnb_amount: 0.40082013 },
    { timestamp: T0 + 18000, block_number: 251, log_index: 1, sender_address: 'wM5', trader_address: '0xeM5', bnb_amount: 0.13582946 },
    { timestamp: T0 + 18000, block_number: 251, log_index: 2, sender_address: 'wM6', trader_address: '0xeM6', bnb_amount: 0.13580056 },
    { timestamp: T0 + 15000, block_number: 236, log_index: 1, sender_address: 'wM4', trader_address: '0xeM4', bnb_amount: 0.19822347 },
    { timestamp: T0 + 1000, block_number: 211 - 211 + 100, log_index: 2, sender_address: 'wM2', trader_address: '0xeM2', bnb_amount: 0.24697901 },
  ];
  // 直接乱序喂（processTick 同步路径即乱序到达）：组构成基于首买 map 覆盖式收敛
  feed(fa8, legs);
  check('X8 乱序到达同值：bigBuy=1.1177（首买 map min 覆盖 + 累计求和序无关）', () =>
    assert.strictEqual(F(fa8, T0 + 21000).launchBigBuyBnb, 1.1177));
}

// ═══════════════ Y. T177 出生窗同块卖出簇 + ≥10 捆绑绝对 veto ═══════════════
// 2026-11-18 0x65104a556200d2ac4fc0462c14b240e3ca307777 案（bt-v147 AF1 复盘），
// 用户裁定原话「在代币早期交易中，出现 10 个或以上的捆绑，无论买入还是砸盘，都不要
// 买了」：10 钱包 t+1s 同块买 0.99B → 拉 +69.7% → 同 10 钱包 t+24s 同块砸 0.87B 块内
// −24.5% → 砸后 12s 反弹洗白全门链买入 → 93s 流动性止损 −62.4%。买侧键已有
// （launchBundleClusterSize 首买簇），卖侧新键 launchSellBundleClusterSize 独立接住
// 「分批建仓后同块合砸」形状；ladder v30 全 14 腿绝对 veto（无年龄放行无破发豁免）。
console.log('Y. T177 同块卖出簇 + ≥10 捆绑绝对 veto（0x6510…7777 案源形状）');
{
  const W10 = Array.from({ length: 10 }, (_, i) => 'wS' + i);
  const buys = W10.map((w, i) => ({ timestamp: T0 + 1000, block_number: 689, log_index: i,
    sender_address: w, trader_address: '0xeS' + i, bnb_amount: 0.09 + i * 0.003 }));
  const dumps = W10.map((w, i) => ({ timestamp: T0 + 24000, block_number: 741, log_index: i,
    trade_type: 'sell', sender_address: w, trader_address: '0xeS' + i, bnb_amount: 0.07 + i * 0.003 }));

  // Y1 案源形状回放：双键 10/10
  const fa1 = newFA();
  feed(fa1, buys); feed(fa1, dumps);
  const m1 = F(fa1, T0 + 30000);
  check('Y1a 案源双键=10/10（同 10 钱包先同块买后同块砸；每钱包累计卖出 ≥0.015 尘线全过）', () => {
    assert.strictEqual(m1.launchBundleClusterSize, 10);
    assert.strictEqual(m1.launchSellBundleClusterSize, 10);
  });

  // Y2 买侧键独盲、卖侧键独立接住：分批建仓（跨 3 块 4+3+3）后同块合砸 10 户
  const fa2 = newFA();
  const spread = [
    ...W10.slice(0, 4).map((w, i) => ({ timestamp: T0 + 1000, block_number: 300, log_index: i, sender_address: w, trader_address: '0xT' + i, bnb_amount: 0.1 })),
    ...W10.slice(4, 7).map((w, i) => ({ timestamp: T0 + 3000, block_number: 320, log_index: i, sender_address: w, trader_address: '0xT' + (i + 4), bnb_amount: 0.1 })),
    ...W10.slice(7).map((w, i) => ({ timestamp: T0 + 5000, block_number: 340, log_index: i, sender_address: w, trader_address: '0xT' + (i + 7), bnb_amount: 0.1 })),
    ...W10.map((w, i) => ({ timestamp: T0 + 30000, block_number: 741, log_index: i, trade_type: 'sell', sender_address: w, trader_address: '0xT' + i, bnb_amount: 0.09 })),
  ];
  feed(fa2, spread);
  const m2 = F(fa2, T0 + 35000);
  check('Y2 分批建仓（首买簇恒 4）+ 同块合砸 10 户 → 卖出键=10 独立接住（买侧键结构性漏的形状）', () => {
    assert.strictEqual(m2.launchBundleClusterSize, 4);
    assert.strictEqual(m2.launchSellBundleClusterSize, 10);
  });

  // Y3 尘线：尘埃卖出不构成捆绑砸盘证据（T162 买入尘线同线）
  const fa3 = newFA();
  feed(fa3, [
    ...W10.map((w, i) => ({ timestamp: T0 + 1000, block_number: 689, log_index: i, sender_address: w, trader_address: '0xD' + i, bnb_amount: 0.1 })),
    ...W10.map((w, i) => ({ timestamp: T0 + 10000, block_number: 700, log_index: i, trade_type: 'sell', sender_address: w, trader_address: '0xD' + i, bnb_amount: 0.001 })),
  ]);
  check('Y3 10 钱包各卖 0.001（<holderDustBnb 0.015）→ 卖出键=0（有证据零值非 null）', () => {
    assert.strictEqual(F(fa3, T0 + 15000).launchSellBundleClusterSize, 0);
  });

  // Y4 分单不漏：两块各 0.01 累计 0.02 过线（累计口径判据，非单笔）
  const fa4 = newFA();
  const w3 = ['wP1', 'wP2', 'wP3'];
  feed(fa4, [
    ...w3.map((w, i) => ({ timestamp: T0 + 1000, block_number: 100, log_index: i, sender_address: w, trader_address: '0xP' + i, bnb_amount: 0.1 })),
    ...w3.map((w, i) => ({ timestamp: T0 + 5000, block_number: 110, log_index: i, trade_type: 'sell', sender_address: w, trader_address: '0xP' + i, bnb_amount: 0.01 })),
    ...w3.map((w, i) => ({ timestamp: T0 + 8000, block_number: 120, log_index: i, trade_type: 'sell', sender_address: w, trader_address: '0xP' + i, bnb_amount: 0.01 })),
  ]);
  check('Y4 每钱包两块各 0.01 累计 0.02 ≥ 尘线 → 两块簇各计 3（累计口径分单不漏）', () => {
    assert.strictEqual(F(fa4, T0 + 12000).launchSellBundleClusterSize, 3);
  });

  // Y5 多块 max：块 A 5 户/块 B 8 户 → 取最大块
  const fa5 = newFA();
  const mk = (blk, arr) => arr.map((w, i) => ({ timestamp: T0 + 1000 + blk, block_number: blk, log_index: i,
    sender_address: w, trader_address: '0xM' + blk + i, bnb_amount: 0.1 }));
  feed(fa5, mk(500, ['a1', 'a2', 'a3', 'a4', 'a5']));
  feed(fa5, mk(510, ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8']).map(t => ({ ...t, trade_type: 'sell' })));
  check('Y5 多块取最大：5 户买块 + 8 户卖块 → 卖出键=8（买块不计入卖出键）', () => {
    assert.strictEqual(F(fa5, T0 + 5000).launchSellBundleClusterSize, 8);
  });

  // Y6 出窗冻结：90s 出生窗外砸块不计；冻结后恒返回快照（token 属性窗内定格）
  const fa6 = newFA();
  feed(fa6, buys);
  feed(fa6, dumps);
  feed(fa6, [{ timestamp: T0 + 92000, block_number: 800, log_index: 0, sender_address: 'wClose', trader_address: '0xC', bnb_amount: 0.05 }]); // 触发关窗（本行不入窗）
  const frozen = F(fa6, T0 + 93000);
  check('Y6a 关窗行触发冻结：双键保持 10/10', () => {
    assert.strictEqual(frozen.launchBundleClusterSize, 10);
    assert.strictEqual(frozen.launchSellBundleClusterSize, 10);
  });
  feed(fa6, Array.from({ length: 12 }, (_, i) => ({ timestamp: T0 + 95000, block_number: 900, log_index: i,
    trade_type: 'sell', sender_address: 'wLate' + i, trader_address: '0xL' + i, bnb_amount: 0.1 })));
  const pickLaunch = (m) => ({
    size: m.launchBundleClusterSize, share: m.launchBundleClusterSharePct,
    eqW: m.launchEqualClusterWallets, eqBnb: m.launchEqualClusterBnb,
    f0: m.launchFirstBlockWallets, wave: m.launchFirstWaveWallets,
    bigBuy: m.launchBigBuyBnb, sellClu: m.launchSellBundleClusterSize,
  });
  check('Y6b 窗外 12 户同块砸不计 → launch 族冻结值不变（早期窗定格，窗外归 CD/FP 锚窗臂管）', () => {
    assert.deepStrictEqual(pickLaunch(F(fa6, T0 + 100000)), pickLaunch(frozen));
  });

  // Y7 defer 乱序收敛：卖出行乱序到达（processTick 同步路径即乱序）→ 终态同值
  const fa7 = newFA();
  feed(fa7, buys);
  feed(fa7, [dumps[5], dumps[0], dumps[9], dumps[2], dumps[7], dumps[1], dumps[8], dumps[3], dumps[6], dumps[4]]);
  check('Y7 卖出行乱序喂入 → 卖出键=10 同值（Set.add/加法幂等收敛）', () => {
    assert.strictEqual(F(fa7, T0 + 30000).launchSellBundleClusterSize, 10);
  });

  // Y8 null wallet 行不入簇（解析缺失回退 trader=路由归一 → 少计宁漏不误充）
  const fa8 = newFA();
  feed(fa8, buys);
  feed(fa8, [
    ...Array.from({ length: 10 }, (_, i) => ({ timestamp: T0 + 24000, block_number: 741, log_index: 50 + i,
      trade_type: 'sell', sender_address: null, trader_address: ROUTER, bnb_amount: 0.1 })),
    { timestamp: T0 + 24000, block_number: 741, log_index: 99, trade_type: 'sell',
      sender_address: 'wOnly1', trader_address: '0xO1', bnb_amount: 0.1 },
  ]);
  check('Y8 10 笔 sender 缺失卖出（全回退 ROUTER）+1 真钱包 → 卖出键=2（路由伪钱包归一为 1 不膨胀簇计数——少计宁漏）', () => {
    assert.strictEqual(F(fa8, T0 + 30000).launchSellBundleClusterSize, 2);
  });

  // Y9 v30 绝对 veto 门串求值：无年龄放行无破发豁免，null 恒 false 宁拦
  {
    const { ConditionEvaluator } = require(path.join(ROOT, 'src', 'strategies', 'ConditionEvaluator.js'));
    const ev = new ConditionEvaluator();
    const veto = 'launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10';
    check('Y9a 双 9 放行（3~9 簇归 G1 豁免域——ASTER 换手豁免边界不变）', () =>
      assert.strictEqual(ev.evaluate(veto, { launchBundleClusterSize: 9, launchSellBundleClusterSize: 9 }), true));
    check('Y9b 买簇 10 恒拒——年龄/破发豁免全部失效（与 G1 的本质差异：绝对 veto）', () =>
      assert.strictEqual(ev.evaluate(veto, {
        launchBundleClusterSize: 10, launchSellBundleClusterSize: 0,
        tokenAgeSec: 600, sinceFirstTradeSec: 600, launchMinVsFloorPct: -38.4 }), false));
    check('Y9c 卖簇 10 恒拒（本案：双 10）', () =>
      assert.strictEqual(ev.evaluate(veto, {
        launchBundleClusterSize: 10, launchSellBundleClusterSize: 10 }), false));
    check('Y9d 键缺失 null 恒 false=宁拦不冒充（旧 FA/快照断代语境 fail-closed）', () =>
      assert.strictEqual(ev.evaluate(veto, { launchSellBundleClusterSize: 9 }), false));
  }

  // Y10 deploy 脚本 v30 门串逐字一致（防漂移；U7 同款）
  check('Y10 deploy 脚本 BUNDLE_VETO_GATE 与本段一致', () => {
    const deploySrc = fs.readFileSync(path.join(ROOT, 'scripts', 'deploy-signal-source-strategies.cjs'), 'utf8');
    const m = deploySrc.match(/const BUNDLE_VETO_GATE = ' AND (launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10)'/);
    assert.ok(m, 'BUNDLE_VETO_GATE 常量缺失或形状漂移');
  });

  // Y11 FactorBuilder 快照透传 + 探针收键（不落库即丢防线）
  check('Y11 FactorBuilder 白名单透传 + getFactorKeys 探针收键', () => {
    const fbSrc = fs.readFileSync(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'), 'utf8');
    assert.ok(/launchSellBundleClusterSize: factorResults\.launchSellBundleClusterSize \?\? null/.test(fbSrc), 'FactorBuilder 透传缺失');
    assert.ok(newFA().getFactorKeys().has('launchSellBundleClusterSize'), '探针未收键');
  });
}

// ═══════════════ Z. T178 两波捆绑买入波数两键 + G4 绝对 veto ═══════════════
// 2026-11-18 0xa025b8d8fb396890c0b469d8f056727e99577777 案（bt-v147 复盘），用户
// 裁定原话「2 次超过钱包捆绑买入，且占总流动性比例太高，非常明显的作弊了。控不住
// 就加个因子过滤」：t+3s 7 钱包同块买 0.92B → t+7s 同组 7 钱包相邻两块**复购**
// 0.98B（第二波非首买，G3 首买簇键结构性看不见，复刻 launchBundleClusterSize=7/
// launchSellBundleClusterSize=6 双双 <10=控不住实锤）→ t+16-17s 同组 9 户两相邻块
// 全清砸 2.08B → 双信号放行买入 −6.7%（FP15 全臂贴线未中+AF1 high_skip 跳 cheat+
// BP 过）。两新键：launchBuyBundleWaves=出生窗「≥5 尘线钱包同块买入」块数（raw
// 逐块含复购）+ launchBuyBundleDominancePct=波块买入合计÷出生窗总买入×100；同窗
// 203 成交票对照 waves≥2∧dom≥30 恰 3 命中（本案 33.2%），低占比域 11 票有机热门
// 盘全放行（dom 才是分离轴）；ladder v31 全 14 腿 G4 绝对 veto（无年龄放行无破发
// 豁免，T177 同形）。
console.log('Z. T178 两波捆绑买入波数 + G4 绝对 veto（0xa025…7777 案源形状）');
{
  const W7 = Array.from({ length: 7 }, (_, i) => 'wZ' + i);
  const wave1 = W7.map((w, i) => ({ timestamp: T0 + 1000, block_number: 300, log_index: i,
    sender_address: w, trader_address: '0xZ' + i, bnb_amount: 0.13 }));           // 0.91B 7 户
  const wave2 = W7.slice(0, 5).map((w, i) => ({ timestamp: T0 + 2000, block_number: 301, log_index: 10 + i,
    sender_address: w, trader_address: '0xZ' + i, bnb_amount: 0.10 }));           // 0.50B 同组 5 户复购
  const retail = Array.from({ length: 8 }, (_, i) => ({ timestamp: T0 + 3000 + i * 1000, block_number: 310 + i,
    log_index: 30 + i, sender_address: 'rZ' + i, trader_address: '0xR' + i, bnb_amount: 0.10 })); // 0.80B 散户分母

  // Z1 案源形状回放：两波成形 + 精确公式值 + G3 首买簇键看不见第二波（结构性反证）
  const fa1 = newFA();
  feed(fa1, wave1); feed(fa1, wave2);
  const mid = F(fa1, T0 + 5000);
  check('Z1a 第二波（复购）计入波数：两波成形 waves=2（raw 逐块口径——G3 盲区接住）', () => {
    assert.strictEqual(mid.launchBuyBundleWaves, 2);
    assert.strictEqual(mid.launchBuyBundleDominancePct, 100); // 窗内只有波块 → 1.41/1.41
  });
  check('Z1b G3 首买簇键看不见第二波：launchBundleClusterSize=7（首买全在块 300——复购不可见=控不住实锤）', () => {
    assert.strictEqual(mid.launchBundleClusterSize, 7);
  });
  feed(fa1, retail);
  const m1 = F(fa1, T0 + 20000);
  check('Z1c 散户分母进场：waves=2 ∧ dom=63.8（=(0.91+0.50)/2.21×100 精确值，一位舍入）', () => {
    assert.strictEqual(m1.launchBuyBundleWaves, 2);
    assert.strictEqual(m1.launchBuyBundleDominancePct, 63.8);
  });

  // Z2 有机热门盘：2 波低占比 → 不拦（waves≥2 单轴 11 票多为有机，dom 才是分离轴）
  const fa2 = newFA();
  feed(fa2, [
    ...Array.from({ length: 5 }, (_, i) => ({ timestamp: T0 + 1000, block_number: 400, log_index: i,
      sender_address: 'oZ' + i, trader_address: '0xO' + i, bnb_amount: 0.02 })),
    ...Array.from({ length: 5 }, (_, i) => ({ timestamp: T0 + 2000, block_number: 401, log_index: 10 + i,
      sender_address: 'pZ' + i, trader_address: '0xP' + i, bnb_amount: 0.02 })),
    ...Array.from({ length: 40 }, (_, i) => ({ timestamp: T0 + 3000 + i * 500, block_number: 410 + i,
      log_index: 30 + i, sender_address: 'qZ' + i, trader_address: '0xQ' + i, bnb_amount: 0.05 })),
  ]);
  const m2 = F(fa2, T0 + 30000);
  check('Z2 有机形状：waves=2（两块各 5 户过尘线）但 dom=9.1（0.20/2.20）→ G4 放行', () => {
    assert.strictEqual(m2.launchBuyBundleWaves, 2);
    assert.strictEqual(m2.launchBuyBundleDominancePct, 9.1);
    const { ConditionEvaluator } = require(path.join(ROOT, 'src', 'strategies', 'ConditionEvaluator.js'));
    assert.strictEqual(new ConditionEvaluator().evaluate(
      '(launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30)', m2), true);
  });

  // Z3 尘线：5 户各 0.01（累计 <holderDustBnb 0.015）→ 不算波（0=有证据零值）
  const fa3 = newFA();
  feed(fa3, Array.from({ length: 5 }, (_, i) => ({ timestamp: T0 + 1000, block_number: 500, log_index: i,
    sender_address: 'dZ' + i, trader_address: '0xD' + i, bnb_amount: 0.01 })));
  check('Z3 尘埃同块 5 户不过尘线 → waves=0 dom=0.0（尘埃买入不构成波）', () => {
    const m3 = F(fa3, T0 + 5000);
    assert.strictEqual(m3.launchBuyBundleWaves, 0);
    assert.strictEqual(m3.launchBuyBundleDominancePct, 0);
  });

  // Z4 4 户过线+1 户尘下 → n=4<5 不算波（波门=尘线以上钱包 ≥5）
  const fa4 = newFA();
  feed(fa4, [
    ...Array.from({ length: 4 }, (_, i) => ({ timestamp: T0 + 1000, block_number: 600, log_index: i,
      sender_address: 'eZ' + i, trader_address: '0xE' + i, bnb_amount: 0.1 })),
    { timestamp: T0 + 1000, block_number: 600, log_index: 9, sender_address: 'eZ9', trader_address: '0xE9', bnb_amount: 0.005 },
  ]);
  check('Z4 4 过线+1 尘下 → waves=0（5 户门只数尘线以上）', () => {
    assert.strictEqual(F(fa4, T0 + 5000).launchBuyBundleWaves, 0);
  });

  // Z5 出窗冻结：窗外第三波不计 + 冻结后恒返回快照（token 属性窗内定格）
  const fa5 = newFA();
  feed(fa5, wave1); feed(fa5, wave2);
  feed(fa5, [{ timestamp: T0 + 92000, block_number: 900, log_index: 0, sender_address: 'x1', trader_address: '0xX1', bnb_amount: 0.1 }]); // 触发关窗
  const frozen = F(fa5, T0 + 93000);
  check('Z5a 关窗行触发冻结：waves=2 保持', () => {
    assert.strictEqual(frozen.launchBuyBundleWaves, 2);
  });
  feed(fa5, Array.from({ length: 5 }, (_, i) => ({ timestamp: T0 + 95000, block_number: 950, log_index: i,
    sender_address: 'yZ' + i, trader_address: '0xY' + i, bnb_amount: 0.1 })));
  check('Z5b 窗外 5 户同块第三波不计 → 冻结值不变（窗外归 CD/FP 锚窗臂管）', () => {
    const late = F(fa5, T0 + 100000);
    assert.strictEqual(late.launchBuyBundleWaves, frozen.launchBuyBundleWaves);
    assert.strictEqual(late.launchBuyBundleDominancePct, frozen.launchBuyBundleDominancePct);
  });

  // Z6 defer 乱序收敛：行乱序到达 → 终态同值（Map 累加交换律）
  const fa6 = newFA();
  const all = [...wave1, ...wave2, ...retail];
  feed(fa6, [all[9], all[0], all[14], all[3], all[7], all[12], all[1], all[8], all[13], all[2],
    all[6], all[11], all[4], all[10], all[5], ...all.slice(15).reverse()]);
  const m6 = F(fa6, T0 + 20000);
  check('Z6 乱序喂入 → waves=2 dom=63.8 同值（加法交换律收敛）', () => {
    assert.strictEqual(m6.launchBuyBundleWaves, 2);
    assert.strictEqual(m6.launchBuyBundleDominancePct, 63.8);
  });

  // Z7 null wallet（sender 缺失回退 ROUTER）归一为 1 不膨胀波计数（Y8 同向少计宁漏）
  const fa7 = newFA();
  feed(fa7, [
    ...Array.from({ length: 4 }, (_, i) => ({ timestamp: T0 + 1000, block_number: 700, log_index: i,
      sender_address: null, trader_address: ROUTER, bnb_amount: 0.1 })),
    { timestamp: T0 + 1000, block_number: 700, log_index: 9, sender_address: 'hZ1', trader_address: '0xH1', bnb_amount: 0.1 },
  ]);
  check('Z7 4 笔 sender 缺失（归一 ROUTER）+1 真钱包 → 块内 2 钱包 <5 → waves=0', () => {
    assert.strictEqual(F(fa7, T0 + 5000).launchBuyBundleWaves, 0);
  });

  // Z8 G4 门串求值：无年龄放行无破发豁免，null 恒 false 宁拦（Y9 同构）
  {
    const { ConditionEvaluator } = require(path.join(ROOT, 'src', 'strategies', 'ConditionEvaluator.js'));
    const ev = new ConditionEvaluator();
    const veto = '(launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30)';
    check('Z8a 本案形状 waves=2 dom=33.2 → 拒', () =>
      assert.strictEqual(ev.evaluate(veto, { launchBuyBundleWaves: 2, launchBuyBundleDominancePct: 33.2 }), false));
    check('Z8b 2 波低占比 dom=29.9 → 放（dom 分离轴）', () =>
      assert.strictEqual(ev.evaluate(veto, { launchBuyBundleWaves: 2, launchBuyBundleDominancePct: 29.9 }), true));
    check('Z8c 单波高占比 dom=80 → 放（单波归 G3/锚窗臂管——0x645886 dom79.5 waves=1 知情放行）', () =>
      assert.strictEqual(ev.evaluate(veto, { launchBuyBundleWaves: 1, launchBuyBundleDominancePct: 80 }), true));
    check('Z8d 10 波 dom=32.9 → 拒（0x51d9e3 同窗对照票）', () =>
      assert.strictEqual(ev.evaluate(veto, { launchBuyBundleWaves: 10, launchBuyBundleDominancePct: 32.9 }), false));
    check('Z8e 年龄/破发豁免全部失效（绝对 veto——与 G1 本质差异）', () =>
      assert.strictEqual(ev.evaluate(veto, { launchBuyBundleWaves: 2, launchBuyBundleDominancePct: 33.2,
        tokenAgeSec: 600, sinceFirstTradeSec: 600, launchMinVsFloorPct: -38.4 }), false));
    check('Z8f 键缺失 null 恒 false=宁拦不冒充（双键缺失拒 / waves=2∧dom 缺失拒；waves=1 在场真放行——单波真无两波形状）', () => {
      assert.strictEqual(ev.evaluate(veto, {}), false);
      assert.strictEqual(ev.evaluate(veto, { launchBuyBundleWaves: 2 }), false); // dom null<30 false → OR false
    });
  }

  // Z9 deploy 脚本 v31 门串逐字一致（防漂移；Y10 同款）
  check('Z9 deploy 脚本 TWO_WAVE_VETO_GATE 与本段一致', () => {
    const deploySrc = fs.readFileSync(path.join(ROOT, 'scripts', 'deploy-signal-source-strategies.cjs'), 'utf8');
    const m = deploySrc.match(/const TWO_WAVE_VETO_GATE = ' AND \(launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30\)'/);
    assert.ok(m, 'TWO_WAVE_VETO_GATE 常量缺失或形状漂移');
  });

  // Z10 FactorBuilder 快照透传 + 探针收键（不落库即丢防线）
  check('Z10 FactorBuilder 白名单透传两键 + getFactorKeys 探针收键', () => {
    const fbSrc = fs.readFileSync(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'), 'utf8');
    assert.ok(/launchBuyBundleWaves: factorResults\.launchBuyBundleWaves \?\? null/.test(fbSrc), 'waves 透传缺失');
    assert.ok(/launchBuyBundleDominancePct: factorResults\.launchBuyBundleDominancePct \?\? null/.test(fbSrc), 'dom 透传缺失');
    const keys = newFA().getFactorKeys();
    assert.ok(keys.has('launchBuyBundleWaves') && keys.has('launchBuyBundleDominancePct'), '探针未收键');
  });
}

// ═══════════════ AA. T180 首两波大部队×高占比（0x17b0 案 FA 键事实 + 迁移指针） ═══════════════
// 2026-11-18 0x17b09420d03be61401cdfaf57160b3e6f8737777 案（bt-v147 复盘）：t+0s
// 单鲸 0.50B 首块 → t+1s 第二块（相邻 883+884 同秒）8 钱包挤入 1.26B（0.1861×2
// 逐位等额带）占窗买 ~76% → t+41s 鲸全清 → fire t+298s（G1 被年龄放行/G3 clu=5/
// G4 waves=1 均不达线）→ 买入 −10.9%。**veto 首落 ladder v32 G6 后同日迁移因子
// 购买前检查门 FP17 launch_squad_dominance 臂**（用户裁定「这个阻挡没问题，放到
// 因子过滤模块吧，不要放到信号触发模块了」——判定与边界测试在
// _test_factor_prebuy_check.cjs T 段，snapshot 锚计算在 _test_buy_point_lib.cjs
// T 组）；本段保留 FA 键事实断言（ladder 仍消费 launchFirstWaveWallets 于 G1、
// launchBuyBundleDominancePct 已无 ladder 消费者但 FA/快照键保留）+ 迁出锁。
console.log('AA. T180 首两波大部队×高占比（0x17b0…7777 案 FA 键事实——veto 已迁 FP17）');
{
  const W8 = Array.from({ length: 8 }, (_, i) => 'wA' + i);
  const mk17 = (w, i, blk, ts, amt) => ({ timestamp: T0 + ts, block_number: blk, log_index: i,
    sender_address: w, trader_address: '0xA' + i, bnb_amount: amt });
  const whale = [mk17('wWhale', 0, 700, 1000, 0.5)];
  const wave2a = [
    mk17(W8[0], 1, 701, 2000, 0.1861), mk17(W8[1], 2, 701, 2000, 0.1861),
    mk17(W8[2], 3, 701, 2000, 0.1980), mk17(W8[3], 4, 701, 2000, 0.2079),
    mk17(W8[4], 5, 701, 2000, 0.1782),
  ];
  const wave2b = [
    mk17(W8[5], 6, 702, 2000, 0.0995), mk17(W8[6], 7, 702, 2000, 0.0995),
    mk17(W8[7], 8, 702, 2000, 0.0498),
  ];
  const retail = Array.from({ length: 6 }, (_, i) => mk17('rA' + i, 20 + i, 710 + i, 4000 + i * 500, 0.1));

  // AA1 案源回放：FA 键事实（跨层对拍锚——snapshot launchSquad 同值见 buy_point_lib T 组）
  const fa1 = newFA();
  feed(fa1, whale); feed(fa1, wave2a); feed(fa1, wave2b); feed(fa1, retail);
  const m1 = F(fa1, T0 + 20000);
  check('AA1a 案源形状：launchFirstWaveWallets=9（f0=1 鲸+同秒 8 户全部入 2s 波窗）', () => {
    assert.strictEqual(m1.launchFirstWaveWallets, 9);
    assert.strictEqual(m1.launchFirstBlockWallets, 1);
  });
  check('AA1b dom=41.5（≥5 户块 0.9563 ÷ 窗买 2.3051 精确值）∧ G3/G4 键不达线（clu=5/waves=1）=v32 前 ladder 全链拦不住的实证', () => {
    assert.strictEqual(m1.launchBuyBundleDominancePct, 41.5);
    assert.strictEqual(m1.launchBundleClusterSize, 5);
    assert.strictEqual(m1.launchBuyBundleWaves, 1);
  });

  // AA2 迁出锁：ladder deploy 无 G6 门串，判定在 FP17（T180 二修同日迁移）
  check('AA2 迁出锁：deploy 脚本不含 WAVE_DOM_VETO_GATE（ladder 尾门回 G1~G5）；FP17 臂在位', () => {
    const deploySrc = fs.readFileSync(path.join(ROOT, 'scripts', 'deploy-signal-source-strategies.cjs'), 'utf8');
    assert.ok(!deploySrc.includes('WAVE_DOM_VETO_GATE'), 'ladder 仍带 G6 门串——迁移未完成');
    assert.ok(!deploySrc.includes('l.condition += WAVE_DOM_VETO_GATE'), 'G6 仍在拼腿');
    const fpSrc = fs.readFileSync(path.join(ROOT, 'src', 'market-analysis', 'factor-pre-buy-check.js'), 'utf8');
    assert.ok(fpSrc.includes("arms.push('launch_squad_dominance')"), 'FP17 臂不在位');
  });

  // AA3 两键仍为现行 FA 键（探针收键；launchBuyBundleDominancePct 保留=FP snapshot
  // 镜像的 FA 侧真源+历史条件串回放兼容）
  check('AA3 两键为现行 FA 键（探针收键——零新键立法的回归锁）', () => {
    const keys = newFA().getFactorKeys();
    assert.ok(keys.has('launchFirstWaveWallets') && keys.has('launchBuyBundleDominancePct'), '探针未收键');
  });
}

console.log(`\n结果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
