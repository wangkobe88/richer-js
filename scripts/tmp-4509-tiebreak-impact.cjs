/**
 * T199c crew 窗平密度 tie-break 修复——影响面扫描（2026-11-20，0x4509 案）
 * 旧=first-found 判更早窗（`n > best.n` 严格大于）；新=平手依次比 窗内买力大者→窗末更晚。
 * 本脚本自带两套逻辑独立副本（不依赖 lib 改动），六窗在跑 burst 买点上对拍：
 * crew 换窗数 / T189 判定翻转 / 翻转案例卖价差与实际 ROI。
 */
require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const { BURST_COOLDOWN_DEFAULTS, evaluateBurstCooldown } = require('../src/trading-engine/core/burst-cooldown-exit.js');

const WINS = [
  { k: 'v140', id: '6e75ed6d-9d5a-48b4-9e72-0b3dfe00c22f' },
  { k: 'v145', id: '2448116a-bebe-457d-9d8a-b4556c9a8e0d' },
  { k: 'v155', id: 'dddbe79e-480a-402a-aa35-85a72d2f591e' },
  { k: 'v156', id: 'b8ae9f2e-832f-42db-bbda-8d8701aecb63' },
  { k: 'v163', id: '7d60bc05-8c4e-4f0d-993c-6f2d02428ea7' },
];
const WAVE_MIN_BNB = 0.29, WAVE_MIN_WALLETS = 2;
const LOOKBACK = 60000, WIN = 5000, GRACE = 5000;
const ms = s => new Date(s).getTime();

function scanBest(rows, tieNew) {
  let best = null;
  for (let i = 0; i < rows.length; i++) {
    let j = i;
    while (j < rows.length && rows[j].ms - rows[i].ms <= WIN) j++;
    const n = j - i;
    if (n === 0) continue;
    let buyBnb = 0;
    for (let k = i; k < j; k++) if (rows[k].side === 'buy' && rows[k].w) buyBnb += rows[k].bnb || 0;
    const endMs = rows[j - 1].ms;
    const better = tieNew
      ? (best === null || n > best.n
        || (n === best.n && (buyBnb > best.buyBnb || (buyBnb === best.buyBnb && endMs > best.endMs))))
      : (best === null || n > best.n);
    if (better) best = { n, i, endIdx: j - 1, buyBnb, endMs };
  }
  return best;
}
function locateCrew(arr, t0Ms, tieNew) {
  const lo = t0Ms - LOOKBACK, hi = t0Ms + GRACE;
  const rows = arr.filter(t => t.ms >= lo && t.ms <= hi);
  if (!rows.length) return null;
  const best = scanBest(rows, tieNew);
  if (!best || !best.n) return null;
  const s = rows[best.i].ms, e = rows[best.endIdx].ms;
  const crewSet = new Set(); let crewBnb = 0;
  for (const t of rows) if (t.ms >= s && t.ms <= e && t.side === 'buy' && t.w) { crewSet.add(t.w); crewBnb += t.bnb || 0; }
  return { crewSet, crewBnb };
}
function viewOf(arr, t0Ms, crewSet, asOfMs) {
  const c1 = 15000, c2 = 30000;
  let w1 = 0, w2 = 0, lastAbs1 = null, lastAbs2 = null;
  for (const t of arr) {
    if (t.side !== 'buy' || t.ms < t0Ms || t.ms > asOfMs) continue;
    if (!t.w || crewSet.has(t.w)) continue;
    if (t.ms < t0Ms + c1) { w1 += t.bnb || 0; if (t.ms > (lastAbs1 || 0)) lastAbs1 = t.ms; }
    else if (t.ms < t0Ms + c2) { w2 += t.bnb || 0; if (t.ms > (lastAbs2 || 0)) lastAbs2 = t.ms; }
  }
  return { t0Ms, w1Bnb: +w1.toFixed(4), w2Bnb: +w2.toFixed(4), w2SoFarBnb: +w2.toFixed(4), lastAbs1Ms: lastAbs1, lastAbs2Ms: lastAbs2 };
}
function simVerdict(arr, t0Ms, crewSet) {
  for (let g = t0Ms + 1000; g <= t0Ms + 60000; g += 1000) {
    const asOf = arr.filter(t => t.ms <= g);
    const v = evaluateBurstCooldown(viewOf(asOf, t0Ms, crewSet, g), g, BURST_COOLDOWN_DEFAULTS);
    if (v && v.action === 'sell') return { batch: v.batch, sellMs: g };
    if (v && v.action === 'release') return { batch: 'release', sellMs: null };
  }
  return { batch: 'none', sellMs: null };
}
async function pageAll(sb, table, eq, sel) {
  const out = []; let from = 0;
  for (;;) {
    let q = sb.from(table).select(sel).order('created_at', { ascending: true }).range(from, from + 999);
    for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
    const { data, error } = await q;
    if (error) throw new Error(JSON.stringify(error));
    if (!data || !data.length) break;
    out.push(...data); from += 1000;
    if (data.length < 1000) break;
  }
  return out;
}
async function main() {
  const sb = dbManager.getClient();
  try {
    const { data: v158 } = await sb.from('experiments').select('id').ilike('experiment_name', 'bt-v158%').limit(1);
    if (v158 && v158[0]) WINS.push({ k: 'v158', id: v158[0].id });
  } catch (e) { /* 可选窗 */ }
  const cases = []; const seen = new Map();
  for (const w of WINS) {
    const sigs = await pageAll(sb, 'strategy_signals', { experiment_id: w.id, signal_type: 'BUY' }, 'id,token_address,created_at,metadata');
    const sigMap = new Map(sigs.map(s => [s.id, s]));
    const trades = await pageAll(sb, 'trades', { experiment_id: w.id }, 'token_address,trade_direction,trade_status,input_amount,output_amount,metadata,signal_id');
    const firstBuy = new Map(); const pnl = new Map();
    for (const t of trades) {
      if (t.trade_status !== 'success') continue;
      const o = pnl.get(t.token_address) || { b: 0, s: 0 };
      if (t.trade_direction === 'buy') o.b += Number(t.input_amount || 0); else o.s += Number(t.output_amount || 0);
      pnl.set(t.token_address, o);
      if (t.trade_direction !== 'buy') continue;
      const vt = (t.metadata && t.metadata.timestamp) || (t.signal_id && sigMap.get(t.signal_id) || {}).created_at;
      if (!vt) continue;
      const cur = firstBuy.get(t.token_address);
      if (!cur || ms(vt) < ms(cur.vt)) firstBuy.set(t.token_address, { vt, sigId: t.signal_id });
    }
    for (const [tok, fb] of firstBuy) {
      const dk = tok + '|' + fb.vt.slice(0, 13);
      if (seen.has(dk)) continue;
      seen.set(dk, 1);
      const sig = fb.sigId ? sigMap.get(fb.sigId) : null;
      const md = (sig && sig.metadata) || {};
      const sbwMeta = (md.actFrontGate && md.actFrontGate.sbw) || '';
      cases.push({ win: w.k, tok, t0Ms: ms(fb.vt), t0S: fb.vt, sbwMeta, pnl: pnl.get(tok) || { b: 0, s: 0 } });
    }
  }
  console.log(`成交买点: ${cases.length}`);
  let armed = 0, crewChanged = 0, verdictChanged = 0, joined = 0, left = 0;
  const flips = [];
  for (const c of cases) {
    const { data: ticks, error } = await sb.from('wss_price_ticks')
      .select('block_time,bnb_amount,price_bnb,trade_type,sender_address,trader_address')
      .eq('token_address', c.tok)
      .gte('block_time', new Date(c.t0Ms - 1800e3).toISOString())
      .lte('block_time', new Date(c.t0Ms + 960e3).toISOString())
      .order('block_time', { ascending: true }).limit(3000);
    if (error || !ticks || ticks.length < 3) continue;
    const arr = ticks.map(t => ({
      ms: ms(t.block_time), bnb: Number(t.bnb_amount), side: t.trade_type === 'sell' ? 'sell' : 'buy',
      p: Number(t.price_bnb), w: ((t.sender_address || t.trader_address) || '').toLowerCase(),
    }));
    const co = locateCrew(arr, c.t0Ms, false), cn = locateCrew(arr, c.t0Ms, true);
    const qo = co && co.crewBnb >= WAVE_MIN_BNB && co.crewSet.size >= WAVE_MIN_WALLETS;
    const qn = cn && cn.crewBnb >= WAVE_MIN_BNB && cn.crewSet.size >= WAVE_MIN_WALLETS;
    if (!qo && !qn) continue;
    armed++;
    if (qo && !qn) left++;
    if (!qo && qn) joined++;
    const changed = co && cn && (co.crewBnb !== cn.crewBnb || co.crewSet.size !== cn.crewSet.size);
    if (!changed) continue;
    crewChanged++;
    const vo = simVerdict(arr, c.t0Ms, co.crewSet);
    const vn = simVerdict(arr, c.t0Ms, cn.crewSet);
    if (vo.batch === vn.batch) continue;
    verdictChanged++;
    const rel = arr.filter(t => t.p > 0);
    const pxAt = m => { const r = rel.filter(t => t.ms <= m).slice(-1)[0]; return r ? r.p : null; };
    flips.push({
      win: c.win, tok: c.tok.slice(0, 10), t0: c.t0S.slice(11, 19), sbw: c.sbwMeta || '-',
      crewOld: `${co.crewSet.size}户/${co.crewBnb.toFixed(2)}B`, crewNew: `${cn.crewSet.size}户/${cn.crewBnb.toFixed(2)}B`,
      old: vo.batch + (vo.sellMs ? `@${Math.round((vo.sellMs - c.t0Ms) / 1000)}s` : ''),
      new: vn.batch + (vn.sellMs ? `@${Math.round((vn.sellMs - c.t0Ms) / 1000)}s` : ''),
      pxDelta: (vo.sellMs && vn.sellMs && pxAt(vo.sellMs) && pxAt(vn.sellMs))
        ? `${((pxAt(vn.sellMs) / pxAt(vo.sellMs) - 1) * 100).toFixed(1)}%` : '-',
      realRoi: c.pnl.b > 0 ? `${((c.pnl.s / c.pnl.b - 1) * 100).toFixed(1)}%` : '-',
    });
  }
  console.log(`armed（旧或新过机械门）: ${armed} | 旧过新不过=${left} 新过旧不过=${joined} | crew 换窗=${crewChanged} | 判定翻转=${verdictChanged}\n`);
  for (const f of flips) {
    console.log(`${f.win} ${f.tok} t0=${f.t0} sbw=${f.sbw} | crew ${f.crewOld} → ${f.crewNew} | ${f.old} → ${f.new} | 卖价差=${f.pxDelta} | 实际=${f.realRoi}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
