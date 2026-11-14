// btv109-trades 复审材料合成（182 跑）：run json × set json × signals(cheat grade/生产BP) × trades(买腿/卖臂) → /tmp/btv109-review.json
import { dbManager } from '../../src/services/dbManager.js';
import fs from 'node:fs';

const RUN = process.argv[2] || 'data/bp-run-2026-11-12T23-22-53-137Z.json';
const SET = 'scripts/buy-point/sets/btv109-trades.json';
const EXP = '029bd863-55e5-4319-91d5-10803a6a9a82';

const run = JSON.parse(fs.readFileSync(RUN, 'utf8'));
const set = JSON.parse(fs.readFileSync(SET, 'utf8'));
const byPoint = new Map(run.results.map(r => [r.pointId, r]));

// 0) 先拉 trades（buyTradeId→signal_id 映射 + 卖臂结局）
const c = await dbManager.getClient();
const trades = []; let from = 0;
while (true) {
  const { data, error } = await c.from('trades')
    .select('id,token_address,trade_direction,signal_id,created_at,metadata')
    .eq('experiment_id', EXP).order('id', { ascending: true }).range(from, from + 999);
  if (error) throw new Error('trades: ' + error.message);
  trades.push(...data); if (data.length < 1000) break; from += 1000;
}
const sigIdOfTrade = new Map(trades.map(t => [String(t.id), t.signal_id]));

// 1) signals 按 id 拉（cheat grade / 生产 BP 判定 / 买腿名）——trades 源的 set.signalId=trades 行 id，须走 trades.signal_id；
//    卖臂结局需要卖 trades 的 signal_id 一并拉
const sellSigIds = [...new Set(trades.filter(t => t.trade_direction === 'sell').map(t => t.signal_id).filter(Boolean))];
const sigIds = [...new Set([
  ...set.points.map(p => p.trade?.buyTradeId).map(id => id && sigIdOfTrade.get(String(id))).filter(Boolean),
  ...sellSigIds,
])];
const sigs = [];
for (let i = 0; i < sigIds.length; i += 50) {
  const { data, error } = await c.from('strategy_signals')
    .select('id,token_address,action,executed,metadata')
    .in('id', sigIds.slice(i, i + 50));
  if (error) throw new Error('signals: ' + error.message);
  sigs.push(...data);
}
const sigById = new Map(sigs.map(s => [s.id, s]));

// 2) per-token 买腿/卖臂结局
const perTok = new Map();
for (const t of trades) {
  if (!perTok.has(t.token_address)) perTok.set(t.token_address, { buys: [], sells: [] });
  const m = t.signal_id ? sigById.get(t.signal_id) : null;
  const name = m?.metadata?.strategyName || t.metadata?.strategyName || '?';
  const o = perTok.get(t.token_address);
  if (t.trade_direction === 'buy') o.buys.push(name); else o.sells.push(name);
}

// 3) 合成
const rows = [];
for (const p of set.points) {
  const r = byPoint.get(p.pointId);
  const sigId = p.trade?.buyTradeId ? sigIdOfTrade.get(String(p.trade.buyTradeId)) : null;
  const sig = sigId ? sigById.get(sigId) : null;
  const cc = sig?.metadata?.cheatCheck || null;
  const bpProd = sig?.metadata?.buyPoint || null;
  const tok = perTok.get(p.tokenAddress) || { buys: [], sells: [] };
  const a = r?.anchors || {};
  const d = r?.dimensions || {};
  const fwd = p.forwardReturns?.byHorizon || {};
  rows.push({
    pointId: p.pointId,
    symbol: p.tokenSymbol,
    addr: p.tokenAddress,
    anchor: p.anchorTimeIso,
    thin: p.thin || false,
    ticks: r?.anchorTickCount ?? p.anchorTickCount,
    ageSec: a.tokenAgeSec,
    curVs: a.currentVsLaunchPct,
    chg5: a.chg5Pct, chg10: a.chg10Pct, chg30: a.chg30Pct,
    maxDn5: a.maxDn5Pct,
    dip5: a.recentDip5Pct != null ? `${a.recentDip5Pct}@${a.recentDip5SecAgo}s` : null,
    mcap: a.mcapBnb,
    // BP64 重析
    bucket: r?.assessment?.bucket, rule: r?.assessment?.rule, prob: r?.assessment?.prob,
    exempt: r?.assessment?.exempt || null,
    mp: d.market_pattern?.bucket, mpProb: d.market_pattern?.prob,
    entry: d.entry_shape?.bucket, entryProb: d.entry_shape?.prob,
    act: d.activity_level?.bucket, actProb: d.activity_level?.prob,
    holder: d.holder_concentration?.bucket, holderProb: d.holder_concentration?.prob,
    // 生产（当时过门）
    cheat: cc ? { grade: cc.grade, reasons: cc.reasons || [], exempt: cc.exempt || null, act: cc.levels?.activityLevel ?? cc.activityLevel ?? null } : null,
    bpProd: bpProd ? { status: bpProd.status, bucket: bpProd.assessment?.bucket ?? bpProd.bucket ?? null, rule: bpProd.assessment?.rule ?? bpProd.rule ?? null } : null,
    buyLeg: [...new Set(tok.buys)],
    sellArms: [...new Set(tok.sells)],
    // 结局
    pnl: p.trade?.episode?.pnlBnb,
    fwd1m: fwd['60'] ? { max: fwd['60'].maxRisePct, last: fwd['60'].lastPct } : null,
    fwd5m: fwd['300'] ? { max: fwd['300'].maxRisePct, last: fwd['300'].lastPct } : null,
    fwd15m: fwd['900'] ? { max: fwd['900'].maxRisePct, last: fwd['900'].lastPct } : null,
  });
}
fs.writeFileSync('/tmp/btv109-review.json', JSON.stringify(rows, null, 1));
console.log(`rows=${rows.length} → /tmp/btv109-review.json`);
const poor = rows.filter(x => x.bucket === 'poor').length;
console.log(`重析 poor=${poor} neutral=${rows.length - poor}`);
const prodCheat = new Map();
for (const x of rows) { const k = x.cheat ? `${x.cheat.grade}${x.cheat.exempt ? '+豁免' : ''}` : '无'; prodCheat.set(k, (prodCheat.get(k) || 0) + 1); }
console.log('生产 cheat grade:', JSON.stringify([...prodCheat.entries()]));
process.exit(0);
