// routerPct 分桶盈亏分布：验证 60 档最优性（R0 全部 73 买入票，实际现金流口径）
'use strict';
require('dotenv').config({ path: '/home/ubuntu/richer-js/config/.env' });
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');

const R0 = '8e9fa667-f061-4d54-9ebb-74fa3113f4f6';

async function main() {
  const c = dbManager.getClient();
  const { data: trades, error } = await c.from('trades')
    .select('token_address,token_symbol,trade_direction,input_amount,output_amount')
    .eq('experiment_id', R0).order('created_at');
  if (error) throw new Error(error.message);
  const { data: sigs, error: e2 } = await c.from('strategy_signals')
    .select('token_address,metadata->preBuyCheckFactors->earlyTradesRouterPct')
    .eq('experiment_id', R0).eq('action', 'buy').limit(4000);
  if (e2) throw new Error(e2.message);

  // 每 token 现金流（买-卖）+ 首个信号 routerPct
  const pnl = new Map(), router = new Map(), sym = new Map();
  for (const t of trades) {
    const v = (Number(t.trade_direction === 'buy' ? t.input_amount : t.output_amount) || 0)
      * (t.trade_direction === 'buy' ? -1 : 1);
    pnl.set(t.token_address, (pnl.get(t.token_address) || 0) + v);
    sym.set(t.token_address, t.token_symbol);
  }
  for (const s of sigs) {
    if (router.has(s.token_address)) continue;
    if (s.earlyTradesRouterPct != null) router.set(s.token_address, s.earlyTradesRouterPct);
  }

  const buckets = [
    ['<30', -1, 30], ['30-50', 30, 50], ['50-60', 50, 60],
    ['60-70', 60, 70], ['70-80', 70, 80], ['80-100', 80, 101],
  ];
  console.log('R0 买入票 routerPct 分桶（净额=现金流：买−卖，未清仓含强平）');
  console.log('桶\t票数\t亏/赢\t净额BNB\t明细');
  for (const [name, lo, hi] of buckets) {
    const rows = [...pnl.keys()].filter(t => {
      const r = router.get(t);
      return r != null && r >= lo && r < hi;
    }).map(t => ({ t, s: sym.get(t), v: pnl.get(t), r: router.get(t) }));
    if (!rows.length) { console.log(`${name}\t0`); continue; }
    const net = rows.reduce((a, r) => a + r.v, 0);
    const losers = rows.filter(r => r.v < 0).length;
    console.log(`${name}\t${rows.length}\t${losers}/${rows.length - losers}\t${net.toFixed(4)}\t` +
      rows.map(r => `${r.s}:${r.v >= 0 ? '+' : ''}${r.v.toFixed(3)}@${r.r.toFixed(0)}%`).join(' '));
  }
  const noRouter = [...pnl.keys()].filter(t => !router.has(t));
  if (noRouter.length) console.log(`无router值信号: ${noRouter.length} 票（covered=0 或 signal 缺失）净 ${noRouter.reduce((a, t) => a + pnl.get(t), 0).toFixed(4)}`);
  process.exit(0);
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
