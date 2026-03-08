/**
 * 修正后的实验 543f039c 分析
 * 正确理解 input_amount 和 output_amount 的含义
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function analyzeExperiment() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    实验 543f039c 修正分析                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取所有交易
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  if (!trades || trades.length === 0) {
    console.log('没有交易记录');
    return;
  }

  console.log(`总交易记录数: ${trades.length}\n`);

  // 按代币分组
  const tokenTradeGroups = new Map();
  trades.forEach(trade => {
    if (!tokenTradeGroups.has(trade.token_address)) {
      tokenTradeGroups.set(trade.token_address, []);
    }
    tokenTradeGroups.get(trade.token_address).push(trade);
  });

  const tokenAnalyses = [];

  for (const [tokenAddress, tokenTrades] of tokenTradeGroups) {
    tokenTrades.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const buyTrades = tokenTrades.filter(t => t.trade_direction === 'buy');
    const sellTrades = tokenTrades.filter(t => t.trade_direction === 'sell');

    if (buyTrades.length === 0 || sellTrades.length === 0) continue;

    const firstBuy = buyTrades[0];
    const tokenSymbol = firstBuy.token_symbol || tokenAddress.substring(0, 8);

    // 正确计算：
    // 买入：input_amount 是花费的BNB，output_amount 是得到的代币数
    // 卖出：input_amount 是卖的代币数，output_amount 是得到的BNB
    let totalBuyAmount = 0;  // 花费的BNB
    let totalSellAmount = 0; // 收到的BNB

    buyTrades.forEach(t => {
      totalBuyAmount += t.input_amount || 0;  // BNB花费
    });

    sellTrades.forEach(t => {
      totalSellAmount += t.output_amount || 0; // BNB收入
    });

    const profit = totalSellAmount - totalBuyAmount;
    const profitPercent = (profit / totalBuyAmount) * 100;

    const signalMetadata = firstBuy.metadata?.factors || {};
    const trendAtBuy = signalMetadata.trendFactors || {};

    tokenAnalyses.push({
      token_symbol: tokenSymbol,
      profitPercent,
      profit,
      totalBuyAmount,
      totalSellAmount,
      trendRiseRatio: trendAtBuy.trendRiseRatio || 0,
      trendStrengthScore: trendAtBuy.trendStrengthScore || 0,
      tvl: trendAtBuy.tvl || 0,
      fdv: trendAtBuy.fdv || 0,
      holders: trendAtBuy.holders || 0,
      earlyReturn: trendAtBuy.earlyReturn || 0,
      drawdownFromHighest: trendAtBuy.drawdownFromHighest || 0,
      trendCV: trendAtBuy.trendCV || 0,
      trendSlope: trendAtBuy.trendSlope || 0,
      trendTotalReturn: trendAtBuy.trendTotalReturn || 0,
      age: trendAtBuy.age || 0
    });
  }

  // 按收益率排序
  tokenAnalyses.sort((a, b) => b.profitPercent - a.profitPercent);

  // 统计
  const profitable = tokenAnalyses.filter(t => t.profitPercent > 0);
  const loss = tokenAnalyses.filter(t => t.profitPercent < 0);

  console.log('【整体统计】');
  console.log(`  总代币数: ${tokenAnalyses.length}`);
  console.log(`  盈利: ${profitable.length} (${(profitable.length / tokenAnalyses.length * 100).toFixed(1)}%)`);
  console.log(`  亏损: ${loss.length}`);
  console.log('');

  const totalProfit = tokenAnalyses.reduce((sum, t) => sum + t.profit, 0);
  const avgProfit = tokenAnalyses.reduce((sum, t) => sum + t.profitPercent, 0) / tokenAnalyses.length;

  console.log(`  平均收益: ${avgProfit.toFixed(2)}%`);
  console.log(`  总收益: ${totalProfit.toFixed(4)} BNB`);
  console.log('');

  // 打印收益列表
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    代币收益列表                                            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log('序号  代币                      收益%     投入BNB  返回BNB   TVL    早期收益%  趋势比');
  console.log('─'.repeat(90));

  tokenAnalyses.forEach((t, index) => {
    const profitColor = t.profitPercent >= 0 ? '\x1b[32m' : '\x1b[31m';
    const resetColor = '\x1b[0m';

    console.log(
      String(index + 1).padStart(4) + '. ' +
      (t.token_symbol.padEnd(24)) +
      profitColor + t.profitPercent.toFixed(2).padStart(8) + '%' + resetColor +
      t.totalBuyAmount.toFixed(4).padStart(10) +
      t.totalSellAmount.toFixed(4).padStart(10) +
      t.tvl.toFixed(0).padStart(7) +
      t.earlyReturn.toFixed(1).padStart(10) +
      t.trendRiseRatio.toFixed(2).padStart(8)
    );
  });

  console.log('');

  // 盈利 vs 亏损特征对比
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    盈利 vs 亏损 特征对比                                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const compare = (feature, name, format = v => v.toFixed(2)) => {
    if (profitable.length === 0 || loss.length === 0) return;
    const profitAvg = profitable.reduce((sum, t) => sum + (t[feature] || 0), 0) / profitable.length;
    const lossAvg = loss.reduce((sum, t) => sum + (t[feature] || 0), 0) / loss.length;
    const diff = profitAvg - lossAvg;

    console.log(`${name}:`);
    console.log(`  盈利: ${format(profitAvg)},  亏损: ${format(lossAvg)}  差异: ${diff > 0 ? '+' : ''}${format(diff)}`);
  };

  compare('trendRiseRatio', '趋势上升比');
  compare('tvl', 'TVL', v => v.toFixed(0));
  compare('fdv', 'FDV', v => v.toFixed(0));
  compare('holders', '持币地址数', v => v.toFixed(0));
  compare('earlyReturn', '早期收益 (%)');
  compare('drawdownFromHighest', '从最高点回撤 (%)');
  compare('trendStrengthScore', '趋势强度得分');
  compare('trendCV', '趋势变异系数');
  compare('trendSlope', '趋势斜率');
  compare('trendTotalReturn', '趋势总收益 (%)');
  compare('age', '代币年龄 (分钟)');

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('分析完成');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

analyzeExperiment().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
