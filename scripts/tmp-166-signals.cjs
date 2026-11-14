// 一次性查询：CD166 三信号时刻+锚（本地小查询）
const { dbManager } = require('../src/services/dbManager.js');
async function main() {
  const client = await dbManager.getClient();
  const { data, error } = await client.from('cheat_detection')
    .select('analyzed_at,question_version,anchor_tick_count,snapshot_digest')
    .eq('token_address', '0xea44b0c60475cca4ad0f86790735af115e3c7777')
    .order('analyzed_at', { ascending: true }).limit(10);
  if (error) throw error;
  for (const r of data || []) {
    const d = typeof r.snapshot_digest === 'string' ? JSON.parse(r.snapshot_digest) : (r.snapshot_digest || {});
    console.log(`${r.analyzed_at} | qv=${r.question_version} | 锚=${r.anchor_tick_count} | grade=${d.grade}${d.gradeReasons ? ' ' + JSON.stringify(d.gradeReasons) : ''}${d.cached ? ' | cached' : ''}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
