// btv134 Echo(二) BP-T021 买点后捆绑买入取证（锚后窗 per-block 买侧聚合，182 跑零 DB）
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { AGGREGATOR_ROUTER_ADDRS } = require_('../../src/trading-engine/pre-check/aggregator-routers.js');
const routers = new Set([...AGGREGATOR_ROUTER_ADDRS].map(s => s.toLowerCase()));

const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades.json'), 'utf8'));
const p = doc.points.find(x => x.pointId === 'BP-T021');
const rowsAll = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades-ticks', p.ticksFile), 'utf8')).rows || [];
const t0 = new Date((doc.tokens[p.tokenAddress] || {}).createdAt || NaN).getTime() / 1000;
const anchorTs = new Date(p.anchorTimeIso).getTime() / 1000;

// 锚后 300s 窗 per-block 买侧聚合（剔路由伪钱包、去尘 0.01）
const byBlock = new Map();
for (const t of rowsAll) {
  const ts = new Date(t.block_time).getTime() / 1000;
  if (ts <= anchorTs || ts > anchorTs + 300) continue;
  const blk = t.block_number;
  if (!byBlock.has(blk)) byBlock.set(blk, { buys: 0, buyN: 0, wallets: new Map(), sells: 0, sellN: 0, dt: t.block_time });
  const e = byBlock.get(blk);
  const w = String(t.sender_address || t.trader_address || '').toLowerCase();
  if (t.trade_type === 'buy') {
    e.buys += Number(t.bnb_amount); e.buyN++;
    if (!routers.has(w)) e.wallets.set(w, (e.wallets.get(w) || 0) + Number(t.bnb_amount));
  } else { e.sells += Number(t.bnb_amount); e.sellN++; }
}
console.log(`Echo(二) ${p.tokenAddress} 锚=${p.anchorTimeIso}（t+${Math.round((anchorTs - t0) / 1000)}s）后 300s：`);
for (const [blk, e] of byBlock) {
  if (e.buys < 0.1) continue;
  const ws = [...e.wallets.entries()].filter(([, b]) => b >= 0.01).sort((a, b) => b[1] - a[1]);
  console.log(`blk ${blk} @${e.dt}（锚+${Math.round((new Date(e.block_time || e.dt).getTime() / 1000 - anchorTs))}s）买 ${e.buys.toFixed(3)}×${e.buyN} 笔/去尘钱包 ${ws.length} 个 卖 ${e.sells.toFixed(3)}×${e.sellN}`);
  if (ws.length >= 3) console.log('   钱包: ' + ws.slice(0, 8).map(([w, b]) => `${w.slice(0, 8)}…${w.slice(-4)}=${b.toFixed(3)}`).join(' '));
}
