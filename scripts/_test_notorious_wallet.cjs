#!/usr/bin/env node
/**
 * T222 臭名昭著钱包总流通持仓占比单测（零 DB 零网络）：
 *   notoriousWalletCircPct = 集合钱包**合计**正净持仓 ÷ 流通(_circDen) ×100
 * 口径断言（2026-11-23 用户点名「BSC 链上真的用户看到就想躲的钱包」首个=bf00
 * 大割；「它持仓不多还行」=门只拦高占比）：
 *   A. 名单未启用（null/空 Set）→ 0 fail-open
 *   B. 合计口径精确值（多地址 Σ，非单钱包 max——「总流通持仓占比」）
 *   C. 负净持仓自然出局（净卖光的地址不占额度）
 *   D. 流通分母 T91a（max(_circTokens, Σ正净持仓)）——恒 ≤100
 *   E. 大小写归一
 *   F. 探针收键
 */
'use strict';
const assert = require('assert');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');

const T0 = 1700000000000;
const PX = 1e-9;
let passed = 0;
function check(name, fn) { try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exit(1); } }

function newFA() {
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  return fa;
}
let seq = 0;
function mkTick(o) {
  return {
    token_address: '0xtoken', trade_type: o.side ?? 'buy', trader_address: null, sender_address: o.w,
    price_bnb: PX, price_usd: 5, bnb_amount: o.bnb ?? 0.05, token_amount: o.tok ?? 5e7,
    block_number: 100, log_index: (seq++),
    timestamp: o.ts, tx_hash: '0xtx' + seq, price_outlier: false,
  };
}
function inject(roster) { FourMemeFactorAggregator.setNotoriousWalletsForTest(roster); }

console.log('A. 名单未启用 fail-open');
{
  const fa = newFA();
  FourMemeFactorAggregator.setNotoriousWalletsForTest(null);
  fa.processTick(mkTick({ ts: T0 + 1000, w: 'nA', tok: 2e8 }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 1500);
  check('A1 roster null → 0', () => assert.strictEqual(f.notoriousWalletCircPct, 0));
  FourMemeFactorAggregator.setNotoriousWalletsForTest(new Set());
  const f2 = fa.buildFactorMap('0xtoken', T0 + 1600);
  check('A2 空 Set → 0', () => assert.strictEqual(f2.notoriousWalletCircPct, 0));
  FourMemeFactorAggregator.setNotoriousWalletsForTest(null);
}

console.log('B. 合计口径精确值');
{
  const fa = newFA();
  inject(new Set(['N1', 'N2']));
  // N1 净买 3e8；N2 净买 2e8；wX 净买 5e8 → 流通=1e9，合计=(3+2)e8/1e9=50
  fa.processTick(mkTick({ ts: T0 + 1000, w: 'N1', tok: 3e8 }), {});
  fa.processTick(mkTick({ ts: T0 + 2000, w: 'N2', tok: 2e8 }), {});
  fa.processTick(mkTick({ ts: T0 + 3000, w: 'wX', tok: 5e8 }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 3500);
  check('B1 Σ 正净持仓 ÷ 流通 ×100 = 50', () => assert.strictEqual(f.notoriousWalletCircPct, 50));
  // 单地址=max 语义反证：N1 单持 30 若按 max 口径应是 30 非 50
  check('B2 非单钱包 max（合计 50 ≠ N1 单持 30）', () => assert.ok(Math.abs(f.notoriousWalletCircPct - 50) < 1e-9));
}

console.log('C. 负净持仓自然出局');
{
  const fa = newFA();
  inject(new Set(['N1']));
  // N1 买 3e8 卖 3.5e8 → 净 −0.5e8（卖光+超卖）不占额度；wX 买 1e8 → 流通 0.5e8
  fa.processTick(mkTick({ ts: T0 + 1000, w: 'N1', tok: 3e8 }), {});
  fa.processTick(mkTick({ ts: T0 + 2000, w: 'N1', side: 'sell', tok: 3.5e8 }), {});
  fa.processTick(mkTick({ ts: T0 + 3000, w: 'wX', tok: 1e8 }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 3500);
  check('C1 净卖光的地址不计 → 0', () => assert.strictEqual(f.notoriousWalletCircPct, 0));
}

console.log('D. T91a 流通分母（恒 ≤100）');
{
  const fa = newFA();
  inject(new Set(['N1']));
  // 纯卖钱包压 _circTokens：N1 买 3e8、wSell 纯卖 2e8（无买行）→ _circTokens=1e8、
  // Σ正净=3e8 → 分母 max=3e8 → 占比 100 而非 300
  fa.processTick(mkTick({ ts: T0 + 1000, w: 'N1', tok: 3e8 }), {});
  fa.processTick(mkTick({ ts: T0 + 2000, w: 'wSell', side: 'sell', tok: 2e8 }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 2500);
  check('D1 纯卖钱包分母修正 → 100（非 300）', () => assert.strictEqual(f.notoriousWalletCircPct, 100));
}

console.log('E. 大小写归一');
{
  const fa = newFA();
  inject(new Set(['n1']));
  fa.processTick(mkTick({ ts: T0 + 1000, w: 'N1', tok: 4e8 }), {});
  fa.processTick(mkTick({ ts: T0 + 2000, w: 'wX', tok: 4e8 }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 2500);
  check('E1 混合大小写识别 → 50', () => assert.strictEqual(f.notoriousWalletCircPct, 50));
}

console.log('F. 探针收键');
{
  const fa = newFA();
  check('F1 notoriousWalletCircPct 在键集', () => assert.ok(fa.getFactorKeys().has('notoriousWalletCircPct')));
  // loader 文件形状校验（真实 roster 文件含 bf00）
  check('F2 真实 roster 文件可解析且非空', () => {
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'config', 'rosters', 'notorious-wallets.json'), 'utf8'));
    assert.ok(Array.isArray(p.wallets) && p.wallets.length >= 1);
    assert.strictEqual(p.wallets[0].toLowerCase(), '0xbf004bff64725914ee36d03b87d6965b0ced4903');
  });
}

console.log(`\n全部通过 ${passed} 断言`);
