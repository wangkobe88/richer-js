// 首笔大额买入对 currentVsLaunchPct 基线污染评估（182 跑零 DB）
// 三口径：A=常量锚（发布价）/ B=现行地板锚（min(常量,首买价,滚动最低)@锚）/ C=修正锚（首买额>阈值时首买价不进地板）
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { resolveLaunchPriceBnb } = require_('../../src/market-analysis/launch-price.js');
const { sliceAsOf } = await import('./lib.mjs');

const THRESH = 0.3; // 用户提案线：首买额 >0.3 BNB 时修正基线
const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades.json'), 'utf8'));
const out = [];
for (const p of doc.points) {
  const rows = sliceAsOf(JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades-ticks', p.ticksFile), 'utf8')).rows || [], p.anchorTickCount);
  const meta = doc.tokens[p.tokenAddress] || {};
  const plat = meta.platform || 'fourmeme';
  const launchConst = resolveLaunchPriceBnb(plat, meta.quoteToken ?? null);
  // 首笔 BUY（链上真序）与滚动最低（可靠价 BUY/SELL 皆更——对齐 FA _minRelPriceBnb 口径）
  let firstBuy = null;
  let minRel = null;
  let lastRel = null; // 锚时刻现价（最后一笔可靠价）
  for (const t of rows) {
    const px = Number(t.price_bnb);
    const ok = px > 0 && !t.price_outlier;
    if (!ok) continue;
    if (t.trade_type === 'buy' && firstBuy === null) firstBuy = { bnb: Number(t.bnb_amount), px, dt: t.block_time };
    if (minRel === null || px < minRel) minRel = px;
    lastRel = px;
  }
  if (!lastRel || !launchConst) { out.push({ pointId: p.pointId, symbol: p.tokenSymbol, skip: true }); continue; }
  const pct = (launch) => launch > 0 ? +((lastRel / launch - 1) * 100).toFixed(2) : null;
  const a = pct(launchConst); // A 常量锚
  const b = pct(Math.min(launchConst, firstBuy ? firstBuy.px : Infinity, minRel ?? Infinity)); // B 现行地板
  const c = firstBuy && firstBuy.bnb > THRESH
    ? pct(Math.min(launchConst, minRel ?? Infinity)) // C 修正：大额首买价不进地板（滚动最低仍进）
    : b; // 非大额首买=与 B 相同
  const fbPct = firstBuy ? +(((lastRel / firstBuy.px) - 1) * 100).toFixed(2) : null;
  const bBasis = b === null || a === null || Math.abs(b - a) <= 0.51 ? 'const'
    : (fbPct !== null && Math.abs(fbPct - b) <= 0.51 ? 'firstBuy' : 'minRel');
  out.push({
    pointId: p.pointId, symbol: p.tokenSymbol,
    firstBuyBnb: firstBuy ? +firstBuy.bnb.toFixed(4) : null,
    firstBuyVsConst: firstBuy && launchConst ? +(((firstBuy.px / launchConst) - 1) * 100).toFixed(1) : null,
    curVsA: a, curVsB: b, curVsC: c,
    gateA: a !== null ? a <= 28.5 : null, gateB: b !== null ? b <= 28.5 : null, gateC: c !== null ? c <= 28.5 : null,
  });
}
writeFileSync('/tmp/btv134-baseline.json', JSON.stringify(out));
console.log(`149 票三口径 → /tmp/btv134-baseline.json`);
