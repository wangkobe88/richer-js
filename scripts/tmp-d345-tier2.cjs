const { dbManager } = require('../src/services/dbManager');
const FM = 4496173469e-18, FL = 6.14 / (107036752 + 1e9);
async function main() {
  const sb = dbManager.getClient();
  const { data: meta } = await sb.from('wss_price_ticks')
    .select('platform').eq('token_address','0x88edc0d6e4ba98eadf4b6f86b41540a438d67777').limit(1);
  const platform = meta[0]?.platform;
  const C = platform === 'flap' ? FL : FM;
  const { data, error } = await sb.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,price_bnb,price_outlier')
    .eq('token_address','0x88edc0d6e4ba98eadf4b6f86b41540a438d67777')
    .gte('block_time','2026-10-12T00:00:00Z').lte('block_time','2026-10-13T09:18:41Z')
    .order('block_time',{ascending:true}).limit(2000);
  if (error) throw error;
  const rel = data.filter(r => !r.price_outlier && r.price_bnb > 0);
  let firstBuy = null, minRel = null;
  for (const r of rel) {
    if (!firstBuy && r.trade_type === 'buy' && Number(r.bnb_amount) > 0) firstBuy = Number(r.price_bnb);
    if (minRel == null || Number(r.price_bnb) < minRel) minRel = Number(r.price_bnb);
  }
  const last = Number(rel[rel.length-1].price_bnb);
  const t130 = Math.min(C, firstBuy ?? C);
  const t139 = Math.min(C, firstBuy ?? C, minRel);
  const curVs = (last/t139-1)*100, floorPct = (last/t130-1)*100;
  console.log('platform:', platform);
  console.log('currentVsLaunchPct(T139):', curVs.toFixed(2) + '% → almost 域?', curVs <= 10);
  console.log('currentVsFloorPct(T130):', floorPct.toFixed(2) + '% → 破发域?', floorPct <= -5);
  console.log('生效档:', floorPct <= -5 ? '破发 180s' : (curVs <= 10 ? 'almost 90s' : '域外 40s'));
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
