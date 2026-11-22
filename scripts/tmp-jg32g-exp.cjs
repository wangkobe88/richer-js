#!/usr/bin/env node
// JG-32g：FP42 兑现对拍实验（bt-v181=clone bt-v178 原样，代码 FP42 生效）
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
(async () => {
  const sb = dbManager.getClient();
  const { data: base } = await sb.from('experiments').select('*').eq('id','2b5e194b-98bb-4f5d-8d9b-a8d5884ae58b').single();
  const cfg = JSON.parse(JSON.stringify(base.config));
  delete cfg.strategyResolved;
  cfg.name = 'bt-v181-jg32f-fp42'; cfg.description = 'JG-32g FP42 兑现对拍：B 形状 24 票集合，现行 v2 包+代码 FP42（big_buy_defer 换手豁免腿）——预期登天猫豁免买入、famous 布局票（丁真/女大/人生指南）仍拒、A 臂 4 票基线不变';
  const row = { experiment_name: 'bt-v181-jg32f-fp42', experiment_description: cfg.description, status: 'stopped', trading_mode: 'backtest', strategy_type: base.strategy_type, blockchain: 'bsc', kline_type: '1m', config: cfg };
  const { data: ins, error } = await sb.from('experiments').insert(row).select('id').single();
  if (error) throw new Error(error.message);
  console.log(ins.id);
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
