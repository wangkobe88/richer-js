// FP13 burst 弱波对拍（182 跑零 DB）：btv141+btv143 成交集全量重放 → burst_weak_wave
// 命中面 vs 复审联立面 16 票对照（先序臂认领分流）+ 全量 reason 分布
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { buildBuyPointSnapshot } = require_('../../src/market-analysis/buy-point-snapshot.js');
const { evaluateFactorPreBuy } = require_('../../src/market-analysis/factor-pre-buy-check.js');
const { sliceAsOf } = await import('./lib.mjs');

// 复审联立面 16 票（tmp-burst-review v5 JSON 派生全址，勿手敲——手敲地址陷阱）
const LINE_A = new Set([
  '0x0b46c99274a633a0ee7e89f72c288573ac1f7777','0x65aebe91f87b3b8f94e8061f2fa578d7ed857777',
  '0x308406e1dc5e5a40797196dd88a1a75912ec7777','0xcd6830d3af85c0224db0d094eea91e1e71ee7777',
  '0x88225c905ca858a60cd38405fa4457954f747777','0xed38a34638854d20809432a43a616cbba34c7777',
  '0xa3efddca9d8a138ace3548b8f70118a1c4767777','0x650cc91af983b1862e7e0c7096dc3098efed7777',
  '0x3c5965f6e39590d2637b45f9f22b6f731e8e7777','0x2711e159f3e9ff438ff2bb80456d19a6bd827777',
  '0x9295363666be41791f9ac20ad5cba59a69e07777','0xa29fefb9922a761093a316e9f658c0f0ebc07777',
  '0x93d56791dedc296ed1b07b1b1d8392e771e88888','0x8d38a38ed7af002a6681996ef23c08e5acc17777',
  '0x596304179cb0ddfd3e04082b4b29baf8925d8888','0x1454a93f01a66c06f101778c5213c05c208c7777',
]);
const hit16 = (addr) => LINE_A.has(String(addr).toLowerCase());

const out = [];
for (const SET of ['btv141-trades', 'btv143-trades']) {
  const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', `${SET}.json`), 'utf8'));
  for (const p of doc.points) {
    const rows = sliceAsOf(JSON.parse(readFileSync(resolve(HERE, 'sets', `${SET}-ticks`, p.ticksFile), 'utf8')).rows || [], p.anchorTickCount);
    const meta = { ...(doc.tokens[p.tokenAddress] || { address: p.tokenAddress }), quoteToken: p.quoteToken || null };
    const snap = buildBuyPointSnapshot(rows, meta, { anchorTickCount: p.anchorTickCount, capped: p.capped === true, signalInfo: {} });
    const r = evaluateFactorPreBuy(snap);
    const q = snap.buyDerived.burstWaveQuality;
    out.push({ set: SET, pointId: p.pointId, addr: p.tokenAddress, symbol: p.tokenSymbol,
      pass: r.pass, reason: r.reason, lineA: hit16(p.tokenAddress),
      bwq: q, pnl: p.trade?.episode?.pnlBnb ?? null, fwd5: p.forwardReturns?.byHorizon?.['300']?.maxRisePct ?? null });
  }
}
writeFileSync('/tmp/fp13-replay.json', JSON.stringify(out, null, 1));

// 去重跨 set（同 token 取最新 set=v143）
const byTok = new Map();
for (const r of out) if (!byTok.has(r.addr) || r.set === 'btv143-trades') byTok.set(r.addr, r);
const uniq = [...byTok.values()];
const hit = uniq.filter((r) => r.reason === 'burst_weak_wave');
const lineAAll = uniq.filter((r) => r.lineA);
console.log(`重放 ${out.length} 点（去重 ${uniq.length} 票，version=${out[0].version}）→ /tmp/fp13-replay.json`);
console.log(`burst_weak_wave 命中 ${hit.length} 张；复审线A 票 ${lineAAll.length} 张在集内`);
console.log('\n--- 线A 票的 FP13 实判（命中/先序码认领/放行分流）---');
for (const r of lineAAll) {
  console.log(`  ${r.symbol} ${r.addr.slice(0, 10)} pnl=${r.pnl ?? '-'} → ${r.pass ? '放行' : r.reason} | 大户=${r.bwq ? r.bwq.whaleWallets : '-'} 压箱=${r.bwq ? r.bwq.preWaveBuyBnb : '-'}B`);
}
console.log('\n--- burst_weak_wave 命中票（非线A 的额外命中=口径差）---');
for (const r of hit.filter((r) => !r.lineA)) {
  console.log(`  ${r.symbol} ${r.addr.slice(0, 10)} pnl=${r.pnl ?? '-'} | 大户=${r.bwq.whaleWallets} 压箱=${r.bwq.preWaveBuyBnb}B`);
}
const hitPnl = hit.map((r) => r.pnl).filter((x) => x != null);
console.log(`\n命中面 pnl: n=${hitPnl.length} Σ=${hitPnl.reduce((s, x) => s + x, 0).toFixed(4)} 胜=${hitPnl.filter((x) => x > 0).length}`);
