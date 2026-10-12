#!/usr/bin/env node
// P11 SniperFlagCache 查询探针单测（2026-10-13 perf11 后定因）：earlyMs 的
// 「六族因子纯 CPU」归因未经实测——flagsFor 是计算段唯一 await。计数器
// queryMs/batches/queriedAddrs/failures 经 EarlyParticipantCheckService.
// getPerfStats.sniper 透出，回放收尾打印。零 DB 零网络：mock supabase
// busy-wait 延迟 + 查询计数。用法：node scripts/_test_sniper_cache_probe.cjs
'use strict';

const { SniperFlagCache } = require('../src/trading-engine/pre-check/sniper-detector');
const { EarlyParticipantCheckService } = require('../src/trading-engine/pre-check/EarlyParticipantCheckService');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}
const eq = (name, v, expected) => check(name, v, expected);

/** mock supabase：profile 行集可控 / 每查询 busy-wait delayMs / failNext 注入 */
function mkDb(rows, opts = {}) {
  const state = { queries: 0 };
  state.failNext = false;
  const db = {
    from(table) {
      if (table !== 'wallet_offline_profiles') throw new Error(`意外表: ${table}`);
      return {
        select(cols) {
          if (cols !== 'address, profile') throw new Error(`意外列: ${cols}`);
          return {
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
          };
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
      ['batches', 'cached', 'failures', 'queriedAddrs', 'queryMs'].sort());
    eq('F2 初始全零', p.sniper.batches + p.sniper.queriedAddrs + p.sniper.queryMs + p.sniper.failures, 0);
    await svc._sniperFlagCache.flagsFor(svc.supabase, [addr(1)]);
    eq('F3 透传计数', svc.getPerfStats().sniper.batches, 1);
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
