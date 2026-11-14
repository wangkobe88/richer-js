// 一次性取证（182 跑）：D3.65 立法定向——ba5e(M4GA) v98 首信号 07:52:18 锚的
// cheatCheck 明细（levels.stallBurstWave 判了什么？anchors burst 三键值？）
// + 现场模拟「全窗最密 5s 窗」三键（D3.65 后 CD383 臂将读到的值）。
const { dbManager } = require('../../src/services/dbManager.js');

const V98 = 'fe029df4-cd1f-490c-bfaf-f945feed287b';
const ADDR = '0xba5ed45b42479e0a75316de7bf990ec90a3e4444';
const FM_LAUNCH = 4496173469e-18;

async function main() {
  const client = await dbManager.getClient();
  // 1) v98 ba5e 全部 BUY 信号（看首信号与短路后的形态）
  const { data: sigs, error: e1 } = await client.from('strategy_signals')
    .select('created_at,action,executed,metadata').eq('experiment_id', V98)
    .eq('token_address', ADDR).eq('signal_type', 'BUY')
    .order('created_at', { ascending: true }).limit(10);
  if (e1) { console.log('sig err', e1.message); }
  for (const s of (sigs || [])) {
    const cc = (s.metadata && s.metadata.cheatCheck) || {};
    const lv = cc.levels || {};
    const an = cc.anchors || {};
    console.log(`\n== 信号 ${s.created_at.slice(5, 19)} action=${s.action} executed=${s.executed}`);
    console.log(`   status=${cc.status} grade=${cc.grade} reasons=${JSON.stringify(cc.reasons || null)}`);
    console.log(`   activityLevel=${cc.buckets && cc.buckets.activityLevel} sbw=${lv.stallBurstWave} sbwKey=${lv.stallBurstWaveKey}`);
    console.log(`   burstMaxGapSec=${an.burstMaxGapSec} waveBuy=${an.burstWaveBuyBnb} waveWallets=${an.burstWaveWallets} startVs=${an.burstWaveStartVsLaunchPct}`);
    if (cc.exempt || cc.exemptDenied) console.log(`   exempt=${JSON.stringify(cc.exempt)} denied=${cc.exemptDenied}`);
  }
  if (!sigs || !sigs.length) { console.log('（v98 无 ba5e 信号）'); }

  // 2) ba5e 07:39-07:53 全窗 ticks → 模拟 D3.65 全窗最密 5s 窗
  const ticks = [];
  for (let t = new Date('2026-11-05T07:38:00Z').getTime(); t < new Date('2026-11-05T07:53:30Z').getTime(); t += 10 * 60000) {
    const t2 = t + 10 * 60000;
    const { data, error } = await client.from('wss_price_ticks')
      .select('block_time,price_bnb,bnb_amount,trade_type').eq('token_address', ADDR)
      .gte('block_time', new Date(t).toISOString()).lt('block_time', new Date(t2).toISOString())
      .order('block_time', { ascending: true }).limit(2000);
    if (error) { console.log('tick err', error.message); break; }
    ticks.push(...(data || []));
  }
  console.log(`\nticks(07:38-07:53)=${ticks.length}`);
  const t0 = new Date(ticks[0].block_time).getTime();
  const rows = ticks.map((x) => ({
    dt: (new Date(x.block_time).getTime() - t0) / 1000,
    buy: x.trade_type === 'buy',
    bnb: Number(x.bnb_amount || 0),
    p: x.price_bnb,
    rel: x.price_bnb > 0 && !/[oO]utlier/.test(String(x.price_outlier || '')),
  }));
  // 全窗最密 5s 双指针（对齐 BURST_WAVE_SEC=5；不做 outlier 剔除的 tick 原料近似——探测用）
  let j = 0, curN = 0, curBuy = 0, bestN = 0, bestBuy = 0, bestW = 0;
  const wallets = new Map();
  let bestFrom = 0, bestTo = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    curN++; if (r.buy) curBuy += r.bnb;
    wallets.set(i, 1);
    while (r.dt - rows[j].dt > 5) { if (rows[j].buy) curBuy -= rows[j].bnb; curN--; wallets.delete(j); j++; }
    if (curN > bestN) { bestN = curN; bestBuy = curBuy; bestW = wallets.size; bestFrom = rows[j].dt; bestTo = r.dt; }
  }
  console.log(`全窗最密5s窗: 笔数=${bestN} Σ买=${bestBuy.toFixed(4)}B 窗dt=[${bestFrom.toFixed(1)}, ${bestTo.toFixed(1)}]s`);
  // 波起点价（窗内首个正价）
  const winRows = rows.filter((r) => r.dt >= bestFrom - 0.01 && r.dt <= bestTo + 0.01);
  const firstP = winRows.find((r) => r.p > 0);
  const firstBuyP = ticks.find((x) => x.trade_type === 'buy' && x.price_bnb > 0);
  const launch = Math.min(FM_LAUNCH, (firstBuyP && firstBuyP.price_bnb) || FM_LAUNCH);
  if (firstP) {
    console.log(`波起点价=${firstP.p.toExponential(4)} vs launch=${launch.toExponential(4)} → startVs=${((firstP.p / launch - 1) * 100).toFixed(1)}%`);
  }
  // 临近段对照（现状口径 120s）
  const lastDt = rows[rows.length - 1].dt;
  const near = rows.filter((r) => r.dt >= lastDt - 120);
  const nearBuy = near.filter((r) => r.buy).reduce((a, b) => a + b.bnb, 0);
  console.log(`临近段(120s)对照: 笔数=${near.length} Σ买=${nearBuy.toFixed(4)}B（现状 burstWaveBuyBnb 口径）`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
