require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

(async () => {
  // 检查所有 loop 值（不分组）
  const { data: allData } = await supabase
    .from('experiment_time_series_data')
    .select('loop_count, token_symbol, timestamp')
    .eq('experiment_id', '0c616581-aa7f-4fcf-beed-6c84488925fb')
    .order('timestamp', { ascending: true });

  console.log('源实验总数据点:', allData?.length || 0);

  if (allData && allData.length > 0) {
    const firstLoop = allData[0].loop_count;
    const lastLoop = allData[allData.length - 1].loop_count;
    const startTime = new Date(allData[0].timestamp);
    const endTime = new Date(allData[allData.length - 1].timestamp);

    console.log('第一个数据点: loop=' + firstLoop + ', ' + startTime.toLocaleString('zh-CN'));
    console.log('最后一个数据点: loop=' + lastLoop + ', ' + endTime.toLocaleString('zh-CN'));
    console.log('时间跨度: ' + ((endTime - startTime) / 1000 / 60).toFixed(2) + ' 分钟');
  }

  // 检查所有不同的 loop 值
  const uniqueLoops = [...new Set(allData?.map(d => d.loop_count) || [])];
  uniqueLoops.sort((a, b) => a - b);

  console.log('\n所有 loop 值 (前10和后10):');
  console.log('前10:', uniqueLoops.slice(0, 10).join(', '));
  console.log('后10:', uniqueLoops.slice(-10).join(', '));
  console.log('总计 ' + uniqueLoops.length + ' 个不同的 loop 值');

  // 分析问题
  console.log('\n=== 问题分析 ===');
  console.log('回测实验运行了 3.72 分钟，但没有处理到 loop 1166 的数据');
  console.log('这是因为源实验的第一个 loop 是 1144，而不是 8');
  console.log('回测引擎按 loop 分组处理数据，可能只处理了部分数据');

  console.log('\n可能的原因:');
  console.log('1. 回测引擎只处理了前几个 loop 的数据');
  console.log('2. 或者回测引擎有超时/提前退出的逻辑');
  console.log('3. 或者数据处理时出现了错误');

  // 建议
  console.log('\n=== 建议 ===');
  console.log('需要检查回测引擎的日志，看是否有错误信息');
  console.log('或者使用数据量更集中、loop 范围更小的源实验');
})();
