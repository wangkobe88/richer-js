// bt-v141（全量修改）vs bt-v140（v28 基线）按票盈亏差集归因
const { dbManager } = require('../src/services/dbManager.js');

const EXPS = {
  base: '550f9e89-1deb-49af-98b9-9906265b1161',  // bt-v133 同窗基线
  v141: '8a7b6b09-e2bc-4773-8393-a696821ff531',   // bt-v142
};

async function tokenPnl(c, expId) {
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
  const map = new Map();
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
  const [mB, mN] = await Promise.all([tokenPnl(c, EXPS.base), tokenPnl(c, EXPS.v141)]);
  const sum = (m) => [...m.values()].reduce((a, e) => a + e.pnl, 0);
  console.log(`v133 基线: ${mB.size} 票 Σ${sum(mB).toFixed(4)}`);
  console.log(`v142 全量: ${mN.size} 票 Σ${sum(mN).toFixed(4)}`);

  const both = [...mB.keys()].filter(a => mN.has(a));
  const onlyB = [...mB.keys()].filter(a => !mN.has(a));
  const onlyN = [...mN.keys()].filter(a => !mB.has(a));
  const s = (m, arr) => arr.reduce((a, k) => a + m.get(k).pnl, 0);

  console.log(`\n== 共同 ${both.length} 票：v140 Σ${s(mB, both).toFixed(4)} vs v141 Σ${s(mN, both).toFixed(4)}（Δ${(s(mN, both) - s(mB, both)).toFixed(4)}）==`);
  const drift = both.map(a => ({ a, d: mN.get(a).pnl - mB.get(a).pnl, sym: mB.get(a).symbol }))
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 10);
  for (const d of drift) if (Math.abs(d.d) > 0.005) console.log(`  ${d.sym} ${d.a.slice(0, 10)} Δ${d.d.toFixed(4)} (v140 ${mB.get(d.a).pnl.toFixed(4)} → v141 ${mN.get(d.a).pnl.toFixed(4)})`);

  console.log(`\n== v133 独买 ${onlyB.length} 票 Σ${s(mB, onlyB).toFixed(4)}（v142 不再买（跨代策略差）/门链变化不再买）==`);
  for (const a of onlyB.sort((x, y) => mB.get(y).pnl - mB.get(x).pnl)) {
    const e = mB.get(a);
    console.log(`  ${e.pnl >= 0 ? '［误伤］' : '［止血］'} ${e.symbol} ${a.slice(0, 10)} pnl ${e.pnl.toFixed(4)} (${e.n} 笔)`);
  }

  console.log(`\n== v142 独买 ${onlyN.length} 票 Σ${s(mN, onlyN).toFixed(4)}（时序/门链变化新增入场）==`);
  for (const a of onlyN.sort((x, y) => mN.get(y).pnl - mN.get(x).pnl)) {
    const e = mN.get(a);
    console.log(`  ${e.pnl >= 0 ? '［盈利］' : '［亏损］'} ${e.symbol} ${a.slice(0, 10)} pnl ${e.pnl.toFixed(4)} (${e.n} 笔)`);
  }
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
