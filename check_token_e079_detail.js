const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// 买入条件
const BUY_CONDITIONS = {
  trendCV_min: 0.005,
  trendCV_max: 0.08,
  trendDirectionCount_min: 2,
  trendStrengthScore_min: 30,
  trendTotalReturn_min: 5,
  trendRecentDownRatio_max: 0.6,
  drawdownFromHighest_min: -25,
  earlyReturn_max: 40,
  riseSpeed_max: 25,
  age_min: 1.5
};

function checkBuyCondition(factors) {
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

  if (age < BUY_CONDITIONS.age_min) {
    result.passed = false;
    result.reasons.push(`age<1.5 (${age.toFixed(2)})`);
  }
  if (trendCV <= BUY_CONDITIONS.trendCV_min) {
    result.passed = false;
    result.reasons.push(`trendCV<=0.005 (${trendCV.toFixed(3)})`);
  }
  if (trendCV >= BUY_CONDITIONS.trendCV_max) {
    result.passed = false;
    result.reasons.push(`trendCV>=0.08 (${trendCV.toFixed(3)})`);
  }
  if (trendDirectionCount < BUY_CONDITIONS.trendDirectionCount_min) {
    result.passed = false;
    result.reasons.push(`trendDirectionCount<2 (${trendDirectionCount})`);
  }
  if (trendStrengthScore < BUY_CONDITIONS.trendStrengthScore_min) {
    result.passed = false;
    result.reasons.push(`trendStrengthScore<30 (${trendStrengthScore.toFixed(1)})`);
  }
  if (trendTotalReturn < BUY_CONDITIONS.trendTotalReturn_min) {
    result.passed = false;
    result.reasons.push(`trendTotalReturn<5 (${trendTotalReturn.toFixed(1)})`);
  }
  if (trendRecentDownRatio >= BUY_CONDITIONS.trendRecentDownRatio_max) {
    result.passed = false;
    result.reasons.push(`trendRecentDownRatio>=0.6 (${trendRecentDownRatio.toFixed(2)})`);
  }
  if (drawdownFromHighest <= BUY_CONDITIONS.drawdownFromHighest_min) {
    result.passed = false;
    result.reasons.push(`drawdownFromHighest<=-25 (${drawdownFromHighest.toFixed(1)})`);
  }
  if (earlyReturn >= BUY_CONDITIONS.earlyReturn_max) {
    result.passed = false;
    result.reasons.push(`earlyReturn>=40 (${earlyReturn.toFixed(1)})`);
  }
  if (riseSpeed >= BUY_CONDITIONS.riseSpeed_max) {
    result.passed = false;
    result.reasons.push(`riseSpeed>=25 (${riseSpeed.toFixed(1)})`);
  }

  return result;
}

async function main() {
  const EXP_ID = "4101ee2e-6e9c-437b-a44f-6c7e96a32085";
  const TOKEN = "0xe079942b37bcfec88cea509bffbcf4d5365e4444";

  console.log("=== Habibi (0xe0799...) 买入条件分析 ===\n");

  // 获取时序数据
  const { data: tsData } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', EXP_ID)
    .eq('token_address', TOKEN)
    .order('timestamp', { ascending: true })
    .limit(200);

  if (!tsData || tsData.length === 0) {
    console.log("没有时序数据");
    return;
  }

  console.log(`时序数据点数: ${tsData.length}\n`);

  // 先检查所有数据点（包括 age < 1.5）
  console.log("=== 所有数据点 ===\n");

  let everPassed = false;
  let firstPassWithoutAge = null;

  for (let i = 0; i < tsData.length; i++) {
    const row = tsData[i];
    const factors = row.factor_values || {};
    const age = factors.age || 0;

    if (age > 1.5) {
      const time = new Date(row.timestamp).toLocaleTimeString();
      const result = checkBuyCondition(factors);

      if (result.passed && !everPassed) {
        console.log(`[${i + 1}] ${time} age=${age.toFixed(2)}min ✅ 满足所有条件！`);
        console.log(`   earlyReturn=${(factors.earlyReturn || 0).toFixed(1)}% riseSpeed=${(factors.riseSpeed || 0).toFixed(1)} trendCV=${(factors.trendCV || 0).toFixed(3)} trendTotalReturn=${(factors.trendTotalReturn || 0).toFixed(1)}%`);
        everPassed = true;
      } else if (!result.passed) {
        // 显示失败条件
        const reasonsStr = result.reasons.join(', ');
        console.log(`[${i + 1}] ${time} age=${age.toFixed(2)}min ❌ ${reasonsStr}`);
      }
    }
  }

  console.log(`\n=== 总结 ===`);
  if (everPassed) {
    console.log(`该代币曾满足买入条件，但未购买。`);
  } else {
    console.log(`该代币在整个观测期间从未满足买入条件。`);
  }
}

main().catch(console.error);
