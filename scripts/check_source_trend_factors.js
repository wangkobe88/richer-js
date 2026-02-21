require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

(async () => {
  const sourceExpId = '0c616581-aa7f-4fcf-beed-6c84488925fb';

  // 检查几个数据点的 factor_values
  const { data } = await supabase
    .from('experiment_time_series_data')
    .select('loop_count, token_symbol, factor_values')
    .eq('experiment_id', sourceExpId)
    .limit(20);

  console.log('源实验时序数据的因子值:');
  let withTrendFactors = 0;
  let withoutTrendFactors = 0;

  for (const row of (data || [])) {
    const fv = row.factor_values || {};
    const hasTrendFactors = fv.trendCV !== undefined || fv.trendDirectionCount !== undefined;

    if (hasTrendFactors) {
      withTrendFactors++;
    } else {
      withoutTrendFactors++;
    }

    if (row.loop_count >= 1160 && row.loop_count <= 1170) {
      console.log(`\nloop ${row.loop_count}: ${row.token_symbol}`);
      console.log(`  trendCV: ${fv.trendCV}`);
      console.log(`  trendDirectionCount: ${fv.trendDirectionCount}`);
      console.log(`  trendStrengthScore: ${fv.trendStrengthScore}`);
      console.log(`  trendTotalReturn: ${fv.trendTotalReturn}`);
      console.log(`  tvl: ${fv.tvl}`);
      console.log(`  holders: ${fv.holders}`);
      console.log(`  earlyReturn: ${fv.earlyReturn}`);
    }
  }

  console.log(`\n统计:`);
  console.log(`有趋势因子: ${withTrendFactors}`);
  console.log(`无趋势因子: ${withoutTrendFactors}`);

  // 分析为什么没有买入信号
  console.log(`\n=== 买入条件分析 ===`);
  console.log(`买入条件: trendCV > 0.005 AND trendDirectionCount >= 2 AND trendStrengthScore >= 30 AND trendTotalReturn >= 5 AND tvl >= 3000 AND txVolumeU24h >= 3500 AND holders >= 30 AND earlyReturn < 180`);

  if (withoutTrendFactors > 0) {
    console.log(`\n⚠️ 源实验中 ${withoutTrendFactors}/${data?.length || 0} 的数据点没有趋势因子`);
    console.log('由于趋势因子是 null 或 undefined，条件 trendCV > 0.005 无法满足');
    console.log('这就是为什么没有产生任何买入信号！');
  }

  // 建议
  console.log(`\n=== 建议 ===`);
  console.log('源实验 0c616581 是在修复趋势因子保存问题之前运行的');
  console.log('因此时序数据中没有趋势因子，无法满足买入条件');
  console.log('需要使用更近期的源实验，或者重新运行源实验');
})();
