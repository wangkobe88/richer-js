/**
 * 深入分析实验 ab75cb2b 的交易时序和价格数据
 * 了解为什么某些代币能达到超高收益
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function analyzeTrades() {
  const experimentId = 'ab75cb2b-4930-4049-a3bd-f96e3de6af47';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    交易时序深度分析                                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取所有交易
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  if (!trades || trades.length === 0) {
    console.log('没有交易记录');
    return;
  }

  // 获取所有代币数据 - 从 trades 中提取代币地址
  const uniqueAddresses = [...new Set(trades.map(t => t.token_address))];
  const tokenMap = new Map();

  // 尝试从 experiment_tokens 获取代币基本信息
  for (const address of uniqueAddresses) {
    tokenMap.set(address, {
      token_address: address,
      token_symbol: trades.find(t => t.token_address === address)?.token_symbol || address.substring(0, 8)
    });
  }

  // 按代币分组交易
  const tokenTradeGroups = new Map();
  trades.forEach(trade => {
    if (!tokenTradeGroups.has(trade.token_address)) {
      tokenTradeGroups.set(trade.token_address, []);
    }
    tokenTradeGroups.get(trade.token_address).push(trade);
  });

  // 分析每个代币的交易时序
  const tokenAnalyses = [];

  for (const [tokenAddress, tokenTrades] of tokenTradeGroups) {
    const token = tokenMap.get(tokenAddress);

    // 按时间排序
    tokenTrades.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const buyTrades = tokenTrades.filter(t => t.action === 'buy');
    const sellTrades = tokenTrades.filter(t => t.action === 'sell');

    if (buyTrades.length === 0) continue;

    const firstBuy = buyTrades[0];
    const lastSell = sellTrades.length > 0 ? sellTrades[sellTrades.length - 1] : null;

    // 计算时间差
    const buyTime = new Date(firstBuy.created_at).getTime();
    const sellTime = lastSell ? new Date(lastSell.created_at).getTime() : buyTime;
    const holdMinutes = (sellTime - buyTime) / (1000 * 60);

    // 代币符号
    const tokenSymbol = firstBuy.token_symbol || token?.token_symbol || tokenAddress.substring(0, 8);

    // 计算收益
    let totalBuyAmount = 0;
    let totalSellAmount = 0;
    let totalBought = 0;
    let totalSold = 0;

    buyTrades.forEach(t => {
      totalBuyAmount += t.amount || 0;
      totalBought += t.token_amount || 0;
    });

    sellTrades.forEach(t => {
      totalSellAmount += t.amount || 0;
      totalSold += t.token_amount || 0;
    });

    // FIFO计算剩余持仓价值
    const remainingTokens = totalBought - totalSold;
    const avgBuyPrice = totalBought > 0 ? totalBuyAmount / totalBought : 0;

    // 计算收益率
    let profit = 0;
    let profitPercent = 0;

    if (sellTrades.length > 0) {
      // 已卖出
      profit = totalSellAmount - totalBuyAmount;
      profitPercent = (profit / totalBuyAmount) * 100;
    } else {
      // 持仓中，用当前价格计算（这里简化处理，使用最后买入价）
      // 回测结束时可能没有卖出
      profit = 0;
      profitPercent = 0;
    }

    // 获取购买信号数据
    const { data: signals } = await supabase
      .from('strategy_signals')
      .select('*')
      .eq('experiment_id', experimentId)
      .eq('token_address', tokenAddress)
      .eq('action', 'buy')
      .single();

    let signalMetadata = {};
    if (signals?.metadata) {
      try {
        signalMetadata = typeof signals.metadata === 'string'
          ? JSON.parse(signals.metadata)
          : signals.metadata;
      } catch (e) {}
    }

    // 获取趋势数据
    const trendAtBuy = signalMetadata.trendFactors || {};

    tokenAnalyses.push({
      token_symbol: tokenSymbol,
      token_address: tokenAddress,
      buyTime: firstBuy.created_at,
      sellTime: lastSell?.created_at || null,
      holdMinutes,
      buyTrades: buyTrades.length,
      sellTrades: sellTrades.length,
      totalBuyAmount,
      totalSellAmount,
      profit,
      profitPercent,
      status: sellTrades.length > 0 ? '已卖出' : '持仓中',
      avgBuyPrice,
      buyPrice: firstBuy.unit_price,
      sellPrice: lastSell?.unit_price || 0,
      highestPrice: trendAtBuy.highestPrice || 0,
      highestPriceUsd: trendAtBuy.highestPriceUsd || 0,
      earlyReturn: trendAtBuy.earlyReturn || 0,
      drawdownFromHighest: trendAtBuy.drawdownFromHighest || 0,
      trendRiseRatio: trendAtBuy.trendRiseRatio || 0
    });
  }

  // 按收益率排序
  tokenAnalyses.sort((a, b) => b.profitPercent - a.profitPercent);

  // 打印TOP收益代币的详细交易时序
  console.log('【高收益代币交易时序分析】\n');
  console.log('序号  代币                      收益%     持有时间   买入价    卖出价    最高价    回撤%   趋势比');
  console.log('─'.repeat(100));

  tokenAnalyses.slice(0, 15).forEach((t, index) => {
    const profitColor = t.profitPercent >= 0 ? '\x1b[32m' : '\x1b[31m';
    const resetColor = '\x1b[0m';

    const holdTimeStr = t.holdMinutes < 0.1
      ? `${(t.holdMinutes * 60).toFixed(1)}秒`
      : `${t.holdMinutes.toFixed(2)}分`;

    const drawdownStr = t.drawdownFromHighest ? `${t.drawdownFromHighest.toFixed(1)}%` : 'N/A';

    console.log(
      String(index + 1).padStart(4) + '. ' +
      (t.token_symbol.padEnd(24)) +
      profitColor + t.profitPercent.toFixed(2).padStart(8) + '%' + resetColor +
      holdTimeStr.padStart(10) +
      t.buyPrice.toFixed(8).padStart(12) +
      (t.sellPrice > 0 ? t.sellPrice.toFixed(8).padStart(12) : '未卖出'.padStart(12)) +
      (t.highestPrice > 0 ? t.highestPrice.toFixed(8).padStart(12) : 'N/A'.padStart(12)) +
      drawdownStr.padStart(10) +
      (t.trendRiseRatio > 0 ? t.trendRiseRatio.toFixed(2).padStart(8) : 'N/A'.padStart(8))
    );
  });

  console.log('\n');

  // 分析CLAWSTER的超高收益
  const clawster = tokenAnalyses.find(t => t.token_symbol === 'CLAWSTER');
  if (clawster) {
    console.log('╔══════════════════════════════════════════════════════════════════════════╗');
    console.log('║                    CLAWSTER 超高收益解析                                  ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

    console.log(`收益率: ${clawster.profitPercent.toFixed(2)}%`);
    console.log(`买入时间: ${clawster.buyTime}`);
    console.log(`卖出时间: ${clawster.sellTime || '未卖出'}`);
    console.log(`持有时间: ${clawster.holdMinutes.toFixed(4)} 分钟 (${(clawster.holdMinutes * 60).toFixed(1)} 秒)`);
    console.log('');

    console.log('价格信息:');
    console.log(`  买入价: ${clawster.buyPrice}`);
    console.log(`  卖出价: ${clawster.sellPrice || '未卖出'}`);
    console.log(`  最高价: ${clawster.highestPrice || 'N/A'}`);
    console.log(`  早期收益率: ${clawster.earlyReturn || 'N/A'}%`);
    console.log('');

    console.log('交易金额:');
    console.log(`  总买入: ${clawster.totalBuyAmount.toFixed(4)} BNB`);
    console.log(`  总卖出: ${clawster.totalSellAmount.toFixed(4)} BNB`);
    console.log(`  净利润: ${clawster.profit.toFixed(4)} BNB`);
    console.log('');

    console.log('趋势因子:');
    console.log(`  从最高点回撤: ${clawster.drawdownFromHighest || 'N/A'}%`);
    console.log(`  趋势上升比: ${clawster.trendRiseRatio || 'N/A'}`);
    console.log('');
  }

  // 统计持有时间分布
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    持有时间分布分析                                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const holdTimeRanges = [
    { max: 0.0167, label: '< 1秒' },     // < 1秒
    { min: 0.0167, max: 0.0833, label: '1-5秒' },
    { min: 0.0833, max: 0.5, label: '5秒-30秒' },
    { min: 0.5, max: 1, label: '30秒-1分' },
    { min: 1, max: 5, label: '1-5分钟' },
    { min: 5, label: '> 5分钟' }
  ];

  const soldTokens = tokenAnalyses.filter(t => t.status === '已卖出');

  holdTimeRanges.forEach(range => {
    const count = soldTokens.filter(t => {
      if (range.max === undefined) return t.holdMinutes >= range.min;
      if (range.min === undefined) return t.holdMinutes < range.max;
      return t.holdMinutes >= range.min && t.holdMinutes < range.max;
    }).length;

    if (count > 0) {
      const avgReturn = soldTokens
        .filter(t => {
          if (range.max === undefined) return t.holdMinutes >= range.min;
          if (range.min === undefined) return t.holdMinutes < range.max;
          return t.holdMinutes >= range.min && t.holdMinutes < range.max;
        })
        .reduce((sum, t, _, arr) => sum + t.profitPercent / arr.length, 0);

      const pct = (count / soldTokens.length * 100).toFixed(1);
      console.log(`  ${range.label.padEnd(15)} ${count} 个 (${pct}%)   平均收益: ${avgReturn.toFixed(2)}%`);
    }
  });

  console.log('\n');

  // 分析快速卖出（<1秒）的原因
  const superFastTrades = soldTokens.filter(t => t.holdMinutes < 0.0167);

  if (superFastTrades.length > 0) {
    console.log('╔══════════════════════════════════════════════════════════════════════════╗');
    console.log('║                    快速卖出分析 (< 1秒)                                    ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

    console.log(`数量: ${superFastTrades.length} 个`);
    console.log(`占比: ${(superFastTrades.length / soldTokens.length * 100).toFixed(1)}%`);
    console.log(`平均收益: ${superFastTrades.reduce((sum, t) => sum + t.profitPercent, 0) / superFastTrades.length.toFixed(2)}%`);
    console.log('');

    console.log('快速卖出代币列表:');
    console.log('代币                      收益%     趋势比    回撤%    早期收益%');
    console.log('─'.repeat(70));

    superFastTrades.forEach(t => {
      const profitColor = t.profitPercent >= 0 ? '\x1b[32m' : '\x1b[31m';
      const resetColor = '\x1b[0m';

      console.log(
        (t.token_symbol.padEnd(24)) +
        profitColor + t.profitPercent.toFixed(2).padStart(8) + '%' + resetColor +
        (t.trendRiseRatio > 0 ? t.trendRiseRatio.toFixed(2).padStart(10) : 'N/A'.padStart(10)) +
        (t.drawdownFromHighest ? t.drawdownFromHighest.toFixed(1).padStart(9) : 'N/A'.padStart(9)) +
        (t.earlyReturn ? t.earlyReturn.toFixed(1).padStart(10) : 'N/A'.padStart(10))
      );
    });
  }

  // 获取实验配置
  const { data: experiment } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', experimentId)
    .single();

  console.log('\n╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    策略配置                                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const config = experiment?.config;
  if (config?.strategiesConfig?.buyStrategies) {
    config.strategiesConfig.buyStrategies.forEach((s, i) => {
      console.log(`买入策略 ${i + 1}:`);
      console.log(`  条件: ${s.condition}`);
      console.log(`  购买前检查: ${s.preBuyCheckCondition || '未设置'}`);
      console.log('');
    });
  }

  if (config?.strategiesConfig?.sellStrategies) {
    config.strategiesConfig.sellStrategies.forEach((s, i) => {
      console.log(`卖出策略 ${i + 1}:`);
      console.log(`  条件: ${s.condition}`);
      console.log('');
    });
  }

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('分析完成');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

analyzeTrades().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
