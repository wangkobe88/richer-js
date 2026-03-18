import fs from 'fs';

/**
 * 人工标注与机器评分对比分析
 */
class HumanMachineComparison {
  constructor() {
    // 加载数据
    this.humanData = JSON.parse(fs.readFileSync('data/human_judged_tokens.json', 'utf-8'));
    this.machineScores = JSON.parse(fs.readFileSync('data/narrative_scores.json', 'utf-8'));

    // 创建token到机器评分的映射
    this.machineMap = new Map(
      this.machineScores.map(s => [s.token, s])
    );
  }

  /**
   * 对比分析
   */
  compare() {
    console.log('=== 人工标注 vs 机器评分 对比分析 ===\n');

    // 统计
    const comparison = {
      high_high: [],    // 人工高 → 机器高
      high_mid: [],     // 人工高 → 机器中
      high_low: [],     // 人工高 → 机器低
      mid_high: [],
      mid_mid: [],
      mid_low: [],
      low_high: [],
      low_mid: [],
      low_low: []
    };

    this.humanData.forEach(token => {
      const machineScore = this.machineMap.get(token.token_symbol);
      if (!machineScore) return;

      const humanCat = token.human_judges?.category;
      const machineCat = machineScore.category;

      if (!humanCat) return;

      const key = `${humanCat.split('_')[0]}_${machineCat}`;
      comparison[key].push({
        token: token.token_symbol,
        human: humanCat,
        machine: machineCat,
        machineScore: machineScore.total_score,
        scores: machineScore.scores
      });
    });

    // 打印统计
    console.log('=== 一致性统计 ===');
    console.log('人工标注分布:');
    console.log(`  高质量: ${this.humanData.filter(t => t.human_judges?.category === 'high_quality').length}`);
    console.log(`  中质量: ${this.humanData.filter(t => t.human_judges?.category === 'mid_quality').length}`);
    console.log(`  低质量: ${this.humanData.filter(t => t.human_judges?.category === 'low_quality').length}`);

    console.log('\n机器评分分布:');
    console.log(`  高质量: ${this.machineScores.filter(s => s.category === 'high').length}`);
    console.log(`  中质量: ${this.machineScores.filter(s => s.category === 'mid').length}`);
    console.log(`  低质量: ${this.machineScores.filter(s => s.category === 'low').length}`);

    // 显示关键差异
    console.log('\n=== 关键差异分析 ===');

    console.log(`\n【人工高 → 机器低】(最严重的误判): ${comparison.high_low.length}个`);
    if (comparison.high_low.length > 0) {
      comparison.high_low.slice(0, 5).forEach(item => {
        console.log(`\n  ${item.token} - 机器分: ${item.machineScore}`);
        console.log(`    清晰度: ${item.scores.clarity}/30, 可信度: ${item.scores.credibility}/25`);
        console.log(`    吸引力: ${item.scores.appeal}/20, 时效性: ${item.scores.timeliness}/15, 完整性: ${item.scores.completeness}/10`);
        console.log(`    推文: ${this.machineMap.get(item.token)?.text?.substring(0, 100)}...`);
      });
    }

    console.log(`\n【人工高 → 机器中】(需要调整): ${comparison.high_mid.length}个`);
    if (comparison.high_mid.length > 0) {
      comparison.high_mid.slice(0, 3).forEach(item => {
        console.log(`\n  ${item.token} - 机器分: ${item.machineScore}`);
        console.log(`    清晰度: ${item.scores.clarity}/30, 可信度: ${item.scores.credibility}/25`);
        console.log(`    推文: ${this.machineMap.get(item.token)?.text?.substring(0, 80)}...`);
      });
    }

    console.log(`\n【人工低 → 机器高】(过度乐观): ${comparison.low_high.length}个`);

    // 评分维度分析
    console.log('\n=== 评分维度分析 ===');
    this.analyzeDimensions();

    // 保存对比结果
    const comparisonData = {
      summary: {
        high_high: comparison.high_high.length,
        high_mid: comparison.high_mid.length,
        high_low: comparison.high_low.length,
        mid_high: comparison.mid_high.length,
        mid_mid: comparison.mid_mid.length,
        mid_low: comparison.mid_low.length,
        low_high: comparison.low_high.length,
        low_mid: comparison.low_mid.length,
        low_low: comparison.low_low.length
      },
      details: comparison
    };

    fs.writeFileSync(
      'data/human_machine_comparison.json',
      JSON.stringify(comparisonData, null, 2)
    );

    console.log('\n对比结果已保存到 data/human_machine_comparison.json');

    return comparison;
  }

  /**
   * 分析各评分维度
   */
  analyzeDimensions() {
    // 分析人工标注为"高质量"的代币，看机器在哪些维度得分低
    const highQualityHuman = this.humanData
      .filter(t => t.human_judges?.category === 'high_quality')
      .map(t => this.machineMap.get(t.token_symbol))
      .filter(s => s);

    if (highQualityHuman.length === 0) {
      console.log('  没有找到人工标注为高质量的推文数据');
      return;
    }

    const avgScores = {
      clarity: { sum: 0, count: 0, max: 30 },
      credibility: { sum: 0, count: 0, max: 25 },
      appeal: { sum: 0, count: 0, max: 20 },
      timeliness: { sum: 0, count: 0, max: 15 },
      completeness: { sum: 0, count: 0, max: 10 }
    };

    highQualityHuman.forEach(s => {
      Object.keys(avgScores).forEach(dim => {
        if (s.scores[dim] !== undefined) {
          avgScores[dim].sum += s.scores[dim];
          avgScores[dim].count++;
        }
      });
    });

    console.log('\n人工标注"高质量"的平均机器得分:');
    Object.entries(avgScores).forEach(([dim, data]) => {
      const avg = data.count > 0 ? (data.sum / data.count).toFixed(1) : 0;
      const pct = data.count > 0 ? ((data.sum / data.count) / data.max * 100).toFixed(0) : 0;
      console.log(`  ${dim}: ${avg}/${data.max} (${pct}%)`);
    });

    // 找出得分最低的维度
    const sortedDims = Object.entries(avgScores)
      .map(([dim, data]) => ({
        dim,
        avg: data.count > 0 ? data.sum / data.count : 0,
        max: data.max,
        pct: data.count > 0 ? (data.sum / data.count) / data.max * 100 : 0
      }))
      .sort((a, b) => a.pct - b.pct);

    console.log('\n得分率最低的维度 (可能需要调整):');
    sortedDims.slice(0, 3).forEach(({ dim, avg, max, pct }) => {
      console.log(`  ${dim}: ${avg.toFixed(1)}/${max} (${pct.toFixed(0)}%)`);
    });
  }
}

// 执行对比
try {
  const comparison = new HumanMachineComparison();
  comparison.compare();
  console.log('\n分析完成！');
  process.exit(0);
} catch (err) {
  console.error('错误:', err);
  process.exit(1);
}
