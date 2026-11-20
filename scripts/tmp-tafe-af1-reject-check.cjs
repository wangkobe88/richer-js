#!/usr/bin/env node
const { dbManager } = require('../src/services/dbManager');
const EXP = '9b31baf4-bdd3-4ebb-9031-2a1603f34633';
const TOKEN = '0x4aa6169babeae83ab2fe544753eca44baf917777';
async function main() {
  const sb = dbManager.getClient();
  const { data: trades } = await sb.from('trades')
    .select('trade_direction,input_amount,output_amount,unit_price,created_at,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(10);
  console.log('=== trades ===');
  for (const t of trades || []) {
    const md = t.metadata || {};
    console.log(JSON.stringify({ at: t.created_at, dir: t.trade_direction, inBnb: t.input_amount, unit: t.unit_price?.toPrecision?.(6) ?? t.unit_price, pnlBnb: md.pnlBnb ?? md.realizedPnlBnb ?? md.profitLoss, pct: md.profitPercent, why: md.reason ?? md.why ?? md.strategyName }));
  }

  const { data: ticks } = await sb.from('wss_price_ticks')
    .select('block_time,price_bnb,bnb_amount,trade_type')
    .eq('token_address', TOKEN)
    .gte('block_time', '2026-10-12T00:11:20+00:00')
    .lte('block_time', '2026-10-12T00:15:00+00:00')
    .order('block_time', { ascending: true })
    .limit(1000);
  console.log('\n=== ticks ===', ticks?.length, '行');
  if (ticks?.length) {
    const t0 = new Date(ticks[0].block_time).getTime();
    for (const t of ticks) {
      const sec = Math.round((new Date(t.block_time).getTime() - t0) / 1000);
      if (sec <= 40 || sec % 30 === 0) {
        console.log(`t+${sec}s  ${t.trade_type === 'buy' ? 'B' : 'S'}  ${Number(t.price_bnb).toExponential(4)}  ${Number(t.bnb_amount).toFixed(3)}B`);
      }
    }
    const a1 = new Date('2026-10-12T00:11:43Z').getTime(), a2 = new Date('2026-10-12T00:11:56Z').getTime();
    let max1 = 0, max2 = 0, last = 0;
    for (const t of ticks) {
      const ts = new Date(t.block_time).getTime();
      last = Number(t.price_bnb);
      if (ts > a1 && ts <= a1 + 300000) max1 = Math.max(max1, last);
      if (ts > a2 && ts <= a2 + 300000) max2 = Math.max(max2, last);
    }
    const px = (arr, ts0) => { const near = arr.filter(t => Math.abs(new Date(t.block_time).getTime() - ts0) <= 2000); return near.length ? Number(near[near.length - 1].price_bnb) : 0; };
    const px1 = px(ticks, a1), px2 = px(ticks, a2);
    console.log(`\n锚1(00:11:43) 价≈${px1.toExponential(4)} → 后5min峰值 ${max1.toExponential(4)} (${((max1 / px1 - 1) * 100).toFixed(1)}%)`);
    console.log(`锚2(00:11:56) 价≈${px2.toExponential(4)} → 后5min峰值 ${max2.toExponential(4)} (${((max2 / px2 - 1) * 100).toFixed(1)}%)  [实际买入价 unit=4.8866e-6]`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
