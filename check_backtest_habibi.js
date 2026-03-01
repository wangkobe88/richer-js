const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function check() {
  const SOURCE_EXP = "4101ee2e-6e9c-437b-a44f-6c7e96a32085";
  const TOKEN = "0xe079942b37bcfec88cea509bffbcf4d5365e4444";

  // 检查源实验中Habibi的时序数据
  console.log("=== 源实验中Habibi的时序数据 ===\n");

  const { data: tsData } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', SOURCE_EXP)
    .eq('token_address', TOKEN)
    .order('timestamp', { ascending: true });

  if (!tsData || tsData.length === 0) {
    console.log("没有时序数据");
    return;
  }

  console.log(`时序数据点数: ${tsData.length}\n`);

  // 检查是否有loop_count字段
  const hasLoopCount = tsData[0].loop_count !== undefined;
  console.log(`是否有loop_count字段: ${hasLoopCount}`);

  if (hasLoopCount) {
    const loopCounts = [...new Set(tsData.map(d => d.loop_count))];
    console.log(`loop_count范围: ${Math.min(...loopCounts)} - ${Math.max(...loopCounts)}`);
    console.log(`不同loop_count数量: ${loopCounts.length}`);
  }

  // 显示age>1.3的所有数据点
  console.log("\n=== age > 1.3 的数据点 ===\n");

  for (let i = 0; i < tsData.length; i++) {
    const row = tsData[i];
    const factors = row.factor_values || {};
    const age = factors.age || 0;
    const time = new Date(row.timestamp).toLocaleTimeString();

    if (age > 1.3) {
      const earlyReturn = factors.earlyReturn || 0;
      const riseSpeed = factors.riseSpeed || 0;
      const trendCV = factors.trendCV || 0;
      const trendTotalReturn = factors.trendTotalReturn || 0;
      const trendDirectionCount = factors.trendDirectionCount || 0;
      const trendStrengthScore = factors.trendStrengthScore || 0;
      const loopCount = row.loop_count || 'N/A';

      console.log(`[${i + 1}] ${time} loop=${loopCount} age=${age.toFixed(2)}min er=${earlyReturn.toFixed(1)}% rs=${riseSpeed.toFixed(1)} cv=${trendCV.toFixed(3)} tr=${trendTotalReturn.toFixed(1)}% dir=${trendDirectionCount} str=${trendStrengthScore.toFixed(1)}`);

      // 检查是否满足新条件
      const passed =
        age > 1.3 &&
        trendCV > 0.005 && trendCV < 0.12 &&
        trendDirectionCount >= 2 &&
        trendStrengthScore >= 30 &&
        trendTotalReturn >= 5 &&
        earlyReturn < 60 &&
        riseSpeed < 35;

      if (passed) {
        console.log(`    ✅ 满足新条件！`);
        break;
      }
    }
  }
}
check().catch(console.error);
