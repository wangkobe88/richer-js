require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  const { data: points, error } = await supabase
    .from('experiment_time_series_data')
    .select('loop_count, token_symbol, factor_values')
    .eq('experiment_id', '0c616581-aa7f-4fcf-beed-6c84488925fb')
    .gte('loop_count', 100)
    .lte('loop_count', 500)
    .limit(100);

  if (error) {
    console.log('查询错误:', error);
    return;
  }

  if (points && points.length > 0) {
    console.log('找到', points.length, '个数据点');

    let foundNonZero = false;
    for (const p of points) {
      const fv = p.factor_values || {};
      if ((fv.trendCV || 0) > 0 || (fv.trendDirectionCount || 0) > 0) {
        console.log('\n找到非零趋势因子:');
        console.log('  代币:', p.token_symbol);
        console.log('  Loop:', p.loop_count);
        console.log('  trendCV:', fv.trendCV);
        console.log('  trendDirectionCount:', fv.trendDirectionCount);
        console.log('  trendStrengthScore:', fv.trendStrengthScore);
        console.log('  trendTotalReturn:', fv.trendTotalReturn);
        foundNonZero = true;
        break;
      }
    }

    if (!foundNonZero) {
      console.log('\n所有数据点的趋势因子都是 0！');
    }
  } else {
    console.log('没有找到数据');
  }
})();
