const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// 买入条件（从实验配置获取）
// trendCV > 0.005 AND trendDirectionCount >= 2 AND trendStrengthScore >= 30 AND
// trendTotalReturn >= 5 AND trendRecentDownRatio < 0.6 AND drawdownFromHighest > -25 AND
// earlyReturn < 40 AND riseSpeed < 25 AND trendCV < 0.08 AND age > 1.5

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

// 检查单个时序数据点是否满足买入条件
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

  const failedConditions = [];

  if (trendCV <= BUY_CONDITIONS.trendCV_min) failedConditions.push(`trendCV<=0.005 (${trendCV.toFixed(3)})`);
  if (trendCV >= BUY_CONDITIONS.trendCV_max) failedConditions.push(`trendCV>=0.08 (${trendCV.toFixed(3)})`);
  if (trendDirectionCount < BUY_CONDITIONS.trendDirectionCount_min) failedConditions.push(`trendDirectionCount<2 (${trendDirectionCount})`);
  if (trendStrengthScore < BUY_CONDITIONS.trendStrengthScore_min) failedConditions.push(`trendStrengthScore<30 (${trendStrengthScore.toFixed(1)})`);
  if (trendTotalReturn < BUY_CONDITIONS.trendTotalReturn_min) failedConditions.push(`trendTotalReturn<5 (${trendTotalReturn.toFixed(1)})`);
  if (trendRecentDownRatio >= BUY_CONDITIONS.trendRecentDownRatio_max) failedConditions.push(`trendRecentDownRatio>=0.6 (${trendRecentDownRatio.toFixed(2)})`);
  if (drawdownFromHighest <= BUY_CONDITIONS.drawdownFromHighest_min) failedConditions.push(`drawdownFromHighest<=-25 (${drawdownFromHighest.toFixed(1)})`);
  if (earlyReturn >= BUY_CONDITIONS.earlyReturn_max) failedConditions.push(`earlyReturn>=40 (${earlyReturn.toFixed(1)})`);
  if (riseSpeed >= BUY_CONDITIONS.riseSpeed_max) failedConditions.push(`riseSpeed>=25 (${riseSpeed.toFixed(1)})`);
  if (age < BUY_CONDITIONS.age_min) failedConditions.push(`age<1.5 (${age.toFixed(2)})`);

  return {
    passed: failedConditions.length === 0,
    failedConditions,
    factors: { trendCV, earlyReturn, age, riseSpeed, trendDirectionCount, trendStrengthScore, trendTotalReturn, trendRecentDownRatio, drawdownFromHighest }
  };
}

async function main() {
  const EXP_ID = "4101ee2e-6e9c-437b-a44f-6c7e96a32085";

  // 1. 获取高涨幅但未买入的代币
  console.log("=== 获取高涨幅但未买入的代币 ===\n");

  const { data: tokens, error } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', EXP_ID)
    .gte('analysis_results->>max_change_percent', 50)
    .not('status', 'in', '(bought,selling,exited)');

  if (error) {
    console.error("查询错误:", error);
    return;
  }

  console.log(`找到 ${tokens.length} 个高涨幅但未买入的代币\n`);

  // 统计失败条件的原因
  const failureReasons = {};

  // 分析每个代币
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const address = token.token_address;
    const symbol = token.token_symbol || 'UNKNOWN';
    const maxChange = token.analysis_results?.max_change_percent || 0;

    console.log(`\n[${i + 1}/${tokens.length}] ${symbol} (${address.slice(0, 10)}...) - 最大涨幅: ${maxChange.toFixed(2)}%`);

    // 获取时序数据
    const { data: tsData } = await supabase
      .from('experiment_time_series_data')
      .select('*')
      .eq('experiment_id', EXP_ID)
      .eq('token_address', address)
      .order('timestamp', { ascending: true })
      .limit(200);

    if (!tsData || tsData.length === 0) {
      console.log("  ⚠️  无时序数据");
      continue;
    }

    // 检查 age > 1.5 之后的所有数据点，看是否曾经满足过买入条件
    let everPassed = false;
    let firstPassPoint = null;
    let allFailedReasons = {};

    for (const row of tsData) {
      const factors = row.factor_values || {};
      const age = factors.age || 0;

      // 只检查 age > 1.5 分钟后的数据
      if (age > 1.5) {
        const result = checkBuyCondition(factors);

        // 统计所有失败原因
        if (!result.passed) {
          result.failedConditions.forEach(reason => {
            const key = reason.split('(')[0].trim();
            allFailedReasons[key] = (allFailedReasons[key] || 0) + 1;
          });
        }

        // 找到第一个满足条件的点
        if (!everPassed && result.passed) {
          everPassed = true;
          firstPassPoint = { row, result };
        }
      }
    }

    if (everPassed) {
      const { row, result } = firstPassPoint;
      const factors = row.factor_values || {};
      const time = new Date(row.timestamp).toLocaleTimeString();

      console.log(`  ✅ 曾满足条件 (${time}, age=${(factors.age || 0).toFixed(2)}min):`);
      console.log(`    earlyReturn=${(factors.earlyReturn || 0).toFixed(1)}% riseSpeed=${(factors.riseSpeed || 0).toFixed(1)} trendCV=${(factors.trendCV || 0).toFixed(3)} trendTotalReturn=${(factors.trendTotalReturn || 0).toFixed(1)}%`);
      console.log(`    ⚠️  满足条件但未买入！`);
    } else {
      console.log(`  ❌ 从未满足条件`);

      // 显示最接近满足的点（失败条件最少的点）
      const validPoints = tsData.filter(row => (row.factor_values?.age || 0) > 1.5);
      if (validPoints.length > 0) {
        // 找失败条件最少的点
        let bestPoint = null;
        let minFailed = 100;
        for (const row of validPoints) {
          const result = checkBuyCondition(row.factor_values || {});
          if (result.failedConditions.length < minFailed) {
            minFailed = result.failedConditions.length;
            bestPoint = { row, result };
          }
        }

        if (bestPoint) {
          const { row, result } = bestPoint;
          const factors = row.factor_values || {};
          const time = new Date(row.timestamp).toLocaleTimeString();

          console.log(`  最接近点 (${time}, age=${(factors.age || 0).toFixed(2)}min, ${result.failedConditions.length}项不满足):`);
          result.failedConditions.forEach(reason => console.log(`    - ${reason}`));

          // 统计到总失败原因中
          result.failedConditions.forEach(reason => {
            const key = reason.split('(')[0].trim();
            failureReasons[key] = (failureReasons[key] || 0) + 1;
          });
        }
      }
    }
  }

  // 打印统计结果
  console.log("\n\n=== 失败原因统计 ===");
  const sortedReasons = Object.entries(failureReasons)
    .sort((a, b) => b[1] - a[1]);

  sortedReasons.forEach(([reason, count]) => {
    const pct = (count / tokens.length * 100).toFixed(1);
    console.log(`${reason}: ${count}次 (${pct}%)`);
  });
}

main().catch(console.error);
