#!/usr/bin/env node
// P3 四基底验证（182 跑，只读）：sbw=1 票谱系 + 两根拟立法线预演
// 线1「出口波 ≥0.4 ∧ 出口整窗跨度 ≤10s」（组织拉起进行时贴锚）
// 线2「出口整窗卖占比 ≥30% ∧ 卖额 ≥0.3」（卖驱动出口）
// 验收：真burst亏票拦住几个、赢家误伤几个——四基底方向一致才可立法
import { dbManager } from '../../src/services/dbManager.js';
import fs from 'node:fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { buildSnapshotFromRows } = require('../../src/market-analysis/cheat-snapshot.js');

const SETS = [
  ['btv109', '029bd863-55e5-4319-91d5-10803a6a9a82', 'scripts/buy-point/sets/btv109-trades'],
  ['btv104', '18db4a3e-b25d-44f3-9fc6-32d3c2f2857b', 'scripts/buy-point/sets/btv104-trades'],
  ['btv103-r2', 'b9e0f341-dbd2-4aca-a027-b22c598733a2', 'scripts/buy-point/sets/btv103-r2-trades'],
  ['v73', 'c6efed13-ce9d-41b0-89a5-8ca8b029a609', 'scripts/buy-point/sets/bp-2026-11-05-v73-trades'],
];
const ts = (iso) => Date.parse(iso) / 1000;
const fmt = (v, d = 2) => (v == null ? '?' : Number(v).toFixed(d));
const c = await dbManager.getClient();

const all = [];
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
  let nSbw = 0, nNoMeta = 0;
  for (const p of set.points) {
    const addr = p.tokenAddress;
    let rows;
    try { rows = JSON.parse(fs.readFileSync(`${base}-ticks/${addr}.json`, 'utf8')).rows; } catch { continue; }
    const sig = buySig.get(addr);
    const cc = sig?.metadata?.cheatCheck;
    if (!cc) { nNoMeta++; continue; }
    if (cc.levels?.stallBurstWave !== 1) continue;
    nSbw++;
    const anchor = p.anchorTimeIso || rows[rows.length - 1].block_time;
    const aTs = ts(anchor);
    const pre = rows.filter((r) => ts(r.block_time) <= aTs);
    // CD400
    const meta = { address: addr, symbol: p.tokenSymbol ?? '?', name: p.tokenSymbol ?? '?', createdAt: rows[0].block_time, platform: p.platform || 'fourmeme', totalSupply: 1e9 };
    let d = {};
    try { d = buildSnapshotFromRows(pre, meta).derived; } catch {}
    const cd400 = d.nearDumpQualBlocks != null && d.nearDumpQualBlocks >= 1 && d.nearDumpMinAbsorbBnb != null && d.nearDumpMinAbsorbBnb < 0.05;
    // 出口段
    const segs = [];
    for (let i = 1; i < pre.length; i++) if (ts(pre[i].block_time) - ts(pre[i - 1].block_time) >= 50) segs.push(ts(pre[i].block_time));
    const ex0 = segs.length ? segs[segs.length - 1] : null;
    let exitWave = 0, exitWin = null;
    if (ex0 != null) {
      const w = pre.filter((r) => ts(r.block_time) >= ex0);
      const buy = w.filter((r) => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
      const sell = w.filter((r) => r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0);
      exitWin = { buy, sell, net: buy - sell, sellPct: buy + sell > 0 ? (sell / (buy + sell)) * 100 : null, span: aTs - ex0 };
      for (let s0 = ex0; s0 < Math.min(ex0 + 55, aTs + 5); s0 += 1) {
        const b = w.filter((r) => ts(r.block_time) >= s0 && ts(r.block_time) < s0 + 5 && r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
        if (b > exitWave) exitWave = b;
      }
    }
    const anchorBurst = cc.anchors?.burstWaveBuyBnb ?? null;
    const pnl = p.trade?.episode?.pnlBnb ?? null;
    const line1 = exitWin != null && exitWave >= 0.4 && exitWin.span <= 10;
    const line2 = exitWin != null && exitWin.sellPct != null && exitWin.sellPct >= 30 && exitWin.sell >= 0.3;
    all.push({ set: name, pid: p.pointId.slice(3), sym: String(p.tokenSymbol ?? '-').slice(0, 8), pnl, ex: cc.exempt?.code || '原生', orig: cc.exempt?.originalGrade || cc.grade, anchorBurst, exitWave, ratio: anchorBurst && exitWave > 0 ? +(exitWave / anchorBurst).toFixed(2) : (exitWave === 0 ? 0 : null), cd400, line1, line2, sellPct: exitWin?.sellPct, sellAmt: exitWin?.sell, span: exitWin?.span });
  }
  console.log(`${name}: sbw=1 ${nSbw} 票（无cheatCheck meta ${nNoMeta} 点位跳过）`);
}
// 汇总表
const sum = (l) => l.reduce((a, x) => a + (x.pnl || 0), 0);
console.log('\n── sbw=1 全票谱系（四基底合并，按 ratio 降序）──');
console.log('基底      pid    sym      pnl      豁免          orig      全窗锚  出口波  ratio CD400 线1 线2 卖%   卖额   跨s');
for (const r of all.sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1))) {
  console.log(`${r.set.padEnd(9)} ${r.pid.padEnd(6)} ${r.sym.padEnd(8)} ${(r.pnl == null ? '?' : r.pnl.toFixed(4)).padStart(8)} ${r.ex.padEnd(12)} ${String(r.orig).padEnd(8)} ${String(r.anchorBurst).padEnd(6)} ${fmt(r.exitWave, 3).padStart(6)} ${String(r.ratio ?? '-').padStart(5)} ${r.cd400 ? 'HIT ' : '-   '} ${r.line1 ? '●' : ' '}   ${r.line2 ? '●' : ' '}   ${fmt(r.sellPct, 0).padStart(4)} ${fmt(r.sellAmt).padStart(6)} ${String(r.span == null ? '-' : Math.round(r.span)).padStart(5)}`);
}
for (const [nm, f] of [['线1 出口波≥0.4∧跨≤10s', (x) => x.line1], ['线2 卖%≥30∧卖额≥0.3', (x) => x.line2], ['CD400 已接', (x) => x.cd400]]) {
  const hits = all.filter(f);
  const win = hits.filter((x) => (x.pnl ?? 0) > 0.001), lose = hits.filter((x) => (x.pnl ?? 0) < -0.001);
  console.log(`\n[${nm}] ${hits.length}票 净=${fmt(sum(hits))}（拦亏 ${lose.length}票 ${fmt(sum(lose))} / 误伤盈 ${win.length}票 ${fmt(sum(win))}）`);
  for (const x of hits) console.log(`   ${x.set} ${x.pid} ${x.sym} pnl=${fmt(x.pnl, 4)} ${x.ex} ratio=${x.ratio} 卖%=${fmt(x.sellPct, 0)} 卖额=${fmt(x.sellAmt)}`);
}
// 分基底线1线2净效应
console.log('\n── 分基底净效应 ──');
for (const [name] of SETS) {
  const sub = all.filter((x) => x.set === name);
  const l1 = sub.filter((x) => x.line1), l2 = sub.filter((x) => x.line2 && !x.line1);
  console.log(`${name}: sbw=${sub.length} 线1净=${fmt(sum(l1))}(${l1.length}票) 线2净=${fmt(sum(l2))}(${l2.length}票) CD400=${sub.filter((x) => x.cd400).length}票`);
}
process.exit(0);
