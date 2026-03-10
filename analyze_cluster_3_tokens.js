/**
 * 分析簇数=3的代币收益
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeCluster3() {
  const expId = '933be40d-1056-463f-b629-aa226a2ea064';

  // 获取执行的信号
  const { data: buySignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', expId)
    .eq('action', 'buy')
    .order('created_at', { ascending: false });

  const executedSignals = buySignals.filter(s => s.metadata?.execution_status === 'executed');

  // 获取收益率
  const { data: sellTrades } = await supabase
    .from('trades')
    .select('token_address, metadata')
    .eq('experiment_id', expId)
    .eq('trade_direction', 'sell')
    .not('metadata->>profitPercent', 'is', null);

  const tokenReturns = {};
  for (const sellTrade of sellTrades || []) {
    tokenReturns[sellTrade.token_address] = sellTrade.metadata?.profitPercent || 0;
  }

  console.log('=== 分析簇数=3的代币收益 ===\n');
  console.log('代币        | 收益率 | Top2% | Mega% | 是否会被新条件拒绝');
  console.log('------------|--------|-------|-------|-------------------');

  executedSignals.forEach(signal => {
    const factors = signal.metadata?.preBuyCheckFactors;
    if (!factors) return;

    const clusterCount = factors.walletClusterCount || 0;
    if (clusterCount === 3) {
      const symbol = signal.metadata?.symbol || signal.token_address.substring(0, 8);
      const top2Ratio = ((factors.walletClusterTop2Ratio || 0) * 100).toFixed(1);
      const megaRatio = ((factors.walletClusterMegaRatio || 0) * 100).toFixed(1);
      const profit = tokenReturns[signal.token_address];
      const wouldReject = parseFloat(top2Ratio) > 85;

      console.log(`${symbol.substring(0, 11).padEnd(11)} | ${profit ? profit.toFixed(1) + '%' : 'N/A'.padStart(6)} | ${top2Ratio.padStart(5)}% | ${megaRatio.padStart(5)}% | ${wouldReject ? '❌ 是' : ''}`);
    }
  });

  // 统计
  console.log('\n【统计】\n');

  const cluster3Signals = executedSignals.filter(s => {
    const factors = s.metadata?.preBuyCheckFactors;
    return factors && factors.walletClusterCount === 3;
  });

  const cluster3WithReturns = cluster3Signals.filter(s => tokenReturns[s.token_address] !== undefined);
  const cluster3Profit = cluster3WithReturns.filter(s => tokenReturns[s.token_address] > 0);
  const cluster3Loss = cluster3WithReturns.filter(s => tokenReturns[s.token_address] <= 0);

  console.log(`簇数=3的代币总数: ${cluster3Signals.length}`);
  console.log(`有收益数据: ${cluster3WithReturns.length}`);
  console.log(`  盈利: ${cluster3Profit.length}个`);
  console.log(`  亏损: ${cluster3Loss.length}个`);

  // 收益分析
  const totalProfit = cluster3Profit.reduce((sum, s) => sum + tokenReturns[s.token_address], 0);
  const totalLoss = cluster3Loss.reduce((sum, s) => sum + tokenReturns[s.token_address], 0);

  console.log(`\n簇数=3代币的:`);
  console.log(`  总收益: +${totalProfit.toFixed(1)}%`);
  console.log(`  总亏损: ${totalLoss.toFixed(1)}%`);
  console.log(`  净收益: ${(totalProfit + totalLoss).toFixed(1)}%`);

  // Top2Ratio > 85 的会被新条件拒绝
  const cluster3Rejected = cluster3WithReturns.filter(s => {
    const factors = s.metadata?.preBuyCheckFactors;
    const top2Ratio = factors?.walletClusterTop2Ratio || 0;
    return top2Ratio > 0.85;
  });

  console.log(`\n簇数=3 且 Top2>85% 的代币: ${cluster3Rejected.length}个`);
  console.log(`  这些代币会被新条件拒绝\n`);

  cluster3Rejected.forEach(s => {
    const symbol = s.metadata?.symbol || s.token_address.substring(0, 8);
    const profit = tokenReturns[s.token_address];
    console.log(`    ${symbol}: ${profit.toFixed(1)}%`);
  });
}

analyzeCluster3().catch(console.error);
