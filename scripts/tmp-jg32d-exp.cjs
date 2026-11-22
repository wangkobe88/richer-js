#!/usr/bin/env node
// JG-32d：双臂 Case 回测实验创建（本地轻查询）。A=现行 v2 基线；B=FP 门关（factorCheck.enabled:false）
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const BASE_ID = '4d74f39e-4055-4adb-afa3-de8a22bb9f49'; // bt-v177（case 通道+signalGateReal 基底）
const COLL = 'fd3fcb3f-a414-4bdd-a22f-965849f8c59e';
(async () => {
  const sb = dbManager.getClient();
  const { data: base, error } = await sb.from('experiments').select('*').eq('id', BASE_ID).single();
  if (error || !base) throw new Error('基底不存在: ' + error?.message);
  const mk = (name, desc, fpOff) => {
    const cfg = JSON.parse(JSON.stringify(base.config || {}));
    delete cfg.strategyResolved;
    cfg.name = name; cfg.description = desc;
    cfg.backtest = { ...cfg.backtest, caseCollectionId: COLL };
    if (fpOff) {
      // 一层浅合并语义：buyPointCheck 整对象替换，照抄基底值仅换 factorCheck
      cfg.fourmemeWs = { ...cfg.fourmemeWs, buyPointCheck: { gate: { awaitMs: 60000 }, memSource: { enabled: false }, factorCheck: { enabled: false }, settleDelayMs: 0 } };
    }
    return { experiment_name: name, experiment_description: desc, status: 'stopped', trading_mode: 'backtest', strategy_type: base.strategy_type, blockchain: base.blockchain || 'bsc', kline_type: base.kline_type || '1m', config: cfg };
  };
  const rows = [
    mk('bt-v178-jg32c-b24-base', 'JG-32d A 臂：B 形状 24 票现行策略基线（clone bt-v177 整包，case 集合换 jg32c-b24；strategyId 解析取库最新 v2=fpRetry 生效）', false),
    mk('bt-v179-jg32c-b24-nofp', 'JG-32d B 臂：同 A 唯四差异=fourmemeWs.buyPointCheck.factorCheck.enabled:false（FP 因子门关，AF1/cheat/BP 照走）——验证「FP32 豁免后活跃度拦截率」', true),
  ];
  for (const row of rows) {
    const { data: ins, error: e2 } = await sb.from('experiments').insert(row).select('id,experiment_name').single();
    if (e2) throw new Error(row.experiment_name + ' 插入失败: ' + e2.message);
    console.log(ins.id, ins.experiment_name);
  }
  process.exit(0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
