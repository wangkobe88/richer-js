#!/usr/bin/env node
// JG-6 因子门合理性③：tail_dip 被拦人群组合豁免形状网格——覆盖右尾/误伤主体/接刀深度。182 跑。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';

(async () => {
  const sb = dbManager.getClient();
  const { data: gd } = await sb.from('case_collection_tokens')
    .select('token_address').eq('collection_id', 'a8414632-7c24-4762-9253-c49bb0f53105');
  const golden = new Set((gd || []).map(t => t.token_address));

  let sigs = [];
  let from = 0;
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

  async function loadTicks(addr) {
    const rows = []; let f = 0;
    while (f < 30000) {
      const { data, error } = await sb.from('wss_price_ticks')
        .select('price_bnb, block_time').eq('token_address', addr)
        .order('id', { ascending: true }).range(f, f + 999);
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      rows.push(...data);
      if (data.length < 1000) break;
      f += 1000;
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
    let rPeak = 0, rMin = 0;
    for (const r of ticks) {
      if (r.t <= t0 || !r.price_bnb) continue;
      const g = (r.price_bnb / anchor.price_bnb - 1) * 100;
      if (g > rPeak) rPeak = g;
      if (g < rMin) rMin = g;
    }
    rows.push({ addr, rPeak, rMin, tf: (s.metadata || {}).trendFactors || {}, golden: golden.has(addr) });
  }
  const right = rows.filter(r => r.rPeak >= 100), mid = rows.filter(r => r.rPeak >= 50 && r.rPeak < 100), main = rows.filter(r => r.rPeak < 50);
  console.log(`右尾 ${right.length} / 中间 ${mid.length} / 主体 ${main.length}`);

  const C = {
    'hold>=6': f => f.holdersExDust >= 6,
    'hold>=8': f => f.holdersExDust >= 8,
    'hold>=6 ∧ top2≤60': f => f.holdersExDust >= 6 && f.top2HolderCircPct <= 60,
    'hold>=6 ∧ top1≤35': f => f.holdersExDust >= 6 && f.top1HolderCircPct <= 35,
    'hold>=6 ∧ curVs≥10': f => f.holdersExDust >= 6 && f.currentVsLaunchPct >= 10,
    'hold>=6 ∧ earlyRet≥0': f => f.holdersExDust >= 6 && f.earlyReturn >= 0,
    'hold>=6 ∧ top2≤60 ∧ earlyRet≥0': f => f.holdersExDust >= 6 && f.top2HolderCircPct <= 60 && f.earlyReturn >= 0,
    'hold>=7 ∧ rise>0': f => f.holdersExDust >= 7 && f.riseSpeed > 0,
    'buyW≥20 ∧ top2≤60': f => f.buyWallets >= 20 && f.top2HolderCircPct <= 60,
    'hold>=6 ∧ r60≥60': f => f.holdersExDust >= 6 && f.tradesRouterPct >= 60,
    'hold>=6 ∧ top2≤60 ∧ r60≥60': f => f.holdersExDust >= 6 && f.top2HolderCircPct <= 60 && f.tradesRouterPct >= 60,
    'hold>=6 ∧ grad≥0.03': f => f.holdersExDust >= 6 && f.graduationProgress >= 0.03,
    'hold>=6 ∧ mcap≥5.8e6': f => f.holdersExDust >= 6 && f.marketCap >= 5.8e6,
  };
  console.log('\n=== 候选形状：右尾覆盖 | 主体命中（误伤面）| 命中主体的接刀深度 ===');
  for (const [name, fn] of Object.entries(C)) {
    const hitR = right.filter(r => fn(r.tf));
    const hitM = main.filter(r => fn(r.tf));
    const hitMid = mid.filter(r => fn(r.tf));
    const mPeaks = hitM.map(r => r.rPeak).sort((a, b) => a - b);
    const mMed = mPeaks.length ? mPeaks[Math.floor(mPeaks.length / 2)] : 0;
    const mMin = hitM.map(r => r.rMin).sort((a, b) => a - b);
    const worst = mMin.length ? mMin[0] : 0;
    const gd5 = hitR.filter(r => r.golden).length;
    console.log(`${name.padEnd(28)} 右尾 ${String(hitR.length).padStart(2)}/${right.length}（金狗${gd5}/6） 主体 ${String(hitM.length).padStart(3)}/${main.length}(${(hitM.length / main.length * 100).toFixed(0)}%) 中间 ${hitMid.length}/${mid.length} | 命中主体: 峰中位+${mMed.toFixed(0)}% 最深${worst.toFixed(0)}%`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
