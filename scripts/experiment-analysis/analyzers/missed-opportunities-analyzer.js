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
        // 买入信号未触发（时序逐点回放深挖链已随 experiment_time_series_data 停写移除，
        // 因子级归因请查 strategy_signals 行 metadata.trendFactors 快照）
        detailedReason = '买入信号未触发';
        suggestion = '该代币未满足买腿触发条件（时序回放分析已下线，查 signal metadata trendFactors）';
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
