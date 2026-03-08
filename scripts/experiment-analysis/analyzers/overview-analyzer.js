/**
 * 概览分析器
 * 分析实验的整体表现
 */

const { AnalyzerBase } = require('../core/analyzer-base');

class OverviewAnalyzer extends AnalyzerBase {
  async analyze() {
    const trades = await this.dataLoader.getTrades();
    const tokens = await this.dataLoader.getTokens();
    const blacklistStats = await this.dataLoader.getBlacklistStats();

    // 计算所有代币的收益
    const tokenAddresses = [...new Set(trades.map(t => t.token_address))];
    const tokenReturns = tokenAddresses.map(addr => {
      const pnl = this.calculateTokenPnL(addr, trades);
      if (!pnl) return null;

      const tokenTrades = trades.filter(t => t.token_address === addr);
      const symbol = tokenTrades[0]?.token_symbol || 'Unknown';

      return { tokenAddress: addr, symbol, pnl };
    }).filter(t => t !== null);

    // 统计指标
    const totalTokens = tokenReturns.length;
    const profitableTokens = tokenReturns.filter(t => t.pnl.returnRate > 0);
    const lossTokens = tokenReturns.filter(t => t.pnl.returnRate < 0);

    const totalSpent = tokenReturns.reduce((sum, t) => sum + t.pnl.totalSpent, 0);
    const totalReceived = tokenReturns.reduce((sum, t) => sum + t.pnl.totalReceived + t.pnl.remainingCost, 0);
    const totalReturn = totalSpent > 0 ? ((totalReceived - totalSpent) / totalSpent * 100) : 0;
    const totalBNBChange = totalReceived - totalSpent;

    const winRate = totalTokens > 0 ? (profitableTokens.length / totalTokens * 100) : 0;

    const avgProfit = profitableTokens.length > 0
      ? profitableTokens.reduce((sum, t) => sum + t.pnl.returnRate, 0) / profitableTokens.length
      : 0;

    const avgLoss = lossTokens.length > 0
      ? lossTokens.reduce((sum, t) => sum + t.pnl.returnRate, 0) / lossTokens.length
      : 0;

    // 持有时间分析
    const holdingTimes = tokenReturns.map(t => {
      const tokenTrades = trades.filter(tr => tr.token_address === t.tokenAddress);
      const firstTrade = tokenTrades[0];
      const lastTrade = tokenTrades[tokenTrades.length - 1];
      if (!firstTrade || !lastTrade) return 0;
      return (new Date(lastTrade.created_at) - new Date(firstTrade.created_at)) / 60000; // 分钟
    }).filter(t => t > 0);

    const avgHoldingTime = holdingTimes.length > 0
      ? holdingTimes.reduce((sum, t) => sum + t, 0) / holdingTimes.length
      : 0;

    // 黑名单统计
    const blacklistHitRate = blacklistStats && blacklistStats.totalTokens > 0
      ? (blacklistStats.blacklistedTokens / blacklistStats.totalTokens * 100)
      : 0;

    this.results = {
      summary: {
        totalTokens,
        profitableCount: profitableTokens.length,
        lossCount: lossTokens.length,
        winRate,
        totalReturn,
        totalBNBChange,
        avgProfit,
        avgLoss,
        avgHoldingTime
      },
      blacklistStats: {
        totalTokens: blacklistStats?.totalTokens || 0,
        blacklistedTokens: blacklistStats?.blacklistedTokens || 0,
        blacklistHitRate
      },
      tokenReturns: tokenReturns.map(t => ({
        symbol: t.symbol,
        returnRate: t.pnl.returnRate,
        realizedPnL: t.pnl.realizedPnL,
        status: t.pnl.status
      }))
    };

    return this.results;
  }

  formatReport() {
    const r = this.results;
    let output = '';

    output += '【整体表现】\n\n';
    output += `  总交易数: ${r.summary.totalTokens}\n`;
    output += `  盈利代币: ${r.summary.profitableCount}\n`;
    output += `  亏损代币: ${r.summary.lossCount}\n`;
    output += `  胜率: ${r.summary.winRate.toFixed(1)}%\n\n`;

    output += `  总收益率: ${this.formatPercent(r.summary.totalReturn)}\n`;
    output += `  总盈亏: ${this.formatBNB(r.summary.totalBNBChange)}\n\n`;

    output += `  平均盈利: ${this.formatPercent(r.summary.avgProfit)}\n`;
    output += `  平均亏损: ${this.formatPercent(r.summary.avgLoss)}\n`;
    output += `  平均持有时间: ${r.summary.avgHoldingTime.toFixed(2)} 分钟\n\n`;

    output += '【黑名单统计】\n\n';
    output += `  总检测代币: ${r.blacklistStats.totalTokens}\n`;
    output += `  命中黑名单: ${r.blacklistStats.blacklistedTokens}\n`;
    output += `  命中率: ${r.blacklistStats.blacklistHitRate.toFixed(1)}%\n\n`;

    output += '【代币收益明细】\n\n';
    output += '  代币              收益率      盈亏BNB    状态\n';
    output += '  ' + '─'.repeat(50) + '\n';

    r.tokenReturns.sort((a, b) => b.returnRate - a.returnRate).forEach(t => {
      const statusLabel = t.status === 'exited' ? '已退出' : t.status === 'bought' ? '已买入' : '监控中';
      output += `  ${t.symbol.padEnd(16)} ${this.formatPercent(t.returnRate).padStart(10)} ${this.formatBNB(t.realizedPnL).padStart(10)} ${statusLabel}\n`;
    });

    return output;
  }
}

module.exports = { OverviewAnalyzer };
