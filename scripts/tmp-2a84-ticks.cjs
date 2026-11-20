require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');

const TOKEN = '0x2a84792c035229c761facd5790e4507f39377777';
const ANCHOR = '2026-10-04T01:28:06+00:00';
const FROM = '2026-10-04T01:22:30+00:00';

async function main() {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('wss_price_ticks')
    .select('block_time,bnb_amount,price_bnb,trade_type,sender_address,trader_address,block_number')
    .eq('token_address', TOKEN)
    .gte('block_time', FROM)
    .lte('block_time', ANCHOR)
    .order('block_time', { ascending: true })
    .limit(1000);
  if (error) throw new Error(JSON.stringify(error));
  console.log('ticks in window:', data.length);
  let last = null;
  for (const t of data) {
    const w = (t.sender_address || t.trader_address || '').slice(0, 8);
    const gap = last ? ((new Date(t.block_time) - new Date(last)) / 1000).toFixed(1) : '-';
    const bnb = Number(t.bnb_amount).toFixed(4);
    const side = t.trade_type === 'sell' ? 'S' : 'B';
    console.log(`${t.block_time} ${side} ${bnb}B gap=${gap}s w=${w} blk=${t.block_number}`);
    last = t.block_time;
  }
  // 汇总：最后30s/60s
  const anchorMs = new Date(ANCHOR).getTime();
  for (const win of [30, 60, 120]) {
    const rows = data.filter(r => anchorMs - new Date(r.block_time).getTime() <= win * 1000);
    const buys = rows.filter(r => r.trade_type !== 'sell');
    const sells = rows.filter(r => r.trade_type === 'sell');
    const buyBnb = buys.reduce((s, r) => s + Number(r.bnb_amount), 0);
    const sellBnb = sells.reduce((s, r) => s + Number(r.bnb_amount), 0);
    const wallets = new Set(rows.map(r => r.sender_address || r.trader_address));
    console.log(`\n[尾${win}s] rows=${rows.length} 买${buys.length}笔/${buyBnb.toFixed(4)}B 卖${sells.length}笔/${sellBnb.toFixed(4)}B 钱包${wallets.size} 吞吐${((buyBnb+sellBnb)/(win/60)).toFixed(2)}B/min`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
