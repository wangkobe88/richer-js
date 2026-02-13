/**
 * 分析实验的购买策略和收益情况
 *
 * 用法: node analytics/analyze_strategy_performance.js <experimentId>
 *
 * 示例: node analytics/analyze_strategy_performance.js 2f9f0fa5-9b8b-4b6b-9e65-10342d1f0bdf
 */

const { ExperimentDataService } = require('../src/web/services/ExperimentDataService');

// ANSI 颜色代码
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

/**
 * 格式化数字显示
 */
function formatNumber(num) {
  if (typeof num !== 'number') return 'N/A';
  if (Math.abs(num) < 0.0001) return num.toExponential(2);
  return num.toFixed(6);
}

/**
 * 格式化百分比显示
 */
function formatPercent(num) {
  if (typeof num !== 'number') return 'N/A';
  return num.toFixed(2) + '%';
}

/**
 * 主分析函数
 */
async function analyze(experimentId) {
  console.log(`\n${colors.cyan}========================================`);
  console.log(`${colors.cyan}实验购买策略和收益分析`);
  console.log(`${colors.cyan}========================================\n`);

  const dataService = new ExperimentDataService();

  // 获取所有数据
  console.log(`${colors.blue}正在获取数据...`);
  const [signals, trades] = await Promise.all([
    dataService.getSignals(experimentId, { limit: 10000 }),
    dataService.getTrades(experimentId, { limit: 10000 })
  ]);

  console.log(`${colors.green}✓ 获取到 ${signals.length} 条信号`);
  console.log(`${colors.green}✓ 获取到 ${trades.length} 条交易\n`);

  // 创建信号映射（通过 signalId 快速查找）
  const signalMap = new Map();
  for (const signal of signals) {
    signalMap.set(signal.id, signal);
  }

  // 按策略和代币分组交易数据
  const strategyGroups = new Map(); // strategyId -> { name, tokens: Map }

  for (const trade of trades) {
    if (!trade.success) continue;

    // 跳过卖出交易，只处理买入
    if (trade.tradeDirection !== 'buy') continue;

    // 通过 signalId 找到对应的信号
    const signal = signalMap.get(trade.signalId);
    if (!signal) continue;

    const strategyId = signal.metadata?.strategyId || 'unknown';
    const strategyName = signal.metadata?.strategyName || 'Unknown Strategy';
    const tokenAddress = trade.tokenAddress;

    // 初始化策略组
    if (!strategyGroups.has(strategyId)) {
      strategyGroups.set(strategyId, {
        id: strategyId,
        name: strategyName,
        tokens: new Map() // tokenAddress -> { symbol, buyTrades[], sellTrades[] }
      });
    }

    const group = strategyGroups.get(strategyId);

    // 初始化代币数据
    if (!group.tokens.has(tokenAddress)) {
      group.tokens.set(tokenAddress, {
        symbol: trade.tokenSymbol,
        buyTrades: [],
        sellTrades: []
      });
    }

    group.tokens.get(tokenAddress).buyTrades.push(trade);
  }

  // 将卖出交易分配到对应的代币
  for (const trade of trades) {
    if (!trade.success) continue;
    if (trade.tradeDirection !== 'sell') continue;

    const tokenAddress = trade.tokenAddress;

    // 找到包含此代币的策略组
    for (const group of strategyGroups.values()) {
      if (group.tokens.has(tokenAddress)) {
        group.tokens.get(tokenAddress).sellTrades.push(trade);
        break;
      }
    }
  }

  // 计算代币收益
  function calculateTokenPnL(buyTrades, sellTrades) {
    let totalBuyAmount = 0; // 总花费 BNB
    let totalBuyTokens = 0;  // 总买入代币数量
    let totalSellAmount = 0; // 总收回 BNB
    let totalSellTokens = 0; // 总卖出代币数量

    for (const trade of buyTrades) {
      // inputAmount 可能是字符串(wei)、数字(BNB)或BigInt
      let inputAmt = trade.inputAmount;
      if (typeof inputAmt === 'string' || inputAmt instanceof String) {
        inputAmt = Number(inputAmt) / 1e18; // wei转BNB
      } else if (typeof inputAmt === 'bigint') {
        inputAmt = Number(inputAmt) / 1e18;
      }
      totalBuyAmount += inputAmt;

      // outputAmount 是代币数量
      totalBuyTokens += Number(trade.outputAmount || 0);
    }

    for (const trade of sellTrades) {
      // inputAmount 是代币数量
      totalSellTokens += Number(trade.inputAmount || 0);

      // outputAmount 是BNB数量
      let outputAmt = trade.outputAmount;
      if (typeof outputAmt === 'string' || outputAmt instanceof String) {
        outputAmt = Number(outputAmt) / 1e18;
      } else if (typeof outputAmt === 'bigint') {
        outputAmt = Number(outputAmt) / 1e18;
      }
      totalSellAmount += outputAmt;
    }

    const remainingTokens = totalBuyTokens - totalSellTokens;

    return {
      totalBuyAmount,
      totalBuyTokens,
      totalSellAmount,
      totalSellTokens,
      remainingTokens,
      pnl: totalSellAmount - totalBuyAmount
    };
  }

  // 输出分析结果
  console.log(`${colors.cyan}========================================`);
  console.log(`${colors.cyan}按策略分组统计`);
  console.log(`${colors.cyan}========================================\n`);

  const summary = {
    totalStrategies: strategyGroups.size,
    totalTokens: 0,
    totalPnL: 0,
    totalBuyAmount: 0,
    totalSellAmount: 0,
    profitableStrategies: 0,
    lossStrategies: 0
  };

  for (const [strategyId, group] of strategyGroups) {
    let strategyPnL = 0;
    let strategyBuyAmount = 0;
    let strategySellAmount = 0;
    let tokensWithTrades = 0;

    console.log(`${colors.bright}${colors.white}策略: ${group.name} (${strategyId})`);
    console.log(`${colors.white}交易代币: ${group.tokens.size}\n`);

    for (const [tokenAddress, tokenData] of group.tokens) {
      const pnlData = calculateTokenPnL(tokenData.buyTrades, tokenData.sellTrades);
      tokensWithTrades++;

      strategyBuyAmount += pnlData.totalBuyAmount;
      strategySellAmount += pnlData.totalSellAmount;
      strategyPnL += pnlData.pnl;

      const pnlPercent = pnlData.totalBuyAmount > 0
        ? (pnlData.pnl / pnlData.totalBuyAmount) * 100
        : 0;

      const pnlColor = pnlData.pnl >= 0 ? colors.green : colors.red;
      const statusText = pnlData.remainingTokens > 0
        ? `${colors.yellow}[持仓中]${colors.reset}`
        : `${colors.cyan}[已退出]${colors.reset}`;

      console.log(`  ${statusText} ${colors.white}${tokenData.symbol}${colors.reset} (${tokenAddress.slice(0, 8)}...)`);
      console.log(`    买入: ${formatNumber(pnlData.totalBuyAmount)} BNB | 卖出: ${formatNumber(pnlData.totalSellAmount)} BNB`);
      console.log(`    盈亏: ${pnlColor}${formatNumber(pnlData.pnl)} BNB (${formatPercent(pnlPercent)})${colors.reset}`);
      console.log(`    交易: ${tokenData.buyTrades.length}买/${tokenData.sellTrades.length}卖 | 剩余: ${formatNumber(pnlData.remainingTokens)}`);
      console.log('');
    }

    // 策略汇总
    const strategyPnLPercent = strategyBuyAmount > 0
      ? (strategyPnL / strategyBuyAmount) * 100
      : 0;

    const strategyPnLColor = strategyPnL >= 0 ? colors.green : colors.red;

    console.log(`  ${colors.white}策略汇总:`);
    console.log(`    总花费: ${formatNumber(strategyBuyAmount)} BNB`);
    console.log(`    总收回: ${formatNumber(strategySellAmount)} BNB`);
    console.log(`    净盈亏: ${strategyPnLColor}${formatNumber(strategyPnL)} BNB (${formatPercent(strategyPnLPercent)})${colors.reset}`);
    console.log(`    交易代币: ${tokensWithTrades}\n`);

    // 更新全局统计
    summary.totalTokens += tokensWithTrades;
    summary.totalPnL += strategyPnL;
    summary.totalBuyAmount += strategyBuyAmount;
    summary.totalSellAmount += strategySellAmount;
    if (strategyPnL >= 0) summary.profitableStrategies++;
    else summary.lossStrategies++;
  }

  // 输出总体统计
  console.log(`${colors.cyan}========================================`);
  console.log(`${colors.cyan}总体统计`);
  console.log(`${colors.cyan}========================================\n`);

  const totalPnLPercent = summary.totalBuyAmount > 0
    ? (summary.totalPnL / summary.totalBuyAmount) * 100
    : 0;

  console.log(`${colors.white}策略总数: ${summary.totalStrategies}`);
  console.log(`${colors.white}交易代币数: ${summary.totalTokens}`);
  console.log(`${colors.white}盈利策略数: ${colors.green}${summary.profitableStrategies}${colors.reset}`);
  console.log(`${colors.white}亏损策略数: ${colors.red}${summary.lossStrategies}${colors.reset}`);
  console.log(`${colors.white}总花费: ${formatNumber(summary.totalBuyAmount)} BNB`);
  console.log(`${colors.white}总收回: ${formatNumber(summary.totalSellAmount)} BNB`);
  console.log(`${colors.white}总盈亏: ${summary.totalPnL >= 0 ? colors.green : colors.red}${formatNumber(summary.totalPnL)} BNB (${formatPercent(totalPnLPercent)})${colors.reset}`);
  console.log('');
}

// 主入口
if (require.main === module) {
  const experimentId = process.argv[2];

  if (!experimentId) {
    console.error(`${colors.red}错误: 请提供实验ID`);
    console.error(`${colors.yellow}用法: node analytics/analyze_strategy_performance.js <experimentId>`);
    process.exit(1);
  }

  analyze(experimentId).catch(error => {
    console.error(`${colors.red}分析失败:`, error);
    process.exit(1);
  });
}

module.exports = { analyze };
