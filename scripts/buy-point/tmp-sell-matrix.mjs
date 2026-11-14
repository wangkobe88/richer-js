// 卖侧补充：条件 trailing 矩阵（peakGain≥G% 才启用回撤 R% 止盈）——专看 28ad/来财/b881 三形状在各档行为
import { dbManager } from '../../src/services/dbManager.js';
import { createGunzip } from 'node:zlib';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const V107 = '6b016c53-0c20-4a50-94c3-c2de2f205b79';
const SRC = 'c6efed13-ce9d-41b0-89a5-8ca8b029a609';
const c = await dbManager.getClient();
async function pullTable(table, cols) {
  const rows = []; let from = 0;
  while (true) {
    const { data, error } = await c.from(table).select(cols).eq('experiment_id', V107).order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data); if (data.length < 1000) break; from += 1000;
  }
  return rows;
}
const trades = await pullTable('trades', 'token_address,trade_direction,input_amount,output_amount,created_at');
const rounds = new Map();
for (const t of trades) {
  if (!rounds.has(t.token_address)) rounds.set(t.token_address, { addr: t.token_address, buys: [], sells: [] });
  (t.trade_direction === 'buy' ? rounds.get(t.token_address).buys : rounds.get(t.token_address).sells).push(t);
}
for (const r of rounds.values()) {
  r.buyBnb = r.buys.reduce((s, t) => s + Number(t.input_amount || 0), 0);
  r.sellBnb = r.sells.reduce((s, t) => s + Number(t.output_amount || 0), 0);
  r.net = r.sellBnb - r.buyBnb;
  const bt = r.buys.map(t => t.created_at).sort(), st = r.sells.map(t => t.created_at).sort();
  r.t0 = bt[0]; r.t1 = st[st.length - 1] ?? null;
}
const CACHE = `/home/ubuntu/richer-js/data/tick-cache/backtest/${SRC}`;
const priceMap = new Map();
for (const plat of ['fourmeme', 'flap']) {
  try {
    const rl = createInterface({ input: createReadStream(`${CACHE}/${plat}.jsonl.gz`).pipe(createGunzip()) });
    for await (const line of rl) {
      if (!line) continue;
      const row = JSON.parse(line);
      if (!rounds.has(row.token_address) || row.price_outlier) continue;
      const p = Number(row.price_bnb);
      if (!(p > 0)) continue;
      if (!priceMap.has(row.token_address)) priceMap.set(row.token_address, []);
      priceMap.get(row.token_address).push({ ts: row.block_time, p });
    }
  } catch (e) {}
}
for (const arr of priceMap.values()) arr.sort((a, b) => a.ts < b.ts ? -1 : 1);
function priceAt(series, ts) { let lo = null; for (const x of series) { if (x.ts <= ts) lo = x; else break; } return lo?.p ?? series[0]?.p ?? null; }

const GS = [30, 50, 80], RS = [25, 30, 35, 40];
const rounds2 = [];
for (const r of rounds.values()) {
  const series = priceMap.get(r.addr) || [];
  if (!series.length || !r.t1) continue;
  const win = series.filter(x => x.ts >= r.t0 && x.ts <= r.t1);
  if (win.length < 2) continue;
  rounds2.push({ ...r, pBuy: priceAt(series, r.t0), win });
}
const actNet = rounds2.reduce((s, r) => s + r.net, 0);
console.log(`轮=${rounds2.length} 实际净=${actNet.toFixed(4)}\n`);
console.log('=== 条件 trailing 矩阵（peakGain≥G% ∧ 从峰回撤≥R% 全清；未触发=实际净）===');
console.log('G\\R    25%      30%      35%      40%');
for (const G of GS) {
  const cells = [];
  for (const R of RS) {
    let sNet = 0;
    for (const r of rounds2) {
      let rp = -1, hit = null;
      for (const x of r.win) {
        if (x.p > rp) rp = x.p;
        const armed = rp >= r.pBuy * (1 + G / 100);
        if (armed && x.p <= rp * (1 - R / 100)) { hit = x; break; }
      }
      sNet += hit ? r.buyBnb * (hit.p / r.pBuy - 1) : r.net;
    }
    cells.push(`${sNet >= actNet ? '+' : ''}${(sNet - actNet).toFixed(3)}`);
  }
  console.log(`≥${G}%  ${cells.join('   ')}`);
}

// 三形状票在各档的行为
const FOCUS = {
  '28ad(一波到顶)': '0x28ad2c7d08d83a85467bd4afcfd673dfce564444',
  '来财(两波拉盘)': '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777',
  'b881(浮盈87%没卖)': '0xb88113c98d5e33b15925edd635170e80a0fbffff',
  '13d7(浮盈92%没卖)': '0x13d7a62693e2860ba4bd51d6c9c75edc53427777',
  '谷谷(慢拉)': '0x32f18a98e4fc3b33013f80454faae710a6367777',
};
console.log('\n=== 焦点票 per 档模拟净 ===');
for (const [label, addr] of Object.entries(FOCUS)) {
  const r = rounds2.find(x => x.addr === addr);
  if (!r) { console.log(`${label}: 无`); continue; }
  const out = [];
  for (const [G, R] of [[50, 30], [50, 35], [80, 35], [80, 40], [50, 40]]) {
    let rp = -1, hit = null;
    for (const x of r.win) {
      if (x.p > rp) rp = x.p;
      if (rp >= r.pBuy * (1 + G / 100) && x.p <= rp * (1 - R / 100)) { hit = x; break; }
    }
    const simNet = hit ? r.buyBnb * (hit.p / r.pBuy - 1) : r.net;
    out.push(`G${G}/R${R}=${simNet.toFixed(3)}${hit ? '@' + hit.ts.slice(11, 19) : '(未触发)'}`);
  }
  console.log(`  ${label} 实际=${r.net.toFixed(4)} | ${out.join(' | ')}`);
}
process.exit(0);
