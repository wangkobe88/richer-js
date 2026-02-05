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

  // 3. 构建代币数据
  const tokenMap = new Map();

  trades?.forEach(trade => {
    const addr = trade.token_address;
    if (!tokenMap.has(addr)) {
      tokenMap.set(addr, {
        tokenAddress: addr,
        symbol: trade.token_symbol,
        trades: [],
        firstSignal: null
      });
    }
    tokenMap.get(addr).trades.push(trade);
  });

  signals?.forEach(signal => {
    const addr = signal.token_address;
    if (!tokenMap.has(addr)) {
      tokenMap.set(addr, {
        tokenAddress: addr,
        symbol: signal.token_symbol,
        trades: [],
        firstSignal: null
      });
    }
    const token = tokenMap.get(addr);
    if (!token.firstSignal || new Date(signal.created_at) < new Date(token.firstSignal.created_at)) {
      token.firstSignal = signal;
    }
  });

  // 4. 计算收益
  const results = [];
  for (const [addr, token] of tokenMap) {
    const pnl = calculateTokenPnL(token.trades);
    if (pnl) {
      const factors = token.firstSignal?.metadata || {};
      results.push({
        tokenAddress: addr,
        symbol: token.symbol,
        pnl: pnl,
        factors: factors
      });
    }
  }

  results.sort((a, b) => b.pnl.returnRate - a.pnl.returnRate);

  const profit = results.filter(r => r.pnl.returnRate > 0);
  const loss = results.filter(r => r.pnl.returnRate < 0);

  console.log('========== 盈利 vs 亏损 代币详细对比 ==========\n');

  // 打印所有代币的详细数据
  console.log('代币 | 收益率 | age | fdv | holders | earlyReturn | riseSpeed');
  console.log('---');
  results.forEach(r => {
    const sign = r.pnl.returnRate > 0 ? '+' : '';
    const cat = r.pnl.returnRate > 0 ? '🟢' : '🔴';
    console.log(`${cat} ${r.symbol.padEnd(20)} | ${sign}${r.pnl.returnRate.toFixed(2).padStart(7)}% | ${format(r.factors.age)} | ${format(r.factors.fdv)} | ${format(r.factors.holders)} | ${format(r.factors.earlyReturn)}% | ${format(r.factors.riseSpeed)}`);
  });

  // 5. 测试更多过滤条件
  console.log('\n========== 过滤条件测试 ==========');
  console.log('条件 | 盈利保留 | 亏损过滤 | 说明');
  console.log('---');

  const tests = [
    // 基于 holders 的过滤
    { name: 'holders >= 20', filter: r => (r.factors.holders || 0) >= 20 },
    { name: 'holders >= 25', filter: r => (r.factors.holders || 0) >= 25 },
    { name: 'holders >= 30', filter: r => (r.factors.holders || 0) >= 30 },
    { name: 'holders >= 35', filter: r => (r.factors.holders || 0) >= 35 },

    // 基于 riseSpeed 的反向过滤（太高的不要）
    { name: 'riseSpeed < 100', filter: r => (r.factors.riseSpeed || 0) < 100 },
    { name: 'riseSpeed < 80', filter: r => (r.factors.riseSpeed || 0) < 80 },
    { name: 'riseSpeed < 60', filter: r => (r.factors.riseSpeed || 0) < 60 },
    { name: 'riseSpeed < 50', filter: r => (r.factors.riseSpeed || 0) < 50 },
    { name: '10 < riseSpeed < 80', filter: r => (r.factors.riseSpeed || 0) > 10 && (r.factors.riseSpeed || 0) < 80 },

    // 基于 earlyReturn 的反向过滤
    { name: 'earlyReturn < 150', filter: r => (r.factors.earlyReturn || 0) < 150 },
    { name: 'earlyReturn < 120', filter: r => (r.factors.earlyReturn || 0) < 120 },
    { name: 'earlyReturn < 100', filter: r => (r.factors.earlyReturn || 0) < 100 },
    { name: '50 < earlyReturn < 120', filter: r => (r.factors.earlyReturn || 0) > 50 && (r.factors.earlyReturn || 0) < 120 },

    // 基于 fdv
    { name: 'fdv < 10000', filter: r => (r.factors.fdv || 999999) < 10000 },
    { name: 'fdv < 9000', filter: r => (r.factors.fdv || 999999) < 9000 },

    // 组合条件
    { name: 'holders >= 25 AND riseSpeed < 100', filter: r => (r.factors.holders || 0) >= 25 && (r.factors.riseSpeed || 0) < 100 },
    { name: 'holders >= 30 AND riseSpeed < 80', filter: r => (r.factors.holders || 0) >= 30 && (r.factors.riseSpeed || 0) < 80 },
    { name: 'holders >= 25 AND earlyReturn < 120', filter: r => (r.factors.holders || 0) >= 25 && (r.factors.earlyReturn || 0) < 120 },
    { name: 'fdv < 10000 AND riseSpeed < 80', filter: r => (r.factors.fdv || 999999) < 10000 && (r.factors.riseSpeed || 0) < 80 },
    { name: 'holders >= 30 AND fdv < 10000', filter: r => (r.factors.holders || 0) >= 30 && (r.factors.fdv || 999999) < 10000 },
    { name: 'holders >= 25 AND riseSpeed < 100 AND fdv < 10000', filter: r => (r.factors.holders || 0) >= 25 && (r.factors.riseSpeed || 0) < 100 && (r.factors.fdv || 999999) < 10000 },
  ];

  let bestCondition = null;
  let bestScore = -1;

  for (const test of tests) {
    const profitMatched = profit.filter(test.filter);
    const lossFiltered = loss.filter(r => !test.filter(r));

    if (profitMatched.length === 0) continue;

    const profitRecall = profitMatched.length / profit.length;
    const lossFilterRate = lossFiltered.length / loss.length;
    const accuracy = (profitMatched.length + lossFiltered.length) / results.length;

    // 综合评分：盈利保留率 * 0.5 + 亏损过滤率 * 0.5
    const score = profitRecall * 0.5 + lossFilterRate * 0.5;

    if (score > bestScore) {
      bestScore = score;
      bestCondition = { ...test, profitMatched, lossFiltered, profitRecall, lossFilterRate, score };
    }

    const desc = lossFiltered.length > 0 ? `过滤掉 ${lossFiltered.map(l => l.symbol).join(', ')}` : '-';
    console.log(`${test.name.padEnd(50)} | ${profitMatched.length}/${profit.length} (${(profitRecall * 100).toFixed(0)}%) | ${lossFiltered.length}/${loss.length} (${(lossFilterRate * 100).toFixed(0)}%) | ${desc}`);
  }

  // 6. 推荐条件
  console.log('\n========== 推荐过滤条件 ==========');
  if (bestCondition) {
    console.log(`推荐: ${bestCondition.name}`);
    console.log(`  - 盈利保留: ${bestCondition.profitMatched.length}/${profit.length} (${(bestCondition.profitRecall * 100).toFixed(0)}%)`);
    console.log(`  - 亏损过滤: ${bestCondition.lossFiltered.length}/${loss.length} (${(bestCondition.lossFilterRate * 100).toFixed(0)}%)`);
    console.log(`  - 综合评分: ${(bestCondition.score * 100).toFixed(0)}%`);

    // 打印被过滤的盈利代币
    const lostProfit = profit.filter(r => !bestCondition.filter(r));
    if (lostProfit.length > 0) {
      console.log(`  ⚠️  被过滤的盈利代币: ${lostProfit.map(r => r.symbol).join(', ')}`);
    }
  }

  // 7. 进一步分析：找出每个因子的最佳阈值
  console.log('\n========== 因子阈值分析 ==========');

  analyzeFactorThreshold('holders', results, profit, loss, 10, 50, 5);
  analyzeFactorThreshold('riseSpeed', results, profit, loss, 0, 200, 10);
  analyzeFactorThreshold('earlyReturn', results, profit, loss, 0, 200, 10);
  analyzeFactorThreshold('fdv', results, profit, loss, 5000, 15000, 1000);
}

function analyzeFactorThreshold(factor, results, profit, loss, min, max, step) {
  console.log(`\n${factor} 阈值分析:`);
  console.log('阈值 | 盈利保留 | 亏损过滤 | 评分');

  let bestThreshold = null;
  let bestScore = -1;

  for (let t = min; t <= max; t += step) {
    // 测试 "< t" 条件
    const filter1 = r => (r.factors[factor] || 0) < t;
    const profitMatched1 = profit.filter(filter1).length;
    const lossFiltered1 = loss.filter(r => !filter1(r)).length;
    const score1 = profitMatched1 > 0 ? (profitMatched1 / profit.length) * 0.5 + (lossFiltered1 / loss.length) * 0.5 : -1;

    // 测试 ">= t" 条件
    const filter2 = r => (r.factors[factor] || 0) >= t;
    const profitMatched2 = profit.filter(filter2).length;
    const lossFiltered2 = loss.filter(r => !filter2(r)).length;
    const score2 = profitMatched2 > 0 ? (profitMatched2 / profit.length) * 0.5 + (lossFiltered2 / loss.length) * 0.5 : -1;

    if (score1 > bestScore) {
      bestScore = score1;
      bestThreshold = { threshold: t, op: '<', profitMatched: profitMatched1, lossFiltered: lossFiltered1, score: score1 };
    }
    if (score2 > bestScore) {
      bestScore = score2;
      bestThreshold = { threshold: t, op: '>=', profitMatched: profitMatched2, lossFiltered: lossFiltered2, score: score2 };
    }
  }

  if (bestThreshold) {
    console.log(`最佳: ${bestThreshold.op} ${bestThreshold.threshold} | 保留 ${bestThreshold.profitMatched}/${profit.length} | 过滤 ${bestThreshold.lossFiltered}/${loss.length} | 评分 ${(bestThreshold.score * 100).toFixed(0)}%`);
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
