#!/usr/bin/env node
/**
 * vision 预启动穿透链单测（2026-10-13 叙事提速第二批 1B）——零 DB 零网络
 *
 * 链路：实验级 fourmemeWs.visionPrefetch.enabled（flap 配 flapWs 段同键）
 *   → FourMemeWssTradingEngine 构造点 new NarrativeDirectCaller({ analyzeOptions })
 *   → caller._analyzeOptions → _startAnalysis options 展开 → NarrativeAnalyzer.analyze
 *   → 泳道 0 门控（行为级见 _test_narrative_middle_parallel A4/B4）
 *
 * 用户裁定：完整版 + 开关默认关——默认 false 维持 C58「预检拦截票不烧视觉调用」
 * 约束；worker / web routes / 回测不注入 = 全默认零变化；182 实验显式开启观察
 * 24-48h 后再定默认。
 *
 * 节：
 *   A. constructor 行为级：analyzeOptions 存引用 / 缺省空对象
 *   B. _startAnalysis 行为级（覆写实例方法 _getAnalyzer 截获真实 options 组装）：
 *      注入 visionPrefetch:true → options.visionPrefetch===true 且既有键
 *      （enrichSocialByGmgn/skipIntermediateSave/_timing/rowCache）原样保留；
 *      未注入 → 无 visionPrefetch 键（未配置键零影响）
 *   C. 源码口径：引擎构造点缺省段形状（|| {}).enabled === true 严格默认 false）/
 *      引擎单实例（N3 预触发与 fire 共用 caller 自动同享）/ Worker.mjs 与
 *      narrative-engine.json 无此键（C58 防线）/ analyze 解构默认 false /
 *      flap 引擎继承父类构造点（flapWs 段由 _mergedWsConfig 段名机制接管）
 *
 * 用法：node scripts/_test_narrative_vision_prefetch.cjs
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function assert(cond, label, extra) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.error(`  ❌ ${label}${extra ? ` | ${extra}` : ''}`); }
}
function src(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

async function main() {
  const { NarrativeDirectCaller } = require('../src/trading-engine/pre-check/NarrativeDirectCaller.js');

  // ═══ A. constructor 行为级 ═══
  console.log('══ A. constructor（纯内存零副作用）══');
  {
    const injected = { visionPrefetch: true };
    const c1 = new NarrativeDirectCaller({ analyzeOptions: injected });
    assert(c1._analyzeOptions === injected, 'A1 analyzeOptions 存引用（_startAnalysis 原样展开）');
    assert(new NarrativeDirectCaller({})._analyzeOptions && Object.keys(new NarrativeDirectCaller({})._analyzeOptions).length === 0,
      'A2 缺省 = 空对象（不传 = analyze 全默认）');
    assert(new NarrativeDirectCaller()._analyzeOptions && Object.keys(new NarrativeDirectCaller()._analyzeOptions).length === 0,
      'A3 无参构造同缺省');
  }

  // ═══ B. _startAnalysis 行为级（覆写 _getAnalyzer 截获真实 options 组装）═══
  console.log('══ B. _startAnalysis options 组装（实例方法覆写截获）══');
  {
    // 注入 visionPrefetch:true → 展开进 analyze options，既有键不被覆盖
    let captured = null;
    const c = new NarrativeDirectCaller({ analyzeOptions: { visionPrefetch: true } });
    const timingSink = [];
    c._getAnalyzer = async () => ({
      analyze: async (addr, opts) => { captured = { addr, opts }; return { rating: 9 }; },
    });
    await c._startAnalysis('0xABCdef000000000000000000000000000000dEaD', timingSink);
    assert(captured.opts.visionPrefetch === true, 'B1 注入 visionPrefetch → options.visionPrefetch===true',
      JSON.stringify(captured?.opts));
    assert(captured.addr === '0xABCdef000000000000000000000000000000dEaD',
      'B1b analyze 收原始地址（小写归一在 analyze 侧；inflight key 才是小写口径）');
    assert(captured.opts.enrichSocialByGmgn === true && captured.opts.skipIntermediateSave === true,
      'B2 直调语境既有键保留（gmgn 增强+中段 save 跳过不受透传影响）');
    assert(captured.opts._timing === timingSink, 'B3 _timing 引用透传（N1 探针链路不变）');
    assert(!('rowCache' in captured.opts) || captured.opts.rowCache === undefined,
      'B4 未预载 rowCache 无键/undefined（回测预载路径正交）');

    // 未注入 → 无 visionPrefetch 键（未配置键零影响，worker/web/回测零变化）
    let captured2 = null;
    const c2 = new NarrativeDirectCaller({});
    c2._getAnalyzer = async () => ({
      analyze: async (addr, opts) => { captured2 = { addr, opts }; return { rating: 9 }; },
    });
    await c2._startAnalysis('0xabc2', []);
    assert(!('visionPrefetch' in captured2.opts), 'B5 未注入 → options 无 visionPrefetch 键（analyze 默认 false 兜底）');

    // inflight join：并发同地址共享一次 analyze（既有机制不回归）
    let analyzeCalls = 0;
    const c3 = new NarrativeDirectCaller({});
    let release;
    const gate = new Promise(r => { release = r; });
    c3._getAnalyzer = async () => ({
      analyze: async (addr, opts) => { analyzeCalls++; if (analyzeCalls === 1) await gate; return { rating: 9 }; },
    });
    const p1 = c3._startAnalysis('0xjoin', []);
    const p2 = c3._startAnalysis('0xjoin', []);
    await new Promise(r => setTimeout(r, 10));
    release();
    await Promise.all([p1, p2]);
    assert(analyzeCalls === 1, 'B6 inflight 去重不受影响（并发同地址一次 analyze）', String(analyzeCalls));
  }

  // ═══ C. 源码口径（锁防线）═══
  console.log('══ C. 源码口径 ═══');
  {
    const ndc = src('src/trading-engine/pre-check/NarrativeDirectCaller.js');
    assert(ndc.includes('this._analyzeOptions = options.analyzeOptions || {};'),
      'C1 caller 构造存 analyzeOptions（缺省空对象）');
    // 展开位置：在 skipIntermediateSave/_timing 字面量之间（后展开覆盖同键默认）
    const spreadIdx = ndc.indexOf('...this._analyzeOptions,');
    const skipIdx = ndc.indexOf('skipIntermediateSave: true,');
    const timingIdx = ndc.indexOf('_timing: timingSink,');
    assert(spreadIdx > -1 && skipIdx > -1 && spreadIdx > skipIdx && spreadIdx < timingIdx,
      'C2 _startAnalysis options 展开（skipIntermediateSave 后、_timing 前）');

    const eng = src('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
    // C3（C84 2026-10-17 退役反证）：visionPrefetch 注入点已删——引擎源码零残留
    assert(!eng.includes('visionPrefetch'),
      'C3 引擎源码零 visionPrefetch（C84 退役：注入点随 dataPrefetch 机制整体删除）');
    assert((eng.match(/new NarrativeDirectCaller\(/g) || []).length === 1,
      'C4 引擎内 NarrativeDirectCaller 单实例（N3 预触发/触发状态机与 fire 共用一个 caller）');

    const flap = src('src/trading-engine/implementations/FlapWssTradingEngine.js');
    assert(/class FlapWssTradingEngine extends FourMemeWssTradingEngine/.test(flap)
      && !flap.includes('new NarrativeDirectCaller('),
      'C5 flap 引擎继承父类构造点（_mergedWsConfig 段名机制接管，无重复构造）');

    const worker = src('src/narrative/engine/Worker.mjs');
    assert(!worker.includes('visionPrefetch'),
      'C6 Worker.mjs 无此键 = C58 防线（叙事 worker 不开启：预检拦截票不烧视觉调用）');

    const cfg = fs.readFileSync(path.join(ROOT, 'config/narrative-engine.json'), 'utf8');
    assert(!cfg.includes('visionPrefetch'),
      'C7 全局配置无此键（开关只在实验级 fourmemeWs/flapWs 段，182 实验显式开启观察）');

    const na = src('src/narrative/analyzer/NarrativeAnalyzer.mjs');
    // C8（C84 2026-10-17 退役反证）：analyze 解构无 visionPrefetch 键（泳道 0 已删，
    // invalidateAccountCorpus 默认关仍锁定；退役注释里的字样剥除后再判）
    assert(!na.replace(/\/\/[^\n]*/g, '').includes('visionPrefetch')
      && na.includes('skipIntermediateSave = false, invalidateAccountCorpus = false } = options'),
      'C8 analyze 解构无 visionPrefetch（C84 退役）+ invalidateAccountCorpus 默认关形状');
  }

  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}：${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FAIL:', e); process.exit(1); });
