#!/usr/bin/env node
// 一次性：JG-4 候选 0x4509...7777 burst 断流卖出误伤取证（bt-v164 小结果，本地可跑）。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
const TOKEN = '0x4509204c4f82dee14352bf7cfafae4138b287777';
const COLL = 'a8414632-7c24-4762-9253-c49bb0f53105';

(async () => {
  const db = dbManager.getClient();

  // 1) 金狗集合成员资格
  const { data: member } = await db.from('case_collection_tokens')
    .select('token_address, note, sync_state, added_at')
    .eq('collection_id', COLL)
    .eq('token_address', TOKEN);
  console.log('=== 集合成员:', member && member.length ? JSON.stringify(member[0], null, 1).slice(0, 800) : '不在金狗集合');

  // 2) 信号行
  const { data: sigs, error: e1 } = await db.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('created_at', { ascending: true });
  if (e1) throw new Error(e1.message);
  console.log(`\n=== 信号 ${sigs.length} 行`);
  for (const s of sigs) {
    const md = s.metadata || {};
    const brief = {
      id: s.id, type: s.signal_type, action: s.action,
      at: s.created_at, reason: s.reason,
      profitPercent: md.profitPercent, price: md.priceBnb || md.currentPriceBnb,
      stallClose: md.stallClose, burstCooldownArm: md.burstCooldownArm,
      blocked: md.blocked, blockedReason: md.blockedReason,
      factorSellFilter: md.factorSellFilter,
      execStatus: md.execution_status || md.executionStatus, execReason: md.execution_reason,
      mdKeys: Object.keys(md),
    };
    console.log(JSON.stringify(brief));
  }

  // 3) 成交行
  const { data: trades, error: e2 } = await db.from('trades')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('created_at', { ascending: true });
  if (e2) throw new Error(e2.message);
  console.log(`\n=== 成交 ${trades.length} 行`);
  for (const t of trades) {
    console.log(JSON.stringify({
      id: t.id, dir: t.trade_direction, status: t.trade_status, success: t.success,
      in: t.input_amount, out: t.output_amount, unitPrice: t.unit_price,
      at: t.created_at, exec: t.executed_at, symbol: t.token_symbol,
      reason: t.metadata && (t.metadata.reason || t.metadata.closeReason),
    }));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
