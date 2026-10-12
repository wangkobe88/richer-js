#!/usr/bin/env node

/**
 * ExternalResourceCache miss 负缓存单测（2026-10-12，perf5 终验画像 2994 次 ×
 * ~25ms ≈ 75s DB miss 重查定因）。零 DB 零网络：dbManager.getSupabase 打桩。
 *
 * 覆盖面：
 *  A 默认关：miss 每次直调查 DB（实时链路行为零变化）
 *  B 开启后：miss 只查一次 DB，后续 get 零 DB 直接 null
 *  C DB 命中行不受负缓存影响（照常每次查 DB 返回行）
 *  D 查询 error 不登记（瞬时故障不固化——恢复后重查命中）
 *  E 查询异常（throw）不登记
 *  F set 写入成功即解除登记（真析 fetch→set→下次命中闭环）
 *  G preloadByKeys 灌负键：启用语境下无行键直接登记，首次 get 零 DB；
 *    有行键走预载层返回 content 零 DB
 *  H preloadByKeys 未启用不登记（实时链路行为不变）
 *  I invalidate 显式失效同步清键（下次 get 重查 DB）
 *  J setNegativeCacheEnabled(false) 清空登记且关闭短路
 *  K 回测预载语境集成形状：preloadCache 开启开关（源码口径断言）
 */

const path = require('path');
const ERC_PATH = '../src/narrative/db/ExternalResourceCache.mjs';
const ANALYZER_PATH = path.join(__dirname, '..', 'src', 'narrative', 'analyzer', 'NarrativeAnalyzer.mjs');

// ⚠ 必须解构：require 返回的是 module.exports 包装对象 { DatabaseClientManager,
// dbManager }，不解构直接给它赋 getSupabase 打的是包装对象、实例毫发无损 →
// mock 静默失效全走真 DB（本单测首版事故：假 URL 行被 set 写进线上表）
const { dbManager } = require('../src/services/dbManager.js');

let passed = 0;
let failed = 0;
function assert(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ═══════════════ mock supabase ═══════════════
// rowsByUrl: Map<`${rt}\u0000${url}`, {url, resource_type, status, content, expires_at}>
// 链式构造器覆盖 get（eq+maybeSingle）/ preloadByKeys（in）/ set（upsert）/
// invalidate（delete）四种查询形状
function makeMockSupabase(rowsByUrl, opts = {}) {
  let queries = 0;
  const client = {
    from(table) {
      const s = { table, filters: {}, upsertPayload: null, deleteMode: false, isIn: false };
      const chain = {
        select() { return chain; },
        eq(col, val) { (s.filters[col] = s.filters[col] || []).push(val); return chain; },
        or() { return chain; },                 // get 的 expires_at or 条件（mock 行全未过期）
        in(col, vals) { s.filters[col] = vals; s.isIn = true; return chain; },
        maybeSingle() { return chain; },
        upsert(payload) { s.upsertPayload = payload; return chain; },
        delete() { s.deleteMode = true; return chain; },
        then(resolve) {
          queries++;
          if (s.deleteMode) {                    // invalidate：删行 + 清键由 ERC 侧做
            const url = s.filters.url?.[0], rt = s.filters.resource_type?.[0];
            rowsByUrl.delete(`${rt}\u0000${url}`);
            resolve({ data: null, error: null });
            return;
          }
          if (s.upsertPayload) {                 // set / markFailed：写行
            const p = s.upsertPayload;
            rowsByUrl.set(`${p.resource_type}\u0000${p.url}`, { ...p });
            resolve({ data: null, error: opts.upsertError || null });
            return;
          }
          if (opts.getError) { resolve({ data: null, error: opts.getError }); return; }
          if (opts.getThrow) { throw opts.getThrow; }   // then 内 throw → await reject → ERC catch
          if (s.isIn) {                          // preloadByKeys：url in (...) 多行
            const urls = new Set(s.filters.url);
            const data = [...rowsByUrl.values()]
              .filter(r => urls.has(r.url) && r.status === 'success')
              .map(r => ({ url: r.url, resource_type: r.resource_type, status: r.status,
                           content: r.content, expires_at: r.expires_at }));
            resolve({ data, error: null });
            return;
          }
          const url = s.filters.url?.[0], rt = s.filters.resource_type?.[0];
          const row = rowsByUrl.get(`${rt}\u0000${url}`);
          resolve({ data: row && row.status === 'success' ? row : null, error: null });
        }
      };
      return chain;
    }
  };
  return { client, count: () => queries };
}

function freshRow(url, content) {
  return { url, resource_type: 'tweet', status: 'success', content,
           expires_at: new Date(Date.now() + 86400e3).toISOString() };
}

async function resetERC(ERC) {
  ERC._preloadStore.clear();
  ERC.setNegativeCacheEnabled(false);   // 清 _missStore + 复位开关
}

(async () => {
  const { ExternalResourceCache: ERC } = await import(ERC_PATH);

  const U1 = 'https://x.com/a/status/1';
  const U2 = 'https://x.com/a/status/2';

  // ═══ A 默认关：miss 每次查 DB ═══
  {
    console.log('\n[A] 默认关：miss 每次直调查 DB（实时链路零变化）');
    await resetERC(ERC);
    const rows = new Map();
    const mock = makeMockSupabase(rows);
    dbManager.getSupabase = () => mock.client;
    const r1 = await ERC.get(U1, 'tweet');
    const r2 = await ERC.get(U1, 'tweet');
    assert('两次 miss 都返回 null', r1 === null && r2 === null);
    assert('两次都查了 DB（各一次）', mock.count() === 2, `queries=${mock.count()}`);
    assert('未登记 miss 键', ERC._missStore.size === 0);
  }

  // ═══ B 开启后：miss 只查一次 ═══
  {
    console.log('\n[B] 开启后：miss 登记键，后续 get 零 DB 直接 null');
    await resetERC(ERC);
    const rows = new Map();
    const mock = makeMockSupabase(rows);
    dbManager.getSupabase = () => mock.client;
    ERC.setNegativeCacheEnabled(true);
    const r1 = await ERC.get(U1, 'tweet');
    const r2 = await ERC.get(U1, 'tweet');
    const r3 = await ERC.get(U1, 'tweet');
    assert('三次都返回 null', r1 === null && r2 === null && r3 === null);
    assert('只查了第一次的 DB（queries=1）', mock.count() === 1, `queries=${mock.count()}`);
    assert('登记了 1 个键', ERC._missStore.size === 1 && ERC._missStore.has(`tweet\u0000${U1}`));
    // 不同键各自登记
    await ERC.get(U2, 'tweet');
    assert('不同键独立登记（第二个键再查一次 DB）', mock.count() === 2 && ERC._missStore.size === 2);
  }

  // ═══ C DB 命中行不受影响 ═══
  {
    console.log('\n[C] DB 命中行：照常每次查 DB 返回行（负缓存只对 miss）');
    await resetERC(ERC);
    const rows = new Map([[`tweet\u0000${U1}`, freshRow(U1, { id: 'row1' })]]);
    const mock = makeMockSupabase(rows);
    dbManager.getSupabase = () => mock.client;
    ERC.setNegativeCacheEnabled(true);
    const r1 = await ERC.get(U1, 'tweet');
    const r2 = await ERC.get(U1, 'tweet');
    assert('两次都命中返回行内容', r1?.id === 'row1' && r2?.id === 'row1');
    assert('命中行不进负缓存（每次照查 DB）', mock.count() === 2 && ERC._missStore.size === 0);
  }

  // ═══ D error 不登记 ═══
  {
    console.log('\n[D] 查询 error：不登记（瞬时故障不固化），恢复后重查命中');
    await resetERC(ERC);
    const rows = new Map([[`tweet\u0000${U1}`, freshRow(U1, { id: 'row1' })]]);
    const bad = makeMockSupabase(new Map(), { getError: { message: 'connection refused' } });
    dbManager.getSupabase = () => bad.client;
    ERC.setNegativeCacheEnabled(true);
    const r1 = await ERC.get(U1, 'tweet');
    assert('error 路径返回 null', r1 === null);
    assert('error 不登记 miss 键', ERC._missStore.size === 0, `size=${ERC._missStore.size}`);
    const good = makeMockSupabase(rows);
    dbManager.getSupabase = () => good.client;
    const r2 = await ERC.get(U1, 'tweet');
    assert('恢复后重查命中（无负缓存粘滞）', r2?.id === 'row1', JSON.stringify(r2));
  }

  // ═══ E throw 不登记 ═══
  {
    console.log('\n[E] 查询异常（throw → catch）：不登记');
    await resetERC(ERC);
    const bad = makeMockSupabase(new Map(), { getThrow: new Error('network gone') });
    dbManager.getSupabase = () => bad.client;
    ERC.setNegativeCacheEnabled(true);
    const r = await ERC.get(U1, 'tweet');
    assert('异常路径返回 null', r === null);
    assert('异常不登记 miss 键', ERC._missStore.size === 0, `size=${ERC._missStore.size}`);
  }

  // ═══ F set 成功清键 ═══
  {
    console.log('\n[F] set 写入成功即解除登记（fetch→set→下次命中闭环）');
    await resetERC(ERC);
    const rows = new Map();
    const mock = makeMockSupabase(rows);
    dbManager.getSupabase = () => mock.client;
    ERC.setNegativeCacheEnabled(true);
    await ERC.get(U1, 'tweet');
    assert('miss 已登记', ERC._missStore.has(`tweet\u0000${U1}`));
    const ok = await ERC.set(U1, 'tweet', { id: 'fetched' });
    assert('set 成功', ok === true);
    assert('set 后负缓存键被清除', !ERC._missStore.has(`tweet\u0000${U1}`));
    const r = await ERC.get(U1, 'tweet');
    assert('下次 get 重查 DB 命中新写入行', r?.id === 'fetched', JSON.stringify(r));
    // set 失败不清键
    const rows2 = new Map();
    const mockFail = makeMockSupabase(rows2, { upsertError: { message: 'write denied' } });
    dbManager.getSupabase = () => mockFail.client;
    await mockFail.client.from('external_resource_cache').select(); // 计数基准无关紧要
    await ERC.get(U2, 'tweet');
    const ok2 = await ERC.set(U2, 'tweet', { id: 'x' });
    assert('set 失败返回 false', ok2 === false);
    assert('set 失败保持负缓存键（宁保快照口径不冒充已写）', ERC._missStore.has(`tweet\u0000${U2}`));
  }

  // ═══ G preloadByKeys 灌负键 ═══
  {
    console.log('\n[G] preloadByKeys 灌负键：无行键直接登记、首次 get 零 DB；有行键走预载层');
    await resetERC(ERC);
    const rows = new Map([[`tweet\u0000${U1}`, freshRow(U1, { id: 'row1' })]]);
    const mock = makeMockSupabase(rows);
    dbManager.getSupabase = () => mock.client;
    ERC.setNegativeCacheEnabled(true);
    const loaded = await ERC.preloadByKeys([['tweet', U1], ['tweet', U2]]);
    assert('预载灌入 1 行', loaded === 1);
    assert('无行键 U2 已登记负缓存', ERC._missStore.has(`tweet\u0000${U2}`), JSON.stringify([...ERC._missStore]));
    assert('有行键 U1 未被误登记', !ERC._missStore.has(`tweet\u0000${U1}`));
    const q0 = mock.count();
    const r1 = await ERC.get(U1, 'tweet');
    const r2 = await ERC.get(U2, 'tweet');
    assert('U1 预载命中返回行（零 DB）', r1?.id === 'row1');
    assert('U2 负缓存短路 null（零 DB）', r2 === null);
    assert('两次 get 零 DB 查询', mock.count() === q0, `queries=${mock.count() - q0}`);
  }

  // ═══ H 未启用 preloadByKeys 不登记 ═══
  {
    console.log('\n[H] 未启用：preloadByKeys 不登记（实时链路行为不变）');
    await resetERC(ERC);
    const rows = new Map([[`tweet\u0000${U1}`, freshRow(U1, { id: 'row1' })]]);
    const mock = makeMockSupabase(rows);
    dbManager.getSupabase = () => mock.client;
    await ERC.preloadByKeys([['tweet', U1], ['tweet', U2]]);
    assert('未启用不登记任何负键', ERC._missStore.size === 0);
    const q0 = mock.count();
    const r2 = await ERC.get(U2, 'tweet');
    assert('U2 照常查 DB 返回 miss null', r2 === null);
    assert('get 走了 DB（未短路）', mock.count() === q0 + 1);
  }

  // ═══ I invalidate 清键 ═══
  {
    console.log('\n[I] invalidate 显式失效：清 miss 登记后下次 get 重查 DB');
    await resetERC(ERC);
    const rows = new Map();
    const mock = makeMockSupabase(rows);
    dbManager.getSupabase = () => mock.client;
    ERC.setNegativeCacheEnabled(true);
    await ERC.get(U1, 'tweet');
    assert('登记就位', ERC._missStore.has(`tweet\u0000${U1}`));
    const ok = await ERC.invalidate(U1, 'tweet');
    assert('invalidate 成功', ok === true);
    assert('负缓存键已清', !ERC._missStore.has(`tweet\u0000${U1}`));
    const q0 = mock.count();
    await ERC.get(U1, 'tweet');
    assert('下次 get 重查 DB（无短路粘滞）', mock.count() === q0 + 1);
  }

  // ═══ J 关闭开关清空登记 ═══
  {
    console.log('\n[J] setNegativeCacheEnabled(false)：清空登记并关闭短路');
    await resetERC(ERC);
    const rows = new Map();
    const mock = makeMockSupabase(rows);
    dbManager.getSupabase = () => mock.client;
    ERC.setNegativeCacheEnabled(true);
    await ERC.get(U1, 'tweet');
    await ERC.get(U2, 'tweet');
    assert('登记 2 键', ERC._missStore.size === 2);
    ERC.setNegativeCacheEnabled(false);
    assert('关闭清空登记', ERC._missStore.size === 0);
    const q0 = mock.count();
    await ERC.get(U1, 'tweet');
    assert('关闭后 get 恢复直调 DB', mock.count() === q0 + 1);
  }

  // ═══ K 集成：preloadCache 开启开关（源码口径） ═══
  {
    console.log('\n[K] NarrativeAnalyzer.preloadCache 开启负缓存（回测 opt-in 源码口径）');
    await resetERC(ERC);
    const src = require('fs').readFileSync(ANALYZER_PATH, 'utf8');
    assert('preloadCache 体内调用 setNegativeCacheEnabled(true)', /static\s+async\s+preloadCache\([^)]*\)\s*\{[\s\S]*?setNegativeCacheEnabled\(true\)/.test(src));
    assert('调用点在 preloadCache 内且先于 preloadByKeys', src.indexOf('setNegativeCacheEnabled(true)') < src.indexOf('preloadByKeys(tweetKeys)'));
    const noDirect = !/setNegativeCacheEnabled/.test(
      require('fs').readFileSync(
        path.join(__dirname, '..', 'src', 'trading-engine', 'pre-check', 'NarrativeDirectCaller.js'), 'utf8'));
    assert('引擎侧无开关调用（实时链路不经此路径开启）', noDirect);
  }

  // 收尾清理 static 状态（防泄漏到同进程后续 import）
  await resetERC(ERC);

  console.log('\n══════════════════════════════');
  console.log(`结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('单测异常:', e); process.exit(1); });
