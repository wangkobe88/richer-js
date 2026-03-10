/**
 * 检查 time_series_data 表的完整字段
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkTimeSeriesFields() {
  // 获取一条数据看看有哪些字段
  const { data: sampleData } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .limit(1);

  console.log('=== Time Series Data 字段 ===\n');
  if (sampleData && sampleData.length > 0) {
    const fields = Object.keys(sampleData[0]);
    console.log('字段列表:');
    fields.forEach(f => console.log('  -', f));
  }
}

checkTimeSeriesFields().catch(console.error);
