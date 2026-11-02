#!/usr/bin/env node
/**
 * tmp：候选锚点分布测量（2026-10-31 用户裁定「等额簇个数改为持仓占比」）
 * 在 54 票人工裁定集上算等额/近等额/同块簇的【持仓占比】三类分位——不烧 Jev。
 * 持仓口径：net(w)=buyBnb−sellBnb；分母=Σ全体钱包正净持仓（T91a 哲学 ≤100）；
 *           分子=簇成员 Σ 正净持仓（只计正，防簇内已倒掉钱包贡献负数虚降占比——
 *           「已卖回」信息由买入占比对照列承载）。钱包集=已剔 router 伪钱包。
 * 182 跑：node scripts/cheat-detection/tmp-anchor-dist.mjs
 */
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { buildSnapshotFromRows } = require_('../../src/trading-engine/pre-check/cheat-snapshot.js');

const TICK_COLS = 'block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
const EQ_MIN = 0.001;      // 等额簇尘门（快照层固定值同款）
const NEAR_REL = 0.02;     // 近等额带 ±2%
const SB_MIN = 3;          // 桶/簇最小笔数

function sb() {
  const { dbManager } = require_('../../src/services/dbManager.js');
  return dbManager.getClient();
}

async function pullTicksToAnchor(token, n) {
  const { data, error } = await sb().from('wss_price_ticks')
    .select(TICK_COLS).eq('token_address', token)
    .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(n);
  if (error) throw new Error(`ticks 查询失败: ${error.message}`);
  if ((data ?? []).length < n) throw new Error(`锚不足：${n} vs ${data?.length}`);
  return data;
}

/** 簇成员钱包 union → {holdPct, buyPct, wallets}；denom=Σ正净持仓 */
function clusterShare(ticks, wallets, memberWallets) {
  if (!memberWallets.size) return { holdPct: null, buyPct: null, wallets: 0 };
  const netOf = new Map(wallets.map((w) => [w.w, w.buyBnb - w.sellBnb]));
  let denom = 0;
  for (const v of netOf.values()) if (v > 0) denom += v;
  let numHold = 0, numBuy = 0, totalBuy = 0;
  for (const w of wallets) totalBuy += w.buyBnb;
  for (const m of memberWallets) {
    const n = netOf.get(m) ?? 0;
    if (n > 0) numHold += n;
    numBuy += (wallets.find((w) => w.w === m) || { buyBnb: 0 }).buyBnb;
  }
  return {
    holdPct: denom > 0 ? (numHold / denom) * 100 : null,
    buyPct: totalBuy > 0 ? (numBuy / totalBuy) * 100 : null,
    wallets: memberWallets.size,
  };
}

function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

const fixtures = JSON.parse(readFileSync(resolve(HERE, 'fixtures.json'), 'utf8')).cases;
const cases = fixtures.filter((c) => c.caseId !== 'CD24' && c.expect && c.expect.verdict && c.expect.verdict !== 'unclear');
console.log(`票数=${cases.length}（剔 CD24）`);

const rows = [];
for (const c of cases) {
  const r = await pullTicksToAnchor(c.addr.toLowerCase(), c.anchor.tickCount);
  const snap = buildSnapshotFromRows(r, { address: c.addr }, {});
  const { ticks, wallets } = snap;

  // 精确等额簇（T74 四位舍入）
  const eqBuckets = new Map();
  for (const t of ticks) {
    if (t.side !== 'BUY' || (t.bnb || 0) < EQ_MIN || !t.wallet) continue;
    const k = Math.round(t.bnb * 10000);
    if (!eqBuckets.has(k)) eqBuckets.set(k, new Set());
    eqBuckets.get(k).add(t.wallet);
  }
  const eqWallets = new Set();
  let eqBucketsN = 0;
  for (const ws of eqBuckets.values()) if (ws.size >= SB_MIN) { eqBucketsN++; for (const w of ws) eqWallets.add(w); }

  // 近等额带（排序后相邻相对差 ≤2% 链式分段）
  const buys = ticks.filter((t) => t.side === 'BUY' && (t.bnb || 0) >= EQ_MIN && t.wallet).sort((a, b) => a.bnb - b.bnb);
  const nearWallets = new Set();
  let nearBandsN = 0;
  for (let i = 0; i < buys.length;) {
    let j = i;
    while (j + 1 < buys.length && (buys[j + 1].bnb - buys[i].bnb) / buys[i].bnb <= NEAR_REL) j++;
    const seg = buys.slice(i, j + 1);
    const ws = new Set(seg.map((t) => t.wallet));
    if (ws.size >= SB_MIN && seg.length >= SB_MIN) { nearBandsN++; for (const w of ws) nearWallets.add(w); }
    i = j + 1;
  }

  // 同块簇（≥3 笔买同块）
  const blkBuckets = new Map();
  for (const t of ticks) {
    if (t.side !== 'BUY' || t.block === null || !t.wallet) continue;
    if (!blkBuckets.has(t.block)) blkBuckets.set(t.block, new Set());
    blkBuckets.get(t.block).add(t.wallet);
  }
  const sbWallets = new Set();
  let sbClustersN = 0;
  for (const ws of blkBuckets.values()) if (ws.size >= SB_MIN) { sbClustersN++; for (const w of ws) sbWallets.add(w); }

  rows.push({
    id: c.caseId, label: c.expect.verdict,
    eqHold: clusterShare(ticks, wallets, eqWallets).holdPct,
    eqBuy: clusterShare(ticks, wallets, eqWallets).buyPct,
    nearHold: clusterShare(ticks, wallets, nearWallets).holdPct,
    nearBuy: clusterShare(ticks, wallets, nearWallets).buyPct,
    sbHold: clusterShare(ticks, wallets, sbWallets).holdPct,
    sbBuy: clusterShare(ticks, wallets, sbWallets).buyPct,
    eqBucketsN, nearBandsN, sbClustersN,
  });
  process.stdout.write('.');
}
console.log('\n');

const byLabel = {};
for (const r of rows) (byLabel[r.label] ??= []).push(r);
const metrics = ['eqHold', 'eqBuy', 'nearHold', 'nearBuy', 'sbHold', 'sbBuy'];
for (const m of metrics) {
  console.log(`── ${m} ──`);
  for (const [label, list] of Object.entries(byLabel)) {
    const vals = list.map((r) => r[m]).filter((v) => v !== null);
    const zero = list.length - vals.length;
    console.log(`  ${label.padEnd(9)} n=${list.length}  q25=${pct(vals, .25)?.toFixed(1)}  med=${pct(vals, .5)?.toFixed(1)}  q75=${pct(vals, .75)?.toFixed(1)}  max=${Math.max(...(vals.length ? vals : [0])).toFixed(1)}  null=${zero}`);
  }
}

// 极端票点名（判别力目检）
console.log('\n── eqHold top/bottom 明细 ──');
const sorted = [...rows].sort((a, b) => (b.eqHold ?? -1) - (a.eqHold ?? -1));
for (const r of [...sorted.slice(0, 8), ...sorted.slice(-5)]) {
  console.log(`${r.id} ${r.label.padEnd(9)} eqHold=${r.eqHold?.toFixed(1) ?? '-'} nearHold=${r.nearHold?.toFixed(1) ?? '-'} eqBuy=${r.eqBuy?.toFixed(1) ?? '-'} nearBuy=${r.nearBuy?.toFixed(1) ?? '-'} 桶=${r.eqBucketsN}/${r.nearBandsN}`);
}
