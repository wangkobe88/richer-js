const { dbManager } = require('../src/services/dbManager');
const LAUNCH = 4496173469e-18; // four.meme 主流档常量
async function main() {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,price_bnb')
    .eq('token_address','0x88edc0d6e4ba98eadf4b6f86b41540a438d67777')
    .gte('block_time','2026-10-13T09:14:00Z').lte('block_time','2026-10-13T09:21:00Z')
    .order('block_time',{ascending:true}).limit(500);
  if (error) throw error;
  console.log('行数:', data.length);
  let lastSub = null;
  for (const r of data) {
    const bnb = Number(r.bnb_amount);
    const vs = r.price_bnb != null ? ((Number(r.price_bnb)/LAUNCH-1)*100).toFixed(1) : 'null';
    const sub = bnb >= 0.01;
    if (sub) lastSub = r.block_time;
    console.log(`${r.block_time} ${r.trade_type} bnb=${bnb.toFixed(4)}${sub?' *足额':''} curVs=${vs}%`);
  }
  const sellT = new Date('2026-10-13T09:18:41Z').getTime();
  if (lastSub) {
    const gap = (sellT - new Date(lastSub).getTime())/1000;
    console.log(`\n卖出信号 09:18:41 | 最后足额 tick=${lastSub} | 断流间隔=${gap.toFixed(1)}s`);
  } else console.log('\n窗内无足额 tick(≥0.01)');
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
