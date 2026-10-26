#!/usr/bin/env node
/**
 * FA tradesNetBuyRatio / tradesRouterPct 全史实时两键单测（T70 2026-10-26）+ earlyTrades*
 * 族删除防复活反证（T71 2026-10-26）——本地零 DB 零网络。
 *
 * T70 背景（智子 0x4451f373…7777 / 币安1986 0xd6c7e7c9…7777 双案）：earlyTrades* 是出生
 * 锚定 90s 累计窗**冻结**因子，流动性不足市场的慢热票窗后真实参与永远进不了门（智子窗终
 * 值 49.8 差 0.2pp 被净买门拦、币安1986 前 90s 仅 dev 自倒路由占比冻结 0 恒拦）→ 净买/路由
 * 门换全史实时载体。T71 用户裁定 earlyTrades* 十键整族删除（冻结载体已无消费者）。
 *
 * 两键口径（写点=processTick「计数与地址统计」段，全量 tick 无 skip）：
 *   - tradesNetBuyRatio = (Σ买−Σ卖)÷Σ买×100（buy=0 时全卖 −100 / 全空 0——有证据零值）
 *   - tradesRouterPct   = Σ(trader∈AGGREGATOR_ROUTER_ADDRS 的买)÷Σ买×100
 *   - 无窗无冻结：买点时刻全史真值，后续 tick 持续改值
 *   - router 判 **trader 层**；只计买腿；无 outlier/price_usd 过滤（照计语义）
 *
 * 用法：node scripts/_test_fa_early_trades_factors.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'), 'utf8');
const FourMemeFactorAggregator = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'));

const ROUTER = '0x1de460f363af910f51726def188f9004276bf4bc'; // AGGREGATOR_ROUTER_ADDRS 唯一条目（GMGN）

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const T0 = 1790802000000;
const ADDR = '0xtok_trades';

function newFA(factorParams) {
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

// ═══════════════ A. 公式精确值 ═══════════════
console.log('A. 公式精确值');
{
  const fa = newFA();
  feed(fa, [
    { trade_type: 'buy', sender_address: 'a', bnb_amount: 1.0 },
    { trade_type: 'sell', sender_address: 'b', bnb_amount: 0.4 },
  ]);
  check('A1 净买 (1−0.4)/1×100=60', () =>
    assert.strictEqual(F(fa).tradesNetBuyRatio, 60));
  check('A2 无路由买 → tradesRouterPct=0', () =>
    assert.strictEqual(F(fa).tradesRouterPct, 0));
}
{
  const fa = newFA();
  // 复刻币安1986 窗内形状：仅 dev EOA 自倒 1 买 0.3 + 1 卖 0.15
  feed(fa, [
    { sender_address: 'dev', bnb_amount: 0.3, timestamp: T0 + 1000 },
    { trade_type: 'sell', sender_address: 'dev', bnb_amount: 0.15, timestamp: T0 + 2000 },
  ]);
  check('A3 早期读数=当时真值：(0.3−0.15)/0.3×100=50 路由 0', () => {
    const f = F(fa, T0 + 89000);
    assert.strictEqual(f.tradesNetBuyRatio, 50);
    assert.strictEqual(f.tradesRouterPct, 0);
  });
}
{
  const fa = newFA();
  feed(fa, [
    { trade_type: 'buy', sender_address: 'wB', bnb_amount: 0.1 },
  ]);
  check('A4 纯买 → 100', () =>
    assert.strictEqual(F(fa).tradesNetBuyRatio, 100));
}

// ═══════════════ B. 口径反证 ═══════════════
console.log('B. 口径反证');
{
  const fa = newFA();
  feed(fa, [
    { sender_address: 'wX', trader_address: ROUTER, bnb_amount: 0.3 }, // trader=路由 → 计
    { sender_address: ROUTER, trader_address: '0xeoa9', bnb_amount: 0.3 }, // sender=路由 trader=EOA → 不计
  ]);
  check('B1 router 判 trader 层：仅 trader∈路由行计入 → 0.3/0.6=50', () =>
    assert.strictEqual(F(fa).tradesRouterPct, 50));
  const fa3 = newFA();
  feed(fa3, [{ trade_type: 'sell', sender_address: 'wS', trader_address: ROUTER, bnb_amount: 0.2 }]);
  check('B2 只计买腿：路由卖出不抬分子 → 0', () =>
    assert.strictEqual(F(fa3).tradesRouterPct, 0));
}
{
  const fa = newFA();
  feed(fa, [
    { sender_address: 'w1', bnb_amount: 0.7, price_outlier: true, price_usd: null },
  ]);
  check('B3 照计语义：outlier/price_usd 缺失行照进分子（净买 100）', () => {
    const f = F(fa);
    assert.strictEqual(f.tradesNetBuyRatio, 100);
    assert.strictEqual(f.tradesRouterPct, 0);
  });
}

// ═══════════════ C. 全史实时（无窗无冻结）═══════════════
// T70 案复刻：出窗后散户 GMGN 路由蜂拥（币安1986 90-300s 形状）——冻结版恒 0 是本案拦截元凶，
// 实时版必须跟着抬。
console.log('C. 全史实时');
{
  const fa = newFA();
  feed(fa, [
    { sender_address: 'dev', bnb_amount: 0.3, timestamp: T0 + 1000 },
    { trade_type: 'sell', sender_address: 'dev', bnb_amount: 0.15, timestamp: T0 + 2000 },
  ]);
  const early = F(fa, T0 + 89000);
  feed(fa, [
    { sender_address: 'r1', trader_address: ROUTER, bnb_amount: 0.4, timestamp: T0 + 200000, tx_hash: '0xt70a' },
    { sender_address: 'r2', trader_address: ROUTER, bnb_amount: 0.4, timestamp: T0 + 250000, tx_hash: '0xt70b' },
    { sender_address: 'r3', trader_address: ROUTER, bnb_amount: 0.4, timestamp: T0 + 300000, tx_hash: '0xt70c' },
  ]);
  const mid = F(fa, T0 + 400000);
  check('C1 出窗路由买照抬占比：1.2/1.5×100=80（冻结版恒 0 的形状）', () =>
    assert.strictEqual(mid.tradesRouterPct, 80));
  check('C2 净买同步全史：(1.5−0.15)/1.5×100=90', () =>
    assert.strictEqual(mid.tradesNetBuyRatio, 90));
  feed(fa, [{ sender_address: 'wZ', bnb_amount: 0.3, timestamp: T0 + 500000, tx_hash: '0xt70d' }]);
  const late = F(fa, T0 + 600000);
  check('C3 后续 tick 继续改值（智子 49.8 差 0.2pp 形状的解）：(1.8−0.15)/1.8=91.67', () => {
    assert.strictEqual(late.tradesNetBuyRatio, 91.67);
    assert.strictEqual(late.tradesRouterPct, 66.67); // 1.2/1.8
  });
  check('C4 同 asOf 幂等重读不漂移', () =>
    assert.deepStrictEqual(F(fa, T0 + 600000), late));
}

// ═══════════════ D. 零值语义 ═══════════════
console.log('D. 零值语义');
{
  const fa = newFA();
  feed(fa, [{ trade_type: 'sell', sender_address: 'wS', bnb_amount: 0.1 }]);
  check('D1 全卖无买 → netBuyRatio=-100 routerPct=0（有证据零值非 null）', () => {
    const f = F(fa);
    assert.strictEqual(f.tradesNetBuyRatio, -100);
    assert.strictEqual(f.tradesRouterPct, 0);
  });
  check('D2 全空 → 双键 0 非 undefined', () => {
    const f = F(newFA());
    assert.strictEqual(f.tradesNetBuyRatio, 0);
    assert.strictEqual(f.tradesRouterPct, 0);
  });
}

// ═══════════════ E. 探针与源码锚定 ═══════════════
console.log('E. 探针与源码锚定');
{
  check('E1 getFactorKeys 探针含两键（未知因子防线认得）', () => {
    const keys = newFA().getFactorKeys();
    assert.ok(keys.has('tradesNetBuyRatio'), 'tradesNetBuyRatio 缺');
    assert.ok(keys.has('tradesRouterPct'), 'tradesRouterPct 缺');
  });
  check('E2 totalRouterBuyBnb 写点走 AGGREGATOR_ROUTER_ADDRS（单一真相源）', () => {
    const at = src.indexOf('state.totalRouterBuyBnb += bnbAmount');
    assert.ok(at > 0 && src.slice(Math.max(0, at - 250), at).includes('AGGREGATOR_ROUTER_ADDRS'),
      'tradesRouterPct 分子累计点未走 AGGREGATOR_ROUTER_ADDRS');
  });
  check('E3 发射点公式锁死（net=buy−sell÷buy、router=routerBuy÷buy）', () => {
    const at = src.indexOf('tradesNetBuyRatio: state.totalBuyBnb > 0');
    assert.ok(at > 0 && /tradesRouterPct:\s*state\.totalBuyBnb\s*>\s*0\s*\? parseFloat\(\(state\.totalRouterBuyBnb \/ state\.totalBuyBnb \* 100\)/.test(src.slice(at, at + 400)),
      '发射公式形状漂移');
  });
}

// ═══════════════ F. T71 防复活反证（earlyTrades* 族整族删除）═══════════════
// 2026-10-26 用户裁定删除：出生锚 90s 冻结窗十键无消费者（门已换实时载体）。本段锁死
// 「删了就是删了」——键/方法/源码标识三级反证，复活必须过本段改这里。
console.log('F. T71 防复活');
{
  check('F1 getFactorKeys 不含任何 earlyTrades* 键（条件引用即三防线拒启）', () => {
    const leaked = [...newFA().getFactorKeys()].filter(k => k.startsWith('earlyTrades'));
    assert.deepStrictEqual(leaked, []);
  });
  check('F2 buildFactorMap 无 earlyTrades* 键（undefined 非 0——条件比较恒 false 拦死）', () => {
    feed(newFA(), [{ sender_address: 'w1', bnb_amount: 0.3, timestamp: T0 + 1000 }]);
    const f = F(newFA());
    for (const k of ['earlyTradesPerWallet', 'earlyTradesMaxWalletTrades', 'earlyTradesNetBuyRatio',
      'earlyTradesTop1BuySharePct', 'earlyTradesTop1BuyBnb', 'earlyTradesBuyBnb',
      'earlyTradesRouterPct', 'earlyTradesUniformBuyClusterRatio', 'earlyTradesUniformBuyWallets',
      'earlyTradesUniformBuyClusterN']) {
      assert.ok(f[k] === undefined, `${k} 仍发射`);
    }
  });
  check('F3 方法面删除：getEarlyTopBuyers/_earlyWindowAdvance/_earlyTradesFactors 无实现', () => {
    const fa = newFA();
    assert.ok(typeof fa.getEarlyTopBuyers !== 'function', 'getEarlyTopBuyers 复活');
    assert.ok(typeof fa._earlyWindowAdvance !== 'function', '_earlyWindowAdvance 复活');
    assert.ok(typeof fa._earlyTradesFactors !== 'function', '_earlyTradesFactors 复活');
  });
  check('F4 源码无活标识（墓碑注释除外）：窗机/冻结/累计标识零残留', () => {
    const noComments = src.replace(/\/\/[^\n]*/g, '');
    for (const id of ['_earlyWindowAdvance', '_earlyWindowClosed', '_earlyFrozen',
      '_earlyTradesFactors', '_earlyRouterBuyBnb', '_earlyWalletTrades', '_earlyUniform',
      'earlyTradesWindowMs', '_EARLY_MAX_WALLETS']) {
      assert.ok(!noComments.includes(id), `${id} 源码残留`);
    }
  });
  check('F5 state 无 _early* 字段（冻结窗状态机不重建）', () => {
    const fa = newFA();
    feed(fa, [
      { sender_address: 'w1', bnb_amount: 0.3, timestamp: T0 + 1000 },
      { sender_address: 'w2', bnb_amount: 0.2, timestamp: T0 + 200000, tx_hash: '0xf5' }, // 远超 90s
    ]);
    const st = fa._states.get(ADDR);
    const leaked = Object.keys(st).filter(k => k.startsWith('_early'));
    assert.deepStrictEqual(leaked, []);
  });
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
