// 一次性（182 跑）：验 strategy_signals/trades 列名（单行）
const { dbManager } = require('../src/services/dbManager.js');
(async () => {
  const c = await dbManager.getClient();
  const { data: s } = await c.from('strategy_signals').select('*').eq('experiment_id', '11fc182a-b051-4665-857c-5c14e6713334').eq('signal_type', 'BUY').limit(1);
  if (s && s[0]) {
    console.log('SIGNAL_COLS:', Object.keys(s[0]).join(','));
    console.log('strategy_name:', s[0].strategy_name, '| action:', s[0].action);
    const m = typeof s[0].metadata === 'string' ? JSON.parse(s[0].metadata) : s[0].metadata || {};
    console.log('META_KEYS:', Object.keys(m).join(','));
    if (m.factors) console.log('factors.currentVsLaunchPct:', m.factors.currentVsLaunchPct, 'actTotalBnb:', m.factors.actTotalBnb);
    if (m.factorResults) console.log('factorResults.currentVsLaunchPct:', m.factorResults.currentVsLaunchPct);
  } else console.log('无 BUY 行');
  const { data: t } = await c.from('trades').select('*').eq('experiment_id', '11fc182a-b051-4665-857c-5c14e6713334').limit(1);
  if (t && t[0]) console.log('TRADE_COLS:', Object.keys(t[0]).join(','));
  else console.log('无 trades 行（尚未有成交或未 flush）');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
