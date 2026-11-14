// 用户点名票归因：5390bbfa 实验 0x5910…7777 为何 BP 门放行（活跃度低却过）
import { dbManager } from '../../src/services/dbManager.js';

const EXP = '5390bbfa-0c86-48a2-b9e1-94537c54ac17';
const TOKEN = '0x591018ffb7de68d0047ce285a25a2f0142e87777';

const c = await dbManager.getClient();

// 1) 信号行（BUY）+ metadata 三段
const { data: sigs, error: e1 } = await c.from('strategy_signals')
  .select('id,action,executed,reason,created_at,metadata')
  .eq('experiment_id', EXP).eq('token_address', TOKEN)
  .order('created_at', { ascending: true });
if (e1) throw new Error('signals: ' + e1.message);
console.log(`=== strategy_signals (${sigs.length}) ===`);
for (const s of sigs) {
  const md = s.metadata || {};
  console.log(`\n--- [${s.created_at}] action=${s.action} executed=${s.executed} strategyId=${(s.metadata||{}).strategyId} reason=${s.reason || ''}`);
  const bp = md.buyPoint || md.buyPointCheck;
  if (bp) console.log('buyPoint:', JSON.stringify(bp, null, 1));
  const ch = md.cheatCheck;
  if (ch) console.log('cheatCheck(摘要):', JSON.stringify({
    status: ch.status, grade: ch.grade, reasons: ch.reasons, levels: ch.levels, anchors: ch.anchors, exempt: ch.exempt, exemptDenied: ch.exemptDenied,
  }, null, 1));
  const sg = md.signalGate;
  if (sg) console.log('signalGate:', JSON.stringify(sg, null, 1));
}

// 2) BP 分析行
const { data: bps, error: e2 } = await c.from('buy_point_analyses')
  .select('*')
  .eq('token_address', TOKEN)
  .order('created_at', { ascending: true });
if (e2) throw new Error('bp: ' + e2.message);
console.log(`\n=== buy_point_analyses (${bps.length}) ===`);
for (const r of bps) {
  console.log(`\n--- [${r.created_at}] exp=${r.experiment_id} status=${r.status} bucket=${r.result_bucket} rule=${r.result_rule}`);
  if (r.questions) console.log('answers:', JSON.stringify(r.questions, null, 1));
  if (r.result_reasons) console.log('reasons:', JSON.stringify(r.result_reasons));
  const dg = r.snapshot_digest;
  if (dg) {
    console.log('digest keys:', Object.keys(dg).join(','));
    const picks = {};
    for (const k of ['activity_level','market_pattern','entry_shape','anchorCountAt','spanSec','tickCount','ticksPerMin','avgTradeBnb','idlePct','maxGapSec','curVsLaunchPct','totalVolumeBnb','assessment','exempt']) {
      if (dg[k] !== undefined) picks[k] = dg[k];
    }
    console.log('digest 摘要:', JSON.stringify(picks, null, 1));
    if (dg.assessment) console.log('assessment:', JSON.stringify(dg.assessment, null, 1));
    if (dg.anchors) console.log('anchors:', JSON.stringify(dg.anchors, null, 1));
  }
}
