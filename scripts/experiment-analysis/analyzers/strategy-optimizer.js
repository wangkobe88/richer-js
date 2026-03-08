/**
 * 策略优化器
 * 综合各分析模块的结果，给出具体的策略优化建议
 */

const { AnalyzerBase } = require('../core/analyzer-base');

class StrategyOptimizer extends AnalyzerBase {
  constructor(dataLoader) {
    super(dataLoader);
    this.analyzerResults = {};
  }

  /**
   * 设置各个分析器的结果
   */
  setAnalyzerResults(results) {
    this.analyzerResults = results;
    return this;
  }

  /**
   * 分析并生成优化建议
   */
  async analyze() {
    const optimizations = [];

    // 从漏掉的好票分析中提取买入条件优化建议
    if (this.analyzerResults.missedOpportunities) {
      const missed = this.analyzerResults.missedOpportunities;
      if (missed.totalMissed > 0) {
        // 分析信号未触发的原因
        const noSignalCount = missed.byReason['no_signal'] || 0;
        const rejectedCount = missed.byReason['signal_rejected'] || 0;

        if (noSignalCount > 0) {
          optimizations.push({
            category: 'buy_condition',
            priority: noSignalCount > 5 ? 'high' : 'medium',
            title: '优化买入条件以捕获更多机会',
            description: `${noSignalCount}个高涨幅代币从未触发买入信号`,
            suggestions: [
              '检查trendRiseRatio阈值是否过高',
              '检查age窗口是否过窄',
              '考虑降低earlyReturn要求'
            ],
            expectedImpact: `预计可额外捕获 ${noSignalCount} 个机会`
          });
        }

        if (rejectedCount > 0) {
          optimizations.push({
            category: 'pre_buy_check',
            priority: rejectedCount > 3 ? 'high' : 'medium',
            title: '优化购买前检查条件',
            description: `${rejectedCount}个高涨幅代币的信号被预检查拒绝`,
            suggestions: [
              '检查黑名单是否过于严格',
              '检查持仓比例阈值是否合理',
              '考虑使用动态阈值而非固定值'
            ],
            expectedImpact: `预计可额外捕获 ${rejectedCount} 个机会`
          });
        }
      }
    }

    // 从错误购买分析中提取过滤条件优化建议
    if (this.analyzerResults.badBuys) {
      const badBuys = this.analyzerResults.badBuys;
      if (badBuys.filterSuggestions && badBuys.filterSuggestions.length > 0) {
        badBuys.filterSuggestions.forEach(s => {
          optimizations.push({
            category: 'buy_filter',
            priority: s.priority === 'high' ? 'high' : 'medium',
            title: `添加${s.factor}过滤条件`,
            description: s.reason,
            suggestions: [
              `建议添加条件: ${s.condition}`,
              s.wouldLose > 0
                ? `注意: 会过滤掉 ${s.wouldLose} 个盈利代币，需权衡`
                : '不会影响已有盈利代币'
            ],
            expectedImpact: `可过滤 ${s.wouldFilter} 个亏损代币`
          });
        });
      }
    }

    // 从错误卖出分析中提取卖出策略优化建议
    if (this.analyzerResults.badSells) {
      const badSells = this.analyzerResults.badSells;
      if (badSells.optimizations && badSells.optimizations.length > 0) {
        badSells.optimizations.forEach(opt => {
          optimizations.push({
            category: 'sell_strategy',
            priority: opt.priority === 'high' ? 'high' : 'medium',
            title: opt.title,
            description: opt.description,
            suggestions: [
              opt.suggestion
            ],
            expectedImpact: opt.expectedImpact
          });
        });
      }
    }

    // 按优先级排序
    optimizations.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    // 生成综合建议
    const summary = this.generateSummary(optimizations);

    this.results = {
      optimizations,
      summary
    };

    return this.results;
  }

  /**
   * 优化摘要
   */
  generateSummary(optimizations) {
    const byPriority = { high: [], medium: [], low: [] };
    optimizations.forEach(opt => {
      byPriority[opt.priority].push(opt);
    });

    const summary = [];

    summary.push(`共发现 ${optimizations.length} 个优化点`);

    if (byPriority.high.length > 0) {
      summary.push(`高优先级: ${byPriority.high.length} 个`);
      byPriority.high.forEach(opt => {
        summary.push(`  - ${opt.title}`);
      });
    }

    if (byPriority.medium.length > 0) {
      summary.push(`中优先级: ${byPriority.medium.length} 个`);
      byPriority.medium.slice(0, 3).forEach(opt => {
        summary.push(`  - ${opt.title}`);
      });
    }

    if (byPriority.low.length > 0) {
      summary.push(`低优先级: ${byPriority.low.length} 个`);
    }

    return summary;
  }

  /**
   * 生成配置文件建议
   */
  generateConfigSuggestion() {
    if (!this.results || !this.results.optimizations) {
      return null;
    }

    const config = {
      buyConditions: {},
      preBuyCheck: {},
      sellConditions: {},
      notes: []
    };

    this.results.optimizations.forEach(opt => {
      switch (opt.category) {
        case 'buy_condition':
          config.notes.push(`[买入条件] ${opt.title}: ${opt.suggestions.join('; ')}`);
          break;
        case 'buy_filter':
          config.notes.push(`[买入过滤] ${opt.title}: ${opt.suggestions.join('; ')}`);
          break;
        case 'pre_buy_check':
          config.notes.push(`[预检查] ${opt.title}: ${opt.suggestions.join('; ')}`);
          break;
        case 'sell_strategy':
          config.notes.push(`[卖出策略] ${opt.title}: ${opt.suggestions.join('; ')}`);
          break;
      }
    });

    return config;
  }

  formatReport() {
    const r = this.results;

    let output = '';

    output += '【优化建议摘要】\n\n';
    r.summary.forEach(line => {
      output += `  ${line}\n`;
    });
    output += '\n';

    output += '【详细优化建议】\n\n';

    if (r.optimizations.length === 0) {
      output += '  🎉 当前策略表现良好，暂无优化建议！\n\n';
    } else {
      r.optimizations.forEach((opt, index) => {
        const priorityBadge = opt.priority === 'high' ? '[高优先级]' : opt.priority === 'medium' ? '[中优先级]' : '[低优先级]';
        const categoryLabel = {
          'buy_condition': '买入条件',
          'buy_filter': '买入过滤',
          'pre_buy_check': '预检查',
          'sell_strategy': '卖出策略'
        }[opt.category] || opt.category;

        output += `${index + 1}. ${priorityBadge} [${categoryLabel}] ${opt.title}\n`;
        output += `   问题: ${opt.description}\n`;
        output += `   建议:\n`;
        opt.suggestions.forEach(s => {
          output += `     • ${s}\n`;
        });
        output += `   预期效果: ${opt.expectedImpact}\n\n`;
      });
    }

    // 生成配置建议
    const config = this.generateConfigSuggestion();
    if (config && config.notes.length > 0) {
      output += '【配置文件建议】\n\n';
      config.notes.forEach(note => {
        output += `  # ${note}\n`;
      });
      output += '\n';
    }

    return output;
  }
}

module.exports = { StrategyOptimizer };
