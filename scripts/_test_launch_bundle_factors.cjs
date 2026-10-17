#!/usr/bin/env node
/**
 * FA launch* 出生锚定捆绑簇 4 键单测（2026-10-17 Agentum 案方向 C）——本地零 DB 零网络。
 *
 * launchBundleClusterSize / launchBundleClusterSharePct / launchEqualClusterWallets /
 * launchEqualClusterBnb：出生窗（firstTickAt+launchBundleWinMs=90s）累计 + 出窗冻结。
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

console.log(`\n结果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
