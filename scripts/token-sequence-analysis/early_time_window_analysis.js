/**
 * 早期时间窗口分析
 * 验证前1.2分钟的交易数据是否足够预测
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'processed');

function loadSequences() {
  const sequencesPath = path.join(DATA_DIR, 'all_sequences.json');
  const content = fs.readFileSync(sequencesPath, 'utf-8');
  const data = JSON.parse(content);
  return data.sequences;
}

/**
 * 分析不同时间窗口的预测力
 */
function analyzeTimeWindowPredictivePower(sequences) {
  console.log('========================================');
  console.log('时间窗口预测力分析');
  console.log('========================================\n');

  // 假设每笔交易间隔3秒
  const TRADE_INTERVAL = 3;

  // 定义不同的时间窗口
  const timeWindows = [
    { name: '前30秒', seconds: 30, trades: Math.floor(30 / TRADE_INTERVAL) },
    { name: '前60秒', seconds: 60, trades: Math.floor(60 / TRADE_INTERVAL) },
    { name: '前72秒 (1.2分钟)', seconds: 72, trades: Math.floor(72 / TRADE_INTERVAL) },
    { name: '前90秒', seconds: 90, trades: Math.floor(90 / TRADE_INTERVAL) },
    { name: '前120秒', seconds: 120, trades: Math.floor(120 / TRADE_INTERVAL) },
    { name: '前180秒', seconds: 180, trades: Math.floor(180 / TRADE_INTERVAL) },
    { name: '全部交易', seconds: Infinity, trades: Infinity }
  ];

  // 计算相关性
  const correlation = (xArr, yArr) => {
    const n = xArr.length;
    if (n === 0) return 0;

    const meanX = xArr.reduce((a, b) => a + b, 0) / n;
    const meanY = yArr.reduce((a, b) => a + b, 0) / n;

    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < n; i++) {
      const dx = xArr[i] - meanX;
      const dy = yArr[i] - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }

    if (denX === 0 || denY === 0) return 0;
    return num / Math.sqrt(denX * denY);
  };

  // 计算信息价值（IV）
  const calcIV = (values, isHighReturn) => {
    const buckets = 10;
    const sortedValues = [...values].sort((a, b) => a - b);
    const bucketSize = Math.ceil(sortedValues.length / buckets);
    const bucketBounds = [];

    for (let i = 0; i < buckets; i++) {
      bucketBounds.push(sortedValues[Math.min(i * bucketSize, sortedValues.length - 1)]);
    }
    bucketBounds.push(Infinity);

    const bucketStats = [];
    for (let i = 0; i < buckets; i++) {
      const bucketValues = values.filter((v, idx) => {
        const val = v;
        return val >= bucketBounds[i] && (i === buckets - 1 || val < bucketBounds[i + 1]);
      });

      const highCount = bucketValues.filter((v, idx) => isHighReturn[idx]).length;
      const totalCount = bucketValues.length;

      bucketStats.push({
        highCount,
        totalCount,
        highRate: totalCount > 0 ? highCount / totalCount : 0
      });
    }

    const totalHigh = isHighReturn.filter(v => v).length;
    const overallRate = totalHigh / values.length;

    let iv = 0;
    for (const bucket of bucketStats) {
      if (bucket.totalCount === 0) continue;

      const actualRate = bucket.highRate;
      if (actualRate === 0 || actualRate === 1) continue;

      const weight = bucket.totalCount / values.length;
      iv += weight * (actualRate - overallRate) * Math.log(actualRate / overallRate);
    }

    return iv;
  };

  // 对每个时间窗口进行分析
  const results = [];

  console.log('【不同时间窗口的预测力对比】\n');
  console.log('时间窗口  | 净流入相关 | 唯一钱包相关 | 净流入IV | 唯一钱包IV');
  console.log('----------|-----------|-------------|----------|-----------');

  const changes = sequences.map(s => s.max_change_percent);
  const isHighReturn = sequences.map(s => s.max_change_percent >= 100);

  timeWindows.forEach(window => {
    const netFlows = [];
    const uniqueWallets = [];

    sequences.forEach(seq => {
      const maxTrades = window.trades === Infinity ? seq.sequence.length : window.trades;
      const windowTrades = seq.sequence.slice(0, maxTrades);

      const netFlow = windowTrades.reduce((sum, [, a]) => sum + a, 0);
      const wallets = new Set(windowTrades.map(([w]) => w));

      netFlows.push(netFlow);
      uniqueWallets.push(wallets.size);
    });

    const corrNetFlow = correlation(netFlows, changes);
    const corrWallets = correlation(uniqueWallets, changes);
    const ivNetFlow = calcIV(netFlows, isHighReturn);
    const ivWallets = calcIV(uniqueWallets, isHighReturn);

    results.push({
      name: window.name,
      seconds: window.seconds,
      corrNetFlow,
      corrWallets,
      ivNetFlow,
      ivWallets
    });

    console.log(`${window.name.padEnd(9)} | ${corrNetFlow.toFixed(3).padStart(10)} | ${corrWallets.toFixed(3).padStart(11)} | ${ivNetFlow.toFixed(3).padStart(8)} | ${ivWallets.toFixed(3).padStart(9)}`);
  });

  // 找出预测力最强的时间窗口
  console.log('\n【关键发现】\n');

  const bestNetFlow = results.reduce((best, r) => r.ivNetFlow > best.ivNetFlow ? r : best);
  const bestWallets = results.reduce((best, r) => r.ivWallets > best.ivWallets ? r : best);

  console.log(`净流入IV最高的时间窗口: ${bestNetFlow.name} (IV=${bestNetFlow.ivNetFlow.toFixed(3)})`);
  console.log(`唯一钱包IV最高的时间窗口: ${bestWallets.name} (IV=${bestWallets.ivWallets.toFixed(3)})`);

  // 分析1.2分钟的具体表现
  console.log('\n【前72秒（1.2分钟）的详细分析】\n');

  const window72 = results.find(r => r.seconds === 72);
  console.log(`净流入相关系数: ${window72.corrNetFlow.toFixed(3)}`);
  console.log(`唯一钱包相关系数: ${window72.corrWallets.toFixed(3)}`);
  console.log(`净流入IV: ${window72.ivNetFlow.toFixed(3)}`);
  console.log(`唯一钱包IV: ${window72.ivWallets.toFixed(3)}`);

  // 判断是否"够用"
  console.log('\n【评估：前1.2分钟是否够用？】\n');

  // 定义阈值
  const MIN_ACCEPTABLE_IV = 0.03;
  const MIN_ACCEPTABLE_CORR = 0.15;

  const netFlowAcceptable = window72.ivNetFlow >= MIN_ACCEPTABLE_IV;
  const walletAcceptable = window72.ivWallets >= MIN_ACCEPTABLE_IV;

  console.log(`评估标准: IV >= ${MIN_ACCEPTABLE_IV}, 相关系数 >= ${MIN_ACCEPTABLE_CORR}\n`);

  if (netFlowAcceptable && walletAcceptable) {
    console.log('✅ 前分钟数据足够用于预测');
    console.log(`   净流入IV = ${window72.ivNetFlow.toFixed(3)} >= ${MIN_ACCEPTABLE_IV}`);
    console.log(`   唯一钱包IV = ${window72.ivWallets.toFixed(3)} >= ${MIN_ACCEPTABLE_IV}`);
  } else {
    console.log('⚠️  前分钟数据预测力有限');

    if (!netFlowAcceptable) {
      console.log(`   净流入IV = ${window72.ivNetFlow.toFixed(3)} < ${MIN_ACCEPTABLE_IV} (建议使用更长窗口)`);
    }
    if (!walletAcceptable) {
      console.log(`   唯一钱包IV = ${window72.ivWallets.toFixed(3)} < ${MIN_ACCEPTABLE_IV} (建议使用更长窗口)`);
    }

    // 推荐最佳时间窗口
    console.log(`\n💡 建议使用: ${bestNetFlow.name}`);
    console.log(`   净流入IV = ${bestNetFlow.ivNetFlow.toFixed(3)}`);
  }

  // 对比不同时间窗口的高涨幅预测准确率
  console.log('\n【不同时间窗口的高涨幅预测准确率】\n');

  timeWindows.forEach(window => {
    const maxTrades = window.trades === Infinity ? Infinity : window.trades;

    // 计算该窗口的净流入阈值
    const windowNetFlows = sequences.map(seq => {
      const windowTrades = seq.sequence.slice(0, Math.min(maxTrades, seq.sequence.length));
      return windowTrades.reduce((sum, [, a]) => sum + a, 0);
    });

    const sortedFlows = [...windowNetFlows].sort((a, b) => a - b);
    const threshold = sortedFlows[Math.floor(sortedFlows.length * 0.7)]; // 前30%

    // 预测：净流入 >= threshold → 高涨幅
    let correct = 0;
    let predictedHigh = 0;
    let actualHigh = 0;

    sequences.forEach((seq, i) => {
      const predicted = windowNetFlows[i] >= threshold;
      const actual = seq.max_change_percent >= 100;

      if (predicted === actual) correct++;
      if (predicted) predictedHigh++;
      if (actual) actualHigh++;
    });

    const accuracy = correct / sequences.length;
    const precision = predictedHigh > 0 ? correct / predictedHigh : 0;
    const recall = actualHigh > 0 ? correct / actualHigh : 0;

    console.log(`${window.name}:`);
    console.log(`  准确率: ${(accuracy * 100).toFixed(1)}%, 精确率: ${(precision * 100).toFixed(1)}%, 召回率: ${(recall * 100).toFixed(1)}%`);
  });

  return results;
}

/**
 * 分析前1.2分钟的序列形状
 */
function analyzeEarlySequenceShapes(sequences) {
  console.log('\n========================================');
  console.log('前1.2分钟的序列形状分析');
  console.log('========================================\n');

  const TRADE_INTERVAL = 3;
  const WINDOW_TRADES = Math.floor(72 / TRADE_INTERVAL); // 72秒 = 1.2分钟

  const shapes = {
    '强烈买入': [],  // 买入 >= 80%
    '偏多买入': [],  // 买入 60-80%
    '买卖平衡': [],  // 买入 40-60%
    '偏多卖出': [],  // 买入 < 40%
    '交易极少': []   // 交易 < 10笔
  };

  sequences.forEach(seq => {
    const windowTrades = seq.sequence.slice(0, Math.min(WINDOW_TRADES, seq.sequence.length));

    if (windowTrades.length < 10) {
      shapes['交易极少'].push(seq);
      return;
    }

    const buyCount = windowTrades.filter(([, a]) => a > 0).length;
    const buyRatio = buyCount / windowTrades.length;

    if (buyRatio >= 0.8) {
      shapes['强烈买入'].push(seq);
    } else if (buyRatio >= 0.6) {
      shapes['偏多买入'].push(seq);
    } else if (buyRatio >= 0.4) {
      shapes['买卖平衡'].push(seq);
    } else {
      shapes['偏多卖出'].push(seq);
    }
  });

  console.log('前1.2分钟的交易模式与涨幅关系:\n');

  Object.entries(shapes).forEach(([shape, tokens]) => {
    if (tokens.length === 0) return;

    const avgChange = tokens.reduce((sum, t) => sum + t.max_change_percent, 0) / tokens.length;
    const highReturnRate = tokens.filter(t => t.max_change_percent >= 100).length / tokens.length;

    console.log(`${shape} (${tokens.length}个代币):`);
    console.log(`  平均涨幅: ${avgChange.toFixed(1)}%`);
    console.log(`  高涨幅占比: ${(highReturnRate * 100).toFixed(1)}%`);
    console.log('');
  });

  return shapes;
}

async function main() {
  console.log('========================================');
  console.log('前1.2分钟交易数据预测力验证');
  console.log('========================================\n');

  const sequences = loadSequences();
  console.log(`✓ 读取 ${sequences.length} 个代币序列\n`);

  console.log('假设: 每笔交易间隔3秒\n');

  // 时间窗口预测力分析
  analyzeTimeWindowPredictivePower(sequences);

  // 前1.2分钟序列形状分析
  analyzeEarlySequenceShapes(sequences);

  console.log('\n========================================');
  console.log('分析完成!');
  console.log('========================================\n');
}

main().catch(err => {
  console.error('失败:', err);
  process.exit(1);
});
