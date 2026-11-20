// C3 大户口径对拍：A=top5 持仓者（现行） vs B=top5∪famous∪smartmoney vs C=名单单独
// 182 跑：node scripts/tmp-7ae8-famous-merge.cjs
require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');

const EXPS = [
  ['w1019', '7ae8e398-c875-454a-942b-bc1accfacd53'],
  ['w1012', '8ebaccce-62c6-4209-a2a0-40f361c49bf9'],
  ['w1103', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
];
const ROUTERS = new Set(['0x1de460c4be5e61988aa0ab4e2d9b62e159690b2f', '0x4ed099c3e1710e5b9f0a4b9a0f9c8d3e2f1a0b9c']); // 主路由占位，下面从代码读真名单
// 从 aggregator-routers 读真名单
try {
  const { AGGREGATOR_ROUTER_ADDRS } = require('../src/trading-engine/pre-check/aggregator-routers');
  ROUTERS.clear();
  for (const a of AGGREGATOR_ROUTER_ADDRS) ROUTERS.add(a.toLowerCase());
} catch (e) { console.warn('router 名单加载失败，用占位'); }

// famous roster
const famousSet = new Set();
try {
  const arr = JSON.parse(fs.readFileSync('config/rosters/famous-copy-wallets.json', 'utf8'));
  for (const w of (Array.isArray(arr) ? arr : arr.wallets || [])) famousSet.add(String(w.address || w).toLowerCase());
} catch (e) { console.warn('famous roster 缺失:', e.message); }
// smartmoney
const smSet = new Set();
try {
  const j = JSON.parse(fs.readFileSync('data/kol-study/smartmoney-accum.json', 'utf8'));
  for (const w of (j.sources?.smartmoney || [])) smSet.add(String(w).toLowerCase());
} catch (e) { console.warn('smartmoney 名单缺失:', e.message); }
console.log(`名单: routers=${ROUTERS.size} famous=${famousSet.size} smartmoney=${smSet.size}`);

async function load(expId) {
  const sb = dbManager.getClient();
  const { data: trades } = await sb.from('trades')
    .select('token_address,token_symbol,trade_direction,input_amount,output_amount,signal_id,created_at')
    .eq('experiment_id', expId).order('created_at', { ascending: true }).limit(500);
  const byToken = new Map();
  for (const t of trades) {
    const k = t.token_address;
    if (!byToken.has(k)) byToken.set(k, { symbol: t.token_symbol, cost: 0, got: 0, buySigId: null, buyAt: null });
    const e = byToken.get(k);
    if (t.trade_direction === 'buy') { e.cost += Number(t.input_amount || 0); e.buySigId = t.signal_id; e.buyAt = t.created_at; }
    else e.got += Number(t.output_amount || 0);
  }
  const tokens = [...byToken.entries()].map(([addr, v]) => ({ addr, symbol: v.symbol, cost: v.cost, got: v.got, pnl: v.got - v.cost, buySigId: v.buySigId, buyAt: v.buyAt }));
  const ids = tokens.map(t => t.buySigId).filter(Boolean);
  const metaById = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const { data } = await sb.from('strategy_signals').select('id,metadata').in('id', ids.slice(i, i + 50));
    for (const r of data || []) metaById.set(r.id, r.metadata || {});
  }
  return tokens.map(t => {
    const m = metaById.get(t.buySigId) || {};
    return { ...t, A: (m.buyPoint || {}).anchors || {} };
  });
}

(async () => {
  const sb = dbManager.getClient();
  const num = (s, k) => Number(s.A[k]);
  // C3 判据工厂：不同卖出口径
  const evalToken = async (s) => {
    // 拉 token 全生命周期到买点的 ticks（锚窗）
    const { data: ticks } = await sb.from('wss_price_ticks')
      .select('block_time,trade_type,bnb_amount,token_amount,price_bnb,sender_address,trader_address')
      .eq('token_address', s.addr).lte('block_time', s.buyAt)
      .order('block_time', { ascending: true }).limit(3000);
    if (!ticks?.length) return null;
    const anchorTs = new Date(s.buyAt).getTime();
    // wallet + 净持仓（token 域）
    const netTok = new Map();
    const rows = [];
    for (const t of ticks) {
      const w = ((t.sender_address || t.trader_address) || '').toLowerCase();
      const isBuy = t.trade_type === 'buy';
      rows.push({ ts: new Date(t.block_time).getTime(), w, isBuy, bnb: Number(t.bnb_amount || 0), tok: t.token_amount == null ? null : Number(t.token_amount) });
      if (w && !ROUTERS.has(w) && rows[rows.length - 1].tok != null) {
        netTok.set(w, (netTok.get(w) || 0) + (isBuy ? rows[rows.length - 1].tok : -rows[rows.length - 1].tok));
      }
    }
    const posSorted = [...netTok.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const top5 = new Set(posSorted.slice(0, 5).map(([w]) => w));
    // 60s 卖出 per 口径
    let sTop5 = 0, sFam = 0, sSm = 0;
    for (const r of rows) {
      if (r.isBuy || !r.w || anchorTs - r.ts > 60000 || anchorTs - r.ts < 0) continue;
      if (ROUTERS.has(r.w)) continue;
      if (top5.has(r.w)) sTop5 += r.bnb;
      if (famousSet.has(r.w)) sFam += r.bnb;
      if (smSet.has(r.w)) sSm += r.bnb;
    }
    return { top5: +sTop5.toFixed(4), fam: +sFam.toFixed(4), sm: +sSm.toFixed(4), merged: +Math.min(sTop5 + sFam + sSm, 999).toFixed(4) };
  };

  const summary = { A: [], B: [], C: [] };  // A=top5 口径 C3, B=合并口径 C3, C=名单单独口径
  for (const [w, id] of EXPS) {
    const samples = await load(id);
    const per = { A: { n: 0, pnl: 0, win: 0 }, B: { n: 0, pnl: 0, win: 0 }, C: { n: 0, pnl: 0, win: 0 } };
    const detailB = [];
    for (const s of samples) {
      if (num(s, 'athVsLaunchPct') == null || Number.isNaN(num(s, 'athVsLaunchPct'))) continue;
      const ath = num(s, 'athVsLaunchPct');
      if (ath >= 80) continue;
      const r = await evalToken(s);
      if (!r) continue;
      const hitA = r.top5 >= 0.1 && r.top5 < 0.3;
      const hitC = (r.fam + r.sm) >= 0.1;
      const hitB = hitA || hitC;
      if (hitA) { per.A.n++; per.A.pnl += s.pnl; if (s.pnl > 0.0005) per.A.win++; }
      if (hitB) { per.B.n++; per.B.pnl += s.pnl; if (s.pnl > 0.0005) per.B.win++; detailB.push({ s, r, onlyB: !hitA && hitC }); }
      if (hitC) { per.C.n++; per.C.pnl += s.pnl; if (s.pnl > 0.0005) per.C.win++; }
    }
    console.log(`\n[${w}] (域 ath<80)`);
    console.log(`  A top5∈[0.1,0.3)     n=${per.A.n} 胜${per.A.win} 净${per.A.pnl.toFixed(3)}`);
    console.log(`  B A∪fam∪sm(≥0.1)    n=${per.B.n} 胜${per.B.win} 净${per.B.pnl.toFixed(3)}`);
    console.log(`  C fam∪sm 单独(≥0.1)  n=${per.C.n} 胜${per.C.win} 净${per.C.pnl.toFixed(3)}`);
    // B 独有增量面（famous/sm 卖出 ≥0.1 但 top5 不在带内）
    const onlyB = detailB.filter(d => d.onlyB);
    console.log(`  B 独有增量（名单卖出≥0.1 ∧ top5 不在带内）: ${onlyB.length} 票 净${onlyB.reduce((a, d) => a + d.s.pnl, 0).toFixed(3)}`);
    for (const d of onlyB) {
      console.log('   ' + (d.s.pnl > 0.0005 ? '▲' : '✗'), (d.s.symbol || '').slice(0, 9).padEnd(10), d.s.pnl.toFixed(4).padStart(7),
        'top5', String(d.r.top5).padStart(6), 'fam', String(d.r.fam).padStart(6), 'sm', String(d.r.sm).padStart(6), 'ath', String(num(d.s, 'athVsLaunchPct')).padStart(6));
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
