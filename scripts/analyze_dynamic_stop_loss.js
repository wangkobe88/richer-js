/**
 * 动态止损策略分析
 * 分析不同持有时间下的最佳止损阈值
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function analyzeDynamicStopLoss() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    动态止损策略分析                                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取交易数据
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  // 获取信号数据
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  // 按代币分组
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

    if (buyTrades.length === 0) continue;

    const firstBuy = buyTrades[0];
    const symbol = firstBuy.token_symbol;

    let totalBuy = 0, totalSell = 0;
    buyTrades.forEach(t => totalBuy += t.input_amount || 0);
    sellTrades.forEach(t => totalSell += t.output_amount || 0);

    const profit = totalSell - totalBuy;
    const profitPercent = (profit / totalBuy) * 100;

    const buyTime = new Date(firstBuy.created_at).getTime();
    const sellTime = sellTrades.length > 0
      ? new Date(sellTrades[sellTrades.length - 1].created_at).getTime()
      : null;
    const holdMinutes = sellTime ? (sellTime - buyTime) / 60000 : null;

    const trend = firstBuy.metadata?.factors?.trendFactors || {};

    // 获取卖出信号
    const tokenSignals = signals.filter(s => s.token_address === addr && s.action === 'sell');
    const sellSignal = tokenSignals.length > 0 ? tokenSignals[0] : null;

    tokens.push({
      symbol,
      addr,
      profitPercent,
      profit,
      hasSell: sellTrades.length > 0,
      holdMinutes,
      buyPrice: firstBuy.unit_price || 0,
      sellPrice: sellTrades.length > 0 ? (sellTrades[sellTrades.length - 1].unit_price || 0) : 0,
      highestPrice: trend.highestPrice || 0,
      sellSignalReason: sellSignal?.reason || null,
      // 买入时的因子
      buyRatio: trend.trendRiseRatio || 0,
      buyAge: trend.age || 0,
      buyCV: trend.trendCV || 0
    });
  }

  // 按持有时间分组分析
  console.log('【按持有时间分组分析】\n');

  const timeGroups = [
    { name: '短期 (<2分钟)', filter: t => t.holdMinutes && t.holdMinutes < 2 },
    { name: '中短期 (2-5分钟)', filter: t => t.holdMinutes && t.holdMinutes >= 2 && t.holdMinutes < 5 },
    { name: '中期 (5-10分钟)', filter: t => t.holdMinutes && t.holdMinutes >= 5 && t.holdMinutes < 10 },
    { name: '长期 (≥10分钟)', filter: t => t.holdMinutes && t.holdMinutes >= 10 }
  ];

  timeGroups.forEach(group => {
    const groupTokens = tokens.filter(group.filter);
    if (groupTokens.length === 0) return;

    const profitable = groupTokens.filter(t => t.profitPercent > 0);
    const avgProfit = groupTokens.reduce((sum, t) => sum + t.profitPercent, 0) / groupTokens.length;
    const avgHoldTime = groupTokens.reduce((sum, t) => sum + t.holdMinutes, 0) / groupTokens.length;

    console.log(`【${group.name}】(${groupTokens.length}个)`);
    console.log(`  胜率: ${(profitable.length / groupTokens.length * 100).toFixed(1)}%`);
    console.log(`  平均收益: ${avgProfit.toFixed(2)}%`);
    console.log(`  平均持有时间: ${avgHoldTime.toFixed(2)}分钟`);
    console.log('');
  });

  // 分析当前止损策略的效果
  console.log('【当前卖出策略分析】\n');

  const soldTokens = tokens.filter(t => t.hasSell);
  console.log(`已卖出代币: ${soldTokens.length}个`);

  // 分析不同持有时间下的最佳收益
  console.log('\n【不同持有时间点的收益分布】\n');

  // 对于每个已卖出的代币，计算如果在不同时间点卖出的收益
  // 这里简化处理，按实际持有时间分组
  const holdTimeBuckets = [1, 2, 3, 5, 7, 10, 15];

  console.log('持有时间阈值  该区间代币数  平均收益%  胜率');
  console.log('─'.repeat(50));

  let prevThreshold = 0;
  holdTimeBuckets.forEach(threshold => {
    const bucketTokens = soldTokens.filter(t =>
      t.holdMinutes && t.holdMinutes >= prevThreshold && t.holdMinutes < threshold
    );

    if (bucketTokens.length > 0) {
      const avgProfit = bucketTokens.reduce((sum, t) => sum + t.profitPercent, 0) / bucketTokens.length;
      const winCount = bucketTokens.filter(t => t.profitPercent > 0).length;
      const winRate = (winCount / bucketTokens.length * 100);

      console.log(`${prevThreshold}-${threshold}分钟      ${bucketTokens.length.toString().padStart(8)}  ${avgProfit.toFixed(2).padStart(8)}  ${winRate.toFixed(1)}%`);
    }

    prevThreshold = threshold;
  });

  // 最后一个区间
  const lastBucket = soldTokens.filter(t => t.holdMinutes && t.holdMinutes >= prevThreshold);
  if (lastBucket.length > 0) {
    const avgProfit = lastBucket.reduce((sum, t) => sum + t.profitPercent, 0) / lastBucket.length;
    const winCount = lastBucket.filter(t => t.profitPercent > 0).length;
    const winRate = (winCount / lastBucket.length * 100);

    console.log(`≥${prevThreshold}分钟      ${lastBucket.length.toString().padStart(8)}  ${avgProfit.toFixed(2).padStart(8)}  ${winRate.toFixed(1)}%`);
  }

  console.log('');
  console.log('');

  // 提出动态止损策略
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    动态止损策略建议                                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log('【策略一：三阶段动态止损】\n');
  console.log('持有时间区间    止损阈值      说明');
  console.log('─'.repeat(55));
  console.log('0-2分钟        -25%         给代币充分波动空间，避免过早止损');
  console.log('2-5分钟        -20%         逐步收紧止损，保护风险');
  console.log('5-10分钟       -15%         进一步收紧，锁定已有收益');
  console.log('≥10分钟        -10%         严格止损，避免长期持有风险');
  console.log('');

  console.log('【策略二：收益追踪动态止损】\n');
  console.log('持有时间区间    止损规则                              说明');
  console.log('─'.repeat(75));
  console.log('0-2分钟        max(-25%, buyPrice * 0.75)            宽松止损');
  console.log('2-5分钟        max(-20%, buyPrice * 0.80)            适度收紧');
  console.log('5-10分钟       max(-15%, highestPrice * 0.90)        追踪最高价');
  console.log('≥10分钟        max(-10%, highestPrice * 0.95)        严格追踪');
  console.log('');

  console.log('【策略三：分批止盈 + 动态止损】\n');
  console.log('收益达到        操作说明');
  console.log('─'.repeat(50));
  console.log('+30%           卖出30%，剩余70%继续持有');
  console.log('+50%           再卖出30%，剩余40%继续持有');
  console.log('+100%          再卖出20%，剩余20%继续持有');
  console.log('任何时间        回撤超过动态阈值则全部止损');
  console.log('');

  console.log('【动态止损阈值表】\n');
  console.log('持有时间    基础止损    追踪止损    触发条件');
  console.log('─'.repeat(55));
  console.log('0-2分钟     -25%        无          价格跌破买入价75%');
  console.log('2-5分钟     -20%        无          价格跌破买入价80%');
  console.log('5-10分钟    -15%        最高价-10%   价格从最高点回撤10%');
  console.log('≥10分钟     -10%        最高价-5%    价格从最高点回撤5%');
  console.log('');

  console.log('【实现伪代码】\n');
  console.log(`
function getDynamicStopLoss(token, holdMinutes) {
  const buyPrice = token.buyPrice;
  const highestPrice = token.highestPrice;
  const currentPrice = token.currentPrice;

  let stopLoss;

  if (holdMinutes < 2) {
    // 早期：宽松止损
    stopLoss = buyPrice * 0.75;
  } else if (holdMinutes < 5) {
    // 中早期：适度收紧
    stopLoss = buyPrice * 0.80;
  } else if (holdMinutes < 10) {
    // 中期：追踪止损
    stopLoss = Math.max(buyPrice * 0.85, highestPrice * 0.90);
  } else {
    // 长期：严格追踪
    stopLoss = Math.max(buyPrice * 0.90, highestPrice * 0.95);
  }

  return stopLoss;
}

// 检查是否应该止损
function shouldStopLoss(token) {
  const holdMinutes = (Date.now() - token.buyTime) / 60000;
  const stopLoss = getDynamicStopLoss(token, holdMinutes);
  return token.currentPrice <= stopLoss;
}
  `);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

analyzeDynamicStopLoss().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
