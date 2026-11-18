// ea78：creator/0x624a 全程交易史 + 钱包净持仓概况（单票小查询）
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0xea7886d590ba1d7d6d4e7761148ba26405c67777';

(async () => {
  const c = await dbManager.getClient();
  const q = await c.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,token_amount,price_bnb,sender_address')
    .eq('token_address', ADDR)
    .or('sender_address.eq.0x030d39fc017dcb45bceb65815b0de75154b0d573,sender_address.eq.0x624a7af8b3fe44f9d381100963676712367b3c56,sender_address.eq.0xdfb69be14bf6ea78f2c49904041176c911db19e2')
    .order('block_time', { ascending: true }).limit(200);
  const rows = q.data || [];
  console.log(`三钱包全程交易行=${rows.length}`);
  for (const r of rows) {
    console.log(`  ${r.block_time} ${r.trade_type.padEnd(4)} bnb=${Number(r.bnb_amount).toFixed(4)} tok=${Math.round(Number(r.token_amount)).toLocaleString('en')} w=${r.sender_address.slice(0, 8)}`);
  }
  // 汇总净额
  const agg = {};
  for (const r of rows) {
    const w = r.sender_address.slice(0, 10);
    agg[w] = agg[w] || { buyBnb: 0, sellBnb: 0, buyTok: 0, sellTok: 0 };
    if (r.trade_type === 'buy') { agg[w].buyBnb += Number(r.bnb_amount); agg[w].buyTok += Number(r.token_amount); }
    else { agg[w].sellBnb += Number(r.bnb_amount); agg[w].sellTok += Number(r.token_amount); }
  }
  console.log('\n净额汇总:');
  for (const [w, a] of Object.entries(agg)) {
    console.log(`  ${w}: 买 ${a.buyBnb.toFixed(4)}B/${Math.round(a.buyTok).toLocaleString('en')}tok  卖 ${a.sellBnb.toFixed(4)}B/${Math.round(a.sellTok).toLocaleString('en')}tok  净tok=${Math.round(a.buyTok - a.sellTok).toLocaleString('en')}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
