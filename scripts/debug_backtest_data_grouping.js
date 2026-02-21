require('dotenv').config({ path: './config/.env' });
const { ExperimentTimeSeriesService } = require('../src/web/services/ExperimentTimeSeriesService');
const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');

(async () => {
  console.log('调试回测数据加载和分组...\n');

  const sourceExpId = '0c616581-aa7f-4fcf-beed-6c84488925fb';
  const backtestExpId = '9733f934-b263-40e0-a4d3-8639703b0da9';

  // 1. 加载实验配置
  const factory = ExperimentFactory.getInstance();
  const experiment = await factory.load(backtestExpId);

  console.log('回测实验配置:');
  console.log('  源实验ID:', experiment.config?.backtest?.sourceExperimentId);
  console.log('  初始余额:', experiment.config?.backtest?.initialBalance);

  // 2. 加载时序数据
  console.log('\n加载时序数据...');
  const timeSeriesService = new ExperimentTimeSeriesService();

  const data = await timeSeriesService.getExperimentTimeSeries(
    sourceExpId,
    null,
    {
      retryAttempt: 1,
      maxRetries: 3
    }
  );

  console.log('加载的数据点数:', data.length);

  if (data.length === 0) {
    console.log('没有数据！');
    return;
  }

  // 3. 模拟 _groupDataByLoopCount
  console.log('\n分组数据...');
  const grouped = new Map();
  for (const dataPoint of data) {
    const loopCount = dataPoint.loop_count || 0;
    if (!grouped.has(loopCount)) {
      grouped.set(loopCount, []);
    }
    grouped.get(loopCount).push(dataPoint);
  }

  const groupedData = Array.from(grouped.entries())
    .map(([loopCount, dataPoints]) => ({ loopCount, dataPoints }))
    .sort((a, b) => a.loopCount - b.loopCount);

  console.log('分组后的轮次数:', groupedData.length);

  // 4. 检查前10个和后10个轮次
  console.log('\n前10个轮次:');
  for (let i = 0; i < Math.min(10, groupedData.length); i++) {
    const round = groupedData[i];
    console.log(`  [${i}] loop=${round.loopCount}, 数据点=${round.dataPoints.length}`);
  }

  console.log('\n后10个轮次:');
  for (let i = Math.max(0, groupedData.length - 10); i < groupedData.length; i++) {
    const round = groupedData[i];
    console.log(`  [${i}] loop=${round.loopCount}, 数据点=${round.dataPoints.length}`);
  }

  // 5. 模拟处理前100个轮次，看看是否有问题
  console.log('\n模拟处理前100个轮次...');
  for (let i = 0; i < Math.min(100, groupedData.length); i++) {
    const round = groupedData[i];
    const { loopCount, dataPoints } = round;

    // 检查数据点
    for (let j = 0; j < dataPoints.length; j++) {
      const dp = dataPoints[j];

      // 检查是否有 null 或 undefined 值
      if (!dp.token_address || !dp.token_symbol) {
        console.log(`⚠️ 轮次 ${i} (loop ${loopCount}) 数据点 ${j} 缺少必要字段`);
        console.log('  ', dp);
      }

      // 检查 factor_values
      if (!dp.factor_values) {
        console.log(`⚠️ 轮次 ${i} (loop ${loopCount}) 数据点 ${j} 没有 factor_values`);
      }
    }

    // 每20轮显示一次进度
    if ((i + 1) % 20 === 0) {
      console.log(`  已检查 ${i + 1} 个轮次...`);
    }
  }

  // 6. 检查第 83 个轮次（索引 83）
  if (groupedData.length > 83) {
    const round83 = groupedData[83];
    console.log('\n第 83 个轮次 (索引83):');
    console.log('  loop:', round83.loopCount);
    console.log('  数据点数:', round83.dataPoints.length);

    // 检查每个数据点
    round83.dataPoints.forEach((dp, idx) => {
      console.log(`  数据点 ${idx}:`);
      console.log(`    代币: ${dp.token_symbol} (${dp.token_address})`);
      console.log(`    loop_count: ${dp.loop_count}`);
      console.log(`    价格: ${dp.price_usd}`);
      console.log(`    factor_values:`, dp.factor_values ? '有' : '无');
    });
  }

  // 7. 分析问题
  console.log('\n=== 问题分析 ===');
  if (groupedData.length > 100) {
    console.log('数据加载正常，有', groupedData.length, '个轮次');
    console.log('如果回测只处理到第 83 轮，问题出在执行阶段');
    console.log('可能的原因:');
    console.log('1. 回测过程中有未捕获的异常');
    console.log('2. 进程被外部终止');
    console.log('3. 有超时或资源限制');
  } else {
    console.log('⚠️ 只有', groupedData.length, '个轮次');
    console.log('数据加载可能有问题');
  }

  // 8. 检查源实验的状态
  const sourceExp = await factory.load(sourceExpId);
  if (sourceExp) {
    console.log('\n源实验状态:', sourceExp.status);
    console.log('源实验 tradingMode:', sourceExp.tradingMode);
  }
})();
