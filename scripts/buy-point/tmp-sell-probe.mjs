// 探针：tick-cache 行字段/单位 vs trades 均价（用 28ad 盈利票对拍）
import { createGunzip } from 'node:zlib';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { dbManager } from '../../src/services/dbManager.js';

const V107 = '6b016c53-0c20-4a50-94c3-c2de2f205b79';
const SRC = 'c6efed13-ce9d-41b0-89a5-8ca8b029a609';
const ADDR = '0x28ad2c7d08d83a85467bd4afcfd673dfce564444';

const c = await dbManager.getClient();
const { data: tr } = await c.from('trades')
  .select('token_address,trade_direction,input_amount,output_amount,created_at')
  .eq('experiment_id', V107).eq('token_address', ADDR).eq('success', true).order('id');
console.log('=== trades（28ad）===');
for (const t of tr) console.log(` ${t.created_at} ${t.trade_direction} in=${t.input_amount} out=${t.output_amount}`);
const buyBnb = tr.filter(t=>t.trade_direction==='buy').reduce((s,t)=>s+Number(t.input_amount),0);
const buyTok = tr.filter(t=>t.trade_direction==='buy').reduce((s,t)=>s+Number(t.output_amount),0);
const sellBnb = tr.filter(t=>t.trade_direction==='sell').reduce((s,t)=>s+Number(t.output_amount),0);
const sellTok = tr.filter(t=>t.trade_direction==='sell').reduce((s,t)=>s+Number(t.input_amount),0);
console.log(`buyPrice=${(buyBnb/buyTok).toExponential(4)} avgSell=${(sellBnb/sellTok).toExponential(4)}`);

let first = true; let n = 0; const win = [];
const times = tr.map(t => t.created_at).sort();
const t0 = times[0], t1 = times[times.length - 1];
console.log(`window=[${t0}, ${t1}]`);
for (const plat of ['fourmeme','flap']) {
  const f = `/home/ubuntu/richer-js/data/tick-cache/backtest/${SRC}/${plat}.jsonl.gz`;
  try {
    const rl = createInterface({ input: createReadStream(f).pipe(createGunzip()) });
    for await (const line of rl) {
      if (first) { const r = JSON.parse(line); console.log(`\n=== tick-cache 行字段（${plat}）===`, Object.keys(r).join(','), '\nsample:', JSON.stringify(r).slice(0, 300)); first = false; }
      const row = JSON.parse(line);
      if (row.token_address !== ADDR) continue;
      if (row.block_time >= t0 && row.block_time <= t1) { win.push(row); n++; }
    }
  } catch (e) { console.log(`skip ${plat}: ${e.message}`); }
}
console.log(`\nwin rows=${n}`);
win.sort((a,b)=>a.block_time<b.block_time?-1:1);
for (const r of win.slice(0, 3).concat(win.slice(-3)))
  console.log(` ${r.block_time} p=${r.price_bnb} side=${r.side} bnb=${r.bnb_amount} out=${r.price_outlier}`);
const ps = win.map(r=>Number(r.price_bnb)).filter(x=>x>0);
console.log(`price range: min=${Math.min(...ps).toExponential(3)} max=${Math.max(...ps).toExponential(3)} vs buyPrice=${(buyBnb/buyTok).toExponential(3)} avgSell=${(sellBnb/sellTok).toExponential(3)}`);
process.exit(0);
