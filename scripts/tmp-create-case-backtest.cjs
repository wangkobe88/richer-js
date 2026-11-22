#!/usr/bin/env node
/**
 * 一次性脚本：从 bt-v164（T202 标准基底）整包克隆 config 创建 Case 集合回测实验
 * ——只换数据源（backtest 段→caseCollectionId），策略包/门链灰度/机制段全保真。
 * 本地跑（单行读写轻查询）。用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const BASE_ID = '9e9163de-a677-4d39-9c33-9ec9df05e400';       // bt-v164-t202pack-48h-win1003
const COLLECTION_ID = 'a8414632-7c24-4762-9253-c49bb0f53105'; // 大金狗-尽量保证买入
const NEW_NAME = 'bt-v165-case-jindog-b1';

(async () => {
  const db = dbManager.getClient();
  const { data: base, error } = await db.from('experiments').select('*').eq('id', BASE_ID).single();
  if (error || !base) throw new Error('基底实验不存在: ' + BASE_ID);

  const cfg = JSON.parse(JSON.stringify(base.config || {}));
  delete cfg.strategyResolved; // 陈旧审计（clone 同款剥离）
  // 数据源换 Case 集合：时间窗删除（全量回放），maxTickRows/signalGateReal 继承基底
  const keep = {
    caseCollectionId: COLLECTION_ID,
    maxTickRows: cfg.backtest?.maxTickRows,
    signalGateReal: cfg.backtest?.signalGateReal,
  };
  cfg.backtest = keep;
  cfg.platform = base.config?.platform || 'both';

  const row = {
    experiment_name: NEW_NAME,
    experiment_description: 'Case 集合回测：大金狗-尽量保证买入 第一批 8 票（clone bt-v164 整包 config，仅换数据源 backtest.caseCollectionId；时间窗=全量，门链真调继承）',
    status: 'stopped',
    trading_mode: 'backtest',
    strategy_type: base.strategy_type,
    blockchain: base.blockchain || 'bsc',
    kline_type: base.kline_type || '1m',
    config: cfg,
  };
  const { data: inserted, error: insErr } = await db.from('experiments').insert(row).select('id').single();
  if (insErr) throw new Error('插入失败: ' + insErr.message);
  console.log('新实验:', inserted.id, NEW_NAME);
  console.log('backtest 段:', JSON.stringify(cfg.backtest));
  process.exit(0);
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
