// bt-v114 vs bt-v115 对照归因（2026-11-15）：三变量=T139 滚动地板+删 gmgn-entry 腿+HOLD 180
const { dbManager } = require('../src/services/dbManager.js');
const V114 = '685c9518-27eb-4be1-ac4c-764dc488a5f6';
const V115 = '34e78e97-2b1f-4e3d-8272-b0cdd6b641ca';

async function pull(c, expId, tag) {
  let rows = [], from = 0;
  while (true) {
    const { data, error } = await c.from('trades')
      .select('token_address,token_symbol,trade_direction,input_currency,input_amount,output_currency,output_amount,success,created_at')
      .eq('experiment_id', expId).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows = rows.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const byToken = new Map();
  for (const t of rows) {
    if (t.success === false) continue;
    const buy = t.trade_direction === 'buy';
    const v = buy
      ? (t.input_currency === 'BNB' ? Number(t.input_amount || 0) : t.output_currency === 'BNB' ? Number(t.output_amount || 0) : 0)
      : (t.output_currency === 'BNB' ? Number(t.output_amount || 0) : t.input_currency === 'BNB' ? Number(t.input_amount || 0) : 0);
    let e = byToken.get(t.token_address);
    if (!e) { e = { sym: t.token_symbol, buyBnb: 0, sellBnb: 0, nBuy: 0, nSell: 0, firstBuyAt: null, lastSellAt: null }; byToken.set(t.token_address, e); }
    if (buy) { e.buyBnb += v; e.nBuy++; if (!e.firstBuyAt || t.created_at < e.firstBuyAt) e.firstBuyAt = t.created_at; }
    else { e.sellBnb += v; e.nSell++; if (!e.lastSellAt || t.created_at > e.lastSellAt) e.lastSellAt = t.created_at; }
  }
  for (const [k, e] of byToken) e.net = e.sellBnb - e.buyBnb;
  console.log(`${tag}: trades=${rows.length} tokens=${byToken.size} net=${[...byToken.values()].reduce((s, e) => s + e.net, 0).toFixed(4)} win=${[...byToken.values()].filter((e) => e.net > 0).length}`);
  return byToken;
}

async function main() {
  const c = await dbManager.getClient();
  const a = await pull(c, V114, 'bt-v114(恒常量+gmgn腿+HOLD120)');
  const b = await pull(c, V115, 'bt-v115(T139地板+删gmgn腿+HOLD180)');

  const both = [...a.keys()].filter((k) => b.has(k));
  const onlyA = [...a.keys()].filter((k) => !b.has(k));
  const onlyB = [...b.keys()].filter((k) => !a.has(k));
  const sum = (m, ks) => ks.reduce((s, k) => s + m.get(k).net, 0);
  console.log(`\n== 分组 ==\n共同 ${both.length} 票 net: v114=${sum(a, both).toFixed(4)} v115=${sum(b, both).toFixed(4)} Δ=${(sum(b, both) - sum(a, both)).toFixed(4)}`);
  console.log(`仅 v114 ${onlyA.length} 票 net(v114 口径)=${sum(a, onlyA).toFixed(4)}  [v115 未买=T139 地板 curVs 抬高过门族]`);
  console.log(`仅 v115 ${onlyB.length} 票 net(v115 口径)=${sum(b, onlyB).toFixed(4)}`);

  console.log('\n== 仅 v114 票明细（net 排序，|net|>=0.01 全列）==');
  const oa = onlyA.map((k) => ({ k, ...a.get(k) })).sort((x, y) => y.net - x.net);
  for (const r of oa) if (Math.abs(r.net) >= 0.01) console.log(`  ${r.net >= 0 ? '+' : ''}${r.net.toFixed(4)} ${(r.sym || '?').slice(0, 10).padEnd(11)} ${r.k} 买${r.nBuy}次`);

  console.log('\n== 仅 v115 票明细 ==');
  for (const r of onlyB.map((k) => ({ k, ...b.get(k) })).sort((x, y) => y.net - x.net))
    if (Math.abs(r.net) >= 0.01) console.log(`  ${r.net >= 0 ? '+' : ''}${r.net.toFixed(4)} ${(r.sym || '?').slice(0, 10).padEnd(11)} ${r.k} 买${r.nBuy}次`);

  console.log('\n== 共同票 Δnet 排序（|Δ|>=0.03）==');
  const both2 = both.map((k) => ({ k, sym: a.get(k).sym, na: a.get(k).net, nb: b.get(k).net, d: b.get(k).net - a.get(k).net,
    fa: a.get(k).firstBuyAt, fb: b.get(k).firstBuyAt })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  for (const r of both2) if (Math.abs(r.d) >= 0.03)
    console.log(`  Δ=${r.d >= 0 ? '+' : ''}${r.d.toFixed(4)} (v114 ${r.na.toFixed(4)} → v115 ${r.nb.toFixed(4)}) ${(r.sym || '?').slice(0, 10).padEnd(11)} ${r.k}${r.fa !== r.fb ? ' [首买时刻不同]' : ''}`);
  const dAll = both2.reduce((s, r) => s + r.d, 0);
  console.log(`  共同票 Δ 合计=${dAll.toFixed(4)}；其中首买时刻不同票数=${both2.filter((r) => r.fa !== r.fb).length}`);

  // sell 信号 strategy_id 分布对照（行为级：HOLD 释放腿/删腿/gmgn 腿触发计数）
  for (const [expId, tag] of [[V114, 'v114'], [V115, 'v115']]) {
    const { data, error } = await c.from('strategy_signals').select('strategy_id,signal_type,status')
      .eq('experiment_id', expId).eq('signal_type', 'SELL');
    if (error) throw new Error(error.message);
    const dist = new Map();
    for (const s of data) dist.set(s.strategy_id, (dist.get(s.strategy_id) || 0) + 1);
    console.log(`\n== ${tag} SELL 信号 strategy_id 分布（n=${data.length}）==`);
    for (const [sid, n] of [...dist.entries()].sort((x, y) => y[1] - x[1])) console.log(`  ${sid}: ${n}`);
  }
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
