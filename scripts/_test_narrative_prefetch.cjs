#!/usr/bin/env node
/**
 * N3 叙事预触发单测（2026-10-13 叙事提速案）——本地零 DB 零网络
 *
 *   A. 行为级 _narrativePrefetchCheck（Object.create 引擎 prototype + 手工挂成员，
 *      getRating 计次打桩）：
 *      开关关零调用 / 条件不满足不标 write-once（后续满足可发起）/ 条件满足发起+
 *      startedAt 落值 / write-once 二次 tick 不再发起 / rating=1 登记 _narrativeBlockedTokens
 *      / address-fail 重试窗豁免（真 shouldBlockOnNarrative）/ getRating reject 不崩不登记
 *   B. _narrativePrefetchCondition 条件分派：prefetch 字段优先 / 缺省回落 call /
 *      首条买腿优先（卖腿不参与）/ 全无 → null + 惰性缓存
 *   C. fire join in-flight（真 NarrativeDirectCaller + _getAnalyzer 打桩）：
 *      预触发发起后 fire 的 getRating join 同一 inflight → 底层 analyze 恰 1 次，
 *      两调用方拿到同一评级
 *   D. 源码口径（锁防线）：_onFactorsUpdated 挂点在 _scheduleDebouncedBuy 前 /
 *      fire 直调点 prefetchLeadMs 形状 / 开关默认 false 形状 / 构造区四成员 /
 *      BacktestEngine 无预触发 / StrategyEngine 双键校验+字段透传 / 引擎加载透传
 *
 * 用法：node scripts/_test_narrative_prefetch.cjs
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { FourMemeWssTradingEngine } = require('../src/trading-engine/implementations/FourMemeWssTradingEngine');
const { NarrativeDirectCaller, shouldBlockOnNarrative } = require('../src/trading-engine/pre-check/NarrativeDirectCaller');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.error(`  ❌ ${name}${detail !== undefined ? ` | ${JSON.stringify(detail)}` : ''}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 轻量引擎实例（先例 _test_stop_loss_rules：prototype 直挂跳过 constructor，手动注入成员）
function makeEngine(fields = {}) {
  return Object.assign(Object.create(FourMemeWssTradingEngine.prototype), {
    _experimentId: 'test-exp',
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    _narrativePrefetchEnabled: true,
    _narrativePrefetchedTokens: new Set(),
    _narrativePrefetchStartedAt: new Map(),
    _narrativePrefetchCond: undefined,
    _narrativeBlockedTokens: new Set(),
    _shouldBlockOnNarrative: shouldBlockOnNarrative, // 真判定函数（与 _initializeDataSources 同源）
    _strategyEngine: {
      evaluateCondition: (cond, factors) => factors.__condHit === true,
      getAllStrategies: () => [{ action: 'buy', narrativeCallCondition: 'age < 10' }],
    },
    _narrativeCaller: { getRating: async () => { throw new Error('should not be called'); } },
    ...fields,
  });
}

async function main() {
  const ADDR = '0xp1';

  // ═══ A. _narrativePrefetchCheck 行为级 ═══
  console.log('══ A. _narrativePrefetchCheck 行为级 ══');
  {
    // A1 开关关 → 零调用零标记
    let calls = 0;
    const engOff = makeEngine({
      _narrativePrefetchEnabled: false,
      _narrativeCaller: { getRating: async () => { calls++; return { numericRating: 3 }; } },
    });
    engOff._narrativePrefetchCheck(ADDR, { __condHit: true, age: 1 }, { symbol: 'T' });
    await sleep(5);
    check('A1 开关关 → getRating 零调用', calls === 0);
    check('A1b 开关关 → write-once 集不标', engOff._narrativePrefetchedTokens.size === 0);
  }
  {
    // A2 条件不满足 → 零调用且【不标 write-once】（后续条件满足仍可发起）
    let calls = 0;
    const eng = makeEngine({
      _narrativeCaller: { getRating: async () => { calls++; return { numericRating: 3 }; } },
    });
    eng._narrativePrefetchCheck(ADDR, { __condHit: false, age: 1 }, { symbol: 'T' });
    await sleep(5);
    check('A2 条件不满足 → 零调用', calls === 0);
    check('A2b 条件不满足 → 不标 write-once（后续满足可发起）', !eng._narrativePrefetchedTokens.has(ADDR));
    eng._narrativePrefetchCheck(ADDR, { __condHit: true, age: 1 }, { symbol: 'T' });
    await sleep(5);
    check('A2c 后续条件满足 → 正常发起', calls === 1 && eng._narrativePrefetchedTokens.has(ADDR));
  }
  {
    // A3 条件满足 → 发起 + startedAt 落值 + write-once
    let calls = 0;
    const eng = makeEngine({
      _narrativeCaller: { getRating: async () => { calls++; await sleep(5); return { numericRating: 3, rating: 'medium', durationMs: 5, fromCache: false }; } },
    });
    const t0 = Date.now();
    eng._narrativePrefetchCheck(ADDR, { __condHit: true, age: 2 }, { symbol: 'T' });
    check('A3 发起即标 write-once', eng._narrativePrefetchedTokens.has(ADDR));
    const startedAt = eng._narrativePrefetchStartedAt.get(ADDR);
    check('A3b startedAt 落值（lead 度量原料）', typeof startedAt === 'number' && startedAt >= t0 && startedAt <= Date.now());
    await sleep(20);
    check('A3c getRating 恰 1 次', calls === 1);
    // A4 write-once：二次 tick 不再发起
    eng._narrativePrefetchCheck(ADDR, { __condHit: true, age: 2 }, { symbol: 'T' });
    await sleep(5);
    check('A4 二次 tick 不再发起（write-once）', calls === 1);
  }
  {
    // A5 rating=1 非 address 挂点 → 登记 _narrativeBlockedTokens
    const eng = makeEngine({
      _narrativeCaller: { getRating: async () => ({ numericRating: 1, rating: 'low', precheckStage: null, durationMs: 5, fromCache: false }) },
    });
    eng._narrativePrefetchCheck(ADDR, { __condHit: true, age: 10 }, { symbol: 'T' });
    await sleep(10);
    check('A5 rating=1 → 预触发否决登记短路集', eng._narrativeBlockedTokens.has(ADDR));
  }
  {
    // A6 rating=1 + address 挂点 + age<5min → 豁免不登记（宣告竞态重试窗）
    const eng = makeEngine({
      _narrativeCaller: { getRating: async () => ({ numericRating: 1, rating: 'low', precheckStage: 'address', durationMs: 5, fromCache: false }) },
    });
    eng._narrativePrefetchCheck(ADDR, { __condHit: true, age: 3 }, { symbol: 'T' });
    await sleep(10);
    check('A6 address 挂点窗内 → 豁免不登记', !eng._narrativeBlockedTokens.has(ADDR));
    // A6b 出窗（age≥5min）→ 登记
    eng._narrativePrefetchCheck('0xp2', { __condHit: true, age: 6 }, { symbol: 'T2' });
    await sleep(10);
    check('A6b address 挂点出窗 → 登记', eng._narrativeBlockedTokens.has('0xp2'));
  }
  {
    // A7 getRating reject → 不崩、不登记、write-once 仍标（fire 时直调兜底）
    const eng = makeEngine({
      _narrativeCaller: { getRating: async () => { throw new Error('analyze down'); } },
    });
    let err = null;
    try { eng._narrativePrefetchCheck(ADDR, { __condHit: true, age: 1 }, { symbol: 'T' }); }
    catch (e) { err = e; }
    await sleep(10);
    check('A7 reject 同步不抛（fire-and-forget + catch）', err === null);
    check('A7b reject → 不登记短路集', !eng._narrativeBlockedTokens.has(ADDR));
    check('A7c reject → write-once 仍标（不重复烧）', eng._narrativePrefetchedTokens.has(ADDR));
  }
  {
    // A8 无任何叙事条件腿（cond=null）→ 零调用（预触发无意义）
    let calls = 0;
    const eng = makeEngine({
      _strategyEngine: {
        evaluateCondition: () => true,
        getAllStrategies: () => [{ action: 'buy', narrativeCallCondition: null, narrativePrefetchCondition: null }],
      },
      _narrativeCaller: { getRating: async () => { calls++; return { numericRating: 3 }; } },
    });
    eng._narrativePrefetchCheck(ADDR, { age: 1 }, { symbol: 'T' });
    await sleep(5);
    check('A8 无叙事条件腿 → cond=null 零调用', calls === 0);
  }

  // ═══ B. _narrativePrefetchCondition 条件分派 ═══
  console.log('══ B. _narrativePrefetchCondition 条件分派 ══');
  const mkCondEngine = (legs) => makeEngine({
    _strategyEngine: { evaluateCondition: () => true, getAllStrategies: () => legs },
  });
  {
    check('B1 prefetch 字段优先',
      mkCondEngine([{ action: 'buy', narrativePrefetchCondition: ' age < 5 ', narrativeCallCondition: 'age < 10' }])
        ._narrativePrefetchCondition() === 'age < 5');
    check('B2 缺省回落 narrativeCallCondition',
      mkCondEngine([{ action: 'buy', narrativePrefetchCondition: null, narrativeCallCondition: 'age < 10' }])
        ._narrativePrefetchCondition() === 'age < 10');
    check('B2b 空串视为未配（回落 call）',
      mkCondEngine([{ action: 'buy', narrativePrefetchCondition: '  ', narrativeCallCondition: 'age < 10' }])
        ._narrativePrefetchCondition() === 'age < 10');
    check('B3 首条带条件的买腿（前腿无叙事后腿有 → 取后腿）',
      mkCondEngine([
        { action: 'buy', narrativePrefetchCondition: null, narrativeCallCondition: null },
        { action: 'buy', narrativeCallCondition: 'age < 3' },
        { action: 'buy', narrativePrefetchCondition: 'age < 8' },
      ])._narrativePrefetchCondition() === 'age < 3');
    check('B4 卖腿不参与（只有卖腿带条件 → null）',
      mkCondEngine([{ action: 'sell', narrativeCallCondition: 'profitPercent > 50' }])
        ._narrativePrefetchCondition() === null);
    check('B5 全无 → null', mkCondEngine([{ action: 'buy' }])._narrativePrefetchCondition() === null);
    // 惰性缓存：改腿集合后二次调用仍取缓存值（策略启动后不变，重启才换）
    const eng = mkCondEngine([{ action: 'buy', narrativeCallCondition: 'age < 10' }]);
    eng._narrativePrefetchCondition();
    eng._strategyEngine.getAllStrategies = () => [{ action: 'buy', narrativeCallCondition: 'age < 99' }];
    check('B6 惰性缓存（策略集变化不重算）', eng._narrativePrefetchCondition() === 'age < 10');
  }

  // ═══ C. fire join in-flight（真 NarrativeDirectCaller）═══
  console.log('══ C. fire join in-flight（_getAnalyzer 打桩）══');
  {
    // C1 预触发发起（未完成）→ fire 的 getRating join 同一 inflight：analyze 恰 1 次
    let analyzeCalls = 0;
    let resolveAnalyze;
    const caller = new NarrativeDirectCaller();
    caller._getAnalyzer = async () => ({
      analyze: async (addr) => {
        analyzeCalls++;
        return new Promise(res => { resolveAnalyze = () => res({ numericRating: 3, rating: 'medium', meta: {} }); });
      },
    });
    const eng = makeEngine({ _narrativeCaller: caller });
    eng._narrativePrefetchCheck(ADDR, { __condHit: true, age: 1 }, { symbol: 'T' }); // 预触发发起
    await sleep(5); // 等 analyze 进入 inflight
    const firePromise = caller.getRating(ADDR); // fire 时刻直调（join 语义）
    await sleep(5);
    resolveAnalyze();
    const [prefetchSide, fireSide] = await Promise.all([
      // 预触发侧结果没有直接返回值——用同一 caller 再验证已完成路径；此处断言 fire 侧
      firePromise,
    ]);
    check('C1 fire join inflight → 底层 analyze 恰 1 次', analyzeCalls === 1, { analyzeCalls });
    check('C1b fire 侧拿到评级', prefetchSide.numericRating === 3);

    // C2 完成后再次 getRating（已完成 = analyze 层行缓存语境，caller 不去重）→ 新 analyze 调用
    //    （真实链路里这次 analyze 内部命中 token_narrative 行缓存秒回——引擎侧零改动前提）
    caller._getAnalyzer = async () => ({
      analyze: async () => { analyzeCalls++; return { numericRating: 3, rating: 'medium', meta: { fromCache: true } }; },
    });
    const again = await caller.getRating(ADDR);
    check('C2 完成后再调 → analyze 层接管（fromCache 透传）', again.fromCache === true && analyzeCalls === 2);
    check('C3 startedAt 已被预触发侧消费语义保留（引擎成员仍在，fire 点删除）',
      eng._narrativePrefetchStartedAt.has(ADDR) === true);
  }

  // ═══ D. 源码口径（锁防线）═══
  console.log('══ D. 源码口径 ══');
  const eng = fs.readFileSync(path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');
  const se = fs.readFileSync(path.join(ROOT, 'src/strategies/StrategyEngine.js'), 'utf8');
  const be = fs.readFileSync(path.join(ROOT, 'src/trading-engine/implementations/BacktestEngine.js'), 'utf8');
  {
    // D1 挂点：买腿分支内、_scheduleDebouncedBuy 前（OPB/TPA 后台 fire-and-forget 同款时序位）
    check('D1 挂点在 _scheduleDebouncedBuy 前',
      eng.indexOf('this._narrativePrefetchCheck(tokenAddress, factors, token);') !== -1
      && eng.indexOf('this._narrativePrefetchCheck(tokenAddress, factors, token);')
        < eng.indexOf('this._scheduleDebouncedBuy(tokenAddress, tick);'));
    check('D1b 挂点恰 1 处', (eng.match(/this\._narrativePrefetchCheck\(/g) || []).length === 1);
    // D2 fire 直调点 prefetchLeadMs：get → 计算 lead → delete（一次性消费）
    const m = eng.match(/const prefetchStartedAt = this\._narrativePrefetchStartedAt\.get\(tokenAddress\);[\s\S]{0,260}/) || [''];
    check('D2 fire 点 lead 计算形状（get→lead→delete）',
      m[0].includes('narrativeCallInfo.prefetchLeadMs = Date.now() - prefetchStartedAt;')
      && m[0].includes('this._narrativePrefetchStartedAt.delete(tokenAddress);'));
    // D3 开关默认 false 形状（narrativePrefetch 段缺省 → {} → enabled!==true → false）
    check('D3 开关形状（缺省段恒 false）',
      eng.includes('this._narrativePrefetchEnabled = (this._mergedWsConfig().narrativePrefetch || {}).enabled === true;'));
    // D4 构造区四成员
    check('D4 构造区四成员（enabled/write-once 集/startedAt/cond 缓存）',
      eng.includes('this._narrativePrefetchedTokens = new Set();')
      && eng.includes('this._narrativePrefetchStartedAt = new Map();')
      && eng.includes('this._narrativePrefetchCond = undefined;'));
    // D5 fire 侧 gate 仍按 narrativeCallCondition（只配 prefetch 不配 call 的腿不短路）
    check('D5 fire gate 键不漂移（narrativeGateEnabled 判 narrativeCallCondition）',
      eng.includes("const narrativeGateEnabled = !!(strategy.narrativeCallCondition && String(strategy.narrativeCallCondition).trim() !== '');"));
    // D6 回测不适用：BacktestEngine 零预触发引用（回测有 preloadCache 预载机制）
    check('D6 BacktestEngine 无预触发', !be.includes('_narrativePrefetchCheck') && !be.includes('narrativePrefetch'));
    // D7 StrategyEngine：双键同集校验 + 策略对象字段透传
    check('D7 StrategyEngine 双键校验循环',
      se.includes("for (const field of ['narrativeCallCondition', 'narrativePrefetchCondition'])"));
    check('D7b StrategyEngine 策略对象透传 prefetch 字段',
      se.includes('narrativePrefetchCondition: config.narrativePrefetchCondition || null,'));
    // D8 引擎策略加载透传
    check('D8 引擎加载透传 prefetch 字段',
      eng.includes('narrativePrefetchCondition: s.narrativePrefetchCondition || null,'));
    // D9 getRating 调用侧 catch 兜底（P10 unhandled 防线先例）
    const m2 = eng.match(/this\._narrativeCaller\.getRating\(tokenAddress\)[\s\S]{0,900}/) || [''];
    check('D9 预触发 getRating 带 .catch 兜底', /\.catch\(e => this\.logger\.warn/.test(m2[0]));
  }

  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}：${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
