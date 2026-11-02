#!/usr/bin/env node
// tmp：D3.0 现象层分布分析（182 跑）——最新存档按类拆现象档位 + retail + 错票点名
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(resolve(HERE, 'data')).filter((f) => f.startsWith('cd-run-') && f.endsWith('.json')).sort();
const a = JSON.parse(readFileSync(resolve(HERE, 'data', files[files.length - 1]), 'utf8'));
console.log('存档:', files[files.length - 1], 'version:', a.questionVersion);

const fx = JSON.parse(readFileSync(resolve(HERE, 'fixtures.json'), 'utf8')).cases;
const exp = Object.fromEntries(fx.map((c) => [c.caseId, c.expect?.verdict]));
const PH = ['same_block_buy_burst', 'equal_amount_split', 'coordinated_sell_back', 'quota_ladder_heat',
  'creator_front_run', 'strong_hand_real_buy', 'second_wave_absorption', 'sell_dispersion'];

const ok = {}, tot = {}, dist = {}, wrong = [];
for (const r of a.results) {
  if (r.caseId === 'CD24') continue;
  const e = exp[r.caseId]; if (!e) continue;
  tot[e] = (tot[e] || 0) + 1; if (r.pass) ok[e] = (ok[e] || 0) + 1;
  const lv = r.interp?.ruleAudit?.levels || {};
  dist[e] = dist[e] || {};
  for (const p of PH) {
    const v = lv[p] || '?';
    dist[e][p] = dist[e][p] || {};
    dist[e][p][v] = (dist[e][p][v] || 0) + 1;
  }
  if (!r.pass) wrong.push([r.caseId, e, r.interp?.verdict, r.interp?.ruleAudit?.hitArm]);
}
console.log('按类:', JSON.stringify({ ok, tot }));
console.log('\n现象档位分布（none/weak/moderate/strong 计数）:');
for (const p of PH) {
  const cells = ['cheat', 'unhealthy', 'healthy'].map((e) => {
    const d = dist[e]?.[p] || {};
    return `${e}: ${d.none || 0}/${d.weak || 0}/${d.moderate || 0}/${d.strong || 0}`;
  });
  console.log(`  ${p.padEnd(24)} ${cells.join('  |  ')}`);
}
const ret = { cheat: [], unhealthy: [], healthy: [] };
for (const r of a.results) {
  if (r.caseId === 'CD24') continue;
  const e = exp[r.caseId]; if (ret[e]) ret[e].push(r.interp?.retailParticipation);
}
const med = (arr) => { const s = arr.filter((v) => v != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)].toFixed(2) : '-'; };
console.log('\nretail 中位:', JSON.stringify({ cheat: med(ret.cheat), unhealthy: med(ret.unhealthy), healthy: med(ret.healthy) }));
console.log('\n错票（id 期望 实际 命中臂）:');
for (const w of wrong) console.log(' ', w.join('  '));
