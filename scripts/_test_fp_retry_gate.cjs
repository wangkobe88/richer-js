#!/usr/bin/env node
/**
 * T203 FP 拒后门内重试 单测（零 DB 零网络）。
 * 覆盖：①normalizeSignalGate.fpRetry 归一化（缺省 0/合法域/非法形状）；
 * ②FpRetryTracker 状态机（登记/间隔/预算耗尽/通过清 pending/地平线过期/覆盖/
 * 零 Date.now——时钟注入红线）；③事故现场反证（T203c：bt-v178 0xb6ee…7777
 * 本尊重跑，拒后 +0.8s/+1.9s 三笔 tick 即断流 30s，2s 间隔零重评饿死——
 * 间隔 200ms+重评预算 2 即接住）；④引擎胶水源码锁
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
  ok(tk.spacingMs === 200, 'spacing 缺省 200ms=debounce 节奏（T203c）');
  ok(tk.tickCheck('t', T0 + 100) === null, 'spacing 100ms < 200ms 不评（同块连 tick 不逐笔烧预算）');
  ok(tk.tickCheck('t', T0 + 200) && tk.tickCheck('t', T0 + 200).kind === 'eval', 'spacing 200ms 到点评');
  // 首次重评仍拒
  let r = tk.recordResult('t', false, 'launch_fail_dead', T0 + 200);
  ok(!r.pass && r.remaining === 1 && !r.exhausted && r.attempts.length === 1, '拒 1 次 remaining=1');
  ok(r.attempts[0].reason === 'launch_fail_dead' && r.attempts[0].verdict === 'reject', 'attempt 留痕 reason/verdict');
  ok(tk.tickCheck('t', T0 + 399) === null, '第二间隔内不评（间隔自上次评估起算）');
  ok(tk.tickCheck('t', T0 + 400).kind === 'eval', '上次评估 +200ms 到点');
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

// ── C. 事故现场反证（T203c 案源=bt-v178 0xb6ee…7777 本尊重跑：2s 间隔饿死形状）──
console.log('\n[C] 0xb6ee bt-v178 案 tick 节奏重放（评估器打桩）');
{
  const { FpRetryTracker } = require('../src/trading-engine/core/FpRetryTracker');
  const t0 = 1762300218000; // 首评锚（信号时刻，相对时间打桩）
  const T = (sec) => t0 + sec * 1000;
  // case_ticks 实测（集合 a8414632）：19:10:57 买 → 58 买 → 59 买×2 → 断流 30s
  // → 19:11:29 买。拒后 tick 时刻（秒）：+0.8 / +1.8 / +1.9 / +31.8
  const tickSec = [0.8, 1.8, 1.9, 31.8];
  // 尾 7s 窗买笔数（armLaunchFailDead：N≤2 拒 / N≥3 过——ath 26.8% 龄 71s
  // 两腿在重评时刻恒在域内，只有尾 7s 腿随 tick 翻转）
  const t7nAt = (ts) => (ts < T(0.8) ? 1 : ts < T(1.8) ? 2 : 3);
  const fpVerdict = (ts) => (t7nAt(ts) > 2 ? { pass: true } : { pass: false, reason: 'launch_fail_dead' });

  ok(fpVerdict(t0).pass === false, '首评 尾7s买 N=1 FP28 拒（事故现场）');

  // 反证锁：旧 2s 间隔同节奏零重评饿死（bt-v178 实况 fpRetry attempts:[] expired）
  const old = new FpRetryTracker({ spacingMs: 2000 });
  old.register('b6ee', { legId: 'L', signalId: 's0', budget: 1, nowMs: t0 });
  const oldEvalN = tickSec.filter((s) => { const c = old.tickCheck('b6ee', T(s)); return c && c.kind === 'eval'; }).length;
  ok(oldEvalN === 0 && old.tickCheck('b6ee', T(31.8)).kind === 'expired',
    '旧 2s 间隔：拒后四笔 tick 全不评，+31.8s 即过期=attempts 空（事故重演锁）');

  // 新缺省 200ms + budget 2：+0.8s 重评 N=2 仍拒（烧一次）→ +1.8s 重评 N=3 过
  const tk = new FpRetryTracker();
  tk.register('b6ee', { legId: 'buy_0_1', signalId: 'sig1', budget: 2, nowMs: t0 });
  let st = tk.tickCheck('b6ee', T(0.8));
  ok(st && st.kind === 'eval', '+0.8s tick 到点评（debounce 节奏）');
  let g = fpVerdict(T(0.8));
  let rec = tk.recordResult('b6ee', g.pass, g.pass ? null : g.reason, T(0.8));
  ok(!rec.pass && !rec.exhausted && rec.remaining === 1, '+0.8s 重评 N=2 仍拒（剩 1 次——共 3 评少一次都接不住）');
  st = tk.tickCheck('b6ee', T(1.8));
  ok(st && st.kind === 'eval', '+1.8s tick 到点重评');
  g = fpVerdict(T(1.8));
  rec = tk.recordResult('b6ee', g.pass, g.pass ? null : g.reason, T(1.8));
  ok(rec.pass === true && rec.attempts.length === 2, '+1.8s 重评 N=3 翻转通过（重评 2 次预算恰好用尽）');
  ok(tk.pendingOf('b6ee') === null, '通过后 pending 清（引擎续跑门链）');

  // 预算 1 反证：同节奏 +0.8s 烧完即耗尽，+1.8s 翻转无预算可评=包 fpRetry 必须 ≥2
  const tk1 = new FpRetryTracker();
  tk1.register('b6ee', { legId: 'buy_0_1', signalId: 'sig1', budget: 1, nowMs: t0 });
  tk1.tickCheck('b6ee', T(0.8));
  const r1 = tk1.recordResult('b6ee', false, 'launch_fail_dead', T(0.8));
  ok(r1.exhausted === true && tk1.pendingOf('b6ee') === null && tk1.tickCheck('b6ee', T(1.8)) === null,
    'budget 1 反证：+0.8s 拒即耗尽，+1.8s N=3 无预算可评（包 fpRetry 1→2 立法依据）');
}

// ── E. T203d 重评资格门控（2026-11-22 用户裁定「每一个条件的重试，也是要满足
//      因子表达式条件的基础上进行的」；案源 GWC 0xb712…7777 bt-v179：FP 第 2 次
//      重评锚恰落拉升波首 tick，curVs 31.4% 已破腿门 28.5 线=条件翻假，重评两头
//      皆死路——FP 拒白烧预算 / FP 过被 BP 位置门拦还白烧 cheat/BP Jev）──
console.log('\n[E] T203d 腿条件门控重评资格');
{
  const { FpRetryTracker } = require('../src/trading-engine/core/FpRetryTracker');
  const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');

  // E1 noteSkip 纯逻辑：skips 计数；不动 remaining/lastEvalAt（下一个到点 tick 照常可评）
  const tk = new FpRetryTracker();
  const T0 = 1700000000000;
  tk.register('t', { legId: 'L', signalId: 's1', budget: 2, nowMs: T0 });
  tk.noteSkip('t'); tk.noteSkip('t');
  ok(tk.pendingOf('t').skips === 2 && tk.pendingOf('t').remaining === 2, 'noteSkip×2：skips=2 预算不动');
  ok(tk.pendingOf('t').lastEvalAt === T0, 'noteSkip 不动 lastEvalAt（条件回真下个到点 tick 即评）');
  ok(tk.tickCheck('t', T0 + 200).kind === 'eval', '跳过后 spacing 语义原样（+200ms 到点可评）');
  tk.noteSkip('missing'); // 无 pending 票 no-op 不抛
  ok(true, 'noteSkip 无 pending no-op');

  // E2 事故现场反证：0xb712 GWC bt-v179 真时间线重放（真 ConditionEvaluator+真
  // tracker；FP verdict 打桩=首评/重评恒拒 act_low——本案 FP 层确恒拒，焦点在
  // 预算是否被条件翻假时刻白烧）。腿条件=ladder leg0 同形关键三腿；factors=
  // 各时刻 FA 重放实测值（tmp-b712-fa-replay.cjs）。
  const cond = 'tradeCount >= 6 AND currentVsLaunchPct <= 28.5 AND actTotalBnb >= 0.1';
  const ce = new ConditionEvaluator();
  // [相对秒, factors, 事件] —— 07:54:35.2 触发；36.0 重评#1（价格未动条件仍真）；
  // 48.0 波首 tick（curVs 31.4% ∧ actTotalBnb 0.0985 双翻假）；49.2 全波落地
  // （curVs 57.9%）；55.0 闪卖（curVs 55.0%）；23:55:18=+42.8s 超地平线
  const timeline = [
    [0.0, { tradeCount: 37, currentVsLaunchPct: 26.33, actTotalBnb: 0.1504 }, 'fire'],
    [0.8, { tradeCount: 37, currentVsLaunchPct: 26.33, actTotalBnb: 0.1504 }, 'tick'],
    [12.8, { tradeCount: 40, currentVsLaunchPct: 31.4, actTotalBnb: 0.0985 }, 'tick'],
    [13.2, { tradeCount: 48, currentVsLaunchPct: 57.89, actTotalBnb: 0.5836 }, 'tick'],
    [19.8, { tradeCount: 49, currentVsLaunchPct: 55.04, actTotalBnb: 0.6321 }, 'tick'],
    [42.8, { tradeCount: 51, currentVsLaunchPct: 40.28, actTotalBnb: 0.2594 }, 'tick'],
  ];
  const fpAlwaysReject = () => ({ pass: false, reason: 'act_low' });

  // 门控版（T203d）：到点先复评腿条件，翻假跳过不烧预算
  {
    const tkx = new FpRetryTracker();
    tkx.register('b712', { legId: 'buy_0_1', signalId: 'sig', budget: 2, nowMs: T0, strategyName: 'P1·首买' });
    // 首评拒（登记即首评）：fire 时刻条件真
    ok(ce.evaluate(cond, timeline[0][1]) === true, 'fire 时刻腿条件真（curVs 26.33 域内）——触发合法');
    tkx.recordResult('b712', false, 'act_low', T0 + 800); // +0.8s 重评#1（条件仍真→评 FP 拒）
    let expired = null, skips = 0, attempts = 1;
    for (const [sec, factors] of timeline.slice(2)) {
      const st = tkx.tickCheck('b712', T0 + sec * 1000);
      if (!st) continue;
      if (st.kind === 'expired') { expired = st; tkx.clear('b712'); break; } // 引擎侧过期后 clear（镜像 __fpRetryTickInner）
      // T203d 门控：腿条件复评
      if (ce.evaluate(cond, factors) === false) { tkx.noteSkip('b712'); skips++; continue; }
      const g = fpAlwaysReject();
      const rec = tkx.recordResult('b712', g.pass, g.reason, T0 + sec * 1000);
      attempts++;
      if (rec.exhausted) break;
    }
    const p = tkx.pendingOf('b712');
    ok(expired && expired.kind === 'expired' && p === null, '门控版：30s 地平线过期终态（pending 清）');
    ok(expired.attempts.length === 1 && attempts === 1, '门控版：attempts 恒 1（48.0/49.2/55.0 三次条件翻假全跳过——预算剩 1 未白烧）');
    ok(skips === 3, `门控版：skips=3（翻假时刻 48.0/49.2/55.0 全跳过，实际=${skips}）`);

    // 对照（无门控=T203c 现行形状）：48.0 即烧最后一发 → 耗尽终态（bt-v179 实况）
    const tkOld = new FpRetryTracker();
    tkOld.register('b712', { legId: 'buy_0_1', signalId: 'sig', budget: 2, nowMs: T0 });
    tkOld.recordResult('b712', false, 'act_low', T0 + 800);
    let exhaustedAt = null;
    for (const [sec] of timeline.slice(2)) {
      const st = tkOld.tickCheck('b712', T0 + sec * 1000);
      if (!st) continue;
      if (st.kind === 'eval') {
        const rec = tkOld.recordResult('b712', false, 'act_low', T0 + sec * 1000);
        if (rec.exhausted) { exhaustedAt = sec; break; }
      }
    }
    ok(exhaustedAt === 12.8, `对照无门控：48.0（+12.8s）白烧最后一发即耗尽（bt-v179 实况重演，实际=${exhaustedAt}）`);
  }

  // E3 引擎胶水源码锁：门控调用点在 _factorGateEvaluate 之前 + noteSkip/skipped 落痕在场
  const abs = fs.readFileSync(path.join(__dirname, '../src/trading-engine/core/AbstractTradingEngine.js'), 'utf8');
  const trk = fs.readFileSync(path.join(__dirname, '../src/trading-engine/core/FpRetryTracker.js'), 'utf8');
  const innerIdx = abs.indexOf('async __fpRetryTickInner(');
  const condIdx = abs.indexOf('_fpRetryLegConditionPasses(strategy, factors, tokenAddress) === false', innerIdx);
  const gateIdx = abs.indexOf('await this._factorGateEvaluate(tokenAddress', innerIdx);
  ok(innerIdx > 0 && condIdx > innerIdx && gateIdx > condIdx,
    '源码锁：条件门控调用点在 __fpRetryTickInner 内、_factorGateEvaluate 之前（先资格后重评）');
  ok(abs.includes('_fpRetryLegConditionPasses(strategy, factors, tokenAddress)'), '源码锁：门控 helper 在场');
  ok(abs.includes('tr.noteSkip(tokenAddress)'), '源码锁：翻假分支调 noteSkip');
  ok(abs.includes('{ skipped: p.skips }'), '源码锁：metadata.fpRetry 落 skipped 计数（过期/拒两条留痕路径）');
  ok(trk.includes('noteSkip(token)'), 'tracker：noteSkip 在场');
  ok(!/Date\.now/.test(trk.split('noteSkip')[1] || ''), 'noteSkip 零 Date.now（时钟注入红线不变）');
}
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
  // D5b T203b 作用域锁（bt-v166 首跑事故：块内 const _fp4T0 在块外慢分解段
  // 引用=正常路径全链放行也 ReferenceError→成交前静默炸——「块内 const 块外
  // 恒不可见」与块是否执行无关）：_fp4T0/_fp4Dt 必须 let 声明在 resume 块外
  ok(/let _fp4T0 = 0, _fp4Dt = 0;\s*\n\s*if \(!opts\.resume\) \{/.test(bt),
    '回测：_fp4T0/_fp4Dt 声明在 resume 块外（T203b 作用域修复锁）');
  ok(!/if \(!opts\.resume\) \{[\s\S]{0,600}?const _fp4T0/.test(bt),
    '回测：resume 块内无 const _fp4T0（防撕裂回潮）');
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
