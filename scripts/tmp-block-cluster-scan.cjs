// 多块纯买聚集扫描 v2（182 跑，用户三修正口径）：
// 块=fire（首 BUY 信号）前 ∧ 纯买入（块内卖=0）∧ 剔 dust 单笔（<0.015 holderDustBnb 同线）
// 块内非 dust 买笔数 ≥3 的块计数 × 盈亏方向
const { dbManager } = require('../src/services/dbManager.js');

const EXP = 'e5941591-df22-4434-ae29-1a93ced0f841';
const DUST = 0.015;

(async () => {
  const c = await dbManager.getClient();
  const { data: sigs } = await c.from('strategy_signals')
    .select('token_address,created_at,metadata')
    .eq('experiment_id', EXP).eq('signal_type', 'BUY').eq('executed', true)
    .order('created_at', { ascending: true });
  const first = new Map();
  for (const s of (sigs || [])) if (!first.has(s.token_address)) first.set(s.token_address, s);

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
    const fireTs = new Date(sig.created_at).getTime();
    const rows = []; let cursor = 0;
    for (;;) {
      const { data } = await c.from('wss_price_ticks').select(COLS)
        .eq('token_address', addr).gt('id', cursor).order('id', { ascending: true }).limit(1000);
      if (!data || !data.length) break; rows.push(...data); if (data.length < 1000) break;
      cursor = data[data.length - 1].id;
    }
    if (!rows.length) continue;
    rows.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
    // fire 前的行
    const upto = rows.filter(r => new Date(r.block_time).getTime() <= fireTs);
    // 块统计：纯买块（无卖行）内非 dust 买笔数
    const byBlk = new Map();
    for (const r of upto) {
      if (!byBlk.has(r.block_number)) byBlk.set(r.block_number, { buy: 0, sellN: 0, buyBnb: 0, wallets: new Set() });
      const e = byBlk.get(r.block_number);
      if (r.trade_type === 'buy') {
        if ((r.bnb_amount || 0) >= DUST) { e.buy++; e.buyBnb += r.bnb_amount; const w = (r.sender_address || r.trader_address || ''); if (w) e.wallets.add(w); }
      } else e.sellN++;
    }
    let ge3 = 0, ge2 = 0; const hitBlks = [];
    for (const [blk, e] of byBlk) {
      if (e.sellN > 0) continue; // 纯买块
      if (e.buy >= 3) { ge3++; hitBlks.push(blk + '(' + e.buy + '笔/' + e.wallets.size + '户/' + e.buyBnb.toFixed(3) + 'B)'); }
      if (e.buy >= 2) ge2++;
    }
    const p = pnl.get(addr);
    out.push({
      addr, sym: p ? p.sym : '?', pnl: p ? p.sell - p.buy : null, ge3, ge2,
      hits: hitBlks.join(' '), tf: (sig.metadata || {}).trendFactors || {},
    });
  }

  console.log(`票数=${out.length}（口径：fire 前 ∧ 纯买块 ∧ 单笔≥${DUST} ∧ 块内≥3 笔）`);
  for (const n of [2, 3]) {
    const b = out.filter(o => o.ge3 >= n);
    const sum = b.reduce((s, o) => s + (o.pnl || 0), 0);
    const neg = b.filter(o => (o.pnl || 0) < 0).length;
    console.log(`\n≥${n} 个纯买聚集块: ${b.length} 票 Σpnl=${sum.toFixed(4)} 负${neg}/${b.length}`);
    for (const o of b.sort((x, y) => (x.pnl || 0) - (y.pnl || 0)))
      console.log(`  ${(o.pnl || 0) < 0 ? '［−］' : '［+］'} ${o.sym} ${o.addr.slice(0, 10)} ge3=${o.ge3}(ge2=${o.ge2}) pnl=${o.pnl != null ? o.pnl.toFixed(4) : '无'} | clu=${o.tf.launchBundleClusterSize} bigBuy=${o.tf.launchBigBuyBnb} minVs=${o.tf.launchMinVsFloorPct} age=${o.tf.tokenAgeSec}`);
  }
  // 驴来专项打印
  const ll = out.find(o => o.addr.startsWith('0x531ddef1'));
  if (ll) console.log(`\n驴来专项: ge3=${ll.ge3} ge2=${ll.ge2} 块明细=${ll.hits}`);
  // ge2 维度对照
  const b2 = out.filter(o => o.ge2 >= 3 && o.ge3 < 2);
  console.log(`\n对照（ge2≥3 但 ge3<2，宽口径不达线）: ${b2.length} 票 Σpnl=${b2.reduce((s, o) => s + (o.pnl || 0), 0).toFixed(4)}`);
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
