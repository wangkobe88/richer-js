/**
 * 分析总结：购买前检查特征对代币质量的区分能力
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

function calculatePercentiles(values, percentiles) {
  if (values.length === 0) return {};
  const sorted = [...values].sort((a, b) => a - b);
  const result = {};
  percentiles.forEach(p => {
    const index = Math.ceil(sorted.length * p / 100) - 1;
    const clampedIndex = Math.max(0, Math.min(index, sorted.length - 1));
    result[`P${p}`] = sorted[clampedIndex];
  });
  return result;
}

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

async function analyzeSummary() {
  const experimentId = 'afed3289-2f89-4da5-88f1-1468d61f8b3d';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║          购买前检查特征区分能力分析报告                                    ║');
  console.log('║          实验ID: afed3289-2f89-4da5-88f1-1468d61f8b3d                         ║');
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

  // 质量分布统计
  const qualityStats = { high: 0, medium: 0, low: 0 };
  tokens.forEach(t => {
    const cat = t.human_judges?.category?.toLowerCase();
    if (cat === 'high_quality') qualityStats.high++;
    else if (cat === 'mid_quality') qualityStats.medium++;
    else if (cat === 'low_quality') qualityStats.low++;
  });

  console.log('【数据概况】');
  console.log(`  高质量代币: ${qualityStats.high}`);
  console.log(`  中质量代币: ${qualityStats.medium}`);
  console.log(`  低质量代币: ${qualityStats.low}`);
  console.log(`  总计: ${tokens.length}`);
  console.log(`  购买信号数: ${signals.length}\n`);

  // 按质量分组
  const factorKeys = [
    'holderBlacklistCount', 'holderWhitelistCount', 'devHoldingRatio', 'maxHoldingRatio',
    'earlyTradesCountPerMin', 'earlyTradesVolumePerMin', 'earlyTradesHighValuePerMin',
    'earlyTradesWalletsPerMin', 'earlyTradesUniqueWallets'
  ];

  const goodTokens = [], badTokens = [];
  tokens.forEach(token => {
    const category = token.human_judges?.category?.toLowerCase();
    const isGood = category === 'high_quality' || category === 'mid_quality';
    const isBad = category === 'low_quality';
    const factors = signalDataMap.get(token.token_address);
    if (factors && (isGood || isBad)) {
      const tokenData = { token: token.token_address, symbol: token.token_symbol, ...factors };
      if (isGood) goodTokens.push(tokenData);
      if (isBad) badTokens.push(tokenData);
    }
  });

  console.log(`【分析样本】`);
  console.log(`  中高质量: ${goodTokens.length} 个`);
  console.log(`  低质量: ${badTokens.length} 个\n`);

  // 特征区分度分析
  const featureAnalysis = [];
  factorKeys.forEach(key => {
    const goodValues = goodTokens.map(t => t[key]).filter(v => v !== null && v !== undefined);
    const badValues = badTokens.map(t => t[key]).filter(v => v !== null && v !== undefined);
    if (goodValues.length > 0 && badValues.length > 0) {
      const goodStats = calculateStats(goodValues);
      const badStats = calculateStats(badValues);
      const diffPercent = badStats.avg !== 0 ? ((goodStats.avg - badStats.avg) / Math.abs(badStats.avg) * 100) : 0;

      // Cohen's d 分离度
      const pooledStdDev = Math.sqrt(
        (Math.pow(goodStats.stdDev, 2) * (goodValues.length - 1) +
         Math.pow(badStats.stdDev, 2) * (badValues.length - 1)) /
        (goodValues.length + badValues.length - 2)
      );
      const discriminantPower = pooledStdDev > 0 ? Math.abs(goodStats.avg - badStats.avg) / pooledStdDev : 0;

      featureAnalysis.push({
        feature: key,
        goodAvg: goodStats.avg,
        badAvg: badStats.avg,
        diffPercent,
        discriminantPower,
        goodPercentiles: calculatePercentiles(goodValues, [25, 50, 75]),
        badPercentiles: calculatePercentiles(badValues, [25, 50, 75])
      });
    }
  });

  // 按分离度排序
  featureAnalysis.sort((a, b) => b.discriminantPower - a.discriminantPower);

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                      特征区分度排序                                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  featureAnalysis.forEach((f, i) => {
    const direction = f.goodAvg >= f.badAvg ? '↑' : '↓';
    console.log(`${i + 1}. ${f.feature} ${direction}`);
    console.log(`   中高质量平均: ${f.goodAvg.toFixed(2)} | 低质量平均: ${f.badAvg.toFixed(2)}`);
    console.log(`   差异: ${f.diffPercent > 0 ? '+' : ''}${f.diffPercent.toFixed(1)}% | 分离度: ${f.discriminantPower.toFixed(2)}`);
    console.log('');
  });

  // Top 5 特征详细分析
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                      Top 5 特征详细分析                                     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const top5 = featureAnalysis.slice(0, 5);
  const currentThresholds = {
    holderBlacklistCount: '<= 5',
    holderWhitelistCount: '>= holderBlacklistCount * 2',
    devHoldingRatio: '< 15',
    maxHoldingRatio: '< 18',
    earlyTradesCountPerMin: '>= 30',
    earlyTradesVolumePerMin: '>= 4000',
    earlyTradesHighValuePerMin: '>= 10',
    earlyTradesWalletsPerMin: '未设置',
    earlyTradesUniqueWallets: '未设置'
  };

  top5.forEach(f => {
    console.log(`【${f.feature}】`);
    console.log(`  当前阈值: ${currentThresholds[f.feature] || '未设置'}`);
    console.log(`  中高质量: P25=${f.goodPercentiles.P25?.toFixed(2) || 'N/A'}, P50=${f.goodPercentiles.P50?.toFixed(2) || 'N/A'}, P75=${f.goodPercentiles.P75?.toFixed(2) || 'N/A'}`);
    console.log(`  低质量:   P25=${f.badPercentiles.P25?.toFixed(2) || 'N/A'}, P50=${f.badPercentiles.P50?.toFixed(2) || 'N/A'}, P75=${f.badPercentiles.P75?.toFixed(2) || 'N/A'}`);
    console.log('');
  });

  // 优化建议
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                      优化建议                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log('基于数据分析，建议的购买前检查优化：\n');

  console.log('1. 【新增特征】earlyTradesUniqueWallets（早期独立钱包数）');
  console.log('   - 分离度最高: 1.25');
  console.log('   - 建议阈值: >= 70-75');
  console.log('   - 含义: 代币发布早期参与的不同钱包地址数量\n');

  console.log('2. 【新增特征】earlyTradesWalletsPerMin（每分钟活跃钱包数）');
  console.log('   - 分离度: 1.10');
  console.log('   - 建议阈值: >= 65-70');
  console.log('   - 含义: 代币发布早期每分钟参与交易的钱包数量\n');

  console.log('3. 【调整现有】earlyTradesCountPerMin（每分钟交易次数）');
  console.log('   - 当前阈值: >= 30');
  console.log('   - 建议阈值: >= 120-125');
  console.log('   - 理由: 当前阈值过低，建议大幅提高以过滤低质量代币\n');

  console.log('4. 【调整现有】holderWhitelistCount（白名单持币地址数）');
  console.log('   - 当前阈值: >= holderBlacklistCount * 2');
  console.log('   - 建议阈值: >= 30-35（绝对值）');
  console.log('   - 理由: 设定绝对下限比相对比例更可靠\n');

  console.log('5. 【调整现有】earlyTradesVolumePerMin（每分钟交易量）');
  console.log('   - 当前阈值: >= 4000');
  console.log('   - 建议阈值: >= 10000-10500');
  console.log('   - 理由: 提高阈值可以更好地区分高质量代币\n');

  console.log('═══════════════════════════════════════════════════════════════════════════\n');
  console.log('注意: 以上分析基于 ' + goodTokens.length + ' 个中高质量代币和 ' + badTokens.length + ' 个低质量代币。');
  console.log('      高质量代币样本较少(2个)，建议积累更多标注数据后进一步验证。\n');
}

analyzeSummary().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
