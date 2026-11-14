// R1 取证补：C 组 4 票对齐复盘锚（首信号≠复盘点位信号的中途信号）+币安之心 39 位真值
// 182 跑：node scripts/buy-point/tmp-r1c-realign.mjs
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const sb = dbManager.getClient();

const EXP = '18db4a3e-b25d-44f3-9fc6-32d3c2f2857b';
// [sym, token(DB 真值), 复盘锚时刻(UTC)]
const LIST = [
  ['29', '0xdc1910375c1c1c3d0c25c13ee6e5f2bec1887777', '2026-11-05T12:00:09'],
  ['蝴蝶', '0xac0b530995e47794dd0b722497aa33873b8c7777', '2026-11-05T05:30:05'],
  ['蝴蝶人生路', '0xb359716d1affde1fb9d351fec71a0f2e79257777', '2026-11-05T12:43:10'],
  ['苹果SI', '0xc9bf4530033f6497002d228296fedb45036f7777', '2026-11-05T05:11:40'],
  ['持械入宋', '0xea3ce510829b2b3c77dae374aad440e23be94444', '2026-11-05T07:41:30'],
  ['币安之心(39位真值)', '0x08aa150d7d86c4a0dfa37f310c1380de9c187777', '2026-11-05T12:11:23'],
];

for (const [sym, tok, hint] of LIST) {
  const { data, error } = await sb.from('strategy_signals')
    .select('id,created_at,metadata')
    .eq('experiment_id', EXP).eq('token_address', tok).eq('action', 'buy')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const ht = new Date(hint + 'Z').getTime();
  let best = null, bestD = Infinity;
  for (const r of data || []) {
    const d = Math.abs(new Date(r.created_at).getTime() - ht);
    if (d < bestD) { bestD = d; best = r; }
  }
  if (!best) { console.log(`\n### ${sym} — 无 buy 信号行`); continue; }
  const bp = (best.metadata || {}).buyPoint || {};
  const dims = bp.dimensions || {};
  const anc = bp.anchors || {};
  console.log(`\n### ${sym} ${tok.slice(0, 8)} 信号=${best.created_at.slice(11, 19)}（距复盘锚 ${Math.round(bestD / 1000)}s）`);
  console.log(`   es=${JSON.stringify(dims.entry_shape)} mp=${JSON.stringify(dims.market_pattern)} act=${JSON.stringify(dims.activity_level)} rule=${bp.assessment?.rule} prob=${bp.assessment?.prob} exempt=${JSON.stringify(bp.assessment?.exempt)}`);
  const keys = ['tokenAgeSec','curVsLaunchPct','curVsAthPct','chg5Pct','chg10Pct','chg30Pct','maxDn5Pct','nearMaxDn5Pct','recentDip5Pct','recentDip5SecAgo','swingHighCount','swingLowCount','swingLastDir','secSinceSwingHigh','secSinceSwingLow','currentVsSwingHighPct','currentVsSwingLowPct','swingMaxAmplPct','anchorTickCount'];
  console.log('   ' + keys.map((k) => k + '=' + (anc[k] ?? '-')).join(' '));
}
process.exit(0);
