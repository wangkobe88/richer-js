/**
 * 因子计算器
 * 计算和比较各种交易因子
 */

class FactorCalculator {
  /**
   * 计算因子的平均值
   */
  static average(items, key) {
    if (items.length === 0) return 0;
    const sum = items.reduce((acc, item) => acc + (item[key] || 0), 0);
    return sum / items.length;
  }

  /**
   * 计算因子的中位数
   */
  static median(items, key) {
    if (items.length === 0) return 0;
    const values = items.map(item => item[key] || 0).sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    return values.length % 2 === 0
      ? (values[mid - 1] + values[mid]) / 2
      : values[mid];
  }

  /**
   * 计算因子的最大值和最小值
   */
  static range(items, key) {
    if (items.length === 0) return { min: 0, max: 0 };
    const values = items.map(item => item[key] || 0);
    return {
      min: Math.min(...values),
      max: Math.max(...values)
    };
  }

  /**
   * 比较两组数据的因子差异
   */
  static compareFactors(groupA, groupB, factorKeys) {
    const comparison = [];

    factorKeys.forEach(({ key, name }) => {
      const avgA = this.average(groupA, key);
      const avgB = this.average(groupB, key);
      const diff = avgA - avgB;
      const diffPercent = avgB !== 0 ? (diff / avgB * 100) : 0;

      comparison.push({
        key,
        name,
        avgA,
        avgB,
        diff,
        diffPercent
      });
    });

    // 按差异绝对值排序
    comparison.sort((a, b) => Math.abs(b.diffPercent) - Math.abs(a.diffPercent));

    return comparison;
  }

  /**
   * 分析因子阈值效果
   */
  static analyzeThresholdEffect(items, factorKey, thresholds, profitKey = 'profitPercent') {
    const results = [];

    thresholds.forEach(threshold => {
      let filtered;
      let label;

      if (typeof threshold === 'object') {
        if (threshold.min !== undefined && threshold.max !== undefined) {
          filtered = items.filter(item => {
            const value = item[factorKey] || 0;
            return value >= threshold.min && value < threshold.max;
          });
          label = `${threshold.min} ~ ${threshold.max}`;
        } else if (threshold.min !== undefined) {
          filtered = items.filter(item => (item[factorKey] || 0) >= threshold.min);
          label = `>= ${threshold.min}`;
        } else if (threshold.max !== undefined) {
          filtered = items.filter(item => (item[factorKey] || 0) < threshold.max);
          label = `< ${threshold.max}`;
        }
      } else {
        filtered = items.filter(item => (item[factorKey] || 0) >= threshold);
        label = `>= ${threshold}`;
      }

      if (filtered.length === 0) return;

      const avgProfit = this.average(filtered, profitKey);
      const totalProfit = filtered.reduce((sum, item) => sum + (item[profitKey] || 0), 0);
      const winRate = (filtered.filter(item => (item[profitKey] || 0) > 0).length / filtered.length * 100);

      results.push({
        label,
        count: filtered.length,
        avgProfit,
        totalProfit,
        winRate
      });
    });

    return results;
  }

  /**
   * 测试组合条件的效果
   */
  static testComboFilters(items, filters) {
    const results = [];

    filters.forEach(({ name, condition }) => {
      const filtered = items.filter(condition);

      if (filtered.length === 0) return;

      const avgProfit = this.average(filtered, 'profitPercent');
      const totalProfit = filtered.reduce((sum, item) => sum + (item.profitPercent || 0), 0);
      const winRate = (filtered.filter(item => (item.profitPercent || 0) > 0).length / filtered.length * 100);

      results.push({
        name,
        count: filtered.length,
        avgProfit,
        totalProfit,
        winRate
      });
    });

    return results;
  }

  /**
   * 找出最优阈值
   */
  static findOptimalThreshold(items, factorKey, profitKey = 'profitPercent', direction = 'higher') {
    const values = items.map(item => item[factorKey] || 0).filter(v => v > 0);
    if (values.length === 0) return null;

    const uniqueValues = [...new Set(values)].sort((a, b) => a - b);

    let bestThreshold = null;
    let bestScore = -Infinity;

    uniqueValues.forEach(value => {
      const filtered = items.filter(item => {
        const itemValue = item[factorKey] || 0;
        return direction === 'higher' ? itemValue >= value : itemValue <= value;
      });

      if (filtered.length < 3) return;  // 至少需要3个样本

      const avgProfit = this.average(filtered, profitKey);
      const score = avgProfit * (filtered.length / items.length);  // 考虑样本数量

      if (score > bestScore) {
        bestScore = score;
        bestThreshold = value;
      }
    });

    return { threshold: bestThreshold, score: bestScore };
  }
}

module.exports = { FactorCalculator };
