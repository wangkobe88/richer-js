#!/usr/bin/env node
/**
 * T203 FP 拒后门内重试 单测（零 DB 零网络）。
 * 覆盖：①normalizeSignalGate.fpRetry 归一化（缺省 0/合法域/非法形状）；
 * ②FpRetryTracker 状态机（登记/间隔/预算耗尽/通过清 pending/地平线过期/覆盖/
 * 零 Date.now——时钟注入红线）；③事故现场反证（bt-v164 0xb6ee…7777 FP28 锚
 * 相位形状：首评 t7N=2 拒，+2s 重评 t7N=4 翻转通过）；④引擎胶水源码锁
 * （resume 跳过 T110/落库/触发记账/FP 门；回测挂点虚拟时钟非墙钟；归策略包
 * 缺省 0）。
 * 直接跑，断言失败退出非零。
 */
'use strict';
const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (cond, label) => {
  if (cond) console.log('  ✓ ' + label);
  else { failed++; console.error('  ❌ FAIL: ' + label); }
};

// ── A. normalizeSignalGate.fpRetry ──
console.log('\n[A] normalizeSignalGate.fpRetry 归一化');
{
  const { normalizeSignalGate } = require('../src/strategies/StrategyEngine');
  const d = normalizeSignalGate({});
  ok(d.normalized && d.normalized.fpRetry === 0, '缺省 fpRetry=0（存量腿零行为）');
  ok(normalizeSignalGate(null).normalized === null, '无 signalGate 段照旧 null');
  const ok1 = normalizeSignalGate({ fpRetry: 2 });
  ok(ok1.normalized.fpRetry === 2, 'fpRetry:2 合法');
  ok(normalizeSignalGate({ fpRetry: 10 }).normalized.fpRetry === 10, 'fpRetry:10 上界含端');
  for (const [v, why] of [[-1, '负'], [1.5, '非整'], [11, '超上界']]) {
    const r = normalizeSignalGate({ fpRetry: v });
    ok(r.error && /fpRetry/.test(r.error), `fpRetry:${JSON.stringify(v)}（${why}）拒`);
  }
  ok(normalizeSignalGate({ fpRetry: '2' }).normalized.fpRetry === 2, "fpRetry:'2' Number 强转=2（maxTriggers 同款既有形状）");
  const unk = normalizeSignalGate({ fpRetryX: 1 });
  ok(unk.error && unk.error.includes('fpRetry'), '未知键报错文案含 fpRetry 白名单');
  // 与既有键正交
  const mix = normalizeSignalGate({ maxTriggers: 2, fpRetry: 3, bpPassLevels: ['good'] });
  ok(mix.normalized.fpRetry === 3 && mix.normalized.maxTriggers === 2, '与既有键共存');
}

// ── B. FpRetryTracker 状态机 ──
console.log('\n[B] FpRetryTracker 状态机（时钟注入）');
{
  const { FpRetryTracker } = require('../src/trading-engine/core/FpRetryTracker');
  const T0 = 1700000000000;
  const tk = new FpRetryTracker();
  ok(tk.register('t', { legId: 'L', signalId: 's1', budget: 0, nowMs: T0 }) === null, 'budget=0 登记 no-op（fpRetry 缺省零行为）');
  ok(tk.register('t', { legId: 'L', signalId: null, budget: 2, nowMs: T0 }) === null, 'signalId 缺席 no-op');

  tk.register('t', { legId: 'L', signalId: 's1', budget: 2, nowMs: T0, strategyName: 'leg0' });
  ok(tk.pendingOf('t') && tk.pendingOf('t').remaining === 2, '登记 pending（budget 2）');
  ok(tk.tickCheck('t', T0 + 1000) === null, 'spacing 1s < 2s 不评（防同秒连 tick 烧穿预算）');
  ok(tk.tickCheck('t', T0 + 2000) && tk.tickCheck('t', T0 + 2000).kind === 'eval', 'spacing 2s 到点评');
  // 首次重评仍拒
  let r = tk.recordResult('t', false, 'launch_fail_dead', T0 + 2000);
  ok(!r.pass && r.remaining === 1 && !r.exhausted && r.attempts.length === 1, '拒 1 次 remaining=1');
  ok(r.attempts[0].reason === 'launch_fail_dead' && r.attempts[0].verdict === 'reject', 'attempt 留痕 reason/verdict');
  ok(tk.tickCheck('t', T0 + 3000) === null, '第二间隔内不评');
  // 覆盖语义：新信号接管
  tk.register('t', { legId: 'L', signalId: 's2', budget: 1, nowMs: T0 + 3500, strategyName: 'leg0' });
  ok(tk.pendingOf('t').signalId === 's2' && tk.pendingOf('t').remaining === 1, '同 token 新信号覆盖 pending（最新接管）');
  r = tk.recordResult('t', false, 'tail_no_buyer_pressure', T0 + 6000);
  ok(!r.pass && r.exhausted === true, 'budget 1 拒即耗尽');
  ok(tk.pendingOf('t') === null, '耗尽清 pending');

  // 通过清 pending
  tk.register('u', { legId: 'L', signalId: 's3', budget: 2, nowMs: T0 });
  r = tk.recordResult('u', true, null, T0 + 2100);
  ok(r.pass === true && tk.pendingOf('u') === null, '重评通过清 pending（引擎续跑）');
  ok(tk.tickCheck('u', T0 + 9999) === null, '通过后无 pending tickCheck null');

  // 地平线过期
  tk.register('v', { legId: 'L', signalId: 's4', budget: 3, nowMs: T0 });
  const st = tk.tickCheck('v', T0 + 31000);
  ok(st && st.kind === 'expired' && st.budget === 3, '30s 地平线过期（陈旧信号不复活）');
  // 零 Date.now：时钟全注入（源码锁——剥注释后扫描，注释里的「实时=Date.now」
  // 说明文字不算功能性调用）
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const src = stripComments(fs.readFileSync(path.join(__dirname, '../src/trading-engine/core/FpRetryTracker.js'), 'utf8'));
  ok(!/Date\.now/.test(src), 'FpRetryTracker 功能代码零 Date.now（时钟注入红线）');
}

// ── C. 事故现场反证（bt-v164 0xb6ee…7777 FP28 锚相位形状）──
console.log('\n[C] 0xb6ee 案锚相位形状重放（评估器打桩）');
{
  const { FpRetryTracker } = require('../src/trading-engine/core/FpRetryTracker');
  const t0 = 1762300218000; // 19:10:58 锚
  // 尾 7s 窗买笔数随时间（打桩：锚时 N=2 → +1s 起 N=4——0.074×2 进窗）
  const t7nAt = (ts) => (ts <= t0 ? 2 : 4);
  const fpVerdict = (ts) => t7nAt(ts) > 2 ? { pass: true } : { pass: false, reason: 'launch_fail_dead' };

  const tk = new FpRetryTracker();
  tk.register('b6ee', { legId: 'buy_0_1', signalId: 'sig1', budget: 2, nowMs: t0 });
  // 首评即 FP 拒（引擎在 _evaluateBuyPath FP 分支登记后 return）
  let gate = fpVerdict(t0);
  ok(gate.pass === false, '锚时刻 t7N=2 FP28 拒（事故现场）');
  // +1s tick：spacing 2s 未到 → 不评（0x5859 类同秒连 tick 不烧预算）
  ok(tk.tickCheck('b6ee', t0 + 1000) === null, '+1s spacing 未到不评');
  // +2s tick：重评 → t7N=4 → 翻转
  const st = tk.tickCheck('b6ee', t0 + 2000);
  ok(st && st.kind === 'eval', '+2s 到点重评');
  gate = fpVerdict(t0 + 2000);
  const rec = tk.recordResult('b6ee', gate.pass, gate.pass ? null : gate.reason, t0 + 2000);
  ok(rec.pass === true && rec.attempts.length === 1, '重评 t7N=4 翻转通过（延迟 2s 救回=用户思想实验）');
  ok(tk.pendingOf('b6ee') === null, '通过后 pending 清（引擎续跑门链）');
}

// ── D. 引擎胶水源码锁（形状防线）──
console.log('\n[D] 引擎胶水源码锁');
{
  const live = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');
  const bt = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/BacktestEngine.js'), 'utf8');
  const abs = fs.readFileSync(path.join(__dirname, '../src/trading-engine/core/AbstractTradingEngine.js'), 'utf8');

  // D1 实时：resume 跳过 T110（节流块在 if (!opts.resume) 内）
  ok(/if \(!opts\.resume\) \{\s*\n\s*const _throttleAdmit = this\._buySignalThrottle\.admit/.test(live),
    '实时：T110 admit 包在 if(!opts.resume)（重试不走发射冷却）');
  // D2 实时：save 块跳过 + signalId 直传
  ok(/let signalId = null;\s*\n\s*if \(!opts\.resume\) \{\s*\n\s*try \{/.test(live), '实时：信号落库块包在 if(!opts.resume)');
  ok(/if \(opts\.resume && opts\.resume\.signalId\) signalId = opts\.resume\.signalId;/.test(live), '实时：resume 直传 signalId');
  // D3 实时：FP 拒登记 + 触发记账跳过
  ok(live.includes('await this._fpRetryOnReject(tokenAddress, strategy, signalId'), '实时：FP 拒分支调 _fpRetryOnReject');
  ok(/if \(!opts\.resume\) \{\s*\n\s*this\._sgRecordTrigger/.test(live), '实时：_sgRecordTrigger 包在 if(!opts.resume)（重试不耗新触发）');
  // D4 实时：挂点在买腿分支（observation 之后 T132 之前）+ Date.now 时钟
  ok(live.includes("this._fpRetryTick(tokenAddress, token, factors, Date.now()"), '实时：挂点调 _fpRetryTick（墙钟）');
  // D5 回测：同款三跳过
  ok(/if \(!opts\.resume\) \{\s*\n\s*const _throttleAdmit = this\._buySignalThrottle\.admit/.test(bt), '回测：T110 包在 if(!opts.resume)');
  ok(/let signalId = null;\s*\n\s*if \(!opts\.resume\) \{\s*\n\s*try \{/.test(bt), '回测：落库块包在 if(!opts.resume)');
  ok(/if \(!opts\.resume\) \{\s*\n\s*this\._sgRecordTrigger/.test(bt), '回测：_sgRecordTrigger 包在 if(!opts.resume)');
  ok(bt.includes('await this._fpRetryOnReject(tokenAddress, strategy, signalId'), '回测：FP 拒分支调 _fpRetryOnReject');
  // D6 回测：挂点决策时钟=虚拟 tickTs（tickCheck/重评/续跑全链；perf 仪表的
  // 墙钟计数与主循环既有形状一致不算决策时钟）
  const hookIdx = bt.indexOf('_fpRetryTickBacktest(tick.token_address, token, _frFactors, tick, tickTs)');
  ok(hookIdx > 0, '回测：主循环挂点存在');
  const hookStart = bt.lastIndexOf('if (this._fpRetryEnsure().pendingOf(tick.token_address)', hookIdx);
  const hookBlock = bt.slice(hookStart, hookIdx + 120);
  ok(hookBlock.includes('tickCheck(tick.token_address, tickTs)'), '回测：挂点 spacing 判定用 tickTs 虚拟时钟');
  ok(hookBlock.includes('buildFactorMap(tick.token_address, tickTs)'), '回测：补 build 用 tickTs');
  ok(hookBlock.includes('_fpRetryTickBacktest(tick.token_address, token, _frFactors, tick, tickTs)'), '回测：重评入口传 tickTs');
  ok(bt.includes('anchorMs: tickTs }'), '回测：重评 anchorMs=tickTs（as-of 截窗防前视）');
  // D7 共享 glue：登记/重评锚语义
  ok(abs.includes('async _fpRetryOnReject(') && abs.includes('async _fpRetryTick('), '共享 glue 两方法在场');
  ok(abs.includes('__fpRetryInflight') && abs.includes('async __fpRetryTickInner('), '共享 glue 防重入护栏在场（重评 await 期双 tick 不双派发）');
  ok(/signalCreatedAt: nowMs,\s*\n\s*\.\.\.fpCtx,/.test(abs), '共享 glue：重评 ctx 可注入 anchorMs（回测截窗防前视）');
  ok(abs.includes('fpRetry'), '共享 glue 消费 fpRetry 键');
  // D8 归一化产物含缺省键（loadStrategies/validateLegs 同源）
  const se = fs.readFileSync(path.join(__dirname, '../src/strategies/StrategyEngine.js'), 'utf8');
  ok(/fpRetry: 0 \}/.test(se), 'normalizeSignalGate 缺省产物含 fpRetry:0');
}

console.log(`\n${failed === 0 ? '✅ 全绿' : '❌ ' + failed + ' 项失败'}`);
process.exit(failed ? 1 : 0);
