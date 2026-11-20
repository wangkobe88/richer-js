// 终臂验证：B1∧w30SelN≥5 明细 + sbw 数值代理（burst5BuyBnb 量级线）可行性
require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');

const EXPS = [
  ['w1019', '7ae8e398-c875-454a-942b-bc1accfacd53'],
  ['w1012', '8ebaccce-62c6-4209-a2a0-40f361c49bf9'],
  ['w1103', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
];

async function loadSamples(expId) {
  const sb = dbManager.getClient();
  const { data: trades } = await sb.from('trades')
    .select('token_address,token_symbol,trade_direction,input_amount,output_amount,signal_id')
    .eq('experiment_id', expId).order('created_at', { ascending: true }).limit(500);
  const byToken = new Map();
  for (const t of trades) {
    const k = t.token_address;
    if (!byToken.has(k)) byToken.set(k, { symbol: t.token_symbol, cost: 0, got: 0, buySigId: null });
    const e = byToken.get(k);
    if (t.trade_direction === 'buy') { e.cost += Number(t.input_amount || 0); e.buySigId = t.signal_id; }
    else e.got += Number(t.output_amount || 0);
  }
  const tokens = [...byToken.entries()].map(([addr, v]) => ({ addr, symbol: v.symbol, cost: v.cost, got: v.got, pnl: v.got - v.cost, buySigId: v.buySigId }));
  const ids = tokens.map(t => t.buySigId).filter(Boolean);
  const metaById = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const { data } = await sb.from('strategy_signals').select('id,metadata').in('id', ids.slice(i, i + 50));
    for (const r of data || []) metaById.set(r.id, r.metadata || {});
  }
  return tokens.map(t => {
    const m = metaById.get(t.buySigId) || {};
    const an = (m.buyPoint || {}).anchors || {};
    let sbw = (m.actFrontGate || {}).sbw;
    if (!sbw) { const lv = (m.cheatCheck || {}).levels || {}; if (lv.stallBurstWave != null) sbw = Number(lv.stallBurstWave) === 1 ? 'burst' : 'none'; }
    return { ...t, A: an, sbw: sbw || '?', act: (m.actFrontGate || {}).act || '?', leg: ((m.signalGate || {}).legId || '?') };
  });
}

(async () => {
  const all = {};
  for (const [name, id] of EXPS) all[name] = await loadSamples(id);
  const num = (s, k) => Number(s.A[k]);

  console.log('═══ ① sbw 判定 vs burst5BuyBnb 数值代理分离度（三窗全票）═══');
  for (const [w, ss] of Object.entries(all)) {
    const bySbw = {};
    for (const s of ss) {
      (bySbw[s.sbw] = bySbw[s.sbw] || []).push(num(s, 'burst5BuyBnb'));
    }
    for (const [k, v] of Object.entries(bySbw)) {
      const fin = v.filter(Number.isFinite).sort((a, b) => a - b);
      console.log(`  [${w}] sbw=${k} n=${v.length} burst5BuyBnb: min=${fin[0]?.toFixed(3)} p10=${fin[Math.floor(fin.length*.1)]?.toFixed(3)} 中位=${fin[Math.floor(fin.length/2)]?.toFixed(3)} p90=${fin[Math.floor(fin.length*.9)]?.toFixed(3)} max=${fin[fin.length-1]?.toFixed(3)}`);
    }
  }
  console.log('  → sbw=burst 的 burst5BuyBnb 分布下界 vs none 的上界（0.3 线=CD402 量级线）');

  console.log('\n═══ ② 终臂 B1∧w30SelN≥5 全命中票明细（含负票）═══');
  const arm = s => s.sbw !== 'burst' && num(s, 'actNearTail5BuyN') < 2 && num(s, 'win30SellN') >= 5;
  for (const [w, ss] of Object.entries(all)) {
    const hits = ss.filter(arm).sort((a, b) => a.pnl - b.pnl);
    console.log(`  [${w}] ${hits.length} 票:`);
    for (const s of hits) {
      console.log('   ', (s.symbol || '').slice(0, 10).padEnd(11), s.pnl.toFixed(4).padStart(7),
        'leg', s.leg.padEnd(10), 't5N', String(s.A.actNearTail5BuyN).padStart(2), 'w30sel', String(s.A.win30SellN).padStart(3),
        'w30net', String(num(s, 'win30NetBnb')).padStart(7), 'chg5', String(s.A.chg5Pct).padStart(7),
        'bhs', String(s.A.bigHolderSellBnb60 ?? '-').padStart(5), 'curVs', String(s.A.currentVsLaunchPct).padStart(6),
        'b5B', String(s.A.burst5BuyBnb ?? '-').padStart(5), 'sbw', s.sbw);
    }
  }

  console.log('\n═══ ③ 数值代理版（sbw 腿换 burst5BuyBnb<0.3）三窗效果 ═══');
  const armProxy = s => num(s, 'burst5BuyBnb') < 0.3 && num(s, 'actNearTail5BuyN') < 2 && num(s, 'win30SellN') >= 5;
  for (const [w, ss] of Object.entries(all)) {
    const hit = ss.filter(armProxy);
    const stop = hit.filter(s => s.pnl < 0).reduce((a, s) => a + s.pnl, 0);
    const hurt = hit.filter(s => s.pnl >= 0).reduce((a, s) => a + s.pnl, 0);
    console.log(`  [${w}] 命中${hit.length} 胜${hit.filter(s => s.pnl > 0.0005).length} 止血${stop.toFixed(3)} 误伤${hurt.toFixed(3)} 净${(stop + hurt).toFixed(3)}`);
  }

  console.log('\n═══ ④ 与 FP18（tail_dip_knife）重叠检查：命中票中 chg5<-5∧chg30<-5 的（FP18 已管，但都成交了说明 FP18 域外）═══');
  for (const [w, ss] of Object.entries(all)) {
    const hits = ss.filter(arm);
    const fp18 = hits.filter(s => num(s, 'chg5Pct') < -5 && num(s, 'chg30Pct') < -5);
    console.log(`  [${w}] 命中${hits.length} 其中 FP18 形状(chg5<-5∧chg30<-5) ${fp18.length}（这些成交了=不在 FP18 域 ath≥40∧curVs≤28.5 或已豁免）`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
