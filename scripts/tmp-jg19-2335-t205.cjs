#!/usr/bin/env node
// 一次性（本地小结果）：胖橘貓 0x2335 T205 灰度开态（enableActStageCold:true）FP 重放 + 2h 前向全局峰值。只读。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot');
const M = require('../src/market-analysis/factor-pre-buy-check');
const TOKEN = '0x2335bc4868817a216be949c545f9a7e550bf7777';
const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
(async () => {
  const sb = dbManager.getClient();
  const [{ data: rowsAll, error }, { data: grads }] = await Promise.all([
    sb.from('wss_price_ticks').select(TICK_COLS).eq('token_address', TOKEN)
      .gte('block_time', '2026-10-03T05:31:00Z').lte('block_time', '2026-10-03T08:00:00Z')
      .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(40000),
    sb.from('wss_events').select('block_time').eq('kind', 'graduation').eq('token_address', TOKEN).limit(2),
  ]);
  if (error) throw new Error(error.message);
  const rows = rowsAll || [];
  console.log(`ticks(05:31~08:00)=${rows.length} 毕业事件=${grads && grads[0] ? grads[0].block_time : '无'}`);
  // 全局峰值（剔 outlier）
  let peak = 0, peakT = '', minP = Infinity;
  for (const r of rows) if (!r.price_outlier && r.price_bnb) { if (Number(r.price_bnb) > peak) { peak = Number(r.price_bnb); peakT = r.block_time; } if (Number(r.price_bnb) < minP) minP = Number(r.price_bnb); }
  const launch = 6.5129e-9 / 1.174; // 由 05:39:48 curVs=17.4 反推
  console.log(`全局峰值=${peak.toExponential(4)}@${peakT.slice(11, 19)} vs launch(${launch.toExponential(3)}) = +${((peak / launch - 1) * 100).toFixed(0)}%  全局最低=${minP.toExponential(4)}`);
  // 首锚点后逐 10min 峰值轨迹
  const aT = Date.parse('2026-10-03T05:39:48Z');
  for (let m = 10; m <= 120; m += 10) {
    const seg = rows.filter(x => !x.price_outlier && x.price_bnb && Date.parse(x.block_time) > aT && Date.parse(x.block_time) <= aT + m * 60 * 1000);
    if (!seg.length) { console.log(`  +${m}min: 无行`); continue; }
    let pk = 0, t = ''; for (const f of seg) if (Number(f.price_bnb) > pk) { pk = Number(f.price_bnb); t = f.block_time.slice(11, 19); }
    console.log(`  +${m}min: peak=${pk.toExponential(4)}@${t} (${seg.length}行)`);
  }
  // T205 开态重放
  const meta = { address: TOKEN, symbol: '胖橘貓', platform: 'flap', createdAt: '2026-10-03T05:31:54.000Z', creatorAddress: null, totalSupply: 1e9 };
  for (const anchorIso of ['2026-10-03T05:39:48Z', '2026-10-03T05:40:44Z', '2026-10-03T05:43:04Z']) {
    const win = rows.filter(r => r.block_time <= anchorIso);
    const snap = buildBuyPointSnapshot(win, meta, { famousRoster: undefined });
    const r = M.evaluateFactorPreBuy(snap, { enableTailDipExempt: true, enableActStageCold: true });
    console.log(`[T205开] @${anchorIso.slice(11, 19)} pass=${r.pass} reason=${r.reason} arms=${JSON.stringify(r.arms || [])}`);
  }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
