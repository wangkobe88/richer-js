// 一次性分析：若「单次检测 ≥2 unhealthy 通道 → 升格 cheat」对现有 D3.57 生产行+fixtures 的影响面（小结果，本地跑）
import { dbManager } from '../src/services/dbManager.js';

const fixtures = JSON.parse(await (await import('node:fs/promises')).readFile(
  new URL('./cheat-detection/fixtures.json', import.meta.url), 'utf8')).cases;

const c = await dbManager.getClient();
const { data: rows, error } = await c.from('cheat_detection')
  .select('id,token_address,analyzed_at,anchor_tick_count,snapshot_digest')
  .eq('question_version', 'D3.57')
  .order('analyzed_at', { ascending: true })
  .limit(500);
if (error) throw error;

const byToken = new Map();
for (const r of rows) {
  const d = r.snapshot_digest;
  const unhealthyCh = (d.gradeReasons || []).filter(x => x.level === 'unhealthy');
  if (!byToken.has(r.token_address)) byToken.set(r.token_address, []);
  byToken.get(r.token_address).push({
    id: r.id, grade: d.grade, at: r.analyzed_at, anchor: r.anchor_tick_count,
    chCount: unhealthyCh.length, codes: unhealthyCh.map(x => x.code),
  });
}

const fxByAddr = new Map(fixtures.map(f => [f.addr.toLowerCase(), f]));

// 影响矩阵：票级（任一检测行双通道 → 该票会拉黑）
let flipToCheat = [], dualButUnhealthyExpect = [], unaffected = [], healthyRowsWith2 = [];
for (const [addr, dets] of byToken) {
  const fx = fxByAddr.get(addr);
  const grades = [...new Set(dets.map(d => d.grade))];
  const maxCh = Math.max(...dets.map(d => d.chCount));
  const dualRows = dets.filter(d => d.chCount >= 2);
  const cur = dets[dets.length - 1].grade; // 最新一次
  const entry = {
    addr: addr.slice(0, 10) + '…' + addr.slice(-4),
    caseId: fx ? fx.caseId : '（非回归票）',
    expect: fx ? fx.expect.verdict : '-',
    grades: grades.join('/'), maxCh, dualAt: dualRows.map(d => `#${d.id}@${d.anchor}t`).join(','),
  };
  if (dualRows.length > 0) {
    // 现行最新态不是 cheat 的票 = 会被新规则改变命运的票
    if (cur !== 'cheat') flipToCheat.push({ ...entry, cur, codes: dualRows.map(d => d.codes.join('+')) });
    else unaffected.push({ ...entry, note: '已是 cheat 终态' });
  } else {
    // 无双通道行：但要看现行 unhealthy 票是否曾双通道（无）→ 不变
    unaffected.push(entry);
  }
}

// 逐行口径：现行 grade=unhealthy 且 chCount>=2 的行（这些行本身会变 cheat）
const rowLevel = rows.map(r => {
  const d = r.snapshot_digest;
  const uch = (d.gradeReasons || []).filter(x => x.level === 'unhealthy');
  return { id: r.id, grade: d.grade, n: uch.length, codes: uch.map(x => x.code).join('+') };
});

console.log(`D3.57 生产行 ${rows.length} 行 / ${byToken.size} 票；fixtures ${fixtures.length} 票\n`);

console.log('== 票级：存在 ≥2 通道 unhealthy 检测行、且当前不是 cheat 终态（新规则下会翻 cheat 拉黑）==');
for (const e of flipToCheat) console.log(`${e.addr} ${e.caseId} expect=${e.expect} 轨迹=${e.grades} 最新=${e.cur} 双通道行=${e.dualAt} [${e.codes}]`);
if (!flipToCheat.length) console.log('（无）');

console.log('\n== 对拍 expect：这些票的人工裁定 vs 新规则结果 ==');
for (const e of flipToCheat) {
  const agree = e.expect === 'cheat' ? '一致（人工也判 cheat）' : e.expect === 'unhealthy' ? '★人工=unhealthy，新规则升格 cheat（裁定翻案）' : e.expect === 'healthy' ? '‼人工=healthy，新规则误伤' : '非回归票无裁定';
  console.log(`  ${e.addr} ${e.caseId} expect=${e.expect} → ${agree}`);
}

console.log('\n== 通道组合分布（全 73 行，unhealthy 通道数直方图）==');
const hist = {};
for (const r of rowLevel) { const k = `${r.grade}:${r.n}`; hist[k] = (hist[k] || 0) + 1; }
for (const [k, v] of Object.entries(hist).sort()) console.log(`grade=unhealthy 通道数关系 ${k} → ${v} 行`);
console.log('\n双通道（n≥2）行明细:');
for (const r of rowLevel.filter(r => r.n >= 2)) console.log(`  #${r.id} grade=${r.grade} [${r.codes}]`);
console.log('\n单通道 unhealthy 行明细:');
for (const r of rowLevel.filter(r => r.n === 1)) console.log(`  #${r.id} [${r.codes}]`);

process.exit(0);
