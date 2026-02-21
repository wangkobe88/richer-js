require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

(async () => {
  // 获取源实验的数据统计
  const { data: timeSeries } = await supabase
    .from('experiment_time_series_data')
    .select('token_address, token_symbol, loop_count, timestamp')
    .eq('experiment_id', '0c616581-aa7f-4fcf-beed-6c84488925fb')
    .order('timestamp', { ascending: true });

  console.log('源实验数据点总数:', timeSeries?.length || 0);

  // 按代币统计
  const byToken = {};
  for (const ts of (timeSeries || [])) {
    const symbol = ts.token_symbol;
    if (!byToken[symbol]) {
      byToken[symbol] = { count: 0, maxLoop: 0 };
    }
    byToken[symbol].count++;
    byToken[symbol].maxLoop = Math.max(byToken[symbol].maxLoop, ts.loop_count || 0);
  }

  console.log('\n各代币数据点数:');
  Object.entries(byToken).forEach(([symbol, data]) => {
    console.log(`  ${symbol}: ${data.count}点, 最大loop=${data.maxLoop}`);
  });

  // 检查时间范围
  if (timeSeries && timeSeries.length > 0) {
    const startTime = new Date(timeSeries[0].timestamp).getTime();
    const endTime = new Date(timeSeries[timeSeries.length - 1].timestamp).getTime();
    const duration = (endTime - startTime) / 1000 / 60; // 分钟

    console.log('\n时间范围:');
    console.log('  开始:', new Date(startTime).toLocaleString('zh-CN'));
    console.log('  结束:', new Date(endTime).toLocaleString('zh-CN'));
    console.log('  持续时间:', duration.toFixed(2), '分钟');
  }

  // 分析为什么没有触发趋势检测
  console.log('\n=== 问题分析 ===');
  console.log('趋势检测需要至少6个数据点');
  console.log('这些代币的数据点数不足，导致趋势因子都是0');
  console.log('买入条件需要 trendCV > 0.005, trendDirectionCount >= 2 等');
  console.log('由于趋势因子都是0，无法满足买入条件');

  // 建议
  console.log('\n=== 建议 ===');
  console.log('源实验 0c616581 数据不足，无法用于回测');
  console.log('建议使用 0cc6804d 作为源实验（有更多数据和趋势因子）');
})();
