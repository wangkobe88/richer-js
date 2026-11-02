const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
(async () => {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find((e) => e.name === 'buy-v2-repeat');
  if (!entry) { console.error('buy-v2-repeat NOT FOUND'); process.exit(1); }
  const full = await svc.getById(entry.id);
  const legs = full.legs.legs || full.legs;
  const out = { name: full.name, version: full.version, legCount: legs.length };
  out.legs = legs.map((leg) => ({
    name: leg.name, priority: leg.priority, buyPhase: leg.buyPhase,
    amountBnb: leg.amountBnb, maxExecutions: leg.maxExecutions,
    condition: leg.condition, narrativeTriggerCondition: leg.narrativeTriggerCondition,
    gmgnCheckCondition: leg.gmgnCheckCondition,
  }));
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
