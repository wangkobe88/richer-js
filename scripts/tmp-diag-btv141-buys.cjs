const { dbManager } = require('../src/services/dbManager.js');
(async () => {
  const c = await dbManager.getClient();
  const EXP='3916fb15-66a1-45f0-bde1-1c145513817a';
  const { data: tr } = await c.from('trades')
    .select('token_address,trade_direction,input_amount,output_amount,created_at,executed_at,token_symbol,metadata')
    .eq('experiment_id',EXP).eq('trade_direction','buy').order('created_at');
  const buys = tr||[];
  console.log('买入行:', buys.length);
  const { data: sells } = await c.from('trades')
    .select('token_address,input_amount,output_amount,created_at,metadata')
    .eq('experiment_id',EXP).eq('trade_direction','sell');
  const sellOut = new Map();
  for (const s of sells||[]) sellOut.set(s.token_address, (sellOut.get(s.token_address)||0) + (s.output_amount||0));
  // FIFO 盈亏粗算：per token 卖出 BNB 合计 − 买入 BNB 合计（input_amount 对 buy 是 BNB）
  const byTok = new Map();
  for (const b of buys) {
    if (!byTok.has(b.token_address)) byTok.set(b.token_address, { sym: b.token_symbol, buyBnb: 0, n: 0, first: b.executed_at||b.created_at });
    const e = byTok.get(b.token_address);
    e.buyBnb += b.input_amount; e.n++;
  }
  let totPnl = 0, rows = [];
  for (const [addr, e] of byTok) {
    const out = sellOut.get(addr) || 0;
    const pnl = out - e.buyBnb;
    totPnl += pnl;
    rows.push({ addr, sym: e.sym, buyBnb: +e.buyBnb.toFixed(3), pnl: +pnl.toFixed(4), n: e.n, first: e.first });
  }
  rows.sort((a,b)=>a.pnl-b.pnl);
  console.log('买入票数:', rows.length, '| 粗算总盈亏:', totPnl.toFixed(4), 'BNB');
  console.log('最差 10:'); rows.slice(0,10).forEach(r=>console.log(`  ${r.sym} ${r.addr.slice(0,10)}… buy=${r.buyBnb} pnl=${r.pnl} @${r.first}`));
  console.log('最好 5:'); rows.slice(-5).forEach(r=>console.log(`  ${r.sym} ${r.addr.slice(0,10)}… buy=${r.buyBnb} pnl=${r.pnl} @${r.first}`));
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
