#!/usr/bin/env node
/** 评3 161 票主题归类汇总：theme × 盈亏交叉 + 东方票名单 */
const fs = require('fs');
const path = require('path');

const DIAG = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/analysis-82093ca3-diagnosis.json'), 'utf8'));
const dByAddr = new Map(DIAG.map(t => [t.addr, t]));

const rows = [];
for (let i = 1; i <= 4; i++) {
  const f = path.join(__dirname, '../data/diagnosis-out/r3-' + i + '.json');
  if (!fs.existsSync(f)) { console.log('缺 r3-' + i); continue; }
  rows.push(...JSON.parse(fs.readFileSync(f, 'utf8')));
}
console.log('归类', rows.length, '票\n');

const THEME_LABEL = {
  west_current: '西方时事', east_current: '东方时事', crypto_native: '加密原生',
  east_ip: '东方虚构IP', west_ip: '西方虚构IP', cn_meme: '中文梗/纯词', en_meme: '英文梗/纯词', other: '其他',
};

console.log('===== theme × 盈亏交叉 =====');
console.log('theme'.padEnd(14), 'n'.padStart(3), 'win'.padStart(4), 'loss'.padStart(4), '胜率'.padStart(5), '净BNB'.padStart(8));
const agg = {};
rows.forEach(r => {
  const d = dByAddr.get(r.addr);
  const k = r.theme || 'other';
  agg[k] = agg[k] || { n: 0, win: 0, loss: 0, net: 0 };
  agg[k].n++;
  if (d) {
    if (d.outcome === 'win') agg[k].win++;
    else if (d.outcome === 'loss') agg[k].loss++;
    agg[k].net += d.netBnb;
  }
});
const order = ['west_current', 'east_current', 'crypto_native', 'east_ip', 'west_ip', 'cn_meme', 'en_meme', 'other'];
let totNet = 0;
[...order].sort((a, b) => (agg[b]?.n || 0) - (agg[a]?.n || 0)).concat(order.filter(k => !agg[k])).filter((v, i, a) => a.indexOf(v) === i && agg[v]).forEach(k => {
  const v = agg[k]; totNet += v.net;
  console.log((THEME_LABEL[k] || k).padEnd(14), String(v.n).padStart(3), String(v.win).padStart(4), String(v.loss).padStart(4),
    (v.win + v.loss ? (100 * v.win / (v.win + v.loss)).toFixed(0) + '%' : '-').padStart(5), v.net.toFixed(2).padStart(8));
});
console.log('合计', rows.length, '票，净', totNet.toFixed(2), 'BNB');

console.log('\n===== 东方时事（east_current）全名单 =====');
rows.filter(r => r.theme === 'east_current').forEach(r => {
  const d = dByAddr.get(r.addr);
  console.log(`  ${r.symbol.padEnd(12)} ${r.addr} ${(d ? d.netBnb : 0).toFixed(3)} ${d ? d.outcome : '?'} | ${r.why}`);
});

console.log('\n===== 东方虚构IP（east_ip）全名单 =====');
rows.filter(r => r.theme === 'east_ip').forEach(r => {
  const d = dByAddr.get(r.addr);
  console.log(`  ${r.symbol.padEnd(12)} ${r.addr} ${(d ? d.netBnb : 0).toFixed(3)} ${d ? d.outcome : '?'} | ${r.why}`);
});

console.log('\n===== 西方时事（west_current）代表 15 =====');
rows.filter(r => r.theme === 'west_current').slice(0, 15).forEach(r => {
  const d = dByAddr.get(r.addr);
  console.log(`  ${r.symbol.padEnd(12)} ${r.addr} ${(d ? d.netBnb : 0).toFixed(3)} ${d ? d.outcome : '?'} | ${r.why.slice(0, 60)}`);
});

fs.writeFileSync(path.join(__dirname, '../data/analysis-82093ca3-r3-theme.json'), JSON.stringify(rows, null, 1));
console.log('\n存档 data/analysis-82093ca3-r3-theme.json');
