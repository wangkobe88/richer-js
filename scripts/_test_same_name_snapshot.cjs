/**
 * AVE 同名检查快照化（2026-10-12 用户裁定，SI 0xbc97c27f 对拍事故）单测
 *
 * 零 DB 零网络：require.cache 打桩 AveTokenAPI（未预期真调会 fail）+
 * mock snapshotWriter。五节：
 *  A 写端：7 字段裁剪/rowCount 保真/6h 节流/TTL 缓存命中不写/AVE 失败不写
 *  B 回测 as-of：桶内最近快照命中（零网络）/asOf<t1 miss 兜底实时+兜底照写/
 *    边界 asOf=t2 闭区间取 t2/异桶 miss
 *  C 行级发布前过滤（仅 asOf 路径）：未来盘剔除/created_at=0 剔除（fail-closed）/
 *    锚缺失不过滤/实时路径零变化（未来盘照常计入）
 *  D 空/未注入索引 + asOf → 兜底实时
 *  E 事故反证（红线 13）：同 asOf 两次调用 bit 一致（决定性，AVE 零调用）；
 *    快照簇 3 → `strictSameNameTokenCount >= 3` 门过
 */

'use strict';

// ═══════════════ require.cache 打桩 AveTokenAPI（先于 service 加载）═══════════════
const aveCalls = [];
let AVE_ROWS = [];      // searchTokens 返回（可变注入）
let AVE_FAIL = false;   // 模拟 AVE 挂
class StubAveAPI {
  constructor(baseURL, timeout, apiKey) { aveCalls.push({ ctor: [baseURL, timeout, apiKey] }); }
  async searchTokens(term, chain, limit, sort) {
    aveCalls.push({ search: [term, chain, limit, sort] });
    if (AVE_FAIL) throw new Error('mock AVE 宕机');
    return JSON.parse(JSON.stringify(AVE_ROWS));
  }
}
const AVE_PATH = require.resolve('../src/core/ave-api');
require.cache[AVE_PATH] = { id: AVE_PATH, filename: AVE_PATH, loaded: true, exports: { AveTokenAPI: StubAveAPI } };

const { SameNameTokenService } = require('../src/trading-engine/pre-check/SameNameTokenService');
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');

let passed = 0, failed = 0;
function ok(cond, label, detail) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}${detail ? ` | ${detail}` : ''}`); }
}
const mockLogger = { debug() {}, info() {}, warn() {}, error() {} };

function mkWriter() {
  const writes = [];
  return { writes, async insert(row) { writes.push(JSON.parse(JSON.stringify(row))); } };
}
const nSearch = () => aveCalls.filter(c => c.search).length;

// ── 固定时间轴 ──
const T1 = Date.UTC(2026, 9, 12, 10, 0, 0);
const T2 = Date.UTC(2026, 9, 12, 11, 0, 0);
const T3 = Date.UTC(2026, 9, 12, 12, 0, 0);
const AS_OF = T2 + 30 * 60000;          // t2 与 t3 之间 → 取 t2
const SELF = '0xself0000000000000000000000000000000000001';
const TARGET_LAUNCH = 5000;             // 被检 token 发布锚（epoch 秒）

// 快照行工厂（7 字段裁剪形状）
const row = (token, name, created) => ({
  token, name, symbol: 'SI', fdv: '1000000', tvl: '5000',
  tx_volume_u_24h: '800', created_at: created,
});
// t2 快照：3 同名老盘 + 1 异名 + 1 未来盘(created 9000>5000) + 1 created_at=0
const R2 = [
  row('0xold1', 'SI Coin', 1000),
  row('0xold2', 'SI Coin Two', 2000),      // 互包含 si coin → 同名
  row('0xold3', 'SI Coin X', 3000),        // 互包含 → 同名
  row('0xother', 'Unrelated', 1500),       // 异名
  row('0xfuture', 'SI Coin Future', 9000), // 发布后同名盘（快照时刻<=asOf 但行是未来）
  row('0xzero', 'SI Coin Zero', 0),        // created_at 无效
];
const R1 = [row('0xold1', 'SI Coin', 1000)];
const R3 = [row('0xold1', 'SI Coin', 1000)];

function mkSnapIdx() {
  const idx = new Map();
  idx.set('bsc:si', [
    { searchedAtMs: T1, rowCount: 1, results: R1 },
    { searchedAtMs: T2, rowCount: 6, results: R2 },
    { searchedAtMs: T3, rowCount: 1, results: R3 },
  ]);
  return idx;
}

async function main() {
  // ═══ A. 写端（实时语义，无 asOfMs）═══
  console.log('A. 写端：裁剪/节流/缓存命中不写/失败不写');
  {
    AVE_ROWS = [row('0xa', 'SI Coin', 1000), { ...row('0xb', 'Other', 2000), spam_field: 'x', fdv: '2000000' }];
    const writer = mkWriter();
    const svc = new SameNameTokenService(mockLogger, { snapshotWriter: writer });
    const r = await svc.performCheck('SI', 'SI Coin', { selfAddress: SELF, sourceExperimentId: 'exp-1' });
    ok(r.success === true && r.snapshotHit === false && r.fallback === false, 'A1. 实时调用成功 + 非快照标记');
    ok(writer.writes.length === 1, 'A2. 真调成功写一条快照', `writes=${writer.writes.length}`);
    const w = writer.writes[0];
    ok(w.chain === 'bsc' && w.search_term === 'si' && w.source_experiment_id === 'exp-1', 'A3. 行头字段（search_term 归一化/provenance）');
    ok(w.row_count === 2, 'A4. row_count 保真原始搜索行数', `row_count=${w.row_count}`);
    const keys = Object.keys(w.results[1]).sort().join(',');
    ok(keys === 'created_at,fdv,name,symbol,token,tvl,tx_volume_u_24h', 'A5. 裁剪 7 字段（spam_field 剔除）', keys);
    ok(w.results[1].fdv === '2000000' && w.results[1].created_at === 2000, 'A6. 字段值保真');

    // 6h 节流：TTL 关 → 再真调一次（searchTokens 又调）但不写
    const callsBefore = nSearch();
    await svc.performCheck('SI', 'SI Coin', { selfAddress: SELF });
    ok(nSearch() === callsBefore + 1, 'A7. TTL 关 → 第二次再真调');
    ok(writer.writes.length === 1, 'A8. 6h 内同 key 不重复写', `writes=${writer.writes.length}`);

    // TTL 开 → 缓存命中不写（缓存命中不发生真实搜索）
    const writer2 = mkWriter();
    const svc2 = new SameNameTokenService(mockLogger, { snapshotWriter: writer2, searchCacheTtlSec: 60 });
    await svc2.performCheck('SI', 'SI Coin', { selfAddress: SELF });
    const c2 = nSearch();
    const r2c = await svc2.performCheck('SI', 'SI Coin', { selfAddress: SELF });
    ok(nSearch() === c2, 'A9. TTL 缓存命中零真实搜索');
    ok(writer2.writes.length === 1, 'A10. 缓存命中不写快照', `writes=${writer2.writes.length}`);
    ok(r2c.success === true, 'A11. 缓存命中仍正常出因子');

    // AVE 失败：不写 + 空因子（-1 拒绝语义）
    AVE_FAIL = true;
    const writer3 = mkWriter();
    const svc3 = new SameNameTokenService(mockLogger, { snapshotWriter: writer3 });
    const rf = await svc3.performCheck('SI', 'SI Coin', { selfAddress: SELF });
    AVE_FAIL = false;
    ok(rf.success === false && rf.factors.strictSameNameTokenCount === -1, 'A12. AVE 失败 → 空因子 -1（门拦截语义不变）');
    ok(writer3.writes.length === 0, 'A13. 失败不写快照');
  }

  // ═══ B. 回测 as-of ═══
  console.log('B. 回测 as-of：命中/miss 兜底/边界/异桶');
  {
    AVE_ROWS = [row('0xlive', 'SI Coin Live', 1000)];
    const writer = mkWriter();
    const svc = new SameNameTokenService(mockLogger, { snapshotWriter: writer });
    svc.setHistoricalSnapshots(mkSnapIdx());

    const calls0 = nSearch();
    const r = await svc.performCheck('SI', 'SI Coin', {
      selfAddress: SELF, asOfMs: AS_OF, targetCreatedAtSec: TARGET_LAUNCH,
    });
    ok(nSearch() === calls0, 'B1. 快照命中路径零真实 AVE 调用', `calls=${nSearch() - calls0}`);
    ok(r.snapshotHit === true && r.fallback === false, 'B2. snapshotHit 标记');
    ok(r.factors.strictSameNameSearchCount === 6, 'B3. searchCount=快照 rowCount 保真（非过滤后长度）', `count=${r.factors.strictSameNameSearchCount}`);
    // 发布前过滤后：old1/old2/old3 同名（future/zero 被滤）→ 3
    ok(r.factors.strictSameNameTokenCount === 3, 'B4. 同名簇=3（未来盘+无效 created_at 已剔除）', `count=${r.factors.strictSameNameTokenCount}`);
    ok(r.preLaunchDropped === 2, 'B5. preLaunchDropped 计数（future+zero）', `dropped=${r.preLaunchDropped}`);

    // asOf 恰=t2 → 闭区间取 t2
    const rb = await svc.performCheck('SI', 'SI Coin', { selfAddress: SELF, asOfMs: T2, targetCreatedAtSec: TARGET_LAUNCH });
    ok(rb.factors.strictSameNameSearchCount === 6, 'B6. asOf=t2 边界 → 取 t2（<= 闭区间）');

    // asOf<t1 → miss 兜底实时 + 兜底照写 + fallback 标记
    const calls1 = nSearch();
    const w0 = writer.writes.length;
    const rm = await svc.performCheck('SI', 'SI Coin', { selfAddress: SELF, asOfMs: T1 - 1, targetCreatedAtSec: TARGET_LAUNCH });
    ok(nSearch() === calls1 + 1, 'B7. miss → 兜底真实调用');
    ok(rm.snapshotHit === false && rm.fallback === true, 'B8. fallback 标记（日志/观测用）');
    ok(writer.writes.length === w0 + 1, 'B9. 兜底成功也写快照（供未来回测）');
    // 兜底路径的发布前过滤：0xlive created=1000<=5000 → 计入同名簇 1
    ok(rm.factors.strictSameNameTokenCount === 1, 'B10. 兜底行同样过发布前滤（未来盘不计入）');

    // 异桶（同 chain 不同 term）miss
    const rx = await svc.performCheck('OTHER', 'Other', { selfAddress: SELF, asOfMs: AS_OF, targetCreatedAtSec: TARGET_LAUNCH });
    ok(rx.fallback === true, 'B11. 异桶 miss → 兜底');
  }

  // ═══ C. 行级发布前过滤 ═══
  console.log('C. 行级发布前过滤（仅 asOf 路径）');
  {
    AVE_ROWS = [row('0xlive', 'SI Coin', 1000), row('0xfut', 'SI Coin Fut', 9000), row('0z', 'SI Coin Z', 0)];
    const svc = new SameNameTokenService(mockLogger, { snapshotWriter: null });
    svc.setHistoricalSnapshots(mkSnapIdx());

    // 锚缺失 → 不过滤 + warn（与实时行为一致，不静默全拦）
    const r1 = await svc.performCheck('SI', 'SI Coin', { selfAddress: SELF, asOfMs: AS_OF, targetCreatedAtSec: null });
    ok(r1.factors.strictSameNameTokenCount === 5, 'C1. 锚缺失不过滤（t2 簇含 future/zero 共 5 同名）', `count=${r1.factors.strictSameNameTokenCount}`);
    ok(r1.preLaunchDropped === 0, 'C2. 锚缺失 preLaunchDropped=0');

    // created_at=0 全剔除后簇=0（fail-closed 偏拦：>=3 门不过）
    const idx2 = new Map();
    idx2.set('bsc:si', [{ searchedAtMs: T2, rowCount: 1, results: [row('0z', 'SI Coin', 0)] }]);
    const svc2 = new SameNameTokenService(mockLogger, { snapshotWriter: null });
    svc2.setHistoricalSnapshots(idx2);
    const r2 = await svc2.performCheck('SI', 'SI Coin', { selfAddress: SELF, asOfMs: AS_OF, targetCreatedAtSec: TARGET_LAUNCH });
    ok(r2.factors.strictSameNameTokenCount === 0 && r2.preLaunchDropped === 1, 'C3. created_at=0 行剔除（宁拦不冒充）');

    // 实时路径（无 asOfMs）零变化：未来盘照常计入、无 preLaunchDropped 语义
    const calls0 = nSearch();
    const r3 = await svc.performCheck('SI', 'SI Coin', { selfAddress: SELF });
    ok(nSearch() === calls0 + 1, 'C4. 实时路径照常真调（注入了索引也不用快照）');
    ok(r3.factors.strictSameNameTokenCount === 3 && r3.snapshotHit === false && r3.preLaunchDropped === 0,
      'C5. 实时零变化：未来盘(9000)与无效行(0)照常参与（AVE_ROWS 3 行全同名）', `count=${r3.factors.strictSameNameTokenCount}`);
  }

  // ═══ D. 空/未注入索引 + asOf ═══
  console.log('D. 空/未注入索引');
  {
    AVE_ROWS = [row('0xlive', 'SI Coin', 1000)];
    const svcD1 = new SameNameTokenService(mockLogger, { snapshotWriter: null });
    const r1 = await svcD1.performCheck('SI', 'SI Coin', { selfAddress: SELF, asOfMs: AS_OF, targetCreatedAtSec: TARGET_LAUNCH });
    ok(r1.fallback === true && r1.success === true, 'D1. 未注入索引 + asOf → 兜底实时');

    const svcD2 = new SameNameTokenService(mockLogger, { snapshotWriter: null });
    svcD2.setHistoricalSnapshots(new Map());
    const r2 = await svcD2.performCheck('SI', 'SI Coin', { selfAddress: SELF, asOfMs: AS_OF, targetCreatedAtSec: TARGET_LAUNCH });
    ok(r2.fallback === true, 'D2. 空索引 → 兜底实时');
    // 摘除（BacktestEngine fail-open 路径置 null）
    svcD2.setHistoricalSnapshots(null);
    const r3 = await svcD2.performCheck('SI', 'SI Coin', { selfAddress: SELF, asOfMs: AS_OF, targetCreatedAtSec: TARGET_LAUNCH });
    ok(r3.fallback === true, 'D3. null 摘除索引 → 兜底实时');
  }

  // ═══ E. 事故反证（SI 0xbc97c27f：两次运行同名簇漂移翻转决策）═══
  console.log('E. 事故反证：决定性 + 簇 3 放行');
  {
    const svc = new SameNameTokenService(mockLogger, { snapshotWriter: null });
    svc.setHistoricalSnapshots(mkSnapIdx());
    const e0 = nSearch();
    const ra = await svc.performCheck('SI', 'SI Coin', { selfAddress: SELF, asOfMs: AS_OF, targetCreatedAtSec: TARGET_LAUNCH });
    const rb2 = await svc.performCheck('SI', 'SI Coin', { selfAddress: SELF, asOfMs: AS_OF, targetCreatedAtSec: TARGET_LAUNCH });
    ok(JSON.stringify(ra.factors) === JSON.stringify(rb2.factors), 'E1. 同 asOf 两次调用因子 bit 一致（决定性——事故核心反证）');
    ok(nSearch() === e0, 'E2. 本段零真实 AVE 调用（命中路径零网络）', `calls=${nSearch() - e0}`);
    // 快照簇 3 → 既有 preBuy 门 `>= 3` 放行（v0 00:58 行为复现，不再依赖运行墙钟）
    const ce = new ConditionEvaluator();
    ok(ce.evaluate('strictSameNameTokenCount >= 3', ra.factors) === true, 'E3. 簇 3 → `>= 3` 门放行');
    const stats = svc.getSnapshotStats();
    ok(stats.snapshotHits === 2 && stats.buckets === 1, 'E4. 观测计数（snapshotHits/buckets）', JSON.stringify(stats));
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
