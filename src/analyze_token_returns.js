const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function analyzeTokenReturns() {
  const experimentId = '73aca84a-683c-4f6a-b66c-06378dbc48be';

  // 1. 获取所有交易数据
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  // 2. 获取所有信号数据
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .order('created_at', { ascending: true });

  // 3. 计算每个代币的收益
  const tokenMap = new Map();

  // 先处理交易数据
  trades?.forEach(trade => {
    const addr = trade.token_address;
    if (!tokenMap.has(addr)) {
      tokenMap.set(addr, {
        tokenAddress: addr,
        symbol: trade.token_symbol,
        trades: [],
        buySignals: [],
        firstSignal: null
      });
    }
    tokenMap.get(addr).trades.push(trade);
  });

  // 再处理信号数据
  signals?.forEach(signal => {
    const addr = signal.token_address;
    if (!tokenMap.has(addr)) {
      tokenMap.set(addr, {
        tokenAddress: addr,
        symbol: signal.token_symbol,
        trades: [],
        buySignals: [],
        firstSignal: null
      });
    }
    const token = tokenMap.get(addr);
    token.buySignals.push(signal);

    // 记录第一个买入信号的时间
    if (!token.firstSignal || new Date(signal.created_at) < new Date(token.firstSignal.created_at)) {
      token.firstSignal = signal;
    }
  });

  // 4. 计算每个代币的收益（使用 FIFO 方法）
  const results = [];

  for (const [addr, token] of tokenMap) {
    const pnl = calculateTokenPnL(token.trades);
    if (pnl) {
      // 获取信号时的因子数据
      const factors = token.firstSignal?.metadata || {};

      results.push({
        tokenAddress: addr,
        symbol: token.symbol,
        pnl: pnl,
        factors: factors,
        signalCount: token.buySignals.length
      });
    }
  }

  // 5. 按收益率排序
  results.sort((a, b) => b.pnl.returnRate - a.pnl.returnRate);

  // 6. 分类
  const profit = results.filter(r => r.pnl.returnRate > 0);
  const loss = results.filter(r => r.pnl.returnRate < 0);
  const highProfit = results.filter(r => r.pnl.returnRate >= 30);
  const lowProfit = results.filter(r => r.pnl.returnRate >= 0 && r.pnl.returnRate < 30);
  const highLoss = results.filter(r => r.pnl.returnRate <= -30);

  console.log('========== 代币收益分类 ==========');
  console.log(`总代币数: ${results.length}`);
  console.log(`盈利代币: ${profit.length} (${(profit.length / results.length * 100).toFixed(1)}%)`);
  console.log(`  - 高收益 (≥30%): ${highProfit.length}`);
  console.log(`  - 低收益 (0-30%): ${lowProfit.length}`);
  console.log(`亏损代币: ${loss.length} (${(loss.length / results.length * 100).toFixed(1)}%)`);
  console.log(`  - 高亏损 (≤-30%): ${highLoss.length}`);

  // 7. 详细对比分析
  console.log('\n========== 盈利 vs 亏损 代币因子对比 ==========');

  const factors = ['age', 'fdv', 'tvl', 'holders', 'txVolumeU24h', 'earlyReturn', 'riseSpeed', 'currentPrice', 'collectionPrice'];

  console.log('\n因子 | 盈利平均 | 亏损平均 | 差异 | 说明');
  console.log('---');

  for (const factor of factors) {
    const profitValues = profit.map(r => r.factors[factor]).filter(v => v !== undefined && v !== null);
    const lossValues = loss.map(r => r.factors[factor]).filter(v => v !== undefined && v !== null);

    if (profitValues.length === 0 || lossValues.length === 0) continue;

    const profitAvg = profitValues.reduce((a, b) => a + b, 0) / profitValues.length;
    const lossAvg = lossValues.reduce((a, b) => a + b, 0) / lossValues.length;
    const diff = profitAvg - lossAvg;

    let desc = '';
    if (factor === 'riseSpeed') {
      desc = diff > 0 ? '盈利代币涨速更快' : '亏损代币涨速更快';
    } else if (factor === 'earlyReturn') {
      desc = diff > 0 ? '盈利代币早期收益更高' : '亏损代币早期收益更高';
    }

    console.log(`${factor} | ${format(profitAvg)} | ${format(lossAvg)} | ${format(diff)} | ${desc}`);
  }

  // 8. 列出所有代币详情
  console.log('\n========== 所有代币收益详情 ==========');
  console.log('代币 | 收益率 | 盈亏 | age | fdv | earlyReturn | riseSpeed');
  console.log('---');

  results.forEach(r => {
    const sign = r.pnl.returnRate > 0 ? '+' : '';
    const category = r.pnl.returnRate >= 30 ? '🟢' : r.pnl.returnRate >= 0 ? '🟡' : '🔴';
    console.log(`${category} ${r.symbol} | ${sign}${r.pnl.returnRate.toFixed(2)}% | ${r.pnl.realizedPnL.toFixed(3)} | ${format(r.factors.age)} | ${format(r.factors.fdv)} | ${format(r.factors.earlyReturn)}% | ${format(r.factors.riseSpeed)}`);
  });

  // 9. 测试过滤条件
  console.log('\n========== 过滤条件测试 ==========');
  console.log('条件 | 盈利保留 | 亏损过滤 | 准确率 | 说明');
  console.log('---');

  const tests = [
    { name: 'riseSpeed > 0', filter: r => (r.factors.riseSpeed || 0) > 0 },
    { name: 'riseSpeed > 1', filter: r => (r.factors.riseSpeed || 0) > 1 },
    { name: 'riseSpeed > 2', filter: r => (r.factors.riseSpeed || 0) > 2 },
    { name: 'riseSpeed > 3', filter: r => (r.factors.riseSpeed || 0) > 3 },
    { name: 'earlyReturn > 0', filter: r => (r.factors.earlyReturn || 0) > 0 },
    { name: 'earlyReturn > 5', filter: r => (r.factors.earlyReturn || 0) > 5 },
    { name: 'earlyReturn > 10', filter: r => (r.factors.earlyReturn || 0) > 10 },
    { name: 'age < 10', filter: r => (r.factors.age || 999) < 10 },
    { name: 'age < 5', filter: r => (r.factors.age || 999) < 5 },
    { name: 'fdv < 50000', filter: r => (r.factors.fdv || 999999) < 50000 },
    { name: 'fdv < 20000', filter: r => (r.factors.fdv || 999999) < 20000 },
    { name: 'riseSpeed > 1 AND earlyReturn > 5', filter: r => (r.factors.riseSpeed || 0) > 1 && (r.factors.earlyReturn || 0) > 5 },
    { name: 'riseSpeed > 2 AND earlyReturn > 10', filter: r => (r.factors.riseSpeed || 0) > 2 && (r.factors.earlyReturn || 0) > 10 },
    { name: 'riseSpeed > 0 AND earlyReturn > 0 AND age < 10', filter: r => (r.factors.riseSpeed || 0) > 0 && (r.factors.earlyReturn || 0) > 0 && (r.factors.age || 999) < 10 },
  ];

  for (const test of tests) {
    const profitMatched = profit.filter(test.filter);
    const lossFiltered = loss.filter(r => !test.filter(r));

    if (profitMatched.length === 0 && lossFiltered.length === 0) continue;

    const profitRecall = profit.length > 0 ? profitMatched.length / profit.length : 0;
    const lossFilterRate = loss.length > 0 ? lossFiltered.length / loss.length : 0;
    const accuracy = (profitMatched.length + lossFiltered.length) / results.length;

    console.log(`${test.name} | ${profitMatched.length}/${profit.length} (${(profitRecall * 100).toFixed(0)}%) | ${lossFiltered.length}/${loss.length} (${(lossFilterRate * 100).toFixed(0)}%) | ${(accuracy * 100).toFixed(0)}%`);
  }

  // 10. 找出最佳过滤条件
  console.log('\n========== 推荐过滤条件 ==========');

  // 目标：尽量保留盈利代币，过滤掉亏损代币
  let bestCondition = null;
  let bestScore = -1;

  for (const test of tests) {
    const profitMatched = profit.filter(test.filter).length;
    const lossFiltered = loss.filter(r => !test.filter(r)).length;

    // 评分 = 盈利保留率 * 0.6 + 亏损过滤率 * 0.4
    const profitRecall = profit.length > 0 ? profitMatched / profit.length : 0;
    const lossFilterRate = loss.length > 0 ? lossFiltered / loss.length : 0;
    const score = profitRecall * 0.6 + lossFilterRate * 0.4;

    if (score > bestScore && profitMatched > 0) {
      bestScore = score;
      bestCondition = { ...test, profitMatched, lossFiltered, profitRecall, lossFilterRate, score };
    }
  }

  if (bestCondition) {
    console.log(`推荐: ${bestCondition.name}`);
    console.log(`  - 盈利保留: ${bestCondition.profitMatched}/${profit.length} (${(bestCondition.profitRecall * 100).toFixed(0)}%)`);
    console.log(`  - 亏损过滤: ${bestCondition.lossFiltered}/${loss.length} (${(bestCondition.lossFilterRate * 100).toFixed(0)}%)`);
    console.log(`  - 综合评分: ${(bestCondition.score * 100).toFixed(0)}%`);
  }
}

function calculateTokenPnL(tokenTrades) {
  const buyQueue = [];
  let totalRealizedPnL = 0;
  let totalBNBSpent = 0;
  let totalBNBReceived = 0;

  tokenTrades.forEach(trade => {
    const direction = trade.trade_direction || trade.direction || trade.action;
    const isBuy = direction === 'buy' || direction === 'BUY';

    if (isBuy) {
      const inputAmount = parseFloat(trade.input_amount || 0);
      const outputAmount = parseFloat(trade.output_amount || 0);

      if (outputAmount > 0) {
        buyQueue.push({
          amount: outputAmount,
          cost: inputAmount
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

  let remainingCost = 0;
  buyQueue.forEach(buy => {
    remainingCost += buy.cost;
  });

  const totalCost = totalBNBSpent || 1;
  const totalValue = totalBNBReceived + remainingCost;
  const returnRate = ((totalValue - totalCost) / totalCost) * 100;

  return {
    returnRate,
    realizedPnL: totalRealizedPnL,
    totalSpent: totalBNBSpent,
    totalReceived: totalBNBReceived
  };
}

function format(val) {
  if (val === undefined || val === null) return 'N/A';
  if (typeof val === 'number') return val.toFixed(2);
  return val;
}

analyzeTokenReturns();
