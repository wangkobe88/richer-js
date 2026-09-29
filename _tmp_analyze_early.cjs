const { dbManager } = require('./src/services/dbManager.js');
(async () => {
  const addr = '0x1684e8f48e3a408d77b02adafddb7acc88b17777';
  const createdMs = new Date('2026-09-28T20:04:13+00:00').getTime();
  const client = dbManager.getClient();
  const { data: ticks, error } = await client
    .from('wss_price_ticks')
    .select('id, price_bnb, price_usd, bnb_amount, token_amount, trader_address, trade_type, block_time, tx_hash, log_index, price_outlier')
    .eq('token_address', addr)
    .order('block_time', { ascending: true })
    .order('log_index', { ascending: true });
  if (error) throw new Error(error.message);
  console.log('total rows:', ticks.length);

  // ===== 价格轨迹(每 60s 一个点) =====
  let lastP = null;
  const pricePath = [];
  ticks.forEach(t => { lastP = t.price_bnb; });
  const firstP = ticks[0].price_bnb, maxP = Math.max(...ticks.map(t=>t.price_bnb)), minP = Math.min(...ticks.map(t=>t.price_bnb));
  console.log(`\n===== 价格轨迹 =====`);
  console.log(`首价 ${firstP.toExponential(4)} BNB, 峰值 ${maxP.toExponential(4)} (+${((maxP/firstP-1)*100).toFixed(1)}%), 谷值 ${minP.toExponential(4)}, 终价 ${lastP.toExponential(4)} (${((lastP/firstP-1)*100).toFixed(1)}%)`);
  // 时间分布
  const lastMs = new Date(ticks[ticks.length-1].block_time).getTime();
  console.log(`tick 时间跨度: ${(lastMs-createdMs)/1000/60|0} 分钟; 前90s ticks: ${ticks.filter(t=>new Date(t.block_time).getTime()-createdMs<=90000).length}, 6h后: ${ticks.filter(t=>new Date(t.block_time).getTime()-createdMs>6*3600000).length}`);

  // ===== 钱包聚合(全周期) =====
  const wallets = new Map();
  for (const t of ticks) {
    const w = t.trader_address.toLowerCase();
    if (!wallets.has(w)) wallets.set(w, { buyBnb: 0, sellBnb: 0, buyN: 0, sellN: 0, firstMs: new Date(t.block_time).getTime(), lastMs: 0 });
    const e = wallets.get(w);
    const ms = new Date(t.block_time).getTime();
    e.lastMs = Math.max(e.lastMs, ms);
    if (t.trade_type === 'buy') { e.buyBnb += t.bnb_amount; e.buyN++; } else { e.sellBnb += t.bnb_amount; e.sellN++; }
  }
  console.log(`\n===== 钱包聚合(全周期, 共 ${wallets.size} 钱包) =====`);
  const sorted = [...wallets.entries()].sort((a,b) => (b[1].buyBnb+b[1].sellBnb) - (a[1].buyBnb+a[1].sellBnb));
  for (const [w, e] of sorted.slice(0, 25)) {
    const net = e.buyBnb - e.sellBnb;
    console.log(`${w.slice(0,10)}… 买 ${e.buyBnb.toFixed(4)} BNB(${e.buyN}笔) 卖 ${e.sellBnb.toFixed(4)}(${e.sellN}笔) 净 ${net>=0?'+':''}${net.toFixed(4)}  首笔+${((e.firstMs-createdMs)/1000).toFixed(0)}s 末笔+${((e.lastMs-createdMs)/60000).toFixed(1)}min`);
  }

  // ===== 前 90s 窗口分析(创建锚定) =====
  const w90 = ticks.filter(t => new Date(t.block_time).getTime() - createdMs <= 90000 && t.price_outlier === false && t.price_usd !== null);
  console.log(`\n===== 前90s 窗口(创建锚定, ${w90.length} 笔有效) =====`);
  // 同额度簇(复刻 _calculateUniformBuyCluster)
  const buyByWallet = new Map();
  for (const t of w90) {
    if (t.trade_type !== 'buy') continue;
    const k = t.trader_address.toLowerCase();
    buyByWallet.set(k, (buyByWallet.get(k) || 0) + t.bnb_amount);
  }
  const amounts = [...buyByWallet.entries()].filter(([,a]) => a >= 0.01);
  const buckets = new Map();
  for (const [w, a] of amounts) {
    const k = a.toFixed(2);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(w);
  }
  console.log(`买入钱包(≥0.01 BNB): ${amounts.length}; 同额度簇:`);
  for (const [k, ws] of [...buckets.entries()].sort((a,b)=>b[1].length-a[1].length).slice(0, 8)) {
    if (ws.length >= 2) console.log(`  ${k} BNB × ${ws.length} 钱包: ${ws.map(w=>w.slice(0,8)).join(', ')}`);
  }
  // 前90s 净流入
  let b90=0, s90=0;
  for (const t of w90) { if (t.trade_type==='buy') b90+=t.bnb_amount; else s90+=t.bnb_amount; }
  console.log(`前90s 买 ${b90.toFixed(3)} BNB / 卖 ${s90.toFixed(3)} BNB, 净流入 ${((b90-s90)/b90*100).toFixed(1)}%`);

  // ===== 早期买家(前90s买入≥0.05)后续卖出行为 =====
  console.log(`\n===== 早期买家(前90s 买≥0.05 BNB)的全周期行为 =====`);
  for (const [w, a] of amounts.filter(([,a])=>a>=0.05).sort((x,y)=>y[1]-x[1])) {
    const e = wallets.get(w);
    const sells = ticks.filter(t => t.trader_address.toLowerCase()===w && t.trade_type==='sell');
    const sellOutMs = sells.length ? ((new Date(sells[sells.length-1].block_time).getTime()-createdMs)/60000).toFixed(1) : '-';
    console.log(`${w} 买${a.toFixed(3)} 卖${e.sellBnb.toFixed(3)}(${e.sellN}笔) 清仓于+${sellOutMs}min ${e.sellBnb>e.buyBnb*0.8?'← 高比例卖出':''}`);
  }

  // ===== 实验交易记录 =====
  const { data: trades } = await client
    .from('trades')
    .select('action, amount_bnb, price_bnb, token_amount, created_at, metadata')
    .eq('experiment_id', '9e413cbe-d60d-43ef-93bb-2889b7261423')
    .eq('token_address', addr)
    .order('created_at');
  console.log(`\n===== 实验交易 =====`);
  let buyB=0, sellB=0;
  for (const t of (trades||[])) {
    if (t.action==='buy') buyB+=parseFloat(t.amount_bnb); else sellB+=parseFloat(t.amount_bnb);
    console.log(`${t.created_at} ${t.action} ${t.amount_bnb} BNB @ ${t.price_bnb.toExponential(3)}`);
  }
  console.log(`净投入 ${(buyB-sellB).toFixed(4)} BNB`);

  // ===== 钱包标签查询 =====
  const addrs = sorted.slice(0, 15).map(([w]) => w);
  const { data: labels } = await client
    .from('wallets')
    .select('address, label, tags, risk_level')
    .in('address', addrs);
  console.log(`\n===== 钱包标签 =====`);
  console.log(JSON.stringify(labels, null, 1));
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
