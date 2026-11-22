#!/usr/bin/env node
// JG-6 因子门合理性⑤：「紧:全六腿」形状命中票全量分组明细展示（右尾/中间/主体）。
// 无对敲∧nbs<10∧HHI<0.2∧买≥3B∧r60entry≥60∧top1买<15。182 跑。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const { buildSnapshotFromRows } = require('../src/market-analysis/cheat-snapshot.js');

const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
const CAP = 3000;
const LEG6 = d => (d.washPairCount ?? 0) === 0 && (d.noBuySellPct ?? 100) < 10 && (d.holderHHI ?? 1) < 0.2
  && d.totalBuyBnb >= 3 && (d.routerEntryBuyPct ?? 0) >= 60 && (d.top1BuyPct ?? 100) < 15;

(async () => {
  const sb = dbManager.getClient();
  const { data: gd } = await sb.from('case_collection_tokens')
    .select('token_address, token_meta').eq('collection_id', 'a8414632-7c24-4762-9253-c49bb0f53105');
  const golden = new Map((gd || []).map(t => [t.token_address, ((t.token_meta || {}).symbol) || '']));

  let sigs = []; let from = 0;
  while (true) {
    const { data, error } = await sb.from('strategy_signals')
      .select('id, token_address, token_symbol, created_at, metadata')
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
    const { data } = await sb.from('wss_events')
      .select('platform,payload,block_time').eq('kind', 'token_create').eq('token_address', addr)
      .order('id', { ascending: true }).limit(5);
    const hit = (data || []).find(r => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
    const p = hit ? hit.payload : {};
    return {
      address: addr, symbol: p.symbol || null, name: p.name || null, platform: hit ? hit.platform : null,
      createdAt: p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null),
      creatorAddress: p.creator || null, createTxHash: p.txHash || p.tx_hash || null,
      totalSupply: p.totalSupply ?? ((hit && (hit.platform === 'flap' || hit.platform === 'gang')) ? 1e9 : null),
    };
  }

  const rows = [];
  for (const [addr, s] of firstByToken) {
    const t0 = new Date(s.created_at).getTime();
    const all = await loadAllTicks(addr);
    for (const r of all) r.bt = new Date(r.block_time).getTime();
    all.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
    const anchorRows = all.filter(r => r.bt <= t0).slice(-CAP);
    const fwd = all.filter(r => r.bt > t0);
    let anchorP = null;
    for (const r of anchorRows) if (r.price_bnb > 0) anchorP = r.price_bnb;
    if (!anchorP) continue;
    let rPeak = 0, r10 = 0, r30 = 0, rMin = 0, buy30 = 0, n30 = 0;
    for (const r of fwd) {
      if (!r.price_bnb) continue;
      const g = (r.price_bnb / anchorP - 1) * 100;
      if (g > rPeak) rPeak = g;
      if (g < rMin) rMin = g;
      if (r.bt <= t0 + 600e3 && g > r10) r10 = g;
      if (r.bt <= t0 + 1800e3 && g > r30) r30 = g;
      if (r.bt <= t0 + 1800e3) { n30++; if (r.trade_type === 'BUY') buy30 += r.bnb_amount || 0; }
    }
    if (anchorRows.length < 7) continue;
    const meta = { ...(await loadMeta(addr)), quoteToken: [...anchorRows].reverse().find(r => r.quote_token)?.quote_token || null };
    let d = null;
    try { d = buildSnapshotFromRows(anchorRows, meta, { capped: all.length > CAP, anchorTickCount: anchorRows.length }).derived; } catch { }
    if (!d || !LEG6(d)) continue;
    rows.push({
      addr, sym: s.token_symbol, t0, d, tf: (s.metadata || {}).trendFactors || {},
      rPeak, r10, r30, rMin, buy30, n30, golden: golden.has(addr),
    });
  }

  const R = rows.filter(r => r.rPeak >= 100);
  const M = rows.filter(r => r.rPeak >= 50 && r.rPeak < 100);
  const D = rows.filter(r => r.rPeak < 50);
  console.log(`\n「紧:全六腿」命中 ${rows.length} 票 = 右尾 ${R.length} + 中间 ${M.length} + 主体 ${D.length}\n`);
  const show = (title, arr, sortPeak) => {
    console.log(`=== ${title} ===`);
    arr.sort((a, b) => sortPeak ? b.rPeak - a.rPeak : a.t0 - b.t0);
    for (const r of arr) {
      const d = r.d, f = r.tf;
      console.log(`${r.addr.slice(0, 10)} ${(r.sym || '').slice(0, 9).padEnd(9)}${r.golden ? '★' : ' '} ${new Date(r.t0).toISOString().slice(5, 16)} | 买${d.totalBuyBnb.toFixed(1)}B/${d.buyN}笔/${d.walletCount}钱包 hold${d.posHolderCount} ath${((d.priceArc?.ath / d.priceArc?.first - 1) * 100 || 0).toFixed(0)}% | top1买${d.top1BuyPct.toFixed(1)}% HHI${d.holderHHI.toFixed(2)} nbs${d.noBuySellPct.toFixed(1)}% r60e${d.routerEntryBuyPct.toFixed(0)}% | curVs${(f.currentVsLaunchPct ?? -1).toFixed(0)}% dd${(f.drawdownFromHighest ?? 0).toFixed(0)}% | 峰+${r.rPeak.toFixed(0).padStart(4)}% (10m+${r.r10.toFixed(0).padStart(3)} 30m+${r.r30.toFixed(0).padStart(4)}) 最深${r.rMin.toFixed(0).padStart(4)}% | 后30m ${r.n30}行 买${r.buy30.toFixed(1)}B`);
    }
    console.log('');
  };
  show(`右尾（前向峰值≥100%）${R.length} 票`, R, true);
  show(`中间（50~100%）${M.length} 票`, M, true);
  show(`主体（<50%）${D.length} 票（峰值降序）`, D, true);

  const pk = D.map(r => r.rPeak).sort((a, b) => b - a);
  console.log('主体票峰值分布: ≥30%:' + pk.filter(x => x >= 30).length + ' 10~30%:' + pk.filter(x => x >= 10 && x < 30).length + ' <10%:' + pk.filter(x => x < 10).length);
  const mn = D.map(r => r.rMin).sort((a, b) => a - b);
  console.log('主体票最深回撤: p25 ' + mn[Math.floor(mn.length * .25)].toFixed(0) + '% / 中位 ' + mn[Math.floor(mn.length / 2)].toFixed(0) + '% / 最深 ' + mn[0].toFixed(0) + '%');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
