// bt-v140（ladder v28 豁免<0）vs bt-v138（v26 豁免<10+无推迟豁免）按票盈亏差集归因
const { dbManager } = require('../src/services/dbManager.js');

const EXPS = {
  v138: '341dd3af-fe17-430f-9fbb-490b4f4e42d0',
  v140: '6e75ed6d-807a-4164-9551-d3b95d1fc37b',
};

async function tokenPnl(c, expId) {
  // 分页拉全 trades（回测 299/318 笔一页够，留 1000 帽保险）
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await c.from('trades')
      .select('token_address,token_symbol,trade_direction,input_amount,output_amount,executed_at')
      .eq('experiment_id', expId)
      .eq('success', true)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const map = new Map(); // addr -> {symbol, buy, sell, n}
  for (const t of rows) {
    const e = map.get(t.token_address) || { symbol: t.token_symbol, buy: 0, sell: 0, n: 0 };
    if (t.trade_direction === 'buy') e.buy += t.input_amount;
    else e.sell += t.output_amount;
    e.n += 1;
    map.set(t.token_address, e);
  }
  for (const e of map.values()) e.pnl = e.sell - e.buy;
  return map;
}

async function main() {
  const c = await dbManager.getClient();
  const [m138, m140] = await Promise.all([tokenPnl(c, EXPS.v138), tokenPnl(c, EXPS.v140)]);
  const sum = (m) => [...m.values()].reduce((a, e) => a + e.pnl, 0);
  console.log(`v138: ${m138.size} 票 Σ${sum(m138).toFixed(4)}`);
  console.log(`v140: ${m140.size} 票 Σ${sum(m140).toFixed(4)}`);

  const both = [...m138.keys()].filter(a => m140.has(a));
  const only138 = [...m138.keys()].filter(a => !m140.has(a));
  const only140 = [...m140.keys()].filter(a => !m138.has(a));
  const s = (m, arr) => arr.reduce((a, k) => a + m.get(k).pnl, 0);

  console.log(`\n== 共同 ${both.length} 票：v138 Σ${s(m138, both).toFixed(4)} vs v140 Σ${s(m140, both).toFixed(4)}（Δ${(s(m140, both) - s(m138, both)).toFixed(4)}）==`);
  const drift = both.map(a => ({ a, d: m140.get(a).pnl - m138.get(a).pnl, s138: m138.get(a).symbol }))
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 8);
  for (const d of drift) if (Math.abs(d.d) > 0.005) console.log(`  ${d.s138} ${d.a.slice(0, 10)} Δ${d.d.toFixed(4)} (v138 ${m138.get(d.a).pnl.toFixed(4)} → v140 ${m140.get(d.a).pnl.toFixed(4)})`);

  console.log(`\n== v138 独买 ${only138.length} 票 Σ${s(m138, only138).toFixed(4)}（v140 豁免收紧/门变化不再买）==`);
  for (const a of only138.sort((x, y) => m138.get(y).pnl - m138.get(x).pnl)) {
    const e = m138.get(a);
    console.log(`  ${e.pnl >= 0 ? '［误伤］' : '［止血］'} ${e.symbol} ${a.slice(0, 10)} pnl ${e.pnl.toFixed(4)} (${e.n} 笔)`);
  }

  console.log(`\n== v140 独买 ${only140.length} 票 Σ${s(m140, only140).toFixed(4)}（推迟门豁免臂等新增）==`);
  for (const a of only140.sort((x, y) => m140.get(y).pnl - m140.get(x).pnl)) {
    const e = m140.get(a);
    console.log(`  ${e.pnl >= 0 ? '［盈利］' : '［亏损］'} ${e.symbol} ${a.slice(0, 10)} pnl ${e.pnl.toFixed(4)} (${e.n} 笔)`);
  }
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
