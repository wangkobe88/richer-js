const path = require('path'); require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');
const db = dbManager.getClient();
(async () => {
  const T = process.argv[2] || '0xe05dbebf96c62c377eb51d0c09e42e966c0f7777';
  const rows = [];
  let cursor = null;
  for (let page = 0; page < 12; page++) { // id keyset 分页防 max-rows 截断
    let q = db.from('wss_price_ticks')
      .select('id,block_time,trade_type,price_bnb,bnb_amount')
      .eq('token_address', T).order('id', { ascending: true }).limit(1000);
    if (cursor) q = q.gt('id', cursor);
    const { data, error } = await q;
    if (error) { console.log('err', error.message); process.exit(1); }
    if (!data || !data.length) break;
    rows.push(...data);
    cursor = data[data.length - 1].id;
    if (data.length < 1000) break;
  }
  console.log(`token=${T.slice(0, 10)}… total rows=${rows.length} 首=${rows[0]?.block_time} 末=${rows[rows.length - 1]?.block_time}`);
  const rel = rows.filter(r => r.price_bnb > 0);
  const first = rel[0]?.price_bnb;
  let max = 0, maxT = '';
  for (const r of rel) { if (r.price_bnb > max) { max = r.price_bnb; maxT = r.block_time; } }
  const last = rel[rel.length - 1];
  console.log(`首可靠价=${first.toExponential(4)} @${rel[0].block_time}`);
  console.log(`峰值=${max.toExponential(4)} @${maxT} (+${((max / first - 1) * 100).toFixed(1)}%)`);
  console.log(`末价=${last.price_bnb.toExponential(4)} @${last.block_time} (${((last.price_bnb / first - 1) * 100).toFixed(1)}%)`);
  // 买点后时点价（tick 时序）
  const anchorMs = new Date(process.argv[3] || '2026-11-05T11:08:51Z').getTime();
  for (const m of [1, 3, 5, 10, 15, 30, 60, 120, 240]) {
    const t = anchorMs + m * 60000;
    let before = null;
    for (const r of rel) { if (new Date(r.block_time).getTime() <= t) before = r; else break; }
    if (before) console.log(`+${m}min: ${before.price_bnb.toExponential(4)} (${((before.price_bnb / first - 1) * 100).toFixed(1)}%) @${before.block_time}`);
    else console.log(`+${m}min: (无 tick)`);
  }
  // 买点前后 3 分钟逐 30s 轨迹
  console.log('\n== 买点前后轨迹（每 ~30s） ==');
  let lastT = 0;
  for (const r of rel) {
    const ms = new Date(r.block_time).getTime();
    if (ms < anchorMs - 3 * 60000 || ms > anchorMs + 180000) continue;
    if (ms - lastT >= 25000 || ms === anchorMs) {
      console.log(`${r.block_time} ${r.trade_type} ${r.price_bnb.toExponential(4)} (${((r.price_bnb / first - 1) * 100).toFixed(1)}%) bnb=${r.bnb_amount}`);
      lastT = ms;
    }
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
