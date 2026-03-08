/**
 * 动态止损策略回测
 * 模拟不同止损策略的效果
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

// 定义不同的动态止损策略
const stopLossStrategies = {
  // 固定止损基线
  fixed_minus20: {
    name: '固定止损 -20%',
    getStopLoss: (token, holdMinutes, highestPrice) => token.buyPrice * 0.80
  },

  fixed_minus25: {
    name: '固定止损 -25%',
    getStopLoss: (token, holdMinutes, highestPrice) => token.buyPrice * 0.75
  },

  fixed_minus15: {
    name: '固定止损 -15%',
    getStopLoss: (token, holdMinutes, highestPrice) => token.buyPrice * 0.85
  },

  // 两阶段动态止损
  two_phase_2min: {
    name: '两阶段: 2分钟前-25%, 2分钟后-20%',
    getStopLoss: (token, holdMinutes, highestPrice) => {
      return holdMinutes < 2 ? token.buyPrice * 0.75 : token.buyPrice * 0.80;
    }
  },

  two_phase_3min: {
    name: '两阶段: 3分钟前-25%, 3分钟后-15%',
    getStopLoss: (token, holdMinutes, highestPrice) => {
      return holdMinutes < 3 ? token.buyPrice * 0.75 : token.buyPrice * 0.85;
    }
  },

  // 三阶段动态止损
  three_phase_2_5_10: {
    name: '三阶段: <2min:-25%, 2-5min:-20%, ≥5min:-15%',
    getStopLoss: (token, holdMinutes, highestPrice) => {
      if (holdMinutes < 2) return token.buyPrice * 0.75;
      if (holdMinutes < 5) return token.buyPrice * 0.80;
      return token.buyPrice * 0.85;
    }
  },

  three_phase_3_5_10: {
    name: '三阶段: <3min:-25%, 3-5min:-20%, ≥5min:-15%',
    getStopLoss: (token, holdMinutes, highestPrice) => {
      if (holdMinutes < 3) return token.buyPrice * 0.75;
      if (holdMinutes < 5) return token.buyPrice * 0.80;
      return token.buyPrice * 0.85;
    }
  },

  // 追踪止损
  trailing_5min_10pct: {
    name: '追踪止损: ≥5分钟追踪-10%',
    getStopLoss: (token, holdMinutes, highestPrice) => {
      if (holdMinutes < 5) return token.buyPrice * 0.75;
      return Math.max(token.buyPrice * 0.80, highestPrice * 0.90);
    }
  },

  trailing_3min_10pct: {
    name: '追踪止损: ≥3分钟追踪-10%',
    getStopLoss: (token, holdMinutes, highestPrice) => {
      if (holdMinutes < 3) return token.buyPrice * 0.75;
      return Math.max(token.buyPrice * 0.80, highestPrice * 0.90);
    }
  },

  // 激进策略
  aggressive_3min: {
    name: '激进: <3min:-30%, ≥3min:-15%',
    getStopLoss: (token, holdMinutes, highestPrice) => {
      return holdMinutes < 3 ? token.buyPrice * 0.70 : token.buyPrice * 0.85;
    }
  },

  // 保守策略
  conservative: {
    name: '保守: 始终-10%',
    getStopLoss: (token, holdMinutes, highestPrice) => {
      return token.buyPrice * 0.90;
    }
  },

  // 最优策略（基于数据分析）
  optimal_2_5: {
    name: '最优: <2min:-25%, 2-5min:-20%, ≥5min追踪-10%',
    getStopLoss: (token, holdMinutes, highestPrice) => {
      if (holdMinutes < 2) return token.buyPrice * 0.75;
      if (holdMinutes < 5) return token.buyPrice * 0.80;
      return Math.max(token.buyPrice * 0.85, highestPrice * 0.90);
    }
  }
};

async function backtestStrategy(token, strategy, priceHistory) {
  const buyPrice = token.buyPrice;
  let highestPrice = buyPrice;
  let stopLoss = strategy.getStopLoss(token, 0, highestPrice);
  let sold = false;
  let sellPrice = null;
  let sellTime = null;
  let sellReason = null;

  // 模拟每个时间点
  for (let i = 0; i < priceHistory.length; i++) {
    const point = priceHistory[i];
    const currentPrice = point.price;
    const holdMinutes = point.minutes;

    // 更新最高价
    if (currentPrice > highestPrice) {
      highestPrice = currentPrice;
    }

    // 计算新的止损价
    const newStopLoss = strategy.getStopLoss(
      { ...token, buyPrice },
      holdMinutes,
      highestPrice
    );

    // 止损价只能向上调整（追踪止损）
    stopLoss = Math.max(stopLoss, newStopLoss);

    // 检查是否触发止损
    if (currentPrice <= stopLoss) {
      sold = true;
      sellPrice = stopLoss; // 假设在止损价卖出
      sellTime = holdMinutes;
      sellReason = 'stop_loss';
      break;
    }

    // 检查是否达到观察期结束（30分钟）
    if (holdMinutes >= 30) {
      sold = true;
      sellPrice = currentPrice;
      sellTime = holdMinutes;
      sellReason = 'timeout';
      break;
    }
  }

  // 如果没有卖出，使用最后的价格
  if (!sold && priceHistory.length > 0) {
    sellPrice = priceHistory[priceHistory.length - 1].price;
    sellTime = priceHistory[priceHistory.length - 1].minutes;
    sellReason = 'end_of_data';
  }

  const profitPercent = ((sellPrice - buyPrice) / buyPrice) * 100;

  return {
    sold,
    sellPrice,
    sellTime,
    sellReason,
    profitPercent,
    stopLoss
  };
}

async function main() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    动态止损策略回测                                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取交易数据
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  // 简化处理：使用实际交易数据模拟
  const tokenTradeGroups = new Map();
  trades.forEach(trade => {
    if (!tokenTradeGroups.has(trade.token_address)) {
      tokenTradeGroups.set(trade.token_address, []);
    }
    tokenTradeGroups.get(trade.token_address).push(trade);
  });

  const tokens = [];
  for (const [addr, tokenTrades] of tokenTradeGroups) {
    tokenTrades.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const buyTrades = tokenTrades.filter(t => t.trade_direction === 'buy');
    const sellTrades = tokenTrades.filter(t => t.trade_direction === 'sell');

    if (buyTrades.length === 0 || sellTrades.length === 0) continue;

    const firstBuy = buyTrades[0];
    const lastSell = sellTrades[sellTrades.length - 1];
    const buyTime = new Date(firstBuy.created_at).getTime();
    const sellTime = new Date(lastSell.created_at).getTime();
    const holdMinutes = (sellTime - buyTime) / 60000;

    let totalBuy = 0, totalSell = 0;
    buyTrades.forEach(t => totalBuy += t.input_amount || 0);
    sellTrades.forEach(t => totalSell += t.output_amount || 0);
    const profitPercent = ((totalSell - totalBuy) / totalBuy) * 100;

    const trend = firstBuy.metadata?.factors?.trendFactors || {};

    tokens.push({
      symbol: firstBuy.token_symbol,
      buyPrice: firstBuy.unit_price || 0,
      sellPrice: lastSell.unit_price || 0,
      holdMinutes,
      profitPercent,
      highestPrice: trend.highestPrice || 0
    });
  }

  console.log(`测试代币数: ${tokens.length}\n`);

  // 对每个策略进行回测
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    策略回测结果                                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log('策略                                      总收益%   平均收益%   胜率   卖出数');
  console.log('─'.repeat(80));

  const results = [];

  for (const [key, strategy] of Object.entries(stopLossStrategies)) {
    let totalProfit = 0;
    let winCount = 0;
    let sellCount = 0;

    tokens.forEach(token => {
      // 简化模拟：使用实际数据判断
      const stopLoss = strategy.getStopLoss(token, token.holdMinutes || 3, token.highestPrice || token.buyPrice);
      const actualSellPrice = token.sellPrice;

      // 如果实际卖出价低于止损价，假设会在止损点卖出
      const simulatedSellPrice = Math.min(actualSellPrice, stopLoss);
      const simulatedProfit = ((simulatedSellPrice - token.buyPrice) / token.buyPrice) * 100;

      totalProfit += simulatedProfit;
      if (simulatedProfit > 0) winCount++;
      sellCount++;
    });

    const avgProfit = totalProfit / tokens.length;
    const winRate = (winCount / sellCount * 100);

    results.push({
      name: strategy.name,
      totalProfit,
      avgProfit,
      winRate,
      sellCount
    });
  }

  // 按总收益排序
  results.sort((a, b) => b.totalProfit - a.totalProfit);

  results.forEach((r, i) => {
    const color = i === 0 ? '\x1b[32m' : r.totalProfit > 0 ? '\x1b[36m' : '\x1b[31m';
    const reset = '\x1b[0m';
    const badge = i === 0 ? ' 👑' : '';

    console.log(`${color}${r.name.padEnd(40)}${r.totalProfit.toFixed(2).padStart(8)}${reset}   ${r.avgProfit.toFixed(2).padStart(8)}  ${r.winRate.toFixed(1).padStart(5)}%  ${r.sellCount}${badge}`);
  });

  console.log('');
  console.log('');

  // 对比分析
  const bestStrategy = results[0];
  const baseline = results.find(r => r.name.includes('固定止损 -20%'));

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    策略对比分析                                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  if (baseline && bestStrategy) {
    const improvement = ((bestStrategy.totalProfit - baseline.totalProfit) / Math.abs(baseline.totalProfit) * 100);

    console.log('【基线策略】');
    console.log(`  ${baseline.name}`);
    console.log(`  总收益: ${baseline.totalProfit.toFixed(2)}%`);
    console.log(`  胜率: ${baseline.winRate.toFixed(1)}%`);
    console.log('');

    console.log('【最优策略】');
    console.log(`  ${bestStrategy.name}`);
    console.log(`  总收益: ${bestStrategy.totalProfit.toFixed(2)}%`);
    console.log(`  胜率: ${bestStrategy.winRate.toFixed(1)}%`);
    console.log('');

    console.log('【改善效果】');
    const color = improvement > 0 ? '\x1b[32m' : '\x1b[31m';
    const reset = '\x1b[0m';
    console.log(`  收益提升: ${color}${improvement > 0 ? '+' : ''}${improvement.toFixed(1)}%${reset}`);
    console.log(`  胜率提升: ${color}${(bestStrategy.winRate - baseline.winRate).toFixed(1)}个百分点${reset}`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
