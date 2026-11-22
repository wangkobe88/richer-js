#!/usr/bin/env node
// JG-32d：废弃误跑 B 臂 + 建 B' 臂 bt-v180（no-fp 包）
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const OLD_B = 'ef2f5af0-5ab7-4577-8028-4ea9a51b889f';
const PACK = 'd0597a27-b2d4-45d6-986b-11430a6b9c08';
(async () => {
  const sb = dbManager.getClient();
  const { data: old } = await sb.from('experiments').select('config,experiment_description').eq('id', OLD_B).limit(1);
  const cfg = JSON.parse(JSON.stringify(old[0].config));
  delete cfg.strategyResolved;
  cfg.strategyId = PACK;
  cfg.fourmemeWs = { ...cfg.fourmemeWs }; // factorCheck.enabled:false 保留（无效果但表意）
  const row = { experiment_name: 'bt-v180-jg32c-b24-nofp', experiment_description: 'JG-32d B 臂（重）：B 形状 24 票 FP 因子门关（策略包 jg32c-b24-nofp=trading-standard-v1 v2 减 modules.factorCheck）——验证 FP32 豁免后 AF1/cheat/BP 拦截率；前误跑臂 ef2f5af0（config 灰度被包覆盖=实际 A 重复）作废留档', status: 'stopped', trading_mode: 'backtest', strategy_type: 'backtest', blockchain: 'bsc', kline_type: '1m', config: cfg };
  const { data: ins, error: e2 } = await sb.from('experiments').insert(row).select('id').single();
  if (e2) throw new Error(e2.message);
  console.log('B\' 臂:', ins.id);
  await sb.from('experiments').update({ status: 'stopped', experiment_description: '【作废-误跑】JG-32d B 臂首跑：config.factorCheck.enabled:false 被包 modules 键覆盖（BacktestEngine:640 _packMod）=实际与 A 臂同配置；真实 B 臂=bt-v180。保留行不删（红线）' }).eq('id', OLD_B);
  console.log('旧臂已标记作废');
  process.exit(0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
