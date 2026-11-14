// bt-v108 vs V107 读数对照：逐票 Δ + peak-protect 触发面 + 焦点票明细（182 跑）
import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const V107 = '6b016c53-0c20-4a50-94c3-c2de2f205b79';
const V108 = '8e2b37ac-d144-4de5-a0b0-d265f1585cb4';
async function pull(table, cols, eid) {
  const rows = []; let from = 0;
  while (true) {
    const { data, error } = await c.from(table).select(cols).eq('experiment_id', eid).order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(table + ': ' + error.message);
    rows.push(...data); if (data.length < 1000) break; from += 1000;
  }
  return rows;
}
const t107 = await pull('trades', 'token_address,trade_direction,input_amount,output_amount,created_at,signal_id', V107);
const t108 = await pull('trades', 'token_address,trade_direction,input_amount,output_amount,created_at,signal_id', V108);
function roundNet(rows) {
  const m = new Map();
  for (const t of rows) {
    if (!m.has(t.token_address)) m.set(t.token_address, { buy: 0, sell: 0, trades: [] });
    const o = m.get(t.token_address); o.trades.push(t);
    if (t.trade_direction === 'buy') o.buy += Number(t.input_amount || 0); else o.sell += Number(t.output_amount || 0);
  }
  for (const o of m.values()) o.net = o.sell - o.buy;
  return m;
}
const r107 = roundNet(t107), r108 = roundNet(t108);
const s107 = [...r107.values()].reduce((s, o) => s + o.net, 0), s108 = [...r108.values()].reduce((s, o) => s + o.net, 0);
console.log(`V107: ${r107.size} 票 net=${s107.toFixed(4)} | V108: ${r108.size} 票 net=${s108.toFixed(4)} | Δ=${(s108 - s107).toFixed(4)}`);
const allAddr = new Set([...r107.keys(), ...r108.keys()]);
const deltas = [];
for (const a of allAddr) {
  const n7 = r107.get(a)?.net ?? 0, n8 = r108.get(a)?.net ?? 0;
  deltas.push({ a, n7, n8, d: n8 - n7 });
}
const diff = deltas.filter(x => Math.abs(x.d) > 1e-6);
console.log(`\n行为差异票 ${diff.length} 张：`);
for (const x of diff.sort((p, q) => q.d - p.d)) console.log(`  ${x.d >= 0 ? '+' : ''}${x.d.toFixed(4)} ${x.a} V107=${x.n7.toFixed(4)} → V108=${x.n8.toFixed(4)}`);
const same = deltas.filter(x => Math.abs(x.d) <= 1e-6).length;
console.log(`\n逐票 bit 一致=${same}/${deltas.length}`);
const sigs108 = await pull('strategy_signals', 'id,token_address,action,metadata,created_at', V108);
const sellSigs = sigs108.filter(s => s.action === 'sell');
console.log(`\nV108 卖信号 ${sellSigs.length} 行；metadata 首行 keys=`, sellSigs[0] ? Object.keys(sellSigs[0].metadata || {}).join(',') : '无');
const trig = sellSigs.filter(s => (s.metadata?.condition || '').includes('peakProfitPct >= 80'));
console.log(`\npeak-protect 触发信号 ${trig.length} 行：`);
const trigByTok = new Map();
for (const s of trig) {
  if (!trigByTok.has(s.token_address)) trigByTok.set(s.token_address, []);
  trigByTok.get(s.token_address).push(s);
}
for (const [a, list] of trigByTok) {
  const n7 = r107.get(a)?.net ?? 0, n8 = r108.get(a)?.net ?? 0;
  console.log(`  ${a} 触发 ${list.length} 次 @${list.map(s => s.created_at.slice(11, 19)).join(',')} V107=${n7.toFixed(4)} → V108=${n8.toFixed(4)}`);
}
const FOCUS = ['0x28ad2c7d08d83a85467bd4afcfd673dfce564444','0xc84a0ff2e7bab3d32cb6426f07855b70694f7777','0x32f18a98e4fc3b33013f80454faae710a6367777','0xb88113c98d5e33b15925edd635170e80a0fbffff','0x13d7a62693e2860ba4bd51d6c9c75edc53427777'];
const sigById = new Map(sigs108.map(s => [s.id, s]));
console.log(`\n=== 焦点票 V108 交易明细 ===`);
for (const a of FOCUS) {
  const o = r108.get(a); if (!o) { console.log(`${a.slice(0, 10)}: 无交易`); continue; }
  console.log(`${a.slice(0, 10)} net=${o.net.toFixed(4)} (V107 ${(r107.get(a)?.net ?? 0).toFixed(4)})`);
  for (const t of o.trades.sort((x, y) => x.created_at < y.created_at ? -1 : 1)) {
    const m = t.signal_id ? sigById.get(t.signal_id)?.metadata : null;
    console.log(`  ${t.created_at.slice(11, 19)} ${t.trade_direction} in=${Number(t.input_amount).toFixed(4)} out=${Number(t.output_amount).toFixed(4)} ${m?.strategyName || ''}${(m?.condition || '').includes('peakProfitPct >= 80') ? ' [peak-protect]' : ''}`);
  }
}
process.exit(0);
