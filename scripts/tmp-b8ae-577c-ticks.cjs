const { dbManager } = require('../src/services/dbManager');

const TOKEN = '0x577c885d80a2bfc915c1acab3c51dca91c137777';

async function main() {
  const sb = dbManager.getClient();
  const { data: exp } = await sb.from('experiments').select('experiment_name,name,trading_mode,status').eq('id','b8ae9f2e-832f-42db-bbda-8d8701aecb63').single();
  console.log('实验:', exp && (exp.experiment_name || exp.name), '|', exp && exp.trading_mode, exp && exp.status);

  // BUY 行完整 buyPoint 段
  const { data: sigs } = await sb.from('strategy_signals').select('metadata')
    .eq('experiment_id','b8ae9f2e-832f-42db-bbda-8d8701aecb63').eq('token_address', TOKEN)
    .eq('signal_type','BUY').limit(1);
  const bp = sigs?.[0]?.metadata?.buyPoint;
  if (bp) {
    console.log('\n=== buyPoint 全段 ===');
    console.log(JSON.stringify(bp, null, 1).slice(0, 4500));
  }

  // ticks 全程
  const { data: ticks, error } = await sb.from('wss_price_ticks')
    .select('block_time,block_number,price_bnb,bnb_amount,trade_type,price_outlier')
    .eq('token_address', TOKEN)
    .gte('block_time', '2026-10-19T09:14:00')
    .lte('block_time', '2026-10-19T09:40:00')
    .order('block_time', { ascending: true })
    .limit(2000);
  if (error) throw error;
  const ts = ticks || [];
  console.log('\nticks 总数(09:14~09:40):', ts.length);
  if (!ts.length) process.exit(0);

  // 轨迹概要：10s 桶
  console.log('\n-- 10s 桶轨迹（价格=末值 BNB, 买/卖笔数, 买额）:');
  const t0 = new Date(ts[0].block_time).getTime();
  const buckets = new Map();
  for (const t of ts) {
    const b = Math.floor((new Date(t.block_time).getTime() - t0) / 10000);
    if (!buckets.has(b)) buckets.set(b, { n: 0, buyN: 0, sellN: 0, buyBnb: 0, lastP: 0 });
    const o = buckets.get(b);
    o.n++; if (t.trade_type === 'buy') { o.buyN++; o.buyBnb += Number(t.bnb_amount); } else o.sellN++;
    o.lastP = Number(t.price_bnb);
  }
  for (const [b, o] of [...buckets].sort((a, b) => a[0] - b[0])) {
    const sec = b * 10;
    console.log(`  t+${String(sec).padStart(4)}s  ${o.n.toString().padStart(3)}笔 买${o.buyN}/卖${o.sellN} 买额${o.buyBnb.toFixed(3)}B  price=${o.lastP.toExponential(4)}${o.lastP ? '' : ''}`);
  }

  // 全程极值
  let ath = 0, athT = null, first = null, last = ts[ts.length-1];
  for (const t of ts) { const p = Number(t.price_bnb); if (first === null && p > 0) first = p; if (p > ath) { ath = p; athT = t.block_time; } }
  console.log(`\n首价=${first && first.toExponential(4)}  ATH=${ath.toExponential(4)}@${athT}  末价=${Number(last.price_bnb).toExponential(4)}@${last.block_time}`);
  console.log(`ATH/首价=${(ath/first*100).toFixed(0)}%  末价/首价=${(Number(last.price_bnb)/first*100).toFixed(1)}%  末价/ATH=${(Number(last.price_bnb)/ath*100).toFixed(1)}%`);

  // spike 段细看：09:16:20~09:16:40 每笔
  console.log('\n-- spike 段逐笔 (09:16:10~09:16:45):');
  for (const t of ts) {
    if (t.block_time >= '2026-10-19T09:16:10' && t.block_time <= '2026-10-19T09:16:45')
      console.log('  ', t.block_time, 'blk', t.block_number, t.trade_type, Number(t.price_bnb).toExponential(4), 'bnb=', Number(t.bnb_amount).toFixed(4), t.price_outlier ? '[outlier]' : '');
  }
  // 买后与卖后
  const sellT = '2026-10-19T09:18:58';
  const after = ts.filter(t => t.block_time > sellT);
  console.log(`\n卖出(${sellT})后 ticks: ${after.length} 笔`);
  for (const t of after.slice(0, 12)) console.log('  ', t.block_time, t.trade_type, Number(t.price_bnb).toExponential(4), 'bnb=', Number(t.bnb_amount).toFixed(4));
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
