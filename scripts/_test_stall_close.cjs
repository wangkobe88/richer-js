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
 *   D. T118 断流足额门（0x48ce 案 2026-11-05 用户指令「这个级别的交易就给忽略掉吧，
 *      至少 0.02 吧」）：真 FA lastSubstantialTickAt 水位推进（微量不推进/足额推进/
 *      买卖两向同判/恰等阈值推进/Math.max 防回拨/阈值关恒 null）+ 实时与回测
 *      _scanStallClose 水位切换（微量刷新 lastTickAt 不阻拦=0x48ce 事故反证 /
 *      足额近期不触发 / 水位 null fail-open / 关=原口径 / 策略名 ≥vBNB 后缀 /
 *      回测 asOf=lastSubstantialTickAt+stallMs 检测时点 parity）
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
  async function runScan({ now = null, stallMs = 10000, lastTickAtByAddr, holdings, tokenByAddr, factorsByAddr, selling = [], buying = [] }) {
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
    // 扫描期冻结墙钟（锚=调用方构造 lastTickAt 所用的同一 now）：断言集含「恰等阈值
    // 不触发」（0xedge=now-10000 对 stallMs=10000），引擎内部 Date.now() 晚 1ms 即
    // stalledMs=10001 翻越边界——实测原始版 5/8 次假红（T118 扩测时发现的本测试存量
    // 竞速，冻结后边界语义确定性可测）
    const origNow = Date.now;
    const frozen = now != null ? now : origNow.call(Date);
    Date.now = () => frozen;
    try { await eng._scanStallClose(); } finally { Date.now = origNow; }
    return { calls, buildCalls };
  }

  const now = Date.now();
  // 超时 15s > 10s → 触发；窗内 5s → 不触发；恰等 10s → 不触发（> 语义）
  const t1 = await runScan({
    now,
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
    now,
    lastTickAtByAddr: { '0xselling': now - 30000, '0xbuying': now - 30000, '0xsold': now - 30000, '0xok': now - 30000 },
    holdings: [{ tokenAddress: '0xselling' }, { tokenAddress: '0xbuying' }, { tokenAddress: '0xsold' }, { tokenAddress: '0xok' }],
    tokenByAddr: { '0xselling': { token: '0xselling', status: 'bought' }, '0xbuying': { token: '0xbuying', status: 'bought' }, '0xsold': { token: '0xsold', status: 'sold' }, '0xok': { token: '0xok', status: 'bought' } },
    factorsByAddr: { '0xok': { profitPercent: 1 } },
    selling: ['0xselling'], buying: ['0xbuying'],
  });
  check('卖/买执行中与 sold 状态全跳过，仅 0xok 触发', t3.calls.map(c => c.addr), ['0xok']);

  // buildFactorMap null（prune 后）→ 跳过不炸
  const t4 = await runScan({
    now,
    lastTickAtByAddr: { '0xpruned': now - 30000 },
    holdings: [{ tokenAddress: '0xpruned' }],
    tokenByAddr: { '0xpruned': { token: '0xpruned', status: 'bought' } },
    factorsByAddr: { '0xpruned': null },
  });
  check('prune(null factors) 零触发零异常', t4.calls, []);

  // 未配置（_stallCloseMs null）→ no-op 自守卫（不依赖调用方门）
  const t5 = await runScan({ now, stallMs: null, lastTickAtByAddr: { '0xany': now - 999999 }, holdings: [{ tokenAddress: '0xany' }], tokenByAddr: { '0xany': { token: '0xany', status: 'bought' } }, factorsByAddr: { '0xany': { profitPercent: 0 } } });
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

// ═══ D. T118 断流足额门 ═══
console.log('D1. 真 FA lastSubstantialTickAt 水位（阈值 0.02，processTick 直喂）');
{
  const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
  const mkTick = (o) => Object.assign({
    token_address: '0xt', trade_type: 'buy', trader_address: '0xa', sender_address: null,
    price_bnb: 0.00001, price_usd: 5, bnb_amount: 1, token_amount: 1000,
    block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: 0,
  }, o);
  const newFA = (th) => {
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xt', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    if (th != null) fa.setSubstantialTickBnb(th);
    return fa;
  };

  // 0x48ce 事故现场反证：足额 0.5 后连续微量（0.002/0.0067/0.01）——lastTickAt 照推、
  // lastSubstantialTickAt 停在足额笔（微量不算流动性证据=T118 立法本意）
  {
    const fa = newFA(0.02);
    fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 - 40000 }));
    fa.processTick(mkTick({ bnb_amount: 0.002, timestamp: T0 - 10000 }));
    fa.processTick(mkTick({ bnb_amount: 0.0067, timestamp: T0 - 5000 }));
    fa.processTick(mkTick({ bnb_amount: 0.01, timestamp: T0 - 2000 }));
    const st = fa.getTokenState('0xt');
    check('微量三连不推进水位（0x48ce 反证）', st.lastSubstantialTickAt, T0 - 40000);
    check('lastTickAt 全量口径照推（既有消费者零影响）', st.lastTickAt, T0 - 2000);
  }
  // 足额推进：买卖两向同判（大卖也是对手盘流动性）/ 恰等阈值 >= 推进
  {
    const fa = newFA(0.02);
    fa.processTick(mkTick({ bnb_amount: 0.02, timestamp: T0 - 30000 }));   // 恰等阈值 → 推进
    fa.processTick(mkTick({ trade_type: 'sell', bnb_amount: 0.07, timestamp: T0 - 8000 }));
    const st = fa.getTokenState('0xt');
    check('恰等阈值 0.02 推进（>= 语义）+ 足额卖推进', st.lastSubstantialTickAt, T0 - 8000);
  }
  // Math.max 防回拨：迟到旧足额 tick 不拉回水位（与 lastTickAt 同点同防）
  {
    const fa = newFA(0.02);
    fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 - 10000 }));
    fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 - 30000 })); // 迟到旧足额
    const st = fa.getTokenState('0xt');
    check('迟到旧足额 tick 不回拨水位', st.lastSubstantialTickAt, T0 - 10000);
  }
  // 阈值未注入（缺省）→ 水位恒 null（零消费者零影响）；setter 非正数=关
  {
    const fa = newFA();
    fa.processTick(mkTick({ bnb_amount: 5, timestamp: T0 - 1000 }));
    check('阈值关 → 足额 tick 也不推水位（恒 null）', fa.getTokenState('0xt').lastSubstantialTickAt, null);
    fa.setSubstantialTickBnb(0.02);
    check('后补开启不追溯（下一笔起才推）', fa.getTokenState('0xt').lastSubstantialTickAt, null);
    fa.setSubstantialTickBnb(0);
    fa.processTick(mkTick({ bnb_amount: 5, timestamp: T0 - 500 }));
    check('setter 非正数=关', fa.getTokenState('0xt').lastSubstantialTickAt, null);
  }
}

console.log('D2. 实时引擎足额门水位切换（stallMs=10000，minTickBnb=0.02）');
{
  const now = Date.now();
  const run = async ({ minTickBnb, stateByAddr }) => {
    const calls = [];
    const buildCalls = [];
    const eng = makeWssEngine({
      _stallCloseMs: 10000,
      _stallCloseMinTickBnb: minTickBnb,
      _getAllHoldings: () => Object.keys(stateByAddr).map(a => ({ tokenAddress: a })),
      _tokenPool: { getToken: (a) => ({ token: a, status: 'bought' }) },
      _factorAggregator: {
        getTokenState: (a) => stateByAddr[a],
        buildFactorMap: (a, t) => { buildCalls.push({ a, t }); return { profitPercent: -1 }; },
      },
      _sellingTokens: new Set(), _buyingTokens: new Set(),
      _emitStallCloseSell: async (token, factors, stalledMs) => { calls.push({ addr: token.token, stalledMs }); },
    });
    await eng._scanStallClose();
    return { calls, buildCalls };
  };
  // 0x48ce 形状：微量 2s 前刷新 lastTickAt，足额 40s 前——足额门开启即触发（原口径不触发）
  const shape = {
    '0xmicro': { lastTickAt: now - 2000, lastSubstantialTickAt: now - 40000 },
    '0xalive': { lastTickAt: now - 2000, lastSubstantialTickAt: now - 3000 }, // 足额也近期
    '0xfresh': { lastTickAt: now - 2000, lastSubstantialTickAt: null },       // 未见足额
  };
  const d1 = await run({ minTickBnb: 0.02, stateByAddr: shape });
  check('足额门：微量刷新 lastTickAt 不阻拦（0x48ce 形状触发）', d1.calls.map(c => c.addr), ['0xmicro']);
  check('stalledMs 按足额水位计（≥40s）', d1.calls[0].stalledMs >= 40000, true);
  const d2 = await run({ minTickBnb: null, stateByAddr: shape });
  check('足额门关=原 lastTickAt 口径（同形状零触发）', d2.calls, []);
  const d3 = await run({ minTickBnb: 0.02, stateByAddr: { '0xonlynull': { lastTickAt: now - 999999, lastSubstantialTickAt: null } } });
  check('水位 null fail-open（未见足额 tick 不卖）', d3.calls, []);
  // 策略名带 ≥vBNB 后缀（观测口径留痕）
  let captured = null;
  const eng = makeWssEngine({
    _stallCloseMs: 10000, _stallCloseMinTickBnb: 0.02,
    _emitSellSignal: async (t, s) => { captured = s; return { success: true }; },
  });
  eng._emitStallCloseSell({ token: '0x', symbol: 'X' }, {}, 30000);
  check('策略名带足额门后缀', captured.name, '流动性止损-无成交超时(10s,≥0.02BNB)');
  const eng2 = makeWssEngine({
    _stallCloseMs: 10000, _stallCloseMinTickBnb: null,
    _emitSellSignal: async (t, s) => { captured = s; return { success: true }; },
  });
  eng2._emitStallCloseSell({ token: '0x', symbol: 'X' }, {}, 30000);
  check('门关=原名（存量零变化）', captured.name, '流动性止损-无成交超时(10s)');
}

console.log('D3. 回测引擎足额门（虚拟时钟 + asOf 检测时点 parity）');
{
  let captured = null;
  const eng = makeBtEngine({
    _stallCloseMs: 10000, _stallCloseMinTickBnb: 0.02,
    _getAllHoldings: () => [{ tokenAddress: '0xlate' }],
    _tokenPool: { getToken: (a) => ({ token: a, status: 'bought' }) },
    _factorAggregator: {
      // 0x48ce 形状回放版：足额 T0-35s，微量 T0-2s 刷新 lastTickAt 不算证据
      getTokenState: () => ({ lastTickAt: T0 - 2000, lastSubstantialTickAt: T0 - 35000 }),
      buildFactorMap: (a, asOf) => { captured = { a, asOf }; return { profitPercent: -2 }; },
    },
    _sellingTokens: new Set(), _buyingTokens: new Set(),
    _emitStallCloseSell: async () => {},
  });
  await eng._scanStallClose(T0);
  check('足额水位 35s 前超窗触发（微量不阻拦）', captured != null, true);
  check('★asOf=lastSubstantialTickAt+stallMs（检测时点 parity，非 nowTs）', captured.asOf, T0 - 35000 + 10000);
  // 足额近期 → 零构建零触发
  const eng2 = makeBtEngine({
    _stallCloseMs: 10000, _stallCloseMinTickBnb: 0.02,
    _getAllHoldings: () => [{ tokenAddress: '0xok' }],
    _tokenPool: { getToken: (a) => ({ token: a, status: 'bought' }) },
    _factorAggregator: {
      getTokenState: () => ({ lastTickAt: T0 - 2000, lastSubstantialTickAt: T0 - 5000 }),
      buildFactorMap: () => { throw new Error('不应构建'); },
    },
    _sellingTokens: new Set(), _buyingTokens: new Set(),
    _emitStallCloseSell: async () => {},
  });
  await eng2._scanStallClose(T0);
  check('足额近期（5s<10s）不触发', true, true);
}

console.log(`\n结果: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);

})();
