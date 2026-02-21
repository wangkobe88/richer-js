require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  // 获取大量数据点进行检查
  const { data: points, error } = await supabase
    .from('experiment_time_series_data')
    .select('loop_count, token_symbol, factor_values')
    .eq('experiment_id', '0c616581-aa7f-4fcf-beed-6c84488925fb')
    .gte('loop_count', 100)
    .limit(1000);

  if (error) {
    console.log('查询错误:', error);
    return;
  }

  if (points && points.length > 0) {
    console.log('检查', points.length, '个数据点的买入条件...\n');

    let satisfiedCount = 0;
    const samples = [];

    for (const p of points) {
      const fv = p.factor_values || {};
      
      // 买入条件
      const satisfied = 
        (fv.trendCV || 0) > 0.005 &&
        (fv.trendDirectionCount || 0) >= 2 &&
        (fv.trendStrengthScore || 0) >= 30 &&
        (fv.trendTotalReturn || 0) >= 5 &&
        (fv.tvl || 0) >= 3000 &&
        (fv.txVolumeU24h || 0) >= 3500 &&
        (fv.holders || 0) >= 30 &&
        (fv.earlyReturn || 0) < 180;

      if (satisfied) {
        satisfiedCount++;
        if (samples.length < 3) {
          samples.push(p);
        }
      }
    }

    console.log('结果:');
    console.log('  总数据点:', points.length);
    console.log('  满足条件:', satisfiedCount);
    console.log('  满足率:', ((satisfiedCount / points.length) * 100).toFixed(2) + '%\n');

    if (samples.length > 0) {
      console.log('满足条件的样例:');
      samples.forEach((p, idx) => {
        const fv = p.factor_values;
        console.log(`\n样例 ${idx + 1}:`);
        console.log('  代币:', p.token_symbol);
        console.log('  Loop:', p.loop_count);
        console.log('  trendCV:', fv.trendCV);
        console.log('  trendDirectionCount:', fv.trendDirectionCount);
        console.log('  trendStrengthScore:', fv.trendStrengthScore);
        console.log('  trendTotalReturn:', fv.trendTotalReturn);
        console.log('  tvl:', fv.tvl);
        console.log('  holders:', fv.holders);
      });
    } else {
      console.log('没有找到满足条件的数据点！');
      
      // 分析为什么没有满足条件
      console.log('\n因子范围分析:');
      const ranges = {
        trendCV: { min: Infinity, max: -Infinity },
        trendDirectionCount: { min: Infinity, max: -Infinity },
        trendStrengthScore: { min: Infinity, max: -Infinity },
        tvl: { min: Infinity, max: -Infinity },
        holders: { min: Infinity, max: -Infinity }
      };
      
      for (const p of points) {
        const fv = p.factor_values;
        if (fv.trendCV !== undefined) {
          ranges.trendCV.min = Math.min(ranges.trendCV.min, fv.trendCV);
          ranges.trendCV.max = Math.max(ranges.trendCV.max, fv.trendCV);
        }
        if (fv.trendDirectionCount !== undefined) {
          ranges.trendDirectionCount.min = Math.min(ranges.trendDirectionCount.min, fv.trendDirectionCount);
          ranges.trendDirectionCount.max = Math.max(ranges.trendDirectionCount.max, fv.trendDirectionCount);
        }
        if (fv.trendStrengthScore !== undefined) {
          ranges.trendStrengthScore.min = Math.min(ranges.trendStrengthScore.min, fv.trendStrengthScore);
          ranges.trendStrengthScore.max = Math.max(ranges.trendStrengthScore.max, fv.trendStrengthScore);
        }
        if (fv.tvl !== undefined) {
          ranges.tvl.min = Math.min(ranges.tvl.min, fv.tvl);
          ranges.tvl.max = Math.max(ranges.tvl.max, fv.tvl);
        }
        if (fv.holders !== undefined) {
          ranges.holders.min = Math.min(ranges.holders.min, fv.holders);
          ranges.holders.max = Math.max(ranges.holders.max, fv.holders);
        }
      }
      
      console.log('  trendCV:', ranges.trendCV.min.toFixed(4), '-', ranges.trendCV.max.toFixed(4), '(需要 > 0.005)');
      console.log('  trendDirectionCount:', ranges.trendDirectionCount.min, '-', ranges.trendDirectionCount.max, '(需要 >= 2)');
      console.log('  trendStrengthScore:', ranges.trendStrengthScore.min, '-', ranges.trendStrengthScore.max, '(需要 >= 30)');
      console.log('  tvl:', ranges.tvl.min.toFixed(2), '-', ranges.tvl.max.toFixed(2), '(需要 >= 3000)');
      console.log('  holders:', ranges.holders.min, '-', ranges.holders.max, '(需要 >= 30)');
    }
  }
})();
