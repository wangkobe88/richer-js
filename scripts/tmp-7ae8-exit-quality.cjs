// 修 ① exit 来源（sell signal metadata）+ ⑤ 卖后 15min maxRel（出场方式质量：割在底部的误杀面）
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
    .select('token_address,token_symbol,trade_direction,input_amount,output_amount,signal_id,created_at')
    .eq('experiment_id', expId).order('created_at', { ascending: true }).limit(500);
  const byToken = new Map();
  for (const t of trades) {
    const k = t.token_address;
    if (!byToken.has(k)) byToken.set(k, { symbol: t.token_symbol, cost: 0, got: 0, buySigId: null, sells: [] });
    const e = byToken.get(k);
    if (t.trade_direction === 'buy') { e.cost += Number(t.input_amount || 0); e.buySigId = t.signal_id; }
    else { e.got += Number(t.output_amount || 0); e.sells.push(t); }
  }
  const tokens = [...byToken.entries()].map(([addr, v]) => ({ addr, symbol: v.symbol, cost: v.cost, got: v.got, pnl: v.got - v.cost, buySigId: v.buySigId, sells: v.sells }));
  // 买信号 metadata（FP26 两腿）
  const ids = tokens.map(t => t.buySigId).filter(Boolean);
  const metaById = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const { data } = await sb.from('strategy_signals').select('id,metadata').in('id', ids.slice(i, i + 50));
    for (const r of data || []) metaById.set(r.id, r.metadata || {});
  }
  // 卖信号 metadata（exit 方式）
  const sellIds = [...new Set(tokens.flatMap(t => t.sells.map(s => s.signal_id).filter(Boolean)))];
  const sellMetaById = new Map();
  for (let i = 0; i < sellIds.length; i += 50) {
    const { data } = await sb.from('strategy_signals').select('id,metadata,reason').in('id', sellIds.slice(i, i + 50));
    for (const r of data || []) sellMetaById.set(r.id, { m: r.metadata || {}, reason: r.reason });
  }
  return tokens.map(t => {
    const m = metaById.get(t.buySigId) || {};
    const an = (m.buyPoint || {}).anchors || {};
    let exit = '未平/无卖信号';
    const s0 = t.sells.map(s => sellMetaById.get(s.signal_id)).find(Boolean);
    if (s0) {
      const mm = s0.m || {};
      if (mm.stallClose) exit = 'stallClose:' + (mm.stallClose.tier || 'base');
      else if (mm.burstCooldownInfo || /burst/i.test('' + (s0.reason || ''))) exit = 'burstCooldown';
      else if (/止损/.test('' + (s0.reason || ''))) exit = 'stopLoss';
      else exit = 'sellLeg';
    }
    return { ...t, A: an, exit, lastSellAt: t.sells.length ? t.sells[t.sells.length - 1].created_at : null };
  });
}

(async () => {
  const sb = dbManager.getClient();
  const all = {};
  for (const [name, id] of EXPS) all[name] = await loadSamples(id);
  const num = (s, k) => Number(s.A[k]);
  const fp26 = s => num(s, 'actNearTail5BuyN') <= 1 && num(s, 'win30SellN') >= 5;

  console.log('═══ ① 断流亏损票漏网面（FP26 边界外的衰减带）═══');
  for (const [w, ss] of Object.entries(all)) {
    const stallLose = ss.filter(s => s.exit.startsWith('stallClose') && s.pnl < -0.005);
    const covered = stallLose.filter(fp26);
    const leak = stallLose.filter(s => !fp26(s));
    console.log(`[${w}] stall亏损 ${stallLose.length} 票 Σ${stallLose.reduce((a, s) => a + s.pnl, 0).toFixed(3)} | FP26接 ${covered.length} | 漏 ${leak.length} Σ${leak.reduce((a, s) => a + s.pnl, 0).toFixed(3)}`);
    for (const s of leak.slice(0, 12)) {
      console.log('   ✗', (s.symbol || '').slice(0, 9).padEnd(10), s.pnl.toFixed(4).padStart(7),
        't5N', String(s.A.actNearTail5BuyN).padStart(2), 'selN', String(s.A.win30SellN).padStart(3),
        't10selW', String(s.A.actNearTail10SellWallets ?? '-').padStart(2), 'w30net', String(num(s, 'win30NetBnb')).padStart(7),
        'chg5', String(s.A.chg5Pct).padStart(6), 'age', String(s.A.tokenAgeSec).padStart(4));
    }
  }
  // 边界外衰减带量化：t5N=2 ∧ selN>=5 的效果（三窗）
  console.log('\n-- 衰减带 t5N=2 ∧ selN≥5（FP26 边界外一格）三窗效果 --');
  for (const [w, ss] of Object.entries(all)) {
    const hit = ss.filter(s => num(s, 'actNearTail5BuyN') === 2 && num(s, 'win30SellN') >= 5);
    const stop = hit.filter(s => s.pnl < 0).reduce((a, s) => a + s.pnl, 0);
    const hurt = hit.filter(s => s.pnl >= 0).reduce((a, s) => a + s.pnl, 0);
    console.log(`  [${w}] n=${hit.length} 胜${hit.filter(s => s.pnl > 0.0005).length} 止血${stop.toFixed(3)} 误伤${hurt.toFixed(3)} 净${(stop + hurt).toFixed(3)}`);
  }

  console.log('\n═══ ⑤ 卖后 15min maxRel（出场质量——割在底部的误杀面）═══');
  for (const [w, ss] of Object.entries(all)) {
    const sold = ss.filter(s => s.lastSellAt);
    // 拉卖后 ticks
    for (const s of sold) {
      const sellTs = new Date(s.lastSellAt).toISOString();
      const endTs = new Date(new Date(s.lastSellAt).getTime() + 15 * 60 * 1000).toISOString();
      const { data: ticks } = await sb.from('wss_price_ticks')
        .select('block_time,price_bnb,trade_type')
        .eq('token_address', s.addr).gt('block_time', sellTs).lte('block_time', endTs)
        .order('block_time', { ascending: true }).limit(300);
      const pxs = (ticks || []).map(t => Number(t.price_bnb)).filter(x => x > 0);
      s.postMaxRel = pxs.length ? Math.max(...pxs) / (s.cost > 0 && s.sells && s.sells.length ? Number(s.sells[s.sells.length - 1].output_amount) / 1e9 : pxs[0]) : null;
      // 简化：用卖后最高价 vs 最后卖价（最后卖价用 sell output_amount/数量不可靠，改用卖后首价基准）
      s.postMaxVsFirst = pxs.length >= 2 ? Math.max(...pxs) / pxs[0] - 1 : null;
    }
    const groups = new Map();
    for (const s of sold) {
      const k = s.exit.split(':')[0];
      (groups.get(k) || groups.set(k, []).get(k)).push(s);
    }
    console.log(`\n[${w}]`);
    for (const [k, gs] of groups) {
      const withRel = gs.filter(s => s.postMaxVsFirst != null);
      const med = a => { const v = a.slice().sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : NaN; };
      const big = withRel.filter(s => s.postMaxVsFirst > 0.3).length;
      console.log('  ' + k.padEnd(14), 'n=' + String(gs.length).padStart(3), 'pnlΣ' + gs.reduce((a, s) => a + s.pnl, 0).toFixed(3).padStart(7),
        '| 卖后有价' + withRel.length, '卖后max涨幅 中位' + (med(withRel.map(s => s.postMaxVsFirst)) * 100).toFixed(0) + '%',
        '>+30%' + big + '张');
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
