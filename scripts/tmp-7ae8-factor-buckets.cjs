// bt-v158 (7ae8e398) 因子分桶盈亏分析：找出「什么条件的买点容易亏」
// 182 跑：node scripts/tmp-7ae8-factor-buckets.cjs
require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');

const EXP = '7ae8e398-c875-454a-942b-bc1accfacd53';

async function main() {
  const sb = dbManager.getClient();

  // ── 1. trades → per-token 回合盈亏 ──
  const { data: trades } = await sb.from('trades')
    .select('id,token_address,token_symbol,trade_direction,input_amount,output_amount,created_at,signal_id,metadata')
    .eq('experiment_id', EXP).order('created_at', { ascending: true }).limit(400);
  const byToken = new Map();
  for (const t of trades) {
    const k = t.token_address;
    if (!byToken.has(k)) byToken.set(k, { symbol: t.token_symbol, cost: 0, got: 0, buySigId: null, sells: [] });
    const e = byToken.get(k);
    if (t.trade_direction === 'buy') { e.cost += Number(t.input_amount || 0); e.buySigId = t.signal_id; }
    else { e.got += Number(t.output_amount || 0); e.sells.push(t); }
  }
  const tokens = [...byToken.entries()].map(([addr, v]) => ({
    addr, symbol: v.symbol, cost: v.cost, got: v.got, pnl: v.got - v.cost, buySigId: v.buySigId,
    sellSigs: v.sells.map(s => s.signal_id).filter(Boolean),
    holdSec: v.sells.length ? Math.round((new Date(v.sells[v.sells.length - 1].created_at) - new Date(v.sells[0].created_at)) / 1000) : null,
  }));
  console.log(`票数 ${tokens.length} 净Σ ${tokens.reduce((a, t) => a + t.pnl, 0).toFixed(4)} BNB`);

  // ── 2. 拉买入信号 metadata（分批 .in ≤50）──
  const ids = tokens.map(t => t.buySigId).filter(Boolean);
  const metaById = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const { data } = await sb.from('strategy_signals').select('id,metadata')
      .in('id', ids.slice(i, i + 50));
    for (const r of data || []) metaById.set(r.id, r.metadata || {});
  }
  // 卖出信号 metadata（离场方式）
  const sellIds = [...new Set(tokens.flatMap(t => t.sellSigs))];
  const sellMetaById = new Map();
  for (let i = 0; i < sellIds.length; i += 50) {
    const { data } = await sb.from('strategy_signals').select('id,metadata,reason')
      .in('id', sellIds.slice(i, i + 50));
    for (const r of data || []) sellMetaById.set(r.id, { m: r.metadata || {}, reason: r.reason });
  }

  // ── 3. 组装样本：每票 = pnl + anchors + 门链段 + 离场方式 ──
  const samples = tokens.map(t => {
    const m = metaById.get(t.buySigId) || {};
    const bp = m.buyPoint || {};
    const an = bp.anchors || {};
    // 离场方式：取首个卖 signal 的标识
    let exit = '?';
    const s0 = t.sellSigs.map(id => sellMetaById.get(id)).find(Boolean);
    if (s0) {
      const mm = s0.m || {};
      if (mm.stallClose) exit = 'stallClose:' + (mm.stallClose.tier || mm.stallClose.effectiveSec || '');
      else if (mm.burstCooldownInfo) exit = 'burstCooldown';
      else if (s0.reason) exit = ('' + s0.reason).slice(0, 24);
    }
    return {
      ...t, pnlPct: t.cost > 0 ? t.pnl / t.cost * 100 : 0,
      A: an, exit,
      sg: m.signalGate || {},
      cheat: m.cheatCheck || {},
      af: m.actFrontGate || {},
      fc: m.factorCheck || {},
      bpStatus: bp.status, bpRule: (bp.assessment || {}).rule || bp.rule || '',
    };
  });
  require('fs').writeFileSync('/tmp/bt158_samples.json', JSON.stringify(samples));

  // ── 4. 分桶统计工具 ──
  function bucketNumeric(key, edges) {
    const rows = samples.filter(s => Number.isFinite(Number(s.A[key])));
    if (rows.length < 30) return null;
    const vals = rows.map(s => Number(s.A[key]));
    const useEdges = edges || (function () {
      const v = [...vals].sort((a, b) => a - b);
      const q = p => v[Math.floor(p * (v.length - 1))];
      return [q(.25), q(.5), q(.75)];
    })();
    const groups = rows.map(s => {
      const x = Number(s.A[key]);
      let g = 0; while (g < useEdges.length && x > useEdges[g]) g++;
      return { g, s };
    });
    const out = { key, n: rows.length, edges: useEdges, buckets: [] };
    for (let g = 0; g <= useEdges.length; g++) {
      const ss = groups.filter(x => x.g === g).map(x => x.s);
      if (!ss.length) { out.buckets.push(null); continue; }
      const sum = ss.reduce((a, s) => a + s.pnl, 0);
      const win = ss.filter(s => s.pnl > 0.0005).length;
      out.buckets.push({
        lo: g === 0 ? '-∞' : useEdges[g - 1], hi: g === useEdges.length ? '+∞' : useEdges[g],
        n: ss.length, winRate: +(win / ss.length * 100).toFixed(0), sum: +sum.toFixed(3), mean: +(sum / ss.length).toFixed(4),
      });
    }
    return out;
  }
  function bucketCategorical(getKey, label) {
    const groups = new Map();
    for (const s of samples) {
      const k = getKey(s); if (k == null) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    const rows = [...groups.entries()].map(([k, ss]) => {
      const sum = ss.reduce((a, s) => a + s.pnl, 0);
      return { k, n: ss.length, winRate: +Math.round(ss.filter(s => s.pnl > 0.0005).length / ss.length * 100), sum: +sum.toFixed(3), mean: +(sum / ss.length).toFixed(4) };
    }).sort((a, b) => a.sum - b.sum);
    return { key: label, buckets: rows };
  }

  // ── 5. 输出 ──
  console.log('\n═══════ A. 离场方式 × 盈亏 ═══════');
  for (const r of bucketCategorical(s => s.exit, 'exit').buckets) console.log(r.k.padEnd(28), 'n=' + String(r.n).padEnd(3), 'win ' + String(r.winRate) + '%', 'Σ' + r.sum.toFixed(3).padStart(7), 'μ' + r.mean.toFixed(4).padStart(8));

  console.log('\n═══════ B. 门链段 × 盈亏 ═══════');
  for (const r of bucketCategorical(s => (s.cheat && s.cheat.grade) || '?', 'cheat.grade').buckets) console.log('cheat.' + String(r.k).padEnd(20), 'n=' + String(r.n).padEnd(3), 'win ' + String(r.winRate) + '%', 'Σ' + r.sum.toFixed(3).padStart(7));
  for (const r of bucketCategorical(s => (s.cheat && s.cheat.exempt && s.cheat.exempt.code) || '无豁免', 'cheat.exempt').buckets) console.log('exempt.' + String(r.k).padEnd(20), 'n=' + String(r.n).padEnd(3), 'win ' + String(r.winRate) + '%', 'Σ' + r.sum.toFixed(3).padStart(7));
  for (const r of bucketCategorical(s => (s.af && s.af.act) || '?', 'actFront.act').buckets) console.log('AF.act.' + String(r.k).padEnd(18), 'n=' + String(r.n).padEnd(3), 'win ' + String(r.winRate) + '%', 'Σ' + r.sum.toFixed(3).padStart(7));
  for (const r of bucketCategorical(s => (s.af && s.af.sbw) || '?', 'actFront.sbw').buckets) console.log('AF.sbw.' + String(r.k).padEnd(18), 'n=' + String(r.n).padEnd(3), 'win ' + String(r.winRate) + '%', 'Σ' + r.sum.toFixed(3).padStart(7));
  for (const r of bucketCategorical(s => (s.sg && s.sg.legId) || '?', 'legId').buckets) console.log('leg.' + String(r.k).padEnd(22), 'n=' + String(r.n).padEnd(3), 'win ' + String(r.winRate) + '%', 'Σ' + r.sum.toFixed(3).padStart(7));

  console.log('\n═══════ C. 核心数值因子四分位分桶（找亏损集中桶）═══════');
  const KEYS = [
    ['tokenAgeSec', null], ['currentVsLaunchPct', null], ['currentVsAthPct', null], ['secSinceAth', null],
    ['mcapFromPeakPct', null], ['chg5Pct', null], ['chg10Pct', null], ['chg30Pct', null],
    ['recentDip5Pct', null], ['recentDip5SecAgo', null], ['recentDip5UnrecoveredPct', null],
    ['nearMaxDn5Pct', null], ['nearMaxUp5Pct', null], ['maxDn5Pct', null], ['maxChg5Pct', null],
    ['win30BuyN', null], ['win30NetBnb', null], ['win30SellN', null], ['win30NewBuyers', null],
    ['win60NetBnb', null], ['win120NetBnb', null], ['win30BuySharePct', null],
    ['actThroughputBnbPerMin', null], ['actNearSegBnbPerMin', null], ['actIdlePct', null],
    ['holdersNow', null], ['holdersDelta60', null],
    ['chipTop1HoldCircPct', null], ['chipTop1Top2HoldCircPct', null], ['chipPosHolderCount', null], ['chipBuyersTotal', null],
    ['bundledBlockN', null], ['bundledBlockWallets', null], ['bundledBlockBnb', null],
    ['burst5N', null], ['burst5BuyBnb', null], ['burst5Wallets', null],
    ['firstBuySharePct', null], ['openSegBuySharePct', null], ['openSegBigBuyN', null], ['openLateBuyBnb', null],
    ['dumpBlockBnb', null], ['dump2BlockBnb', null], ['dumpBlockSellers', null], ['dump2BlockSellers', null],
    ['exitSellerCount60', null], ['bigHolderSellBnb60', null], ['top1BuyPct60', null], ['top1SellPct60', null],
    ['totalVolumeBnb', null], ['spanSec', null], ['mcapBnb', null], ['mcapPeakBnb', null],
    ['swingRisePct', null], ['swingRiseSec', null], ['curVsMinGapPct', null],
    ['phaseSplitPreBuySharePct', null], ['phaseSplitSecSinceFirstSell', null],
    ['actNearTail10BnbPerMin', null], ['actNearTail10SellWallets', null], ['actNearTail5BuyN', null], ['actNearTail5BuyBnb', null],
    ['routerBuyPct60', null], ['athVsLaunchPct', null], ['minVsLaunchPct', null],
  ];
  const results = [];
  for (const [k, e] of KEYS) { const r = bucketNumeric(k, e); if (r) results.push(r); }
  // 排序：桶间 Σpnl 极差最大的键优先
  results.sort((a, b) => {
    const spread = r => Math.max(...r.buckets.filter(Boolean).map(x => x.sum)) - Math.min(...r.buckets.filter(Boolean).map(x => x.sum));
    return spread(b) - spread(a);
  });
  for (const r of results) {
    const parts = r.buckets.map(b => b ? `[${fmt(b.lo)},${fmt(b.hi)}] n${b.n} win${b.winRate}% Σ${b.sum}]` : '[空]').join(' ');
    console.log(r.key.padEnd(26), '极差' + (Math.max(...r.buckets.filter(Boolean).map(x => x.sum)) - Math.min(...r.buckets.filter(Boolean).map(x => x.sum))).toFixed(3).padStart(7), parts);
  }
  function fmt(x) { return typeof x === 'number' ? (Math.abs(x) >= 1000 ? x.toFixed(0) : x.toFixed(2)) : x; }

  console.log('\n═══════ D. 亏票清单（pnl<-0.02）因子剖面 ═══════');
  for (const s of samples.filter(s => s.pnl < -0.02).sort((a, b) => a.pnl - b.pnl)) {
    const a = s.A;
    console.log(
      (s.symbol || '').slice(0, 10).padEnd(11),
      s.pnl.toFixed(4).padStart(7),
      'age', String(a.tokenAgeSec).padStart(4), 'curVs', String(a.currentVsLaunchPct).padStart(6),
      'ath', String(a.athVsLaunchPct).padStart(6), 'chg5', String(a.chg5Pct).padStart(6), 'chg30', String(a.chg30Pct).padStart(7),
      'w30net', String(a.win30NetBnb).padStart(6), 'holders', String(a.holdersNow).padStart(4),
      'exit=' + s.exit.slice(0, 18), 'AF=' + (s.af.act || '?') + '/' + (s.af.sbw || '?'), 'cheat=' + ((s.cheat.grade || '?') + (s.cheat.exempt ? '⚠' + s.cheat.exempt.code : ''))
    );
  }
  console.log('\nsaved /tmp/bt158_samples.json');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
