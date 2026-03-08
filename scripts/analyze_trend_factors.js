/**
 * 分析例行运行阶段的因子（趋势检测因子等）
 * 对代币质量的区分能力
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function analyzeTrendFactors() {
  const experimentId = 'afed3289-2f89-4da5-88f1-1468d61f8b3d';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                 趋势检测因子分析 - 例行运行阶段                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 1. 获取数据
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, human_judges, token_symbol')
    .eq('experiment_id', experimentId)
    .not('human_judges', 'is', null);

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy');

  console.log(`数据概况: ${tokens.length} 个标注代币, ${signals.length} 个信号\n`);

  // 2. 首先查看数据结构
  console.log('【步骤 1】查看信号数据结构\n');

  let sampleMetadata = null;
  for (const signal of signals) {
    try {
      let metadata = signal.metadata;
      if (typeof metadata === 'string') {
        metadata = JSON.parse(metadata);
      }
      if (metadata && (metadata.trendFactors || metadata.regularFactors)) {
        sampleMetadata = metadata;
        break;
      }
    } catch (e) {}
  }

  if (sampleMetadata) {
    console.log('metadata 结构包含以下部分:\n');

    if (sampleMetadata.trendFactors) {
      console.log('trendFactors (趋势因子):');
      Object.keys(sampleMetadata.trendFactors).forEach(key => {
        console.log(`  - ${key}: ${typeof sampleMetadata.trendFactors[key]}`);
      });
    }

    if (sampleMetadata.regularFactors) {
      console.log('\nregularFactors (常规因子):');
      Object.keys(sampleMetadata.regularFactors).forEach(key => {
        console.log(`  - ${key}: ${typeof sampleMetadata.regularFactors[key]}`);
      });
    }

    if (sampleMetadata.preBuyCheckFactors) {
      console.log('\npreBuyCheckFactors (购买前检查因子):');
      Object.keys(sampleMetadata.preBuyCheckFactors).forEach(key => {
        console.log(`  - ${key}: ${typeof sampleMetadata.preBuyCheckFactors[key]}`);
      });
    }
    console.log('');
  }

  // 3. 提取所有因子
  console.log('【步骤 2】提取所有因子并分组\n');

  const signalDataMap = new Map();

  signals.forEach(signal => {
    try {
      let metadata = signal.metadata;
      if (typeof metadata === 'string') {
        metadata = JSON.parse(metadata);
      }

      const trendFactors = metadata?.trendFactors || {};
      const regularFactors = metadata?.regularFactors || {};
      const preBuyCheckFactors = metadata?.preBuyCheckFactors || {};

      signalDataMap.set(signal.token_address, {
        trendFactors,
        regularFactors,
        preBuyCheckFactors
      });
    } catch (e) {}
  });

  // 4. 按质量分组
  const goodTokens = [];
  const badTokens = [];

  tokens.forEach(token => {
    const category = token.human_judges?.category?.toLowerCase();
    const isGood = category === 'high_quality' || category === 'mid_quality';
    const isBad = category === 'low_quality';

    const data = signalDataMap.get(token.token_address);
    if (data && (isGood || isBad)) {
      const tokenData = {
        token: token.token_address,
        symbol: token.token_symbol,
        category,
        ...data.trendFactors,
        ...data.regularFactors,
        ...data.preBuyCheckFactors
      };

      // 添加来源标记
      Object.keys(data.trendFactors).forEach(k => {
        tokenData[`trend_${k}`] = data.trendFactors[k];
      });
      Object.keys(data.regularFactors).forEach(k => {
        tokenData[`regular_${k}`] = data.regularFactors[k];
      });
      Object.keys(data.preBuyCheckFactors).forEach(k => {
        tokenData[`prebuy_${k}`] = data.preBuyCheckFactors[k];
      });

      if (isGood) goodTokens.push(tokenData);
      if (isBad) badTokens.push(tokenData);
    }
  });

  console.log(`数据匹配结果: 中高质量 ${goodTokens.length} 个, 低质量 ${badTokens.length} 个\n`);

  // 5. 分析趋势因子
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                  趋势因子区分能力分析                                         ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  function calculateStats(values) {
    if (values.length === 0) return { min: 0, max: 0, avg: 0, median: 0, stdDev: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg,
      median: sorted[Math.floor(sorted.length / 2)],
      stdDev: Math.sqrt(variance)
    };
  }

  function calculateDiscriminantPower(goodValues, badValues) {
    const goodStats = calculateStats(goodValues);
    const badStats = calculateStats(badValues);
    const pooledStdDev = Math.sqrt(
      (Math.pow(goodStats.stdDev, 2) * (goodValues.length - 1) +
       Math.pow(badStats.stdDev, 2) * (badValues.length - 1)) /
      (goodValues.length + badValues.length - 2)
    );
    return pooledStdDev > 0 ? Math.abs(goodStats.avg - badStats.avg) / pooledStdDev : 0;
  }

  // 趋势因子列表
  const trendFactorKeys = [
    'age', 'fdv', 'tvl', 'holders',
    'trendCV', 'trendSlope',
    'earlyReturn', 'riseSpeed',
    'trendPriceUp', 'trendMedianUp',
    'trendRiseRatio',
    'trendDataPoints',
    'trendTotalReturn',
    'trendStrengthScore',
    'drawdownFromHighest',
    'trendRecentDownCount',
    'trendRecentDownRatio',
    'trendConsecutiveDowns'
  ];

  // 过滤掉非数值的因子
  const validTrendFactors = [];

  trendFactorKeys.forEach(key => {
    const goodValues = goodTokens.map(t => t[key]).filter(v => typeof v === 'number' && !isNaN(v));
    const badValues = badTokens.map(t => t[key]).filter(v => typeof v === 'number' && !isNaN(v));

    if (goodValues.length > 0 && badValues.length > 0) {
      const goodStats = calculateStats(goodValues);
      const badStats = calculateStats(badValues);
      const discriminantPower = calculateDiscriminantPower(goodValues, badValues);
      const diffPercent = badStats.avg !== 0 ? ((goodStats.avg - badStats.avg) / Math.abs(badStats.avg) * 100) : 0;

      validTrendFactors.push({
        key,
        goodStats,
        badStats,
        discriminantPower,
        diffPercent,
        goodCount: goodValues.length,
        badCount: badValues.length
      });
    }
  });

  // 按分离度排序
  validTrendFactors.sort((a, b) => b.discriminantPower - a.discriminantPower);

  console.log('趋势因子区分能力排序:\n');
  console.log('排名'.padEnd(6) + '因子名'.padEnd(28) + '分离度'.padStart(8) + '中高质量均值'.padStart(14) + '低质量均值'.padStart(14));
  console.log('─'.repeat(68));

  validTrendFactors.forEach((f, i) => {
    const direction = f.goodStats.avg >= f.badStats.avg ? '↑' : '↓';
    console.log(
      String(i + 1).padStart(4) + '. ' +
      (f.key + direction).padEnd(28) +
      f.discriminantPower.toFixed(2).padStart(6) +
      f.goodStats.avg.toFixed(2).padStart(12) +
      f.badStats.avg.toFixed(2).padStart(12)
    );
  });
  console.log('');

  // 6. 详细分析Top因子
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    Top 5 趋势因子详细分析                                     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const currentBuyCondition = {
    'trendCV': { current: '> 0.02', description: '趋势变异系数' },
    'trendSlope': { current: '> 0.02', description: '趋势斜率' },
    'trendPriceUp': { current: '>= 1', description: '价格是否上涨' },
    'trendMedianUp': { current: '>= 1', description: '中位数是否上涨' },
    'trendStrengthScore': { current: '>= 30', description: '趋势强度分数' },
    'trendTotalReturn': { current: '>= 10', description: '总收益率' },
    'earlyReturn': { current: '> 15', description: '早期收益率' },
    'trendRecentDownRatio': { current: '< 0.6', description: '近期下跌比例' },
    'drawdownFromHighest': { current: '> -25', description: '从最高点回撤' },
    'age': { current: '> 1.2', description: '代币年龄(分钟)' }
  };

  validTrendFactors.slice(0, 5).forEach((f, i) => {
    console.log(`【${i + 1}. ${f.key}】`);
    console.log(`  说明: ${getFactorDescription(f.key)}`);
    console.log(`  当前阈值: ${currentBuyCondition[f.key]?.current || '未设置'}`);
    console.log(`  中高质量: P25=${f.goodStats.min.toFixed(2)}, P50=${f.goodStats.median.toFixed(2)}, P75=${f.goodStats.max.toFixed(2)}`);
    console.log(`  低质量:   P25=${f.badStats.min.toFixed(2)}, P50=${f.badStats.median.toFixed(2)}, P75=${f.badStats.max.toFixed(2)}`);
    console.log(`  差异: ${f.diffPercent > 0 ? '+' : ''}${f.diffPercent.toFixed(1)}% | 分离度: ${f.discriminantPower.toFixed(2)}`);

    // 建议阈值
    const suggestedThreshold = suggestThreshold(f);
    if (suggestedThreshold) {
      console.log(`  建议阈值: ${suggestedThreshold}`);
    }
    console.log('');
  });

  // 7. 当前策略评估
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                   当前趋势策略评估                                           ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const currentTrendCondition = (f) => {
    return f.trendCV > 0.02 &&
           f.trendSlope > 0.02 &&
           f.trendPriceUp >= 1 &&
           f.trendMedianUp >= 1 &&
           f.trendStrengthScore >= 30 &&
           f.trendTotalReturn >= 10 &&
           f.earlyReturn > 15 &&
           f.trendRecentDownRatio < 0.6 &&
           f.drawdownFromHighest > -25 &&
           f.age > 1.2;
  };

  let currentTrendTP = 0, currentTrendFP = 0, currentTrendTN = 0, currentTrendFN = 0;

  goodTokens.forEach(t => {
    if (currentTrendCondition(t)) currentTrendTP++; else currentTrendFN++;
  });
  badTokens.forEach(t => {
    if (currentTrendCondition(t)) currentTrendFP++; else currentTrendTN++;
  });

  const currentTrendPrecision = currentTrendTP + currentTrendFP > 0 ? currentTrendTP / (currentTrendTP + currentTrendFP) : 0;
  const currentTrendRecall = currentTrendTP + currentTrendFN > 0 ? currentTrendTP / (currentTrendTP + currentTrendFN) : 0;

  console.log('当前趋势策略混淆矩阵:\n');
  console.log('                     实际');
  console.log('              ┌─────────────┬─────────────┐');
  console.log('              │   高质量    │   低质量    │');
  console.log('    ┌─────────┼─────────────┼─────────────┤');
  console.log(' 预  │ 通过    │  TP = ' + String(currentTrendTP).padStart(3) + '  │  FP = ' + String(currentTrendFP).padStart(3) + '  │');
  console.log(' 测  ├─────────┼─────────────┼─────────────┤');
  console.log(' 结  │ 拒绝    │  FN = ' + String(currentTrendFN).padStart(3) + '  │  TN = ' + String(currentTrendTN).padStart(3) + '  │');
  console.log('    └─────────┴─────────────┴─────────────┘\n');

  console.log('评估指标:');
  console.log(`  精确率: ${(currentTrendPrecision * 100).toFixed(1)}%`);
  console.log(`  召回率: ${(currentTrendRecall * 100).toFixed(1)}%`);
  console.log('');

  // 8. 优化建议
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                   趋势策略优化建议                                           ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 找出有区分度但当前未使用或阈值不合理的因子
  const optimizationSuggestions = [];

  validTrendFactors.forEach(f => {
    const current = currentBuyCondition[f.key];
    if (!current) {
      // 未使用的因子
      if (f.discriminantPower > 0.5) {
        optimizationSuggestions.push({
          factor: f.key,
          type: '新增',
          discriminantPower: f.discriminantPower,
          suggestion: suggestThreshold(f)
        });
      }
    } else if (f.discriminantPower > 0.3) {
      // 已使用的因子，检查阈值是否合理
      const suggested = suggestThreshold(f);
      if (suggested && suggested !== current.current) {
        optimizationSuggestions.push({
          factor: f.key,
          type: '调整',
          current: current.current,
          discriminantPower: f.discriminantPower,
          suggestion: suggested
        });
      }
    }
  });

  if (optimizationSuggestions.length > 0) {
    console.log('建议优化:\n');
    optimizationSuggestions.forEach(s => {
      console.log(`【${s.type}】${s.factor}`);
      if (s.current) console.log(`  当前阈值: ${s.current}`);
      console.log(`  建议阈值: ${s.suggestion}`);
      console.log(`  分离度: ${s.discriminantPower.toFixed(2)}`);
      console.log('');
    });
  } else {
    console.log('当前趋势策略已较为合理，无需显著调整。\n');
  }

  // 9. 组合策略建议
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                   组合策略建议 (趋势 + 购买前检查)                            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log('推荐策略结构:\n');
  console.log('// 趋势条件 (例行运行阶段)');
  console.log('trendCondition = "');
  console.log('  trendCV > 0.02 AND');
  console.log('  trendSlope > 0.02 AND');
  console.log('  trendPriceUp >= 1 AND');
  console.log('  trendMedianUp >= 1 AND');
  console.log('  trendStrengthScore >= 30 AND');
  console.log('  trendTotalReturn >= 10 AND');
  console.log('  earlyReturn > 15 AND');
  console.log('  trendRecentDownRatio < 0.6 AND');
  console.log('  drawdownFromHighest > -25 AND');
  console.log('  age > 1.2');
  console.log('"\n');
  console.log('// 购买前检查条件 (执行购买前)');
  console.log('preBuyCheckCondition = "');
  console.log('  holderBlacklistCount <= 5 AND');
  console.log('  holderWhitelistCount >= 30 AND');
  console.log('  devHoldingRatio < 15 AND');
  console.log('  maxHoldingRatio < 18 AND');
  console.log('  earlyTradesCountPerMin >= 120 AND');
  console.log('  earlyTradesVolumePerMin >= 10000 AND');
  console.log('  earlyTradesUniqueWallets >= 70 AND');
  console.log('  earlyTradesWalletsPerMin >= 65');
  console.log('"\n');

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('分析完成。趋势因子主要用于筛选有上涨潜力的代币，购买前检查因子用于');
  console.log('过滤质量较差的代币。两者配合使用可以达到最佳效果。');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

function getFactorDescription(key) {
  const descriptions = {
    'age': '代币创建后的年龄（分钟）',
    'fdv': '完全稀释估值',
    'tvl': '总锁定价值',
    'holders': '持币地址数量',
    'trendCV': '趋势变异系数，衡量价格波动的稳定性',
    'trendSlope': '趋势斜率，衡量价格上涨速度',
    'earlyReturn': '早期收益率，代币发布初期的涨幅',
    'riseSpeed': '上涨速度',
    'trendPriceUp': '当前价格是否高于初始价格（0/1）',
    'trendMedianUp': '中位数是否高于初始价格（0/1）',
    'trendRiseRatio': '上涨K线占比',
    'trendDataPoints': '趋势数据点数量（K线数量）',
    'trendTotalReturn': '总收益率',
    'trendStrengthScore': '趋势强度分数，综合评估趋势健康度',
    'drawdownFromHighest': '从最高点的回撤幅度',
    'trendRecentDownCount': '近期下跌K线数量',
    'trendRecentDownRatio': '近期下跌K线占比',
    'trendConsecutiveDowns': '连续下跌K线数量'
  };
  return descriptions[key] || '未知因子';
}

function suggestThreshold(factorData) {
  const { key, goodStats, badStats } = factorData;
  const direction = goodStats.avg >= badStats.avg;

  // 基于中位数差异给出建议
  if (direction) {
    // 高质量值更高，设置下限
    const threshold = (goodStats.median + badStats.median) / 2;
    if (key.includes('Ratio') || key.includes('Score') || key.includes('Count')) {
      return `>= ${threshold.toFixed(2)}`;
    } else if (key.includes('CV') || key.includes('Slope') || key.includes('Return')) {
      return `> ${threshold.toFixed(4)}`;
    } else {
      return `>= ${threshold.toFixed(2)}`;
    }
  } else {
    // 高质量值更低，设置上限
    const threshold = (goodStats.median + badStats.median) / 2;
    return `< ${threshold.toFixed(2)}`;
  }
}

analyzeTrendFactors().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
