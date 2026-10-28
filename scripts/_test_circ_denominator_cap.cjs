#!/usr/bin/env node
/**
 * T91a 流通分母口径修复单测（2026-10-28 孙权 0x3b1b…7777 top3=114% 案用户裁定
 * 「无论如何都要解决大于 100 的问题」）——本地零 DB 零网络。
 *
 * 修法：全部 ÷circ 键分母统一 = max(_circTokens, Σ正净持仓)。
 *   病根：零买入纯卖出钱包（flap 税币接收方/初始筹码分配——Sell 事件在、Buy 事件
 *   永无）把 _circTokens=Σ买−Σ卖 压到低于真实在外筹码 → Σ正净持仓/circ > 100%
 *   病态（孙权 40 纯卖钱包 Σ−226M≈22.6% 供给，fire 前拦截窗 top3 虚高 114 拦 163s）。
 *   恒等式：所有 ÷circ 键分子只计正净持仓（top1/名单族/块簇并集/even 并集 ⊆ Σ正）
 *   → 分母取 max 后恒 ≤100；正常票（无纯卖钱包）Σnet(买入钱包)=circ ⇒ Σ正 ≤ circ
 *   ⇒ max 恒取 circ = 逐输入 bit 不变。
 *
 * 覆盖：
 *   A. 孙权事故现场反证（纯卖钱包压分母形状）：旧口径 top1=100/top3>100 病态 →
 *      新口径精确值（分母=Σ正）且全键 ≤100
 *   B. 正常票 bit 不变（卖者均有买入记录）：Σ正 ≤ circ ⇒ 键值与旧分母手算 bit 一致
 *   C. 负净抵扣形状（净卖者压 Σ正 不压 max）：分母恒取 circ 键不变
 *   D. 全清仓零值（circ=0 ∧ Σ正=0 → 键 0 有证据零值非 null）
 *   E. 恒等式扫描（乱序/多簇/纯卖混合任意形状：top1/bundle/top2/top3/even ≤100）
 *   F. defer 乱序 parity（乱序喂 == 正序喂 键值一致——Σ正单趟求和交换律）
 *   G. 源码口径断言（分母位 state._circTokens 除法不再出现 / max 入口在场 /
 *      out.circTokens 审计透传保留原值 / _bundleClusterFactors 签名 circDen 第三参）
 *
 * 用法：node scripts/_test_circ_denominator_cap.cjs
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

function newFA() {
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  return fa;
}

const M = 1e6;
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// ═══════════════ A. 孙权事故现场反证（纯卖钱包压分母） ═══════════════
console.log('A. 孙权事故现场反证（零买入纯卖出钱包压分母 → 旧口径 >100 病态）');
{
  const fa = newFA();
  const ticks = [
    // A 买 100M（block 100）
    mkTick({ timestamp: T0 + 1000, sender_address: 'wa', block_number: 100, log_index: 1,
      bnb_amount: 1.0, token_amount: 100 * M }),
    // 纯卖钱包 P（初始筹码/税币接收方：Sell 事件在、Buy 事件永无）卖 60M
    mkTick({ timestamp: T0 + 2000, trade_type: 'sell', sender_address: 'wp',
      block_number: 101, log_index: 2, bnb_amount: 0.6, token_amount: 60 * M }),
    // B 接盘买 60M（block 102，与 A 不同块）
    mkTick({ timestamp: T0 + 3000, sender_address: 'wb', block_number: 102, log_index: 3,
      bnb_amount: 0.6, token_amount: 60 * M }),
  ];
  for (const tk of ticks) fa.processTick(tk, {});
  const f = fa.buildFactorMap('0xtoken', T0 + 4000);
  // 旧口径：circ = 100+60−60 = 100M → top1 = 100/100 = 100%、top2 = (A∪B 全筹码)/100 = 160% 病态
  // 新口径：Σ正 = A100 + B60 = 160M → 分母 = max(100, 160) = 160M
  check('A1 top1HolderCircPct = 62.5（100M/160M；旧口径 100% 病态消除）', () =>
    near(f.top1HolderCircPct, 62.5));
  check('A2 top2BundleClusterHoldCircPct = 100（两块并集=Σ正=分母 → 恰 100 上限）', () =>
    near(f.top2BundleClusterHoldCircPct, 100));
  check('A3 全 ÷circ 键 ≤ 100（恒等式：分子 ⊆ Σ正净持仓）', () => {
    for (const k of ['top1HolderCircPct', 'maxBlockBuyCircPct', 'bundleClusterHoldCircPct',
      'top2BundleClusterHoldCircPct', 'top3BundleClusterHoldCircPct', 'evenClusterHoldCircPct']) {
      assert.ok(f[k] <= 100 + 1e-9, `${k}=${f[k]} > 100`);
    }
  });
  check('A4 旧口径病态反证（直接以 _circTokens 为分母算 top2 = 160 > 100）', () => {
    const st = fa._states.get('0xtoken');
    near(100 * M + 60 * M, 160 * M); // Σ正
    const legacy = (100 * M + 60 * M) / st._circTokens * 100;
    assert.ok(legacy > 100, `legacy=${legacy} 应 >100（事故形状在场）`);
  });
}

// ═══════════════ B. 正常票 bit 不变（卖者均有买入记录） ═══════════════
console.log('B. 正常票 bit 不变（Σ正 ≤ circ ⇒ max 恒取 circ）');
{
  const fa = newFA();
  const ticks = [
    mkTick({ timestamp: T0 + 1000, sender_address: 'wa', block_number: 100, log_index: 1,
      bnb_amount: 1.0, token_amount: 100 * M }),
    mkTick({ timestamp: T0 + 2000, sender_address: 'wb', block_number: 101, log_index: 2,
      bnb_amount: 0.5, token_amount: 50 * M }),
    // A 卖 60M（A 有买入记录 → circ 正常扣减；A 净 40M 仍正）
    mkTick({ timestamp: T0 + 3000, trade_type: 'sell', sender_address: 'wa',
      block_number: 102, log_index: 3, bnb_amount: 0.6, token_amount: 60 * M }),
    // C 接盘买 60M
    mkTick({ timestamp: T0 + 4000, sender_address: 'wc', block_number: 103, log_index: 4,
      bnb_amount: 0.6, token_amount: 60 * M }),
  ];
  for (const tk of ticks) fa.processTick(tk, {});
  const f = fa.buildFactorMap('0xtoken', T0 + 5000);
  // circ = 100+50+60−60 = 150M；Σ正 = A40+B50+C60 = 150M → max=150M=circ → 与旧口径 bit 一致
  check('B1 top1HolderCircPct = 40（最大持有者 C60M/150M，分母=circ bit 不变）', () =>
    near(f.top1HolderCircPct, 60000000 / 150000000 * 100));
  check('B2 top2 键与旧分母手算 bit 一致（C60+B50 两块并集 110M/150M，发射点十分位舍入）', () => {
    near(f.top2BundleClusterHoldCircPct, Math.round(110000000 / 150000000 * 100 * 10) / 10, 1e-9);
  });
  check('B3 max 未触发（Σ正=150M == circ=150M，键与直除 _circTokens 等价）', () => {
    const st = fa._states.get('0xtoken');
    near(150 * M, st._circTokens);
  });
}

// ═══════════════ C. 负净抵扣形状（净卖者压 Σ正 不压 max） ═══════════════
console.log('C. 负净抵扣形状（D 买全卖 → 净负出局 Σ正；分母恒取 circ）');
{
  const fa = newFA();
  const ticks = [
    mkTick({ timestamp: T0 + 1000, sender_address: 'wa', block_number: 100, log_index: 1,
      bnb_amount: 1.0, token_amount: 100 * M }),
    mkTick({ timestamp: T0 + 2000, sender_address: 'wd', block_number: 101, log_index: 2,
      bnb_amount: 0.3, token_amount: 30 * M }),
    // D 全卖（净 0 出局 Σ正；D 有买入记录 → circ 扣减正常）
    mkTick({ timestamp: T0 + 3000, trade_type: 'sell', sender_address: 'wd',
      block_number: 102, log_index: 3, bnb_amount: 0.3, token_amount: 30 * M }),
  ];
  for (const tk of ticks) fa.processTick(tk, {});
  const f = fa.buildFactorMap('0xtoken', T0 + 4000);
  // circ = 100+30−30 = 100M；Σ正 = A100M（D 净 0 不计）→ max=100M=circ → bit 不变
  check('C1 top1HolderCircPct = 100（A100M/100M——真实单一持有者，恰 100 非病态）', () =>
    near(f.top1HolderCircPct, 100));
  check('C2 max 恒取 circ（Σ正=100M ≤ circ=100M）', () => {
    const st = fa._states.get('0xtoken');
    near(st._circTokens, 100 * M);
  });
}

// ═══════════════ D. 全清仓零值 ═══════════════
console.log('D. 全清仓零值（circ=0 ∧ Σ正=0 → 有证据零值）');
{
  const fa = newFA();
  const ticks = [
    mkTick({ timestamp: T0 + 1000, sender_address: 'wa', block_number: 100, log_index: 1,
      bnb_amount: 1.0, token_amount: 100 * M }),
    mkTick({ timestamp: T0 + 2000, trade_type: 'sell', sender_address: 'wa',
      block_number: 101, log_index: 2, bnb_amount: 1.0, token_amount: 100 * M }),
  ];
  for (const tk of ticks) fa.processTick(tk, {});
  const f = fa.buildFactorMap('0xtoken', T0 + 3000);
  check('D1 top1/bundle/top2/top3 全 0 非 null', () => {
    for (const k of ['top1HolderCircPct', 'bundleClusterHoldCircPct',
      'top2BundleClusterHoldCircPct', 'top3BundleClusterHoldCircPct']) {
      assert.strictEqual(f[k], 0, `${k}=${f[k]}`);
    }
  });
}

// ═══════════════ E. 恒等式扫描（混合形状全键 ≤100） ═══════════════
console.log('E. 恒等式扫描（纯卖×多簇×清仓混合：全 ÷circ 键 ≤100）');
{
  const fa = newFA();
  const ticks = [];
  // 三块簇买入
  for (let b = 0; b < 3; b++) {
    for (let i = 0; i < 4; i++) {
      ticks.push(mkTick({ timestamp: T0 + 1000 + b * 500 + i,
        sender_address: `wc${b}_${i}`, block_number: 200 + b, log_index: i + 1,
        bnb_amount: 0.2, token_amount: 20 * M }));
    }
  }
  // 纯卖钱包群砸 250M（税币接收方形状）
  for (let i = 0; i < 5; i++) {
    ticks.push(mkTick({ timestamp: T0 + 4000 + i, trade_type: 'sell',
      sender_address: `wpure${i}`, block_number: 300 + i, log_index: i,
      bnb_amount: 0.5, token_amount: 50 * M }));
  }
  // 接盘买（与簇块不同）
  for (let i = 0; i < 5; i++) {
    ticks.push(mkTick({ timestamp: T0 + 5000 + i, sender_address: `wtk${i}`,
      block_number: 400 + i, log_index: i, bnb_amount: 0.5, token_amount: 50 * M }));
  }
  // 簇钱包部分卖出
  ticks.push(mkTick({ timestamp: T0 + 6000, trade_type: 'sell', sender_address: 'wc0_0',
    block_number: 500, log_index: 0, bnb_amount: 0.1, token_amount: 10 * M }));
  for (const tk of ticks) fa.processTick(tk, {});
  const f = fa.buildFactorMap('0xtoken', T0 + 7000);
  check('E1 全 ÷circ 键 ≤100（恒等式成立）', () => {
    for (const k of ['top1HolderCircPct', 'maxBlockBuyCircPct', 'bundleClusterHoldCircPct',
      'top2BundleClusterHoldCircPct', 'top3BundleClusterHoldCircPct', 'evenClusterHoldCircPct']) {
      assert.ok(f[k] <= 100 + 1e-9, `${k}=${f[k]}`);
    }
  });
  check('E2 纯卖在场时分母 > _circTokens（max 抬升生效）', () => {
    const st = fa._states.get('0xtoken');
    let pos = 0;
    for (const v of st._walletNetTokens.values()) if (v > 0) pos += v;
    assert.ok(pos > st._circTokens, `Σ正=${pos} 应 > circ=${st._circTokens}`);
  });
}

// ═══════════════ F. defer 乱序 parity ═══════════════
console.log('F. defer 乱序 parity（Σ正单趟求和交换律 → 乱序喂 == 正序喂）');
{
  const mk = () => {
    const t = [];
    // 两块毛买入刻意不等（100 块 60M / 200 块 75M）——相等会踩 maxBlockBuy 的
    // 既有到达序 tie-breaking（单调 max 严格大于才翻转；与 T91a 无关的已知形状）
    for (let i = 0; i < 3; i++) {
      t.push(mkTick({ timestamp: T0 + 1000 + i, sender_address: `wx0_${i}`,
        block_number: 100, log_index: i + 1, bnb_amount: 0.2, token_amount: 20 * M }));
    }
    for (let i = 0; i < 3; i++) {
      t.push(mkTick({ timestamp: T0 + 1300 + i, sender_address: `wx1_${i}`,
        block_number: 200, log_index: i + 1, bnb_amount: 0.25, token_amount: 25 * M }));
    }
    t.push(mkTick({ timestamp: T0 + 2000, trade_type: 'sell', sender_address: 'wpure',
      block_number: 300, log_index: 0, bnb_amount: 0.4, token_amount: 40 * M }));
    t.push(mkTick({ timestamp: T0 + 3000, sender_address: 'wtk', block_number: 400,
      log_index: 0, bnb_amount: 0.4, token_amount: 40 * M }));
    t.push(mkTick({ timestamp: T0 + 4000, trade_type: 'sell', sender_address: 'wx0_0',
      block_number: 500, log_index: 0, bnb_amount: 0.1, token_amount: 10 * M }));
    return t;
  };
  const fa1 = newFA(); for (const tk of mk()) fa1.processTick(tk, {});
  const fa2 = newFA();
  const shuf = mk(); // 确定性乱序：簇/纯卖/接盘交错
  shuf.sort((a, b) => ((a.block_number * 7 + a.log_index * 3) % 11) - ((b.block_number * 7 + b.log_index * 3) % 11));
  for (const tk of shuf) fa2.processTick(tk, {});
  const f1 = fa1.buildFactorMap('0xtoken', T0 + 5000);
  const f2 = fa2.buildFactorMap('0xtoken', T0 + 5000);
  check('F1 乱序喂 == 正序喂（÷circ 六键 bit 一致）', () => {
    for (const k of ['top1HolderCircPct', 'maxBlockBuyCircPct', 'bundleClusterHoldCircPct',
      'top2BundleClusterHoldCircPct', 'top3BundleClusterHoldCircPct', 'evenClusterHoldCircPct']) {
      assert.strictEqual(f1[k], f2[k], `${k}: ${f1[k]} vs ${f2[k]}`);
    }
  });
}

// ═══════════════ G. 源码口径断言 ═══════════════
console.log('G. 源码口径断言（分母统一 max 入口 / 透传保留 / 签名第三参）');
{
  const src = read('src/services/FourMemeFactorAggregator.js');
  check('G1 分母位不再直除 _circTokens（/ state._circTokens 消失）', () => {
    assert.ok(!src.includes('/ state._circTokens'), '仍有分母位直除 _circTokens');
  });
  check('G2 max 入口在场（_circDen = Math.max(state._circTokens, _posNetSum)）', () => {
    assert.ok(src.includes('const _circDen = Math.max(state._circTokens, _posNetSum);'));
  });
  check('G3 out.circTokens 审计透传保留原值（_circTokens 不经 max）', () => {
    assert.ok(src.includes('out.circTokens = state._circTokens;'));
  });
  check('G4 _bundleClusterFactors 签名 = (state, now, circDen, out)', () => {
    assert.ok(src.includes('_bundleClusterFactors(state, now, circDen, out) {'));
  });
  check('G5 写点未动（_circTokens += isBuy 原样，T91a 只改读点分母）', () => {
    assert.ok(src.includes('state._circTokens += isBuy ? tokenAmount : -tokenAmount;'));
  });
  check('G6 scan-bundle-clusters 直调点已同步第四参', () => {
    const s2 = read('scripts/scan-bundle-clusters.cjs');
    assert.ok(s2.includes('Math.max(_st._circTokens, _posNetSum), detail)'), 'scan 直调点未同步');
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
