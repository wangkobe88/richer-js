// 一次性读数（182 跑）：bt-v96（e582e873，BP58 二修+精简题面）vs bt-v95（首版 BP52）vs bt-v94（BP51 基线）。
// 口径：trades 净额=Σ(sell.output_amount)−Σ(buy.input_amount)（BNB 域，success 行）；
// 门链统计=strategy_signals BUY 行 metadata 买点门 rule/entry_shape/pattern 桶分布 + cheat grade 分布。
const { dbManager } = require('../../src/services/dbManager.js');

const EXPS = [
  { key: 'bt-v94(BP51基线)', id: '85cbad14-696f-49b2-baa4-a5407df4a2d2' },
  { key: 'bt-v95(BP52首版)', id: '675c71a1-0e19-49b6-924b-facffc073afd' },
  { key: 'bt-v96(BP52二修)', id: 'e582e873-7f1a-44a5-b50f-0fca576847be' },
];

async function fetchAll(client, table, cols, eq) {
  const out = [];
  let from = 0;
  for (;;) {
    const q = client.from(table).select(cols).eq('experiment_id', eq).order('id', { ascending: true }).range(from, from + 999);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return out;
}

async function main() {
  const client = await dbManager.getClient();
  for (const e of EXPS) {
    const trades = await fetchAll(client, 'trades', 'id,trade_direction,input_amount,output_amount,success,token_address', e.id);
    const ok = trades.filter((t) => t.success);
    const buys = ok.filter((t) => t.trade_direction === 'buy');
    const sells = ok.filter((t) => t.trade_direction === 'sell');
    const bnbIn = buys.reduce((a, t) => a + Number(t.input_amount || 0), 0);
    const bnbOut = sells.reduce((a, t) => a + Number(t.output_amount || 0), 0);
    console.log(`== ${e.key} trades: buy=${buys.length} sell=${sells.length} 净额=${(bnbOut - bnbIn).toFixed(4)} BNB (in=${bnbIn.toFixed(4)} out=${bnbOut.toFixed(4)})`);

    // 成交票级盈亏
    const byToken = new Map();
    for (const t of ok) {
      const m = byToken.get(t.token_address) || { in: 0, out: 0 };
      if (t.trade_direction === 'buy') m.in += Number(t.input_amount || 0); else m.out += Number(t.output_amount || 0);
      byToken.set(t.token_address, m);
    }
    const rows = [...byToken.entries()].map(([addr, m]) => ({ addr, pnl: m.out - m.in })).sort((a, b) => b.pnl - a.pnl);
    const pos = rows.filter((r) => r.pnl > 0), neg = rows.filter((r) => r.pnl <= 0);
    console.log(`   票级: ${rows.length} 票（正 ${pos.length} / 负 ${neg.length}）正 Σ=${pos.reduce((a, r) => a + r.pnl, 0).toFixed(4)} 负 Σ=${neg.reduce((a, r) => a + r.pnl, 0).toFixed(4)}`);
    console.log(`   Top5: ${rows.slice(0, 5).map((r) => `${r.addr.slice(0, 8)} ${r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(4)}`).join(' | ')}`);
    console.log(`   Bot5: ${rows.slice(-5).reverse().map((r) => `${r.addr.slice(0, 8)} ${r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(4)}`).join(' | ')}`);

    // 门链统计：BUY 信号 metadata
    const sigs = await fetchAll(client, 'strategy_signals', 'id,metadata,token_address,signal_type', e.id);
    const buySigs = sigs.filter((s) => s.signal_type === 'BUY');
    const ruleBy = new Map(), entryBy = new Map(), patBy = new Map(), gradeBy = new Map();
    for (const s of buySigs) {
      const md = s.metadata || {};
      const bp = md.buyPoint || md.buyPointCheck || null;
      const cheat = md.cheatCheck || md.cheat || null;
      const rule = bp && bp.rule ? bp.rule : (bp && bp.status === 'pass' ? 'pass' : null);
      if (rule) ruleBy.set(rule, (ruleBy.get(rule) || 0) + 1);
      const es = bp && (bp.dimensions || {}).entry_shape;
      if (es && es.bucket) entryBy.set(es.bucket, (entryBy.get(es.bucket) || 0) + 1);
      const mp = bp && (bp.dimensions || {}).market_pattern;
      if (mp && mp.bucket) patBy.set(mp.bucket, (patBy.get(mp.bucket) || 0) + 1);
      const g = cheat && cheat.grade ? cheat.grade : null;
      if (g) gradeBy.set(g, (gradeBy.get(g) || 0) + 1);
    }
    const fmt = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ') || '(空)';
    console.log(`   BUY 信号 ${buySigs.length} 条；bp.rule: ${fmt(ruleBy)}`);
    console.log(`   entry_shape: ${fmt(entryBy)}；market_pattern: ${fmt(patBy)}；cheat.grade: ${fmt(gradeBy)}`);
  }
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
