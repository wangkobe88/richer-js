/**
 * 漏掉的好票分析器
 * 找出应该买但没买的代币，分析原因
 */

const { AnalyzerBase } = require('../core/analyzer-base');
const { TokenClassifier } = require('../utils/token-classifier');
const { SignalFilter } = require('../utils/signal-filter');

class MissedOpportunitiesAnalyzer extends AnalyzerBase {
  async analyze(options = {}) {
    const {
      minHighestReturn = 100,
      requireNonFakePump = true,
      requireNonLowQuality = false
    } = options;

    const trades = await this.dataLoader.getTrades();
    const tokens = await this.dataLoader.getTokens();
    const signals = await this.dataLoader.getSignals();

    // 找出被交易过的代币
    const tradedAddresses = new Set(trades.map(t => t.token_address));

    // 找出所有好票（高涨幅 + 非流水盘 + 未被交易）
    const goodTokens = tokens.filter(token => {
      // 必须是高涨幅
      if (!TokenClassifier.isGoodToken(token, { minHighestReturn, requireNonFakePump, requireNonLowQuality })) {
        return false;
      }
      // 必须没有被交易过
      return !tradedAddresses.has(token.token_address);
    });

    // 分析每个好票漏掉的原因
    const analyzedGoodTokens = [];

    for (const token of goodTokens) {
      const missedAnalysis = SignalFilter.analyzeMissedReason(token, signals, null);

      let detailedReason = '';
      let suggestion = '';

      if (missedAnalysis.reason === 'no_signal') {
        // 需要分析时序数据，看为什么没触发信号
        // 这里暂时简化处理
        detailedReason = '买入信号未触发';
        suggestion = '需要分析时序数据查看因子变化';

        // 尝试获取时序数据进行深入分析
        try {
          const timeSeriesData = await this.dataLoader.getTimeSeries(token.token_address);
          if (timeSeriesData && timeSeriesData.length > 0) {
            const factorAnalysis = this.analyzeWhyNoSignal(timeSeriesData);
            detailedReason = factorAnalysis.reason;
            suggestion = factorAnalysis.suggestion;
          }
        } catch (e) {
          // 时序数据获取失败，使用默认说明
        }
      } else if (missedAnalysis.reason === 'signal_rejected') {
        detailedReason = `买入信号被拒绝: ${missedAnalysis.description}`;
        suggestion = missedAnalysis.suggestion;

        // 获取被拒绝信号的具体原因
        const buySignals = SignalFilter.getBuySignals(signals, token.token_address);
        const rejectedSignals = buySignals.filter(s => SignalFilter.isRejectedSignal(s));

        if (rejectedSignals.length > 0) {
          const preBuyCheck = SignalFilter.analyzePreBuyCheck(rejectedSignals[0]);
          if (preBuyCheck.reason) {
            detailedReason = `预检查拒绝: ${preBuyCheck.reason}`;
          }
        }
      }

      analyzedGoodTokens.push({
        symbol: token.token_symbol || token.token_address.slice(0, 8),
        tokenAddress: token.token_address,
        highestReturn: token.highest_return || token.highestReturn || 0,
        qualityLabel: TokenClassifier.getQualityLabel(token),
        missedReason: missedAnalysis.reason,
        detailedReason,
        suggestion
      });
    }

    // 按最高涨幅排序
    analyzedGoodTokens.sort((a, b) => b.highestReturn - a.highestReturn);

    // 统计
    const totalMissed = analyzedGoodTokens.length;
    const byReason = {};
    analyzedGoodTokens.forEach(t => {
      byReason[t.missedReason] = (byReason[t.missedReason] || 0) + 1;
    });

    this.results = {
      totalMissed,
      byReason,
      goodTokens: analyzedGoodTokens
    };

    return this.results;
  }

  /**
   * 分析为什么没有触发信号
   */
  analyzeWhyNoSignal(timeSeriesData) {
    // 获取最近的数据点
    const recentData = timeSeriesData.slice(-10);

    if (recentData.length === 0) {
      return {
        reason: '无时序数据',
        suggestion: '无法分析'
      };
    }

    // 检查常见的购买条件
    const latest = recentData[recentData.length - 1];
    const factors = latest.factors || latest.trendFactors || {};

    const issues = [];

    // trendRiseRatio
    if ((factors.trendRiseRatio || 0) < 0.7) {
      issues.push(`trendRiseRatio不达标 (${(factors.trendRiseRatio || 0).toFixed(2)} < 0.7)`);
    }

    // age
    if ((factors.age || 0) < 1.2) {
      issues.push(`age未达标 (${(factors.age || 0).toFixed(2)} < 1.2)`);
    }
    if ((factors.age || 0) > 10) {
      issues.push(`age过大 (${(factors.age || 0).toFixed(2)} > 10)`);
    }

    // earlyReturn
    if ((factors.earlyReturn || 0) < 15) {
      issues.push(`earlyReturn过低 (${(factors.earlyReturn || 0).toFixed(1)} < 15)`);
    }

    // drawdownFromHighest
    if ((factors.drawdownFromHighest || 0) < -25) {
      issues.push(`回撤过大 (${(factors.drawdownFromHighest || 0).toFixed(1)} < -25)`);
    }

    // trendCV
    if ((factors.trendCV || 0) < 0.02) {
      issues.push(`trendCV过低 (${(factors.trendCV || 0).toFixed(3)} < 0.02)`);
    }

    if (issues.length > 0) {
      return {
        reason: '条件不满足: ' + issues.join(', '),
        suggestion: '可以考虑调整相关因子的阈值'
      };
    }

    return {
      reason: '未知原因',
      suggestion: '需要更详细的分析'
    };
  }

  formatReport() {
    const r = this.results;

    if (r.totalMissed === 0) {
      return '【漏掉的好票】\n\n  🎉 太棒了！没有漏掉明显的好票！\n';
    }

    let output = '';

    output += `【漏掉的好票】共 ${r.totalMissed} 个\n\n`;

    output += '漏掉原因统计:\n';
    Object.entries(r.byReason).forEach(([reason, count]) => {
      const label = {
        'no_signal': '信号未触发',
        'signal_rejected': '信号被拒绝',
        'unknown': '未知原因'
      }[reason] || reason;
      output += `  ${label}: ${count} 个\n`;
    });
    output += '\n';

    output += '详细列表:\n\n';
    output += '  代币              最高涨幅  质量  漏掉原因    详细原因\n';
    output += '  ' + '─'.repeat(70) + '\n';

    r.goodTokens.forEach(t => {
      const qualityBadge = `${t.qualityLabel.emoji}${t.qualityLabel.label}`;
      const reasonLabel = {
        'no_signal': '信号未触发',
        'signal_rejected': '信号被拒绝',
        'unknown': '未知原因'
      }[t.missedReason] || t.missedReason;

      output += `  ${t.symbol.padEnd(16)} +${t.highestReturn.toFixed(1).padStart(6)}%  ${qualityBadge.padEnd(8)} ${reasonLabel.padEnd(12)}\n`;
      output += `    └─ ${t.detailedReason}\n`;
      output += `    └─ 建议: ${t.suggestion}\n\n`;
    });

    return output;
  }
}

module.exports = { MissedOpportunitiesAnalyzer };
