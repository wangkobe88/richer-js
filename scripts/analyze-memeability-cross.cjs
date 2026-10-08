#!/usr/bin/env node
// ============================================================================
// 方向2 referent_memeability dry-run 交叉分析（本地纯 JSON，零 DB 零网络）
// 输入：data/memeability-dryrun-0fed.json（182 跑出，数组：每张 addr/symbol/net/
//       cat/memScore/stateSrc/nrChoice；memScore=null = 无分）
// 输出：三组验证（E 类赢票应≥3 / 点名亏票应≤1 / 边界票落档）+ 门阈模拟表
// 用法：node scripts/analyze-memeability-cross.cjs
// ============================================================================
const fs = require('fs');
const path = require('path');

const dry = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/memeability-dryrun-0fed.json'), 'utf8'));
const scored = dry.filter(r => typeof r.memScore === 'number');
const noScore = dry.filter(r => typeof r.memScore !== 'number');
console.log(`dry-run 票: ${dry.length}（有分 ${scored.length} / 无分 ${noScore.length}）`);
if (noScore.length) {
  const bySrc = new Map();
  for (const r of noScore) bySrc.set(r.stateSrc, (bySrc.get(r.stateSrc) || 0) + 1);
  console.log('  无分原因:', [...bySrc.entries()].map(([k, v]) => `${k}×${v}`).join(' '),
    '| 无分票净额:', noScore.reduce((s, r) => s + (r.net || 0), 0).toFixed(4));
}

// ── 分数×盈亏交叉 ──
console.log('\n═══ memScore 档 × 盈亏 ═══');
const byScore = new Map();
for (const r of scored) {
  const k = Math.round(r.memScore); // 档聚合到整数档（量表 0-5 连续分）
  if (!byScore.has(k)) byScore.set(k, []);
  byScore.get(k).push(r);
}
for (const k of [...byScore.keys()].sort((a, b) => a - b)) {
  const g = byScore.get(k);
  const net = g.reduce((s, r) => s + r.net, 0);
  const wins = g.filter(r => r.net > 0).length;
  console.log(`  mem≈${k}: ${g.length} 票 | 净 ${net.toFixed(4)} BNB | 赢 ${wins}/${g.length} | ${g.map(r => `${r.symbol}(${r.net >= 0 ? '+' : ''}${r.net.toFixed(3)})`).join(' ')}`);
}
// 双门合并视角：≤1 与 ≥2 的总净额
const lo = scored.filter(r => r.memScore <= 1), hi = scored.filter(r => r.memScore > 1);
console.log(`  ── mem≤1 合计: ${lo.length} 票 净 ${lo.reduce((s, r) => s + r.net, 0).toFixed(4)} | mem>1 合计: ${hi.length} 票 净 ${hi.reduce((s, r) => s + r.net, 0).toFixed(4)}`);

// ── 门阈模拟 ──
console.log('\n═══ 门阈模拟（memScore ≤ N 拦截，拦票里 net<0=避亏）═══');
for (const N of [0, 1, 1.5, 2, 3]) {
  const blocked = scored.filter(r => r.memScore <= N);
  const bNet = blocked.reduce((s, r) => s + r.net, 0);
  const winsBlocked = blocked.filter(r => r.net > 0);
  console.log(`  拦 ≤${N}: 拦 ${blocked.length} 票 净 ${bNet.toFixed(4)}${bNet < 0 ? '（避亏）' : '（误拦）'}；误拦赢票 ${winsBlocked.length} 张: ${winsBlocked.map(r => `${r.symbol}(+${r.net.toFixed(3)})`).join(' ') || '无'}`);
}

// ── 三组验证 ──
console.log('\n═══ 三组验证 ═══');
const pick = f => scored.filter(f);
const group = (label, list, expect) => {
  console.log(`  [${label}]`);
  if (!list.length) { console.log('    （无命中票）'); return; }
  for (const r of list.sort((a, b) => a.memScore - b.memScore)) {
    console.log(`    ${r.addr} | ${r.symbol} | mem=${r.memScore} nr=${r.nrChoice} | net=${r.net.toFixed(4)}`);
  }
};
const has = (...names) => r => names.some(n => (r.symbol || '').includes(n));
group('E 类赢票（期望 ≥3 张 mem>1）', pick(has('佛咪咪', '莎莎酱', '洛洛', '海绵宝宝')), null);
group('点名亏票（期望 ≤1 张 mem>1）', pick(has('币安汽车', '尼桑', '日产', '途乐', 'invoice', 'INVOICE', '隔音舱')), null);
group('边界票（落档供裁定）', pick(has('皮草', '永生', 'Taigan', 'TAIGAN', 'JACKET')), null);
process.exit(0);
