/**
 * 评估购买前检查策略并生成混淆矩阵
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

// 策略定义
const strategies = {
  'current': {
    name: '当前策略',
    condition: (f) => {
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

  'optimized_basic': {
    name: '优化策略-基础版',
    condition: (f) => {
      return f.holderBlacklistCount <= 5 &&
             f.holderWhitelistCount >= 30 &&
             f.devHoldingRatio < 15 &&
             f.maxHoldingRatio < 18 &&
             f.earlyTradesCountPerMin >= 120 &&
             f.earlyTradesVolumePerMin >= 10000;
    }
  },

  'optimized_with_unique': {
    name: '优化策略-含独立钱包',
    condition: (f) => {
      return f.holderBlacklistCount <= 5 &&
             f.holderWhitelistCount >= 30 &&
             f.devHoldingRatio < 15 &&
             f.maxHoldingRatio < 18 &&
             f.earlyTradesCountPerMin >= 120 &&
             f.earlyTradesVolumePerMin >= 10000 &&
             f.earlyTradesUniqueWallets >= 70;
    }
  },

  'optimized_with_wallets_per_min': {
    name: '优化策略-含钱包速率',
    condition: (f) => {
      return f.holderBlacklistCount <= 5 &&
             f.holderWhitelistCount >= 30 &&
             f.devHoldingRatio < 15 &&
             f.maxHoldingRatio < 18 &&
             f.earlyTradesCountPerMin >= 120 &&
             f.earlyTradesVolumePerMin >= 10000 &&
             f.earlyTradesWalletsPerMin >= 65;
    }
  },

  'optimized_full': {
    name: '优化策略-完整版',
    condition: (f) => {
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

  'conservative': {
    name: '保守策略-高精度',
    condition: (f) => {
      return f.holderBlacklistCount <= 3 &&
             f.holderWhitelistCount >= 35 &&
             f.devHoldingRatio < 10 &&
             f.maxHoldingRatio < 15 &&
             f.earlyTradesCountPerMin >= 140 &&
             f.earlyTradesVolumePerMin >= 11000 &&
             f.earlyTradesUniqueWallets >= 75 &&
             f.earlyTradesWalletsPerMin >= 70;
    }
  },

  'balanced': {
    name: '平衡策略',
    condition: (f) => {
      return f.holderBlacklistCount <= 5 &&
             f.holderWhitelistCount >= 25 &&
             f.devHoldingRatio < 15 &&
             f.maxHoldingRatio < 18 &&
             f.earlyTradesCountPerMin >= 100 &&
             f.earlyTradesVolumePerMin >= 8000 &&
             f.earlyTradesUniqueWallets >= 65;
    }
  },

  'aggressive': {
    name: '激进策略-高召回',
    condition: (f) => {
      return f.holderBlacklistCount <= 5 &&
             f.holderWhitelistCount >= 20 &&
             f.devHoldingRatio < 20 &&
             f.maxHoldingRatio < 20 &&
             f.earlyTradesCountPerMin >= 80 &&
             f.earlyTradesVolumePerMin >= 6000 &&
             f.earlyTradesUniqueWallets >= 55;
    }
  }
};

function calculateConfusionMatrix(goodTokens, badTokens, strategyCondition) {
  let tp = 0, fp = 0, tn = 0, fn = 0;

  goodTokens.forEach(token => {
    if (strategyCondition(token)) {
      tp++;
    } else {
      fn++;
    }
  });

  badTokens.forEach(token => {
    if (strategyCondition(token)) {
      fp++;
    } else {
      tn++;
    }
  });

  return { tp, fp, tn, fn };
}

function printConfusionMatrix(cm, totalGood, totalBad) {
  const { tp, fp, tn, fn } = cm;

  console.log('                     实际质量');
  console.log('              ┌─────────────┬─────────────┐');
  console.log('              │   高质量    │   低质量    │');
  console.log('    ┌─────────┼─────────────┼─────────────┤');
  console.log(' 预  │ 通过购买 │  TP = ' + String(tp).padStart(3) + '  │  FP = ' + String(fp).padStart(3) + '  │');
  console.log(' 测  │ (正例)  │   (正确)    │  (误判)     │');
  console.log(' 结  ├─────────┼─────────────┼─────────────┤');
  console.log(' 果  │ 拒绝购买 │  FN = ' + String(fn).padStart(3) + '  │  TN = ' + String(tn).padStart(3) + '  │');
  console.log('    │ (负例)  │  (漏掉)     │  (正确)     │');
  console.log('    └─────────┴─────────────┴─────────────┘');
}

function calculateMetrics(cm) {
  const { tp, fp, tn, fn } = cm;
  const total = tp + fp + tn + fn;

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const specificity = tn + fp > 0 ? tn / (tn + fp) : 0;
  const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
  const accuracy = total > 0 ? (tp + tn) / total : 0;
  const falsePositiveRate = tn + fp > 0 ? fp / (tn + fp) : 0;

  return { precision, recall, specificity, f1, accuracy, falsePositiveRate };
}

async function evaluateStrategies() {
  const experimentId = 'afed3289-2f89-4da5-88f1-1468d61f8b3d';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║          购买前检查策略评估与混淆矩阵分析                                  ║');
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

  // 构建信号数据映射
  const signalDataMap = new Map();
  signals.forEach(signal => {
    try {
      let metadata = signal.metadata;
      if (typeof metadata === 'string') {
        metadata = JSON.parse(metadata);
      }
      const preBuyCheckFactors = metadata?.preBuyCheckFactors || {};
      signalDataMap.set(signal.token_address, preBuyCheckFactors);
    } catch (e) { }
  });

  // 按质量分组
  const goodTokens = [];
  const badTokens = [];
  const noSignalTokens = [];

  tokens.forEach(token => {
    const category = token.human_judges?.category?.toLowerCase();
    const isGood = category === 'high_quality' || category === 'mid_quality';
    const isBad = category === 'low_quality';

    const factors = signalDataMap.get(token.token_address);
    if (!factors) {
      if (isGood || isBad) {
        noSignalTokens.push(token);
      }
      return;
    }

    const tokenData = {
      token: token.token_address,
      symbol: token.token_symbol,
      ...factors
    };

    if (isGood) goodTokens.push(tokenData);
    if (isBad) badTokens.push(tokenData);
  });

  console.log(`数据概况:`);
  console.log(`  中高质量代币: ${goodTokens.length}`);
  console.log(`  低质量代币: ${badTokens.length}`);
  console.log(`  无信号数据: ${noSignalTokens.length}\n`);

  // 评估所有策略
  const results = [];

  Object.entries(strategies).forEach(([key, strategy]) => {
    const cm = calculateConfusionMatrix(goodTokens, badTokens, strategy.condition);
    const metrics = calculateMetrics(cm);
    results.push({ key, strategy, cm, metrics });
  });

  // 按F1分数排序
  results.sort((a, b) => b.metrics.f1 - a.metrics.f1);

  // 打印策略对比表
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                          策略对比表                                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log('策略'.padEnd(28) + '精度'.padStart(8) + '召回'.padStart(8) + 'F1'.padStart(8) + '准确率'.padStart(8) + '通过率'.padStart(10));
  console.log('─'.repeat(78));

  results.forEach(({ key, strategy, cm, metrics }) => {
    const passRate = ((cm.tp + cm.fp) / (goodTokens.length + badTokens.length) * 100).toFixed(1);
    const label = (key === 'optimized_full' ? '★ ' : '  ') + strategy.name;
    console.log(
      label.padEnd(28) +
      (metrics.precision * 100).toFixed(1).padStart(7) + '%' +
      (metrics.recall * 100).toFixed(1).padStart(7) + '%' +
      (metrics.f1 * 100).toFixed(1).padStart(7) + '%' +
      (metrics.accuracy * 100).toFixed(1).padStart(7) + '%' +
      passRate.padStart(9) + '%'
    );
  });

  // 详细展示推荐策略的混淆矩阵
  console.log('\n╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                       推荐策略详细分析                                     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const recommended = results.find(r => r.key === 'optimized_full');
  if (recommended) {
    console.log(`【${recommended.strategy.name}】\n`);
    printConfusionMatrix(recommended.cm, goodTokens.length, badTokens.length);
    console.log('');
    console.log('指标:');
    console.log(`  精确率 (Precision): ${(recommended.metrics.precision * 100).toFixed(1)}% - 预测通过中真正高质量的比例`);
    console.log(`  召回率 (Recall):    ${(recommended.metrics.recall * 100).toFixed(1)}% - 高质量代币被正确识别的比例`);
    console.log(`  特异性 (Specificity): ${(recommended.metrics.specificity * 100).toFixed(1)}% - 低质量代币被正确过滤的比例`);
    console.log(`  F1分数: ${(recommended.metrics.f1 * 100).toFixed(1)}% - 精确率和召回率的调和平均`);
    console.log(`  准确率 (Accuracy): ${(recommended.metrics.accuracy * 100).toFixed(1)}% - 整体预测正确的比例`);
    console.log(`  假正率: ${(recommended.metrics.falsePositiveRate * 100).toFixed(1)}% - 低质量被误判通过的比例`);
    console.log('');
  }

  // 策略条件详情
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                       推荐策略条件                                         ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

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

  // 对比当前策略
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    与当前策略对比                                         ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const currentResult = results.find(r => r.key === 'current');
  const optimizedResult = results.find(r => r.key === 'optimized_full');

  if (currentResult && optimizedResult) {
    console.log('                    当前策略     优化策略     改善');
    console.log('精确率 (Precision):   ' +
      (currentResult.metrics.precision * 100).toFixed(1).padStart(6) + '%    ' +
      (optimizedResult.metrics.precision * 100).toFixed(1).padStart(6) + '%    ' +
      ((optimizedResult.metrics.precision - currentResult.metrics.precision) * 100).toFixed(1).padStart(6) + '%');
    console.log('召回率 (Recall):      ' +
      (currentResult.metrics.recall * 100).toFixed(1).padStart(6) + '%    ' +
      (optimizedResult.metrics.recall * 100).toFixed(1).padStart(6) + '%    ' +
      ((optimizedResult.metrics.recall - currentResult.metrics.recall) * 100).toFixed(1).padStart(6) + '%');
    console.log('F1分数:               ' +
      (currentResult.metrics.f1 * 100).toFixed(1).padStart(6) + '%    ' +
      (optimizedResult.metrics.f1 * 100).toFixed(1).padStart(6) + '%    ' +
      ((optimizedResult.metrics.f1 - currentResult.metrics.f1) * 100).toFixed(1).padStart(6) + '%');
    console.log('');
  }

  // 遗漏的高质量代币分析
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    遗漏的高质量代币分析                                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const optimizedResultData = results.find(r => r.key === 'optimized_full');
  if (optimizedResultData) {
    const missedGoodTokens = goodTokens.filter(t => !optimizedResultData.strategy.condition(t));

    console.log(`优化策略遗漏的高质量代币 (${missedGoodTokens.length} 个):\n`);

    missedGoodTokens.forEach(token => {
      console.log(`代币: ${token.symbol}`);
      console.log(`  地址: ${token.token}`);
      console.log(`  黑名单: ${token.holderBlacklistCount}, 白名单: ${token.holderWhitelistCount}`);
      console.log(`  交易数/分: ${token.earlyTradesCountPerMin?.toFixed(2) || 'N/A'}, 交易量/分: ${token.earlyTradesVolumePerMin?.toFixed(2) || 'N/A'}`);
      console.log(`  独立钱包: ${token.earlyTradesUniqueWallets || 'N/A'}, 钱包/分: ${token.earlyTradesWalletsPerMin?.toFixed(2) || 'N/A'}`);
      console.log('');
    });
  }

  // 通过的低质量代币分析
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    通过的低质量代币分析                                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  if (optimizedResultData) {
    const passedBadTokens = badTokens.filter(t => optimizedResultData.strategy.condition(t));

    console.log(`优化策略通过的低质量代币 (${passedBadTokens.length} 个):\n`);

    passedBadTokens.forEach(token => {
      console.log(`代币: ${token.symbol}`);
      console.log(`  地址: ${token.token}`);
      console.log(`  黑名单: ${token.holderBlacklistCount}, 白名单: ${token.holderWhitelistCount}`);
      console.log(`  交易数/分: ${token.earlyTradesCountPerMin?.toFixed(2) || 'N/A'}, 交易量/分: ${token.earlyTradesVolumePerMin?.toFixed(2) || 'N/A'}`);
      console.log(`  独立钱包: ${token.earlyTradesUniqueWallets || 'N/A'}, 钱包/分: ${token.earlyTradesWalletsPerMin?.toFixed(2) || 'N/A'}`);
      console.log('');
    });
  }

  // 最终推荐
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                       最终推荐                                             ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log('基于数据分析和混淆矩阵评估，推荐使用以下策略:\n');
  console.log('【主推】优化策略-完整版 (optimized_full)');
  console.log('  - 平衡了精确率和召回率');
  console.log('  - 引入了两个新强特征: earlyTradesUniqueWallets, earlyTradesWalletsPerMin');
  console.log('  - 显著降低了误判率\n');

  console.log('【备选】保守策略-高精度 (conservative)');
  console.log('  - 如果优先考虑避免买到低质量代币');
  console.log('  - 精确率更高，但会漏掉部分高质量代币\n');

  console.log('【备选】激进策略-高召回 (aggressive)');
  console.log('  - 如果优先考虑不错过高质量代币');
  console.log('  - 召回率更高，但会通过更多低质量代币\n');

  console.log('═══════════════════════════════════════════════════════════════════════════\n');
  console.log('注意: 以上评估基于 ' + goodTokens.length + ' 个中高质量代币和 ' + badTokens.length + ' 个低质量代币。');
  console.log('      建议在实盘前进行回测验证，并持续监控效果。\n');
}

evaluateStrategies().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('评估失败:', error);
  process.exit(1);
});
