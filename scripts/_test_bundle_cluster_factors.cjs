#!/usr/bin/env node
/**
 * 同 block 首买簇捆绑检测 bundle* 6 键单测（2026-10-16 BITCAT 案）——本地零 DB 零网络。
 *
 * 6+2 键：bundleClusterSize/bundleClusterSharePct/bundleClusterAmountRatio/
 *      bundleClusterEvenGap/bundleClusterSameTrader/maxBlockBuyCircPct/
 *      bundleClusterHoldCircPct（2026-10-25 两口径 A/B 对比用户裁定新增，替换
 *      bundleClusterSharePct 的门位：全史 max over 块(该块买家集合当前正净持仓合计)
 *      ÷ 累计流通 ×100——流量口径误伤快进快出交易簇，存量口径拦真囤簇）/
 *      top2BundleClusterHoldCircPct（同日 AIFLY 0x0bae…7777 案用户裁定第二道门：
 *      持仓口径最大两块买家集合【并集去重】当前正净持仓合计 ÷ 流通 ×100——
 *      复买跨块钱包只计一份筹码，不足两块退化 = top1 值）；
 *      窗口 bundleWinMs 默认 10000（对齐 act*），factorParams 可覆盖；
 *      口径：wallet=sender||trader；首买=钱包本票全史首笔买（min 替换非 Set 判重）；
 *      流通=_circTokens（Σ买−Σ卖 token，BITCAT 重放对拍 63.3% 同口径）。
 *      ★2026-10-20 口径断代（乌龟案用户裁定）：maxBlockBuyCircPct 分子由「10s 滚动窗
 *      最大」改为「全史最大」——滚动版在大块滑出窗后归零（C2 反证：出窗后簇键 0、
 *      吞噬率保留 100）；本键历史快照/扫描值与新口径不可比。
 *
 * 覆盖：
 *   A. BITCAT 事故现场反证（真簇：size=5/share≈52.6/amountRatio=1/evenGap=1/
 *      sameTrader=100/maxBlockBuyCircPct≈63.3——0xdae1cb51…7777 五 bundler 同 block
 *      首买 52.5% 窗内买盘、单 block 吞流通 63.3%、fire 峰顶买入后同 block 清仓 -35.8%）
 *   B. 散户簇对照（假簇：size=4/share≈11.9/amountRatio≈5/evenGap=0/sameTrader=25）
 *   C. 窗边界（ts==cutoff 留 / 1ms 前出局）
 *   D. 非首买不进簇（复买只计 share 分母与 block 买量，不重复聚簇）
 *   E. defer 乱序 parity（含 min 替换：乱序喂 == 链序喂 6 键 bit 一致）
 *   F. 摊销裁剪（>64 事件/块触发 splice/delete，窗内值不变 + 长度收缩）
 *   G. 流通口径对拍（_circTokens = Σ买−Σ卖 独立重算；卖出缩小分母抬高吞噬率）
 *   H. 空窗零值（6 键全 0 非 null）+ getFactorKeys/getAvailableFactorIds 探针含 6 键
 *   I. 参数覆盖（factorParams.bundleWinMs）+ blk 缺失行不聚簇不炸
 *   J. 源码口径断言（写点段禁 Date.now / 读点纯函数 / 写点在 _applyWalletAggregation
 *      体内 / _walletFirstBuyTs 全史不裁 / 2× 裁剪余量 / 字面量与快照白名单含 6 键）
 *   K. StrategyEngine 装载 + ConditionEvaluator 求值（纯读因子无互斥）
 *   L. FactorBuilder 快照透传（旧输入 null 不掩盖）
 *
 * 用法：node scripts/_test_bundle_cluster_factors.cjs
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
const mkTick = (o) => Object.assign({
  token_address: '0xtoken', trade_type: 'buy', trader_address: null, sender_address: null,
  price_bnb: 0.00001, price_usd: 5, bnb_amount: 1, token_amount: 1000,
  block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: 0,
}, o);

/** 标准构造：FA + 已注册 token（factorParams 覆盖经参传） */
function newFA(factorParams) {
  const cfg = factorParams ? { fourmemeWs: { factorParams } } : {};
  const fa = new FourMemeFactorAggregator(cfg, { info() {}, warn() {}, error() {} });
  fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  return fa;
}

const ROUTER = '0x1de460f3c1bd0c66b8d5f1ce8c4f0e2e9d3d6f4bc'; // GMGN BSC 聚合路由（BITCAT 案同款）
const M = 1e6;

/** BITCAT 场景 tick 集（真簇 block 1023 / 散户假簇 block 1015，bg 高价小 token 量） */
function bitcatTicks() {
  const t = [];
  // 早期建仓（窗外出局，只进流通分母）
  t.push(mkTick({ timestamp: T0 + 0, trader_address: 'eoaP', sender_address: 'wp1',
    block_number: 1000, log_index: 1, bnb_amount: 0.2134, token_amount: 21.34 * M }));
  // 窗内背景买单（bg 高价 1e-6 → token 量微小，只垫 share 分母）
  t.push(mkTick({ timestamp: T0 + 10000, trader_address: 'eoa1', sender_address: 'wbg1',
    block_number: 1010, log_index: 5, bnb_amount: 1.0, token_amount: 1 * M }));
  t.push(mkTick({ timestamp: T0 + 12000, trader_address: 'eoa2', sender_address: 'wbg2',
    block_number: 1012, log_index: 7, bnb_amount: 2.0, token_amount: 2 * M }));
  t.push(mkTick({ timestamp: T0 + 13000, trader_address: 'eoa3', sender_address: 'wbg3',
    block_number: 1013, log_index: 9, bnb_amount: 3.59, token_amount: 3.59 * M }));
  // 散户假簇（4 钱包同 block：金额离散 / li 间隔不齐 / trader 各异）
  const famts = [0.08, 0.16, 0.25, 0.40], ftoks = [4, 8, 12.5, 20], flis = [10, 25, 31, 60];
  for (let i = 0; i < 4; i++) {
    t.push(mkTick({ timestamp: T0 + 15000, trader_address: `eoaF${i}`, sender_address: `wf${i}`,
      block_number: 1015, log_index: flis[i], bnb_amount: famts[i], token_amount: ftoks[i] * M }));
  }
  // bundler 真簇（5 钱包同 block：等额 0.19776 / li 等差 31 / trader 全 GMGN 路由）
  const tlis = [22, 53, 84, 115, 146];
  for (let i = 0; i < 5; i++) {
    t.push(mkTick({ timestamp: T0 + 23000, trader_address: ROUTER, sender_address: `wt${i}`,
      block_number: 1023, log_index: tlis[i], bnb_amount: 0.19776, token_amount: 24.986 * M }));
  }
  return t;
}

// ═══════════════ A. BITCAT 事故现场反证 ═══════════════
console.log('A. BITCAT 事故现场反证（真簇 block 1023）');
{
  const fa = newFA();
  for (const tk of bitcatTicks()) fa.processTick(tk, {});
  const NOW = T0 + 24000; // fire 时刻（真簇 1s 后），窗 cutoff=T0+14000：假簇+真簇在窗、bg 出局
  const f = fa.buildFactorMap('0xtoken', NOW);
  check('A1 bundleClusterSize = 5（五 bundler 同 block 首买）', () => assert.strictEqual(f.bundleClusterSize, 5));
  check('A2 bundleClusterSharePct ≈ 52.6（0.9888/1.8788，BITCAT 实测 52.5）', () =>
    assert.ok(Math.abs(f.bundleClusterSharePct - 52.6) < 0.05, `got ${f.bundleClusterSharePct}`));
  check('A3 bundleClusterAmountRatio = 1（等额 0.19776×5）', () =>
    assert.ok(Math.abs(f.bundleClusterAmountRatio - 1) < 1e-9));
  check('A4 bundleClusterEvenGap = 1（li 差分 [31,31,31,31]）', () => assert.strictEqual(f.bundleClusterEvenGap, 1));
  check('A5 bundleClusterSameTrader = 100（5 行全 GMGN 聚合路由）', () =>
    assert.strictEqual(f.bundleClusterSameTrader, 100));
  check('A6 maxBlockBuyCircPct ≈ 63.3（全史最大 block 124.93M/197.36M，BITCAT 重放同口径）', () =>
    assert.ok(Math.abs(f.maxBlockBuyCircPct - 63.3) < 0.05, `got ${f.maxBlockBuyCircPct}`));
  check('A7 流通分母 = Σ买−Σ卖 = 197.36M（含窗外出局行——全史累计）', () =>
    assert.strictEqual(fa._states.get('0xtoken')._circTokens, 197360000));
}

// ═══════════════ B. 巨鲸单买簇（金额优先选择：size1 大额簇 > size4 散户簇）═══════════════
console.log('B. 巨鲸单买簇（bg3 单钱包 3.59 BNB > 散户簇 0.89——FLY 案后的金额优先口径）');
{
  const fa = newFA();
  const t = [];
  t.push(mkTick({ timestamp: T0 + 0, trader_address: 'eoaP', sender_address: 'wp1',
    block_number: 1000, log_index: 1, bnb_amount: 0.2134, token_amount: 21.34 * M }));
  t.push(mkTick({ timestamp: T0 + 10000, trader_address: 'eoa1', sender_address: 'wbg1',
    block_number: 1010, log_index: 5, bnb_amount: 1.0, token_amount: 50 * M }));
  t.push(mkTick({ timestamp: T0 + 12000, trader_address: 'eoa2', sender_address: 'wbg2',
    block_number: 1012, log_index: 7, bnb_amount: 2.0, token_amount: 100 * M }));
  t.push(mkTick({ timestamp: T0 + 13000, trader_address: 'eoa3', sender_address: 'wbg3',
    block_number: 1013, log_index: 9, bnb_amount: 3.59, token_amount: 179.5 * M }));
  const famts = [0.08, 0.16, 0.25, 0.40], ftoks = [4, 8, 12.5, 20], flis = [10, 25, 31, 60];
  for (let i = 0; i < 4; i++) {
    t.push(mkTick({ timestamp: T0 + 15000, trader_address: `eoaF${i}`, sender_address: `wf${i}`,
      block_number: 1015, log_index: flis[i], bnb_amount: famts[i], token_amount: ftoks[i] * M }));
  }
  for (const tk of t) fa.processTick(tk, {});
  const f = fa.buildFactorMap('0xtoken', T0 + 16000); // cutoff=6000：bg+假簇全窗
  check('B1 bundleClusterSize = 1（best=bg3 巨鲸单买簇——金额 3.59 > 散户簇 0.89）', () =>
    assert.strictEqual(f.bundleClusterSize, 1));
  check('B2 bundleClusterSharePct ≈ 48.0（3.59/7.48——巨鲸占近半买盘，旧 size 口径只显 11.9 是漏检）', () =>
    assert.ok(Math.abs(f.bundleClusterSharePct - 48.0) < 0.05, `got ${f.bundleClusterSharePct}`));
  check('B3 size<2 无金额比证据 → amountRatio=0 / evenGap=0', () => {
    assert.strictEqual(f.bundleClusterAmountRatio, 0);
    assert.strictEqual(f.bundleClusterEvenGap, 0);
  });
  check('B4 bundleClusterSameTrader = 100（单行模态 1/1）', () =>
    assert.strictEqual(f.bundleClusterSameTrader, 100));
  check('B6 maxBlockBuyCircPct = 45.4（bg3 单 block 179.5M/流通 395.34M——block 级吞噬与簇键独立）', () =>
    assert.ok(Math.abs(f.maxBlockBuyCircPct - 45.4) < 0.05, `got ${f.maxBlockBuyCircPct}`));
}

// ═══════════════ C. 窗边界 ═══════════════
console.log('C. 窗边界（ts==cutoff 留 / 1ms 前出局）');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 10000, trader_address: 'wX', block_number: 500, log_index: 3,
    bnb_amount: 0.5, token_amount: 10 * M }), {});
  const fIn = fa.buildFactorMap('0xtoken', T0 + 20000); // cutoff=T0+10000，事件恰在边界
  check('C1 边界事件留（size=1，单钱包簇 share=100）', () => {
    assert.strictEqual(fIn.bundleClusterSize, 1);
    assert.strictEqual(fIn.bundleClusterSharePct, 100);
    assert.strictEqual(fIn.bundleClusterSameTrader, 100); // 单行模态 1/1（数学真值）
    assert.strictEqual(fIn.bundleClusterAmountRatio, 0);  // size<2 无金额比证据
    assert.strictEqual(fIn.bundleClusterEvenGap, 0);
    assert.ok(fIn.maxBlockBuyCircPct > 0);
  });
  const fOut = fa.buildFactorMap('0xtoken', T0 + 20001); // cutoff=T0+10001，事件出局 1ms
  check('C2 出局 1ms → 5 个滚动簇键全 0；maxBlockBuyCircPct 全史口径保留 = 100（10M/10M 不回零）', () => {
    for (const k of ['bundleClusterSize', 'bundleClusterSharePct', 'bundleClusterAmountRatio',
      'bundleClusterEvenGap', 'bundleClusterSameTrader']) {
      assert.strictEqual(fOut[k], 0, k);
    }
    assert.strictEqual(fOut.maxBlockBuyCircPct, 100);
  });
}

// ═══════════════ D. 非首买不进簇 ═══════════════
console.log('D. 非首买不进簇（复买只计 share 分母与 block 买量）');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'wX', block_number: 50, log_index: 1,
    bnb_amount: 0.1, token_amount: 10 * M }), {});
  fa.processTick(mkTick({ timestamp: T0 + 5000, trader_address: 'wX', block_number: 55, log_index: 2,
    bnb_amount: 0.2, token_amount: 20 * M }), {}); // wX 复买（非首买）
  fa.processTick(mkTick({ timestamp: T0 + 5000, trader_address: 'wY', block_number: 55, log_index: 3,
    bnb_amount: 0.3, token_amount: 30 * M }), {});
  fa.processTick(mkTick({ timestamp: T0 + 5000, trader_address: 'wZ', block_number: 55, log_index: 4,
    bnb_amount: 0.3, token_amount: 30 * M }), {});
  const st = fa._states.get('0xtoken');
  const f = fa.buildFactorMap('0xtoken', T0 + 6000);
  check('D1 簇 = blk55 {wY,wZ} size=2（wX 复买不重复聚簇）', () => assert.strictEqual(f.bundleClusterSize, 2));
  check('D2 sharePct = 66.7（簇 0.6 / 窗内全买盘 0.9——分母含 wX 复买与首买）', () =>
    assert.ok(Math.abs(f.bundleClusterSharePct - 66.7) < 0.05, `got ${f.bundleClusterSharePct}`));
  check('D3 _bundleEvents 恰 3 条（wX 复买不 push）', () => assert.strictEqual(st._bundleEvents.length, 3));
  check('D4 _walletFirstBuyTs 全史 min（wX → T0+1000）', () =>
    assert.strictEqual(st._walletFirstBuyTs.get('wX'), T0 + 1000));
  // ★2026-10-20 二次口径修正（가나디 120.5% 案）：分子 = 最大块买家集合的**当前净持仓**
  // （含他们在其它块的买入/卖出），不再是块毛买入量。blk55 买家 {wX,wY,wZ} 当前净持仓
  // = wX 10+20 + wY 30 + wZ 30 = 90M；流通 = Σ买−Σ卖 = 90M → 100%（旧毛买入口径 80/90=88.9）
  check('D5 maxBlockBuyCircPct = 100（分子=块买家当前净持仓 90M 含 wX blk50 首买 / 流通 90M）', () =>
    assert.ok(Math.abs(f.maxBlockBuyCircPct - 100) < 0.05, `got ${f.maxBlockBuyCircPct}`));
}

// ═══════════════ E. defer 乱序 parity（含 min 替换） ═══════════════
console.log('E. defer 乱序 parity（乱序喂 == 链序喂，min 替换顶掉伪首买）');
{
  const KEYS = ['bundleClusterSize', 'bundleClusterSharePct', 'bundleClusterAmountRatio',
    'bundleClusterEvenGap', 'bundleClusterSameTrader', 'maxBlockBuyCircPct',
    'bundleClusterHoldCircPct', 'top2BundleClusterHoldCircPct'];
  // E1：D 场景乱序（wX 复买先到，真首买后到 → min 替换 + 读点去重）
  const ticksD = [
    mkTick({ timestamp: T0 + 1000, trader_address: 'wX', block_number: 50, log_index: 1, bnb_amount: 0.1, token_amount: 10 * M }),
    mkTick({ timestamp: T0 + 5000, trader_address: 'wX', block_number: 55, log_index: 2, bnb_amount: 0.2, token_amount: 20 * M }),
    mkTick({ timestamp: T0 + 5000, trader_address: 'wY', block_number: 55, log_index: 3, bnb_amount: 0.3, token_amount: 30 * M }),
    mkTick({ timestamp: T0 + 5000, trader_address: 'wZ', block_number: 55, log_index: 4, bnb_amount: 0.3, token_amount: 30 * M }),
  ];
  const faA = newFA();
  for (const tk of ticksD) faA.processTick(tk, {});
  const faB = newFA();
  for (const tk of [ticksD[3], ticksD[2], ticksD[1], ticksD[0]]) faB.processTick(tk, {}); // 逆序
  const fa2 = faA.buildFactorMap('0xtoken', T0 + 6000);
  const fb2 = faB.buildFactorMap('0xtoken', T0 + 6000);
  check('E1 D 场景逆序喂 6 键 bit 一致（含伪首买替换）', () => {
    for (const k of KEYS) assert.strictEqual(fb2[k], fa2[k], k);
  });
  // E2：BITCAT 全场景乱序（13 票确定性 shuffle，每票恰一次）
  const faC = newFA();
  const ticks = bitcatTicks();
  const shuf = [ticks[8], ticks[3], ticks[11], ticks[0], ticks[5], ticks[9], ticks[4],
    ticks[12], ticks[1], ticks[6], ticks[10], ticks[2], ticks[7]];
  for (const tk of shuf) faC.processTick(tk, {});
  const fc2 = faC.buildFactorMap('0xtoken', T0 + 24000);
  const faD = newFA();
  for (const tk of ticks) faD.processTick(tk, {});
  const fd2 = faD.buildFactorMap('0xtoken', T0 + 24000);
  check('E2 BITCAT 场景乱序喂 6 键 bit 一致（交换律聚合 + min 语义首买）', () => {
    for (const k of KEYS) assert.strictEqual(fc2[k], fd2[k], k);
  });
}

// ═══════════════ F. 摊销裁剪 ═══════════════
console.log('F. 摊销裁剪（>64 触发，窗内值不受影响）');
{
  const fa = newFA();
  // 80 买：i=0..69 各自 block，i=70..79 同 block 8000；ts=i 秒
  for (let i = 0; i < 80; i++) {
    fa.processTick(mkTick({
      timestamp: T0 + i * 1000, trader_address: `w${i}`, block_number: i < 70 ? 100 + i : 8000,
      log_index: i, bnb_amount: 0.1, token_amount: 1 * M,
    }), {});
  }
  const st = fa._states.get('0xtoken');
  // 首次越阈在喂 i=64（len 65 > 64，cutoff=44s）：头 44 条/块出局 → 21；此后 i=65..79
  // 事件再进 15 条 → 36；块加 5 单块 + blk8000 → 27（后续 len/size ≤ 64 不再触发）
  check('F1 _bundleEvents 裁剪收缩（80 → 36，cutoff 前老事件出局）', () =>
    assert.strictEqual(st._bundleEvents.length, 36, `len=${st._bundleEvents.length}`));
  check('F2 _blockBuyAgg 裁剪收缩（71 块 → 27 块，cutoff 前老块出局）', () =>
    assert.strictEqual(st._blockBuyAgg.size, 27, `size=${st._blockBuyAgg.size}`));
  const f = fa.buildFactorMap('0xtoken', T0 + 79500); // cutoff=69500：blk8000 的 10 票全窗
  check('F3 裁剪后窗内簇完整（blk8000 size=10）', () => assert.strictEqual(f.bundleClusterSize, 10));
  check('F4 sharePct = 100（窗内买盘恰为簇本身）', () =>
    assert.ok(Math.abs(f.bundleClusterSharePct - 100) < 0.05, `got ${f.bundleClusterSharePct}`));
  check('F5 maxBlockBuyCircPct = 12.5（blk8000 买 10M / 全史流通 80M——分母全史不裁）', () =>
    assert.ok(Math.abs(f.maxBlockBuyCircPct - 12.5) < 0.05, `got ${f.maxBlockBuyCircPct}`));
  check('F6 _walletFirstBuyTs 全史不裁（80 钱包全在——裁=复买误判新首买）', () =>
    assert.strictEqual(st._walletFirstBuyTs.size, 80));
}

// ═══════════════ G. 流通口径对拍 ═══════════════
console.log('G. 流通口径对拍（Σ买−Σ卖 独立重算；卖出缩小分母）');
{
  const fa = newFA();
  const ticks = bitcatTicks();
  ticks.push(mkTick({ timestamp: T0 + 24500, trader_address: ROUTER, sender_address: 'wt1',
    trade_type: 'sell', block_number: 1025, log_index: 7, bnb_amount: 0.4, token_amount: 5 * M }));
  ticks.push(mkTick({ timestamp: T0 + 24600, trader_address: 'eoaF1', sender_address: 'wf1',
    trade_type: 'sell', block_number: 1026, log_index: 2, bnb_amount: 0.1, token_amount: 2 * M }));
  for (const tk of ticks) fa.processTick(tk, {});
  const st = fa._states.get('0xtoken');
  const expectCirc = ticks.reduce((s, tk) =>
    s + (tk.trade_type === 'buy' ? tk.token_amount : -tk.token_amount), 0);
  check('G1 _circTokens == 独立重算 Σ买−Σ卖（全量重放对拍）', () =>
    assert.strictEqual(st._circTokens, expectCirc));
  const f = fa.buildFactorMap('0xtoken', T0 + 25000); // cutoff=15000
  // ★二次口径修正：块买家 wt1 卖 5M → 分子 124.93-5=119.93M；流通 197.36-5-2=190.36M
  // → 63.0%（旧毛买入口径只缩分母=65.6%——块买家卖出后不再算控盘，这是新语义的核心）
  check('G2 块买家卖出 → 分子分母同降（119.93/190.36 = 63.0）', () =>
    assert.ok(Math.abs(f.maxBlockBuyCircPct - 63.0) < 0.05, `got ${f.maxBlockBuyCircPct}`));
  check('G3 卖腿不进首买事件（size 仍 5，簇形不变）', () => assert.strictEqual(f.bundleClusterSize, 5));
  // G4 ★가나디现场反证（0xa270…7777，2026-10-20）：最大块买家全部清仓 → 分子归 0 → 因子 0
  // （旧毛买入口径下该票显示 120.5%——买入 127.5M 后 7 秒卖光，筹码已不在他手上）
  const fa2 = newFA();
  fa2.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'wBig', block_number: 700, log_index: 1,
    bnb_amount: 0.581, token_amount: 127.5 * M }), {});
  fa2.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'wR', block_number: 701, log_index: 1,
    bnb_amount: 0.1, token_amount: 10 * M }), {});
  check('G4 买家未卖时 = 127.5/137.5 ≈ 92.7', () =>
    assert.ok(Math.abs(fa2.buildFactorMap('0xtoken', T0 + 3000).maxBlockBuyCircPct - 92.7) < 0.1,
      `got ${fa2.buildFactorMap('0xtoken', T0 + 3000).maxBlockBuyCircPct}`));
  fa2.processTick(mkTick({ timestamp: T0 + 4000, trader_address: 'wBig', trade_type: 'sell',
    block_number: 702, log_index: 1, bnb_amount: 0.6, token_amount: 127.5 * M }), {});
  check('G5 买家清仓 → 因子归 0（가나디 案：卖掉的筹码不算控盘；毛买入口径会虚显 >100%）', () =>
    assert.strictEqual(fa2.buildFactorMap('0xtoken', T0 + 5000).maxBlockBuyCircPct, 0));
}

// ═══════════════ H. 空窗零值 + 探针 ═══════════════
console.log('H. 空窗零值 + 键集探针');
{
  const fa = newFA();
  const f = fa.buildFactorMap('0xtoken', T0 + 60000);
  check('H1 无 tick → 8 键全 0 非 null（有证据零值；maxBlockBuyCircPct 全史口径同 0）', () => {
    for (const k of ['bundleClusterSize', 'bundleClusterSharePct', 'bundleClusterAmountRatio',
      'bundleClusterEvenGap', 'bundleClusterSameTrader', 'maxBlockBuyCircPct',
      'bundleClusterHoldCircPct', 'top2BundleClusterHoldCircPct']) {
      assert.strictEqual(f[k], 0, k);
    }
  });
  check('H2 getFactorKeys 探针含 8 键（出键自动性——三防线零登记）', () => {
    const keys = fa.getFactorKeys();
    for (const k of ['bundleClusterSize', 'bundleClusterSharePct', 'bundleClusterAmountRatio',
      'bundleClusterEvenGap', 'bundleClusterSameTrader', 'maxBlockBuyCircPct',
      'bundleClusterHoldCircPct', 'top2BundleClusterHoldCircPct']) {
      assert.ok(keys.has(k), `缺 ${k}`);
    }
  });
  const { getAvailableFactorIds } = require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));
  check('H3 getAvailableFactorIds 含 7 键（引擎装载键集）', () => {
    const ids = getAvailableFactorIds();
    for (const k of ['bundleClusterSize', 'bundleClusterSharePct', 'maxBlockBuyCircPct',
      'bundleClusterHoldCircPct']) {
      assert.ok(ids.has(k), `缺 ${k}`);
    }
  });
}

// ═══════════════ I. 参数覆盖 + blk 缺失 ═══════════════
console.log('I. factorParams.bundleWinMs 覆盖 + blk 缺失行');
{
  const fa = newFA({ bundleWinMs: 3000 });
  fa.processTick(mkTick({ timestamp: T0 + 8000, trader_address: 'wP', block_number: 500, log_index: 1,
    bnb_amount: 1, token_amount: 10 * M }), {});
  fa.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'wQ', block_number: 501, log_index: 1,
    bnb_amount: 2, token_amount: 20 * M }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 9000); // 3s 窗：8s 留 / 2s 出局
  check('I1 3s 窗覆盖生效（size=1，share=100）', () => {
    assert.strictEqual(f.bundleClusterSize, 1);
    assert.strictEqual(f.bundleClusterSharePct, 100);
  });
  check('I2 部分覆盖不破坏其余默认（_fp 合并垫底）', () => assert.strictEqual(fa._fp.riseMinTicks, 8));

  const fa2 = newFA();
  fa2.processTick(mkTick({ timestamp: T0 + 5000, trader_address: 'wN', block_number: null, log_index: null,
    bnb_amount: 0.5, token_amount: 10 * M }), {});
  const f2 = fa2.buildFactorMap('0xtoken', T0 + 6000);
  check('I3 blk 缺失行不聚簇不炸（size=0，买量照计 share 分母与流通）', () => {
    assert.strictEqual(f2.bundleClusterSize, 0);
    assert.strictEqual(f2.bundleClusterSharePct, 0);
    assert.strictEqual(f2.maxBlockBuyCircPct, 0); // block agg 跳过 null blk
    assert.strictEqual(fa2._states.get('0xtoken')._circTokens, 10 * M);
  });
}

// ═══════════════ J. 源码口径断言 ═══════════════
console.log('J. 源码口径断言（防前视/防误删防线）');
{
  const src = read('src/services/FourMemeFactorAggregator.js');
  check('J1 读点/裁剪点无 Date.now（防前视红线；第三参 out=扫描明细容器，引擎路径不传零变化）', () => {
    for (const name of ['_bundleClusterFactors(state, now, circDen, out) {', '_pruneBundleEvents(state, now) {']) {
      const start = src.indexOf(name);
      assert.ok(start > 0, `${name} 未找到`);
      const end = src.indexOf('\n    }', start);
      assert.ok(!src.slice(start, end).includes('Date.now'), `${name} 体内禁 Date.now`);
    }
  });
  check('J2 读点纯函数无副作用（本地 Map 构建合法，state 容器/标量只读）', () => {
    const start = src.indexOf('_bundleClusterFactors(state, now) {');
    const end = src.indexOf('\n    }', start);
    const body = src.slice(start, end);
    assert.ok(!/\bstate\.[A-Za-z_]+\.(set|push|splice|delete|shift|unshift)\(/.test(body), '读点不得写 state 容器');
    assert.ok(!/state\._circTokens\s*(\+=|-=|=)/.test(body), '读点不得改流通标量');
  });
  check('J3 写点在 _applyWalletAggregation 体内（每 tick 恰一次，tickBuildSkip 无互斥的前提）', () => {
    const mStart = src.indexOf('_applyWalletAggregation(state, tick, vars) {');
    const mEnd = src.indexOf('\n    }', mStart);
    const body = src.slice(mStart, mEnd);
    assert.ok(body.includes('state._bundleEvents.push'), '_bundleEvents.push 不在体内');
    assert.ok(body.includes('state._circTokens += isBuy ? tokenAmount : -tokenAmount'), '_circTokens 双腿累计不在体内');
    assert.ok(!body.includes('Date.now'), '写点段禁 Date.now（now 由 tick.timestamp 供给）');
  });
  check('J4 首买判定 min 替换非 Set 判重（乱序晚到更早首买顶掉伪首买）', () => {
    const mStart = src.indexOf('_applyWalletAggregation(state, tick, vars) {');
    const mEnd = src.indexOf('\n    }', mStart);
    const body = src.slice(mStart, mEnd);
    assert.ok(body.includes('_walletFirstBuyTs.get'), '首买判据应查 _walletFirstBuyTs');
    assert.ok(/_pb === undefined \|\| tick\.timestamp < _pb/.test(body), 'min 替换语义（< 才重置）');
  });
  check('J5 _walletFirstBuyTs 全史不裁（裁=复买误判新首买混进簇）', () => {
    const start = src.indexOf('_pruneBundleEvents(state, now) {');
    const end = src.indexOf('\n    }', start);
    const body = src.slice(start, end);
    assert.ok(!body.includes('_walletFirstBuyTs'), '_pruneBundleEvents 不得触碰全史首买 Map');
    assert.ok(!body.includes('_circTokens'), '全史流通标量不得裁剪');
    assert.ok(!body.includes('_blockBuyWalletsAll'), '_blockBuyWalletsAll 全史不裁（存量口径原料，裁=块归簇遗忘）');
  });
  check('J6 裁剪余量 2×（2 * this._fp.bundleWinMs）', () => {
    assert.ok(/_pruneBundleEvents[\s\S]{0,600}2 \* this\._fp\.bundleWinMs/.test(src));
  });
  check('J7 因子字面量含 8 键（防误删；maxBlockBuyCircPct 2026-10-20 起为全史口径）', () => {
    for (const k of ['bundleClusterSize: bundle.bundleClusterSize', 'bundleClusterSharePct: bundle.bundleClusterSharePct',
      'bundleClusterAmountRatio: bundle.bundleClusterAmountRatio', 'bundleClusterEvenGap: bundle.bundleClusterEvenGap',
      'bundleClusterSameTrader: bundle.bundleClusterSameTrader', 'maxBlockBuyCircPct: bundle.maxBlockBuyCircPct',
      'bundleClusterHoldCircPct: bundle.bundleClusterHoldCircPct',
      'top2BundleClusterHoldCircPct: bundle.top2BundleClusterHoldCircPct']) {
      assert.ok(src.includes(k), `缺 ${k}`);
    }
  });
  check('J8 FactorBuilder 快照白名单含 8 键（FA 内存环不可重算，不落库即丢）', () => {
    const fb = read('src/trading-engine/core/FactorBuilder.js');
    for (const k of ['bundleClusterSize', 'bundleClusterSharePct', 'bundleClusterAmountRatio',
      'bundleClusterEvenGap', 'bundleClusterSameTrader', 'maxBlockBuyCircPct',
      'bundleClusterHoldCircPct', 'top2BundleClusterHoldCircPct']) {
      assert.ok(fb.includes(`factorResults.${k} ?? null`), `FactorBuilder 缺 ${k}`);
    }
  });
}

// ═══════════════ K. 装载与求值 ═══════════════
console.log('K. StrategyEngine 装载 + ConditionEvaluator 求值（纯读无互斥）');
{
  const { StrategyEngine } = require(path.join(ROOT, 'src', 'strategies', 'StrategyEngine.js'));
  const { getAvailableFactorIds } = require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));
  check('K1 腿 condition 引用 bundle* 键装载成功', () => {
    const se = new StrategyEngine();
    se.loadStrategies([{
      id: 's1', name: 'bundle-leg', action: 'buy', priority: 1,
      condition: 'bundleClusterSharePct < 60 AND bundleClusterSize < 5 AND age < 1.5',
    }], getAvailableFactorIds());
    assert.strictEqual(se._strategies.length, 1);
  });
  check('K2 ConditionEvaluator 直评（BITCAT 形状被拦 / 散户形状放行）', () => {
    const { ConditionEvaluator } = require(path.join(ROOT, 'src', 'strategies', 'ConditionEvaluator.js'));
    const ev = new ConditionEvaluator();
    const gate = 'bundleClusterSharePct < 60 AND bundleClusterSize < 5';
    assert.strictEqual(ev.evaluate(gate, { bundleClusterSharePct: 52.6, bundleClusterSize: 5 }), false);
    assert.strictEqual(ev.evaluate(gate, { bundleClusterSharePct: 11.9, bundleClusterSize: 4 }), true);
    assert.strictEqual(ev.evaluate(gate, { bundleClusterSharePct: 0, bundleClusterSize: 0 }), true); // 空窗放行
  });
}

// ═══════════════ M. TOP1 持仓集中度（2026-10-16 用户裁定门键）═══════════════
console.log('M. top1HolderCircPct（TOP1 净持仓 ÷ 流通）');
{
  // M1 BITCAT 场景：5 bundler 等额各 24.986M → top1 = 24.986M / 197.36M ≈ 12.66
  // （捆绑团伙刻意分散持仓时 top1 不高——本键拦的是囤筹集中，团伙盘靠 share 门）
  {
    const fa = newFA();
    for (const tk of bitcatTicks()) fa.processTick(tk, {});
    const f = fa.buildFactorMap('0xtoken', T0 + 24000);
    check('M1 BITCAT top1 ≈ 12.66（等额簇单钱包 24.986M/流通 197.36M）', () =>
      assert.ok(Math.abs(f.top1HolderCircPct - 12.66) < 0.05, `got ${f.top1HolderCircPct}`));
  }
  // M2 巨鲸囤筹：wX 独买 80M、wY/wZ 各 10M → top1=80（单巨鲸垄断筹码）
  {
    const fa = newFA();
    fa.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'wX', block_number: 50, log_index: 1, bnb_amount: 8, token_amount: 80 * M }), {});
    fa.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'wY', block_number: 51, log_index: 1, bnb_amount: 1, token_amount: 10 * M }), {});
    fa.processTick(mkTick({ timestamp: T0 + 3000, trader_address: 'wZ', block_number: 52, log_index: 1, bnb_amount: 1, token_amount: 10 * M }), {});
    check('M2 巨鲸囤筹 top1 = 80（80M/100M）', () =>
      assert.ok(Math.abs(fa.buildFactorMap('0xtoken', T0 + 5000).top1HolderCircPct - 80) < 1e-9));
    // wX 清仓 → 负净持仓出局，top1 降为 wY/wZ 的 10M/30M
    fa.processTick(mkTick({ timestamp: T0 + 8000, trader_address: 'wX', block_number: 60, log_index: 1,
      trade_type: 'sell', bnb_amount: 8, token_amount: 80 * M }), {});
    check('M3 巨鲸清仓后 top1 = 50（wX 归零出局；流通同步缩至 20M，10M/20M——分母随卖腿收缩是口径特性）', () =>
      assert.ok(Math.abs(fa.buildFactorMap('0xtoken', T0 + 9000).top1HolderCircPct - 50) < 0.05));
  }
  // M4 空 state / 全卖光 → 0（有证据零值非 null；流通 0 防除零）
  {
    const fa = newFA();
    check('M4 无 tick → top1 = 0（流通 0 防除零）', () =>
      assert.strictEqual(fa.buildFactorMap('0xtoken', T0 + 6000).top1HolderCircPct, 0));
    fa.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'wX', block_number: 50, log_index: 1,
      bnb_amount: 1, token_amount: 10 * M }), {});
    fa.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'wX', block_number: 51, log_index: 1,
      trade_type: 'sell', bnb_amount: 1, token_amount: 10 * M }), {});
    check('M5 全卖光流通=0 → top1 = 0（Σ买−Σ卖=0 防除零）', () =>
      assert.strictEqual(fa.buildFactorMap('0xtoken', T0 + 6000).top1HolderCircPct, 0));
  }
  // M6 乱序 parity：巨鲸场景逆序喂（_walletNetTokens 加减法交换律 + max 序无关）
  {
    const faA = newFA(), faB = newFA();
    const tks = [
      mkTick({ timestamp: T0 + 1000, trader_address: 'wX', block_number: 50, log_index: 1, bnb_amount: 8, token_amount: 80 * M }),
      mkTick({ timestamp: T0 + 2000, trader_address: 'wY', block_number: 51, log_index: 1, bnb_amount: 1, token_amount: 10 * M }),
      mkTick({ timestamp: T0 + 3000, trader_address: 'wX', block_number: 52, log_index: 1, trade_type: 'sell', bnb_amount: 3, token_amount: 30 * M }),
    ];
    for (const tk of tks) faA.processTick(tk, {});
    for (const tk of [tks[2], tks[1], tks[0]]) faB.processTick(tk, {});
    const a = faA.buildFactorMap('0xtoken', T0 + 5000), b = faB.buildFactorMap('0xtoken', T0 + 5000);
    check('M6 逆序喂 top1 bit 一致（50/60 净持仓，交换律）', () =>
      assert.strictEqual(b.top1HolderCircPct, a.top1HolderCircPct));
  }
  // M7 探针与白名单
  {
    const fa = newFA();
    const keys = fa.getFactorKeys();
    check('M7 getFactorKeys 含 top1HolderCircPct（出键自动性）', () =>
      assert.ok(keys.has('top1HolderCircPct')));
    const { getAvailableFactorIds } = require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));
    check('M8 getAvailableFactorIds 含键（引擎装载）', () =>
      assert.ok(getAvailableFactorIds().has('top1HolderCircPct')));
    const fb = read('src/trading-engine/core/FactorBuilder.js');
    check('M9 FactorBuilder 快照白名单含键（内存环不可重算，不落库即丢）', () =>
      assert.ok(fb.includes('factorResults.top1HolderCircPct ?? null')));
    const src = read('src/services/FourMemeFactorAggregator.js');
    check('M10 字面量与读段在场（防误删；读段单趟扫 max 纯读）', () => {
      assert.ok(src.includes('top1HolderCircPct,'));
      assert.ok(/let _top1Net = 0;\s*\n\s*for \(const v of state\._walletNetTokens\.values\(\)\) if \(v > _top1Net\) _top1Net = v;/.test(src));
    });
  }
}

// ═══════════════ N. FLY 等额镜像对现场反证（2026-10-16 金额优先改口径驱动案）═══════════════
console.log('N. FLY 等额镜像对（0xbf00+0xd6ab395c 同 block 等额 0.3705×2 vs 散户簇）');
{
  // FLY 真实形状缩微：散买垫分母 + 093 散户簇 0.271 + 092 等额对 0.741（全走 GMGN）
  const fa = newFA();
  const t = [];
  t.push(mkTick({ timestamp: T0 + 16000, trader_address: 'eoa1', sender_address: 'wbg1',
    block_number: 1016, log_index: 5, bnb_amount: 0.10, token_amount: 20 * M }));
  t.push(mkTick({ timestamp: T0 + 17000, trader_address: 'eoa2', sender_address: 'wbg2',
    block_number: 1017, log_index: 7, bnb_amount: 0.065, token_amount: 13 * M }));
  const famts = [0.08, 0.16, 0.011, 0.02], flis = [10, 25, 31, 60];   // 093 散户簇 0.271
  for (let i = 0; i < 4; i++) {
    t.push(mkTick({ timestamp: T0 + 15000, trader_address: `eoaF${i}`, sender_address: `wf${i}`,
      block_number: 1015, log_index: flis[i], bnb_amount: famts[i], token_amount: famts[i] * 200 * M }));
  }
  // 等额镜像对 block 1023（FLY：0xbf004bff/0xd6ab395c 各 0.3705 同 block 首买）
  t.push(mkTick({ timestamp: T0 + 23000, trader_address: ROUTER, sender_address: 'wm1',
    block_number: 1023, log_index: 18, bnb_amount: 0.3705, token_amount: 64.93 * M }));
  t.push(mkTick({ timestamp: T0 + 23000, trader_address: ROUTER, sender_address: 'wm2',
    block_number: 1023, log_index: 41, bnb_amount: 0.3705, token_amount: 57.2 * M }));
  for (const tk of t) fa.processTick(tk, {});
  const f = fa.buildFactorMap('0xtoken', T0 + 24000); // cutoff=14000：全部窗内
  check('N1 best=等额对（0.741 > 散户簇 0.271）→ size=2（旧 size 口径选 size4 散户簇只显 22% 是漏检）', () =>
    assert.strictEqual(f.bundleClusterSize, 2));
  check('N2 sharePct ≈ 62.9（0.741/1.1775——钱包簇真实占比，远超 50 门线）', () =>
    assert.ok(Math.abs(f.bundleClusterSharePct - 62.9) < 0.15, `got ${f.bundleClusterSharePct}`));
  check('N3 amountRatio = 1（等额镜像）', () =>
    assert.ok(Math.abs(f.bundleClusterAmountRatio - 1) < 1e-9));
  check('N4 sameTrader = 100（双行全 GMGN 路由）', () =>
    assert.strictEqual(f.bundleClusterSameTrader, 100));
  // N5 巨鲸单买也是簇：单钱包 0.8 BNB vs 散户簇 0.89——0.8<0.89 时仍选散户簇，
  //    金额 1.2 时选巨鲸（「一个钱包占五成买盘」语义由 size1 簇承载）
  {
    const fa2 = newFA();
    fa2.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'eoaW', sender_address: 'wW',
      block_number: 500, log_index: 1, bnb_amount: 1.2, token_amount: 200 * M }), {});
    fa2.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'eoa1', sender_address: 'ws1',
      block_number: 501, log_index: 1, bnb_amount: 0.3, token_amount: 50 * M }), {});
    fa2.processTick(mkTick({ timestamp: T0 + 3000, trader_address: 'eoa2', sender_address: 'ws2',
      block_number: 501, log_index: 2, bnb_amount: 0.3, token_amount: 50 * M }), {});
    fa2.processTick(mkTick({ timestamp: T0 + 4000, trader_address: 'eoa3', sender_address: 'ws3',
      block_number: 501, log_index: 3, bnb_amount: 0.3, token_amount: 50 * M }), {});
    const f2 = fa2.buildFactorMap('0xtoken', T0 + 6000);
    check('N5 巨鲸单买簇（1.2 > 0.9）→ size=1 share=57.1（1.2/2.1）', () => {
      assert.strictEqual(f2.bundleClusterSize, 1);
      assert.ok(Math.abs(f2.bundleClusterSharePct - 57.1) < 0.15, `got ${f2.bundleClusterSharePct}`);
    });
  }
  // N6 源码锁：best 选择段金额优先（防回退到 size 优先——FLY 漏检现场）
  {
    const src = read('src/services/FourMemeFactorAggregator.js');
    const start = src.indexOf('_bundleClusterFactors(state, now, circDen, out) {');
    const end = src.indexOf('\n    }', start);
    const body = src.slice(start, end);
    check('N6 源码锁：簇选择 c.bnb > best.c.bnb 金额优先', () => {
      assert.ok(/c\.bnb > best\.c\.bnb/.test(body), '金额优先比较不在读点体内');
      assert.ok(!/c\.rows\.length > best\.c\.rows\.length\s*\|\|\s*\(c\.rows\.length === best\.c\.rows\.length\s*&&\s*\(c\.bnb/.test(body), '旧 size 优先形状不得回流');
    });
  }
}

// ═══════════════ L. FactorBuilder 快照透传 ═══════════════
console.log('L. FactorBuilder 快照透传');
{
  const { buildFactorValuesForTimeSeries } =
    require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));
  const KEYS = ['bundleClusterSize', 'bundleClusterSharePct', 'bundleClusterAmountRatio',
    'bundleClusterEvenGap', 'bundleClusterSameTrader', 'maxBlockBuyCircPct',
    'bundleClusterHoldCircPct', 'top2BundleClusterHoldCircPct',
    'top3BundleClusterHoldCircPct', 'top1HolderCircPct'];
  const sample = {
    bundleClusterSize: 5, bundleClusterSharePct: 52.6, bundleClusterAmountRatio: 1.0,
    bundleClusterEvenGap: 1, bundleClusterSameTrader: 100, maxBlockBuyCircPct: 63.3,
    bundleClusterHoldCircPct: 63.3, top2BundleClusterHoldCircPct: 85.8,
    top3BundleClusterHoldCircPct: 92.1, top1HolderCircPct: 12.66,
  };
  check('L1 signal 快照 10 键透传（7 bundle + top2 + top3 + top1）', () => {
    const snap = buildFactorValuesForTimeSeries(sample);
    for (const k of KEYS) assert.strictEqual(snap[k], sample[k], k);
  });
  check('L2 旧输入（FA 无键）→ null 不掩盖', () => {
    const snap = buildFactorValuesForTimeSeries({ currentPrice: 1 });
    for (const k of KEYS) assert.strictEqual(snap[k], null, k);
  });
  check('L3 null 输入早 return {}', () => {
    assert.deepStrictEqual(buildFactorValuesForTimeSeries(null), {});
  });
}

// ═══════════════ O. bundleClusterHoldCircPct 存量口径（2026-10-25 A/B 对比用户裁定）═══════════════
console.log('O. bundleClusterHoldCircPct 存量口径（全块 max 当前正净持仓 ÷ 流通；替换流量口径门位）');
{
  // O1 两键分离反证：选块标准差异——毛买入最大块（maxBlockBuyCircPct 判定）≠ 持仓最大块
  //   （新键判定）。块 200 毛买入 80M 买家清仓、块 210 毛买入 30M 买家囤住：
  //   旧键选块 200 → 分子 0 → 0%；新键选块 210 → 30M/流通 30M = 100%
  const fa1 = newFA();
  fa1.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'wA1', block_number: 200, log_index: 1,
    bnb_amount: 1.0, token_amount: 50 * M }), {});
  fa1.processTick(mkTick({ timestamp: T0 + 1100, trader_address: 'wA2', block_number: 200, log_index: 2,
    bnb_amount: 0.6, token_amount: 30 * M }), {});
  fa1.processTick(mkTick({ timestamp: T0 + 5000, trader_address: 'wB1', block_number: 210, log_index: 1,
    bnb_amount: 0.4, token_amount: 20 * M }), {});
  fa1.processTick(mkTick({ timestamp: T0 + 5100, trader_address: 'wB2', block_number: 210, log_index: 2,
    bnb_amount: 0.2, token_amount: 10 * M }), {});
  fa1.processTick(mkTick({ timestamp: T0 + 9000, trader_address: 'wA1', block_number: 230, log_index: 1,
    trade_type: 'sell', bnb_amount: 1.0, token_amount: 50 * M }), {});
  fa1.processTick(mkTick({ timestamp: T0 + 9100, trader_address: 'wA2', block_number: 230, log_index: 2,
    trade_type: 'sell', bnb_amount: 0.6, token_amount: 30 * M }), {});
  const f1 = fa1.buildFactorMap('0xtoken', T0 + 10000);
  check('O1 两键分离（清仓大块 vs 囤筹小块）：maxBlockBuyCircPct=0 / holdCircPct=100', () => {
    assert.strictEqual(f1.maxBlockBuyCircPct, 0);
    assert.strictEqual(f1.bundleClusterHoldCircPct, 100);
  });

  // O2 买后清仓回落（A/B 对比 BNB Legend 形状：流量门 100 误拦 34s——交易簇应放行）
  //   簇清仓后存量键由散户块接管（簇块归 0），对照流量键 sharePct 在窗内仍 100（流量不回落）
  const fa2 = newFA();
  fa2.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'wT1', block_number: 300, log_index: 1,
    bnb_amount: 0.6, token_amount: 30 * M }), {});
  fa2.processTick(mkTick({ timestamp: T0 + 1100, trader_address: 'wT2', block_number: 300, log_index: 2,
    bnb_amount: 0.6, token_amount: 30 * M }), {});
  fa2.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'wR', block_number: 310, log_index: 1,
    bnb_amount: 0.2, token_amount: 10 * M }), {});
  fa2.processTick(mkTick({ timestamp: T0 + 2500, trader_address: 'wR2', block_number: 320, log_index: 1,
    bnb_amount: 0.2, token_amount: 10 * M }), {});
  const f2a = fa2.buildFactorMap('0xtoken', T0 + 3000);
  check('O2a 簇持仓期 holdCircPct = 75（60M/流通 80M）', () =>
    assert.ok(Math.abs(f2a.bundleClusterHoldCircPct - 75) < 0.05, `got ${f2a.bundleClusterHoldCircPct}`));
  fa2.processTick(mkTick({ timestamp: T0 + 5000, trader_address: 'wT1', block_number: 330, log_index: 1,
    trade_type: 'sell', bnb_amount: 0.6, token_amount: 30 * M }), {});
  fa2.processTick(mkTick({ timestamp: T0 + 5100, trader_address: 'wT2', block_number: 330, log_index: 2,
    trade_type: 'sell', bnb_amount: 0.6, token_amount: 30 * M }), {});
  const f2b = fa2.buildFactorMap('0xtoken', T0 + 6000);
  check('O2b 簇清仓 → 簇块归 0、散户块接管 50（10M/流通 20M）；流量键窗内仍 75（语义反证）', () => {
    assert.strictEqual(f2b.bundleClusterHoldCircPct, 50);
    assert.strictEqual(f2b.bundleClusterSharePct, 75);
  });

  // O3 真囤簇持续可见（OST 形状）+ 时间无关：簇事件滑出 bundleWinMs 后流量键归 0、
  //    存量键全史不裁仍 64.9（24M/37M；真囤=已知盲区——对真囤簇更晚放，用户裁定接受）
  const fa3 = newFA();
  fa3.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'wH1', block_number: 400, log_index: 1,
    bnb_amount: 0.48, token_amount: 24 * M }), {});
  fa3.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'wR1', block_number: 410, log_index: 1,
    bnb_amount: 0.26, token_amount: 13 * M }), {});
  const f3 = fa3.buildFactorMap('0xtoken', T0 + 30000); // 簇事件全出 10s 窗
  check('O3 出窗后：流量键归 0 / 存量键保留 64.9（全史属性不随窗滑出遗忘）', () => {
    assert.strictEqual(f3.bundleClusterSharePct, 0);
    assert.ok(Math.abs(f3.bundleClusterHoldCircPct - 64.9) < 0.05, `got ${f3.bundleClusterHoldCircPct}`);
  });

  // O4 数学不变量：holdCircPct ≥ maxBlockBuyCircPct 恒成立（前者扫全部块取 max，
  //    后者只扫毛买入最大块——搜索域包含关系）+ BITCAT 场景同值 63.3（毛买入最大块
  //    恰是持仓最大块）
  const fa4 = newFA();
  for (const tk of bitcatTicks()) fa4.processTick(tk, {});
  const f4 = fa4.buildFactorMap('0xtoken', T0 + 24000);
  check('O4 BITCAT 场景 holdCircPct = 63.3 = maxBlockBuyCircPct（不变量 ≥ 且同块同值）', () => {
    assert.ok(Math.abs(f4.bundleClusterHoldCircPct - 63.3) < 0.05, `got ${f4.bundleClusterHoldCircPct}`);
    assert.ok(f4.bundleClusterHoldCircPct >= f4.maxBlockBuyCircPct);
  });

  // O5 prune 全史反证：>64 块触发 _blockBuyAgg 滑窗淘汰后，_blockBuyWalletsAll 保留、
  //    新键不归零；且淘汰后同块晚到回推行（defer 乱序形状）Set 并入不丢旧买家
  //    （与 _blockBuyAgg 共引用会被 prune+重建断裂丢 wOld——防线反证）
  const fa5 = newFA();
  fa5.processTick(mkTick({ timestamp: T0 + 0, trader_address: 'wOld', block_number: 1, log_index: 1,
    bnb_amount: 1.0, token_amount: 50 * M }), {});
  for (let i = 0; i < 68; i++) {
    fa5.processTick(mkTick({ timestamp: T0 + 100 + i * 300, trader_address: `w${i}`, block_number: 100 + i,
      log_index: 1, bnb_amount: 0.02, token_amount: 1 * M }), {});
  }
  // prune 由 processTick 尾部触发（读点不裁）：末尾晚 tick 推进裁剪时钟，69 早期块全出 2× 窗
  fa5.processTick(mkTick({ timestamp: T0 + 60000, trader_address: 'wEnd', block_number: 999, log_index: 1,
    bnb_amount: 0.02, token_amount: 1 * M }), {});
  const st5 = fa5._states.get('0xtoken');
  const f5a = fa5.buildFactorMap('0xtoken', T0 + 60000);
  check('O5a prune 后 _blockBuyAgg 只剩当前块 / _blockBuyWalletsAll 保留 70 块 / 键 42 不归零', () => {
    assert.strictEqual(st5._blockBuyAgg.size, 1);
    assert.strictEqual(st5._blockBuyWalletsAll.size, 70);
    assert.ok(Math.abs(f5a.bundleClusterHoldCircPct - 42.0) < 0.05, `got ${f5a.bundleClusterHoldCircPct}`);
  });
  fa5.processTick(mkTick({ timestamp: T0 + 500, trader_address: 'wLate', block_number: 1, log_index: 5,
    bnb_amount: 0.1, token_amount: 5 * M }), {}); // 块 1 晚到回推（_blockBuyAgg 已无此块条目）
  const f5b = fa5.buildFactorMap('0xtoken', T0 + 60000);
  check('O5b 回推并集不丢旧买家（wOld 50M + wLate 5M = 55M/流通 124M = 44.4）', () =>
    assert.ok(Math.abs(f5b.bundleClusterHoldCircPct - 44.4) < 0.05, `got ${f5b.bundleClusterHoldCircPct}`));

  // O6 复买去重：同钱包同块两笔买 → Set 单钱包（若重复元素会虚计 2× 持仓）
  const fa6 = newFA();
  fa6.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'w1', block_number: 500, log_index: 1,
    bnb_amount: 0.2, token_amount: 10 * M }), {});
  fa6.processTick(mkTick({ timestamp: T0 + 1500, trader_address: 'w1', block_number: 500, log_index: 2,
    bnb_amount: 0.2, token_amount: 10 * M }), {}); // w1 复买同块
  const f6 = fa6.buildFactorMap('0xtoken', T0 + 2000);
  check('O6 同钱包同块复买 Set 去重（holdCircPct = 100 非 200）', () =>
    assert.strictEqual(f6.bundleClusterHoldCircPct, 100));

  // O7 源码防线：写点在 _applyWalletAggregation 体内（每 tick 恰一次）+ 独立 Map
  //    不与 _blockBuyAgg 的 wallets 共引用（prune 断裂防线）
  {
    const src = read('src/services/FourMemeFactorAggregator.js');
    check('O7 写点在位且独立 Map（_blockBuyWalletsAll.set 在 wallet 聚合体内）', () => {
      const mStart = src.indexOf('_applyWalletAggregation(state, tick, vars) {');
      const mEnd = src.indexOf('\n    }', mStart);
      const body = src.slice(mStart, mEnd);
      assert.ok(body.includes('state._blockBuyWalletsAll.set'), '_blockBuyWalletsAll 写点不在体内');
    });
    check('O8 _maxBuyBlockWallets 刻意不指向 _blockBuyWalletsAll 的 Set（两结构独立）', () => {
      const src2 = read('src/services/FourMemeFactorAggregator.js');
      assert.ok(!src2.includes('_blockBuyWalletsAll.get(blockNumber).wallets'));
      assert.ok(/state\._maxBuyBlockWallets = _bbCur\.wallets/.test(src2), '旧 max 块引用语义不得漂移');
    });
  }

  // P. top2BundleClusterHoldCircPct 第二道门（2026-10-25 AIFLY 0x0bae…7777 案用户裁定）
  console.log('P. top2BundleClusterHoldCircPct（最大两块买家并集去重正净持仓 ÷ 流通）');
  {
    // P1 并集去重：wA 复买跨块（blk200 30M + blk220 10M=净 40M）两块 sum 同 40 tie，
    //    并集 {wA}=40M/流通 60M = 66.7；相加口径 80M/60M=133% 虚超 100%（去重反证）
    {
      const fa = newFA();
      fa.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'wA', block_number: 200, log_index: 1,
        bnb_amount: 3.0, token_amount: 30 * M }), {});
      fa.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'wB', block_number: 210, log_index: 1,
        bnb_amount: 2.0, token_amount: 20 * M }), {});
      fa.processTick(mkTick({ timestamp: T0 + 3000, trader_address: 'wA', block_number: 220, log_index: 1,
        bnb_amount: 1.0, token_amount: 10 * M }), {});
      const f = fa.buildFactorMap('0xtoken', T0 + 4000);
      check('P1 复买跨块并集去重（top1=66.7 / top2=66.7 非 133）', () => {
        assert.ok(Math.abs(f.bundleClusterHoldCircPct - 66.7) < 0.05, `top1 got ${f.bundleClusterHoldCircPct}`);
        assert.ok(Math.abs(f.top2BundleClusterHoldCircPct - 66.7) < 0.05, `top2 got ${f.top2BundleClusterHoldCircPct}`);
      });
    }

    // P2 不重叠两块相加语义：wX 36M + wY 24M / 流通 60M → top1=60 / top2=100
    {
      const fa = newFA();
      fa.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'wX', block_number: 200, log_index: 1,
        bnb_amount: 3.6, token_amount: 36 * M }), {});
      fa.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'wY', block_number: 210, log_index: 1,
        bnb_amount: 2.4, token_amount: 24 * M }), {});
      const f = fa.buildFactorMap('0xtoken', T0 + 3000);
      check('P2 不重叠两块 top2=100（36+24 / 60），top1=60', () => {
        assert.ok(Math.abs(f.bundleClusterHoldCircPct - 60) < 0.05);
        assert.ok(Math.abs(f.top2BundleClusterHoldCircPct - 100) < 0.05);
      });
    }

    // P3 单块退化：不足两块 → top2 = top1（并集自然结果）
    {
      const fa = newFA();
      fa.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'wX', block_number: 200, log_index: 1,
        bnb_amount: 1.0, token_amount: 40 * M }), {});
      fa.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'wX', block_number: 210, log_index: 1,
        bnb_amount: 1.0, token_amount: 20 * M }), {});
      const f = fa.buildFactorMap('0xtoken', T0 + 3000);
      check('P3 单块票 top2 退化 = top1 = 100', () =>
        assert.strictEqual(f.top2BundleClusterHoldCircPct, 100));
    }

    // P4 AIFLY 现场缩微（fire 时刻）：bundler 块剩仓 91M + 囤筹块 58.5M + 散户垫 112.2M
    //    （拆两块各 56.1M 防散户块自身成 top1）= 流通 261.7M → top1=34.8（擦线过 35 门）/
    //    top2=57.1（≥50 被新门拦——本案裁定现场）
    {
      const fa = newFA();
      fa.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'wR1', block_number: 190, log_index: 1,
        bnb_amount: 5.61, token_amount: 56.1 * M }), {});
      fa.processTick(mkTick({ timestamp: T0 + 1100, trader_address: 'wR2', block_number: 191, log_index: 1,
        bnb_amount: 5.61, token_amount: 56.1 * M }), {});
      fa.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'wB1', block_number: 200, log_index: 1,
        bnb_amount: 9.1, token_amount: 91 * M }), {});
      fa.processTick(mkTick({ timestamp: T0 + 3000, trader_address: 'wF', block_number: 201, log_index: 1,
        bnb_amount: 5.85, token_amount: 58.5 * M }), {});
      const f = fa.buildFactorMap('0xtoken', T0 + 4000);
      check('P4 AIFLY 现场缩微：top1=34.8 擦线过门 / top2=57.1 被第二道门拦', () => {
        assert.ok(Math.abs(f.bundleClusterHoldCircPct - 34.8) < 0.05, `top1 got ${f.bundleClusterHoldCircPct}`);
        assert.ok(Math.abs(f.top2BundleClusterHoldCircPct - 57.1) < 0.05, `top2 got ${f.top2BundleClusterHoldCircPct}`);
      });
    }

    // P5 不变量 top2 ≥ top1 恒（并集域 ⊇ top1 域）+ BITCAT 场景 63.3 → top2=85.8
    //    （真簇 124.93M ∪ 假簇 44.5M = 169.43M / 流通 197.36M）
    {
      const fa = newFA();
      for (const tk of bitcatTicks()) fa.processTick(tk, {});
      const f = fa.buildFactorMap('0xtoken', T0 + 24000);
      check('P5 BITCAT top2=85.8 ≥ top1=63.3（并集含假簇块）', () => {
        assert.ok(Math.abs(f.top2BundleClusterHoldCircPct - 85.8) < 0.05, `got ${f.top2BundleClusterHoldCircPct}`);
        assert.ok(f.top2BundleClusterHoldCircPct >= f.bundleClusterHoldCircPct);
      });
    }

    // P6 乱序 parity：P4 场景逆序喂 bit 一致（top1/top2 追踪交换律 + 并集去重序无关）
    {
      const mk = () => {
        const fa = newFA();
        fa.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'wR1', block_number: 190, log_index: 1,
          bnb_amount: 11.22, token_amount: 112.2 * M }), {});
        fa.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'wB1', block_number: 200, log_index: 1,
          bnb_amount: 9.1, token_amount: 91 * M }), {});
        fa.processTick(mkTick({ timestamp: T0 + 3000, trader_address: 'wF', block_number: 201, log_index: 1,
          bnb_amount: 5.85, token_amount: 58.5 * M }), {});
        return fa;
      };
      const a = mk();
      const b = newFA();
      b.processTick(mkTick({ timestamp: T0 + 3000, trader_address: 'wF', block_number: 201, log_index: 1,
        bnb_amount: 5.85, token_amount: 58.5 * M }), {});
      b.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'wR1', block_number: 190, log_index: 1,
        bnb_amount: 11.22, token_amount: 112.2 * M }), {});
      b.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'wB1', block_number: 200, log_index: 1,
        bnb_amount: 9.1, token_amount: 91 * M }), {});
      assert.strictEqual(a._states.size, 1); // 保序侧引用
      const fa2 = a.buildFactorMap('0xtoken', T0 + 4000), fb2 = b.buildFactorMap('0xtoken', T0 + 4000);
      check('P6 逆序喂 top1/top2 bit 一致', () => {
        assert.strictEqual(fb2.bundleClusterHoldCircPct, fa2.bundleClusterHoldCircPct);
        assert.strictEqual(fb2.top2BundleClusterHoldCircPct, fa2.top2BundleClusterHoldCircPct);
      });
    }
  }
}

// ═══════════════ Q. top3BundleClusterHoldCircPct（2026-10-26 同族第三块观察键） ═══════════════
console.log('Q. top3BundleClusterHoldCircPct（最大三块买家并集去重正净持仓 ÷ 流通）');
{
  // Q1 三块不重叠相加：30M + 20M + 10M / 流通 60M → top1=50 / top2=83.3 / top3=100
  {
    const fa = newFA();
    fa.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'wA', block_number: 200, log_index: 1,
      bnb_amount: 3.0, token_amount: 30 * M }), {});
    fa.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'wB', block_number: 210, log_index: 1,
      bnb_amount: 2.0, token_amount: 20 * M }), {});
    fa.processTick(mkTick({ timestamp: T0 + 3000, trader_address: 'wC', block_number: 220, log_index: 1,
      bnb_amount: 1.0, token_amount: 10 * M }), {});
    const f = fa.buildFactorMap('0xtoken', T0 + 4000);
    check('Q1 三块阶梯 top3=100（30+20+10 / 60），top2=83.3，top1=50', () => {
      assert.ok(Math.abs(f.bundleClusterHoldCircPct - 50) < 0.05, `top1 got ${f.bundleClusterHoldCircPct}`);
      assert.ok(Math.abs(f.top2BundleClusterHoldCircPct - 83.3) < 0.05, `top2 got ${f.top2BundleClusterHoldCircPct}`);
      assert.ok(Math.abs(f.top3BundleClusterHoldCircPct - 100) < 0.05, `top3 got ${f.top3BundleClusterHoldCircPct}`);
    });
  }

  // Q2 第三块含跨块复买去重：wA blk200 20M + blk230 10M（净 30M 两块同 sum tie），
  //    wB 20M，wC 10M → 块 sum：{wA}=30（tie 两块占 top1/top2）/ {wB}=20 / {wC}=10；
  //    top2 并集 {wA}=30、top3 并集 {wA,wB}∪…=30+20=50 / 流通 60 = 83.3 非 113 虚超
  {
    const fa = newFA();
    fa.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'wA', block_number: 200, log_index: 1,
      bnb_amount: 2.0, token_amount: 20 * M }), {});
    fa.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'wB', block_number: 210, log_index: 1,
      bnb_amount: 2.0, token_amount: 20 * M }), {});
    fa.processTick(mkTick({ timestamp: T0 + 3000, trader_address: 'wC', block_number: 220, log_index: 1,
      bnb_amount: 1.0, token_amount: 10 * M }), {});
    fa.processTick(mkTick({ timestamp: T0 + 4000, trader_address: 'wA', block_number: 230, log_index: 1,
      bnb_amount: 1.0, token_amount: 10 * M }), {});
    const f = fa.buildFactorMap('0xtoken', T0 + 5000);
    check('Q2 wA 复买跨块 tie 占 top1/top2，top3={wA,wB}=50/60=83.3（去重非 30+30+20 虚超）', () => {
      assert.ok(Math.abs(f.top2BundleClusterHoldCircPct - 50) < 0.05, `top2 got ${f.top2BundleClusterHoldCircPct}`);
      assert.ok(Math.abs(f.top3BundleClusterHoldCircPct - 83.3) < 0.05, `top3 got ${f.top3BundleClusterHoldCircPct}`);
    });
  }

  // Q3 退化链：一块 → top2=top3=top1；两块 → top3=top2
  {
    const fa1 = newFA();
    fa1.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'wX', block_number: 200, log_index: 1,
      bnb_amount: 1.0, token_amount: 40 * M }), {});
    const f1 = fa1.buildFactorMap('0xtoken', T0 + 2000);
    check('Q3a 单块票 top3 退化 = top2 = top1 = 100', () => {
      assert.strictEqual(f1.top2BundleClusterHoldCircPct, 100);
      assert.strictEqual(f1.top3BundleClusterHoldCircPct, 100);
    });
    const fa2 = newFA();
    fa2.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'wX', block_number: 200, log_index: 1,
      bnb_amount: 2.0, token_amount: 20 * M }), {});
    fa2.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'wY', block_number: 210, log_index: 1,
      bnb_amount: 2.0, token_amount: 20 * M }), {});
    const f2 = fa2.buildFactorMap('0xtoken', T0 + 3000);
    check('Q3b 两块票 top3 退化 = top2 = 100', () =>
      assert.strictEqual(f2.top3BundleClusterHoldCircPct, 100));
  }

  // Q4 清仓钱包零贡献（当前正净持仓）+ 第四有效块进并集：wA 30M / wB 20M / wC 10M
  //    清仓（净 0）/ wD 15M → 流通 65M；块 sum {wA}30 {wB}20 {wC}0 {wD}15 →
  //    top1=46.2 / top2=76.9 / top3=100（65/65——清仓块零贡献不虚增分子）
  {
    const fa = newFA();
    fa.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'wA', block_number: 200, log_index: 1,
      bnb_amount: 3.0, token_amount: 30 * M }), {});
    fa.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'wB', block_number: 210, log_index: 1,
      bnb_amount: 2.0, token_amount: 20 * M }), {});
    fa.processTick(mkTick({ timestamp: T0 + 3000, trader_address: 'wC', block_number: 220, log_index: 1,
      bnb_amount: 1.0, token_amount: 10 * M }), {});
    fa.processTick(mkTick({ timestamp: T0 + 4000, trader_address: 'wC', block_number: 230, log_index: 1,
      trade_type: 'sell', bnb_amount: 1.0, token_amount: 10 * M }), {});
    fa.processTick(mkTick({ timestamp: T0 + 5000, trader_address: 'wD', block_number: 240, log_index: 1,
      bnb_amount: 1.5, token_amount: 15 * M }), {});
    const f = fa.buildFactorMap('0xtoken', T0 + 6000);
    check('Q4 清仓块零贡献，top1=46.2 / top2=76.9 / top3=100（65/65）', () => {
      assert.ok(Math.abs(f.bundleClusterHoldCircPct - 46.2) < 0.05, `top1 got ${f.bundleClusterHoldCircPct}`);
      assert.ok(Math.abs(f.top2BundleClusterHoldCircPct - 76.9) < 0.05, `top2 got ${f.top2BundleClusterHoldCircPct}`);
      assert.ok(Math.abs(f.top3BundleClusterHoldCircPct - 100) < 0.05, `top3 got ${f.top3BundleClusterHoldCircPct}`);
    });
  }

  // Q5 乱序 parity：Q1 场景逆序喂 bit 一致（三槽级联交换律 + 并集去重序无关）
  {
    const mk = () => {
      const fa = newFA();
      fa.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'wA', block_number: 200, log_index: 1,
        bnb_amount: 3.0, token_amount: 30 * M }), {});
      fa.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'wB', block_number: 210, log_index: 1,
        bnb_amount: 2.0, token_amount: 20 * M }), {});
      fa.processTick(mkTick({ timestamp: T0 + 3000, trader_address: 'wC', block_number: 220, log_index: 1,
        bnb_amount: 1.0, token_amount: 10 * M }), {});
      return fa;
    };
    const a = mk();
    const b = newFA();
    b.processTick(mkTick({ timestamp: T0 + 3000, trader_address: 'wC', block_number: 220, log_index: 1,
      bnb_amount: 1.0, token_amount: 10 * M }), {});
    b.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'wA', block_number: 200, log_index: 1,
      bnb_amount: 3.0, token_amount: 30 * M }), {});
    b.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'wB', block_number: 210, log_index: 1,
      bnb_amount: 2.0, token_amount: 20 * M }), {});
    const fa2 = a.buildFactorMap('0xtoken', T0 + 4000), fb2 = b.buildFactorMap('0xtoken', T0 + 4000);
    check('Q5 逆序喂 top1/top2/top3 bit 一致', () => {
      assert.strictEqual(fb2.bundleClusterHoldCircPct, fa2.bundleClusterHoldCircPct);
      assert.strictEqual(fb2.top2BundleClusterHoldCircPct, fa2.top2BundleClusterHoldCircPct);
      assert.strictEqual(fb2.top3BundleClusterHoldCircPct, fa2.top3BundleClusterHoldCircPct);
    });
  }

  // Q6 事故现场反证（2026-10-26 v39 崩溃案）：恰两块票第二块持仓和=0（买家全清仓）——
  //    级联第三分支 `_s(0) > _top3Sum(-1)` 恒真，零和块抢占 _top3Ws 而 _top2Ws 仍 null；
  //    修复前读点 `_top2Ws.has(_w)` null has 崩（TickDebouncer 路径无 catch → 进程崩死×2：
  //    v38@3914763 / v39 首启；handleLog 路径被吞成「解码失败」35+ 条）。修复后零和块
  //    零贡献（_v>0 守卫），top2/top3 退化=top1=100（流通 30M）
  {
    const fa = newFA();
    fa.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'wA', block_number: 200, log_index: 1,
      bnb_amount: 3.0, token_amount: 30 * M }), {});
    fa.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'wB', block_number: 210, log_index: 1,
      bnb_amount: 2.0, token_amount: 20 * M }), {});
    fa.processTick(mkTick({ timestamp: T0 + 3000, trader_address: 'wB', block_number: 220, log_index: 1,
      trade_type: 'sell', bnb_amount: 2.0, token_amount: 20 * M }), {}); // wB 清仓 → blk210 块和=0
    const f = fa.buildFactorMap('0xtoken', T0 + 4000);
    check('Q6 零和块抢占第三槽不崩（v39 事故现场）：top1=top2=top3=100（30M/30M）', () => {
      assert.ok(Math.abs(f.bundleClusterHoldCircPct - 100) < 0.05, `top1 got ${f.bundleClusterHoldCircPct}`);
      assert.ok(Math.abs(f.top2BundleClusterHoldCircPct - 100) < 0.05, `top2 got ${f.top2BundleClusterHoldCircPct}`);
      assert.ok(Math.abs(f.top3BundleClusterHoldCircPct - 100) < 0.05, `top3 got ${f.top3BundleClusterHoldCircPct}`);
    });
    // Q6b 对照：三块票第三块零和（_top2Ws 就位正常形状）值不变——真第三块被零和块顶替位无差
    const fa2 = newFA();
    fa2.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'wA', block_number: 200, log_index: 1,
      bnb_amount: 3.0, token_amount: 30 * M }), {});
    fa2.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'wB', block_number: 210, log_index: 1,
      bnb_amount: 2.0, token_amount: 20 * M }), {});
    fa2.processTick(mkTick({ timestamp: T0 + 3000, trader_address: 'wC', block_number: 220, log_index: 1,
      bnb_amount: 1.0, token_amount: 10 * M }), {});
    fa2.processTick(mkTick({ timestamp: T0 + 3500, trader_address: 'wC', block_number: 230, log_index: 1,
      trade_type: 'sell', bnb_amount: 1.0, token_amount: 10 * M }), {}); // wC 清仓 → blk220 块和=0（第三槽）
    const f2 = fa2.buildFactorMap('0xtoken', T0 + 4000);
    check('Q6b 三块票第三块清仓：top1=60 / top2=100 / top3=100（零和槽零贡献）', () => {
      assert.ok(Math.abs(f2.bundleClusterHoldCircPct - 60) < 0.05, `top1 got ${f2.bundleClusterHoldCircPct}`);
      assert.ok(Math.abs(f2.top2BundleClusterHoldCircPct - 100) < 0.05, `top2 got ${f2.top2BundleClusterHoldCircPct}`);
      assert.ok(Math.abs(f2.top3BundleClusterHoldCircPct - 100) < 0.05, `top3 got ${f2.top3BundleClusterHoldCircPct}`);
    });
    // Q6c 源码锁：null 守卫形状在位（防回退到裸 `_top2Ws.has`——回退即复活崩溃）
    check('Q6c 源码锁：top3 并集去重含 _top2Ws null 守卫', () => {
      const src = read('src/services/FourMemeFactorAggregator.js');
      assert.ok(src.includes('if (_top1Ws.has(_w) || (_top2Ws !== null && _top2Ws.has(_w))) continue;'),
        'null 安全守卫不在位');
    });
  }
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
