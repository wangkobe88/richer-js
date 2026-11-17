// R7 验证：锚窗卖/买比分布（豁免资格成色腿候选线 ≥3）——重算 set-ticks 全 149 成交票
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { sliceAsOf } = await import('./lib.mjs');
const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades.json'), 'utf8'));
const out = [];
for (const p of doc.points) {
  const rows = sliceAsOf(JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades-ticks', p.ticksFile), 'utf8')).rows || [], p.anchorTickCount);
  let buy = 0, sell = 0;
  for (const t of rows) {
    if (t.trade_type === 'buy') buy += Number(t.bnb_amount); else sell += Number(t.bnb_amount);
  }
  out.push({
    pointId: p.pointId, symbol: p.tokenSymbol, addr: p.tokenAddress,
    winBuy: +buy.toFixed(3), winSell: +sell.toFixed(3),
    sellBuyRatio: buy > 0 ? +(sell / buy).toFixed(2) : null,
  });
}
writeFileSync('/tmp/btv134-r7-ratio.json', JSON.stringify(out));
console.log(`149 票锚窗买卖比 → /tmp/btv134-r7-ratio.json`);
