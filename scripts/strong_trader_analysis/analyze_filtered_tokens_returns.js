const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../config/.env' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeFilteredTokensReturns() {
  // 1. 获取回测实验所有未执行信号
  const batchSize = 100;
  let offset = 0;
  let allNotExecuted = [];

  while (true) {
    const { data: batch } = await supabase
      .from('strategy_signals')
      .select('id, token_address, token_symbol, metadata')
      .eq('experiment_id', 'a2ee5c27-3788-48fa-8735-858cbc60fcad')
      .eq('executed', false)
      .range(offset, offset + batchSize - 1);

    if (!batch || batch.length === 0) break;
    allNotExecuted.push(...batch);
    offset += batchSize;
    if (batch.length < batchSize) break;
  }

  // 2. 筛选出 ratio >= 5% 的代币（去重）
  const filteredByRatio = [];
  const seen = new Set();
  allNotExecuted.forEach(s => {
    const ratio = s.metadata?.preBuyCheckFactors?.strongTraderNetPositionRatio;
    if (ratio !== undefined && ratio !== null && ratio >= 5 && !seen.has(s.token_address)) {
      seen.add(s.token_address);
      filteredByRatio.push({
        address: s.token_address,
        symbol: s.token_symbol,
        ratio: ratio
      });
    }
  });

  console.log('回测实验中被 strongTraderNetPositionRatio >= 5 过滤的代币:', filteredByRatio.length);

  // 3. 获取原始实验的所有交易
  const { data: trades } = await supabase
    .from('trades')
    .select('token_address, token_symbol, trade_direction, input_amount, output_amount')
    .eq('experiment_id', '015db965-0b33-4d98-88b1-386203886381');

  console.log('原始虚拟实验交易数:', trades?.length || 0);

  // 4. 计算原始实验中每个代币的收益率
  // 注意：trades 表字段是 trade_direction, input_amount, output_amount
  const tokenStats = new Map();
  trades?.forEach(trade => {
    const addr = trade.token_address;
    if (!tokenStats.has(addr)) {
      tokenStats.set(addr, {
        symbol: trade.token_symbol,
        address: addr,
        buyCost: 0,
        sellRevenue: 0,
        buyCount: 0,
        sellCount: 0
      });
    }
    const stat = tokenStats.get(addr);
    // buy: input_amount 是 BNB, output_amount 是代币
    // sell: input_amount 是代币, output_amount 是 BNB
    if (trade.trade_direction === 'buy') {
      stat.buyCost += trade.input_amount || 0;
      stat.buyCount += 1;
    } else if (trade.trade_direction === 'sell') {
      stat.sellRevenue += trade.output_amount || 0;
      stat.sellCount += 1;
    }
  });

  // 5. 找出被过滤代币在原始实验中的收益情况
  const foundReturns = [];
  const notFound = [];

  filteredByRatio.forEach(token => {
    const stat = tokenStats.get(token.address);
    if (stat && stat.buyCost > 0) {
      const profit = stat.sellRevenue - stat.buyCost;
      const returnRate = (profit / stat.buyCost) * 100;
      foundReturns.push({
        ...token,
        buyCost: stat.buyCost,
        sellRevenue: stat.sellRevenue,
        profit,
        returnRate,
        isHolding: stat.sellCount === 0
      });
    } else {
      notFound.push(token);
    }
  });

  console.log('\n=== 匹配结果 ===');
  console.log('在原始虚拟实验中找到交易记录:', foundReturns.length, '个');
  console.log('没有找到交易记录:', notFound.length, '个');

  if (notFound.length > 0) {
    console.log('\n没有交易记录的代币 (可能在原始实验中未买入):');
    notFound.forEach(t => console.log('  ' + t.symbol));
  }

  if (foundReturns.length === 0) {
    console.log('\n没有找到任何有交易记录的被过滤代币');
    return;
  }

  // 按收益率排序
  foundReturns.sort((a, b) => b.returnRate - a.returnRate);

  // 统计
  const profitCount = foundReturns.filter(r => r.returnRate > 0).length;
  const lossCount = foundReturns.filter(r => r.returnRate < 0).length;
  const holdingCount = foundReturns.filter(r => r.isHolding).length;

  console.log('\n=== 被 strongTraderNetPositionRatio >= 5 过滤且有交易记录的代币收益情况 ===\n');

  console.log('统计:');
  console.log(`  代币数: ${foundReturns.length} 个`);
  console.log(`  盈利: ${profitCount} 个`);
  console.log(`  亏损: ${lossCount} 个`);
  console.log(`  持仓中: ${holdingCount} 个`);
  console.log(`  已退出: ${foundReturns.length - holdingCount} 个`);

  const totalProfit = foundReturns.reduce((sum, r) => sum + r.profit, 0);
  const totalCost = foundReturns.reduce((sum, r) => sum + r.buyCost, 0);
  const avgReturnRate = foundReturns.reduce((sum, r) => sum + r.returnRate, 0) / foundReturns.length;

  console.log(`  总花费: ${totalCost.toFixed(2)} BNB`);
  console.log(`  总盈亏: ${totalProfit.toFixed(2)} BNB`);
  console.log(`  总收益率: ${(totalProfit / totalCost * 100).toFixed(2)}%`);
  console.log(`  平均收益率: ${avgReturnRate.toFixed(2)}%`);
  console.log(`  胜率: ${(profitCount / foundReturns.length * 100).toFixed(1)}%`);

  // 详细列表
  console.log('\n详细列表 (按收益率降序):');
  console.log('代币\t\tRatio\t\t收益率\t\t盈亏\t\t状态');
  console.log(''.padEnd(70, '-'));
  foundReturns.forEach(r => {
    const status = r.isHolding ? '持仓中' : '已退出';
    const returnClass = r.returnRate >= 0 ? '+' : '';
    console.log(`${r.symbol.padEnd(12)}\t${r.ratio.toFixed(2)}%\t\t${returnClass}${r.returnRate.toFixed(2)}%\t\t${r.profit.toFixed(2)}\t\t${status}`);
  });

  // 获取回测实验中执行的代币（作为对比）
  const { data: executedSignals } = await supabase
    .from('strategy_signals')
    .select('token_address, token_symbol, metadata')
    .eq('experiment_id', 'a2ee5c27-3788-48fa-8735-858cbc60fcad')
    .eq('executed', true);

  const executedMap = new Map();
  executedSignals?.forEach(s => {
    const ratio = s.metadata?.preBuyCheckFactors?.strongTraderNetPositionRatio;
    if (ratio !== undefined && ratio !== null) {
      if (!executedMap.has(s.token_address) || executedMap.get(s.token_address).ratio < ratio) {
        executedMap.set(s.token_address, { address: s.token_address, symbol: s.token_symbol, ratio });
      }
    }
  });

  // 找出未过滤且在原始实验有交易的代币
  const filteredAddresses = new Set(foundReturns.map(r => r.address));
  const notFilteredReturns = [];

  for (const [addr, stat] of tokenStats) {
    if (stat.buyCost > 0 && !filteredAddresses.has(addr)) {
      const executed = executedMap.get(addr);
      if (executed && executed.ratio < 5) {
        const profit = stat.sellRevenue - stat.buyCost;
        const returnRate = (profit / stat.buyCost) * 100;
        notFilteredReturns.push({
          symbol: stat.symbol,
          ratio: executed.ratio,
          profit,
          returnRate,
          buyCost: stat.buyCost
        });
      }
    }
  }

  console.log('\n\n=== 未被过滤的代币收益情况 (ratio < 5，对比) ===\n');

  const notFilteredProfitCount = notFilteredReturns.filter(r => r.returnRate > 0).length;
  const notFilteredLossCount = notFilteredReturns.filter(r => r.returnRate < 0).length;

  console.log('统计:');
  console.log(`  代币数: ${notFilteredReturns.length} 个`);
  console.log(`  盈利: ${notFilteredProfitCount} 个`);
  console.log(`  亏损: ${notFilteredLossCount} 个`);

  const notFilteredTotalProfit = notFilteredReturns.reduce((sum, r) => sum + r.profit, 0);
  const notFilteredTotalCost = notFilteredReturns.reduce((sum, r) => sum + r.buyCost, 0);

  console.log(`  总花费: ${notFilteredTotalCost.toFixed(2)} BNB`);
  console.log(`  总盈亏: ${notFilteredTotalProfit.toFixed(2)} BNB`);
  console.log(`  总收益率: ${(notFilteredTotalProfit / notFilteredTotalCost * 100).toFixed(2)}%`);
  console.log(`  平均收益率: ${(notFilteredReturns.reduce((sum, r) => sum + r.returnRate, 0) / notFilteredReturns.length).toFixed(2)}%`);
  console.log(`  胜率: ${(notFilteredProfitCount / notFilteredReturns.length * 100).toFixed(1)}%`);

  // 结论
  console.log('\n\n=== 结论 ===\n');

  const filteredWinRate = (profitCount / foundReturns.length * 100).toFixed(1);
  const notFilteredWinRate = (notFilteredProfitCount / notFilteredReturns.length * 100).toFixed(1);

  console.log(`被过滤的代币 (ratio >= 5, ${foundReturns.length}个):`);
  console.log(`  总收益率: ${(totalProfit / totalCost * 100).toFixed(2)}%`);
  console.log(`  平均收益率: ${avgReturnRate.toFixed(2)}%`);
  console.log(`  胜率: ${filteredWinRate}%`);

  console.log(`\n未过滤的代币 (ratio < 5, ${notFilteredReturns.length}个):`);
  console.log(`  总收益率: ${(notFilteredTotalProfit / notFilteredTotalCost * 100).toFixed(2)}%`);
  console.log(`  平均收益率: ${(notFilteredReturns.reduce((sum, r) => sum + r.returnRate, 0) / notFilteredReturns.length).toFixed(2)}%`);
  console.log(`  胜率: ${notFilteredWinRate}%`);

  if (avgReturnRate > (notFilteredReturns.reduce((sum, r) => sum + r.returnRate, 0) / notFilteredReturns.length)) {
    console.log('\n⚠️ 被过滤的代币平均收益率更高！strongTraderNetPositionRatio >= 5 的条件可能过于严格。');
  } else if (avgReturnRate < (notFilteredReturns.reduce((sum, r) => sum + r.returnRate, 0) / notFilteredReturns.length)) {
    console.log('\n✓ 被过滤的代币平均收益率更低，过滤条件有效。');
  } else {
    console.log('\n= 两者平均收益率相近。');
  }

  // 显示被过滤代币中盈利的那些
  const profitTokens = foundReturns.filter(r => r.returnRate > 0);
  if (profitTokens.length > 0) {
    console.log('\n⚠️ 被 strongTrader 过滤但盈利的代币:');
    profitTokens.forEach(r => {
      console.log(`  ${r.symbol}: ratio=${r.ratio.toFixed(2)}%, return=+${r.returnRate.toFixed(2)}%`);
    });
  }
}

analyzeFilteredTokensReturns().catch(console.error);
