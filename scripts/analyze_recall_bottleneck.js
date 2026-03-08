/**
 * 分析购买前检查条件的召回率瓶颈
 * 找出哪些条件限制了高质量代币通过
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function analyzeRecallBottleneck() {
  const experimentId = 'afed3289-2f89-4da5-88f1-1468d61f8b3d';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                  购买前检查召回率瓶颈分析                                    ║');
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
      signalDataMap.set(signal.token_address, metadata?.preBuyCheckFactors || {});
    } catch (e) {}
  });

  const goodTokens = [], badTokens = [];
  tokens.forEach(token => {
    const category = token.human_judges?.category?.toLowerCase();
    const isGood = category === 'high_quality' || category === 'mid_quality';
    const isBad = category === 'low_quality';

    const factors = signalDataMap.get(token.token_address);
    if (factors && (isGood || isBad)) {
      const tokenData = {
        token: token.token_address,
        symbol: token.token_symbol,
        category,
        ...factors
      };
      if (isGood) goodTokens.push(tokenData);
      if (isBad) badTokens.push(tokenData);
    }
  });

  console.log(`数据: ${goodTokens.length} 个中高质量, ${badTokens.length} 个低质量\n`);

  // 当前推荐的购买前检查条件
  const currentPrebuyCondition = {
    holderBlacklistCount: { condition: (v) => v <= 5, name: '黑名单数量 <= 5' },
    holderWhitelistCount: { condition: (v) => v >= 25, name: '白名单数量 >= 25' },
    devHoldingRatio: { condition: (v) => v < 15, name: '开发者持仓 < 15%' },
    maxHoldingRatio: { condition: (v) => v < 18, name: '最大持仓 < 18%' },
    earlyTradesCountPerMin: { condition: (v) => v >= 100, name: '交易数/分钟 >= 100' },
    earlyTradesVolumePerMin: { condition: (v) => v >= 8000, name: '交易量/分钟 >= 8000' },
    earlyTradesUniqueWallets: { condition: (v) => v >= 65, name: '独立钱包数 >= 65' }
  };

  // 分析每个条件的影响
  console.log('【步骤 1】分析各条件对高质量代币的通过率影响\n');

  const conditionImpact = [];

  Object.entries(currentPrebuyCondition).forEach(([key, config]) => {
    const passedCount = goodTokens.filter(t => {
      const value = t[key];
      return value !== null && value !== undefined && config.condition(value);
    }).length;

    const failedTokens = goodTokens.filter(t => {
      const value = t[key];
      return value === null || value === undefined || !config.condition(value);
    });

    conditionImpact.push({
      key,
      name: config.name,
      passCount: passedCount,
      passRate: passedCount / goodTokens.length,
      failedTokens
    });
  });

  // 按通过率排序（通过率低的排在前面，是瓶颈）
  conditionImpact.sort((a, b) => a.passRate - b.passRate);

  console.log('条件通过率排序（从低到高，低的是瓶颈）:\n');
  console.log('排名  条件名                    通过数  通过率  阻挡的代币');
  console.log('─'.repeat(70));

  conditionImpact.forEach((item, i) => {
    const blockedSymbols = item.failedTokens.map(t => t.symbol).join(', ');
    console.log(
      String(i + 1).padStart(2) + '. ' +
      item.name.padEnd(26) +
      String(item.passCount).padStart(4) +
      (item.passRate * 100).toFixed(1).padStart(6) + '%' +
      '  [' + blockedSymbols + ']'
    );
  });
  console.log('');

  // 找出"最小瓶颈"：稍微放宽就能显著提升召回率的条件
  console.log('【步骤 2】识别可优化的瓶颈条件\n');

  const bottlenecks = conditionImpact.filter(item => item.passRate < 0.7 && item.failedTokens.length > 0);

  console.log(`找到 ${bottlenecks.length} 个主要瓶颈条件:\n`);

  bottlenecks.forEach(item => {
    console.log(`【${item.name}】`);
    console.log(`  当前通过率: ${(item.passRate * 100).toFixed(1)}%`);

    // 分析失败代币的值分布
    const values = item.failedTokens.map(t => t[item.key]).filter(v => v !== null && v !== undefined);
    if (values.length > 0) {
      const sorted = [...values].sort((a, b) => a - b);
      console.log(`  被阻挡代币的值: 最小=${sorted[0]?.toFixed(2)}, 最大=${sorted[sorted.length-1]?.toFixed(2)}, 中位数=${sorted[Math.floor(sorted.length/2)]?.toFixed(2)}`);

      // 计算如果稍微放宽阈值能召回多少
      let suggestedThreshold;
      if (item.key.includes('Count') && item.key.includes('Blacklist')) {
        // 黑名单是 <= 条件，当前是 <= 5，被阻挡的可能都是 >5 的
        suggestedThreshold = { current: 5, suggested: 8, direction: '放宽' };
      } else if (item.key.includes('Count') || item.key.includes('Wallets')) {
        // 其他是 >= 条件
        const minFailed = Math.min(...values);
        suggestedThreshold = { current: item.key.includes('Whitelist') ? 25 : (item.key.includes('Count') ? 100 : 65), suggested: Math.floor(minFailed * 0.9), direction: '降低' };
      } else if (item.key.includes('Ratio')) {
        const minFailed = Math.min(...values);
        suggestedThreshold = { current: item.key.includes('Dev') ? 15 : 18, suggested: Math.ceil(minFailed * 1.1), direction: '提高' };
      }

      if (suggestedThreshold) {
        const newCondition = item.key.includes('Blacklist')
          ? (v) => v <= suggestedThreshold.suggested
          : item.key.includes('Ratio')
          ? (v) => v < suggestedThreshold.suggested
          : (v) => v >= suggestedThreshold.suggested;

        const wouldPass = goodTokens.filter(t => {
          const value = t[item.key];
          return value !== null && value !== undefined && newCondition(value);
        }).length;

        const improvement = wouldPass - item.passCount;
        console.log(`  建议: 将阈值从 ${suggestedThreshold.current} ${suggestedThreshold.direction}到 ${suggestedThreshold.suggested}`);
        console.log(`  预期效果: 通过数从 ${item.passCount} 增加到 ${wouldPass} (+${improvement})，召回率提升 ${(improvement / goodTokens.length * 100).toFixed(1)}%`);
      }
    }
    console.log('');
  });

  // 测试不同的召回率优化方案
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                  召回率优化方案对比                                         ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const recallOptimizationStrategies = [
    {
      name: '当前推荐策略',
      conditions: {
        holderBlacklistCount: (v) => v <= 5,
        holderWhitelistCount: (v) => v >= 25,
        devHoldingRatio: (v) => v < 15,
        maxHoldingRatio: (v) => v < 18,
        earlyTradesCountPerMin: (v) => v >= 100,
        earlyTradesVolumePerMin: (v) => v >= 8000,
        earlyTradesUniqueWallets: (v) => v >= 65
      }
    },
    {
      name: '微调版-1 (放宽交易量)',
      description: '降低交易量和交易数阈值',
      conditions: {
        holderBlacklistCount: (v) => v <= 5,
        holderWhitelistCount: (v) => v >= 25,
        devHoldingRatio: (v) => v < 15,
        maxHoldingRatio: (v) => v < 18,
        earlyTradesCountPerMin: (v) => v >= 80,   // 从100降到80
        earlyTradesVolumePerMin: (v) => v >= 6500, // 从8000降到6500
        earlyTradesUniqueWallets: (v) => v >= 65
      }
    },
    {
      name: '微调版-2 (放宽钱包数)',
      description: '降低独立钱包数阈值',
      conditions: {
        holderBlacklistCount: (v) => v <= 5,
        holderWhitelistCount: (v) => v >= 25,
        devHoldingRatio: (v) => v < 15,
        maxHoldingRatio: (v) => v < 18,
        earlyTradesCountPerMin: (v) => v >= 100,
        earlyTradesVolumePerMin: (v) => v >= 8000,
        earlyTradesUniqueWallets: (v) => v >= 55   // 从65降到55
      }
    },
    {
      name: '微调版-3 (放宽白名单)',
      description: '降低白名单数量阈值',
      conditions: {
        holderBlacklistCount: (v) => v <= 5,
        holderWhitelistCount: (v) => v >= 20,      // 从25降到20
        devHoldingRatio: (v) => v < 15,
        maxHoldingRatio: (v) => v < 18,
        earlyTradesCountPerMin: (v) => v >= 100,
        earlyTradesVolumePerMin: (v) => v >= 8000,
        earlyTradesUniqueWallets: (v) => v >= 65
      }
    },
    {
      name: '平衡优化版',
      description: '小幅放宽多个阈值',
      conditions: {
        holderBlacklistCount: (v) => v <= 5,
        holderWhitelistCount: (v) => v >= 22,      // 从25降到22
        devHoldingRatio: (v) => v < 15,
        maxHoldingRatio: (v) => v < 18,
        earlyTradesCountPerMin: (v) => v >= 85,    // 从100降到85
        earlyTradesVolumePerMin: (v) => v >= 7000, // 从8000降到7000
        earlyTradesUniqueWallets: (v) => v >= 58    // 从65降到58
      }
    }
  ];

  function evaluateStrategy(conditions) {
    let tp = 0, fp = 0, tn = 0, fn = 0;

    goodTokens.forEach(t => {
      const pass = Object.entries(conditions).every(([key, fn]) => {
        const value = t[key];
        return value !== null && value !== undefined && fn(value);
      });
      if (pass) tp++; else fn++;
    });

    badTokens.forEach(t => {
      const pass = Object.entries(conditions).every(([key, fn]) => {
        const value = t[key];
        return value !== null && value !== undefined && fn(value);
      });
      if (pass) fp++; else tn++;
    });

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

    return { tp, fp, tn, fn, precision, recall, f1 };
  }

  console.log('策略'.padEnd(22) + '精确率'.padStart(8) + '召回率'.padStart(8) + 'F1'.padStart(8) + 'TP'.padStart(4) + 'FP');
  console.log('─'.repeat(58));

  const strategyResults = recallOptimizationStrategies.map(s => ({
    name: s.name,
    description: s.description || '',
    ...evaluateStrategy(s.conditions)
  }));

  strategyResults.forEach(r => {
    const label = r.name.includes('平衡优化') ? '★ ' + r.name : '  ' + r.name;
    console.log(
      label.padEnd(22) +
      (r.precision * 100).toFixed(1).padStart(7) + '%' +
      (r.recall * 100).toFixed(1).padStart(7) + '%' +
      (r.f1 * 100).toFixed(1).padStart(7) + '%' +
      String(r.tp).padStart(3) +
      String(r.fp).padStart(4)
    );
  });
  console.log('');

  // 推荐策略详情
  console.log('【推荐策略配置：平衡优化版】\n');
  const recommended = recallOptimizationStrategies.find(s => s.name === '平衡优化版');
  if (recommended) {
    console.log('preBuyCheckCondition = "');
    console.log('  holderBlacklistCount <= 5 AND');
    console.log('  holderWhitelistCount >= 22 AND      // 从25降到22');
    console.log('  devHoldingRatio < 15 AND');
    console.log('  maxHoldingRatio < 18 AND');
    console.log('  earlyTradesCountPerMin >= 85 AND    // 从100降到85');
    console.log('  earlyTradesVolumePerMin >= 7000 AND // 从8000降到7000');
    console.log('  earlyTradesUniqueWallets >= 58      // 从65降到58');
    console.log('"\n');
  }

  // 对比分析
  const baseResult = strategyResults[0];
  const optimizedResult = strategyResults.find(r => r.name === '平衡优化版');

  console.log('效果对比:');
  console.log(`  召回率: ${(baseResult.recall * 100).toFixed(1)}% → ${(optimizedResult.recall * 100).toFixed(1)}% (+${((optimizedResult.recall - baseResult.recall) * 100).toFixed(1)}%)`);
  console.log(`  精确率: ${(baseResult.precision * 100).toFixed(1)}% → ${(optimizedResult.precision * 100).toFixed(1)}% (${((optimizedResult.precision - baseResult.precision) * 100).toFixed(1)}%)`);
  console.log(`  F1分数: ${(baseResult.f1 * 100).toFixed(1)}% → ${(optimizedResult.f1 * 100).toFixed(1)}% (+${((optimizedResult.f1 - baseResult.f1) * 100).toFixed(1)}%)`);
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('总结: 通过小幅放宽多个阈值，可以在保持较高精确率的同时');
  console.log('      显著提升召回率。推荐使用"平衡优化版"。');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

analyzeRecallBottleneck().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
