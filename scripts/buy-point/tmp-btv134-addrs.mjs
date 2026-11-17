// btv134 149 票扫多个指定钱包行为（182 跑，零 DB）
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGETS = process.argv.slice(2);
if (!TARGETS.length) { console.error('用法: tmp-btv134-addrs.mjs 0xaaa,0xbbb,…'); process.exit(2); }
const want = new Set(TARGETS[0].split(',').map(s => s.trim().toLowerCase()));
const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades.json'), 'utf8'));

for (const addr of want) {
  console.log(`\n===== ${addr}`);
  let hits = 0;
  for (const p of doc.points) {
    const rows = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades-ticks', p.ticksFile), 'utf8')).rows || [];
    const mine = rows.filter(t => String(t.sender_address || t.trader_address || '').toLowerCase() === addr);
    if (!mine.length) continue;
    hits++;
    const t0 = new Date((doc.tokens[p.tokenAddress] || {}).createdAt || NaN).getTime() / 1000;
    const anchorRel = Number.isFinite(t0) ? Math.round(new Date(p.anchorTimeIso).getTime() / 1000 - t0) : null;
    let buy = 0, sell = 0, first = null, last = null;
    for (const t of mine) {
      const rel = Number.isFinite(t0) ? Math.round(new Date(t.block_time).getTime() / 1000 - t0) : null;
      if (t.trade_type === 'buy') buy += Number(t.bnb_amount); else sell += Number(t.bnb_amount);
      if (first === null || (rel !== null && rel < first)) first = rel;
      if (last === null || (rel !== null && rel > last)) last = rel;
    }
    const totBuy = rows.filter(t => t.trade_type === 'buy').reduce((s, t) => s + Number(t.bnb_amount), 0);
    const pnl = p.trade && p.trade.episode ? p.trade.episode.pnlBnb : null;
    const beforeAnchor = last !== null && anchorRel !== null && last <= anchorRel;
    console.log(`${p.pointId} ${p.tokenSymbol} | 买${buy.toFixed(4)} 卖${sell.toFixed(4)} | 区间 t+${first}~t+${last}s（锚=t+${anchorRel}s${beforeAnchor ? '，行为全在锚前' : ''}）| 占全窗买 ${(totBuy > 0 ? (buy / totBuy * 100).toFixed(1) : '?')}% | ep=${pnl !== null ? pnl.toFixed(4) : '?'}`);
  }
  console.log(`命中 token: ${hits}/149`);
}
