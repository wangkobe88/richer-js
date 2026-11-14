#!/usr/bin/env node
// P3 探针2（182 跑，只读）：剩余靶面 4 票（T100/T036/T082/T045）+ T089（activity_high 一揽子族）
// 生产全通道码 + routerEntryBuyPct（G17 N 源锚）+ CD400 六键 → 验证「N 不享豁免」方案可行性
import { dbManager } from '../../src/services/dbManager.js';
import fs from 'node:fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { buildSnapshotFromRows } = require('../../src/market-analysis/cheat-snapshot.js');

const EXP = '029bd863-55e5-4319-91d5-10803a6a9a82';
const TICKS = 'scripts/buy-point/sets/btv109-trades-ticks';
const SET = 'scripts/buy-point/sets/btv109-trades.json';
const WANT = ['T100', 'T036', 'T082', 'T045', 'T089', 'T054', 'T014', 'T041', 'T093', 'T064', 'T065'];

const set = JSON.parse(fs.readFileSync(SET, 'utf8'));
const c = await dbManager.getClient();
const sigs = []; let from = 0;
while (true) {
  const { data, error } = await c.from('strategy_signals')
    .select('id,token_address,action,executed,reason,metadata,created_at')
    .eq('experiment_id', EXP).order('id', { ascending: true }).range(from, from + 999);
  if (error) throw new Error(error.message);
  sigs.push(...data); if (data.length < 1000) break; from += 1000;
}
const buySig = new Map();
for (const s of sigs) {
  if (s.action !== 'buy') continue;
  if (!buySig.has(s.token_address) || s.executed) buySig.set(s.token_address, s);
}
const ts = (iso) => Date.parse(iso) / 1000;
const fmt = (v, d = 2) => (v == null ? '?' : Number(v).toFixed(d));

for (const p of set.points) {
  const pid = p.pointId.slice(3);
  if (!WANT.includes(pid)) continue;
  const addr = p.tokenAddress;
  let rows;
  try { rows = JSON.parse(fs.readFileSync(`${TICKS}/${addr}.json`, 'utf8')).rows; } catch { continue; }
  const sig = buySig.get(addr);
  const cc = sig?.metadata?.cheatCheck || {};
  const anchor = p.anchorTimeIso || rows[rows.length - 1].block_time;
  const aTs = ts(anchor);
  const pre = rows.filter((r) => ts(r.block_time) <= aTs);
  const meta = { address: addr, symbol: p.tokenSymbol ?? '?', name: p.tokenSymbol ?? '?', createdAt: rows[0].block_time, platform: 'fourmeme', totalSupply: 1e9 };
  let d = {};
  try { d = buildSnapshotFromRows(pre, meta).derived; } catch {}
  const cd400 = d.nearDumpQualBlocks != null && d.nearDumpQualBlocks >= 1 && d.nearDumpMinAbsorbBnb != null && d.nearDumpMinAbsorbBnb < 0.05;
  const reasons = (cc.reasons || []).map((x) => x.code).join(',');
  const ex = cc.exempt?.code || '原生';
  const orig = cc.exempt?.originalGrade || cc.grade;
  console.log(`${pid} ${String(p.tokenSymbol).slice(0, 8)} orig=${orig} ex=${ex} act=${cc.levels?.activityLevel} sbw=${cc.levels?.stallBurstWave}`);
  console.log(`   reasons=[${reasons}]`);
  console.log(`   routerEntry=${fmt(cc.anchors?.routerEntryBuyPct)}% burstWaveNet=${fmt(cc.anchors?.burstWaveWalletNetBnb, 3)} burstExitBuy=${fmt(cc.anchors?.burstExitWaveBuyBnb, 3)} CD400=${cd400 ? `HIT(qual=${d.nearDumpQualBlocks} minAbs=${fmt(d.nearDumpMinAbsorbBnb, 3)})` : `-(qual=${d.nearDumpQualBlocks} minAbs=${fmt(d.nearDumpMinAbsorbBnb, 3)})`} pnl=${fmt(p.trade?.episode?.pnlBnb, 4)}`);
}
process.exit(0);
