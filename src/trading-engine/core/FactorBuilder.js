/**
 * 因子构建器
 * 统一管理所有因子的计算逻辑，供多个引擎共享
 *
 * 职责：
 * 1. 计算所有交易因子（基础因子 + 趋势因子）
 * 2. 序列化因子到时序数据格式
 * 3. 从时序数据反序列化因子
 */

/**
 * 构建因子对象用于记录时序数据
 * @param {Object} factorResults - _buildFactors() 返回的完整因子结果
 * @returns {Object} 适合存储到时序数据的因子对象
 */
function buildFactorValuesForTimeSeries(factorResults) {
  if (!factorResults) {
    return {};
  }

  return {
    // 基础因子
    age: factorResults.age,
    currentPrice: factorResults.currentPrice,
    collectionPrice: factorResults.collectionPrice,
    launchPrice: factorResults.launchPrice,
    earlyReturn: factorResults.earlyReturn,
    riseSpeed: factorResults.riseSpeed,
    buyPrice: factorResults.buyPrice,
    holdDuration: factorResults.holdDuration,
    profitPercent: factorResults.profitPercent,
    highestPrice: factorResults.highestPrice,
    highestPriceTimestamp: factorResults.highestPriceTimestamp,
    drawdownFromHighest: factorResults.drawdownFromHighest,
    txVolumeU24h: factorResults.txVolumeU24h,
    holders: factorResults.holders,
    tvl: factorResults.tvl,
    fdv: factorResults.fdv,
    marketCap: factorResults.marketCap,
    // 趋势因子（用于回测）
    trendCV: factorResults.trendCV,
    trendDirectionCount: factorResults.trendDirectionCount,
    trendStrengthScore: factorResults.trendStrengthScore,
    trendTotalReturn: factorResults.trendTotalReturn,
    trendRiseRatio: factorResults.trendRiseRatio,
    trendDataPoints: factorResults.trendDataPoints,
    trendRecentDownCount: factorResults.trendRecentDownCount,
    trendRecentDownRatio: factorResults.trendRecentDownRatio,
    trendConsecutiveDowns: factorResults.trendConsecutiveDowns,
    trendPriceChangeFromDetect: factorResults.trendPriceChangeFromDetect,
    trendSinceBuyReturn: factorResults.trendSinceBuyReturn,
    trendSinceBuyDataPoints: factorResults.trendSinceBuyDataPoints
  };
}

/**
 * 从时序数据构建因子对象
 * @param {Object} factorValues - 时序数据中的 factor_values
 * @param {Object} tokenState - 代币状态
 * @param {number} priceUsd - 当前价格
 * @param {number} timestamp - 时间戳
 * @returns {Object} 因子对象
 */
function buildFactorsFromTimeSeries(factorValues, tokenState = {}, priceUsd = 0, timestamp = Date.now()) {
  const fv = factorValues || {};

  // 优先使用 factor_values 中的 age（基于代币创建时间），如果没有则重新计算
  let age = fv.age;
  if (age === undefined || age === null) {
    const collectionTime = tokenState.collectionTime || timestamp;
    age = (timestamp - collectionTime) / 1000 / 60;
  }

  // 持仓相关因子需要基于回测引擎的买入状态动态计算
  const holdDuration = tokenState.buyTime ? (timestamp - tokenState.buyTime) / 1000 : 0;

  let profitPercent = 0;
  if (tokenState.buyPrice && tokenState.buyPrice > 0 && priceUsd > 0) {
    profitPercent = ((priceUsd - tokenState.buyPrice) / tokenState.buyPrice) * 100;
  }

  return {
    // 基础因子
    age: age,
    currentPrice: priceUsd,
    collectionPrice: tokenState.collectionPrice || fv.collectionPrice || 0,
    launchPrice: fv.launchPrice || 0,
    earlyReturn: fv.earlyReturn || 0,
    riseSpeed: fv.riseSpeed || 0,
    buyPrice: tokenState.buyPrice || 0,
    holdDuration: holdDuration,
    profitPercent: profitPercent,
    // 直接使用 factor_values 中的最高价相关数据（虚拟引擎已动态维护）
    highestPrice: fv.highestPrice || priceUsd,
    highestPriceTimestamp: fv.highestPriceTimestamp || timestamp,
    drawdownFromHighest: fv.drawdownFromHighest || 0,
    txVolumeU24h: fv.txVolumeU24h || 0,
    holders: fv.holders || 0,
    tvl: fv.tvl || 0,
    fdv: fv.fdv || 0,
    marketCap: fv.marketCap || 0,
    // 趋势因子（从时序数据中读取）
    trendCV: fv.trendCV ?? null,
    trendDirectionCount: fv.trendDirectionCount ?? null,
    trendStrengthScore: fv.trendStrengthScore ?? null,
    trendTotalReturn: fv.trendTotalReturn ?? null,
    trendRiseRatio: fv.trendRiseRatio ?? null,
    trendDataPoints: fv.trendDataPoints ?? null,
    trendRecentDownCount: fv.trendRecentDownCount ?? null,
    trendRecentDownRatio: fv.trendRecentDownRatio ?? null,
    trendConsecutiveDowns: fv.trendConsecutiveDowns ?? null,
    trendPriceChangeFromDetect: fv.trendPriceChangeFromDetect ?? null,
    trendSinceBuyReturn: fv.trendSinceBuyReturn ?? null,
    trendSinceBuyDataPoints: fv.trendSinceBuyDataPoints ?? null
  };
}

/**
 * 获取所有可用的因子ID列表
 * @returns {Set<string>} 因子ID集合
 */
function getAvailableFactorIds() {
  return new Set([
    // 基础因子
    'age', 'currentPrice', 'collectionPrice', 'earlyReturn', 'buyPrice',
    'holdDuration', 'profitPercent',
    'highestPrice', 'highestPriceTimestamp', 'drawdownFromHighest',
    'txVolumeU24h', 'holders', 'tvl', 'fdv', 'marketCap',
    // 趋势因子
    'trendCV', 'trendDirectionCount', 'trendStrengthScore', 'trendTotalReturn', 'trendRiseRatio',
    'trendDataPoints', 'trendRecentDownCount', 'trendRecentDownRatio', 'trendConsecutiveDowns',
    'trendPriceChangeFromDetect', 'trendSinceBuyReturn', 'trendSinceBuyDataPoints'
  ]);
}

module.exports = {
  buildFactorValuesForTimeSeries,
  buildFactorsFromTimeSeries,
  getAvailableFactorIds
};
