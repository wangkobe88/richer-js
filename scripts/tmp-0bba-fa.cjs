'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const FA = require('../src/services/FourMemeFactorAggregator');
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');

const ADDR = '0x0bba00ba64c147a6477fd18720b782a640357777';
const COND = "tradeCount >= 6 AND buyVolumeBnb >= 1 AND holdersExDust >= 4 AND currentVsLaunchPct <= 28.5 AND actTotalBnb >= 0.1 AND tokenAgeSec >= 15 AND ((launchBundleClusterSize < 3 AND launchFirstBlockWallets < 2 AND launchFirstWaveWallets < 3) OR (tokenAgeSec > 60 AND sinceFirstTradeSec > 45) OR launchMinVsFloorPct < -10) AND launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10 AND (launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30) AND cheatCrewBuyBnb == 0";
const KEYS = ['tradeCount','buyVolumeBnb','holdersExDust','currentVsLaunchPct','actTotalBnb','tokenAgeSec','launchBundleClusterSize','launchFirstBlockWallets','launchFirstWaveWallets','launchMinVsFloorPct','sinceFirstTradeSec','launchSellBundleClusterSize','launchBuyBundleWaves','launchBuyBundleDominancePct','cheatCrewBuyBnb'];

(async () => {
  const sb = dbManager.getClient();
  const { data: rows, error } = await sb.from('wss_price_ticks')
    .select('block_time, block_number, log_index, trade_type, bnb_amount, token_amount, price_bnb, sender_address, trader_address, tx_hash, price_outlier')
    .eq('token_address', ADDR)
    .gte('block_time', '2026-10-03T11:26:50Z')
    .lt('block_time', '2026-10-03T11:40:00Z')
    .order('block_time', { ascending: true })
    .limit(1000);
  if (error) throw new Error(error.message);
  const ticks = rows.map(r => ({
    token_address: ADDR, trade_type: r.trade_type, trader_address: r.trader_address,
    sender_address: r.sender_address, price_bnb: Number(r.price_bnb), price_usd: null,
    bnb_amount: Number(r.bnb_amount), token_amount: r.token_amount == null ? null : Number(r.token_amount),
    block_number: r.block_number, log_index: r.log_index, tx_hash: r.tx_hash,
    price_outlier: r.price_outlier, timestamp: Date.parse(r.block_time), platform: 'flap',
  }));
  const fa = new FA({ fourmemeWs: { factorParams: { netBuyWinTrades: 12 } } }, console);
  fa.registerToken(ADDR, { createdAtMs: 1791026810000, totalSupply: 1e9, platform: 'flap', symbol: '扁头', name: '猪五花' });
  const ev = new ConditionEvaluator();
  const t0 = 1791026810000;
  let fired = 0;
  const interesting = (ts) => {
    const a = (ts - t0) / 1000;
    return (a >= 4 && a <= 50) || (a >= 250 && a <= 370) || (a >= 470 && a <= 490);
  };
  for (const t of ticks) {
    fa.processTick(t, { emitFactors: false });
    const fm = fa.buildFactorMap(ADDR, t.timestamp);
    if (!fm) { continue; }
    const pass = ev.evaluate(COND, fm);
    if (pass) { fired++; if (fired <= 3) console.log(`★★★ 触发 @a${((t.timestamp - t0) / 1000).toFixed(0)}s`, JSON.stringify(Object.fromEntries(KEYS.map(k => [k, fm[k]])))); }
    else if (interesting(t.timestamp)) {
      console.log(`a${((t.timestamp - t0) / 1000).toFixed(0)}s ` + KEYS.map(k => `${k}=${fm[k]}`).join(' '));
    }
  }
  console.log('触发时刻总数(13min):', fired);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message, e); process.exit(1); });
