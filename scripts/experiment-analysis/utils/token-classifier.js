/**
 * 代币分类器
 * 对代币进行各种分类判断
 */

class TokenClassifier {
  /**
   * 判断是否是好票（漏掉的机会）
   * 好票定义: 最高涨幅高 + 非流水盘 + 非低质量
   */
  static isGoodToken(token, options = {}) {
    const {
      minHighestReturn = 100,  // 最低最高涨幅要求
      requireNonFakePump = true,  // 必须非流水盘
      requireNonLowQuality = false  // 必须非低质量
    } = options;

    // 最高涨幅从 analysis_results.max_change_percent 获取
    const analysisResults = token.analysis_results || token.analysisResults || {};
    const highestReturn = analysisResults.max_change_percent || token.highest_return || token.highestReturn || 0;

    const humanJudges = token.human_judges || token.humanJudges || {};
    const category = humanJudges.category;

    // 检查最高涨幅
    if (highestReturn < minHighestReturn) return false;

    // 检查是否是流水盘
    if (requireNonFakePump && category === 'fake_pump') return false;

    // 检查是否是低质量
    if (requireNonLowQuality && category === 'low_quality') return false;

    return true;
  }

  /**
   * 判断是否是错误购买
   * 错误购买: 收益为负
   */
  static isBadBuy(tokenPnL) {
    if (!tokenPnL) return false;
    return tokenPnL.returnRate < 0;
  }

  /**
   * 判断是否是错误卖出
   * 错误卖出: 已退出 + 卖出价格远低于最高价格
   */
  static isBadSell(tokenPnL, token, options = {}) {
    const { missedThreshold = 0.3 } = options;  // 错过30%以上收益算卖得太早

    if (!tokenPnL || !token) return false;

    // 必须已经退出
    if (tokenPnL.status !== 'exited') return false;

    // 计算最高价格和卖出价格
    const highestPrice = token.highest_price || token.highestPrice || 0;
    const sellPrice = token.sell_price || token.sellPrice || 0;

    if (highestPrice <= 0 || sellPrice <= 0) return false;

    // 计算错过的收益比例
    const missedRatio = (highestPrice - sellPrice) / highestPrice;

    return missedRatio > missedThreshold;
  }

  /**
   * 判断是否是流水盘
   */
  static isFakePump(token) {
    const humanJudges = token.human_judges || token.humanJudges || {};
    return humanJudges.category === 'fake_pump';
  }

  /**
   * 判断是否是低质量
   */
  static isLowQuality(token) {
    const humanJudges = token.human_judges || token.humanJudges || {};
    return humanJudges.category === 'low_quality';
  }

  /**
   * 判断是否是高质量
   */
  static isHighQuality(token) {
    const humanJudges = token.human_judges || token.humanJudges || {};
    return humanJudges.category === 'high_quality';
  }

  /**
   * 获取代币质量标签
   */
  static getQualityLabel(token) {
    const humanJudges = token.human_judges || token.humanJudges || {};
    const category = humanJudges.category;

    const labels = {
      fake_pump: { emoji: '🎭', label: '流水盘', priority: 1 },
      no_user: { emoji: '👻', label: '无人玩', priority: 2 },
      low_quality: { emoji: '📉', label: '低质量', priority: 3 },
      mid_quality: { emoji: '📊', label: '中质量', priority: 4 },
      high_quality: { emoji: '🚀', label: '高质量', priority: 5 }
    };

    return labels[category] || { emoji: '❓', label: '未标注', priority: 0 };
  }

  /**
   * 按收益分组代币
   */
  static groupByPnL(tokenReturns) {
    return {
      profitable: tokenReturns.filter(t => t.pnl.returnRate > 0),
      loss: tokenReturns.filter(t => t.pnl.returnRate < 0),
      breakeven: tokenReturns.filter(t => t.pnl.returnRate === 0)
    };
  }

  /**
   * 按状态分组代币
   */
  static groupByStatus(tokenReturns) {
    return {
      exited: tokenReturns.filter(t => t.pnl.status === 'exited'),
      holding: tokenReturns.filter(t => t.pnl.status !== 'exited')
    };
  }
}

module.exports = { TokenClassifier };
