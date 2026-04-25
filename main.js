#!/usr/bin/env node

/**
 * Richer-js 主入口
 * 用于启动虚拟交易实验
 */

require('dotenv').config({ path: './config/.env' });
const { Command } = require('commander');
const fs = require('fs');
const path = require('path');

// 引入引擎相关模块
const { ExperimentFactory } = require('./src/trading-engine/factories/ExperimentFactory');
const { Experiment } = require('./src/trading-engine/entities/Experiment');
const { VirtualTradingEngine } = require('./src/trading-engine/implementations/VirtualTradingEngine');
const { LiveTradingEngine } = require('./src/trading-engine/implementations/LiveTradingEngine');
const { BacktestEngine } = require('./src/trading-engine/implementations/BacktestEngine');

const consoleLogger = {
  info: (msg) => console.log(msg),
  error: (msg) => console.error('❌', msg),
  success: (msg) => console.log('✅', msg)
};

/**
 * 虚拟交易系统
 */
class VirtualTradingSystem {
  constructor() {
    this.engine = null;
    this.isRunning = false;
    this.experimentId = null;
  }

  /**
   * 创建引擎（根据交易模式）
   * @private
   * @param {Object} experiment - 实验对象
   * @returns {Object} 交易引擎实例
   */
  _createEngine(experiment) {
    const tradingMode = experiment.tradingMode;

    switch (tradingMode) {
      case 'virtual':
        const initialBalance = experiment.config?.virtual?.initialBalance || 100;
        console.log(`🎮 创建虚拟交易引擎，初始余额: ${initialBalance}`);
        return new VirtualTradingEngine({ initialBalance });

      case 'live':
        console.log(`🔴 创建实盘交易引擎`);
        return new LiveTradingEngine();

      case 'backtest':
        console.log(`📊 创建回测引擎`);
        return new BacktestEngine();

      default:
        throw new Error(`不支持的交易模式: ${tradingMode}`);
    }
  }

  /**
   * 通过实验ID启动交易引擎
   * @param {string} experimentId - 实验ID
   * @param {boolean} force - 强制重启，忽略当前状态
   */
  async startByExperimentId(experimentId, force = false) {
    try {
      console.log(``);
      console.log(`========================================`);
      console.log(`🚀 Richer-js 交易系统`);
      console.log(`========================================`);
      console.log(``);
      console.log(`🔍 启动实验: ${experimentId}`);

      // 1. 加载实验配置
      const experimentFactory = ExperimentFactory.getInstance();
      const experiment = await experimentFactory.load(experimentId);

      if (!experiment) {
        throw new Error(`实验不存在: ${experimentId}`);
      }

      console.log(`📋 实验名称: ${experiment.experimentName}`);
      console.log(`🎯 交易模式: ${experiment.tradingMode}`);
      console.log(`📊 当前状态: ${experiment.status}`);
      console.log(`⛓️  区块链: ${experiment.blockchain}`);
      console.log(`📈 K线类型: ${experiment.klineType}`);

      // 2. 检查实验状态
      if (experiment.status !== 'initializing') {
        if (force) {
          console.log(`⚠️  实验当前状态: ${experiment.status}，强制重启中...`);
          await experimentFactory.updateStatus(experimentId, 'initializing');
          experiment.status = 'initializing';
        } else {
          const statusMap = {
            'running': '已在运行中',
            'completed': '已完成',
            'failed': '启动失败',
            'stopped': '已停止'
          };
          const reason = statusMap[experiment.status] || '状态异常';
          throw new Error(`实验${reason}，不能启动。只有 initializing 状态的实验才能启动。使用 --force 强制重启。`);
        }
      }

      console.log(`✅ 实验状态检查通过`);

      // 3. 根据交易模式创建引擎
      const engineNameMap = {
        'virtual': '虚拟交易',
        'live': '实盘交易',
        'backtest': '回测'
      };
      console.log(`🎯 交易模式: ${engineNameMap[experiment.tradingMode] || experiment.tradingMode}`);

      // 4. 创建对应的引擎
      this.engine = this._createEngine(experiment);

      // 5. 初始化引擎
      console.log(`⚙️  正在初始化引擎...`);
      await this.engine.initialize(experimentId);
      console.log(`✅ 引擎初始化完成`);

      // 6. 启动引擎
      console.log(`🚀 正在启动引擎...`);

      // 对于回测模式，引擎内部会管理状态（running -> completed/failed）
      // 对于其他模式，需要在启动前设置为 running
      if (experiment.tradingMode !== 'backtest') {
        await experimentFactory.updateStatus(experimentId, 'running');
      }

      await this.engine.start();
      this.isRunning = true;
      this.experimentId = experimentId;

      console.log(`✅ 引擎已启动`);

      // 7. 打印引擎信息
      this.printStatus(experiment);

      // 8. 对于非回测模式，设置优雅退出
      if (experiment.tradingMode !== 'backtest') {
        this.setupGracefulShutdown();

        console.log(``);
        console.log(`========================================`);
        console.log(`✅ 引擎运行中，按 Ctrl+C 停止`);
        console.log(`========================================`);
        console.log(``);

        // 保持运行
        process.stdin.resume();
      } else {
        // 回测模式会自动运行完成
        console.log(``);
        console.log(`========================================`);
        console.log(`📊 回测运行中...`);
        console.log(`========================================`);
        console.log(``);
      }

    } catch (error) {
      console.error(``);
      console.error(`❌ 启动失败: ${error.message}`);
      console.error(``);

      // 如果已经加载了实验，更新状态为失败
      if (experimentId) {
        const factory = ExperimentFactory.getInstance();
        await factory.updateStatus(experimentId, 'failed');
      }

      process.exit(1);
    }
  }

  /**
   * 打印状态信息
   */
  printStatus(experiment) {
    console.log(``);
    console.log(`📊 引擎状态:`);
    console.log(`   实验ID: ${this.experimentId}`);
    console.log(`   实验名称: ${experiment.experimentName}`);
    console.log(`   交易模式: ${experiment.tradingMode}`);
    console.log(`   策略类型: ${experiment.strategyType}`);
    console.log(`   区块链: ${experiment.blockchain}`);
    console.log(`   K线类型: ${experiment.klineType}`);

    // 根据交易模式显示不同的初始余额
    if (experiment.tradingMode === 'live') {
      // 实盘：显示钱包余额（从引擎获取）
      const walletBalance = this.engine._walletBalance;
      if (walletBalance) {
        console.log(`   钱包余额: ${walletBalance.toFixed(4)} ${experiment.blockchain.toUpperCase()}`);
      }
    } else {
      // 虚拟盘：显示配置的初始余额
      console.log(`   初始余额: ${experiment.config?.virtual?.initialBalance || 100} ${experiment.blockchain.toUpperCase()}`);
    }
    console.log(``);
  }

  /**
   * 设置优雅退出
   */
  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      console.log(``);
      console.log(`收到 ${signal} 信号，正在停止...`);

      try {
        await this.stop();
        console.log(``);
        console.log(`========================================`);
        console.log(`✅ 引擎已停止`);
        console.log(`========================================`);
        console.log(``);
      } catch (error) {
        console.error(`❌ 停止失败: ${error.message}`);
      }

      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  /**
   * 停止引擎
   */
  async stop() {
    if (!this.isRunning || !this.engine) {
      console.log(`⚠️ 引擎未在运行`);
      return;
    }

    try {
      // 停止引擎
      await this.engine.stop();
      this.isRunning = false;

      // 更新实验状态
      if (this.experimentId) {
        const experimentFactory = ExperimentFactory.getInstance();
        await experimentFactory.updateStatus(this.experimentId, 'stopped');
      }

      // 获取最终指标
      const metrics = this.engine.getMetrics();
      console.log(``);
      console.log(`📈 最终统计:`);

      // 从 metrics 中提取数据
      const summary = metrics.summary || {};
      const portfolio = metrics.portfolio || {};
      const engine = metrics.engine || {};

      console.log(`   引擎状态: ${engine.status || 'unknown'}`);
      console.log(`   循环次数: ${engine.loopCount || 0}`);
      console.log(`   总信号数: ${summary.totalSignals || 0}`);
      console.log(`   买入信号: ${summary.buySignals || 0}`);
      console.log(`   卖出信号: ${summary.sellSignals || 0}`);
      console.log(`   执行交易: ${summary.executedTrades || 0}`);
      if (portfolio.totalValue !== undefined) {
        console.log(`   总价值: ${portfolio.totalValue} BNB`);
      }
      if (portfolio.availableBalance !== undefined) {
        console.log(`   可用余额: ${portfolio.availableBalance} BNB`);
      }
      if (portfolio.totalPnL !== undefined) {
        console.log(`   总盈亏: ${portfolio.totalPnL} BNB`);
      }

    } catch (error) {
      console.error(`❌ 停止失败: ${error.message}`);
      throw error;
    }
  }
}

/**
 * CLI 命令行接口
 */
async function main() {
  const program = new Command();

  program
    .name('richer-js')
    .description('Richer-js - Fourmeme 虚拟交易系统')
    .version('1.0.0');

  // 启动实验命令
  program
    .command('start-experiment')
    .description('通过实验ID启动虚拟交易引擎')
    .requiredOption('-e, --experiment-id <id>', '实验ID')
    .option('-f, --force', '强制重启（忽略实验当前状态，重置为 initializing 后启动）')
    .action(async (options) => {
      const tradingSystem = new VirtualTradingSystem();
      await tradingSystem.startByExperimentId(options.experimentId, options.force);
    });

  // 解析命令行参数
  program.parse();

  // 如果没有提供命令，显示帮助
  if (process.argv.length <= 2) {
    program.outputHelp();
  }
}

// 错误处理
process.on('uncaughtException', (error) => {
  console.error('❌ 未捕获的异常:', error.message);
  console.error(error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ 未处理的Promise拒绝:', reason);
  process.exit(1);
});

// 启动应用
if (require.main === module) {
  main();
}

module.exports = { VirtualTradingSystem };
