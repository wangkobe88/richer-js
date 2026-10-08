#!/usr/bin/env node
/**
 * 0fed29f9 晚票证据门细化扫描（纯本地，读 timing JSON）
 *
 * 用户裁定方向：早票（相对事件时点）正常买；晚票要求更高——比较确定
 * 用户认同（或强庄）才入场。corpusLagSec = 首 tick − min(主推,父推) 时间。
 *
 * 输出：lag 边界敏感性 / 单门与组合门（er×uw×buyBnb×top1）逐档避亏-误伤表 /
 *       旧语料票（≥24h）与簇内晚票分层。
 */
const fs = require('fs');
const path = require('path');
const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/analysis-0fed29f9-timing.json'), 'utf8'));

for (const r of rows) {
  const anchorTs = Math.min(...[r.corpusMainAt, r.corpusParentAt].filter(Boolean));
  const tickTs = r.firstTickReceivedAt ? Date.parse(r.firstTickReceivedAt) : NaN;
  r.lagSec = (isFinite(anchorTs) && isFinite(tickTs)) ? (tickTs - anchorTs) / 1000 : null;
  r.er = r.tf?.earlyReturn ?? null;
  r.uw = r.pbc?.earlyTradesUniqueWallets ?? null;
  r.bnb = r.pbc?.earlyTradesBuyBnb ?? null;
  r.top1 = r.pbc?.earlyTradesTop1BuySharePct ?? null;
}
const sum = a => a.reduce((x, y) => x + y, 0);
const noLag = rows.filter(r => r.lagSec == null);
console.log(`共 ${rows.length} 票，lag 可算 ${rows.length - noLag.length}，不可算 ${noLag.length}（${noLag.map(r => r.symbol).join(',') || '-'}）`);
console.log(`全体净额 ${sum(rows.map(r => r.net)).toFixed(3)} BNB\n`);

// ---------- lag 边界敏感性 ----------
console.log('===== lag 边界敏感性（早/晚分桶净额）=====');
for (const cut of [180, 300, 600, 1800, 86400]) {
  const early = rows.filter(r => r.lagSec != null && r.lagSec < cut);
  const late = rows.filter(r => r.lagSec != null && r.lagSec >= cut);
  console.log(`cut=${String(cut).padStart(6)}s | 早 ${String(early.length).padStart(2)} 票 净 ${sum(early.map(r => r.net)).toFixed(3).padStart(7)} | 晚 ${String(late.length).padStart(2)} 票 净 ${sum(late.map(r => r.net)).toFixed(3).padStart(7)} | 晚亏票 ${late.filter(r => r.net < 0).length}`);
}

// ---------- 晚票门扫描（lag>=300）----------
const LATE_CUT = 300;
const late = rows.filter(r => r.lagSec != null && r.lagSec >= LATE_CUT);
console.log(`\n===== 晚票门扫描（lag>=${LATE_CUT}s，${late.length} 票，现状净 ${sum(late.map(r => r.net)).toFixed(3)}）=====`);
const gates = [];
for (const er of [60, 80, 100, 120]) gates.push({ name: `er>=${er}`, f: r => (r.er ?? 0) >= er });
for (const uw of [18, 20, 25]) gates.push({ name: `uw>=${uw}`, f: r => (r.uw ?? 0) >= uw });
for (const er of [60, 80, 100]) for (const uw of [18, 20]) gates.push({ name: `er>=${er}&uw>=${uw}`, f: r => (r.er ?? 0) >= er && (r.uw ?? 0) >= uw });
gates.push({ name: 'er>=100&bnb>=5', f: r => (r.er ?? 0) >= 100 && (r.bnb ?? 0) >= 5 });
gates.push({ name: 'er>=80&uw>=18&top1<30', f: r => (r.er ?? 0) >= 80 && (r.uw ?? 0) >= 18 && (r.top1 ?? 100) < 30 });

for (const g of gates) {
  const keep = late.filter(g.f), block = late.filter(r => !g.f(r));
  const blockedWin = block.filter(r => r.net > 0.0005);
  console.log(`${g.name.padEnd(22)} | 放 ${String(keep.length).padStart(2)} 票 净 ${sum(keep.map(r => r.net)).toFixed(3).padStart(7)} | 拦 ${String(block.length).padStart(2)} 票 净 ${sum(block.map(r => r.net)).toFixed(3).padStart(7)}（避亏 ${(-sum(block.map(r => r.net))).toFixed(3)}）| 误拦赢票 ${blockedWin.length} 张 ${blockedWin.map(r => `${r.symbol}+${r.net.toFixed(2)}`).join(' ') || '-'}`);
}

// ---------- 旧语料分层 ----------
console.log(`\n===== 旧语料票分层（lag>=24h）=====`);
const stale = rows.filter(r => r.lagSec != null && r.lagSec >= 86400);
const clusterLate = rows.filter(r => r.lagSec != null && r.lagSec >= LATE_CUT && r.lagSec < 86400);
console.log(`簇内晚票(5m-24h) ${clusterLate.length} 票 净 ${sum(clusterLate.map(r => r.net)).toFixed(3)} | 旧语料(>=24h) ${stale.length} 票 净 ${sum(stale.map(r => r.net)).toFixed(3)}`);
console.log(`旧语料明细: ${stale.map(r => `${r.symbol}(${r.net.toFixed(2)},lag${(r.lagSec / 3600).toFixed(0)}h,er${r.er ?? '-'})`).join(' ')}`);

// ---------- 早票对照（sanity：门不伤早票）----------
console.log(`\n===== 早票(lag<300s) er 分布（对照，确认门不影响）=====`);
const early = rows.filter(r => r.lagSec != null && r.lagSec < 300);
const lowEr = early.filter(r => (r.er ?? 0) < 100);
console.log(`早票 ${early.length} 张中 er<100 有 ${lowEr.length} 张，净 ${sum(lowEr.map(r => r.net)).toFixed(3)}——若门误扩到早票会砍掉这部分`);
