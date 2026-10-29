#!/usr/bin/env node
/**
 * 前 1/2 大净持仓占总量比例观察键单测（2026-10-29 用户裁定「先新增占总量比例的
 * 因子，再观察一段时间再说怎么用」）——本地零 DB 零网络。
 *
 * 键：top1HolderSupplyPct / top2HolderSupplyPct = _top1Net / (_nA+_nB) ÷
 *   state.totalSupply ×100——与 top1/top2HolderCircPct 同分子，分母换 totalSupply。
 * 动机：早期流通分母小，circ 口径占比天然虚高（Binancians 0x04c1…7777 早期窗
 * top1 50-63/top2 79-99 全因流通未铺开）；supply 口径度量「买到总量的多大比例」。
 * 纯观察键不进条件串（T74/T76 先例，阈值待票池分布裁定）。
 * null 语义：totalSupply 缺失(=0) → null（marketCap/shares 族同惯例 fail-closed）。
 *
 * 覆盖：
 *   A. 公式精确值 + 与 circ 键口径分离（同输入双分母对照）
 *   B. ★用户意图现场反证：早期流通小（仅 5% supply 买出）时 circ 虚高 / supply 不受污染
 *   C. 恒 ≤ 同名 circ 键 / 恒 ≤100（Σ正净 ⊆ 池累计流出 ≤ supply）
 *   D. 孙权纯卖形状：supply 口径不受流通分母压低影响（与 T91a circ 修法分离）
 *   E. 退化与负净出局：单持有人 top2==top1；第二大清仓换第三人
 *   F. 乱序 parity（_walletNetTokens 加减交换律，分子同 top2HolderCircPct 前提）
 *   G. supply 缺失 → null；空窗（supply 在无 tick）→ 0 有证据零值；探针收键
 *   H. FactorBuilder 快照透传（值透传 + 旧输入 null 不掩盖）
 *   I. 源码口径断言（公式形状 / 字面量发射 / 快照白名单 / totalSupply 防线）
 *
 * 用法：node scripts/_test_top_holder_supply.cjs
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

/** 标准构造：FA + 已注册 token（totalSupply 显式传入） */
function newFA(totalSupply) {
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply, symbol: 'T', creatorAddress: null });
  return fa;
}

const M = 1e6;

// ═══════════════ A. 公式精确值 + 双分母口径分离 ═══════════════
console.log('A. 公式精确值（前 1/2 大净持仓 ÷ totalSupply，与 circ 键同输入对照）');
{
  const SUP = 100 * M; // 流通铺满后 circ=supply 形状
  const fa = newFA(SUP);
  fa.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'w1', block_number: 50, log_index: 1, bnb_amount: 3, token_amount: 30 * M }), {});
  fa.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'w2', block_number: 51, log_index: 1, bnb_amount: 2, token_amount: 20 * M }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 3000);
  check('A1 双持有人：top1S=30 / top2S=50（(30+20)/100M——circ 60/100 对照分离）', () => {
    assert.ok(Math.abs(f.top1HolderSupplyPct - 30) < 1e-6, `top1S got ${f.top1HolderSupplyPct}`);
    assert.ok(Math.abs(f.top2HolderSupplyPct - 50) < 1e-6, `top2S got ${f.top2HolderSupplyPct}`);
    assert.ok(Math.abs(f.top1HolderCircPct - 60) < 1e-6);
    assert.ok(Math.abs(f.top2HolderCircPct - 100) < 1e-6);
  });
  check('A2 流通铺满时两口径重合（supply==circDen → S==C）', () => {
    assert.ok(Math.abs(f.top1HolderSupplyPct - f.top1HolderCircPct * 0.5) < 1e-6); // 50M/100M 流通
  });
}

// ═══════════════ B. 用户意图现场反证（早期流通小） ═══════════════
console.log('B. 早期流通小：circ 虚高 / supply 不受流通进度污染');
{
  // Binancians 形状最小化：首买家买 30M，流通仅 50M（5% supply）——
  // circ 口径 top1=60（虚高，早期分母小）；supply 口径 top1=3（真实囤筹占总量的比例）
  const fa = newFA(1e9);
  fa.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'w1', block_number: 50, log_index: 1, bnb_amount: 3, token_amount: 30 * M }), {});
  fa.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'w2', block_number: 51, log_index: 1, bnb_amount: 2, token_amount: 20 * M }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 3000);
  check('B1 早期 5% 流通：circ top1=60 虚高 vs supply top1=3（30M/1e9）', () => {
    assert.ok(Math.abs(f.top1HolderCircPct - 60) < 1e-6);
    assert.ok(Math.abs(f.top1HolderSupplyPct - 3) < 1e-6, `top1S got ${f.top1HolderSupplyPct}`);
  });
  check('B2 supply top2=5（(30+20)M/1e9）vs circ top2=100——观察维度正交', () => {
    assert.ok(Math.abs(f.top2HolderSupplyPct - 5) < 1e-6, `top2S got ${f.top2HolderSupplyPct}`);
    assert.ok(Math.abs(f.top2HolderCircPct - 100) < 1e-6);
  });
}

// ═══════════════ C. 恒 ≤ 同名 circ 键 / 恒 ≤100 ═══════════════
console.log('C. 不变量（S ≤ C、≤100）');
{
  const fa = newFA(1e9);
  fa.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'w1', block_number: 50, log_index: 1, bnb_amount: 3, token_amount: 300 * M }), {});
  fa.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'w2', block_number: 51, log_index: 1, bnb_amount: 1, token_amount: 100 * M }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 3000);
  check('C1 恒 ≤ 同名 circ 键（supply ≥ _circDen：75/40 vs 100/100）', () => {
    assert.ok(f.top1HolderSupplyPct <= f.top1HolderCircPct);
    assert.ok(f.top2HolderSupplyPct <= f.top2HolderCircPct);
    assert.ok(Math.abs(f.top1HolderSupplyPct - 30) < 1e-6 && Math.abs(f.top2HolderSupplyPct - 40) < 1e-6);
  });
  const fa2 = newFA(400 * M); // 全部 supply 买出的极端形状
  fa2.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'w1', block_number: 50, log_index: 1, bnb_amount: 3, token_amount: 300 * M }), {});
  fa2.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'w2', block_number: 51, log_index: 1, bnb_amount: 1, token_amount: 100 * M }), {});
  const f2 = fa2.buildFactorMap('0xtoken', T0 + 3000);
  check('C2 极端全流出 top2S 恰 100（≤100 封顶不断言 <）', () =>
    assert.ok(Math.abs(f2.top2HolderSupplyPct - 100) < 1e-6, `got ${f2.top2HolderSupplyPct}`));
}

// ═══════════════ D. 孙权纯卖形状（supply 口径与 T91a 修法分离） ═══════════════
console.log('D. 零买纯卖钱包压流通分母（孙权 114% 形状）');
{
  const fa = newFA(1e9);
  for (let i = 0; i < 5; i++) {
    fa.processTick(mkTick({ timestamp: T0 + 1000 + i, trader_address: `wb${i}`, block_number: 50 + i,
      log_index: 1, bnb_amount: 1, token_amount: 10 * M }), {});
  }
  for (let i = 0; i < 10; i++) {
    fa.processTick(mkTick({ timestamp: T0 + 8000 + i, trader_address: `ws${i}`, block_number: 90 + i,
      log_index: 1, trade_type: 'sell', bnb_amount: 0.35, token_amount: 3.5 * M }), {});
  }
  const f = fa.buildFactorMap('0xtoken', T0 + 20000);
  check('D1 纯卖钱包压流通：circ top1=20（T91a max 分母）/ supply top1=1（10M/1e9 不变）', () => {
    assert.ok(Math.abs(f.top1HolderCircPct - 20) < 0.001);
    assert.ok(Math.abs(f.top1HolderSupplyPct - 1) < 1e-6, `top1S got ${f.top1HolderSupplyPct}`);
    assert.ok(Math.abs(f.top2HolderSupplyPct - 2) < 1e-6, `top2S got ${f.top2HolderSupplyPct}`);
  });
}

// ═══════════════ E. 退化与负净出局 ═══════════════
console.log('E. 退化与负净出局');
{
  const fa = newFA(1e9);
  fa.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'w1', block_number: 50, log_index: 1, bnb_amount: 1, token_amount: 10 * M }), {});
  const f1 = fa.buildFactorMap('0xtoken', T0 + 2000);
  check('E1 单持有人 top2S==top1S（_nB=0 退化同 circ 键语义）', () =>
    assert.strictEqual(f1.top2HolderSupplyPct, f1.top1HolderSupplyPct));
  const fa2 = newFA(1e9);
  fa2.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'w1', block_number: 50, log_index: 1, bnb_amount: 3, token_amount: 30 * M }), {});
  fa2.processTick(mkTick({ timestamp: T0 + 2000, trader_address: 'w2', block_number: 51, log_index: 1, bnb_amount: 2, token_amount: 20 * M }), {});
  fa2.processTick(mkTick({ timestamp: T0 + 3000, trader_address: 'w4', block_number: 52, log_index: 1, bnb_amount: 1, token_amount: 10 * M }), {});
  fa2.processTick(mkTick({ timestamp: T0 + 4000, trader_address: 'w2', block_number: 53, log_index: 1,
    trade_type: 'sell', bnb_amount: 2, token_amount: 20 * M }), {});
  const f2 = fa2.buildFactorMap('0xtoken', T0 + 5000);
  check('E2 第二大清仓出局：top1S=3 / top2S=4（(30+10)M/1e9，净卖者不进分子）', () => {
    assert.ok(Math.abs(f2.top1HolderSupplyPct - 3) < 1e-6, `got ${f2.top1HolderSupplyPct}`);
    assert.ok(Math.abs(f2.top2HolderSupplyPct - 4) < 1e-6, `got ${f2.top2HolderSupplyPct}`);
  });
}

// ═══════════════ F. 乱序 parity ═══════════════
console.log('F. 乱序 parity（分子同 top2HolderCircPct 前提）');
{
  const tks = [
    mkTick({ timestamp: T0 + 1000, trader_address: 'w1', block_number: 50, log_index: 1, bnb_amount: 3, token_amount: 30 * M }),
    mkTick({ timestamp: T0 + 2000, trader_address: 'w2', block_number: 51, log_index: 1, bnb_amount: 2, token_amount: 20 * M }),
    mkTick({ timestamp: T0 + 3000, trader_address: 'w3', block_number: 52, log_index: 1, bnb_amount: 1, token_amount: 10 * M }),
    mkTick({ timestamp: T0 + 4000, trader_address: 'w2', block_number: 53, log_index: 1, trade_type: 'sell', bnb_amount: 0.5, token_amount: 5 * M }),
  ];
  const faA = newFA(1e9), faB = newFA(1e9);
  for (const tk of tks) faA.processTick(tk, {});
  for (const tk of [tks[3], tks[2], tks[1], tks[0]]) faB.processTick(tk, {});
  const a = faA.buildFactorMap('0xtoken', T0 + 5000), b = faB.buildFactorMap('0xtoken', T0 + 5000);
  check('F1 逆序喂 bit 一致（(30+15)M/1e9=4.5）', () => {
    assert.strictEqual(b.top1HolderSupplyPct, a.top1HolderSupplyPct);
    assert.strictEqual(b.top2HolderSupplyPct, a.top2HolderSupplyPct);
    assert.ok(Math.abs(a.top2HolderSupplyPct - 4.5) < 1e-6, `got ${a.top2HolderSupplyPct}`);
  });
}

// ═══════════════ G. null 语义 + 空窗零值 + 探针 ═══════════════
console.log('G. supply 缺失 null / 空窗零值 / 探针');
{
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  fa.registerToken('0xtoken', { createdAtMs: T0, symbol: 'T' }); // 不传 totalSupply
  fa.processTick(mkTick({ timestamp: T0 + 1000, trader_address: 'w1', block_number: 50, log_index: 1, bnb_amount: 1, token_amount: 10 * M }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 2000);
  check('G1 totalSupply 缺失 → null（fail-closed，marketCap/shares 族同惯例；circ 键照常 100）', () => {
    assert.strictEqual(f.top1HolderSupplyPct, null);
    assert.strictEqual(f.top2HolderSupplyPct, null);
    assert.ok(Math.abs(f.top1HolderCircPct - 100) < 1e-6);
  });
  const fa2 = newFA(1e9);
  check('G2 空窗（supply 在无 tick）→ 0 有证据零值非 null', () =>
    assert.strictEqual(fa2.buildFactorMap('0xtoken', T0 + 5000).top2HolderSupplyPct, 0));
  check('G3 getFactorKeys 含两键（出键自动性）', () => {
    const ks = fa2.getFactorKeys();
    assert.ok(ks.has('top1HolderSupplyPct') && ks.has('top2HolderSupplyPct'));
  });
  const { getAvailableFactorIds } = require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));
  check('G4 getAvailableFactorIds 含两键（引擎装载/三防线认得）', () => {
    const ids = getAvailableFactorIds();
    assert.ok(ids.has('top1HolderSupplyPct') && ids.has('top2HolderSupplyPct'));
  });
}

// ═══════════════ H. FactorBuilder 快照透传 ═══════════════
console.log('H. FactorBuilder 快照透传');
{
  const { buildFactorValuesForTimeSeries } =
    require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));
  const sample = { top1HolderSupplyPct: 3.1, top2HolderSupplyPct: 4.9 };
  check('H1 signal 快照透传（观察键不落库即丢）', () => {
    const snap = buildFactorValuesForTimeSeries(sample);
    assert.strictEqual(snap.top1HolderSupplyPct, 3.1);
    assert.strictEqual(snap.top2HolderSupplyPct, 4.9);
  });
  check('H2 旧输入（FA 无键）→ null 不掩盖', () =>
    assert.strictEqual(buildFactorValuesForTimeSeries({ currentPrice: 1 }).top1HolderSupplyPct, null));
}

// ═══════════════ I. 源码口径断言 ═══════════════
console.log('I. 源码口径断言（防回退/防误删）');
{
  const src = read('src/services/FourMemeFactorAggregator.js');
  check('I1 公式形状（_top1Net / (_nA + _nB) ÷ state.totalSupply + supply>0 门）', () => {
    assert.ok(/const top1HolderSupplyPct = state\.totalSupply > 0 \? _top1Net \/ state\.totalSupply \* 100 : null;/.test(src),
      'top1 公式不在位');
    assert.ok(/const top2HolderSupplyPct = state\.totalSupply > 0 \? \(_nA \+ _nB\) \/ state\.totalSupply \* 100 : null;/.test(src),
      'top2 公式不在位');
  });
  check('I2 字面量发射在场（factor map 键）', () =>
    assert.ok(src.includes('top1HolderSupplyPct,') && src.includes('top2HolderSupplyPct,')));
  const fb = read('src/trading-engine/core/FactorBuilder.js');
  check('I3 FactorBuilder 快照白名单含两键', () =>
    assert.ok(fb.includes('factorResults.top1HolderSupplyPct ?? null') && fb.includes('factorResults.top2HolderSupplyPct ?? null')));
  check('I4 registerToken totalSupply 防线在位（info.totalSupply > 0 才写 state）', () =>
    assert.ok(/if \(info\.totalSupply > 0\) state\.totalSupply = info\.totalSupply;/.test(src)));
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
