#!/usr/bin/env node
// JG-6 因子门合理性②：tail_dip_knife 被拦 375 票——右尾（前向峰值≥+100%）vs 主体（<+50%）
// 的被拦时刻因子快照分离度扫描（全键 AUC + 分布分位）。182 跑。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';

(async () => {
  const sb = dbManager.getClient();

  const { data: gd, error: eg } = await sb.from('case_collection_tokens')
    .select('token_address, token_meta')
    .eq('collection_id', 'a8414632-7c24-4762-9253-c49bb0f53105');
  if (eg) throw new Error(eg.message);
  const golden = new Map((gd || []).map(t => [t.token_address, ((t.token_meta || {}).symbol || '金狗')]));

  // 被 tail_dip_knife 拦的全部 BUY 信号（含因子快照）
  let sigs = [];
  {
    let from = 0;
    while (true) {
      const { data, error } = await sb.from('strategy_signals')
        .select('id, token_address, token_symbol, created_at, metadata')
        .eq('experiment_id', EXP)
        .eq('signal_type', 'BUY')
        .filter('metadata->>execution_reason', 'eq', 'factor_gate_tail_dip_knife')
        .order('id', { ascending: true }).range(from, from + 199);
      if (error) throw new Error('信号查询失败: ' + error.message);
      if (!data || !data.length) break;
      sigs.push(...data);
      if (data.length < 200) break;
      from += 200;
    }
  }
  const firstByToken = new Map();
  for (const s of sigs) if (!firstByToken.has(s.token_address)) firstByToken.set(s.token_address, s);
  console.log('被拦信号', sigs.length, '行 /', firstByToken.size, '票（首次快照+前向收益）');

  async function loadTicks(addr) {
    const rows = [];
    let from = 0;
    while (from < 30000) {
      const { data, error } = await sb.from('wss_price_ticks')
        .select('price_bnb, block_time')
        .eq('token_address', addr).order('id', { ascending: true }).range(from, from + 999);
      if (error) throw new Error('ticks 查询失败: ' + error.message);
      if (!data || !data.length) break;
      rows.push(...data);
      if (data.length < 1000) break;
      from += 1000;
    }
    for (const r of rows) r.t = new Date(r.block_time).getTime();
    rows.sort((a, b) => a.t - b.t);
    return rows;
  }

  const rows = [];
  for (const [addr, s] of firstByToken) {
    const t0 = new Date(s.created_at).getTime();
    const ticks = await loadTicks(addr);
    let anchor = null;
    for (const r of ticks) if (r.t <= t0 && r.price_bnb > 0) anchor = r;
    if (!anchor || !anchor.price_bnb) continue;
    let rPeak = 0;
    for (const r of ticks) {
      if (r.t <= t0 || !r.price_bnb) continue;
      const gain = (r.price_bnb / anchor.price_bnb - 1) * 100;
      if (gain > rPeak) rPeak = gain;
    }
    const tf = (s.metadata || {}).trendFactors || {};
    rows.push({ addr, sym: s.token_symbol, rPeak, tf, golden: golden.has(addr) });
  }

  const right = rows.filter(r => r.rPeak >= 100);
  const mid = rows.filter(r => r.rPeak >= 50 && r.rPeak < 100);
  const main = rows.filter(r => r.rPeak < 50);
  console.log(`分组: 右尾≥100% ${right.length} 票（金狗 ${right.filter(r => r.golden).length}） / 中间50~100 ${mid.length} / 主体<50 ${main.length}`);

  // 全键 AUC 扫描（右尾=1 vs 主体=0）
  const keys = new Set();
  for (const r of rows) for (const k of Object.keys(r.tf)) keys.add(k);
  const aucResults = [];
  for (const k of keys) {
    const rv = right.map(r => r.tf[k]).filter(v => typeof v === 'number' && isFinite(v));
    const mv = main.map(r => r.tf[k]).filter(v => typeof v === 'number' && isFinite(v));
    if (rv.length < right.length * 0.6 || mv.length < main.length * 0.6) continue;
    if (rv.length < 10 || mv.length < 10) continue;
    const rSorted = [...rv].sort((a, b) => a - b);
    const mSorted = [...mv].sort((a, b) => a - b);
    // Mann-Whitney AUC：P(右尾值 > 主体值)+0.5P(=)
    let u = 0;
    for (const x of rv) for (const y of mv) u += x > y ? 1 : (x === y ? 0.5 : 0);
    const auc = u / (rv.length * mv.length);
    const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
    aucResults.push({
      key: k, auc,
      rMed: q(rSorted, 0.5), mMed: q(mSorted, 0.5),
      rP25: q(rSorted, 0.25), rP75: q(rSorted, 0.75),
      mP25: q(mSorted, 0.25), mP75: q(mSorted, 0.75),
    });
  }
  aucResults.sort((a, b) => Math.abs(b.auc - 0.5) - Math.abs(a.auc - 0.5));
  console.log('\n=== 全键 AUC 排序 top 30（|AUC-0.5| 大=分离好；AUC<0.5=右尾该键更小） ===');
  for (const a of aucResults.slice(0, 30)) {
    console.log(`${a.key.padEnd(34)} AUC=${a.auc.toFixed(3)} | 右尾[${a.rP25.toExponential(2)} ~ ${a.rMed.toExponential(2)} ~ ${a.rP75.toExponential(2)}] 主体[${a.mP25.toExponential(2)} ~ ${a.mMed.toExponential(2)} ~ ${a.mP75.toExponential(2)}]`);
  }

  // 右尾票明细（供形状解读）
  console.log('\n=== 右尾 34 票明细（供形状解读） ===');
  right.sort((a, b) => b.rPeak - a.rPeak);
  for (const r of right) {
    const f = r.tf;
    console.log(`${r.addr.slice(0, 8)} ${(r.sym || '').slice(0, 8).padEnd(8)} 峰+${String(r.rPeak.toFixed(0)).padStart(5)}% ${r.golden ? '★' : ' '}| buyVol${(f.buyVolumeBnb ?? -1).toFixed(1)}B 钱包${f.buyWallets ?? '?'} hold${f.holdersExDust ?? '?'} top1${(f.top1HolderCircPct ?? -1).toFixed(0)}% r60${(f.tradesRouterPct ?? -1).toFixed(0)} age${Math.round((f.tokenAgeSec ?? -1))}s curVs${(f.currentVsLaunchPct ?? -1).toFixed(0)}% dd${(f.drawdownFromHighest ?? -1).toFixed(0)}%`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
