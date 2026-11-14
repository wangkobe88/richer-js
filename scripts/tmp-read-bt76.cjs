const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
(async () => {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();
  const { data: exp, error: e1 } = await db.from('experiments')
    .select('id,experiment_name,trading_mode,config').eq('id', 'b67513a8-a389-4297-86d0-868a5b8eab1a').limit(1);
  if (e1) throw new Error(e1.message);
  const cfg = exp[0].config;
  console.log('== bt76:', exp[0].trading_mode, exp[0].config.platform);
  console.log('backtest:', JSON.stringify(cfg.backtest));
  console.log('cheatCheck:', JSON.stringify(cfg.fourmemeWs?.cheatCheck));
  console.log('buyPointCheck:', JSON.stringify(cfg.fourmemeWs?.buyPointCheck));
  console.log('buySignal throttle:', JSON.stringify({ms: cfg.fourmemeWs?.buySignalCooldownMs, ticks: cfg.fourmemeWs?.buySignalCooldownTicks, max: cfg.fourmemeWs?.buySignalMaxPerToken}));
  console.log('tradeAmount:', JSON.stringify(cfg.tradeAmount));
  console.log('positionManagement:', JSON.stringify(cfg.positionManagement));
  console.log('stallClose:', JSON.stringify(cfg.stallClose));
  console.log('sellStrategies:', JSON.stringify((cfg.sellStrategies||[]).map(l => ({name: l.name, priority: l.priority, condition: l.condition, cards: l.cards, bypass: l.bypassDebounce}))));
  console.log('libraryRefs:', JSON.stringify(cfg.strategiesConfig?.libraryRefs));
  console.log('buyLegs:', JSON.stringify((cfg.buyStrategies||[]).map(l => ({name: l.name, priority: l.priority, condition: l.condition}))));
  const { data: lib, error: e2 } = await db.from('strategy_library')
    .select('id,name,version,legs,description').eq('name', 'signal-source-ladder-v1').order('version', { ascending: false }).limit(1);
  if (e2) throw new Error(e2.message);
  console.log('== lib:', lib[0].name, 'version', lib[0].version, 'id', lib[0].id);
  const legs = typeof lib[0].legs === 'string' ? JSON.parse(lib[0].legs) : lib[0].legs;
  for (const l of legs) console.log(`  p${l.priority} ${l.condition} gate=${JSON.stringify(l.signalGate)} phase=${l.buyPhase}`);
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
