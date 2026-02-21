require('dotenv').config({ path: './config/.env' });
const { ExperimentTimeSeriesService } = require('../src/web/services/ExperimentTimeSeriesService');

(async () => {
  console.log('模拟回测引擎的数据加载过程...\n');

  const timeSeriesService = new ExperimentTimeSeriesService();
  const sourceExperimentId = '0c616581-aa7f-4fcf-beed-6c84488925fb';

  try {
    console.log('开始加载时序数据...');
    const startTime = Date.now();

    const data = await timeSeriesService.getExperimentTimeSeries(
      sourceExperimentId,
      null,
      {
        retryAttempt: 1,
        maxRetries: 3
      }
    );

    const loadTime = Date.now() - startTime;
    console.log('\n=== 加载结果 ===');
    console.log('加载的数据点数:', data.length);
    console.log('加载耗时:', (loadTime / 1000).toFixed(2), '秒');

    if (data.length > 0) {
      // 模拟 _groupDataByLoopCount
      console.log('\n=== 分组数据 ===');
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

      if (groupedData.length > 0) {
        const firstLoop = groupedData[0].loopCount;
        const lastLoop = groupedData[groupedData.length - 1].loopCount;
        console.log('loop 范围:', firstLoop, '-', lastLoop);

        console.log('\n前10轮:');
        for (let i = 0; i < Math.min(10, groupedData.length); i++) {
          const round = groupedData[i];
          console.log(`  轮次 ${i}: loop=${round.loopCount}, 数据点=${round.dataPoints.length}`);
        }

        console.log('\n后10轮:');
        for (let i = Math.max(0, groupedData.length - 10); i < groupedData.length; i++) {
          const round = groupedData[i];
          console.log(`  轮次 ${i}: loop=${round.loopCount}, 数据点=${round.dataPoints.length}`);
        }

        // 检查第 83 轮是什么
        if (groupedData.length > 83) {
          const round83 = groupedData[83];
          console.log('\n第 83 轮 (索引83):');
          console.log(`  loop=${round83.loopCount}, 数据点=${round83.dataPoints.length}`);
        }
      }

      // 问题分析
      console.log('\n=== 问题分析 ===');
      if (groupedData.length === 83) {
        console.log('⚠️ 分组后只有 83 个轮次！');
        console.log('这与日志中"第 83 轮"吻合');
        console.log('说明回测引擎确实只处理了 83 个轮次');
        console.log('\n但源实验有 1,246 个不同的 loop 值');
        console.log('需要检查为什么只加载了部分数据');
      } else if (groupedData.length > 100) {
        console.log('✅ 分组后有', groupedData.length, '个轮次');
        console.log('数据加载正常');
        console.log('\n那为什么回测只处理到第 83 轮？');
        console.log('可能原因:');
        console.log('1. 回测过程中发生错误提前退出');
        console.log('2. 有超时限制');
        console.log('3. 有最大轮次限制');
      }

    } else {
      console.log('⚠️ 没有加载到任何数据！');
    }

  } catch (error) {
    console.error('❌ 加载失败:', error.message);
    console.error(error.stack);
  }
})();
