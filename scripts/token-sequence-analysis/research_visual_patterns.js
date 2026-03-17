/**
 * 交易模式可视化分析
 * 通过热力图和统计图展示交易模式
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'processed');
const OUTPUT_DIR = path.join(__dirname, 'data', 'visualizations');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function loadSequences() {
  const sequencesPath = path.join(DATA_DIR, 'all_sequences.json');
  const content = fs.readFileSync(sequencesPath, 'utf-8');
  const data = JSON.parse(content);
  return data.sequences;
}

/**
 * 生成ASCII热力图
 */
function generateHeatmap(data, rows, cols, title) {
  console.log(`\n${title}`);
  console.log('='.repeat(title.length));

  // 找到最大最小值
  const allValues = data.flat();
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);

  // ASCII灰度梯度
  const gradient = ' ░▒▓█';

  for (let i = 0; i < rows; i++) {
    let line = '';
    for (let j = 0; j < cols; j++) {
      if (data[i] && data[i][j] !== undefined) {
        const value = data[i][j];
        const normalized = (value - min) / (max - min + 0.001);
        const idx = Math.floor(normalized * (gradient.length - 1));
        line += gradient[idx];
      } else {
        line += ' ';
      }
    }
    console.log(line);
  }

  console.log(`最小: ${min.toFixed(2)}, 最大: ${max.toFixed(2)}`);
}

/**
 * 交易密度热力图（时间 vs 钱包）
 */
function tradeDensityHeatmap(sequences) {
  console.log('========================================');
  console.log('交易密度热力图分析');
  console.log('========================================\n');

  // 按涨幅排序，取前5、中5、后5个代币
  const sorted = [...sequences].sort((a, b) => b.max_change_percent - a.max_change_percent);

  const top5 = sorted.slice(0, 5);
  const mid5 = sorted.slice(Math.floor(sorted.length / 2) - 2, Math.floor(sorted.length / 2) + 3);
  const bottom5 = sorted.slice(-5);

  // 生成热力图数据
  const createHeatmapData = (tokens) => {
    const data = [];
    const maxLen = Math.max(...tokens.map(t => t.sequence.length));

    for (const token of tokens) {
      const row = [];
      for (let i = 0; i < Math.min(60, maxLen); i += 3) { // 每3笔交易合并
        const start = i;
        const end = Math.min(i + 3, token.sequence.length);
        const trades = token.sequence.slice(start, end);

        const buyAmount = trades.reduce((sum, [, a]) => a > 0 ? sum + a : sum, 0);
        const sellAmount = trades.reduce((sum, [, a]) => a < 0 ? sum + Math.abs(a) : sum, 0);
        row.push(buyAmount - sellAmount);
      }
      data.push(row);
    }

    return data;
  };

  // 高涨幅组
  const topData = createHeatmapData(top5);
  generateHeatmap(topData, 5, 20, '高涨幅组 Top 5 (每3笔合并):');

  console.log('\n代币信息:');
  top5.forEach((t, i) => {
    console.log(`  ${i + 1}. ${t.token_symbol}: +${t.max_change_percent.toFixed(1)}%, ${t.sequence.length} 笔`);
  });

  // 中涨幅组
  const midData = createHeatmapData(mid5);
  generateHeatmap(midData, 5, 20, '\n中涨幅组 Mid 5 (每3笔合并):');

  console.log('\n代币信息:');
  mid5.forEach((t, i) => {
    console.log(`  ${i + 1}. ${t.token_symbol}: +${t.max_change_percent.toFixed(1)}%, ${t.sequence.length} 笔`);
  });

  // 低涨幅组
  const bottomData = createHeatmapData(bottom5);
  generateHeatmap(bottomData, 5, 20, '\n低涨幅组 Bottom 5 (每3笔合并):');

  console.log('\n代币信息:');
  bottom5.forEach((t, i) => {
    console.log(`  ${i + 1}. ${t.token_symbol}: +${t.max_change_percent.toFixed(1)}%, ${t.sequence.length} 笔`);
  });
}

/**
 * 买卖模式柱状图
 */
function buySellPatternAnalysis(sequences) {
  console.log('\n========================================');
  console.log('买卖模式分析');
  console.log('========================================\n');

  // 按涨幅分组
  const groups = {
    '高涨幅 (>500%)': sequences.filter(s => s.max_change_percent >= 500),
    '中涨幅 (100-500%)': sequences.filter(s => s.max_change_percent >= 100 && s.max_change_percent < 500),
    '低涨幅 (<100%)': sequences.filter(s => s.max_change_percent < 100)
  };

  Object.entries(groups).forEach(([name, tokens]) => {
    if (tokens.length === 0) return;

    // 计算前30笔交易的买卖模式
    const pattern = [];
    for (let i = 0; i < Math.min(30, tokens[0].sequence.length); i += 3) {
      let buy = 0, sell = 0;
      tokens.forEach(token => {
        const trades = token.sequence.slice(i, i + 3);
        buy += trades.filter(([, a]) => a > 0).length;
        sell += trades.filter(([, a]) => a < 0).length;
      });
      pattern.push({ buy, sell, net: buy - sell });
    }

    console.log(`${name} (${tokens.length} 个代币):`);

    // ASCII柱状图
    pattern.forEach((p, i) => {
      const barLength = Math.min(50, Math.abs(p.net) * 2);
      const bar = p.net > 0 ? '█'.repeat(barLength) : '░'.repeat(barLength);
      const sign = p.net > 0 ? '+' : '';
      console.log(`  段${i + 1}: ${sign}${p.net} ${bar}`);
    });
    console.log('');
  });
}

/**
 * 序列形状分类
 */
function sequenceShapeClassification(sequences) {
  console.log('\n========================================');
  console.log('序列形状分类');
  console.log('========================================\n');

  const shapes = {
    '急涨型': [],      // 前期大量买入，后期平稳
    '缓涨型': [],      // 持续稳定买入
    '波动型': [],      // 买卖交替
    '抛售型': [],      // 后期大量卖出
    '极简型': []       // 交易极少
  };

  sequences.forEach(seq => {
    if (seq.sequence.length < 10) {
      shapes['极简型'].push(seq);
      return;
    }

    const firstHalf = seq.sequence.slice(0, Math.floor(seq.sequence.length / 2));
    const secondHalf = seq.sequence.slice(Math.floor(seq.sequence.length / 2));

    const firstBuy = firstHalf.filter(([, a]) => a > 0).length;
    const firstSell = firstHalf.filter(([, a]) => a < 0).length;
    const secondBuy = secondHalf.filter(([, a]) => a > 0).length;
    const secondSell = secondHalf.filter(([, a]) => a < 0).length;

    const firstNet = firstBuy - firstSell;
    const secondNet = secondBuy - secondSell;

    if (firstNet > secondNet * 2 && firstSell < firstBuy * 0.3) {
      shapes['急涨型'].push(seq);
    } else if (firstNet > 0 && secondNet > 0 && Math.abs(firstNet - secondNet) < firstNet * 0.5) {
      shapes['缓涨型'].push(seq);
    } else if (secondSell > secondBuy * 2) {
      shapes['抛售型'].push(seq);
    } else {
      shapes['波动型'].push(seq);
    }
  });

  // 分析各形状的平均涨幅
  console.log('序列形状与涨幅的关系:\n');

  Object.entries(shapes).forEach(([shape, tokens]) => {
    if (tokens.length === 0) return;

    const avgChange = tokens.reduce((sum, t) => sum + t.max_change_percent, 0) / tokens.length;
    const highReturnRate = tokens.filter(t => t.max_change_percent >= 100).length / tokens.length;

    console.log(`${shape}: ${tokens.length} 个代币`);
    console.log(`  平均涨幅: ${avgChange.toFixed(1)}%`);
    console.log(`  高涨幅占比: ${(highReturnRate * 100).toFixed(1)}%`);

    // 显示代表代币
    tokens.sort((a, b) => b.max_change_percent - a.max_change_percent);
    console.log(`  代表代币:`);
    tokens.slice(0, 3).forEach(t => {
      console.log(`    ${t.token_symbol}: +${t.max_change_percent.toFixed(1)}%`);
    });
    console.log('');
  });
}

/**
 * 金额分布直方图
 */
function amountDistributionHistogram(sequences) {
  console.log('\n========================================');
  console.log('金额分布分析');
  console.log('========================================\n');

  // 收集所有交易金额
  const allAmounts = [];
  const buyAmounts = [];
  const sellAmounts = [];

  sequences.forEach(seq => {
    seq.sequence.forEach(([, amount]) => {
      const absAmount = Math.abs(amount);
      allAmounts.push(absAmount);
      if (amount > 0) {
        buyAmounts.push(absAmount);
      } else {
        sellAmounts.push(absAmount);
      }
    });
  });

  // 统计区间
  const createHistogram = (amounts, label) => {
    console.log(`\n${label}:`);

    const bins = [0, 10, 50, 100, 500, 1000, 5000, 10000, Infinity];
    const counts = new Array(bins.length - 1).fill(0);

    amounts.forEach(a => {
      for (let i = 0; i < bins.length - 1; i++) {
        if (a >= bins[i] && a < bins[i + 1]) {
          counts[i]++;
          break;
        }
      }
    });

    const maxCount = Math.max(...counts);

    counts.forEach((count, i) => {
      const barLength = Math.floor((count / maxCount) * 50);
      const bar = '█'.repeat(barLength);
      const rangeLabel = bins[i + 1] === Infinity ? `>= $${bins[i]}` : `$${bins[i]}-${bins[i + 1]}`;
      console.log(`  ${rangeLabel.padEnd(15)} ${bar} ${count}`);
    });

    console.log(`  总数: ${amounts.length}`);
    console.log(`  中位数: $${amounts.sort((a, b) => a - b)[Math.floor(amounts.length / 2)].toFixed(2)}`);
    console.log(`  平均: $${(amounts.reduce((a, b) => a + b, 0) / amounts.length).toFixed(2)}`);
  };

  createHistogram(allAmounts, '所有交易');
  createHistogram(buyAmounts, '买入交易');
  createHistogram(sellAmounts, '卖出交易');

  // 分析大额交易与涨幅的关系
  console.log('\n\n========================================');
  console.log('大额交易与涨幅的关系');
  console.log('========================================\n');

  const tokenLargeTradeRatio = sequences.map(seq => {
    const largeThreshold = 500; // $500以上算大额
    const largeTrades = seq.sequence.filter(([, a]) => Math.abs(a) >= largeThreshold).length;
    const ratio = largeTrades / seq.sequence.length;

    return {
      symbol: seq.token_symbol,
      change: seq.max_change_percent,
      largeTradeRatio: ratio,
      largeTradeCount: largeTrades
    };
  });

  // 按大额交易比例分组
  const groups = [
    { name: '无大额交易', min: 0, max: 0 },
    { name: '少量大额 (<10%)', min: 0, max: 0.1 },
    { name: '中量大量 (10-30%)', min: 0.1, max: 0.3 },
    { name: '大量交易 (>30%)', min: 0.3, max: 1 }
  ];

  groups.forEach(group => {
    const groupTokens = tokenLargeTradeRatio.filter(t => {
      if (group.max === 0) return t.largeTradeRatio === 0;
      return t.largeTradeRatio >= group.min && t.largeTradeRatio < group.max;
    });

    if (groupTokens.length === 0) return;

    const avgChange = groupTokens.reduce((sum, t) => sum + t.change, 0) / groupTokens.length;
    const highReturnRate = groupTokens.filter(t => t.change >= 100).length / groupTokens.length;

    console.log(`${group.name}: ${groupTokens.length} 个代币`);
    console.log(`  平均涨幅: ${avgChange.toFixed(1)}%`);
    console.log(`  高涨幅占比: ${(highReturnRate * 100).toFixed(1)}%`);
    console.log('');
  });
}

/**
 * 导出数据用于外部可视化
 */
function exportVisualizationData(sequences) {
  console.log('\n========================================');
  console.log('导出可视化数据');
  console.log('========================================\n');

  // 导出热力图数据
  const heatmapData = sequences.map(seq => {
    const windows = [];
    for (let i = 0; i < seq.sequence.length; i += 5) {
      const window = seq.sequence.slice(i, i + 5);
      const netFlow = window.reduce((sum, [, a]) => sum + a, 0);
      windows.push(netFlow);
    }
    return {
      symbol: seq.token_symbol,
      change: seq.max_change_percent,
      windows: windows.slice(0, 50) // 最多50个窗口
    };
  });

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'heatmap_data.json'),
    JSON.stringify(heatmapData, null, 2)
  );

  console.log('✓ 热力图数据已导出到: data/visualizations/heatmap_data.json');

  // 导出时间序列数据
  const timeseriesData = sequences.map(seq => {
    const cumulativeFlow = [];
    let cumulative = 0;
    seq.sequence.forEach(([, amount]) => {
      cumulative += amount;
      cumulativeFlow.push(cumulative);
    });

    return {
      symbol: seq.token_symbol,
      change: seq.max_change_percent,
      cumulative_flow: cumulativeFlow.slice(0, 100)
    };
  });

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'timeseries_data.json'),
    JSON.stringify(timeseriesData, null, 2)
  );

  console.log('✓ 时间序列数据已导出到: data/visualizations/timeseries_data.json');
}

async function main() {
  console.log('========================================');
  console.log('交易模式可视化分析');
  console.log('========================================\n');

  const sequences = loadSequences();
  console.log(`✓ 读取 ${sequences.length} 个代币序列\n`);

  // 1. 交易密度热力图
  tradeDensityHeatmap(sequences);

  // 2. 买卖模式分析
  buySellPatternAnalysis(sequences);

  // 3. 序列形状分类
  sequenceShapeClassification(sequences);

  // 4. 金额分布直方图
  amountDistributionHistogram(sequences);

  // 5. 导出数据
  exportVisualizationData(sequences);

  console.log('\n========================================');
  console.log('✓ 分析完成!');
  console.log('========================================\n');
}

main().catch(err => {
  console.error('分析失败:', err);
  process.exit(1);
});
