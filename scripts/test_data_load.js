require('dotenv').config({ path: './config/.env' });
const { ExperimentTimeSeriesService } = require('../src/web/services/ExperimentTimeSeriesService');

const timeSeriesService = new ExperimentTimeSeriesService();

(async () => {
  const sourceExperimentId = '0c616581-aa7f-4fcf-beed-6c84488925fb';

  console.log('开始加载时序数据...');
  const startTime = Date.now();

  try {
    const data = await timeSeriesService.getExperimentTimeSeries(
      sourceExperimentId,
      null,
      {
        retryAttempt: 1,
        maxRetries: 3
      }
    );

    const duration = Date.now() - startTime;

    console.log('\n=== 加载结果 ===');
    console.log(`加载耗时: ${duration}ms`);
    console.log(`数据点总数: ${data.length}`);

    // 分析 loop_count 范围
    const loopCounts = new Set();
    const minLoop = Math.min(...data.map(d => d.loop_count || 0));
    const maxLoop = Math.max(...data.map(d => d.loop_count || 0));

    for (const d of data) {
      loopCounts.add(d.loop_count);
    }

    console.log(`loop_count 范围: ${minLoop} - ${maxLoop}`);
    console.log(`唯一 loop_count 数量: ${loopCounts.size}`);
    console.log(`平均每轮数据点: ${(data.length / loopCounts.size).toFixed(2)}`);

    // 检查是否有数据缺失
    const expectedLoops = maxLoop - minLoop + 1;
    if (loopCounts.size < expectedLoops) {
      console.log(`⚠️ 可能缺失了 ${expectedLoops - loopCounts.size} 个轮次的数据`);
    }

  } catch (error) {
    console.error('加载失败:', error.message);
  }
})();
