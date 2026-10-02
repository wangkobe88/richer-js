#!/usr/bin/env node
/** 汇总 9 批 LLM 逐票归因 + 真 path 数据 exit 复核交叉校正 */
const fs = require('fs');
const path = require('path');
const OUT = '/Users/nobody1/Desktop/Codes/richer-js/data/diagnosis-out';
const DIAG = JSON.parse(fs.readFileSync('/Users/nobody1/Desktop/Codes/richer-js/data/analysis-82093ca3-diagnosis.json', 'utf8'));
const sum = a => a.reduce((x, y) => x + y, 0);
const diagByAddr = new Map(DIAG.map(t => [t.addr, t]));

const rows = [];
for (let i = 1; i <= 9; i++) {
  const f = path.join(OUT, `batch-${i}.json`);
  if (!fs.existsSync(f)) { console.log(`缺 batch-${i}`); continue; }
  rows.push(...JSON.parse(fs.readFileSync(f, 'utf8')));
}
console.log(`LLM 归因 ${rows.length} 票\n`);

// ==== exit 复核（真 path 数值直判，校正 primary）====
// 强制改判 exit 条件（对齐卖腿实际可反应带）：
//   ① 峰 >50%（TP2/P9/移动止盈带可及）或 ② 峰 >30% 且峰出现在买入 1min 后（保护腿有反应时间）
//   —— 峰 30-50% 且 1min 内的瞬时脉冲客观不可卖（无腿在 +30% 触发），保留 LLM 原判
// 降级规则：净亏票 maxPctAfterBuy<10 → exit 不可能成立，LLM 判了 exit 也降级 dead
let exitFixed = 0;
for (const r of rows) {
  const d = diagByAddr.get(r.addr);
  if (!d) continue;
  const maxPct = d.path.maxPctAfterBuy;
  if (r.netBnb < -0.001 && maxPct != null) {
    const sellablePeak = maxPct > 50 || (maxPct > 30 && d.path.maxAtMin != null && d.path.maxAtMin >= 1);
    if (sellablePeak && r.primary !== 'exit') {
      r.primaryBefore = r.primary; r.primary = 'exit'; r.secondary = r.primaryBefore;
      r.evidence.push(`[path复核] 买后峰 +${maxPct.toFixed(0)}% @${d.path.maxAtMin}min 但净亏 → 给过可卖机会未拿住`);
      exitFixed++;
    }
    if (maxPct < 10 && r.primary === 'exit') {
      r.primaryBefore = r.primary; r.primary = 'dead';
      r.evidence.push(`[path复核] 买后峰仅 +${maxPct.toFixed(0)}% exit 不成立`);
    }
  }
}
console.log(`exit 复核校正: ${exitFixed} 票改判 exit（给过 >30% 机会但净亏）\n`);

const losses = rows.filter(r => r.netBnb < -0.001);
const wins = rows.filter(r => r.netBnb >= -0.001);

console.log('===== 亏票 primary 分布 =====');
const dist = {};
losses.forEach(r => { dist[r.primary] = (dist[r.primary] || { n: 0, net: 0, b: 0 }); dist[r.primary].n++; dist[r.primary].net += r.netBnb; if (r.boundary) dist[r.primary].b++; });
Object.entries(dist).sort((a, b) => b[1].n - a[1].n).forEach(([k, v]) =>
  console.log(`${k.padEnd(9)} ${String(v.n).padStart(3)} 票  合计 ${v.net.toFixed(2)} BNB  (回放强平边界 ${v.b})`));
console.log(`合计亏票 ${losses.length}，净 ${sum(losses.map(r => r.netBnb)).toFixed(2)} BNB`);

console.log('\n===== secondary 分布 =====');
const sdist = {};
losses.forEach(r => { if (r.secondary) sdist[r.secondary] = (sdist[r.secondary] || 0) + 1; });
console.log(JSON.stringify(sdist));

console.log('\n===== 各类代表票（每类最深 3 个，带地址）=====');
for (const k of Object.keys(dist)) {
  const arr = losses.filter(r => r.primary === k).sort((a, b) => a.netBnb - b.netBnb).slice(0, 3);
  arr.forEach(r => console.log(`[${k}] ${r.symbol} ${r.addr} ${r.netBnb.toFixed(3)} | ${r.diagnosis}`));
}

console.log('\n===== 赢票成功模式分布 =====');
const wdist = {};
wins.forEach(r => { const k = r.primary || '?'; (wdist[k] = wdist[k] || { n: 0, net: 0 }).n++; wdist[k].net += r.netBnb; });
Object.entries(wdist).sort((a, b) => b[1].n - a[1].n).forEach(([k, v]) => console.log(`${k.padEnd(10)} ${v.n} 票  合计 +${v.net.toFixed(2)} BNB`));
const eg = {};
wins.forEach(r => { if (r.exitGap) eg[r.exitGap] = (eg[r.exitGap] || 0) + 1; });
console.log('exitGap:', JSON.stringify(eg));

// ==== 赢票 vs 亏票的买点画像对比（成功模式因子差异）====
console.log('\n===== 赢/亏票买点因子中位对比 =====');
const med = arr => { const s = arr.filter(v => v != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
for (const key of ['uw', 'top1Share', 'holderTrendCV', 'ddAtBuy', 'riseSpeed', 'earlyReturn', 'ageSec', 'netBuyRatio']) {
  const wv = wins.map(r => { const d = diagByAddr.get(r.addr); return d && d.buy[key]; });
  const lv = losses.map(r => { const d = diagByAddr.get(r.addr); return d && d.buy[key]; });
  const wm = med(wv), lm = med(lv);
  if (wm != null && lm != null) console.log(`${key.padEnd(15)} win=${Number(wm).toFixed(2).padStart(9)}  loss=${Number(lm).toFixed(2).padStart(9)}`);
}
const wmax = med(wins.map(r => { const d = diagByAddr.get(r.addr); return d && d.path.maxPctAfterBuy; }));
const lmax = med(losses.map(r => { const d = diagByAddr.get(r.addr); return d && d.path.maxPctAfterBuy; }));
console.log(`${'maxPctAfterBuy'.padEnd(15)} win=${Number(wmax).toFixed(1).padStart(9)}  loss=${Number(lmax).toFixed(1).padStart(9)}`);

fs.writeFileSync('/Users/nobody1/Desktop/Codes/richer-js/data/analysis-82093ca3-llm-attribution.json', JSON.stringify(rows, null, 1));
console.log('\n存档 data/analysis-82093ca3-llm-attribution.json');
