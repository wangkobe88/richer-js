require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

(async () => {
  // 检查源实验的时序数据
  const { data: timeSeries } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', '0c616581-aa7f-4fcf-beed-6c84488925fb')
    .limit(5);

  console.log('源实验时序数据:', timeSeries?.length || 0);

  if (timeSeries && timeSeries.length > 0) {
    const ts = timeSeries[0];
    console.log('\nfactor_values keys:', ts.factor_values ? Object.keys(ts.factor_values) : 'null');

    if (ts.factor_values) {
      const fv = ts.factor_values;
      console.log('\n趋势因子:');
      console.log('  trendCV:', fv.trendCV);
      console.log('  trendDirectionCount:', fv.trendDirectionCount);
      console.log('  trendStrengthScore:', fv.trendStrengthScore);
      console.log('  trendTotalReturn:', fv.trendTotalReturn);
      console.log('  holders:', fv.holders);
      console.log('  tvl:', fv.tvl);
      console.log('  earlyReturn:', fv.earlyReturn);
    }
  }

  // 统计有多少数据点包含趋势因子
  const { data: allData } = await supabase
    .from('experiment_time_series_data')
    .select('factor_values')
    .eq('experiment_id', '0c616581-aa7f-4fcf-beed-6c84488925fb')
    .limit(100);

  let withTrendCV = 0;
  for (const row of (allData || [])) {
    if (row.factor_values && row.factor_values.trendCV !== undefined) {
      withTrendCV++;
    }
  }
  console.log('\n前100条中包含 trendCV 的数据点:', withTrendCV);

  // 检查源实验是什么时候运行的
  const { data: sourceExp } = await supabase
    .from('experiments')
    .select('started_at, created_at')
    .eq('id', '0c616581-aa7f-4fcf-beed-6c84488925fb')
    .single();

  console.log('\n源实验运行时间:', sourceExp?.started_at || sourceExp?.created_at);
  console.log('这是在我们修改代码保存趋势因子之前运行的');
})();
