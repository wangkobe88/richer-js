/**
 * 信号过滤器
 * 分析和过滤交易信号
 */

class SignalFilter {
  /**
   * 获取代币的买入信号
   */
  static getBuySignals(signals, tokenAddress) {
    return signals.filter(s =>
      s.token_address === tokenAddress &&
      (s.action === 'buy' || s.signal_action === 'buy')
    );
  }

  /**
   * 获取代币的卖出信号
   */
  static getSellSignals(signals, tokenAddress) {
    return signals.filter(s =>
      s.token_address === tokenAddress &&
      (s.action === 'sell' || s.signal_action === 'sell')
    );
  }

  /**
   * 检查信号是否被拒绝
   */
  static isRejectedSignal(signal) {
    return signal.status === 'rejected' ||
           signal.rejected === true ||
           (signal.metadata && signal.metadata.rejected === true);
  }

  /**
   * 获取信号被拒绝的原因
   */
  static getRejectionReason(signal) {
    const metadata = signal.metadata || {};
    const preBuyCheck = metadata.pre_buy_check || metadata.preBuyCheck || {};

    if (preBuyCheck.rejected) {
      return preBuyCheck.reason || preBuyCheck.rejectionReason || '未知原因';
    }

    if (metadata.rejection_reason) {
      return metadata.rejection_reason;
    }

    if (metadata.rejectedReason) {
      return metadata.rejectedReason;
    }

    return '未知原因';
  }

  /**
   * 分析预检查结果
   */
  static analyzePreBuyCheck(signal) {
    const metadata = signal.metadata || {};
    const preBuyCheck = metadata.pre_buy_check || metadata.preBuyCheck || {};

    return {
      rejected: preBuyCheck.rejected || false,
      reason: preBuyCheck.reason || preBuyCheck.rejectionReason || null,
      checks: {
        blacklist: preBuyCheck.blacklistCheck || preBuyCheck.blacklist_passed,
        holderDistribution: preBuyCheck.holderDistribution || preBuyCheck.holder_distribution_ok,
        tradingActivity: preBuyCheck.tradingActivity || preBuyCheck.trading_activity_ok
      }
    };
  }

  /**
   * 检查信号是否触发过
   */
  static hasBuySignal(signals, tokenAddress) {
    const buySignals = this.getBuySignals(signals, tokenAddress);
    return buySignals.length > 0;
  }

  /**
   * 检查代币是否被交易过
   */
  static hasTraded(trades, tokenAddress) {
    return trades.some(t => t.token_address === tokenAddress);
  }

  /**
   * 分析漏掉原因
   */
  static analyzeMissedReason(token, signals, timeSeriesData) {
    const buySignals = this.getBuySignals(signals, token.token_address);

    // 没有买入信号
    if (buySignals.length === 0) {
      return {
        reason: 'no_signal',
        description: '从未触发买入信号',
        suggestion: '需要分析时序数据，查看哪些因子不满足条件'
      };
    }

    // 有信号但被拒绝（预检查失败）
    const rejectedSignals = buySignals.filter(s =>
      s.executed === false || s.execution_status === 'failed'
    );
    if (rejectedSignals.length > 0) {
      return {
        reason: 'signal_rejected',
        description: '预检查拒绝',
        suggestion: '可以考虑调整预检查条件'
      };
    }

    // 有信号但没有交易
    return {
      reason: 'unknown',
      description: '有买入信号但没有交易记录',
      suggestion: '可能是系统问题或其他未知原因'
    };
  }

  /**
   * 分析卖出时机
   */
  static analyzeSellTiming(token, sellSignals, trades) {
    const tokenSells = sellSignals.filter(s => s.token_address === token.token_address);
    const tokenTrades = trades.filter(t => t.token_address === token.token_address && t.trade_direction === 'sell');

    if (tokenSells.length === 0 || tokenTrades.length === 0) {
      return null;
    }

    // 找到最后一次卖出
    const lastSell = tokenTrades[tokenTrades.length - 1];
    const lastSellSignal = tokenSells[tokenSells.length - 1];

    const highestPrice = token.highest_price || token.highestPrice || 0;
    const sellPrice = lastSell.unit_price || 0;

    if (highestPrice <= 0 || sellPrice <= 0) {
      return null;
    }

    const missedRatio = (highestPrice - sellPrice) / highestPrice;
    const potentialProfit = (highestPrice - sellPrice) / sellPrice * 100;

    return {
      sellPrice,
      highestPrice,
      missedRatio,
      potentialProfit,
      signalReason: lastSellSignal?.reason || '止盈/止损触发'
    };
  }
}

module.exports = { SignalFilter };
