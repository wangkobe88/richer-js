// 汇总模拟实验 trades:per-token 买卖与 pnl(小结果,本地)
const { dbManager } = require('../src/services/dbManager');
const SIM = process.argv[2] || 'a1457a15-382c-4960-b845-f1b7a91624df';
(async () => {
  const c = dbManager.getClient();
  const { data: trs, error } = await c.from('trades')
    .select('token_address,token_symbol,trade_direction,trade_status,input_amount,output_amount,created_at,metadata')
    .eq('experiment_id', SIM).order('created_at', { ascending: true }).limit(2000);
  if (error) { console.log('ERR', error.message); process.exit(1); }
  const by = {};
  for (const t of trs) {
    const k = t.token_address;
    const b = (by[k] ||= { symbol: t.token_symbol, buys: [], sells: [] });
    if (t.trade_direction === 'buy') b.buys.push(t); else if (t.trade_direction === 'sell') b.sells.push(t);
    else (b.other ||= []).push(t);
  }
  const rows = [];
  for (const [addr, b] of Object.entries(by)) {
    const buyBnb = b.buys.reduce((s, x) => s + (x.input_amount || 0), 0);
    const sellBnb = b.sells.reduce((s, x) => s + (x.output_amount || 0), 0);
    // 未平仓:买 token 数量 - 卖 token 数量
    const buyTok = b.buys.reduce((s, x) => s + (x.output_amount || 0), 0);
    const sellTok = b.sells.reduce((s, x) => s + (x.input_amount || 0), 0);
    rows.push({
      addr, symbol: b.symbol, firstBuyAt: b.buys[0]?.created_at, nBuys: b.buys.length, nSells: b.sells.length,
      buyBnb: +buyBnb.toFixed(6), sellBnb: +sellBnb.toFixed(6),
      realized: +(sellBnb - buyBnb).toFixed(6),
      openTok: +(buyTok - sellTok).toFixed(2),
      lastTradeAt: trs.filter(x => x.token_address === addr).pop()?.created_at,
    });
  }
  rows.sort((x, y) => (x.firstBuyAt || '').localeCompare(y.firstBuyAt || ''));
  console.log('tokens:', rows.length, '| rows:', trs.length);
  for (const r of rows) {
    console.log([
      (r.symbol || '?').slice(0, 14).padEnd(14), r.addr, String(r.nBuys).padStart(2) + 'b/' + String(r.nSells).padStart(2) + 's',
      'in=' + r.buyBnb.toFixed(4), 'out=' + r.sellBnb.toFixed(4), 'pnl=' + r.realized.toFixed(5), 'open=' + r.openTok,
      r.firstBuyAt?.slice(11, 19),
    ].join(' '));
  }
  const totIn = rows.reduce((s, r) => s + r.buyBnb, 0), totOut = rows.reduce((s, r) => s + r.sellBnb, 0);
  const wins = rows.filter(r => r.realized > 0).length;
  console.log(`\nTOTAL(in=${totIn.toFixed(4)} out=${totOut.toFixed(4)} realized=${(totOut - totIn).toFixed(5)} wins=${wins}/${rows.length})`);
  const fs = require('fs');
  fs.writeFileSync('/tmp/sim-a1457-rows.json', JSON.stringify(rows, null, 1));
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
