/**
 * 分析源实验 afed3289-2f89-4da5-88f1-1468d61f8b3d 的交易数据
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function analyzeSourceExperiment() {
  const experimentId = 'afed3289-2f89-4da5-88f1-1468d61f8b3d';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║           源实验交易数据分析                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取实验信息
  const { data: experiment } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', experimentId)
    .single();

  console.log('实验: ' + experiment.experiment_name);
  console.log('状态: ' + experiment.status);
  console.log('模式: ' + experiment.trading_mode);
  console.log('');

  // 获取交易记录
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  console.log('【交易概况】');
  console.log(`  总交易数: ${trades?.length || 0}`);

  if (!trades || trades.length === 0) {
    console.log('  没有交易记录');
    return;
  }

  const buyTrades = trades.filter(t => t.action === 'buy');
  const sellTrades = trades.filter(t => t.action === 'sell');
  console.log(`  买入: ${buyTrades.length}`);
  console.log(`  卖出: ${sellTrades.length}`);
  console.log(`  当前持仓: ${buyTrades.length - sellTrades.length}`);
  console.log('');

  // 按代币分组
  const tokenTrades = new Map();
  trades.forEach(trade => {
    if (!tokenTrades.has(trade.token_address)) {
      tokenTrades.set(trade.token_address, {
        token_address: trade.token_address,
        token_symbol: trade.token_symbol,
        buys: [],
        sells: [],
        totalBuyAmount: 0,
        totalSellAmount: 0
      });
    }
    const token = tokenTrades.get(trade.token_address);
    if (trade.action === 'buy') {
      token.buys.push(trade);
      token.totalBuyAmount += trade.amount || 0;
    } else {
      token.sells.push(trade);
      token.totalSellAmount += trade.amount || 0;
    }
  });

  // 计算每个代币的收益
  const tokenResults = [];
  tokenTrades.forEach((data, address) => {
    const profit = data.totalSellAmount - data.totalBuyAmount;
    const profitPercent = data.totalBuyAmount > 0 ? (profit / data.totalBuyAmount) * 100 : 0;
    const status = data.sells.length > 0 ? '已卖出' : '持仓中';

    tokenResults.push({
      ...data,
      profit,
      profitPercent,
      status
    });
  });

  // 排序
  tokenResults.sort((a, b) => b.profitPercent - a.profitPercent);

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    代币收益详情                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log('序号  代币                      状态      投入      返回      收益       收益率%');
  console.log('─'.repeat(88));

  tokenResults.forEach((t, index) => {
    const statusIcon = t.status === '已卖出' ? '✓' : '○';
    const profitColor = t.profit >= 0 ? '\x1b[32m' : '\x1b[31m';
    const resetColor = '\x1b[0m';

    console.log(
      String(index + 1).padStart(4) + '. ' +
      (t.token_symbol || t.token_address.substring(0, 8)).padEnd(24) +
      statusIcon.padEnd(8) +
      t.totalBuyAmount.toFixed(4).padStart(8) +
      t.totalSellAmount.toFixed(4).padStart(10) +
      profitColor + t.profit.toFixed(4).padStart(10) + resetColor +
      profitColor + t.profitPercent.toFixed(2).padStart(8) + '%' + resetColor
    );
  });
  console.log('');

  // 统计
  const profitableTokens = tokenResults.filter(t => t.profit > 0);
  const lossTokens = tokenResults.filter(t => t.profit < 0);
  const totalInvested = tokenResults.reduce((sum, t) => sum + t.totalBuyAmount, 0);
  const totalReturned = tokenResults.reduce((sum, t) => sum + t.totalSellAmount, 0);
  const totalProfit = totalReturned - totalInvested;
  const totalProfitPercent = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;

  console.log('【整体统计】');
  console.log(`  总投入: ${totalInvested.toFixed(4)} BNB`);
  console.log(`  总返回: ${totalReturned.toFixed(4)} BNB`);
  console.log(`  总收益: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(4)} BNB (${totalProfitPercent >= 0 ? '+' : ''}${totalProfitPercent.toFixed(2)}%)`);
  console.log(`  盈利代币: ${profitableTokens.length}`);
  console.log(`  亏损代币: ${lossTokens.length}`);
  console.log('');

  // 获取购买信号数据
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy');

  console.log('【购买信号】');
  console.log(`  总信号数: ${signals?.length || 0}`);

  if (signals && signals.length > 0) {
    let passedCount = 0;
    let failedCount = 0;

    signals.forEach(signal => {
      try {
        let metadata = signal.metadata;
        if (typeof metadata === 'string') {
          metadata = JSON.parse(metadata);
        }
        const status = metadata?.execution_status;
        if (status === 'success') passedCount++;
        else failedCount++;
      } catch (e) {}
    });

    console.log(`  通过: ${passedCount}`);
    console.log(`  失败: ${failedCount}`);
    console.log(`  通过率: ${signals.length > 0 ? (passedCount / signals.length * 100).toFixed(1) : 0}%`);
  }

  // 分析策略配置
  console.log('');
  console.log('【策略配置】');
  const config = experiment.config;
  if (config && config.strategiesConfig) {
    console.log('');
    console.log('买入条件:');
    console.log(`  ${config.strategiesConfig.buyStrategies?.[0]?.condition || '未设置'}`);
    console.log('');
    console.log('购买前检查:');
    console.log(`  ${config.strategiesConfig.buyStrategies?.[0]?.preBuyCheckCondition || '未设置'}`);
  }
}

analyzeSourceExperiment().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
