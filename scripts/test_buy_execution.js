require('dotenv').config({ path: './config/.env' });
const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
const { BacktestEngine } = require('../src/trading-engine/implementations/BacktestEngine');

(async () => {
  console.log('测试买入执行...\n');

  const experimentId = '9733f934-b263-40e0-a4d3-8639703b0da9';

  try {
    // 加载实验
    const factory = ExperimentFactory.getInstance();
    const experiment = await factory.load(experimentId);

    if (!experiment) {
      console.error('实验不存在');
      return;
    }

    // 创建引擎
    const engine = new BacktestEngine();
    await engine.initialize(experimentId);

    console.log('引擎初始化完成');
    console.log('_positionManagement:', engine._positionManagement);
    console.log('_portfolioManager:', engine._portfolioManager ? '存在' : '不存在');
    console.log('_tokenPool:', engine._tokenPool ? '存在' : '不存在');

    // 检查投资组合
    if (engine._portfolioManager) {
      const portfolio = engine._portfolioManager.getPortfolio(engine._portfolioId);
      console.log('投资组合:', portfolio ? '存在' : '不存在');
      if (portfolio) {
        console.log('  availableBalance:', portfolio.availableBalance);
        console.log('  totalValue:', portfolio.totalValue);
      }
    }

    // 模拟一个买入信号
    const testSignal = {
      action: 'buy',
      symbol: 'Tips',
      tokenAddress: '0xca7de526b6215ae769f564430b52987ee9824444',
      chain: 'bsc',
      price: 0.00000752,
      confidence: 80,
      reason: '测试',
      cards: 4
    };

    console.log('\n测试信号:', testSignal);

    // 直接调用 _executeBuy
    console.log('\n调用 _executeBuy...');
    const result = await engine._executeBuy(testSignal, 'test-signal-123', {}, new Date());

    console.log('\n结果:', result);

  } catch (error) {
    console.error('错误:', error.message);
    console.error(error.stack);
  }
})();
