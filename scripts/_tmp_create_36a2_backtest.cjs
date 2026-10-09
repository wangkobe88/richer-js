#!/usr/bin/env node
// ============================================================================
// 一次性：用 3e8460f1（R1 lag 门臂）的策略整包，回测 36a2c12a 虚拟实验窗口
//（10-04 12:47Z ~ 10-08 13:10Z，both），叙事全量重析（跑前先失效窗口缓存）。
// 唯一改动 = backtest.{startTime,endTime,sourceExperimentId} + name/description；
// 策略本体（V2v6+hg55门+lag 门）零改动。
// 用法：node scripts/_tmp_create_36a2_backtest.cjs [--commit]
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const SRC_ID = '3e8460f1-ba61-40e1-b3c0-0d3c26bd8833';
const WIN_SRC = '36a2c12a-a7d6-47ec-ba7e-7f007562fdb4';
const COMMIT = process.argv.includes('--commit');

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const { data, error } = await dbManager.getClient().from('experiments').select('config').eq('id', SRC_ID).limit(1);
  if (error) throw new Error(error.message);
  const cfg = JSON.parse(JSON.stringify(data[0].config));
  if (!/narrativeCorpusLagSec < 300 OR earlyReturn >= 100/.test(cfg.strategiesConfig.buyStrategies[0].preBuyCheckCondition)) {
    throw new Error('源实验 preBuy 缺 lag 门——拿错实验了');
  }
  const before = JSON.stringify(cfg.backtest);
  cfg.backtest.startTime = '2026-10-04T12:47:00.000Z';
  cfg.backtest.endTime = '2026-10-08T13:10:00.000Z';
  cfg.backtest.sourceExperimentId = WIN_SRC;
  cfg.name = '回测-lag门-36a2c12a窗口-叙事重析-1009';
  cfg.description = '策略=3e8460f1 整包（V2v6+hg55门+lag 门 lag<300 OR er>=100）；窗口=36a2c12a 虚拟实跑 '
    + '（10-04 12:47Z~10-08 13:10Z both，95727 token）；跑前已失效窗口 token_narrative → 全量重析 '
    + '（J1.28 referent_memeability 恒带 + C58 图分析 + C59 图豁免最新链路）';
  console.log('backtest 段:', before, '→', JSON.stringify(cfg.backtest));
  console.log('name:', cfg.name);
  console.log('买腿 preBuy:', cfg.strategiesConfig.buyStrategies[0].preBuyCheckCondition);
  if (!COMMIT) { console.log('[dry-run] 未建；加 --commit 真建'); process.exit(0); }
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const container = await ExperimentFactory.getInstance().createFromConfig(cfg, 'backtest');
  console.log('创建 →', container.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
