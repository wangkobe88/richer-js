// tmp-46b1-famous.mjs — 0x46b1…7777 cheat_detection famous 锚查看（review 辅助，不进 git）
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
require_('dotenv').config({ path: 'config/.env' });
const { dbManager } = require_('../../src/services/dbManager.js');

const ADDR = (process.argv[2] || '0x46b19a670569067686c2d4c402c5ef5519077777').toLowerCase();
const sb = dbManager.getClient();
const { data, error } = await sb.from('cheat_detection')
  .select('analyzed_at,question_version,verdict,fail_reason,anchor_tick_count,snapshot_digest,source_experiment_id')
  .eq('token_address', ADDR)
  .order('analyzed_at', { ascending: true })
  .limit(20);
if (error) throw new Error(error.message);
console.log(`cheat_detection 行数=${data.length}`);
for (const r of data) {
  const d = r.snapshot_digest || {};
  console.log(`\n=== ${r.analyzed_at} v=${r.question_version} verdict=${r.verdict} fail=${r.fail_reason ?? '-'} 锚=${r.anchor_tick_count} 行 exp=${r.source_experiment_id ?? '-'}`);
  console.log(`grade=${d.grade ?? '-'} reasons=${JSON.stringify(d.gradeReasons ?? '-')}`);
  console.log(`famous=${JSON.stringify(d.famous ?? null)}`);
  const an = d.anchors ?? {};
  console.log(`anchors=${JSON.stringify(an)}`);
  const etc = {};
  for (const k of Object.keys(d)) if (/famous|group/i.test(k)) etc[k] = d[k];
  console.log(`digest(famous/group族)=${JSON.stringify(etc)}`);
}
