// tmp-d335-compare.mjs — D3.35+G12 全量真调 vs D3.34+G11 基线对拍（CD135，本地零网络纯读 json）
// 用法：node scripts/cheat-detection/tmp-d335-compare.mjs <新run.json> [基线json]
// 基线缺省 scripts/cheat-detection/data/cd-run-2026-11-02T12-50-01-253Z.json（一致 67/128）
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const NEW = resolve(process.cwd(), process.argv[2]);
const OLD = process.argv[3]
  ? resolve(process.cwd(), process.argv[3])
  : resolve(HERE, 'data/cd-run-2026-11-02T12-50-01-253Z.json');

const nu = JSON.parse(readFileSync(NEW, 'utf8'));
const ol = JSON.parse(readFileSync(OLD, 'utf8'));
const cases = JSON.parse(readFileSync(resolve(HERE, 'fixtures.json'), 'utf8')).cases;
const exp = new Map(cases.map((c) => [c.caseId, c.expect?.verdict ?? null]));
const sym = new Map(cases.map((c) => [c.caseId, c.symbol || c.addr.slice(0, 8)]));

const N = new Map(nu.results.map((r) => [r.caseId, r]));
const O = new Map(ol.results.map((r) => [r.caseId, r]));
const W = { cheat: 3, unhealthy: 2, healthy: 1 }; // 重量级（重→轻）
const lv = (g) => W[g] ?? 0;
const ids = [...N.keys()].sort((a, b) => parseInt(a.slice(2)) - parseInt(b.slice(2)));

console.log(`新版 ${nu.questionVersion}/${nu.gradeRulesVersion ?? '?'} n=${nu.results.length}  vs  基线 ${ol.questionVersion}/${ol.gradeRulesVersion ?? '?'} n=${ol.results.length}`);
console.log(`人工分布：cheat 63 / unhealthy 39 / healthy 24 / unclear 2（128 票）\n`);

// ── 1. real_participation 桶位分布 + 人工交叉 ──
const bucketCnt = {}; const bucketXExp = {};
for (const id of ids) {
  const r = N.get(id);
  const b = r.interp?.participation?.bucket ?? 'null';
  bucketCnt[b] = (bucketCnt[b] || 0) + 1;
  const e = exp.get(id) || '（未裁定）';
  bucketXExp[b] = bucketXExp[b] || {};
  bucketXExp[b][e] = (bucketXExp[b][e] || 0) + 1;
}
console.log('── 1. real_participation 桶位分布 × 人工裁定交叉 ──');
for (const b of ['mostly_genuine', 'meaningful_genuine', 'minimal_genuine', 'unclear', 'null']) {
  if (!bucketCnt[b]) continue;
  console.log(`  ${b}: ${bucketCnt[b]} 票  ${JSON.stringify(bucketXExp[b])}`);
}

// ── 2. R 通道命中票 ──
console.log('\n── 2. R 通道（R_minimal_genuine）命中票 ──');
const rHits = ids.filter((id) => (N.get(id).gradeReasons || []).some((x) => x.code === 'R_minimal_genuine'));
for (const id of rHits) {
  const r = N.get(id);
  const part = r.interp?.participation?.bucket ?? 'null';
  console.log(`  ${id} ${sym.get(id)}: grade=${r.grade} part=${part} 人工=${exp.get(id)} 基线=${O.get(id)?.grade ?? '-'} 理由=[${(r.gradeReasons || []).map((x) => x.code).join(',')}]`);
}
if (!rHits.length) console.log('  （零命中）');

// ── 3. 新旧 grade 逐票 diff ──
console.log('\n── 3. 相对基线 grade 变化票 ──');
const diffs = ids.filter((id) => N.get(id).grade !== O.get(id)?.grade);
let up = 0; let down = 0;
for (const id of diffs) {
  const ng = N.get(id).grade; const og = O.get(id)?.grade;
  const d = lv(ng) - lv(og);
  if (d > 0) up++; else down++;
  console.log(`  ${d > 0 ? '↑加重' : '↓减轻'} ${id} ${sym.get(id)}: ${og} → ${ng}（人工=${exp.get(id)}）新理由=[${(N.get(id).gradeReasons || []).map((x) => x.code).join(',')}] 旧理由=[${(O.get(id)?.gradeReasons || []).map((x) => x.code).join(',')}]`);
}
if (!diffs.length) console.log('  （零变化）');
console.log(`  小计：加重 ${up} / 减轻 ${down}`);

// ── 4. vs 人工一致率 ──
const agreeOf = (M) => {
  const judged = ids.filter((id) => M.get(id) && exp.get(id));
  const agree = judged.filter((id) => M.get(id).grade === exp.get(id));
  return { n: judged.length, agree: agree.length };
};
const aN = agreeOf(N); const aO = agreeOf(O);
console.log(`\n── 4. vs 人工一致率 ──\n  基线：${aO.agree}/${aO.n}\n  新版：${aN.agree}/${aN.n}（${aN.agree - aO.agree >= 0 ? '+' : ''}${aN.agree - aO.agree}）`);

// 人工分组落点矩阵（新版）
const matrix = {};
for (const id of ids) {
  const e = exp.get(id); if (!e) continue;
  matrix[e] = matrix[e] || {};
  const g = N.get(id).grade;
  matrix[e][g] = (matrix[e][g] || 0) + 1;
}
console.log('  新版 人工→机器 落点矩阵：');
for (const [e, m] of Object.entries(matrix)) console.log(`    人工=${e}: ${JSON.stringify(m)}`);

// ── 5. 人工 healthy 24 票误伤 ──
console.log('\n── 5. 人工 healthy 票机器落点（误伤盯防）──');
for (const id of ids) {
  if (exp.get(id) !== 'healthy') continue;
  const ng = N.get(id).grade; const og = O.get(id)?.grade ?? '-';
  if (ng !== og) console.log(`  ${ng !== 'healthy' ? '⚠误伤' : '✓回正'} ${id} ${sym.get(id)}: ${og} → ${ng}`);
}
const hBadN = ids.filter((id) => exp.get(id) === 'healthy' && N.get(id).grade !== 'healthy').length;
const hBadO = ids.filter((id) => exp.get(id) === 'healthy' && O.get(id) && O.get(id).grade !== 'healthy').length;
console.log(`  小计：人工 healthy 误伤 基线 ${hBadO}/24 → 新版 ${hBadN}/24`);

// ── 6. 人工 cheat 63 票接回（基线放行 healthy 的）──
console.log('\n── 6. 人工 cheat 票基线放行者的新版落点（接回盯防）──');
for (const id of ids) {
  if (exp.get(id) !== 'cheat') continue;
  const og = O.get(id)?.grade; const ng = N.get(id).grade;
  if (og === 'healthy') console.log(`  ${ng !== 'healthy' ? '✓接回' : '仍放'} ${id} ${sym.get(id)}: ${og} → ${ng}（part=${N.get(id).interp?.participation?.bucket ?? 'null'}）`);
}

// ── 7. 重点票 CD6/CD7/CD10 落点 ──
console.log('\n── 7. 重点票落点 ──');
for (const id of ['CD6', 'CD7', 'CD10']) {
  const r = N.get(id); if (!r) continue;
  console.log(`  ${id} ${sym.get(id)}: grade=${r.grade}（人工=${exp.get(id)} 基线=${O.get(id)?.grade}）part=${r.interp?.participation?.bucket ?? 'null'}(p=${r.interp?.participation?.prob ?? '-'})`);
  console.log(`    理由=[${(r.gradeReasons || []).map((x) => x.code).join(',') || 'clean'}] 协同四锚=块${r.interp?.anchors?.maxBlockBuyCount ?? '-'}笔/${r.interp?.anchors?.maxBlockBuyPct ?? '-'}%/前摇${r.interp?.anchors?.maxBlockPreGapSec ?? '-'}s/同档${r.interp?.anchors?.sameAmountWalletPct ?? '-'}% 创建者峰值=${r.interp?.anchors?.creatorPeakHoldSupplyPct ?? '-'}%`);
}
