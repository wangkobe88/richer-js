#!/usr/bin/env node
// tmp：top2 紧邻买入形状研究（2026-11-02 用户点题 CD122：「大户持仓太多了，因为我们
// 似乎只考虑了 top1……如果 top2 跟 top1 紧邻买的，更危险」）。I 通道（G4）现只看
// top1HoldSupplyPct≥40；本研究看锚窗内 top1/top2 净持仓（token 数域 ÷ totalSupply）与
// 两者首买时间差/同块/同交易的关系，128 票全量分布（零 Jev，182 跑），供是否立项
// G7/top2 通道定线。与 tmp-flow-exempt-precond 同骨架。
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);

function sb() {
  const { dbManager } = require_('../../src/services/dbManager.js');
  return dbManager.getClient();
}
const TICK_COLS = 'block_number,log_index,trade_type,bnb_amount,trader_address,sender_address,token_amount,block_time,tx_hash';
async function pullTicksToAnchor(token, n) {
  const { data, error } = await sb().from('wss_price_ticks').select(TICK_COLS)
    .eq('token_address', token).order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(n);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length < n) throw new Error(`锚截窗不足：锚=${n} 实际=${rows.length}`);
  return rows;
}
async function loadMeta(token) {
  const { data } = await sb().from('wss_events').select('payload,platform')
    .eq('token_address', token).eq('kind', 'token_create')
    .order('id', { ascending: true }).limit(5);
  const hit = (data ?? []).find((r) => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
  const p = hit ? hit.payload : {};
  // 与 run.mjs loadTokenMeta 同口径：flap/gang=平台恒 1e9；four.meme=payload 真值
  const ts = Number(p.totalSupply) > 0 ? Number(p.totalSupply)
    : (hit && (hit.platform === 'flap' || hit.platform === 'gang')) ? 1e9 : null;
  return { createdAt: p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : null, totalSupply: ts };
}

// 锚窗钱包聚合：netTok + 首买行（block/tx/时间）
function walletAgg(rows, createdAtMs) {
  const map = new Map();
  for (const r of rows) {
    const w = (r.sender_address || r.trader_address || '').toLowerCase();
    if (!w) continue;
    const isBuy = String(r.trade_type || '').toUpperCase() === 'BUY';
    const tok = Number(r.token_amount) || 0;
    let e = map.get(w);
    if (!e) { e = { w, buyTok: 0, sellTok: 0, buyBnb: 0, firstBuy: null }; map.set(w, e); }
    if (isBuy) {
      e.buyTok += tok; e.buyBnb += Number(r.bnb_amount) || 0;
      if (!e.firstBuy) e.firstBuy = { block: r.block_number, tx: r.tx_hash, t: new Date(r.block_time).getTime() };
    } else e.sellTok += tok;
  }
  const pos = [...map.values()].map((e) => ({ ...e, netTok: e.buyTok - e.sellTok })).filter((e) => e.netTok > 0);
  pos.sort((a, b) => b.netTok - a.netTok);
  return pos;
}

const fxDoc = JSON.parse(readFileSync(resolve(HERE, 'fixtures.json'), 'utf8'));
const { loadAndValidateFixtures } = await import('./lib.mjs');
const { cases, errors } = loadAndValidateFixtures(fxDoc);
if (errors.length) { console.error(errors.join('\n')); process.exit(2); }

const out = [];
for (const c of cases) {
  try {
    const rows = await pullTicksToAnchor(c.addr.toLowerCase(), c.anchor.tickCount);
    const meta = await loadMeta(c.addr.toLowerCase());
    const pos = walletAgg(rows);
    const sumPos = pos.reduce((s, e) => s + e.netTok, 0);
    const t1 = pos[0] || null, t2 = pos[1] || null;
    const sup = (e) => (meta.totalSupply && e ? +(e.netTok / meta.totalSupply * 100).toFixed(1) : null);
    const circ = (e) => (sumPos > 0 && e ? +(e.netTok / sumPos * 100).toFixed(1) : null);
    let dSec = null, sameBlock = null, sameTx = null;
    if (t1 && t2 && t1.firstBuy && t2.firstBuy) {
      dSec = +((t1.firstBuy.t - t2.firstBuy.t) / 1000).toFixed(1);
      sameBlock = t1.firstBuy.block === t2.firstBuy.block;
      sameTx = t1.firstBuy.tx === t2.firstBuy.tx;
    }
    const expectV = c.expect && typeof c.expect === 'object' ? c.expect.verdict : c.expect;
    out.push({
      id: c.caseId, expect: expectV,
      t1s: sup(t1), t2s: sup(t2), sum2: (sup(t1) !== null && sup(t2) !== null) ? +(sup(t1) + sup(t2)).toFixed(1) : null,
      t1c: circ(t1), t2c: circ(t2), dSec, sameBlock, sameTx,
      supply: meta.totalSupply,
      _t1: t1, _t2: t2,
    });
  } catch (err) { out.push({ id: c.caseId, err: String(err.message || err) }); }
}

const f2 = (v) => (v === null || v === undefined ? '  —' : String(v).padStart(6));
console.log('caseId 人工    top1供% top2供% 合计供% top1流% top2流%  Δ首买秒 同块 同tx');
for (const o of out) {
  if (o.err) { console.log(o.id.padEnd(6), 'ERR:', o.err); continue; }
  console.log(o.id.padEnd(6), String(o.expect).padEnd(8), f2(o.t1s), f2(o.t2s), f2(o.sum2), f2(o.t1c), f2(o.t2c),
    ' ', f2(o.dSec), '  ', o.sameBlock ? 'Y' : '.', '  ', o.sameTx ? 'Y' : '.');
}

// 分布段
const ok = out.filter((o) => !o.err);
console.log(`\n有效 ${ok.length} 票（supply 缺失票供应口径为 —）`);
console.log('\n带A I 通道现覆盖（top1供≥40）:');
for (const o of ok.filter((o) => (o.t1s ?? 0) >= 40)) console.log(`  ${o.id}: top1供=${o.t1s} top2供=${o.t2s} Δ=${o.dSec}s 同块=${o.sameBlock} 人工=${o.expect}`);
console.log('\n带B 用户点名疑似遗漏（top1供<40 ∧ 合计供≥40）:');
for (const o of ok.filter((o) => (o.t1s ?? 0) < 40 && (o.sum2 ?? 0) >= 40)) console.log(`  ${o.id}: top1供=${o.t1s} top2供=${o.t2s} 合计=${o.sum2} Δ=${o.dSec}s 同块=${o.sameBlock} 同tx=${o.sameTx} 人工=${o.expect}`);
console.log('\n带C G4 定线 25-30 混杂带（top1供∈[25,30)）:');
for (const o of ok.filter((o) => (o.t1s ?? 0) >= 25 && (o.t1s ?? 0) < 30)) console.log(`  ${o.id}: top1供=${o.t1s} top2供=${o.t2s} 合计=${o.sum2} Δ=${o.dSec}s 同块=${o.sameBlock} 人工=${o.expect}`);
console.log('\n带D top2 大户票（top2供≥15）按 Δ 升序:');
for (const o of ok.filter((o) => (o.t2s ?? 0) >= 15).sort((a, b) => (a.dSec ?? 1e9) - (b.dSec ?? 1e9)))
  console.log(`  ${o.id}: top2供=${o.t2s} top1供=${o.t1s} Δ=${o.dSec}s 同块=${o.sameBlock} 同tx=${o.sameTx} 人工=${o.expect}`);
console.log('\nΔ首买分布（top2供≥10 的票）: Δ≤3s / ≤10s / ≤60s / >60s =',
  ok.filter((o) => (o.t2s ?? 0) >= 10 && o.dSec !== null && o.dSec <= 3).length, '/',
  ok.filter((o) => (o.t2s ?? 0) >= 10 && o.dSec !== null && o.dSec <= 10).length, '/',
  ok.filter((o) => (o.t2s ?? 0) >= 10 && o.dSec !== null && o.dSec <= 60).length, '/',
  ok.filter((o) => (o.t2s ?? 0) >= 10 && o.dSec !== null && o.dSec > 60).length);

const cd122 = out.find((o) => o.id === 'CD122');
if (cd122 && !cd122.err) {
  console.log('\nCD122 详单（0xdaf3dfdf3c6e84a725cda2a1c8d59df24ef97777）:');
  for (const [k, e] of [['top1', cd122._t1], ['top2', cd122._t2], ['top3', undefined]]) {
    if (!e) break;
    console.log(`  ${k}: ${e.w} 净持=${(e.netTok / 1e6).toFixed(2)}M 买${e.buyN ?? ''}Σ${e.buyBnb.toFixed(4)}BNB 首买=${e.firstBuy ? new Date(e.firstBuy.t).toISOString() : '—'} block=${e.firstBuy?.block} tx=${e.firstBuy?.tx?.slice(0, 12)}`);
  }
}
