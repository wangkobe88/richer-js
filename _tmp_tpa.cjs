const { dbManager } = require('./src/services/dbManager.js');
(async () => {
  const exp = '9e413cbe-d60d-43ef-93bb-2889b7261423';
  const addr = '0x1684e8f48e3a408d77b02adafddb7acc88b17777';
  const client = dbManager.getClient();
  // 1. 实验 config
  const { data: e } = await client.from('experiments').select('name, config').eq('id', exp).single();
  const cfg = e.config || {};
  console.log('实验:', e.name);
  console.log('tokenPositionAnalyzer 段:', JSON.stringify(cfg.tokenPositionAnalyzer ?? '(不存在)'));
  console.log('stopLoss 段:', JSON.stringify(cfg.stopLoss ?? '(不存在)'));
  console.log('tokenCycle 段:', cfg.tokenCycle ? '存在 enforce=' + cfg.tokenCycle.enforce : '(不存在)');
  // 买策略 condition 是否引用 TPAPre
  const buys = (cfg.strategiesConfig || cfg.strategies || {}).buy || cfg.buyStrategies || [];
  const sc = cfg.strategiesConfig || {};
  const buyLegs = sc.buyStrategies || [];
  for (const b of buyLegs) {
    console.log('\n买腿:', b.id, '| condition:', (b.condition || '').slice(0, 200));
    console.log('  preBuyCheckCondition:', b.preBuyCheckCondition || '(无)');
  }
  // 2. buy signal 完整 metadata
  const { data: sig } = await client.from('strategy_signals')
    .select('id, metadata').eq('id', 'e4ccba33-fde0-41f8-96e3-42d605620a5c').single();
  const m = sig.metadata || {};
  console.log('\n===== buy signal metadata keys =====');
  console.log(Object.keys(m).join(', '));
  const tpaKeys = Object.fromEntries(Object.entries(m).filter(([k]) => k.toLowerCase().includes('tpa') || k.startsWith('TPAPre')));
  console.log('TPA 相关:', JSON.stringify(tpaKeys));
  console.log('trendFactors:', JSON.stringify((m.trendFactors || {}).tokenCycle !== undefined ? {cycle: m.trendFactors.tokenCycle} : '(无cycle)'));
  // 3. token_position_analyses
  const { data: tpa, error: tpaErr } = await client.from('token_position_analyses')
    .select('trigger_no, triggered_at, verdict, holding_factors')
    .eq('experiment_id', exp).eq('token_address', addr);
  console.log('\n===== token_position_analyses =====', tpaErr ? 'ERR ' + tpaErr.message : JSON.stringify(tpa));
  // 4. 表是否真空
  const { count } = await client.from('wallet_offline_profiles').select('address', { count: 'exact', head: true });
  console.log('\nwallet_offline_profiles 行数:', count);
  process.exit(0);
})().catch(err => { console.error('ERR', err); process.exit(1); });
