#!/usr/bin/env node
// ============================================================================
// 新虚拟实验创建（2026-10-08，用户裁定：「使用实验 3e8460f1 的策略，重新建一个
// 虚拟实验，36a2c12a 可以停止」）
//
// 源 = 3e8460f1-ba61-40e1-b3c0-0d3c26bd8833
//   「回测-双门-R1-lag门单臂-lag300er100-1008」——completed（1008 配对臂，lag 门
//   净效应见 compare-corpus-lag-pair）。config = 基底 3473dbc0（拱形v2重构R3
//   去router上界）整包 + preBuy 追加 lag 门。
//
// 本脚本：config 整包克隆 + 删 backtest 段（虚拟盘无回放窗口），其余零改动
// （策略/双门/止损/TPA/周期/PM 全同源）。vs 36a2c12a（12-，V2v6+hg55门）实质差异：
//   ① 买腿 preBuy 追加 (narrativeCorpusLagSec < 300 OR earlyReturn >= 100)
//   ② 卖侧 17 腿（hot/mid/cold 三桶）→ 拱形v2 5 腿（全周期可见）
//   买侧 v6 门 / hg55 门 / router 去上界两边一致。
//
// 用法：node scripts/create-virtual-arch-v2-lag.cjs [--commit]
//   默认 dry-run 打印；--commit 真建（virtual 模式）。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const SRC_ID = '3e8460f1-ba61-40e1-b3c0-0d3c26bd8833';
const NEW_NAME = '13-双平台虚拟-拱形v2+lag门-1008';
const NEW_DESC = '克隆自 3e8460f1（回测-双门-R1-lag门单臂-1008，基底 3473dbc0 拱形v2重构R3去router上界）'
  + 'config 整包、删 backtest 段；vs 12-（36a2c12a，V2v6+hg55门）差异 = ① preBuy 追加 lag 门 '
  + '(narrativeCorpusLagSec < 300 OR earlyReturn >= 100)（早票正常买、晚票要求 earlyReturn>=100 证据，'
  + 'null lag/er fail-closed 落证据门，负 lag=宣告竞态=早票放行）② 卖侧 17 腿→拱形v2 5 腿；'
  + '接替 36a2c12a（stopped 留行）';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(SRC_ID);
  if (!src) throw new Error('源实验不存在: ' + SRC_ID);
  if (src.tradingMode !== 'backtest') throw new Error('源实验不是回测: ' + src.tradingMode);

  const cfg = JSON.parse(JSON.stringify(src.config));
  delete cfg.backtest;  // 虚拟盘无回放窗口
  if (!cfg.virtual || !cfg.virtual.tradeAmount) throw new Error('源 config 缺 virtual 段');
  const buy = cfg.strategiesConfig.buyStrategies[0];
  if (!/narrativeCorpusLagSec < 300 OR earlyReturn >= 100/.test(buy.preBuyCheckCondition)) {
    throw new Error('lag 门未在源 preBuy 中——源实验选择有误');
  }
  if (cfg.strategiesConfig.sellStrategies.length !== 5) {
    throw new Error('源卖腿数非 5（拱形v2）：' + cfg.strategiesConfig.sellStrategies.length);
  }
  cfg.name = NEW_NAME;
  cfg.description = NEW_DESC;

  console.log('===== 新虚拟实验 =====');
  console.log('  name:', cfg.name);
  console.log('  platform:', cfg.platform, '| virtual:', JSON.stringify(cfg.virtual));
  console.log('  condition:', buy.condition);
  console.log('  preBuy:', buy.preBuyCheckCondition);
  console.log('  narrativeCall:', buy.narrativeCallCondition);
  console.log('  卖腿:', cfg.strategiesConfig.sellStrategies.map(s =>
    `P${s.priority} ${s.condition}`).join(' | '));
  console.log('  PM:', JSON.stringify(cfg.positionManagement),
    '| tokenCycle:', JSON.stringify(cfg.tokenCycle),
    '| stopLoss:', JSON.stringify(cfg.stopLoss),
    '| TPA:', JSON.stringify(cfg.tokenPositionAnalyzer));

  if (!COMMIT) { console.log('\n[dry-run] 未建；加 --commit 真建'); process.exit(0); }

  const container = await factory.createFromConfig(cfg, 'virtual');
  console.log('\nNEW_ID=' + container.id);
  console.log('下一步（182）：screen -dmS exp-' + container.id.slice(0, 8)
    + " bash -c 'cd /home/ubuntu/richer-js && node src/run-engine.js " + container.id
    + " > logs/experiment-" + container.id + "-$(date +%m%d).log 2>&1'");
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
