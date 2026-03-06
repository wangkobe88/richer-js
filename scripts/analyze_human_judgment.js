/**
 * 分析人工判断数据与购买前检查特征的关系
 * 用于实验 6be58f66-8b75-46b8-8bb5-c3388fa0a195
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function analyzeHumanJudgment() {
  const experimentId = '6be58f66-8b75-46b8-8bb5-c3388fa0a195';

  console.log('=== 开始分析人工判断数据 ===\n');

  // 1. 获取实验信息，找到源实验ID
  const { data: experiment, error: expError } = await supabase
    .from('experiments')
    .select('id, experiment_name, trading_mode, config')
    .eq('id', experimentId)
    .single();

  if (expError) {
    console.error('获取实验信息失败:', expError);
    return;
  }

  console.log('实验信息:');
  console.log(`  ID: ${experiment.id}`);
  console.log(`  名称: ${experiment.experiment_name}`);
  console.log(`  模式: ${experiment.trading_mode}`);

  // 从 config 中获取源实验ID
  const sourceExperimentId = experiment.config?.backtest?.sourceExperimentId;

  console.log(`  源实验ID: ${sourceExperimentId || '无'}\n`);

  if (!sourceExperimentId) {
    console.error('未找到源实验ID（config.backtest.sourceExperimentId）');
    return;
  }

  // 2. 获取有人工判断标记的代币
  const { data: tokens, error: tokensError } = await supabase
    .from('experiment_tokens')
    .select('token_address, human_judges, token_symbol')
    .eq('experiment_id', sourceExperimentId)
    .not('human_judges', 'is', null);

  if (tokensError) {
    console.error('获取代币数据失败:', tokensError);
    return;
  }

  console.log(`找到 ${tokens.length} 个有人工判断标记的代币\n`);

  // 3. 分析质量分布 - category 字段
  const qualityDistribution = { high: 0, medium: 0, low: 0, unknown: 0 };
  const tokensByQuality = { high: [], medium: [], low: [], unknown: [] };

  tokens.forEach(token => {
    // category 可能是: low_quality, mid_quality, high_quality
    const category = token.human_judges?.category?.toLowerCase();
    if (category === 'high_quality') {
      qualityDistribution.high++;
      tokensByQuality.high.push(token);
    } else if (category === 'mid_quality') {
      qualityDistribution.medium++;
      tokensByQuality.medium.push(token);
    } else if (category === 'low_quality') {
      qualityDistribution.low++;
      tokensByQuality.low.push(token);
    } else {
      qualityDistribution.unknown++;
      tokensByQuality.unknown.push(token);
    }
  });

  console.log('质量分布:');
  console.log(`  高质量: ${qualityDistribution.high}`);
  console.log(`  中质量: ${qualityDistribution.medium}`);
  console.log(`  低质量: ${qualityDistribution.low}`);
  console.log(`  未知: ${qualityDistribution.unknown}\n`);

  // 4. 获取这些代币的购买信号metadata
  const { data: signals, error: signalsError } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata, created_at')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy');

  if (signalsError) {
    console.error('获取信号数据失败:', signalsError);
    return;
  }

  console.log(`找到 ${signals.length} 个购买信号\n`);

  // 5. 解析preBuyCheckFactors
  const signalDataMap = new Map();

  signals.forEach(signal => {
    try {
      let metadata = signal.metadata;
      if (typeof metadata === 'string') {
        metadata = JSON.parse(metadata);
      }

      const preBuyCheckFactors = metadata?.preBuyCheckFactors || {};
      signalDataMap.set(signal.token_address, {
        preBuyCheckFactors,
        created_at: signal.created_at
      });
    } catch (e) {
      console.error(`解析信号metadata失败 ${signal.token_address}:`, e.message);
    }
  });

  // 6. 按质量分组统计preBuyCheckFactors
  const factorsByQuality = {
    high: [],
    medium: [],
    low: []
  };

  tokens.forEach(token => {
    const category = token.human_judges?.category?.toLowerCase();
    if (category !== 'high_quality' && category !== 'mid_quality' && category !== 'low_quality') {
      return;
    }

    const qualityKey = category === 'high_quality' ? 'high'
      : category === 'mid_quality' ? 'medium'
      : 'low';

    const signalData = signalDataMap.get(token.token_address);
    if (signalData) {
      factorsByQuality[qualityKey].push({
        token: token.token_address,
        symbol: token.token_symbol,
        ...signalData.preBuyCheckFactors
      });
    }
  });

  // 7. 输出统计结果
  console.log('=== 购买前检查特征统计 ===\n');

  const factorKeys = [
    'holderBlacklistCount',
    'holderWhitelistCount',
    'devHoldingRatio',
    'maxHoldingRatio',
    'earlyTradesCountPerMin',
    'earlyTradesVolumePerMin',
    'earlyTradesHighValuePerMin',
    'earlyTradesWalletsPerMin',
    'earlyTradesUniqueWallets',
    'earlyTradesDataCoverage'
  ];

  function calculateStats(values) {
    if (values.length === 0) return { min: 0, max: 0, avg: 0, median: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / values.length,
      median: sorted[Math.floor(sorted.length / 2)]
    };
  }

  console.log('各质量级别的特征统计:\n');

  ['high', 'medium', 'low'].forEach(quality => {
    const qualityName = quality === 'high' ? '高质量' : quality === 'medium' ? '中质量' : '低质量';
    const data = factorsByQuality[quality];

    console.log(`--- ${qualityName} (${data.length} 个代币) ---`);

    if (data.length === 0) {
      console.log('  无数据\n');
      return;
    }

    factorKeys.forEach(key => {
      const values = data.map(d => d[key]).filter(v => v !== null && v !== undefined);
      if (values.length > 0) {
        const stats = calculateStats(values);
        console.log(`  ${key}:`);
        console.log(`    最小值: ${stats.min.toFixed(2)}`);
        console.log(`    最大值: ${stats.max.toFixed(2)}`);
        console.log(`    平均值: ${stats.avg.toFixed(2)}`);
        console.log(`    中位数: ${stats.median.toFixed(2)}`);
      }
    });
    console.log('');
  });

  // 8. 输出具体代币数据
  console.log('=== 具体代币数据 ===\n');

  ['high', 'medium', 'low'].forEach(quality => {
    const qualityName = quality === 'high' ? '高质量' : quality === 'medium' ? '中质量' : '低质量';
    const data = factorsByQuality[quality];

    console.log(`--- ${qualityName}代币 ---`);

    if (data.length === 0) {
      console.log('无数据\n');
      return;
    }

    data.forEach(item => {
      console.log(`\n代币: ${item.symbol || item.token}`);
      console.log(`  地址: ${item.token}`);
      console.log(`  黑名单数量: ${item.holderBlacklistCount || 0}`);
      console.log(`  Dev持仓比例: ${item.devHoldingRatio || 0}%`);
      console.log(`  最大持仓比例: ${item.maxHoldingRatio || 0}%`);
      console.log(`  早期交易量/分钟: ${item.earlyTradesVolumePerMin || 0}`);
      console.log(`  早期交易数/分钟: ${item.earlyTradesCountPerMin || 0}`);
      console.log(`  早期大额交易/分钟: ${item.earlyTradesHighValuePerMin || 0}`);
      console.log(`  早期独立钱包数: ${item.earlyTradesUniqueWallets || 0}`);
      console.log(`  数据覆盖率: ${item.earlyTradesDataCoverage || 0}%`);
    });
    console.log('');
  });

  // 9. 分析区分度
  console.log('=== 特征区分度分析 ===\n');

  factorKeys.forEach(key => {
    const highValues = factorsByQuality.high.map(d => d[key]).filter(v => v !== null && v !== undefined);
    const mediumValues = factorsByQuality.medium.map(d => d[key]).filter(v => v !== null && v !== undefined);
    const lowValues = factorsByQuality.low.map(d => d[key]).filter(v => v !== null && v !== undefined);

    if (highValues.length > 0 || mediumValues.length > 0 || lowValues.length > 0) {
      console.log(`${key}:`);

      if (highValues.length > 0) {
        const highAvg = highValues.reduce((a, b) => a + b, 0) / highValues.length;
        console.log(`  高质量平均值: ${highAvg.toFixed(2)}`);
      }
      if (mediumValues.length > 0) {
        const mediumAvg = mediumValues.reduce((a, b) => a + b, 0) / mediumValues.length;
        console.log(`  中质量平均值: ${mediumAvg.toFixed(2)}`);
      }
      if (lowValues.length > 0) {
        const lowAvg = lowValues.reduce((a, b) => a + b, 0) / lowValues.length;
        console.log(`  低质量平均值: ${lowAvg.toFixed(2)}`);
      }

      // 计算差异度
      const allValues = [...highValues, ...mediumValues, ...lowValues];
      if (allValues.length > 0) {
        const overallAvg = allValues.reduce((a, b) => a + b, 0) / allValues.length;
        const variance = allValues.reduce((sum, v) => sum + Math.pow(v - overallAvg, 2), 0) / allValues.length;
        console.log(`  整体方差: ${variance.toFixed(2)}`);
      }
      console.log('');
    }
  });

  // 10. 生成过滤建议
  console.log('=== 高质量 vs 低质量特征差异分析 ===\n');

  const highFactors = factorsByQuality.high;
  const lowFactors = factorsByQuality.low;

  if (highFactors.length > 0 && lowFactors.length > 0) {
    console.log(`基于 ${highFactors.length} 个高质量代币和 ${lowFactors.length} 个低质量代币:\n`);

    factorKeys.forEach(key => {
      const highValues = highFactors.map(d => d[key]).filter(v => v !== null && v !== undefined);
      const lowValues = lowFactors.map(d => d[key]).filter(v => v !== null && v !== undefined);

      if (highValues.length > 0 && lowValues.length > 0) {
        const highAvg = highValues.reduce((a, b) => a + b, 0) / highValues.length;
        const lowAvg = lowValues.reduce((a, b) => a + b, 0) / lowValues.length;
        const diff = highAvg - lowAvg;
        const diffPercent = lowAvg !== 0 ? (diff / Math.abs(lowAvg)) * 100 : 0;

        // 判断差异是否显著（差异超过20%或绝对值差异较大）
        const isSignificant = Math.abs(diffPercent) > 20 || Math.abs(diff) > 5;

        if (isSignificant) {
          console.log(`【显著差异】${key}:`);
          console.log(`  高质量平均: ${highAvg.toFixed(2)}`);
          console.log(`  低质量平均: ${lowAvg.toFixed(2)}`);
          console.log(`  差异: ${diff > 0 ? '+' : ''}${diff.toFixed(2)} (${diffPercent > 0 ? '+' : ''}${diffPercent.toFixed(1)}%)`);

          // 根据差异给出建议
          if (diff > 0) {
            console.log(`  建议: 设置下限过滤，高质量值更高`);
          } else {
            console.log(`  建议: 设置上限过滤，高质量值更低`);
          }
          console.log('');
        }
      }
    });
  } else {
    console.log(`数据不足 - 高质量: ${highFactors.length}, 低质量: ${lowFactors.length}`);
  }

  // 11. 中高质量合并分析
  console.log('\n=== 中+高质量 vs 低质量特征差异分析 ===\n');

  const midHighFactors = [...factorsByQuality.high, ...factorsByQuality.medium];

  if (midHighFactors.length > 0 && lowFactors.length > 0) {
    console.log(`基于 ${midHighFactors.length} 个中高质量代币和 ${lowFactors.length} 个低质量代币:\n`);

    factorKeys.forEach(key => {
      const midHighValues = midHighFactors.map(d => d[key]).filter(v => v !== null && v !== undefined);
      const lowValues = lowFactors.map(d => d[key]).filter(v => v !== null && v !== undefined);

      if (midHighValues.length > 0 && lowValues.length > 0) {
        const midHighAvg = midHighValues.reduce((a, b) => a + b, 0) / midHighValues.length;
        const lowAvg = lowValues.reduce((a, b) => a + b, 0) / lowValues.length;
        const diff = midHighAvg - lowAvg;
        const diffPercent = lowAvg !== 0 ? (diff / Math.abs(lowAvg)) * 100 : 0;

        const isSignificant = Math.abs(diffPercent) > 20 || Math.abs(diff) > 5;

        if (isSignificant) {
          console.log(`【显著差异】${key}:`);
          console.log(`  中高质量平均: ${midHighAvg.toFixed(2)}`);
          console.log(`  低质量平均: ${lowAvg.toFixed(2)}`);
          console.log(`  差异: ${diff > 0 ? '+' : ''}${diff.toFixed(2)} (${diffPercent > 0 ? '+' : ''}${diffPercent.toFixed(1)}%)`);

          if (diff > 0) {
            console.log(`  建议: 设置下限过滤，中高质量值更高`);
          } else {
            console.log(`  建议: 设置上限过滤，中高质量值更低`);
          }
          console.log('');
        }
      }
    });
  }
}

analyzeHumanJudgment().then(() => {
  console.log('\n分析完成');
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
