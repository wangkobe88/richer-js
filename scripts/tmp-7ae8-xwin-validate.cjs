// 候选因子臂跨窗验证：bt-v158(win1019)/bt-v150(win1012)/bt-v145(win1103) 三窗重放
// 182 跑：node scripts/tmp-7ae8-xwin-validate.cjs
require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');

const EXPS = [
  ['bt-v158 win1019', '7ae8e398-c875-454a-942b-bc1accfacd53'],
  ['bt-v150 win1012', '8ebaccce-62c6-4209-a2a0-40f361c49bf9'],
  ['bt-v145 win1103', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
];

async function loadSamples(expId) {
  const sb = dbManager.getClient();
  const { data: trades } = await sb.from('trades')
    .select('token_address,token_symbol,trade_direction,input_amount,output_amount,created_at,signal_id,metadata')
    .eq('experiment_id', expId).order('created_at', { ascending: true }).limit(500);
  if (!trades?.length) return null;
  const byToken = new Map();
  for (const t of trades) {
    const k = t.token_address;
    if (!byToken.has(k)) byToken.set(k, { symbol: t.token_symbol, cost: 0, got: 0, buySigId: null, sellSigs: [] });
    const e = byToken.get(k);
    if (t.trade_direction === 'buy') { e.cost += Number(t.input_amount || 0); e.buySigId = t.signal_id; }
    else { e.got += Number(t.output_amount || 0); e.sellSigs.push(t); }
  }
  const tokens = [...byToken.entries()].map(([addr, v]) => ({
    addr, symbol: v.symbol, cost: v.cost, got: v.got, pnl: v.got - v.cost, buySigId: v.buySigId,
    exit: v.sellSigs.length && v.sellSigs[0].metadata ? (v.sellSigs[0].metadata.stallClose ? 'stall' : 'sell') : '?',
  }));
  const ids = tokens.map(t => t.buySigId).filter(Boolean);
  const metaById = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const { data } = await sb.from('strategy_signals').select('id,metadata').in('id', ids.slice(i, i + 50));
    for (const r of data || []) metaById.set(r.id, r.metadata || {});
  }
  return tokens.map(t => {
    const m = metaById.get(t.buySigId) || {};
    const an = (m.buyPoint || {}).anchors || {};
    // sbw 双源：AF 段或 cheat levels
    let sbw = (m.actFrontGate || {}).sbw;
    if (!sbw) { const lv = (m.cheatCheck || {}).levels || {}; if (lv.stallBurstWave != null) sbw = Number(lv.stallBurstWave) === 1 ? 'burst' : 'none'; }
    return { ...t, A: an, sbw: sbw || '?', act: (m.actFrontGate || {}).act || '?' };
  });
}

// ── 候选判据（都是买点时刻可得的 snapshot 键 / AF 段键）──
const num = (s, k) => Number(s.A[k]);
const ARMS = [
  { id: 'A1 dip未收复深+尾段买力薄', f: s => num(s, 'recentDip5UnrecoveredPct') <= -10 && num(s, 'actNearTail5BuyN') <= 2 },
  { id: 'A2 dip未收复深(单键<=-15)', f: s => num(s, 'recentDip5UnrecoveredPct') <= -15 },
  { id: 'A3 dip未收复深+尾5买Bnb薄', f: s => num(s, 'recentDip5UnrecoveredPct') <= -10 && num(s, 'actNearTail5BuyBnb') < 0.2 },
  { id: 'B1 sbw!=burst+尾段买力薄', f: s => s.sbw !== 'burst' && num(s, 'actNearTail5BuyN') < 2 },
  { id: 'B2 sbw!=burst+尾5买Bnb<0.1', f: s => s.sbw !== 'burst' && num(s, 'actNearTail5BuyBnb') < 0.1 },
  { id: 'C1 bhs60>=0.1+无砸块', f: s => num(s, 'bigHolderSellBnb60') >= 0.1 && !num(s, 'dump2BlockSellers') },
  { id: 'C2 bhs60>=0.1+exitSellers>=8', f: s => num(s, 'bigHolderSellBnb60') >= 0.1 && num(s, 'exitSellerCount60') >= 8 },
  { id: 'D1 尾10s卖钱包>=2+win30卖>=7', f: s => num(s, 'actNearTail10SellWallets') >= 2 && num(s, 'win30SellN') >= 7 },
  { id: 'E1 A1或B1（并集）', f: s => (num(s, 'recentDip5UnrecoveredPct') <= -10 && num(s, 'actNearTail5BuyN') <= 2) || (s.sbw !== 'burst' && num(s, 'actNearTail5BuyN') < 2) },
  { id: 'F1 尾5买N<=2(单键对照)', f: s => num(s, 'actNearTail5BuyN') <= 2 },
];

async function main() {
  for (const [name, id] of EXPS) {
    if (!id) { console.log('\n### ' + name + ': id 未找到，跳过'); continue; }
    const samples = await loadSamples(id);
    if (!samples) { console.log('\n### ' + name + ': 无 trades'); continue; }
    const net = samples.reduce((a, s) => a + s.pnl, 0);
    const wins = samples.filter(s => s.pnl > 0.0005).length;
    console.log(`\n### ${name}（${samples.length} 票，净 ${net.toFixed(3)}，胜率 ${Math.round(wins / samples.length * 100)}%）`);
    for (const arm of ARMS) {
      const hit = samples.filter(arm.f);
      if (!hit.length) { console.log(('  ' + arm.id).padEnd(34), '命中 0'); continue; }
      const stop = hit.filter(s => s.pnl < 0).reduce((a, s) => a + s.pnl, 0);   // 止血（负 pnl 之和）
      const hurt = hit.filter(s => s.pnl >= 0).reduce((a, s) => a + s.pnl, 0);  // 误伤（正 pnl 之和）
      const winN = hit.filter(s => s.pnl > 0.0005).length;
      console.log(('  ' + arm.id).padEnd(34), '命中', String(hit.length).padEnd(3), '胜' + String(winN).padEnd(3),
        '止血Σ', stop.toFixed(3).padStart(7), '误伤Σ', hurt.toFixed(3).padStart(6), '净', (stop + hurt).toFixed(3).padStart(7));
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
