'use strict';
// JG-17 补查：信号时刻价格锚（currentVsLaunchPct 等）从 signal metadata 因子段提取
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const TOKEN = '0xe4e4149ed653e10d45d640f14445ae744ffb7777';
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
(async () => {
  const sb = dbManager.getClient();
  const { data: sigs, error } = await sb.from('strategy_signals')
    .select('created_at,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(30);
  if (error) throw new Error(error.message);
  for (const s of (sigs || [])) {
    const md = s.metadata || {};
    const keys = ['currentVsLaunchPct', 'tokenAgeSec', 'actTotalBnb', 'buyPriceBnb', 'marketCapBnb', 'tradesNetBuyRatioShortWin'];
    const out = {};
    const src = md.factors || md.factorValues || md;
    for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
    console.log(s.created_at, JSON.stringify(out));
  }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
