// bt-v160 热窗（09-28）因子分桶盈亏分析：找热市场亏损集中形状（抢速互割族）
require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');

const EXP = '5b2c1747-959f-42de-a622-f57deb9fb407';

async function main() {
  const sb = dbManager.getClient();
  const { data: trades } = await sb.from('trades')
    .select('id,token_address,token_symbol,trade_direction,input_amount,output_amount,created_at,signal_id,metadata')
    .eq('experiment_id', EXP).order('created_at', { ascending: true }).limit(600);
  const byToken = new Map();
  for (const t of trades) {
    const k = t.token_address;
    if (!byToken.has(k)) byToken.set(k, { symbol: t.token_symbol, cost: 0, got: 0, buySigId: null, sellSigs: [] });
    const e = byToken.get(k);
    if (t.trade_direction === 'buy') { e.cost += Number(t.input_amount || 0); e.buySigId = t.signal_id; }
    else { e.got += Number(t.output_amount || 0); e.sellSigs.push(t.signal_id); }
  }
  const tokens = [...byToken.entries()].map(([addr, v]) => ({
    addr, symbol: v.symbol, cost: v.cost, got: v.got, pnl: v.got - v.cost, buySigId: v.buySigId, sellSigs: v.sellSigs.filter(Boolean),
  }));
  console.log(`票数 ${tokens.length} 净Σ ${tokens.reduce((a, t) => a + t.pnl, 0).toFixed(4)}`);

  const ids = tokens.map(t => t.buySigId).filter(Boolean);
  const metaById = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const { data } = await sb.from('strategy_signals').select('id,metadata').in('id', ids.slice(i, i + 50));
    for (const r of data || []) metaById.set(r.id, r.metadata || {});
  }
  const sellIds = [...new Set(tokens.flatMap(t => t.sellSigs))];
  const sellMetaById = new Map();
  for (let i = 0; i < sellIds.length; i += 50) {
    const { data } = await sb.from('strategy_signals').select('id,metadata,reason').in('id', sellIds.slice(i, i + 50));
    for (const r of data || []) sellMetaById.set(r.id, { m: r.metadata || {}, reason: r.reason });
  }
  const samples = tokens.map(t => {
    const m = metaById.get(t.buySigId) || {};
    const an = (m.buyPoint || {}).anchors || {};
    let exit = '?';
    const s0 = t.sellSigs.map(id => sellMetaById.get(id)).find(Boolean);
    if (s0) {
      const mm = s0.m || {};
      if (mm.stallClose) exit = 'stall:' + (mm.stallClose.tier || '');
      else if (mm.burstCooldownInfo || /burst/i.test('' + (s0.reason || ''))) exit = 'burstCd';
      else exit = 'sellLeg';
    }
    return { ...t, pnlPct: t.cost > 0 ? t.pnl / t.cost * 100 : 0, A: an, exit,
      sg: m.signalGate || {}, cheat: m.cheatCheck || {}, af: m.actFrontGate || {},
      leg: (m.signalGate || {}).legId || '?', trig: (m.signalGate || {}).triggerNo };
  });
  require('fs').writeFileSync('/tmp/bt160_samples.json', JSON.stringify(samples));

  function bucketCategorical(getKey, label) {
    const groups = new Map();
    for (const s of samples) { const k = getKey(s); if (k == null) continue; (groups.get(k) || groups.set(k, []).get(k)).push(s); }
    return [...groups.entries()].map(([k, ss]) => ({ k, n: ss.length, winRate: Math.round(ss.filter(s => s.pnl > 0.0005).length / ss.length * 100), sum: ss.reduce((a, s) => a + s.pnl, 0) })).sort((a, b) => a.sum - b.sum);
  }
  function bucketNumeric(key) {
    const rows = samples.filter(s => Number.isFinite(Number(s.A[key])));
    if (rows.length < 40) return null;
    const v = rows.map(s => Number(s.A[key])).sort((a, b) => a - b);
    const q = p => v[Math.floor(p * (v.length - 1))];
    const edges = [q(.25), q(.5), q(.75)];
    const out = { key, buckets: [] };
    for (let g = 0; g <= 3; g++) {
      const ss = rows.filter(s => { const x = Number(s.A[key]); let gi = 0; while (gi < edges.length && x > edges[gi]) gi++; return gi === g; });
      if (!ss.length) { out.buckets.push(null); continue; }
      out.buckets.push({ lo: g ? edges[g - 1] : null, hi: g < 3 ? edges[g] : null, n: ss.length,
        winRate: Math.round(ss.filter(s => s.pnl > 0.0005).length / ss.length * 100), sum: ss.reduce((a, s) => a + s.pnl, 0) });
    }
    return out;
  }

  console.log('\n═══ A. 出场方式/腿/门链段 ═════');
  for (const r of bucketCategorical(s => s.exit, 'exit')) console.log(String(r.k).padEnd(14), 'n=' + String(r.n).padEnd(3), 'win ' + String(r.winRate) + '%', 'Σ' + r.sum.toFixed(3));
  for (const r of bucketCategorical(s => s.leg, 'leg')) console.log('leg.' + String(r.k).padEnd(12), 'n=' + String(r.n).padEnd(3), 'win ' + String(r.winRate) + '%', 'Σ' + r.sum.toFixed(3));
  for (const r of bucketCategorical(s => (s.af && s.af.act) || '?', 'af.act')) console.log('AF.' + String(r.k).padEnd(12), 'n=' + String(r.n).padEnd(3), 'win ' + String(r.winRate) + '%', 'Σ' + r.sum.toFixed(3));
  for (const r of bucketCategorical(s => (s.af && s.af.sbw) || '?', 'af.sbw')) console.log('sbw.' + String(r.k).padEnd(12), 'n=' + String(r.n).padEnd(3), 'win ' + String(r.winRate) + '%', 'Σ' + r.sum.toFixed(3));

  console.log('\n═══ B. 数值因子四分位（按桶间 Σ 极差排序）═══════');
  const KEYS = ['tokenAgeSec','currentVsLaunchPct','athVsLaunchPct','currentVsAthPct','secSinceAth','mcapFromPeakPct',
    'chg5Pct','chg10Pct','chg30Pct','recentDip5Pct','recentDip5SecAgo','recentDip5UnrecoveredPct','nearMaxDn5Pct','nearMaxUp5Pct','maxDn5Pct','maxChg5Pct',
    'win30BuyN','win30SellN','win30NetBnb','win30NewBuyers','win30BuySharePct','win60NetBnb','win120NetBnb',
    'actNearTail5BuyN','actNearTail5BuyBnb','actNearTail10SellWallets','actNearTail10BnbPerMin','actThroughputBnbPerMin','actNearSegBnbPerMin','actIdlePct','actBuyMedianBnb',
    'holdersNow','chipPosHolderCount','chipTop1HoldCircPct','chipTop1Top2HoldCircPct','chipBuyersTotal',
    'bundledBlockN','bundledBlockWallets','bundledBlockBnb','burst5N','burst5BuyBnb','burst5Wallets',
    'firstBuySharePct','openSegBuySharePct','openSegBigBuyN','openSegBuyBnb','openLateBuyBnb','openSegBuyN',
    'dumpBlockBnb','dumpBlockSellers','dump2BlockBnb','dump2BlockSellers','bigHolderSellBnb60','exitSellerCount60',
    'top1BuyPct60','top1SellPct60','totalVolumeBnb','spanSec','mcapBnb','mcapPeakBnb',
    'swingRisePct','swingRiseSec','curVsMinGapPct','phaseSplitPreBuySharePct','routerBuyPct60','minVsLaunchPct','launchCovered'];
  const results = KEYS.map(bucketNumeric).filter(Boolean);
  results.sort((a, b) => {
    const sp = r => Math.max(...r.buckets.filter(Boolean).map(x => x.sum)) - Math.min(...r.buckets.filter(Boolean).map(x => x.sum));
    return sp(b) - sp(a);
  });
  const f = x => typeof x === 'number' ? (Math.abs(x) >= 1000 ? x.toFixed(0) : x.toFixed(2)) : x;
  for (const r of results.slice(0, 30)) {
    console.log(r.key.padEnd(26), r.buckets.map(b => b ? `[${f(b.lo)},${f(b.hi)}]n${b.n} w${b.winRate}% Σ${b.sum}]` : '[空]').join(' '));
  }

  console.log('\n═══ C. 亏票剖面（pnl<-0.03）════');
  for (const s of samples.filter(s => s.pnl < -0.03).sort((a, b) => a.pnl - b.pnl)) {
    const a = s.A;
    console.log((s.symbol || '').slice(0, 10).padEnd(11), s.pnl.toFixed(4).padStart(7),
      'age', String(a.tokenAgeSec).padStart(4), 'curVs', String(a.currentVsLaunchPct).padStart(6), 'ath', String(a.athVsLaunchPct).padStart(6),
      'chg5', String(a.chg5Pct).padStart(6), 'w30net', String(a.win30NetBnb).padStart(6), 'w30sel', String(a.win30SellN).padStart(3),
      't5N', String(a.actNearTail5BuyN).padStart(2), 'burst5N', String(a.burst5N).padStart(3), 'holders', String(a.holdersNow).padStart(3),
      'leg', s.leg.padEnd(9), 'exit=' + s.exit.slice(0, 12), 'AF=' + (s.af.act || '?') + '/' + (s.af.sbw || '?'));
  }
  console.log('\nsaved /tmp/bt160_samples.json');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
