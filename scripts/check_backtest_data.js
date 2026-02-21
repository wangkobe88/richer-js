require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

(async () => {
  // 检查源实验的时序数据
  const { data: timeSeries, error } = await supabase
    .from('experiment_time_series')
    .select('*')
    .eq('experiment_id', '0cc6804d-834e-44f8-8287-c4b4a78abd30')
    .limit(1);

  console.log('Error:', error?.message);
  console.log('时序数据存在:', timeSeries && timeSeries.length > 0);

  if (timeSeries && timeSeries.length > 0) {
    const ts = timeSeries[0];
    console.log('\n时序数据结构:');
    console.log('factor_values keys:', ts.factor_values ? Object.keys(ts.factor_values) : 'null');

    if (ts.factor_values) {
      const fv = ts.factor_values;
      console.log('\n是否有趋势因子:');
      console.log('  trendCV:', fv.trendCV);
      console.log('  trendDirectionCount:', fv.trendDirectionCount);
      console.log('  trendStrengthScore:', fv.trendStrengthScore);
      console.log('  trendTotalReturn:', fv.trendTotalReturn);
    }
  }
})();
