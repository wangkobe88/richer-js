#!/usr/bin/env node
/** 一次性小读取：bt-v164 实验窗口/配置 + 信号 token 总数（比较组规模） */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const EXP_ID = '9e9163de-a677-4d39-9c33-9ec9df05e400';

(async () => {
  const db = dbManager.getClient();
  const exp = await db.from('experiments').select('id, display_name, trading_mode, status, config').eq('id', EXP_ID).limit(1);
  if (exp.error) throw new Error(exp.error.message);
  const e = exp.data[0];
  const cfg = e.config || {};
  console.log('name=', e.name, 'mode=', e.trading_mode, 'status=', e.status);
  console.log('backtest=', JSON.stringify(cfg.backtest));
  console.log('platform=', cfg.platform, ' strategyId=', cfg.strategyId);
  // 信号 token 去重数（有信号代币=比较组候选池）
  const sig = await db.from('strategy_signals').select('token_address').eq('experiment_id', EXP_ID);
  if (sig.error) throw new Error(sig.error.message);
  const set = new Set(sig.data.map(r => (r.token_address || '').toLowerCase()).filter(Boolean));
  console.log('signal tokens=', set.size, 'signal rows=', sig.data.length);
  process.exit(0);
})().catch((err) => { console.error('失败:', err.message); process.exit(1); });
