// 一次性（182 跑）：launch 三方案调研 Phase 0+1 探测——
//   Phase 0: wss_events token_create 行字段/payload 键 dump（fourmeme/flap 各一行，看有无 template/tier/价格字段）
//   Phase 1: 窗口内 token_create 票数 by platform by day（决定主体调研窗口大小）
const { dbManager } = require('../../src/services/dbManager.js');

const FROM = '2026-11-04T00:00:00Z';
const TO = '2026-11-11T00:00:00Z';

async function main() {
  const sb = await dbManager.getClient();

  // Phase 0: 各平台一行 dump
  for (const plat of ['fourmeme', 'flap']) {
    const { data, error } = await sb.from('wss_events')
      .select('*').eq('kind', 'token_create').eq('platform', plat)
      .gte('block_time', FROM).lte('block_time', TO).limit(1);
    if (error) { console.log(`[${plat}] 查询错误:`, error.message); continue; }
    if (!data || !data.length) { console.log(`[${plat}] 窗口内无行`); continue; }
    const row = data[0];
    console.log(`\n===== Phase 0 [${plat}] token_create 列名 =====`);
    console.log(Object.keys(row).join(', '));
    console.log(`payload 键:`, row.payload ? Object.keys(typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload).join(', ') : '(无 payload)');
    const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    console.log(`payload 样例（截断）:`, JSON.stringify(p).slice(0, 600));
  }

  // Phase 1: 票数 by platform by day
  const { data: creates, error } = await sb.from('wss_events')
    .select('platform,block_time').eq('kind', 'token_create')
    .gte('block_time', FROM).lte('block_time', TO);
  if (error) throw error;
  const byDay = new Map();
  for (const r of creates || []) {
    const day = (r.block_time || '').slice(0, 10);
    const key = `${day}|${r.platform}`;
    byDay.set(key, (byDay.get(key) || 0) + 1);
  }
  console.log('\n===== Phase 1 token_create by day|platform =====');
  const days = [...byDay.entries()].sort();
  for (const [k, v] of days) console.log(`  ${k}: ${v}`);
  const byPlat = new Map();
  for (const r of creates || []) byPlat.set(r.platform, (byPlat.get(r.platform) || 0) + 1);
  console.log('合计 by platform:', JSON.stringify([...byPlat.entries()]));
  console.log('窗口总票数:', (creates || []).length);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
