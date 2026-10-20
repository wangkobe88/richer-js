#!/usr/bin/env node
/**
 * sybil 大簇名单生成（182 专用，读离线 pair 缓存零网络）
 *
 * 产物 `config/rosters/sybil-clusters.json`：从 copy-trade-pairs 缓存（scan-copy-trade-
 * clusters.cjs 的 14 天 pair 统计）建「强边连通分量」= sybil 大簇，FA 因子
 * `sybilClusterHolderCircPct` 的原料（所有大簇钱包合计净持仓 ÷ 流通 ×100）。
 *
 * 为什么独立于 copy-wallet-roster.json（2026-10-20 乌龟案 0x0adad648…7777 用户裁定）：
 * 主名单有 memberNeedsLeader + minFollowers 剪枝，把「三五个钱包互相抱团、谁都不算
 * leader」的闭环小簇整个丢掉（本案四钱包 co=116~165 / 同步卖 84~142 / 等额买 88~122，
 * 指纹远超档 B 判据，却因 followers<20 不在 350 名单里）——本文件补这个盲区。
 *
 * 簇定义（定义非调参，改=改口径）：
 *   - 强边：co >= coThr(50) 且 (sellSync/co >= ratio(0.5) 或 even/co >= ratio(0.5))
 *     （同步卖出或等额复制过半 = 同一操作者的行为指纹；单靠共现=同场抢盘 bot 噪声）
 *   - 连通分量 size >= minSize(3)；size=2 的镜像对不进（FLY 案主名单已覆盖形态，
 *     且两钱包合计口径天然小、信号弱）
 *
 * 用法（182）：
 *   node scripts/build-sybil-clusters.cjs                 # 只打印统计，不写文件
 *   node scripts/build-sybil-clusters.cjs --commit        # 写 config/rosters/sybil-clusters.json
 *   node scripts/build-sybil-clusters.cjs --co-thr 50 --ratio 0.5 --min-size 3
 *
 * 维护口径：与主名单同源（14 天滑窗 pair 缓存，`--from-cache` 调参零网络）——
 * 重扫 pair 缓存后重跑本脚本 → --commit → push → 重启实验进程生效（FA 静态快照）。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const PAIRS_FILE = path.join(ROOT, 'data', 'offline-cache', 'copy-trade-pairs.json.gz');
const OUT_FILE = path.join(ROOT, 'config', 'rosters', 'sybil-clusters.json');

function argOf(name, dflt) {
  const i = process.argv.indexOf(name);
  if (i === -1) return dflt;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : dflt;
}

const CO_THR = argOf('--co-thr', 50);
const RATIO = argOf('--ratio', 0.5);
const MIN_SIZE = argOf('--min-size', 3);
const COMMIT = process.argv.includes('--commit');

function main() {
  if (!fs.existsSync(PAIRS_FILE)) {
    console.error(`pair 缓存不存在：${PAIRS_FILE}（182 上由 scan-copy-trade-clusters.cjs 生成）`);
    process.exit(1);
  }
  const meta = JSON.parse(zlib.gunzipSync(fs.readFileSync(PAIRS_FILE)).toString());
  const pairs = meta.pairs || [];
  if (!Array.isArray(pairs) || pairs.length === 0) {
    console.error('pair 缓存为空（pairs 缺失/非数组）');
    process.exit(1);
  }

  // 强边邻接表
  const adj = new Map();
  let strongEdges = 0;
  for (const p of pairs) {
    const co = Number(p.co) || 0;
    if (co < CO_THR) continue;
    const sellRatio = co > 0 ? (Number(p.sellSync) || 0) / co : 0;
    const evenRatio = co > 0 ? (Number(p.even) || 0) / co : 0;
    if (sellRatio < RATIO && evenRatio < RATIO) continue;
    const [a, b] = String(p.k || '').split('|');
    if (!a || !b) continue;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
    strongEdges++;
  }

  // 连通分量
  const seen = new Set();
  const clusters = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const stack = [start];
    const comp = [];
    seen.add(start);
    while (stack.length) {
      const n = stack.pop();
      comp.push(n);
      for (const m of adj.get(n) || []) {
        if (!seen.has(m)) { seen.add(m); stack.push(m); }
      }
    }
    if (comp.length >= MIN_SIZE) {
      comp.sort();
      clusters.push(comp);
    }
  }
  clusters.sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));

  // 每簇统计（最大 co、平均同步卖比）——审计用，FA 不消费
  const pairIndex = new Map();
  for (const p of pairs) {
    const co = Number(p.co) || 0;
    if (co < CO_THR) continue;
    pairIndex.set(String(p.k || ''), p);
  }
  const outClusters = clusters.map((wallets, idx) => {
    let maxCo = 0;
    let syncSell = 0;
    let pairN = 0;
    for (let i = 0; i < wallets.length; i++) {
      for (let j = i + 1; j < wallets.length; j++) {
        const p = pairIndex.get(`${wallets[i]}|${wallets[j]}`) || pairIndex.get(`${wallets[j]}|${wallets[i]}`);
        if (!p) continue;
        pairN++;
        if ((Number(p.co) || 0) > maxCo) maxCo = Number(p.co) || 0;
        syncSell += Number(p.sellSync) || 0;
      }
    }
    return { id: idx, size: wallets.length, maxCo, pairs: pairN, wallets };
  });
  const union = [...new Set(clusters.flat())].sort();

  console.log(`pair 缓存: ${pairs.length} 条（days=${meta.meta?.days ?? '?'}）`);
  console.log(`强边(co>=${CO_THR} 且 同步卖/等额 >=${RATIO}): ${strongEdges} 条`);
  console.log(`大簇(size>=${MIN_SIZE}): ${clusters.length} 个，钱包并集 ${union.length} 个`);
  const sizeHist = new Map();
  for (const c of clusters) sizeHist.set(c.length, (sizeHist.get(c.length) || 0) + 1);
  console.log(`簇大小分布: ${[...sizeHist.entries()].sort((a, b) => b[0] - a[0]).map(([s, n]) => `${s}:${n}`).join(' ')}`);
  console.log('Top10 簇:');
  for (const c of outClusters.slice(0, 10)) {
    console.log(`  #${c.id} size=${c.size} maxCo=${c.maxCo} pairs=${c.pairs} ${c.wallets.slice(0, 3).join(' ')}…`);
  }
  const probe = '0x371903abb32f5f69b536b77495e92adedfea25da';
  const hit = outClusters.find(c => c.wallets.includes(probe));
  console.log(`乌龟案探针 ${probe}: ${hit ? `命中簇 #${hit.id} size=${hit.size} [${hit.wallets.join(' ')}]` : '未命中（簇可能滑出 14 天窗）'}`);

  if (!COMMIT) {
    console.log('\n（未写文件；加 --commit 写入）');
    return;
  }
  const out = {
    version: 1,
    generatedAt: new Date().toISOString(),
    note: 'sybil 大簇（用户裁定 2026-10-20 乌龟案）：强边(co>=50 且 同步卖/等额过半)连通分量 size>=3——'
      + 'FA 因子 sybilClusterHolderCircPct 原料（簇内钱包合计净持仓÷流通×100，阈值 <35 拦）。'
      + '独立于 copy-wallet-roster.json（主名单 memberNeedsLeader 剪掉的闭环小簇在此补齐）；'
      + '重扫 pair 缓存后重跑 scripts/build-sybil-clusters.cjs --commit 覆盖本文件。',
    params: { coThr: CO_THR, ratio: RATIO, minSize: MIN_SIZE, source: 'copy-trade-pairs.json.gz', sourceDays: meta.meta?.days ?? null },
    clusters: outClusters,
    wallets: union,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 1) + '\n');
  console.log(`\n已写入 ${OUT_FILE}（${clusters.length} 簇 / ${union.length} 钱包）`);
}

main();
