/**
 * 分析实验 543f039c-c1bd-45ba-94fa-b1490c123513
 * 查看收益和信号数据，提出优化建议
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function analyzeExperiment() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    实验 543f039c 收益分析                                  ║');
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

  // 分析每个代币的收益
  const tokenAnalyses = [];

  for (const [tokenAddress, tokenTrades] of tokenTradeGroups) {
    tokenTrades.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const buyTrades = tokenTrades.filter(t => t.trade_direction === 'buy');
    const sellTrades = tokenTrades.filter(t => t.trade_direction === 'sell');

    if (buyTrades.length === 0) continue;

    const firstBuy = buyTrades[0];
    const lastSell = sellTrades.length > 0 ? sellTrades[sellTrades.length - 1] : null;

    const buyTime = new Date(firstBuy.created_at).getTime();
    const sellTime = lastSell ? new Date(lastSell.created_at).getTime() : Date.now();
    const holdMinutes = (sellTime - buyTime) / (1000 * 60);

    const tokenSymbol = firstBuy.token_symbol || tokenAddress.substring(0, 8);

    let totalBuyAmount = 0;
    let totalSellAmount = 0;

    buyTrades.forEach(t => totalBuyAmount += t.input_amount || 0);
    sellTrades.forEach(t => totalSellAmount += t.output_amount || 0);

    let profit = 0;
    let profitPercent = 0;
    let status = '持仓中';

    if (sellTrades.length > 0) {
      profit = totalSellAmount - totalBuyAmount;
      profitPercent = (profit / totalBuyAmount) * 100;
      status = profitPercent >= 0 ? '已卖出(盈)' : '已卖出(亏)';
    }

    // 获取购买信号数据
    const signalMetadata = firstBuy.metadata?.factors || {};
    const trendAtBuy = signalMetadata.trendFactors || {};
    const preBuyCheck = signalMetadata.preBuyCheckFactors || {};

    tokenAnalyses.push({
      token_symbol: tokenSymbol,
      token_address: tokenAddress,
      status,
      holdMinutes,
      totalBuyAmount,
      totalSellAmount,
      profit,
      profitPercent,
      buyTime: firstBuy.created_at,
      // 趋势因子
      trendRiseRatio: trendAtBuy.trendRiseRatio || 0,
      tvl: trendAtBuy.tvl || 0,
      fdv: trendAtBuy.fdv || 0,
      holders: trendAtBuy.holders || 0,
      earlyReturn: trendAtBuy.earlyReturn || 0,
      drawdownFromHighest: trendAtBuy.drawdownFromHighest || 0,
      trendStrengthScore: trendAtBuy.trendStrengthScore || 0,
      trendCV: trendAtBuy.trendCV || 0,
      trendSlope: trendAtBuy.trendSlope || 0,
      trendTotalReturn: trendAtBuy.trendTotalReturn || 0,
      age: trendAtBuy.age || 0,
      // 购买前检查因子
      earlyTradesCountPerMin: preBuyCheck.earlyTradesCountPerMin || 0,
      earlyTradesVolumePerMin: preBuyCheck.earlyTradesVolumePerMin || 0,
      earlyTradesUniqueWallets: preBuyCheck.earlyTradesUniqueWallets || 0,
      holderWhitelistCount: preBuyCheck.holderWhitelistCount || 0,
      holderBlacklistCount: preBuyCheck.holderBlacklistCount || 0
    });
  }

  // 按收益率排序
  tokenAnalyses.sort((a, b) => b.profitPercent - a.profitPercent);

  // 统计
  const profitable = tokenAnalyses.filter(t => t.profitPercent > 0);
  const loss = tokenAnalyses.filter(t => t.profitPercent < 0);
  const holding = tokenAnalyses.filter(t => t.status === '持仓中');

  console.log('【整体统计】');
  console.log(`  总代币数: ${tokenAnalyses.length}`);
  console.log(`  已完成交易: ${tokenAnalyses.length - holding.length}`);
  console.log(`  持仓中: ${holding.length}`);
  console.log(`  盈利: ${profitable.length} (${profitable.length > 0 ? (profitable.length / (tokenAnalyses.length - holding.length) * 100).toFixed(1) : 0}%)`);
  console.log(`  亏损: ${loss.length}`);
  console.log('');

  const completedTrades = tokenAnalyses.filter(t => t.status !== '持仓中');
  if (completedTrades.length > 0) {
    const avgProfit = completedTrades.reduce((sum, t) => sum + t.profitPercent, 0) / completedTrades.length;
    const totalProfit = completedTrades.reduce((sum, t) => sum + t.profit, 0);
    console.log(`  平均收益: ${avgProfit.toFixed(2)}%`);
    console.log(`  总收益: ${totalProfit.toFixed(4)} BNB`);
    console.log('');
  }

  // 打印收益列表
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    代币收益列表                                            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log('序号  代币                      收益%     TVL     早期收益%  趋势比  持有时间');
  console.log('─'.repeat(85));

  tokenAnalyses.forEach((t, index) => {
    const profitColor = t.profitPercent >= 0 ? '\x1b[32m' : '\x1b[31m';
    const resetColor = '\x1b[0m';

    const holdTimeStr = t.holdMinutes < 60
      ? `${t.holdMinutes.toFixed(1)}分`
      : `${(t.holdMinutes / 60).toFixed(1)}时`;

    console.log(
      String(index + 1).padStart(4) + '. ' +
      (t.token_symbol.padEnd(24)) +
      profitColor + t.profitPercent.toFixed(2).padStart(8) + '%' + resetColor +
      t.tvl.toFixed(0).padStart(8) +
      t.earlyReturn.toFixed(1).padStart(10) +
      t.trendRiseRatio.toFixed(2).padStart(8) +
      holdTimeStr.padStart(10)
    );
  });

  console.log('');

  // 分析盈利 vs 亏损的特征差异
  if (profitable.length > 0 && loss.length > 0) {
    console.log('╔══════════════════════════════════════════════════════════════════════════╗');
    console.log('║                    盈利 vs 亏损 特征对比                                  ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

    const compare = (feature, name, format = v => v.toFixed(2)) => {
      const profitAvg = profitable.reduce((sum, t) => sum + (t[feature] || 0), 0) / profitable.length;
      const lossAvg = loss.reduce((sum, t) => sum + (t[feature] || 0), 0) / loss.length;
      const diff = profitAvg - lossAvg;
      const diffPct = lossAvg !== 0 ? (diff / lossAvg * 100) : 0;

      console.log(`${name}:`);
      console.log(`  盈利: ${format(profitAvg)},  亏损: ${format(lossAvg)}  差异: ${diff > 0 ? '+' : ''}${format(diff)} (${diffPct > 0 ? '+' : ''}${diffPct.toFixed(1)}%)`);
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
    compare('earlyTradesCountPerMin', '早期交易数/分钟');
    compare('earlyTradesVolumePerMin', '早期交易量/分钟');
    compare('earlyTradesUniqueWallets', '早期独立钱包数');

    console.log('');
  }

  // 获取所有购买信号（包括未执行的）
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    购买信号分析                                            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .order('created_at', { ascending: true });

  if (signals && signals.length > 0) {
    console.log(`总购买信号数: ${signals.length}`);

    // 分析信号执行情况
    let executedCount = 0;
    let notExecutedCount = 0;
    const signalsByToken = new Map();

    for (const signal of signals) {
      let metadata = signal.metadata;
      if (typeof metadata === 'string') {
        try {
          metadata = JSON.parse(metadata);
        } catch (e) {
          metadata = {};
        }
      }

      const executed = metadata.execution_status === 'success';
      if (executed) {
        executedCount++;
      } else {
        notExecutedCount++;
      }

      if (!signalsByToken.has(signal.token_address)) {
        signalsByToken.set(signal.token_address, {
          tokenAddress: signal.token_address,
          symbol: signal.symbol || signal.token_address?.substring(0, 8),
          signals: [],
          executed: false
        });
      }
      signalsByToken.get(signal.token_address).signals.push({
        executed,
        metadata
      });
      if (executed) {
        signalsByToken.get(signal.token_address).executed = true;
      }
    }

    console.log(`  已执行: ${executedCount}`);
    console.log(`  未执行: ${notExecutedCount}`);
    console.log(`  执行率: ${(executedCount / signals.length * 100).toFixed(1)}%`);
    console.log('');
  }

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
