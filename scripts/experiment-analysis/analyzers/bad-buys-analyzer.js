/**
 * 错误购买分析器
 * 找出不应该买但买了的代币，分析如何过滤
 */

const { AnalyzerBase } = require('../core/analyzer-base');
const { TokenClassifier } = require('../utils/token-classifier');
const { FactorCalculator } = require('../utils/factor-calculator');

class BadBuysAnalyzer extends AnalyzerBase {
  async analyze() {
    const trades = await this.dataLoader.getTrades();
    const tokens = await this.dataLoader.getTokens();
    const signals = await this.dataLoader.getSignals();

    // 计算所有代币的收益
    const tokenAddresses = [...new Set(trades.map(t => t.token_address))];
    const tokenReturns = [];

    for (const addr of tokenAddresses) {
      const pnl = this.calculateTokenPnL(addr, trades);
      if (!pnl) continue;

      const tokenTrades = trades.filter(t => t.token_address === addr);
      const symbol = tokenTrades[0]?.token_symbol || 'Unknown';

      // 获取第一个买入交易的因子
      const firstBuy = tokenTrades.find(t => (t.trade_direction || t.action) === 'buy');
      const factors = this.extractFactors(firstBuy);

      tokenReturns.push({
        tokenAddress: addr,
        symbol,
        pnl,
        factors
      });
    }

    // 分组
    const profitable = tokenReturns.filter(t => !TokenClassifier.isBadBuy(t.pnl));
    const badBuys = tokenReturns.filter(t => TokenClassifier.isBadBuy(t.pnl));

    // 因子对比分析
    const factorKeys = [
      { key: 'trendRiseRatio', name: 'trendRiseRatio' },
      { key: 'earlyReturn', name: 'earlyReturn' },
      { key: 'age', name: 'age' },
      { key: 'tvl', name: 'TVL' },
      { key: 'fdv', name: 'FDV' },
      { key: 'holders', name: 'holders' },
      { key: 'trendStrengthScore', name: 'trendStrength' },
      { key: 'trendCV', name: 'trendCV' },
      { key: 'trendSlope', name: 'trendSlope' },
      { key: 'trendTotalReturn', name: 'trendTotalReturn' },
      { key: 'drawdownFromHighest', name: 'drawdown' }
    ];

    const factorComparison = FactorCalculator.compareFactors(
      profitable.map(t => ({ ...t.factors, profitPercent: t.pnl.returnRate })),
      badBuys.map(t => ({ ...t.factors, profitPercent: t.pnl.returnRate })),
      factorKeys
    );

    // 分析潜在过滤条件
    const filterSuggestions = this.analyzeFilterSuggestions(badBuys, profitable);

    this.results = {
      totalBadBuys: badBuys.length,
      totalProfitable: profitable.length,
      badBuys: badBuys.map(t => ({
        symbol: t.symbol,
        returnRate: t.pnl.returnRate,
        realizedPnL: t.pnl.realizedPnL,
        factors: t.factors
      })),
      factorComparison,
      filterSuggestions
    };

    return this.results;
  }

  /**
   * 分析潜在的过滤条件
   */
  analyzeFilterSuggestions(badBuys, profitable) {
    const suggestions = [];

    // 分析 age 因子
    const badAvgAge = badBuys.reduce((sum, t) => sum + (t.factors.age || 0), 0) / badBuys.length;
    const goodAvgAge = profitable.reduce((sum, t) => sum + (t.factors.age || 0), 0) / profitable.length;

    if (badAvgAge > goodAvgAge * 1.3) {
      const threshold = Math.floor(badAvgAge);
      const filteredCount = badBuys.filter(t => (t.factors.age || 0) >= threshold).length;
      const lostProfit = profitable.filter(t => (t.factors.age || 0) >= threshold)
        .reduce((sum, t) => sum + t.pnl.realizedPnL, 0);

      suggestions.push({
        factor: 'age',
        condition: `age < ${threshold}`,
        reason: `亏损代币平均age(${badAvgAge.toFixed(2)})明显高于盈利代币(${goodAvgAge.toFixed(2)})`,
        wouldFilter: filteredCount,
        wouldLose: profitable.filter(t => (t.factors.age || 0) >= threshold).length,
        lostProfit,
        priority: filteredCount > 0 ? 'high' : 'medium'
      });
    }

    // 分析 trendCV 因子
    const badAvgCV = badBuys.reduce((sum, t) => sum + (t.factors.trendCV || 0), 0) / badBuys.length;
    const goodAvgCV = profitable.reduce((sum, t) => sum + (t.factors.trendCV || 0), 0) / profitable.length;

    if (badAvgCV < goodAvgCV * 0.7) {
      const threshold = 0.2;
      const filteredCount = badBuys.filter(t => (t.factors.trendCV || 0) < threshold).length;
      const lostProfit = profitable.filter(t => (t.factors.trendCV || 0) < threshold)
        .reduce((sum, t) => sum + t.pnl.realizedPnL, 0);

      suggestions.push({
        factor: 'trendCV',
        condition: `trendCV >= ${threshold}`,
        reason: `亏损代币平均trendCV(${badAvgCV.toFixed(3)})明显低于盈利代币(${goodAvgCV.toFixed(3)})`,
        wouldFilter: filteredCount,
        wouldLose: profitable.filter(t => (t.factors.trendCV || 0) < threshold).length,
        lostProfit,
        priority: filteredCount > 0 ? 'high' : 'medium'
      });
    }

    // 分析 trendRiseRatio 因子
    const badAvgRatio = badBuys.reduce((sum, t) => sum + (t.factors.trendRiseRatio || 0), 0) / badBuys.length;
    const goodAvgRatio = profitable.reduce((sum, t) => sum + (t.factors.trendRiseRatio || 0), 0) / profitable.length;

    if (badAvgRatio < goodAvgRatio * 0.9) {
      const threshold = 0.7;
      const filteredCount = badBuys.filter(t => (t.factors.trendRiseRatio || 0) < threshold).length;
      const lostProfit = profitable.filter(t => (t.factors.trendRiseRatio || 0) < threshold)
        .reduce((sum, t) => sum + t.pnl.realizedPnL, 0);

      suggestions.push({
        factor: 'trendRiseRatio',
        condition: `trendRiseRatio >= ${threshold}`,
        reason: `亏损代币平均trendRiseRatio(${badAvgRatio.toFixed(3)})低于盈利代币(${goodAvgRatio.toFixed(3)})`,
        wouldFilter: filteredCount,
        wouldLose: profitable.filter(t => (t.factors.trendRiseRatio || 0) < threshold).length,
        lostProfit,
        priority: filteredCount > 0 ? 'high' : 'medium'
      });
    }

    return suggestions.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  formatReport() {
    const r = this.results;

    if (r.totalBadBuys === 0) {
      return '【错误购买】\n\n  🎉 太棒了！没有错误购买！\n';
    }

    let output = '';

    output += `【错误购买】共 ${r.totalBadBuys} 个 (占比 ${(r.totalBadBuys / (r.totalBadBuys + r.totalProfitable) * 100).toFixed(1)}%)\n\n`;

    output += '【因子对比：盈利代币 vs 亏损代币】\n\n';
    output += '  因子                     盈利平均   亏损平均   差异      差异%\n';
    output += '  ' + '─'.repeat(65) + '\n';

    r.factorComparison.slice(0, 8).forEach(f => {
      output += `  ${f.name.padEnd(24)} ${f.avgA.toFixed(3).padStart(9)} ${f.avgB.toFixed(3).padStart(9)} ${f.diff.toFixed(3).padStart(8)} ${f.diffPercent > 0 ? '+' : ''}${f.diffPercent.toFixed(1).padStart(7)}%\n`;
    });

    output += '\n';

    output += '【建议过滤条件】\n\n';

    if (r.filterSuggestions.length === 0) {
      output += '  没有发现明显的过滤条件\n\n';
    } else {
      r.filterSuggestions.forEach(s => {
        const priorityBadge = s.priority === 'high' ? '[高优先级]' : s.priority === 'medium' ? '[中优先级]' : '[低优先级]';
        output += `  ${priorityBadge} ${s.condition}\n`;
        output += `    原因: ${s.reason}\n`;
        output += `    可过滤: ${s.wouldFilter} 个亏损代币`;
        if (s.wouldLose > 0) {
          output += ` | 会损失: ${s.wouldLose} 个盈利代币 (${this.formatBNB(s.lostProfit)})`;
        }
        output += '\n\n';
      });
    }

    output += '【亏损代币列表】\n\n';
    output += '  代币              收益率      盈亏BNB    关键因子\n';
    output += '  ' + '─'.repeat(60) + '\n';

    r.badBuys.sort((a, b) => a.returnRate - b.returnRate).forEach(t => {
      const keyFactors = `ratio:${(t.factors.trendRiseRatio || 0).toFixed(2)} age:${(t.factors.age || 0).toFixed(1)} cv:${(t.factors.trendCV || 0).toFixed(3)}`;
      output += `  ${t.symbol.padEnd(16)} ${this.formatPercent(t.returnRate).padStart(10)} ${this.formatBNB(t.realizedPnL).padStart(10)} ${keyFactors}\n`;
    });

    return output;
  }
}

module.exports = { BadBuysAnalyzer };
