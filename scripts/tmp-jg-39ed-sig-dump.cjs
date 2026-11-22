#!/usr/bin/env node
// 一次性（本地小结果）：dump 0x39ed…7777 在 bt-v164 的唯一 BUY 信号完整 metadata（查死在哪道门）。只读。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
const ADDR = '0x39ed13ccb5e067b7fce459548501cf2659287777';
(async () => {
  const sb = dbManager.getClient();
  const { data: sigs } = await sb.from('strategy_signals').select('*')
    .eq('experiment_id', EXP).eq('token_address', ADDR);
  for (const s of sigs) {
    const { metadata, ...rest } = s;
    console.log('=== 行字段:', JSON.stringify(rest, null, 1));
    const m = metadata || {};
    for (const k of Object.keys(m)) {
      const v = m[k];
      if (k === 'buyPoint' && v && typeof v === 'object') {
        console.log(`[${k}] passed=${v.passed} status=${v.status} bucket=${v.bucket} rule=${v.rule}`, JSON.stringify(v.reason || v.detail || '').slice(0, 300));
      } else if (k === 'trendFactors' || (v && typeof v === 'object' && Object.keys(v).length > 30)) {
        const pick = {};
        for (const fk of ['currentVsLaunchPct', 'actTotalBnb', 'actBuyBnb', 'actTrades', 'actBuyers', 'tokenAgeSec', 'quietSpanMs', 'quietSurgeBuyBnb', 'quietSurgeSec', 'tradesRouterPct', 'mcapBnb', 'buyPriceBnb', 'chg5Pct', 'athVsLaunchPct']) if (v[fk] !== undefined) pick[fk] = v[fk];
        console.log(`[${k}]`, JSON.stringify(pick));
      } else {
        console.log(`[${k}]`, JSON.stringify(v).slice(0, 500));
      }
    }
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
