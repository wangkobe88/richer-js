#!/usr/bin/env node
// 0xddac…2127 两票行级时序细节
const { dbManager } = require('../src/services/dbManager');
const W = '0xddac928a240bdace3994c2cc0783d4e29a002127';
const TOKS = ['0x14e6e49f851fdec239240f74082394338dff7777', '0xc793156f6659226562e7ad48ba56487d5d267777'];

async function main() {
  const sb = dbManager.getClient();
  for (const t of TOKS) {
    const { data, error } = await sb.from('wss_price_ticks')
      .select('block_time,block_number,log_index,trade_type,bnb_amount,sender_address,price_bnb')
      .eq('token_address', t)
      .gte('block_time', '2026-11-16T00:00:00Z').lte('block_time', '2026-11-17T00:00:00Z')
      .order('id', { ascending: true }).range(0, 1999);
    if (error) throw new Error(error.message);
    const rows = data || [];
    const first = rows.length ? rows[0].block_time : null;
    console.log(`\n=== ${t} rows=${rows.length} first=${first}`);
    for (const r of rows) {
      if ((r.sender_address || '').toLowerCase() !== W) continue;
      const dt = (new Date(r.block_time) - new Date(first)) / 1000;
      console.log(`  t+${dt.toFixed(0)}s ${r.trade_type} bnb=${Number(r.bnb_amount).toFixed(4)} blk=${r.block_number} li=${r.log_index} price=${r.price_bnb}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
