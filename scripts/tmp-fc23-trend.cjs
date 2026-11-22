'use strict';
// 0xfc23：完整 trendFactors（找 holdersExDust / launch* / tradeCount）
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const TOKEN = '0xfc23bfc0371d8296d26d034a4e8b155661a57777';
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
const WANT = ['tradeCount', 'holdersExDust', 'holders', 'launchBundleClusterSize', 'launchFirstBlockWallets', 'launchFirstWaveWallets', 'launchMinVsFloorPct', 'launchSellBundleClusterSize', 'launchBuyBundleWaves', 'launchBuyBundleDominancePct', 'sinceFirstTradeSec', 'buyVolumeBnb', 'currentVsLaunchPct', 'recentBlockDropPct', 'mcapFromPeakPct', 'quietSpanMs', 'quietSurgeBuyBnb', 'quietSurgeSec', 'cheatCrewBuyBnb', 'cheatCrewWallets', 'copyWalletBuyBnb', 'buyWallets'];
(async () => {
  const sb = dbManager.getClient();
  const { data: sigs, error } = await sb.from('strategy_signals')
    .select('created_at,metadata').eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(10);
  if (error) throw new Error(error.message);
  for (const s of (sigs || [])) {
    const tf = (s.metadata || {}).trendFactors || {};
    console.log(`\n===== ${s.created_at} =====`);
    for (const k of WANT) console.log(`  ${k} = ${tf[k]}`);
    // 万一键名不同，打印全部含 launch/holder/trade/quiet 的键
    const extra = Object.keys(tf).filter(k => /launch|holder|trade|quiet|ExDust/i.test(k) && !WANT.includes(k));
    for (const k of extra) console.log(`  (extra) ${k} = ${JSON.stringify(tf[k]).slice(0, 120)}`);
  }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
