const { dbManager } = require('../src/services/dbManager');
const FM = 4496173469e-18; // four.meme 主流档常量
async function main() {
  const sb = dbManager.getClient();
  // 拉回测窗口内该票全部 ticks（win1012 实验窗口=2026-10-12~14 附近，取宽窗限行）
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
  const last = rel.length ? Number(rel[rel.length-1].price_bnb) : null;
  const t130 = Math.min(FM, firstBuy ?? FM);          // min(常量, 首买价)
  const t139 = Math.min(FM, firstBuy ?? FM, minRel);  // min(常量, 首买, 滚动最低)
  console.log('行数(可靠价):', rel.length);
  console.log('首买价 vs 常量: ' + ((firstBuy/FM-1)*100).toFixed(1) + '%');
  console.log('滚动最低 vs 常量: ' + ((minRel/FM-1)*100).toFixed(1) + '%');
  console.log('末价(09:17:40 卖出锚前) vs 常量: ' + ((last/FM-1)*100).toFixed(1) + '%');
  console.log('--- 档位判定（卖出时点）---');
  console.log('currentVsLaunchPct (T139 地板):', ((last/t139-1)*100).toFixed(2) + '%  → almost 域(≤+10)?', ((last/t139-1)*100) <= 10);
  console.log('currentVsFloorPct  (T130 地板):', ((last/t130-1)*100).toFixed(2) + '%  → 破发域(≤−5)?', ((last/t130-1)*100) <= -5);
  console.log('→ 生效档:', ((last/t130-1)*100) <= -5 ? '破发档 180s' : (((last/t139-1)*100) <= 10 ? 'almost 档 90s' : '域外 40s'));
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
