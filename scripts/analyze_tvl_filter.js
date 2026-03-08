/**
 * 分析添加 TVL >= 5000 条件后的效果
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function analyzeTVLFilter() {
  const experimentId = 'ab75cb2b-4930-4049-a3bd-f96e3de6af47';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    TVL >= 5000 过滤效果分析                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取所有购买信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .order('created_at', { ascending: true });

  if (!signals || signals.length === 0) {
    console.log('没有购买信号');
    return;
  }

  console.log(`【原始信号】总购买信号数: ${signals.length}\n`);

  // 分析每个信号的TVL
  const signalAnalysis = [];

  for (const signal of signals) {
    let metadata = signal.metadata;
    if (typeof metadata === 'string') {
      try {
        metadata = JSON.parse(metadata);
      } catch (e) {
        metadata = {};
      }
    }

    const trendFactors = metadata.factors?.trendFactors || {};
    const tvl = trendFactors.tvl || 0;

    // 检查是否执行了交易
    const { data: trades } = await supabase
      .from('trades')
      .select('*')
      .eq('signal_id', signal.id)
      .eq('trade_direction', 'buy')
      .limit(1);

    const executed = trades && trades.length > 0;

    // 如果执行了交易，获取收益数据
    let profitPercent = 0;
    let profitAmount = 0;
    let status = '未执行';

    if (executed) {
      // 获取该代币的所有交易
      const { data: allTrades } = await supabase
        .from('trades')
        .select('*')
        .eq('token_address', signal.token_address)
        .eq('experiment_id', experimentId);

      if (allTrades && allTrades.length > 0) {
        const buyTrades = allTrades.filter(t => t.trade_direction === 'buy');
        const sellTrades = allTrades.filter(t => t.trade_direction === 'sell');

        let totalBuyAmount = 0;
        let totalSellAmount = 0;

        buyTrades.forEach(t => totalBuyAmount += t.input_amount || 0);
        sellTrades.forEach(t => totalSellAmount += t.output_amount || 0);

        if (sellTrades.length > 0) {
          profitAmount = totalSellAmount - totalBuyAmount;
          profitPercent = (profitAmount / totalBuyAmount) * 100;
          status = profitPercent >= 0 ? '盈利' : '亏损';
        } else {
          status = '持仓中';
        }
      }
    }

    signalAnalysis.push({
      tokenSymbol: signal.symbol || signal.token_address?.substring(0, 8) || 'Unknown',
      tokenAddress: signal.token_address,
      signalId: signal.id,
      tvl,
      fdv: trendFactors.fdv || 0,
      holders: trendFactors.holders || 0,
      earlyReturn: trendFactors.earlyReturn || 0,
      trendRiseRatio: trendFactors.trendRiseRatio || 0,
      drawdownFromHighest: trendFactors.drawdownFromHighest || 0,
      passedTVLFilter: tvl >= 5000,
      executed,
      status,
      profitPercent,
      profitAmount
    });
  }

  // 统计
  const totalSignals = signalAnalysis.length;
  const passedTVL = signalAnalysis.filter(s => s.passedTVLFilter);
  const failedTVL = signalAnalysis.filter(s => !s.passedTVLFilter);

  console.log('【TVL过滤统计】');
  console.log(`  通过 TVL >= 5000: ${passedTVL.length} 个 (${(passedTVL.length / totalSignals * 100).toFixed(1)}%)`);
  console.log(`  未通过: ${failedTVL.length} 个 (${(failedTVL.length / totalSignals * 100).toFixed(1)}%)`);
  console.log('');

  // 分析执行情况
  const executedPassed = passedTVL.filter(s => s.executed);
  const executedFailed = failedTVL.filter(s => s.executed);

  console.log('【执行情况】');
  console.log(`  通过TVL且执行: ${executedPassed.length} 个`);
  console.log(`  未通过TVL但执行: ${executedFailed.length} 个`);
  console.log('');

  // 收益分析
  const profitablePassed = passedTVL.filter(s => s.profitPercent > 0);
  const lossPassed = passedTVL.filter(s => s.profitPercent < 0);
  const profitableFailed = failedTVL.filter(s => s.profitPercent > 0);
  const lossFailed = failedTVL.filter(s => s.profitPercent < 0);

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    收益对比                                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log('【通过 TVL >= 5000 的交易】');
  console.log(`  总交易数: ${executedPassed.length}`);
  console.log(`  盈利: ${profitablePassed.length}, 亏损: ${lossPassed.length}`);
  if (executedPassed.length > 0) {
    const avgProfit = executedPassed.reduce((sum, s) => sum + s.profitPercent, 0) / executedPassed.length;
    const totalProfit = executedPassed.reduce((sum, s) => sum + s.profitAmount, 0);
    const winRate = (profitablePassed.length / executedPassed.length * 100);
    console.log(`  平均收益: ${avgProfit.toFixed(2)}%`);
    console.log(`  总收益: ${totalProfit.toFixed(4)} BNB`);
    console.log(`  胜率: ${winRate.toFixed(1)}%`);
  }
  console.log('');

  console.log('【未通过 TVL < 5000 的交易】');
  console.log(`  总交易数: ${executedFailed.length}`);
  console.log(`  盈利: ${profitableFailed.length}, 亏损: ${lossFailed.length}`);
  if (executedFailed.length > 0) {
    const avgProfit = executedFailed.reduce((sum, s) => sum + s.profitPercent, 0) / executedFailed.length;
    const totalProfit = executedFailed.reduce((sum, s) => sum + s.profitAmount, 0);
    const winRate = (profitableFailed.length / executedFailed.length * 100);
    console.log(`  平均收益: ${avgProfit.toFixed(2)}%`);
    console.log(`  总收益: ${totalProfit.toFixed(4)} BNB`);
    console.log(`  胜率: ${winRate.toFixed(1)}%`);
  }
  console.log('');

  // 详细列表
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    未通过 TVL 过滤的代币详情                               ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const failedAndExecuted = failedTVL.filter(s => s.executed).sort((a, b) => a.profitPercent - b.profitPercent);

  console.log('序号  代币                      TVL     收益%     状态');
  console.log('─'.repeat(60));

  failedAndExecuted.forEach((s, index) => {
    const profitColor = s.profitPercent >= 0 ? '\x1b[32m' : '\x1b[31m';
    const resetColor = '\x1b[0m';

    console.log(
      String(index + 1).padStart(4) + '. ' +
      (s.tokenSymbol.padEnd(24)) +
      s.tvl.toFixed(0).padStart(8) +
      profitColor + s.profitPercent.toFixed(2).padStart(8) + '%' + resetColor +
      s.status.padStart(8)
    );
  });

  console.log('');

  // 分析如果应用TVL过滤后的整体效果
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    应用 TVL >= 5000 后的效果预测                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const currentTotalProfit = signalAnalysis.reduce((sum, s) => sum + s.profitAmount, 0);
  const executedSignals = signalAnalysis.filter(s => s.executed);
  const currentAvgProfit = executedSignals.length > 0
    ? executedSignals.reduce((sum, s) => sum + s.profitPercent, 0) / executedSignals.length
    : 0;
  const currentWinRate = executedSignals.length > 0
    ? ((profitablePassed.length + profitableFailed.length) / executedSignals.length * 100)
    : 0;

  const newTotalProfit = passedTVL.reduce((sum, s) => sum + s.profitAmount, 0);
  const newAvgProfit = executedPassed.length > 0
    ? executedPassed.reduce((sum, s) => sum + s.profitPercent, 0) / executedPassed.length
    : 0;
  const newWinRate = executedPassed.length > 0
    ? (profitablePassed.length / executedPassed.length * 100)
    : 0;

  console.log('【当前策略（无TVL过滤）】');
  console.log(`  总交易数: ${executedSignals.length}`);
  console.log(`  总收益: ${currentTotalProfit.toFixed(4)} BNB`);
  console.log(`  平均收益: ${currentAvgProfit.toFixed(2)}%`);
  console.log(`  胜率: ${currentWinRate.toFixed(1)}%`);
  console.log('');

  console.log('【添加 TVL >= 5000 后】');
  console.log(`  总交易数: ${executedPassed.length} (减少 ${executedSignals.length - executedPassed.length} 个)`);
  console.log(`  总收益: ${newTotalProfit.toFixed(4)} BNB (${newTotalProfit > currentTotalProfit ? '+' : ''}${(newTotalProfit - currentTotalProfit).toFixed(4)})`);
  console.log(`  平均收益: ${newAvgProfit.toFixed(2)}% (${newAvgProfit > currentAvgProfit ? '+' : ''}${(newAvgProfit - currentAvgProfit).toFixed(2)}%)`);
  console.log(`  胜率: ${newWinRate.toFixed(1)}% (${newWinRate > currentWinRate ? '+' : ''}${(newWinRate - currentWinRate).toFixed(1)}%)`);
  console.log('');

  // 计算TVL分布
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    TVL 分布统计                                            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const tvlRanges = [
    { max: 2000, label: '< 2000' },
    { min: 2000, max: 4000, label: '2000-4000' },
    { min: 4000, max: 5000, label: '4000-5000' },
    { min: 5000, max: 8000, label: '5000-8000' },
    { min: 8000, max: 12000, label: '8000-12000' },
    { min: 12000, label: '> 12000' }
  ];

  tvlRanges.forEach(range => {
    const inRange = executedSignals.filter(s => {
      if (range.max === undefined) return s.tvl >= range.min;
      if (range.min === undefined) return s.tvl < range.max;
      return s.tvl >= range.min && s.tvl < range.max;
    });

    if (inRange.length > 0) {
      const avgProfit = inRange.reduce((sum, s) => sum + s.profitPercent, 0) / inRange.length;
      const winRate = (inRange.filter(s => s.profitPercent > 0).length / inRange.length * 100);
      console.log(`  ${range.label.padEnd(15)} ${inRange.length} 个   平均收益: ${avgProfit.toFixed(2)}%   胜率: ${winRate.toFixed(1)}%`);
    }
  });

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

analyzeTVLFilter().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
