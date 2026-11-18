// 多块程序化聚集形状扫描（182 跑）：bt-v143 全部 BUY 成交票出生窗块结构
// ——「≥N 个 3+ 笔块 ∧ 对倒弱」分布与盈亏方向（用户提案：驴来案 5 个 3+ 笔块非自然）
const { dbManager } = require('../src/services/dbManager.js');

const EXP = 'e5941591-df22-4434-ae29-1a93ced0f841';

(async () => {
  const c = await dbManager.getClient();
  const { data: sigs } = await c.from('strategy_signals')
    .select('token_address,created_at,metadata')
    .eq('experiment_id', EXP).eq('signal_type', 'BUY').eq('executed', true)
    .order('created_at', { ascending: true });
  const first = new Map();
  for (const s of (sigs || [])) if (!first.has(s.token_address)) first.set(s.token_address, s);

  // 盈亏
  const tr = []; let from = 0;
  for (;;) {
    const { data } = await c.from('trades')
      .select('token_address,token_symbol,trade_direction,input_amount,output_amount')
      .eq('experiment_id', EXP).eq('success', true).range(from, from + 999);
    if (!data || !data.length) break; tr.push(...data);
    if (data.length < 1000) break; from += 1000;
  }
  const pnl = new Map();
  for (const t of tr) { const e = pnl.get(t.token_address) || { sym: t.token_symbol, buy: 0, sell: 0 }; if (t.trade_direction === 'buy') e.buy += t.input_amount; else e.sell += t.output_amount; pnl.set(t.token_address, e); }

  const COLS = 'id,block_time,block_number,log_index,trade_type,bnb_amount,sender_address,trader_address';
  const out = [];
  for (const [addr, sig] of first) {
    const rows = []; let cursor = 0;
    for (;;) {
      const { data } = await c.from('wss_price_ticks').select(COLS)
        .eq('token_address', addr).gt('id', cursor).order('id', { ascending: true }).limit(1000);
      if (!data || !data.length) break; rows.push(...data); if (data.length < 1000) break;
      cursor = data[data.length - 1].id;
    }
    if (!rows.length) continue;
    rows.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
    const firstTs = new Date(rows[0].block_time).getTime();
    const win = rows.filter(r => new Date(r.block_time).getTime() - firstTs <= 90_000);
    // 每块统计
    const byBlk = new Map();
    const bw = new Map(); // blk|w -> {b,s}
    for (const r of win) {
      if (!byBlk.has(r.block_number)) byBlk.set(r.block_number, { n: 0, buy: 0, sell: 0 });
      const e = byBlk.get(r.block_number); e.n++;
      if (r.trade_type === 'buy') e.buy++; else e.sell++;
      const w = (r.sender_address || r.trader_address || '');
      if (w) { const k = r.block_number + '|' + w; if (!bw.has(k)) bw.set(k, { b: 0, s: 0 }); const x = bw.get(k); if (r.trade_type === 'buy') x.b += r.bnb_amount || 0; else x.s += r.bnb_amount || 0; }
    }
    let both = 0; for (const e of bw.values()) if (e.b > 0 && e.s > 0) both++;
    let ge3 = 0, gt3 = 0, ge3buy = 0, ge3sell = 0;
    for (const e of byBlk.values()) {
      if (e.n >= 3) { ge3++; if (e.buy >= e.sell) ge3buy++; else ge3sell++; }
      if (e.n > 3) gt3++;
    }
    const p = pnl.get(addr);
    out.push({
      addr, sym: p ? p.sym : '?', pnl: p ? p.sell - p.buy : null,
      ge3, gt3, ge3buy, ge3sell, both, blocks: byBlk.size,
      tf: (sig.metadata || {}).trendFactors || {},
    });
  }

  // 分桶：ge3 块数 × 方向
  console.log(`票数=${out.length}`);
  const band = (n) => out.filter(o => o.ge3 >= n && o.both <= 2);
  for (const n of [3, 4, 5, 6, 7]) {
    const b = band(n);
    const sum = b.reduce((s, o) => s + (o.pnl || 0), 0);
    const neg = b.filter(o => (o.pnl || 0) < 0).length;
    console.log(`\n≥${n} 个 3+ 笔块 ∧ 对倒弱(双向≤2): ${b.length} 票，Σpnl=${sum.toFixed(4)}，负票 ${neg}/${b.length}`);
    for (const o of b.sort((x, y) => (x.pnl || 0) - (y.pnl || 0)).slice(0, 12)) {
      console.log(`  ${o.pnl != null && o.pnl < 0 ? '［−］' : '［+］'} ${o.sym} ${o.addr.slice(0, 10)} ge3=${o.ge3}(买${o.ge3buy}/卖${o.ge3sell}) gt3=${o.gt3} 对倒=${o.both} 块数=${o.blocks} pnl=${o.pnl != null ? o.pnl.toFixed(4) : '无'} | clu=${o.tf.launchBundleClusterSize} bigBuy=${o.tf.launchBigBuyBnb} minVs=${o.tf.launchMinVsFloorPct} f0=${o.tf.launchFirstBlockWallets}`);
    }
  }
  // 对照：ge3>=5 但对倒强（双向>2）
  const strong = out.filter(o => o.ge3 >= 5 && o.both > 2);
  console.log(`\n对照（≥5 个 3+ 笔块 但对倒强>2 组）: ${strong.length} 票 Σpnl=${strong.reduce((s, o) => s + (o.pnl || 0), 0).toFixed(4)}`);
  for (const o of strong) console.log(`  ${o.sym} ${o.addr.slice(0, 10)} ge3=${o.ge3} 对倒=${o.both} pnl=${(o.pnl || 0).toFixed(4)}`);
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
