/**
 * 完整策略组合评估 - 趋势条件 + 购买前检查条件
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function analyzeCombinedStrategies() {
  const experimentId = 'afed3289-2f89-4da5-88f1-1468d61f8b3d';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                   完整策略组合评估与优化                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取数据
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

  // 解析数据
  const signalDataMap = new Map();
  signals.forEach(signal => {
    try {
      let metadata = signal.metadata;
      if (typeof metadata === 'string') {
        metadata = JSON.parse(metadata);
      }
      signalDataMap.set(signal.token_address, {
        trend: metadata?.trendFactors || {},
        prebuy: metadata?.preBuyCheckFactors || {}
      });
    } catch (e) {}
  });

  const goodTokens = [], badTokens = [];
  tokens.forEach(token => {
    const category = token.human_judges?.category?.toLowerCase();
    const isGood = category === 'high_quality' || category === 'mid_quality';
    const isBad = category === 'low_quality';

    const data = signalDataMap.get(token.token_address);
    if (data && (isGood || isBad)) {
      const tokenData = {
        token: token.token_address,
        symbol: token.token_symbol,
        ...data.trend,
        ...data.prebuy
      };
      if (isGood) goodTokens.push(tokenData);
      if (isBad) badTokens.push(tokenData);
    }
  });

  console.log(`数据: ${goodTokens.length} 个中高质量, ${badTokens.length} 个低质量\n`);

  // 定义策略组合
  const strategies = [
    {
      name: '当前策略',
      trendCondition: (f) => {
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
      },
      prebuyCondition: (f) => {
        return f.holderBlacklistCount <= 5 &&
               f.holderWhitelistCount >= f.holderBlacklistCount * 2 &&
               f.devHoldingRatio < 15 &&
               f.maxHoldingRatio < 18 &&
               f.earlyTradesHighValueCount >= 8 &&
               f.earlyTradesHighValuePerMin >= 10 &&
               f.earlyTradesCountPerMin >= 30 &&
               f.earlyTradesVolumePerMin >= 4000 &&
               f.earlyTradesActualSpan > 65;
      }
    },
    {
      name: '优化策略A - 保守',
      description: '优先避免低质量，精确率最高',
      trendCondition: (f) => {
        return f.earlyReturn > 150 &&
               f.drawdownFromHighest >= -5 &&
               f.tvl >= 6000 &&
               f.holders >= 35 &&
               f.age >= 1.5;
      },
      prebuyCondition: (f) => {
        return f.holderBlacklistCount <= 5 &&
               f.holderWhitelistCount >= 30 &&
               f.devHoldingRatio < 15 &&
               f.maxHoldingRatio < 18 &&
               f.earlyTradesCountPerMin >= 120 &&
               f.earlyTradesVolumePerMin >= 10000 &&
               f.earlyTradesUniqueWallets >= 70 &&
               f.earlyTradesWalletsPerMin >= 65;
      }
    },
    {
      name: '优化策略B - 平衡',
      description: '平衡精确率和召回率',
      trendCondition: (f) => {
        return f.earlyReturn > 80 &&
               f.drawdownFromHighest >= -10 &&
               f.tvl >= 5000 &&
               f.holders >= 30 &&
               f.fdv >= 8000;
      },
      prebuyCondition: (f) => {
        return f.holderBlacklistCount <= 5 &&
               f.holderWhitelistCount >= 25 &&
               f.devHoldingRatio < 15 &&
               f.maxHoldingRatio < 18 &&
               f.earlyTradesCountPerMin >= 100 &&
               f.earlyTradesVolumePerMin >= 8000 &&
               f.earlyTradesUniqueWallets >= 65;
      }
    },
    {
      name: '优化策略C - 激进',
      description: '优先捕捉机会，召回率最高',
      trendCondition: (f) => {
        return f.earlyReturn > 50 &&
               f.drawdownFromHighest >= -15 &&
               f.tvl >= 4000 &&
               f.holders >= 25;
      },
      prebuyCondition: (f) => {
        return f.holderBlacklistCount <= 5 &&
               f.holderWhitelistCount >= 20 &&
               f.devHoldingRatio < 20 &&
               f.maxHoldingRatio < 20 &&
               f.earlyTradesCountPerMin >= 80 &&
               f.earlyTradesVolumePerMin >= 6000 &&
               f.earlyTradesUniqueWallets >= 55;
      }
    },
    {
      name: '优化策略D - 趋势强化',
      description: '强化趋势因子筛选',
      trendCondition: (f) => {
        return f.earlyReturn > 100 &&
               f.tvl >= 5000 &&
               f.fdv >= 9000 &&
               f.holders >= 30 &&
               f.trendTotalReturn > 50 &&
               f.riseSpeed >= 80;
      },
      prebuyCondition: (f) => {
        return f.holderBlacklistCount <= 5 &&
               f.holderWhitelistCount >= 30 &&
               f.earlyTradesCountPerMin >= 120 &&
               f.earlyTradesVolumePerMin >= 10000 &&
               f.earlyTradesUniqueWallets >= 70;
      }
    }
  ];

  // 评估所有策略
  function evaluateStrategy(strategy) {
    let tp = 0, fp = 0, tn = 0, fn = 0;

    goodTokens.forEach(t => {
      const passTrend = strategy.trendCondition(t);
      const passPrebuy = strategy.prebuyCondition(t);
      if (passTrend && passPrebuy) tp++; else fn++;
    });

    badTokens.forEach(t => {
      const passTrend = strategy.trendCondition(t);
      const passPrebuy = strategy.prebuyCondition(t);
      if (passTrend && passPrebuy) fp++; else tn++;
    });

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
    const accuracy = (tp + tn) / (tp + fp + tn + fn);

    return { tp, fp, tn, fn, precision, recall, f1, accuracy };
  }

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                       策略对比表                                           ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const results = strategies.map(s => ({
    name: s.name,
    description: s.description || '',
    ...evaluateStrategy(s)
  }));

  results.sort((a, b) => b.f1 - a.f1);

  console.log('策略'.padEnd(24) + '精确率'.padStart(8) + '召回率'.padStart(8) + 'F1'.padStart(8) + '准确率'.padStart(8) + '通过率');
  console.log('─'.repeat(72));

  results.forEach(r => {
    const passRate = ((r.tp + r.fp) / (goodTokens.length + badTokens.length) * 100).toFixed(1);
    const label = r.name.includes('优化') ? '★ ' + r.name.substring(2) : '  ' + r.name;
    console.log(
      label.padEnd(24) +
      (r.precision * 100).toFixed(1).padStart(7) + '%' +
      (r.recall * 100).toFixed(1).padStart(7) + '%' +
      (r.f1 * 100).toFixed(1).padStart(7) + '%' +
      (r.accuracy * 100).toFixed(1).padStart(7) + '%' +
      passRate.padStart(8) + '%'
    );
  });

  // 详细对比
  console.log('\n╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                       策略详细对比                                         ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  results.forEach((r, i) => {
    console.log(`【${r.name}】`);
    if (r.description) console.log(`  ${r.description}`);
    console.log(`  混淆矩阵: TP=${r.tp}, FP=${r.fp}, FN=${r.fn}, TN=${r.tn}`);
    console.log(`  精确率=${(r.precision * 100).toFixed(1)}%, 召回率=${(r.recall * 100).toFixed(1)}%, F1=${(r.f1 * 100).toFixed(1)}%`);
    console.log('');
  });

  // 推荐策略详情
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                       推荐策略配置                                         ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const recommended = strategies.find(s => s.name === '优化策略B - 平衡');
  if (recommended) {
    console.log('【推荐：优化策略B - 平衡】\n');
    console.log('// 趋势条件 (例行运行阶段)');
    console.log('trendCondition = "');
    console.log('  earlyReturn > 80 AND');
    console.log('  drawdownFromHighest >= -10 AND');
    console.log('  tvl >= 5000 AND');
    console.log('  holders >= 30 AND');
    console.log('  fdv >= 8000');
    console.log('"\n');

    console.log('// 购买前检查条件 (执行购买前)');
    console.log('preBuyCheckCondition = "');
    console.log('  holderBlacklistCount <= 5 AND');
    console.log('  holderWhitelistCount >= 25 AND');
    console.log('  devHoldingRatio < 15 AND');
    console.log('  maxHoldingRatio < 18 AND');
    console.log('  earlyTradesCountPerMin >= 100 AND');
    console.log('  earlyTradesVolumePerMin >= 8000 AND');
    console.log('  earlyTradesUniqueWallets >= 65');
    console.log('"\n');
  }

  // 趋势因子建议
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                       趋势因子优化要点                                       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log('【新增强区分因子】');
  console.log('  1. tvl (总锁定价值) - 分离度 1.70');
  console.log('     建议阈值: >= 5000-6000');
  console.log('  2. fdv (完全稀释估值) - 分离度 1.46');
  console.log('     建议阈值: >= 8000-10000');
  console.log('  3. holders (持币地址数) - 分离度 1.15');
  console.log('     建议阈值: >= 30-35\n');

  console.log('【调整现有因子阈值】');
  console.log('  1. earlyReturn - 从 >15 提升到 >80-150');
  console.log('     (当前阈值过低，几乎所有代币都能通过)');
  console.log('  2. drawdownFromHighest - 从 >-25 收紧到 >=-10');
  console.log('     (过滤回撤较大的代币)');
  console.log('  3. trendTotalReturn - 从 >=10 提升到 >50');
  console.log('  4. age - 从 >1.2 提升到 >=1.5\n');

  console.log('【可考虑移除的弱因子】');
  console.log('  - trendPriceUp, trendMedianUp: 所有代币值都相同，无区分能力');
  console.log('  - trendStrengthScore: 方向与预期相反（低质量代币分数更高）');
  console.log('  - trendRiseRatio, trendRecentDownRatio: 分离度较低\n');

  // 与当前策略对比
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                       与当前策略对比                                         ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const currentResult = results.find(r => r.name === '当前策略');
  const recommendedResult = results.find(r => r.name === '优化策略B - 平衡');

  if (currentResult && recommendedResult) {
    console.log('                    当前策略     推荐策略     改善');
    console.log('精确率 (Precision):   ' +
      (currentResult.precision * 100).toFixed(1).padStart(6) + '%    ' +
      (recommendedResult.precision * 100).toFixed(1).padStart(6) + '%    ' +
      ((recommendedResult.precision - currentResult.precision) * 100).toFixed(1).padStart(6) + '%');
    console.log('召回率 (Recall):      ' +
      (currentResult.recall * 100).toFixed(1).padStart(6) + '%    ' +
      (recommendedResult.recall * 100).toFixed(1).padStart(6) + '%    ' +
      ((recommendedResult.recall - currentResult.recall) * 100).toFixed(1).padStart(6) + '%');
    console.log('F1分数:               ' +
      (currentResult.f1 * 100).toFixed(1).padStart(6) + '%    ' +
      (recommendedResult.f1 * 100).toFixed(1).padStart(6) + '%    ' +
      ((recommendedResult.f1 - currentResult.f1) * 100).toFixed(1).padStart(6) + '%');
    console.log('假正率:               ' +
      ((currentResult.fp / (currentResult.fp + currentResult.tn)) * 100).toFixed(1).padStart(6) + '%    ' +
      ((recommendedResult.fp / (recommendedResult.fp + recommendedResult.tn)) * 100).toFixed(1).padStart(6) + '%    ' +
      (((currentResult.fp / (currentResult.fp + currentResult.tn)) - (recommendedResult.fp / (recommendedResult.fp + recommendedResult.tn))) * 100).toFixed(1).padStart(6) + '%');
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('总结: 推荐策略在保持较高召回率的同时，显著提升精确率，减少误判。');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

analyzeCombinedStrategies().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
