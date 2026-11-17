// 首笔大单 flap LibCurve 反推真实起点 P₀（182 跑零 DB）
// 主力档 CURVE_RH_BNB(20)：r=6.14, h=107036752；恒积 (1e9+h−s)(r+eth)=k
// 买入 Δx：均价 p̄=(r_cur+Δx)/(h+1e9) → tx 前真实起点 P0_real=p̄−Δx/(h+1e9)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { resolveLaunchPriceBnb } = require_('../../src/market-analysis/launch-price.js');
const { sliceAsOf } = await import('./lib.mjs');

const H_SUPPLY = 107036752 + 1e9; // 主力档 token 供给（h+1e9）
const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades.json'), 'utf8'));
const constBnb = resolveLaunchPriceBnb('flap');
const out = [];
for (const p of doc.points) {
  const rows = sliceAsOf(JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades-ticks', p.ticksFile), 'utf8')).rows || [], p.anchorTickCount);
  let fb = null;
  for (const t of rows) { if (t.trade_type === 'buy') { fb = t; break; } }
  if (!fb) continue;
  const dx = Number(fb.bnb_amount);
  const pbar = Number(fb.price_bnb);
  if (!(dx > 0) || !(pbar > 0)) continue;
  const p0Real = pbar - dx / H_SUPPLY; // tx 前真实起点（BNB/token）
  // 锚时刻现价（最后可靠价）与三口径 curVs
  let lastRel = null;
  for (const t of rows) {
    const px = Number(t.price_bnb);
    if (px > 0 && !t.price_outlier) lastRel = px;
  }
  if (!lastRel) continue;
  const pct = (l) => l > 0 ? +(((lastRel / l) - 1) * 100).toFixed(2) : null;
  out.push({
    pointId: p.pointId, symbol: p.tokenSymbol,
    firstBuyBnb: +dx.toFixed(4), pbar: +pbar.toPrecision(4),
    p0Real: p0Real > 0 ? +p0Real.toPrecision(4) : null,
    p0RealVsConst: p0Real > 0 ? +(((p0Real / constBnb) - 1) * 100).toFixed(1) : null,
    curVsConst: pct(constBnb), curVsReal: pct(p0Real),
    gateConst: (lastRel / constBnb - 1) * 100 <= 28.5, gateReal: p0Real > 0 && (lastRel / p0Real - 1) * 100 <= 28.5,
  });
}
writeFileSync('/tmp/btv134-p0-reverse.json', JSON.stringify(out));
console.log(`flap 首买反推票 n=${out.length} → /tmp/btv134-p0-reverse.json`);
