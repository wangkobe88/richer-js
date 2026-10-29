#!/usr/bin/env node
/**
 * T98 holdersExDust 剔尘埃人气键单测（2026-10-29 用户裁定「极小持仓者剔除——这样
 * 不会让假活跃票进门，新搞一个因子替换现有的 holders」）——本地零 DB 零网络。
 *
 * 键：holdersExDust = 净持仓按**首可靠价**折算 ≥ holderDustBnb 的钱包数。默认
 * 0.015（2026-10-29 追裁定 0.002→0.015——Jenner 0xa3362c21…7777 实查 16 钱包
 * 分布，$10 以下钱包不算有效承接）。与 holders（净持仓 > 0）同 map 同写点：
 * 跨尘门边界 ±1 增量维护（门=token 域常量 → 单钱包变动不影响他钱包跨界，
 * 归纳等价成立）；首价冻结时固化 T=holderDustBnb÷首价并一次性全 map 重扫
 * （每 token 一生恰一次）；无可靠价票 T=0 退化=holders fail-open（宁多计
 * 不放大门拦截力）；显式 holderDustBnb:0 = 恒等 holders。
 *
 * 设计原则：**测机制非默认值**——A-I 组全部显式传 {holderDustBnb: 0.002}
 * 锁定原语义断言（T=200 token 数值不动），以后调默认值不破测试；默认值
 * 断言只在 J4（现 0.015）。
 *
 * 案由（holders 口径问询）：清零者已剔（跨 0 边界）但「卖剩渣」极小持仓无门槛——
 * 刷 holder 的假活跃票（多钱包各买刚过 tick 尘门的 0.001-0.002 BNB）照过人气门。
 *
 * 覆盖：
 *   A. 基础口径（尘埃钱包不计 / 过门钱包计数）
 *   B. 卖剩渣出局（holders 不变、holdersExDust 跨界 --；holders 照计=对照口径）
 *   C. 尘钱包清仓（holders --、holdersExDust 不动=本就不计）
 *   D. ★假活跃票现场反证（立件意图）：10 钱包各 0.0015 BNB + 1 大钱包 →
 *      holders=11 过旧门 / holdersExDust=1 新门拦死
 *   E. 首价缺失退化 fail-open（全行价格不可靠 → holdersExDust ≡ holders）
 *   F. 首价晚到固化重扫（固化前按 T=0 计数 → 冻结时全 map 重数纠正）
 *   G. 显式 holderDustBnb:0 关门 → 恒等 holders
 *   H. 乱序 parity（判定只依赖单钱包净持仓终值 → 交换律收敛）
 *   I. 探针收键 + FactorBuilder 快照透传（值透传 / 旧输入 null 不掩盖）
 *   J. 源码口径断言（增量维护形状 / 固化公式 / 字面量发射 / 白名单 / 默认 0.015）
 *
 * 用法：node scripts/_test_holders_ex_dust.cjs
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
const PRICE = 0.00001;             // 首价（首个可靠行冻结）→ T = 0.002/0.00001 = 200 token
const mkTick = (o) => Object.assign({
  token_address: '0xtoken', trade_type: 'buy', trader_address: null, sender_address: null,
  price_bnb: PRICE, price_usd: 5, bnb_amount: 1, token_amount: 1000,
  block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: 0,
}, o);

/** 标准构造：FA + 已注册 token（factorParams 可覆盖） */
function newFA(factorParams) {
  const cfg = factorParams ? { fourmemeWs: { factorParams } } : {};
  const fa = new FourMemeFactorAggregator(cfg, { info() {}, warn() {}, error() {} });
  fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  return fa;
}
const factors = (fa, ts) => fa.buildFactorMap('0xtoken', ts);

// ═══════════════ A. 基础口径 ═══════════════
console.log('A. 基础口径（净持仓折算 ≥ 0.002 BNB 才算持有人；T=200 token）');
{
  const fa = newFA({ holderDustBnb: 0.002 });
  // w1 大额买 0.003（300 token > 200 过门）；w2 尘埃买 0.001（100 < 200）；w3 巨买过门
  fa.processTick(mkTick({ trader_address: 'w1', bnb_amount: 0.003, token_amount: 300, block_number: 100, log_index: 1 }), {});
  fa.processTick(mkTick({ trader_address: 'w2', bnb_amount: 0.001, token_amount: 100, block_number: 101, log_index: 1 }), {});
  fa.processTick(mkTick({ trader_address: 'w3', bnb_amount: 0.05, token_amount: 5000, block_number: 102, log_index: 1 }), {});
  const f = factors(fa, T0 + 4000);
  check('A1 holders=3 / holdersExDust=2（w2 尘埃不计）', () => {
    assert.strictEqual(f.holders, 3);
    assert.strictEqual(f.holdersExDust, 2);
  });
}

// ═══════════════ B. 卖剩渣出局 ═══════════════
console.log('B. 卖剩渣出局（holders 照计=既有口径不动；holdersExDust 跨界 --）');
{
  const fa = newFA({ holderDustBnb: 0.002 });
  fa.processTick(mkTick({ trader_address: 'w1', bnb_amount: 0.003, token_amount: 300, block_number: 100, log_index: 1 }), {});
  fa.processTick(mkTick({ trader_address: 'w3', bnb_amount: 0.05, token_amount: 5000, block_number: 101, log_index: 1 }), {});
  let f = factors(fa, T0 + 3000);
  check('B1 基线 holders=2 / holdersExDust=2', () => {
    assert.strictEqual(f.holders, 2); assert.strictEqual(f.holdersExDust, 2);
  });
  // w1 卖 250 剩 50（折算 0.0005 < 0.002）
  fa.processTick(mkTick({ trader_address: 'w1', trade_type: 'sell', bnb_amount: 0.0025, token_amount: 250, block_number: 102, log_index: 1 }), {});
  f = factors(fa, T0 + 4000);
  check('B2 卖剩渣：holders=2（50>0 照计）/ holdersExDust=1（跨尘门出局）', () => {
    assert.strictEqual(f.holders, 2);
    assert.strictEqual(f.holdersExDust, 1);
  });
}

// ═══════════════ C. 尘钱包清仓 ═══════════════
console.log('C. 尘钱包清仓（holders -- / holdersExDust 不动=本就不计）');
{
  const fa = newFA({ holderDustBnb: 0.002 });
  fa.processTick(mkTick({ trader_address: 'w1', bnb_amount: 0.003, token_amount: 300, block_number: 100, log_index: 1 }), {});
  fa.processTick(mkTick({ trader_address: 'w2', bnb_amount: 0.001, token_amount: 100, block_number: 101, log_index: 1 }), {});
  fa.processTick(mkTick({ trader_address: 'w2', trade_type: 'sell', bnb_amount: 0.001, token_amount: 100, block_number: 102, log_index: 1 }), {});
  const f = factors(fa, T0 + 4000);
  check('C1 尘钱包清仓：holders=1 / holdersExDust=1（全程未计 w2）', () => {
    assert.strictEqual(f.holders, 1);
    assert.strictEqual(f.holdersExDust, 1);
  });
}

// ═══════════════ D. ★假活跃票现场反证（立件意图） ═══════════════
console.log('D. 假活跃票现场反证：10 钱包各 0.0015 BNB（刚过 tick 尘门 <0.002 尘门）+ 1 大钱包');
{
  const fa = newFA({ holderDustBnb: 0.002 });
  // 大钱包先行定首价（0.0015 < minPriceUpdateBnb 0.002 的行价格不可靠，须可靠行冻结）
  fa.processTick(mkTick({ trader_address: 'wbig', bnb_amount: 0.05, token_amount: 5000, block_number: 100, log_index: 1 }), {});
  for (let i = 1; i <= 10; i++) {
    fa.processTick(mkTick({ trader_address: 'ws' + i, bnb_amount: 0.0015, token_amount: 150, block_number: 100 + i, log_index: 1 }), {});
  }
  const f = factors(fa, T0 + 13000);
  check('D1 holders=11（旧口径 holders >= 10 放行假活跃票）', () => assert.strictEqual(f.holders, 11));
  check('D2 holdersExDust=1（新口径 holdersExDust >= 10 拦死——尘埃钱包全不计）', () =>
    assert.strictEqual(f.holdersExDust, 1));
  check('D3 门语义反转实证：holders >= 10 真 / holdersExDust >= 10 假', () => {
    assert.ok(f.holders >= 10);
    assert.ok(!(f.holdersExDust >= 10));
  });
}

// ═══════════════ E. 首价缺失退化 fail-open ═══════════════
console.log('E. 首价缺失（全行价格不可靠 bnb<0.002）→ T=0 退化 holdersExDust ≡ holders');
{
  const fa = newFA({ holderDustBnb: 0.002 });
  fa.processTick(mkTick({ trader_address: 'w1', bnb_amount: 0.0015, token_amount: 300, block_number: 100, log_index: 1 }), {});
  fa.processTick(mkTick({ trader_address: 'w2', bnb_amount: 0.0015, token_amount: 150, block_number: 101, log_index: 1 }), {});
  const f = factors(fa, T0 + 3000);
  check('E1 无可靠价票两口径一致（fail-open 宁多计不放大拦截力）', () =>
    assert.strictEqual(f.holdersExDust, f.holders));
}

// ═══════════════ F. 首价晚到固化重扫 ═══════════════
console.log('F. 首价晚到：固化前按 T=0 计数 → 冻结时全 map 重数纠正');
{
  const fa = newFA({ holderDustBnb: 0.002 });
  // 先尘埃行（价格不可靠 T 未固化，w1 按 T=0 计入）
  fa.processTick(mkTick({ trader_address: 'w1', bnb_amount: 0.0015, token_amount: 150, block_number: 100, log_index: 1 }), {});
  let f = factors(fa, T0 + 2000);
  check('F1 固化前 holders=1 / holdersExDust=1（T=0 退化）', () => {
    assert.strictEqual(f.holders, 1); assert.strictEqual(f.holdersExDust, 1);
  });
  // 首个可靠行到达：首价冻结 + T 固化 + 重扫 → w1（150 ≤ 200）出局纠正
  fa.processTick(mkTick({ trader_address: 'w2', bnb_amount: 0.05, token_amount: 5000, block_number: 101, log_index: 1 }), {});
  f = factors(fa, T0 + 3000);
  check('F2 固化重扫后 holders=2 / holdersExDust=1（w1 尘埃被重扫剔除）', () => {
    assert.strictEqual(f.holders, 2);
    assert.strictEqual(f.holdersExDust, 1);
  });
}

// ═══════════════ G. 显式关门 ═══════════════
console.log('G. holderDustBnb:0 显式关 → 恒等 holders');
{
  const fa = newFA({ holderDustBnb: 0 });
  fa.processTick(mkTick({ trader_address: 'wbig', bnb_amount: 0.05, token_amount: 5000, block_number: 100, log_index: 1 }), {});
  for (let i = 1; i <= 10; i++) {
    fa.processTick(mkTick({ trader_address: 'ws' + i, bnb_amount: 0.0015, token_amount: 150, block_number: 100 + i, log_index: 1 }), {});
  }
  const f = factors(fa, T0 + 13000);
  check('G1 关门后 holdersExDust ≡ holders（=11，与 D 段同场景对照）', () =>
    assert.strictEqual(f.holdersExDust, f.holders));
}

// ═══════════════ H. 乱序 parity ═══════════════
console.log('H. 乱序 parity（判定只依赖单钱包净持仓终值 → 交换律收敛）');
{
  const rows = [
    { trader_address: 'w1', bnb_amount: 0.003, token_amount: 300, block_number: 100, log_index: 1 },
    { trader_address: 'w2', bnb_amount: 0.001, token_amount: 100, block_number: 101, log_index: 1 },
    { trader_address: 'w3', bnb_amount: 0.05, token_amount: 5000, block_number: 102, log_index: 1 },
    { trader_address: 'w1', trade_type: 'sell', bnb_amount: 0.0025, token_amount: 250, block_number: 103, log_index: 1 },
  ];
  const run = (order) => {
    const fa = newFA({ holderDustBnb: 0.002 });
    for (const i of order) fa.processTick(mkTick(rows[i]), {});
    return factors(fa, T0 + 5000);
  };
  const straight = run([0, 1, 2, 3]);
  // 乱序组：卖行先行 / 尘埃行垫后 / 两买行交换（各行 price_bnb 同值 → 首价序无关 → T 序无关）
  const shuffled = run([3, 2, 0, 1]);
  check('H1 正序终值 holders=3 / holdersExDust=1（w1 卖剩渣出局、w2 尘埃不计、仅 w3）', () => {
    assert.strictEqual(straight.holders, 3);
    assert.strictEqual(straight.holdersExDust, 1);
  });
  check('H2 乱序回放同终值（跨尘门判定=单钱包净持仓序列函数，交换律）', () => {
    assert.strictEqual(shuffled.holders, straight.holders);
    assert.strictEqual(shuffled.holdersExDust, straight.holdersExDust);
  });
}

// ═══════════════ I. 探针收键 + 快照透传 ═══════════════
console.log('I. getFactorKeys 探针 + FactorBuilder 快照透传');
{
  const fa = newFA({ holderDustBnb: 0.002 });
  fa.processTick(mkTick({ trader_address: 'w1', bnb_amount: 0.003, token_amount: 300, block_number: 100, log_index: 1 }), {});
  factors(fa, T0 + 2000);
  check('I1 getFactorKeys 自动收键（未知因子三防线认得新键）', () =>
    assert.ok(fa.getFactorKeys().has('holdersExDust'), '键集缺 holdersExDust'));
  const { buildFactorValuesForTimeSeries } =
    require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));
  const snap = buildFactorValuesForTimeSeries({ holders: 7, holdersExDust: 5 });
  check('I2 signal 快照值透传', () => {
    assert.strictEqual(snap.holdersExDust, 5);
    assert.strictEqual(snap.holders, 7);
  });
  check('I3 旧输入（FA 无键）→ null 不掩盖', () =>
    assert.strictEqual(buildFactorValuesForTimeSeries({ currentPrice: 1 }).holdersExDust, null));
}

// ═══════════════ J. 源码口径断言（防漂移防复活） ═══════════════
console.log('J. 源码口径断言');
{
  const fa = read('src/services/FourMemeFactorAggregator.js');
  const fb = read('src/trading-engine/core/FactorBuilder.js');
  check('J1 增量维护形状（跨尘门边界 ±1，与 holderCount 同点）', () =>
    assert.ok(fa.includes('if (_prev <= _d && _cur > _d) state.holderCountExDust++;')
      && fa.includes('else if (_prev > _d && _cur <= _d) state.holderCountExDust--;')));
  check('J2 固化公式（holderDustBnb ÷ 首可靠价 = token 域常量）+ 一次性重扫', () =>
    assert.ok(fa.includes('state._holderDustTokens = this._fp.holderDustBnb / priceBnb;')
      && fa.includes('if (_net > state._holderDustTokens) state.holderCountExDust++;')));
  check('J3 字面量发射（_buildFactorMap 直发 state.holderCountExDust）', () =>
    assert.ok(fa.includes('holdersExDust: state.holderCountExDust,')));
  check('J4 默认 0.015（10-29 追裁定：$10 以下钱包不算有效承接）', () =>
    assert.ok(fa.includes('holderDustBnb: 0.015,')));
  check('J5 FactorBuilder 快照白名单含键（不落库即丢防线）', () =>
    assert.ok(fb.includes("'holdersExDust'")));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
