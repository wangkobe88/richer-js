// 修正基线「重找点位」模拟（182 跑零 DB）：23 张翻转票在真实口径门(≤28.5)下
// 锚后窗口内找第一个回落可买点 t*，以 t* 买入，近似新 episode（5m/15m 末价卖出口径）
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades.json'), 'utf8'));
const rev = JSON.parse(readFileSync(resolve(HERE, 'data/btv134-p0-reverse.json'), 'utf8'));
const flipIds = ['BP-T051','BP-T046','BP-T025','BP-T056','BP-T053','BP-T016','BP-T055','BP-T041','BP-T050','BP-T009','BP-T002','BP-T104','BP-T097','BP-T135','BP-T136','BP-T143','BP-T010','BP-T114','BP-T134','BP-T028','BP-T020','BP-T141','BP-T066'];
const p0 = new Map(rev.map(r => [r.pointId, r.p0Real]));
const GATE = 28.5, POS = 0.2, WAIT_MS = 15 * 60 * 1000;

const out = [];
for (const pid of flipIds) {
  const p = doc.points.find(x => x.pointId === pid);
  const P0 = p0.get(pid);
  if (!P0) { out.push({ pointId: pid, note: 'no p0' }); continue; }
  const rows = (JSON.parse(readFileSync(resolve(HERE, `sets/btv134-trades-ticks/${p.ticksFile}`), 'utf8')).rows) || [];
  const anchorTs = new Date(p.anchorTimeIso).getTime();
  const rel = rows.map(t => ({ ts: new Date(t.block_time).getTime(), px: Number(t.price_bnb), out: t.price_outlier }))
    .filter(x => x.px > 0 && !x.out);
  // 锚后 WAIT 窗内找第一个 curVs_real<=28.5 的点（且价格低于锚价——回落才叫重找点位；高于锚价的门内点=原锚本身可能就过门（curVs_real 在 28.5 上下边缘））
  let entry = null;
  for (const x of rel) {
    if (x.ts <= anchorTs || x.ts > anchorTs + WAIT_MS) continue;
    if ((x.px / P0 - 1) * 100 <= GATE) { entry = x; break; }
  }
  if (!entry) { out.push({ pointId: pid, symbol: p.tokenSymbol, reentry: false }); continue; }
  const fwd = (winMs) => {
    let mx = entry.px, last = null, n = 0;
    for (const x of rel) {
      if (x.ts <= entry.ts || x.ts > entry.ts + winMs) continue;
      n++; if (x.px > mx) mx = x.px; last = x.px;
    }
    return { n, maxPct: +(((mx / entry.px) - 1) * 100).toFixed(1), lastPct: last !== null ? +(((last / entry.px) - 1) * 100).toFixed(1) : null };
  };
  out.push({
    pointId: pid, symbol: p.tokenSymbol, reentry: true,
    waitSec: Math.round((entry.ts - anchorTs) / 1000),
    entryPctVsAnchor: +(((entry.px / (rel.find(x => x.ts <= anchorTs)?.px || entry.px)) - 1) * 100).toFixed(1),
    fwd5m: fwd(300000), fwd15m: fwd(900000),
    pnl5m: +(POS * fwd(300000).lastPct / 100).toFixed(4),
    pnl15m: +(POS * fwd(900000).lastPct / 100).toFixed(4),
  });
}
writeFileSync('/tmp/btv134-reentry.json', JSON.stringify(out, null, 1));
const ok = out.filter(r => r.reentry);
console.log(`23 张翻转票：重找点位成功 ${ok.length}，错过（15min 内未回落进门）${out.length - ok.length}`);
