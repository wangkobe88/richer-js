/**
 * 错误卖出分析器
 * 找出卖太早的代币，分析如何优化卖出时机
 */

const { AnalyzerBase } = require('../core/analyzer-base');
const { TokenClassifier } = require('../utils/token-classifier');
const { SignalFilter } = require('../utils/signal-filter');
const { FactorCalculator } = require('../utils/factor-calculator');

class BadSellsAnalyzer extends AnalyzerBase {
  async analyze(options = {}) {
    const { missedThreshold = 0.3 } = options;

    const trades = await this.dataLoader.getTrades();
    const tokens = await this.dataLoader.getTokens();
    const signals = await this.dataLoader.getSignals();

    // 计算所有代币的收益
    const tokenAddresses = [...new Set(trades.map(t => t.token_address))];
    const tokenReturns = [];

    for (const addr of tokenAddresses) {
      const pnl = this.calculateTokenPnL(addr, trades);
      if (!pnl || pnl.status !== 'exited') continue;

      const tokenTrades = trades.filter(t => t.token_address === addr);
      const symbol = tokenTrades[0]?.token_symbol || 'Unknown';

      // 获取代币信息
      const tokenInfo = tokens.find(t => t.token_address === addr);

      // 计算卖出相关指标
      const sellTrades = tokenTrades.filter(t => (t.trade_direction || t.action) === 'sell');
      const lastSell = sellTrades[sellTrades.length - 1];

      const firstBuy = tokenTrades.find(t => (t.trade_direction || t.action) === 'buy');
      const buyPrice = firstBuy?.unit_price || 0;

      const highestPrice = tokenInfo?.highest_price || tokenInfo?.highestPrice || 0;
      const sellPrice = lastSell?.unit_price || 0;

      // 计算持有时间
      const buyTime = new Date(firstBuy?.created_at || 0);
      const sellTime = new Date(lastSell?.created_at || 0);
      const holdMinutes = (sellTime - buyTime) / 60000;

      // 计算错过的收益
      let missedRatio = 0;
      let potentialMaxProfit = 0;

      if (highestPrice > 0 && sellPrice > 0) {
        missedRatio = (highestPrice - sellPrice) / highestPrice;
        potentialMaxProfit = (highestPrice - buyPrice) / buyPrice * 100;
      }

      tokenReturns.push({
        tokenAddress: addr,
        symbol,
        pnl,
        buyPrice,
        sellPrice,
        highestPrice,
        holdMinutes,
        missedRatio,
        potentialMaxProfit,
        capturedProfitPercent: potentialMaxProfit > 0 ? (pnl.returnRate / potentialMaxProfit * 100) : 0
      });
    }

    // 找出错误卖出
    const badSells = tokenReturns.filter(t => TokenClassifier.isBadSell(t.pnl, { highest_price: t.highestPrice, sell_price: t.sellPrice }, { missedThreshold }));
    const goodSells = tokenReturns.filter(t => !TokenClassifier.isBadSell(t.pnl, { highest_price: t.highestPrice, sell_price: t.sellPrice }, { missedThreshold }) && t.pnl.status === 'exited');

    // 分析不同卖出的特征
    const excellentSells = goodSells.filter(t => t.pnl.returnRate > 50);
    const normalSells = goodSells.filter(t => t.pnl.returnRate >= 0 && t.pnl.returnRate <= 50);

    // 统计各类卖出的平均持有时间
    const avgHoldTime = {
      excellent: excellentSells.length > 0 ? FactorCalculator.average(excellentSells, 'holdMinutes') : 0,
      normal: normalSells.length > 0 ? FactorCalculator.average(normalSells, 'holdMinutes') : 0,
      bad: badSells.length > 0 ? FactorCalculator.average(badSells, 'holdMinutes') : 0
    };

    // 统计各类卖出的平均捕获比例
    const avgCaptured = {
      excellent: excellentSells.length > 0 ? FactorCalculator.average(excellentSells.filter(s => s.potentialMaxProfit > 0), 'capturedProfitPercent') : 0,
      normal: normalSells.length > 0 ? FactorCalculator.average(normalSells.filter(s => s.potentialMaxProfit > 0), 'capturedProfitPercent') : 0,
      bad: badSells.length > 0 ? FactorCalculator.average(badSells.filter(s => s.potentialMaxProfit > 0), 'capturedProfitPercent') : 0
    };

    // 优化建议
    const optimizations = this.generateOptimizations(avgHoldTime, avgCaptured, badSells);

    this.results = {
      totalExited: tokenReturns.length,
      excellentCount: excellentSells.length,
      normalCount: normalSells.length,
      badCount: badSells.length,
      avgHoldTime,
      avgCaptured,
      badSells: badSells.map(t => ({
        symbol: t.symbol,
        returnRate: t.pnl.returnRate,
        potentialMaxProfit: t.potentialMaxProfit,
        capturedPercent: t.capturedProfitPercent,
        holdMinutes: t.holdMinutes,
        sellPrice: t.sellPrice,
        highestPrice: t.highestPrice
      })),
      optimizations
    };

    return this.results;
  }

  /**
   * 生成优化建议
   */
  generateOptimizations(avgHoldTime, avgCaptured, badSells) {
    const optimizations = [];

    // 分析持有时间
    if (avgHoldTime.bad < avgHoldTime.excellent * 0.5) {
      optimizations.push({
        type: 'hold_time',
        priority: 'high',
        title: '延长卖出持有时间',
        description: `糟糕卖出的平均持有时间(${avgHoldTime.bad.toFixed(2)}分钟)明显短于优秀卖出(${avgHoldTime.excellent.toFixed(2)}分钟)`,
        suggestion: `建议将最小持有时间从当前设置延长到 ${Math.ceil(avgHoldTime.excellent)} 分钟`,
        expectedImpact: '预期可显著提高捕获潜在收益的比例'
      });
    }

    // 分析捕获比例
    if (avgCaptured.bad < 30) {
      optimizations.push({
        type: 'capture_ratio',
        priority: 'high',
        title: '提高收益捕获比例',
        description: `糟糕卖出平均只捕获了${avgCaptured.bad.toFixed(1)}%的潜在收益`,
        suggestion: '考虑使用动态止损策略，让利润充分奔跑',
        expectedImpact: '预期可将平均捕获比例提高到50%以上'
      });
    }

    // 分析回撤阈值
    const veryBadSells = badSells.filter(s => s.capturedProfitPercent < 15);
    if (veryBadSells.length > badSells.length * 0.5) {
      optimizations.push({
        type: 'drawdown_threshold',
        priority: 'medium',
        title: '调整止损阈值',
        description: `超过一半的糟糕卖出只捕获了不到15%的潜在收益`,
        suggestion: '当前的止损阈值可能过于严格，考虑放宽到-25%或-30%',
        expectedImpact: '预期可减少过早卖出'
      });
    }

    // 分批止盈建议
    if (avgCaptured.excellent > 70) {
      optimizations.push({
        type: 'partial_take_profit',
        priority: 'medium',
        title: '采用分批止盈策略',
        description: `优秀卖出平均捕获了${avgCaptured.excellent.toFixed(1)}%的潜在收益`,
        suggestion: '在达到一定收益后分批卖出：+30%卖50%，+50%卖30%，剩余持有更长时间',
        expectedImpact: '平衡风险和收益，避免卖得太早或太晚'
      });
    }

    return optimizations;
  }

  formatReport() {
    const r = this.results;

    let output = '';

    output += '【卖出质量分类】\n\n';
    output += `  优秀卖出 (>50%收益): ${r.excellentCount} 个\n`;
    output += `  一般卖出 (0-50%收益): ${r.normalCount} 个\n`;
    output += `  糟糕卖出 (卖太早): ${r.badCount} 个\n\n`;

    output += '【卖出质量分析】\n\n';
    output += '  类别        数量  平均持有时间  平均捕获收益\n';
    output += '  ' + '─'.repeat(45) + '\n';
    output += `  优秀卖出    ${r.excellentCount.toString().padStart(4)}  ${r.avgHoldTime.excellent.toFixed(2).padStart(10)}分钟  ${r.avgCaptured.excellent.toFixed(1).padStart(10)}%\n`;
    output += `  一般卖出    ${r.normalCount.toString().padStart(4)}  ${r.avgHoldTime.normal.toFixed(2).padStart(10)}分钟  ${r.avgCaptured.normal.toFixed(1).padStart(10)}%\n`;
    output += `  糟糕卖出    ${r.badCount.toString().padStart(4)}  ${r.avgHoldTime.bad.toFixed(2).padStart(10)}分钟  ${r.avgCaptured.bad.toFixed(1).padStart(10)}%\n\n`;

    if (r.badCount > 0) {
      output += '【错误卖出详情】\n\n';
      output += '  代币              实际收益  潜在最高  捕获比例  持有时间\n';
      output += '  ' + '─'.repeat(60) + '\n';

      r.badSells.sort((a, b) => a.capturedPercent - b.capturedPercent).forEach(t => {
        output += `  ${t.symbol.padEnd(16)} ${this.formatPercent(t.returnRate).padStart(10)} ${this.formatPercent(t.potentialMaxProfit).padStart(10)} ${t.capturedPercent.toFixed(1).padStart(8)}% ${t.holdMinutes.toFixed(2).padStart(8)}分钟\n`;
      });
    }

    output += '\n';

    output += '【优化建议】\n\n';

    if (r.optimizations.length === 0) {
      output += '  当前卖出策略表现良好，暂无优化建议\n\n';
    } else {
      r.optimizations.forEach(opt => {
        const priorityBadge = opt.priority === 'high' ? '[高优先级]' : opt.priority === 'medium' ? '[中优先级]' : '[低优先级]';
        output += `  ${priorityBadge} ${opt.title}\n`;
        output += `    问题: ${opt.description}\n`;
        output += `    建议: ${opt.suggestion}\n`;
        output += `    预期效果: ${opt.expectedImpact}\n\n`;
      });
    }

    return output;
  }
}

module.exports = { BadSellsAnalyzer };
