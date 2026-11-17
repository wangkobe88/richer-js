// T144 Newly-blocked 19 票净额核算（182）
const { dbManager } = require('../src/services/dbManager.js');
async function main() {
  const c = await dbManager.getClient();
  const { data: rows } = await c.from('trades')
    .select('token_address,token_symbol,trade_direction,input_currency,input_amount,output_currency,output_amount,success')
    .eq('experiment_id', 'b67b7318-1715-443d-a29b-7919b2db6e65').range(0, 999);
  const m = new Map();
  for (const t of rows || []) {
    if (t.success === false) continue;
    const buy = t.trade_direction === 'buy';
    const v = buy ? (t.input_currency === 'BNB' ? Number(t.input_amount || 0) : Number(t.output_amount || 0))
      : (t.output_currency === 'BNB' ? Number(t.output_amount || 0) : Number(t.input_amount || 0));
    let e = m.get(t.token_address);
    if (!e) { e = { sym: t.token_symbol, buyBnb: 0, sellBnb: 0 }; m.set(t.token_address, e); }
    if (buy) e.buyBnb += v; else e.sellBnb += v;
  }
  const addrs = ['0x19e095b6','0xf5e642bc','0x65a4c2da','0x0767f5ae','0x47922a47','0xf71413b7','0xdae106c8','0x2469ef30','0x6b9b863c','0x3f7e659b','0xb59692cc','0x562ba26b','0x5d11aae0','0x6b87facc','0xd94cd641','0x1e5d0f4c','0x2e5f8b37','0xeb209205'];
  let sum = 0;
  for (const a of addrs) {
    const k = [...m.keys()].find((x) => x.startsWith(a));
    const e = k ? m.get(k) : null;
    const net = e ? e.sellBnb - e.buyBnb : 0;
    sum += net;
    console.log(`${net >= 0 ? '+' : ''}${net.toFixed(4)}  ${(e ? e.sym : '?')}`);
  }
  console.log(`合计 ${sum >= 0 ? '+' : ''}${sum.toFixed(4)}（负=止血 正=误伤）`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
