const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');

const TOKEN = '0x397ada63ce5f5c13885b4893b7f4e01c046a7777';
const NEW_W = '0x41ccc209d3ba4e81ef0c1fcb6d191127fb5b42f5';
const T0 = '2026-10-19T13:05:52';
const ANCHORS = ['2026-10-19T13:07:13', '2026-10-19T13:07:16', '2026-10-19T13:07:19'];

async function main() {
  const sb = dbManager.getClient();
  const rosterNow = JSON.parse(fs.readFileSync('config/rosters/famous-copy-wallets.json', 'utf8')).wallets.map(w => w.toLowerCase());

  const { data: rows } = await sb.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,price_bnb,sender_address,trader_address')
    .eq('token_address', TOKEN)
    .gte('block_time', T0)
    .lte('block_time', '2026-10-19T13:07:30')
    .order('block_time', { ascending: true })
    .limit(2000);
  const ts = rows || [];

  // 三钱包逐笔
  const watch = new Set([NEW_W, ...rosterNow]);
  for (const r of ts) {
    const w = (r.sender_address || r.trader_address || '').toLowerCase();
    if (watch.has(w) && r.block_time <= '2026-10-19T13:07:19') {
      console.log(r.block_time.slice(11), r.trade_type === 'buy' ? 'BUY ' : 'SELL', Number(r.bnb_amount).toFixed(4), '@', Number(r.price_bnb).toExponential(3), w.slice(0, 8), w === NEW_W ? '<- 41ccc新' : '');
    }
  }

  for (const A of ANCHORS) {
    let totalBuy = 0, totalSell = 0;
    const per = {}; // wallet -> {b,s}
    for (const r of ts) {
      if (r.block_time > A) break;
      const w = (r.sender_address || r.trader_address || '').toLowerCase();
      const isBuy = r.trade_type === 'buy';
      if (isBuy) totalBuy += Number(r.bnb_amount); else totalSell += Number(r.bnb_amount);
      if (rosterNow.includes(w) || w === NEW_W) {
        per[w] = per[w] || { b: 0, s: 0 };
        if (isBuy) per[w].b += Number(r.bnb_amount); else per[w].s += Number(r.bnb_amount);
      }
    }
    const agg = (inclNew) => {
      let b = 0, s = 0;
      for (const [w, v] of Object.entries(per)) {
        if (!inclNew && w === NEW_W) continue;
        b += v.b; s += v.s;
      }
      return { b, s };
    };
    const cur = agg(false), plus = agg(true);
    console.log(`\n== anchor ${A} | totalBuy=${totalBuy.toFixed(3)} totalSell=${totalSell.toFixed(3)}`);
    for (const [w, v] of Object.entries(per)) console.log('   ', w.slice(0, 10), 'buy=', v.b.toFixed(4), 'sell=', v.s.toFixed(4), 'soldRatio=', v.b > 0 ? (v.s / v.b).toFixed(2) : '-');
    console.log('   现行 roster 群体: buy=', cur.b.toFixed(4), 'sell=', cur.s.toFixed(4), 'soldRatio=', cur.b > 0 ? (cur.s / cur.b).toFixed(3) : '-', '占买=', (cur.b / totalBuy * 100).toFixed(1) + '%', '占卖=', (cur.s / totalSell * 100).toFixed(1) + '%');
    console.log('   +41ccc 群体:  buy=', plus.b.toFixed(4), 'sell=', plus.s.toFixed(4), 'soldRatio=', plus.b > 0 ? (plus.s / plus.b).toFixed(3) : '-', '占买=', (plus.b / totalBuy * 100).toFixed(1) + '%', '占卖=', (plus.s / totalSell * 100).toFixed(1) + '%');
  }
}
main().catch(e => { console.error(e); process.exit(1); });
