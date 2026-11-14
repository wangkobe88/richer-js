// tmp：读 0x9b1f…7777（btv111）cheat 观测 + 信号 metadata —— 本地小结果读取
import { dbManager } from '../../src/services/dbManager.js';

const EXP = '5390bbfa-0c86-48a2-b9e1-94537c54ac17';
const TOKEN = '0x9b1fb6a662e2b1e5a521ea1dd5147f13184b7777';
const c = await dbManager.getClient();

// cheat_detection 行（token 级全局，按 created_at 排）
const cd = [];
{
  let from = 0;
  while (true) {
    const { data, error } = await c.from('cheat_detection')
      .select('*')
      .eq('token_address', TOKEN)
      .order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error('cheat_detection: ' + error.message);
    cd.push(...data); if (data.length < 1000) break; from += 1000;
  }
}
console.log('=== cheat_detection rows:', cd.length);
for (const r of cd) {
  console.log(JSON.stringify({
    id: r.id, created_at: r.created_at, experiment_id: r.experiment_id,
    verdict: r.verdict, grade: r.grade, grade_reasons: r.grade_reasons,
    grade_version: r.grade_version, question_version: r.question_version,
    anchor_sell_count: r.anchor_sell_count,
  }, null, 0));
  const d = r.snapshot_digest || {};
  console.log('--- digest.levels:', JSON.stringify(d.levels));
  console.log('--- digest.anchors:', JSON.stringify(d.anchors));
  console.log('--- digest.activity:', JSON.stringify(d.activity));
  console.log('--- digest.observation:', JSON.stringify(d.observation));
}

// 信号行
const sigs = [];
{
  let from = 0;
  while (true) {
    const { data, error } = await c.from('strategy_signals')
      .select('id,created_at,action,executed,reason,metadata')
      .eq('experiment_id', EXP).eq('token_address', TOKEN)
      .order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error('signals: ' + error.message);
    sigs.push(...data); if (data.length < 1000) break; from += 1000;
  }
}
console.log('\n=== strategy_signals rows:', sigs.length);
for (const s of sigs) {
  const m = s.metadata || {};
  console.log(JSON.stringify({
    id: s.id, created_at: s.created_at, action: s.action, executed: s.executed,
    reason: s.reason, rule_name: s.rule_name, strategy_id: s.strategy_id,
  }));
  if (m.cheatCheck) console.log('--- meta.cheatCheck:', JSON.stringify(m.cheatCheck));
  if (m.buyPoint) console.log('--- meta.buyPoint:', JSON.stringify(m.buyPoint));
  if (m.signalGate) console.log('--- meta.signalGate:', JSON.stringify(m.signalGate));
}
await dbManager.destroy?.();
