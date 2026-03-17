import fs from 'fs';

/**
 * 人工标注与机器V2评分对比
 */
class HumanMachineComparisonV2 {
  constructor() {
    this.humanData = JSON.parse(fs.readFileSync('narrative_analysis/human_judged_tokens.json', 'utf-8'));
    this.machineScores = JSON.parse(fs.readFileSync('narrative_analysis/narrative_scores_v2.json', 'utf-8'));
    this.machineMap = new Map(this.machineScores.map(s => [s.token, s]));
  }

  compare() {
    console.log('=== 人工标注 vs 机器V2评分 对比分析 ===\n');

    const comparison = {
      high_high: [], high_mid: [], high_low: [],
      mid_high: [], mid_mid: [], mid_low: [],
      low_high: [], low_mid: [], low_low: []
    };

    this.humanData.forEach(token => {
      const machineScore = this.machineMap.get(token.token_symbol);
      if (!machineScore) return;

      const humanCat = token.human_judges?.category;
      if (!humanCat) return;

      const key = `${humanCat.split('_')[0]}_${machineScore.category}`;
      comparison[key].push({
        token: token.token_symbol,
        human: humanCat,
        machine: machineScore.category,
        machineScore: machineScore.total_score,
        scores: machineScore.scores
      });
    });

    // 统计
    console.log('=== 机器V2评分分布 ===');
    console.log(`高质量: ${this.machineScores.filter(s => s.category === 'high').length}`);
    console.log(`中质量: ${this.machineScores.filter(s => s.category === 'mid').length}`);
    console.log(`低质量: ${this.machineScores.filter(s => s.category === 'low').length}`);

    console.log('\n=== 一致性分析 ===');
    const total = comparison.high_high.length + comparison.mid_mid.length + comparison.low_low.length;
    const totalCompared = Object.values(comparison).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`完全一致: ${total}/${totalCompared} (${(total/totalCompared*100).toFixed(1)}%)`);
    console.log(`人工高→机器高: ${comparison.high_high.length}`);
    console.log(`人工中→机器中: ${comparison.mid_mid.length}`);
    console.log(`人工低→机器低: ${comparison.low_low.length}`);

    console.log('\n=== 关键误判案例 ===');

    console.log(`\n【人工高 → 机器低】(严重误判): ${comparison.high_low.length}个`);
    comparison.high_low.slice(0, 3).forEach(item => {
      const tweet = this.machineMap.get(item.token);
      console.log(`  ${item.token} (${item.machineScore}分)`);
      console.log(`    ${tweet?.text?.substring(0, 80)}...`);
    });

    console.log(`\n【人工低 → 机器高】(过度乐观): ${comparison.low_high.length}个`);
    comparison.low_high.slice(0, 3).forEach(item => {
      const tweet = this.machineMap.get(item.token);
      console.log(`  ${item.token} (${item.machineScore}分)`);
      console.log(`    ${tweet?.text?.substring(0, 80)}...`);
    });

    // 保存结果
    fs.writeFileSync(
      'narrative_analysis/comparison_v2.json',
      JSON.stringify(comparison, null, 2)
    );

    return comparison;
  }
}

// 执行
new HumanMachineComparisonV2().compare();
