// 0x2b63 大量捆绑砸盘尾声票取证（b8ae9f2e 实验）
const { dbManager } = require('../src/services/dbManager');
const EXP = 'b8ae9f2e-832f-42db-bbda-8d8701aecb63';
const TOKEN = '0x2b63c82ed1eb65e6298031c8cf5c307c26307777';

function walletOf(r) { return (r.sender_address || r.trader_address || '').toLowerCase(); }

async function main() {
  const sb = dbManager.getClient();

  // 1. token_create 事件
  const { data: evs } = await sb.from('wss_events').select('kind,block_time,payload')
    .eq('token_address', TOKEN).in('kind', ['token_create', 'graduation']).order('block_time');
  for (const e of evs || []) {
    const p = e.payload || {};
    console.log('EVENT', e.kind, e.block_time, '| platform=', p.platform, '| symbol=', p.symbol, '| name=', p.name);
  }

  // 2. trades
  const { data: trades } = await sb.from('trades').select('*').eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at');
  for (const t of trades || []) {
    const m = t.metadata || {};
    console.log('TRADE', t.created_at, t.trade_direction, '| status=', t.trade_status, '| in=', t.input_amount, '| out=', t.output_amount,
      '| unit=', t.unit_price, '| success=', t.success, '| pnlBnb=', m.pnlBnb, 'pp=', m.profitPercent, '| why=', m.why || m.sellReason || '');
  }

  // 3. 信号行
  const { data: sigs } = await sb.from('strategy_signals').select('created_at,signal_type,reason,price,execution_status,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at');
  for (const s of sigs || []) {
    const m = s.metadata || {};
    if (s.signal_type === 'BUY') {
      console.log('\nSIG BUY', s.created_at, s.reason, '| price=', s.price, '| exec=', s.execution_status);
      console.log('  signalGate:', JSON.stringify(m.signalGate));
      console.log('  factorCheck:', JSON.stringify(m.factorCheck));
      console.log('  actFront:', JSON.stringify(m.actFrontGate));
      console.log('  cheat:', JSON.stringify(m.cheatCheck));
      console.log('  buyPoint:', JSON.stringify(m.buyPoint));
      const fr = m.factorResults || m.factors || {};
      const keys = ['tradeCount', 'buyVolumeBnb', 'actTotalBnb', 'currentVsLaunchPct', 'tokenAgeSec', 'holdersExDust',
        'tradesNetBuyRatioLongWin', 'tradesNetBuyRatioShortWin', 'launchBundleClusterSize', 'launchFirstBlockWallets', 'launchFirstWaveWallets', 'launchMinVsFloorPct'];
      console.log('  factors:', keys.map(k => k + '=' + fr[k]).join(' '));
    } else if (s.signal_type === 'SELL') {
      console.log('\nSIG SELL', s.created_at, s.reason, '| price=', s.price, '| exec=', s.execution_status,
        '| stallClose=', JSON.stringify(m.stallClose), '| pp=', m.profitPercent);
      if (m.factorSellFilter) console.log('  factorSellFilter:', JSON.stringify(m.factorSellFilter));
    }
  }

  // 4. ticks 全景（单票）
  const { data: ticks, error } = await sb.from('wss_price_ticks')
    .select('block_time,block_number,log_index,price_bnb,bnb_amount,trade_type,price_outlier,sender_address,trader_address')
    .eq('token_address', TOKEN).order('block_time', { ascending: true }).limit(5000);
  if (error) throw error;
  const ts = ticks || [];
  console.log('\n=== ticks total:', ts.length, ts.length ? `${ts[0].block_time} ~ ${ts[ts.length - 1].block_time}` : '');

  if (!ts.length) { process.exit(0); }

  // 可靠价序列
  const rel = ts.filter(t => !t.price_outlier && Number(t.price_bnb) > 0);
  let firstPx = null, ath = 0, athT = null, mn = Infinity, mnT = null;
  for (const t of rel) {
    const p = Number(t.price_bnb);
    if (firstPx === null) firstPx = p;
    if (p > ath) { ath = p; athT = t.block_time; }
    if (p < mn) { mn = p; mnT = t.block_time; }
  }
  console.log(`firstRel=${firstPx.toExponential(4)} ATH=${ath.toExponential(4)}@${athT} min=${mn.toExponential(4)}@${mnT} ATH%=${((ath / firstPx - 1) * 100).toFixed(1)} min%=${((mn / firstPx - 1) * 100).toFixed(1)}`);

  // 块级聚合
  const byBlock = new Map();
  for (const t of ts) {
    const b = t.block_number;
    if (!byBlock.has(b)) byBlock.set(b, { time: t.block_time, buys: [], sells: [] });
    const rec = { bnb: Number(t.bnb_amount), w: walletOf(t), price: Number(t.price_bnb), out: t.price_outlier };
    if (String(t.trade_type).toUpperCase() === 'BUY') byBlock.get(b).buys.push(rec); else byBlock.get(b).sells.push(rec);
  }
  // 砸盘块：独立卖方 ≥3 或 卖额 ≥0.3
  console.log('\n=== 块级聚合（卖方≥3 或 卖额≥0.3 或 买额≥0.5）：');
  const dumpBlocks = [];
  for (const [b, v] of byBlock) {
    const sellers = new Set(v.sells.map(r => r.w));
    const sellBnb = v.sells.reduce((a, r) => a + r.bnb, 0);
    const buyBnb = v.buys.reduce((a, r) => a + r.bnb, 0);
    const buyers = new Set(v.buys.map(r => r.w));
    if (sellers.size >= 3 || sellBnb >= 0.3 || buyBnb >= 0.5) {
      dumpBlocks.push({ b, time: v.time, nS: sellers.size, sellBnb, buyBnb, nB: buyers.size, nSellT: v.sells.length, nBuyT: v.buys.length });
    }
  }
  dumpBlocks.sort((a, b2) => a.time < b2.time ? -1 : 1);
  for (const d of dumpBlocks) console.log(` blk ${d.b} ${d.time} | 卖方=${d.nS} 卖额=${d.sellBnb.toFixed(3)} (${d.nSellT}笔) | 买方=${d.nB} 买额=${d.buyBnb.toFixed(3)} (${d.nBuyT}笔)`);

  // 买点（首个 BUY trade executed）前后形状
  const buyTrade = (trades || []).find(t => t.trade_direction === 'BUY');
  if (buyTrade) {
    const bt = buyTrade.executed_at || buyTrade.created_at;
    console.log(`\n=== 买点 ${bt} 前后 120s ticks：`);
    const t0 = new Date(bt).getTime();
    for (const t of ts) {
      const dt = new Date(t.block_time).getTime() - t0;
      if (dt >= -120000 && dt <= 180000) {
        console.log(`  ${t.block_time} (${dt >= 0 ? '+' : ''}${(dt / 1000).toFixed(1)}s) ${t.trade_type} px=${Number(t.price_bnb).toExponential(3)} bnb=${Number(t.bnb_amount).toFixed(4)} w=${walletOf(t).slice(0, 10)}${t.price_outlier ? ' [out]' : ''}`);
      }
    }
    // 买点后走势
    const after = rel.filter(t => new Date(t.block_time).getTime() >= t0);
    if (after.length) {
      const buyPx = Number(buyTrade.unit_price || buyTrade.price || 0) || null;
      let mx = 0, mxT = null, last = null, mnA = Infinity;
      for (const t of after) { const p = Number(t.price_bnb); if (p > mx) { mx = p; mxT = t.block_time; } mnA = Math.min(mnA, p); last = p; }
      console.log(`买点后: max=${mx.toExponential(4)}@${mxT} min=${mnA.toExponential(4)} last=${last.toExponential(4)} 末段ts=${after[after.length - 1].block_time}`);
      if (buyPx) console.log(`  以买价 ${buyPx.toExponential(4)} 计: 末=${((last / buyPx - 1) * 100).toFixed(1)}% max=${((mx / buyPx - 1) * 100).toFixed(1)}%`);
    }
  }

  // 5. 钱包层：卖方累计（捆绑团伙指纹）
  const walletSell = new Map(), walletBuy = new Map();
  for (const t of ts) {
    const w = walletOf(t), bnb = Number(t.bnb_amount);
    if (String(t.trade_type).toUpperCase() === 'BUY') walletBuy.set(w, (walletBuy.get(w) || 0) + bnb);
    else walletSell.set(w, (walletSell.get(w) || 0) + bnb);
  }
  const topSellers = [...walletSell.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 15);
  console.log('\n=== Top 卖方（累计）：');
  for (const [w, v] of topSellers) console.log(`  ${w} sell=${v.toFixed(4)} buy=${(walletBuy.get(w) || 0).toFixed(4)}`);
  // 同块等额捆绑指纹：块内卖方金额 toFixed(4) 相同
  console.log('\n=== 同块等额簇（≥3 钱包 同块 金额 4 位小数相同）：');
  for (const [b, v] of byBlock) {
    const buckets = new Map();
    for (const r of v.sells) { const k = r.bnb.toFixed(4); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(r.w); }
    for (const [k, ws] of buckets) if (new Set(ws).size >= 3) console.log(`  blk ${b} ${v.time} 等额 ${k} x ${new Set(ws).size} 钱包（卖）`);
    const bb = new Map();
    for (const r of v.buys) { const k = r.bnb.toFixed(4); if (!bb.has(k)) bb.set(k, []); bb.get(k).push(r.w); }
    for (const [k, ws] of bb) if (new Set(ws).size >= 3) console.log(`  blk ${b} ${v.time} 等额 ${k} x ${new Set(ws).size} 钱包（买）`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
