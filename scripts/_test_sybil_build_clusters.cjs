#!/usr/bin/env node
/**
 * build-sybil-clusters 纯函数单测（2026-10-26 0x2fe5 团伙案：二档强边+分发号通道）
 *
 * 零 DB 零网络：打桩 pairs/walletsStat 直调 buildClustersFromPairs。
 * 真值表来源（182 实测 pair 值，2026-10-26 /tmp/an-2fe5-gang.log）：
 *   - 乌龟批（2026-10-20 案）：co=116 同步卖 84 等额 88 → 一档
 *   - 三胞胎批（0x617f2b/0xdaf656/0x24593a）：co=33-35 同步卖/等额 0.85-0.91 → 旧口径漏网、二档咬住
 *   - 0xd5155c×0x00c60c：co=26 比例 22/26=0.846 → 二档 0.85 边界外（差 0.4pp 不进=防误伤设计）
 *   - 镜像对 0xefb1dc×0x24a57c：co=192 even=192 一档强边但 size=2 → 仍不进簇（manual 兜底）
 *   - 分发号 0x7154c0：2686 票零买入纯卖 → pair 域结构性隐身，钱包级通道直收
 * 用法：node scripts/_test_sybil_build_clusters.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const { buildClustersFromPairs } = require(path.join(ROOT, 'scripts', 'build-sybil-clusters.cjs'));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

// ── 打桩地址（真实尾号+序号占位，判据语义不受影响）──
const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const C = '0xcccccccccccccccccccccccccccccccccccccccc';
const D = '0xdddddddddddddddddddddddddddddddddddddddd';
const E = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const F = '0xffffffffffffffffffffffffffffffffffffffff';
const G = '0x1111111111111111111111111111111111111111';
const H = '0x2222222222222222222222222222222222222222';
const pk = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
const pair = (a, b, co, sellSync, even) => ({ k: pk(a, b), co, sellSync, even });

console.log('A. 一档强边（旧口径不动：co>=50 且 过半）');
check('A1 乌龟批 co=116 ss=84 ev=88 → 一档边，size=4 成簇', () => {
  const r = buildClustersFromPairs([pair(A, B, 116, 84, 88), pair(A, C, 116, 84, 88), pair(A, D, 116, 84, 88), pair(B, C, 116, 84, 88), pair(B, D, 116, 84, 88), pair(C, D, 116, 84, 88)], null);
  assert.equal(r.tier1Edges, 6);
  assert.equal(r.clusters.length, 1);
  assert.deepEqual(r.clusters[0], [A, B, C, D].sort());
});
check('A2 co=49 比例 1.0 → 一档不进、二档进（二档是最低门槛）', () => {
  const r = buildClustersFromPairs([pair(A, B, 49, 49, 49), pair(B, C, 49, 49, 49), pair(A, C, 49, 49, 49)], null);
  assert.equal(r.tier1Edges, 0);
  assert.equal(r.tier2Edges, 3);
  assert.equal(r.clusters.length, 1);
});
check('A3 co=50 比例 0.5 恰过一档（边界含）', () => {
  const r = buildClustersFromPairs([pair(A, B, 50, 25, 0), pair(B, C, 50, 25, 0), pair(A, C, 50, 25, 0)], null);
  assert.equal(r.tier1Edges, 3);
});

console.log('B. 二档强边（新批次补盲：co>=20 且 >=0.85）');
check('B1 三胞胎批 co=33 ss=29 ev=33（ev/co=1.0）→ 二档边成簇（旧口径漏网反证）', () => {
  const r = buildClustersFromPairs([pair(A, B, 33, 29, 33), pair(A, C, 34, 28, 33), pair(B, C, 35, 30, 33)], null);
  assert.equal(r.tier2Edges, 3);
  assert.equal(r.tier1Edges, 0);
  assert.equal(r.clusters.length, 1);
  assert.equal(r.clusters[0].length, 3);
});
check('B2 0xd5155c 形状 co=26 比例 22/26=0.846 → 二档边界外不进（防误伤设计）', () => {
  const r = buildClustersFromPairs([pair(A, B, 26, 22, 22), pair(B, C, 26, 22, 22), pair(A, C, 26, 22, 22)], null);
  assert.equal(r.tier2Edges, 0);
  assert.equal(r.clusters.length, 0);
});
check('B3 co=19 比例 1.0 → 二档不进（co 门槛）', () => {
  const r = buildClustersFromPairs([pair(A, B, 19, 19, 19), pair(B, C, 19, 19, 19), pair(A, C, 19, 19, 19)], null);
  assert.equal(r.tier2Edges, 0);
});
check('B4 co=20 比例 0.85 恰过二档（边界含）', () => {
  const r = buildClustersFromPairs([pair(A, B, 20, 17, 0), pair(B, C, 20, 17, 0), pair(A, C, 20, 17, 0)], null);
  assert.equal(r.tier2Edges, 3);
});
check('B5 二档比例 0.84 不进', () => {
  const r = buildClustersFromPairs([pair(A, B, 30, 25, 0), pair(B, C, 30, 25, 0), pair(A, C, 30, 25, 0)], null);
  assert.equal(r.tier2Edges, 0);
});
check('B6 真跟单形状（co 高但两比均 0.3）→ 两档都不进（防误咬 leader-follower）', () => {
  const r = buildClustersFromPairs([pair(A, B, 200, 60, 60)], null);
  assert.equal(r.tier1Edges + r.tier2Edges, 0);
});

console.log('C. size=2 镜像对（minSize=3 维持：manual 兜底，判据不越权）');
check('C1 镜像对 co=192 even=192 满级强边 → size=2 仍不进簇', () => {
  const r = buildClustersFromPairs([pair(A, B, 192, 176, 192)], null);
  assert.equal(r.tier1Edges, 1);
  assert.equal(r.clusters.length, 0);
});
check('C2 镜像对+三角第三者 → 三者同簇（连通即入）', () => {
  const r = buildClustersFromPairs([pair(A, B, 192, 176, 192), pair(B, C, 97, 94, 97), pair(A, C, 97, 94, 97)], null);
  assert.equal(r.clusters.length, 1);
  assert.equal(r.clusters[0].length, 3);
});

console.log('D. 分发号通道（pair 域结构性隐身的零买入纯卖号）');
check('D1 0x7154c0 形状 buys=0 sells>0 tokens=2686 → 直收 distributors', () => {
  const ws = { [G]: { tokens: 2686, buys: 0, sells: 2800 } };
  const r = buildClustersFromPairs([], ws);
  assert.deepEqual(r.distributors, [G]);
  assert.ok(r.union.includes(G));
});
check('D2 零买入 tokens=49 → 不收（阈值 50）', () => {
  const r = buildClustersFromPairs([], { [G]: { tokens: 49, buys: 0, sells: 60 } });
  assert.equal(r.distributors.length, 0);
});
check('D3 有买入（buys=1）→ 不收（真用户可能只卖场景排除）', () => {
  const r = buildClustersFromPairs([], { [G]: { tokens: 300, buys: 1, sells: 500 } });
  assert.equal(r.distributors.length, 0);
});
check('D4 walletsStat=null（老缓存）→ 通道跳过不炸，一二档照常', () => {
  const r = buildClustersFromPairs([pair(A, B, 33, 29, 33), pair(B, C, 33, 29, 33), pair(A, C, 33, 29, 33)], null);
  assert.equal(r.distributors.length, 0);
  assert.equal(r.clusters.length, 1);
});
check('D5 union=簇∪分发号去重排序', () => {
  const ws = { [H]: { tokens: 100, buys: 0, sells: 120 } };
  const r = buildClustersFromPairs([pair(A, B, 60, 40, 40), pair(B, C, 60, 40, 40), pair(A, C, 60, 40, 40)], ws);
  assert.deepEqual(r.union, [A, B, C, H].sort());
});

console.log('E. 源码口径断言（红线 13：事故现场反证）');
check('E1 build 源码含 0x2fe5 案三个判据锚（三胞胎/镜像对/分发号）', () => {
  const s = read('scripts/build-sybil-clusters.cjs');
  assert.ok(s.includes('0x7154c0'), '分发号锚');
  assert.ok(s.includes('0xefb1dc'), '镜像对锚');
  assert.ok(s.includes('tier2'), '二档判据');
});
check('E2 scan 源码含 wallets 统计段（分发号通道数据源）', () => {
  const s = read('scripts/scan-copy-trade-clusters.cjs');
  assert.ok(s.includes('walletsStat'), 'walletsStat 产出');
  assert.ok(s.includes('wallets: walletsStat'), '缓存 meta.wallets 键');
});
check('E3 manual 名单存在且 schema 合法（FA loader 合并消费）', () => {
  const m = JSON.parse(read('config/rosters/sybil-clusters-manual.json'));
  assert.ok(Array.isArray(m.wallets) && m.wallets.length >= 6);
  for (const w of m.wallets) assert.ok(/^0x[0-9a-fA-F]{40}$/.test(w), `地址形状 ${w}`);
});
check('E4 FA loader 源码含 manual 合并（缺文件 ENOENT 静默/schema 错抛）', () => {
  const s = read('src/services/FourMemeFactorAggregator.js');
  assert.ok(s.includes('sybil-clusters-manual.json'), 'manual 路径');
  assert.ok(s.includes("e.code !== 'ENOENT'"), 'ENOENT 例外语义（缺失静默，schema 错抛）');
});

console.log('F. 参数化（CLI 调参不改默认）');
check('F1 tier2Ratio 可调 0.8 → 0xd5155c 形状(0.846)进二档', () => {
  const r = buildClustersFromPairs([pair(A, B, 26, 22, 22), pair(B, C, 26, 22, 22), pair(A, C, 26, 22, 22)], null, { tier2Ratio: 0.8 });
  assert.equal(r.tier2Edges, 3);
});
check('F2 distTokens 可调 30 → tokens=49 收', () => {
  const r = buildClustersFromPairs([], { [G]: { tokens: 49, buys: 0, sells: 60 } }, { distTokens: 30 });
  assert.equal(r.distributors.length, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
