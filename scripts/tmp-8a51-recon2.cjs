// 侦察2:修正列名+拿完整 config 卖腿/fourmemeWs 段
const { dbManager } = require('../src/services/dbManager');
const EXP = '8a51f2fd-e467-4459-9004-18b9486ab567';
(async () => {
  const client = dbManager.getClient();
  const { data: exp } = await client.from('experiments').select('config').eq('id', EXP).single();
  const cfg = exp.config || {};
  const sc = cfg.strategiesConfig || {};
  console.log('=== sellStrategies (names/conditions) ===');
  for (const s of (sc.sellStrategies || [])) {
    console.log('---', s.name, '| bypassDebounce:', JSON.stringify(s.sellDebounce || null), '| cards:', JSON.stringify(s.cards));
    console.log('   condition:', (s.condition || '').slice(0, 500));
  }
  console.log('=== fourmemeWs keys ===', Object.keys(cfg.fourmemeWs || {}).join(','));
  const fw = cfg.fourmemeWs || {};
  console.log('cheatCheck:', JSON.stringify(fw.cheatCheck));
  console.log('buySignal throttle:', JSON.stringify({ ms: fw.buySignalCooldownMs, ticks: fw.buySignalCooldownTicks, max: fw.buySignalMaxPerToken }));
  console.log('stopLoss:', JSON.stringify(fw.stopLoss || cfg.positionManagement?.stopLoss || null));
  console.log('positionManagement:', JSON.stringify(cfg.positionManagement));
  console.log('observationSignals:', JSON.stringify(fw.observationSignals || null));
  // 单行探列名
  const { data: s1 } = await client.from('strategy_signals').select('*').eq('experiment_id', EXP).limit(1);
  if (s1 && s1[0]) console.log('signal cols:', Object.keys(s1[0]).join(','));
  const { data: r1 } = await client.from('narrative_analysis_rounds').select('*').eq('experiment_id', EXP).limit(1);
  if (r1 && r1[0]) console.log('round cols:', Object.keys(r1[0]).join(','));
  const { data: t1 } = await client.from('trades').select('*').eq('experiment_id', EXP).limit(1);
  if (t1 && t1[0]) console.log('trade cols:', Object.keys(t1[0]).join(','));
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
