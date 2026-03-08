/**
 * 寻找最优阈值组合 - 精确率和召回率的最佳平衡
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function findOptimalThresholds() {
  const experimentId = 'afed3289-2f89-4da5-88f1-1468d61f8b3d';

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

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                  寻找最优阈值组合                                           ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 测试不同的阈值组合
  const thresholdCombinations = [
    // 格式: [交易数阈值, 交易量阈值, 独立钱包阈值, 白名单阈值]
    [100, 8000, 65, 25],  // 原推荐
    [80, 6500, 55, 22],   // 平衡优化
    [70, 6000, 50, 20],   // 更宽松
    [60, 5500, 45, 18],   // 激进
    [90, 7000, 60, 22],   // 微调
    [75, 6200, 52, 20],   // 中等偏松
    [85, 6800, 58, 22],   // 微调2
    [65, 5800, 48, 19],   // 激进2
  ];

  function evaluateThresholds(countThresh, volumeThresh, walletThresh, whitelistThresh) {
    let tp = 0, fp = 0, tn = 0, fn = 0;

    const condition = (t) => {
      return t.holderBlacklistCount <= 5 &&
             t.holderWhitelistCount >= whitelistThresh &&
             t.devHoldingRatio < 15 &&
             t.maxHoldingRatio < 18 &&
             t.earlyTradesCountPerMin >= countThresh &&
             t.earlyTradesVolumePerMin >= volumeThresh &&
             t.earlyTradesUniqueWallets >= walletThresh;
    };

    goodTokens.forEach(t => {
      if (condition(t)) tp++; else fn++;
    });
    badTokens.forEach(t => {
      if (condition(t)) fp++; else tn++;
    });

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

    return { tp, fp, tn, fn, precision, recall, f1 };
  }

  const results = thresholdCombinations.map(([c, v, w, wl]) => ({
    countThresh: c,
    volumeThresh: v,
    walletThresh: w,
    whitelistThresh: wl,
    ...evaluateThresholds(c, v, w, wl)
  }));

  // 按F1排序
  results.sort((a, b) => b.f1 - a.f1);

  console.log('阈值组合对比 (按F1排序):\n');
  console.log('交易数  交易量  钱包数  白名单  精确率  召回率   F1   TP  FP');
  console.log('─'.repeat(60));

  results.forEach((r, i) => {
    const label = i === 0 ? '★ ' : '  ';
    console.log(
      label +
      r.countThresh.toString().padStart(4) +
      r.volumeThresh.toString().padStart(5) +
      r.walletThresh.toString().padStart(5) +
      r.whitelistThresh.toString().padStart(5) +
      (r.precision * 100).toFixed(1).padStart(6) + '%' +
      (r.recall * 100).toFixed(1).padStart(6) + '%' +
      (r.f1 * 100).toFixed(1).padStart(5) + '%' +
      r.tp.toString().padStart(3) +
      r.fp.toString().padStart(3)
    );
  });
  console.log('');

  // 找出F1最高的
  const best = results[0];
  console.log('【最优配置】\n');
  console.log('preBuyCheckCondition = "');
  console.log('  holderBlacklistCount <= 5 AND');
  console.log(`  holderWhitelistCount >= ${best.whitelistThresh} AND`);
  console.log('  devHoldingRatio < 15 AND');
  console.log('  maxHoldingRatio < 18 AND');
  console.log(`  earlyTradesCountPerMin >= ${best.countThresh} AND`);
  console.log(`  earlyTradesVolumePerMin >= ${best.volumeThresh} AND`);
  console.log(`  earlyTradesUniqueWallets >= ${best.walletThresh}`);
  console.log('"\n');

  console.log('预期效果:');
  console.log(`  精确率: ${(best.precision * 100).toFixed(1)}%`);
  console.log(`  召回率: ${(best.recall * 100).toFixed(1)}%`);
  console.log(`  F1分数: ${(best.f1 * 100).toFixed(1)}%\n`);

  // 针对不同目标的推荐
  console.log('【针对不同目标的推荐配置】\n');

  console.log('1. 追求高召回率 (不错过机会):');
  const highRecall = results.slice(0, 5).sort((a, b) => b.recall - a.recall)[0];
  console.log(`   交易数>=${highRecall.countThresh}, 交易量>=${highRecall.volumeThresh}, 钱包>=${highRecall.walletThresh}, 白名单>=${highRecall.whitelistThresh}`);
  console.log(`   召回率: ${(highRecall.recall * 100).toFixed(1)}%, 精确率: ${(highRecall.precision * 100).toFixed(1)}%\n`);

  console.log('2. 追求高精确率 (避免买到垃圾):');
  const highPrecision = results.slice(0, 10).sort((a, b) => b.precision - a.precision)[0];
  console.log(`   交易数>=${highPrecision.countThresh}, 交易量>=${highPrecision.volumeThresh}, 钱包>=${highPrecision.walletThresh}, 白名单>=${highPrecision.whitelistThresh}`);
  console.log(`   精确率: ${(highPrecision.precision * 100).toFixed(1)}%, 召回率: ${(highPrecision.recall * 100).toFixed(1)}%\n`);

  console.log('3. 追求平衡 (F1最高):');
  console.log(`   交易数>=${best.countThresh}, 交易量>=${best.volumeThresh}, 钱包>=${best.walletThresh}, 白名单>=${best.whitelistThresh}`);
  console.log(`   F1分数: ${(best.f1 * 100).toFixed(1)}%, 精确率: ${(best.precision * 100).toFixed(1)}%, 召回率: ${(best.recall * 100).toFixed(1)}%\n`);

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('建议: 根据你的风险偏好选择合适的配置。如果希望召回率在60%以上，');
  console.log('      推荐"追求高召回率"或"平衡"配置。');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

findOptimalThresholds().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
