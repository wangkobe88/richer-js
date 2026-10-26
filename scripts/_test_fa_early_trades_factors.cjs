#!/usr/bin/env node
/**
 * FA earlyTrades* 首窗累计因子单测（C84 2026-10-17 买腿重构）——本地零 DB 零网络。
 *
 * 10 键（迁自 EarlyParticipantCheckService DB trailing 90s 窗 → FA 出生锚定累计窗，
 * 单一买条件消除两阶段因子漂移）：earlyTradesPerWallet / MaxWalletTrades / NetBuyRatio /
 * Top1BuySharePct / Top1BuyBnb / BuyBnb / RouterPct / UniformBuyClusterRatio /
 * UniformBuyWallets / UniformBuyClusterN。
 *
 * 口径要点（与 legacy 的 delta，台账 C84）：
 *   - 出生锚=firstTickAt、窗=earlyTradesWindowMs(90s)，首个出窗 tick 冻结快照
 *   - trader 层（rows/总量/router）无 outlier/price_usd 过滤（delta①，照计语义）
 *   - router 按 trader 层（AGGREGATOR_ROUTER_ADDRS）；top1 协议双地址层剔除
 *     （PROTOCOL_ADDRS wallet||trader 任一命中）；uniform 全钱包无协议剔除
 *   - 尘埃门 earlyUniformDustBnb(0.01) 只影响 uniform 簇——钱包计数/总买/top1 照进
 *   - null wallet 行进分子（rows）不计人（wallets）；defer 路径 trader 段先行，
 *     wallet 段 applyWalletTick 后补，窗内乱序收敛；冻结后晚到 wallet 行丢弃
 *
 * H 段（T70 2026-10-26）：对照臂 tradesNetBuyRatio/tradesRouterPct 全史实时两键
 * （同公式同口径、无窗无冻结——early 90s 冻结窗对慢热票失真，买腿换实时载体）。
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
const PROTOCOL = '0x000006b7be706cdb1e5a43c9fd974c0000000091'; // PROTOCOL_ADDRS（four.meme 协议地址）

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const T0 = 1790802000000;
const ADDR = '0xtok_early';

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
const pick = (f) => ({
  perWallet: f.earlyTradesPerWallet, maxW: f.earlyTradesMaxWalletTrades,
  net: f.earlyTradesNetBuyRatio, top1Pct: f.earlyTradesTop1BuySharePct,
  top1Bnb: f.earlyTradesTop1BuyBnb, buyBnb: f.earlyTradesBuyBnb,
  routerPct: f.earlyTradesRouterPct, uRatio: f.earlyTradesUniformBuyClusterRatio,
  uWallets: f.earlyTradesUniformBuyWallets, uCluster: f.earlyTradesUniformBuyClusterN,
});

// ═══════════════ A. 10 键公式精确值 ═══════════════
console.log('A. 公式精确值');
{
  const fa = newFA();
  feed(fa, [
    { sender_address: 'w1', trader_address: '0xeoa1', bnb_amount: 0.30 },
    { sender_address: 'w2', trader_address: '0xeoa2', bnb_amount: 0.30 },
    { sender_address: 'w3', trader_address: '0xeoa3', bnb_amount: 0.30 },
    { trade_type: 'sell', sender_address: 'w4', trader_address: '0xeoa4', bnb_amount: 0.10 },
    { sender_address: 'w5', trader_address: ROUTER, bnb_amount: 0.10 }, // GMGN 路由买
  ]);
  const p = pick(F(fa));
  check('A1 perWallet=5行/5钱包=1', () => assert.strictEqual(p.perWallet, 1));
  check('A2 maxWalletTrades=1', () => assert.strictEqual(p.maxW, 1));
  check('A3 netBuyRatio=(1.0−0.1)/1.0×100=90', () => assert.strictEqual(p.net, 90));
  check('A4 top1BuySharePct=0.3/1.0×100=30', () => assert.strictEqual(p.top1Pct, 30));
  check('A5 top1BuyBnb=0.3 / buyBnb=1（toFixed(4)）',
    () => { assert.strictEqual(p.top1Bnb, 0.3); assert.strictEqual(p.buyBnb, 1); });
  check('A6 routerPct=0.1/1.0×100=10（trader∈GMGN 路由）', () => assert.strictEqual(p.routerPct, 10));
  check('A7 uniform：尘埃门以上 4 钱包（0.30×3+0.10），最大簇 3 → ratio 75',
    () => { assert.strictEqual(p.uWallets, 4); assert.strictEqual(p.uCluster, 3); assert.strictEqual(p.uRatio, 75); });
}

// ═══════════════ B. 口径反证 ═══════════════
console.log('B. 口径反证');
{
  const fa = newFA();
  feed(fa, [
    // delta①：outlier 行 + price_usd 缺失行照计（legacy SQL 侧 price_outlier=false AND price_usd 非空）
    { sender_address: 'w1', bnb_amount: 0.7, price_outlier: true, price_usd: null },
  ]);
  check('B1 outlier/price_usd 缺失照计（buyBnb=0.7）', () =>
    assert.strictEqual(pick(F(fa)).buyBnb, 0.7));
}
{
  const fa = newFA();
  feed(fa, [
    { sender_address: 'wX', trader_address: ROUTER, bnb_amount: 0.3 }, // trader=路由 → 计
    { sender_address: ROUTER, trader_address: '0xeoa9', bnb_amount: 0.3 }, // sender=路由 trader=EOA → 不计
  ]);
  const p = pick(F(fa));
  check('B2 router 按 trader 层：仅 trader∈路由行计入 → 0.3/0.6=50', () =>
    assert.strictEqual(p.routerPct, 50));
  check('B2b 路由地址作钱包照进 top1/uniform（协议剔除只剔 PROTOCOL_ADDRS）', () => {
    assert.strictEqual(p.top1Bnb, 0.3);
    assert.strictEqual(p.uWallets, 2);
  });
}
{
  const fa = newFA();
  feed(fa, [
    { sender_address: 'w1', trader_address: '0xeoa1', bnb_amount: 0.5 },
    { sender_address: PROTOCOL, trader_address: '0xeoa2', bnb_amount: 0.4 }, // wallet 层命中
    { sender_address: 'wP', trader_address: PROTOCOL, bnb_amount: 0.45 }, // trader 层命中
  ]);
  const p = pick(F(fa));
  check('B3 top1 协议双地址层剔除：max 停 0.5 非 0.45 → share 37.04', () => {
    assert.strictEqual(p.top1Bnb, 0.5);
    assert.strictEqual(p.top1Pct, 37.04);
  });
  check('B3b 协议剔除只剔 top1：buyBnb=1.35 含协议行 / uniform 3 钱包簇 1 → 33.3', () => {
    assert.strictEqual(p.buyBnb, 1.35);
    assert.strictEqual(p.uWallets, 3);
    assert.strictEqual(p.uCluster, 1);
    assert.strictEqual(p.uRatio, 33.3);
  });
}
{
  const fa = newFA();
  feed(fa, [
    { sender_address: null, trader_address: null, bnb_amount: 0.1 }, // 无钱包行
    { sender_address: 'w1', bnb_amount: 0.1 },
  ]);
  const p = pick(F(fa));
  check('B4 null wallet 行进分子不计人：2 行/1 钱包 perWallet=2，top1 只算 w1', () => {
    assert.strictEqual(p.perWallet, 2);
    assert.strictEqual(p.top1Bnb, 0.1);
  });
}
{
  const fa = newFA();
  feed(fa, [
    { sender_address: 'wD1', bnb_amount: 0.001 }, // 尘行（<0.01）
    { sender_address: 'wD2', bnb_amount: 0.001 },
  ]);
  const p = pick(F(fa));
  check('B5 尘埃门只影响 uniform：2 尘行照进钱包数/总买/top1，uniform 全 0', () => {
    assert.strictEqual(p.perWallet, 1);
    assert.strictEqual(p.buyBnb, 0.002);
    assert.strictEqual(p.top1Bnb, 0.001);
    assert.strictEqual(p.uWallets, 0);
    assert.strictEqual(p.uCluster, 0);
    assert.strictEqual(p.uRatio, 0);
  });
}

// ═══════════════ C. defer 乱序收敛 ═══════════════
console.log('C. defer 两阶段');
{
  const fa = newFA();
  const tA = mkTick({ sender_address: 'wA', trader_address: '0xeoaA', bnb_amount: 0.4, timestamp: T0 + 1000 });
  const tB = mkTick({ sender_address: 'wB', trader_address: '0xeoaB', bnb_amount: 0.2, timestamp: T0 + 2000 });
  fa.processTick(tA, { deferWallet: true });
  const mid = pick(F(fa, T0 + 2500));
  check('C1 defer 价格段 trader 层先行：buyBnb=0.4 已可见（wallet 段未补 perWallet=0）', () => {
    assert.strictEqual(mid.buyBnb, 0.4);
    assert.strictEqual(mid.perWallet, 0);
  });
  fa.processTick(tB, { deferWallet: true });
  fa.applyWalletTick(tB); // 乱序：B 先回推
  fa.applyWalletTick(tA);
  const p = pick(F(fa, T0 + 3000));
  check('C2 wallet 段乱序回推收敛：2 行/2 钱包/top1=0.4/share 66.67', () => {
    assert.strictEqual(p.perWallet, 1);
    assert.strictEqual(p.top1Bnb, 0.4);
    assert.strictEqual(p.top1Pct, 66.67);
  });
  check('C3 applyWalletTick 先于价格段 → throw fail-loud（价格段必须先行）', () => {
    const tX = mkTick({ token_address: '0xno_state', timestamp: T0 + 1000 });
    assert.throws(() => fa.applyWalletTick(tX), /无 state——价格段必须先行/);
  });
}

// ═══════════════ D. 出窗冻结 ═══════════════
console.log('D. 出窗冻结');
{
  const fa = newFA();
  feed(fa, [
    { sender_address: 'w1', bnb_amount: 0.1, timestamp: T0 },
    { sender_address: 'w2', bnb_amount: 0.2, timestamp: T0 + 90000 }, // 边界含（<=）
  ]);
  const before = pick(F(fa, T0 + 90000));
  check('D1 窗含边界：ts−firstTickAt=90000 行照计（buyBnb=0.3 perWallet=1）', () => {
    assert.strictEqual(before.buyBnb, 0.3);
    assert.strictEqual(before.perWallet, 1);
  });
  feed(fa, [
    { sender_address: 'w3', bnb_amount: 5.0, timestamp: T0 + 90001, tx_hash: '0xfreeze' }, // 首个出窗
    { sender_address: 'w4', bnb_amount: 9.0, timestamp: T0 + 200000, tx_hash: '0xafter' }, // 冻结后
  ]);
  const after = pick(F(fa, T0 + 300000));
  check('D2 首个出窗 tick 冻结：出窗行不计（buyBnb 停 0.3）', () =>
    assert.strictEqual(after.buyBnb, 0.3));
  check('D3 冻结后行不再入窗（perWallet 停 1），且任意 asOf 读同一快照', () => {
    assert.strictEqual(after.perWallet, 1);
    assert.deepStrictEqual(pick(F(fa, T0 + 10 ** 7)), after);
  });
  check('D4 冻结后晚到 defer wallet 行丢弃（wallets 不增）', () => {
    const tLate = mkTick({ sender_address: 'w9', bnb_amount: 1.0, timestamp: T0 + 5000, tx_hash: '0xlate' });
    fa.applyWalletTick(tLate);
    assert.strictEqual(pick(F(fa, T0 + 300000)).perWallet, 1);
  });
}

// ═══════════════ E. _EARLY_MAX_WALLETS 帽 ═══════════════
console.log('E. 5000 钱包防御帽');
{
  const fa = newFA();
  const ticks = [];
  for (let i = 0; i < 5000; i++) {
    ticks.push({ sender_address: `cap${i}`, bnb_amount: 0.01, timestamp: T0 + 100, tx_hash: `0xcap${i}` });
  }
  feed(fa, ticks);
  let p = pick(F(fa, T0 + 500));
  check('E1 帽前 5000 钱包全入册（uniform wallets=5000 簇 5000 → 100）', () => {
    assert.strictEqual(p.uWallets, 5000);
    assert.strictEqual(p.uRatio, 100);
  });
  feed(fa, [
    { sender_address: 'capNew', bnb_amount: 0.01, timestamp: T0 + 600, tx_hash: '0xcapnew' }, // 新钱包→帽拦
    { sender_address: 'cap0', bnb_amount: 0.01, timestamp: T0 + 700, tx_hash: '0xcap0b' }, // 已入册→照更
  ]);
  p = pick(F(fa, T0 + 800));
  check('E2 帽只停新钱包入册：capNew 不进（wallets 停 5000）', () =>
    assert.strictEqual(p.uWallets, 5000));
  check('E3 已入册钱包照常更新：cap0 二买 maxWalletTrades=2，桶迁移簇 4999', () => {
    assert.strictEqual(p.maxW, 2);
    assert.strictEqual(p.uCluster, 4999);
  });
}

// ═══════════════ F. 空窗/退化形零值 ═══════════════
console.log('F. 零值语义');
{
  const fa = newFA();
  feed(fa, [{ sender_address: null, trader_address: null, bnb_amount: 0 }]); // 双向全 0
  const p = pick(F(fa));
  check('F1 buy=sell=0 → netBuyRatio=0 分支（10 键全出非 undefined）', () => {
    assert.strictEqual(p.net, 0);
    for (const v of Object.values(p)) assert.ok(v !== undefined, '键缺失');
  });
  const fa2 = newFA();
  feed(fa2, [{ trade_type: 'sell', sender_address: 'wS', bnb_amount: 0.1 }]);
  check('F2 全卖无买 → netBuyRatio=-100', () =>
    assert.strictEqual(pick(F(fa2)).net, -100));
  const fa3 = newFA();
  feed(fa3, [{ trade_type: 'buy', sender_address: 'wB', bnb_amount: 0.1 }]);
  check('F3 纯买 → netBuyRatio=100', () =>
    assert.strictEqual(pick(F(fa3)).net, 100));
}
{
  const keys = newFA().getFactorKeys();
  check('F4 getFactorKeys 探针含 10 键（condition 可直引+未知因子防线认得）', () => {
    for (const k of ['earlyTradesPerWallet', 'earlyTradesMaxWalletTrades', 'earlyTradesNetBuyRatio',
      'earlyTradesTop1BuySharePct', 'earlyTradesTop1BuyBnb', 'earlyTradesBuyBnb',
      'earlyTradesRouterPct', 'earlyTradesUniformBuyClusterRatio', 'earlyTradesUniformBuyWallets',
      'earlyTradesUniformBuyClusterN']) {
      assert.ok(keys.has(k), `${k} 缺`);
    }
  });
}

// ═══════════════ G. 源码口径反证 ═══════════════
console.log('G. 源码口径');
{
  const seg = src.slice(src.indexOf('── earlyTrades* trader 层原料'), src.indexOf('// 首块脉冲'));
  const noComments = seg.replace(/\/\/[^\n]*/g, '');
  check('G1 trader 层无 outlier/price_usd 过滤（照计 delta① 源码锁死）', () => {
    assert.ok(!/price_outlier/.test(noComments), 'trader 层出现 price_outlier 过滤');
    assert.ok(!/price_usd/.test(noComments), 'trader 层出现 price_usd 过滤');
  });
  check('G2 窗含边界 <=（90000 整点行照计）', () =>
    assert.ok(/_earlyWindowAdvance[\s\S]*?<=\s*this\._fp\.earlyTradesWindowMs/.test(
      src.slice(src.indexOf('_earlyWindowAdvance(state, ts) {'), src.indexOf('_earlyWindowAdvance(state, ts) {') + 400)),
      '窗边界非 <='));
  check('G3 router 判定走 AGGREGATOR_ROUTER_ADDRS（单一真相源，锚 _earlyRouterBuyBnb 写点）', () => {
    const at = src.indexOf('state._earlyRouterBuyBnb += bnbAmount');
    assert.ok(at > 0 && src.slice(Math.max(0, at - 200), at).includes('AGGREGATOR_ROUTER_ADDRS'),
      'router 累加点未走 AGGREGATOR_ROUTER_ADDRS');
  });
  check('G4 top1 协议剔除双地址层（wallet||trader）', () => {
    const wseg = src.slice(src.indexOf('earlyTrades* wallet 层原料'), src.indexOf('── bundle* 6 键原料'));
    assert.ok(/PROTOCOL_ADDRS\.has\(_wl\)[\s\S]*?PROTOCOL_ADDRS\.has\(String\(tick\.trader_address/.test(wseg),
      '双地址层剔除形状漂移');
  });
  check('G5 默认窗 90s/尘埃门 0.01（FACTOR_PARAM_DEFAULTS）', () => {
    assert.ok(/earlyTradesWindowMs:\s*90000/.test(src));
    assert.ok(/earlyUniformDustBnb:\s*0\.01/.test(src));
  });
}

// ═══════════════ H. T70 全史实时两键（tradesNetBuyRatio/tradesRouterPct）═══════════════
// 2026-10-26 智子/币安1986 案：early 90s 冻结窗对慢热票结构性失真（币安1986 前 90s
// 仅 dev 自倒 routerPct 冻结 0 恒拦，90-300s 散户蜂拥也改不了冻结值）→ 买腿换实时
// 载体。同公式同口径、无窗无冻结：买点时刻全史真值。
console.log('H. T70 trades* 全史实时两键');
{
  const fa = newFA();
  // 窗内复刻币安1986：仅 dev EOA 自倒 1 买 0.3 + 1 卖 0.15，无路由买
  feed(fa, [
    { sender_address: 'dev', bnb_amount: 0.3, timestamp: T0 + 1000 },
    { trade_type: 'sell', sender_address: 'dev', bnb_amount: 0.15, timestamp: T0 + 2000 },
  ]);
  const inWin = F(fa, T0 + 89000);
  check('H1 窗内读数=当时真值：tradesRouterPct=0 tradesNetBuyRatio=50（早期=买点真值非 null）', () => {
    assert.strictEqual(inWin.tradesRouterPct, 0);
    assert.strictEqual(inWin.tradesNetBuyRatio, 50);
  });
  // 出窗后散户 GMGN 路由蜂拥 3×0.4（复刻 90-300s 形状）
  feed(fa, [
    { sender_address: 'r1', trader_address: ROUTER, bnb_amount: 0.4, timestamp: T0 + 200000, tx_hash: '0xt70a' },
    { sender_address: 'r2', trader_address: ROUTER, bnb_amount: 0.4, timestamp: T0 + 250000, tx_hash: '0xt70b' },
    { sender_address: 'r3', trader_address: ROUTER, bnb_amount: 0.4, timestamp: T0 + 300000, tx_hash: '0xt70c' },
  ]);
  const after = pick(F(fa, T0 + 400000));
  check('H2 核心反证：出窗路由买照抬 tradesRouterPct=1.2/1.5×100=80，earlyTradesRouterPct 冻结 0 不变', () => {
    assert.strictEqual(after.routerPct, 0); // early 冻结版=本案拦截元凶
    assert.strictEqual(F(fa, T0 + 400000).tradesRouterPct, 80); // 实时版改判
  });
  check('H3 tradesNetBuyRatio 同步全史=(1.5−0.15)/1.5×100=90，earlyTradesNetBuyRatio 冻结 50', () => {
    assert.strictEqual(after.net, 50);
    assert.strictEqual(F(fa, T0 + 400000).tradesNetBuyRatio, 90);
  });
  check('H4 实时两键无冻结语义：后续 tick 继续改值（智子 49.8 差 0.2pp 形状的解）', () => {
    feed(fa, [{ sender_address: 'wZ', bnb_amount: 0.3, timestamp: T0 + 500000, tx_hash: '0xt70d' }]);
    const f = F(fa, T0 + 600000);
    assert.strictEqual(f.tradesNetBuyRatio, 91.67); // (1.8−0.15)/1.8
    assert.strictEqual(after.net, 50); // early 冻结照旧
  });
}
{
  const fa = newFA();
  feed(fa, [
    { trade_type: 'buy', sender_address: 'a', bnb_amount: 1.0 },
    { trade_type: 'sell', sender_address: 'b', bnb_amount: 0.4 },
  ]);
  check('H5 公式精确值：净买 (1−0.4)/1×100=60', () =>
    assert.strictEqual(F(fa).tradesNetBuyRatio, 60));
}
{
  const fa = newFA();
  feed(fa, [
    { trade_type: 'sell', sender_address: 'wS', bnb_amount: 0.1 },
  ]);
  check('H6 零值形状：全卖无买 → tradesNetBuyRatio=-100 tradesRouterPct=0（有证据零值）', () => {
    assert.strictEqual(F(fa).tradesNetBuyRatio, -100);
    assert.strictEqual(F(fa).tradesRouterPct, 0);
  });
  const fa2 = newFA();
  check('H7 全空 → 双键 0 非 undefined', () => {
    const f = F(fa2);
    assert.strictEqual(f.tradesNetBuyRatio, 0);
    assert.strictEqual(f.tradesRouterPct, 0);
  });
}
{
  // trader 层口径对齐 early 同名臂（B2 同款）：仅 trader∈路由行计入
  const fa = newFA();
  feed(fa, [
    { sender_address: 'wX', trader_address: ROUTER, bnb_amount: 0.3 },
    { sender_address: ROUTER, trader_address: '0xeoa9', bnb_amount: 0.3 }, // sender=路由 trader=EOA → 不计
  ]);
  check('H8 tradesRouterPct 判 trader 层：0.3/0.6=50', () =>
    assert.strictEqual(F(fa).tradesRouterPct, 50));
  const fa3 = newFA();
  feed(fa3, [{ trade_type: 'sell', sender_address: 'wS', trader_address: ROUTER, bnb_amount: 0.2 }]);
  check('H9 只计买腿：路由卖出不抬分子', () =>
    assert.strictEqual(F(fa3).tradesRouterPct, 0));
}
{
  check('H10 getFactorKeys 探针含 T70 两键（未知因子防线认得）', () => {
    const keys = newFA().getFactorKeys();
    assert.ok(keys.has('tradesNetBuyRatio'), 'tradesNetBuyRatio 缺');
    assert.ok(keys.has('tradesRouterPct'), 'tradesRouterPct 缺');
  });
  check('G6 源码锚定：totalRouterBuyBnb 写点走 AGGREGATOR_ROUTER_ADDRS（单一真相源）', () => {
    const at = src.indexOf('state.totalRouterBuyBnb += bnbAmount');
    assert.ok(at > 0 && src.slice(Math.max(0, at - 250), at).includes('AGGREGATOR_ROUTER_ADDRS'),
      'tradesRouterPct 分子累计点未走 AGGREGATOR_ROUTER_ADDRS');
  });
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
