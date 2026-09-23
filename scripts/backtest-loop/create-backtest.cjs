#!/usr/bin/env node
// ============================================================================
// 回测迭代工作台——创建回测实验（pumpfun 因子迭代用，2026-09-23）
//
// 从源实验（572033ad 等）克隆数据源建 backtest 实验：策略可换（--strategy JSON）、
// 平台自动继承源实验（flap→flapWs / four.meme→fourmemeWs 配置段）。
// 创建后打印 EXPERIMENT_ID=<id>，用 `node main.js start-experiment -e <id> -f` 启动回放。
//
// 策略 JSON 顶层字段（均可省，省则继承源实验）：
//   buyStrategies / sellStrategies  —— 策略腿数组（priority/condition/maxExecutions/腿字段）
//   tradeAmount                     —— 每笔买入 BNB
//   initialBalance                  —— 初始余额（默认 100）
//   ws                              —— 引擎级覆盖（合入实验 config 的平台 ws 段：
//                                      sellDebounceMs / factorParams / signalDebounce 等）
//
// 用法：node scripts/backtest-loop/create-backtest.cjs --source <id> --name 轮0基线 \
//        --strategy scripts/backtest-loop/strategies/round0.json
// 写操作（插 experiments 一行）——建议 182 跑；本地小写可容忍但遵守红线优先远程。
// ============================================================================
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../..', 'config/.env') });

async function main() {
  const a = process.argv;
  let source = null, name = null, strategyPath = null;
  for (let i = 2; i < a.length; i++) {
    if (a[i] === '--source') source = a[++i];
    else if (a[i] === '--name') name = a[++i];
    else if (a[i] === '--strategy') strategyPath = a[++i];
    else { console.error(`未知参数: ${a[i]}`); process.exit(1); }
  }
  if (!source) { console.error('缺 --source <experimentId>'); process.exit(1); }

  const { ExperimentFactory } = require('../../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(source);
  if (!src) { console.error(`源实验不存在: ${source}`); process.exit(1); }
  const platform = (src.config && src.config.platform) || 'fourmeme';
  const wsSection = platform === 'flap' ? 'flapWs' : 'fourmemeWs';

  const S = strategyPath ? JSON.parse(fs.readFileSync(strategyPath, 'utf8')) : {};
  const config = {
    name: name || `回测-${String(src.experimentName || '').slice(0, 20)}`,
    description: `回测迭代（源 ${source.slice(0, 8)}，平台 ${platform}${strategyPath ? '，策略 ' + path.basename(strategyPath) : '，策略继承源'}）`,
    blockchain: 'bsc',
    platform,
    kline_type: '1m',
    tradeAmount: S.tradeAmount != null ? S.tradeAmount : ((src.config && src.config.tradeAmount) != null ? src.config.tradeAmount : 0.1),
    strategiesConfig: {
      buyStrategies: S.buyStrategies || (src.config && src.config.strategiesConfig && src.config.strategiesConfig.buyStrategies) || [],
      sellStrategies: S.sellStrategies || (src.config && src.config.strategiesConfig && src.config.strategiesConfig.sellStrategies) || [],
    },
    backtest: {
      initialBalance: S.initialBalance != null ? S.initialBalance : 100,
      sourceExperimentId: source,
      minMaxChangePercent: 0,
    },
  };
  if (S.ws) config[wsSection] = S.ws;

  const exp = await factory.createFromConfig(config, 'backtest');
  console.log(`平台=${platform}（${wsSection} 段） | tradeAmount=${config.tradeAmount} | 初始余额=${config.backtest.initialBalance}`);
  console.log('EXPERIMENT_ID=' + exp.id);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
