#!/usr/bin/env node
// CD401 生效面查证 v3（182 跑）：对拍命中票取 sets point.signalId——精确对到
// 「成交那条信号」的 metadata.cheatCheck（grade/exempt/sbw）——denied 只在
// 成交信号是豁免放行时改变行为（否则该票根本买不进/或另由非豁免信号买入）。
// 叠加 snapshot 出口段三键 → 每票终判：denied 生效拦截 / 不生效零效果。
import fs from 'node:fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { dbManager } = require('../../src/services/dbManager.js');
const { buildSnapshotFromRows } = require('../../src/market-analysis/cheat-snapshot.js');

const SETS = [
  ['btv109', 'btv109-trades', '029bd863-55e5-4319-91d5-10803a6a9a82'],
  ['btv104', 'btv104-trades', '18db4a3e-b25d-44f3-9fc6-32d3c2f2857b'],
  ['btv103-r2', 'btv103-r2-trades', 'b9e0f341-dbd2-4aca-a027-b22c598733a2'],
];
const ts = (iso) => Date.parse(iso) / 1000;
const c = dbManager.getClient();

let rowsOut = [];
for (const [name, base, exp] of SETS) {
  const set = JSON.parse(fs.readFileSync(`scripts/buy-point/sets/${base}.json`, 'utf8'));
  const targets = new Map(); // signalId -> point
  for (const p of set.points) if (p.signalId) targets.set(p.signalId, p);
  if (!targets.size) continue;
  const sigById = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await c.from('strategy_signals')
      .select('id,token_address,created_at,metadata')
      .eq('experiment_id', exp).order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) if (targets.has(r.id)) sigById.set(r.id, r);
    if (!data || data.length < 1000) break;
  }
  for (const [sid, p] of targets) {
    const sig = sigById.get(sid);
    if (!sig) continue;
    const cc = sig.metadata?.cheatCheck;
    let ticks;
    try { ticks = JSON.parse(fs.readFileSync(`scripts/buy-point/sets/${base}-ticks/${p.tokenAddress}.json`, 'utf8')).rows; } catch { continue; }
    const anchor = p.anchorTimeIso || ticks[ticks.length - 1].block_time;
    const aTs = ts(anchor);
    const pre = ticks.filter((r) => ts(r.block_time) <= aTs);
    const meta = { address: p.tokenAddress, symbol: p.tokenSymbol ?? '?', name: p.tokenSymbol ?? '?', createdAt: ticks[0].block_time, platform: 'fourmeme', totalSupply: 1e9 };
    const d = buildSnapshotFromRows(pre, meta).derived;
    if (d.burstExitSegSellPct == null) continue;
    const hit = d.burstExitSegSellPct >= 30 && d.burstExitSegSellBnb >= 0.3;
    if (!hit) continue;
    const dumpHit = d.nearDumpQualBlocks >= 1 && d.nearDumpMinAbsorbBnb < 0.05;
    const exempt = cc?.exempt?.code ?? null;
    const exemptLive = exempt === 'stall_burst' || (exempt ?? '').startsWith('activity_');
    const deniedCode = !exemptLive ? null : (dumpHit ? 'dump_no_absorption(双中归CD400)' : 'burst_exit_sell_pressure');
    rowsOut.push({
      set: name, pid: p.pointId.slice(3), sym: p.tokenSymbol ?? '-', addr: p.tokenAddress.slice(0, 10),
      pct: d.burstExitSegSellPct, sell: d.burstExitSegSellBnb, buy: d.burstExitSegBuyBnb,
      sigGrade: cc?.grade ?? '无cheatCheck', exempt, sbw: cc?.levels?.stallBurstWave ?? null,
      act: cc?.buckets?.activityLevel ?? null, deniedCode,
      pnl: p.trade?.episode?.pnlBnb ?? null,
    });
  }
}
rowsOut.sort((a, b) => (a.set < b.set ? -1 : 1));
let blockSum = 0, blockN = 0, saveSum = 0, saveN = 0;
for (const r of rowsOut) {
  const live = r.deniedCode === 'burst_exit_sell_pressure';
  console.log(`${r.set} ${r.pid} ${r.sym} ${r.addr} pct=${r.pct}% 卖${r.sell}/买${r.buy} 成交信号:grade=${r.sigGrade} exempt=${r.exempt} sbw=${r.sbw} act=${r.act} → ${r.deniedCode ?? '不生效(豁免不在场)'} pnl=${r.pnl}`);
  if (live && (r.pnl ?? 0) < 0) { saveSum += r.pnl; saveN++; }
  if (live && (r.pnl ?? 0) > 0.001) { blockSum += r.pnl; blockN++; }
}
console.log(`\nCD401 生效拦截: 止损票 ${saveN} 张 Σ=${saveSum.toFixed(4)}（拦截收益）| 误伤票 ${blockN} 张 Σ=${blockSum.toFixed(4)}（机会成本）| 净=${(saveSum + blockSum).toFixed(4)}`);
process.exit(0);
