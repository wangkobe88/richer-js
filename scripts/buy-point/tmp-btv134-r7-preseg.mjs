// R7 手算：出口段（最后 ≥30s gap 后→锚）+ 段前 60s 背景窗（T143 同口径）——149 票
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades.json'), 'utf8'));
const out = [];
for (const p of doc.points) {
  const rowsAll = (JSON.parse(readFileSync(resolve(HERE, `sets/btv134-trades-ticks/${p.ticksFile}`), 'utf8')).rows) || [];
  const rel = rowsAll
    .map(t => ({ ts: new Date(t.block_time).getTime(), bnb: Number(t.bnb_amount), side: t.trade_type }))
    .sort((a, b) => a.ts - b.ts);
  const anchorTs = new Date(p.anchorTimeIso).getTime();
  const win = rel.filter(x => x.ts <= anchorTs);
  if (win.length < 2) continue;
  // 最后一个 ≥30s gap（沉积段）=出口行
  let exitIdx = 0;
  for (let i = 1; i < win.length; i++) {
    if (win[i].ts - win[i - 1].ts >= 30000) exitIdx = i;
  }
  const seg = win.slice(exitIdx);
  const exitTs = win[exitIdx].ts;
  // 段前 60s 背景窗（T143 背景腿同口径：出口行前 60s）
  const pre = win.filter(x => x.ts >= exitTs - 60000 && x.ts < exitTs);
  const preBnb = pre.reduce((s, x) => s + x.bnb, 0);
  const prePerMin = preBnb; // 60s 窗→B/min 数值同
  const preTicksPerMin = pre.length;
  const segBuy = seg.filter(x => x.side === 'buy').reduce((s, x) => s + x.bnb, 0);
  const segSell = seg.filter(x => x.side === 'sell').reduce((s, x) => s + x.bnb, 0);
  out.push({
    pointId: p.pointId, symbol: p.tokenSymbol, addr: p.tokenAddress,
    segStartDt: exitIdx === 0 ? null : 'dep', segN: seg.length,
    segBuy: +segBuy.toFixed(3), segSell: +segSell.toFixed(3),
    segRatio: segBuy > 0 ? +(segSell / segBuy).toFixed(2) : null,
    prePerMin: +prePerMin.toFixed(3), preTicksPerMin,
    preCold: prePerMin < 0.5 && preTicksPerMin < 6,
  });
}
writeFileSync('/tmp/btv134-r7-preseg.json', JSON.stringify(out));
console.log(`149 票手算段前背景 → /tmp/btv134-r7-preseg.json`);
