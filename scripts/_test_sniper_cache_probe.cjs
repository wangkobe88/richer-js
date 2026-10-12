#!/usr/bin/env node
// P11 SniperFlagCache 查询探针 + P12 全表预载单测（2026-10-13 perf12 定因：
// sniper 画像查询 52.4s = earlySvc 96.5%，纯碎 RTT 堆积）。P11 计数器
// queryMs/batches/queriedAddrs/failures 经 getPerfStats.sniper 透出；P12
// preloadAll 全表预载后 miss 直判 false（bit 等价于现查空行）。零 DB 零网络：
// mock supabase（in() 单查 + cursor 分页双形状）busy-wait 延迟 + 查询计数。
// 用法：node scripts/_test_sniper_cache_probe.cjs
'use strict';

const fs = require('fs');
const path = require('path');
const { SniperFlagCache } = require('../src/trading-engine/pre-check/sniper-detector');
const { EarlyParticipantCheckService } = require('../src/trading-engine/pre-check/EarlyParticipantCheckService');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}
const eq = (name, v, expected) => check(name, v, expected);

/** mock supabase：profile 行集可控 / in() 单查与 preload cursor 分页两种形状 /
 *  每查询 busy-wait delayMs / failNext（单查）/ failPreloadPage（预载第 N 页失败） */
function mkDb(rows, opts = {}) {
  const state = { queries: 0, preloadPages: 0 };
  state.failNext = false;
  state.failPreloadPage = opts.failPreloadPage || 0;
  const sorted = [...rows].sort((a, b) => (a.address < b.address ? -1 : 1));
  const db = {
    from(table) {
      if (table !== 'wallet_offline_profiles') throw new Error(`意外表: ${table}`);
      return {
        select(cols) {
          if (cols !== 'address, profile') throw new Error(`意外列: ${cols}`);
          const chain = {
            in(field, batch) {
              if (field !== 'address') throw new Error(`意外过滤键: ${field}`);
              return (async () => {
                state.queries++;
                const t0 = Date.now();
                while (Date.now() - t0 < (opts.delayMs || 0)) {} // busy-wait 模拟 RTT
                // 失败也耗一个网络往返后才返回（真实形状：RTT 后才见 error）
                if (state.failNext) { state.failNext = false; return { data: null, error: { message: 'db down' } }; }
                const set = new Set(batch);
                return { data: rows.filter(r => set.has(r.address)), error: null };
              })();
            },
            order(field) {
              if (field !== 'address') throw new Error(`意外排序键: ${field}`);
              return chain;
            },
            limit(n) {
              if (n !== 1000) throw new Error(`意外页大小: ${n}`);
              return chain;
            },
            gt(field, val) {
              if (field !== 'address') throw new Error(`意外 gt 键: ${field}`);
              return (async () => {
                state.preloadPages++;
                if (state.preloadPages === state.failPreloadPage) {
                  return { data: null, error: { message: 'preload page down' } };
                }
                return { data: sorted.filter(r => r.address > val).slice(0, 1000), error: null };
              })();
            },
            // 首页（无 gt）：order+limit 后直接 await 走 thenable
            then(onF, onR) {
              return (async () => {
                state.preloadPages++;
                if (state.preloadPages === state.failPreloadPage) {
                  return { data: null, error: { message: 'preload page down' } };
                }
                return { data: sorted.slice(0, 1000), error: null };
              })().then(onF, onR);
            },
          };
          return chain;
        },
      };
    },
  };
  db._state = state;
  if (opts.failFirst) state.failNext = true;
  return db;
}

const addr = i => `0x${String(i).padStart(40, '0')}`;

async function main() {
  const rows = [
    { address: addr(1), profile: { tokenCount: 150, medianHoldSeconds: 60 } },        // sniper（主判）
    { address: addr(2), profile: { tokenCount: 10 } },                                 // 非 sniper
    { address: addr(3), profile: { tokenCount: 200, medianHoldSeconds: null, buyCount: 50, sellCount: 50 } }, // sniper（补判）
  ];

  // ── A. 首查计数：1 批 / 2 址 / queryMs 含 RTT / 缓存落 2 条 ──
  console.log('A. 首查计数');
  {
    const db = mkDb(rows, { delayMs: 3 });
    const cache = new SniperFlagCache(null);
    const flags = await cache.flagsFor(db, [addr(1), addr(2)]);
    eq('A1 判定透传（sniper 主判）', flags.get(addr(1)), true);
    eq('A2 判定透传（非 sniper）', flags.get(addr(2)), false);
    const s = cache.getStats();
    eq('A3 批数 1', s.batches, 1);
    eq('A4 地址数 2', s.queriedAddrs, 2);
    check('A5 queryMs ≥ RTT 3ms', s.queryMs >= 3, true);
    eq('A6 缓存条数 2', s.cached, 2);
    eq('A7 失败 0', s.failures, 0);
  }

  // ── B. 命中不重查：同地址零新批，新地址只补 1 批 ──
  console.log('B. 缓存命中');
  {
    const db = mkDb(rows);
    const cache = new SniperFlagCache(null);
    await cache.flagsFor(db, [addr(1), addr(2)]);
    const flags2 = await cache.flagsFor(db, [addr(1), addr(3)]); // 1 命中 + 1 新
    eq('B1 新地址判定（补判 sniper）', flags2.get(addr(3)), true);
    eq('B2 命中地址仍返回（内存）', flags2.get(addr(1)), true);
    const s = cache.getStats();
    eq('B3 只补 1 批', s.batches, 2);
    eq('B4 地址数只计 miss 集', s.queriedAddrs, 3);
    eq('B5 mock 查询数同步', db._state.queries, 2);
  }

  // ── C. 批次边界：250 址 = 3 批 ──
  console.log('C. 批次边界');
  {
    const db = mkDb([]);
    const cache = new SniperFlagCache(null);
    const many = Array.from({ length: 250 }, (_, i) => addr(1000 + i));
    await cache.flagsFor(db, many);
    eq('C1 250 址 3 批', cache.getStats().batches, 3);
    eq('C2 全 miss 缓存 250', cache.getStats().cached, 250);
  }

  // ── D. 失败路径：fail-open 全 false / 不写缓存 / failures 计数 / queryMs 仍累计 ──
  console.log('D. 失败路径');
  {
    const db = mkDb(rows, { failFirst: true, delayMs: 2 });
    const cache = new SniperFlagCache(null);
    const flags = await cache.flagsFor(db, [addr(1)]);
    eq('D1 失败 fail-open false', flags.get(addr(1)), false);
    const s = cache.getStats();
    eq('D2 failures=1', s.failures, 1);
    eq('D3 失败不写缓存', s.cached, 0);
    check('D4 失败路径同样计时（≥2ms）', s.queryMs >= 2, true);
    eq('D5 失败计入地址数', s.queriedAddrs, 1);
    // 失败不固化：下次重查成功
    const flags2 = await cache.flagsFor(db, [addr(1)]);
    eq('D6 重试成功翻正', flags2.get(addr(1)), true);
    eq('D7 共 2 批', cache.getStats().batches, 2);
  }

  // ── E. supabase=null 早退：零计数零查询 ──
  console.log('E. 未注入客户端');
  {
    const cache = new SniperFlagCache(null);
    const flags = await cache.flagsFor(null, [addr(1)]);
    eq('E1 全按非 sniper 放行', flags.get(addr(1)), false);
    const s = cache.getStats();
    eq('E2 零批次', s.batches, 0);
    eq('E3 零地址数', s.queriedAddrs, 0);
    eq('E4 零缓存', s.cached, 0);
  }

  // ── F. 透传：EarlyParticipantCheckService.getPerfStats.sniper ──
  console.log('F. 服务透传');
  {
    const svc = new EarlyParticipantCheckService({ info() {}, warn() {}, error() {} }, {}, mkDb(rows));
    const p = svc.getPerfStats();
    check('F1 sniper 键集', Object.keys(p.sniper).sort(),
      ['batches', 'cached', 'failures', 'fullyLoaded', 'preloadedRows', 'queriedAddrs', 'queryMs'].sort());
    eq('F2 初始全零', p.sniper.batches + p.sniper.queriedAddrs + p.sniper.queryMs + p.sniper.failures, 0);
    await svc._sniperFlagCache.flagsFor(svc.supabase, [addr(1)]);
    eq('F3 透传计数', svc.getPerfStats().sniper.batches, 1);
  }

  // ── G. 全表预载（P12）：在表地址判定透传 / 不在表地址 false / 零 DB 查询 ──
  console.log('G. 全表预载');
  {
    const db = mkDb(rows);
    const cache = new SniperFlagCache(null);
    const pre = await cache.preloadAll(db);
    eq('G1 预载行数', pre.rows, 3);
    check('G2 预载页数（3 行单页 + 空页终止）', db._state.preloadPages, 2);
    const s0 = cache.getStats();
    check('G3 fullyLoaded 置位', s0.fullyLoaded, true);
    eq('G4 preloadedRows', s0.preloadedRows, 3);
    const flags = await cache.flagsFor(db, [addr(1), addr(99)]);
    eq('G5 在表地址判定透传（sniper）', flags.get(addr(1)), true);
    eq('G6 不在表地址 false（=无行=非 sniper）', flags.get(addr(99)), false);
    eq('G7 零 DB 单查', db._state.queries, 0);
    const s = cache.getStats();
    eq('G8 短路不计 queriedAddrs', s.queriedAddrs, 0);
    eq('G9 短路不计批数', s.batches, 0);
    eq('G10 缓存含短路写入的无行地址', s.cached, 4);
    // 短路后命中同走内存
    const flags2 = await cache.flagsFor(db, [addr(99)]);
    eq('G11 二查命中', flags2.get(addr(99)), false);
    eq('G12 仍零 DB 单查', db._state.queries, 0);
  }

  // ── H. 预载中途失败：throw / 不设全表标志 / 已写行保留 / 未载地址回退现查 ──
  console.log('H. 预载失败 fail-open');
  {
    const bigRows = [
      ...rows,
      ...Array.from({ length: 1000 }, (_, i) => ({ address: addr(100 + i), profile: { tokenCount: 5 } })),
    ];
    const db = mkDb(bigRows, { failPreloadPage: 2 });
    const cache = new SniperFlagCache(null);
    let threw = null;
    try { await cache.preloadAll(db); } catch (e) { threw = e.message; }
    check('H1 预载失败 throw', threw !== null && threw.includes('预载'), true);
    check('H2 不设全表标志', cache.getStats().fullyLoaded, false);
    // 首页已写入的行保留（真实表行判定值，bit 与现查相同）→ 该地址零重查
    const flags = await cache.flagsFor(db, [addr(2)]);
    eq('H3 首页行缓存命中（零单查）', [flags.get(addr(2)), db._state.queries], [false, 0]);
    // 未载入地址（第二页起）回退现查路径
    const flags2 = await cache.flagsFor(db, [addr(1099)]);
    eq('H4 未载地址回退现查', [flags2.get(addr(1099)), db._state.queries], [false, 1]);
    eq('H5 现查批数计数恢复', cache.getStats().batches, 1);
  }

  // ── I. 源码口径（红线 13：短路位置/预载形状锁定） ──
  console.log('I. 源码口径');
  {
    const src = fs.readFileSync(path.join(__dirname, '../src/trading-engine/pre-check/sniper-detector.js'), 'utf8');
    const iShort = src.indexOf('if (this._fullyLoaded)');
    const iNoClient = src.indexOf("if (!supabase) {");
    check('I1 短路锚点齐全', iShort > 0 && iNoClient > 0, true);
    eq('I2 全表短路在 !supabase 早退之前', iShort < iNoClient, true);
    check('I3 预载 cursor 形状（gt+order+limit）',
      /\.gt\('address', lastAddress\)/.test(src) && /\.order\('address'\)/.test(src) && /\.limit\(PAGE\)/.test(src), true);
    eq('I4 仅空页终止（部分页不 break）', src.includes('data.length === 0) break'), true);
    eq('I5 预载成功才置位（置于循环后）',
      src.indexOf('this._fullyLoaded = true;') > src.indexOf('data.length === 0) break'), true);
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
