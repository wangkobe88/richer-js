// btv134 149 票扫指定钱包 0xa142…78bc 的全部行为（182 跑，零 DB）
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = '0xa1426c6f65fe804e05ce3c07a42412d735ef78bc';
const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades.json'), 'utf8'));
const byId = new Map(doc.points.map(p => [p.pointId, p]));

let hits = 0;
for (const p of doc.points) {
  const rows = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades-ticks', p.ticksFile), 'utf8')).rows || [];
  const mine = rows.filter(t => String(t.sender_address || t.trader_address || '').toLowerCase() === TARGET);
  if (!mine.length) continue;
  hits++;
  let buy = 0, sell = 0, firstDt = null, lastDt = null;
  const tokMeta = doc.tokens[p.tokenAddress] || {};
  const create = new Date(tokMeta.createdAt || NaN).getTime() / 1000;
  for (const t of mine) {
    const dt = new Date(t.block_time).getTime() / 1000;
    const rel = Number.isFinite(create) ? Math.round(dt - create) : null;
    if (t.trade_type === 'buy') buy += Number(t.bnb_amount); else sell += Number(t.bnb_amount);
    if (firstDt === null || rel < firstDt) firstDt = rel;
    if (lastDt === null || rel > lastDt) lastDt = rel;
  }
  const anchorRel = (() => {
    const a = new Date(p.anchorTimeIso).getTime() / 1000;
    return Number.isFinite(a) && Number.isFinite(create) ? Math.round(a - create) : null;
  })();
  const totalBuy = rows.filter(t => t.trade_type === 'buy').reduce((s, t) => s + Number(t.bnb_amount), 0);
  const pnl = p.trade && p.trade.episode ? p.trade.episode.pnlBnb : null;
  console.log(`${p.pointId} ${p.tokenSymbol} | 该钱包 买${buy.toFixed(4)} 卖${sell.toFixed(4)} | 出现区间 t+${firstDt}s~t+${lastDt}s（锚=t+${anchorRel}s）| 全窗总买${totalBuy.toFixed(2)}（占 ${(totalBuy > 0 ? buy / totalBuy * 100 : 0).toFixed(1)}%）| 本票 ep=${pnl !== null ? pnl.toFixed(4) : '?'}`);
}
console.log(`\n命中 token 数: ${hits}/149`);
