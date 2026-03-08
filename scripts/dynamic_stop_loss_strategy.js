/**
 * 基于数据洞察的动态止损策略
 *
 * 核心发现：
 * 1. 持有时间 < 2分钟：胜率仅28.6%，平均亏损-5.75%
 * 2. 持有时间 2-5分钟：胜率100%，平均收益+91.55%
 * 3. 持有时间 5-10分钟：胜率50%，但平均收益+113.79%
 *
 * 策略建议：
 * - 给代币至少2分钟的表现时间
 * - 2-5分钟是黄金窗口，考虑分批止盈
 * - 5分钟后转入追踪止损模式
 */

/**
 * 动态止损策略配置
 */
const DYNAMIC_STOP_LOSS_CONFIG = {
  // 策略一：时间分段动态止损
  timeBased: {
    name: '时间分段动态止损',
    stages: [
      {
        name: '观察期',
        maxHoldMinutes: 2,
        stopLoss: -0.25,           // -25%
        description: '给代币充分波动空间，避免过早止损'
      },
      {
        name: '黄金窗口',
        minHoldMinutes: 2,
        maxHoldMinutes: 5,
        stopLoss: -0.15,           // -15%
        takeProfit: 0.50,          // +50%时卖出50%
        description: '最佳表现窗口，考虑分批止盈'
      },
      {
        name: '追踪期',
        minHoldMinutes: 5,
        stopLoss: -0.10,           // -10%
        trailingStop: -0.10,       // 从最高点回撤10%
        description: '追踪止损，保护利润'
      }
    ]
  },

  // 策略二：收益追踪动态止损
  profitBased: {
    name: '收益追踪动态止损',
    rules: [
      {
        condition: 'profit < 30%',
        stopLoss: -0.25,
        description: '亏损或微利时，宽松止损'
      },
      {
        condition: 'profit >= 30% && profit < 50%',
        stopLoss: 0,              // 保本
        trailingStop: -0.15,
        description: '盈利30%后，保本止损'
      },
      {
        condition: 'profit >= 50% && profit < 100%',
        stopLoss: 0.30,           // 锁定30%利润
        trailingStop: -0.10,
        description: '盈利50%后，锁定30%利润'
      },
      {
        condition: 'profit >= 100%',
        stopLoss: 0.50,           // 锁定50%利润
        trailingStop: -0.5,
        description: '盈利翻倍后，锁定50%利润'
      }
    ]
  },

  // 策略三：混合策略（推荐）
  hybrid: {
    name: '混合动态止损',
    rules: [
      // 时间规则
      {
        type: 'time',
        condition: 'holdMinutes < 2',
        stopLoss: -0.25,
        description: '前2分钟：宽松止损-25%'
      },
      {
        type: 'time',
        condition: 'holdMinutes >= 2 && holdMinutes < 5',
        stopLoss: -0.15,
        description: '2-5分钟：适度止损-15%'
      },
      {
        type: 'time',
        condition: 'holdMinutes >= 5',
        stopLoss: -0.10,
        trailingStop: -0.10,
        description: '5分钟后：追踪止损从最高点-10%'
      },
      // 收益规则（覆盖时间规则）
      {
        type: 'profit',
        condition: 'profit >= 50%',
        action: 'sell_50_percent',
        description: '盈利50%时：卖出50%仓位'
      },
      {
        type: 'profit',
        condition: 'profit >= 100%',
        action: 'sell_30_percent',
        description: '盈利100%时：再卖出30%仓位'
      }
    ]
  }
};

/**
 * 计算动态止损价格
 *
 * @param {Object} token - 代币信息
 * @param {number} holdMinutes - 持有分钟数
 * @param {number} buyPrice - 买入价格
 * @param {number} highestPrice - 持有期间最高价
 * @param {number} currentProfit - 当前收益率
 * @param {Object} config - 止损配置
 * @returns {Object} 止损决策
 */
function calculateDynamicStopLoss(token, holdMinutes, buyPrice, highestPrice, currentProfit, config = DYNAMIC_STOP_LOSS_CONFIG.hybrid) {
  let stopLossPrice = buyPrice;  // 默认止损价
  let stopLossReason = [];
  let shouldSell = false;
  let sellPercent = 0;
  let sellReason = null;

  // 按优先级应用规则
  for (const rule of config.rules) {
    if (rule.type === 'time') {
      // 时间规则
      if (evaluateCondition(rule.condition, { holdMinutes })) {
        if (rule.stopLoss !== undefined) {
          const newStopLoss = buyPrice * (1 + rule.stopLoss);
          // 止损价可以低于买入价，但应该使用更宽松的（更小）的止损
          if (stopLossPrice === buyPrice || newStopLoss < stopLossPrice) {
            stopLossPrice = newStopLoss;
            stopLossReason.push(rule.description);
          }
        }

        // 追踪止损
        if (rule.trailingStop !== undefined && highestPrice > buyPrice) {
          const trailingStopPrice = highestPrice * (1 + rule.trailingStop);
          // 追踪止损使用更高的价格
          if (trailingStopPrice > stopLossPrice) {
            stopLossPrice = trailingStopPrice;
            stopLossReason.push(`追踪止损: ${rule.description}`);
          }
        }
      }
    } else if (rule.type === 'profit') {
      // 收益规则
      if (evaluateCondition(rule.condition, { currentProfit })) {
        if (rule.action && rule.action.startsWith('sell_')) {
          sellPercent = parseInt(rule.action.split('_')[1]);
          shouldSell = true;
          sellReason = rule.description;
        }
        if (rule.stopLoss !== undefined) {
          const newStopLoss = buyPrice * (1 + rule.stopLoss);
          // 收益规则产生的止损价是保护利润的，使用更高的价格
          if (newStopLoss > stopLossPrice) {
            stopLossPrice = newStopLoss;
            stopLossReason.push(rule.description);
          }
        }
      }
    }
  }

  return {
    stopLossPrice,
    stopLossReason: stopLossReason.join('; '),
    shouldSell,
    sellPercent,
    sellReason
  };
}

/**
 * 评估条件
 */
function evaluateCondition(condition, context) {
  // 简化的条件评估器
  if (condition.includes('holdMinutes < ')) {
    const threshold = parseFloat(condition.split('holdMinutes < ')[1]);
    return context.holdMinutes < threshold;
  }
  if (condition.includes('holdMinutes >= ') && condition.includes(' && ')) {
    const parts = condition.split(' && ');
    const minThreshold = parseFloat(parts[0].split('holdMinutes >= ')[1]);
    const maxThreshold = parseFloat(parts[1].split('holdMinutes < ')[1]);
    return context.holdMinutes >= minThreshold && context.holdMinutes < maxThreshold;
  }
  if (condition.includes('holdMinutes >= ')) {
    const threshold = parseFloat(condition.split('holdMinutes >= ')[1]);
    return context.holdMinutes >= threshold;
  }
  if (condition.includes('profit >= ') && condition.includes(' && ')) {
    const parts = condition.split(' && ');
    const minThreshold = parseFloat(parts[0].split('profit >= ')[1]);
    const maxThreshold = parseFloat(parts[1].split('profit < ')[1]);
    const profit = context.currentProfit || 0;
    return profit >= minThreshold && profit < maxThreshold;
  }
  if (condition.includes('profit >= ')) {
    const threshold = parseFloat(condition.split('profit >= ')[1]);
    return (context.currentProfit || 0) >= threshold;
  }
  if (condition.includes('profit < ')) {
    const threshold = parseFloat(condition.split('profit < ')[1]);
    return (context.currentProfit || 0) < threshold;
  }
  return false;
}

/**
 * 检查是否应该卖出
 */
function shouldSell(token, currentPrice, buyPrice, holdMinutes, highestPrice) {
  const currentProfit = ((currentPrice - buyPrice) / buyPrice) * 100;

  const decision = calculateDynamicStopLoss(
    token,
    holdMinutes,
    buyPrice,
    highestPrice,
    currentProfit
  );

  // 检查是否触发止损
  const hitStopLoss = currentPrice <= decision.stopLossPrice;

  // 检查是否应该分批卖出
  if (decision.shouldSell) {
    return {
      shouldSell: true,
      sellPercent: decision.sellPercent,
      reason: decision.sellReason,
      stopLossPrice: decision.stopLossPrice
    };
  }

  // 触发止损
  if (hitStopLoss) {
    return {
      shouldSell: true,
      sellPercent: 100,  // 全部卖出
      reason: `触发止损: ${decision.stopLossReason}`,
      stopLossPrice: decision.stopLossPrice
    };
  }

  return {
    shouldSell: false,
    stopLossPrice: decision.stopLossPrice,
    reason: `持有中，当前止损价: ${decision.stopLossPrice.toFixed(8)} BNB`
  };
}

// 示例使用
function example() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    动态止损策略示例                                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const scenarios = [
    {
      name: '场景1: 刚买入1分钟，价格下跌15%',
      token: { symbol: 'TEST' },
      buyPrice: 0.01,
      currentPrice: 0.0085,
      holdMinutes: 1,
      highestPrice: 0.01
    },
    {
      name: '场景2: 持有3分钟，价格上涨40%',
      token: { symbol: 'TEST' },
      buyPrice: 0.01,
      currentPrice: 0.014,
      holdMinutes: 3,
      highestPrice: 0.014
    },
    {
      name: '场景3: 持有6分钟，价格先涨到80%后回落到60%',
      token: { symbol: 'TEST' },
      buyPrice: 0.01,
      currentPrice: 0.016,
      holdMinutes: 6,
      highestPrice: 0.018
    },
    {
      name: '场景4: 持有8分钟，价格翻倍',
      token: { symbol: 'TEST' },
      buyPrice: 0.01,
      currentPrice: 0.02,
      holdMinutes: 8,
      highestPrice: 0.02
    }
  ];

  scenarios.forEach(scenario => {
    const decision = shouldSell(
      scenario.token,
      scenario.currentPrice,
      scenario.buyPrice,
      scenario.holdMinutes,
      scenario.highestPrice
    );

    const currentProfit = ((scenario.currentPrice - scenario.buyPrice) / scenario.buyPrice * 100).toFixed(2);

    console.log(`【${scenario.name}】`);
    console.log(`  当前价格: ${scenario.currentPrice.toFixed(8)} BNB (${currentProfit > 0 ? '+' : ''}${currentProfit}%)`);
    console.log(`  持有时间: ${scenario.holdMinutes} 分钟`);
    console.log(`  最高价格: ${scenario.highestPrice.toFixed(8)} BNB`);
    console.log(`  止损价格: ${decision.stopLossPrice.toFixed(8)} BNB`);
    console.log(`  决策: ${decision.shouldSell ? `卖出 ${decision.sellPercent}%` : '持有'}`);
    console.log(`  原因: ${decision.reason}`);
    console.log('');
  });
}

// 导出配置和函数
module.exports = {
  DYNAMIC_STOP_LOSS_CONFIG,
  calculateDynamicStopLoss,
  shouldSell,
  example
};

// 如果直接运行此文件，执行示例
if (require.main === module) {
  example();
}
