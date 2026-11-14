// 一次性查询：0x0c3c88345196b05d8c75a9a2dc0b2f2be07d7777 首信号 unhealthy 归因（单条小结果）
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0x0c3c88345196b05d8c75a9a2dc0b2f2be07d7777';
const EXP = 'f0898589-58f1-4101-a648-0dc9cad41f3a';

async function main() {
  const client = await dbManager.getClient();

  // 1) cheat_detection 行
  const { data: rows, error: e1 } = await client
    .from('cheat_detection')
    .select('id,verdict,fail_reason,question_version,anchor_tick_count,source_experiment_id,analyzed_at,snapshot_digest,answers_raw')
    .eq('token_address', ADDR)
    .order('analyzed_at', { ascending: true })
    .limit(50);
  if (e1) throw e1;
  console.log(`cheat_detection 共 ${rows ? rows.length : 0} 行`);
  for (const r of rows || []) {
    console.log(`\n=== #${r.id} exp=${r.source_experiment_id} qv=${r.question_version} verdict=${r.verdict} fail=${r.fail_reason ?? '-'} analyzed_at=${r.analyzed_at} anchorTicks=${r.anchor_tick_count ?? '-'} ===`);
    const d = typeof r.snapshot_digest === 'string' ? JSON.parse(r.snapshot_digest) : r.snapshot_digest;
    if (d) {
      console.log(`grade=${d.grade ?? '-'} reasons=${JSON.stringify(d.gradeReasons)}`);
      console.log(`levels: ${JSON.stringify(d.levels)}`);
      console.log(`buckets: ${JSON.stringify(d.buckets)}`);
      console.log(`anchors: ${JSON.stringify(d.anchors)}`);
      console.log(`activity: ${JSON.stringify(d.activity)}`);
      console.log(`famous: ${JSON.stringify(d.famous)}`);
      const a = typeof r.answers_raw === 'string' ? JSON.parse(r.answers_raw) : r.answers_raw;
      if (a && a.answers) {
        for (const [qid, ans] of Object.entries(a.answers)) {
          console.log(`  ${qid}: ${JSON.stringify(ans)}`);
        }
      }
    }
  }

  // 2) 信号行 metadata.cheatCheck
  const { data: sigs, error: e2 } = await client
    .from('strategy_signals')
    .select('id,signal_type,action,status,reason,created_at,metadata')
    .eq('experiment_id', EXP)
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(20);
  if (e2) throw e2;
  console.log(`\nstrategy_signals 共 ${sigs ? sigs.length : 0} 行`);
  for (const s of sigs || []) {
    const m = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : s.metadata;
    console.log(`\n--- signal #${s.id} type=${s.signal_type} action=${s.action} status=${s.status} reason=${s.reason} at=${s.created_at}`);
    if (m && m.cheatCheck) console.log(`cheatCheck: ${JSON.stringify(m.cheatCheck).slice(0, 4000)}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
