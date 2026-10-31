#!/usr/bin/env node
// 规则零配额重放：对已跑存档的 answersRaw 重跑当前 mapper 综合规则（不调 Jev）
//
// D3.0 架构的核心闭环——Jev 现象标注一次落存档（answersRaw），此后改
// cheat-result-mapper.js 的综合规则/阈值，跑本工具即验证效果，零 Jev 配额：
//   node scripts/cheat-detection/replay.mjs                     # 最新存档
//   node scripts/cheat-detection/replay.mjs --archive <file>    # 指定存档
//   node scripts/cheat-detection/replay.mjs --show CD31         # 单票现象档位明细
//
// 输出：按类 verdict 命中率 + 现象档位×类分布 + 持仓占比锚分布 + 命中臂分布 + 错票点名。
// 注意：存档行带 answersRaw 自 D3.0 起（run.mjs --baseline 路径同）；旧版存档无此键
// 的行报 skipped（不可重放，只能重烧 Jev）。**锚重放自 D3.1 起**：run/baseline 主循环
// 存档行带 anchors（{sameBlockHoldPct, equalBandHoldPct}）——D3.0 存档无锚=A5 锚臂
// 静默不评（重放归因须知道此降解）；现象档位题在 D3.0 存档中包含 D3.1 四题=可直接重放。
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { loadAndValidateFixtures } from './lib.mjs';

const require = createRequire(import.meta.url);
const { mapCheatAnswers, PHENOMENON_IDS, LEVEL_ORDER } = require('../../src/market-analysis/cheat-result-mapper.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i];
  if (!k.startsWith('--')) { console.error(`未知参数形状: ${k}`); process.exit(2); }
  args[k.slice(2)] = process.argv[i + 1];
}

const fxDoc = JSON.parse(readFileSync(resolve(HERE, 'fixtures.json'), 'utf8'));
const { cases, errors: fxErrors } = loadAndValidateFixtures(fxDoc);
if (fxErrors.length) { console.error('fixtures 校验失败:\n' + fxErrors.join('\n')); process.exit(2); }
const byId = new Map(cases.map((c) => [c.caseId, c]));

let file = args.archive;
if (!file) {
  const files = readdirSync(resolve(HERE, 'data')).filter((f) => f.startsWith('cd-run-') && f.endsWith('.json')).sort();
  if (!files.length) { console.error('data/ 无 cd-run 存档'); process.exit(2); }
  file = files[files.length - 1];
}
const archive = JSON.parse(readFileSync(resolve(HERE, 'data', file), 'utf8'));
console.log(`存档: ${file}  questionVersion=${archive.questionVersion}  跑时=${archive.ranAt}`);

// verdict 对拍忽略 observe 票的 cheatProb/pattern 断言，仅比 verdict（expect.verdict 缺失=跳过）
const LVL = Object.keys(LEVEL_ORDER);
const rows = [];
let noAnswers = 0;
for (const r of archive.results) {
  const c = byId.get(r.caseId);
  if (!c || r.error || r.minTicksSkipped || r.dry) continue;
  if (!r.answersRaw) { noAnswers += 1; continue; }
  let mapped;
  try {
    mapped = mapCheatAnswers(r.answersRaw, r.anchors ?? null);
  } catch (e) {
    rows.push({ caseId: r.caseId, expect: c.expect?.verdict, got: `MAP_ERROR:${e.message}`, ruleAudit: null });
    continue;
  }
  const want = c.expect?.verdict;
  rows.push({
    caseId: r.caseId,
    expect: want,
    got: mapped.verdict,
    pass: !want || mapped.verdict === want,
    ruleAudit: mapped.ruleAudit,
  });
}
if (noAnswers) console.log(`⚠ ${noAnswers} 行无 answersRaw（旧版存档）——已跳过`);

const classes = ['cheat', 'unhealthy', 'healthy'];
const ok = {}, tot = {};
for (const r of rows) {
  if (!r.expect) continue;
  tot[r.expect] = (tot[r.expect] || 0) + 1;
  if (r.pass) ok[r.expect] = (ok[r.expect] || 0) + 1;
}
const all = Object.values(tot).reduce((a, b) => a + b, 0);
const allOk = Object.values(ok).reduce((a, b) => a + b, 0);
console.log(`\n== verdict 对拍: ${allOk}/${all} ==`);
for (const k of classes) {
  if (tot[k] !== undefined) console.log(`  ${k.padEnd(10)} ${ok[k] || 0}/${tot[k]}`);
}

// 现象档位×类分布（重放归因主表——哪个现象在哪类票上被标到什么档位）
console.log('\n== 现象档位×类分布（none/weak/moderate/strong）==');
for (const ph of PHENOMENON_IDS) {
  const cells = classes.map((k) => {
    const d = { none: 0, weak: 0, moderate: 0, strong: 0 };
    for (const r of rows) if (r.expect === k && r.ruleAudit) {
      const v = r.ruleAudit.levels[ph];
      if (v !== undefined) d[v] += 1;
    }
    return `${k}: ${LVL.map((l) => d[l] || 0).join('/')}`;
  });
  console.log(`  ${ph.padEnd(24)} ${cells.join('  |  ')}`);
}

// 持仓占比锚分布（按类，A5 臂校准主表）+ 命中臂分布（按类）+ 错票点名
const med = (arr) => { const s = arr.filter((v) => v != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const q = (arr, p) => { const s = arr.filter((v) => v != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
console.log('\n== 持仓占比锚分布（med / q25 / q75 / null 数；D3.0 存档无锚行全 null）==');
for (const key of ['sameBlockHoldPct', 'equalBandHoldPct']) {
  for (const k of classes) {
    const arr = rows.filter((r) => r.expect === k).map((r) => r.ruleAudit?.anchors?.[key] ?? null);
    if (arr.some((v) => v != null) || arr.length) console.log(`  ${key.slice(0, 2)} ${k.padEnd(10)} med=${med(arr)}  q25=${q(arr, 0.25)}  q75=${q(arr, 0.75)}  null=${arr.filter((v) => v == null).length}`);
  }
}
console.log('\n== 命中臂分布（ruleAudit.hitArm × 类）==');
const armDist = {};
for (const r of rows) {
  if (!r.expect || !r.ruleAudit) continue;
  armDist[`${r.expect}→${r.ruleAudit.hitArm}`] = (armDist[`${r.expect}→${r.ruleAudit.hitArm}`] || 0) + 1;
}
for (const [k, v] of Object.entries(armDist).sort()) console.log(`  ${k.padEnd(30)} ${v}`);
console.log('\n== 错票（id 期望 实际 命中臂 sbHold/eqHold）==');
for (const r of rows) {
  if (r.expect && !r.pass) console.log(`  ${r.caseId.padEnd(5)} ${r.expect.padEnd(10)} ${String(r.got).padEnd(10)} ${r.ruleAudit?.hitArm ?? '-'}  sb=${r.ruleAudit?.anchors?.sameBlockHoldPct ?? '-'} eq=${r.ruleAudit?.anchors?.equalBandHoldPct ?? '-'}`);
}

if (args.show) {
  const r = rows.find((x) => x.caseId === args.show);
  if (!r) { console.error(`\n--show ${args.show} 无重放行`); process.exit(2); }
  console.log(`\n== ${args.show} 明细 ==`);
  console.log(`  expect=${r.expect} got=${r.got} hitArm=${r.ruleAudit?.hitArm} sbHold=${r.ruleAudit?.anchors?.sameBlockHoldPct ?? '-'} eqHold=${r.ruleAudit?.anchors?.equalBandHoldPct ?? '-'}`);
  if (r.ruleAudit) for (const ph of PHENOMENON_IDS) console.log(`  ${ph.padEnd(24)} ${r.ruleAudit.levels[ph]}`);
}
