/**
 * 持有者趋势检测器
 * 检测代币持有者数量的变化趋势
 * 与 TrendDetector 类似，但针对持有者数据特点进行了调整
 */
class HolderTrendDetector {
  /**
   * @param {Object} config - 配置
   * @param {number} config.minDataPoints - 最小数据点数，默认6
   * @param {number} config.maxDataPoints - 最大数据点数，默认Infinity（不限制）
   * @param {number} config.cvThreshold - CV阈值，默认0.02（2%，持有者数据更稳定，阈值比价格高）
   * @param {number} config.scoreThreshold - 趋势强度评分阈值，默认30
   * @param {number} config.growthRatioThreshold - 增长率阈值，默认3（%）
   * @param {number} config.riseRatioThreshold - 增长占比阈值，默认0.5（50%）
   * @param {number} config.minSlopeThreshold - 最小相对斜率阈值
   */
  constructor(config = {}) {
    this.minDataPoints = config.minDataPoints || 6;
    this.maxDataPoints = config.maxDataPoints || Infinity;
    this.cvThreshold = config.cvThreshold ?? 0.02; // 持有者变化更稳定，阈值更高
    this.scoreThreshold = config.scoreThreshold ?? 30;
    this.growthRatioThreshold = config.growthRatioThreshold ?? 3; // 3%增长
    this.riseRatioThreshold = config.riseRatioThreshold ?? 0.5;
    this.minSlopeThreshold = config.minSlopeThreshold ?? 0.01;
  }

  /**
   * 检测趋势（滑动窗口）
   * @param {Array<number>} holderCounts - 持有者数量数组
   * @returns {Object} 检测结果
   */
  detect(holderCounts) {
    if (!holderCounts || holderCounts.length < this.minDataPoints) {
      return {
        passed: false,
        reason: 'insufficient_data',
        dataPoints: holderCounts?.length || 0
      };
    }

    // 滑动窗口检测：从 minDataPoints 到 maxDataPoints
    const maxCheck = Math.min(this.maxDataPoints, holderCounts.length);

    for (let dp = this.minDataPoints; dp <= maxCheck; dp++) {
      const checkCounts = holderCounts.slice(0, dp);
      const result = this._fourStepMethod(checkCounts);

      if (result.passed) {
        return {
          passed: true,
          firstPassPoint: dp,
          score: result.details.score,
          growthRatio: result.details.growthRatio,
          riseRatio: result.details.riseRatio,
          cv: result.details.cv,
          direction: result.details.direction
        };
      }
    }

    // 未通过，返回最后一次检测的详细信息（用于调试）
    const lastResult = this._fourStepMethod(holderCounts.slice(0, maxCheck));
    return {
      passed: false,
      reason: 'not_passed',
      dataPoints: maxCheck,
      lastStep: lastResult.step,
      score: lastResult.details?.score || 0,
      growthRatio: lastResult.details?.growthRatio || 0,
      riseRatio: lastResult.details?.riseRatio || 0,
      cv: lastResult.details?.cv || 0,
      direction: lastResult.details?.direction || 0
    };
  }

  /**
   * 四步法检测
   * @param {Array<number>} holderCounts - 持有者数量数组
   * @returns {Object} 检测结果
   */
  _fourStepMethod(holderCounts) {
    // 第一步：噪音过滤 (CV > 2%)
    const cv = this._calculateCV(holderCounts);
    if (cv <= this.cvThreshold) {
      return {
        passed: false,
        step: 1,
        details: { cv }
      };
    }

    // 第二步：方向确认 (>= 2/3)
    const direction = this._confirmDirection(holderCounts);
    if (direction.passed < 2) {
      return {
        passed: false,
        step: 2,
        details: { cv, direction: direction.passed }
      };
    }

    // 第三步：强度验证 (score >= 30)
    const strength = this._calculateTrendStrength(holderCounts);
    if (strength.score < this.scoreThreshold) {
      return {
        passed: false,
        step: 3,
        details: { cv, direction: direction.passed, score: strength.score }
      };
    }

    // 第四步：质量筛选 (增长率 > 3% 且增长占比 > 50%)
    if (strength.details.growthRatio <= this.growthRatioThreshold ||
        strength.details.riseRatio <= this.riseRatioThreshold) {
      return {
        passed: false,
        step: 4,
        details: {
          cv,
          direction: direction.passed,
          score: strength.score,
          growthRatio: strength.details.growthRatio,
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
        growthRatio: strength.details.growthRatio,
        riseRatio: strength.details.riseRatio
      }
    };
  }

  /**
   * 计算变异系数 (CV)
   * CV = 标准差 / 均值
   */
  _calculateCV(holderCounts) {
    const n = holderCounts.length;
    if (n < 2) return 0;

    const mean = holderCounts.reduce((a, b) => a + b, 0) / n;
    if (mean === 0) return 0;

    const variance = holderCounts.reduce((a, c) => a + Math.pow(c - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    return stdDev / mean;
  }

  /**
   * 计算线性回归斜率
   */
  _calculateLinearRegressionSlope(holderCounts) {
    const n = holderCounts.length;
    if (n < 2) return 0;

    const sumX = (n - 1) * n / 2;
    const sumY = holderCounts.reduce((a, b) => a + b, 0);
    const sumXY = holderCounts.reduce((a, c, i) => a + i * c, 0);
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
   * 返回2个独立指标（1=通过/正值，0=不通过/负值）：持有者数量增加、中位数上升
   * 使用固定窗口：最多8个点，最少4个点
   */
  _confirmDirection(holderCounts) {
    // 固定窗口：只使用最近8个点
    const maxPoints = 8;
    const minPoints = 4;

    if (holderCounts.length < minPoints) {
      return {
        holderCountUp: 0,
        holderMedianUp: 0,
        relativeSlope: 0
      };
    }

    // 只取最近8个点（如果超过8个），否则使用全部点
    const recentCounts = holderCounts.slice(-maxPoints);
    const n = recentCounts.length;

    // 计算斜率
    const slope = this._calculateLinearRegressionSlope(recentCounts);
    const avgCount = recentCounts.reduce((a, b) => a + b, 0) / n;
    const relativeSlope = avgCount > 0 ? slope / avgCount : 0;

    // 方法2：最新持有者数量 > 初始持有者数量
    const holderCountUp = recentCounts[n - 1] > recentCounts[0] ? 1 : 0;

    // 方法3：后半部分中位数 > 前半部分中位数
    const mid = Math.floor(n / 2);
    const firstHalfMedian = this._median(recentCounts.slice(0, mid));
    const secondHalfMedian = this._median(recentCounts.slice(mid));
    const holderMedianUp = secondHalfMedian > firstHalfMedian ? 1 : 0;

    return {
      holderCountUp,
      holderMedianUp,
      relativeSlope
    };
  }

  /**
   * 计算趋势强度评分（第三步）
   * 使用固定窗口：最多8个点，最少4个点
   */
  _calculateTrendStrength(holderCounts) {
    // 固定窗口：只使用最近8个点
    const maxPoints = 8;
    const minPoints = 4;

    if (holderCounts.length < minPoints) {
      return { score: 0, details: {} };
    }

    // 只取最近8个点（如果超过8个），否则使用全部点
    const recentCounts = holderCounts.slice(-maxPoints);
    const n = recentCounts.length;

    const avgCount = recentCounts.reduce((a, b) => a + b, 0) / n;
    const slope = this._calculateLinearRegressionSlope(recentCounts);

    // 归一化斜率（相对于平均持有者数量的百分比变化率）
    const normalizedSlope = (slope / avgCount) * 100;

    // 增长率
    const growthRatio = ((recentCounts[n - 1] - recentCounts[0]) / recentCounts[0]) * 100;

    // 增长次数占比
    let riseCount = 0;
    for (let i = 1; i < n; i++) {
      if (recentCounts[i] > recentCounts[i - 1]) riseCount++;
    }
    const riseRatio = riseCount / (n - 1);

    // CV
    const cv = this._calculateCV(recentCounts);

    // 各项评分
    const slopeScore = Math.min(Math.abs(normalizedSlope) * 500, 100); // 斜率权重更大
    const growthScore = Math.min(Math.abs(growthRatio) * 20, 100);
    const consistencyScore = riseRatio * 100;
    const stabilityScore = Math.max((1 - cv * 20) * 100, 0);

    // 方向乘数（负增长时大幅降低评分）
    let directionMultiplier = 1;
    if (growthRatio < 0) directionMultiplier = 0.3;
    else if (growthRatio === 0) directionMultiplier = 0.1;

    // 最终评分（加权平均）
    const finalScore = (
      slopeScore * 0.3 +
      growthScore * 0.3 +
      consistencyScore * 0.2 +
      stabilityScore * 0.2
    ) * directionMultiplier;

    return {
      score: finalScore,
      details: {
        normalizedSlope,
        growthRatio,
        riseRatio,
        cv
      }
    };
  }

  /**
   * 计算持有者减少的统计（用于卖出信号）
   * @param {Array<number>} holderCounts - 持有者数量数组
   * @returns {Object} 减少统计信息
   */
  calculateDecreaseStats(holderCounts) {
    if (!holderCounts || holderCounts.length < 2) {
      return {
        decreaseCount: 0,
        decreaseRatio: 0,
        consecutiveDecreases: 0,
        recentDecreaseCount: 0,
        recentDecreaseRatio: 0
      };
    }

    const n = holderCounts.length;
    const checkSize = Math.min(5, n); // 检查最近5个点

    // 总体减少统计
    let decreaseCount = 0;
    let maxConsecutiveDecreases = 0;
    let currentConsecutiveDecreases = 0;

    for (let i = 1; i < n; i++) {
      if (holderCounts[i] < holderCounts[i - 1]) {
        decreaseCount++;
        currentConsecutiveDecreases++;
        maxConsecutiveDecreases = Math.max(maxConsecutiveDecreases, currentConsecutiveDecreases);
      } else {
        currentConsecutiveDecreases = 0;
      }
    }

    const decreaseRatio = decreaseCount / (n - 1);

    // 最近减少统计
    const recentCounts = holderCounts.slice(-checkSize);
    let recentDecreaseCount = 0;
    for (let i = 1; i < recentCounts.length; i++) {
      if (recentCounts[i] < recentCounts[i - 1]) {
        recentDecreaseCount++;
      }
    }
    const recentDecreaseRatio = recentDecreaseCount / Math.max(1, recentCounts.length - 1);

    return {
      decreaseCount,
      decreaseRatio,
      consecutiveDecreases: maxConsecutiveDecreases,
      recentDecreaseCount,
      recentDecreaseRatio
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
    if (config.growthRatioThreshold !== undefined) this.growthRatioThreshold = config.growthRatioThreshold;
    if (config.riseRatioThreshold !== undefined) this.riseRatioThreshold = config.riseRatioThreshold;
  }
}

module.exports = HolderTrendDetector;
