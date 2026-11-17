// bt-v129 逐票明细（2026-11-15，182 跑）：钉结果——净额分布 top 盈亏+正负票统计+豁免臂观察
const { dbManager } = require('../src/services/dbManager.js');

async function main() {
  const c = await dbManager.getClient();
  const { data: exps } = await c.from('experiments').select('id').limit(500);
  const id = exps.find((e) => e.id.startsWith('4af09d63')).id;
  let rows = [], from = 0;
  while (true) {
    const { data, error } = await c.from('trades')
      .select('token_address,token_symbol,trade_direction,input_currency,input_amount,output_currency,output_amount,success')
      .eq('experiment_id', id).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows = rows.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const m = new Map();
  for (const t of rows) {
    if (t.success === false) continue;
    const buy = t.trade_direction === 'buy';
    const v = buy ? (t.input_currency === 'BNB' ? Number(t.input_amount || 0) : Number(t.output_amount || 0))
      : (t.output_currency === 'BNB' ? Number(t.output_amount || 0) : Number(t.input_amount || 0));
    let e = m.get(t.token_address);
    if (!e) { e = { sym: t.token_symbol, buyBnb: 0, sellBnb: 0 }; m.set(t.token_address, e); }
    if (buy) e.buyBnb += v; else e.sellBnb += v;
  }
  const arr = [...m.entries()].map(([k, e]) => ({ k, ...e, net: e.sellBnb - e.buyBnb }));
  const net = arr.reduce((s, e) => s + e.net, 0);
  const pos = arr.filter((e) => e.net > 0), neg = arr.filter((e) => e.net <= 0);
  console.log(`bt-v129 逐票：${arr.length} 票 净额 ${net >= 0 ? '+' : ''}${net.toFixed(4)}；正票 ${pos.length} 张 +${pos.reduce((s, e) => s + e.net, 0).toFixed(4)} / 负票 ${neg.length} 张 ${neg.reduce((s, e) => s + e.net, 0).toFixed(4)}`);
  console.log('\n== Top 盈利 ==');
  for (const e of arr.sort((a, b) => b.net - a.net).slice(0, 12))
    console.log(`  ${e.net >= 0 ? '+' : ''}${e.net.toFixed(4)}  ${(e.sym || '?').slice(0, 14).padEnd(15)} ${e.k}`);
  console.log('\n== Top 亏损 ==');
  for (const e of arr.sort((a, b) => a.net - b.net).slice(0, 8))
    console.log(`  ${e.net >= 0 ? '+' : ''}${e.net.toFixed(4)}  ${(e.sym || '?').slice(0, 14).padEnd(15)} ${e.k}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
