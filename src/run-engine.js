#!/usr/bin/env node

/**
 * 运行虚拟交易引擎
 * 用法: node src/run-engine.js <experiment_id>
 */

require('dotenv').config({ path: './config/.env' });

const { ExperimentFactory } = require('./trading-engine/factories/ExperimentFactory');
const { VirtualTradingEngine } = require('./trading-engine/implementations/VirtualTradingEngine');

async function runEngine(experimentId) {
  if (!experimentId) {
    console.error('用法: node src/run-engine.js <experiment_id>');
    process.exit(1);
  }

  console.log('');
  console.log('========================================');
  console.log('🚀 Richer-js 虚拟交易引擎');
  console.log('========================================');
  console.log('');

  try {
    // 创建引擎实例
    const engine = new VirtualTradingEngine();

    // 初始化引擎（加载实验）
    console.log(`🔍 启动实验: ${experimentId}`);
    await engine.initialize(experimentId);

    // 启动引擎
    console.log('🚀 正在启动虚拟交易引擎...');
    await engine.start();

    console.log('');
    console.log('========================================');
    console.log('✅ 引擎运行中，按 Ctrl+C 停止');
    console.log('========================================');
    console.log('');

    // 设置优雅关闭
    process.on('SIGINT', async () => {
      console.log('\n👋 收到关闭信号，正在停止引擎...');
      await engine.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n👋 收到关闭信号，正在停止引擎...');
      await engine.stop();
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ 启动引擎失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 从命令行参数获取实验ID
const experimentId = process.argv[2];
runEngine(experimentId).catch(error => {
  console.error('未捕获的错误:', error);
  process.exit(1);
});
