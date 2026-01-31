#!/usr/bin/env node

/**
 * 虚拟交易引擎测试脚本
 * 用于测试 richer-js 的虚拟交易功能
 */

require('dotenv').config({ path: './config/.env' });

const { ExperimentFactory } = require('./trading-engine/factories/ExperimentFactory');
const { Experiment } = require('./trading-engine/entities/Experiment');
const { VirtualTradingEngine } = require('./trading-engine/implementations/VirtualTradingEngine');
const { ExperimentDataService } = require('./web/services/ExperimentDataService');

/**
 * 测试流程：
 * 1. 创建实验
 * 2. 初始化虚拟引擎
 * 3. 模拟信号并处理
 * 4. 验证结果
 */

async function runTest() {
  console.log('');
  console.log('========================================');
  console.log('🧪 Richer-js 虚拟交易引擎测试');
  console.log('========================================');
  console.log('');

  try {
    // 1. 创建实验
    console.log('📋 步骤 1: 创建实验...');
    const experimentConfig = {
      name: 'Fourmeme 虚拟交易测试',
      description: '测试虚拟交易引擎功能',
      blockchain: 'bsc',
      kline_type: '1m',
      virtual: {
        initialBalance: 100
      }
    };

    const factory = ExperimentFactory.getInstance();
    const experiment = await factory.createFromConfig(experimentConfig, 'virtual');

    console.log(`✅ 实验创建成功: ${experiment.id}`);
    console.log(`   名称: ${experiment.experimentName}`);
    console.log(`   策略: ${experiment.strategyType}`);
    console.log(`   区块链: ${experiment.blockchain}`);
    console.log(`   K线: ${experiment.klineType}`);
    console.log('');

    // 2. 初始化虚拟引擎
    console.log('🎮 步骤 2: 初始化虚拟交易引擎...');
    const engine = new VirtualTradingEngine({
      initialBalance: 100
    });

    await engine.initialize(experiment.id);
    console.log('✅ 虚拟引擎初始化完成');
    console.log('');

    // 3. 启动引擎
    console.log('🚀 步骤 3: 启动引擎...');
    await engine.start();
    console.log('✅ 引擎已启动');
    console.log('');

    // 4. 模拟买入信号
    console.log('📊 步骤 4: 处理买入信号...');
    const buySignal = {
      tokenAddress: '0x1234567890123456789012345678901234567890',
      symbol: 'TEST',
      chain: 'bsc',
      action: 'buy',
      signalType: 'BUY',
      confidence: 85,
      reason: 'earlyReturn 在 80-120% 区间',
      price: 0.0001,
      buyPrice: 0.0001
    };

    const buyResult = await engine.processSignal(buySignal);
    console.log(`   买入结果: ${buyResult.success ? '成功' : '失败'}`);
    if (buyResult.success) {
      console.log(`   交易ID: ${buyResult.trade?.id}`);
    }
    console.log('');

    // 5. 获取引擎指标
    console.log('📈 步骤 5: 获取引擎指标...');
    const metrics = engine.getMetrics();
    console.log(`   总信号数: ${metrics.totalSignals}`);
    console.log(`   总交易数: ${metrics.totalTrades}`);
    console.log(`   成功交易: ${metrics.successfulTrades}`);
    console.log(`   当前余额: ${metrics.currentBalance.toFixed(4)} BNB`);
    console.log(`   持仓数: ${metrics.holdingsCount}`);
    console.log('');

    // 6. 从数据库验证信号记录
    console.log('💾 步骤 6: 验证数据库记录...');
    const dataService = new ExperimentDataService();

    const signals = await dataService.getSignals(experiment.id, { limit: 10 });
    console.log(`   信号记录: ${signals.length} 条`);
    signals.forEach(signal => {
      console.log(`   - ${signal.signalType} ${signal.tokenSymbol} @ ${signal.metadata?.price || 'N/A'}`);
    });

    const trades = await dataService.getTrades(experiment.id, { limit: 10 });
    console.log(`   交易记录: ${trades.length} 条`);
    trades.forEach(trade => {
      console.log(`   - ${trade.direction} ${trade.tokenSymbol} ${trade.amount?.toFixed(6) || 'N/A'} @ ${trade.price || 'N/A'}`);
    });
    console.log('');

    // 7. 停止引擎
    console.log('🛑 步骤 7: 停止引擎...');
    await engine.stop();
    console.log('✅ 引擎已停止');
    console.log('');

    // 8. 最终结果
    console.log('========================================');
    console.log('📊 测试结果汇总');
    console.log('========================================');
    const finalMetrics = engine.getMetrics();
    const profit = finalMetrics.currentBalance - finalMetrics.initialBalance;
    const profitRate = (profit / finalMetrics.initialBalance) * 100;

    console.log(`实验ID: ${experiment.id}`);
    console.log(`初始余额: ${finalMetrics.initialBalance} BNB`);
    console.log(`当前余额: ${finalMetrics.currentBalance.toFixed(4)} BNB`);
    console.log(`盈亏: ${profit.toFixed(4)} BNB (${profitRate.toFixed(2)}%)`);
    console.log(`总信号数: ${finalMetrics.totalSignals}`);
    console.log(`总交易数: ${finalMetrics.totalTrades}`);
    console.log(`成功交易: ${finalMetrics.successfulTrades}`);
    console.log('');

    // 9. 测试实验详情API
    console.log('🔗 步骤 8: 测试API端点...');
    console.log(`   实验列表API: GET http://localhost:3000/api/experiments`);
    console.log(`   实验详情API: GET http://localhost:3000/api/experiment/${experiment.id}`);
    console.log(`   信号API: GET http://localhost:3000/api/experiment/${experiment.id}/signals`);
    console.log(`   交易API: GET http://localhost:3000/api/experiment/${experiment.id}/trades`);
    console.log('');

    console.log('========================================');
    console.log('✅ 测试完成！');
    console.log('========================================');
    console.log('');
    console.log('💡 提示: 可以启动 web 服务器查看界面');
    console.log('   npm run web');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('❌ 测试失败:', error.message);
    console.error('');
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行测试
runTest().catch(error => {
  console.error('未捕获的错误:', error);
  process.exit(1);
});
