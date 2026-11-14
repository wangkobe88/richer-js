// 一次性（182 跑）：launch 调研 probe v2——token_create 分页计数（max-rows=1000 帽绕行，id 游标）
const { dbManager } = require('../../src/services/dbManager.js');

const FROM = '2026-11-04T00:00:00Z';
const TO = '2026-11-11T00:00:00Z';

async function main() {
  const sb = await dbManager.getClient();
  const all = [];
  let fromId = 0;
  for (;;) {
    const { data, error } = await sb.from('wss_events')
      .select('id,platform,token_address,block_time').eq('kind', 'token_create')
      .gt('id', fromId).gte('block_time', FROM).lte('block_time', TO)
      .order('id', { ascending: true }).limit(1000);
    if (error) throw error;
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < 1000) break;
    fromId = data[data.length - 1].id;
  }
  const byDay = new Map();
  for (const r of all) {
    const key = `${(r.block_time || '').slice(0, 10)}|${r.platform}`;
    byDay.set(key, (byDay.get(key) || 0) + 1);
  }
  console.log('===== token_create by day|platform（分页全量） =====');
  for (const [k, v] of [...byDay.entries()].sort()) console.log(`  ${k}: ${v}`);
  const byPlat = new Map();
  for (const r of all) byPlat.set(r.platform, (byPlat.get(r.platform) || 0) + 1);
  console.log('合计 by platform:', JSON.stringify([...byPlat.entries()]));
  console.log('窗口总票数:', all.length);
  // v100 同窗（11-04~11-06）票数单列
  const v100win = all.filter((r) => r.block_time < '2026-11-06T00:00:00Z');
  const v100plat = new Map();
  for (const r of v100win) v100plat.set(r.platform, (v100plat.get(r.platform) || 0) + 1);
  console.log('v100 同窗（11-04~11-06）:', JSON.stringify([...v100plat.entries()]), '小计', v100win.length);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
