// bt-v110 KOL HOLD 读数：V110 vs V108 双列对比 + HOLD 触发面归因（182 跑）
import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const V108 = '8e2b37ac-d144-4de5-a0b0-d265f1585cb4';
const V110 = '80e3867f-db2c-4f68-9647-180758287ded';

async function pullTrades(eid) {
  const rows = []; let from = 0;
  while (true) {
    const { data, error } = await c.from('trades').select('token_address,trade_direction,input_amount,output_amount,created_at,signal_id,metadata')
      .eq('experiment_id', eid).order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data); if (data.length < 1000) break; from += 1000;
  }
  return rows;
}
async function pullSigs(eid) {
  const rows = []; let from = 0;
  while (true) {
    const { data, error } = await c.from('strategy_signals').select('id,token_address,action,metadata,created_at')
      .eq('experiment_id', eid).eq('action', 'sell').order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data); if (data.length < 1000) break; from += 1000;
  }
  return rows;
}
const t8 = await pullTrades(V108), t0 = await pullTrades(V110);
const s8 = await pullSigs(V108), s0 = await pullSigs(V110);

function pnlPerToken(trades) {
  const m = new Map();
  for (const t of trades) {
    const bnb = t.trade_direction === 'buy' ? -Number(t.input_amount) : Number(t.output_amount);
    m.set(t.token_address, (m.get(t.token_address) || 0) + bnb);
  }
  return m;
}
const p8 = pnlPerToken(t8), p0 = pnlPerToken(t0);
const allToks = new Set([...p8.keys(), ...p0.keys()]);
let sum8 = 0, sum0 = 0;
const diffs = [];
for (const a of allToks) {
  const v8 = p8.get(a) || 0, v0 = p0.get(a) || 0;
  sum8 += v8; sum0 += v0;
  if (Math.abs(v0 - v8) > 1e-9) diffs.push({ a, v8, v0, d: v0 - v8 });
}
console.log(`V108: ${t8.length} trades / ${p8.size} 票 / 净 ${sum8.toFixed(4)}`);
console.log(`V110: ${t0.length} trades / ${p0.size} 票 / 净 ${sum0.toFixed(4)}`);
console.log(`Δ(V110-V108) = ${(sum0 - sum8).toFixed(4)}，差异票 ${diffs.length} 张`);
diffs.sort((x, y) => y.d - x.d);
for (const d of diffs) console.log(`  ${d.a} V108=${d.v8.toFixed(4)} V110=${d.v0.toFixed(4)} Δ=${d.d.toFixed(4)}`);

// HOLD 触发面：V110 卖信号 metadata 因子快照里 sinceLastFamousBigBuySec
console.log(`\nV110 卖信号 ${s0.length} 行（V108 ${s8.length} 行）`);
const sig0 = new Map(s0.map(s => [s.id, s]));
function fmtSeq(trades, sigs, addr) {
  const list = trades.filter(t => t.token_address === addr).sort((a, b) => a.created_at < b.created_at ? -1 : 1);
  if (!list.length) return ['    （无交易）'];
  return list.map(t => {
    const m = t.signal_id ? sigs.get(t.signal_id)?.metadata : null;
    const amt = t.trade_direction === 'buy' ? `-${Number(t.input_amount).toFixed(4)}B` : `+${Number(t.output_amount).toFixed(4)}B`;
    const pp = m?.profitPercent != null ? ` pp=${Number(m.profitPercent).toFixed(0)}` : '';
    const sid = m?.strategyId || '';
    const fk = m?.sinceLastFamousBigBuySec != null ? ` fB=${m.sinceLastFamousBigBuySec}` : '';
    const fs = m?.recentFamousSellBnb != null ? ` fS=${m.recentFamousSellBnb}` : '';
    return `    ${t.created_at.slice(11, 19)} ${amt} ${sid}${pp}${fk}${fs}`;
  });
}
const WATCH = diffs.map(d => d.a).slice(0, 20);
const sig8m = new Map(s8.map(s => [s.id, s]));
console.log(`\n=== 差异票双边序列（V108 / V110）===`);
for (const a of WATCH) {
  console.log(`\n${a}`);
  console.log('  V108:'); for (const l of fmtSeq(t8, sig8m, a)) console.log(l);
  console.log('  V110:'); for (const l of fmtSeq(t0, sig0, a)) console.log(l);
}
process.exit(0);
