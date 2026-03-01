const { ConditionEvaluator } = require('./src/strategies/ConditionEvaluator');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function test() {
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

  const factors = loop228.factor_values || {};

  console.log("=== 测试策略条件评估 ===\n");
  console.log("条件:", NEW_CONDITION);
  console.log("\n因子值:");
  console.log("  age:", factors.age);
  console.log("  earlyReturn:", factors.earlyReturn);
  console.log("  riseSpeed:", factors.riseSpeed);
  console.log("  trendCV:", factors.trendCV);
  console.log("  trendDirectionCount:", factors.trendDirectionCount);
  console.log("  trendStrengthScore:", factors.trendStrengthScore);
  console.log("  trendTotalReturn:", factors.trendTotalReturn);
  console.log("  trendRecentDownRatio:", factors.trendRecentDownRatio);
  console.log("  drawdownFromHighest:", factors.drawdownFromHighest);

  // 使用ConditionEvaluator评估条件
  const evaluator = new ConditionEvaluator();
  const result = evaluator.evaluate(NEW_CONDITION, factors);

  console.log("\n=== 评估结果 ===");
  console.log("结果:", result ? "✅ 满足条件" : "❌ 不满足条件");

  // 逐步检查每个条件
  console.log("\n=== 逐步检查 ===");
  const checks = [
    { name: "trendCV > 0.005", expr: factors.trendCV > 0.005, value: factors.trendCV },
    { name: "trendDirectionCount >= 2", expr: factors.trendDirectionCount >= 2, value: factors.trendDirectionCount },
    { name: "trendStrengthScore >= 30", expr: factors.trendStrengthScore >= 30, value: factors.trendStrengthScore },
    { name: "trendTotalReturn >= 5", expr: factors.trendTotalReturn >= 5, value: factors.trendTotalReturn },
    { name: "trendRecentDownRatio < 0.6", expr: (factors.trendRecentDownRatio || 0) < 0.6, value: factors.trendRecentDownRatio || 0 },
    { name: "drawdownFromHighest > -25", expr: (factors.drawdownFromHighest || 0) > -25, value: factors.drawdownFromHighest || 0 },
    { name: "earlyReturn < 60", expr: factors.earlyReturn < 60, value: factors.earlyReturn },
    { name: "riseSpeed < 35", expr: factors.riseSpeed < 35, value: factors.riseSpeed },
    { name: "trendCV < 0.12", expr: factors.trendCV < 0.12, value: factors.trendCV },
    { name: "age > 1.3", expr: factors.age > 1.3, value: factors.age }
  ];

  let allPassed = true;
  checks.forEach(c => {
    console.log(`  ${c.expr ? '✅' : '❌'} ${c.name}: ${c.value}`);
    if (!c.expr) allPassed = false;
  });

  console.log("\n总结:", allPassed ? "✅ 所有条件满足" : "❌ 有条件不满足");
}
test().catch(console.error);
