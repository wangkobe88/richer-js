const { dbManager } = require('../src/services/dbManager');
(async () => {
  const c = dbManager.getClient();
  const { data: sigs } = await c.from('strategy_signals')
    .select('token_address,token_symbol,created_at,metadata')
    .eq('experiment_id', 'c73b62be-bb1d-4acf-8002-652e5fb8a507').eq('signal_type', 'SELL')
    .eq('metadata->>strategyId', 'sell_2_5')
    .order('created_at', { ascending: true }).limit(100);
  const done = new Set(['BNCBSI','BIBI','熊二','熊翠花','大美','Ritual','Mity','Winverse AI']);
  for (const s of sigs || []) {
    if (done.has(s.token_symbol)) continue;
    const tFire = new Date(s.created_at).getTime();
    const { data: ticks } = await c.from('wss_price_ticks')
      .select('block_time,price_bnb,price_outlier')
      .eq('token_address', s.token_address)
      .gte('block_time', new Date(tFire - 70000).toISOString())
      .lte('block_time', new Date(tFire + 5000).toISOString())
      .order('block_time', { ascending: true }).limit(400);
    const rel = (ticks || []).filter(x => !x.price_outlier);
    const atFire = [...rel].reverse().find(x => new Date(x.block_time).getTime() <= tFire);
    const fb = [...rel].reverse().find(x => new Date(x.block_time).getTime() <= tFire - 5000);
    const tb = [...rel].reverse().find(x => new Date(x.block_time).getTime() <= tFire - 10000);
    const chg5 = atFire && fb ? ((atFire.price_bnb / fb.price_bnb - 1) * 100) : null;
    const chg10 = atFire && tb ? ((atFire.price_bnb / tb.price_bnb - 1) * 100) : null;
    const fsf = s.metadata?.factorSellFilter || {};
    console.log(`${s.token_sym ?? s.token_symbol} | ${s.created_at.slice(5, 19)} | chg5=${chg5 === null ? 'null' : chg5.toFixed(2)}% chg10=${chg10 === null ? 'null' : chg10.toFixed(2)}% | pp=${(s.metadata?.profitPercent ?? 0).toFixed(1)} sLF=${fsf.sinceLastFamousBigBuySec} sLS=${fsf.sinceLastSmartBigBuySec}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
