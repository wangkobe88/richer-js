// C 窗数据源侦察（2026-11-15，182 跑）：找 A 窗（11-02T12→11-03T15）/B 窗（11-05T00→13:45）
// 之外的新时段——候选虚拟实验清单 + wss_events token_create 按小时密度（避开两窗重叠）。
const { dbManager } = require('../src/services/dbManager.js');

async function main() {
  const c = await dbManager.getClient();
  // 1. 近期虚拟实验清单（11-01 后创建/运行的）
  const { data: exps, error } = await c.from('experiments')
    .select('id,experiment_name,trading_mode,status,created_at,updated_at')
    .eq('trading_mode', 'virtual')
    .gte('created_at', '2026-10-25T00:00:00Z')
    .order('created_at', { ascending: false }).limit(60);
  if (error) throw new Error(error.message);
  console.log('===== 近期虚拟实验（11-01 后）=====');
  for (const e of exps)
    console.log(`${e.created_at?.slice(0, 16)}~${e.updated_at?.slice(0, 16)} ${e.status.padEnd(9)} ${(e.experiment_name || '').slice(0, 46).padEnd(47)} ${e.id}`);
  // 2. token_create 小时密度（11-02 起，wss_events 低频表）
  const from = new Date(Date.UTC(2026, 10, 2, 0, 0, 0)).toISOString();
  let rows = [], off = 0;
  while (true) {
    const { data, error: e2 } = await c.from('wss_events')
      .select('block_time,platform')
      .eq('kind', 'token_create')
      .gte('block_time', from)
      .order('block_time', { ascending: true }).range(off, off + 999);
    if (e2) throw new Error(e2.message);
    rows = rows.concat(data);
    if (data.length < 1000) break;
    off += 1000;
  }
  const byHour = new Map();
  for (const r of rows) {
    const h = r.block_time.slice(0, 13);
    const k = byHour.get(h) || { n: 0, gm: 0, flap: 0 };
    k.n++;
    if (r.platform === 'fourmeme') k.gm++; else k.flap++;
    byHour.set(h, k);
  }
  console.log(`\n===== token_create 小时密度 ${from.slice(0, 16)} 起 共 ${rows.length} 行 =====`);
  for (const [h, k] of [...byHour.entries()].sort())
    console.log(`${h}:00  ${String(k.n).padStart(3)}  (fourmeme ${k.gm} / flap ${k.flap})`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
