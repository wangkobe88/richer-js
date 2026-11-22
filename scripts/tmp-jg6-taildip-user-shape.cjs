#!/usr/bin/env node
// JG-6 用户理念版：LEG6 命中 62 票的量能/famous参与/同块跟单/捆绑持仓/流量结构画像 + 精化腿网格。
// 锚=首次被拦时刻。182 跑。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');
const { buildSnapshotFromRows } = require('../src/market-analysis/cheat-snapshot.js');

const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
const CAP = 3000;
const LEG6 = d => (d.washPairCount ?? 0) === 0 && (d.noBuySellPct ?? 100) < 10 && (d.holderHHI ?? 1) < 0.2
  && d.totalBuyBnb >= 3 && (d.routerEntryBuyPct ?? 0) >= 60 && (d.top1BuyPct ?? 100) < 15;

const FAM = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '../config/rosters/famous-copy-wallets.json'), 'utf8')).wallets.map(w => w.toLowerCase()));

(async () => {
  const sb = dbManager.getClient();
  const { data: gd } = await sb.from('case_collection_tokens')
    .select('token_address').eq('collection_id', 'a8414632-7c24-4762-9253-c49bb0f53105');
  const golden = new Set((gd || []).map(t => t.token_address));

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
    if (!anchorP || anchorRows.length < 7) continue;
    let rPeak = 0;
    for (const r of fwd) if (r.price_bnb > 0) {
      const g = (r.price_bnb / anchorP - 1) * 100;
      if (g > rPeak) rPeak = g;
    }
    const meta = { ...(await loadMeta(addr)), quoteToken: [...anchorRows].reverse().find(r => r.quote_token)?.quote_token || null };
    let d = null;
    try { d = buildSnapshotFromRows(anchorRows, meta, { capped: all.length > CAP, anchorTickCount: anchorRows.length }).derived; } catch { }
    if (!d || !LEG6(d)) continue;

    // ── famous 维度（wallet=sender||trader）──
    const W = r => ((r.sender_address || r.trader_address) || '').toLowerCase();
    let famBuyBnb = 0, famSellBnb = 0, famBuyN = 0;
    const famBuyBlocks = new Set();
    const buyWalletsByBlock = new Map();
    for (const r of anchorRows) {
      const w = W(r), isB = (r.trade_type || '').toUpperCase() === 'BUY';
      if (isB) {
        const set = buyWalletsByBlock.get(r.block_number) || new Set();
        set.add(w); buyWalletsByBlock.set(r.block_number, set);
        if (FAM.has(w)) { famBuyBnb += r.bnb_amount || 0; famBuyN++; famBuyBlocks.add(r.block_number); }
      } else if (FAM.has(w)) famSellBnb += r.bnb_amount || 0;
    }
    // famous 买块的同块跟单（非 famous 同块买钱包数）max
    let maxFamCohort = 0, sumFamCohort = 0;
    for (const b of famBuyBlocks) {
      const ws = buyWalletsByBlock.get(b) || new Set();
      let cohort = 0;
      for (const w of ws) if (!FAM.has(w)) cohort++;
      if (cohort > maxFamCohort) maxFamCohort = cohort;
      sumFamCohort += cohort;
    }
    // ── 量能结构 ──
    const tf = (s.metadata || {}).trendFactors || {};
    const lastBt = anchorRows[anchorRows.length - 1]?.bt ?? t0;
    let tail30Bnb = 0, tail60Bnb = 0;
    for (const r of anchorRows) {
      if (r.bt > lastBt - 30000) tail30Bnb += r.bnb_amount || 0;
      if (r.bt > lastBt - 60000) tail60Bnb += r.bnb_amount || 0;
    }
    // 等额同块簇买额占比（bot 流量代理）
    let eqClusterBnb = 0;
    if (Array.isArray(d.exactEqualBlockClusters)) for (const c of d.exactEqualBlockClusters) eqClusterBnb += c.sumBnb || 0;
    rows.push({
      addr, sym: s.token_symbol, rPeak, golden: golden.has(addr), d, tf,
      famBuyBnb, famSellBnb, famBuyN, maxFamCohort, sumFamCohort,
      tail30Bnb, tail60Bnb, eqPct: d.totalBuyBnb > 0 ? eqClusterBnb / d.totalBuyBnb * 100 : 0,
      buyBnb: d.totalBuyBnb, bundleHold: tf.bundleClusterHoldCircPct ?? tf.top2BundleClusterHoldCircPct ?? null,
      athDt: d.priceArc?.athDt ?? null, spanSec: d.spanSec,
    });
  }

  rows.sort((a, b) => b.rPeak - a.rPeak);
  console.log(`\nLEG6+画像 ${rows.length} 票（峰降序）\n`);
  for (const r of rows) {
    console.log(`${r.addr.slice(0, 8)} ${(r.sym || '').slice(0, 8).padEnd(8)}${r.golden ? '★' : ' '} 峰+${String(r.rPeak.toFixed(0)).padStart(4)}% | 总买${r.buyBnb.toFixed(1)}B 笔均${(r.buyBnb / Math.max(1, r.d.buyN)).toFixed(2)}B | fam买${r.famBuyBnb.toFixed(2)}B/${r.famBuyN}笔 净${(r.famBuyBnb - r.famSellBnb).toFixed(2)}B 同块跟单max${r.maxFamCohort}Σ${r.sumFamCohort} | 捆绑hold${r.bundleHold === null ? '-' : r.bundleHold.toFixed(0) + '%'} 等额簇${r.eqPct.toFixed(0)}% | ath@${r.athDt}s 跨${r.spanSec}s 尾30s${r.tail30Bnb.toFixed(2)}B`);
  }

  // ── 精化腿网格 ──
  const leg = {
    '总量≤8B': r => r.buyBnb <= 8,
    '总量≤10B': r => r.buyBnb <= 10,
    'fam参与≥0.1B': r => r.famBuyBnb >= 0.1,
    'fam同块跟单max≤3': r => r.maxFamCohort <= 3,
    '捆绑hold≤35%': r => r.bundleHold !== null && r.bundleHold <= 35,
    '等额簇≤40%': r => r.eqPct <= 40,
    '尾30s≤0.5B(量衰减)': r => r.tail30Bnb <= 0.5,
    'ath@≤60s(峰在开盘段)': r => r.athDt !== null && r.athDt <= 60,
  };
  const combos = {
    'LEG6+总量≤8B': r => leg['总量≤8B'](r),
    '+fam参与': r => leg['总量≤8B'](r) && leg['fam参与≥0.1B'](r),
    '+fam参与+跟单≤3': r => leg['总量≤8B'](r) && leg['fam参与≥0.1B'](r) && leg['fam同块跟单max≤3'](r),
    '+捆绑≤35': r => leg['总量≤8B'](r) && leg['fam参与≥0.1B'](r) && leg['fam同块跟单max≤3'](r) && leg['捆绑hold≤35%'](r),
    '+等额簇≤40': r => leg['总量≤8B'](r) && leg['fam参与≥0.1B'](r) && leg['fam同块跟单max≤3'](r) && leg['捆绑hold≤35%'](r) && leg['等额簇≤40%'](r),
    '+尾30s≤0.5B': r => leg['总量≤8B'](r) && leg['fam参与≥0.1B'](r) && leg['fam同块跟单max≤3'](r) && leg['捆绑hold≤35%'](r) && leg['等额簇≤40%'](r) && leg['尾30s≤0.5B(量衰减)'](r),
  };
  console.log('\n=== 精化腿网格（在 LEG6 62 票上叠加） ===');
  const R = rows.filter(r => r.rPeak >= 100), M = rows.filter(r => r.rPeak >= 50 && r.rPeak < 100), D = rows.filter(r => r.rPeak < 50);
  for (const [name, fn] of Object.entries(combos)) {
    const hr = R.filter(fn), hm = D.filter(fn), hmid = M.filter(fn);
    console.log(`${name.padEnd(24)} 右尾 ${hr.length}/${R.length}${hr.length ? '（剔:' + R.filter(r => !fn(r)).map(r => (r.sym || r.addr.slice(0, 6)).replace(/\s+/g, '')).join(',') + '）' : ''} | 主体 ${hm.length}/${D.length} 中间 ${hmid.length}/${M.length}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
