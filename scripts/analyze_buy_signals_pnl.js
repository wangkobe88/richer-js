require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

/**
 * 计算单个代币的盈亏（使用FIFO方法）
 */
function calculateTokenPnL(tokenTrades) {
  // 按时间排序
  const sortedTrades = tokenTrades
    .filter(t => t.status === 'success' || t.trade_status === 'success')
    .sort((a, b) => new Date(a.created_at || a.executed_at) - new Date(b.created_at || b.executed_at));

  if (sortedTrades.length === 0) {
    return null;
  }

  const buyQueue = [];
  let totalRealizedPnL = 0;
  let totalBNBSpent = 0;
  let totalBNBReceived = 0;

  sortedTrades.forEach(trade => {
    const direction = trade.trade_direction || trade.direction || trade.action;
    const isBuy = direction === 'buy' || direction === 'BUY';

    if (isBuy) {
      const inputAmount = parseFloat(trade.input_amount || 0);
      const outputAmount = parseFloat(trade.output_amount || 0);
      const unitPrice = parseFloat(trade.unit_price || 0);

      if (outputAmount > 0) {
        buyQueue.push({
          amount: outputAmount,
          cost: inputAmount,
          price: unitPrice
        });
        totalBNBSpent += inputAmount;
      }
    } else {
      const inputAmount = parseFloat(trade.input_amount || 0);
      const outputAmount = parseFloat(trade.output_amount || 0);

      let remainingToSell = inputAmount;
      let costOfSold = 0;

      while (remainingToSell > 0 && buyQueue.length > 0) {
        const oldestBuy = buyQueue[0];
        const sellAmount = Math.min(remainingToSell, oldestBuy.amount);

        const unitCost = oldestBuy.cost / oldestBuy.amount;
        costOfSold += unitCost * sellAmount;
        remainingToSell -= sellAmount;

        oldestBuy.amount -= sellAmount;
        oldestBuy.cost -= unitCost * sellAmount;

        if (oldestBuy.amount <= 0.00000001) {
          buyQueue.shift();
        }
      }

      totalBNBReceived += outputAmount;
      totalRealizedPnL += (outputAmount - costOfSold);
    }
  });

  // 剩余持仓
  let remainingAmount = 0;
  let remainingCost = 0;
  buyQueue.forEach(buy => {
    remainingAmount += buy.amount;
    remainingCost += buy.cost;
  });

  const totalCost = totalBNBSpent || 1;
  const totalValue = totalBNBReceived + remainingCost;
  const returnRate = ((totalValue - totalCost) / totalCost) * 100;

  let status = 'monitoring';
  if (buyQueue.length === 0) {
    status = 'exited';
  } else if (totalBNBReceived > 0) {
    status = 'bought';
  }

  return {
    returnRate,
    realizedPnL: totalRealizedPnL,
    totalSpent: totalBNBSpent,
    totalReceived: totalBNBReceived,
    remainingAmount,
    remainingCost,
    status,
    buyCount: sortedTrades.filter(t => (t.trade_direction || t.direction || t.action) === 'buy' || (t.trade_direction || t.direction || t.action) === 'BUY').length,
    sellCount: sortedTrades.filter(t => (t.trade_direction || t.direction || t.action) === 'sell' || (t.trade_direction || t.direction || t.action) === 'SELL').length
  };
}

async function analyzeBuySignalsWithPnL() {
  const experimentId = '21b23e96-e25d-4ea2-bcf8-1762ffffc702';

  console.log('正在获取买入信号...');
  const { data: signals, error: signalError } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .order('created_at', { ascending: true });

  if (signalError) {
    console.log('查询信号错误:', signalError.message);
    return;
  }

  console.log('找到 ' + signals.length + ' 条买入信号\n');

  console.log('正在获取交易数据...');
  const { data: trades, error: tradeError } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  if (tradeError) {
    console.log('查询交易错误:', tradeError.message);
    return;
  }

  console.log('找到 ' + trades.length + ' 条交易记录\n');

  // 按代币地址分组交易
  const tradesByToken = new Map();
  trades.forEach(t => {
    const addr = t.token_address;
    if (!tradesByToken.has(addr)) {
      tradesByToken.set(addr, []);
    }
    tradesByToken.get(addr).push(t);
  });

  // 关联信号和盈亏
  const results = [];

  for (const signal of signals) {
    const tokenAddr = signal.token_address;
    const tokenTrades = tradesByToken.get(tokenAddr) || [];
    const pnl = tokenTrades.length > 0 ? calculateTokenPnL(tokenTrades) : null;

    const meta = signal.metadata || {};

    results.push({
      tokenSymbol: signal.token_symbol,
      tokenAddress: tokenAddr,
      signalCreatedAt: signal.created_at,
      hasTrades: tokenTrades.length > 0,
      tradeCount: tokenTrades.length,
      // 信号时的参数
      buyAge: meta.age,
      buyEarlyReturn: meta.earlyReturn,
      buyRiseSpeed: meta.riseSpeed,
      buyHolders: meta.holders,
      buyDrawdown: meta.drawdownFromHighest,
      buyCards: meta.cards,
      buyMarketCap: meta.marketCap,
      buyFdV: meta.fdv,
      buyTVL: meta.tvl,
      buyTxVolume: meta.txVolumeU24h,
      // 实际盈亏
      returnRate: pnl?.returnRate ?? null,
      realizedPnL: pnl?.realizedPnL ?? null,
      totalSpent: pnl?.totalSpent ?? null,
      status: pnl?.status ?? 'no_trades',
      buyCount: pnl?.buyCount ?? 0,
      sellCount: pnl?.sellCount ?? 0
    });
  }

  // 统计
  const withTrades = results.filter(r => r.hasTrades);
  const profitCount = withTrades.filter(r => r.returnRate > 0).length;
  const lossCount = withTrades.filter(r => r.returnRate < 0).length;
  const breakEvenCount = withTrades.filter(r => Math.abs(r.returnRate) < 0.01).length;

  console.log('=== 买入信号与盈亏分析 ===\n');
  console.log('总买入信号数: ' + results.length);
  console.log('有交易的代币: ' + withTrades.length);
  console.log('盈利: ' + profitCount + ', 亏损: ' + lossCount + ', 持平: ' + breakEvenCount);
  console.log('胜率: ' + (withTrades.length > 0 ? (profitCount / withTrades.length * 100).toFixed(1) : 0) + '%\n');

  // 按盈亏排序显示
  console.log('=== 按收益率排序 ===\n');
  const sortedByReturn = [...withTrades].sort((a, b) => b.returnRate - a.returnRate);

  sortedByReturn.forEach((r, i) => {
    const profitSign = r.returnRate > 0 ? '+' : '';
    const pnlSign = r.realizedPnL > 0 ? '+' : '';
    console.log((i + 1) + '. ' + r.tokenSymbol);
    console.log('   收益率: ' + profitSign + r.returnRate.toFixed(2) + '%');
    console.log('   盈亏: ' + pnlSign + r.realizedPnL.toFixed(4) + ' BNB (花费 ' + r.totalSpent.toFixed(4) + ' BNB)');
    console.log('   买入时参数: age=' + r.buyAge?.toFixed(2) + 'min, earlyReturn=' + r.buyEarlyReturn?.toFixed(2) + '%, riseSpeed=' + r.buyRiseSpeed?.toFixed(2));
    console.log('   drawdownFromHighest=' + r.buyDrawdown?.toFixed(2) + '%, holders=' + r.buyHolders);
    console.log('');
  });

  // 分析盈利和亏损代币的参数差异
  console.log('\n=== 盈利 vs 亏损代币参数对比 ===\n');

  const profit = withTrades.filter(r => r.returnRate > 0);
  const loss = withTrades.filter(r => r.returnRate < 0);

  function avg(arr, key) {
    const values = arr.map(r => r[key]).filter(v => v !== null && v !== undefined);
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  function median(arr, key) {
    const values = arr.map(r => r[key]).filter(v => v !== null && v !== undefined).sort((a, b) => a - b);
    if (values.length === 0) return 0;
    const mid = Math.floor(values.length / 2);
    return values.length % 2 !== 0 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  }

  console.log('                | 盈利代币 (' + profit.length + ') | 亏损代币 (' + loss.length + ')');
  console.log('----------------|------------------------|------------------------');
  console.log('收益率(平均)    | ' + avg(profit, 'returnRate').toFixed(2) + '%                | ' + avg(loss, 'returnRate').toFixed(2) + '%');
  console.log('age(平均)       | ' + avg(profit, 'buyAge').toFixed(2) + ' min               | ' + avg(loss, 'buyAge').toFixed(2) + ' min');
  console.log('earlyReturn(平均)| ' + avg(profit, 'buyEarlyReturn').toFixed(2) + '%                | ' + avg(loss, 'buyEarlyReturn').toFixed(2) + '%');
  console.log('riseSpeed(平均) | ' + avg(profit, 'buyRiseSpeed').toFixed(2) + '                 | ' + avg(loss, 'buyRiseSpeed').toFixed(2));
  console.log('drawdown(平均)  | ' + avg(profit, 'buyDrawdown').toFixed(2) + '%                | ' + avg(loss, 'buyDrawdown').toFixed(2) + '%');
  console.log('holders(平均)   | ' + avg(profit, 'buyHolders').toFixed(0) + '                   | ' + avg(loss, 'buyHolders').toFixed(0));
  console.log('marketCap(中位数)| ' + (median(profit, 'buyMarketCap') / 1000).toFixed(0) + 'K                | ' + (median(loss, 'buyMarketCap') / 1000).toFixed(0) + 'K');

  // 导出完整CSV
  const csvHeaders = [
    'tokenSymbol', 'tokenAddress', 'signalCreatedAt',
    'hasTrades', 'tradeCount', 'returnRate', 'realizedPnL', 'totalSpent', 'status',
    'buyAge', 'buyEarlyReturn', 'buyRiseSpeed', 'buyHolders', 'buyDrawdown',
    'buyCards', 'buyMarketCap', 'buyFdV', 'buyTVL', 'buyTxVolume'
  ];

  const csvRows = results.map(r => [
    r.tokenSymbol, r.tokenAddress, r.signalCreatedAt,
    r.hasTrades, r.tradeCount, r.returnRate?.toFixed(2) ?? '', r.realizedPnL?.toFixed(4) ?? '', r.totalSpent?.toFixed(4) ?? '', r.status,
    r.buyAge ?? '', r.buyEarlyReturn ?? '', r.buyRiseSpeed ?? '', r.buyHolders ?? '', r.buyDrawdown ?? '',
    r.buyCards ?? '', r.buyMarketCap ?? '', r.buyFdV ?? '', r.buyTVL ?? '', r.buyTxVolume ?? ''
  ].map(v => `"${v}"`).join(','));

  const csvContent = [csvHeaders.join(','), ...csvRows].join('\n');
  const filename = 'experiment_' + experimentId.slice(0, 8) + '_buy_signals_with_pnl.csv';
  fs.writeFileSync(filename, csvContent, 'utf8');

  console.log('\n\nCSV文件已生成: ' + filename);

  // 尝试找到过滤条件
  console.log('\n=== 寻找过滤条件 ===\n');

  // 尝试不同的阈值组合
  const conditions = [
    { name: 'age < 1.5', filter: r => r.buyAge < 1.5 },
    { name: 'earlyReturn > 100', filter: r => r.buyEarlyReturn > 100 },
    { name: 'riseSpeed > 80', filter: r => r.buyRiseSpeed > 80 },
    { name: 'holders >= 30', filter: r => r.buyHolders >= 30 },
    { name: 'drawdownFromHighest = 0', filter: r => r.buyDrawdown === 0 },
    { name: 'marketCap > 5000', filter: r => r.buyMarketCap > 5000 },
    { name: 'age < 2 AND earlyReturn > 80', filter: r => r.buyAge < 2 && r.buyEarlyReturn > 80 },
    { name: 'riseSpeed > 70 AND holders >= 20', filter: r => r.buyRiseSpeed > 70 && r.buyHolders >= 20 },
  ];

  console.log('过滤条件分析 (仅统计有交易的代币):');
  console.log('条件                      | 通过数 | 盈利 | 亏损 | 胜率   | 平均收益');
  console.log('--------------------------|--------|------|------|--------|----------');

  conditions.forEach(cond => {
    const passed = withTrades.filter(cond.filter);
    const prof = passed.filter(r => r.returnRate > 0).length;
    const los = passed.filter(r => r.returnRate < 0).length;
    const winRate = passed.length > 0 ? (prof / passed.length * 100).toFixed(1) : '0.0';
    const avgRet = passed.length > 0 ? (passed.reduce((s, r) => s + r.returnRate, 0) / passed.length).toFixed(2) : '0.00';

    console.log(
      cond.name.padEnd(25) + ' | ' +
      String(passed.length).padStart(6) + ' | ' +
      String(prof).padStart(4) + '  | ' +
      String(los).padStart(4) + '  | ' +
      winRate.padStart(6) + '% | ' +
      avgRet.padStart(6) + '%'
    );
  });
}

analyzeBuySignalsWithPnL().catch(console.error);
