// 临时脚本：bt-v104 闪崩三票（2ef6/258e/08aa）BUY 信号 crash 数值锚对照
// 182 跑：node scripts/buy-point/tmp-btv104-crash-anchors.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const sb = dbManager.getClient();

const EXP = '18db4a3e-b25d-44f3-9fc6-32d3c2f2857b';
const toks = [
  '0x2ef6c0e630d34b78ad36aabe04cd90f57e3c7777',
  '0x258e485725b8d799b885b9f079241e2c812d7777',
  '0x08aa150d7d86c4a0dfa37f310c1380de9c1877777',
];
const { data, error } = await sb.from('strategy_signals')
  .select('id,token_address,created_at,metadata')
  .eq('experiment_id', EXP).in('token_address', toks).eq('action', 'BUY');
if (error) throw new Error(error.message);
for (const s of data || []) {
  const a = s.metadata?.buyPoint?.anchors || {};
  const keys = ['tokenAgeSec','curVsLaunchPct','curVsAthPct','chg5Pct','chg10Pct','chg30Pct','nearMaxDn5Pct','nearMaxUp5Pct','curVsMinGapPct','maxDn5Pct','recentDip5Pct','recentDip5SecAgo'];
  const es = s.metadata?.buyPoint?.dimensions?.entry_shape;
  console.log(s.token_address.slice(0, 10), s.created_at.slice(11, 19), 'es=' + JSON.stringify(es));
  console.log('  ', keys.map(k => k + '=' + (a[k] ?? '-')).join(' '));
}
process.exit(0);
