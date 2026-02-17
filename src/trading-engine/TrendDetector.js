/**
 * 趋势检测器
 * 使用四步法检测代币是否形成上升趋势
 */
class TrendDetector {
  /**
   * @param {Object} config - 配置
   * @param {number} config.minDataPoints - 最小数据点数，默认6
   * @param {number} config.maxDataPoints - 最大数据点数，默认Infinity（不限制）
   * @param {number} config.cvThreshold - CV阈值，默认0.005（0.5%）
   * @param {number} config.scoreThreshold - 趋势强度评分阈值，默认30
   * @param {number} config.totalReturnThreshold - 总涨幅阈值，默认5（%）
   * @param {number} config.riseRatioThreshold - 上涨占比阈值，默认0.5（50%）
   */
  constructor(config = {}) {
    this.minDataPoints = config.minDataPoints || 6;
    this.maxDataPoints = config.maxDataPoints || Infinity;
    this.cvThreshold = config.cvThreshold ?? 0.005;
    this.scoreThreshold = config.scoreThreshold ?? 30;
    this.totalReturnThreshold = config.totalReturnThreshold ?? 5;
    this.riseRatioThreshold = config.riseRatioThreshold ?? 0.5;
  }

  /**
   * 检测趋势（四步法，滑动窗口）
   * @param {Array<number>} prices - 价格数组
   * @returns {Object} 检测结果
   */
  detect(prices) {
    if (!prices || prices.length < this.minDataPoints) {
      return {
        passed: false,
        reason: 'insufficient_data',
        dataPoints: prices?.length || 0
      };
    }

    // 滑动窗口检测：从 minDataPoints 到 maxDataPoints
    const maxCheck = Math.min(this.maxDataPoints, prices.length);

    for (let dp = this.minDataPoints; dp <= maxCheck; dp++) {
      const checkPrices = prices.slice(0, dp);
      const result = this._fourStepMethod(checkPrices);

      if (result.passed) {
        return {
          passed: true,
          firstPassPoint: dp,
          score: result.details.score,
          totalReturn: result.details.totalReturn,
          riseRatio: result.details.riseRatio,
          cv: result.details.cv,
          direction: result.details.direction
        };
      }
    }

    // 未通过，返回最后一次检测的详细信息（用于调试）
    const lastResult = this._fourStepMethod(prices.slice(0, maxCheck));
    return {
      passed: false,
      reason: 'not_passed',
      dataPoints: maxCheck,
      lastStep: lastResult.step,
      score: lastResult.details?.score || 0,
      totalReturn: lastResult.details?.totalReturn || 0,
      riseRatio: lastResult.details?.riseRatio || 0,
      cv: lastResult.details?.cv || 0,
      direction: lastResult.details?.direction || 0
    };
  }

  /**
   * 四步法检测
   * @param {Array<number>} prices - 价格数组
   * @returns {Object} 检测结果
   */
  _fourStepMethod(prices) {
    // 第一步：噪音过滤 (CV > 0.5%)
    const cv = this._calculateCV(prices);
    if (cv <= this.cvThreshold) {
      return {
        passed: false,
        step: 1,
        details: { cv }
      };
    }

    // 第二步：方向确认 (>= 2/3)
    const direction = this._confirmDirection(prices);
    if (direction.passed < 2) {
      return {
        passed: false,
        step: 2,
        details: { cv, direction: direction.passed }
      };
    }

    // 第三步：强度验证 (score >= 30)
    const strength = this._calculateTrendStrength(prices);
    if (strength.score < this.scoreThreshold) {
      return {
        passed: false,
        step: 3,
        details: { cv, direction: direction.passed, score: strength.score }
      };
    }

    // 第四步：质量筛选 (涨幅 > 5% 且上涨占比 > 50%)
    if (strength.details.totalReturn <= this.totalReturnThreshold ||
        strength.details.riseRatio <= this.riseRatioThreshold) {
      return {
        passed: false,
        step: 4,
        details: {
          cv,
          direction: direction.passed,
          score: strength.score,
          totalReturn: strength.details.totalReturn,
          riseRatio: strength.details.riseRatio
        }
      };
    }

    return {
      passed: true,
      details: {
        cv,
        direction: direction.passed,
        score: strength.score,
        totalReturn: strength.details.totalReturn,
        riseRatio: strength.details.riseRatio
      }
    };
  }

  /**
   * 计算变异系数 (CV)
   * CV = 标准差 / 均值
   */
  _calculateCV(prices) {
    const n = prices.length;
    if (n < 2) return 0;

    const mean = prices.reduce((a, b) => a + b, 0) / n;
    if (mean === 0) return 0;

    const variance = prices.reduce((a, p) => a + Math.pow(p - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    return stdDev / mean;
  }

  /**
   * 计算线性回归斜率
   */
  _calculateLinearRegressionSlope(prices) {
    const n = prices.length;
    if (n < 2) return 0;

    const sumX = (n - 1) * n / 2;
    const sumY = prices.reduce((a, b) => a + b, 0);
    const sumXY = prices.reduce((a, p, i) => a + i * p, 0);
    const sumX2 = (n - 1) * n * (2 * n - 1) / 6;

    const denominator = n * sumX2 - sumX * sumX;
    if (denominator === 0) return 0;

    return (n * sumXY - sumX * sumY) / denominator;
  }

  /**
   * 计算中位数
   */
  _median(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * 确认方向（第二步）
   * 三种方法：斜率、首尾价格、中位数比较
   */
  _confirmDirection(prices) {
    const n = prices.length;
    if (n < 4) return { passed: 0 };

    let passed = 0;

    // 方法1：线性回归斜率 > 0
    const slope = this._calculateLinearRegressionSlope(prices);
    if (slope > 0) passed++;

    // 方法2：最新价格 > 初始价格
    if (prices[n - 1] > prices[0]) passed++;

    // 方法3：后半部分中位数 > 前半部分中位数
    const mid = Math.floor(n / 2);
    const firstHalfMedian = this._median(prices.slice(0, mid));
    const secondHalfMedian = this._median(prices.slice(mid));
    if (secondHalfMedian > firstHalfMedian) passed++;

    return { passed };
  }

  /**
   * 计算趋势强度评分（第三步）
   */
  _calculateTrendStrength(prices) {
    const n = prices.length;
    if (n < 4) return { score: 0, details: {} };

    const avgPrice = prices.reduce((a, b) => a + b, 0) / n;
    const slope = this._calculateLinearRegressionSlope(prices);

    // 归一化斜率（相对于平均价格的百分比变化率）
    const normalizedSlope = (slope / avgPrice) * 100;

    // 总收益率
    const totalReturn = ((prices[n - 1] - prices[0]) / prices[0]) * 100;

    // 上涨次数占比
    let riseCount = 0;
    for (let i = 1; i < n; i++) {
      if (prices[i] > prices[i - 1]) riseCount++;
    }
    const riseRatio = riseCount / (n - 1);

    // CV
    const cv = this._calculateCV(prices);

    // 各项评分
    const slopeScore = Math.min(Math.abs(normalizedSlope) * 1000, 100);
    const returnScore = Math.min(Math.abs(totalReturn) * 10, 100);
    const consistencyScore = riseRatio * 100;
    const stabilityScore = Math.max((1 - cv * 10) * 100, 0);

    // 方向乘数（负收益时大幅降低评分）
    let directionMultiplier = 1;
    if (totalReturn < 0) directionMultiplier = 0.3;
    else if (totalReturn === 0) directionMultiplier = 0.1;

    // 最终评分（加权平均）
    const finalScore = (
      slopeScore * 0.3 +
      returnScore * 0.3 +
      consistencyScore * 0.2 +
      stabilityScore * 0.2
    ) * directionMultiplier;

    return {
      score: finalScore,
      details: {
        normalizedSlope,
        totalReturn,
        riseRatio,
        cv
      }
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config) {
    if (config.minDataPoints !== undefined) this.minDataPoints = config.minDataPoints;
    if (config.maxDataPoints !== undefined) this.maxDataPoints = config.maxDataPoints;
    if (config.cvThreshold !== undefined) this.cvThreshold = config.cvThreshold;
    if (config.scoreThreshold !== undefined) this.scoreThreshold = config.scoreThreshold;
    if (config.totalReturnThreshold !== undefined) this.totalReturnThreshold = config.totalReturnThreshold;
    if (config.riseRatioThreshold !== undefined) this.riseRatioThreshold = config.riseRatioThreshold;
  }
}

module.exports = TrendDetector;
