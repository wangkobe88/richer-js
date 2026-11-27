#!/usr/bin/env node
/**
 * T240 v13 GMGN 画像买家占比单测（零 DB 零网络——名单经 setter 注入）：
 *   gmgnProfiledBuyerPct = 全史买家中库内画像钱包数占比 %（wallet=sender||trader）
 * 口径断言（2026-11-27 用户提案「无 GMGN 画像钱包的比例——做市钱包没画像；有画像
 * 太多=散户大量入场」→ 做市臂「散户包场保护」原料）：
 *   A. 精确值（首见即入分母、去重幂等、卖不入分母）
 *   B. 无买家 → null（条件须带 IS NULL 臂 fail-open）
 *   C. 名单空 Set=保护门全开恒 0（fail-open；文件缺失同态）
 *   D. 名单 null（未加载）→ 分子恒 0（保护门全开，不冒充画像）
 *   E. sender||trader COALESCE 口径（K 组同款）
 *   F. 任意序回放收敛（add-only 计数）
 *   G. 探针收键（getFactorKeys 自动认得——三防线同款）
 *   H. loader：真读 config/rosters/gmgn-profiled-wallets.json（零 DB；文件在库中）
 */
'use strict';
const assert = require('assert');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');

const T0 = 1700000000000;
let passed = 0;
function check(name, fn) { try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exit(1); } }

function newFA() {
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  return fa;
}
let seq = 0;
function mkTick(o) {
  return Object.assign({
    token_address: '0xtoken', trade_type: 'buy', trader_address: null, sender_address: null,
    price_bnb: 1e-9, price_usd: 5, bnb_amount: 1, token_amount: 1000,
    block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: 0,
  }, o, { log_index: o.log_index ?? (seq++) });
}

check('A. 精确值：首见入分母去重、画像分子计数、卖不入分母', () => {
  FourMemeFactorAggregator.setGmgnProfiledWalletsForTest(['0xa', '0xb']);
  const fa = newFA();
  fa.processTick(mkTick({ sender_address: '0xa', bnb_amount: 0.5 }));                       // 画像买家
  fa.processTick(mkTick({ sender_address: '0xc', bnb_amount: 0.3 }));                       // 无画像买家
  fa.processTick(mkTick({ sender_address: '0xa', bnb_amount: 0.2 }));                       // 重复：不计
  fa.processTick(mkTick({ trade_type: 'sell', sender_address: '0xd', bnb_amount: 1 }));     // 卖：不入分母
  const f = fa.buildFactorMap('0xtoken', T0 + 4000);
  assert.strictEqual(f.gmgnProfiledBuyerPct, 50.0, '1/2 画像 = 50');
  // 再来一个画像买家 → 2/3
  fa.processTick(mkTick({ sender_address: '0xb' }));
  const f2 = fa.buildFactorMap('0xtoken', T0 + 5000);
  assert.strictEqual(f2.gmgnProfiledBuyerPct, 66.67, '2/3 = 66.67（toFixed(2)）');
});

check('B. 无买家 → null（条件带 IS NULL 臂 fail-open）', () => {
  FourMemeFactorAggregator.setGmgnProfiledWalletsForTest(['0xa']);
  const fa = newFA();
  const f = fa.buildFactorMap('0xtoken', T0 + 1000);
  assert.strictEqual(f.gmgnProfiledBuyerPct, null, '无买家无证据 → null 不冒充');
});

check('C. 空名单=保护门全开恒 0（fail-open；文件缺失同态）', () => {
  FourMemeFactorAggregator.setGmgnProfiledWalletsForTest([]);
  const fa = newFA();
  fa.processTick(mkTick({ sender_address: '0xa' }));
  fa.processTick(mkTick({ sender_address: '0xb' }));
  const f = fa.buildFactorMap('0xtoken', T0 + 2000);
  assert.strictEqual(f.gmgnProfiledBuyerPct, 0, '空名单 → 分子恒 0=裸比较放行');
});

check('D. 名单 null（未加载）→ 分子恒 0（保护门全开，不冒充画像）', () => {
  FourMemeFactorAggregator.setGmgnProfiledWalletsForTest(null);
  const fa = newFA();
  fa.processTick(mkTick({ sender_address: '0xa' }));
  const f = fa.buildFactorMap('0xtoken', T0 + 2000);
  assert.strictEqual(f.gmgnProfiledBuyerPct, 0, '未加载态 → 0=放行');
});

check('E. sender||trader COALESCE 口径（K 组同款：trader 兜底也计）', () => {
  FourMemeFactorAggregator.setGmgnProfiledWalletsForTest(['0xroute1']);
  const fa = newFA();
  fa.processTick(mkTick({ sender_address: null, trader_address: '0xroute1' }));   // 画像钱包走 trader
  fa.processTick(mkTick({ sender_address: null, trader_address: '0xroute2' }));   // 无画像
  const f = fa.buildFactorMap('0xtoken', T0 + 2000);
  assert.strictEqual(f.gmgnProfiledBuyerPct, 50.0, 'trader 兜底同口径');
});

check('F. 任意序回放收敛（add-only 计数，序无关）', () => {
  FourMemeFactorAggregator.setGmgnProfiledWalletsForTest(['0xa']);
  const ticks = [
    mkTick({ sender_address: '0xc', timestamp: T0 + 3000, log_index: 3 }),
    mkTick({ sender_address: '0xa', timestamp: T0 + 1000, log_index: 1 }),
    mkTick({ sender_address: '0xb', timestamp: T0 + 2000, log_index: 2 }),
  ];
  const fa1 = newFA(); for (const t of ticks) fa1.processTick(t);
  const fa2 = newFA(); for (const t of [...ticks].reverse()) fa2.processTick(t);
  const f1 = fa1.buildFactorMap('0xtoken', T0 + 4000);
  const f2 = fa2.buildFactorMap('0xtoken', T0 + 4000);
  assert.strictEqual(f1.gmgnProfiledBuyerPct, f2.gmgnProfiledBuyerPct, '乱序同值');
  assert.strictEqual(f1.gmgnProfiledBuyerPct, 33.33, '1/3 = 33.33');
});

check('G. 探针收键（getFactorKeys 自动认得）', () => {
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  const keys = fa.getFactorKeys();
  assert.ok(keys.has('gmgnProfiledBuyerPct'), 'FA 键域含 gmgnProfiledBuyerPct');
});

// H 是异步用例（loader 真读文件），放在同步组之后执行——⚠调用前必须先复位注入
// （loader 幂等 guard 会直接返回注入集；F 段留下的 1 元素集正是此坑）
(async () => {
  const fs = require('fs');
  const path = require('path');
  const rosterPath = path.resolve(__dirname, '..', 'config', 'rosters', 'gmgn-profiled-wallets.json');
  if (!fs.existsSync(rosterPath)) { console.log('  ∿ H 跳过（名单文件不在本地）'); }
  else {
    try {
      FourMemeFactorAggregator.setGmgnProfiledWalletsForTest(null);
      const set = await FourMemeFactorAggregator.loadGmgnProfiledWallets();
      assert.ok(set instanceof Set && set.size > 100, `快照名单应 >100 址（实 ${set.size}）`);
      assert.ok(set.has('0x0000000000be226afde21672a5e4adc45692e69d'), '抽查首地址在册');
      console.log('  ✓ H. loader 真读名单（零 DB；文件随库）');
      passed++;
    } catch (e) { console.error(`  ✗ H\n    ${e.message}`); process.exit(1); }
  }
  console.log(`全部通过 ${passed}/8`);
})().catch(e => { console.error(e); process.exit(1); });
