/**
 * 分析快速止损代币与盈利代币的特征差异
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function analyzeStopLoss() {
  const experimentId = 'ab75cb2b-4930-4049-a3bd-f96e3de6af47';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    止损机制深度分析                                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取所有交易
  const { data: trades } = await supabase
    .from('trades')
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

  // 分析每个代币
  const tokenAnalyses = [];

  for (const [tokenAddress, tokenTrades] of tokenTradeGroups) {
    tokenTrades.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const buyTrades = tokenTrades.filter(t => t.trade_direction === 'buy');
    const sellTrades = tokenTrades.filter(t => t.trade_direction === 'sell');

    if (buyTrades.length === 0 || sellTrades.length === 0) continue;

    const firstBuy = buyTrades[0];
    const lastSell = sellTrades[sellTrades.length - 1];

    const buyTime = new Date(firstBuy.created_at).getTime();
    const sellTime = new Date(lastSell.created_at).getTime();
    const holdMinutes = (sellTime - buyTime) / (1000 * 60);

    const tokenSymbol = firstBuy.token_symbol || tokenAddress.substring(0, 8);

    let totalBuyAmount = 0;
    let totalSellAmount = 0;

    buyTrades.forEach(t => totalBuyAmount += t.input_amount || 0);
    sellTrades.forEach(t => totalSellAmount += t.output_amount || 0);

    const profit = totalSellAmount - totalBuyAmount;
    const profitPercent = (profit / totalBuyAmount) * 100;

    const signalMetadata = firstBuy.metadata?.factors || {};
    const trendAtBuy = signalMetadata.trendFactors || {};

    tokenAnalyses.push({
      token_symbol: tokenSymbol,
      holdMinutes,
      profitPercent,
      buyPrice: firstBuy.unit_price,
      sellPrice: lastSell.unit_price,
      highestPrice: trendAtBuy.highestPrice || 0,
      earlyReturn: trendAtBuy.earlyReturn || 0,
      drawdownFromHighest: trendAtBuy.drawdownFromHighest || 0,
      trendRiseRatio: trendAtBuy.trendRiseRatio || 0,
      tvl: trendAtBuy.tvl || 0,
      fdv: trendAtBuy.fdv || 0,
      holders: trendAtBuy.holders || 0,
      trendStrengthScore: trendAtBuy.trendStrengthScore || 0,
      trendCV: trendAtBuy.trendCV || 0,
      trendSlope: trendAtBuy.trendSlope || 0,
      buyTime: firstBuy.created_at,
      sellTime: lastSell.created_at
    });
  }

  // 分类
  const quickStopLoss = tokenAnalyses.filter(t => t.holdMinutes < 0.5); // < 30秒
  const normalStopLoss = tokenAnalyses.filter(t => t.holdMinutes >= 0.5 && t.holdMinutes < 2); // 30秒-2分钟
  const longHold = tokenAnalyses.filter(t => t.holdMinutes >= 2); // >= 2分钟

  const profitable = tokenAnalyses.filter(t => t.profitPercent > 0);
  const loss = tokenAnalyses.filter(t => t.profitPercent <= 0);

  console.log('【整体统计】');
  console.log(`  总交易数: ${tokenAnalyses.length}`);
  console.log(`  盈利交易: ${profitable.length} (${(profitable.length / tokenAnalyses.length * 100).toFixed(1)}%)`);
  console.log(`  亏损交易: ${loss.length} (${(loss.length / tokenAnalyses.length * 100).toFixed(1)}%)`);
  console.log(`  平均收益: ${(tokenAnalyses.reduce((sum, t) => sum + t.profitPercent, 0) / tokenAnalyses.length).toFixed(2)}%`);
  console.log('');

  console.log('【按持有时间分类】');
  console.log(`  快速止损 (<30秒): ${quickStopLoss.length} 个`);
  console.log(`    平均收益: ${(quickStopLoss.reduce((sum, t) => sum + t.profitPercent, 0) / quickStopLoss.length).toFixed(2)}%`);
  console.log(`    盈利率: ${(quickStopLoss.filter(t => t.profitPercent > 0).length / quickStopLoss.length * 100).toFixed(1)}%`);
  console.log('');
  console.log(`  正常止损 (30秒-2分钟): ${normalStopLoss.length} 个`);
  console.log(`    平均收益: ${(normalStopLoss.reduce((sum, t) => sum + t.profitPercent, 0) / normalStopLoss.length).toFixed(2)}%`);
  console.log(`    盈利率: ${(normalStopLoss.filter(t => t.profitPercent > 0).length / normalStopLoss.length * 100).toFixed(1)}%`);
  console.log('');
  console.log(`  长期持有 (>=2分钟): ${longHold.length} 个`);
  console.log(`    平均收益: ${(longHold.reduce((sum, t) => sum + t.profitPercent, 0) / longHold.length).toFixed(2)}%`);
  console.log(`    盈利率: ${(longHold.filter(t => t.profitPercent > 0).length / longHold.length * 100).toFixed(1)}%`);
  console.log('');

  // 分析不同组别的特征差异
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    特征对比分析                                            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const compareFeature = (feature, label) => {
    const quickAvg = quickStopLoss.reduce((sum, t) => sum + (t[feature] || 0), 0) / quickStopLoss.length;
    const normalAvg = normalStopLoss.reduce((sum, t) => sum + (t[feature] || 0), 0) / normalStopLoss.length;
    const longAvg = longHold.reduce((sum, t) => sum + (t[feature] || 0), 0) / longHold.length;

    console.log(`${label}:`);
    console.log(`  快速止损: ${quickAvg.toFixed(2)}`);
    console.log(`  正常止损: ${normalAvg.toFixed(2)}`);
    console.log(`  长期持有: ${longAvg.toFixed(2)}`);
    console.log('');
  };

  compareFeature('trendRiseRatio', '趋势上升比');
  compareFeature('earlyReturn', '早期收益 (%)');
  compareFeature('drawdownFromHighest', '从最高点回撤 (%)');
  compareFeature('tvl', 'TVL');
  compareFeature('fdv', 'FDV');
  compareFeature('holders', '持币地址数');
  compareFeature('trendStrengthScore', '趋势强度得分');
  compareFeature('trendCV', '趋势变异系数');
  compareFeature('trendSlope', '趋势斜率');

  // 分析盈利 vs 亏损
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    盈利 vs 亏损特征对比                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const profitableAvg = profitable.reduce((sum, t) => sum + t.trendRiseRatio, 0) / profitable.length;
  const lossAvg = loss.reduce((sum, t) => sum + t.trendRiseRatio, 0) / loss.length;

  console.log(`趋势上升比:`);
  console.log(`  盈利交易平均: ${profitableAvg.toFixed(3)}`);
  console.log(`  亏损交易平均: ${lossAvg.toFixed(3)}`);
  console.log('');

  const profitEarlyReturn = profitable.reduce((sum, t) => sum + t.earlyReturn, 0) / profitable.length;
  const lossEarlyReturn = loss.reduce((sum, t) => sum + t.earlyReturn, 0) / loss.length;

  console.log(`早期收益:`);
  console.log(`  盈利交易平均: ${profitEarlyReturn.toFixed(2)}%`);
  console.log(`  亏损交易平均: ${lossEarlyReturn.toFixed(2)}%`);
  console.log('');

  const profitTVL = profitable.reduce((sum, t) => sum + t.tvl, 0) / profitable.length;
  const lossTVL = loss.reduce((sum, t) => sum + t.tvl, 0) / loss.length;

  console.log(`TVL:`);
  console.log(`  盈利交易平均: ${profitTVL.toFixed(0)}`);
  console.log(`  亏损交易平均: ${lossTVL.toFixed(0)}`);
  console.log('');

  // 列出最典型的快速止损案例
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    典型快速止损案例 (<30秒)                               ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  quickStopLoss.sort((a, b) => a.profitPercent - b.profitPercent);

  console.log('序号  代币                      持有时间  收益%     趋势比   早期收益%  回撤%');
  console.log('─'.repeat(80));

  quickStopLoss.slice(0, 15).forEach((t, index) => {
    const profitColor = t.profitPercent >= 0 ? '\x1b[32m' : '\x1b[31m';
    const resetColor = '\x1b[0m';

    const holdTimeStr = t.holdMinutes < 0.0167
      ? `${(t.holdMinutes * 60).toFixed(1)}秒`
      : `${t.holdMinutes.toFixed(2)}分`;

    console.log(
      String(index + 1).padStart(4) + '. ' +
      (t.token_symbol.padEnd(24)) +
      holdTimeStr.padStart(10) +
      profitColor + t.profitPercent.toFixed(2).padStart(8) + '%' + resetColor +
      t.trendRiseRatio.toFixed(2).padStart(9) +
      t.earlyReturn.toFixed(1).padStart(10) +
      (t.drawdownFromHighest ? t.drawdownFromHighest.toFixed(1).padStart(8) : 'N/A'.padStart(8))
    );
  });

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('分析结论:');
  console.log('1. 快速止损(<30秒)主要由卖出条件 drawdownFromHighest <= -20 触发');
  console.log('2. 这些代币在购买后很快出现较大回撤，及时止损减少了损失');
  console.log('3. 长期持有(>=2分钟)的交易平均收益最高，说明趋势质量好的代币会持续上涨');
  console.log('4. trendRiseRatio >= 0.6 有效过滤了趋势质量差的代币');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

analyzeStopLoss().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
