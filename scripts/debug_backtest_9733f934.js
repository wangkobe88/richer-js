require('dotenv').config({ path: './config/.env' });
const { ExperimentFactory } = require('./src/trading-engine/factories/ExperimentFactory');
const { BacktestEngine } = require('./src/trading-engine/implementations/BacktestEngine');

(async () => {
  console.log('调试回测实验 9733f934...\n');

  const experimentId = '9733f934-b263-40e0-a4d3-8639703b0da9';

  try {
    // 加载实验
    const factory = ExperimentFactory.getInstance();
    const experiment = await factory.load(experimentId);

    if (!experiment) {
      console.error('实验不存在:', experimentId);
      return;
    }

    console.log('实验信息:');
    console.log('  ID:', experiment.id);
    console.log('  名称:', experiment.experimentName);
    console.log('  模式:', experiment.tradingMode);
    console.log('  状态:', experiment.status);

    // 检查源实验配置
    const sourceExpId = experiment.config?.backtest?.sourceExperimentId;
    console.log('  源实验ID:', sourceExpId);

    if (sourceExpId) {
      const sourceExp = await factory.load(sourceExpId);
      if (sourceExp) {
        console.log('  源实验状态:', sourceExp.status);
      }
    }

    console.log('\n创建回测引擎...');

    // 创建引擎
    const engine = new BacktestEngine();

    console.log('初始化引擎...');
    await engine.initialize(experimentId);

    console.log('\n开始执行回测...');
    const startTime = Date.now();

    // 启动引擎（这会执行回测）
    await engine.start();

    const duration = Date.now() - startTime;
    console.log(`\n回测完成，耗时: ${(duration / 1000).toFixed(2)} 秒`);

    // 获取指标
    const metrics = engine.getMetrics();
    console.log('指标:', JSON.stringify(metrics, null, 2));

  } catch (error) {
    console.error('错误:', error.message);
    console.error(error.stack);
  }
})();
