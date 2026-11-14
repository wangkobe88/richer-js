// 一次性（182 跑，只读）：①idx192 팔꿈치 매수 首 6 笔（发布价 vs FM 常量——「发布价格太低」高开向取证）
// ②idx191 壹刀剑 cheat_detection 最新行 sbw/levels（「burst 识别错误」漏识别方向取证）
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager.js');

async function main() {
  const sb = await dbManager.getClient();
  const { data: d1, error: e1 } = await sb.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,price_bnb,price_outlier')
    .eq('token_address', '0x1ff6da9856abf6d7869797f46468f5e883c57777')
    .order('block_number', { ascending: true }).order('log_index', { ascending: true })
    .limit(6);
  if (e1) throw new Error(e1.message);
  console.log('--- idx192 首 6 笔（FM 常量=4.4962e-9）---');
  for (const r of d1) console.log(r.block_time, r.trade_type, (r.bnb_amount || 0).toFixed(4) + 'B', 'px=' + (r.price_bnb ? r.price_bnb.toExponential(4) : '-'), ((r.price_bnb / 4.496173469e-9 - 1) * 100).toFixed(1) + '% vs常量', r.price_outlier ? 'OUTLIER' : '');

  const { data: d2, error: e2 } = await sb.from('cheat_detection')
    .select('analyzed_at,verdict,snapshot_digest')
    .eq('token_address', '0x74a3c123b676806fba3ff723904c2fe8975a7777')
    .order('analyzed_at', { ascending: false }).limit(2);
  if (e2) throw new Error(e2.message);
  console.log('--- idx191 cheat_detection 行:', d2.length, '---');
  for (const r of d2) {
    const dg = r.snapshot_digest || {};
    console.log(r.analyzed_at, r.verdict, '| sbw=', JSON.stringify(dg.extLevels && dg.extLevels.stall_burst_wave), '| act=', dg.activityLevel, '| anchors.burst=', JSON.stringify({ gap: dg.anchors && dg.anchors.burstMaxGapSec, buy: dg.anchors && dg.anchors.burstWaveBuyBnb, wallets: dg.anchors && dg.anchors.burstWaveWallets, exitVs: dg.anchors && dg.anchors.burstExitVsLaunchPct }));
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
