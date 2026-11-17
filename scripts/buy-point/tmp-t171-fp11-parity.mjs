// T171/FP11 对拍（182 跑零 DB）：真 evaluateFactorPreBuy × btv141 全 499 点重放
// 验证=famous 早窗快闪双支臂翻动面与扫描结论一致：trades 拦 5 张全负 Σ−0.130
// 零正票误伤（第 6 张 SI 0x13cc 被 set 构建的 cheat/unhealthy 过滤剔除外置验证）。
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { buildBuyPointSnapshot } = require_('../../src/market-analysis/buy-point-snapshot.js');
const { evaluateFactorPreBuy, FACTOR_PREBUY_VERSION } = require_('../../src/market-analysis/factor-pre-buy-check.js');
const { sliceAsOf } = await import('./lib.mjs');

const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv141-trades.json'), 'utf8'));
console.log(`FP 版本=${FACTOR_PREBUY_VERSION}，点数=${doc.points.length}`);

let blocked = [];
for (const p of doc.points) {
  const full = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv141-trades-ticks', p.ticksFile), 'utf8')).rows || [];
  const rows = sliceAsOf(full, p.anchorTickCount);
  const meta = { ...(doc.tokens?.[p.tokenAddress] || { address: p.tokenAddress }), quoteToken: p.quoteToken || null };
  const snap = buildBuyPointSnapshot(rows, meta, { anchorTickCount: p.anchorTickCount, capped: p.capped === true, signalInfo: p.signalInfo || {} });
  const r = evaluateFactorPreBuy(snap);
  const isEarlyFlip = (r.arms || []).some((a) => a === 'fam_early_flip_partial' || a === 'fam_early_flip_exit');
  if (isEarlyFlip) blocked.push({ pid: p.pointId, src: p.source, sym: p.tokenSymbol, addr: p.tokenAddress, pnl: p.trade?.episode?.pnlBnb ?? null, arms: r.arms, reason: r.reason });
}
console.log(`\nFP11 双支命中 ${blocked.length} 点：`);
const seen = new Set();
for (const b of blocked) {
  const key = b.addr + (b.pnl != null ? '#t' : '');
  const dup = seen.has(key); seen.add(key);
  console.log(`  ${dup ? '(同票)' : ''} ${b.pid} ${b.sym} src=${b.src} pnl=${b.pnl ?? '—'} reason=${b.reason}`);
}
const t = blocked.filter((b) => b.pnl != null);
console.log(`\ntrades 命中 ${t.length} 张 净额=${t.reduce((a, b) => a + b.pnl, 0).toFixed(4)} | 正票误伤=${t.filter((b) => b.pnl > 0).length}`);
console.log('期望：5 张全负（거침없이/Xilo/食蟹猴/富个鸟/SI同名）零误伤；SI 0x13cc（A 支 −0.0508）不在 set=外置本地已验证');
