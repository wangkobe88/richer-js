// C 窗源实验定位（2026-11-15，182 跑）：experiment_tokens 按 experiment 分组——
// 谁在 11-04 时段发现了 token（C 窗候选 [11-04T00:00, 11-04T23:59] 与 A/B 窗零重叠）。
const { dbManager } = require('../src/services/dbManager.js');

async function main() {
  const c = await dbManager.getClient();
  // experiment_tokens 11-03T15~11-05T14 分组（覆盖 11-04 的实验）
  let rows = [], off = 0;
  while (true) {
    const { data, error } = await c.from('experiment_tokens')
      .select('experiment_id,token_address,platform,created_at')
      .gte('created_at', '2026-11-03T15:00:00Z')
      .lte('created_at', '2026-11-05T14:00:00Z')
      .order('created_at', { ascending: true }).range(off, off + 999);
    if (error) throw new Error(error.message);
    rows = rows.concat(data);
    if (data.length < 1000) break;
    off += 1000;
  }
  console.log(`experiment_tokens 11-03T15→11-05T14 共 ${rows.length} 行`);
  const byExp = new Map();
  for (const r of rows) {
    let e = byExp.get(r.experiment_id);
    if (!e) { e = { n: 0, min: r.created_at, max: r.created_at, plat: new Map(), d04: 0 }; byExp.set(r.experiment_id, e); }
    e.n++;
    if (r.created_at < e.min) e.min = r.created_at;
    if (r.created_at > e.max) e.max = r.created_at;
    e.plat.set(r.platform, (e.plat.get(r.platform) || 0) + 1);
    if (r.created_at >= '2026-11-04T00:00:00Z' && r.created_at < '2026-11-05T00:00:00Z') e.d04++;
  }
  const ids = [...byExp.keys()];
  const { data: exps } = await c.from('experiments').select('id,experiment_name,trading_mode,status').limit(500);
  for (const [id, e] of [...byExp.entries()].sort((a, b) => b[1].n - a[1].n)) {
    const ex = exps.find((x) => x.id === id);
    console.log(`${String(e.n).padStart(5)} 行 [${e.min.slice(5, 16)}→${e.max.slice(5, 16)}] 11-04时段=${e.d04} plat=${[...e.plat.entries()].map(([p, n]) => p + ':' + n).join(',')}  ${(ex ? (ex.experiment_name + '/' + ex.trading_mode + '/' + ex.status) : '?').slice(0, 60)}  ${id}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
