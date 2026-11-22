#!/usr/bin/env node
// 一次性（本地小结果）：0xf38f 登摩羯（登天猫）bt-v177 FP 拒后锚点序列重放。
// 拒点 05:50:32（big_buy_defer，距首笔 19s<45s 线）→ 45s 线过（≈05:50:58）后 FP 是否放行；
// 用现行 FP 代码 + 生产灰度 enableTailDipExempt:true，锚点从拒点起每 4s 一个到 05:51:40。
// 另输出前向 5min/30min 峰值与毕业信息，量化错过成本。只读。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot');
const M = require('../src/market-analysis/factor-pre-buy-check');

const TOKEN = '0xf38f48cfe9e84920e7de4d47823a0fba95a87777';
const FROM = '2026-10-04T05:50:00Z', TO = '2026-10-04T06:40:00Z';
const ANCHORS = [];
for (let t = Date.parse('2026-10-04T05:50:32Z'); t <= Date.parse('2026-10-04T05:51:40Z'); t += 4000) ANCHORS.push(new Date(t).toISOString());

(async () => {
  const sb = dbManager.getClient();
  console.log('FP 版本:', M.FACTOR_PREBUY_VERSION);
  const [{ data: rowsAll, error }, { data: evs }, { data: grads }] = await Promise.all([
    sb.from('wss_price_ticks').select('block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token')
      .eq('token_address', TOKEN).gte('block_time', FROM).lte('block_time', TO)
      .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(20000),
    sb.from('wss_events').select('platform,payload,block_time').eq('kind', 'token_create').eq('token_address', TOKEN).order('id', { ascending: true }).limit(5),
    sb.from('wss_events').select('block_time').eq('kind', 'graduation').eq('token_address', TOKEN).limit(2),
  ]);
  if (error) throw new Error(error.message);
  const hit = (evs || []).find(r => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
  const p = hit ? hit.payload : {};
  const meta = {
    address: TOKEN, symbol: p.symbol || null, name: p.name || null,
    platform: hit ? hit.platform : null,
    createdAt: p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null),
    creatorAddress: p.creator || null, createTxHash: p.txHash || p.tx_hash || null,
    totalSupply: p.totalSupply ?? ((hit && (hit.platform === 'flap' || hit.platform === 'gang')) ? 1e9 : null),
  };
  const rows = rowsAll || [];
  console.log(`创建: ${meta.createdAt} platform=${meta.platform} symbol=${meta.symbol} | ticks=${rows.length} | 毕业: ${grads && grads[0] ? grads[0].block_time : '无'}`);
  const firstTick = rows[0];
  console.log(`首 tick: ${firstTick ? firstTick.block_time : '无'}（45s 线 ≈ ${firstTick ? new Date(Date.parse(firstTick.block_time) + 45000).toISOString().slice(11, 19) : '?'}）`);
  for (const anchorIso of ANCHORS) {
    const win = rows.filter(r => r.block_time <= anchorIso);
    if (win.length < 3) { console.log(`@${anchorIso.slice(11, 19)} 行不足跳过`); continue; }
    let snap;
    try { snap = buildBuyPointSnapshot(win, meta, { famousRoster: undefined }); } catch (e) { console.log(`@${anchorIso.slice(11, 19)} SNAP FAIL: ${e.message}`); continue; }
    const r = M.evaluateFactorPreBuy(snap, { enableTailDipExempt: true });
    const d = snap.buyDerived || {};
    const fmt = (x) => (x === null || x === undefined) ? 'null' : (typeof x === 'number' ? x.toFixed(2) : x);
    const gateRows = (r.gates || []).filter(g => g.hit).map(g => `${g.id}[${g.value}]`);
    const deferGate = (r.gates || []).find(g => g.id === 'big_buy_defer');
    console.log(`@${anchorIso.slice(11, 19)} rows=${win.length} → pass=${r.pass} arms=${JSON.stringify(r.arms || [])} 命中: ${gateRows.join(' | ') || '(无)'}`);
    console.log(`   curVs=${fmt(d.currentVsLaunchPct)} ath=${fmt(d.athVsLaunchPct)} actTotal=${fmt(d.actTotalBnb ?? d.act?.totalBnb)} age=${fmt(d.tokenAgeSec)} | defer:${deferGate ? deferGate.value : 'n/a'}`);
  }
  // 拒点与 45s 线后的前向收益（剔 outlier 可靠价）
  const rel = rows.filter(x => !x.price_outlier && x.price_bnb);
  for (const [label, iso] of [['拒点 05:50:32', '2026-10-04T05:50:32Z'], ['45s线后 05:51:00', '2026-10-04T05:51:00Z'], ['05:51:30', '2026-10-04T05:51:30Z']]) {
    const aT = Date.parse(iso);
    const base = Number((rel.filter(x => Date.parse(x.block_time) <= aT).slice(-1)[0] || {}).price_bnb || 0);
    if (!base) { console.log(`${label}: 无锚价`); continue; }
    for (const mins of [5, 30]) {
      const fwd = rel.filter(x => Date.parse(x.block_time) > aT && Date.parse(x.block_time) <= aT + mins * 60 * 1000);
      if (!fwd.length) continue;
      let peak = 0, peakT = '', low = Infinity;
      for (const f of fwd) { const px = Number(f.price_bnb); if (px > peak) { peak = px; peakT = f.block_time.slice(11, 19); } if (px < low) low = px; }
      console.log(`${label} → 前向${mins}min: base=${base.toExponential(4)} peak=${peak.toExponential(4)}@${peakT} (+${((peak / base - 1) * 100).toFixed(1)}%) 低点${low.toExponential(4)} (${((low / base - 1) * 100).toFixed(1)}%)`);
    }
  }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
