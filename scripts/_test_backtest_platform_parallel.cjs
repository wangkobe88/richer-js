#!/usr/bin/env node
// P14b 双平台装载并行单测（2026-10-13 perf14 装载画像：fourmeme 64s + flap 83s
// 串行 = ticks 拉取窗 166s，两平台缓存文件/查询全独立）。_loadRawTickRows 两条
// 路径（缓存 getOrFetch / 直拉 _fetchPlatformTicksRows）双平台 Promise.all 并行：
// 行序由 _loadWssTicks 全局链上真序排序兜底（order-independent），失败语义保持
// fail-loud（一平台 reject 整体 reject）。护栏口径：priorRowCount 并行后每平台
// 独立起算（恒 0），上限实际放宽 ×平台数——护栏防「拉错集合」意外非正确性机制。
// 零 DB 零网络：Object.create(prototype) 绕 constructor（P5 先例）+ fake
// _tickCache/_fetchPlatformTicksRows 挂起门。用法：node scripts/_test_backtest_platform_parallel.cjs
'use strict';

const fs = require('fs');
const path = require('path');
const { BacktestEngine } = require('../src/trading-engine/implementations/BacktestEngine');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}
const eq = (name, v, expected) => check(name, v, expected);

let unhandled = 0;
process.on('unhandledRejection', (reason) => {
  unhandled++;
  console.error('  [unhandledRejection]', reason && reason.message);
});

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };

/** 受控挂起门 */
function gate() {
  let resolve, reject;
  const p = new Promise((res, rej) => { resolve = res; reject = rej; });
  p.catch(() => {});
  return { promise: p, finish: (v) => resolve(v), fail: (e) => reject(e) };
}

function mkEngine(platforms, backtestCfg = {}) {
  const e = Object.create(BacktestEngine.prototype);
  const events = [];
  e._experimentId = 'test-p14b';
  e.logger = {
    info: (id, tag, msg) => events.push(['log', tag, msg]),
    warn: (id, tag, msg) => events.push(['warn', tag, msg]),
    error: (id, tag, msg) => events.push(['error', tag, msg]),
  };
  e._platforms = platforms;
  e._sourceExperimentId = 'exp-src';
  e._experiment = { config: { backtest: { sourceExperimentId: 'exp-src', ...backtestCfg } } };
  e.metrics = { processedDataPoints: 0 };
  return { e, events };
}

const ROWS_FOUR = [
  { id: 1, token_address: '0xA', platform: 'fourmeme' },
  { id: 3, token_address: '0xB', platform: 'fourmeme' },
];
const ROWS_FLAP = [
  { id: 2, token_address: '0xC', platform: 'flap' },
  { id: 4, token_address: '0xD', platform: 'flap' },
  { id: 5, token_address: '0xE', platform: 'flap' },
];

async function main() {
  // ── A. 缓存路径：fourmeme getOrFetch 挂起时 flap 已发起（并行证明）──
  console.log('A. 缓存路径双平台并行');
  {
    const { e } = mkEngine(['fourmeme', 'flap']);
    const started = [];
    const fmGate = gate();
    e._tickCache = {
      getOrFetch: async (opts) => {
        started.push(opts.platform);
        if (opts.platform === 'fourmeme') {
          const rows = await fmGate.promise;
          return { rows, source: 'miss' };
        }
        return { rows: ROWS_FLAP, source: 'miss' };
      },
    };
    const p = e._loadRawTickRows({ __fake: 'sb' }, ['0xA', '0xB', '0xC', '0xD', '0xE']);
    await flush();
    eq('A1 fourmeme 挂起时两平台 getOrFetch 均已发起', started.sort(), ['flap', 'fourmeme']);
    fmGate.finish(ROWS_FOUR);
    const raw = await p;
    check('A2 合并行数 = 两平台之和', raw.length, 5);
    // 合并序 = _platforms 序（fourmeme 块在前）；行序正确性由 _loadWssTicks 全局排序兜底（J 节源码口径）
    eq('A3 平台块序 = _platforms 序', [...new Set(raw.map(r => r.platform))], ['fourmeme', 'flap']);
    // miss 走 fetchRows 已计（fake getOrFetch 未调 fetchRows），fresh 才补计——E 节覆盖
    check('A4 miss 不在此补计 processedDataPoints', e.metrics.processedDataPoints, 0);
  }

  // ── B. 直拉路径：cacheEnabled=false，fourmeme fetch 挂起时 flap 已发起 ──
  console.log('B. 直拉路径双平台并行');
  {
    const { e } = mkEngine(['fourmeme', 'flap'], { cacheEnabled: false });
    const calls = [];
    const fmGate = gate();
    e._fetchPlatformTicksRows = async (sb, addrs, pf, afterId, prior) => {
      calls.push([pf, afterId, prior]);
      if (pf === 'fourmeme') return fmGate.promise;
      return ROWS_FLAP;
    };
    const p = e._loadRawTickRows({ __fake: 'sb' }, ['0xA', '0xB', '0xC', '0xD', '0xE']);
    await flush();
    eq('B1 fourmeme 挂起时两平台 fetch 均已发起', calls.map(c => c[0]).sort(), ['flap', 'fourmeme']);
    eq('B2 直拉路径 afterId 恒 0（MISS 形状）', calls.map(c => c[1]), [0, 0]);
    eq('B3 直拉路径 priorRowCount 恒 0（并行后每平台独立起算）', calls.map(c => c[2]), [0, 0]);
    fmGate.finish(ROWS_FOUR);
    const raw = await p;
    check('B4 合并行数 = 两平台之和', raw.length, 5);
  }

  // ── C. 单平台（fourmeme-only 实验形状）退化为单飞零变化 ──
  console.log('C. 单平台退化');
  {
    const { e } = mkEngine(['fourmeme']);
    let calls = 0;
    e._tickCache = {
      getOrFetch: async () => { calls++; return { rows: ROWS_FOUR, source: 'miss' }; },
    };
    const raw = await e._loadRawTickRows({}, ['0xA', '0xB']);
    check('C1 单平台一次 getOrFetch', calls, 1);
    check('C2 行数不增', raw.length, 2);
  }

  // ── D. 失败语义：一平台 reject → 整体 reject（fail-loud 对齐串行版）──
  console.log('D. 失败语义');
  {
    const { e } = mkEngine(['fourmeme', 'flap']);
    e._tickCache = {
      getOrFetch: async (opts) => {
        if (opts.platform === 'flap') throw new Error('flap cache down');
        return { rows: ROWS_FOUR, source: 'miss' };
      },
    };
    let caught = null;
    await e._loadRawTickRows({}, ['0xA']).catch(err => caught = err);
    check('D1 缓存路径一平台失败整体 reject', caught && caught.message.includes('flap cache down'), true);
  }
  {
    const { e } = mkEngine(['fourmeme', 'flap'], { cacheEnabled: false });
    e._fetchPlatformTicksRows = async (sb, addrs, pf) => {
      if (pf === 'flap') throw new Error('flap fetch down');
      return ROWS_FOUR;
    };
    let caught = null;
    await e._loadRawTickRows({}, ['0xA']).catch(err => caught = err);
    check('D2 直拉路径一平台失败整体 reject', caught && caught.message.includes('flap fetch down'), true);
  }

  // ── E. FRESH 计数补计：纯读文件路径 per-platform 累计（miss/stale 不在此计防双计）──
  console.log('E. FRESH 计数');
  {
    const { e } = mkEngine(['fourmeme', 'flap']);
    e._tickCache = {
      getOrFetch: async (opts) => ({
        rows: opts.platform === 'fourmeme' ? ROWS_FOUR : ROWS_FLAP,
        source: 'fresh',
      }),
    };
    await e._loadRawTickRows({}, ['0xA', '0xC']);
    check('E1 双平台 fresh 行数全额补计（2+3）', e.metrics.processedDataPoints, 5);
  }
  {
    const { e } = mkEngine(['fourmeme', 'flap']);
    e._tickCache = {
      getOrFetch: async (opts) => ({
        rows: opts.platform === 'fourmeme' ? ROWS_FOUR : ROWS_FLAP,
        source: 'stale',
      }),
    };
    await e._loadRawTickRows({}, ['0xA', '0xC']);
    check('E2 stale 不补计（fetchRows 内已计防双计）', e.metrics.processedDataPoints, 0);
  }

  // ── F. 源码口径（红线 13：并行形状 + 禁 spread 锁定）──
  console.log('F. 源码口径');
  {
    const src = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/BacktestEngine.js'), 'utf8');
    const iMethod = src.indexOf('async _loadRawTickRows(');
    const iNext = src.indexOf('async _fetchPlatformTicksRows(', iMethod);
    const body = src.slice(iMethod, iNext);
    check('F0 锚点齐全', iMethod > 0 && iNext > iMethod, true);
    check('F1 直拉路径 Promise.all(this._platforms.map(...))',
      /const perPlatform = await Promise\.all\(this\._platforms\.map\(platform =>\s*\n\s*this\._fetchPlatformTicksRows\(supabase, addresses, platform, 0, 0\)\)\)/.test(body), true);
    check('F2 缓存路径 Promise.all(this._platforms.map(async ...))',
      /const perPlatform = await Promise\.all\(this\._platforms\.map\(async \(platform\) =>/.test(body), true);
    check('F3 两路径均无 for-platform 串行循环残留', /for \(const platform of this\._platforms\)/.test(body), false);
    check('F4 双 push 循环合并（禁 spread，大数组溢出防线）',
      (body.match(/for \(const rows of perPlatform\) for \(const r of rows\) raw\.push\(r\);/g) || []).length, 2);
    check('F5 缓存路径 fetchRows 闭包 priorRowCount=0（每平台独立起算注释口径）',
      /fetchRows: \(afterId\) => this\._fetchPlatformTicksRows\(supabase, addresses, platform, afterId, 0\)/.test(body), true);
  }

  eq('G1 全程零 unhandled rejection', unhandled, 0);
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
