// P4 act=low 误杀 18 票展示页生成（本地跑，零 DB 零网络：读 /tmp/bp-runs 两份合成档）
// 口径：重析 bucket=poor 且 rule=activity_gate（活跃度门首拒）——恰 18 票 pnl 合计 +0.4252
import fs from 'node:fs';

const rev = JSON.parse(fs.readFileSync('/tmp/bp-runs/btv109-review.json', 'utf8'));
const run = JSON.parse(fs.readFileSync('/tmp/bp-runs/btv109-run.json', 'utf8'));
const runBy = new Map(run.results.map(r => [r.pointId, r]));

const rows = rev.filter(r => r.rule === 'activity_gate').map(r => {
  const rr = runBy.get(r.pointId);
  const an = rr?.anchors ?? {};
  const fwd = {};
  for (const h of [1, 5, 15]) {
    const k = `fwd${h}m`;
    fwd[h] = r[k] ?? null;
  }
  const fw = rr?.forwardReturns?.byHorizon ?? {};
  const hOf = (sec) => fw[sec] ?? null;
  return {
    pid: r.pointId.replace('BP-', ''), symbol: r.symbol, addr: r.addr, anchor: r.anchor,
    ageSec: r.ageSec, curVs: r.curVs, tickN: rr?.anchorTickCount ?? r.ticks,
    act: r.act, actProb: r.actProb, mp: r.mp, entry: r.entry, holder: r.holder,
    idlePct: an.actIdlePct, thru: an.actThroughputBnbPerMin,
    segTpm: an.actNearSegTicksPerMin, segBnb: an.actNearSegBnbPerMin, segMaxGap: an.actNearSegMaxGapSec,
    tail10Tpm: an.actNearTail10BnbPerMin, tail10TickN: an.actNearTail10TickN, tail10SellW: an.actNearTail10SellWallets,
    pre20: an.actNearPre20BnbPerMin, w30: an.win30TicksPerMin, w60: an.win60TicksPerMin, w120: an.win120TicksPerMin,
    tail5BuyN: an.actNearTail5BuyN, tail5BuyBnb: an.actNearTail5BuyBnb, tail5BuySharePct: an.actNearTail5BuySharePct,
    pnl: r.pnl ?? 0,
    fwd1: hOf(60), fwd5: hOf(300), fwd15: hOf(900),
    prodGrade: r.cheat?.grade ?? '?', prodExempt: r.cheat?.exempt?.code ?? null,
    bpBucket: r.bpProd?.bucket ?? '?', bpRule: r.bpProd?.rule ?? '?',
    buyLeg: (r.buyLeg ?? []).join(' / '),
  };
});
rows.sort((a, b) => (b.pnl || 0) - (a.pnl || 0));
const sumPnl = rows.reduce((a, r) => a + (r.pnl || 0), 0);
const nBought = rows.filter(r => r.bpBucket === 'neutral').length;

const fmt = (v, d = 2) => v == null ? '—' : Number(v).toFixed(d);
const cls = (v) => v == null ? '' : (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
const fwdCell = (f) => !f ? '—' : `<span class="${cls(f.maxRisePct)}">${fmt(f.maxRisePct, 1)}%</span><span class="sub">/${fmt(f.lastPct, 1)}</span>`;

const trs = rows.map(r => `
<tr>
  <td class="pid">${r.pid}</td>
  <td class="sym">${r.symbol}<span class="addr" title="${r.addr}">${r.addr.slice(0, 8)}…${r.addr.slice(-4)}</span></td>
  <td class="t">${r.anchor.slice(11, 19)}</td>
  <td class="n">${r.ageSec >= 3600 ? fmt(r.ageSec / 60, 0) + '分' : r.ageSec + 's'}</td>
  <td class="${cls(r.curVs)}">${fmt(r.curVs, 1)}%</td>
  <td class="n">${r.tickN}</td>
  <td class="pill">${r.act}</td>
  <td class="n">${fmt(r.actProb * 100, 0)}%</td>
  <td class="pill">${r.mp}</td>
  <td class="pill">${r.entry ?? '—'}</td>
  <td class="pill">${r.holder ?? '—'}</td>
  <td class="n">${fmt(r.idlePct, 0)}%</td>
  <td class="n">${fmt(r.thu, 2)}</td>
  <td class="n">${fmt(r.segBnb, 2)}</td>
  <td class="n">${r.segTpm ?? '—'}</td>
  <td class="n">${fmt(r.tail10Tpm, 2)}</td>
  <td class="n">${fmt(r.pre20, 2)}</td>
  <td class="n">${fmt(r.w30)}·${fmt(r.w60)}·${fmt(r.w120)}</td>
  <td class="n">${r.tail5BuyN}笔/${fmt(r.tail5BuyBnb, 3)}</td>
  <td class="${cls(r.pnl)} b">${fmt(r.pnl, 4)}</td>
  <td>${fwdCell(r.fwd1)}</td>
  <td>${fwdCell(r.fwd5)}</td>
  <td>${fwdCell(r.fwd15)}</td>
  <td class="pill">${r.prodGrade}${r.prodExempt ? `<span class="ex">${r.prodExempt}</span>` : ''}</td>
  <td class="pill ${r.bpBucket === 'neutral' ? 'ok' : 'bad'}">${r.bpBucket}</td>
  <td class="small">${r.buyLeg}</td>
</tr>`).join('');

const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>P4 act=low 误杀 18 票 — btv109</title>
<style>
  :root { color-scheme: dark; }
  body { background:#14161a; color:#d7dce3; font:13px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif; margin:0; padding:24px; }
  h1 { font-size:18px; margin:0 0 4px; }
  .sub2 { color:#8b93a1; font-size:12px; margin-bottom:16px; }
  .stats { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:16px; }
  .card { background:#1d2026; border:1px solid #2a2f38; border-radius:8px; padding:10px 16px; }
  .card .k { color:#8b93a1; font-size:11px; }
  .card .v { font-size:17px; font-weight:600; margin-top:2px; }
  .pos { color:#4cd48a; } .neg { color:#f2707a; } .b { font-weight:600; }
  table { border-collapse:collapse; width:100%; font-size:12px; }
  th { position:sticky; top:0; background:#1d2026; color:#9aa3b2; font-weight:500; text-align:right; padding:7px 8px; border-bottom:1px solid #2a2f38; cursor:pointer; user-select:none; white-space:nowrap; }
  th:hover { color:#d7dce3; }
  td { padding:6px 8px; border-bottom:1px solid #22262e; text-align:right; white-space:nowrap; }
  td.l, th.l { text-align:left; }
  tr:hover td { background:#1a1d23; }
  .pid { color:#8ab4f8; font-weight:600; }
  .sym { text-align:left; }
  .addr { display:block; color:#6b7382; font-size:10px; font-family:ui-monospace,monospace; }
  .pill { background:#262b33; border-radius:4px; padding:1px 6px; font-size:11px; display:inline-block; }
  .pill.ok { background:#1d3a2b; color:#4cd48a; }
  .pill.bad { background:#3d2327; color:#f2707a; }
  .ex { display:block; color:#d9a94c; font-size:10px; }
  .small { font-size:11px; color:#8b93a1; max-width:150px; overflow:hidden; text-overflow:ellipsis; }
  .sub { color:#6b7382; font-size:10px; display:block; }
  .grp { border-left:2px solid #3a4150; padding-left:6px; }
  .note { margin-top:14px; color:#8b93a1; font-size:11.5px; max-width:1100px; }
</style>
</head>
<body>
<h1>P4 · act=low 误杀 18 票（btv109 复审队列）</h1>
<div class="sub2">口径：BP64 重析 bucket=poor 且首拒 rule=activity_gate（活跃度门）· 重析档 bp-run-2026-11-12T23-22-53 · 全部为生产成交买点（trades 源）</div>
<div class="stats">
  <div class="card"><div class="k">票数</div><div class="v">18</div></div>
  <div class="card"><div class="k">实际盈亏合计（生产已买入）</div><div class="v pos">+${sumPnl.toFixed(4)} BNB</div></div>
  <div class="card"><div class="k">盈利票</div><div class="v">${rows.filter(r => r.pnl > 0).length} / 18</div></div>
  <div class="card"><div class="k">生产 BP 门放行</div><div class="v">${nBought} / 18</div></div>
  <div class="card"><div class="k">fwd15 maxRise 中位</div><div class="v">${fmt(median(rows.map(r => r.fwd15?.maxRisePct).filter(v => v != null)), 1)}%</div></div>
  <div class="card"><div class="k">年龄中位</div><div class="v">${fmt(median(rows.map(r => r.ageSec).filter(v => v != null)), 0)}s</div></div>
</div>
<table id="t">
<thead><tr>
  <th class="l">票</th><th class="l">代币</th><th class="l">锚时刻</th><th>年龄</th><th>位置<br>curVs</th><th>tick数</th>
  <th class="grp l">活跃度</th><th>置信</th><th>盘型</th><th>点位</th><th>筹码</th>
  <th class="grp">闲置率<br>idle%</th><th>吞吐<br>BNB/min</th><th>临近段<br>BNB/min</th><th>临近<br>笔/min</th><th>尾10s<br>BNB/min</th><th>前20s<br>BNB/min</th><th>窗密度<br>30/60/120</th><th>尾5s买</th>
  <th class="grp">实际盈亏<br>BNB</th><th>fwd 1m<br>max/last</th><th>fwd 5m</th><th>fwd 15m</th>
  <th class="grp l">生产cheat</th><th class="l">生产BP</th><th class="l">买腿</th>
</tr></thead>
<tbody>${trs}</tbody>
</table>
<div class="note">
判 low 证据锚（重析 as-of 截窗）：闲置率=actIdlePct · 吞吐=actThroughputBnbPerMin（CD 线 1 BNB/min 死寂）· 临近段=锚前 30s · 尾 10s/前 20s=吞吐固定窗归一 · 窗密度=win30/60/120TicksPerMin。
生产列：cheat=成交信号时刻 grade+豁免码；生产BP=bpProd（neutral=当时放行买入）。
合计口径与 sweep 报告一致：若 BP64 门链当时生效，这 18 笔全被 activity_gate 拒绝 = 损失 +0.4252 BNB（T093 +0.267 单票主导）。
点列头排序。
</div>
<script>
document.querySelectorAll('th').forEach((th, i) => th.addEventListener('click', () => {
  const tbody = document.querySelector('tbody');
  const trs = [...tbody.rows];
  const dir = th.dataset.dir === 'asc' ? -1 : 1;
  document.querySelectorAll('th').forEach(x => x.dataset.dir = '');
  th.dataset.dir = dir === 1 ? 'asc' : 'desc';
  const val = (tr) => { const td = tr.cells[i]; const t = td.textContent.trim().replace(/[%s分BNB/+．]/g,''); const n = parseFloat(t); return isNaN(n) ? -Infinity : n; };
  trs.sort((a, b) => val(a) - val(b)) ; if (dir === -1) trs.reverse();
  trs.forEach(tr => tbody.appendChild(tr));
}));
function median(a){ if(!a.length) return null; const s=[...a].sort((x,y)=>x-y); const m=s.length>>1; return s.length%2?s[m]:(s[m-1]+s[m])/2; }
</script>
</body>
</html>`;
fs.writeFileSync('/tmp/bp-runs/p4-actlow-18.html', html);
console.log('written /tmp/bp-runs/p4-actlow-18.html rows=' + rows.length + ' sum=' + sumPnl.toFixed(4) + ' 生产放行 ' + nBought);
function median(a){ if(!a.length) return null; const s=[...a].sort((x,y)=>x-y); const m=s.length>>1; return s.length%2?s[m]:(s[m-1]+s[m])/2; }
