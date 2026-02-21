require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

(async () => {
  // 检查可能的时序数据表
  const tables = [
    'experiment_time_series',
    'time_series_data',
    'token_time_series',
    'monitoring_data',
    'token_snapshots'
  ];

  console.log('检查时序数据表...\n');

  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .limit(1);

    if (!error) {
      console.log(`✅ 表存在: ${table}`);
      if (data && data.length > 0) {
        console.log(`   数据量: 至少 1 条`);
        console.log(`   字段: ${Object.keys(data[0]).join(', ')}`);
      }
    } else {
      console.log(`❌ 表不存在或无权限: ${table}`);
    }
  }

  // 检查 ExperimentTimeSeriesService 是如何工作的
  console.log('\n\n=== 检查 ExperimentTimeSeriesService ===');
  try {
    const { ExperimentTimeSeriesService } = require('../src/web/services/ExperimentTimeSeriesService');
    const service = new ExperimentTimeSeriesService();

    // 尝试获取数据
    const data = await service.getExperimentTimeSeries('0cc6804d-834e-44f8-8287-c4b4a78abd30');
    console.log('Service 返回数据:', data ? `${data.length} 条` : 'null');

    if (data && data.length > 0) {
      console.log('第一条数据字段:', Object.keys(data[0]));
    }
  } catch (e) {
    console.log('Error:', e.message);
  }
})();
