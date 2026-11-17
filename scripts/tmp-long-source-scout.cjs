// 长跨度源侦察（2026-11-15，182 跑）：① token_create 密度往前往后探边界；
// ② 候选源实验 experiment_tokens 全跨度（含 11-02 前的现役实验）。
const { dbManager } = require('../src/services/dbManager.js');

async function main() {
  const c = await dbManager.getClient();
  // ① 10-28 起 token_create 按日密度
  let rows = [], off = 0;
  while (true) {
    const { data, error } = await c.from('wss_events')
      .select('block_time')
      .eq('kind', 'token_create')
      .gte('block_time', '2026-10-28T00:00:00Z').lt('block_time', '2026-11-02T00:00:00Z')
      .order('block_time', { ascending: true }).range(off, off + 999);
    if (error) throw new Error(error.message);
    rows = rows.concat(data);
    if (data.length < 1000) break;
    off += 1000;
  }
  const byDay = new Map();
  for (const r of rows) { const d = r.block_time.slice(0, 10); byDay.set(d, (byDay.get(d) || 0) + 1); }
  console.log('===== token_create 日密度（11-02 前）=====');
  for (const [d, n] of [...byDay.entries()].sort()) console.log(`${d}: ${n}`);
  // ② 候选源实验全跨度（10-28 起全部 experiment_tokens）
  let tks = [], off2 = 0;
  while (true) {
    const { data, error } = await c.from('experiment_tokens')
      .select('experiment_id,created_at')
      .gte('created_at', '2026-10-28T00:00:00Z')
      .order('created_at', { ascending: true }).range(off2, off2 + 999);
    if (error) throw new Error(error.message);
    tks = tks.concat(data);
    if (data.length < 1000) break;
    off2 += 1000;
  }
  console.log(`\nexperiment_tokens 10-28 起共 ${tks.length} 行（分页 1000×${Math.ceil(tks.length / 1000)}——若=整千可能截断）`);
  const byExp = new Map();
  for (const r of tks) {
    let e = byExp.get(r.experiment_id);
    if (!e) { e = { n: 0, min: r.created_at, max: r.created_at }; byExp.set(r.experiment_id, e); }
    e.n++; if (r.created_at < e.min) e.min = r.created_at; if (r.created_at > e.max) e.max = r.created_at;
  }
  const { data: exps } = await c.from('experiments').select('id,experiment_name,trading_mode').limit(500);
  for (const [id, e] of [...byExp.entries()].sort((a, b) => a[1].min.localeCompare(b[1].min))) {
    if (e.n < 200) continue;
    const ex = exps.find((x) => x.id === id);
    const spanH = ((new Date(e.max) - new Date(e.min)) / 3600000).toFixed(1);
    console.log(`${String(e.n).padStart(5)}行 [${e.min.slice(0, 16)}→${e.max.slice(0, 16)}] ${String(spanH).padStart(6)}h ${(ex ? ex.experiment_name.slice(0, 44) + '/' + ex.trading_mode : '?').padEnd(56)} ${id}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
