// bt-v108 BUY 信号结局 vs V107 对照：V108 里 V107 曾成交票的结局分布（182 跑）
import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const V107 = '6b016c53-0c20-4a50-94c3-c2de2f205b79';
const V108 = '8e2b37ac-d144-4de5-a0b0-d265f1585cb4';
async function pullSigs(eid) {
  const rows = []; let from = 0;
  while (true) {
    const { data, error } = await c.from('strategy_signals').select('id,token_address,action,metadata,created_at')
      .eq('experiment_id', eid).eq('action', 'buy').order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data); if (data.length < 1000) break; from += 1000;
  }
  return rows;
}
const s7 = await pullSigs(V107), s8 = await pullSigs(V108);
console.log(`V107 BUY=${s7.length} | V108 BUY=${s8.length}`);
function layer(m) {
  const es = m?.execution_status, bp = m?.buyPoint, ch = m?.cheatCheck;
  if (es === 'executed' || es === 'completed') return '成交';
  if (bp && bp.passed === false) return `BP拒(${bp.assessment?.rule || bp.assessment?.exempt?.code || bp.status || '?'})`;
  if (bp && bp.passed === true) return 'BP过未成交';
  if (ch) {
    const g = ch.grade || ch.status;
    if (g === 'cheat') return 'cheat拒拉黑';
    if (g === 'unhealthy') return 'cheat拒unhealthy';
    return `cheat拒(grade=${g})`;
  }
  return '前置拒(无cheat段)';
}
for (const [tag, sigs] of [['V107', s7], ['V108', s8]]) {
  const st = new Map();
  for (const s of sigs) { const k = layer(s.metadata); st.set(k, (st.get(k) || 0) + 1); }
  console.log(`\n${tag} 分层：`);
  for (const [k, n] of [...st.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);
}
// V107 成交票在 V108 的结局
const done7 = new Set(s7.filter(s => ['executed', 'completed'].includes(s.metadata?.execution_status)).map(s => s.token_address));
console.log(`\nV107 成交票 ${done7.size} 张在 V108 的结局：`);
const outcome8 = new Map();
for (const s of s8) {
  if (!done7.has(s.token_address)) continue;
  const k = layer(s.metadata);
  if (!outcome8.has(s.token_address)) outcome8.set(s.token_address, k);
}
const cnt = new Map();
for (const [a, k] of outcome8) { cnt.set(k, (cnt.get(k) || 0) + 1); if (!['成交'].includes(k)) console.log(`  ${a} → ${k}`); }
for (const [k, n] of [...cnt.entries()].sort((a, b) => b[1] - a[1])) console.log(`  合计 ${k}: ${n}/${done7.size}`);
// V108 BP 拒因细查（timeout/fail 分布）
const bpFail = s8.filter(s => s.metadata?.buyPoint?.passed === false).map(s => s.metadata.buyPoint);
const rules = new Map();
for (const bp of bpFail) {
  const r = bp.assessment?.rule || '?';
  rules.set(r, (rules.get(r) || 0) + 1);
}
console.log(`\nV108 BP 拒 rule 分布：`);
for (const [r, n] of [...rules.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${r}: ${n}`);
const bpStatus = new Map();
for (const bp of bpFail) { const k = bp.status || '?'; bpStatus.set(k, (bpStatus.get(k) || 0) + 1); }
console.log(`V108 BP 拒 status 分布：`, JSON.stringify([...bpStatus.entries()]));
process.exit(0);
