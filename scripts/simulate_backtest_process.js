require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');
const { buildFactorsFromTimeSeries } = require('../src/trading-engine/core/FactorBuilder');
const { StrategyEngine } = require('../src/strategies/StrategyEngine');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 买入策略条件
const BUY_CONDITION = "trendCV > 0.005 AND trendDirectionCount >= 2 AND trendStrengthScore >= 30 AND trendTotalReturn >= 5 AND tvl >= 3000 AND txVolumeU24h >= 3500 AND holders >= 30  AND earlyReturn < 180";

(async () => {
  // 获取满足条件的数据点
  const { data: points } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', '0c616581-aa7f-4fcf-beed-6c84488925fb')
    .eq('loop_count', 129)
    .eq('token_symbol', 'TCLAW');

  if (!points || points.length === 0) {
    console.log('没有找到 TCLAW loop 129 的数据');
    return;
  }

  const dataPoint = points[0];
  console.log('原始数据:');
  console.log('  代币:', dataPoint.token_symbol);
  console.log('  Loop:', dataPoint.loop_count);
  console.log('  价格:', dataPoint.price_usd);
  console.log('  factor_values.trendCV:', dataPoint.factor_values.trendCV);
  console.log('  factor_values.trendDirectionCount:', dataPoint.factor_values.trendDirectionCount);
  console.log('  factor_values.trendStrengthScore:', dataPoint.factor_values.trendStrengthScore);
  console.log('  factor_values.trendTotalReturn:', dataPoint.factor_values.trendTotalReturn);
  console.log('  factor_values.tvl:', dataPoint.factor_values.tvl);
  console.log('  factor_values.holders:', dataPoint.factor_values.holders);

  // 模拟回测引擎的 tokenState 创建
  const tokenState = {
    token: dataPoint.token_address,
    symbol: dataPoint.token_symbol,
    chain: 'bsc',
    status: 'monitoring',
    currentPrice: parseFloat(dataPoint.price_usd) || 0,
    collectionPrice: dataPoint.factor_values.collectionPrice || parseFloat(dataPoint.price_usd) || 0,
    collectionTime: new Date(dataPoint.timestamp).getTime(),
    buyPrice: 0,
    buyTime: null,
    highestPrice: dataPoint.factor_values.highestPrice || parseFloat(dataPoint.price_usd) || 0,
    highestPriceTimestamp: dataPoint.factor_values.highestPriceTimestamp || new Date(dataPoint.timestamp).getTime(),
    strategyExecutions: {}
  };

  // 模拟回测引擎的因子构建
  const factorResults = buildFactorsFromTimeSeries(
    dataPoint.factor_values || {},
    tokenState,
    parseFloat(dataPoint.price_usd) || 0,
    new Date(dataPoint.timestamp).getTime()
  );

  console.log('\n构建后的因子:');
  console.log('  trendCV:', factorResults.trendCV);
  console.log('  trendDirectionCount:', factorResults.trendDirectionCount);
  console.log('  trendStrengthScore:', factorResults.trendStrengthScore);
  console.log('  trendTotalReturn:', factorResults.trendTotalReturn);
  console.log('  tvl:', factorResults.tvl);
  console.log('  holders:', factorResults.holders);
  console.log('  earlyReturn:', factorResults.earlyReturn);

  // 创建策略引擎并评估
  const strategy = {
    id: 'test_buy',
    name: '测试买入策略',
    action: 'buy',
    condition: BUY_CONDITION,
    priority: 1,
    cooldown: 60,
    enabled: true
  };

  const engine = new StrategyEngine({ strategies: [strategy] });
  const { getAvailableFactorIds } = require('../src/trading-engine/core/FactorBuilder');
  engine.loadStrategies([strategy], getAvailableFactorIds());

  const result = engine.evaluate(
    factorResults,
    dataPoint.token_address,
    new Date(dataPoint.timestamp).getTime(),
    { strategyExecutions: tokenState.strategyExecutions }
  );

  console.log('\n策略评估结果:');
  if (result) {
    console.log('  策略触发:', result.name);
    console.log('  动作:', result.action);
  } else {
    console.log('  策略未触发');
  }
})();
