// btv134 组2 六票 famous 买入占比重算（182 跑，零 DB 零网络：set+ticks 自包含）
// 口径=buildBuyPointSnapshot.famousTraces（roster 默认 loadFamousRoster；wallet=sender||trader）
import { createRequire } from 'module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { buildBuyPointSnapshot } = require_('../../src/market-analysis/buy-point-snapshot.js');
const { sliceAsOf } = await import('./lib.mjs');

const IDS = ['BP-T056','BP-T046','BP-T055','BP-T033','BP-T032','BP-T061'];
const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades.json'), 'utf8'));
const tokensMeta = doc.tokens || {};

for (const p of doc.points) {
  if (!IDS.includes(p.pointId)) continue;
  const rowsAll = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades-ticks', p.ticksFile), 'utf8')).rows || [];
  const rows = sliceAsOf(rowsAll, p.anchorTickCount);
  const meta = { ...(tokensMeta[p.tokenAddress] || { address: p.tokenAddress }), quoteToken: p.quoteToken || null };
  const snap = buildBuyPointSnapshot(rows, meta, {
    capped: p.capped === true, anchorTickCount: p.anchorTickCount,
    signalInfo: { firePriceBnb: p.signalInfo ? p.signalInfo.price : null },
  });
  const b = snap.buyDerived;
  const ft = b.famousTraces;
  const totalBuy = b.cd && b.cd.totalBuyBnb;
  console.log(`\n=== ${p.pointId} ${p.tokenSymbol} ${p.tokenAddress}`);
  if (!ft) { console.log('  famousTraces=null（名单缺失）'); continue; }
  console.log(`  锚窗总买=${(totalBuy ?? 0).toFixed(3)} BNB | famous 买合计=${ft.groupBuyBnb}（占买 ${ft.groupBuyPct}%）| famous 卖合计=${ft.groupSellBnb}（占卖 ${ft.groupSellPct}%）| 净和=${ft.netSumBnb} | 在场净和=${ft.presenceNetBnb} | 在场持有人数=${ft.inCustodyCount}`);
  if (!ft.wallets.length) { console.log('  （锚窗内无 famous 钱包交易）'); continue; }
  for (const w of ft.wallets) {
    console.log(`  ${w.w} 买${w.buyBnb}(${w.buyN}笔) 卖${w.sellBnb}(${w.sellN}笔) 净${w.netBnb} 首买@${w.firstBuyDt !== null ? Math.round(w.firstBuyDt) + 's' : '?'} 入场vs发行=${w.entryVsLaunchPct ?? '?'}% hold=${w.holdSec ?? '?'}s fastFlip=${w.fastFlip}`);
  }
}
