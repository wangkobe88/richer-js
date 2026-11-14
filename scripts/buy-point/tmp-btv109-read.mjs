// bt-v109 全体系长周期基底读数（182 跑）：票级盈亏 + 买腿/门拒/卖臂分布
import { dbManager } from '../../src/services/dbManager.js';

const EXP = '029bd863-55e5-4319-91d5-10803a6a9a82';

async function pull(table, cols, eid) {
  const c = await dbManager.getClient();
  const rows = []; let from = 0;
  while (true) {
    const { data, error } = await c.from(table).select(cols).eq('experiment_id', eid).order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(table + ': ' + error.message);
    rows.push(...data); if (data.length < 1000) break; from += 1000;
  }
  return rows;
}

const trades = await pull('trades', 'token_address,trade_direction,input_amount,output_amount,created_at,signal_id,metadata', EXP);
const sigs = await pull('strategy_signals', 'id,token_address,action,executed,reason,metadata,created_at', EXP);
console.log(`trades=${trades.length} signals=${sigs.length}`);

// ── 票级盈亏 ──
const per = new Map();
for (const t of trades) {
  if (!per.has(t.token_address)) per.set(t.token_address, { buy: 0, sell: 0, nBuy: 0, nSell: 0 });
  const o = per.get(t.token_address);
  if (t.trade_direction === 'buy') { o.buy += Number(t.input_amount || 0); o.nBuy++; }
  else { o.sell += Number(t.output_amount || 0); o.nSell++; }
}
for (const o of per.values()) o.net = o.sell - o.buy;
const nets = [...per.values()].map(o => o.net);
const tot = nets.reduce((s, x) => s + x, 0);
const wins = nets.filter(x => x > 1e-9).length;
console.log(`\n=== 盈亏总览 ===`);
console.log(`成交票数=${per.size} | 总净额=${tot.toFixed(4)} BNB | 胜率=${per.size ? (wins / per.size * 100).toFixed(1) : 0}% (${wins}/${per.size})`);
console.log(`最差=${Math.min(...nets, 0).toFixed(4)} | 最好=${Math.max(...nets, 0).toFixed(4)}`);

const sorted = [...per.entries()].sort((a, b) => b[1].net - a[1].net);
console.log(`\n=== Top10 盈利票 ===`);
for (const [a, o] of sorted.slice(0, 10)) console.log(`  +${o.net.toFixed(4)} ${a} (买${o.buy.toFixed(3)}×${o.nBuy} 卖${o.sell.toFixed(3)}×${o.nSell})`);
console.log(`=== Top10 亏损票 ===`);
for (const [a, o] of sorted.slice(-10).reverse()) console.log(`  ${o.net.toFixed(4)} ${a} (买${o.buy.toFixed(3)}×${o.nBuy} 卖${o.sell.toFixed(3)}×${o.nSell})`);

// ── 信号/门拒分布 ──
const sigById = new Map(sigs.map(s => [s.id, s]));
const buySigs = sigs.filter(s => s.action === 'buy');
console.log(`\n=== 信号分布 ===`);
console.log(`BUY 信号=${buySigs.length}（成交 ${trades.filter(t => t.trade_direction === 'buy').length} 笔）`);
const failReason = new Map();
for (const s of buySigs) {
  const md = s.metadata || {};
  const fail = md.cheatCheck?.status === 'rejected' ? `cheat:${md.cheatCheck.grade}`
    : md.buyPoint?.status ? `bp:${md.buyPoint.status}`
    : (s.reason || md.failureReason || '其它');
  const k = s.executed ? 'executed' : fail;
  failReason.set(k, (failReason.get(k) || 0) + 1);
}
for (const [k, n] of [...failReason.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(k).slice(0, 60)}: ${n}`);

// 买腿分布（成交买信号 strategyName）
const legDist = new Map();
for (const t of trades.filter(x => x.trade_direction === 'buy')) {
  const md = (t.signal_id && sigById.get(t.signal_id)?.metadata) || t.metadata || {};
  const n = md.strategyName || md.legName || '?';
  legDist.set(n, (legDist.get(n) || 0) + 1);
}
console.log(`\n=== 成交买腿分布 ===`);
for (const [k, n] of [...legDist.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);

// 卖臂分布
const sellDist = new Map();
for (const t of trades.filter(x => x.trade_direction === 'sell')) {
  const md = (t.signal_id && sigById.get(t.signal_id)?.metadata) || t.metadata || {};
  const n = md.strategyName || md.legName || '?';
  sellDist.set(n, (sellDist.get(n) || 0) + 1);
}
console.log(`\n=== 卖臂分布 ===`);
for (const [k, n] of [...sellDist.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);
process.exit(0);
