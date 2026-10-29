#!/usr/bin/env node
/**
 * 流动性止损（stall close，T104 2026-10-29）——本地零 DB 零网络单测
 *
 * 背景（用户裁定「如果一个票没流动性了就是要赶紧跑」）：持仓票距上一笔链上成交
 * （FA lastTickAt，非尘 tick 口径）> stallMs → 全部清仓。近 8 天 199 round 回放：
 * 触发 66% / 净 +0.077 BNB/8d / 大票利润 -21%（代价面）。实现=引擎级机制
 * （stallClose 配置段，对齐 stopLoss 家族），实时 1s 墙钟定时器 + 回测主循环
 * processTick 前虚拟时钟 1s 节流扫描；执行走 _emitSellSignal 全清链 bypass 立即
 * 路径（空窗期零 tick，卖确认窗 5-tick 门永远凑不齐——bypass 是机制成立前提）。
 *
 * 覆盖：
 *   A. 实时 _scanStallClose：超时触发 / 窗内不触发 / 恰等阈值不触发（> 语义）/
 *      lastTickAt 缺失 fail-open / 买卖执行中跳过 / 非 bought 跳过 /
 *      buildFactorMap null 跳过 / 未配置 no-op / Date.now() asOf
 *   B. _emitStallCloseSell strategy 构造（cards='all' 全清 / sellPercentage=1 /
 *      bypassDebounce=true / lockTokenAfterSell=false=放行再买臂 / tick=null）
 *   C. 回测 _scanStallClose：虚拟时钟触发 / 因子 asOf=lastTickAt+stallMs
 *      （检测时点 parity 红线——价格冻结在空窗前末 tick，与实时墙钟同价）/
 *      窗内不触发 / lastTickAt 缺失 fail-open / 未配置 no-op
 *
 * 用法：node scripts/_test_stall_close.cjs
 */
'use strict';

const { FourMemeWssTradingEngine } = require('../src/trading-engine/implementations/FourMemeWssTradingEngine');
const { BacktestEngine } = require('../src/trading-engine/implementations/BacktestEngine');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}

// 轻量引擎实例：跳过 constructor（重依赖），prototype 直挂 + 手动注入所需字段
// （_test_stop_loss_rules.cjs 同款 harness）
function makeWssEngine(fields = {}) {
  const eng = Object.create(FourMemeWssTradingEngine.prototype);
  return Object.assign(eng, {
    _experimentId: 'test-exp',
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    _stallCloseMs: null,
    ...fields,
  });
}
function makeBtEngine(fields = {}) {
  const eng = Object.create(BacktestEngine.prototype);
  return Object.assign(eng, {
    _experimentId: 'test-exp',
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    _stallCloseMs: null,
    ...fields,
  });
}

const T0 = 1700000000000;

// ═══ 含 await，CJS 无顶层 await → async IIFE（_test_stop_loss_rules.cjs 同款） ═══
(async () => {

// ═══ A. 实时 _scanStallClose ═══
console.log('A. 实时引擎 _scanStallClose（stallMs=10000，Date.now 墙钟）');
{
  async function runScan({ stallMs = 10000, lastTickAtByAddr, holdings, tokenByAddr, factorsByAddr, selling = [], buying = [] }) {
    const calls = [];
    const buildCalls = [];
    const eng = makeWssEngine({
      _stallCloseMs: stallMs,
      _getAllHoldings: () => holdings,
      _tokenPool: { getToken: (addr) => tokenByAddr[addr] || null },
      _factorAggregator: {
        getTokenState: (addr) => ({ lastTickAt: lastTickAtByAddr[addr] }),
        buildFactorMap: (addr, now) => { buildCalls.push({ addr, now }); return factorsByAddr[addr]; },
      },
      _sellingTokens: new Set(selling), _buyingTokens: new Set(buying),
      _emitStallCloseSell: async (token, factors, stalledMs) => { calls.push({ addr: token.token, factors, stalledMs }); },
    });
    await eng._scanStallClose();
    return { calls, buildCalls };
  }

  const now = Date.now();
  // 超时 15s > 10s → 触发；窗内 5s → 不触发；恰等 10s → 不触发（> 语义）
  const t1 = await runScan({
    lastTickAtByAddr: { '0xstall': now - 15000, '0xalive': now - 5000, '0xedge': now - 10000 },
    holdings: [{ tokenAddress: '0xstall' }, { tokenAddress: '0xalive' }, { tokenAddress: '0xedge' }],
    tokenByAddr: { '0xstall': { token: '0xstall', status: 'bought' }, '0xalive': { token: '0xalive', status: 'bought' }, '0xedge': { token: '0xedge', status: 'bought' } },
    factorsByAddr: { '0xstall': { profitPercent: -3.2 } },
  });
  check('超时 15s 触发（唯一）', t1.calls.map(c => c.addr), ['0xstall']);
  check('触发时 stalledMs 透传（≥15s）', t1.calls[0].stalledMs >= 15000, true);
  check('恰等阈值不触发（> 语义非 >=）', t1.calls.some(c => c.addr === '0xedge'), false);
  check('buildFactorMap 只对超时票调（窗内/恰等零构建）', t1.buildCalls.map(b => b.addr), ['0xstall']);
  check('buildFactorMap asOf=Date.now()（非空墙钟）', t1.buildCalls[0].now != null, true);

  // lastTickAt 缺失 fail-open（重启恢复初期无 tick 证据不卖）
  const t2 = await runScan({
    lastTickAtByAddr: { '0xfresh': null, '0xnostate': undefined },
    holdings: [{ tokenAddress: '0xfresh' }, { tokenAddress: '0xnostate' }],
    tokenByAddr: { '0xfresh': { token: '0xfresh', status: 'bought' }, '0xnostate': { token: '0xnostate', status: 'bought' } },
    factorsByAddr: {},
  });
  check('lastTickAt 缺失/无 state → fail-open 零触发', t2.calls, []);

  // 执行中门：卖出/买入执行中跳过（不重入）；status!=bought 跳过
  const t3 = await runScan({
    lastTickAtByAddr: { '0xselling': now - 30000, '0xbuying': now - 30000, '0xsold': now - 30000, '0xok': now - 30000 },
    holdings: [{ tokenAddress: '0xselling' }, { tokenAddress: '0xbuying' }, { tokenAddress: '0xsold' }, { tokenAddress: '0xok' }],
    tokenByAddr: { '0xselling': { token: '0xselling', status: 'bought' }, '0xbuying': { token: '0xbuying', status: 'bought' }, '0xsold': { token: '0xsold', status: 'sold' }, '0xok': { token: '0xok', status: 'bought' } },
    factorsByAddr: { '0xok': { profitPercent: 1 } },
    selling: ['0xselling'], buying: ['0xbuying'],
  });
  check('卖/买执行中与 sold 状态全跳过，仅 0xok 触发', t3.calls.map(c => c.addr), ['0xok']);

  // buildFactorMap null（prune 后）→ 跳过不炸
  const t4 = await runScan({
    lastTickAtByAddr: { '0xpruned': now - 30000 },
    holdings: [{ tokenAddress: '0xpruned' }],
    tokenByAddr: { '0xpruned': { token: '0xpruned', status: 'bought' } },
    factorsByAddr: { '0xpruned': null },
  });
  check('prune(null factors) 零触发零异常', t4.calls, []);

  // 未配置（_stallCloseMs null）→ no-op 自守卫（不依赖调用方门）
  const t5 = await runScan({ stallMs: null, lastTickAtByAddr: { '0xany': now - 999999 }, holdings: [{ tokenAddress: '0xany' }], tokenByAddr: { '0xany': { token: '0xany', status: 'bought' } }, factorsByAddr: { '0xany': { profitPercent: 0 } } });
  check('未配置 stallClose → _scanStallClose no-op', t5.calls, []);
}

// ═══ B. _emitStallCloseSell strategy 构造 ═══
console.log('B. 实时 _emitStallCloseSell 构造（走 _emitSellSignal 全清链）');
{
  let captured = null;
  const eng = makeWssEngine({
    _stallCloseMs: 10000,
    _emitSellSignal: async (token, strategy, factors, tick) => { captured = { token, strategy, factors, tick }; return { success: true }; },
  });
  const token = { token: '0xabc', symbol: 'TEST' };
  eng._emitStallCloseSell(token, { profitPercent: -4.2 }, 12300);
  check('id/name（档位随 stallMs）', [captured.strategy.id, captured.strategy.name], ['stallClose', '流动性止损-无成交超时(10s)']);
  check('全清语义 cards=all + sellPercentage=1', [captured.strategy.cards, captured.strategy.sellPercentage], ['all', 1]);
  check('bypassDebounce=true（空窗期零 tick，确认窗 5-tick 门凑不齐——立即路径是机制成立前提）', captured.strategy.bypassDebounce, true);
  check('lockTokenAfterSell=false（清仓≠拉黑，放行再买臂接回二次起飞）', captured.strategy.lockTokenAfterSell, false);
  check('action=sell / maxExecutions=null', [captured.strategy.action, captured.strategy.maxExecutions], ['sell', null]);
  check('tick=null 透传（墙钟扫描路径无 tick）', captured.tick, null);
  check('factors 透传', captured.factors, { profitPercent: -4.2 });
}

// ═══ C. 回测 _scanStallClose（虚拟时钟版） ═══
console.log('C. 回测引擎 _scanStallClose（stallMs=10000，虚拟时钟 nowTs）');
{
  async function runBtScan({ stallMs = 10000, lastTickAtByAddr, holdings, nowTs = T0 }) {
    const calls = [];
    const buildCalls = [];
    const eng = makeBtEngine({
      _stallCloseMs: stallMs,
      _getAllHoldings: () => holdings,
      _tokenPool: { getToken: (addr) => ({ token: addr, status: 'bought' }) },
      _factorAggregator: {
        getTokenState: (addr) => ({ lastTickAt: lastTickAtByAddr[addr] }),
        buildFactorMap: (addr, asOf) => { buildCalls.push({ addr, asOf }); return { profitPercent: -2 }; },
      },
      _sellingTokens: new Set(), _buyingTokens: new Set(),
      _emitStallCloseSell: async (token, factors, stalledMs, ts) => { calls.push({ addr: token.token, factors, stalledMs, ts }); },
    });
    await eng._scanStallClose(nowTs);
    return { calls, buildCalls };
  }

  // 超时：lastTickAt=T0-25s，nowTs=T0 → 触发；★asOf=检测时点 lastTickAt+stallMs
  // （parity 红线：价格冻结在空窗前末 tick，与实时墙钟检测同价——若误传 nowTs，
  // 断流期 holdDuration 会多走一段，卖价虽同但时间因子分叉）
  const c1 = await runBtScan({ lastTickAtByAddr: { '0xlate': T0 - 25000 }, holdings: [{ tokenAddress: '0xlate' }] });
  check('超时 25s 触发（唯一）', c1.calls.map(c => c.addr), ['0xlate']);
  check('★因子 asOf=lastTickAt+stallMs（检测时点，非 nowTs）', c1.buildCalls[0].asOf, T0 - 25000 + 10000);
  check('emit 透传 nowTs（虚拟时钟）与 stalledMs', [c1.calls[0].ts, c1.calls[0].stalledMs], [T0, 25000]);

  // 窗内 / 恰等阈值：不触发
  const c2 = await runBtScan({ lastTickAtByAddr: { '0xa': T0 - 5000, '0xb': T0 - 10000 }, holdings: [{ tokenAddress: '0xa' }, { tokenAddress: '0xb' }] });
  check('窗内/恰等阈值零触发（> 语义）', c2.calls, []);

  // lastTickAt 缺失 fail-open / 未配置 no-op
  const c3 = await runBtScan({ lastTickAtByAddr: { '0xfresh': null }, holdings: [{ tokenAddress: '0xfresh' }] });
  check('lastTickAt 缺失 fail-open', c3.calls, []);
  const c4 = await runBtScan({ stallMs: null, lastTickAtByAddr: { '0xany': T0 - 999999 }, holdings: [{ tokenAddress: '0xany' }] });
  check('未配置 stallClose → no-op', c4.calls, []);
}

console.log(`\n结果: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);

})();
