// 一次性查询：0x4792…7777 三次作弊检测为何翻 healthy（单条小结果，本地跑）
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0x47922a47421d10d3d23687fec49f6077bcfb7777';
const EXP = '936e1bd9-630a-4f91-bb52-3f4afb1a27f4';

async function main() {
  const client = await dbManager.getClient();

  // 1) cheat_detection 行（grade 轨迹）
  const { data: rows, error: e1 } = await client
    .from('cheat_detection')
    .select('id,verdict,fail_reason,question_version,anchor_tick_count,source_experiment_id,analyzed_at,snapshot_digest')
    .eq('token_address', ADDR)
    .order('analyzed_at', { ascending: true })
    .limit(50);
  if (e1) throw e1;
  console.log(`cheat_detection 共 ${rows ? rows.length : 0} 行`);
  for (const r of rows || []) {
    const d = typeof r.snapshot_digest === 'string' ? JSON.parse(r.snapshot_digest) : r.snapshot_digest;
    console.log(`\n=== #${r.id} exp=${(r.source_experiment_id||'').slice(0,8)} qv=${r.question_version} verdict=${r.verdict} fail=${r.fail_reason ?? '-'} at=${r.analyzed_at} anchorTicks=${r.anchor_tick_count ?? '-'} ===`);
    if (d) {
      console.log(`grade=${d.grade ?? '-'} reasons=${JSON.stringify(d.gradeReasons ?? null)}`);
      console.log(`unhealthyGrades=${JSON.stringify(d.unhealthyGrades ?? null)}`);
      console.log(`levels: ${JSON.stringify(d.levels)}`);
      console.log(`extLevels: ${JSON.stringify(d.extLevels)}`);
      console.log(`phenomena: ${JSON.stringify(d.phenomena)}`);
      console.log(`anchors: ${JSON.stringify(d.anchors)}`);
      console.log(`activity: ${JSON.stringify(d.activity)}`);
      console.log(`famous: ${JSON.stringify(d.famous)}`);
      console.log(`buyBnb=${d.buyBnb} sellBnb=${d.sellBnb} capped=${d.capped} watermark=${d.watermark}`);
    }
  }

  // 2) 该实验该 token 的 BUY 信号 metadata.cheatCheck
  const { data: sigs, error: e2 } = await client
    .from('strategy_signals')
    .select('id,signal_type,status,created_at,metadata')
    .eq('experiment_id', EXP)
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(30);
  if (e2) throw e2;
  console.log(`\n\nsignals 共 ${sigs ? sigs.length : 0} 行`);
  for (const s of sigs || []) {
    const m = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : s.metadata;
    const cc = m && m.cheatCheck;
    console.log(`\n--- signal #${s.id} ${s.signal_type} ${s.status} at=${s.created_at}`);
    if (cc) console.log(`cheatCheck: ${JSON.stringify(cc)}`);
    else console.log(`cheatCheck: 无`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
