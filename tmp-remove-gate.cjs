require('dotenv').config({ path: './config/.env' });
const { dbManager } = require('./src/services/dbManager');
const { StrategyLibraryService } = require('./src/web/services/StrategyLibraryService');
const GATE = ' AND maxBlockBuyCircPct < 25';
const LIB_ID = '57d0dd71-6bae-47bf-8b74-4cc0bc1084e4';
const EXP_ID = '37b19a9f-10ad-45fb-ab45-c8288e4b492c';
const NOTE = ' | 2026-10-20 用户裁定：先行移除 maxBlockBuyCircPct < 25（全史口径在 111 票回放上 110/111 全拦、11 笔实盘拦 10 含 3 正票，口径待重议）；sybil 大簇门保留';
(async () => {
  const db = dbManager.getClient();
  const svc = new StrategyLibraryService();
  const { data: lib, error: le } = await db.from('strategy_library').select('*').eq('id', LIB_ID).single();
  if (le) throw new Error('lib read: ' + le.message);
  const legs = JSON.parse(JSON.stringify(lib.legs));
  if (legs[0].condition.includes('maxBlockBuyCircPct < 25')) {
    legs[0].condition = legs[0].condition.replace(GATE, '');
    const r = await svc.update(LIB_ID, { name: lib.name, description: (lib.description || '') + NOTE, legs, expectedVersion: lib.version });
    console.log('library updated →', JSON.stringify(r));
  } else console.log('library: gate absent, skip');
  const { data: exp, error: ee } = await db.from('experiments').select('config').eq('id', EXP_ID).single();
  if (ee) throw new Error('exp read: ' + ee.message);
  const cfg = exp.config;
  const buy = cfg.strategiesConfig.buyStrategies[0];
  if (buy.condition.includes('maxBlockBuyCircPct < 25')) {
    buy.condition = buy.condition.replace(GATE, '');
    buy.description = (buy.description || '') + NOTE;
    if (cfg.strategiesConfig.libraryRefs) for (const ref of cfg.strategiesConfig.libraryRefs) if (ref.libId === LIB_ID) ref.version = lib.version + 1;
    const { error: ue } = await db.from('experiments').update({ config: cfg }).eq('id', EXP_ID);
    if (ue) throw new Error('exp update: ' + ue.message);
    console.log('experiment config updated (gate removed)');
  } else console.log('experiment: gate absent, skip');
  console.log('tail:', buy.condition.slice(-150));
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
