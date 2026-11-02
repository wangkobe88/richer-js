// tmp-d335-replay.mjs — D3.35 interpret 修复后离线重放（CD135 事故零重烧：Jev 答案已付配额，
// 从 run json 的 answersRaw+anchors+famous 重建 obs→interpret→grade——R 通道接通）
// 用法：node scripts/cheat-detection/tmp-d335-replay.mjs <run.json> [输出json]
// 重放等价性防线：除 participation 外全部输入 bit 一致（anchors/famous 同源），
// 与原 grade 的差异只能来自 R 通道（minimal_genuine→unhealthy）——差异票若非 R 命中=管线漂移须人工查
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url)); // scripts/cheat-detection
const require_ = createRequire(import.meta.url);
const { buildObservation } = require_('../../src/market-analysis/cheat-result-mapper.js');
const { gradeObservation } = require_('../../src/market-analysis/cheat-grade.js');
const { interpret } = await import(`${pathToHere()}/lib.mjs`);
function pathToHere() { return fileURLToPath(new URL('.', import.meta.url)); }

const SRC = resolve(process.cwd(), process.argv[2]);
const OUT = process.argv[3] ? resolve(process.cwd(), process.argv[3]) : null;
const doc = JSON.parse(readFileSync(SRC, 'utf8'));

let rChg = 0; let nonR = 0;
const results = doc.results.map((r) => {
  const obs = buildObservation(r.answersRaw, r.anchors ?? r.interp?.anchors ?? {});
  const interp = interpret(obs);
  const graded = gradeObservation(interp, {
    famousLevel: r.famous?.level ?? null,
    famousFollowerTop3Pct: r.famous?.followerTop3Pct ?? null,
    famousGroupBuyPct: r.famous?.groupBuyPct ?? null,
    anchorSellCount: null, // G2 起 grade 不消费（兼容形状）——run.mjs L457 同函数签名
  });
  const chg = graded.grade !== r.grade;
  const isR = (graded.reasons || []).some((x) => x.code === 'R_minimal_genuine');
  if (chg) { rChg++; if (!isR) nonR++; }
  return { ...r, grade: graded.grade, gradeReasons: graded.reasons, interp };
});

console.log(`重放 ${results.length} 票：grade 变化 ${rChg}（R 通道 ${rChg - nonR} / 非 R ${nonR}${nonR ? ' ⚠管线漂移须查' : '——差异全由 R 通道承载 ✓'}）`);
if (OUT) {
  writeFileSync(OUT, JSON.stringify({ ...doc, results, replayedAt: new Date().toISOString(), replayNote: 'interpret 修复后离线重放（answersRaw 原答案，零 Jev 重烧）' }, null, 2));
  console.log(`已存 ${OUT}`);
}
