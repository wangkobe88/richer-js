const { dbManager } = require('../src/services/dbManager');
const TOKEN = '0x042bd73540046354f25a3a1e16c1ccc0cf6a7777';
(async () => {
  const c = dbManager.getClient();
  const { data: ticks } = await c.from('wss_price_ticks')
    .select('block_time,price_bnb,bnb_amount,trade_type,sender_address')
    .eq('token_address', TOKEN)
    .gte('block_time', '2026-10-19T01:51:00+00:00')
    .lte('block_time', '2026-10-19T02:05:00+00:00')
    .order('block_time', { ascending: true }).limit(4000);
  console.log('ticks rows:', ticks?.length);
  const buckets = new Map();
  for (const t of ticks || []) {
    const b = Math.floor(new Date(t.block_time).getTime() / 5000) * 5000;
    if (!buckets.has(b)) buckets.set(b, { last: null, buy: 0, sell: 0, n: 0 });
    const o = buckets.get(b);
    o.last = t.price_bnb; o.n++;
    if (t.trade_type === 'buy') o.buy += t.bnb_amount; else o.sell += t.bnb_amount;
  }
  const first = ticks?.[0]?.price_bnb;
  const rows = [...buckets.entries()].sort((x, y) => x[0] - y[0]);
  for (const [b, o] of rows) {
    const d = new Date(b).toISOString().slice(11, 19);
    const pct = first ? ((o.last / first - 1) * 100).toFixed(1) : '';
    console.log(`${d} p=${o.last?.toExponential(4)} vs窗首=${pct.padStart(7)}% buy=${o.buy.toFixed(3).padStart(7)} sell=${o.sell.toFixed(3).padStart(7)} n=${String(o.n).padStart(3)}`);
  }
  // 尾段 15min 峰（拦截点 01:53:06 之后最高价）
  const t0 = new Date('2026-10-19T01:53:06Z').getTime();
  const after = (ticks || []).filter(t => new Date(t.block_time).getTime() >= t0);
  const peak = Math.max(...after.map(t => t.price_bnb));
  const last = after[after.length - 1]?.price_bnb;
  const p5price = 0.000008475787944092329;
  console.log(`\n拦截价=${p5price.toExponential(4)} | 拦截后峰=${peak.toExponential(4)} (${((peak/p5price-1)*100).toFixed(1)}%) | 窗末价=${last?.toExponential(4)} (${((last/p5price-1)*100).toFixed(1)}%)`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
