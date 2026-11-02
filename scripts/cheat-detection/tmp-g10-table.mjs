#!/usr/bin/env node
// 一次性（本地小读取，不进 git）：五张现场票 cheat_detection 存档观测 → G10 重判 + 全锚 dump
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const { gradeObservation } = require_('../../src/market-analysis/cheat-grade.js');
const sb = dbManager.getClient();
const ADDRS = [
  ['RAM', '0xec74ec6b297fbe318ff09da24023319a36737777'],
  ['MAI', '0x732bd5190992ecb2365e080c2d3d37880cb17777'],
  ['眉眉', '0x5a3f19b5bd587c4a127096ff37f6c9d59f007777'],
  ['에코', '0x43705ac9eb429777f3d993d854a29bcd61837777'],
  ['猴子币', '0xd827bc26713cb6412f4d163766938dee3d0c7777'],
];
for (const [name, addr] of ADDRS) {
  const { data } = await sb.from('cheat_detection')
    .select('analyzed_at,verdict,snapshot_digest').eq('token_address', addr)
    .order('analyzed_at', { ascending: true }).limit(30);
  const rows = data ?? [];
  const cheatRow = rows.find((r) => r.snapshot_digest?.grade === 'cheat');
  const last = rows[rows.length - 1];
  console.log(`\n== ${name} ${addr} 行数=${rows.length} ==`);
  const seen = new Set();
  for (const r of [cheatRow, last]) {
    if (!r) continue;
    const key = r.analyzed_at;
    if (seen.has(key)) { console.log(`[首cheat行=末行 ${key}]`); break; }
    seen.add(key);
    const d = r.snapshot_digest;
    const obs = { phenomena: d.phenomena, extLevels: d.extLevels ?? d.ext, activityLevel: d.activityLevel, bundledDominance: d.bundledDominance, anchors: d.anchors };
    const g10 = gradeObservation(obs, d.extras ?? { famousLevel: null, anchorSellCount: null });
    const tag = r === cheatRow ? '首cheat行' : '末行';
    console.log(`--${tag} ${key} 存档=${d.grade}(${(d.gradeReasons || []).map((x) => x.code).join('|')}) → G10=${g10.grade}(${(g10.reasons || []).map((x) => x.code).join('|')}) gradeVersion=${d.gradeVersion}`);
    console.log(`   phenomena=${JSON.stringify(d.phenomena)}`);
    console.log(`   ext=${JSON.stringify(d.extLevels ?? d.ext)} activityLevel=${d.activityLevel} bundledDominance=${d.bundledDominance}`);
    console.log(`   anchors=${JSON.stringify(d.anchors)}`);
    console.log(`   extras=${JSON.stringify(d.extras)}`);
    const dig = { ...d };
    for (const k of ['phenomena', 'extLevels', 'ext', 'activityLevel', 'bundledDominance', 'anchors', 'extras', 'grade', 'gradeReasons', 'gradeVersion']) delete dig[k];
    console.log(`   digest其余=${JSON.stringify(dig)}`);
  }
}
process.exit(0);
