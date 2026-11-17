// v132 三行终局归因（干净版）：救回面/漂移/Go Brrrrr+duanju 验收
const { dbManager } = require('../src/services/dbManager.js');
async function expId(c, pre) {
  const { data } = await c.from('experiments').select('id').limit(500);
  return data.find((e) => e.id.startsWith(pre)).id;
}
async function net(c, id) {
  let rows = [], from = 0;
  while (true) {
    const { data, error } = await c.from('trades')
      .select('token_address,token_symbol,trade_direction,input_currency,input_amount,output_currency,output_amount,success')
      .eq('experiment_id', id).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows = rows.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const m = new Map();
  for (const t of rows) {
    if (t.success === false) continue;
    const buy = t.trade_direction === 'buy';
    const v = buy ? (t.input_currency === 'BNB' ? Number(t.input_amount || 0) : Number(t.output_amount || 0))
      : (t.output_currency === 'BNB' ? Number(t.output_amount || 0) : Number(t.input_amount || 0));
    let e = m.get(t.token_address);
    if (!e) { e = { sym: t.token_symbol, buyBnb: 0, sellBnb: 0 }; m.set(t.token_address, e); }
    if (buy) e.buyBnb += v; else e.sellBnb += v;
  }
  for (const [, e] of m) e.net = e.sellBnb - e.buyBnb;
  return m;
}
async function main() {
  const c = await dbManager.getClient();
  const M = { v129: await net(c, await expId(c, '4af09d63')), v131: await net(c, await expId(c, 'f3dd5537')), v132: await net(c, await expId(c, 'b67b7318')) };
  // v131→v132 救回（v131 未买 v132 买）+ 丢失（v131 买 v132 未买）
  const saved = [...M.v132.keys()].filter((k) => !M.v131.has(k));
  const lost = [...M.v131.keys()].filter((k) => !M.v132.has(k));
  console.log('== v131→v132 新买入（救回/时序） ==');
  for (const k of saved) console.log(`  v132净${fmt(M.v132.get(k).net)} v131${M.v131.has(k) ? fmt(M.v131.get(k).net) : '未买'} v129${M.v129.has(k) ? fmt(M.v129.get(k).net) : '未买'}  ${sym(M.v132.get(k).sym)} ${k}`);
  console.log('== v131→v132 丢失 ==');
  for (const k of lost) console.log(`  v131净${fmt(M.v131.get(k).net)}  ${sym(M.v131.get(k).sym)} ${k}`);
  // 三行共同/漂移（v132∩v131）
  const both = [...M.v132.keys()].filter((k) => M.v131.has(k));
  console.log(`== v131/v132 共同 ${both.length} 张 漂移=${fmt(both.reduce((s, k) => s + M.v132.get(k).net - M.v131.get(k).net, 0))} ==`);
  // Go Brrrrr + duanju 验收（v132 信号+成交）
  for (const [name, pre] of [['Go Brrrrr', '0xdae106c8'], ['duanju', '0x65aebe91']]) {
    const { data: sg } = await c.from('strategy_signals')
      .select('created_at,executed,er:metadata->>execution_reason')
      .eq('experiment_id', await expId(c, 'b67b7318')).eq('signal_type', 'BUY')
      .ilike('token_address', pre + '%').order('created_at', { ascending: true }).limit(8);
    const trades = M.v132.has([...(sg || [])].length ? '' : '') ; // noop
    const inV132 = M.v132.get(pre) || [...M.v132.keys()].find((k) => k.startsWith(pre));
    const inV129 = M.v129.get(pre) || [...M.v129.keys()].find((k) => k.startsWith(pre));
    const execRow = (sg || []).find((s) => s.executed);
    console.log(`== ${name} 验收：v132 ${inV132 ? '买入 净' + fmt(M.v132.get(inV132).net) : '未买'} / v129 ${inV129 ? '净' + fmt(M.v129.get(inV129).net) : '未买'}；exec 行=${execRow ? execRow.created_at.slice(11, 19) : '无'} ==`);
  }
  function fmt(v) { return (v >= 0 ? '+' : '') + v.toFixed(4); }
  function sym(s) { return (s || '?').slice(0, 12); }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
