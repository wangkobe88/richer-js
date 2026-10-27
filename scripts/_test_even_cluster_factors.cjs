#!/usr/bin/env node
/**
 * 等额买簇三键单测（T74 2026-10-26 0x8c4a…7777 对倒案观察键）——本地零 DB 零网络。
 *
 * 三键：evenClusterHoldCircPct（合格等额桶[size≥3 钱包同额买入]钱包并集去重当前正净
 *      持仓合计 ÷ 流通 ×100）/ evenClusterWallets（并集钱包数）/ evenClusterGroups
 *      （合格桶数）。纯观察不进条件串（阈值须票池分布裁定）。
 *      口径：wallet=sender||trader（K 组/holders 同族）；跨块金额维度聚合（amountKey=
 *      bnb_amount.toFixed(6)，对 bundle 单块口径的分批稀释免疫）；含非首买买盘行；
 *      尘埃门 earlyUniformDustBnb（默认 0.01）以下不入桶（launch 等额臂同款参数）；
 *      0=无合格桶/流通≤0 有证据零值非 null。
 *      案发现场：0x8c4a…7777 fire 时单块口径 holdCircPct=32.4/top2=52.1/top3=69.7
 *      全部擦线放行、sybil 名单只盖 8/30 新钱包 → 23.4，等额指纹一把聚合 81.6%；
 *      且证据在买入当刻可见，不受「延迟卖出」节奏化掩护（两栖判据 fire 时仅 39%）。
 *
 * 覆盖：
 *   A. 事故现场反证（跨块两档等额簇：even=74.3 ≫ top3=44.6 ≫ top1=14.9——单块口径
 *      被分批稀释、等额指纹聚合的语义分离度）
 *   B. <3 钱包等额 = 巧合不聚簇（三键全 0）
 *   C. 并集去重（跨桶复买钱包只计一份筹码——桶相加口径会虚超 100%）
 *   D. 清仓钱包不计分子（分子=正净持仓；wallets/groups 照计=形状与风险度量分离）
 *   E. 尘埃门（<0.01 BNB 等额撞桶不入）
 *   F. 乱序/defer 两阶段 parity（Set.add 幂等收敛）
 *   G. getFactorKeys/getAvailableFactorIds 探针 + FactorBuilder 快照透传 +
 *      ConditionEvaluator 求值（键已知合法、纯读无互斥）
 *   H. 源码口径断言（写点在 _applyWalletAggregation 体内禁 Date.now / _evenBuyBuckets
 *      全史不裁不进 _pruneBundleEvents / 读点纯函数 / 字面量与快照白名单含三键）
 *
 * 用法：node scripts/_test_even_cluster_factors.cjs
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

const KEYS = ['evenClusterHoldCircPct', 'evenClusterWallets', 'evenClusterGroups'];

/**
 * 事故现场缩微（0x8c4a…7777 形状）：两档金额各 3 钱包、**同档分散在不同块**——
 * 单块口径只见零散小块（每块 1 钱包），等额指纹跨块聚合 6 钱包。
 * 散户 wP 唯一额（size=1 桶）不入簇，垫流通分母。
 * token_amount 用整数（8.235*1e6 有浮点尾差，勿用乘法）。
 */
function incidentTicks() {
  return [
    // 散户垫流通分母：同额拆两块（0.1067×2=size2 桶<3 不合格——单块口径反证须防
    // 散户单块买量盖过簇块）
    mkTick({ timestamp: T0 + 0, trader_address: 'eoaP', sender_address: 'wP',
      block_number: 1000, log_index: 1, bnb_amount: 0.1067, token_amount: 10670000 }),
    mkTick({ timestamp: T0 + 500, trader_address: 'eoaP', sender_address: 'wP',
      block_number: 1001, log_index: 2, bnb_amount: 0.1067, token_amount: 10670000 }),
    // 档一 0.1647×3 跨块 1010/1012/1014
    mkTick({ timestamp: T0 + 1000, trader_address: 'eoa1', sender_address: 'w1',
      block_number: 1010, log_index: 11, bnb_amount: 0.1647, token_amount: 8235000 }),
    mkTick({ timestamp: T0 + 2000, trader_address: 'eoa2', sender_address: 'w2',
      block_number: 1012, log_index: 13, bnb_amount: 0.1647, token_amount: 8235000 }),
    mkTick({ timestamp: T0 + 3000, trader_address: 'eoa3', sender_address: 'w3',
      block_number: 1014, log_index: 15, bnb_amount: 0.1647, token_amount: 8235000 }),
    // 档二 0.2470×3 跨块 1020/1022/1024
    mkTick({ timestamp: T0 + 4000, trader_address: 'eoa4', sender_address: 'w4',
      block_number: 1020, log_index: 21, bnb_amount: 0.2470, token_amount: 12350000 }),
    mkTick({ timestamp: T0 + 5000, trader_address: 'eoa5', sender_address: 'w5',
      block_number: 1022, log_index: 23, bnb_amount: 0.2470, token_amount: 12350000 }),
    mkTick({ timestamp: T0 + 6000, trader_address: 'eoa6', sender_address: 'w6',
      block_number: 1024, log_index: 25, bnb_amount: 0.2470, token_amount: 12350000 }),
  ];
}

// ═══════════════ A. 事故现场反证（跨块等额聚合 vs 单块稀释） ═══════════════
console.log('A. 事故现场反证（0x8c4a…7777 缩微：同档等额跨块分散，单块口径全瞎）');
{
  const fa = newFA();
  for (const tk of incidentTicks()) fa.processTick(tk, {});
  const f = fa.buildFactorMap('0xtoken', T0 + 7000);
  check('A1 evenClusterGroups = 2（0.1647/0.2470 两档各成合格桶）', () =>
    assert.strictEqual(f.evenClusterGroups, 2));
  check('A2 evenClusterWallets = 6（跨块跨档并集去重）', () =>
    assert.strictEqual(f.evenClusterWallets, 6));
  check('A3 evenClusterHoldCircPct = 74.3（(24705000+37050000)/83095000——案发实测 81.6 同量级）', () =>
    assert.strictEqual(f.evenClusterHoldCircPct, 74.3));
  check('A4 单块口径对照：bundleClusterHoldCircPct = 14.9（每块 1 钱包，分批稀释反证）', () =>
    assert.strictEqual(f.bundleClusterHoldCircPct, 14.9));
  check('A5 top3 = 44.6（三块并集也只聚合到档二）——even(74.3) ≫ top3(44.6) 语义分离度', () => {
    assert.strictEqual(f.top3BundleClusterHoldCircPct, 44.6);
    assert.ok(f.evenClusterHoldCircPct > f.top3BundleClusterHoldCircPct + 25,
      '跨块金额维度聚合对单块口径必须有实质增量');
  });
}

// ═══════════════ B. <3 钱包等额 = 巧合 ═══════════════
console.log('B. <3 钱包等额不聚簇（launch 等额臂同款裁定）');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'w1', block_number: 10,
    log_index: 1, bnb_amount: 0.1, token_amount: 5000000 }), {});
  fa.processTick(mkTick({ timestamp: T0 + 1100, trader_address: 'w2', block_number: 10,
    log_index: 2, bnb_amount: 0.1, token_amount: 5000000 }), {});
  fa.processTick(mkTick({ timestamp: T0 + 1200, trader_address: 'w3', block_number: 11,
    log_index: 1, bnb_amount: 0.15, token_amount: 7500000 }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 2000);
  check('B1 两钱包等额 = 常见巧合 → 三键全 0（非 null 有证据零值）', () => {
    for (const k of KEYS) assert.strictEqual(f[k], 0, k);
  });
}

// ═══════════════ C. 并集去重（跨桶复买只计一份筹码） ═══════════════
console.log('C. 并集去重（w1 两桶都出现：0.1 买一笔 + 0.2 买一笔）');
{
  const fa = newFA();
  const t = [
    mkTick({ timestamp: T0 + 1000, trader_address: 'w1', block_number: 10, log_index: 1,
      bnb_amount: 0.1, token_amount: 5000000 }),
    mkTick({ timestamp: T0 + 1500, trader_address: 'w2', block_number: 11, log_index: 1,
      bnb_amount: 0.1, token_amount: 5000000 }),
    mkTick({ timestamp: T0 + 2000, trader_address: 'w3', block_number: 12, log_index: 1,
      bnb_amount: 0.1, token_amount: 5000000 }),
    mkTick({ timestamp: T0 + 2500, trader_address: 'w1', block_number: 13, log_index: 1,
      bnb_amount: 0.2, token_amount: 10000000 }), // w1 跨桶复买
    mkTick({ timestamp: T0 + 3000, trader_address: 'w4', block_number: 14, log_index: 1,
      bnb_amount: 0.2, token_amount: 10000000 }),
    mkTick({ timestamp: T0 + 3500, trader_address: 'w5', block_number: 15, log_index: 1,
      bnb_amount: 0.2, token_amount: 10000000 }),
  ];
  for (const tk of t) fa.processTick(tk, {});
  const f = fa.buildFactorMap('0xtoken', T0 + 4000);
  check('C1 groups=2 / wallets=5（w1 并集只算一人）', () => {
    assert.strictEqual(f.evenClusterGroups, 2);
    assert.strictEqual(f.evenClusterWallets, 5);
  });
  check('C2 holdCircPct = 100（分子 45000000=流通全量；桶相加错口径=50000000/45000000 虚超 111——去重反证）', () =>
    assert.strictEqual(f.evenClusterHoldCircPct, 100));
}

// ═══════════════ D. 清仓钱包不计分子 ═══════════════
console.log('D. 清仓钱包不计分子（分子=正净持仓；形状观察与风险度量分离）');
{
  const fa = newFA();
  const t = incidentTicks();
  // 档二 w4-w6 全清仓（卖出不入桶，只压净持仓与流通）
  t.push(mkTick({ timestamp: T0 + 6500, trade_type: 'sell', trader_address: 'eoa4', sender_address: 'w4',
    block_number: 1030, log_index: 1, bnb_amount: 0.22, token_amount: 12350000 }));
  t.push(mkTick({ timestamp: T0 + 6600, trade_type: 'sell', trader_address: 'eoa5', sender_address: 'w5',
    block_number: 1030, log_index: 2, bnb_amount: 0.22, token_amount: 12350000 }));
  t.push(mkTick({ timestamp: T0 + 6700, trade_type: 'sell', trader_address: 'eoa6', sender_address: 'w6',
    block_number: 1030, log_index: 3, bnb_amount: 0.22, token_amount: 12350000 }));
  for (const tk of t) fa.processTick(tk, {});
  const f = fa.buildFactorMap('0xtoken', T0 + 7000);
  check('D1 档二清仓 → 分子只剩档一 24705000/流通 46045000 = 53.7', () => {
    assert.strictEqual(f.evenClusterWallets, 6);   // 并集仍含清仓钱包（形状照计）
    assert.strictEqual(f.evenClusterGroups, 2);
    assert.strictEqual(f.evenClusterHoldCircPct, 53.7);
  });
  // 全清：流通 21340000（只剩散户 wP）、分子 0 → 键 0 但形状键照计
  for (const w of ['w1', 'w2', 'w3']) {
    fa.processTick(mkTick({ timestamp: T0 + 7500, trade_type: 'sell', trader_address: w,
      block_number: 1040, log_index: 1, bnb_amount: 0.15, token_amount: 8235000 }), {});
  }
  const f2 = fa.buildFactorMap('0xtoken', T0 + 8000);
  check('D2 全簇清仓 → holdCircPct=0（风险归零）、wallets=6/groups=2 照计（簇存在过的形状证据）', () => {
    assert.strictEqual(f2.evenClusterHoldCircPct, 0);
    assert.strictEqual(f2.evenClusterWallets, 6);
    assert.strictEqual(f2.evenClusterGroups, 2);
  });
}

// ═══════════════ E. 尘埃门 ═══════════════
console.log('E. 尘埃门（earlyUniformDustBnb 默认 0.01 以下不入桶）');
{
  const fa = newFA();
  for (let i = 0; i < 3; i++) {
    fa.processTick(mkTick({ timestamp: T0 + 1000 + i, trader_address: `wd${i}`,
      block_number: 10 + i, log_index: 1, bnb_amount: 0.0099, token_amount: 500000 }), {});
  }
  const f = fa.buildFactorMap('0xtoken', T0 + 2000);
  check('E1 三钱包 0.0099 等额 < 尘门 → 三键全 0', () => {
    for (const k of KEYS) assert.strictEqual(f[k], 0, k);
  });
}

// ═══════════════ F. 乱序 / defer 两阶段 parity ═══════════════
console.log('F. 乱序喂 / defer 两阶段喂 parity（Set.add 幂等收敛）');
{
  const faSeq = newFA();
  for (const tk of incidentTicks()) faSeq.processTick(tk, {});
  const fSeq = faSeq.buildFactorMap('0xtoken', T0 + 7000);
  const faRev = newFA();
  for (const tk of [...incidentTicks()].reverse()) faRev.processTick(tk, {});
  const fRev = faRev.buildFactorMap('0xtoken', T0 + 7000);
  check('F1 逆序喂三键 bit 一致', () => {
    for (const k of KEYS) assert.strictEqual(fRev[k], fSeq[k], k);
  });
  const faDef = newFA();
  for (const tk of incidentTicks()) {
    faDef.processTick(tk, { deferWallet: true });            // 价格段
    faDef.applyWalletTick(tk, { emitFactors: false });       // wallet 段补喂（sender 真值）
  }
  const fDef = faDef.buildFactorMap('0xtoken', T0 + 7000);
  check('F2 defer 两阶段喂（resolver 回查形状）三键 bit 一致', () => {
    for (const k of KEYS) assert.strictEqual(fDef[k], fSeq[k], k);
  });
}

// ═══════════════ G. 探针 / 快照透传 / 求值 ═══════════════
console.log('G. getFactorKeys 探针 + FactorBuilder 快照透传 + ConditionEvaluator 求值');
{
  const { buildFactorValuesForTimeSeries, getAvailableFactorIds } =
    require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));
  const fa = newFA();
  for (const tk of incidentTicks()) fa.processTick(tk, {});
  const f = fa.buildFactorMap('0xtoken', T0 + 7000);
  check('G1 getFactorKeys() 探针自动收三键', () => {
    const ks = fa.getFactorKeys();
    for (const k of KEYS) assert.ok(ks.has(k), k);
  });
  check('G2 getAvailableFactorIds() 含三键（三防线认得）', () => {
    const ids = getAvailableFactorIds();
    for (const k of KEYS) assert.ok(ids.has(k), k);
  });
  check('G3 FactorBuilder 快照透传（不落库即丢防线）+ 旧输入 null 不掩盖', () => {
    const snap = buildFactorValuesForTimeSeries(f);
    assert.strictEqual(snap.evenClusterHoldCircPct, 74.3);
    assert.strictEqual(snap.evenClusterWallets, 6);
    assert.strictEqual(snap.evenClusterGroups, 2);
    const snapOld = buildFactorValuesForTimeSeries({});
    for (const k of KEYS) assert.strictEqual(snapOld[k], null, k);
  });
  check('G4 ConditionEvaluator 键已知合法 + 案发形状被 <60 门拦（观察语义演示，现行不进条件串）', () => {
    const { ConditionEvaluator } = require(path.join(ROOT, 'src', 'strategies', 'ConditionEvaluator.js'));
    const ev = new ConditionEvaluator();
    const gate = 'evenClusterHoldCircPct < 60';
    assert.strictEqual(ev.evaluate(gate, { evenClusterHoldCircPct: 74.3 }), false); // 案发形状
    assert.strictEqual(ev.evaluate(gate, { evenClusterHoldCircPct: 0 }), true);    // 空簇放行
  });
}

// ═══════════════ H. 源码口径断言 ═══════════════
console.log('H. 源码口径断言（写点/读点/裁剪/白名单防线）');
{
  const src = read('src/services/FourMemeFactorAggregator.js');
  check('H1 写点在 _applyWalletAggregation 体内（wallet 段=sender 真值，GMGN 路由行不假聚合）', () => {
    const aggStart = src.indexOf('_applyWalletAggregation(state, tick, vars) {');
    const aggEnd = src.indexOf('applyWalletTick(tick, opts = {}) {');
    const wpos = src.indexOf('state._evenBuyBuckets.get(_ek)');
    assert.ok(aggStart > 0 && aggEnd > aggStart && wpos > aggStart && wpos < aggEnd,
      '等额桶写点必须在 wallet 聚合段内');
  });
  check('H2 写点段无 Date.now（周期判定禁令）', () => {
    const wpos = src.indexOf('── 等额买簇原料（T74');
    const wend = src.indexOf('_walletFirstBuyTs.get(walletAddr)', wpos);
    assert.ok(wpos > 0 && wend > wpos);
    assert.ok(!src.slice(wpos, wend).includes('Date.now'));
  });
  check('H3 _evenBuyBuckets 全史不裁（不进 _pruneBundleEvents）', () => {
    const pStart = src.indexOf('_pruneBundleEvents(state, now) {');
    const pEnd = src.indexOf('\n    }', pStart);
    assert.ok(pStart > 0);
    assert.ok(!src.slice(pStart, pEnd).includes('_evenBuyBuckets'),
      '裁剪段不得触碰等额桶（全史原料）');
  });
  check('H4 读点在 _bundleClusterFactors（纯函数读取）+ 发射字面量 + 快照白名单含三键', () => {
    const bStart = src.indexOf('_bundleClusterFactors(state, now, out) {');
    const bEnd = src.indexOf('_launchBundleFactors(state) {');
    assert.ok(src.slice(bStart, bEnd).includes('evenClusterHoldCircPct'));
    assert.ok(/evenClusterHoldCircPct: bundle\.evenClusterHoldCircPct/.test(src));
    const fb = read('src/trading-engine/core/FactorBuilder.js');
    for (const k of KEYS) {
      assert.ok(fb.includes(`${k}: factorResults.${k} ?? null`), `FactorBuilder 缺 ${k}`);
    }
  });
  check('H5 纯观察键防漂移：FA 源码条件串示例不得把它写成已进门（不进任何门）', () => {
    // 三防线认得键（G2 已验）；此处锁「观察键」语义——buy-v2 库腿不引用（DB 侧由
    // 策略库自证，本测只锁代码侧不新增门位断言文案）
    assert.ok(/纯观察不进条件串（阈值须票池分布裁定）/.test(src));
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
