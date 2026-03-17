/**
 * 修正版：连续买入模式分析
 * 使用更合理的指标
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
 * 指标1: 前30秒内的买入集中度
 */
function earlyBuyIntensity(sequences) {
  console.log('========================================');
  console.log('修正版分析');
  console.log('========================================\n');

  console.log('【指标1: 前30秒买入集中度】\n');

  const results = sequences.map(seq => {
    const first10Trades = seq.sequence.slice(0, 10); // 约30秒
    const buyCount = first10Trades.filter(([, a]) => a > 0).length;
    const intensity = buyCount / first10Trades.length;

    return {
      symbol: seq.token_symbol,
      change: seq.max_change_percent,
      early_buy_intensity: intensity,
      early_buy_count: buyCount
    };
  });

  // 按买入集中度分组
  const groups = {
    '低集中度 (<30%)': [],
    '中集中度 (30-70%)': [],
    '高集中度 (>70%)': []
  };

  results.forEach(r => {
    if (r.early_buy_intensity < 0.3) {
      groups['低集中度 (<30%)'].push(r);
    } else if (r.early_buy_intensity < 0.7) {
      groups['中集中度 (30-70%)'].push(r);
    } else {
      groups['高集中度 (>70%)'].push(r);
    }
  });

  Object.entries(groups).forEach(([name, tokens]) => {
    if (tokens.length === 0) return;
    const avgChange = tokens.reduce((sum, t) => sum + t.change, 0) / tokens.length;
    const highReturnRate = tokens.filter(t => t.change >= 100).length / tokens.length;

    console.log(`${name}: ${tokens.length} 个代币`);
    console.log(`  平均涨幅: ${avgChange.toFixed(1)}%`);
    console.log(`  高涨幅占比: ${(highReturnRate * 100).toFixed(1)}%\n`);
  });
}

/**
 * 指标2: 前10笔交易的买卖模式
 */
function firstTenTradesPattern(sequences) {
  console.log('【指标2: 前10笔交易模式】\n');

  const results = sequences.filter(s => s.sequence.length >= 10).map(seq => {
    const first10 = seq.sequence.slice(0, 10);
    const buyCount = first10.filter(([, a]) => a > 0).length;
    const sellCount = first10.filter(([, a]) => a < 0).length;

    // 分类模式
    let pattern;
    if (buyCount >= 8) {
      pattern = '强烈买入';
    } else if (buyCount >= 6) {
      pattern = '偏多买入';
    } else if (buyCount >= 4) {
      pattern = '买卖平衡';
    } else {
      pattern = '偏多卖出';
    }

    return {
      symbol: seq.token_symbol,
      change: seq.max_change_percent,
      pattern,
      buy_count: buyCount,
      sell_count: sellCount
    };
  });

  // 按模式分组
  const groups = {};
  results.forEach(r => {
    if (!groups[r.pattern]) groups[r.pattern] = [];
    groups[r.pattern].push(r);
  });

  Object.entries(groups).forEach(([pattern, tokens]) => {
    const avgChange = tokens.reduce((sum, t) => sum + t.change, 0) / tokens.length;
    const highReturnRate = tokens.filter(t => t.change >= 100).length / tokens.length;

    console.log(`${pattern} (${tokens.length} 个代币):`);
    console.log(`  平均涨幅: ${avgChange.toFixed(1)}%`);
    console.log(`  高涨幅占比: ${(highReturnRate * 100).toFixed(1)}%\n`);
  });
}

/**
 * 指标3: 买卖转换次数（波动性指标）
 */
function buySellTransitionCount(sequences) {
  console.log('【指标3: 买卖转换次数（前30笔）】\n');

  const results = sequences.map(seq => {
    const first30 = seq.sequence.slice(0, 30);
    let transitions = 0;
    let lastWasBuy = null;

    first30.forEach(([, amount]) => {
      const isBuy = amount > 0;
      if (lastWasBuy !== null && lastWasBuy !== isBuy) {
        transitions++;
      }
      lastWasBuy = isBuy;
    });

    return {
      symbol: seq.token_symbol,
      change: seq.max_change_percent,
      transitions
    };
  });

  // 按转换次数分组
  const groups = {
    '低波动 (0-5次)': [],
    '中波动 (5-15次)': [],
    '高波动 (>15次)': []
  };

  results.forEach(r => {
    if (r.transitions <= 5) {
      groups['低波动 (0-5次)'].push(r);
    } else if (r.transitions <= 15) {
      groups['中波动 (5-15次)'].push(r);
    } else {
      groups['高波动 (>15次)'].push(r);
    }
  });

  Object.entries(groups).forEach(([name, tokens]) => {
    if (tokens.length === 0) return;
    const avgChange = tokens.reduce((sum, t) => sum + t.change, 0) / tokens.length;
    const highReturnRate = tokens.filter(t => t.change >= 100).length / tokens.length;

    console.log(`${name}: ${tokens.length} 个代币`);
    console.log(`  平均涨幅: ${avgChange.toFixed(1)}%`);
    console.log(`  高涨幅占比: ${(highReturnRate * 100).toFixed(1)}%\n`);
  });
}

/**
 * 指标4: 早期是否有"纯买入段"（连续>=5笔买入）
 */
function hasPureBuySegment(sequences) {
  console.log('【指标4: 早期是否有纯买入段】\n');

  const results = sequences.map(seq => {
    const first20 = seq.sequence.slice(0, 20);
    let maxConsecutiveBuys = 0;
    let currentStreak = 0;

    first20.forEach(([, amount]) => {
      if (amount > 0) {
        currentStreak++;
        maxConsecutiveBuys = Math.max(maxConsecutiveBuys, currentStreak);
      } else {
        currentStreak = 0;
      }
    });

    return {
      symbol: seq.token_symbol,
      change: seq.max_change_percent,
      has_pure_buy_segment: maxConsecutiveBuys >= 5,
      max_consecutive: maxConsecutiveBuys
    };
  });

  const withPureBuy = results.filter(r => r.has_pure_buy_segment);
  const withoutPureBuy = results.filter(r => !r.has_pure_buy_segment);

  console.log(`有纯买入段（连续>=5笔）: ${withPureBuy.length} 个代币`);
  console.log(`  平均涨幅: ${withPureBuy.reduce((sum, t) => sum + t.change, 0) / withPureBuy.length}%)`);
  console.log(`  高涨幅占比: ${withPureBuy.filter(t => t.change >= 100).length / withPureBuy.length * 100}%`);

  console.log(`\n无纯买入段: ${withoutPureBuy.length} 个代币`);
  console.log(`  平均涨幅: ${withoutPureBuy.reduce((sum, t) => sum + t.change, 0) / withoutPureBuy.length}%`);
  console.log(`  高涨幅占比: ${withoutPureBuy.filter(t => t.change >= 100).length / withoutPureBuy.length * 100}%`);
}

async function main() {
  const sequences = loadSequences();
  console.log(`✓ 读取 ${sequences.length} 个代币序列\n`);

  earlyBuyIntensity(sequences);
  firstTenTradesPattern(sequences);
  buySellTransitionCount(sequences);
  hasPureBuySegment(sequences);

  console.log('========================================');
  console.log('分析完成');
  console.log('========================================\n');
}

main().catch(err => {
  console.error('失败:', err);
  process.exit(1);
});
