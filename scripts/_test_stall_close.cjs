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
 *   E. T170 almost_launch 域断流延长（fd57 Cashless 案 2026-11-17 用户裁定「价格
 *      都跌到 almost launch 这个范围，断流时间就延长到 1 分钟吧，没啥等待成本，
 *      但是有可能可以救回来大票」）：纯函数（配置归一化 max/缺省 60s/显式 0 关/
 *      域判定 ≤+10 含破发 null 不在域）+ 实时（域内 45s 不卖/65s 卖、域外与缺
 *      证据原阈值照卖、臂关零变化、fd57 事故现场反证=延长窗内足额买盘到达水位
 *      重置零卖出）+ 回测（延长判定吃基础检测点因子、域内耗尽重锚延长点 asOf、
 *      域外票哪怕晚检也保持 T104 基础检测点 parity）
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

// ═══ E. T170+T170b 域断流延长两档（almost_launch 90s + 破发档 180s）═══
console.log('E0. 纯函数 stall-close-almost-launch（两档配置归一化 + 档位判定）');
{
  const M = require('../src/trading-engine/core/stall-close-almost-launch.js');
  // resolveStallCloseExtension：almost 缺省 90s / 破发档缺省关（T170c 2026-11-19
  // d345c 对拍 12/12 全负撤回，显式 breakdownStallMs>0 可恢复）/
  // max 只延长不缩短 / 显式 0 关对应臂 / 机制整体关
  check('缺省 almost 90s + 破发档缺省关（T170c 撤回后）', M.resolveStallCloseExtension({}, 40000), { almostLaunchMs: 90000, breakdownMs: null });
  check('配置 almost 45s 生效（40s→45s 只延长不缩短）', M.resolveStallCloseExtension({ almostLaunchStallMs: 45000 }, 40000), { almostLaunchMs: 45000, breakdownMs: null });
  check('配置 breakdown 240s 显式开启生效', M.resolveStallCloseExtension({ breakdownStallMs: 240000 }, 40000), { almostLaunchMs: 90000, breakdownMs: 240000 });
  check('stallMs 本身 ≥档阈值 → 等于 stallMs（不缩短）', M.resolveStallCloseExtension({ breakdownStallMs: 180000 }, 200000), { almostLaunchMs: 200000, breakdownMs: 200000 });
  check('显式 0=关对应臂（两臂独立）', M.resolveStallCloseExtension({ almostLaunchStallMs: 0, breakdownStallMs: 180000 }, 40000), { almostLaunchMs: null, breakdownMs: 180000 });
  check('显式 0=关破发臂（almost 臂保留）', M.resolveStallCloseExtension({ breakdownStallMs: 0 }, 40000), { almostLaunchMs: 90000, breakdownMs: null });
  check('stallClose 机制整体关 → 两臂随关', M.resolveStallCloseExtension({ almostLaunchStallMs: 90000 }, null), { almostLaunchMs: null, breakdownMs: null });
  check('段缺失（{}兜底）almost 缺省+破发关', M.resolveStallCloseExtension(null, 40000), { almostLaunchMs: 90000, breakdownMs: null });
  // effectiveStallExtension：档位判定（almost ≤+10 / breakdown floorPct≤−5 优先更深档）
  const EXT_ON = { almostLaunchMs: 90000, breakdownMs: 180000 }; // 破发臂显式开形状（留档机制可用性）
  const eff = (curVs, floorPct, ext = EXT_ON) =>
    M.effectiveStallExtension(ext, { currentVsLaunchPct: curVs, currentVsFloorPct: floorPct });
  check('almost 域 curVs=10 恰等在内 → 90s 档', eff(10, null), { ms: 90000, tier: 'almost' });
  check('almost 域外 curVs=10.01 → 不延长', eff(10.01, null), null);
  check('破发档 floorPct=-5 恰等在内 → 180s 档', eff(0, -5), { ms: 180000, tier: 'breakdown' });
  check('双域同真取更深档（breakdown 优先）', eff(3.3, -7), { ms: 180000, tier: 'breakdown' });
  // ★T170b 口径立法反证（用户点名坑）：历史破发回弹票——滚动最低 0.5×地板垫低
  // T139 地板使 curVs=+86（almost 域外），但现价 0.93×T130 地板=真破发 →
  // 破发档必须以 currentVsFloorPct（无滚动最低）接住，curVs 口径此票漏判
  check('★历史破发回弹票 curVs=+86 域外但 floorPct=-7 → 破发档 180s 接住', eff(86, -7), { ms: 180000, tier: 'breakdown' });
  check('floorPct=-4.9 未达破发线 → 落 almost 档（若 curVs 域内）', eff(8, -4.9), { ms: 90000, tier: 'almost' });
  check('floorPct=-4.9 ∧ curVs 域外 → 不延长', eff(28.5, -4.9), null);
  check('curVs null → almost 臂 fail-closed（floorPct 在场照走破发档）', eff(null, -7), { ms: 180000, tier: 'breakdown' });
  check('floorPct null → 破发臂 fail-closed（curVs 域内照走 almost 档）', eff(5, null), { ms: 90000, tier: 'almost' });
  check('双因子 null → 不延长', eff(null, null), null);
  check('双臂全关 → 恒 null', eff(0, -7, { almostLaunchMs: null, breakdownMs: null }), null);
  // ★T170c 撤回锁死：缺省配置（无 breakdownStallMs 键）下破发票不再落破发档——
  // d345c 12/12 全负（瑞娅/面包又鸟/Lora 等），破发域断流=阴跌进行时无恢复期权
  const EXT_DEFAULT = M.resolveStallCloseExtension({}, 40000);
  check('★撤回锁死：缺省配置破发票（curVs 域外）不延长照 40s 卖', M.effectiveStallExtension(EXT_DEFAULT, { currentVsLaunchPct: 86, currentVsFloorPct: -7 }), null);
  check('★撤回锁死：缺省配置破发票（curVs 恰 almost 域内）落 almost 档非破发档', M.effectiveStallExtension(EXT_DEFAULT, { currentVsLaunchPct: 3.3, currentVsFloorPct: -7 }), { ms: 90000, tier: 'almost' });
}

console.log('E1. 实时引擎延长臂（stallMs=10s，almost 90s / 破发 180s）');
{
  const now = Date.now();
  const EXT = { almostLaunchMs: 90000, breakdownMs: 180000 };
  const run = async ({ ext = EXT, lastSubstantialAgoMs, curVs, floorPct = null }) => {
    const calls = [];
    const buildCalls = [];
    const eng = makeWssEngine({
      _stallCloseMs: 10000,
      _stallCloseExt: ext,
      _getAllHoldings: () => [{ tokenAddress: '0xt' }],
      _tokenPool: { getToken: () => ({ token: '0xt', status: 'bought' }) },
      _factorAggregator: {
        getTokenState: () => ({ lastTickAt: now - lastSubstantialAgoMs, lastSubstantialTickAt: now - lastSubstantialAgoMs }),
        buildFactorMap: (a, t) => { buildCalls.push({ a, t }); return { currentVsLaunchPct: curVs, currentVsFloorPct: floorPct }; },
      },
      _sellingTokens: new Set(), _buyingTokens: new Set(),
      _emitStallCloseSell: async (token, factors, stalledMs, extTier) => { calls.push({ addr: token.token, factors, stalledMs, extTier }); },
    });
    await eng._scanStallClose();
    return { calls, buildCalls };
  };
  // fd57 案形状：stallMs=40s 已越（45s>40s），检测时点 curVs≈0（贴地板）→ 延长不卖
  const e1 = await run({ lastSubstantialAgoMs: 45000, curVs: 0 });
  check('域内 45s（越 40s 基础线）不卖=fd57 救回形状', e1.calls, []);
  check('延长判定吃检测时点因子（build 被调）', e1.buildCalls.length, 1);
  const e2 = await run({ lastSubstantialAgoMs: 95000, curVs: 0 });
  check('域内 95s（almost 90s 窗耗尽）照卖', e2.calls.map(c => c.addr), ['0xt']);
  check('耗尽卖出透传 almost 档位（信号名实际生效阈值）', e2.calls[0].extTier, { ms: 90000, tier: 'almost' });
  const e3 = await run({ lastSubstantialAgoMs: 45000, curVs: 28.5 });
  check('域外 45s 原阈值照卖（almost_launch 域限定）', e3.calls.map(c => c.addr), ['0xt']);
  check('域外卖出 extTier=null（原阈值语义）', e3.calls[0].extTier, null);
  const e4 = await run({ lastSubstantialAgoMs: 45000, curVs: null });
  check('curVs 缺失不延长照卖（fail-closed）', e4.calls.map(c => c.addr), ['0xt']);
  const e5 = await run({ ext: { almostLaunchMs: null, breakdownMs: null }, lastSubstantialAgoMs: 45000, curVs: 0 });
  check('双臂关（显式 0/未配段旧实验形状）零变化照卖', e5.calls.map(c => c.addr), ['0xt']);
  // T170b 破发档：curVs=+86（almost 域外）∧ floorPct=-7（真破发）→ 180s 窗
  const e6 = await run({ lastSubstantialAgoMs: 95000, curVs: 86, floorPct: -7 });
  check('★破发档 95s（almost 窗外）不卖（180s 窗内）', e6.calls, []);
  const e7 = await run({ lastSubstantialAgoMs: 185000, curVs: 86, floorPct: -7 });
  check('破发档 185s（180s 窗耗尽）照卖', e7.calls.map(c => c.addr), ['0xt']);
  check('耗尽卖出透传 breakdown 档位', e7.calls[0].extTier, { ms: 180000, tier: 'breakdown' });

  // fd57 事故现场反证：延长窗内第二波足额买盘到达 → 水位重置 → 两轮扫描零卖出
  // （11:30:13 末足额 → 40s 线 11:30:54 卖〔旧〕；11:30:59 4×0.11B 足额到达重置水位）
  {
    const calls = [];
    let watermarkAgoMs = 45000; // 11:30:13 末足额笔，距首检 45s（40s 线已越 5s）
    const eng = makeWssEngine({
      _stallCloseMs: 40000, _stallCloseExt: EXT,
      _getAllHoldings: () => [{ tokenAddress: '0xfd57' }],
      _tokenPool: { getToken: () => ({ token: '0xfd57', status: 'bought' }) },
      _factorAggregator: {
        getTokenState: () => ({ lastSubstantialTickAt: now - watermarkAgoMs }),
        buildFactorMap: () => ({ currentVsLaunchPct: 0, currentVsFloorPct: 0 }),
      },
      _sellingTokens: new Set(), _buyingTokens: new Set(),
      _emitStallCloseSell: async (token) => { calls.push(token.token); },
    });
    const origNow = Date.now; Date.now = () => now;
    try {
      await eng._scanStallClose();            // 11:30:54 形状：越 40s 但域内 ≤90s → 不卖
      watermarkAgoMs = 1000;                  // 11:30:59 形状：4×0.11B 足额重置水位
      await eng._scanStallClose();            // 1s 前足额 → 基础线都没越 → 不卖
    } finally { Date.now = origNow; }
    check('★fd57 反证：延长窗内足额买盘到达 → 全程零卖出（旧 40s 口径此票已清仓）', calls, []);
  }

  // T170b 信号名+断流上下文（真实 _emitStallCloseSell 方法体，桩 _emitSellSignal 捕获
  // strategy）：延长臂卖出显示实际生效阈值+档标注（0x88ed 案被「40s」冒充误导的修正）
  {
    const capture = {};
    const eng = makeWssEngine({
      _stallCloseMs: 40000, _stallCloseMinTickBnb: 0.01,
      _emitSellSignal: async (token, strategy) => { capture.strategy = strategy; },
    });
    await eng._emitStallCloseSell({ token: '0xt', symbol: 'T' }, { profitPercent: -3.2 }, 61000, { ms: 90000, tier: 'almost' });
    check('★almost 档信号名=实际生效阈值 90s+档标注（非基础 40s）', capture.strategy.name, '流动性止损-无成交超时(90s·almost_launch域延长,≥0.01BNB)');
    check('断流上下文 stallCloseInfo（stalledSec/tier/effectiveSec）', capture.strategy.stallCloseInfo, { stalledSec: 61, tier: 'almost', effectiveSec: 90 });
    await eng._emitStallCloseSell({ token: '0xt', symbol: 'T' }, { profitPercent: 107.5 }, 185000, { ms: 180000, tier: 'breakdown' });
    check('破发档信号名=180s·破发域延长', capture.strategy.name, '流动性止损-无成交超时(180s·破发域延长,≥0.01BNB)');
    check('破发档断流上下文', capture.strategy.stallCloseInfo, { stalledSec: 185, tier: 'breakdown', effectiveSec: 180 });
    await eng._emitStallCloseSell({ token: '0xt', symbol: 'T' }, { profitPercent: 2.1 }, 41000, null);
    check('域外信号名=基础阈值原形状（无档标注）', capture.strategy.name, '流动性止损-无成交超时(40s,≥0.01BNB)');
    check('域外断流上下文 tier=null', capture.strategy.stallCloseInfo, { stalledSec: 41, tier: null, effectiveSec: 40 });
  }
}

console.log('E2. 回测引擎延长臂（虚拟时钟 + 检测时点 asOf parity + 破发档重锚）');
{
  // buildFactorMap 按 asOf 返回可区分对象：基础检测点 lastTickAt+stallMs vs 档位
  // 延长点 lastTickAt+档阈值——fire 收到哪个对象即断言 asOf 锚在哪
  const EXT = { almostLaunchMs: 90000, breakdownMs: 180000 };
  const run = async ({ lastTickAt, curVsByAsOf = () => 0, floorPctByAsOf = () => null, stallMs = 10000 }) => {
    const calls = [];
    const buildCalls = [];
    const eng = makeBtEngine({
      _stallCloseMs: stallMs,
      _stallCloseExt: EXT,
      _getAllHoldings: () => [{ tokenAddress: '0xt' }],
      _tokenPool: { getToken: () => ({ token: '0xt', status: 'bought' }) },
      _factorAggregator: {
        getTokenState: () => ({ lastTickAt }),
        buildFactorMap: (a, asOf) => {
          buildCalls.push({ a, asOf });
          return { currentVsLaunchPct: curVsByAsOf(asOf), currentVsFloorPct: floorPctByAsOf(asOf), _asOf: asOf };
        },
      },
      _sellingTokens: new Set(), _buyingTokens: new Set(),
      _emitStallCloseSell: async (token, factors, stalledMs, ts, extTier) => { calls.push({ addr: token.token, factors, stalledMs, ts, extTier }); },
    });
    await eng._scanStallClose(T0);
    return { calls, buildCalls };
  };
  // 域内 45s：延长判定吃基础检测点因子（断流期 state 冻结，价格键与延长点无差）
  const r1 = await run({ lastTickAt: T0 - 45000 });
  check('域内 45s 不卖（回测同判）', r1.calls, []);
  check('延长判定 asOf=基础检测点 lastTickAt+stallMs', r1.buildCalls[0].asOf, T0 - 45000 + 10000);
  // 域内 95s：耗尽真卖，fire 因子重锚 almost 档延长点（=实时墙钟 fire 时刻的回放等价）
  const r2 = await run({ lastTickAt: T0 - 95000 });
  check('域内 95s 卖（唯一）', r2.calls.map(c => c.addr), ['0xt']);
  check('★fire 因子 asOf=almost 档延长点 lastTickAt+90000（非基础检测点非 nowTs）', r2.calls[0].factors._asOf, T0 - 95000 + 90000);
  check('两次 build（基础点判档 + 档位延长点重锚）', r2.buildCalls.map(b => b.asOf), [T0 - 95000 + 10000, T0 - 95000 + 90000]);
  // 破发档 185s：耗尽真卖重锚 180s 点（curVs=86 域外、floorPct=-7 破发档）
  const r2b = await run({ lastTickAt: T0 - 185000, curVsByAsOf: () => 86, floorPctByAsOf: () => -7 });
  check('破发档 185s 卖（180s 窗耗尽）', r2b.calls.map(c => c.addr), ['0xt']);
  check('★破发档 fire asOf=lastTickAt+180000（档位阈值重锚）', r2b.calls[0].factors._asOf, T0 - 185000 + 180000);
  // 域外票晚检（全市场静默后首检落 95s）：照卖且保持 T104 基础检测点（不被延长臂污染）
  const r3 = await run({ lastTickAt: T0 - 95000, curVsByAsOf: () => 28.5 });
  check('域外晚检照卖', r3.calls.map(c => c.addr), ['0xt']);
  check('★域外 fire asOf=基础检测点（T104 parity 零变化，仅一次 build）', [r3.calls[0].factors._asOf, r3.buildCalls.length], [T0 - 95000 + 10000, 1]);
  // curVs 缺失：不延长照卖
  const r4 = await run({ lastTickAt: T0 - 45000, curVsByAsOf: () => null });
  check('curVs 缺失照卖（回测 fail-closed）', r4.calls.map(c => c.addr), ['0xt']);
}

// ═══════════════ T219 大户在场豁免 ═══════════════
{
  const { normalizeStallBigHolderExempt, stallBigHolderExempt } = require('../src/trading-engine/core/stall-close-almost-launch.js');
  check('T219 缺省启用（缺段=开 3/30）', () => {
    const n = normalizeStallBigHolderExempt({ stallMs: 50000 });
    assert.deepStrictEqual(n, { minDustHolders: 3, top1CircPct: 30 });
  });
  check('T219 显式 false 关 → null', () => {
    assert.strictEqual(normalizeStallBigHolderExempt({ bigHolderExempt: false }), null);
  });
  check('T219 覆盖值', () => {
    const n = normalizeStallBigHolderExempt({ bigHolderExempt: { minDustHolders: 5, top1CircPct: 40 } });
    assert.deepStrictEqual(n, { minDustHolders: 5, top1CircPct: 40 });
  });
  const N = { minDustHolders: 3, top1CircPct: 30 };
  check('T219 ≥3 普通大户 → 豁免', () => {
    assert.strictEqual(stallBigHolderExempt({ bigBuyersHeldDust: 3, top1HolderCircPct: 5 }, N), true);
  });
  check('T219 1 个特大户（top1 30%）→ 豁免', () => {
    assert.strictEqual(stallBigHolderExempt({ bigBuyersHeldDust: 1, top1HolderCircPct: 30 }, N), true);
  });
  check('T219 大户少于线且无特大户 → 照卖', () => {
    assert.strictEqual(stallBigHolderExempt({ bigBuyersHeldDust: 2, top1HolderCircPct: 29.9 }, N), false);
  });
  check('T219 证据缺失 fail-closed 照卖（豁免证据缺席宁卖）', () => {
    assert.strictEqual(stallBigHolderExempt({}, N), false);
    assert.strictEqual(stallBigHolderExempt(null, N), false);
  });
}

console.log(`\n结果: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);

})();
