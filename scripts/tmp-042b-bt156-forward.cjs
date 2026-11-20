const { dbManager } = require('../src/services/dbManager');
const EXP = 'b8ae9f2e-832f-42db-bbda-8d8701aecb63';
(async () => {
  const c = dbManager.getClient();
  const { data: sigs } = await c.from('strategy_signals')
    .select('token_address,token_symbol,created_at,metadata')
    .eq('experiment_id', EXP).eq('signal_type', 'SELL')
    .eq('metadata->>strategyId', 'sell_2_5')
    .order('created_at', { ascending: true }).limit(50);
  for (const s of sigs || []) {
    if (s.metadata?.execution_status !== 'blocked') continue;
    const tFire = new Date(s.created_at).getTime();
    const { data: near } = await c.from('wss_price_ticks')
      .select('block_time,price_bnb').eq('token_address', s.token_address).eq('price_outlier', false)
      .gt('price_bnb', 0)
      .gte('block_time', new Date(tFire - 30000).toISOString())
      .lte('block_time', new Date(tFire + 1000).toISOString())
      .order('block_time', { ascending: true }).limit(50);
    const pF = near?.length ? near[near.length - 1].price_bnb : null;
    const { data: fwd } = await c.from('wss_price_ticks')
      .select('block_time,price_bnb').eq('token_address', s.token_address).eq('price_outlier', false)
      .gt('price_bnb', 0)
      .gte('block_time', new Date(tFire + 1000).toISOString())
      .lte('block_time', new Date(tFire + 900000).toISOString())
      .order('block_time', { ascending: true }).limit(800);
    const f = fwd || [];
    const peak = f.length ? Math.max(...f.map(x => x.price_bnb)) : null;
    const trough = f.length ? Math.min(...f.map(x => x.price_bnb)) : null;
    const lastP = f.length ? f[f.length - 1].price_bnb : null;
    const { data: trades } = await c.from('trades')
      .select('trade_direction,input_amount,output_amount,unit_price,created_at')
      .eq('experiment_id', EXP).eq('token_address', s.token_address)
      .order('created_at', { ascending: true }).limit(30);
    let cost = 0, got = 0, openTok = 0;
    for (const t of trades || []) {
      if (t.trade_direction === 'buy') { cost += t.input_amount; openTok += t.output_amount; }
      else { got += t.output_amount; openTok -= t.input_amount; }
    }
    console.log(`${s.token_symbol} pp=${s.metadata.profitPercent?.toFixed(1)} | 拦截价=${pF?.toExponential(3)} | 后15min峰=${peak ? ((peak / pF - 1) * 100).toFixed(1) + '%' : '-'} 谷=${trough ? ((trough / pF - 1) * 100).toFixed(1) + '%' : '-'} 末=${lastP ? ((lastP / pF - 1) * 100).toFixed(1) + '%' : '-'} | 实际: cost=${cost.toFixed(2)} got=${got.toFixed(2)} pnl=${(got - cost).toFixed(3)} 余仓=${openTok.toFixed(0)}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
