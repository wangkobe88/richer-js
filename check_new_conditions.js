const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// 新的买入条件
const NEW_BUY_CONDITIONS = {
  trendCV_min: 0.005,
  trendCV_max: 0.12,      // 原来是 0.08
  trendDirectionCount_min: 2,
  trendStrengthScore_min: 30,
  trendTotalReturn_min: 5,
  trendRecentDownRatio_max: 0.6,
  drawdownFromHighest_min: -25,
  earlyReturn_max: 60,    // 原来是 40
  riseSpeed_max: 35,      // 原来是 25
  age_min: 1.3            // 原来是 1.5
};

function checkBuyCondition(factors, conditions) {
  const trendCV = factors.trendCV || 0;
  const earlyReturn = factors.earlyReturn || 0;
  const age = factors.age || 0;
  const riseSpeed = factors.riseSpeed || 0;
  const trendDirectionCount = factors.trendDirectionCount || 0;
  const trendStrengthScore = factors.trendStrengthScore || 0;
  const trendTotalReturn = factors.trendTotalReturn || 0;
  const trendRecentDownRatio = factors.trendRecentDownRatio || 0;
  const drawdownFromHighest = factors.drawdownFromHighest || 0;

  const result = {
    passed: true,
    reasons: []
  };

  if (age < conditions.age_min) {
    result.passed = false;
    result.reasons.push(`age<${conditions.age_min} (${age.toFixed(2)})`);
  }
  if (trendCV <= conditions.trendCV_min) {
    result.passed = false;
    result.reasons.push(`trendCV<=${conditions.trendCV_min} (${trendCV.toFixed(3)})`);
  }
  if (trendCV >= conditions.trendCV_max) {
    result.passed = false;
    result.reasons.push(`trendCV>=${conditions.trendCV_max} (${trendCV.toFixed(3)})`);
  }
  if (trendDirectionCount < conditions.trendDirectionCount_min) {
    result.passed = false;
    result.reasons.push(`trendDirectionCount<${conditions.trendDirectionCount_min} (${trendDirectionCount})`);
  }
  if (trendStrengthScore < conditions.trendStrengthScore_min) {
    result.passed = false;
    result.reasons.push(`trendStrengthScore<${conditions.trendStrengthScore_min} (${trendStrengthScore.toFixed(1)})`);
  }
  if (trendTotalReturn < conditions.trendTotalReturn_min) {
    result.passed = false;
    result.reasons.push(`trendTotalReturn<${conditions.trendTotalReturn_min} (${trendTotalReturn.toFixed(1)})`);
  }
  if (trendRecentDownRatio >= conditions.trendRecentDownRatio_max) {
    result.passed = false;
    result.reasons.push(`trendRecentDownRatio>=${conditions.trendRecentDownRatio_max} (${trendRecentDownRatio.toFixed(2)})`);
  }
  if (drawdownFromHighest <= conditions.drawdownFromHighest_min) {
    result.passed = false;
    result.reasons.push(`drawdownFromHighest<=${conditions.drawdownFromHighest_min} (${drawdownFromHighest.toFixed(1)})`);
  }
  if (earlyReturn >= conditions.earlyReturn_max) {
    result.passed = false;
    result.reasons.push(`earlyReturn>=${conditions.earlyReturn_max} (${earlyReturn.toFixed(1)})`);
  }
  if (riseSpeed >= conditions.riseSpeed_max) {
    result.passed = false;
    result.reasons.push(`riseSpeed>=${conditions.riseSpeed_max} (${riseSpeed.toFixed(1)})`);
  }

  return result;
}

async function main() {
  const EXP_ID = "4101ee2e-6e9c-437b-a44f-6c7e96a32085";
  const TOKEN = "0xe079942b37bcfec88cea509bffbcf4d5365e4444";

  console.log("=== Habibi (0xe079...) 新条件测试 ===\n");
  console.log("新条件:");
  console.log(`  trendCV: ${NEW_BUY_CONDITIONS.trendCV_min} < < ${NEW_BUY_CONDITIONS.trendCV_max}`);
  console.log(`  trendDirectionCount >= ${NEW_BUY_CONDITIONS.trendDirectionCount_min}`);
  console.log(`  trendStrengthScore >= ${NEW_BUY_CONDITIONS.trendStrengthScore_min}`);
  console.log(`  trendTotalReturn >= ${NEW_BUY_CONDITIONS.trendTotalReturn_min}`);
  console.log(`  trendRecentDownRatio < ${NEW_BUY_CONDITIONS.trendRecentDownRatio_max}`);
  console.log(`  drawdownFromHighest > ${NEW_BUY_CONDITIONS.drawdownFromHighest_min}`);
  console.log(`  earlyReturn < ${NEW_BUY_CONDITIONS.earlyReturn_max} (原40)`);
  console.log(`  riseSpeed < ${NEW_BUY_CONDITIONS.riseSpeed_max} (原25)`);
  console.log(`  age > ${NEW_BUY_CONDITIONS.age_min} (原1.5)\n`);

  // 获取时序数据
  const { data: tsData } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', EXP_ID)
    .eq('token_address', TOKEN)
    .order('timestamp', { ascending: true });

  if (!tsData || tsData.length === 0) {
    console.log("没有时序数据");
    return;
  }

  console.log(`时序数据点数: ${tsData.length}\n`);

  // 检查所有数据点
  for (let i = 0; i < tsData.length; i++) {
    const row = tsData[i];
    const factors = row.factor_values || {};
    const age = factors.age || 0;
    const time = new Date(row.timestamp).toLocaleTimeString();

    const result = checkBuyCondition(factors, NEW_BUY_CONDITIONS);

    if (result.passed) {
      console.log(`✅ 满足新条件！`);
      console.log(`   数据点: [${i + 1}/${tsData.length}]`);
      console.log(`   时间: ${time}, age=${age.toFixed(2)}min`);
      console.log(`   earlyReturn=${(factors.earlyReturn || 0).toFixed(1)}%, riseSpeed=${(factors.riseSpeed || 0).toFixed(1)}, trendCV=${(factors.trendCV || 0).toFixed(3)}, trendTotalReturn=${(factors.trendTotalReturn || 0).toFixed(1)}%`);
      console.log(`   trendDirectionCount=${factors.trendDirectionCount || 0}, trendStrengthScore=${(factors.trendStrengthScore || 0).toFixed(1)}`);
      console.log(`   如果当时用新条件，此时代币会被买入！`);
      return;
    }
  }

  console.log(`❌ 即使使用新条件，该代币也从未满足买入条件`);

  // 显示最接近的点
  let bestMatch = null;
  let minFailed = 100;
  for (const row of tsData) {
    const result = checkBuyCondition(row.factor_values || {}, NEW_BUY_CONDITIONS);
    if (!result.passed && result.reasons.length < minFailed) {
      minFailed = result.reasons.length;
      bestMatch = { row, result };
    }
  }

  if (bestMatch) {
    const { row, result } = bestMatch;
    const factors = row.factor_values || {};
    const time = new Date(row.timestamp).toLocaleTimeString();
    const i = tsData.indexOf(row);

    console.log(`\n最接近满足的时点 (数据点${i + 1}/${tsData.length}):`);
    console.log(`   时间: ${time}, age=${(factors.age || 0).toFixed(2)}min`);
    console.log(`   earlyReturn=${(factors.earlyReturn || 0).toFixed(1)}%, riseSpeed=${(factors.riseSpeed || 0).toFixed(1)}, trendCV=${(factors.trendCV || 0).toFixed(3)}, trendTotalReturn=${(factors.trendTotalReturn || 0).toFixed(1)}%`);
    console.log(`   不满足条件 (${result.reasons.length}项):`);
    result.reasons.forEach(reason => console.log(`     - ${reason}`));
  }
}

main().catch(console.error);
