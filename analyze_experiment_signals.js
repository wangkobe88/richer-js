/**
 * 分析信号数据中的预检查因子
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeSignals() {
  const experimentId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  // 获取所有信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  console.log('=== 信号分析 ===\n');
  console.log('总信号数:', signals.length);

  // 检查 preBuyCheckFactors 是否存在
  const withPreBuy = signals.filter(s => s.metadata?.preBuyCheckFactors && Object.keys(s.metadata.preBuyCheckFactors).length > 0);
  const withoutPreBuy = signals.filter(s => !s.metadata?.preBuyCheckFactors || Object.keys(s.metadata.preBuyCheckFactors).length === 0);

  console.log('有预检查因子:', withPreBuy.length);
  console.log('无预检查因子:', withoutPreBuy.length);
  console.log('');

  // 查看几个信号的详细结构
  console.log('=== 前3个信号的结构 ===\n');

  signals.slice(0, 3).forEach((s, i) => {
    console.log(`信号 ${i + 1}:`);
    console.log('  token_symbol:', s.metadata?.symbol);
    console.log('  execution_status:', s.metadata?.execution_status);
    console.log('  execution_reason:', s.metadata?.execution_reason);
    console.log('  有 trendFactors:', !!s.metadata?.trendFactors);
    console.log('  有 preBuyCheckFactors:', !!s.metadata?.preBuyCheckFactors);

    if (s.metadata?.preBuyCheckFactors) {
      console.log('  preBuyCheckFactors keys:', Object.keys(s.metadata.preBuyCheckFactors).join(', '));
    }
    console.log('');
  });

  // 获取交易数据并计算盈亏
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  console.log('=== 交易盈亏分析 ===\n');

  // 按代币分组
  const tokenResults = new Map();

  trades.forEach(trade => {
    if (!tokenResults.has(trade.token_address)) {
      tokenResults.set(trade.token_address, {
        tokenAddress: trade.token_address,
        symbol: trade.token_symbol || trade.token_address.substring(0, 8),
        buyPrice: null,
        sellPrices: [],
        profits: [],
        buyCount: 0,
        sellCount: 0
      });
    }
    const result = tokenResults.get(trade.token_address);
    if (trade.trade_direction === 'buy') {
      result.buyCount++;
      result.buyPrice = trade.unit_price;
    } else if (trade.trade_direction === 'sell') {
      result.sellCount++;
      const profit = trade.metadata?.profitPercent || 0;
      result.profits.push(profit);
      result.sellPrices.push(trade.unit_price);
    }
  });

  // 计算最终结果
  const results = [];
  tokenResults.forEach((value, key) => {
    const avgProfit = value.profits.length > 0
      ? value.profits.reduce((a, b) => a + b, 0) / value.profits.length
      : 0;
    results.push({
      ...value,
      avgProfit: avgProfit,
      isProfit: avgProfit > 0,
      totalProfit: value.profits.reduce((a, b) => a + b, 0)
    });
  });

  const profitCount = results.filter(r => r.isProfit).length;
  const lossCount = results.filter(r => !r.isProfit).length;
  const winRate = results.length > 0 ? profitCount / results.length * 100 : 0;

  const totalProfit = results.filter(r => r.isProfit).reduce((sum, r) => sum + r.avgProfit, 0);
  const totalLoss = results.filter(r => !r.isProfit).reduce((sum, r) => sum + r.avgProfit, 0);
  const avgProfit = profitCount > 0 ? totalProfit / profitCount : 0;
  const avgLoss = lossCount > 0 ? totalLoss / lossCount : 0;

  console.log('盈利代币:', profitCount);
  console.log('亏损代币:', lossCount);
  console.log('胜率:', winRate.toFixed(1) + '%');
  console.log('平均盈利:', avgProfit.toFixed(1) + '%');
  console.log('平均亏损:', avgLoss.toFixed(1) + '%');
  console.log('盈亏比:', avgLoss !== 0 ? (avgProfit / Math.abs(avgLoss)).toFixed(2) : 'N/A');
  console.log('总收益:', results.reduce((sum, r) => sum + r.avgProfit, 0).toFixed(1) + '%');
  console.log('');

  // 关联信号数据
  console.log('=== 盈亏代币的因子对比 ===\n');

  for (const result of results) {
    const signal = signals.find(s => s.token_address === result.token_address);
    if (signal) {
      result.trendFactors = signal.metadata?.trendFactors || {};
      result.preBuyFactors = signal.metadata?.preBuyCheckFactors || {};
      result.executionStatus = signal.metadata?.execution_status;
      result.executionReason = signal.metadata?.execution_reason;
    }
  }

  const profitTokens = results.filter(r => r.isProfit);
  const lossTokens = results.filter(r => !r.isProfit);

  console.log(`盈利案例: ${profitTokens.length}, 亏损案例: ${lossTokens.length}\n`);

  // 对比关键因子
  const factorsToCompare = [
    { name: 'earlyReturn', key: 'trendFactors', subkey: 'earlyReturn' },
    { name: 'trendCV', key: 'trendFactors', subkey: 'trendCV' },
    { name: 'trendSlope', key: 'trendFactors', subkey: 'trendSlope' },
    { name: 'trendStrengthScore', key: 'trendFactors', subkey: 'trendStrengthScore' },
    { name: 'trendTotalReturn', key: 'trendFactors', subkey: 'trendTotalReturn' },
    { name: 'trendRecentDownRatio', key: 'trendFactors', subkey: 'trendRecentDownRatio' },
    { name: 'earlyWhaleCount', key: 'preBuyFactors', subkey: 'earlyWhaleCount' },
    { name: 'earlyWhaleSellRatio', key: 'preBuyFactors', subkey: 'earlyWhaleSellRatio' },
    { name: 'walletClusterSecondToFirstRatio', key: 'preBuyFactors', subkey: 'walletClusterSecondToFirstRatio' },
    { name: 'earlyTradesVolumePerMin', key: 'preBuyFactors', subkey: 'earlyTradesVolumePerMin' },
  ];

  factorsToCompare.forEach(factor => {
    const profitValues = profitTokens
      .map(t => t[factor.key]?.[factor.subkey])
      .filter(v => v !== undefined && v !== null);

    const lossValues = lossTokens
      .map(t => t[factor.key]?.[factor.subkey])
      .filter(v => v !== undefined && v !== null);

    if (profitValues.length > 0 && lossValues.length > 0) {
      const profitAvg = profitValues.reduce((a, b) => a + b, 0) / profitValues.length;
      const lossAvg = lossValues.reduce((a, b) => a + b, 0) / lossValues.length;

      const diff = profitAvg - lossAvg;

      console.log(`${factor.name}:`);
      console.log(`  盈利平均: ${formatNumber(profitAvg, 2)} (n=${profitValues.length})`);
      console.log(`  亏损平均: ${formatNumber(lossAvg, 2)} (n=${lossValues.length})`);
      console.log(`  差异: ${diff > 0 ? '+' : ''}${formatNumber(diff, 2)}`);
      console.log('');
    }
  });

  // 显示具体案例
  console.log('=== 盈利案例（前5）===');
  const sortedProfitTokens = [...profitTokens].sort((a, b) => b.avgProfit - a.avgProfit);
  console.log('\n代币          | 盈亏% | earlyReturn | trendCV | trendStrength | whaleCount | whaleSellRatio');
  console.log('-------------|-------|-------------|---------|---------------|------------|---------------');

  sortedProfitTokens.slice(0, 5).forEach(t => {
    console.log(`  ${t.symbol.padEnd(13)} | ${t.avgProfit.toFixed(1).padStart(5)}% | ${formatNumber(t.trendFactors?.earlyReturn, 1).padStart(10)}% | ${formatNumber(t.trendFactors?.trendCV, 3).padStart(7)} | ${formatNumber(t.trendFactors?.trendStrengthScore, 1).padStart(12)} | ${formatNumber(t.preBuyFactors?.earlyWhaleCount, 0).padStart(9)} | ${formatNumber(t.preBuyFactors?.earlyWhaleSellRatio, 2).padStart(12)}`);
  });

  console.log('\n=== 亏损案例（前10，按亏损排序）===');
  const sortedLossTokens = [...lossTokens].sort((a, b) => a.avgProfit - b.avgProfit);
  console.log('\n代币          | 盈亏% | earlyReturn | trendCV | trendStrength | whaleCount | whaleSellRatio');
  console.log('-------------|-------|-------------|---------|---------------|------------|---------------');

  sortedLossTokens.slice(0, 10).forEach(t => {
    console.log(`  ${t.symbol.padEnd(13)} | ${t.avgProfit.toFixed(1).padStart(5)}% | ${formatNumber(t.trendFactors?.earlyReturn, 1).padStart(10)}% | ${formatNumber(t.trendFactors?.trendCV, 3).padStart(7)} | ${formatNumber(t.trendFactors?.trendStrengthScore, 1).padStart(12)} | ${formatNumber(t.preBuyFactors?.earlyWhaleCount, 0).padStart(9)} | ${formatNumber(t.preBuyFactors?.earlyWhaleSellRatio, 2).padStart(12)}`);
  });
}

function formatNumber(num, decimals = 2) {
  if (num === undefined || num === null) return 'N/A';
  return num.toFixed(decimals);
}

analyzeSignals().catch(console.error);
