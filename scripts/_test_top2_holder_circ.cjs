#!/usr/bin/env node
/**
 * T93 top2 持有人门单键单测（2026-10-29 BI/Meecot 迟买案用户裁定「top2 块簇门改为
 * top2 持有者的门」）——本地零 DB 零网络。
 *
 * 键：top2HolderCircPct = 前两大净持仓**合计** ÷ max(流通, Σ正净持仓) ×100——
 * 与 top1HolderCircPct 同口径同分母（T91a _circDen），原料复用 top20 降序前缀
 * _nA/_nB（只收正净：v<=0 continue——恒 ≥ top1、恒 ≤100 天然成立）。
 *
 * 案由（v51 d41b9c29 两票迟买归因）：
 *   - BI 0xa7ef…7777（flap 税币）：router 门独拦 12s + top2**块簇**门最后清（+25s，
 *     一号买家 0.99 BNB 顶门上）→ fire=+27s 买在顶部右侧，反事实 +17s 价差 +48.6%；
 *   - Meecot 0x8671d681：sybil 100→59 稀释 150s 才擦线过门 → leadMs=179s 接顶全亏。
 *   裁定三处瘦身：sybil 门去掉 / tradesRouterPct 门去掉 / top2 块簇门换 top2 持有人门
 *   （阈值主 55 / 早期 65 承接）。本测锁**新键**口径；sybil/tradesRouterPct 因子本身
 *   保留为纯观察键（只从条件串删，FA 计算与 roster loader 不动，同 T91 删门留键先例）。
 *
 * 覆盖：
 *   A. 公式精确值（散买稀释逐档核对 top1/top2）
 *   B. 巨鲸+二号囤筹仍拦（瘦身≠放掉真囤筹；恒 ≥ top1）
 *   C. ★口径分离现场反证（T93 意图方向）：同块多钱包簇形状下块簇门（并集去重全簇
 *      合计）拦、持有人门（只算前两大）放行——换键非 no-op，方向=对「同块分散簇」放宽
 *   D. 退化与负净出局：单持有人 top2==top1；第二大清仓后 _nB 取第三人（净卖者出局）
 *   E. T91a 孙权形状 ≤100 反证：零买纯卖钱包压流通分母 → 40 而非 133（恒等式分子 ⊆ Σ正净）
 *   F. 乱序 parity（_walletNetTokens 加减交换律 + top20 插入排序值域不变）
 *   G. 空窗零值 + getFactorKeys/getAvailableFactorIds 探针
 *   H. FactorBuilder 快照透传（值透传 + 旧输入 null 不掩盖）
 *   I. 源码口径断言（字面量发射 / (_nA + _nB) / _circDen 公式 / 快照白名单）
 *   J. ConditionEvaluator 直评主/早期门（55/65）
 *
 * 用法：node scripts/_test_top2_holder_circ.cjs
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

/** 标准构造：FA + 已注册 token */
function newFA(factorParams) {
  const cfg = factorParams ? { fourmemeWs: { factorParams } } : {};
  const fa = new FourMemeFactorAggregator(cfg, { info() {}, warn() {}, error() {} });
  fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  return fa;
}

const M = 1e6;

// ═══════════════ A. 公式精确值 ═══════════════
console.log('A. 公式精确值（前两大净持仓合计 ÷ _circDen）');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'w1', block_number: 50, log_index: 1, bnb_amount: 3, token_amount: 30 * M }), {});
  fa.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'w2', block_number: 51, log_index: 1, bnb_amount: 2, token_amount: 20 * M }), {});
  const f1 = fa.buildFactorMap('0xtoken', T0 + 3000);
  check('A1 两持有人 top1=60 / top2=100（(30+20)/50——前两大即全部流通）', () => {
    assert.ok(Math.abs(f1.top1HolderCircPct - 60) < 1e-6, `top1 got ${f1.top1HolderCircPct}`);
    assert.ok(Math.abs(f1.top2HolderCircPct - 100) < 1e-6, `top2 got ${f1.top2HolderCircPct}`);
  });
  fa.processTick(mkTick({ timestamp: T0 + 4000, trader_address: 'w3', block_number: 52, log_index: 1, bnb_amount: 2.5, token_amount: 25 * M }), {});
  const f2 = fa.buildFactorMap('0xtoken', T0 + 5000);
  check('A2 散买稀释后 top1=40 / top2=73.33（(30+25)/75——第三大 20M 不进分子）', () => {
    assert.ok(Math.abs(f2.top1HolderCircPct - 40) < 1e-6, `top1 got ${f2.top1HolderCircPct}`);
    assert.ok(Math.abs(f2.top2HolderCircPct - 73.3333) < 0.001, `top2 got ${f2.top2HolderCircPct}`);
  });
  check('A3 恒 ≥ top1（两档均真）', () => {
    assert.ok(f1.top2HolderCircPct >= f1.top1HolderCircPct);
    assert.ok(f2.top2HolderCircPct >= f2.top1HolderCircPct);
  });
}

// ═══════════════ B. 巨鲸+二号囤筹仍拦 ═══════════════
console.log('B. 巨鲸+二号囤筹仍拦（瘦身 ≠ 放掉真囤筹）');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'wX', block_number: 50, log_index: 1, bnb_amount: 8, token_amount: 80 * M }), {});
  fa.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'wY', block_number: 51, log_index: 1, bnb_amount: 1, token_amount: 10 * M }), {});
  fa.processTick(mkTick({ timestamp: T0 + 3000, trader_address: 'wZ', block_number: 52, log_index: 1, bnb_amount: 1, token_amount: 10 * M }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 5000);
  check('B1 巨鲸 80M+二号 10M → top2=90 ≥ 55 主门照拦（M2 巨鲸场景同款形状）', () => {
    assert.ok(Math.abs(f.top2HolderCircPct - 90) < 1e-6, `got ${f.top2HolderCircPct}`);
    assert.ok(!(f.top2HolderCircPct < 55));
  });
}

// ═══════════════ C. 口径分离现场反证（T93 意图方向）═══════════════
console.log('C. 块簇门 vs 持有人门口径分离（同块多钱包簇：拦 → 放）');
{
  // BI 案瘦身方向的最小形状：4 钱包同 block 等额首买各 10M（并集簇形状）——
  // 块簇门并集去重全簇 40M/40M=100 拦；持有人门只算前两大 (10+10)/40=50 过 55 门。
  const fa = newFA();
  for (let i = 0; i < 4; i++) {
    fa.processTick(mkTick({ timestamp: T0 + 1000 + i, trader_address: `wc${i}`, block_number: 77,
      log_index: i + 1, bnb_amount: 1, token_amount: 10 * M }), {});
  }
  const f = fa.buildFactorMap('0xtoken', T0 + 4000);
  check('C1 块簇门 top2Bundle=100（单块退化=并集 40M/40M）——旧门拦', () =>
    assert.ok(Math.abs(f.top2BundleClusterHoldCircPct - 100) < 0.05, `got ${f.top2BundleClusterHoldCircPct}`));
  check('C2 持有人门 top2Holder=50（只算前两大 20M/40M）< 55 放行——换键非 no-op', () =>
    assert.ok(Math.abs(f.top2HolderCircPct - 50) < 0.05, `got ${f.top2HolderCircPct}`));
  check('C3 门判分离：旧门 false / 新门 true（瘦身方向断言）', () => {
    assert.ok(!(f.top2BundleClusterHoldCircPct < 55));
    assert.ok(f.top2HolderCircPct < 55);
  });
  // 反向保持：跨块复买囤筹——wm1 两块共 40M、wm2 一块 25M。块簇门持仓最大两块
  // （blk80/blk82）同含 wm1，并集去重只算一份 → 61.5；持有人门 wallet 域聚合
  // (40+25)/65=100——两门同拦，且持有人门对「分批跨块囤筹」聚合力更强
  const fa2 = newFA();
  fa2.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'wm1', block_number: 80, log_index: 1, bnb_amount: 3, token_amount: 30 * M }), {});
  fa2.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'wm2', block_number: 81, log_index: 1, bnb_amount: 2.5, token_amount: 25 * M }), {});
  fa2.processTick(mkTick({ timestamp: T0 + 3000, trader_address: 'wm1', block_number: 82, log_index: 1, bnb_amount: 1, token_amount: 10 * M }), {});
  const f2 = fa2.buildFactorMap('0xtoken', T0 + 5000);
  check('C4 跨块复买囤筹：两门同拦（bundle 61.5 ≥ 55 / holder 100 ≥ 55——wallet 域聚合力不漏）', () => {
    assert.ok(Math.abs(f2.top2BundleClusterHoldCircPct - 61.5) < 0.05, `bundle got ${f2.top2BundleClusterHoldCircPct}`);
    assert.ok(Math.abs(f2.top2HolderCircPct - 100) < 0.05, `holder got ${f2.top2HolderCircPct}`);
    assert.ok(!(f2.top2HolderCircPct < 55));
  });
}

// ═══════════════ D. 退化与负净出局 ═══════════════
console.log('D. 退化与负净出局');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'w1', block_number: 50, log_index: 1, bnb_amount: 1, token_amount: 10 * M }), {});
  const f1 = fa.buildFactorMap('0xtoken', T0 + 2000);
  check('D1 单持有人 top2==top1==100（_nB=0 退化，bundle top2「不足两块退化 top1」同款）', () => {
    assert.ok(Math.abs(f1.top2HolderCircPct - 100) < 1e-6);
    assert.strictEqual(f1.top2HolderCircPct, f1.top1HolderCircPct);
  });
  // 第二大清仓 → _nB 取第三人（w2 净 0 出局，w4 10M 顶上）
  const fa2 = newFA();
  fa2.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'w1', block_number: 50, log_index: 1, bnb_amount: 3, token_amount: 30 * M }), {});
  fa2.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'w2', block_number: 51, log_index: 1, bnb_amount: 2, token_amount: 20 * M }), {});
  fa2.processTick(mkTick({ timestamp: T0 + 3000, trader_address: 'w3', block_number: 52, log_index: 1, bnb_amount: 0.5, token_amount: 5 * M }), {});
  fa2.processTick(mkTick({ timestamp: T0 + 4000, trader_address: 'w4', block_number: 53, log_index: 1, bnb_amount: 1, token_amount: 10 * M }), {});
  fa2.processTick(mkTick({ timestamp: T0 + 5000, trader_address: 'w2', block_number: 54, log_index: 1,
    trade_type: 'sell', bnb_amount: 2, token_amount: 20 * M }), {});
  const f2 = fa2.buildFactorMap('0xtoken', T0 + 6000);
  check('D2 第二大清仓后 top1=66.67 / top2=88.89（(30+10)/45，w3 5M < w4 10M 不进前二）', () => {
    assert.ok(Math.abs(f2.top1HolderCircPct - 66.6667) < 0.001, `top1 got ${f2.top1HolderCircPct}`);
    assert.ok(Math.abs(f2.top2HolderCircPct - 88.8889) < 0.001, `top2 got ${f2.top2HolderCircPct}`);
  });
}

// ═══════════════ E. T91a 孙权形状 ≤100 反证 ═══════════════
console.log('E. T91a 分母口径反证（零买纯卖钱包压流通）');
{
  const fa = newFA();
  for (let i = 0; i < 5; i++) {
    fa.processTick(mkTick({ timestamp: T0 + 1000 + i, trader_address: `wb${i}`, block_number: 50 + i,
      log_index: 1, bnb_amount: 1, token_amount: 10 * M }), {});
  }
  // 10 个零买纯卖钱包（税币接收方/初始筹码，孙权 114% 同形状）各卖 3.5M
  for (let i = 0; i < 10; i++) {
    fa.processTick(mkTick({ timestamp: T0 + 8000 + i, trader_address: `ws${i}`, block_number: 90 + i,
      log_index: 1, trade_type: 'sell', bnb_amount: 0.35, token_amount: 3.5 * M }), {});
  }
  const f = fa.buildFactorMap('0xtoken', T0 + 20000);
  check('E1 流通被压到 15M：top1=20 / top2=40（旧分母形状 20/15=133% 绝迹，恒 ≤100）', () => {
    assert.ok(Math.abs(f.top1HolderCircPct - 20) < 0.001, `top1 got ${f.top1HolderCircPct}`);
    assert.ok(Math.abs(f.top2HolderCircPct - 40) < 0.001, `top2 got ${f.top2HolderCircPct}`);
  });
}

// ═══════════════ F. 乱序 parity ═══════════════
console.log('F. 乱序 parity（钱包净额加减交换律）');
{
  const tks = [
    mkTick({ timestamp: T0 + 1000, trader_address: 'w1', block_number: 50, log_index: 1, bnb_amount: 3, token_amount: 30 * M }),
    mkTick({ timestamp: T0 + 2000, trader_address: 'w2', block_number: 51, log_index: 1, bnb_amount: 2, token_amount: 20 * M }),
    mkTick({ timestamp: T0 + 3000, trader_address: 'w3', block_number: 52, log_index: 1, bnb_amount: 1, token_amount: 10 * M }),
    mkTick({ timestamp: T0 + 4000, trader_address: 'w2', block_number: 53, log_index: 1, trade_type: 'sell', bnb_amount: 0.5, token_amount: 5 * M }),
  ];
  const faA = newFA(), faB = newFA();
  for (const tk of tks) faA.processTick(tk, {});
  for (const tk of [tks[3], tks[2], tks[1], tks[0]]) faB.processTick(tk, {});
  const a = faA.buildFactorMap('0xtoken', T0 + 5000), b = faB.buildFactorMap('0xtoken', T0 + 5000);
  check('F1 逆序喂 top2 bit 一致（(30+15)/55=81.8）', () => {
    assert.strictEqual(b.top2HolderCircPct, a.top2HolderCircPct);
    assert.ok(Math.abs(a.top2HolderCircPct - 81.8182) < 0.001, `got ${a.top2HolderCircPct}`);
  });
}

// ═══════════════ G. 空窗零值 + 探针 ═══════════════
console.log('G. 空窗零值与探针');
{
  const fa = newFA();
  check('G1 无 tick → 0（有证据零值非 null，_circDen=0 防除零）', () =>
    assert.strictEqual(fa.buildFactorMap('0xtoken', T0 + 5000).top2HolderCircPct, 0));
  check('G2 getFactorKeys 含键（出键自动性）', () =>
    assert.ok(fa.getFactorKeys().has('top2HolderCircPct')));
  const { getAvailableFactorIds } = require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));
  check('G3 getAvailableFactorIds 含键（引擎装载/三防线认得）', () =>
    assert.ok(getAvailableFactorIds().has('top2HolderCircPct')));
}

// ═══════════════ H. FactorBuilder 快照透传 ═══════════════
console.log('H. FactorBuilder 快照透传');
{
  const { buildFactorValuesForTimeSeries } =
    require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));
  const sample = { top1HolderCircPct: 37.5, top2HolderCircPct: 62.5 };
  check('H1 signal 快照透传（与 top1 同快照语义）', () => {
    const snap = buildFactorValuesForTimeSeries(sample);
    assert.strictEqual(snap.top2HolderCircPct, 62.5);
    assert.strictEqual(snap.top1HolderCircPct, 37.5);
  });
  check('H2 旧输入（FA 无键）→ null 不掩盖', () =>
    assert.strictEqual(buildFactorValuesForTimeSeries({ currentPrice: 1 }).top2HolderCircPct, null));
}

// ═══════════════ I. 源码口径断言 ═══════════════
console.log('I. 源码口径断言（防回退/防误删）');
{
  const src = read('src/services/FourMemeFactorAggregator.js');
  check('I1 公式形状（(_nA + _nB) / _circDen ×100 + _circDen>0 防除零）', () => {
    assert.ok(/const top2HolderCircPct = _circDen > 0 \? \(_nA \+ _nB\) \/ _circDen \* 100 : 0;/.test(src),
      '公式不在位（可能被改回 _circTokens 或换前缀源）');
  });
  check('I2 字面量发射在场（factor map 键）', () =>
    assert.ok(src.includes('top2HolderCircPct,') || src.includes('top2HolderCircPct:')));
  check('I3 top20 前缀只收正净在位（v <= 0 continue——恒 ≥ top1 的前提）', () =>
    assert.ok(/for \(const \[addr, v\] of state\._walletNetTokens\) \{\s*\n\s*if \(v <= 0\) continue;/.test(src)));
  const fb = read('src/trading-engine/core/FactorBuilder.js');
  check('I4 FactorBuilder 快照白名单含键（内存环不可重算，不落库即丢）', () =>
    assert.ok(fb.includes('factorResults.top2HolderCircPct ?? null')));
}

// ═══════════════ J. ConditionEvaluator 直评门 ═══════════════
console.log('J. ConditionEvaluator 直评（主 55 / 早期 65 承接）');
{
  const { ConditionEvaluator } = require(path.join(ROOT, 'src', 'strategies', 'ConditionEvaluator.js'));
  const ev = new ConditionEvaluator();
  check('J1 主门 top2HolderCircPct < 55：50 过 / 55 恰拒（严格小于）', () => {
    assert.strictEqual(ev.evaluate('top2HolderCircPct < 55', { top2HolderCircPct: 50 }), true);
    assert.strictEqual(ev.evaluate('top2HolderCircPct < 55', { top2HolderCircPct: 55 }), false);
  });
  check('J2 早期门 < 65：62.5 过 / 90 拒', () => {
    assert.strictEqual(ev.evaluate('top2HolderCircPct < 65', { top2HolderCircPct: 62.5 }), true);
    assert.strictEqual(ev.evaluate('top2HolderCircPct < 65', { top2HolderCircPct: 90 }), false);
  });
  check('J3 零值放行（0 < 55 恒真——空窗有证据零值非 null 语义）', () =>
    assert.strictEqual(ev.evaluate('top2HolderCircPct < 55', { top2HolderCircPct: 0 }), true));
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
