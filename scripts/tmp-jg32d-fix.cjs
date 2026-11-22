#!/usr/bin/env node
// JG-32d 修复：B' 臂 config 从 A 臂整包重建（+strategyId=no-fp 包）
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const ARM_A = '2b5e194b-98bb-4f5d-8d9b-a8d5884ae58b';
const ARM_B2 = 'c4e9f11a-9ce9-46f5-969b-9a935cd16789';
const PACK = 'd0597a27-b2d4-45d6-986b-11430a6b9c08';
(async () => {
  const sb = dbManager.getClient();
  const { data: a } = await sb.from('experiments').select('config').eq('id', ARM_A).limit(1);
  const cfg = JSON.parse(JSON.stringify(a[0].config));
  delete cfg.strategyResolved;
  cfg.name = 'bt-v180-jg32c-b24-nofp';
  cfg.description = 'JG-32d B 臂（重）：FP 因子门关（包 jg32c-b24-nofp）——FP32 豁免后 AF1/cheat/BP 拦截率验证';
  cfg.strategyId = PACK;
  const { error } = await sb.from('experiments').update({ config: cfg, status: 'stopped' }).eq('id', ARM_B2);
  if (error) throw new Error(error.message);
  console.log('B\' config 重建 ✓ backtest=', JSON.stringify(cfg.backtest));
  process.exit(0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
