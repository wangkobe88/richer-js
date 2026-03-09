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

        // 尝试获取策略分析数据进行深入分析
        try {
          let strategyAnalysis = await this.dataLoader.getStrategyAnalysis(token.token_address, 'buy', 0);
          let usedAddress = token.token_address;

          // 如果当前地址没有数据，尝试查找同symbol的其他地址
          if (!strategyAnalysis || !strategyAnalysis.timePoints || strategyAnalysis.timePoints.length === 0) {
            const sameSymbolTokens = goodTokens.filter(t => t.token_symbol === token.token_symbol && t.token_address !== token.token_address);
            for (const altToken of sameSymbolTokens) {
              const altAnalysis = await this.dataLoader.getStrategyAnalysis(altToken.token_address, 'buy', 0);
              if (altAnalysis && altAnalysis.timePoints && altAnalysis.timePoints.length > 0) {
                strategyAnalysis = altAnalysis;
                usedAddress = altToken.token_address;
                break;
              }
            }
          }

          if (strategyAnalysis && strategyAnalysis.timePoints && strategyAnalysis.timePoints.length > 0) {
            // 有时序数据，分析为什么不触发信号
            const factorAnalysis = this.analyzeWhyNoSignal(strategyAnalysis);
            detailedReason = factorAnalysis.reason;
            suggestion = factorAnalysis.suggestion;

            // 如果使用了不同的地址，添加说明
            if (usedAddress !== token.token_address) {
              detailedReason += ` (使用同symbol代币数据)`;
            }
          } else {
            // 所有同symbol地址都没有数据
            detailedReason = '无策略分析数据';
            suggestion = '该symbol的所有代币地址都没有时序因子数据，可能未进入监控池';
          }
        } catch (e) {
          // 策略分析数据获取失败
          detailedReason = '无法获取分析数据';
          suggestion = 'API请求失败: ' + e.message;
        }
      } else if (missedAnalysis.reason === 'signal_rejected') {
        detailedReason = `买入信号被拒绝: ${missedAnalysis.description}`;
        suggestion = missedAnalysis.suggestion;

        // 获取被拒绝信号的具体原因
        const buySignals = SignalFilter.getBuySignals(signals, token.token_address);
        const rejectedSignals = buySignals.filter(s => SignalFilter.isRejectedSignal(s));

        if (rejectedSignals.length > 0) {
          const signal = rejectedSignals[0];
          const preBuyCheck = SignalFilter.analyzePreBuyCheck(signal);
          if (preBuyCheck.reason) {
            detailedReason = `预检查拒绝: ${preBuyCheck.reason}`;
          }

          // 尝试从信号元数据中获取更详细的原因
          const metadata = signal.metadata || {};
          if (metadata.execution_reason) {
            detailedReason = `预检查拒绝: ${metadata.execution_reason}`;
            suggestion = '考虑调整预检查条件，特别是钱包聚簇相关阈值';
          } else if (metadata.preBuyCheckResult && !metadata.preBuyCheckResult.canBuy) {
            detailedReason = `预检查拒绝: ${metadata.preBuyCheckResult.reason}`;
            suggestion = '考虑调整预检查条件';
          }
        }
      } else if (missedAnalysis.reason === 'unknown') {
        // 有信号但没有交易 - 检查是否被预检查拒绝
        const buySignals = SignalFilter.getBuySignals(signals, token.token_address);
        if (buySignals.length > 0) {
          const signal = buySignals[0];
          const executed = signal.executed;
          const executionStatus = signal.execution_status || signal.metadata?.execution_status;
          const executionReason = signal.execution_reason || signal.metadata?.execution_reason;

          if (executed === false && executionStatus === 'failed') {
            detailedReason = `预检查拒绝: ${executionReason || '未知原因'}`;
            suggestion = '考虑调整预检查条件';
          } else if (!executed) {
            detailedReason = `有买入信号但未执行交易`;
            suggestion = `信号状态: ${executionStatus || 'unknown'}. 需要检查交易引擎日志`;
          } else {
            detailedReason = `有买入信号但未执行交易`;
            suggestion = `信号状态: ${executionStatus || 'unknown'}, 执行: ${executed ? '是' : '否'}. 需要检查交易引擎日志`;
          }
        }
      }

      const analysisResults = token.analysis_results || token.analysisResults || {};
      const highestReturn = analysisResults.max_change_percent || token.highest_return || token.highestReturn || 0;

      analyzedGoodTokens.push({
        symbol: token.token_symbol || token.token_address.slice(0, 8),
        tokenAddress: token.token_address,
        highestReturn: highestReturn,
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
    const reasonLabels = {
      'no_signal': '信号未触发',
      'signal_rejected': '预检查拒绝',
      'unknown': '有信号但未交易'
    };
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
  analyzeWhyNoSignal(strategyAnalysis) {
    // strategyAnalysis 包含 timePoints 数组，每个元素包含 data.factor_values
    const timePoints = strategyAnalysis.timePoints || [];

    if (timePoints.length === 0) {
      return {
        reason: '无策略分析数据',
        suggestion: '无法分析'
      };
    }

    // 检查是否在任何时间点触发过信号
    const triggeredPoint = timePoints.find(tp => tp.satisfied === true);

    if (triggeredPoint) {
      return {
        reason: '信号曾触发',
        suggestion: '信号在某个时间点触发过，但最终没有执行交易'
      };
    }

    // 获取最新的数据点来分析为什么不满足条件
    const latest = timePoints[timePoints.length - 1];
    const factors = latest.data?.factor_values || {};

    // 检查常见的购买条件
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
        'signal_rejected': '预检查拒绝',
        'unknown': '有信号但未交易'
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
        'signal_rejected': '预检查拒绝',
        'unknown': '有信号但未交易'
      }[t.missedReason] || t.missedReason;

      output += `  ${t.symbol.padEnd(16)} +${t.highestReturn.toFixed(1).padStart(6)}%  ${qualityBadge.padEnd(8)} ${reasonLabel.padEnd(12)}\n`;
      output += `    └─ ${t.detailedReason}\n`;
      output += `    └─ 建议: ${t.suggestion}\n\n`;
    });

    return output;
  }
}

module.exports = { MissedOpportunitiesAnalyzer };
