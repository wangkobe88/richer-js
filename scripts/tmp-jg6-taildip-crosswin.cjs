#!/usr/bin/env node
// JG-6 四窗跨验：指定实验的 tail_dip 被拦人群重放用户形状（LEG6+精化腿）。
// 用法：node tmp-jg6-taildip-crosswin.cjs <experimentId> <label>。182 跑。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');
const { buildSnapshotFromRows } = require('../src/market-analysis/cheat-snapshot.js');

const EXP = process.argv[2];
const LABEL = process.argv[3] || EXP.slice(0, 8);
const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
const CAP = 3000;
const LEG6 = d => (d.washPairCount ?? 0) === 0 && (d.noBuySellPct ?? 100) < 10 && (d.holderHHI ?? 1) < 0.2
  && d.totalBuyBnb >= 3 && (d.routerEntryBuyPct ?? 0) >= 60 && (d.top1BuyPct ?? 100) < 15;
const FAM = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '../config/rosters/famous-copy-wallets.json'), 'utf8')).wallets.map(w => w.toLowerCase()));

(async () => {
  const sb = dbManager.getClient();
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
  console.log(`[${LABEL}] tail_dip 被拦 ${sigs.length} 行 / ${firstByToken.size} 票`);

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
    if (!anchorP || anchorRows.length < 7) { if (++done % 80 === 0) console.error(`  …${done}`); continue; }
    let rPeak = 0;
    for (const r of fwd) if (r.price_bnb > 0) {
      const g = (r.price_bnb / anchorP - 1) * 100;
      if (g > rPeak) rPeak = g;
    }
    const meta = { ...(await loadMeta(addr)), quoteToken: [...anchorRows].reverse().find(r => r.quote_token)?.quote_token || null };
    let d = null;
    try { d = buildSnapshotFromRows(anchorRows, meta, { capped: all.length > CAP, anchorTickCount: anchorRows.length }).derived; } catch { }
    if (!d || !LEG6(d)) { if (++done % 80 === 0) console.error(`  …${done}`); continue; }
    const W = r => ((r.sender_address || r.trader_address) || '').toLowerCase();
    let famBuyBnb = 0, famSellBnb = 0;
    const famBuyBlocks = new Set();
    const buyWalletsByBlock = new Map();
    for (const r of anchorRows) {
      const w = W(r), isB = (r.trade_type || '').toUpperCase() === 'BUY';
      if (isB) {
        const set = buyWalletsByBlock.get(r.block_number) || new Set();
        set.add(w); buyWalletsByBlock.set(r.block_number, set);
        if (FAM.has(w)) { famBuyBnb += r.bnb_amount || 0; famBuyBlocks.add(r.block_number); }
      } else if (FAM.has(w)) famSellBnb += r.bnb_amount || 0;
    }
    let maxFamCohort = 0;
    for (const b of famBuyBlocks) {
      let c = 0;
      for (const w of (buyWalletsByBlock.get(b) || new Set())) if (!FAM.has(w)) c++;
      if (c > maxFamCohort) maxFamCohort = c;
    }
    const tf = (s.metadata || {}).trendFactors || {};
    rows.push({
      addr, sym: s.token_symbol, rPeak, d, tf,
      famBuyBnb, maxFamCohort,
      buyBnb: d.totalBuyBnb,
      bundleHold: tf.bundleClusterHoldCircPct ?? tf.top2BundleClusterHoldCircPct ?? null,
    });
    if (++done % 80 === 0) console.error(`  …${done}/${firstByToken.size}`);
  }

  const R = rows.filter(r => r.rPeak >= 100), M = rows.filter(r => r.rPeak >= 50 && r.rPeak < 100), D = rows.filter(r => r.rPeak < 50);
  console.log(`[${LABEL}] LEG6 命中 ${rows.length} 票 = 右尾 ${R.length} + 中间 ${M.length} + 主体 ${D.length}`);
  const leg8 = r => r.buyBnb <= 8;
  const legB = r => r.bundleHold !== null && r.bundleHold <= 40;
  const legC = r => r.maxFamCohort <= 3;
  const legF = r => r.famBuyBnb >= 0.1;
  const combos = {
    'LEG6': () => true,
    '+总量≤8B': r => leg8(r),
    '+捆绑≤40': r => leg8(r) && legB(r),
    '+跟单≤3(推荐)': r => leg8(r) && legB(r) && legC(r),
    '+fam参与': r => leg8(r) && legB(r) && legC(r) && legF(r),
    '最终版(4腿)': r => leg8(r) && legB(r) && legC(r) && legF(r),
  };
  for (const [name, fn] of Object.entries(combos)) {
    const hr = R.filter(fn), hm = D.filter(fn), hmid = M.filter(fn);
    const peaks = hm.map(r => r.rPeak).sort((a, b) => b - a);
    console.log(`${name.padEnd(16)} 右尾 ${String(hr.length).padStart(2)}/${R.length} | 主体 ${String(hm.length).padStart(3)}/${D.length} 中间 ${hmid.length}/${M.length} | 命中主体峰: ≥30%:${peaks.filter(x => x >= 30).length} 10~30:${peaks.filter(x => x >= 10 && x < 30).length} <10:${peaks.filter(x => x < 10).length}`);
  }
  const top = [...rows].sort((a, b) => b.rPeak - a.rPeak);
  console.log('=== 最终版(4腿)命中全部票（完整地址） ===');
  for (const r of top.filter(r => leg8(r) && legB(r) && legC(r) && legF(r))) console.log(`SHAPE ${r.addr} ${(r.sym || '').replace(/\s+/g, '_')} 峰+${r.rPeak.toFixed(0)}% act=${r.d.activityLevel ?? '-'}${r.d.activityUneven ? '~起伏' : ''} 吞吐${(r.d.actWeightedThroughputBnbPerMin ?? -1).toFixed(1)}B/min 总买${r.buyBnb.toFixed(1)}B fam买${r.famBuyBnb.toFixed(2)}B 捆绑${r.bundleHold === null ? '-' : r.bundleHold.toFixed(0) + '%'} 跟单${r.maxFamCohort}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
