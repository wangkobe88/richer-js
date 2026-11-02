const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
(async () => {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find((e) => e.name === 'buy-v2');
  const full = await svc.getById(entry.id);
  const legs = full.legs.legs || full.legs;
  const leg = legs[0];
  const show = { ...leg };
  show.condition = `[${String(leg.condition).length} chars] ` + leg.condition;
  console.log(JSON.stringify({ name: full.name, version: full.version, legCount: legs.length, leg: show }, null, 1));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
