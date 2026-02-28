/**
 * 拉高砸盘检测器
 *
 * 检测代币价格是否存在"拉高砸盘" (pump and dump) 模式
 * 基于价格时序数据的形态分析，而非简单的数值阈值
 */
class PumpDumpDetector {
  constructor(config = {}) {
    // 各指标的阈值
    this.thresholds = {
      pai: config.paiThreshold ?? 0.3,      // 价格加速度阈值
      pci: config.pciThreshold ?? 0.7,      // 价格集中度阈值
      pwi: config.pwiThreshold ?? 0.5,      // 回落预警阈值
      pdr: config.pdrThreshold ?? 0.15,     // 价格离散度阈值
      bspr: config.bsprThreshold ?? 0.4     // 买卖压力比阈值
    };

    // 各指标的权重
    this.weights = {
      pai: config.paiWeight ?? 25,
      pci: config.pciWeight ?? 30,
      pwi: config.pwiWeight ?? 25,
      pdr: config.pdrWeight ?? 10,
      bspr: config.bsprWeight ?? 10
    };
  }

  /**
   * 检测拉高砸盘风险
   * @param {Array} prices - 价格时序数组
   * @param {Array} klines - K线数据（可选，用于计算买卖压力）
   * @returns {Object} 风险评分结果
   */
  detect(prices, klines = null) {
    if (!prices || prices.length < 6) {
      return {
        risk: 0,
        level: 'LOW',
        reason: 'insufficient_data',
        details: null
      };
    }

    // 计算各项指标
    const pai = this._calculatePAI(prices);
    const pci = this._calculatePCI(prices);
    const pwi = this._calculatePWI(prices);
    const pdr = this._calculatePDR(prices);
    const bspr = klines ? this._calculateBSPR(klines) : 0.5; // 默认中性

    // 计算综合风险分数 (0-100)
    let risk = 0;
    const reasons = [];

    if (pai > this.thresholds.pai) {
      risk += this.weights.pai;
      reasons.push(`PAI=${pai.toFixed(3)} > ${this.thresholds.pai} (异常加速拉升)`);
    }

    if (pci > this.thresholds.pci) {
      risk += this.weights.pci;
      reasons.push(`PCI=${pci.toFixed(3)} > ${this.thresholds.pci} (涨幅过于集中)`);
    }

    if (pwi > this.thresholds.pwi) {
      risk += this.weights.pwi;
      reasons.push(`PWI=${pwi.toFixed(3)} > ${this.thresholds.pwi} (峰值后快速回落)`);
    }

    if (pdr > this.thresholds.pdr) {
      risk += this.weights.pdr;
      reasons.push(`PDR=${pdr.toFixed(3)} > ${this.thresholds.pdr} (价格偏离趋势)`);
    }

    if (bspr < this.thresholds.bspr) {
      risk += this.weights.bspr;
      reasons.push(`BSPR=${bspr.toFixed(3)} < ${this.thresholds.bspr} (卖压过大)`);
    }

    return {
      risk: Math.min(100, risk),
      level: risk > 60 ? 'HIGH' : risk > 30 ? 'MEDIUM' : 'LOW',
      details: { pai, pci, pwi, pdr, bspr },
      reasons: reasons.length > 0 ? reasons : ['无异常']
    };
  }

  /**
   * 价格加速度指标 (Price Acceleration Index)
   * 检测是否有异常的加速拉升
   */
  _calculatePAI(prices) {
    if (prices.length < 3) return 0;

    // 计算每段时间的价格变化率
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      const ret = (prices[i] - prices[i-1]) / prices[i-1];
      returns.push(ret);
    }

    // 计算加速度（二阶导数）
    const accelerations = [];
    for (let i = 1; i < returns.length; i++) {
      accelerations.push(returns[i] - returns[i-1]);
    }

    // 正加速度占比（使用2%作为阈值）
    const threshold = 0.02;
    const positiveAccel = accelerations.filter(a => a > threshold).length;
    return accelerations.length > 0 ? positiveAccel / accelerations.length : 0;
  }

  /**
   * 价格集中度指标 (Price Concentration Index)
   * 检测涨幅是否集中在少数时间点
   */
  _calculatePCI(prices) {
    if (prices.length < 2) return 0;

    const totalGain = (prices[prices.length-1] - prices[0]) / prices[0];
    if (totalGain <= 0) return 0;

    // 计算每个点的涨幅占比
    const pointGains = [];
    for (let i = 1; i < prices.length; i++) {
      const pointGain = (prices[i] - prices[i-1]) / prices[0];
      pointGains.push(pointGain);
    }

    // 排序后看前30%的点贡献了多少涨幅
    pointGains.sort((a, b) => b - a);
    const top30 = Math.max(1, Math.ceil(pointGains.length * 0.3));
    const top30Gain = pointGains.slice(0, top30).reduce((s, v) => s + v, 0);

    return totalGain > 0 ? top30Gain / totalGain : 0;
  }

  /**
   * 回落预警指标 (Pullback Warning Index)
   * 检测峰值后是否快速回落
   */
  _calculatePWI(prices, window = 5) {
    if (prices.length < window * 2) return 0;

    // 计算每个滚动窗口的涨跌幅
    const windowReturns = [];
    for (let i = window; i < prices.length; i++) {
      const windowStart = prices[i - window];
      const windowEnd = prices[i];
      const ret = (windowEnd - windowStart) / windowStart;
      windowReturns.push(ret);
    }

    if (windowReturns.length < 2) return 0;

    // 找出最大涨幅的位置
    let maxGainIdx = 0;
    let maxGain = windowReturns[0];
    for (let i = 1; i < windowReturns.length; i++) {
      if (windowReturns[i] > maxGain) {
        maxGain = windowReturns[i];
        maxGainIdx = i;
      }
    }

    // 计算峰值后的平均回落
    const afterPeakReturns = windowReturns.slice(maxGainIdx + 1);
    if (afterPeakReturns.length === 0) return 0;

    const avgAfterPeak = afterPeakReturns.reduce((s, v) => s + v, 0) / afterPeakReturns.length;

    return maxGain > 0 ? Math.max(0, -avgAfterPeak / maxGain) : 0;
  }

  /**
   * 价格离散度比 (Price Dispersion Ratio)
   * 检测价格是否偏离线性趋势
   */
  _calculatePDR(prices) {
    const n = prices.length;
    if (n < 3) return 0;

    const meanY = prices.reduce((s, v) => s + v, 0) / n;
    if (meanY === 0) return 0;

    const meanX = (n - 1) / 2;

    // 线性回归
    let sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumXY += (i - meanX) * (prices[i] - meanY);
      sumX2 += (i - meanX) ** 2;
    }

    const slope = sumX2 > 0 ? sumXY / sumX2 : 0;
    const intercept = meanY - slope * meanX;

    // 计算残差
    const residuals = prices.map((p, i) => p - (slope * i + intercept));
    const residualStd = Math.sqrt(residuals.reduce((s, r) => s + r ** 2, 0) / n);

    return residualStd / meanY;
  }

  /**
   * 买卖压力比 (Buy-Sell Pressure Ratio)
   * 基于K线计算买卖盘压力
   */
  _calculateBSPR(klines) {
    if (!klines || klines.length === 0) return 0.5;

    let buyPressure = 0, sellPressure = 0;

    for (const kline of klines) {
      const wick = kline.high - kline.low;
      if (wick === 0) continue;

      const body = Math.abs(kline.close - kline.open);

      if (kline.close > kline.open) {
        // 阳线：买压
        buyPressure += body / wick;
      } else {
        // 阴线：卖压
        sellPressure += body / wick;
      }
    }

    const total = buyPressure + sellPressure;
    return total > 0 ? buyPressure / total : 0.5;
  }
}

module.exports = PumpDumpDetector;
