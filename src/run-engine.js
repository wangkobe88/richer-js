#!/usr/bin/env node

/**
 * 运行虚拟交易引擎（WSS 事件驱动；主入口 main.js start-experiment 的精简版）
 * 用法: node src/run-engine.js <experiment_id>
 */

require('dotenv').config({ path: './config/.env' });

const { ExperimentFactory } = require('./trading-engine/factories/ExperimentFactory');
const { FourMemeWssTradingEngine } = require('./trading-engine/implementations/FourMemeWssTradingEngine');
const { FlapWssTradingEngine } = require('./trading-engine/implementations/FlapWssTradingEngine');
const { BacktestEngine } = require('./trading-engine/implementations/BacktestEngine');

async function runEngine(experimentId) {
  if (!experimentId) {
    console.error('用法: node src/run-engine.js <experiment_id>');
    process.exit(1);
  }

  console.log('');
  console.log('========================================');
  console.log('🚀 Richer-js 虚拟交易引擎（WSS 事件驱动）');
  console.log('========================================');
  console.log('');

  try {
    // 加载实验配置：回测实验分派 BacktestEngine（自动跑完退出），
    // 实时按 platform 选引擎——'flap' → Flap 子类；'fourmeme'（缺省）与 'both'
    // （双平台 per-token 分派）→ 基类 FourMemeWssTradingEngine
    const experiment = await ExperimentFactory.getInstance().load(experimentId);
    if (!experiment) {
      throw new Error(`实验不存在: ${experimentId}`);
    }
    const isBacktest = experiment.tradingMode === 'backtest' || experiment.trading_mode === 'backtest';
    // live 实验显式拒绝：本入口恒以 virtual/backtest 模式构造引擎，live 实验会
    // 静默降级成虚拟盘（跑出假账）——fail-fast，live 请用 main.js start-experiment
    if (experiment.tradingMode === 'live' || experiment.trading_mode === 'live') {
      throw new Error('live 实验不能用 run-engine.js 启动（会被静默当作虚拟盘）。请用: node main.js start-experiment -e <id>');
    }
    const EngineClass = isBacktest
      ? BacktestEngine
      : (experiment.config?.platform === 'flap' ? FlapWssTradingEngine : FourMemeWssTradingEngine);
    const engine = new EngineClass({ tradingMode: isBacktest ? 'backtest' : 'virtual' });

    // 优雅关闭：注册必须在 initialize/start 之前——回测的 start() 要等整个回放
    // 跑完才返回，注册放在其后等于回放期间（数小时）进程没有任何信号处理器，
    // SIGTERM 走默认硬杀：不写 stopped、不刷写缓冲（2026-10-11 tnone 37bd7349
    // 停机实录：行状态卡 running，需人工修 DB）
    const gracefulShutdown = async (signal) => {
      console.log(`\n👋 收到 ${signal}，正在停止引擎...`);
      try {
        await engine.stop();
      } catch (error) {
        // 停机链异常留痕后仍退出——进程必须死，但状态可能停在 running 需人工核对
        console.error(`❌ 引擎停止失败: ${error.message}`);
        console.error(error.stack);
      }
      process.exit(0);
    };
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

    // 初始化引擎（加载实验）
    console.log(`🔍 启动实验: ${experimentId}`);
    await engine.initialize(experimentId);

    // 启动引擎
    console.log('🚀 正在启动虚拟交易引擎...');
    await engine.start();

    console.log('');
    console.log('========================================');
    if (isBacktest) {
      console.log('📊 回测运行中...（自动跑完退出）');
    } else {
      console.log('✅ 引擎运行中，按 Ctrl+C 停止');
    }
    console.log('========================================');
    console.log('');

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
