// v70 13 票买/卖失衡分离度探针（pump 卖出腿设计；182 跑）
const { dbManager } = require('../src/services/dbManager.js');
const EXP = 'f0898589-58f1-4101-a648-0dc9cad41f3a';
const WALLET = '0xc3c9a4f7fe43115d282d086610e9f21f2ed2cf20';
const COLS = 'block_time,block_number,log_index,trade_type,bnb_amount,token_amount,trader_address,sender_address';

function netRatio(rows) {
  let b = 0, s = 0, bn = 0;
  for (const r of rows) { const amt = Number(r.bnb_amount || 0); if (r.trade_type === 'buy') { b += amt; bn++; } else s += amt; }
  if (rows.length === 0 || b + s <= 0) return null;
  return { ratio: (b - s) / (b + s) * 100, buyN: bn, n: rows.length };
}

async function main() {
  const c = await dbManager.getClient();
  const { data: trades } = await c.from('trades')
    .select('token_symbol,token_address,trade_direction,trade_status,input_currency,output_currency,input_amount,output_amount,created_at')
    .eq('experiment_id', EXP).order('created_at', { ascending: true }).limit(500);
  const toks = {};
  for (const t of trades || []) {
    if (t.trade_status !== 'success') continue;
    const k = t.token_address;
    toks[k] = toks[k] || { sym: t.token_symbol || k.slice(0, 8), buyBnb: 0, sellBnb: 0, firstBuyAt: null };
    const inBnb = (t.input_currency || '').toUpperCase() === 'BNB';
    const outBnb = (t.output_currency || '').toUpperCase() === 'BNB';
    const bnb = inBnb ? Number(t.input_amount || 0) : outBnb ? Number(t.output_amount || 0) : 0;
    if (/buy/i.test(t.trade_direction)) { toks[k].buyBnb += bnb; if (!toks[k].firstBuyAt) toks[k].firstBuyAt = t.created_at; }
    else toks[k].sellBnb += bnb;
  }
  const results = [];
  for (const [addr, v] of Object.entries(toks)) {
    if (v.buyBnb <= 0) continue;
    const { data: rows } = await c.from('wss_price_ticks').select(COLS)
      .eq('token_address', addr)
      .order('block_number', { ascending: false }).order('log_index', { ascending: false }).limit(8000);
    const ticks = (rows || []).slice().reverse();
    const myBuys = ticks.filter(r => r.trade_type === 'buy' &&
      ((r.sender_address || '').toLowerCase() === WALLET || (r.trader_address || '').toLowerCase() === WALLET));
    const t0 = myBuys.length ? new Date(myBuys[0].block_time).getTime() : new Date(v.firstBuyAt).getTime();
    const t0Src = myBuys.length ? 'chain' : 'db';
    const ts = ticks.map(r => ({ t: new Date(r.block_time).getTime(), r }));
    const inWin = (a, b) => ts.filter(x => x.t >= a && x.t <= b).map(x => x.r);
    const lastNAt = (t, n) => { const arr = ts.filter(x => x.t <= t).map(x => x.r); return arr.slice(-n); };
    const w30 = netRatio(inWin(t0, t0 + 30e3));
    const wAll60 = netRatio(inWin(t0, t0 + 60e3));
    const s12_30 = netRatio(lastNAt(t0 + 30e3, 12));
    const s12_60 = netRatio(lastNAt(t0 + 60e3, 12));
    const pnl = (v.sellBnb - v.buyBnb) / v.buyBnb * 100;
    results.push({ sym: v.sym, addr, pnl, w30, wAll60, s12_30, s12_60, totalTicks: ticks.length, t0Src });
  }
  results.sort((a, b) => a.pnl - b.pnl);
  console.log('符号         盈亏%   | 入场后30s净买比 | 至+60s累计 | S12@+30s | S12@+60s | ticks 锚');
  for (const r of results) {
    const f = (x) => x ? `${x.ratio.toFixed(0)}(${x.buyN}/${x.n})` : 'null';
    console.log(`${(r.sym || '').padEnd(10)} ${r.pnl.toFixed(1).padStart(7)} | ${f(r.w30).padEnd(15)} | ${f(r.wAll60).padEnd(10)} | ${f(r.s12_30).padEnd(8)} | ${f(r.s12_60).padEnd(8)} | ${String(r.totalTicks).padStart(4)} ${r.t0Src}`);
  }
  console.log('\n=== 阈值网格（入场后30s累计净买比 ≥ T → 全卖；统计触发票盈亏）===');
  for (const T of [50, 60, 70, 80, 90]) {
    const hit = results.filter(r => r.w30 && r.w30.ratio >= T);
    const win = hit.filter(r => r.pnl > 0).length;
    console.log(`T=${T}: 触发 ${hit.length}/${results.length} 票（亏 ${hit.length - win} 赚 ${win}）—— ${hit.map(r => r.sym + '(' + r.pnl.toFixed(0) + '%)').join(' ')}`);
  }
  await dbManager.close?.();
}
main().catch(e => { console.error(e); process.exit(1); });
