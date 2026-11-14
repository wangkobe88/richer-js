// 一次性读数（182 跑）：bt-v97（afe7faa8，三变量）vs bt-v96（e582e873 基底）vs bt-v94（85cbad14 BP51 基线）。
// 三变量专项：① t0a 量门 1→1.2（BUY strategyName=P1 分布变化）；② 删 pump-imbalance-exit 卖腿（SELL strategyName 分布对照）；
// ③ alwaysRecheck true→false（cheatCheck.cached 粘滞秒回出现=bt-v97 证据）。
// 口径：trades 净额=Σ(sell.output_amount)−Σ(buy.input_amount)（BNB 域，success 行）。
const { dbManager } = require('../../src/services/dbManager.js');

const EXPS = [
  { key: 'bt-v94(BP51基线)', id: '85cbad14-696f-49b2-baa4-a5407df4a2d2' },
  { key: 'bt-v96(BP52二修基底)', id: 'e582e873-7f1a-44a5-b50f-0fca576847be' },
  { key: 'bt-v97(三变量)', id: 'afe7faa8-bb8b-4b40-b57e-35000f3ad472' },
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

    const sigs = await fetchAll(client, 'strategy_signals', 'id,metadata,token_address,signal_type', e.id);
    const buySigs = sigs.filter((s) => s.signal_type === 'BUY');
    const sellSigs = sigs.filter((s) => s.signal_type === 'SELL');
    const ruleBy = new Map(), entryBy = new Map(), patBy = new Map(), gradeBy = new Map(), cachedBy = new Map();
    const buyLegBy = new Map(), sellLegBy = new Map();
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
      if (cheat && cheat.cached !== undefined) cachedBy.set(String(cheat.cached), (cachedBy.get(String(cheat.cached)) || 0) + 1);
      const leg = md.strategyName || (md.signalGate && md.signalGate.legId) || '?';
      buyLegBy.set(leg, (buyLegBy.get(leg) || 0) + 1);
    }
    for (const s of sellSigs) {
      const leg = (s.metadata || {}).strategyName || '?';
      sellLegBy.set(leg, (sellLegBy.get(leg) || 0) + 1);
    }
    const fmt = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ') || '(空)';
    console.log(`   BUY 信号 ${buySigs.length} 条；bp.rule: ${fmt(ruleBy)}`);
    console.log(`   entry_shape: ${fmt(entryBy)}；market_pattern: ${fmt(patBy)}`);
    console.log(`   cheat.grade: ${fmt(gradeBy)}；cheat.cached: ${fmt(cachedBy)}`);
    console.log(`   BUY 腿分布: ${fmt(buyLegBy)}`);
    console.log(`   SELL 腿分布(${sellSigs.length}): ${fmt(sellLegBy)}`);
    console.log('');
  }
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
