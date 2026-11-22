#!/usr/bin/env node
// FP41 冒烟：ZKind case_ticks 真数据 → buildSnapshotFromRows → holderHHIEntities
// 端到端验证（同块合并豁免键真实产出；重放对照 0.3475，token 域/BNB 域口径略异量级须对）
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const { buildSnapshotFromRows, computeDerived } = require('../src/market-analysis/cheat-snapshot');

const COLL = 'a8414632-7c24-4762-9253-c49bb0f53105';
const TOKEN = '0xa79e736482f55c89e42000151e04af630f2b7777';
const ANCHOR = '2026-10-04T12:15:20Z';

(async () => {
  const sb = dbManager.getClient();
  const { data: rows, error } = await sb.from('case_ticks')
    .select('tx_hash,log_index,trade_type,bnb_amount,token_amount,price_bnb,block_number,block_time,sender_address,trader_address,platform')
    .eq('collection_id', COLL).eq('token_address', TOKEN)
    .lte('block_time', ANCHOR)
    .order('block_time', { ascending: true }).limit(2000);
  if (error) throw new Error(error.message);
  const snap = buildSnapshotFromRows(rows, { createdAt: '2026-10-04T12:11:50Z', platform: 'flap' }, {});
  const cd = computeDerived(snap, new Set());
  console.log('rows=', rows.length);
  console.log('posHolderCount =', cd.posHolderCount);
  console.log('holderHHI（散户） =', cd.holderHHI);
  console.log('holderHHIEntities（实体） =', cd.holderHHIEntities);
  console.log('circSupplyPct =', cd.circSupplyPct);
  const pass = cd.holderHHI !== null && cd.holderHHI < 0.10
    && cd.holderHHIEntities !== null && cd.holderHHIEntities >= 0.10
    && cd.circSupplyPct !== null && cd.circSupplyPct >= 16.5;
  console.log(pass
    ? '✅ FP41 豁免生效形状（散户低 ∧ 实体高 ∧ 高流通 → 旧版拦/新版放行）'
    : '❌ 形状未达豁免（对照重放值检查口径）');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
