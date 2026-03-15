/**
 * 预检查拒绝分析器
 * 分析哪些好票因为预检查条件而被拒绝，以及具体是哪些条件不满足
 */

const { AnalyzerBase } = require('../core/analyzer-base');

// 预检查条件定义
const PRECHECK_CONDITIONS = {
  holderBlacklistCount: {
    name: '黑名单持有人数',
    condition: '<= 5',
    check: (v) => v <= 5
  },
  holderWhitelistRatio: {
    name: '白名单/黑名单比例',
    condition: '>= 黑名单*2',
    requires: ['holderBlacklistCount', 'holderWhitelistCount'],
    check: (f) => f.holderWhitelistCount >= f.holderBlacklistCount * 2
  },
  devHoldingRatio: {
    name: '开发者持仓比例',
    condition: '<= 15%',
    check: (v) => v <= 15
  },
  maxHoldingRatio: {
    name: '最大持仓比例',
    condition: '< 18%',
    check: (v) => v < 18
  },
  earlyTradesHighValueCount: {
    name: '早期高额交易笔数',
    condition: '>= 8',
    check: (v) => v >= 8
  },
  earlyTradesHighValuePerMin: {
    name: '早期高额交易频率',
    condition: '>= 10',
    check: (v) => v >= 10
  },
  earlyTradesCountPerMin: {
    name: '早期交易频率下限',
    condition: '>= 30',
    check: (v) => v >= 30
  },
  earlyTradesCountPerMinUpper: {
    name: '早期交易频率上限',
    condition: '< 150',
    check: (v) => v < 150
  },
  earlyTradesVolumePerMin: {
    name: '早期交易量',
    condition: '>= 3200',
    check: (v) => v >= 3200
  },
  earlyTradesActualSpan: {
    name: '早期交易跨度',
    condition: '>= 60秒',
    check: (v) => v >= 60
  },
  walletClusterMaxBlockBuyRatio: {
    name: '区块最大购买比例',
    condition: '< 0.15',
    check: (v) => v < 0.15
  },
  walletClusterCheck: {
    name: '钱包聚簇检测',
    condition: 'count<4 OR top2<=0.85',
    requires: ['walletClusterCount', 'walletClusterTop2Ratio'],
    check: (f) => f.walletClusterCount < 4 || f.walletClusterTop2Ratio <= 0.85
  },
  creatorIsNotBadDevWallet: {
    name: '创建者钱包检测',
    condition: '>= 1',
    check: (v) => v >= 1
  },
  drawdownFromHighest: {
    name: '回撤检测',
    condition: '> -25%',
    check: (v) => v > -25
  },
  earlyTradesFinalLiquidity: {
    name: '早期交易末流动性',
    condition: '>= 5000',
    check: (v) => v >= 5000
  },
  earlyTradesDrawdownFromHighest: {
    name: '早期交易价格跌幅',
    condition: '> -30%',
    check: (v) => v > -30
  }
};

class PreCheckRejectionAnalyzer extends AnalyzerBase {
  async analyze(options = {}) {
    const { minReturn = 100 } = options;

    const tokens = await this.dataLoader.getTokens();
    const signals = await this.dataLoader.getSignals();

    // 找出好票
    const goodTokens = tokens.filter(token => {
      const analysisResults = token.analysis_results || token.analysisResults || {};
      const maxChange = analysisResults.max_change_percent || 0;
      return maxChange >= minReturn;
    });

    // 按symbol分组
    const bySymbol = {};
    goodTokens.forEach(token => {
      const symbol = token.token_symbol || 'Unknown';
      if (!bySymbol[symbol]) {
        bySymbol[symbol] = [];
      }
      bySymbol[symbol].push(token);
    });

    // 分析每个symbol
    const analyzedTokens = [];
    const conditionStats = {};
    let totalRejected = 0;
    let totalExecuted = 0;
    let totalNoSignal = 0;

    for (const [symbol, tokenList] of Object.entries(bySymbol)) {
      const maxChange = Math.max(...tokenList.map(t => {
        const analysisResults = t.analysis_results || t.analysisResults || {};
        return analysisResults.max_change_percent || 0;
      }));

      // 查找被拒绝的信号
      const rejectedSignals = signals.filter(s =>
        s.token_symbol === symbol &&
        s.executed === false &&
        (s.strategy_type === 'buy' || s.strategy_type === null || s.strategy_type === undefined)
      );

      if (rejectedSignals.length > 0) {
        totalRejected++;
        // 分析拒绝原因（使用第一个被拒绝的信号）
        const signal = rejectedSignals[0];
        const factors = signal.metadata?.preBuyCheckFactors || {};
        const failedConditions = this._analyzePreCheckFailure(factors);

        // 统计原因
        failedConditions.forEach(c => {
          conditionStats[c.name] = (conditionStats[c.name] || 0) + 1;
        });

        analyzedTokens.push({
          symbol,
          maxChange,
          status: 'rejected',
          failedConditions,
          signalCount: rejectedSignals.length
        });
      } else {
        // 检查是否已执行或无信号
        const executedSignals = signals.filter(s =>
          s.token_symbol === symbol && s.executed === true
        );

        if (executedSignals.length > 0) {
          totalExecuted++;
          analyzedTokens.push({
            symbol,
            maxChange,
            status: 'executed',
            failedConditions: [],
            signalCount: executedSignals.length
          });
        } else {
          totalNoSignal++;
          analyzedTokens.push({
            symbol,
            maxChange,
            status: 'no_signal',
            failedConditions: [],
            signalCount: 0
          });
        }
      }
    }

    // 按涨幅排序
    analyzedTokens.sort((a, b) => b.maxChange - a.maxChange);

    this.results = {
      totalGoodTokens: goodTokens.length,
      totalExecuted,
      totalRejected,
      totalNoSignal,
      conditionStats,
      tokens: analyzedTokens
    };

    return this.results;
  }

  /**
   * 分析预检查失败的具体原因
   */
  _analyzePreCheckFailure(factors) {
    const failedConditions = [];

    for (const [key, config] of Object.entries(PRECHECK_CONDITIONS)) {
      let passed;

      if (config.requires) {
        // 需要多个因子值
        passed = config.check(factors);
      } else {
        const value = factors[key];
        passed = config.check(value);
      }

      if (!passed) {
        failedConditions.push({
          key,
          name: config.name,
          condition: config.condition
        });
      }
    }

    return failedConditions;
  }

  formatReport() {
    const r = this.results;

    let output = '';

    output += '【预检查拒绝分析】\n\n';

    output += `  总好票数:     ${r.totalGoodTokens}\n`;
    output += `  已执行:       ${r.totalExecuted} (${(r.totalGoodTokens > 0 ? r.totalExecuted / r.totalGoodTokens * 100 : 0).toFixed(1)}%)\n`;
    output += `  被拒绝:       ${r.totalRejected} (${(r.totalGoodTokens > 0 ? r.totalRejected / r.totalGoodTokens * 100 : 0).toFixed(1)}%)\n`;
    output += `  无信号:       ${r.totalNoSignal} (${(r.totalGoodTokens > 0 ? r.totalNoSignal / r.totalGoodTokens * 100 : 0).toFixed(1)}%)\n\n`;

    if (Object.keys(r.conditionStats).length > 0) {
      output += '【拒绝原因出现频率】\n\n';

      const sortedReasons = Object.entries(r.conditionStats).sort((a, b) => b[1] - a[1]);
      sortedReasons.forEach(([reason, count]) => {
        const percent = (r.totalRejected > 0 ? count / r.totalRejected * 100 : 0).toFixed(1);
        output += `  ${reason.padEnd(30)} ${count.toString().padStart(3)} 次 (${percent}%)\n`;
      });
      output += '\n';
    }

    if (r.totalRejected > 0) {
      output += '【被拒绝的代币详情】\n\n';
      output += '  代币名称              最高涨幅    不满足的条件\n';
      output += '  ' + '─'.repeat(70) + '\n';

      const rejectedTokens = r.tokens.filter(t => t.status === 'rejected');
      rejectedTokens.forEach(t => {
        const conditions = t.failedConditions.length > 0
          ? t.failedConditions.map(c => c.name).join(', ')
          : '-';
        output += `  ${t.symbol.padEnd(20)} +${t.maxChange.toFixed(1).padStart(6)}%  ${conditions}\n`;
      });
    }

    return output;
  }
}

module.exports = { PreCheckRejectionAnalyzer, PRECHECK_CONDITIONS };
