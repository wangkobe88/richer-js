/** v72 edbd5b38 94 票锚后结局三数（182 跑，一次性）：锚=生产首析 anchor_tick_count 位置，
 * 前向 +15min 窗内最大涨幅/15 分末涨幅/尾盘（now）涨幅——CD242-279 review 表同款口径 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const sb = () => require_('../src/services/dbManager').dbManager.getClient();

const collect = JSON.parse(readFileSync('/tmp/v72-collect.json', 'utf8'));
const TICK_COLS = 'id,block_time,block_number,log_index,price_bnb';

async function pullAll(token, startIso) {
  const rows = [];
  let anchorId = 0;
  for (let page = 0; page < 15; page++) {
    const { data, error } = await sb().from('wss_price_ticks')
      .select(TICK_COLS).eq('token_address', token)
      .gte('block_time', startIso).gt('id', anchorId)
      .order('id', { ascending: true }).limit(1000);
    if (error) throw new Error(`ticks 查询失败(${token}): ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
    anchorId = data[data.length - 1].id;
  }
  return rows;
}

const out = [];
let i = 0;
for (const r of collect) {
  i++;
  const startIso = new Date(new Date(r.firstSignalAt).getTime() - 7 * 864e5).toISOString();
  const rows = await pullAll(r.addr.toLowerCase(), startIso);
  rows.sort((a, b) => new Date(a.block_time) - new Date(b.block_time) || Number(a.log_index) - Number(b.log_index));
  const n = r.anchorTickCount;
  const rec = { addr: r.addr, symbol: r.symbol, anchorTickCount: n, rowsTotal: rows.length };
  const anchorRow = n > 0 && n <= rows.length ? rows[n - 1] : null;
  if (anchorRow && anchorRow.price_bnb > 0) {
    const p0 = Number(anchorRow.price_bnb);
    const t0 = new Date(anchorRow.block_time).getTime();
    const fwd = rows.filter((x) => new Date(x.block_time).getTime() > t0 && x.price_bnb > 0);
    const w15 = fwd.filter((x) => new Date(x.block_time).getTime() <= t0 + 900e3);
    const px = (x) => (Number(x.price_bnb) / p0 - 1) * 100;
    rec.max15 = w15.length ? Math.max(...w15.map(px)) : null;
    rec.last15 = w15.length ? px(w15[w15.length - 1]) : null;
    rec.tailNow = fwd.length ? px(fwd[fwd.length - 1]) : null;
    rec.anchorAt = anchorRow.block_time;
  }
  out.push(rec);
  if (i % 10 === 0) console.log(`… ${i}/${collect.length}`);
}
writeFileSync('/tmp/v72-forward.json', JSON.stringify(out, null, 1));
console.log('完成', out.length, '票');
