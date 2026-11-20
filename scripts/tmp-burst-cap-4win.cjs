const { dbManager } = require('../src/services/dbManager');

const WINS = [
  { k: 'v155', id: 'dddbe79e-480a-402a-aa35-85a72d2f591e' },
  { k: 'v156', id: 'b8ae9f2e-832f-42db-bbda-8d8701aecb63' },
  { k: 'v140', id: '6e75ed6d-807a-4164-9551-d3b95d1fc37b' },
  { k: 'v145', id: '2448116a-bebe-457d-9d8a-b4556c9a8e0d' },
];

async function pullSigs(sb, expId) {
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb.from('strategy_signals').select('*')
      .eq('experiment_id', expId).eq('signal_type', 'BUY')
      .order('created_at', { ascending: true }).range(from, from + 999);
    if (error) throw error;
    if (!data || !data.length) break;
    all.push(...data); from += 1000;
    if (data.length < 1000) break;
  }
  return all;
}
async function pullTrades(sb, expId) {
  const map = new Map();
  let from = 0;
  while (true) {
    const { data, error } = await sb.from('trades').select('*')
      .eq('experiment_id', expId).order('created_at').range(from, from + 999);
    if (error) throw error;
    if (!data || !data.length) break;
    for (const t of data) {
      if (!map.has(t.token_address)) map.set(t.token_address, { b: 0, s: 0, nBuy: 0 });
      const o = map.get(t.token_address);
      if (t.trade_direction === 'buy' && t.success) { o.b += Number(t.input_amount); o.nBuy++; }
      if (t.trade_direction === 'sell' && t.success) o.s += Number(t.output_amount);
    }
    from += 1000;
    if (data.length < 1000) break;
  }
  return map;
}

async function main() {
  const sb = dbManager.getClient();
  const rows = []; // 去重键 = token + 首信号日期
  const seen = new Map();
  for (const w of WINS) {
    const sigs = await pullSigs(sb, w.id);
    const trades = await pullTrades(sb, w.id);
    // 首信号 per token
    const first = new Map();
    for (const s of sigs) if (!first.has(s.token_address)) first.set(s.token_address, s);
    for (const [tok, s] of first) {
      const dedupKey = tok + '|' + (s.created_at || '').slice(0, 13); // token+小时
      if (seen.has(dedupKey)) continue;
      seen.set(dedupKey, 1);
      const m = s.metadata || {};
      const bp = m.buyPoint || {};
      const an = bp.anchors || {};
      const dim = bp.dimensions || {};
      const tf = m.trendFactors || {};
      const t = trades.get(tok);
      rows.push({
        win: w.k, tok, t: s.created_at,
        fireChg5: tf.chg5Pct, fireChg30: tf.chg30Pct, fireCurVs: tf.currentVsLaunchPct,
        anchorChg5: an.chg5Pct, anchorCurVs: an.currentVsLaunchPct, athVs: an.athVsLaunchPct,
        idle: an.actIdlePct, tvm: an.totalVolumeBnb, age: an.tokenAgeSec,
        burstN: an.burst5N, burstBnb: an.burst5BuyBnb,
        shape: dim.entry_shape && dim.entry_shape.bucket,
        sbw: (m.cheatCheck && m.cheatCheck.levels && m.cheatCheck.levels.stallBurstWave) ?? (m.actFrontGate && m.actFrontGate.sbw),
        afAct: m.actFrontGate && m.actFrontGate.act,
        bought: !!t && t.nBuy > 0,
        pnl: t ? +(t.s - t.b).toFixed(4) : null,
      });
    }
  }
  const bought = rows.filter(r => r.bought);
  const sum = a => a.reduce((x, r) => x + (r.pnl || 0), 0);
  console.log(`四窗 BUY 首 signal 票数(去重): ${rows.length} | 成交 ${bought.length} | pnlΣ=${sum(bought).toFixed(4)}`);

  // 方向1: 锚 chg5 分桶
  console.log('\n== 方向1: BP锚 chg5(门链拉数时刻波斜率) 分桶 ==');
  const buckets = [[0, 15], [15, 25], [25, 35], [35, 55], [55, 999]];
  for (const [lo, hi] of buckets) {
    const g = bought.filter(r => typeof r.anchorChg5 === 'number' && r.anchorChg5 >= lo && r.anchorChg5 < hi);
    if (!g.length) { console.log(`  chg5 [${lo},${hi}): 无`); continue; }
    const w = g.filter(r => r.pnl > 0).length;
    console.log(`  chg5 [${lo},${hi}): ${String(g.length).padStart(3)}票 pnlΣ=${sum(g).toFixed(4).padStart(8)} 胜${w}/${g.length}`);
  }
  // spike 桶内分桶
  console.log('\n== spike 桶内 chg5 分桶 ==');
  const sp = bought.filter(r => r.shape === 'spike');
  for (const [lo, hi] of buckets) {
    const g = sp.filter(r => typeof r.anchorChg5 === 'number' && r.anchorChg5 >= lo && r.anchorChg5 < hi);
    if (!g.length) continue;
    console.log(`  chg5 [${lo},${hi}): ${String(g.length).padStart(3)}票 pnlΣ=${sum(g).toFixed(4).padStart(8)} 胜${g.filter(r=>r.pnl>0).length}/${g.length} | 票: ${g.map(r => r.tok.slice(0, 8) + (r.pnl > 0 ? '+' : '') + r.pnl).join(' ')}`);
  }
  // 薄盘×猛spike 交叉（tvm<3B）
  console.log('\n== 薄盘(tvm<3B) × 锚chg5 分桶 ==');
  const thin = bought.filter(r => typeof r.tvm === 'number' && r.tvm < 3);
  for (const [lo, hi] of buckets) {
    const g = thin.filter(r => typeof r.anchorChg5 === 'number' && r.anchorChg5 >= lo && r.anchorChg5 < hi);
    if (!g.length) continue;
    console.log(`  chg5 [${lo},${hi}): ${String(g.length).padStart(3)}票 pnlΣ=${sum(g).toFixed(4).padStart(8)} 胜${g.filter(r=>r.pnl>0).length}/${g.length}`);
  }
  // burst5 涨幅代理：锚 chg5 >=25 的票明细（跨窗）
  console.log('\n== 锚chg5>=25 全部成交票明细 ==');
  for (const r of bought.filter(r => r.anchorChg5 >= 25).sort((a, b) => a.anchorChg5 - b.anchorChg5)) {
    console.log(`  ${r.win} ${r.tok.slice(0, 10)} chg5=${r.anchorChg5} fireChg5=${r.fireChg5} fireVs=${r.fireCurVs} shape=${r.shape} sbw=${r.sbw} af=${r.afAct} idle=${r.idle} tvm=${r.tvm}B burst=${r.burstN}w/${r.burstBnb}B pnl=${r.pnl}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
