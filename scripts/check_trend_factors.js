require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

(async () => {
  // 检查时序数据中的趋势因子
  const { data: timeSeries } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', '0cc6804d-834e-44f8-8287-c4b4a78abd30')
    .limit(5);

  console.log('时序数据条数:', timeSeries?.length || 0);

  if (timeSeries && timeSeries.length > 0) {
    const ts = timeSeries[0];
    console.log('\n时序数据结构:');
    console.log('字段:', Object.keys(ts));
    console.log('\nfactor_values 结构:');
    console.log(JSON.stringify(ts.factor_values, null, 2));

    // 检查是否有趋势因子
    const fv = ts.factor_values || {};
    console.log('\n趋势因子检查:');
    console.log('  trendCV:', fv.trendCV);
    console.log('  trendDirectionCount:', fv.trendDirectionCount);
    console.log('  trendStrengthScore:', fv.trendStrengthScore);
    console.log('  trendTotalReturn:', fv.trendTotalReturn);
    console.log('  trendRiseRatio:', fv.trendRiseRatio);
    console.log('  trendDataPoints:', fv.trendDataPoints);

    // 统计有多少数据点包含趋势因子
    const { data: allData } = await supabase
      .from('experiment_time_series_data')
      .select('factor_values')
      .eq('experiment_id', '0cc6804d-834e-44f8-8287-c4b4a78abd30')
      .limit(1000);

    let withTrendCV = 0;
    let totalChecked = 0;
    for (const row of allData || []) {
      totalChecked++;
      if (row.factor_values && row.factor_values.trendCV !== undefined) {
        withTrendCV++;
      }
    }
    console.log('\n趋势因子统计 (前1000条):');
    console.log(`  包含 trendCV 的数据点: ${withTrendCV}/${totalChecked}`);
  }
})();
