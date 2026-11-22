#!/usr/bin/env node
// JG-6c 抄底门研究①：三窗被崩塌域四臂（tail_dip/tail_no_buyer/lifecycle_sell/lifecycle_burst）
// 拦截的全集——前向结局 × 首拦臂矩阵 + derived 快照落盘（供形状分析）。182 跑，后台。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');
const { buildSnapshotFromRows } = require('../src/market-analysis/cheat-snapshot.js');

const CORE = {
  factor_gate_tail_dip_knife: 'tail_dip',
  factor_gate_tail_no_buyer_pressure: 'tail_no_buyer',
  factor_gate_lifecycle_sell_residual: 'lifecycle_sell',
  factor_gate_lifecycle_burst_residual: 'lifecycle_burst',
};
const WINS = ['9e9163de-a677-4d39-9c33-9ec9df05e400', 'ce102e94-293c-4f8f-af98-cd06f4b0e98c', 'dddbe79e-480a-402a-aa35-85a72d2f591e'];
const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
const CAP = 3000;

(async () => {
  const sb = dbManager.getClient();
  // 首拦（票级：最早命中四臂之一的时刻+臂）
  const byArm = new Map();
  for (const exp of WINS) {
    let from = 0;
    while (true) {
      const { data, error } = await sb.from('strategy_signals')
        .select('token_address, created_at, metadata').eq('experiment_id', exp).eq('signal_type', 'BUY')
        .order('created_at', { ascending: true }).range(from, from + 499);
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      for (const s of data) {
        const er = (s.metadata || {}).execution_reason;
        if (!er || !(er in CORE)) continue;
        const e = byArm.get(s.token_address);
        if (!e || new Date(s.created_at) < e.t) e && (e.t = new Date(s.created_at), e.arm = CORE[er]) || byArm.set(s.token_address, { t: new Date(s.created_at), arm: CORE[er] });
      }
      if (data.length < 500) break;
      from += 500;
    }
  }
  console.log('四臂研究域去重:', byArm.size, '票');

  async function loadAllTicks(addr) {
    const rows = []; let f = 0;
    while (f <= CAP) {
      const { data, error } = await sb.from('wss_price_ticks').select(TICK_COLS).eq('token_address', addr)
        .order('id', { ascending: true }).range(f, f + 999);
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      rows.push(...data); if (data.length < 1000) break; f += 1000;
    }
    return rows;
  }
  async function loadMeta(addr) {
    const { data } = await sb.from('wss_events').select('platform,payload,block_time')
      .eq('kind', 'token_create').eq('token_address', addr).order('id', { ascending: true }).limit(5);
    const hit = (data || []).find(r => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
    const p = hit ? hit.payload : {};
    return {
      address: addr, symbol: p.symbol || null, name: p.name || null, platform: hit ? hit.platform : null,
      createdAt: p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null),
      creatorAddress: p.creator || null, createTxHash: p.txHash || p.tx_hash || null,
      totalSupply: p.totalSupply ?? ((hit && (hit.platform === 'flap' || hit.platform === 'gang')) ? 1e9 : null),
      quoteToken: null,
    };
  }

  const out = [];
  let done = 0;
  for (const [addr, e0] of byArm) {
    const t0 = e0.t.getTime();
    const all = await loadAllTicks(addr);
    for (const r of all) r.bt = new Date(r.block_time).getTime();
    all.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
    const anchorRows = all.filter(r => r.bt <= t0).slice(-CAP);
    const fwd = all.filter(r => r.bt > t0);
    let anchorP = null;
    for (const r of anchorRows) if (r.price_bnb > 0) anchorP = r.price_bnb;
    const rec = { addr, arm: e0.arm, t0: e0.t.toISOString(), anchorN: anchorRows.length };
    if (anchorP) {
      let rPeak = 0, r30 = 0, rMin = 0, nAfter = 0;
      for (const r of fwd) {
        if (!r.price_bnb) continue;
        nAfter++;
        const g = (r.price_bnb / anchorP - 1) * 100;
        if (g > rPeak) rPeak = g;
        if (g < rMin) rMin = g;
        if (r.bt <= t0 + 1800e3 && g > r30) r30 = g;
      }
      Object.assign(rec, { rPeak: +rPeak.toFixed(1), r30: +r30.toFixed(1), rMin: +rMin.toFixed(1), nAfter });
    } else { rec.rPeak = null; }
    // derived 快照
    if (anchorRows.length >= 7) {
      const meta = await loadMeta(addr);
      meta.quoteToken = [...anchorRows].reverse().find(r => r.quote_token)?.quote_token || null;
      try {
        const d = buildSnapshotFromRows(anchorRows, meta, { capped: all.length > CAP, anchorTickCount: anchorRows.length }).derived;
        rec.d = {
          washPairCount: d.washPairCount ?? null, noBuySellPct: d.noBuySellPct ?? null, holderHHI: d.holderHHI ?? null,
          totalBuyBnb: d.totalBuyBnb ?? null, routerEntryBuyPct: d.routerEntryBuyPct ?? null, top1BuyPct: d.top1BuyPct ?? null,
          sameBlockHoldCircPct: d.sameBlockHoldCircPct ?? null, posHolderCount: d.posHolderCount ?? null,
          anchorBuySellRatio: d.anchorBuySellRatio ?? null, circSupplyPct: d.circSupplyPct ?? null,
          athPct: d.priceArc ? +(((d.priceArc.ath / d.priceArc.first) - 1) * 100).toFixed(1) : null,
          athDt: d.priceArc?.athDt ?? null, spanSec: d.spanSec ?? null,
          churn60s: d.churn60sWalletCount ?? null, buyMedianBnb: d.buyMedianBnb ?? null,
          clusterRoundTripPct: d.clusterRoundTripPct ?? null, noBuySellVolumePct: d.noBuySellVolumePct ?? null,
          burstWaveBuyBnb: d.burstWaveBuyBnb ?? null, nearDumpQualBlocks: d.nearDumpQualBlocks ?? null,
          nearTail10TickN: d.nearTail10TickN ?? null, actThroughput: d.actWeightedThroughputBnbPerMin ?? null,
          creatorPeakHoldPct: d.creatorPeakHoldSupplyPct ?? null, buyN: d.buyN ?? null, walletCount: d.walletCount ?? null,
          gradPct: d.graduationProgress ?? null, sellBnb: d.totalSellBnb ?? null,
        };
      } catch { }
    }
    out.push(rec);
    if (++done % 100 === 0) { console.log('…' + done + '/' + byArm.size); fs.writeFileSync('/tmp/jg6c-rows.json', JSON.stringify(out)); }
  }
  fs.writeFileSync('/tmp/jg6c-rows.json', JSON.stringify(out));

  // 矩阵：臂 × 前向峰值桶
  const buckets = r => r.rPeak == null ? '无锚' : r.rPeak >= 100 ? '≥100%' : r.rPeak >= 50 ? '50-100' : r.rPeak >= 10 ? '10-50' : '<10%';
  const arms = [...new Set(out.map(r => r.arm))];
  console.log('\n=== 臂 × 前向峰值桶（票数）===');
  console.log('臂'.padEnd(16), '≥100%', '50-100', '10-50', '<10%', '无锚', '合计');
  for (const a of arms) {
    const sub = out.filter(r => r.arm === a);
    const cnt = b => sub.filter(r => buckets(r) === b).length;
    console.log(a.padEnd(16), String(cnt('≥100%')).padStart(4), String(cnt('50-100')).padStart(5), String(cnt('10-50')).padStart(5), String(cnt('<10%')).padStart(4), String(cnt('无锚')).padStart(3), sub.length);
  }
  console.log('\n明细已落盘 /tmp/jg6c-rows.json（' + out.length + ' 票，含 derived 快照）');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
