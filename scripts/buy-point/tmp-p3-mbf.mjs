#!/usr/bin/env node
// P3 线2 复核（本地跑，零 DB）：MBF / 我靠 出口段逐笔明细——用户观察「MBF burst 纯买入无卖」对质
import fs from 'node:fs';

const CASES = [
  ['MBF@btv104', 'scripts/buy-point/sets/btv104-trades', '0xa29fefb9922a761093a316e9f658c0f0ebc07777'],
  ['MBF@btv103-r2', 'scripts/buy-point/sets/btv103-r2-trades', '0xa29fefb9922a761093a316e9f658c0f0ebc07777'],
  ['我靠@btv104', 'scripts/buy-point/sets/btv104-trades', '0xcbfe6b2bceacfab7934c82513f568f4e31a04444'],
];
const ts = (iso) => Date.parse(iso) / 1000;
const hm = (s) => new Date(s * 1000).toISOString().slice(11, 19);

for (const [name, base, addr] of CASES) {
  const set = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
  const p = set.points.find((x) => x.tokenAddress === addr);
  if (!p) { console.log(`${name}: 不在 set`); continue; }
  const rows = JSON.parse(fs.readFileSync(`${base}-ticks/${addr}.json`, 'utf8')).rows;
  const anchor = p.anchorTimeIso || rows[rows.length - 1].block_time;
  const aTs = ts(anchor);
  const pre = rows.filter((r) => ts(r.block_time) <= aTs);
  const segs = [];
  for (let i = 1; i < pre.length; i++) {
    const g = ts(pre[i].block_time) - ts(pre[i - 1].block_time);
    if (g >= 50) segs.push({ gap: Math.round(g), ex: ts(pre[i].block_time) });
  }
  const ex0 = segs.length ? segs[segs.length - 1].ex : null;
  console.log(`\n=== ${name} ${p.pointId} pnl=${p.trade?.episode?.pnlBnb ?? '?'} 锚=${anchor.slice(11, 19)} ===`);
  console.log(`  全部静默段: ${segs.map((s) => `gap${s.gap}s→${hm(s.ex)}`).join(' | ') || '无'}`);
  if (ex0 == null) continue;
  const w = pre.filter((r) => ts(r.block_time) >= ex0);
  for (const r of w) {
    const flags = [r.price_outlier ? 'OUT' : '', r.is_dust ? 'DUST' : ''].filter(Boolean).join(',');
    console.log(`  ${r.block_time.slice(11, 19)} ${String(r.trade_type).padEnd(4)} ${Number(r.bnb_amount).toFixed(4)} w=${String(r.sender_address || r.trader_address || '').slice(0, 10)}${flags ? ' ' + flags : ''}`);
  }
  const buy = w.filter((r) => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
  const sell = w.filter((r) => r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0);
  console.log(`  → 出口整窗(${hm(ex0)}→锚) 买${buy.toFixed(3)} 卖${sell.toFixed(3)} 卖%=${buy + sell > 0 ? ((sell / (buy + sell)) * 100).toFixed(1) : '?'} 跨${Math.round(aTs - ex0)}s`);
  let best = { b: 0 };
  for (let s0 = ex0; s0 < Math.min(ex0 + 55, aTs + 5); s0 += 1) {
    const ww = w.filter((r) => ts(r.block_time) >= s0 && ts(r.block_time) < s0 + 5);
    const b = ww.filter((r) => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
    const s = ww.filter((r) => r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0);
    if (b > best.b) best = { b, s, t0: hm(s0), n: ww.length };
  }
  console.log(`  → burst波(最密5s) ${best.t0} 买${best.b.toFixed(3)} 卖${(best.s || 0).toFixed(3)} ${best.n}行`);
}
