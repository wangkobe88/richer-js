// 10-19 窗最差票近线形状复查（放宽线看距离）
const { dbManager } = require('../src/services/dbManager');
const EXP = 'b8ae9f2e-832f-42db-bbda-8d8701aecb63';
const TOKENS = ['0x3f29d773', '0xe8cb59a8', '0xcd64c7a6', '0x359309eb', '0xac9069a8'];

function walletOf(r) { return (r.sender_address || r.trader_address || '').toLowerCase(); }

async function main() {
  const sb = dbManager.getClient();
  const { data: trades } = await sb.from('trades').select('token_address,created_at,trade_direction,input_amount,output_amount')
    .eq('experiment_id', EXP).order('created_at');
  const firstBuy = new Map();
  for (const t of (trades || []).filter(x => x.trade_direction === 'buy')) if (!firstBuy.has(t.token_address)) firstBuy.set(t.token_address, t);
  const sellByToken = new Map();
  for (const t of (trades || []).filter(x => x.trade_direction === 'sell')) {
    if (!sellByToken.has(t.token_address)) sellByToken.set(t.token_address, []);
    sellByToken.get(t.token_address).push(t);
  }
  for (const pfx of TOKENS) {
    const token = [...firstBuy.keys()].find(k => k.startsWith(pfx));
    if (!token) { console.log(pfx, 'no buy'); continue; }
    const bt = firstBuy.get(token);
    const anchorMs = new Date(bt.created_at).getTime();
    const { data: ticks } = await sb.from('wss_price_ticks')
      .select('block_time,block_number,price_bnb,bnb_amount,trade_type,sender_address,trader_address')
      .eq('token_address', token).order('block_time').limit(5000);
    const ts = ticks || [];
    const win = ts.filter(t => { const ms = new Date(t.block_time).getTime(); return ms <= anchorMs && ms >= anchorMs - 60000; });
    const byBlock = new Map();
    for (const t of win) { if (!byBlock.has(t.block_number)) byBlock.set(t.block_number, []); byBlock.get(t.block_number).push(t); }
    const blocks = [...byBlock.entries()].sort((a, b) => a[0] - b[0]);
    const sells = sellByToken.get(token) || [];
    const pnl = sells.reduce((a, s) => a + Number(s.output_amount || 0), 0) - (trades || []).filter(b => b.trade_direction === 'buy' && b.token_address === token).reduce((a, b) => a + Number(b.input_amount || 0), 0);
    console.log(`\n${pfx} pnl=${pnl.toFixed(4)} buy@${String(bt.created_at).slice(11, 19)} 窗内块=${blocks.length}`);
    // 放宽线：卖方≥2 或 卖额≥0.3 的块（含双块合并）
    for (let i = 0; i < blocks.length; i++) {
      for (const span of [[blocks[i]], i + 1 < blocks.length && blocks[i + 1][0] === blocks[i][0] + 1 ? [blocks[i], blocks[i + 1]] : null]) {
        if (!span) continue;
        const rows = span.flatMap(s => s[1]);
        const sl = rows.filter(r => String(r.trade_type).toLowerCase() !== 'buy');
        const sellers = new Set(sl.map(walletOf));
        const sellBnb = sl.reduce((a, r) => a + Number(r.bnb_amount), 0);
        if (sellers.size < 3 && sellBnb < 0.3) continue;
        const px = sl.filter(r => Number(r.price_bnb) > 0).map(r => Number(r.price_bnb));
        const drop = px.length >= 2 ? (px[px.length - 1] / px[0] - 1) * 100 : null;
        const maxBlk = Math.max(...span.map(s => s[0]));
        const follow = win.filter(r => String(r.trade_type).toLowerCase() === 'buy' && r.block_number > maxBlk).reduce((a, r) => a + Number(r.bnb_amount), 0);
        const lastMs = Math.max(...sl.map(r => new Date(r.block_time).getTime()));
        console.log(`  blk ${span.map(s => s[0]).join('+')} 卖方=${sellers.size} 卖额=${sellBnb.toFixed(3)} 跌幅=${drop === null ? 'null' : drop.toFixed(1) + '%'} 距锚=${((anchorMs - lastMs) / 1000).toFixed(0)}s 承接=${(sellBnb ? follow / sellBnb * 100 : -1).toFixed(0)}%`);
      }
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
