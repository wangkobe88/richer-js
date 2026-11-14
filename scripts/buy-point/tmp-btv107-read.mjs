// bt-v107 票级读数（182 跑）：per-token 盈亏汇总 + 三张误伤票（来财/28ad/谷谷）翻回验证 + V105/V106/V107 对照
import { dbManager } from '../../src/services/dbManager.js';

const V105 = '79aedc57-3493-40be-9ed0-9c067f2c2cec';
const V106 = '90da8b3f-0ae5-4c33-bae4-928a03d9984f';
const V107 = '6b016c53-0c20-4a50-94c3-c2de2f205b79';
const TARGETS = [
  ['来财', '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777'],
  ['28ad', '0x28ad2c7d08d83a85467bd4afcfd673dfce564444'],
  ['谷谷', '0x32f18a98e4fc3b33013f80454faae710a6367777'],
];

async function pull(expId) {
  const c = await dbManager.getClient();
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await c.from('trades')
      .select('token_address,trade_direction,input_amount,output_amount,created_at,success')
      .eq('experiment_id', expId).eq('success', true).order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

function summarize(rows) {
  const m = new Map();
  for (const t of rows) {
    const k = t.token_address;
    if (!m.has(k)) m.set(k, { buy: 0, sell: 0, nBuy: 0, nSell: 0, first: t.created_at, last: t.created_at });
    const o = m.get(k);
    const amt = Number(t.input_amount || 0) + Number(t.output_amount || 0); // 哨兵，不用
    void amt;
    if (t.trade_direction === 'buy') { o.buy += Number(t.input_amount || 0); o.nBuy++; }
    else if (t.trade_direction === 'sell') { o.sell += Number(t.output_amount || 0); o.nSell++; }
    if (t.created_at < o.first) o.first = t.created_at;
    if (t.created_at > o.last) o.last = t.created_at;
  }
  for (const [k, o] of m) o.net = o.sell - o.buy;
  return m;
}

const v105 = summarize(await pull(V105));
const v106 = summarize(await pull(V106));
const v107 = summarize(await pull(V107));
const tot = (m) => [...m.values()].reduce((s, o) => s + o.net, 0);

console.log(`V105: ${v105.size} tokens  net=${tot(v105).toFixed(4)}`);
console.log(`V106: ${v106.size} tokens  net=${tot(v106).toFixed(4)}`);
console.log(`V107: ${v107.size} tokens  net=${tot(v107).toFixed(4)}`);

console.log('\n=== 三张误伤票翻回验证 ===');
for (const [name, addr] of TARGETS) {
  const a = v105.get(addr), b = v106.get(addr), d = v107.get(addr);
  console.log(`\n[${name}] ${addr}`);
  console.log(`  V105: ${a ? `net=${a.net.toFixed(4)} (buy ${a.buy.toFixed(3)}×${a.nBuy} / sell ${a.sell.toFixed(3)}×${a.nSell}) ${a.first}~${a.last}` : '无成交'}`);
  console.log(`  V106: ${b ? `net=${b.net.toFixed(4)} (buy ${b.buy.toFixed(3)}×${b.nBuy} / sell ${b.sell.toFixed(3)}×${b.nSell}) ${b.first}~${b.last}` : '无成交'}`);
  console.log(`  V107: ${d ? `net=${d.net.toFixed(4)} (buy ${d.buy.toFixed(3)}×${d.nBuy} / sell ${d.sell.toFixed(3)}×${d.nSell}) ${d.first}~${d.last}` : '无成交'}`);
}

// 差集：V107 vs V105 双向（净额变动 >0.02 的票）
console.log('\n=== V107 vs V105 票级差（|Δ|>0.02）===');
const keys = new Set([...v105.keys(), ...v107.keys()]);
const diffs = [];
for (const k of keys) {
  const n5 = v105.get(k)?.net ?? 0, n7 = v107.get(k)?.net ?? 0;
  if (Math.abs(n7 - n5) > 0.02) diffs.push({ k, n5, n7, d: n7 - n5 });
}
diffs.sort((x, y) => y.d - x.d);
for (const x of diffs) console.log(`  ${x.k}  V105=${x.n5.toFixed(4)}  V107=${x.n7.toFixed(4)}  Δ=${x.d >= 0 ? '+' : ''}${x.d.toFixed(4)}`);
console.log(`  ΣΔ(全票)=${(tot(v107) - tot(v105)).toFixed(4)}`);
process.exit(0);
