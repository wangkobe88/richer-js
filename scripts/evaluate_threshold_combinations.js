/**
 * 评估不同购买前检查阈值组合的效果
 * 基于实验 6be58f66 的人工判断数据
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function evaluateThresholds() {
  const experimentId = '6be58f66-8b75-46b8-8bb5-c3388fa0a195';

  // 1. 获取实验信息
  const { data: experiment } = await supabase
    .from('experiments')
    .select('config')
    .eq('id', experimentId)
    .single();

  const sourceExperimentId = experiment?.config?.backtest?.sourceExperimentId;
  if (!sourceExperimentId) {
    console.error('未找到源实验ID');
    return;
  }

  // 2. 获取有人工判断的代币
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, human_judges')
    .eq('experiment_id', sourceExperimentId)
    .not('human_judges', 'is', null);

  // 3. 获取购买信号的metadata
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy');

  // 4. 解析数据
  const tokenData = [];

  for (const token of tokens) {
    const category = token.human_judges?.category?.toLowerCase();
    const isGood = category === 'high_quality' || category === 'mid_quality';
    const qualityLabel = category === 'high_quality' ? 'high' : category === 'mid_quality' ? 'mid' : 'low';

    const signal = signals?.find(s => s.token_address === token.token_address);
    let factors = {};

    if (signal) {
      try {
        let metadata = signal.metadata;
        if (typeof metadata === 'string') {
          metadata = JSON.parse(metadata);
        }
        factors = metadata?.preBuyCheckFactors || {};
      } catch (e) {
        // 解析失败，factors 保持为空
      }
    }

    tokenData.push({
      address: token.token_address,
      symbol: token.token_symbol,
      isGood,  // 真实标签：好/坏
      qualityLabel,
      factors
    });
  }

  // 移除没有信号数据的代币（无法评估）
  const validTokens = tokenData.filter(t => Object.keys(t.factors).length > 0);
  console.log(`有效代币数量: ${validTokens.length} (总共 ${tokenData.length} 个标记代币)\n`);

  const goodCount = validTokens.filter(t => t.isGood).length;
  const badCount = validTokens.filter(t => !t.isGood).length;
  console.log(`中高质量: ${goodCount}, 低质量: ${badCount}\n`);

  // 5. 定义阈值组合
  const thresholdCombos = [
    {
      name: '当前配置（宽松）',
      description: '当前使用的阈值',
      thresholds: {
        earlyTradesHighValuePerMin: 5.6,
        earlyTradesCountPerMin: 10.6,
        earlyTradesActualSpan: 65
      }
    },
    {
      name: '推荐配置1（中等）',
      description: '平衡召回率和精度',
      thresholds: {
        earlyTradesHighValuePerMin: 15,
        earlyTradesCountPerMin: 50,
        earlyTradesActualSpan: 70
      }
    },
    {
      name: '推荐配置2（严格）',
      description: '追求高精度，过滤更多低质量',
      thresholds: {
        earlyTradesHighValuePerMin: 18,
        earlyTradesCountPerMin: 60,
        earlyTradesActualSpan: 75,
        earlyTradesVolumePerMin: 4000,
        earlyTradesUniqueWallets: 40
      }
    },
    {
      name: '推荐配置3（超严格）',
      description: '只保留最强信号',
      thresholds: {
        earlyTradesHighValuePerMin: 20,
        earlyTradesCountPerMin: 70,
        earlyTradesActualSpan: 80,
        earlyTradesVolumePerMin: 5000,
        earlyTradesUniqueWallets: 45
      }
    },
    {
      name: '推荐配置4（激进）',
      description: '低阈值，高召回率',
      thresholds: {
        earlyTradesHighValuePerMin: 10,
        earlyTradesCountPerMin: 30,
        earlyTradesActualSpan: 60
      }
    },
    {
      name: '推荐配置5（保守）',
      description: '主要依赖交易量',
      thresholds: {
        earlyTradesVolumePerMin: 4000,
        earlyTradesHighValuePerMin: 12,
        earlyTradesCountPerMin: 40
      }
    }
  ];

  // 6. 评估每个阈值组合
  const results = [];

  for (const combo of thresholdCombos) {
    const thresholds = combo.thresholds;

    // 统计
    let tp = 0, fp = 0, tn = 0, fn = 0;
    const passedTokens = [];
    const rejectedTokens = [];

    for (const token of validTokens) {
      const f = token.factors;
      let passed = true;

      // 检查每个阈值
      for (const [key, minValue] of Object.entries(thresholds)) {
        const value = f[key];
        if (value === null || value === undefined || value < minValue) {
          passed = false;
          break;
        }
      }

      if (passed) {
        if (token.isGood) {
          tp++;
        } else {
          fp++;
        }
        passedTokens.push(token);
      } else {
        if (token.isGood) {
          fn++;
        } else {
          tn++;
        }
        rejectedTokens.push(token);
      }
    }

    const total = tp + fp + tn + fn;
    const precision = tp + fp > 0 ? (tp / (tp + fp)) : 0;
    const recall = tp + fn > 0 ? (tp / (tp + fn)) : 0;
    const specificity = tn + fp > 0 ? (tn / (tn + fp)) : 0;
    const f1Score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    const accuracy = (tp + tn) / total;

    results.push({
      name: combo.name,
      description: combo.description,
      thresholds,
      confusionMatrix: { tp, fp, tn, fn },
      metrics: {
        precision: precision * 100,
        recall: recall * 100,
        specificity: specificity * 100,
        f1Score: f1Score * 100,
        accuracy: accuracy * 100,
        passRate: ((tp + fp) / total) * 100
      },
      passedTokens: passedTokens.map(t => `${t.symbol} (${t.qualityLabel})`),
      rejectedTokens: rejectedTokens.map(t => `${t.symbol} (${t.qualityLabel})`)
    });
  }

  // 7. 输出结果
  console.log('='.repeat(80));
  console.log('购买前检查阈值组合评估结果');
  console.log('='.repeat(80));
  console.log('');

  for (const result of results) {
    console.log(`【${result.name}】`);
    console.log(`描述: ${result.description}`);
    console.log('');

    // 阈值
    console.log('阈值设置:');
    for (const [key, value] of Object.entries(result.thresholds)) {
      console.log(`  ${key}: >= ${value}`);
    }
    console.log('');

    // 混淆矩阵
    console.log('混淆矩阵:');
    console.log('                    预测');
    console.log('              通过    拒绝');
    console.log(`  实际  好 |  ${result.confusionMatrix.tp.toString().padStart(2)}   |  ${result.confusionMatrix.fn.toString().padStart(2)}  |`);
    console.log('        坏 |  ' + result.confusionMatrix.fp.toString().padStart(2) + '   |  ' + result.confusionMatrix.tn.toString().padStart(2) + '  |');
    console.log('');

    // 指标
    console.log('评估指标:');
    console.log(`  精确率 (Precision): ${result.metrics.precision.toFixed(1)}% - 预测为好的代币中真正好的比例`);
    console.log(`  召回率 (Recall):    ${result.metrics.recall.toFixed(1)}% - 实际好的代币被正确识别的比例`);
    console.log(`  特异度 (Specificity): ${result.metrics.specificity.toFixed(1)}% - 实际坏的代币被正确拒绝的比例`);
    console.log(`  F1分数:            ${result.metrics.f1Score.toFixed(1)}% - 精确率和召回率的调和平均`);
    console.log(`  准确率 (Accuracy):  ${result.metrics.accuracy.toFixed(1)}% - 整体预测正确的比例`);
    console.log(`  通过率:            ${result.metrics.passRate.toFixed(1)}% - 信号通过预检查的比例`);
    console.log('');

    // 通过的代币
    console.log(`通过的代币 (${result.passedTokens.length}个):`);
    if (result.passedTokens.length > 0) {
      console.log('  ' + result.passedTokens.join(', '));
    } else {
      console.log('  无');
    }
    console.log('');

    // 被拒绝的代币
    console.log(`被拒绝的代币 (${result.rejectedTokens.length}个):`);
    if (result.rejectedTokens.length > 0) {
      console.log('  ' + result.rejectedTokens.join(', '));
    } else {
      console.log('  无');
    }
    console.log('');
    console.log('-'.repeat(80));
    console.log('');
  }

  // 8. 总结对比
  console.log('='.repeat(80));
  console.log('各配置对比汇总');
  console.log('='.repeat(80));
  console.log('');
  console.log('配置名称                    精确率   召回率   F1分数   准确率   通过率');
  console.log('-'.repeat(80));

  for (const result of results) {
    const name = result.name.substring(0, 25).padEnd(25);
    console.log(`${name}  ${result.metrics.precision.toFixed(1)}%    ${result.metrics.recall.toFixed(1)}%    ${result.metrics.f1Score.toFixed(1)}%    ${result.metrics.accuracy.toFixed(1)}%    ${result.metrics.passRate.toFixed(1)}%`);
  }
  console.log('');

  // 9. 推荐建议
  console.log('='.repeat(80));
  console.log('推荐建议');
  console.log('='.repeat(80));
  console.log('');

  const bestPrecision = results.reduce((best, r) => r.metrics.precision > best.metrics.precision ? r : best);
  const bestRecall = results.reduce((best, r) => r.metrics.recall > best.metrics.recall ? r : best);
  const bestF1 = results.reduce((best, r) => r.metrics.f1Score > best.metrics.f1Score ? r : best);

  console.log(`🎯 最高精确率: ${bestPrecision.name} (${bestPrecision.metrics.precision.toFixed(1)}%)`);
  console.log(`   通过的代币中，高质量代币占比最高，适合追求确定性的策略`);
  console.log('');

  console.log(`📢 最高召回率: ${bestRecall.name} (${bestRecall.metrics.recall.toFixed(1)}%)`);
  console.log(`   能识别最多的好代币，但可能混入较多低质量代币`);
  console.log('');

  console.log(`⚖️  最佳平衡 (F1): ${bestF1.name} (${bestF1.metrics.f1Score.toFixed(1)}%)`);
  console.log(`   精确率和召回率的最佳平衡点`);
  console.log('');

  // 根据用户风险偏好给出建议
  console.log('选择建议:');
  console.log('  - 保守型（追求确定性，宁可错过）：选择最高精确率的配置');
  console.log('  - 平衡型（兼顾质量和数量）：选择最佳F1分数的配置');
  console.log('  - 激进型（抓住机会，容忍风险）：选择高召回率的配置');
  console.log('');
}

evaluateThresholds().then(() => {
  console.log('评估完成');
  process.exit(0);
}).catch(error => {
  console.error('评估失败:', error);
  process.exit(1);
});
