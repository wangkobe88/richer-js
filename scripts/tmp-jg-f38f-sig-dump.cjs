#!/usr/bin/env node
// 一次性（本地小结果）：dump 0xf38f…7777 在 bt-v177 的全部信号完整 metadata（查死在哪道门）。只读。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const EXP = '4d74f39e-4055-4adb-afa3-de8a22bb9f49';
const ADDR = '0xf38f48cfe9e84920e7de4d47823a0fba95a87777';
(async () => {
  const sb = dbManager.getClient();
  const { data: sigs } = await sb.from('strategy_signals').select('*')
    .eq('experiment_id', EXP).eq('token_address', ADDR);
  console.log('信号行数:', (sigs || []).length);
  for (const s of sigs) {
    const { metadata, ...rest } = s;
    console.log('\n=== 行字段:', JSON.stringify(rest, null, 1));
    const m = metadata || {};
    for (const k of Object.keys(m)) {
      const v = m[k];
      if (k === 'buyPoint' && v && typeof v === 'object') {
        console.log(`[${k}] passed=${v.passed} status=${v.status} bucket=${v.bucket} rule=${v.rule}`, JSON.stringify(v.reason || v.detail || '').slice(0, 300));
      } else if (k === 'trendFactors' || (v && typeof v === 'object' && Object.keys(v).length > 30)) {
        const pick = {};
        for (const fk of ['currentVsLaunchPct', 'actTotalBnb', 'actBuyBnb', 'actSellBnb', 'actTrades', 'actBuyers', 'actSellers', 'tokenAgeSec', 'quietSpanMs', 'quietSurgeBuyBnb', 'quietSurgeSec', 'tradesRouterPct', 'mcapBnb', 'buyPriceBnb', 'chg5Pct', 'athVsLaunchPct', 'holdersExDust', 'tradesNetBuyRatioLongWin', 'tradesNetBuyRatioShortWin']) if (v[fk] !== undefined) pick[fk] = v[fk];
        console.log(`[${k}]`, JSON.stringify(pick));
      } else {
        console.log(`[${k}]`, JSON.stringify(v).slice(0, 800));
      }
    }
  }
  // 顺带查 token_create 与毕业事件，了解票的基本盘
  const { data: evs } = await sb.from('wss_events').select('kind,block_time,payload')
    .eq('token_address', ADDR).in('kind', ['token_create', 'graduation']).limit(5);
  for (const e of evs || []) {
    const p = e.payload || {};
    console.log('\n[event]', e.kind, e.block_time, JSON.stringify({ name: p.name, symbol: p.symbol, platform: p.platform }).slice(0, 200));
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
