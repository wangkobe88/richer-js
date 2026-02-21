require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');
const { buildFactorsFromTimeSeries, getAvailableFactorIds } = require('../src/trading-engine/core/FactorBuilder');
const StrategyEngine = require('../src/strategies/StrategyEngine');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 买入策略条件
const BUY_CONDITION = "trendCV > 0.005 AND trendDirectionCount >= 2 AND trendStrengthScore >= 30 AND trendTotalReturn >= 5 AND tvl >= 3000 AND txVolumeU24h >= 3500 AND holders >= 30  AND earlyReturn < 180";

(async () => {
  console.log('正在检查源实验中是否有数据满足买入条件...\n');

  // 创建策略引擎来评估条件
  const strategy = {
    id: 'test_buy',
    name: '测试买入策略',
    action: 'buy',
    condition: BUY_CONDITION,
    enabled: true
  };

  const engine = new StrategyEngine({ strategies: [strategy] });
  const { getAvailableFactorIds } = require('./src/trading-engine/core/FactorBuilder');
  engine.loadStrategies([strategy], getAvailableFactorIds());

  // 获取一些数据点进行测试
  const { data: points } = await supabase
    .from('experiment_time_series')
    .select('*')
    .eq('experiment_id', '0c616581-aa7f-4fcf-beed-6c84488925fb')
    .gte('loop_count', 100)
    .lte('loop_count', 200)
    .limit(1000);

  if (!points || points.length === 0) {
    console.log('没有获取到数据');
    return;
  }

  console.log(`获取了 ${points.length} 个数据点（loop 100-200）\n`);

  // 检查每个数据点
  let satisfiedCount = 0;
  const samplePoints = [];

  for (const point of points) {
    const tokenState = {
      symbol: point.token_symbol || 'UNKNOWN',
      token: point.token_address,
      chain: 'bsc',
      highestPrice: parseFloat(point.price_usd),
      highestPriceTimestamp: new Date(point.timestamp).getTime(),
      currentPrice: parseFloat(point.price_usd),
      buyPrice: null,
      buyTime: null
    };

    const factors = buildFactorsFromTimeSeries(
      point.factor_values || {},
      tokenState,
      parseFloat(point.price_usd),
      new Date(point.timestamp).getTime()
    );

    // 使用策略引擎评估
    const result = engine.evaluate(factors, point.token_address, Date.now(), {});

    if (result) {
      satisfiedCount++;
      if (samplePoints.length < 5) {
        samplePoints.push({ point, factors, result });
      }
    }
  }

  console.log(`\n结果分析:`);
  console.log(`  总数据点: ${points.length}`);
  console.log(`  满足条件: ${satisfiedCount}`);
  console.log(`  满足率: ${((satisfiedCount / points.length) * 100).toFixed(2)}%\n`);

  if (samplePoints.length > 0) {
    console.log('满足条件的样例:');
    samplePoints.forEach(({ point, factors, result }, idx) => {
      console.log(`\n样例 ${idx + 1}:`);
      console.log(`  代币: ${point.token_symbol}`);
      console.log(`  Loop: ${point.loop_count}`);
      console.log(`  价格: ${point.price_usd}`);
      console.log(`  关键因子:`);
      console.log(`    trendCV: ${factors.trendCV}`);
      console.log(`    trendDirectionCount: ${factors.trendDirectionCount}`);
      console.log(`    trendStrengthScore: ${factors.trendStrengthScore}`);
      console.log(`    trendTotalReturn: ${factors.trendTotalReturn}`);
      console.log(`    tvl: ${factors.tvl}`);
      console.log(`    txVolumeU24h: ${factors.txVolumeU24h}`);
      console.log(`    holders: ${factors.holders}`);
      console.log(`    earlyReturn: ${factors.earlyReturn}`);
    });
  } else {
    console.log('没有找到满足条件的数据点！');

    // 检查为什么没有满足条件
    console.log('\n检查因子范围...');
    const allFactors = new Map();
    for (const point of points.slice(0, 100)) {
      const tokenState = {
        symbol: point.token_symbol || 'UNKNOWN',
        token: point.token_address,
        chain: 'bsc',
        highestPrice: parseFloat(point.price_usd),
        highestPriceTimestamp: new Date(point.timestamp).getTime(),
        currentPrice: parseFloat(point.price_usd)
      };

      const factors = buildFactorsFromTimeSeries(
        point.factor_values || {},
        tokenState,
        parseFloat(point.price_usd),
        new Date(point.timestamp).getTime()
      );

      for (const [key, value] of Object.entries(factors)) {
        if (typeof value === 'number') {
          if (!allFactors.has(key)) {
            allFactors.set(key, { min: value, max: value, count: 0 });
          }
          const stats = allFactors.get(key);
          stats.min = Math.min(stats.min, value);
          stats.max = Math.max(stats.max, value);
          stats.count++;
        }
      }
    }

    console.log('\n因子统计（前100个数据点）:');
    const keysToShow = ['trendCV', 'trendDirectionCount', 'trendStrengthScore', 'trendTotalReturn', 'tvl', 'txVolumeU24h', 'holders', 'earlyReturn'];
    for (const key of keysToShow) {
      if (allFactors.has(key)) {
        const stats = allFactors.get(key);
        console.log(`  ${key}: min=${stats.min}, max=${stats.max}, count=${stats.count}`);
      } else {
        console.log(`  ${key}: 未计算`);
      }
    }
  }
})();
