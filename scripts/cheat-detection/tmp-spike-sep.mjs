// tmp-spike-sep.mjs — burst 票尖刺两锚分离度探针（零 Jev；纯 DB 锚窗重拉+本地计算）
// 立项：CD157 가나 用户裁定「burst 没有问题，但这里的 burst 明显是一个尖刺——
// 单独这一个 block 持仓比例多少？这一个 block 在这个 burst 中流动性占比多少？」
// 口径（与 CD157 手算同构，管线化统一）：
//   burst 簇 = 锚窗内最大笔间 gap ≥60s → 该 gap 之后全部行；无大 gap → 全窗
//   尖刺     = burst 簇内 BUY 行最密 SPIKE_SEC 秒滑窗（Σ买入最大；平手取钱包多者）
//   spikeBuyPct  = 尖刺买入 ÷ burst 簇总买 ×100（用户问句②：块在 burst 中流动性占比）
//   spikeHoldPct = 尖刺钱包正净持仓(BNB 域) ÷ 全场 Σ正净持仓 ×100（用户问句①：
//                  单块持仓比例；钱包域=snapshot.wallets 剔路由伪钱包）
// 输入：fixtures.json(expect+anchor) + 128 票存档(burst 清单) + /tmp/cd-v68-baseline.json(v68 20 票)
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { buildSnapshotFromRows } = require_('../../src/market-analysis/cheat-snapshot.js');

const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
const SPIKE_SECS = [3, 5]; // 3s=CD157 手算口径；5s=与 burstWave 波窗对齐参考
const CLUSTER_GAP_SEC = 60;

function sb() {
  const { dbManager } = require_('../../src/services/dbManager.js');
  return dbManager.getClient();
}

async function pullTicksToAnchor(token, n) {
  const { data, error } = await sb().from('wss_price_ticks')
    .select(TICK_COLS)
    .eq('token_address', token)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(n);
  if (error) throw new Error(`wss_price_ticks 查询失败: ${error.message}`);
  const rows = data ?? [];
  if (rows.length < n) throw new Error(`锚截窗不足：锚=${n} 实际=${rows.length}`);
  return rows;
}

async function loadTokenMeta(token) {
  const { data, error } = await sb().from('wss_events')
    .select('platform,payload,block_time')
    .eq('kind', 'token_create')
    .eq('token_address', token)
    .order('id', { ascending: true })
    .limit(5);
  if (error) throw new Error(`wss_events 查询失败: ${error.message}`);
  const hit = (data ?? []).find((r) => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
  const p = hit ? hit.payload : {};
  return {
    address: token, symbol: p.symbol || null, name: p.name || null,
    platform: hit ? hit.platform : null,
    createdAt: p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null),
    creatorAddress: p.creator || null, createTxHash: p.txHash || p.tx_hash || null,
    totalSupply: p.totalSupply ?? ((hit && (hit.platform === 'flap' || hit.platform === 'gang')) ? 1e9 : null),
  };
}

// ── 尖刺计算本体（ticks=snapshot.ticks 归一化行；wallets=snapshot.wallets）──
function computeSpike(snapshot) {
  const ticks = snapshot.ticks.filter((t) => t.dt !== null && t.dt !== undefined);
  if (ticks.length < 2) return null;
  // burst 簇：最大笔间 gap
  let maxGap = 0, gapIdx = -1;
  for (let i = 1; i < ticks.length; i++) {
    const g = ticks[i].dt - ticks[i - 1].dt;
    if (g > maxGap) { maxGap = g; gapIdx = i; }
  }
  const cluster = maxGap >= CLUSTER_GAP_SEC ? ticks.slice(gapIdx) : ticks.slice();
  const clusterBuyRows = cluster.filter((t) => t.side === 'BUY');
  const clusterBuyBnb = clusterBuyRows.reduce((s, t) => s + (t.bnb || 0), 0);
  // 全场 Σ正净持仓（BNB 域；wallets 已剔路由伪钱包）
  const posNetByWallet = new Map();
  let denomPosNet = 0;
  for (const w of snapshot.wallets) {
    const net = (w.buyBnb || 0) - (w.sellBnb || 0);
    if (net > 0) { posNetByWallet.set(w.w, net); denomPosNet += net; }
  }
  const out = {
    windowN: snapshot.ticks.length,
    maxGapSec: maxGap,
    clusterSplit: maxGap >= CLUSTER_GAP_SEC,
    clusterN: cluster.length,
    clusterSpanSec: cluster.length ? cluster[cluster.length - 1].dt - cluster[0].dt : null,
    clusterBuyBnb: +clusterBuyBnb.toFixed(4),
    clusterBuyN: clusterBuyRows.length,
    denomPosNetBnb: +denomPosNet.toFixed(4),
    posNetWallets: posNetByWallet.size,
    spikes: {},
  };
  for (const sec of SPIKE_SECS) {
    const buys = clusterBuyRows.slice().sort((a, b) => a.dt - b.dt);
    if (buys.length === 0 || clusterBuyBnb <= 0) { out.spikes[`${sec}s`] = null; continue; }
    // 双指针最密滑窗：Σ买入最大；平手取钱包多者
    let j = 0, curBuy = 0, curN = 0; const curW = new Map();
    let best = null;
    for (let i = 0; i < buys.length; i++) {
      const t = buys[i];
      curBuy += t.bnb || 0; curN++;
      if (t.wallet) curW.set(t.wallet, (curW.get(t.wallet) || 0) + 1);
      while (t.dt - buys[j].dt > sec) {
        const u = buys[j];
        curBuy -= u.bnb || 0; curN--;
        if (u.wallet) { const n = (curW.get(u.wallet) || 1) - 1; if (n <= 0) curW.delete(u.wallet); else curW.set(u.wallet, n); }
        j++;
      }
      if (!best || curBuy > best.buy + 1e-12 || (Math.abs(curBuy - best.buy) <= 1e-12 && curW.size > best.walletN)) {
        best = { buy: curBuy, buyN: curN, walletN: curW.size, fromDt: buys[j].dt, toDt: t.dt, wallets: new Set(curW.keys()) };
      }
    }
    // 尖刺钱包正净持仓合计（路由伪钱包不在 posNetByWallet → 单独计数）
    let numPosNet = 0, routerN = 0;
    for (const w of best.wallets) {
      if (posNetByWallet.has(w)) numPosNet += posNetByWallet.get(w); else routerN++;
    }
    out.spikes[`${sec}s`] = {
      buyBnb: +best.buy.toFixed(4),
      buyN: best.buyN,
      wallets: best.walletN,
      fromDt: best.fromDt, toDt: best.toDt,
      buyPctInBurst: +((best.buy / clusterBuyBnb) * 100).toFixed(1),
      holdPctAll: denomPosNet > 0 ? +((numPosNet / denomPosNet) * 100).toFixed(1) : null,
      numPosNetBnb: +numPosNet.toFixed(4),
      routerWallets: routerN,
    };
  }
  return out;
}

// ── 票单组装 ──
const fixtures = JSON.parse(readFileSync(resolve(HERE, 'fixtures.json'), 'utf8'));
const byCase = new Map(fixtures.cases.map((c) => [c.caseId, c]));
const archive = JSON.parse(readFileSync(resolve(HERE, 'data', 'cd-run-2026-11-03T00-58-40-508Z.json'), 'utf8'));
const v68 = JSON.parse(readFileSync('/tmp/cd-v68-baseline.json', 'utf8'));

const wanted = []; // {caseId, source}
for (const r of archive.results || []) {
  if (r.interp?.extLevels?.stall_burst_wave === 'burst') wanted.push({ caseId: r.caseId, source: '128', grade: r.grade, reasons: (r.gradeReasons || []).map((x) => x.code) });
}
// v68 baseline 行无 caseId → 按 addr 对回 fixtures（下方补录循环）
const v68ByAddr = new Map((v68.results || []).map((r) => [String(r.addr).toLowerCase(), r.interp?.extLevels?.stall_burst_wave]));
const seen = new Set();
const tickets = [];
for (const w of wanted) {
  const c = byCase.get(w.caseId);
  if (!c) { console.error(`!! ${w.caseId} 不在 fixtures（跳过）`); continue; }
  if (seen.has(w.caseId)) continue;
  seen.add(w.caseId);
  tickets.push({ ...w, c });
}
// 补 v68 burst 票（addr → fixtures caseId）
for (const c of fixtures.cases) {
  if (seen.has(c.caseId)) continue;
  if (v68ByAddr.get(String(c.addr).toLowerCase()) === 'burst') {
    seen.add(c.caseId);
    tickets.push({ caseId: c.caseId, source: 'v68', grade: null, reasons: [], c });
  }
}

console.log(`burst 票共 ${tickets.length} 票（128 存档 ${wanted.filter((w) => w.source === '128').length} + v68 ${wanted.filter((w) => w.source === 'v68').length}）\n`);

const results = [];
for (const t of tickets) {
  const c = t.c;
  const label = `${c.caseId} ${c.symbol ?? ''}`;
  try {
    const rows = await pullTicksToAnchor(String(c.addr).toLowerCase(), c.anchor.tickCount);
    const meta = await loadTokenMeta(String(c.addr).toLowerCase());
    const snap = buildSnapshotFromRows(rows, meta, { capped: c.anchor.capped === true, anchorTickCount: c.anchor.tickCount });
    const spike = computeSpike(snap);
    const d = snap.derived;
    const row = {
      caseId: c.caseId, symbol: c.symbol, addr: c.addr, source: t.source,
      expect: c.expect?.verdict ?? null,
      grade: t.grade, reasons: t.reasons,
      sbHold: d.sameBlockHoldPct, t1Plus: d.t1PlusClusterSupplyPct, t1Sup: d.top1HoldSupplyPct,
      maxBlockBuyPct: d.maxBlockBuyPct, burstWaveBuyBnb: d.burstWaveBuyBnb, burstWaveWallets: d.burstWaveWallets,
      spike,
      activity: { level: d.activityLevel, tpm: d.ticksPerMin, idlePct: d.idlePct },
    };
    results.push(row);
    const s3 = spike?.spikes?.['3s'];
    console.log(
      `${c.caseId.padEnd(6)} ${(c.symbol ?? '').slice(0, 10).padEnd(10)} 人工=${(c.expect?.verdict ?? '-').padEnd(9)}`
      + ` 机器=${String(t.grade ?? '-').padEnd(9)} act=${String(d.activityLevel ?? '-').padEnd(5)}`
      + ` gap=${String(spike?.maxGapSec ?? '-').padStart(5)}s 簇买=${String(spike?.clusterBuyBnb ?? '-').padStart(8)}`
      + ` 尖刺3s: 买${String(s3?.buyBnb ?? '-').padStart(7)}=${String(s3?.buyPctInBurst ?? '-').padStart(5)}%簇 ${String(s3?.wallets ?? '-').padStart(2)}户 持仓${String(s3?.holdPctAll ?? '-').padStart(5)}%`
      + ` sb=${String(d.sameBlockHoldPct ?? '-').padStart(5)}% maxBlk=${String(d.maxBlockBuyPct ?? '-').padStart(5)}%`
      + `${spike?.clusterSplit ? '' : ' [无大gap=全窗]'}`,
    );
  } catch (e) {
    console.log(`${label} !! ${e.message}`);
    results.push({ caseId: c.caseId, symbol: c.symbol, addr: c.addr, error: e.message });
  }
}
// 排序观察：尖刺持仓占比降序
console.log('\n── 按 3s 尖刺持仓占比降序 ──');
const okRows = results.filter((r) => r.spike?.spikes?.['3s']);
for (const r of okRows.slice().sort((a, b) => (b.spike.spikes['3s'].holdPctAll ?? -1) - (a.spike.spikes['3s'].holdPctAll ?? -1))) {
  const s3 = r.spike.spikes['3s'];
  console.log(`${r.caseId.padEnd(6)} ${(r.symbol ?? '').slice(0, 10).padEnd(10)} hold=${String(s3.holdPctAll ?? '-').padStart(5)}% burst占比=${String(s3.buyPctInBurst ?? '-').padStart(5)}% 人工=${(r.expect ?? '-').padEnd(9)} 机器=${r.grade ?? '-'}`);
}
const outPath = resolve(HERE, 'data', 'tmp-spike-sep.json');
const { writeFileSync } = await import('fs');
writeFileSync(outPath, JSON.stringify({ ranAt: new Date().toISOString(), clusterGapSec: CLUSTER_GAP_SEC, spikeSecs: SPIKE_SECS, results }, null, 2));
console.log(`\n→ ${outPath}`);
process.exit(0);
