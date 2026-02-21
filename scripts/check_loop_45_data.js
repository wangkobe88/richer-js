require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

(async () => {
  const sourceExpId = '0c616581-aa7f-4fcf-beed-6c84488925fb';

  // 检查 loop 45 的数据
  const { data } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', sourceExpId)
    .eq('loop_count', 45);

  console.log('Loop 45 数据点数:', data?.length || 0);

  for (const row of (data || [])) {
    const fv = row.factor_values || {};
    console.log(`\n代币: ${row.token_symbol} (${row.token_address})`);
    console.log(`  trendCV: ${fv.trendCV}`);
    console.log(`  trendDirectionCount: ${fv.trendDirectionCount}`);
    console.log(`  trendStrengthScore: ${fv.trendStrengthScore}`);
    console.log(`  trendTotalReturn: ${fv.trendTotalReturn}`);
    console.log(`  tvl: ${fv.tvl}`);
    console.log(`  txVolumeU24h: ${fv.txVolumeU24h}`);
    console.log(`  holders: ${fv.holders}`);
    console.log(`  earlyReturn: ${fv.earlyReturn}`);

    // 检查是否满足买入条件
    const checks = {
      trendCV: fv.trendCV > 0.005,
      trendDirectionCount: fv.trendDirectionCount >= 2,
      trendStrengthScore: fv.trendStrengthScore >= 30,
      trendTotalReturn: fv.trendTotalReturn >= 5,
      tvl: fv.tvl >= 3000,
      txVolumeU24h: fv.txVolumeU24h >= 3500,
      holders: fv.holders >= 30,
      earlyReturn: fv.earlyReturn < 180 && fv.earlyReturn !== null
    };

    const allPassed = Object.values(checks).every(v => v);
    console.log(`  满足买入条件: ${allPassed}`);

    if (!allPassed) {
      console.log(`  失败条件:`, Object.entries(checks).filter(([k, v]) => !v).map(([k]) => k).join(', '));
    }
  }

  // 检查 Tips 代币在哪几个 loop
  console.log('\n\nTips 代币的 loop:');
  const { data: tipsData } = await supabase
    .from('experiment_time_series_data')
    .select('loop_count')
    .eq('experiment_id', sourceExpId)
    .eq('token_symbol', 'Tips')
    .order('loop_count', { ascending: true });

  if (tipsData) {
    const loops = tipsData.map(d => d.loop_count);
    console.log('Tips 出现的 loops:', loops.slice(0, 20).join(', '), `... (共 ${loops.length} 个)`);
  }
})();
