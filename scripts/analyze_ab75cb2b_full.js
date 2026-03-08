/**
 * 完整分析回测实验 ab75cb2b-4930-4049-a3bd-f96e3de6af47
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function analyzeBacktest() {
  const experimentId = 'ab75cb2b-4930-4049-a3bd-f96e3de6af47';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║           回测实验分析报告                                               ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取实验信息
  const { data: experiment } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', experimentId)
    .single();

  console.log('实验: ' + experiment.experiment_name);
  console.log('');

  // 获取交易数据
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  if (!trades || trades.length === 0) {
    console.log('没有交易数据');
    return;
  }

  console.log('【交易概况】');
  console.log(`  总交易数: ${trades.length}`);

  const buyTrades = trades.filter(t => t.trade_direction === 'buy');
  const sellTrades = trades.filter(t => t.trade_direction === 'sell');
  console.log(`  买入: ${buyTrades.length}`);
  console.log(`  卖出: ${sellTrades.length}`);
  console.log(`  当前持仓: ${buyTrades.length - sellTrades.length} 个代币`);
  console.log('');

  // 按代币分组计算收益
  const tokenMap = new Map();
  
  trades.forEach(trade => {
    if (!tokenMap.has(trade.token_address)) {
      tokenMap.set(trade.token_address, {
        token_address: trade.token_address,
        token_symbol: trade.token_symbol,
        buys: [],
        sells: [],
        totalBuyBNB: 0,
        totalSellBNB: 0
      });
    }
    const token = tokenMap.get(trade.token_address);
    if (trade.trade_direction === 'buy') {
      token.buys.push(trade);
      token.totalBuyBNB += trade.input_amount || 0;
    } else {
      token.sells.push(trade);
      token.totalSellBNB += trade.output_amount * trade.unit_price || 0;
    }
  });

  // 计算每个代币的收益
  const results = [];
  tokenMap.forEach((data) => {
    const totalBuyBNB = data.totalBuyBNB;
    const totalSellBNB = data.totalSellBNB;
    const profitBNB = totalSellBNB - totalBuyBNB;
    const profitPercent = totalBuyBNB > 0 ? (profitBNB / totalBuyBNB) * 100 : 0;
    const status = data.sells.length > 0 ? '已卖出' : '持仓中';
    
    // 从交易metadata中获取最高价格来计算最大收益
    let maxReturnPercent = 0;
    if (data.buys.length > 0) {
      const buyMetadata = data.buys[0].metadata?.factors?.trendFactors;
      if (buyMetadata) {
        const buyPrice = buyMetadata.currentPrice || buyMetadata.buyPrice || buyMetadata.collectionPrice || 0;
        const highestPrice = buyMetadata.highestPrice || buyPrice;
        if (buyPrice > 0 && highestPrice > buyPrice) {
          maxReturnPercent = ((highestPrice - buyPrice) / buyPrice) * 100;
        }
      }
    }

    results.push({
      ...data,
      totalBuyBNB,
      totalSellBNB,
      profitBNB,
      profitPercent,
      maxReturnPercent,
      status
    });
  });

  // 排序
  results.sort((a, b) => b.profitPercent - a.profitPercent);

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    代币收益详情                                               ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log('序号  代币                      状态      投入BNB   返回BNB   收益BNB    收益率%    最高收益%');
  console.log('─'.repeat(100));

  results.forEach((t, index) => {
    const statusIcon = t.status === '已卖出' ? '✓' : '○';
    const profitColor = t.profitBNB >= 0 ? '\x1b[32m' : '\x1b[31m';
    const resetColor = '\x1b[0m';

    console.log(
      String(index + 1).padStart(4) + '. ' +
      (t.token_symbol || t.token_address.substring(0, 10)).padEnd(24) +
      statusIcon.padEnd(8) +
      t.totalBuyBNB.toFixed(4).padStart(10) +
      t.totalSellBNB.toFixed(4).padStart(10) +
      profitColor + t.profitBNB.toFixed(4).padStart(10) + resetColor +
      profitColor + t.profitPercent.toFixed(2).padStart(8) + '%' + resetColor +
      t.maxReturnPercent.toFixed(2).padStart(10) + '%'
    );
  });
  console.log('');

  // 统计
  const profitableTokens = results.filter(t => t.profitBNB > 0);
  const lossTokens = results.filter(t => t.profitBNB < 0);
  const totalInvested = results.reduce((sum, t) => sum + t.totalBuyBNB, 0);
  const totalReturned = results.reduce((sum, t) => sum + t.totalSellBNB, 0);
  const totalProfit = totalReturned - totalInvested;
  const totalProfitPercent = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
  const winRate = results.length > 0 ? (profitableTokens.length / results.length) * 100 : 0;

  console.log('【整体统计】');
  console.log(`  总投入: ${totalInvested.toFixed(4)} BNB`);
  console.log(`  总返回: ${totalReturned.toFixed(4)} BNB`);
  console.log(`  总收益: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(4)} BNB (${totalProfitPercent >= 0 ? '+' : ''}${totalProfitPercent.toFixed(2)}%)`);
  console.log(`  盈利代币: ${profitableTokens.length}`);
  console.log(`  亏损代币: ${lossTokens.length}`);
  console.log(`  胜率: ${winRate.toFixed(1)}%`);
  console.log('');

  // 收益分布
  const avgReturn = results.length > 0 ? results.reduce((sum, t) => sum + t.profitPercent, 0) / results.length : 0;
  const maxReturn = Math.max(...results.map(t => t.profitPercent));
  const minReturn = Math.min(...results.map(t => t.profitPercent));

  console.log(`  平均收益率: ${avgReturn.toFixed(2)}%`);
  console.log(`  最高收益率: ${maxReturn.toFixed(2)}%`);
  console.log(`  最低收益率: ${minReturn.toFixed(2)}%`);
  console.log('');

  // 分析策略配置
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    策略配置                                                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const config = experiment.config;
  if (config && config.strategiesConfig) {
    const buyStrategy = config.strategiesConfig.buyStrategies?.[0];
    if (buyStrategy) {
      console.log('买入条件:');
      console.log(`  ${buyStrategy.condition}`);
      console.log('');
      console.log('购买前检查:');
      console.log(`  ${buyStrategy.preBuyCheckCondition || '未设置'}`);
      console.log('');

      // 分析新增的 trendRiseRatio 条件
      if (buyStrategy.condition.includes('trendRiseRatio')) {
        console.log('【策略亮点】');
        console.log('  新增了 trendRiseRatio >= 0.6 条件');
        console.log('  这要求上涨K线占比达到60%，过滤掉波动较大的代币');
      }
    }

    const sellStrategy = config.strategiesConfig.sellStrategies?.[0];
    if (sellStrategy) {
      console.log('卖出条件:');
      console.log(`  ${sellStrategy.condition}`);
    }
  }

  // 分析最佳和最差代币
  console.log('');
  console.log('【最佳交易 Top 3】');
  results.slice(0, 3).forEach((t, i) => {
    console.log(`  ${i + 1}. ${t.token_symbol}: ${t.profitPercent.toFixed(2)}% (${t.status})`);
    if (t.buys[0]?.metadata?.factors?.trendFactors) {
      const factors = t.buys[0].metadata.factors.trendFactors;
      console.log(`     早期收益率: ${factors.earlyReturn?.toFixed(2) || 'N/A'}%`);
      console.log(`     trendRiseRatio: ${factors.trendRiseRatio?.toFixed(2) || 'N/A'}`);
    }
  });
  console.log('');

  if (lossTokens.length > 0) {
    console.log('【最差交易 Top 3】');
    lossTokens.slice(0, 3).forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.token_symbol}: ${t.profitPercent.toFixed(2)}%`);
    });
    console.log('');
  }
}

analyzeBacktest().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
