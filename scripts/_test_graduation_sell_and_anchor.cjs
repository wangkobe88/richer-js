#!/usr/bin/env node
/**
 * 毕业事件驱动卖出 + flap 资金口径毕业进度——本地零 DB 单测
 *
 * 背景（2026-09-28 王之蔑视 0x7abcc1 案立毕业全清；2026-10-24 豆皮/水案
 * 用户裁定资金口径替换价格锚）：
 *   ① 毕业事件驱动卖出：_handleGraduation 对 virtual 持仓 token 直接触发
 *      全清（等价 strategy 走 _emitSellSignal 全清链；live 维持告警人工处置）
 *   ② flap graduationProgress = 资金口径：池净入金 Σ(0.98×buy) − Σ(1.0204×sell)
 *      ÷ 毕业阈值（per-quote 学习值 ?? 全局 15.99808481559237）。旧价格锚
 *      （首市值×12.5，R 恒比假设）实证不成立——豆皮/水 R=9.0/9.4，progress
 *      峰值 0.716/0.754，0.9/0.98 毕业臂全程够不着（死臂）→ 整链退役
 *
 * 覆盖：
 *   A. 资金口径累积（精确公式 / 卖腿 1.0204 / quote 盘 quoteToken 捕获 /
 *      价格无关性 / platform 回填 / four.meme 口径隔离；豆皮/水事故反证在内）
 *   B. noteGraduation 阈值学习（write-once / per-quote / four.meme 不污染 /
 *      null 不学）+ buildFactorMap 出键（four.meme 72 原路径回归）
 *   C. _handleGraduation（virtual+bought 触发全清 / 重复派发幂等 / sold·monitoring
 *      不触发 / live 走告警不走卖出 / buildFactorMap null 安全 / 失败 catch 记日志）
 *   E. 毕业卖出幂等标记后置 + 扫描毕业兜底（2026-10-15 迁自
 *      _test_token_cycle_routing G1/G2——cycle 分桶机制删除拆迁）
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

// FA 白盒辅助：registerToken 后直接操作 state 内部字段（_relPriceBnb 正常由
// processTick 设置，单测直接注入避免构造完整 tick 形状——与 _test_stop_loss_rules 同模式）
function seededState({ platform = 'fourmeme', firstTickOffsetMs = 5000, firstPrice = 5.7e-9, supply = 1e9 } = {}) {
  const fa = new FourMemeFactorAggregator({}, console);
  const createdAt = 1790000000000;
  fa.registerToken('0xabc', { createdAtMs: createdAt, totalSupply: supply, platform });
  const state = fa.getTokenState('0xabc');
  if (firstTickOffsetMs !== null) state.firstTickAt = createdAt + firstTickOffsetMs;
  state._relFirstPriceBnb = firstPrice;
  state._relPriceBnb = firstPrice;
  return { fa, state };
}

// 资金口径喂 tick 辅助（2026-10-24）：最小 tick 形状直达 processTick
const FUNDS_BUY_KEEP = 0.98, FUNDS_SELL_TAKE = 1.0204, FUNDS_THRESHOLD = 15.99808481559237;
let feedSeq = 0;
function feedTick(fa, token, { type = 'buy', bnb = 0.1, price = 5e-9, platform = 'flap', quote = null, ts = null } = {}) {
  fa.processTick({
    token_address: token, timestamp: ts || (1790000000000 + (++feedSeq) * 500),
    trade_type: type, bnb_amount: bnb, price_bnb: price,
    block_number: 48000000 + feedSeq, log_index: feedSeq,
    trader_address: '0xfeed', sender_address: null, platform, quote_token: quote,
  }, { emitFactors: false });
}

// ═══ A. flap 资金口径毕业进度（累积公式 + 阈值 + 事故反证）═══
console.log('A. 资金口径累积（Σ0.98×buy − Σ1.0204×sell ÷ 15.99808481559237）');
{
  const fa = new FourMemeFactorAggregator({}, console);
  fa.registerToken('0xwater', { createdAtMs: 1790000000000, totalSupply: 1e9, platform: 'flap' });
  // BNB 盘 A 实测形状：纯买 16.3246 → 池实收 0.98×16.3246 = 15.998108（四池回归精确）
  feedTick(fa, '0xwater', { bnb: 16.3246 });
  const st = fa.getTokenState('0xwater');
  approx('纯买 16.3246 → inflow=0.98×16.3246', st.poolInflowBnb, 16.3246 * FUNDS_BUY_KEEP);
  approx('progress=15.998108/15.998084 ≈ 1.0000015 ≥0.98 毕业臂触发',
    st.poolInflowBnb / FUNDS_THRESHOLD, (16.3246 * FUNDS_BUY_KEEP) / FUNDS_THRESHOLD);
  check('progress ≥ 0.98（水案毕业臂从死臂复活）', fa.buildFactorMap('0xwater', Date.now()).graduationProgress >= 0.98, true);

  // 卖腿出池系数 1.0204：再卖 1.0 → inflow 15.998108 − 1.0204
  feedTick(fa, '0xwater', { type: 'sell', bnb: 1.0 });
  approx('卖 1.0 → inflow=−1.0204', st.poolInflowBnb, 16.3246 * FUNDS_BUY_KEEP - 1.0 * FUNDS_SELL_TAKE);

  // 事故反证（水 0x25e2…7777 案，2026-10-24）：价格锚 R=毕业市值/首市值恒比假设不成立——
  // 该票价格 9.4×（首市值 1.7 → 峰值市值 16）时旧锚=1.7×12.5=21.25，旧 progress
  // 峰值=16/21.25=0.753，0.9/0.98 毕业臂全程够不着（死臂）；同流量资金口径 ≈1.0 达标。
  // 上方 16.3246 纯买即同量级流量 → 资金口径与价格倍数完全解耦（价格再高 R≠12.5 不影响）
  const fa2 = new FourMemeFactorAggregator({}, console);
  fa2.registerToken('0xdoupi', { createdAtMs: 1790000000000, totalSupply: 1e9, platform: 'flap' });
  // 豆皮案形状：quote 盘（quote_token 在场）+ 多笔买卖混合，价格 9.0×——资金口径照常累积
  feedTick(fa2, '0xdoupi', { bnb: 6.0, price: 1.7e-9, quote: '0x4902c5eb00000000000000000000000000000001' });
  feedTick(fa2, '0xdoupi', { type: 'sell', bnb: 0.5, price: 8e-9, quote: '0x4902c5eb00000000000000000000000000000001' });
  feedTick(fa2, '0xdoupi', { bnb: 11.4, price: 15e-9, quote: '0x4902c5eb00000000000000000000000000000001' });
  const st2 = fa2.getTokenState('0xdoupi');
  approx('quote 盘混合流 inflow=0.98×17.4 − 1.0204×0.5', st2.poolInflowBnb, 17.4 * FUNDS_BUY_KEEP - 0.5 * FUNDS_SELL_TAKE);
  check('quote 盘 quoteToken write-once 捕获', st2.quoteToken, '0x4902c5eb00000000000000000000000000000001');
  check('quote 盘 progress ≈1.06 ≥0.98（豆皮案死臂复活）', fa2.buildFactorMap('0xdoupi', Date.now()).graduationProgress >= 0.98, true);

  // 价格无关性：断价盘（price_bnb=0，quote 换算不可得）资金口径照常出值（价格锚路径须
  // _relPriceBnb>0 否则 null——断流票读 null 的旧盲区）
  const fa3 = new FourMemeFactorAggregator({}, console);
  fa3.registerToken('0xnopx', { createdAtMs: 1790000000000, totalSupply: 1e9, platform: 'flap' });
  feedTick(fa3, '0xnopx', { bnb: 8.0, price: 0 });
  check('零价 tick 资金口径照常累积出值（>0.4）', fa3.buildFactorMap('0xnopx', Date.now()).graduationProgress > 0.4, true);

  // platform 回填：registerToken 晚到（tick.platform 先到）累积不漏
  const fa4 = new FourMemeFactorAggregator({}, console);
  feedTick(fa4, '0xlate', { bnb: 2.0 }); // state 由 tick 自动建，platform 从 tick 回填
  check('tick.platform 回填（registerToken 晚到）', fa4.getTokenState('0xlate').platform, 'flap');
  approx('回填后已累积（不漏首 tick）', fa4.getTokenState('0xlate').poolInflowBnb, 2.0 * FUNDS_BUY_KEEP);

  // four.meme 不走资金累积（72 市值锚原路径）：同款 tick platform='fourmeme'
  const fa5 = new FourMemeFactorAggregator({}, console);
  fa5.registerToken('0xfm', { createdAtMs: 1790000000000, totalSupply: 1e9, platform: 'fourmeme' });
  feedTick(fa5, '0xfm', { bnb: 16.3246, platform: 'fourmeme' });
  check('four.meme 零资金累积（口径隔离）', fa5.getTokenState('0xfm').poolInflowBnb, 0);
}

// ═══ B. noteGraduation 阈值学习 + graduationProgress 端到端（buildFactorMap）═══
console.log('B. noteGraduation 学习 + buildFactorMap 出键');
{
  const fa = new FourMemeFactorAggregator({}, console);
  // B1 BNB 盘学习：quoteToken null 键
  fa.registerToken('0xg1', { createdAtMs: 1790000000000, totalSupply: 1e9, platform: 'flap' });
  fa.noteGraduation({ token: '0xg1', fundsBnb: 15.9, quoteToken: null });
  check('noteGraduation 置 graduated', fa.getTokenState('0xg1').graduated, true);
  feedTick(fa, '0xg1', { bnb: 15.9 }); // inflow 0.98×15.9
  approx('学习阈值 15.9 生效（对全局 15.998 的偏离可分辨）',
    fa.buildFactorMap('0xg1', Date.now()).graduationProgress, (15.9 * FUNDS_BUY_KEEP) / 15.9);
  // write-once：重复毕业不覆盖
  fa.noteGraduation({ token: '0xg1', fundsBnb: 20, quoteToken: null });
  check('学习 write-once（重复毕业不覆盖）', fa._gradFundsThresholds.get(null), 15.9);

  // B2 per-quote 学习：quote 盘按 quoteToken 键独立学习，未学 quote 回落全局
  const QUOTE = '0x4902c5eb00000000000000000000000000000002';
  fa.registerToken('0xg2', { createdAtMs: 1790000000000, totalSupply: 1e9, platform: 'flap' });
  feedTick(fa, '0xg2', { bnb: 10, quote: QUOTE });
  fa.getTokenState('0xg2').quoteToken = QUOTE;
  fa.noteGraduation({ token: '0xg2', fundsBnb: 16.2, quoteToken: QUOTE });
  approx('quote 学习值 16.2 生效', fa.buildFactorMap('0xg2', Date.now()).graduationProgress, (10 * FUNDS_BUY_KEEP) / 16.2);
  fa.registerToken('0xg3', { createdAtMs: 1790000000000, totalSupply: 1e9, platform: 'flap' });
  feedTick(fa, '0xg3', { bnb: 10, quote: '0xunknownquote' });
  approx('未学 quote 回落全局 15.998', fa.buildFactorMap('0xg3', Date.now()).graduationProgress, (10 * FUNDS_BUY_KEEP) / FUNDS_THRESHOLD);

  // B3 four.meme 毕业不学习（金额口径不同，混学会污染 BNB 键阈值）但 graduated 照置
  fa.registerToken('0xfmg', { createdAtMs: 1790000000000, totalSupply: 1e9, platform: 'fourmeme' });
  const before = fa._gradFundsThresholds.get(null);
  fa.noteGraduation({ token: '0xfmg', fundsBnb: 24.9, quoteToken: null });
  check('four.meme 毕业不污染阈值表', fa._gradFundsThresholds.get(null), before);
  check('four.meme 毕业仍置 graduated', fa.getTokenState('0xfmg').graduated, true);

  // B4 fundsBnb null（quote 盘换算不可得）不学习
  fa.registerToken('0xgnull', { createdAtMs: 1790000000000, totalSupply: 1e9, platform: 'flap' });
  const sizeBefore = fa._gradFundsThresholds.size;
  fa.noteGraduation({ token: '0xgnull', fundsBnb: null, quoteToken: '0xq' });
  check('fundsBnb null 不学习（诚实无值）', fa._gradFundsThresholds.size, sizeBefore);
  check('state 缺失 no-op 不抛', (() => { fa.noteGraduation({ token: '0xnostate' }); return true; })(), true);

  // B5 four.meme 72 市值锚原路径回归：现价 5 倍首价 → mcap 28.5 / 72
  const fm = seededState({ platform: 'fourmeme' });
  fm.state._relPriceBnb = 5.7e-9 * 5;
  approx('four.meme progress=28.5/72（原路径不变）', fm.fa.buildFactorMap('0xabc', Date.now()).graduationProgress, 28.5 / 72);
  const nos = seededState({ supply: 0, platform: 'fourmeme' });
  check('four.meme totalSupply=0 → null（原路径不变）', nos.fa.buildFactorMap('0xabc', Date.now()).graduationProgress, null);
  // B6 语义变化记录：flap 资金口径不依赖 supply/价格 → supply=0 照常出值
  const faF = new FourMemeFactorAggregator({}, console);
  faF.registerToken('0xnosupply', { createdAtMs: 1790000000000, totalSupply: 0, platform: 'flap' });
  feedTick(faF, '0xnosupply', { bnb: 10 });
  check('flap supply=0 资金口径照常出值（不再 null）', faF.buildFactorMap('0xnosupply', Date.now()).graduationProgress > 0.6, true);
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
    _factorAggregator: { noteGraduation: () => {}, buildFactorMap: () => FAKE_FACTORS },
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
    _factorAggregator: { noteGraduation: () => {}, buildFactorMap: () => FAKE_FACTORS },
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
      _factorAggregator: { noteGraduation: () => {}, buildFactorMap: () => FAKE_FACTORS },
      _emitSellSignal: async () => { called++; },
    });
    e2._handleGraduation(gradInfo);
    await new Promise(r => setImmediate(r));
    check(`${label} → 不触发卖出`, called, 0);
  }
  let calledNull = 0;
  const e3 = makeEngine({
    _tokenPool: { getToken: () => null },
    _factorAggregator: { noteGraduation: () => {}, buildFactorMap: () => FAKE_FACTORS },
    _emitSellSignal: async () => { calledNull++; },
  });
  e3._handleGraduation(gradInfo);
  await new Promise(r => setImmediate(r));
  check('token 不在池 → 不触发', calledNull, 0);

  // buildFactorMap null（prune 后）→ 安全跳过
  let calledPrune = 0;
  const e4 = makeEngine({
    _tokenPool: { getToken: () => ({ token: '0xking', symbol: 'T', status: 'bought' }) },
    _factorAggregator: { noteGraduation: () => {}, buildFactorMap: () => null },
    _emitSellSignal: async () => { calledPrune++; },
  });
  e4._handleGraduation(gradInfo);
  await new Promise(r => setImmediate(r));
  check('factors null（prune 后）→ 不触发不异常', calledPrune, 0);

  // 卖出失败 → .catch 记日志不崩
  let errs = 0;
  const e5 = makeEngine({
    _tokenPool: { getToken: () => ({ token: '0xking', symbol: 'T', status: 'bought' }) },
    _factorAggregator: { noteGraduation: () => {}, buildFactorMap: () => FAKE_FACTORS },
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
    _factorAggregator: { noteGraduation: () => {}, buildFactorMap: () => FAKE_FACTORS },
    _getHolding: () => ({ amount: 123456n }),
    _notifyLiveAlert: () => { alerts++; },
    _emitSellSignal: async () => { liveSells++; },
  });
  e6._handleGraduation(gradInfo);
  await new Promise(r => setImmediate(r));
  check('live → 告警触发', alerts, 1);
  check('live → 不走引擎卖出（人工处置）', [liveSells, e6._graduationSoldTokens.size], [0, 0]);

  // ═══ E. 毕业卖出幂等标记后置 + 扫描毕业兜底（迁自 _test_token_cycle_routing G1/G2）═══
  console.log('E. 毕业卖出幂等标记后置 + 扫描毕业兜底（2026-10-15 cycle 机制删除拆迁）');

  // E1 _emitGraduationSell 幂等标记后置到卖出成功（失败不标记 → 扫描可重试）
  {
    const eng = makeEngine({
      _factorAggregator: { buildFactorMap: () => ({ graduationProgress: 0.9, profitPercent: 10 }) },
      _emitSellSignal: async () => ({ success: false, reason: '卖出执行中' }),
    });
    const r1 = await eng._emitGraduationSell({ token: '0xg1', symbol: 'G1' }, { fundsBnb: 15 });
    check('卖出失败 → 幂等集不标记（可重试）', [r1.success, eng._graduationSoldTokens.size], [false, 0]);

    eng._emitSellSignal = async () => ({ success: true });
    const r2 = await eng._emitGraduationSell({ token: '0xg1', symbol: 'G1' }, {});
    check('卖出成功 → 幂等集标记', [r2.success, eng._graduationSoldTokens.size], [true, 1]);

    let calls = 0;
    eng._emitSellSignal = async () => { calls++; return { success: true }; };
    const r3 = await eng._emitGraduationSell({ token: '0xg1', symbol: 'G1' }, {});
    check('已标记 → 短路不再调卖出链', [calls, r3], [0, undefined]);
  }

  // E2 _scanHoldingsStopLoss 毕业兜底（先于止损；Set 已含走止损；live 不走）
  {
    async function runScan({ graduated, inSet, isLive }) {
      const stopCalls = [], gradCalls = [];
      const eng = makeEngine({
        _isLive: isLive,
        _stopLossEnabled: true, _stopLossPricePct: -50,
        _graduationSoldTokens: new Set(inSet ? ['0xscan'] : []),
        _getAllHoldings: () => [{ tokenAddress: '0xscan' }],
        _tokenPool: { getToken: () => ({ token: '0xscan', status: 'bought' }) },
        _factorAggregator: {
          buildFactorMap: () => ({ profitPercent: -55, holdDuration: 100 }),
          getTokenState: () => ({ graduated, lastFundsBnb: 15 }),
        },
        _sellingTokens: new Set(), _buyingTokens: new Set(),
        _emitStopLossSell: async () => { stopCalls.push(1); },
        _emitGraduationSell: async () => { gradCalls.push(1); return { success: true }; },
      });
      await eng._scanHoldingsStopLoss();
      return { stopCalls: stopCalls.length, gradCalls: gradCalls.length };
    }
    check('已毕业未卖 → 毕业补卖且不走止损', await runScan({ graduated: true, inSet: false, isLive: false }), { stopCalls: 0, gradCalls: 1 });
    check('已毕业已卖（Set 含）→ 走止损（回归）', await runScan({ graduated: true, inSet: true, isLive: false }), { stopCalls: 1, gradCalls: 0 });
    check('未毕业 → 走止损（回归）', await runScan({ graduated: false, inSet: false, isLive: false }), { stopCalls: 1, gradCalls: 0 });
    check('live → 不走毕业补卖（人工处置语义）', await runScan({ graduated: true, inSet: false, isLive: true }), { stopCalls: 1, gradCalls: 0 });
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exitCode = fail === 0 ? 0 : 1;
})();

// ═══ D. _recentTicks 乱序输入崩溃修复（P2c 后经 _scanRecentTicks 管线）═══
// b24879e0 2026-09-27 19:53Z 裸崩实案：迟到的更早 blockTime tick（watcher 双写者
// bigserial 分配序≠提交序）使 _recentTicks 到达序≠时间序 → 分桶 idx 为负 →
// buckets[-k].push TypeError → uncaught → 进程死。修复 = reliable 归一时间升序。
// P2c（2026-10-12）提取+升序 sort 上移到 _scanRecentTicks 单趟——本节按新架构
// 走 scan→trend 真实管线（乱序到达序直接进 state._recentTicks）。
console.log('D. 趋势因子乱序输入（b24879e0 崩溃复现）');
{
  const fa = new FourMemeFactorAggregator({}, console);
  const now = 1790000000000;
  // 乱序：末位 tick 的 ts 早于首位（迟到的更早 blockTime 行）且数量 ≥8 触发分桶 OLS 分支
  const mk = (dtMs, p) => ({ ts: now - dtMs, isBuy: true, bnb: 1, priceBnb: p, priceReliable: true, blockNumber: null });
  const mkSt = (arr) => { const st = fa._createEmptyState('0xD', now); st._recentTicks.push(...arr); return st; };
  const trendOf = (arr, firstTickAt) => {
    const s = fa._scanRecentTicks(mkSt(arr), now, 0);
    return fa._computePriceTrendFactors(s.reliable, now, firstTickAt);
  };
  const outOfOrder = [
    mk(1000, 5.0e-9), mk(2000, 5.1e-9), mk(3000, 5.2e-9), mk(4000, 5.3e-9),
    mk(5000, 5.4e-9), mk(6000, 5.5e-9), mk(7000, 5.6e-9), mk(8000, 5.7e-9),
    mk(15000, 4.0e-9), // 迟到行：ts 比首位早 14s —— 修复前 idx=Math.floor((t-t0)/span*B) 为负 → 崩
  ];
  let threw = null, factors = null;
  try { factors = trendOf(outOfOrder, now - 20000); }
  catch (e) { threw = e.message; }
  check('乱序输入不再抛异常（修复前 Cannot read push）', threw, null);
  check('乱序输入产出完整 5 因子（非 null 降级）', factors && Object.values(factors).every(v => v !== null && Number.isFinite(v)), true);

  // 升序输入回归：同一组按时间排好 → 不崩且 slope 有限
  const inOrder = [...outOfOrder].sort((a, b) => a.ts - b.ts);
  const f2 = trendOf(inOrder, now - 20000);
  check('升序输入回归正常', f2 && Number.isFinite(f2.priceTrendSlope), true);

  // 乱序后现价语义：window[n-1] 应取时间最新（ts 最大）而非到达序末位
  // 构造：到达序末位是时间最早（低价 1e-9），时间最新在中间（高价 9e-9）
  const lastArrivedOldest = [
    mk(30000, 3e-9), mk(20000, 4e-9), mk(1000, 9e-9) /* 时间最新 */, mk(25000, 3.5e-9),
    mk(29000, 3.2e-9), mk(28000, 3.3e-9), mk(27000, 3.4e-9), mk(26000, 3.6e-9),
  ];
  const f3 = trendOf(lastArrivedOldest, now - 40000);
  // recentRiseFromWindowLowPct 以时间最新价 9e-9 为现价：距窗内低点 3e-9 拉起 = (9-3)/3*100 = 200%
  approx('乱序归一后现价=时间最新（拉起 200%）', f3.recentRiseFromWindowLowPct, 200, 1e-6);

  console.log(`\n（含 D 节）总结果: ${pass} 通过, ${fail} 失败`);
  if (fail > 0) process.exitCode = 1;
}
