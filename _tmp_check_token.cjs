const dm = require('./src/services/dbManager.js').dbManager;
(async () => {
  const addr = '0x1684e8f48e3a408d77b02adafddb7acc88b17777';
  const client = dm.getClient();
  const { count: tickCount } = await client
    .from('wss_price_ticks')
    .select('*', { count: 'exact', head: true })
    .eq('token_address', addr);
  console.log('total ticks:', tickCount);
  const { data: first } = await client
    .from('wss_price_ticks')
    .select('id, price_bnb, bnb_amount, trader_address, trade_type, block_time')
    .eq('token_address', addr)
    .order('id', { ascending: true })
    .limit(5);
  console.log('first ticks:', JSON.stringify(first, null, 1));
  const { data: last } = await client
    .from('wss_price_ticks')
    .select('price_bnb, bnb_amount, trade_type, block_time')
    .eq('token_address', addr)
    .order('id', { ascending: false })
    .limit(2);
  console.log('last ticks:', JSON.stringify(last, null, 1));
  // wss_events: token_create / graduation
  const { data: evts } = await client
    .from('wss_events')
    .select('kind, block_time, payload')
    .eq('token_address', addr)
    .in('kind', ['token_create', 'graduation'])
    .order('block_time');
  for (const e of (evts || [])) {
    const p = e.payload || {};
    console.log('event:', e.kind, e.block_time, JSON.stringify({ name: p.name, symbol: p.symbol, creator: p.creator, funds: p.funds_bnb || p.funds, totalSupply: p.total_supply || p.totalSupply }).slice(0, 200));
  }
  // 实验信号
  const { data: sigs } = await client
    .from('strategy_signals')
    .select('id, action, created_at, metadata')
    .eq('experiment_id', '9e413cbe-d60d-43ef-93bb-2889b7261423')
    .eq('token_address', addr)
    .order('created_at');
  if (sigs && sigs.length) {
    for (const s of sigs) {
      const m = s.metadata || {};
      const pbc = m.preBuyCheckFactors || {};
      const earlyKeys = Object.fromEntries(Object.entries(pbc).filter(([k]) => k.startsWith('early') || k.includes('niform') || k.includes('etBuy')));
      console.log('signal:', s.id, s.action, s.created_at, 'early factors:', JSON.stringify(earlyKeys));
    }
  } else {
    console.log('no signals in this experiment for this token');
  }
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
