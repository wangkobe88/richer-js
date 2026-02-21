require('dotenv').config({ path: './config/.env' });
const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
const { BacktestEngine } = require('../src/trading-engine/implementations/BacktestEngine');

(async () => {
  console.log('测试 TokenPool 和卡牌管理器...\n');

  const experimentId = '9733f934-b263-40e0-a4d3-8639703b0da9';

  try {
    const factory = ExperimentFactory.getInstance();
    const experiment = await factory.load(experimentId);

    const engine = new BacktestEngine();
    await engine.initialize(experimentId);

    const tokenAddress = '0xca7de526b6215ae769f564430b52987ee9824444';
    const chain = 'bsc';

    // 检查代币是否在 tokenPool 中
    const token = engine._tokenPool.getToken(tokenAddress, chain);
    console.log('代币在 tokenPool 中:', token ? '是' : '否');
    if (token) {
      console.log('  代币信息:', {
        symbol: token.symbol,
        chain: token.chain,
        cardPositionManager: token.cardPositionManager ? '存在' : '不存在'
      });
    }

    // 手动添加代币（如果不存在）
    if (!token) {
      console.log('\n手动添加代币到 tokenPool...');
      engine._tokenPool.addToken({
        token: tokenAddress,
        symbol: 'Tips',
        chain: chain,
        current_price_usd: 0.00000752
      });

      const tokenAfter = engine._tokenPool.getToken(tokenAddress, chain);
      console.log('添加后，代币在 tokenPool 中:', tokenAfter ? '是' : '否');
    }

    // 创建卡牌管理器
    const { CardPositionManager } = require('../src/portfolio/CardPositionManager');
    const cardManager = new CardPositionManager({
      totalCards: 4,
      perCardMaxBNB: 0.25,
      minCardsForTrade: 1,
      initialAllocation: {
        bnbCards: 4,
        tokenCards: 0
      }
    });

    console.log('\n设置卡牌管理器...');
    engine._tokenPool.setCardPositionManager(tokenAddress, chain, cardManager);

    // 验证是否设置成功
    const retrievedManager = engine._tokenPool.getCardPositionManager(tokenAddress, chain);
    console.log('获取卡牌管理器:', retrievedManager ? '成功' : '失败');

    if (retrievedManager) {
      console.log('  bnbCards:', retrievedManager.bnbCards);
      console.log('  tokenCards:', retrievedManager.tokenCards);
    }

  } catch (error) {
    console.error('错误:', error.message);
  }
})();
