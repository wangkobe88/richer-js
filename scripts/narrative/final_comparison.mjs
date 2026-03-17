import fs from 'fs';

/**
 * 最终对比分析 - V3 vs 人工标注
 */
class FinalComparison {
  constructor() {
    this.humanData = JSON.parse(fs.readFileSync('narrative_analysis/human_judged_tokens.json', 'utf-8'));
    this.machineScores = JSON.parse(fs.readFileSync('narrative_analysis/narrative_scores_v3.json', 'utf-8'));
    this.machineMap = new Map(this.machineScores.map(s => [s.token, s]));
  }

  compare() {
    console.log('=== 最终对比分析 V3 ===\n');

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
        scores: machineScore.scores,
        text: machineScore.text?.substring(0, 100)
      });
    });

    // 打印完整交叉表
    console.log('=== 交叉对比表 ===');
    console.log('         机器高  机器中  机器低');
    console.log(`人工高    ${comparison.high_high.length}      ${comparison.high_mid.length}      ${comparison.high_low.length}`);
    console.log(`人工中    ${comparison.mid_high.length}      ${comparison.mid_mid.length}      ${comparison.mid_low.length}`);
    console.log(`人工低    ${comparison.low_high.length}      ${comparison.low_mid.length}      ${comparison.low_low.length}`);

    const total = Object.values(comparison).reduce((sum, arr) => sum + arr.length, 0);
    const agree = comparison.high_high.length + comparison.mid_mid.length + comparison.low_low.length;
    console.log(`\n完全一致率: ${agree}/${total} (${(agree/total*100).toFixed(1)}%)`);

    // 方向一致性（忽略中）
    const directionAgree =
      comparison.high_high.length + comparison.high_mid.length +
      comparison.mid_high.length + comparison.mid_mid.length + comparison.mid_low.length +
      comparison.low_mid.length + comparison.low_low.length;
    console.log(`方向一致率: ${directionAgree}/${total} (${(directionAgree/total*100).toFixed(1)}%)`);

    // 关键案例
    console.log('\n=== 高质量案例分析 ===');
    comparison.high_high.forEach(item => {
      console.log(`\n✓ ${item.token}: 人工高 + 机器高 (${item.machineScore}分)`);
      console.log(`  内容: ${item.text}...`);
    });

    console.log('\n=== 误判案例分析 ===');

    if (comparison.high_low.length > 0) {
      console.log('\n✗ 人工高 → 机器低 (严重误判):');
      comparison.high_low.forEach(item => {
        console.log(`  ${item.token} (${item.machineScore}分): ${item.text}...`);
      });
    } else {
      console.log('\n✓ 无人工高→机器低误判');
    }

    if (comparison.low_high.length > 0) {
      console.log('\n✗ 人工低 → 机器高 (过度乐观):');
      comparison.low_high.forEach(item => {
        console.log(`  ${item.token} (${item.machineScore}分): ${item.text}...`);
      });
    } else {
      console.log('\n✓ 无人工低→机器高误判');
    }

    // 评分维度分析
    this.analyzeDimensions();

    // 保存结果
    fs.writeFileSync(
      'narrative_analysis/final_comparison.json',
      JSON.stringify({ comparison, summary: { total, agree, directionAgree } }, null, 2)
    );

    return comparison;
  }

  analyzeDimensions() {
    console.log('\n=== 人工高质量代币的机器评分分析 ===');

    const highHuman = this.humanData
      .filter(t => t.human_judges?.category === 'high_quality')
      .map(t => this.machineMap.get(t.token_symbol))
      .filter(s => s);

    if (highHuman.length === 0) {
      console.log('  无数据');
      return;
    }

    const avgScore = highHuman.reduce((sum, s) => sum + s.total_score, 0) / highHuman.length;
    console.log(`  平均机器分: ${avgScore.toFixed(1)}/100`);
    console.log(`  评为高质量: ${highHuman.filter(s => s.category === 'high').length}/${highHuman.length}`);

    highHuman.forEach(s => {
      console.log(`\n  ${s.token}: ${s.total_score}分 (${s.category})`);
      console.log(`    内容${s.scores.content}/35, 可信${s.scores.credibility}/30, 传播${s.scores.virality}/20, 完整${s.scores.completeness}/15`);
    });
  }
}

// 执行
new FinalComparison().compare();
