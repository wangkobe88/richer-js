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

// 检查条件（可选择是否检查age）
function checkBuyCondition(factors, checkAge = true) {
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

  if (checkAge && age < BUY_CONDITIONS.age_min) {
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

  console.log("=== Habibi (0xe079...) 完整买入条件分析 ===\n");

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

  // 分析所有数据点
  let everPassedWithAge = false;
  let everPassedWithoutAge = false;
  let bestMatchWithoutAge = null;
  let minFailedWithoutAge = 100;

  for (let i = 0; i < tsData.length; i++) {
    const row = tsData[i];
    const factors = row.factor_values || {};
    const age = factors.age || 0;
    const time = new Date(row.timestamp).toLocaleTimeString();

    // 检查包含age条件
    const resultWithAge = checkBuyCondition(factors, true);
    if (resultWithAge.passed && !everPassedWithAge) {
      console.log(`[满足条件] ${time} age=${age.toFixed(2)}min ✅ 满足所有条件（包括age）`);
      everPassedWithAge = true;
    }

    // 检查不包含age条件
    const resultWithoutAge = checkBuyCondition(factors, false);
    if (resultWithoutAge.passed && !everPassedWithoutAge) {
      console.log(`[满足条件] ${time} age=${age.toFixed(2)}min ✅ 满足条件（忽略age）`);
      everPassedWithoutAge = true;
      firstPassWithoutAge = { row, i };
    }

    // 记录失败条件最少的点（忽略age）
    if (!everPassedWithoutAge && !resultWithoutAge.passed) {
      if (resultWithoutAge.reasons.length < minFailedWithoutAge) {
        minFailedWithoutAge = resultWithoutAge.reasons.length;
        bestMatchWithoutAge = { row, result: resultWithoutAge, i };
      }
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("\n=== 总结 ===");

  if (everPassedWithAge) {
    console.log(`✅ 该代币曾满足包含age>1.5的所有买入条件`);
  } else {
    console.log(`❌ 该代币从未满足包含age>1.5的所有买入条件`);
  }

  if (everPassedWithoutAge) {
    const age = firstPassWithoutAge.row.factor_values?.age || 0;
    const time = new Date(firstPassWithoutAge.row.timestamp).toLocaleTimeString();
    const factors = firstPassWithoutAge.row.factor_values || {};
    console.log(`\n✅ 如果去掉age条件，该代币在以下时点满足条件:`);
    console.log(`   时间: ${time}, age=${age.toFixed(2)}min`);
    console.log(`   earlyReturn=${(factors.earlyReturn || 0).toFixed(1)}%, riseSpeed=${(factors.riseSpeed || 0).toFixed(1)}, trendCV=${(factors.trendCV || 0).toFixed(3)}, trendTotalReturn=${(factors.trendTotalReturn || 0).toFixed(1)}%`);
  } else if (bestMatchWithoutAge) {
    const { row, result, i } = bestMatchWithoutAge;
    const age = row.factor_values?.age || 0;
    const time = new Date(row.timestamp).toLocaleTimeString();
    const factors = row.factor_values || {};

    console.log(`\n❌ 即使去掉age条件，该代币也从未满足其他所有条件`);
    console.log(`\n最接近满足的时点 (数据点${i + 1}/${tsData.length}):`);
    console.log(`   时间: ${time}, age=${age.toFixed(2)}min`);
    console.log(`   earlyReturn=${(factors.earlyReturn || 0).toFixed(1)}%, riseSpeed=${(factors.riseSpeed || 0).toFixed(1)}, trendCV=${(factors.trendCV || 0).toFixed(3)}, trendTotalReturn=${(factors.trendTotalReturn || 0).toFixed(1)}%`);
    console.log(`   不满足条件 (${result.reasons.length}项):`);
    result.reasons.forEach(reason => console.log(`     - ${reason}`));

    // 显示前20个数据点的关键因子
    console.log(`\n=== 前20个数据点的关键因子 ===`);
    console.log(`序号   时间      age     earlyReturn  riseSpeed  trendCV   trendTotalReturn  trendDirectionCount`);
    for (let j = 0; j < Math.min(20, tsData.length); j++) {
      const r = tsData[j];
      const f = r.factor_values || {};
      const t = new Date(r.timestamp).toLocaleTimeString();
      const idx = (j + 1).toString().padStart(2, ' ');
      console.log(`[${idx}] ${t} ${(f.age || 0).toFixed(2)}min     ${(f.earlyReturn || 0).toFixed(1)}%        ${(f.riseSpeed || 0).toFixed(1)}         ${(f.trendCV || 0).toFixed(3)}     ${(f.trendTotalReturn || 0).toFixed(1)}%              ${f.trendDirectionCount || 0}`);
    }
  }
}

main().catch(console.error);
