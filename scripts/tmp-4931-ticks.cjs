const { dbManager } = require('../src/services/dbManager');

const TOKEN = '0x493110fac98328a4fd3447f2125a34d514107777';
const T0 = '2026-10-19T09:18:30';

async function main() {
  const sb = dbManager.getClient();
  const { data: ticks, error } = await sb.from('wss_price_ticks')
    .select('block_time,block_number,log_index,price_bnb,bnb_amount,trade_type,price_outlier,sender_address,trader_address')
    .eq('token_address', TOKEN)
    .gte('block_time', T0)
    .lte('block_time', '2026-10-19T09:26:00')
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(800);
  if (error) throw error;
  const ts = ticks || [];
  console.log('ticks 总数:', ts.length);
  if (!ts.length) process.exit(0);

  const wallet = r => (r.sender_address || r.trader_address || '').toLowerCase();
  const t0 = new Date(ts[0].block_time).getTime();
  const dt = r => ((new Date(r.block_time).getTime() - t0) / 1000).toFixed(1);

  // 逐块摘要（前 30 块）
  const perBlock = new Map();
  for (const r of ts) {
    if (!perBlock.has(r.block_number)) perBlock.set(r.block_number, []);
    perBlock.get(r.block_number).push(r);
  }
  console.log('\n-- 前 30 块摘要 (block | +s | 行 | 买B | 卖B | 买钱包 | 均单):');
  let i = 0;
  for (const [blk, rows] of [...perBlock.entries()].sort((a, b) => a[0] - b[0])) {
    if (i++ >= 30) break;
    let buy = 0, sell = 0; const w = new Set();
    for (const r of rows) {
      if (r.trade_type === 'buy') { buy += Number(r.bnb_amount); w.add(wallet(r)); }
      else sell += Number(r.bnb_amount);
    }
    const buyRows = rows.filter(r => r.trade_type === 'buy');
    const avg = buyRows.length ? (buy / buyRows.length).toFixed(3) : '-';
    console.log(`  ${blk} | +${dt(rows[0])}s | n=${rows.length} | buy=${buy.toFixed(3)} | sell=${sell.toFixed(3)} | w=${w.size} | 均单=${avg}`);
  }

  // 首块逐笔
  const firstBlk = Math.min(...ts.map(r => r.block_number));
  console.log(`\n-- 首块 ${firstBlk} 逐笔:`);
  for (const r of ts.filter(r => r.block_number === firstBlk)) {
    console.log(`  ${r.trade_type} ${Number(r.bnb_amount).toFixed(4)}B w=${wallet(r).slice(0, 10)} price=${Number(r.price_bnb).toExponential(3)}${r.price_outlier ? ' [outlier]' : ''}`);
  }

  // 价格轨迹 10s 桶
  console.log('\n-- 10s 桶轨迹:');
  const buckets = new Map();
  for (const t of ts) {
    const b = Math.floor((new Date(t.block_time).getTime() - t0) / 10000);
    if (!buckets.has(b)) buckets.set(b, { n: 0, buyN: 0, sellN: 0, buyBnb: 0, lastP: 0 });
    const o = buckets.get(b);
    o.n++; if (t.trade_type === 'buy') { o.buyN++; o.buyBnb += Number(t.bnb_amount); } else o.sellN++;
    o.lastP = Number(t.price_bnb);
  }
  for (const [b, o] of [...buckets].sort((a, b) => a[0] - b[0])) {
    console.log(`  t+${String(b * 10).padStart(4)}s  ${String(o.n).padStart(3)}笔 买${o.buyN}/卖${o.sellN} 买额${o.buyBnb.toFixed(3)}B  price=${o.lastP.toExponential(4)}`);
  }

  // 极值
  let ath = 0, athT = null, first = null, last = ts[ts.length - 1];
  for (const t of ts) { const p = Number(t.price_bnb); if (first === null && p > 0) first = p; if (p > ath) { ath = p; athT = t.block_time; } }
  console.log(`\n首价=${first.toExponential(4)}  ATH=${ath.toExponential(4)}@${athT} (+${((ath / first - 1) * 100).toFixed(0)}%)  末价=${Number(last.price_bnb).toExponential(4)}@${last.block_time}`);

  // 买信号时刻（09:19:47~09:20:04）前后的逐笔
  console.log('\n-- 09:19:30~09:20:30 逐笔:');
  for (const t of ts) {
    if (t.block_time >= '2026-10-19T09:19:30' && t.block_time <= '2026-10-19T09:20:30')
      console.log('  ', t.block_time, 'blk', t.block_number, t.trade_type, Number(t.price_bnb).toExponential(3), 'bnb=', Number(t.bnb_amount).toFixed(4), 'w=' + wallet(t).slice(0, 10));
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
