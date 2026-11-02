/**
 * 临时脚本：圈定近 5 天有交易的实验与代币样本（mcap<5K 卖臂对拍 第 1 步，本地小结果只读）。
 * 输出：实验清单（含卖腿条件）、BUY/SELL 交易、per-token 出入场摘要。不做任何 tick 拉取。
 */
const { dbManager } = require('/Users/nobody1/Desktop/Codes/richer-js/src/services/dbManager');

(async () => {
  const c = dbManager.getClient();
  const cutoff = new Date(Date.now() - 5 * 86400000).toISOString();

  const { data: trades, error: e1 } = await c.from('trades')
    .select('id,experiment_id,token_address,token_symbol,trade_direction,trade_status,input_amount,output_amount,unit_price,success,is_virtual_trade,created_at,executed_at,metadata')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(2000);
  if (e1) throw new Error('trades: ' + e1.message);

  const expIds = [...new Set(trades.map(t => t.experiment_id))];
  console.log(`近5天 trades=${trades.length} experiments=${expIds.length}`);

  const { data: exps, error: e2 } = await c.from('experiments')
    .select('id,name,platform,mode,status,created_at,config')
    .in('id', expIds);
  if (e2) throw new Error('experiments: ' + e2.message);

  for (const e of exps) {
    const legs = e.config?.strategiesConfig?.legs || e.config?.strategies || [];
    const sellLegs = legs.filter(l => l.side === 'sell').map(l => ({
      name: l.name || l.strategyName || '?',
      condition: l.condition,
      bypass: l.bypassDebounce,
      cards: l.cards,
    }));
    console.log(`\n=== exp ${e.id} [${e.name}] platform=${e.platform} mode=${e.mode} status=${e.status}`);
    for (const s of sellLegs) console.log(`  SELL ${s.name} bypass=${s.bypass} cards=${s.cards}\n       cond: ${s.condition}`);
    const et = trades.filter(t => t.experiment_id === e.id);
    const buys = et.filter(t => t.trade_direction === 'buy' && t.success);
    const sells = et.filter(t => t.trade_direction === 'sell' && t.success);
    console.log(`  trades: ${et.length} (buy ${buys.length} / sell ${sells.length})`);
  }

  // per-token 汇总
  const byToken = new Map();
  for (const t of trades) {
    if (!t.success) continue;
    const k = `${t.experiment_id}:${t.token_address}`;
    if (!byToken.has(k)) byToken.set(k, { exp: t.experiment_id, token: t.token_address, symbol: t.token_symbol, buys: [], sells: [] });
    const o = byToken.get(k);
    (t.trade_direction === 'buy' ? o.buys : o.sells).push(t);
  }
  console.log(`\n持仓票（exp:token）=${byToken.size}`);
  for (const [k, o] of byToken) {
    const open = o.buys.length - o.sells.length;
    console.log(`${k} ${o.symbol || ''} buys=${o.buys.length} sells=${o.sells.length} ${open > 0 ? 'OPEN' : 'closed'}`);
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
