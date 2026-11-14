// 一次性查询（二）：三行 answers_raw 关键题概率 + BUY 信号 metadata.cheatCheck
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0x47922a47421d10d3d23687fec49f6077bcfb7777';
const EXP = '936e1bd9-630a-4f91-bb52-3f4afb1a27f4';
const KEYS = ['insider_supply_sell', 'activity_level', 'burst_spike_concentration', 'abnormal_behavior_ratio', 'bundled_trade_dominance'];

async function main() {
  const client = await dbManager.getClient();

  const { data: rows, error: e1 } = await client
    .from('cheat_detection')
    .select('id,analyzed_at,anchor_tick_count,answers_raw,snapshot_digest')
    .eq('token_address', ADDR)
    .order('analyzed_at', { ascending: true })
    .limit(50);
  if (e1) throw e1;
  for (const r of rows || []) {
    const a = typeof r.answers_raw === 'string' ? JSON.parse(r.answers_raw) : r.answers_raw;
    const d = typeof r.snapshot_digest === 'string' ? JSON.parse(r.snapshot_digest) : r.snapshot_digest;
    console.log(`\n=== #${r.id} at=${r.analyzed_at} anchorTicks=${r.anchor_tick_count} grade=${d.grade} ===`);
    console.log(`digest.activityLevel=${JSON.stringify(d.activityLevel)} bundledDominance=${JSON.stringify(d.bundledDominance)} abnormalBehavior=${JSON.stringify(d.abnormalBehavior)}`);
    const ans = (a && a.answers) || {};
    for (const [k, v] of Object.entries(ans)) {
      if (KEYS.includes(k)) console.log(`  ${k}: ${JSON.stringify(v)}`);
    }
  }

  // signals（修正列名）
  const { data: sigs, error: e2 } = await client
    .from('strategy_signals')
    .select('id,signal_type,action,created_at,metadata')
    .eq('experiment_id', EXP)
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(30);
  if (e2) throw e2;
  console.log(`\n\nsignals 共 ${sigs ? sigs.length : 0} 行`);
  for (const s of sigs || []) {
    const m = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : s.metadata;
    const cc = m && m.cheatCheck;
    console.log(`\n--- signal #${s.id} ${s.signal_type}/${s.action} at=${s.created_at}`);
    if (cc) {
      const brief = {
        status: cc.status, grade: cc.grade, cached: cc.cached, reason: cc.reason,
        reasons: cc.reasons, conditionPassed: cc.conditionPassed, conditionError: cc.conditionError,
        unhealthyGrades: cc.unhealthyGrades,
      };
      console.log(`cheatCheck: ${JSON.stringify(brief)}`);
    } else console.log('cheatCheck: 无');
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
