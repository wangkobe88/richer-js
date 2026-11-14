// 一次性查询：CD175 生产 grade 轨迹（本地小查询）
const { dbManager } = require('../src/services/dbManager.js');
async function main() {
  const client = await dbManager.getClient();
  const { data, error } = await client.from('cheat_detection')
    .select('analyzed_at,question_version,anchor_tick_count,snapshot_digest')
    .eq('token_address', '0x920ac39b2eb6f1925612a1d774bea2dcec247777')
    .order('analyzed_at', { ascending: true }).limit(10);
  if (error) throw error;
  for (const r of data || []) {
    const d = typeof r.snapshot_digest === 'string' ? JSON.parse(r.snapshot_digest) : (r.snapshot_digest || {});
    console.log(`${r.analyzed_at} | qv=${r.question_version} | 锚=${r.anchor_tick_count} | grade=${d.grade}${d.gradeReasons ? ' ' + JSON.stringify(d.gradeReasons) : ''}${d.cached ? ' | cached' : ''}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
