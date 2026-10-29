/**
 * v61（5298b7bd，T102 momentum 臂版）按臂归属战绩——用户「新实验亏的有点惨」
 * 归属=买点 metadata.factors.narrativeRating（1=momentum 臂；2|3=评级臂）。
 */
const { dbManager } = require('../src/services/dbManager.js');
const V61 = '5298b7bd-8374-458d-b9e3-c5fe581e681d';
const BNB_LIKE = new Set(['BNB', 'WBNB', 'WNB']);
const num = (v) => (v === null || v === undefined ? null : Number(v));
const ts = (s) => new Date(s).getTime();

(async () => {
  const db = await dbManager.getClient();
  const res = await db.from('trades')
    .select('token_address,token_symbol,trade_direction,input_currency,output_currency,input_amount,output_amount,created_at,metadata')
    .eq('experiment_id', V61).eq('success', true).order('created_at');
  if (res.error) throw new Error(res.error.message);
  const trades = res.data || [];

  const groups = new Map();
  for (const t of trades) {
    if (!groups.has(t.token_address)) groups.set(t.token_address, []);
    groups.get(t.token_address).push(t);
  }
  const rows = [];
  for (const [token, list] of groups) {
    list.sort((a, b) => ts(a.created_at) - ts(b.created_at));
    let qty = 0, cost = 0, proceeds = 0, rating = null, ageSec = null;
    for (const t of list) {
      const buy = t.trade_direction === 'buy';
      if (!BNB_LIKE.has(buy ? t.input_currency : t.output_currency)) continue;
      const bnb = num(buy ? t.input_amount : t.output_amount);
      const tok = num(buy ? t.output_amount : t.input_amount);
      if (!(bnb > 0) || !(tok > 0)) continue;
      if (buy) {
        const f = (t.metadata && t.metadata.factors) || {};
        if (rating === null) { rating = f.trendFactors?.narrativeRating ?? null; ageSec = f.trendFactors?.tokenAgeSec ?? null; }
        qty += tok; cost += bnb;
      } else {
        qty -= Math.min(tok, qty); proceeds += bnb;
      }
    }
    const arm = rating === 1 ? 'momentum' : (rating === 2 || rating === 3) ? 'rated' : '?';
    rows.push({ symbol: list[0].token_symbol, token, arm, rating, ageSec, cost, proceeds, qty, realized: proceeds - cost });
  }
  rows.sort((a, b) => a.realized - b.realized);
  for (const arm of ['momentum', 'rated', '?']) {
    const sub = rows.filter(r => r.arm === arm);
    if (!sub.length) continue;
    console.log(`\n===== ${arm} 臂（${sub.length} round）=====`);
    for (const r of sub) {
      console.log(`${r.realized >= 0 ? '+' : ''}${r.realized.toFixed(5)} BNB | 投 ${r.cost.toFixed(4)} | 余仓 ${(r.qty > 1e-9 ? r.qty.toExponential(2) : '0')} | rating=${r.rating} age=${r.ageSec == null ? '?' : Math.round(r.ageSec) + 's'} | ${r.symbol} ${r.token.slice(0, 10)}…`);
    }
    console.log(`小计: 投 ${sub.reduce((s, r) => s + r.cost, 0).toFixed(4)} | 已实现 ${(sub.reduce((s, r) => s + r.realized, 0) >= 0 ? '+' : '')}${sub.reduce((s, r) => s + r.realized, 0).toFixed(5)} BNB`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
