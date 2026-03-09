/**
 * 因子构建器
 * 统一管理所有因子的计算逻辑，供多个引擎共享
 *
 * 职责：
 * 1. 构建常规因子（基础因子 + 趋势因子）用于时序数据
 * 2. 构建购买前置检查因子用于信号 metadata
 * 3. 从时序数据反序列化常规因子
 */

/**
 * 构建常规因子对象用于记录时序数据
 * 常规因子：代币状态相关的因子，每个K线都有值
 * @param {Object} factorResults - _buildFactors() 返回的完整因子结果
 * @returns {Object} 适合存储到时序数据的常规因子对象
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
    // 趋势因子（固定窗口8个点）
    trendCV: factorResults.trendCV,
    trendPriceUp: factorResults.trendPriceUp,
    trendMedianUp: factorResults.trendMedianUp,
    trendStrengthScore: factorResults.trendStrengthScore,
    trendTotalReturn: factorResults.trendTotalReturn,
    trendRiseRatio: factorResults.trendRiseRatio,
    trendSlope: factorResults.trendSlope,
    trendDataPoints: factorResults.trendDataPoints,
    trendRecentDownCount: factorResults.trendRecentDownCount,
    trendRecentDownRatio: factorResults.trendRecentDownRatio,
    trendConsecutiveDowns: factorResults.trendConsecutiveDowns
  };
}

/**
 * 构建购买前置检查因子对象用于信号 metadata
 * 购买前置检查因子：只在购买时执行一次，存储在购买信号的 metadata 中
 * @param {Object} preBuyCheckResult - 购买前置检查结果
 * @returns {Object} 购买前置检查因子对象
 */
function buildPreBuyCheckFactorValues(preBuyCheckResult) {
  if (!preBuyCheckResult) {
    return {};
  }

  return {
    // 持有者检查因子
    holderWhitelistCount: preBuyCheckResult.holderWhitelistCount || 0,
    holderBlacklistCount: preBuyCheckResult.holderBlacklistCount || 0,
    holdersCount: preBuyCheckResult.holdersCount || 0,
    devHoldingRatio: preBuyCheckResult.devHoldingRatio || 0,
    maxHoldingRatio: preBuyCheckResult.maxHoldingRatio || 0,
    holderCanBuy: preBuyCheckResult.holderCanBuy ?? null,
    // 早期参与者检查因子
    earlyTradesChecked: preBuyCheckResult.earlyTradesChecked || 0,
    earlyTradesCheckTimestamp: preBuyCheckResult.earlyTradesCheckTimestamp || null,
    earlyTradesCheckDuration: preBuyCheckResult.earlyTradesCheckDuration || null,
    earlyTradesCheckTime: preBuyCheckResult.earlyTradesCheckTime || null,
    earlyTradesWindow: preBuyCheckResult.earlyTradesWindow || null,
    earlyTradesExpectedFirstTime: preBuyCheckResult.earlyTradesExpectedFirstTime || null,
    earlyTradesExpectedLastTime: preBuyCheckResult.earlyTradesExpectedLastTime || null,
    earlyTradesDataFirstTime: preBuyCheckResult.earlyTradesDataFirstTime || null,
    earlyTradesDataLastTime: preBuyCheckResult.earlyTradesDataLastTime || null,
    earlyTradesDataCoverage: preBuyCheckResult.earlyTradesDataCoverage || 0,
    earlyTradesActualSpan: preBuyCheckResult.earlyTradesActualSpan || 0,
    earlyTradesRateCalcWindow: preBuyCheckResult.earlyTradesRateCalcWindow || 1,
    earlyTradesVolumePerMin: preBuyCheckResult.earlyTradesVolumePerMin || 0,
    earlyTradesCountPerMin: preBuyCheckResult.earlyTradesCountPerMin || 0,
    earlyTradesWalletsPerMin: preBuyCheckResult.earlyTradesWalletsPerMin || 0,
    earlyTradesHighValuePerMin: preBuyCheckResult.earlyTradesHighValuePerMin || 0,
    earlyTradesTotalCount: preBuyCheckResult.earlyTradesTotalCount || 0,
    earlyTradesVolume: preBuyCheckResult.earlyTradesVolume || 0,
    earlyTradesUniqueWallets: preBuyCheckResult.earlyTradesUniqueWallets || 0,
    earlyTradesHighValueCount: preBuyCheckResult.earlyTradesHighValueCount || 0,
    earlyTradesFilteredCount: preBuyCheckResult.earlyTradesFilteredCount || 0,
    // 钱包簇检查因子
    walletClusterBlockThreshold: preBuyCheckResult.walletClusterBlockThreshold || null,
    walletClusterMethod: preBuyCheckResult.walletClusterMethod || null,
    walletClusterCount: preBuyCheckResult.walletClusterCount || 0,
    walletClusterMaxSize: preBuyCheckResult.walletClusterMaxSize || 0,
    walletClusterSecondToFirstRatio: preBuyCheckResult.walletClusterSecondToFirstRatio || 0,
    walletClusterTop2Ratio: preBuyCheckResult.walletClusterTop2Ratio || 0,
    walletClusterMegaRatio: preBuyCheckResult.walletClusterMegaRatio || 0,
    walletClusterMaxClusterWallets: preBuyCheckResult.walletClusterMaxClusterWallets || 0,
    // 最大区块买入金额占比因子
    walletClusterMaxBlockBuyRatio: preBuyCheckResult.walletClusterMaxBlockBuyRatio || 0,
    walletClusterMaxBlockNumber: preBuyCheckResult.walletClusterMaxBlockNumber || null,
    walletClusterMaxBlockBuyAmount: preBuyCheckResult.walletClusterMaxBlockBuyAmount || 0,
    walletClusterTotalBuyAmount: preBuyCheckResult.walletClusterTotalBuyAmount || 0
  };
}

/**
 * 从时序数据构建常规因子对象
 * @param {Object} factorValues - 时序数据中的 factor_values
 * @param {Object} tokenState - 代币状态
 * @param {number} priceUsd - 当前价格
 * @param {number} timestamp - 时间戳
 * @returns {Object} 常规因子对象
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
    // 趋势因子（从时序数据中读取，固定窗口8个点）
    trendCV: fv.trendCV ?? null,
    trendPriceUp: fv.trendPriceUp ?? 0,
    trendMedianUp: fv.trendMedianUp ?? 0,
    trendStrengthScore: fv.trendStrengthScore ?? null,
    trendTotalReturn: fv.trendTotalReturn ?? null,
    trendRiseRatio: fv.trendRiseRatio ?? null,
    trendSlope: fv.trendSlope ?? null,
    trendDataPoints: fv.trendDataPoints ?? null,
    trendRecentDownCount: fv.trendRecentDownCount ?? null,
    trendRecentDownRatio: fv.trendRecentDownRatio ?? null,
    trendConsecutiveDowns: fv.trendConsecutiveDowns ?? null
  };
}

/**
 * 获取所有可用的常规因子ID列表
 * 注意：购买前置检查因子不在此列表中，它们只存储在信号 metadata 中
 * @returns {Set<string>} 常规因子ID集合
 */
function getAvailableFactorIds() {
  return new Set([
    // 基础因子
    'age', 'currentPrice', 'collectionPrice', 'earlyReturn', 'buyPrice',
    'holdDuration', 'profitPercent',
    'highestPrice', 'highestPriceTimestamp', 'drawdownFromHighest',
    'txVolumeU24h', 'holders', 'tvl', 'fdv', 'marketCap',
    // 趋势因子（固定窗口8个点）
    'trendCV', 'trendPriceUp', 'trendMedianUp', 'trendStrengthScore',
    'trendTotalReturn', 'trendRiseRatio', 'trendSlope', 'trendDataPoints',
    'trendRecentDownCount', 'trendRecentDownRatio', 'trendConsecutiveDowns'
  ]);
}

module.exports = {
  buildFactorValuesForTimeSeries,
  buildPreBuyCheckFactorValues,
  buildFactorsFromTimeSeries,
  getAvailableFactorIds
};
