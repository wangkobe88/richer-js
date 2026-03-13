/**
 * Verify strong trader position check backtest results
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeResults() {
  const experimentId = 'e9fe498e-a176-4d8f-9096-46a9c7914bd0';

  // 获取交易数据
  const { data: trades, error: tradesError } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: false });

  if (tradesError) {
    console.error('交易查询失败:', tradesError);
    return;
  }

  console.log('=== 实验交易分析 ===');
  console.log('总交易数:', trades.length);
  console.log('');

  // 按代币分组统计
  const tokenStats = new Map();

  for (const trade of trades) {
    const addr = trade.token_address;
    if (!tokenStats.has(addr)) {
      tokenStats.set(addr, {
        symbol: trade.token_symbol,
        buyTrades: [],
        sellTrades: [],
        totalBought: 0,
        totalSold: 0,
        buyCost: 0,
        sellRevenue: 0
      });
    }
    const stat = tokenStats.get(addr);

    if (trade.trade_type === 'buy') {
      stat.buyTrades.push(trade);
      stat.totalBought += trade.amount || 0;
      stat.buyCost += (trade.amount || 0) * (trade.price_usd || 0);
    } else if (trade.trade_type === 'sell') {
      stat.sellTrades.push(trade);
      stat.totalSold += trade.amount || 0;
      stat.sellRevenue += (trade.amount || 0) * (trade.price_usd || 0);
    }
  }

  // 计算收益率
  const results = [];
  for (const [addr, stat] of tokenStats) {
    const profit = stat.sellRevenue - stat.buyCost;
    const returnRate = stat.buyCost > 0 ? (profit / stat.buyCost) * 100 : 0;
    results.push({
      address: addr,
      symbol: stat.symbol,
      returnRate,
      profit,
      buyCost: stat.buyCost,
      sellRevenue: stat.sellRevenue
    });
  }

  results.sort((a, b) => b.returnRate - a.returnRate);

  console.log('=== 代币收益排名 ===');
  results.forEach((r, idx) => {
    const emoji = r.returnRate >= 50 ? '🟢' : r.returnRate >= 0 ? '🟡' : '🔴';
    console.log(`[${idx + 1}] ${emoji} ${r.symbol}: ${r.returnRate.toFixed(2)}% (盈利: $${r.profit.toFixed(2)})`);
  });

  console.log('\n=== 收益统计 ===');
  const winningTrades = results.filter(r => r.returnRate > 0);
  const losingTrades = results.filter(r => r.returnRate < 0);
  const avgReturn = results.reduce((sum, r) => sum + r.returnRate, 0) / results.length;
  const totalProfit = results.reduce((sum, r) => sum + r.profit, 0);

  console.log('盈利代币数:', winningTrades.length);
  console.log('亏损代币数:', losingTrades.length);
  console.log('平均收益率:', avgReturn.toFixed(2) + '%');
  console.log('总盈亏:', totalProfit >= 0 ? '+$' + totalProfit.toFixed(2) : '-$' + Math.abs(totalProfit).toFixed(2));

  console.log('\n=== 与 Strong Trader Factor 关联分析 ===');

  // 获取所有信号及其因子
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId);

  const signalMap = new Map();
  for (const sig of signals) {
    const factors = sig.metadata?.preBuyCheckFactors || {};
    if (!signalMap.has(sig.token_address)) {
      signalMap.set(sig.token_address, {
        netPositionRatio: factors.strongTraderNetPositionRatio || 0,
        walletCount: factors.strongTraderWalletCount || 0,
        tradeCount: factors.strongTraderTradeCount || 0
      });
    }
  }

  // 按 strong trader 参与度分组
  const noStrongTrader = [];
  const lowParticipation = [];
  const highParticipation = [];

  for (const r of results) {
    const factor = signalMap.get(r.address);
    if (!factor || factor.walletCount === 0) {
      noStrongTrader.push(r);
    } else if (factor.netPositionRatio < 5) {
      lowParticipation.push({ ...r, factor });
    } else {
      highParticipation.push({ ...r, factor });
    }
  }

  const calcAvgReturn = (arr) => {
    if (arr.length === 0) return 0;
    return arr.reduce((sum, r) => sum + r.returnRate, 0) / arr.length;
  };

  console.log('\n1. 无强势交易者参与 (walletCount = 0):');
  console.log('   代币数:', noStrongTrader.length);
  console.log('   平均收益:', calcAvgReturn(noStrongTrader).toFixed(2) + '%');

  console.log('\n2. 低参与度 (netPositionRatio < 5%):');
  console.log('   代币数:', lowParticipation.length);
  console.log('   平均收益:', calcAvgReturn(lowParticipation).toFixed(2) + '%');

  console.log('\n3. 高参与度 (netPositionRatio >= 5%):');
  console.log('   代币数:', highParticipation.length);
  highParticipation.forEach(r => {
    console.log(`   - ${r.symbol}: ${r.returnRate.toFixed(2)}% (持仓: ${r.factor.netPositionRatio.toFixed(2)}%, 钱包: ${r.factor.walletCount})`);
  });
  console.log('   平均收益:', calcAvgReturn(highParticipation).toFixed(2) + '%');

  console.log('\n=== 验证结论 ===');
  const noStAvg = calcAvgReturn(noStrongTrader);
  const lowStAvg = calcAvgReturn(lowParticipation);
  const highStAvg = calcAvgReturn(highParticipation);

  console.log('预期: 高参与度 -> 低收益');
  console.log('实际结果:');
  console.log(`  无参与: ${noStAvg.toFixed(2)}%`);
  console.log(`  低参与: ${lowStAvg.toFixed(2)}%`);
  console.log(`  高参与: ${highStAvg.toFixed(2)}%`);

  if (highStAvg < noStAvg && highStAvg < lowStAvg) {
    console.log('\n✓ 符合预期: 高强势交易者持仓确实与低收益相关');
  } else {
    console.log('\n⚠ 数据与预期不完全一致，可能需要更多样本');
  }

  // 额外分析：如果过滤掉高参与度的代币，整体收益会如何？
  console.log('\n=== 过滤效果分析 ===');
  const filteredResults = noStrongTrader.concat(lowParticipation);
  const filteredAvg = calcAvgReturn(filteredResults);
  const filteredProfit = filteredResults.reduce((sum, r) => sum + r.profit, 0);

  console.log('过滤前 (所有代币):');
  console.log(`  平均收益: ${avgReturn.toFixed(2)}%`);
  console.log(`  总盈亏: $${totalProfit.toFixed(2)}`);

  console.log('\n过滤后 (排除 netPositionRatio >= 5%):');
  console.log(`  平均收益: ${filteredAvg.toFixed(2)}%`);
  console.log(`  总盈亏: $${filteredProfit.toFixed(2)}`);
  console.log(`  排除代币数: ${results.length - filteredResults.length}`);

  const improvement = filteredAvg - avgReturn;
  console.log(`\n收益率提升: ${improvement >= 0 ? '+' : ''}${improvement.toFixed(2)}%`);
}

analyzeResults().catch(console.error);
