#!/usr/bin/env node
/**
 * FA preFilter 平移实时引擎对拍单测（批次 6，2026-10-15）
 *
 * live 引擎 build+emit 发生在 FA processTick/applyWalletTick 尾部（if (factors)
 * 才 emit），平移 = 引擎 _initializeDataSources 注入 setPreFilter，FA _buildFactorMap
 * 出窗返回 null → 不 emit（与回测 tickBuildSkip build-null continue 同族副作用序列）。
 *
 * 四层：
 *  A. 引擎注入段【真身源码提取 eval】+ 真 StrategyEngine（AST 腿）+ 真
 *     ConditionEvaluator——e50（3fcea181）事故现场反证：loadStrategies 存的
 *     condition 是 AST 对象，String() 化成 "[object Object]" → 提取恒 null →
 *     preFilter 从未生效。本组断言 AST 直传提取非 null 且区间精确。
 *  B. FA 层开/关双实例对拍（processTick 路径）：固定 tick 序列（窗内/低于
 *     下界/出上界/负 age 乱序/持仓出窗），断言 emit 序列 bit 一致（JSON 逐位）、
 *     出窗票开侧 emit=0、关侧出窗 factors 喂真 ConditionEvaluator 恒 false
 *     （数学等价：跳过的票 condition 也永不为真，不漏买）、持仓豁免两跑一致。
 *  C. applyWalletTick（wallet 段）同款对拍：deferWallet 价格段 + wallet 段
 *     两段合计 emit 一致；出窗票两段都 0。
 *  D. 源码口径（防回流）：注入段形状/开关默认开/Flap 继承（不覆盖
 *     _initializeDataSources）/FA 两处头注/e50 直传防线（无 String(s.condition)）。
 *
 * 零 DB 零网络。用法：node scripts/_test_live_prefilter_parity.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');
const { StrategyEngine } = require('../src/strategies/StrategyEngine');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
}

const stubLogger = { info() {}, warn() {}, error() {}, debug() {} };

// ─── 注入段真身提取（FourMemeWssTradingEngine 源码）───
const ENGINE_PATH = path.join(__dirname, '../src/trading-engine/implementations/FourMemeWssTradingEngine.js');
const ENGINE_SRC = fs.readFileSync(ENGINE_PATH, 'utf8');
const FLAP_SRC = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/FlapWssTradingEngine.js'), 'utf8');
const FA_SRC = fs.readFileSync(path.join(__dirname, '../src/services/FourMemeFactorAggregator.js'), 'utf8');

const segMatch = ENGINE_SRC.match(
  /if \(this\._mergedWsConfig\(\)\.faPreFilter !== false\) \{[\s\S]*?\n    \}/);
ok(!!segMatch, 'D1. 注入段存在且开关形状 = faPreFilter !== false（默认开，显式 false 关）');
const INJ_SEG = segMatch ? segMatch[0] : '';

/**
 * 执行注入段真身：require 包装（引擎内相对路径从测试侧映射到真模块），
 * this 桩提供 _mergedWsConfig/_strategyEngine/_factorAggregator/logger/_experimentId。
 */
function runInjectionSeg({ wsCfg, strategyEngine, faStub, logger }) {
  const fn = new Function('require', INJ_SEG);
  const fakeRequire = (p) => {
    if (typeof p === 'string' && p.endsWith('strategies/ConditionEvaluator')) {
      return { ConditionEvaluator };
    }
    throw new Error(`测试未预期的 require: ${p}`);
  };
  fn.call({
    _mergedWsConfig: () => wsCfg,
    _strategyEngine: strategyEngine,
    _factorAggregator: faStub,
    logger: logger || { info() {} },
    _experimentId: 'parity-test',
  }, fakeRequire);
}

/** 真 StrategyEngine + 真腿集（condition 字符串进，AST 存） */
function mkEngineWithLegs(legs) {
  const se = new StrategyEngine({});
  se.loadStrategies(legs.map((l, i) => ({ id: `leg${i}`, name: `leg${i}`, priority: 1, enabled: true, ...l })), null);
  return se;
}

function mkFaStub() {
  const calls = [];
  return { calls, setPreFilter(r) { calls.push(r); } };
}

const BUY_LEG = 'age >= 1.33 AND age <= 30 AND volume > 5 AND holderTrendSlope > 0';

// ══════════ A. 注入段真身（e50 反证）══════════
console.log('A. 引擎注入段真身（源码提取 eval + 真 StrategyEngine AST）');
{
  // A1. e50 事故现场反证：AST 腿提取非 null 且区间精确
  {
    const se = mkEngineWithLegs([{ action: 'buy', condition: BUY_LEG }]);
    const fa = mkFaStub();
    runInjectionSeg({ wsCfg: {}, strategyEngine: se, faStub: fa });
    ok(fa.calls.length === 1 && Array.isArray(fa.calls[0]) && fa.calls[0].length === 1
      && fa.calls[0][0].minAgeMinutes === 1.33 && fa.calls[0][0].maxAgeMinutes === 30,
      'A1. e50 反证：AST condition 提取非 null（String() 化路径恒 null），区间精确 [1.33, 30]');
  }
  // A2. OR 带 IS NULL 豁免臂（真实库形状）→ 提取 null → setPreFilter(null) fail-open
  {
    const se = mkEngineWithLegs([{ action: 'buy',
      condition: '(age >= 1.33 AND holderTrendGrowthRatio >= 55) OR profitPercent IS NULL' }]);
    const fa = mkFaStub();
    runInjectionSeg({ wsCfg: {}, strategyEngine: se, faStub: fa });
    ok(fa.calls.length === 1 && fa.calls[0] === null,
      'A2. 顶层 OR 带 IS NULL 无 age 臂 → null（fail-open 不过滤，语义安全方向）');
  }
  // A3. 两臂均有区间的 OR → 并包络
  {
    const se = mkEngineWithLegs([{ action: 'buy',
      condition: '(age >= 1 AND age <= 5) OR (age >= 10 AND age <= 20)' }]);
    const fa = mkFaStub();
    runInjectionSeg({ wsCfg: {}, strategyEngine: se, faStub: fa });
    ok(fa.calls.length === 1 && fa.calls[0][0].minAgeMinutes === 1 && fa.calls[0][0].maxAgeMinutes === 20,
      'A3. 双区间 OR 并包络 [1, 20]（跳过补集 ⊆ 恒假补集）');
  }
  // A4. 卖腿被跳过（action !== 'buy'）
  {
    const se = mkEngineWithLegs([
      { action: 'buy', condition: BUY_LEG },
      { action: 'sell', condition: 'age >= 1 AND age <= 2 AND profitPercent > 30' },
    ]);
    const fa = mkFaStub();
    runInjectionSeg({ wsCfg: {}, strategyEngine: se, faStub: fa });
    ok(fa.calls.length === 1 && fa.calls[0].length === 1,
      'A4. 卖腿 age 区间不参与（只收买腿）');
  }
  // A5. 多买腿并集逐腿收集
  {
    const se = mkEngineWithLegs([
      { action: 'buy', condition: 'age >= 2 AND age <= 10' },
      { action: 'buy', condition: 'age >= 5 AND age <= 30 AND volume > 1' },
    ]);
    const fa = mkFaStub();
    runInjectionSeg({ wsCfg: {}, strategyEngine: se, faStub: fa });
    ok(fa.calls.length === 1 && fa.calls[0].length === 2
      && fa.calls[0][0].minAgeMinutes === 2 && fa.calls[0][1].maxAgeMinutes === 30,
      'A5. 多买腿 → 区间数组并集（落任一区间即计算）');
  }
  // A6. 开关显式 false → 不注入（零 setPreFilter 调用）
  {
    const se = mkEngineWithLegs([{ action: 'buy', condition: BUY_LEG }]);
    const fa = mkFaStub();
    runInjectionSeg({ wsCfg: { faPreFilter: false }, strategyEngine: se, faStub: fa });
    ok(fa.calls.length === 0, 'A6. faPreFilter=false → setPreFilter 零调用（恒 emit 旧行为）');
  }
  // A7. 无 age 子句买腿 → 开启但不过滤
  {
    const se = mkEngineWithLegs([{ action: 'buy', condition: 'volume > 5' }]);
    const fa = mkFaStub();
    const logs = [];
    runInjectionSeg({ wsCfg: {}, strategyEngine: se, faStub: fa,
      logger: { info: (...a) => logs.push(a) } });
    ok(fa.calls.length === 1 && fa.calls[0] === null && logs.length === 1,
      'A7. 无 age 子句 → setPreFilter(null) + 一条说明日志');
  }
}

// ══════════ B. FA 层开/关双实例对拍（processTick 路径）══════════
console.log('B. FA 开/关双实例对拍（processTick：窗内/边界外/出上界/负 age/持仓豁免）');
const T0 = Date.UTC(2026, 9, 15, 8, 0, 0); // 2026-10-15 08:00 UTC
const RANGES = [{ minAgeMinutes: 1.33, maxAgeMinutes: 30 }];

function mkFa(preFilterOn) {
  const fa = new FourMemeFactorAggregator({ fourmemeWs: {} }, stubLogger);
  const emitted = [];
  fa.on('factorsUpdated', d => emitted.push({
    tokenAddress: d.tokenAddress, ts: d.tick.timestamp, factors: d.factors,
  }));
  if (preFilterOn) fa.setPreFilter(RANGES);
  return { fa, emitted };
}
function tickFor(tok, tsMs, seq) {
  return {
    token_address: tok, trade_type: seq % 3 === 2 ? 'sell' : 'buy',
    trader_address: `0xtrader${seq % 5}`,
    price_bnb: 0.0001 + (seq % 7) * 1e-6, price_usd: 0.07, bnb_amount: 0.3 + (seq % 4) * 0.1,
    token_amount: 5000, block_number: 45000000 + seq, timestamp: tsMs,
    tx_hash: `0xtx${seq}`, log_index: 1, price_outlier: false, platform: 'fourmeme',
  };
}
function registerTok(fa, tok) {
  fa.registerToken(tok, { createdAtMs: T0, totalSupply: 1e9, symbol: 'TEST', creatorAddress: null });
}

{
  const TOK_WIN = '0xwin00000000000000000000000000000000000a1';
  const TOK_EARLY = '0xear0000000000000000000000000000000000b2';
  const TOK_OUT = '0xout0000000000000000000000000000000000c3';
  const TOK_HELD = '0xhel0000000000000000000000000000000000d4';

  const on = mkFa(true), off = mkFa(false);
  for (const side of [on, off]) {
    for (const t of [TOK_WIN, TOK_EARLY, TOK_OUT, TOK_HELD]) registerTok(side.fa, t);
  }
  // 持仓票：窗内买入（两实例都登记持仓——豁免与开无关，结构性保证）
  for (const side of [on, off]) {
    side.fa.processTick(tickFor(TOK_HELD, T0 + 2 * 60000, 0));
    side.fa.setBuyState(TOK_HELD, { buyPriceBnb: 0.0001, buyPriceUsd: 0.07, buyTime: T0 + 2 * 60000 });
  }

  const script = [];
  // 窗内票：跨窗生命线（1.5min → 29min 连续；低于下界 0.5min；负 age 乱序早到行）
  let seq = 1;
  for (const min of [0.5, 1.5, 5, 15, 29, 29.9]) script.push([TOK_WIN, T0 + min * 60000, seq++]);
  script.push([TOK_WIN, T0 - 30 * 1000, seq++]);           // 负 age（早于创建的乱序行）
  // 低于下界票：全程 < 1.33min
  for (const min of [0.2, 0.8, 1.0]) script.push([TOK_EARLY, T0 + min * 60000, seq++]);
  // 出上界票：> 30min（含长期断流后复流）
  for (const min of [30.1, 45, 240]) script.push([TOK_OUT, T0 + min * 60000, seq++]);
  // 持仓票：买入后出窗（卖腿因子必须照常构建）
  for (const min of [31, 60]) script.push([TOK_HELD, T0 + min * 60000, seq++]);

  for (const side of [on, off]) {
    for (const [tok, ts, s] of script) side.fa.processTick(tickFor(tok, ts, s));
  }

  const byTok = (side, tok) => side.emitted.filter(e => e.tokenAddress === tok);

  // 对齐对拍：preFilter 只挡 build+emit、状态累计照常（processTick 的价格/流量/滑窗
  // 推进与 preFilter 无关）——因此开侧 emit ⊆ 关侧 emit，且共同 ts 的 factors 必须
  // 逐位一致（factors 是同一状态史的函数 = 状态不分叉证明）
  function parityCheck(onList, offList, condAst) {
    const ev = new ConditionEvaluator();
    const offByTs = new Map(offList.map(e => [e.ts, e]));
    let allAligned = true;
    for (const e of onList) {
      const peer = offByTs.get(e.ts);
      if (!peer || JSON.stringify(peer) !== JSON.stringify(e)) { allAligned = false; break; }
    }
    const onTss = new Set(onList.map(e => e.ts));
    let offOnly = true; // 关侧独有条目必须 condition 恒 false（跳过=恒假补集）
    for (const e of offList) {
      if (!onTss.has(e.ts) && ev.evaluate(condAst, e.factors) !== false) { offOnly = false; }
    }
    return { allAligned, offOnly, onTss, offTss: new Set(offList.map(e => e.ts)) };
  }
  const ev = new ConditionEvaluator();
  const condAst = ev.parseCondition(BUY_LEG);

  // B1. 窗内票：共同 ts 逐位一致 + 开侧恰窗内 5 条（0.5min/负 age 两条被跳）
  {
    const r = parityCheck(byTok(on, TOK_WIN), byTok(off, TOK_WIN), condAst);
    ok(r.allAligned && byTok(on, TOK_WIN).length === 5
      && [...r.onTss].every(ts => (ts - T0) / 60000 > 1.33 && (ts - T0) / 60000 < 30),
      'B1. 窗内票共同 ts factors 逐位 JSON 一致（状态累计不分叉）；开侧恰 5 条全在窗内');
    // 差集 = 关侧独有（0.5min 与负 age），condition 恒 false
    const diff = [...r.offTss].filter(ts => !r.onTss.has(ts));
    ok(r.offOnly && diff.length === 2 && diff.every(ts => (ts - T0) / 60000 < 1.33),
      'B1b. 关侧独有 ts 恰 2 条（0.5min + 负 age），condition 全 false（跳过=恒假补集，不漏买）');
  }

  // B2. 出上界票：开侧零 emit；关侧 3 条 condition 恒 false
  {
    const outOff = byTok(off, TOK_OUT);
    ok(byTok(on, TOK_OUT).length === 0 && outOff.length === 3
      && outOff.every(e => ev.evaluate(condAst, e.factors) === false),
      'B2. 出上界票（30.1/45/240min）：开侧 emit=0，关侧 condition 全 false');
  }

  // B3. 低于下界票同款
  {
    const earlyOff = byTok(off, TOK_EARLY);
    ok(byTok(on, TOK_EARLY).length === 0 && earlyOff.length === 3
      && earlyOff.every(e => ev.evaluate(condAst, e.factors) === false),
      'B3. 低于下界票（0.2-1.0min）：开侧 emit=0，关侧 condition 全 false');
  }

  // B4. 负 age 乱序行：关侧 emit 的 factors.age < 0（早于创建锚），开侧同跳
  {
    const negOff = byTok(off, TOK_WIN).filter(e => e.ts < T0);
    ok(negOff.length === 1 && negOff[0].factors.age < 0
      && !byTok(on, TOK_WIN).some(e => e.ts < T0),
      'B4. 负 age 乱序行：关侧 emit age<0（condition 恒 false），开侧同判窗外跳过');
  }

  // B5. 持仓豁免：出窗照常 emit、两侧逐位一致、持仓因子族在（holdDuration 递增）
  {
    const heldOn = byTok(on, TOK_HELD), heldOff = byTok(off, TOK_HELD);
    const outOn = heldOn.filter(e => (e.ts - T0) / 60000 > 30);
    const outOffH = heldOff.filter(e => (e.ts - T0) / 60000 > 30);
    ok(outOn.length === 2 && JSON.stringify(outOn) === JSON.stringify(outOffH)
      && outOn.every(e => e.factors.holdDuration > 0 && e.factors.buyPrice === 0.07)
      && outOn[1].factors.holdDuration > outOn[0].factors.holdDuration,
      'B5. 持仓票出窗（31/60min）照常 emit（holdDuration/buyPrice 持仓因子在），两侧逐位一致（豁免结构性）');
    ok(heldOn.length === 3,
      'B5b. 持仓票全程 emit=3（窗内买入 1 + 出窗 2），不受 preFilter 影响');
  }

  // B6. e50 生效反证：开侧跳过计数 > 0（若提取恒 null 则恒 0——preFilter 名存实亡检测）
  ok(on.fa.getPreFilterSkipped() > 0 && off.fa.getPreFilterSkipped() === 0,
    'B6. getPreFilterSkipped：开侧>0（preFilter 真生效），关侧恒 0');
}

// ══════════ C. applyWalletTick（wallet 段）对拍 ══════════
console.log('C. 两阶段喂食 wallet 段对拍（processTick deferWallet + applyWalletTick）');
{
  const TOK = '0xdef0000000000000000000000000000000000e5';
  const TOK_HELD = '0xhel0000000000000000000000000000000000d4';
  const on = mkFa(true), off = mkFa(false);
  for (const side of [on, off]) {
    for (const t of [TOK, TOK_HELD]) registerTok(side.fa, t);
  }
  // 持仓票窗内首喂 + 登记持仓
  for (const side of [on, off]) {
    side.fa.processTick(tickFor(TOK_HELD, T0 + 2 * 60000, 0));
    side.fa.setBuyState(TOK_HELD, { buyPriceBnb: 0.0001, buyPriceUsd: 0.07, buyTime: T0 + 2 * 60000 });
  }
  const script = [
    [TOK, T0 + 5 * 60000, 1],        // 出窗票？不——5min 在 [1.33,30] 内
    [TOK, T0 + 31 * 60000, 2],       // 出窗
    [TOK, T0 + 40 * 60000, 3],       // 出窗（wallet 段）
    [TOK_HELD, T0 + 35 * 60000, 4],  // 持仓出窗
  ];
  for (const side of [on, off]) {
    for (const [tok, ts, s] of script) {
      const t = tickFor(tok, ts, s);
      side.fa.processTick(t, { deferWallet: true }); // 价格段
      side.fa.applyWalletTick(t);                     // wallet 段
    }
  }
  const byTok = (side, tok) => side.emitted.filter(e => e.tokenAddress === tok);
  // C1. 窗内票：5min（在窗内）两段各 1 条；同 ts 两跑逐位一致（价格段与 wallet 段
  //     合计比较——同 ts 有两条，用数组按序比较）
  {
    const winOn = byTok(on, TOK).filter(e => e.ts === T0 + 5 * 60000);
    const winOff = byTok(off, TOK).filter(e => e.ts === T0 + 5 * 60000);
    ok(winOn.length === 2 && JSON.stringify(winOn) === JSON.stringify(winOff),
      'C1. 窗内票价格段+wallet 段两跑 emit 逐位一致（5min 在窗内，每段各 1 条）');
  }
  // C2. 出窗票：开侧两段合计 0 emit；关侧 31/40min 各 2 条（价格段+wallet 段）
  {
    const outOn = byTok(on, TOK).filter(e => e.ts >= T0 + 31 * 60000);
    const outOff = byTok(off, TOK).filter(e => e.ts >= T0 + 31 * 60000);
    ok(outOn.length === 0 && outOff.length === 4,
      'C2. 出上界票（31/40min）：开侧价格段+wallet 段均不 emit，关侧每 ts 两段各 1');
  }
  // C3. 持仓票出窗：wallet 段照常 emit 且两跑一致
  const heldOn = byTok(on, TOK_HELD).filter(e => e.ts >= T0 + 35 * 60000);
  const heldOff = byTok(off, TOK_HELD).filter(e => e.ts >= T0 + 35 * 60000);
  ok(heldOn.length === 2 && JSON.stringify(heldOn) === JSON.stringify(heldOff),
    'C3. 持仓票出窗：两段（价格/wallet）照常 emit，两跑逐位一致');
}

// ══════════ D. 源码口径（防回流）══════════
console.log('D. 源码口径（防回流）');
{
  ok(!/_initializeDataSources/.test(FLAP_SRC),
    'D2. FlapWssTradingEngine 不覆盖 _initializeDataSources（继承父类注入段，flap 经 _mergedWsConfig 同键）');
  ok(/实时引擎批次 6（2026-10-15）平移同默认开/.test(FA_SRC),
    'D3a. FA setPreFilter 头注含「实时引擎批次 6（2026-10-15）平移同默认开」');
  ok(/live 引擎不调用/.test(FA_SRC),
    'D3b. FA shouldSkipTickBuild 头注含「live 引擎不调用」（live 走 build-null 不 emit，无需本谓词）');
  ok(/const pf = s\.condition \? _CE\.extractBuyRangeFromCondition\(s\.condition\) : null;/.test(INJ_SEG)
    && !/parseCondition\(String\(/.test(INJ_SEG) && !/= String\(s\.condition\)/.test(INJ_SEG),
    'D4. 注入段 AST 直传（代码形状 extractBuyRangeFromCondition(s.condition)，无 String() 化调用——e50 防回流）');
  ok(/faPreFilter !== false/.test(INJ_SEG),
    'D5. 开关形状锁定：faPreFilter !== false（默认开）');
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
