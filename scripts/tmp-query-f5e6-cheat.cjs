// 一次性查询：0xf5e642bc79bd3dff16bb02794c6854933bb57777 cheat 检测行（单条小结果）
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0xf5e642bc79bd3dff16bb02794c6854933bb57777';

async function main() {
  const client = await dbManager.getClient();

  const { data: rows, error: e1 } = await client
    .from('cheat_detection')
    .select('id,token_address,verdict,fail_reason,question_version,anchor_tick_count,source_experiment_id,created_at,snapshot_digest,answers_raw')
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(50);
  if (e1) throw e1;
  if (!rows || rows.length === 0) {
    console.log('cheat_detection 无行');
  } else {
    console.log(`共 ${rows.length} 行`);
    for (const r of rows) {
      console.log(`\n=== #${r.id} exp=${r.source_experiment_id} qv=${r.question_version} verdict=${r.verdict} fail=${r.fail_reason ?? '-'} created_at=${r.created_at} anchorTicks=${r.anchor_tick_count ?? '-'} ===`);
      const d = typeof r.snapshot_digest === 'string' ? JSON.parse(r.snapshot_digest) : r.snapshot_digest;
      if (d) {
        console.log(`levels: ${JSON.stringify(d.levels)}`);
        console.log(`buckets: ${JSON.stringify(d.buckets)}`);
        console.log(`anchors: ${JSON.stringify(d.anchors)}`);
        console.log(`grade=${d.grade ?? '-'} reasons=${JSON.stringify(d.gradeReasons)}`);
        console.log(`activity: ${JSON.stringify(d.activity)}`);
        console.log(`famous: ${JSON.stringify(d.famous)}`);
      }
      if (r.answers_raw) {
        const a = typeof r.answers_raw === 'string' ? JSON.parse(r.answers_raw) : r.answers_raw;
        console.log(`answers: ${JSON.stringify(a.answers).slice(0, 3000)}`);
      }
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
