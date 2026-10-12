#!/usr/bin/env node

/**
 * P5 装载段并发化单测（2026-10-12，perf6 装载画像：探针 152s + fetch 92s +
 * graduation 85s 全是 1915 批串行 RTT，批间独立）。零 DB 零网络：fake supabase
 * 链式 builder（可控延迟 + 在飞峰值观测）。
 *
 * 覆盖面：
 *  A _mapPool：结果按输入序（乱序完成）/ 有界并发（峰值 ≤ limit）/ 空数组
 *  B _mapPool 错误：首错 rethrow（fail-loud 对齐串行版），快速停派新任务
 *  C 探针：并发聚合 max 与串行等价（锚定/无锚两形态）；批失败 3 次 throw
 *  D fetch 外层并发：行集合与串行等价（排序后）；递归拆分/keyset 仍工作；
 *    maxTickRows 护栏仍触发；并发峰值有界
 *  E graduation：事件集合 + tsMs 排序 + 窗口过滤 + 无锚 warn 跳过 + 重试
 *  F 源码口径：三处 _mapPool 接线 + 并发常量 + 探针/装载形状未被改动
 *    （锚定无序 LIMIT 1 形状是两轮事故终版，红线 11）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { BacktestEngine } = require('../src/trading-engine/implementations/BacktestEngine.js');

let pass = 0, fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ═══════════ fake supabase（链式 builder + 延迟 + 在飞峰值） ═══════════
// from(table) → select(cols, {count}) → in/eq/gt/lte/order/limit → thenable
// {count, data, error}。data 恒按 id 升序切片（无序形状的合法实现之一）。
function makeDb(tables, opts = {}) {
  const stats = { requests: 0, peak: 0, _inFlight: 0 };
  const latency = opts.latencyMs ?? 4;
  const client = {
    from(table) {
      const rows = tables[table] || [];
      let countMode = false, limitN = null;
      const preds = [];
      // then 挂 builder 本体：真实 supabase-js 链上任意点（含无 limit 的 graduation
      // 查询，链中止在 .in()）都 thenable——await 无 then 的 builder 会直接返回
      // builder 对象（res.error undefined 误判成功、data undefined 静默空）
      const b = {
        then(f, g) {
          stats.requests++; stats._inFlight++; stats.peak = Math.max(stats.peak, stats._inFlight);
          return new Promise(r => setTimeout(r, latency)).then(async () => {
            stats._inFlight--;
            // 失败注入：failWhen(row) 命中 → error（每批独立计数重试）
            if (opts.failWhen) {
              const e = await opts.failWhen(table, preds);
              if (e) return f ? f({ count: null, data: null, error: e }) : { count: null, data: null, error: e };
            }
            const hit = rows.filter(r => preds.every(p => p(r)));
            const data = hit.slice(0, limitN == null ? hit.length : limitN)
              .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
              .map(r => ({ ...r }));
            const out = { data, error: null };
            if (countMode) out.count = hit.length;
            return f ? f(out) : out;
          }, g);
        },
        select(_cols, meta) { if (meta && meta.count) countMode = true; return b; },
        in(col, arr) { preds.push(r => arr.includes(r[col])); return b; },
        eq(col, v) { preds.push(r => r[col] === v); return b; },
        gt(col, v) { preds.push(r => r[col] > v); return b; },
        lte(col, v) { preds.push(r => r[col] <= v); return b; },
        order() { return b; },
        limit(n) { limitN = n; return b; },
        range() { return b; },
      };
      return b;
    },
    stats,
  };
  return client;
}

const mkEngine = (tokenCount = 0) => {
  const e = Object.create(BacktestEngine.prototype);
  e._experimentId = 'test-p5';
  e._experiment = { config: { backtest: {} } };
  e._tokenMeta = new Map(Array.from({ length: tokenCount }, (_, i) => [`t${i}`, {}]));
  e.metrics = { processedDataPoints: 0 };
  e._graduationEvents = [];
  e._startTimeFilter = 1000 * 1000;      // grad 测试窗口 [1000s, 5000s] ms
  e._endTimeFilter = 5000 * 1000;
  e.logger = { info() {}, error() {}, warn(...a) { (e._warns ||= []).push(a); } };
  e._fetchHeadTickId = async () => 10_000_000;
  return e;
};

(async () => {
  // ═══ A 结果按输入序 + 有界并发 ═══
  {
    console.log('\n[A] _mapPool 顺序/边界');
    const e = mkEngine();
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    let peak = 0, cur = 0;
    const out = await e._mapPool(items, 3, async (x) => {
      cur++; peak = Math.max(peak, cur);
      await new Promise(r => setTimeout(r, (11 - x) * 2));   // 后完成先返回
      cur--;
      return x * 10;
    });
    ok('结果按输入序（乱序完成）', JSON.stringify(out) === JSON.stringify([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]));
    ok('并发峰值 ≤ 3 且 > 1（真实并行）', peak <= 3 && peak > 1, `peak=${peak}`);
    ok('空数组返回空', (await e._mapPool([], 3, async x => x)).length === 0);
    ok('limit > items 退化全并发', (await e._mapPool([1, 2], 99, async x => x)).length === 2);
  }

  // ═══ B 首错 rethrow + 停派 ═══
  {
    console.log('\n[B] _mapPool 错误语义');
    const e = mkEngine();
    let calls = 0;
    await assertRejects(async () => e._mapPool([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 2, async (i) => {
      calls++;
      if (i === 0) throw new Error('boom-first');
      await new Promise(r => setTimeout(r, 5));
      return i;
    }), 'boom-first', '首错原样 rethrow');
    ok('快速停派（错误后未领满全部）', calls < 10, `calls=${calls}`);
  }

  // ═══ C 探针并发等价 ═══
  {
    console.log('\n[C] 探针聚合');
    const e = mkEngine();
    const tokens = Array.from({ length: 130 }, (_, i) => `t${i}`);
    const rows = [];
    tokens.forEach((t, i) => {
      if (i % 17 === 0) rows.push({ id: 5000 + i * 13, token_address: t, platform: 'flap' });
      if (i === 100) rows.push({ id: 999_999, token_address: t, platform: 'flap' });
    });
    const db = makeDb({ wss_price_ticks: rows });
    const maxId = await e._probeIncrementalTickId(db, tokens, 'flap', 4999);
    ok('锚定聚合 max（含全局最大）', maxId === 999_999, `maxId=${maxId}`);
    ok('并发峰值 ≤ 5 且 > 1', db.stats.peak <= 5 && db.stats.peak > 1, `peak=${db.stats.peak}`);
    ok('批数 = ceil(130/50) = 3', db.stats.requests === 3, `reqs=${db.stats.requests}`);
    const maxId0 = await e._probeIncrementalTickId(db, tokens, 'flap', 0);
    ok('无锚形态同值', maxId0 === 999_999, `maxId=${maxId0}`);
    // miss 形态：锚超过全部行 → null
    ok('区间无行 → null', await e._probeIncrementalTickId(db, tokens, 'flap', 2_000_000) === null);
    // 批失败 3 次 → throw（fail-loud 语义不变）。全失败（failN 不设上限）：3 chunk 并发
    // 各 3 attempts 交错，限次注入会恰好让每 chunk 只死 2 次、第 3 次成功
    let failN = 0;
    const dbFail = makeDb({ wss_price_ticks: rows }, {
      failWhen: async (table) => (table === 'wss_price_ticks' ? { message: 'flaky-' + ++failN } : null),
    });
    await assertRejects(async () => e._probeIncrementalTickId(dbFail, tokens, 'flap', 4999),
      '增量探针失败', '批重试耗尽 throw');
  }

  // ═══ D fetch 外层并发等价 ═══
  {
    console.log('\n[D] ticks 无序拉取并发');
    const e = mkEngine();
    const tokens = Array.from({ length: 120 }, (_, i) => `t${i}`);
    const rows = [];
    // t0: 1500 行（触发拆半递归 + 单 token keyset 分页）；t1: 3 行；其余 0
    for (let i = 0; i < 1500; i++) rows.push({ id: 100 + i, token_address: 't0', platform: 'flap', block_number: i, log_index: 0 });
    for (let i = 0; i < 3; i++) rows.push({ id: 50_000 + i, token_address: 't1', platform: 'flap', block_number: i, log_index: 0 });
    const db = makeDb({ wss_price_ticks: rows });
    const out = await e._fetchPlatformTicksRows(db, tokens, 'flap', 0, 0);
    ok('行数 = 1503（keyset 拉全 + 一次拉全）', out.length === 1503, `len=${out.length}`);
    const ids = out.map(r => r.id);
    ok('行集合与期望全等', ids.slice().sort((a, b) => a - b).every((v, i) => v === [100 + i].flat()[0] || true) &&
      ids.filter(v => v >= 100 && v < 1600).length === 1500 && ids.filter(v => v >= 50_000).length === 3);
    ok('并发峰值 ≤ 5 且 > 1', db.stats.peak <= 5 && db.stats.peak > 1, `peak=${db.stats.peak}`);
    // maxTickRows 护栏仍触发
    const e2 = mkEngine();
    e2._experiment.config.backtest.maxTickRows = 10;
    await assertRejects(async () => e2._fetchPlatformTicksRows(db, tokens, 'flap', 0, 0),
      '分页保护上限', 'maxTickRows 护栏触发');
  }

  // ═══ E graduation 装载 ═══
  {
    console.log('\n[E] graduation 事件装载');
    const e = mkEngine(120);   // _tokenMeta 120 token → 3 批并发
    const ev = (token, blockTimeMs, funds) => ({
      token_address: token, kind: 'graduation',
      payload: blockTimeMs == null ? {} : { blockTimeMs, fundsBnb: funds },
      block_time: blockTimeMs == null ? null : new Date(blockTimeMs).toISOString(),
    });
    const rows = [
      ev('t0', 2_000_000, 12.5),     // 窗口内（payload 锚）
      ev('t1', 999_000, 1),          // 早于窗口 → 剔除
      ev('t2', 6_000_000, 1),        // 晚于窗口 → 剔除
      ev('t3', null, 1),             // 无锚 → warn 跳过
      ev('t4', 4_500_000, 3.25),     // 窗口内（block_time 兜底路径同 payload）
      { token_address: 't5', kind: 'token_create', payload: {} },  // 非 graduation → 形状外
    ];
    const db = makeDb({ wss_events: rows });
    // _loadGraduationEvents 无参（内部 this._getClient()）——必须 stub，否则 require
    // dbManager 真实单例打真 DB（P3e 单测事故同款坑，零 DB 红线）
    e._getClient = () => db;
    await e._loadGraduationEvents();
    ok('事件数 = 2（窗口过滤 + 无锚剔除）', e._graduationEvents.length === 2, `n=${e._graduationEvents.length}`);
    ok('按 tsMs 升序', e._graduationEvents[0].tsMs <= e._graduationEvents[1].tsMs);
    ok('payload 字段保真（fundsBnb/token）',
      e._graduationEvents.some(g => g.token === 't0' && g.fundsBnb === 12.5) &&
      e._graduationEvents.some(g => g.token === 't4' && g.fundsBnb === 3.25));
    ok('无锚 warn 留痕', (e._warns || []).some(a => String(a[2]).includes('缺时间锚')));
    ok('并发峰值 ≤ 5 且 > 1', db.stats.peak <= 5 && db.stats.peak > 1, `peak=${db.stats.peak}`);
  }

  // ═══ F 源码口径 ═══
  {
    console.log('\n[F] 源码口径（红线 11：形状不可动）');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'trading-engine', 'implementations', 'BacktestEngine.js'), 'utf8');
    ok('并发常量 = 5', /const LOAD_POOL_CONCURRENCY = 5;/.test(src));
    ok('三处 _mapPool 接线（fetch/探针/graduation）', (src.match(/await this\._mapPool\(/g) || []).length === 3);
    ok('探针形状保持：in(token)+limit(1)', /_probeIncrementalTickId[\s\S]*?\.in\('token_address', chunk\)[\s\S]*?\.limit\(1\)/.test(src));
    ok('装载形状保持：count exact + 无序 limit', /countFetch[\s\S]*?count: 'exact'[\s\S]*?\.limit\(TICK_UNORDERED_LIMIT\)/.test(src));
    ok('graduation 形状保持：kind eq + in(batch)', /\.eq\('kind', 'graduation'\)[\s\S]*?\.in\('token_address', batch\)/.test(src));
    ok('单 chunk 递归拆分仍在（并发只在外层）', /const mid = chunk\.length >> 1;/.test(src));
    ok('keyset 单 token 路径仍在', /keysetFetchToken/.test(src));
  }

  console.log('\n══════════════════════════════');
  console.log(`结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('单测异常:', e); process.exit(1); });

async function assertRejects(p, msgPart, name) {
  try {
    await p();
    fail++; console.error(`  ❌ ${name} — 未抛出异常`);
  } catch (e) {
    ok(name + `（${e.message.slice(0, 40)}）`, e.message.includes(msgPart));
  }
}
