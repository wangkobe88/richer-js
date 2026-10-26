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
 *   - 一档强边：co >= coThr(50) 且 (sellSync/co >= ratio(0.5) 或 even/co >= ratio(0.5))
 *     （同步卖出或等额复制过半 = 同一操作者的行为指纹；单靠共现=同场抢盘 bot 噪声）
 *   - 二档强边（2026-10-26 0x2fe5 团伙案用户裁定）：co >= tier2Co(20) 且
 *     (sellSync/co >= tier2Ratio(0.85) 或 even/co >= tier2Ratio(0.85))——补新批次盲区：
 *     新养号总票数没刷够 50，co 物理不足一档门槛，但比例指纹拉满（三胞胎批 co=33-35
 *     同步卖/等额 0.85-0.91 依然漏网）。比例门槛收到 0.85 防误咬真跟单（leader-
 *     follower 的 even/sellSync 比例天然高，0.5 档全靠 co>=50 兜底）
 *   - 分发号通道（同案裁定）：钱包级统计（缓存 meta.wallets，scan 2026-10-26 起）
 *     buys==0 且 sells>0 且 tokens >= distTokens(50) → 直接入名单——pair 域只统计
 *     首买滑窗，零买入的分发号（0x7154c0…2022：2686 票纯卖、场外分发货指纹）在
 *     pairs 里结构性隐身，任何 pair 判据都咬不到；真实用户零买入纯卖 50+ 票不可能
 *   - 连通分量 size >= minSize(3)；size=2 的镜像对不进（0xefb1dc×0x24a57c co=192
 *     even=192 满级强边仍被剪——铁指纹镜像对走 config/rosters/sybil-clusters-manual.json
 *     人工锚定，FA loader 合并，本脚本 --commit 不覆盖该文件）
 *
 * 用法（182）：
 *   node scripts/build-sybil-clusters.cjs                 # 只打印统计，不写文件
 *   node scripts/build-sybil-clusters.cjs --commit        # 写 config/rosters/sybil-clusters.json
 *   node scripts/build-sybil-clusters.cjs --co-thr 50 --ratio 0.5 --min-size 3
 *   node scripts/build-sybil-clusters.cjs --tier2-co 20 --tier2-ratio 0.85 --dist-tokens 50
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

/**
 * 簇构建纯函数（单测 scripts/_test_sybil_build_clusters.cjs 锁定真值表）。
 * @param {Array<{k:string, co:number, sellSync?:number, even?:number}>} pairsArr pair 统计数组
 * @param {Object<string,{tokens:number,buys:number,sells:number}>|null} walletsStat 钱包级统计
 *   （老缓存无此段=null：分发号通道跳过，一二档照常——fail-open 不炸）
 * @param {Object} opts {coThr, ratio, minSize, tier2Co, tier2Ratio, distTokens}
 * @returns {{clusters:Array<string[]>, distributors:string[], tier1Edges:number,
 *   tier2Edges:number, union:string[]}}
 */
function buildClustersFromPairs(pairsArr, walletsStat, opts = {}) {
  const {
    coThr = 50, ratio = 0.5, minSize = 3,
    tier2Co = 20, tier2Ratio = 0.85, distTokens = 50,
  } = opts;
  const adj = new Map();
  let tier1Edges = 0, tier2Edges = 0;
  const addEdge = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  };
  for (const p of pairsArr) {
    const co = Number(p.co) || 0;
    if (co < tier2Co) continue;                     // 二档是最低 co 门槛
    const ssR = co > 0 ? (Number(p.sellSync) || 0) / co : 0;
    const evR = co > 0 ? (Number(p.even) || 0) / co : 0;
    const [a, b] = String(p.k || '').split('|');
    if (!a || !b) continue;
    if (co >= coThr && (ssR >= ratio || evR >= ratio)) { addEdge(a, b); tier1Edges++; }
    else if (ssR >= tier2Ratio || evR >= tier2Ratio) { addEdge(a, b); tier2Edges++; }
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
    if (comp.length >= minSize) {
      comp.sort();
      clusters.push(comp);
    }
  }
  clusters.sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));
  // 分发号通道（walletsStat 缺段=老缓存：跳过，不炸）
  const distributors = [];
  if (walletsStat && typeof walletsStat === 'object') {
    for (const [w, st] of Object.entries(walletsStat)) {
      if (!st || typeof st !== 'object') continue;
      if ((Number(st.buys) || 0) === 0 && (Number(st.sells) || 0) > 0 && (Number(st.tokens) || 0) >= distTokens) {
        distributors.push(String(w).toLowerCase());
      }
    }
    distributors.sort();
  }
  const union = [...new Set([...clusters.flat(), ...distributors])].sort();
  return { clusters, distributors, tier1Edges, tier2Edges, union };
}

module.exports = { buildClustersFromPairs };

function main() {
  const CO_THR = argOf('--co-thr', 50);
  const RATIO = argOf('--ratio', 0.5);
  const MIN_SIZE = argOf('--min-size', 3);
  const TIER2_CO = argOf('--tier2-co', 20);
  const TIER2_RATIO = argOf('--tier2-ratio', 0.85);
  const DIST_TOKENS = argOf('--dist-tokens', 50);
  const COMMIT = process.argv.includes('--commit');

  if (!fs.existsSync(PAIRS_FILE)) {
    console.error(`pair 缓存不存在：${PAIRS_FILE}（182 上由 scan-copy-trade-clusters.cjs 生成）`);
    process.exit(1);
  }
  const parsed = JSON.parse(zlib.gunzipSync(fs.readFileSync(PAIRS_FILE)).toString());
  const pairs = parsed.pairs || [];
  if (!Array.isArray(pairs) || pairs.length === 0) {
    console.error('pair 缓存为空（pairs 缺失/非数组）');
    process.exit(1);
  }
  const walletsStat = parsed.meta?.wallets || null;
  if (!walletsStat) {
    console.log('[警告] pair 缓存无 meta.wallets（老缓存）——分发号通道跳过；重扫（scan-copy-trade-clusters fresh 路径）后生效');
  }

  const { clusters, distributors, tier1Edges, tier2Edges, union } =
    buildClustersFromPairs(pairs, walletsStat, {
      coThr: CO_THR, ratio: RATIO, minSize: MIN_SIZE,
      tier2Co: TIER2_CO, tier2Ratio: TIER2_RATIO, distTokens: DIST_TOKENS,
    });

  // 每簇审计统计（最大 co、平均同步卖比）——FA 不消费
  const pairIndex = new Map();
  for (const p of pairs) {
    const co = Number(p.co) || 0;
    if (co < TIER2_CO) continue;
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

  console.log(`pair 缓存: ${pairs.length} 条（days=${parsed.meta?.days ?? '?'}，wallets 统计 ${walletsStat ? Object.keys(walletsStat).length + ' 个' : '无（老缓存）'}）`);
  console.log(`一档强边(co>=${CO_THR} 且 同步卖/等额>=${RATIO}): ${tier1Edges} 条`);
  console.log(`二档强边(co>=${TIER2_CO} 且 同步卖/等额>=${TIER2_RATIO}): ${tier2Edges} 条`);
  console.log(`分发号(零买入纯卖 tokens>=${DIST_TOKENS}): ${distributors.length} 个`);
  console.log(`大簇(size>=${MIN_SIZE}): ${clusters.length} 个，钱包并集（含分发号）${union.length} 个`);
  const sizeHist = new Map();
  for (const c of clusters) sizeHist.set(c.length, (sizeHist.get(c.length) || 0) + 1);
  console.log(`簇大小分布: ${[...sizeHist.entries()].sort((a, b) => b[0] - a[0]).map(([s, n]) => `${s}:${n}`).join(' ')}`);
  console.log('Top10 簇:');
  for (const c of outClusters.slice(0, 10)) {
    console.log(`  #${c.id} size=${c.size} maxCo=${c.maxCo} pairs=${c.pairs} ${c.wallets.slice(0, 3).join(' ')}…`);
  }
  const probe = '0x371903abb32f5f69b536b77495e92adedfea25da';
  const hit = outClusters.find(c => c.wallets.includes(probe));
  console.log(`乌龟案探针 ${probe}: ${hit ? `命中簇 #${hit.id} size=${hit.size}` : '未命中（簇可能滑出 14 天窗）'}`);
  // 0x2fe5 案探针（2026-10-26）：三胞胎批靠二档进来、分发号 0x7154c0 靠通道进来
  const probe2 = '0x7154c0de04431c41a97d0f3770d8a31dad4c2022';
  console.log(`0x2fe5 分发号探针 ${probe2}: ${union.includes(probe2) ? '命中' : '未命中（窗口内票数/形状可能变化）'}`);

  if (!COMMIT) {
    console.log('\n（未写文件；加 --commit 写入）');
    return;
  }
  const out = {
    version: 1,
    generatedAt: new Date().toISOString(),
    note: 'sybil 大簇（用户裁定 2026-10-20 乌龟案 + 2026-10-26 0x2fe5 团伙案）：'
      + '一档强边(co>=50 且 同步卖/等额过半) + 二档强边(co>=20 且 >=0.85，新批次补盲) '
      + '+ 分发号通道(零买入纯卖 tokens>=50，pair 域结构性隐身) 连通分量 size>=3——'
      + 'FA 因子 sybilClusterHolderCircPct 原料（簇内钱包合计净持仓÷流通×100，阈值 <35 拦）。'
      + '独立于 copy-wallet-roster.json（主名单 memberNeedsLeader 剪掉的闭环小簇在此补齐）；'
      + 'size=2 镜像对（铁指纹）走 sybil-clusters-manual.json 人工锚定（FA loader 合并，本脚本不覆盖）；'
      + '重扫 pair 缓存后重跑 scripts/build-sybil-clusters.cjs --commit 覆盖本文件。',
    params: {
      coThr: CO_THR, ratio: RATIO, minSize: MIN_SIZE,
      tier2Co: TIER2_CO, tier2Ratio: TIER2_RATIO, distTokens: DIST_TOKENS,
      source: 'copy-trade-pairs.json.gz', sourceDays: parsed.meta?.days ?? null,
    },
    clusters: outClusters,
    distributors,
    wallets: union,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 1) + '\n');
  console.log(`\n已写入 ${OUT_FILE}（${clusters.length} 簇 + ${distributors.length} 分发号 / ${union.length} 钱包）`);
}

if (require.main === module) main();
