#!/usr/bin/env node
// 一次性（本地小结果）：dump 0xb712…7777 在 bt-v164 的 BUY 信号完整 metadata（查死在哪道门/哪个臂）。只读。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
const ADDR = '0xb71209cbe0ba47afdbc0201f2d2647e9919b7777';
(async () => {
  const sb = dbManager.getClient();
  const { data: sigs } = await sb.from('strategy_signals').select('*')
    .eq('experiment_id', EXP).eq('token_address', ADDR);
  console.log(`信号 ${sigs.length} 条`);
  for (const s of sigs) {
    const { metadata, ...rest } = s;
    console.log('\n=== 行字段:', JSON.stringify(rest, null, 1));
    const m = metadata || {};
    for (const k of Object.keys(m)) {
      const v = m[k];
      if (k === 'buyPoint' && v && typeof v === 'object') {
        console.log(`[${k}] passed=${v.passed} status=${v.status} bucket=${v.bucket} rule=${v.rule}`, JSON.stringify(v.reason || v.detail || '').slice(0, 400));
      } else if (k === 'factorCheck' && v && typeof v === 'object') {
        console.log(`[${k}]`, JSON.stringify(v).slice(0, 1200));
      } else if (k === 'trendFactors' || (v && typeof v === 'object' && Object.keys(v).length > 30)) {
        const pick = {};
        for (const fk of ['currentVsLaunchPct', 'athVsLaunchPct', 'actTotalBnb', 'actBuyBnb', 'actTrades', 'actBuyers', 'tokenAgeSec', 'quietSpanMs', 'quietSurgeBuyBnb', 'quietSurgeSec', 'tradesRouterPct', 'mcapBnb', 'buyPriceBnb', 'chg5Pct', 'chg10Pct', 'chg30Pct']) if (v[fk] !== undefined) pick[fk] = v[fk];
        console.log(`[${k}]`, JSON.stringify(pick));
      } else {
        console.log(`[${k}]`, JSON.stringify(v).slice(0, 600));
      }
    }
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
