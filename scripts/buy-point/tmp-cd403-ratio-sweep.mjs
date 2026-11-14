// CD403 候选：dump 承接比不豁免臂（ratio = MinAbsorb/WorstSell < 0.3）成本/收益扫描 v2（182 跑）
// set 驱动：btv* trades sets 的成交点位（自带 episode pnl）→ 买信号 metadata（exempt/levels/anchors）
// → nearDump 六键（metadata 优先，缺席则 per-token ticks as-of 信号锚重算）→ CD400/CD403 分带量成本
import fs from 'node:fs';
import { dbManager } from '../../src/services/dbManager.js';
import { AGGREGATOR_ROUTER_ADDRS } from '../../src/trading-engine/pre-check/aggregator-routers.js';

const SETS = ['btv103-r2-trades', 'btv104-trades', 'btv109-trades', 'btv111-trades'];
const c = await dbManager.getClient();
const ROUTERS = AGGREGATOR_ROUTER_ADDRS;
const ts = (iso) => Date.parse(iso) / 1000;

const points = [];
for (const name of SETS) {
  const set = JSON.parse(fs.readFileSync(`scripts/buy-point/sets/${name}.json`, 'utf8'));
  for (const p of set.points) points.push({ set: name, ...p });
}
console.log('点位共', points.length);

// 1) trades → signal_id 映射（per experiment 分页）
const expIds = [...new Set(points.map(p => p.experimentId))];
const sigIdOfTrade = new Map();
for (const eid of expIds) {
  let from = 0;
  while (true) {
    const { data, error } = await c.from('trades')
      .select('id,signal_id').eq('experiment_id', eid).order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error('trades: ' + error.message);
    for (const t of data) sigIdOfTrade.set(String(t.id), t.signal_id);
    if (data.length < 1000) break; from += 1000;
  }
}

// 2) 买信号 metadata（含 created_at 当锚）
const sigIds = [...new Set(points.map(p => p.trade?.buyTradeId).map(id => id && sigIdOfTrade.get(String(id))).filter(Boolean))];
const sigs = new Map();
for (let i = 0; i < sigIds.length; i += 50) {
  const { data, error } = await c.from('strategy_signals')
    .select('id,created_at,metadata').in('id', sigIds.slice(i, i + 50));
  if (error) throw new Error('signals: ' + error.message);
  for (const s of data) sigs.set(s.id, s);
}

// 3) nearDump：metadata 优先；缺席则 per-token ticks as-of 重算（CD400 同款块聚合）
async function recomputeNearDump(token, anchorIso) {
  const { data, error } = await c.from('wss_price_ticks')
    .select('block_time,block_number,trade_type,bnb_amount,trader_address,sender_address')
    .eq('token_address', token).lte('block_time', anchorIso)
    .order('id', { ascending: false }).limit(3000);
  if (error) throw new Error('ticks: ' + error.message);
  const ticks = (data || []).reverse().map(r => ({
    dt: ts(r.block_time), block: r.block_number, side: r.trade_type, bnb: r.bnb_amount || 0,
    w: ((r.sender_address || r.trader_address || '')).toLowerCase(),
  }));
  if (!ticks.length) return null;
  const anchorDt = ticks[ticks.length - 1].dt;
  const agg = new Map();
  for (const t of ticks) {
    if (t.block == null || !t.w || ROUTERS.has(t.w)) continue;
    let b = agg.get(t.block);
    if (!b) { b = { sellBnb: 0, buyBnb: 0, sellers: new Set(), lastDt: null }; agg.set(t.block, b); }
    if (t.side === 'buy') b.buyBnb += t.bnb;
    else { b.sellBnb += t.bnb; b.sellers.add(t.w); }
    if (b.lastDt === null || t.dt > b.lastDt) b.lastDt = t.dt;
  }
  const bl = [...agg.entries()].map(([block, b]) => ({ block, ...b })).sort((a, b) => a.block - b.block);
  const suffix = new Array(bl.length + 1).fill(0);
  for (let i = bl.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + bl[i].buyBnb;
  let qualN = 0, worst = null;
  for (let i = 0; i < bl.length; i++) {
    const b = bl[i];
    if (b.sellers.size < 4 || b.sellBnb < 0.5) continue;
    if (b.lastDt === null || anchorDt - b.lastDt > 60) continue;
    qualN++;
    const absorb = +suffix[i + 1].toFixed(4);
    if (!worst || absorb < worst.absorb) worst = { ...b, absorb };
  }
  if (!qualN || !worst) return { qualBlocks: 0 };
  return { qualBlocks: qualN, absorb: worst.absorb, worstSellBnb: +worst.sellBnb.toFixed(4), sellers: worst.sellers.size, sec: anchorDt - worst.lastDt };
}

const out = [];
for (const p of points) {
  const buyId = p.trade?.buyTradeId;
  const sigId = buyId ? sigIdOfTrade.get(String(buyId)) : null;
  const sig = sigId ? sigs.get(sigId) : null;
  const cc = sig?.metadata?.cheatCheck;
  if (!cc) continue; // 无 cheat 段=门未启用/未评，非本臂面
  const pnl = p.trade?.episode?.pnlBnb ?? null;
  const an = cc.anchors || {};
  let nd = null;
  if (typeof an.nearDumpQualBlocks === 'number') {
    nd = { qualBlocks: an.nearDumpQualBlocks, absorb: an.nearDumpMinAbsorbBnb, worstSellBnb: an.nearDumpWorstSellBnb, sellers: an.nearDumpWorstSellers, sec: an.nearDumpWorstSecToAnchor, src: 'meta' };
  } else {
    nd = { ...(await recomputeNearDump(p.tokenAddress, sig.created_at)), src: 'recompute' };
  }
  if (!nd || !nd.qualBlocks || nd.qualBlocks < 1 || typeof nd.absorb !== 'number' || !(nd.worstSellBnb > 0)) continue;
  const ratio = nd.absorb / nd.worstSellBnb;
  out.push({
    set: p.set.slice(0, 9), token: p.tokenAddress.slice(0, 10), sym: p.tokenSymbol ?? '?',
    exempt: cc.exempt?.code ?? null, orig: cc.exempt?.originalGrade ?? null, grade: cc.grade ?? null,
    src: nd.src, qual: nd.qualBlocks, absorb: nd.absorb, worst: nd.worstSellBnb, sellers: nd.sellers ?? '?', sec: nd.sec ?? '?',
    ratio: +ratio.toFixed(3), pnl,
    band: nd.absorb < 0.05 ? 'A_cd400' : (ratio < 0.3 ? 'B_cd403新拦' : 'C_放行'),
  });
}

for (const band of ['A_cd400', 'B_cd403新拦', 'C_放行']) {
  const rs = out.filter(r => r.band === band);
  const ex = rs.filter(r => r.exempt);
  const pnlSum = +rs.reduce((s, r) => s + (r.pnl ?? 0), 0).toFixed(4);
  const exPnl = +ex.reduce((s, r) => s + (r.pnl ?? 0), 0).toFixed(4);
  console.log(`\n=== ${band}: ${rs.length} 点 / 其中靠豁免买入 ${ex.length} / pnlΣ ${pnlSum} / 豁免票 pnlΣ ${exPnl}`);
  for (const r of rs.sort((a, b) => (a.pnl ?? 0) - (b.pnl ?? 0))) console.log(JSON.stringify(r));
}
