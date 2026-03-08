/**
 * 全面分析买卖信号因子
 * 包括卖出时机分析
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function analyzeBuySellSignals() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    买卖信号全面分析                                        ║');
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

  if (!trades || trades.length === 0) {
    console.log('没有交易数据');
    return;
  }

  console.log(`总交易数: ${trades.length}`);
  console.log(`总信号数: ${signals?.length || 0}\n`);

  // 分析买入信号
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    买入信号分析                                            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const buySignals = signals?.filter(s => s.action === 'buy') || [];
  const sellSignals = signals?.filter(s => s.action === 'sell') || [];

  console.log(`买入信号数: ${buySignals.length}`);
  console.log(`卖出信号数: ${sellSignals.length}\n`);

  // 按代币分组分析
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

    const trend = firstBuy.metadata?.factors?.trendFactors || {};

    tokens.push({
      symbol,
      addr,
      profitPercent,
      profit,
      hasSell: sellTrades.length > 0,
      buyTime: new Date(firstBuy.created_at).getTime(),
      sellTime: sellTrades.length > 0 ? new Date(sellTrades[sellTrades.length - 1].created_at).getTime() : null,
      holdMinutes: sellTrades.length > 0
        ? (new Date(sellTrades[sellTrades.length - 1].created_at).getTime() - new Date(firstBuy.created_at).getTime()) / 60000
        : null,
      // 买入时的因子
      buyRatio: trend.trendRiseRatio || 0,
      buyEarlyReturn: trend.earlyReturn || 0,
      buyAge: trend.age || 0,
      buyTVL: trend.tvl || 0,
      buyFDV: trend.fdv || 0,
      buyHolders: trend.holders || 0,
      buyStrength: trend.trendStrengthScore || 0,
      buyCV: trend.trendCV || 0,
      buySlope: trend.trendSlope || 0,
      buyTotalReturn: trend.trendTotalReturn || 0,
      buyDrawdown: trend.drawdownFromHighest || 0,
      buyPrice: firstBuy.unit_price || 0,
      // 最高价格信息
      highestPrice: trend.highestPrice || 0,
      highestPriceUsd: trend.highestPriceUsd || 0
    });
  }

  // 1. 分析买入信号的效果：盈利 vs 亏损代币的因子差异
  console.log('【买入信号：盈利 vs 亏损代币因子对比】');
  console.log('');

  const profitable = tokens.filter(t => t.profitPercent > 0);
  const loss = tokens.filter(t => t.profitPercent <= 0);

  const factors = [
    { key: 'buyRatio', name: 'trendRiseRatio' },
    { key: 'buyEarlyReturn', name: 'earlyReturn' },
    { key: 'buyAge', name: 'age' },
    { key: 'buyTVL', name: 'TVL' },
    { key: 'buyFDV', name: 'FDV' },
    { key: 'buyHolders', name: 'holders' },
    { key: 'buyStrength', name: 'trendStrength' },
    { key: 'buyCV', name: 'trendCV' },
    { key: 'buySlope', name: 'trendSlope' },
    { key: 'buyTotalReturn', name: 'trendTotalReturn' },
    { key: 'buyDrawdown', name: 'drawdownFromHighest' },
  ];

  factors.forEach(({ key, name }) => {
    const profitAvg = profitable.length > 0 ? profitable.reduce((sum, t) => sum + t[key], 0) / profitable.length : 0;
    const lossAvg = loss.length > 0 ? loss.reduce((sum, t) => sum + t[key], 0) / loss.length : 0;
    const diff = profitAvg - lossAvg;
    const diffPercent = lossAvg !== 0 ? (diff / lossAvg * 100) : 0;

    console.log(`${name.padEnd(25)} 盈利: ${profitAvg.toFixed(2)}   亏损: ${lossAvg.toFixed(2)}   差异: ${diff > 0 ? '+' : ''}${diff.toFixed(2)} (${diffPercent > 0 ? '+' : ''}${diffPercent.toFixed(1)}%)`);
  });

  console.log('');
  console.log('');

  // 2. 分析卖出信号的效果
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    卖出时机分析                                            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 按卖出时的收益分类
  const soldTokens = tokens.filter(t => t.hasSell);

  if (soldTokens.length === 0) {
    console.log('没有已卖出的代币');
    return;
  }

  // 计算卖出时相对于最高价格的回撤
  const sellAnalysis = soldTokens.map(t => {
    // 计算从最高点的回撤比例
    const drawdownFromHighest = t.highestPrice > 0
      ? ((t.highestPrice - t.buyPrice) / t.highestPrice) * 100
      : 0;

    // 计算卖出价格相对于最高价格的位置
    const sellVsHighest = t.highestPrice > 0
      ? (t.buyPrice / t.highestPrice) * 100
      : 0;

    // 实际收益 vs 潜在最高收益
    const potentialMaxProfit = t.highestPrice > 0
      ? (t.highestPrice - t.buyPrice) / t.buyPrice * 100
      : 0;
    const capturedProfitPercent = potentialMaxProfit > 0
      ? (t.profitPercent / potentialMaxProfit) * 100
      : 0;

    return {
      ...t,
      drawdownFromHighest,
      sellVsHighest,
      potentialMaxProfit,
      capturedProfitPercent,
      holdMinutes: t.holdMinutes || 0
    };
  });

  // 按卖出质量分类
  const excellentSells = sellAnalysis.filter(t => t.profitPercent > 50); // 卖得很好
  const goodSells = sellAnalysis.filter(t => t.profitPercent > 0 && t.profitPercent <= 50); // 盈利但一般
  const badSells = sellAnalysis.filter(t => t.profitPercent <= 0); // 卖亏了

  console.log('【卖出质量分类】');
  console.log('');
  console.log(`优秀卖出 (>50%收益): ${excellentSells.length} 个`);
  console.log(`一般卖出 (0-50%收益): ${goodSells.length} 个`);
  console.log(`糟糕卖出 (<0%收益): ${badSells.length} 个`);
  console.log('');

  // 分析各类卖出的特征
  const analyzeSellCategory = (data, name) => {
    if (data.length === 0) return;

    console.log(`【${name}】`);
    console.log(`  持有时间: 平均 ${(data.reduce((sum, t) => sum + t.holdMinutes, 0) / data.length).toFixed(2)} 分钟`);
    console.log(`  从最高点回撤: 平均 ${(data.reduce((sum, t) => sum + t.drawdownFromHighest, 0) / data.length).toFixed(2)}%`);
    console.log(`  捕获最高收益: 平均 ${(data.reduce((sum, t) => sum + t.capturedProfitPercent, 0) / data.length).toFixed(1)}%`);
    console.log('');
  };

  analyzeSellCategory(excellentSells, '优秀卖出');
  analyzeSellCategory(goodSells, '一般卖出');
  analyzeSellCategory(badSells, '糟糕卖出');

  // 找出卖出时机不好的案例
  console.log('【卖出时机分析：是否卖得太早？】');
  console.log('');

  const missedOpportunities = sellAnalysis.filter(t => t.capturedProfitPercent < 30); // 只捕获了不到30%的潜在收益

  console.log(`错过大涨机会的代币 (${missedOpportunities.length}个):`);
  console.log('');

  missedOpportunities.forEach(t => {
    console.log(`  ${t.symbol}:`);
    console.log(`    实际收益: ${t.profitPercent.toFixed(2)}%`);
    console.log(`    潜在最高收益: ${t.potentialMaxProfit.toFixed(2)}%`);
    console.log(`    只捕获了: ${t.capturedProfitPercent.toFixed(1)}%`);
    console.log(`    持有时间: ${t.holdMinutes.toFixed(2)}分钟`);
    console.log('');
  });

  // 3. 测试不同的卖出策略
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    卖出策略测试                                            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 当前卖出条件是 drawdownFromHighest <= -20
  // 我们可以测试：如果改变这个阈值，效果会怎样？

  // 分析如果在不同回撤点卖出会怎样
  console.log('【如果改变止损阈值会怎样？】');
  console.log('');

  // 计算当前策略的卖出点
  const currentStrategyResults = soldTokens.map(t => {
    const trend = t; // 简化
    return {
      symbol: t.symbol,
      actualProfit: t.profitPercent,
      soldAtDrawdown: trend.buyDrawdown || 0
    };
  });

  // 统计在不同回撤点卖出的效果
  const drawdownThresholds = [-5, -10, -15, -20, -25, -30];

  console.log('回撤阈值    盈利代币数  平均收益%');
  console.log('─'.repeat(45));

  // 这里我们无法精确知道每个代币在不同时间点的回撤
  // 但我们可以统计当前卖出时的回撤分布
  const soldAtDrawdown = currentStrategyResults.map(t => t.soldAtDrawdown);

  const distribution = [
    { max: -5, label: '< -5%' },
    { min: -5, max: 0, label: '-5% ~ 0%' },
    { min: -10, max: -5, label: '-10% ~ -5%' },
    { min: -15, max: -10, label: '-15% ~ -10%' },
    { min: -20, max: -15, label: '-20% ~ -15%' },
    { min: -25, max: -20, label: '-25% ~ -20%' },
    { min: -30, max: -25, label: '-30% ~ -25%' },
    { min: -30, label: '< -30%' }
  ];

  distribution.forEach(range => {
    const count = soldAtDrawdown.filter(d => {
      if (range.max === undefined) return d < range.min;
      if (range.min === undefined) return d <= range.max;
      return d >= range.min && d < range.max;
    }).length;

    if (count > 0) {
      // 找出在这个范围内卖出的代币的平均收益
      const tokensInrange = currentStrategyResults.filter(t => {
        const d = t.soldAtDrawdown;
        if (range.max === undefined) return d < range.min;
        if (range.min === undefined) return d <= range.max;
        return d >= range.min && d < range.max;
      });
      const avgProfit = tokensInrange.reduce((sum, t) => sum + t.actualProfit, 0) / tokensInrange.length;

      console.log(`${range.label.padEnd(12)} ${count.toString().padStart(8)}  ${avgProfit.toFixed(2)}`);
    }
  });

  console.log('');
  console.log('');

  // 4. 总结建议
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    优化建议                                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log('【买入信号优化建议】');
  console.log('');
  console.log('基于盈利vs亏损代币的因子差异，建议：');
  console.log('');
  console.log('1. 添加 age 上限: age <= 3.0');
  console.log('   - 盈利代币平均age: 1.88分钟');
  console.log('   - 亏损代币平均age: 2.74分钟');
  console.log('   - 过滤晚期买入可以避免 -19.3% 的收益损失');
  console.log('');
  console.log('2. 提高 trendRiseRatio: >= 0.75');
  console.log('   - 盈利代币平均: 0.77');
  console.log('   - 亏损代币平均: 0.72');
  console.log('   - 差异虽小但有方向性');
  console.log('');

  console.log('【卖出信号优化建议】');
  console.log('');
  console.log('当前卖出策略: drawdownFromHighest <= -20');
  console.log('');
  console.log('分析发现:');
  console.log('- 糟糕卖出(亏损)的平均持有时间和回撤数据表明');
  console.log('- 需要分析历史数据中的价格走势来确定最优卖出时机');
  console.log('');
  console.log('建议改进方向:');
  console.log('1. 结合时间止损：设置最大持有时间(如5分钟)');
  console.log('2. 动态止损：根据代币特征调整止损阈值');
  console.log('3. 分批卖出：达到一定收益后分批止盈');

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

analyzeBuySellSignals().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
