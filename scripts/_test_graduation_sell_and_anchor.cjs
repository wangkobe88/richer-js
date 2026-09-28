#!/usr/bin/env node
/**
 * 毕业事件驱动卖出 + flap per-token 毕业锚——本地零 DB 单测
 *
 * 背景（2026-09-28 王之蔑视 0x7abcc1 案，用户裁定「2+1」）：
 *   ① 方案②毕业事件驱动卖出：_handleGraduation 对 virtual 持仓 token 直接触发
 *      全清（等价 strategy 走 _emitSellSignal 全清链；live 维持告警人工处置）
 *   ② 方案①flap 专属毕业锚：graduationProgress 对 flap 盘 per-token 定锚
 *      = 首市值（_relFirstPriceBnb×totalSupply）×12.5（R 恒比，182 实测 4/5 样本
 *      ±2%），仅当首 tick 距 token 创建 <60s（锚有效）时启用，否则退 72 默认锚
 *
 * 覆盖：
 *   A. _graduationAnchorBnb 矩阵（flap 有效窗 / 超窗退 72 / 边界 60s / firstTickAt
 *      null / 首市值缺失 / 非 flap / platform 未注册 / 乱序自愈回填）
 *   B. graduationProgress 端到端（buildFactorMap：flap 有效锚 / 退锚 / four.meme 72）
 *   C. _handleGraduation（virtual+bought 触发全清 / 重复派发幂等 / sold·monitoring
 *      不触发 / live 走告警不走卖出 / buildFactorMap null 安全 / 失败 catch 记日志）
 *
 * 用法：node scripts/_test_graduation_sell_and_anchor.cjs
 */
'use strict';

const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
const { FourMemeWssTradingEngine } = require('../src/trading-engine/implementations/FourMemeWssTradingEngine');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}
function approx(name, actual, expected, eps = 1e-9) {
  if (Math.abs(actual - expected) < eps) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ≈${expected}\n    实际 ${actual}`); }
}

// FA 白盒辅助：registerToken 后直接操作 state 内部字段（firstTickAt/_relFirstPriceBnb
// 正常由 processTick 设置，单测直接注入避免构造完整 tick 形状——与 _test_stop_loss_rules 同模式）
function seededState({ platform = 'flap', firstTickOffsetMs = 5000, firstPrice = 5.7e-9, supply = 1e9 } = {}) {
  const fa = new FourMemeFactorAggregator({}, console);
  const createdAt = 1790000000000;
  fa.registerToken('0xabc', { createdAtMs: createdAt, totalSupply: supply, platform });
  const state = fa.getTokenState('0xabc');
  if (firstTickOffsetMs !== null) state.firstTickAt = createdAt + firstTickOffsetMs;
  state._relFirstPriceBnb = firstPrice;
  state._relPriceBnb = firstPrice;
  return { fa, state, anchor: () => fa._graduationAnchorBnb(state) };
}

// ═══ A. _graduationAnchorBnb 矩阵 ═══
console.log('A. _graduationAnchorBnb（默认 72 / ratio 12.5 / 窗 60s）');
{
  const ok = seededState(); // flap + 首 tick 距创建 5s + 首市值 5.7
  approx('flap 有效窗 → 首市值×12.5（5.7×12.5）', ok.anchor(), 71.25);
  check('flap platform 落位 state.platform', ok.state.platform, 'flap');

  approx('边界恰 60s（不大于 → 有效锚）', seededState({ firstTickOffsetMs: 60000 }).anchor(), 71.25);
  check('超窗 60001ms → 退 72', seededState({ firstTickOffsetMs: 60001 }).anchor(), 72);
  check('firstTickAt null（尚无 tick）→ 72', seededState({ firstTickOffsetMs: null }).anchor(), 72);
  check('首市值缺失（_relFirstPriceBnb=0）→ 72', seededState({ firstPrice: 0 }).anchor(), 72);
  check('totalSupply=0 → 首市值 0 → 72', seededState({ supply: 0 }).anchor(), 72);
  check('four.meme → 恒 72', seededState({ platform: 'fourmeme' }).anchor(), 72);
  check('platform 未注册（null，回测/重启过渡态）→ 72', seededState({ platform: null }).anchor(), 72);

  // 乱序自愈：tick 先到（FA 自动建 state，createdAtMs≈tick 时刻），迟到 registerToken
  // 回填权威更早 createdAt → 窗变大超 60s → 锚自动失效退 72
  const fa = new FourMemeFactorAggregator({}, console);
  const realCreate = 1790000000000, tickAt = realCreate + 300000; // 首 tick 距创建 5min
  fa.registerToken('0xlate', { createdAtMs: tickAt, totalSupply: 1e9, platform: 'flap' }); // tick 自动建（createdAt=tick 时刻）
  const st = fa.getTokenState('0xlate');
  st.firstTickAt = tickAt; st._relFirstPriceBnb = 5.7e-9; st._relPriceBnb = 5.7e-9;
  approx('乱序自愈前（窗≈0）误用首市值锚', fa._graduationAnchorBnb(st), 71.25);
  fa.registerToken('0xlate', { createdAtMs: realCreate, totalSupply: 1e9, platform: 'flap' }); // 回填权威创建时间
  approx('迟到注册回填后 → 窗 5min 超 60s → 退 72', fa._graduationAnchorBnb(st), 72);
  check('回填不覆盖 platform', st.platform, 'flap');
}

// ═══ B. graduationProgress 端到端（buildFactorMap）═══
console.log('B. graduationProgress（buildFactorMap 出键）');
{
  // flap 有效锚：现价 5 倍首价 → mcap 28.5 / 锚 71.25 = 0.4
  const flap = seededState();
  const st = flap.state;
  st._relPriceBnb = 5.7e-9 * 5;
  approx('flap 有效锚 progress=28.5/71.25=0.4', flap.fa.buildFactorMap('0xabc', Date.now()).graduationProgress, 0.4);
  // 超窗退 72：同一现价 → 28.5/72
  st.firstTickAt = st.createdAtMs + 120000;
  approx('超窗退 72 后 progress=28.5/72', flap.fa.buildFactorMap('0xabc', Date.now()).graduationProgress, 28.5 / 72);
  // four.meme 72 锚（同现价同首市值）
  const fm = seededState({ platform: 'fourmeme' });
  fm.state._relPriceBnb = 5.7e-9 * 5;
  approx('four.meme progress=28.5/72', fm.fa.buildFactorMap('0xabc', Date.now()).graduationProgress, 28.5 / 72);
  // totalSupply=0 → null fail-closed
  const nos = seededState({ supply: 0 });
  check('totalSupply=0 → null', nos.fa.buildFactorMap('0xabc', Date.now()).graduationProgress, null);
}

// ═══ C. _handleGraduation（引擎事件驱动全清）═══
console.log('C. 毕业事件驱动卖出（virtual 全清 / 幂等 / live 告警）');
(async () => {
  function makeEngine(fields = {}) {
    return Object.assign(Object.create(FourMemeWssTradingEngine.prototype), {
      _experimentId: 'test-exp',
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      _isLive: false,
      _graduationSoldTokens: new Set(),
      ...fields,
    });
  }
  const FAKE_FACTORS = { graduationProgress: 0.889, profitPercent: 506 };
  const gradInfo = { token: '0xking', fundsBnb: 14.2077 };

  // virtual + bought → graduationSell 全清链
  let captured = null;
  let eng = makeEngine({
    _tokenPool: { getToken: () => ({ token: '0xking', symbol: '王之蔑视', status: 'bought' }) },
    _factorAggregator: { markGraduated: () => {}, buildFactorMap: () => FAKE_FACTORS },
    _emitSellSignal: async (token, strategy, factors, tick) => { captured = { token, strategy, factors, tick }; return { success: true }; },
  });
  eng._handleGraduation(gradInfo);
  await new Promise(r => setImmediate(r));
  check('virtual+bought → _emitSellSignal 触发', captured.token.token, '0xking');
  check('strategy id/name', [captured.strategy.id, captured.strategy.name], ['graduationSell', '毕业事件全清']);
  check('全清语义 cards=all + sellPercentage=1', [captured.strategy.cards, captured.strategy.sellPercentage], ['all', 1]);
  check('bypassDebounce=true', captured.strategy.bypassDebounce, true);
  check('factors 来自 buildFactorMap（断流前最后价）', captured.factors, FAKE_FACTORS);
  check('tick=null（事件驱动非 tick 路径）', captured.tick, null);

  // 重复派发幂等（graduation 事件实测重复两遍）
  eng._handleGraduation(gradInfo);
  await new Promise(r => setImmediate(r));
  eng._handleGraduation(gradInfo);
  await new Promise(r => setImmediate(r));
  check('重复派发幂等（只卖一次）', eng._graduationSoldTokens.size, 1);

  // 不同 token 互不影响
  const other = makeEngine({
    _graduationSoldTokens: new Set(['0xking']),
    _tokenPool: { getToken: () => ({ token: '0xother', symbol: 'OTHER', status: 'bought' }) },
    _factorAggregator: { markGraduated: () => {}, buildFactorMap: () => FAKE_FACTORS },
    _emitSellSignal: async () => { throw new Error('should not reach: same-set 不同地址被误挡'); },
  });
  // 0xother 不在 Set → 应正常走卖出链（此处打桩 _emitSellSignal 计数验证）
  let otherCalled = 0;
  other._emitSellSignal = async () => { otherCalled++; return { success: true }; };
  other._handleGraduation({ token: '0xother', fundsBnb: 16 });
  await new Promise(r => setImmediate(r));
  check('幂等集按地址隔离（不同 token 不误挡）', otherCalled, 1);

  // sold / monitoring / 不存在 → 不触发
  for (const [status, label] of [['sold', '已卖'], ['monitoring', '未持有']]) {
    let called = 0;
    const e2 = makeEngine({
      _tokenPool: { getToken: () => ({ token: '0xking', symbol: 'T', status }) },
      _factorAggregator: { markGraduated: () => {}, buildFactorMap: () => FAKE_FACTORS },
      _emitSellSignal: async () => { called++; },
    });
    e2._handleGraduation(gradInfo);
    await new Promise(r => setImmediate(r));
    check(`${label} → 不触发卖出`, called, 0);
  }
  let calledNull = 0;
  const e3 = makeEngine({
    _tokenPool: { getToken: () => null },
    _factorAggregator: { markGraduated: () => {}, buildFactorMap: () => FAKE_FACTORS },
    _emitSellSignal: async () => { calledNull++; },
  });
  e3._handleGraduation(gradInfo);
  await new Promise(r => setImmediate(r));
  check('token 不在池 → 不触发', calledNull, 0);

  // buildFactorMap null（prune 后）→ 安全跳过
  let calledPrune = 0;
  const e4 = makeEngine({
    _tokenPool: { getToken: () => ({ token: '0xking', symbol: 'T', status: 'bought' }) },
    _factorAggregator: { markGraduated: () => {}, buildFactorMap: () => null },
    _emitSellSignal: async () => { calledPrune++; },
  });
  e4._handleGraduation(gradInfo);
  await new Promise(r => setImmediate(r));
  check('factors null（prune 后）→ 不触发不异常', calledPrune, 0);

  // 卖出失败 → .catch 记日志不崩
  let errs = 0;
  const e5 = makeEngine({
    _tokenPool: { getToken: () => ({ token: '0xking', symbol: 'T', status: 'bought' }) },
    _factorAggregator: { markGraduated: () => {}, buildFactorMap: () => FAKE_FACTORS },
    _emitSellSignal: async () => { throw new Error('sell failed'); },
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => { errs++; } },
  });
  e5._handleGraduation(gradInfo);
  await new Promise(r => setImmediate(r));
  check('卖出失败 → error 日志一次（catch 吞掉不崩）', errs, 1);

  // live → 不触发卖出，走 Telegram 告警人工处置
  let alerts = 0, liveSells = 0;
  const e6 = makeEngine({
    _isLive: true,
    _tokenPool: { getToken: () => ({ token: '0xking', symbol: 'T', status: 'bought' }) },
    _factorAggregator: { markGraduated: () => {}, buildFactorMap: () => FAKE_FACTORS },
    _getHolding: () => ({ amount: 123456n }),
    _notifyLiveAlert: () => { alerts++; },
    _emitSellSignal: async () => { liveSells++; },
  });
  e6._handleGraduation(gradInfo);
  await new Promise(r => setImmediate(r));
  check('live → 告警触发', alerts, 1);
  check('live → 不走引擎卖出（人工处置）', [liveSells, e6._graduationSoldTokens.size], [0, 0]);

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exitCode = fail === 0 ? 0 : 1;
})();

// ═══ D. _computePriceTrendFactors 乱序输入崩溃修复 ═══
// b24879e0 2026-09-27 19:53Z 裸崩实案：迟到的更早 blockTime tick（watcher 双写者
// bigserial 分配序≠提交序）使 _recentTicks 到达序≠时间序 → 分桶 idx 为负 →
// buckets[-k].push TypeError → uncaught → 进程死。修复 = reliable 归一时间升序。
console.log('D. 趋势因子乱序输入（b24879e0 崩溃复现）');
{
  const fa = new FourMemeFactorAggregator({}, console);
  const now = 1790000000000;
  // 乱序：末位 tick 的 ts 早于首位（迟到的更早 blockTime 行）且数量 ≥8 触发分桶 OLS 分支
  const mk = (dtMs, p) => ({ ts: now - dtMs, priceBnb: p, priceReliable: true });
  const outOfOrder = [
    mk(1000, 5.0e-9), mk(2000, 5.1e-9), mk(3000, 5.2e-9), mk(4000, 5.3e-9),
    mk(5000, 5.4e-9), mk(6000, 5.5e-9), mk(7000, 5.6e-9), mk(8000, 5.7e-9),
    mk(15000, 4.0e-9), // 迟到行：ts 比首位早 14s —— 修复前 idx=Math.floor((t-t0)/span*B) 为负 → 崩
  ];
  let threw = null, factors = null;
  try { factors = fa._computePriceTrendFactors(outOfOrder, now, now - 20000); }
  catch (e) { threw = e.message; }
  check('乱序输入不再抛异常（修复前 Cannot read push）', threw, null);
  check('乱序输入产出完整 5 因子（非 null 降级）', factors && Object.values(factors).every(v => v !== null && Number.isFinite(v)), true);

  // 升序输入回归：同一组按时间排好 → 不崩且 slope 有限
  const inOrder = [...outOfOrder].sort((a, b) => a.ts - b.ts);
  const f2 = fa._computePriceTrendFactors(inOrder, now, now - 20000);
  check('升序输入回归正常', f2 && Number.isFinite(f2.priceTrendSlope), true);

  // 乱序后现价语义：window[n-1] 应取时间最新（ts 最大）而非到达序末位
  // 构造：到达序末位是时间最早（低价 1e-9），时间最新在中间（高价 9e-9）
  const lastArrivedOldest = [
    mk(30000, 3e-9), mk(20000, 4e-9), mk(1000, 9e-9) /* 时间最新 */, mk(25000, 3.5e-9),
    mk(29000, 3.2e-9), mk(28000, 3.3e-9), mk(27000, 3.4e-9), mk(26000, 3.6e-9),
  ];
  const f3 = fa._computePriceTrendFactors(lastArrivedOldest, now, now - 40000);
  // riseFromLow6s / drawdown 以时间最新价 9e-9 为现价：距窗内低点 3e-9 拉起 = (9-3)/3*100 = 200%
  approx('乱序归一后现价=时间最新（拉起 200%）', f3.recentRiseFromWindowLowPct, 200, 1e-6);

  console.log(`\n（含 D 节）总结果: ${pass} 通过, ${fail} 失败`);
  if (fail > 0) process.exitCode = 1;
}
