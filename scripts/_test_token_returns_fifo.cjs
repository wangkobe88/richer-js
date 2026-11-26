#!/usr/bin/env node
/**
 * token-returns / trades 页 FIFO 盈亏口径回归（零 DB 零网络——直接 eval 页面脚本、
 * 伪造实例、喂真实事故现场行断言）。
 *
 * 事故现场（2026-11-26 用户报「0x00498f 显示亏损 48% 但交易不亏」）：
 * Темир 4 卡买入 0.2 BNB 实收 36,284.077695663414，随后两笔同秒（created_at 全等
 * 17:02:23.000Z）半仓卖单各卖 18,142.038847831707 收 0.1037332。旧代码在循环内
 * 「全清腿残量归零」（cardTrade.after===0 触发）把尚未处理的兄弟半仓成本并入本对
 * ——全清卖先被处理时本对成本翻倍 0.2、只记一笔卖收 → 收益率 −48.13%（=用户所见）。
 * 修法=循环内只记 fullCloseSeen 标记、全部行处理完后才吸收残量到尾对（此时队列剩余
 * 只可能是真税损尾巴）；排序加 executed_at 决胜键。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const reads = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

function loadPageClass(rel, className) {
  let src = reads(rel);
  // 中和自动实例化，只暴露类
  const idx = src.lastIndexOf("document.addEventListener('DOMContentLoaded'");
  if (idx > 0) src = src.slice(0, idx);
  src += `\n;globalThis.__CLS__ = ${className};`;
  const sandbox = {
    document: {
      addEventListener() {}, removeEventListener() {}, createElement: () => ({}),
      getElementById: () => ({ addEventListener() {}, classList: { add() {}, remove() {} } }),
      querySelector: () => null, querySelectorAll: () => [], body: {}, documentElement: {},
    },
    window: null, console, fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }),
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    Chart: function () {}, requestAnimationFrame: (fn) => setTimeout(fn, 0),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: rel });
  if (!sandbox.__CLS__) throw new Error(`${className} 未暴露（尾部替换失败？）`);
  return sandbox.__CLS__;
}

const TokenReturns = loadPageClass('src/web/static/js/experiment_token_returns.js', 'ExperimentTokenReturns');
const Trades = loadPageClass('src/web/static/js/experiment_trades.js', 'ExperimentTrades');

let passed = 0, failed = 0;
function check(label, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ❌ FAIL: ' + label + (extra !== undefined ? ` | ${extra}` : '')); }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ── Темир 事故现场行（同秒双卖）──
const buyRow = {
  token_address: '0x00498f2e3e0d5dd2d67d0c89363bc806b9997777', trade_direction: 'buy', status: 'success',
  input_amount: 0.2, output_amount: 36284.077695663414, unit_price: 0.000005512059633361,
  created_at: '2026-10-03T16:57:58.200Z', executed_at: '2026-11-26T11:05:59.407Z', metadata: { cardTrade: { after: 4, cards: 4 } },
};
const halfSellRow = (over = {}) => ({
  token_address: buyRow.token_address, trade_direction: 'sell', status: 'success',
  input_amount: 18142.038847831707, output_amount: 0.10373320947194395, unit_price: 0.000005717836365693,
  created_at: '2026-10-03T17:02:23.000Z', executed_at: '2026-11-26T11:05:59.473Z',
  metadata: { cardTrade: { after: 2, cards: 2 }, sellPercentage: 0.5 },
  ...over,
});
const fullCloseSellRow = (over = {}) => ({
  ...halfSellRow(), executed_at: '2026-11-26T11:05:59.474Z',
  metadata: { cardTrade: { after: 0, cards: 2 }, sellPercentage: 1 },
  ...over,
});

// ── 普通人 0x934b 税损尾案（2026-10-28 立法的原形状：live 税币链上卖量 < 账面买入量）──
const dustBuy = {
  token_address: '0x934b1111111111111111111111111111117777', trade_direction: 'buy', status: 'success',
  input_amount: 0.5, output_amount: 717544, unit_price: 6.97e-7,
  created_at: '2026-10-28T10:00:00.000Z', executed_at: '2026-10-28T10:00:01.000Z', metadata: {},
};
const dustSell = {
  token_address: dustBuy.token_address, trade_direction: 'sell', status: 'success',
  input_amount: 699608, output_amount: 0.49, unit_price: 7.0e-7,
  created_at: '2026-10-28T10:25:00.000Z', executed_at: '2026-10-28T10:25:01.000Z',
  metadata: { sellPercentage: 1, cardTrade: { after: 0 } },
};

console.log('A. token-returns 页（Темир 事故现场）');
{
  // A1 乱序：全清卖（after=0）executed_at 更早 → 排序后先被处理（旧代码在此顺序下 −48.13%）
  const inst = Object.create(TokenReturns.prototype);
  inst.tradesData = [fullCloseSellRow({ executed_at: '2026-11-26T11:05:59.470Z' }), halfSellRow(), buyRow];
  const p = inst.calculateTokenPnL(buyRow.token_address);
  check('A1 乱序（全清卖先处理）：收益率 +3.7332%（非 −48.13%）', near(p.returnRate, 3.7332094719439435));
  check('A1 乱序：realizedPnL +0.0075', near(p.realizedPnL, 0.0074664189438879, 1e-4));
  check('A1 乱序：两对全匹配、无假持仓', p.pairCount === 2 && p.hasUnmatchedBuy === false && p.status === 'exited');
  check('A1 乱序：总投入 0.2 / 总收到 0.2075', near(p.totalSpent, 0.2) && near(p.totalReceived, 0.2074664189438879, 1e-4));

  // A2 正序：半仓卖先、全清卖后
  const inst2 = Object.create(TokenReturns.prototype);
  inst2.tradesData = [buyRow, halfSellRow(), fullCloseSellRow()];
  const p2 = inst2.calculateTokenPnL(buyRow.token_address);
  check('A2 正序：收益率同 +3.7332%', near(p2.returnRate, 3.7332094719439435));
  check('A2 正序：两对、无假持仓', p2.pairCount === 2 && p2.hasUnmatchedBuy === false);
}

console.log('B. token-returns 页（普通人税损尾案——旧立法形状不被破坏）');
{
  const inst = Object.create(TokenReturns.prototype);
  inst.tradesData = [dustBuy, dustSell];
  const p = inst.calculateTokenPnL(dustBuy.token_address);
  check('B1 税损尾巴并入最后一对：pair.cost=0.5', p.tradePairs.length === 1 && near(p.tradePairs[0].cost, 0.5));
  check('B1 pair pnl=−0.01（税损已实现）', near(p.tradePairs[0].pnl, -0.01, 1e-4));
  check('B1 无假持仓（不渲染「卖出全部」）', p.hasUnmatchedBuy === false && p.status === 'exited');
  check('B1 收益率 −2%', near(p.returnRate, -2, 1e-6));
}

console.log('C. token-returns 页（部分卖出未全清——持仓语义保持）');
{
  const inst = Object.create(TokenReturns.prototype);
  inst.tradesData = [
    { ...buyRow, output_amount: 100, metadata: {} },
    { ...halfSellRow(), input_amount: 50, output_amount: 0.06, metadata: {} },
  ];
  const p = inst.calculateTokenPnL(buyRow.token_address);
  check('C1 未全清=持仓中', p.hasUnmatchedBuy === true && p.status === 'bought');
  check('C1 剩余成本=半仓', near(p.remainingCost, 0.1));
}

console.log('D. trades 页（同款修复）');
{
  // D1 Темир 乱序
  const inst = Object.create(Trades.prototype);
  inst.tradesData = [fullCloseSellRow({ executed_at: '2026-11-26T11:05:59.470Z' }), halfSellRow(), buyRow];
  const p = inst.calculateTokenPnL(buyRow.token_address);
  check('D1 乱序：totalPnL +0.0075', near(p.totalPnL, 0.0074664189438879, 1e-4));
  check('D1 乱序：pnlRate +3.7332%', near(p.pnlRate, 3.7332094719439435));
  check('D1 乱序：无剩余持仓', p.remainingTokens === 0 && near(p.remainingCost, 0));

  // D2 普通人税损尾
  const inst2 = Object.create(Trades.prototype);
  inst2.tradesData = [dustBuy, dustSell];
  const p2 = inst2.calculateTokenPnL(dustBuy.token_address);
  check('D2 totalPnL=−0.01（税损已实现）', near(p2.totalPnL, -0.01, 1e-4));
  check('D2 无剩余持仓', p2.remainingTokens === 0 && near(p2.remainingCost, 0));

  // D3 未全清：剩余持仓照算
  const inst3 = Object.create(Trades.prototype);
  inst3.tradesData = [
    { ...buyRow, output_amount: 100, metadata: {} },
    { ...halfSellRow(), input_amount: 50, output_amount: 0.06, metadata: {} },
  ];
  const p3 = inst3.calculateTokenPnL(buyRow.token_address);
  check('D3 未全清：剩余 50 token / 成本 0.1', near(p3.remainingTokens, 50) && near(p3.remainingCost, 0.1));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} token-returns/trades FIFO 回归：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
