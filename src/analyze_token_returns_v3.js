const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function analyzeTokenReturns() {
  const experimentId = '73aca84a-683c-4f6a-b66c-06378dbc48be';

  // 1. 获取所有交易数据（按时间排序）
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('success', true)
    .order('created_at', { ascending: true });

  // 2. 获取所有信号数据（按时间排序）
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .order('created_at', { ascending: true });

  // 3. 为每个交易找到对应的信号（交易时间之前的最近信号）
  const tradesWithFactors = trades.map(trade => {
    const tradeTime = new Date(trade.created_at);
    const tokenAddr = trade.token_address;

    // 找到该代币在交易时间之前的最近买入信号
    const matchingSignals = signals
      .filter(s => s.token_address === tokenAddr && new Date(s.created_at) <= tradeTime)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const signal = matchingSignals[0]; // 最近的一个信号

    return {
      ...trade,
      factors: signal?.metadata || null,
      signalTime: signal?.created_at || null
    };
  });

  // 4. 按代币分组，计算收益
  const tokenMap = new Map();

  tradesWithFactors.forEach(trade => {
    const addr = trade.token_address;
    if (!tokenMap.has(addr)) {
      tokenMap.set(addr, {
        tokenAddress: addr,
        symbol: trade.token_symbol,
        buys: [],
        sells: []
      });
    }

    const direction = trade.trade_direction || trade.direction || trade.action;
    const isBuy = direction === 'buy' || direction === 'BUY';

    if (isBuy) {
      tokenMap.get(addr).buys.push(trade);
    } else {
      tokenMap.get(addr).sells.push(trade);
    }
  });

  // 5. 计算每个代币的收益，并记录第一次买入时的因子
  const results = [];

  for (const [addr, data] of tokenMap) {
    const pnl = calculateTokenPnL([...data.buys, ...data.sells]);
    if (pnl && data.buys.length > 0) {
      // 使用第一次买入交易时的因子
      const firstBuy = data.buys[0];
      const factors = firstBuy.factors || {};

      results.push({
        tokenAddress: addr,
        symbol: data.symbol,
        pnl: pnl,
        factors: factors,
        firstBuyTime: firstBuy.created_at,
        signalTime: firstBuy.signalTime,
        buyCount: data.buys.length,
        sellCount: data.sells.length
      });
    }
  }

  results.sort((a, b) => b.pnl.returnRate - a.pnl.returnRate);

  const profit = results.filter(r => r.pnl.returnRate > 0);
  const loss = results.filter(r => r.pnl.returnRate < 0);

  console.log('========== 代币收益详情（使用第一次买入时的因子） ==========\n');

  // 打印所有代币的详细数据
  console.log('代币 | 收益率 | age | fdv | holders | earlyReturn | riseSpeed');
  console.log('---');
  results.forEach(r => {
    const sign = r.pnl.returnRate > 0 ? '+' : '';
    const cat = r.pnl.returnRate > 0 ? '🟢' : '🔴';
    console.log(`${cat} ${r.symbol.padEnd(20)} | ${sign}${r.pnl.returnRate.toFixed(2).padStart(7)}% | ${format(r.factors.age)} | ${format(r.factors.fdv)} | ${format(r.factors.holders)} | ${format(r.factors.earlyReturn)}% | ${format(r.factors.riseSpeed)}`);
  });

  // 因子对比
  console.log('\n========== 盈利 vs 亏损 代币因子对比 ==========');

  const factors = ['age', 'fdv', 'tvl', 'holders', 'txVolumeU24h', 'earlyReturn', 'riseSpeed'];

  console.log('\n因子 | 盈利平均 | 亏损平均 | 差异');
  console.log('---');

  for (const factor of factors) {
    const profitValues = profit.map(r => r.factors[factor]).filter(v => v !== undefined && v !== null);
    const lossValues = loss.map(r => r.factors[factor]).filter(v => v !== undefined && v !== null);

    if (profitValues.length === 0 || lossValues.length === 0) continue;

    const profitAvg = profitValues.reduce((a, b) => a + b, 0) / profitValues.length;
    const lossAvg = lossValues.reduce((a, b) => a + b, 0) / lossValues.length;
    const diff = profitAvg - lossAvg;

    console.log(`${factor} | ${format(profitAvg)} | ${format(lossAvg)} | ${format(diff)}`);
  }

  // 测试过滤条件
  console.log('\n========== 过滤条件测试 ==========');
  console.log('条件 | 盈利保留 | 亏损过滤');
  console.log('---');

  const tests = [
    { name: 'holders >= 25', filter: r => (r.factors.holders || 0) >= 25 },
    { name: 'holders >= 20', filter: r => (r.factors.holders || 0) >= 20 },
    { name: 'riseSpeed < 100', filter: r => (r.factors.riseSpeed || 0) < 100 },
    { name: 'riseSpeed < 60', filter: r => (r.factors.riseSpeed || 0) < 60 },
    { name: 'earlyReturn < 120', filter: r => (r.factors.earlyReturn || 0) < 120 },
    { name: 'earlyReturn < 100', filter: r => (r.factors.earlyReturn || 0) < 100 },
    { name: 'fdv < 10000', filter: r => (r.factors.fdv || 999999) < 10000 },
    { name: 'holders >= 25 AND riseSpeed < 100', filter: r => (r.factors.holders || 0) >= 25 && (r.factors.riseSpeed || 0) < 100 },
    { name: 'holders >= 25 AND earlyReturn < 120', filter: r => (r.factors.holders || 0) >= 25 && (r.factors.earlyReturn || 0) < 120 },
  ];

  let bestCondition = null;
  let bestScore = -1;

  for (const test of tests) {
    const profitMatched = profit.filter(test.filter);
    const lossFiltered = loss.filter(r => !test.filter(r));

    if (profitMatched.length === 0) continue;

    const profitRecall = profitMatched.length / profit.length;
    const lossFilterRate = lossFiltered.length / loss.length;
    const score = profitRecall * 0.5 + lossFilterRate * 0.5;

    if (score > bestScore) {
      bestScore = score;
      bestCondition = { ...test, profitMatched, lossFiltered, profitRecall, lossFilterRate, score };
    }

    const lostProfit = profit.filter(r => !test.filter(r));
    const desc = lostProfit.length > 0 ? `误杀: ${lostProfit.map(r => r.symbol).join(', ')}` : '-';

    console.log(`${test.name.padEnd(45)} | ${profitMatched.length}/${profit.length} (${(profitRecall * 100).toFixed(0)}%) | ${lossFiltered.length}/${loss.length} (${(lossFilterRate * 100).toFixed(0)}%) | ${desc}`);
  }

  // 推荐条件
  console.log('\n========== 推荐过滤条件 ==========');
  if (bestCondition) {
    console.log(`推荐: ${bestCondition.name}`);
    console.log(`  - 盈利保留: ${bestCondition.profitMatched.length}/${profit.length} (${(bestCondition.profitRecall * 100).toFixed(0)}%)`);
    console.log(`  - 亏损过滤: ${bestCondition.lossFiltered.length}/${loss.length} (${(bestCondition.lossFilterRate * 100).toFixed(0)}%)`);
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
