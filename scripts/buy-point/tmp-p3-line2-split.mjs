#!/usr/bin/env node
// P3 线2 口径敏感性（182 跑）：命中票卖压时序分解——波前卖 vs 波中/波后卖
// 用户观察：MBF/我靠 burst 波纯买、卖全在波前（先砸后拉）。分解后看「波后卖」变体还拦谁
import { dbManager } from '../../src/services/dbManager.js';
import fs from 'node:fs';

const SETS = [
  ['btv109', '029bd863-55e5-4319-91d5-10803a6a9a82', 'scripts/buy-point/sets/btv109-trades'],
  ['btv104', '18db4a3e-b25d-44f3-9fc6-32d3c2f2857b', 'scripts/buy-point/sets/btv104-trades'],
  ['btv103-r2', 'b9e0f341-dbd2-4aca-a027-b22c598733a2', 'scripts/buy-point/sets/btv103-r2-trades'],
  ['v73', 'c6efed13-ce9d-41b0-89a5-8ca8b029a609', 'scripts/buy-point/sets/bp-2026-11-05-v73-trades'],
];
const ts = (iso) => Date.parse(iso) / 1000;
const fmt = (v, d = 2) => (v == null ? '?' : Number(v).toFixed(d));
const c = await dbManager.getClient();

for (const [name, exp, base] of SETS) {
  const set = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
  const sigs = []; let from = 0;
  while (true) {
    const { data, error } = await c.from('strategy_signals')
      .select('id,token_address,action,executed,metadata')
      .eq('experiment_id', exp).order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    sigs.push(...data); if (data.length < 1000) break; from += 1000;
  }
  const buySig = new Map();
  for (const s of sigs) {
    if (s.action !== 'buy') continue;
    if (!buySig.has(s.token_address) || s.executed) buySig.set(s.token_address, s);
  }
  for (const p of set.points) {
    const addr = p.tokenAddress;
    let rows;
    try { rows = JSON.parse(fs.readFileSync(`${base}-ticks/${addr}.json`, 'utf8')).rows; } catch { continue; }
    const cc = buySig.get(addr)?.metadata?.cheatCheck;
    if (!cc || cc.levels?.stallBurstWave !== 1) continue;
    const anchor = p.anchorTimeIso || rows[rows.length - 1].block_time;
    const aTs = ts(anchor);
    const pre = rows.filter((r) => ts(r.block_time) <= aTs);
    const segs = [];
    for (let i = 1; i < pre.length; i++) if (ts(pre[i].block_time) - ts(pre[i - 1].block_time) >= 50) segs.push(ts(pre[i].block_time));
    const ex0 = segs.length ? segs[segs.length - 1] : null;
    if (ex0 == null) continue;
    const w = pre.filter((r) => ts(r.block_time) >= ex0);
    const buy = w.filter((r) => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
    const sell = w.filter((r) => r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0);
    const sellPct = buy + sell > 0 ? (sell / (buy + sell)) * 100 : null;
    if (sellPct == null || sellPct < 30 || sell < 0.3) continue; // 只看线2命中票
    // burst 波起点（出口后 60s 内最密 5s 窗）
    let best = { b: 0 };
    for (let s0 = ex0; s0 < Math.min(ex0 + 55, aTs + 5); s0 += 1) {
      const b = w.filter((r) => ts(r.block_time) >= s0 && ts(r.block_time) < s0 + 5 && r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
      if (b > best.b) best = { b, t0: s0 };
    }
    const t0 = best.t0 ?? aTs;
    const preSell = w.filter((r) => ts(r.block_time) < t0 && r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0);
    const postSell = w.filter((r) => ts(r.block_time) >= t0 && r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0);
    // 波中/波后（含波窗本身到锚）买卖
    const postBuy = w.filter((r) => ts(r.block_time) >= t0 && r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
    const postSellPct = postBuy + postSell > 0 ? (postSell / (postBuy + postSell)) * 100 : null;
    const pnl = p.trade?.episode?.pnlBnb ?? null;
    console.log(`${name} ${p.pointId.slice(3)} ${String(p.tokenSymbol ?? '-').slice(0, 8).padEnd(8)} pnl=${fmt(pnl, 4)} ${cc.exempt?.code || '原生'} | 出口窗 买${fmt(buy)} 卖${fmt(sell)} ${fmt(sellPct, 0)}% | 波起点${new Date(t0 * 1000).toISOString().slice(11, 19)}(距锚${Math.round(aTs - t0)}s 波买${fmt(best.b)}) | 波前卖${fmt(preSell)} 波中后卖${fmt(postSell)}(${fmt(postSellPct, 0)}%)`);
  }
}
process.exit(0);
