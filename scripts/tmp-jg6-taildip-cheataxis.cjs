#!/usr/bin/env node
// JG-6 因子门合理性④：tail_dip 被拦 375 票——cheat 维度（做市商痕迹）锚窗 snapshot 分离度。
// 锚=首次被拦时刻；纯代码零 Jev（buildSnapshotFromRows derived 键）。182 跑。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const { buildSnapshotFromRows } = require('../src/market-analysis/cheat-snapshot.js');

const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
const CAP = 3000;

(async () => {
  const sb = dbManager.getClient();
  const { data: gd } = await sb.from('case_collection_tokens')
    .select('token_address').eq('collection_id', 'a8414632-7c24-4762-9253-c49bb0f53105');
  const golden = new Set((gd || []).map(t => t.token_address));

  let sigs = []; let from = 0;
  while (true) {
    const { data, error } = await sb.from('strategy_signals')
      .select('id, token_address, created_at, metadata')
      .eq('experiment_id', EXP).eq('signal_type', 'BUY')
      .filter('metadata->>execution_reason', 'eq', 'factor_gate_tail_dip_knife')
      .order('id', { ascending: true }).range(from, from + 199);
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    sigs.push(...data);
    if (data.length < 200) break;
    from += 200;
  }
  const firstByToken = new Map();
  for (const s of sigs) if (!firstByToken.has(s.token_address)) firstByToken.set(s.token_address, s);
  console.log('被拦', sigs.length, '行 /', firstByToken.size, '票');

  async function loadAllTicks(addr) {
    const rows = []; let f = 0;
    while (f <= CAP) {
      const { data, error } = await sb.from('wss_price_ticks')
        .select(TICK_COLS).eq('token_address', addr)
        .order('id', { ascending: true }).range(f, f + 999);
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      rows.push(...data);
      if (data.length < 1000) break;
      f += 1000;
    }
    return rows;
  }
  async function loadMeta(addr) {
    const { data, error } = await sb.from('wss_events')
      .select('platform,payload,block_time').eq('kind', 'token_create').eq('token_address', addr)
      .order('id', { ascending: true }).limit(5);
    if (error) throw new Error(error.message);
    const hit = (data || []).find(r => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
    const p = hit ? hit.payload : {};
    return {
      address: addr, symbol: p.symbol || null, name: p.name || null,
      platform: hit ? hit.platform : null,
      createdAt: p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null),
      creatorAddress: p.creator || null, createTxHash: p.txHash || p.tx_hash || null,
      totalSupply: p.totalSupply ?? ((hit && (hit.platform === 'flap' || hit.platform === 'gang')) ? 1e9 : null),
    };
  }

  const rows = [];
  let done = 0;
  for (const [addr, s] of firstByToken) {
    const t0 = new Date(s.created_at).getTime();
    const all = await loadAllTicks(addr);
    for (const r of all) r.bt = new Date(r.block_time).getTime();
    all.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
    const anchorRows = all.filter(r => r.bt <= t0).slice(-CAP);
    const fwd = all.filter(r => r.bt > t0);
    let anchorP = null;
    for (const r of anchorRows) if (r.price_bnb > 0) anchorP = r.price_bnb;
    let rPeak = 0;
    if (anchorP) for (const r of fwd) if (r.price_bnb > 0) {
      const g = (r.price_bnb / anchorP - 1) * 100;
      if (g > rPeak) rPeak = g;
    }
    let d = null;
    if (anchorRows.length >= 7) {
      const meta = { ...(await loadMeta(addr)), quoteToken: anchorRows.length ? [...anchorRows].reverse().find(r => r.quote_token)?.quote_token || null : null };
      try {
        const snap = buildSnapshotFromRows(anchorRows, meta, { capped: all.length > CAP, anchorTickCount: anchorRows.length });
        d = snap.derived;
      } catch (e) { /* snapshot 异常按缺省处理 */ }
    }
    rows.push({ addr, rPeak, d, tf: (s.metadata || {}).trendFactors || {}, golden: golden.has(addr) });
    if (++done % 50 === 0) console.error(`  …${done}/${firstByToken.size}`);
  }

  const right = rows.filter(r => r.rPeak >= 100), mid = rows.filter(r => r.rPeak >= 50 && r.rPeak < 100), main = rows.filter(r => r.rPeak < 50);
  const hasD = arr => arr.filter(r => r.d);
  console.log(`右尾 ${right.length}(d=${hasD(right).length}) / 中间 ${mid.length} / 主体 ${main.length}(d=${hasD(main).length})`);

  // 做市商痕迹轴 AUC 扫描
  const keys = ['washPairCount','clusterRoundTripPct','pulseBlockCount','exactEqualBlockBuyPct','exactEqualBlockClusters','sameBlockClusters','sameBlockHoldPct','noBuySellPct','routerEntryBuyPct','routerPct','top1BuyPct','top1HoldSupplyPct','top2HoldSupplyPct','holderHHI','circSupplyPct','churn60sWalletCount','totalBuyBnb','buyN','walletCount','famousHoldPct','creatorPeakHoldSupplyPct','creatorBuyBnb','anchorBuySellRatio','priceArc','activityLevel','spanSec','ticksPerMin','posHolderCount','spikePreGapSec','spikeBuyBnb','maxBlockBuyCount','postStallSpanSec','nearDumpQualBlocks','burstWaveBuyBnb'];
  console.log('\n=== cheat 轴 derived 键：右尾 vs 主体 AUC ===');
  const res = [];
  for (const k of keys) {
    const rv = hasD(right).map(r => r.d[k]).filter(v => typeof v === 'number' && isFinite(v));
    const mv = hasD(main).map(r => r.d[k]).filter(v => typeof v === 'number' && isFinite(v));
    if (rv.length < 15 || mv.length < 100) { res.push({ k, auc: null, note: `n=${rv.length}/${mv.length}` }); continue; }
    let u = 0;
    for (const x of rv) for (const y of mv) u += x > y ? 1 : (x === y ? 0.5 : 0);
    const auc = u / (rv.length * mv.length);
    const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
    res.push({ k, auc, rMed: q(rv, .5), mMed: q(mv, .5) });
  }
  res.sort((a, b) => (Math.abs((b.auc ?? .5) - .5)) - (Math.abs((a.auc ?? .5) - .5)));
  for (const r of res.slice(0, 18)) {
    console.log(`${r.k.padEnd(26)} AUC=${r.auc === null ? 'n/a' : r.auc.toFixed(3)} | 右尾中位 ${r.rMed !== undefined ? r.rMed.toExponential(2) : '?'} 主体中位 ${r.mMed !== undefined ? r.mMed.toExponential(2) : '?'} ${r.note || ''}`);
  }

  // 用户形状网格：做市商痕迹弱（无对敲/无 insider 抛货/无大户主导/散户通道/筹码分散）∧ 火过 ∧ （T182 域自带回落）
  const noWash = d => (d.washPairCount ?? 0) === 0;
  const conds = {
    '无对敲 ∧ nbs<10': d => noWash(d) && (d.noBuySellPct ?? 100) < 10,
    '无对敲 ∧ nbs<10 ∧ top1买<15': d => noWash(d) && (d.noBuySellPct ?? 100) < 10 && (d.top1BuyPct ?? 100) < 15,
    '无对敲 ∧ HHI<0.2': d => noWash(d) && (d.holderHHI ?? 1) < 0.2,
    '无对敲 ∧ HHI<0.2 ∧ top1买<15': d => noWash(d) && (d.holderHHI ?? 1) < 0.2 && (d.top1BuyPct ?? 100) < 15,
    '无对敲 ∧ nbs<10 ∧ HHI<0.2': d => noWash(d) && (d.noBuySellPct ?? 100) < 10 && (d.holderHHI ?? 1) < 0.2,
    '∧ r60entry≥60': d => noWash(d) && (d.noBuySellPct ?? 100) < 10 && (d.holderHHI ?? 1) < 0.2 && (d.routerEntryBuyPct ?? 0) >= 60,
    '∧ 火过(买≥3B)': d => noWash(d) && (d.noBuySellPct ?? 100) < 10 && (d.holderHHI ?? 1) < 0.2 && d.totalBuyBnb >= 3,
    '∧ 火过 ∧ r60entry≥60': d => noWash(d) && (d.noBuySellPct ?? 100) < 10 && (d.holderHHI ?? 1) < 0.2 && d.totalBuyBnb >= 3 && (d.routerEntryBuyPct ?? 0) >= 60,
    '∧ 火过 ∧ creatorPeak<10': d => noWash(d) && (d.noBuySellPct ?? 100) < 10 && (d.holderHHI ?? 1) < 0.2 && d.totalBuyBnb >= 3 && (d.creatorPeakHoldSupplyPct ?? 100) < 10,
    '∧ 火过 ∧ top1买<12': d => noWash(d) && (d.noBuySellPct ?? 100) < 10 && (d.holderHHI ?? 1) < 0.2 && d.totalBuyBnb >= 3 && (d.top1BuyPct ?? 100) < 12,
    '紧: 全六腿': d => noWash(d) && (d.noBuySellPct ?? 100) < 10 && (d.holderHHI ?? 1) < 0.2 && d.totalBuyBnb >= 3 && (d.routerEntryBuyPct ?? 0) >= 60 && (d.top1BuyPct ?? 100) < 15,
  };
  console.log('\n=== 用户形状（cheat 维度豁免候选）：覆盖/误伤 ===');
  for (const [name, fn] of Object.entries(conds)) {
    const hr = hasD(right).filter(r => fn(r.d));
    const hm = hasD(main).filter(r => fn(r.d));
    const hmid = hasD(mid).filter(r => fn(r.d));
    const peaks = hm.map(r => r.rPeak).sort((a, b) => a - b);
    const med = peaks.length ? peaks[Math.floor(peaks.length / 2)] : 0;
    const ge50 = peaks.filter(x => x >= 50).length;
    console.log(`${name.padEnd(30)} 右尾 ${String(hr.length).padStart(2)}/${right.length}（金狗${hr.filter(r => r.golden).length}/6） | 主体 ${String(hm.length).padStart(3)}/${main.length}(${(hm.length / hasD(main).length * 100).toFixed(0)}%) 中间 ${hmid.length}/${mid.length} | 命中主体峰中位+${med.toFixed(0)}% ≥50%:${ge50}/${hm.length}`);
  }

  // 쿠우타 明细
  const kuta = rows.find(r => r.addr === '0xc0e896ddec43881055a25786c17fa5d5d6337777');
  if (kuta && kuta.d) {
    console.log('\n=== 쿠우타（首次被拦锚窗 derived）===');
    const d = kuta.d;
    console.log(JSON.stringify({ washPairCount: d.washPairCount, clusterRoundTripPct: d.clusterRoundTripPct, pulseBlockCount: d.pulseBlockCount, exactEqualBlockClusters: d.exactEqualBlockClusters, sameBlockClusters: d.sameBlockClusters?.length ?? d.sameBlockClusters, noBuySellPct: d.noBuySellPct, routerEntryBuyPct: d.routerEntryBuyPct, top1BuyPct: d.top1BuyPct, top1HoldSupplyPct: d.top1HoldSupplyPct, holderHHI: d.holderHHI, totalBuyBnb: d.totalBuyBnb, buyN: d.buyN, walletCount: d.walletCount, activityLevel: d.activityLevel, priceArc: d.priceArc }));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
