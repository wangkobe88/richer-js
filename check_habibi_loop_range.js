const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// 新条件
function checkNewConditions(factors) {
  const age = factors.age || 0;
  const trendCV = factors.trendCV || 0;
  const earlyReturn = factors.earlyReturn || 0;
  const riseSpeed = factors.riseSpeed || 0;
  const trendDirectionCount = factors.trendDirectionCount || 0;
  const trendStrengthScore = factors.trendStrengthScore || 0;
  const trendTotalReturn = factors.trendTotalReturn || 0;

  return age > 1.3 &&
    trendCV > 0.005 && trendCV < 0.12 &&
    trendDirectionCount >= 2 &&
    trendStrengthScore >= 30 &&
    trendTotalReturn >= 5 &&
    earlyReturn < 60 &&
    riseSpeed < 35;
}

async function main() {
  const SOURCE_EXP = "4101ee2e-6e9c-437b-a44f-6c7e96a32085";
  const TOKEN = "0xe079942b37bcfec88cea509bffbcf4d5365e4444";

  console.log("=== Habibi loop 222-400 新条件检查 ===\n");

  // 获取Habibi的所有时序数据
  const { data: habibiData } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', SOURCE_EXP)
    .eq('token_address', TOKEN)
    .order('loop_count', { ascending: true });

  if (!habibiData || habibiData.length === 0) {
    console.log("没有Habibi数据");
    return;
  }

  console.log(`Habibi数据点数: ${habibiData.length}`);
  console.log(`loop范围: ${habibiData[0].loop_count} - ${habibiData[habibiData.length - 1].loop_count}\n`);

  // 检查是否有满足新条件的数据点
  for (const row of habibiData) {
    const factors = row.factor_values || {};
    if (checkNewConditions(factors)) {
      const time = new Date(row.timestamp).toLocaleTimeString();
      console.log(`✅ 满足新条件!`);
      console.log(`   loop: ${row.loop_count}`);
      console.log(`   时间: ${time}`);
      console.log(`   age: ${(factors.age || 0).toFixed(2)}min`);
      console.log(`   earlyReturn: ${(factors.earlyReturn || 0).toFixed(1)}%`);
      console.log(`   riseSpeed: ${(factors.riseSpeed || 0).toFixed(1)}`);
      console.log(`   trendCV: ${(factors.trendCV || 0).toFixed(3)}`);
      console.log(`   trendTotalReturn: ${(factors.trendTotalReturn || 0).toFixed(1)}%`);
      console.log(`   trendDirectionCount: ${factors.trendDirectionCount || 0}`);
      console.log(`   trendStrengthScore: ${(factors.trendStrengthScore || 0).toFixed(1)}`);
      return;
    }
  }

  console.log(`❌ Habibi在整个loop 222-400范围内从未满足新条件`);

  // 显示最接近的点
  let bestMatch = null;
  let minFailed = 100;

  for (const row of habibiData) {
    const factors = row.factor_values || {};
    const age = factors.age || 0;
    if (age > 1.3) {
      let failed = 0;
      if ((factors.trendCV || 0) <= 0.005) failed++;
      if ((factors.trendCV || 0) >= 0.12) failed++;
      if ((factors.trendDirectionCount || 0) < 2) failed++;
      if ((factors.trendStrengthScore || 0) < 30) failed++;
      if ((factors.trendTotalReturn || 0) < 5) failed++;
      if ((factors.earlyReturn || 0) >= 60) failed++;
      if ((factors.riseSpeed || 0) >= 35) failed++;

      if (failed < minFailed) {
        minFailed = failed;
        bestMatch = row;
      }
    }
  }

  if (bestMatch) {
    const factors = bestMatch.factor_values || {};
    const time = new Date(bestMatch.timestamp).toLocaleTimeString();
    console.log(`\n最接近的点:`);
    console.log(`   loop: ${bestMatch.loop_count}`);
    console.log(`   时间: ${time}`);
    console.log(`   age: ${(factors.age || 0).toFixed(2)}min`);
    console.log(`   earlyReturn: ${(factors.earlyReturn || 0).toFixed(1)}% (<60)`);
    console.log(`   riseSpeed: ${(factors.riseSpeed || 0).toFixed(1)} (<35)`);
    console.log(`   trendCV: ${(factors.trendCV || 0).toFixed(3)} (0.005-0.12)`);
    console.log(`   trendTotalReturn: ${(factors.trendTotalReturn || 0).toFixed(1)}% (>=5)`);
  }
}
main().catch(console.error);
