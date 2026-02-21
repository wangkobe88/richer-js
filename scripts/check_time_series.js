const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  const sourceExperimentId = '0c616581-aa7f-4fcf-beed-6c84488925fb';

  console.log('=== 检查源实验时序数据 ===\n');

  // 1. 检查总数据量
  const { count: totalCount, error: countError } = await supabase
    .from('experiment_time_series_data')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', sourceExperimentId);

  if (countError) {
    console.log('❌ 统计失败:', countError.message);
  } else {
    console.log(`✅ 总数据量: ${totalCount} 条`);
  }

  // 2. 检查 loop_count 范围
  const { data: loopData, error: loopError } = await supabase
    .from('experiment_time_series_data')
    .select('loop_count')
    .eq('experiment_id', sourceExperimentId)
    .order('loop_count', { ascending: true });

  if (!loopError && loopData) {
    const loopCounts = [...new Set(loopData.map(d => d.loop_count))];
    console.log(`✅ loop_count 范围: ${Math.min(...loopCounts)} - ${Math.max(...loopCounts)} (共 ${loopCounts.length} 个不同值)`);
  }

  // 3. 检查是否有重复的时间戳（可能导致 range 查询问题）
  const { data: timeData, error: timeError } = await supabase
    .from('experiment_time_series_data')
    .select('timestamp')
    .eq('experiment_id', sourceExperimentId)
    .order('timestamp', { ascending: true })
    .limit(10);

  if (!timeError && timeData) {
    console.log('\n✅ 前10条时间戳:');
    timeData.forEach(d => console.log(`   ${d.timestamp}`));
  }

  // 4. 测试 range 查询（模拟分页）
  console.log('\n=== 测试分页查询 ===');
  const pageSize = 100;

  for (let page = 0; page < 6; page++) {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    const { data: pageData, error: pageError } = await supabase
      .from('experiment_time_series_data')
      .select('id, loop_count, timestamp')
      .eq('experiment_id', sourceExperimentId)
      .order('timestamp', { ascending: true })
      .range(from, to);

    if (pageError) {
      console.log(`❌ 第 ${page + 1} 页查询失败: ${pageError.message}`);
      break;
    }

    console.log(`第 ${page + 1} 页 (range ${from}-${to}): 获取 ${pageData?.length || 0} 条`);

    if (!pageData || pageData.length === 0) {
      break;
    }

    // 检查是否有新的 loop_count
    const loops = [...new Set(pageData.map(d => d.loop_count))];
    console.log(`   loop_count: ${Math.min(...loops)} - ${Math.max(...loops)}`);
  }

})();
