#!/usr/bin/env node
/**
 * 创建 RSI 策略正式回测实验
 *
 * 对 Multi-Confirm 和 Crossover 两个策略，
 * 分别基于两个虚拟实验源创建回测，
 * 包含 pre-buy check。
 *
 * 用法: node scripts/create-rsi-backtests.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'config', '.env') });

const { dbManager } = require('../src/services/dbManager');
const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');

const SOURCE_EXPERIMENTS = [
  { id: '8dfee382-179b-49e1-9b99-839e3db9663a', name: '虚拟实验A' },
  { id: 'f57487fa-2c4c-4a6e-b1dc-e0dcebdf58f5', name: '虚拟实验B' },
];

const PRE_BUY_REF_ID = '2007c1f0-487a-4e5a-b8cc-6541d5cf7bf0';

const STRATEGIES = [
  {
    name: 'RSI Crossover',
    buyCondition: 'rsiFast >= 55 AND rsiCrossover == 1 AND earlyReturn >= 30',
    sellCondition: '(rsiCrossover == 0 AND rsiSlope < 0 AND profitPercent >= 3) OR drawdownFromHighestSinceLastBuy <= -18 OR (holdDuration >= 90 AND profitPercent >= 5)',
  },
  {
    name: 'RSI Multi-Confirm',
    buyCondition: 'rsiFast >= 55 AND rsiMedium >= 50 AND rsiCrossover == 1 AND rsiSlope > 0 AND earlyReturn >= 30',
    sellCondition: '(rsiFast < 40 AND rsiCrossover == 0 AND rsiSlope < 0) OR drawdownFromHighestSinceLastBuy <= -15 OR (holdDuration >= 120 AND profitPercent >= 5)',
  },
];

async function main() {
  const factory = new ExperimentFactory();
  const supabase = dbManager.getClient();

  // 读取参考实验的配置
  console.log('加载参考实验配置...');
  const { data: refExp, error } = await supabase
    .from('experiments')
    .select('config')
    .eq('id', PRE_BUY_REF_ID)
    .single();

  if (error || !refExp) {
    console.error('无法加载参考实验:', error?.message);
    process.exit(1);
  }

  const refConfig = refExp.config || {};
  const refPreBuyCheck = refConfig.preBuyCheck || {};
  const refBuyStrategies = refConfig.strategiesConfig?.buyStrategies || [];
  const refPreBuyCheckCondition = refBuyStrategies[0]?.preBuyCheckCondition || '';

  console.log('  preBuyCheck:', JSON.stringify(refPreBuyCheck));
  console.log('  preBuyCheckCondition:', refPreBuyCheckCondition);

  // 读取默认 preBuyCheck 配置
  const defaultConfig = require('../config/default.json');
  const mergedPreBuyCheck = { ...defaultConfig.preBuyCheck, ...refPreBuyCheck };

  const createdExperiments = [];

  for (const source of SOURCE_EXPERIMENTS) {
    for (const strategy of STRATEGIES) {
      const experimentName = `RSI ${strategy.name} [${source.name}]`;

      const config = {
        name: experimentName,
        description: `RSI ${strategy.name} 策略回测，源实验 ${source.name} (${source.id})`,
        blockchain: 'bsc',
        kline_type: '1m',
        backtest: {
          sourceExperimentId: source.id,
          initialBalance: 100,
        },
        preBuyCheck: mergedPreBuyCheck,
        strategiesConfig: {
          buyStrategies: [{
            priority: 1,
            condition: strategy.buyCondition,
            preBuyCheckCondition: refPreBuyCheckCondition,
            description: `${strategy.name} Buy`,
            cards: 1,
            cooldown: 300,
          }],
          sellStrategies: [{
            priority: 1,
            condition: strategy.sellCondition,
            description: `${strategy.name} Sell`,
            cards: 'all',
            cooldown: 60,
          }],
        },
      };

      console.log(`\n创建实验: ${experimentName}`);
      try {
        const experiment = await factory.createFromConfig(config, 'backtest');
        createdExperiments.push({ id: experiment.id, name: experimentName });
        console.log(`  ✅ 实验ID: ${experiment.id}`);
      } catch (err) {
        console.error(`  ❌ 创建失败: ${err.message}`);
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('创建完成，实验列表：');
  for (const exp of createdExperiments) {
    console.log(`  ${exp.name}`);
    console.log(`  ID: ${exp.id}`);
    console.log(`  启动命令: sudo node main.js start-experiment -e ${exp.id} --force`);
    console.log('');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('致命错误:', err);
  process.exit(1);
});
