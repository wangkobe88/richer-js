const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  const SOURCE_EXP = "4101ee2e-6e9c-437b-a44f-6c7e96a32085";
  const TOKEN = "0xe079942b37bcfec88cea509bffbcf4d5365e4444";

  // 新条件
  const NEW_CONDITION = "trendCV > 0.005 AND trendDirectionCount >= 2 AND trendStrengthScore >= 30 AND trendTotalReturn >= 5 AND trendRecentDownRatio < 0.6 AND drawdownFromHighest > -25 AND earlyReturn < 60 AND riseSpeed < 35 AND trendCV < 0.12 AND age > 1.3";

  // 获取Habibi的loop 228数据
  const { data: loop228 } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', SOURCE_EXP)
    .eq('token_address', TOKEN)
    .eq('loop_count', 228)
    .single();

  if (!loop228) {
    console.log("没有找到loop 228的数据");
    return;
  }

  console.log("=== Habibi loop 228 数据 ===\n");
  console.log("时间:", new Date(loop228.timestamp).toLocaleString());
  console.log("价格:", loop228.price_usd);

  const factors = loop228.factor_values || {};
  console.log("\n因子值:");
  console.log("  age:", (factors.age || 0).toFixed(2), "(> 1.3)");
  console.log("  earlyReturn:", (factors.earlyReturn || 0).toFixed(1), "% (< 60)");
  console.log("  riseSpeed:", (factors.riseSpeed || 0).toFixed(1), "(< 35)");
  console.log("  trendCV:", (factors.trendCV || 0).toFixed(3), "(0.005 - 0.12)");
  console.log("  trendDirectionCount:", factors.trendDirectionCount || 0, "(>= 2)");
  console.log("  trendStrengthScore:", (factors.trendStrengthScore || 0).toFixed(1), "(>= 30)");
  console.log("  trendTotalReturn:", (factors.trendTotalReturn || 0).toFixed(1), "% (>= 5)");

  // 检查条件
  const checks = [
    { name: "age > 1.3", passed: (factors.age || 0) > 1.3, value: (factors.age || 0).toFixed(2) },
    { name: "earlyReturn < 60", passed: (factors.earlyReturn || 0) < 60, value: (factors.earlyReturn || 0).toFixed(1) + "%" },
    { name: "riseSpeed < 35", passed: (factors.riseSpeed || 0) < 35, value: (factors.riseSpeed || 0).toFixed(1) },
    { name: "trendCV > 0.005", passed: (factors.trendCV || 0) > 0.005, value: (factors.trendCV || 0).toFixed(3) },
    { name: "trendCV < 0.12", passed: (factors.trendCV || 0) < 0.12, value: (factors.trendCV || 0).toFixed(3) },
    { name: "trendDirectionCount >= 2", passed: (factors.trendDirectionCount || 0) >= 2, value: factors.trendDirectionCount || 0 },
    { name: "trendStrengthScore >= 30", passed: (factors.trendStrengthScore || 0) >= 30, value: (factors.trendStrengthScore || 0).toFixed(1) },
    { name: "trendTotalReturn >= 5", passed: (factors.trendTotalReturn || 0) >= 5, value: (factors.trendTotalReturn || 0).toFixed(1) + "%" }
  ];

  console.log("\n=== 条件检查 ===");
  const allPassed = checks.every(c => c.passed);
  checks.forEach(c => {
    console.log(`  ${c.passed ? '✅' : '❌'} ${c.name}: ${c.value}`);
  });

  console.log(`\n结果: ${allPassed ? '✅ 所有条件满足，应该买入！' : '❌ 有条件不满足，不买入'}`);

  // 检查是否有factor_values数据缺失
  const missingFactors = [];
  if (!factors.age) missingFactors.push("age");
  if (!factors.earlyReturn) missingFactors.push("earlyReturn");
  if (!factors.riseSpeed) missingFactors.push("riseSpeed");
  if (!factors.trendCV) missingFactors.push("trendCV");
  if (!factors.trendDirectionCount) missingFactors.push("trendDirectionCount");
  if (!factors.trendStrengthScore) missingFactors.push("trendStrengthScore");
  if (!factors.trendTotalReturn) missingFactors.push("trendTotalReturn");

  if (missingFactors.length > 0) {
    console.log(`\n⚠️  缺失的因子: ${missingFactors.join(", ")}`);
  }
}
main().catch(console.error);
