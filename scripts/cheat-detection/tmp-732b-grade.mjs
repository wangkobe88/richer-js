#!/usr/bin/env node
/**
 * 一次性查看（0x732b…7777 为何判作弊，review 辅助，不进 git）：cheat_detection 全行 grade 轨迹。
 * 本地单 token 小读取。
 */
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');

const ADDR = '0x732bd5190992ecb2365e080c2d3d37880cb17777';
const sb = dbManager.getClient();
const { data, error } = await sb.from('cheat_detection')
  .select('id,platform,verdict,analyzed_at,source_experiment_id,snapshot_digest')
  .eq('token_address', ADDR)
  .order('analyzed_at', { ascending: true })
  .limit(50);
if (error) throw new Error(error.message);
const rows = data ?? [];
console.log(`cheat_detection 行数=${rows.length}`);
for (const r of rows) {
  const d = r.snapshot_digest || {};
  console.log('---');
  console.log(`#${r.id} ${r.analyzed_at} verdict=${r.verdict} platform=${r.platform} exp=${r.source_experiment_id} error=${r.error ?? '-'} timeout=${r.timeout_ms ?? '-'}`);
  console.log(`grade=${d.grade} version=${d.gradeVersion} anchorSellCount=${d.anchorSellCount}`);
  console.log(`gradeReasons=${JSON.stringify(d.gradeReasons)}`);
  console.log(`phenomena=${JSON.stringify(d.phenomena)}`);
  console.log(`extLevels=${JSON.stringify(d.extLevels)}`);
  console.log(`activityLevel=${d.activityLevel} bundledDominance=${d.bundledDominance}`);
  console.log(`anchors=${JSON.stringify(d.anchors)}`);
  const extras = d.famousDominance !== undefined ? `famousDominance=${d.famousDominance} famousFollowerTop3Pct=${d.famousFollowerTop3Pct} famousGroupBuyPct=${d.famousGroupBuyPct} bundleBuyPct=${d.bundleBuyPct}` : '(无 famous/extras 键)';
  console.log(extras);
}
