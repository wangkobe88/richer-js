#!/usr/bin/env node
// 一次性（本地小结果）：JG-19 双票 FP 单票重放（现行 FP40 代码 + 生产灰度 enableTailDipExempt:true）
// 0xc0e8 쿠우타 5 锚点 / 0x2335 胖橘貓 3 锚点：真 snapshot + evaluateFactorPreBuy + 前向 30min 峰值 + 毕业。只读。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot');
const M = require('../src/market-analysis/factor-pre-buy-check');

const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
const JOBS = [
  {
    name: '쿠우타 0xc0e8（JG-6 案源）', token: '0xc0e896ddec43881055a25786c17fa5d5d6337777',
    from: '2026-10-03T02:28:30Z', to: '2026-10-03T03:10:00Z',
    anchors: ['2026-10-03T02:30:40Z', '2026-10-03T02:31:58Z', '2026-10-03T02:32:02Z', '2026-10-03T02:32:09Z', '2026-10-03T02:33:46Z'],
  },
  {
    name: '胖橘貓 0x2335（JG-19）', token: '0x2335bc4868817a216be949c545f9a7e550bf7777',
    from: '2026-10-03T05:31:00Z', to: '2026-10-03T06:20:00Z',
    anchors: ['2026-10-03T05:39:48Z', '2026-10-03T05:40:44Z', '2026-10-03T05:43:04Z'],
  },
];

(async () => {
  const sb = dbManager.getClient();
  console.log('FP 版本:', M.FACTOR_PREBUY_VERSION);
  for (const job of JOBS) {
    console.log(`\n========== ${job.name} ==========`);
    const [{ data: rowsAll, error }, { data: evs }, { data: grads }] = await Promise.all([
      sb.from('wss_price_ticks').select(TICK_COLS).eq('token_address', job.token)
        .gte('block_time', job.from).lte('block_time', job.to)
        .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(20000),
      sb.from('wss_events').select('platform,payload,block_time').eq('kind', 'token_create')
        .eq('token_address', job.token).order('id', { ascending: true }).limit(5),
      sb.from('wss_events').select('block_time').eq('kind', 'graduation').eq('token_address', job.token).limit(2),
    ]);
    if (error) throw new Error(error.message);
    const hit = (evs || []).find(r => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
    const p = hit ? hit.payload : {};
    const meta = {
      address: job.token, symbol: p.symbol || null, name: p.name || null,
      platform: hit ? hit.platform : null,
      createdAt: p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null),
      creatorAddress: p.creator || null, createTxHash: p.txHash || p.tx_hash || null,
      totalSupply: p.totalSupply ?? ((hit && (hit.platform === 'flap' || hit.platform === 'gang')) ? 1e9 : null),
    };
    console.log(`创建: ${meta.createdAt} platform=${meta.platform} symbol=${meta.symbol} | ticks=${(rowsAll || []).length} | 毕业事件: ${grads && grads[0] ? grads[0].block_time : '无'}`);
    const rows = (rowsAll || []);
    for (const anchorIso of job.anchors) {
      const win = rows.filter(r => r.block_time <= anchorIso);
      if (win.length < 3) { console.log(`@${anchorIso.slice(11, 19)} 行不足跳过`); continue; }
      let snap;
      try { snap = buildBuyPointSnapshot(win, meta, { famousRoster: undefined }); } catch (e) { console.log(`@${anchorIso.slice(11, 19)} SNAP FAIL: ${e.message}`); continue; }
      const r = M.evaluateFactorPreBuy(snap, { enableTailDipExempt: true });
      const d = snap.buyDerived || {};
      const fmt = (x) => (x === null || x === undefined) ? 'null' : (typeof x === 'number' ? x.toFixed(2) : x);
      const gateRows = (r.gates || []).filter(g => g.hit).map(g => `${g.id}[${g.value}]`);
      console.log(`@${anchorIso.slice(11, 19)} rows=${win.length} → pass=${r.pass} reason=${r.reason} arms=${JSON.stringify(r.arms || [])}`);
      console.log(`   curVs=${fmt(d.currentVsLaunchPct)} minVsFloor=${fmt(d.launchMinVsFloorPct)} athVsLaunch=${fmt(d.athVsLaunchPct)} actTotalBnb=${fmt(d.actTotalBnb ?? d.act?.totalBnb)} age=${fmt(d.tokenAgeSec)} totalVol=${fmt(d.totalVolumeBnb)}`);
      console.log(`   命中门: ${gateRows.join(' | ') || '(无)'}`);
      // 前向 30min 峰值（剔 outlier）
      const aT = Date.parse(anchorIso);
      const fwd = rows.filter(x => !x.price_outlier && x.price_bnb && Date.parse(x.block_time) > aT && Date.parse(x.block_time) <= aT + 30 * 60 * 1000);
      const anchorPx = Number((win.filter(x => !x.price_outlier && x.price_bnb).slice(-1)[0] || {}).price_bnb || 0);
      if (fwd.length && anchorPx) {
        let peak = 0, peakT = ''; for (const f of fwd) if (Number(f.price_bnb) > peak) { peak = Number(f.price_bnb); peakT = f.block_time.slice(11, 19); }
        console.log(`   前向30min: anchor价=${anchorPx.toExponential(4)} peak=${peak.toExponential(4)}@${peakT} → +${((peak / anchorPx - 1) * 100).toFixed(1)}%`);
      }
    }
  }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
