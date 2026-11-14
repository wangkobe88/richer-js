// 一次性查询：0xc0a62abacfbe8b80f1650e14f5b0c092347b7777 activity_level 档位核对（单条小结果，182 跑）
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0xc0a62abacfbe8b80f1650e14f5b0c092347b7777';
const EXP = 'f0898589-58f1-4101-a648-0dc9cad41f3a';

async function main() {
  const client = await dbManager.getClient();

  // 1) cheat_detection 行（关注 activity_level 档）
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
      console.log(`grade=${d.grade ?? '-'} reasons=${JSON.stringify(d.gradeReasons ?? d.gradeReasons)}`);
      console.log(`levels: ${JSON.stringify(d.levels)}`);
      console.log(`anchors: ${JSON.stringify(d.anchors)}`);
      console.log(`activity: ${JSON.stringify(d.activity)}`);
    }
    const a = typeof r.answers_raw === 'string' ? JSON.parse(r.answers_raw) : r.answers_raw;
    if (a && a.answers) {
      for (const ans of a.answers) {
        const s = JSON.stringify(ans);
        if (s.includes('activity') || s.includes('burst') || s.includes('stall')) {
          console.log(`answer ${ans.id ?? ans.question_id}: ${s.slice(0, 300)}`);
        }
      }
    }
  }

  // 2) 该实验该 token BUY 信号（生产锚=created_at）
  const { data: sigs, error: e2 } = await client
    .from('strategy_signals')
    .select('id,signal_type,action,status,created_at,metadata')
    .eq('experiment_id', EXP)
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(20);
  if (e2) throw e2;
  console.log(`\nstrategy_signals ${sigs ? sigs.length : 0} 行:`);
  for (const s of sigs || []) {
    let cheatInfo = '';
    if (s.metadata) {
      const m = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : s.metadata;
      if (m.cheatCheck) cheatInfo = ' cheat=' + JSON.stringify(m.cheatCheck).slice(0, 200);
    }
    console.log(`  ${s.created_at} ${s.signal_type} ${s.action} ${s.status}${cheatInfo}`);
  }

  // 3) token_create meta
  const { data: ev, error: e3 } = await client
    .from('wss_events')
    .select('block_time,payload')
    .eq('token_address', ADDR)
    .eq('kind', 'token_create')
    .limit(1);
  if (e3) throw e3;
  if (ev && ev[0]) {
    const p = typeof ev[0].payload === 'string' ? JSON.parse(ev[0].payload) : ev[0].payload;
    console.log(`\ntoken_create: block_time=${ev[0].block_time} platform=${p.platform} symbol=${p.symbol} creator=${p.creatorAddress ?? p.creator}`);
  }

  await dbManager.close?.();
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
