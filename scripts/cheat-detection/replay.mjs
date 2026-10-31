#!/usr/bin/env node
// 观测记录零配额重放：对已跑存档的 answersRaw 重跑当前 mapper 观测组装（不调 Jev）
//
// D3.0 架构的核心闭环——Jev 现象标注一次落存档（answersRaw），此后改
// cheat-result-mapper.js 观测组装/题面档位映射，跑本工具即验证效果，零 Jev 配额：
//   node scripts/cheat-detection/replay.mjs                     # 最新存档
//   node scripts/cheat-detection/replay.mjs --archive <file>    # 指定存档
//   node scripts/cheat-detection/replay.mjs --show CD31         # 单票观测明细
//
// D3.5 判定层停产后本工具输出=**观测数据分析**（无 verdict 对拍）：
//   现象档位×人工裁定类分布 + Jev 活跃度档×类分布 + 持仓占比锚分布 + --show 明细。
//   expect.verdict 仍作「人工裁定类」标签供分组（分布的类维度，非对拍目标）。
// 注意：存档行带 answersRaw 自 D3.0 起；旧版存档无此键的行报 skipped（不可重放）。
//   **锚重放自 D3.1 起**（存档行带 anchors）；**activity_level 题自 D3.5 起**
//   （旧存档缺席 → activityLevel=null 行，act 分布单列）；**amount_tiering 自
//   D3.7 / same_block_buy_wave+bundled_trade_dominance 自 D3.8 起**（同容缺）；
//   **D3.9：insider_supply_sell 起自 D3.9（缺席 null）；stall_burst_wave 改三分类
//   桶域——D3.3-D3.8 旧档四档值（weak/moderate/strong）语义不可比=断代 null（分布
//   单列，与缺席同显示）**；**D3.10：桶名 burst_suspect → burst_cheat；D3.11：
//   退回纯现象二分 none/burst（用户裁定「burst_cheat 就不再次检测了……只做一个
//   是否有 停滞后涌入 的现象判断即可」）——D3.10 存档 burst_cheat/burst_normal
//   桶值与此前全部旧档值同走断代 null**。
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { loadAndValidateFixtures } from './lib.mjs';

const require = createRequire(import.meta.url);
const { buildObservation, PHENOMENON_IDS, EXT_PHENOMENON_IDS, LEVEL_ORDER, ACTIVITY_LEVELS, BUNDLED_LEVELS, STALL_BURST_LEVELS } = require('../../src/market-analysis/cheat-result-mapper.js');

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
console.log('（D3.5 判定层停产——重放=观测数据分析，无 verdict 对拍；expect.verdict=人工裁定类标签）');

const LVL = Object.keys(LEVEL_ORDER);
const rows = [];
let noAnswers = 0;
for (const r of archive.results) {
  const c = byId.get(r.caseId);
  if (!c || r.error || r.minTicksSkipped || r.dry) continue;
  if (!r.answersRaw) { noAnswers += 1; continue; }
  let obs;
  try {
    obs = buildObservation(r.answersRaw, r.anchors ?? null);
  } catch (e) {
    rows.push({ caseId: r.caseId, cls: c.expect?.verdict, obsError: e.message, obs: null });
    continue;
  }
  rows.push({ caseId: r.caseId, cls: c.expect?.verdict, obs });
}
if (noAnswers) console.log(`⚠ ${noAnswers} 行无 answersRaw（旧版存档）——已跳过`);

const classes = ['cheat', 'unhealthy', 'healthy'];

// 现象档位×人工裁定类分布（重放归因主表——哪个现象在哪类票上被标到什么档位；
// sbw 独立桶域列（D3.11 现象二分——四档列下 burst 值会被静默丢数）
console.log('\n== 现象档位×人工裁定类分布（none/weak/moderate/strong；sbw 行=none/burst）==');
for (const ph of [...PHENOMENON_IDS, ...EXT_PHENOMENON_IDS]) {
  const lv = ph === 'stall_burst_wave' ? STALL_BURST_LEVELS : LVL;
  const cells = classes.map((k) => {
    const d = { null: 0 };
    for (const l of lv) d[l] = 0;
    for (const r of rows) if (r.cls === k && r.obs) {
      const v = EXT_PHENOMENON_IDS.includes(ph) ? r.obs.extLevels[ph] : r.obs.phenomena[ph];
      if (v === null || v === undefined) d.null += 1;
      else if (!(v in d)) d[v] = 1; // 域外值不静默丢（列头之外单列计数）
      else d[v] += 1;
    }
    const extra = Object.keys(d).filter((x) => x !== 'null' && !lv.includes(x));
    return `${k}: ${lv.map((l) => d[l] || 0).join('/')}${d.null ? `/${d.null}null` : ''}${extra.length ? ` 域外:${extra.map((x) => `${x}×${d[x]}`).join(',')}` : ''}`;
  });
  console.log(`  ${ph.padEnd(24)} ${cells.join('  |  ')}`);
}

// Jev 活跃度档×人工裁定类分布（D3.5 新题——<D3.5 存档缺席=null 单列）
console.log('\n== 活跃度档×人工裁定类分布（low/mid/high/ultra；<D3.5 存档缺席=null）==');
{
  const cells = classes.map((k) => {
    const d = { low: 0, mid: 0, high: 0, ultra: 0, null: 0 };
    for (const r of rows) if (r.cls === k && r.obs) {
      const v = r.obs.activityLevel ? r.obs.activityLevel.bucket : null;
      d[v ?? 'null'] += 1;
    }
    return `${k}: ${ACTIVITY_LEVELS.map((l) => d[l] || 0).join('/')}${d.null ? `/${d.null}null` : ''}`;
  });
  console.log(`  ${'activity_level'.padEnd(24)} ${cells.join('  |  ')}`);
}

// 捆绑交易主导度档×人工裁定类分布（D3.8 新题——<D3.8 存档缺席=null 单列）
console.log('\n== 捆绑主导度档×人工裁定类分布（low/mid/high；<D3.8 存档缺席=null）==');
{
  const cells = classes.map((k) => {
    const d = { low: 0, mid: 0, high: 0, null: 0 };
    for (const r of rows) if (r.cls === k && r.obs) {
      const v = r.obs.bundledDominance ? r.obs.bundledDominance.bucket : null;
      d[v ?? 'null'] += 1;
    }
    return `${k}: ${BUNDLED_LEVELS.map((l) => d[l] || 0).join('/')}${d.null ? `/${d.null}null` : ''}`;
  });
  console.log(`  ${'bundled_dom'.padEnd(24)} ${cells.join('  |  ')}`);
}

// 持仓占比锚分布（按人工裁定类——数值锚与现象档位的对照原料）
const med = (arr) => { const s = arr.filter((v) => v != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const q = (arr, p) => { const s = arr.filter((v) => v != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
console.log('\n== 持仓占比锚分布（med / q25 / q75 / null 数；D3.0 存档无锚行全 null）==');
for (const key of ['sameBlockHoldPct', 'equalBandHoldPct']) {
  for (const k of classes) {
    const arr = rows.filter((r) => r.cls === k).map((r) => r.obs?.anchors?.[key] ?? null);
    if (arr.some((v) => v != null) || arr.length) console.log(`  ${key.slice(0, 2)} ${k.padEnd(10)} med=${med(arr)}  q25=${q(arr, 0.25)}  q75=${q(arr, 0.75)}  null=${arr.filter((v) => v == null).length}`);
  }
}

if (rows.some((r) => r.obsError)) {
  console.log('\n== 组装异常（fail-loud 留痕，不静默）==');
  for (const r of rows) if (r.obsError) console.log(`  ${r.caseId.padEnd(5)} ${r.obsError}`);
}

if (args.show) {
  const r = rows.find((x) => x.caseId === args.show);
  if (!r) { console.error(`\n--show ${args.show} 无重放行`); process.exit(2); }
  console.log(`\n== ${args.show} 观测明细 ==`);
  console.log(`  人工裁定=${r.cls ?? '（未裁定）'}  activity=${r.obs?.activityLevel ? r.obs.activityLevel.bucket : 'null'}  bundled=${r.obs?.bundledDominance ? r.obs.bundledDominance.bucket : 'null'}  sbHold=${r.obs?.anchors?.sameBlockHoldPct ?? '-'} eqHold=${r.obs?.anchors?.equalBandHoldPct ?? '-'}`);
  if (r.obs) {
    for (const ph of PHENOMENON_IDS) console.log(`  ${ph.padEnd(24)} ${r.obs.phenomena[ph]}`);
    for (const ph of EXT_PHENOMENON_IDS) console.log(`  ${ph.padEnd(24)} ${r.obs.extLevels[ph]}`);
  }
}
