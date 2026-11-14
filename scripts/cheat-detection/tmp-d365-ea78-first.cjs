// 一次性取证（182 跑）：ea78(吉祥) v98 首判行完整 cheatCheck——豁免链卡点
// （activityLevel 档位？sbw？burst 三锚值？）+ 全窗首价（D3.65 startVs 腿前瞻）。
const { dbManager } = require('../../src/services/dbManager.js');

const V98 = 'fe029df4-cd1f-490c-bfaf-f945feed287b';
const ADDR = '0xea7886d590ba1d7d6d4e7761148ba26405c67777';
const FL_LAUNCH = 5.546e-9;

async function main() {
  const client = await dbManager.getClient();
  const { data: sigs } = await client.from('strategy_signals')
    .select('created_at,metadata').eq('experiment_id', V98).eq('token_address', ADDR)
    .eq('signal_type', 'BUY').order('created_at', { ascending: true }).limit(3);
  for (const s of (sigs || [])) {
    const cc = (s.metadata && s.metadata.cheatCheck) || {};
    console.log(`\n== ${s.created_at.slice(5, 19)} status=${cc.status} grade=${cc.grade} exempt=${JSON.stringify(cc.exempt || null)}`);
    console.log('  buckets.activityLevel =', cc.buckets && cc.buckets.activityLevel);
    console.log('  buckets.stallBurstWave =', cc.buckets && cc.buckets.stallBurstWave);
    console.log('  levels.slowGrindPump =', cc.levels && cc.levels.slowGrindPump, ' insiderSupplySell =', cc.levels && cc.levels.insiderSupplySell);
    console.log('  reasons =', JSON.stringify((cc.reasons || []).map((r) => r.code)));
    const an = cc.anchors || {};
    console.log('  anchors: gap=%s waveBuy=%s waveWallets=%s startVs=%s noBuySell=%s',
      an.burstMaxGapSec, an.burstWaveBuyBnb, an.burstWaveWallets, an.burstWaveStartVsLaunchPct, an.noBuySellPct);
  }
  // 全窗首价（D3.65 startVs 腿前瞻：锚窗=07:32 起全史）
  const { data: t1 } = await client.from('wss_price_ticks')
    .select('block_time,price_bnb,trade_type,bnb_amount').eq('token_address', ADDR)
    .gte('block_time', '2026-11-05T07:30:00').lt('block_time', '2026-11-05T07:40:00')
    .order('block_time', { ascending: true }).limit(2000);
  const rows = (t1 || []).filter((x) => x.price_bnb > 0);
  console.log(`\n07:30-07:40 有效价行=${rows.length}`);
  for (const r of rows.slice(0, 8)) {
    console.log(`  ${r.block_time.slice(11, 19)} ${r.trade_type} ${Number(r.bnb_amount || 0).toFixed(3)}B vsFL=${((r.price_bnb / FL_LAUNCH - 1) * 100).toFixed(1)}%`);
  }
  const firstBuy = rows.find((x) => x.trade_type === 'buy');
  const launch = Math.min(FL_LAUNCH, (firstBuy && firstBuy.price_bnb) || FL_LAUNCH);
  console.log(`全窗首价=${rows[0].price_bnb.toExponential(4)} → startVs(D3.65)=${((rows[0].price_bnb / launch - 1) * 100).toFixed(1)}%（launch=${launch.toExponential(4)}）`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
