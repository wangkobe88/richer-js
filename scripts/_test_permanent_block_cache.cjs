#!/usr/bin/env node
/**
 * _evaluatePermanentBlock 编译缓存单测（批次 4c，2026-10-15）
 *
 * 买腿每 fire 一次 new Function 编译永久阻断条件（hg55 门）——同条件+同键集
 * 重复编译纯浪费。模块级 Map 缓存（两引擎各自一份，复制纪律不抽公共）：
 * key=`${jsExpr}\0${keys.join(',')}`（形参列表决定 fn，keys 必须进 key），
 * 命中直调。语义零变化：对拍参考实现=旧内联 new Function。
 *
 * 零 DB 零网络：Object.create(prototype) 桩引擎直调方法。
 * 用法：node scripts/_test_permanent_block_cache.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { FourMemeWssTradingEngine } = require('../src/trading-engine/implementations/FourMemeWssTradingEngine.js');
const { BacktestEngine } = require('../src/trading-engine/implementations/BacktestEngine.js');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}

/** 旧实现参考（改造前逐字内联形状） */
function refImpl(preBuyCheckResult, condition) {
  if (!condition || String(condition).trim() === '') return { blocked: false, reason: '' };
  try {
    const context = {};
    for (const [key, value] of Object.entries(preBuyCheckResult)) {
      if (typeof value !== 'object' && typeof value !== 'function') context[key] = value;
    }
    const jsExpr = String(condition)
      .replace(/\bAND\b/gi, '&&').replace(/\bOR\b/gi, '||').replace(/\bNOT\b/gi, '!');
    const keys = Object.keys(context);
    const values = Object.values(context);
    const fn = new Function(...keys, `return ${jsExpr};`);
    const blocked = fn(...values);
    return blocked ? { blocked: true, reason: `永久阻断: ${condition}` } : { blocked: false, reason: '' };
  } catch (error) {
    return { blocked: false, reason: '' };
  }
}

function mkEngine(Cls) {
  const eng = Object.create(Cls.prototype);
  eng.logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  eng._experimentId = 't';
  return eng;
}

// 随机形状语料：标量各类型/对象与函数被剔除/null/undefined/嵌套
const SHAPES = [
  { canBuy: true, earlyTradesTop1BuySharePct: 80, earlyTradesRouterPct: 30, n: 5 },
  { canBuy: false, earlyTradesTop1BuySharePct: 12.5, flag: 0, s: 'x' },
  { a: null, b: undefined, c: -3, d: Number.MAX_SAFE_INTEGER },
  { top1: 100, obj: { nested: 1 }, fn: () => {}, plain: 0 },
  { canBuy: 1, earlyTradesSniperHoldingPct: 49.99, extra: true },
];
const CONDITIONS = [
  'earlyTradesTop1BuySharePct >= 60',
  'earlyTradesTop1BuySharePct >= 60 AND earlyTradesRouterPct < 50',
  'top1 >= 50 OR n > 3',
  'NOT canBuy',
  'not (canBuy) and n >= 5',        // 小写语法糖
  'a == null && c < 0',
  'top1 > 50 OR (n > 10 AND s == "y")',
  'earlyTradesSniperHoldingPct < 50 AND extra',
];

console.log('A. 两引擎 × 全形状 × 全条件：与旧内联 new Function 参考逐例全等（含 reason）');
{
  let cases = 0, mismatches = [];
  for (const Cls of [FourMemeWssTradingEngine, BacktestEngine]) {
    const eng = mkEngine(Cls);
    for (let round = 0; round < 3; round++) { // 多轮：命中缓存路径与参考仍全等
      for (const shape of SHAPES) {
        for (const cond of CONDITIONS) {
          const got = eng._evaluatePermanentBlock(shape, cond);
          const want = refImpl(shape, cond);
          cases++;
          if (JSON.stringify(got) !== JSON.stringify(want)) mismatches.push([Cls.name, cond, JSON.stringify(shape), got, want]);
        }
      }
    }
    // 空条件/缺省形状
    check(`A1 ${Cls.name} 空条件→不拦`, eng._evaluatePermanentBlock(SHAPES[0], ''), { blocked: false, reason: '' });
    check(`A2 ${Cls.name} null 条件→不拦`, eng._evaluatePermanentBlock(SHAPES[0], null), { blocked: false, reason: '' });
    check(`A3 ${Cls.name} 纯空白→不拦`, eng._evaluatePermanentBlock(SHAPES[0], '   '), { blocked: false, reason: '' });
  }
  check('A4 240 例逐例全等（3 轮×5 形状×8 条件×2 引擎）', [cases, mismatches.length], [240, 0]);
  if (mismatches.length) console.log('   首个失配:', JSON.stringify(mismatches[0]));
}

console.log('B. fail-open 不变（语法错/运行时错，含缓存命中后的重复调用）');
{
  for (const Cls of [FourMemeWssTradingEngine, BacktestEngine]) {
    const eng = mkEngine(Cls);
    const shape = { canBuy: true, x: 1 };
    // B1 语法错（编译阶段 throw，不进缓存）
    check(`B1 ${Cls.name} 语法错 fail-open`,
      [eng._evaluatePermanentBlock(shape, '(((').blocked, eng._evaluatePermanentBlock(shape, '(((').blocked], [false, false]);
    // B2 运行时错（编译成功进缓存，每次调用 throw→catch fail-open）
    check(`B2 ${Cls.name} 运行时错 fail-open（含重复命中缓存）`,
      [eng._evaluatePermanentBlock(shape, 'noSuchKey > 1').blocked,
       eng._evaluatePermanentBlock(shape, 'noSuchKey > 1').blocked,
       eng._evaluatePermanentBlock(shape, 'noSuchKey > 1').blocked], [false, false, false]);
    // B3 同条件不同键集：独立正确（keys 进 cacheKey 反证——键集 B 缺 x 时 undefined 比较）
    const shapeB = { canBuy: true };
    check(`B3 ${Cls.name} 不同键集独立条目`,
      [eng._evaluatePermanentBlock(shapeB, 'x > 0').blocked], [refImpl(shapeB, 'x > 0').blocked]);
  }
}

console.log('C. 源码口径（防回流；两引擎对称）');
{
  for (const [name, p] of [
    ['FourMeme', path.join(__dirname, '../src/trading-engine/implementations/FourMemeWssTradingEngine.js')],
    ['Backtest', path.join(__dirname, '../src/trading-engine/implementations/BacktestEngine.js')],
  ]) {
    const src = fs.readFileSync(p, 'utf8');
    const m = src.match(/_evaluatePermanentBlock\(preBuyCheckResult, condition\) \{[\s\S]*?\n  \}/);
    check(`C1 ${name} 方法存在`, m !== null, true);
    check(`C2 ${name} 模块级缓存 Map`,
      /const _permBlockFnCache = new Map\(\);/.test(src), true);
    if (m) {
      check(`C3 ${name} cacheKey=jsExpr\\0keys（形参列表进 key）`,
        /const cacheKey = `\$\{jsExpr\}\\0\$\{keys\.join\(','\)\}`;/.test(m[0]), true);
      check(`C4 ${name} new Function 只在 miss 分支（命中免编译）`,
        [/let fn = _permBlockFnCache\.get\(cacheKey\);/.test(m[0]),
         /if \(!fn\) \{\s*\n\s*fn = new Function\(/.test(m[0]),
         (m[0].match(/new Function\(/g) || []).length === 1].every(Boolean), true);
      check(`C5 ${name} FIFO 防呆上限`,
        /_permBlockFnCache\.size >= 1000/.test(m[0]), true);
      check(`C6 ${name} catch fail-open 原样（error 日志+返回不拦）`,
        /return \{ blocked: false, reason: '' \};\s*\n\s*\}/.test(m[0]), true);
    }
  }
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
