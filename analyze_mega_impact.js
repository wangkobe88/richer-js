/**
 * 分析 MegaRatio 对高收益代币的误伤情况
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeMegaRatioImpact() {
  console.log('=== MegaRatio 对高收益代币的影响分析 ===\n');

  const experiments = ['6b17ff18-002d-4ce0-a745-b8e02676abd4', '1dde2be5-2f4e-49fb-9520-cb032e9ef759'];

  // 获取所有代币
  const allTokens = [];

  for (const expId of experiments) {
    const { data: buySignals } = await supabase
      .from('strategy_signals')
      .select('*')
      .eq('experiment_id', expId)
      .eq('action', 'buy')
      .order('created_at', { ascending: false });

    const executedSignals = buySignals.filter(s => s.metadata?.execution_status === 'executed');

    const seenAddresses = new Set();
    for (const signal of executedSignals) {
      if (!seenAddresses.has(signal.token_address)) {
        seenAddresses.add(signal.token_address);

        const factors = signal.metadata?.preBuyCheckFactors;
        if (!factors) continue;

        allTokens.push({
          tokenAddress: signal.token_address,
          symbol: signal.metadata?.symbol || signal.token_address.substring(0, 8),
          clusterCount: factors.walletClusterCount || 0,
          top2Ratio: factors.walletClusterTop2Ratio || 0,
          megaRatio: factors.walletClusterMegaRatio || 0,
          maxClusterSize: factors.walletClusterMaxSize || 0,
          maxClusterRatio: factors.walletClusterMaxClusterRatio || 0
        });
      }
    }
  }

  // 获取收益率
  const { data: sellTrades } = await supabase
    .from('trades')
    .select('token_address, metadata')
    .eq('trade_direction', 'sell')
    .not('metadata->>profitPercent', 'is', null);

  const tokenReturns = {};
  for (const sellTrade of sellTrades || []) {
    tokenReturns[sellTrade.token_address] = sellTrade.metadata?.profitPercent || 0;
  }

  // 分类
  const lossTokens = allTokens.filter(t => (tokenReturns[t.tokenAddress] || 0) <= 0);
  const profitTokens = allTokens.filter(t => (tokenReturns[t.tokenAddress] || 0) > 0);

  // 按收益率分组盈利代币
  const highProfit = profitTokens.filter(t => tokenReturns[t.tokenAddress] > 50);
  const midProfit = profitTokens.filter(t => tokenReturns[t.tokenAddress] > 20 && tokenReturns[t.tokenAddress] <= 50);
  const lowProfit = profitTokens.filter(t => tokenReturns[t.tokenAddress] > 0 && tokenReturns[t.tokenAddress] <= 20);

  console.log(`总代币数: ${allTokens.length}`);
  console.log(`亏损代币: ${lossTokens.length}`);
  console.log(`盈利代币: ${profitTokens.length}`);
  console.log(`  高收益 (>50%): ${highProfit.length}`);
  console.log(`  中收益 (20-50%): ${midProfit.length}`);
  console.log(`  低收益 (0-20%): ${lowProfit.length}\n`);

  // 分析 MegaRatio 对不同收益率代币的影响
  console.log('【MegaRatio 对不同收益率代币的影响】\n');

  const megaThresholds = [0.5, 0.6, 0.7, 0.8, 0.85, 0.9];

  console.log('Mega阈值 | 亏损过滤 | 高收益误伤 | 中收益误伤 | 低收益误伤 | 总误伤');
  console.log('---------|----------|-----------|-----------|-----------|--------');

  megaThresholds.forEach(threshold => {
    const condition = t => t.megaRatio > threshold;

    const lossFiltered = lossTokens.filter(condition).length;
    const highProfitFiltered = highProfit.filter(condition).length;
    const midProfitFiltered = midProfit.filter(condition).length;
    const lowProfitFiltered = lowProfit.filter(condition).length;
    const totalFiltered = highProfitFiltered + midProfitFiltered + lowProfitFiltered;

    console.log(`${(threshold * 100).toFixed(0).padEnd(8)} | ${lossFiltered.toString().padStart(8)} | ${highProfitFiltered.toString().padStart(9)} | ${midProfitFiltered.toString().padStart(9)} | ${lowProfitFiltered.toString().padStart(9)} | ${totalFiltered.toString().padStart(6)}`);
  });

  // 显示被 MegaRatio>0.7 过滤掉的高收益代币
  console.log('\n【被 MegaRatio>0.7 过滤掉的高收益代币】\n');

  const megaHighProfit = highProfit.filter(t => t.megaRatio > 0.7);
  if (megaHighProfit.length > 0) {
    console.log('代币        | 收益率 | 簇数 | Top2% | Mega% | 最大簇');
    console.log('------------|--------|------|-------|-------|--------');

    megaHighProfit.sort((a, b) => tokenReturns[b.tokenAddress] - tokenReturns[a.tokenAddress]).forEach(t => {
      console.log(`${t.symbol.substring(0, 11).padEnd(11)} | +${tokenReturns[t.tokenAddress].toFixed(1).padStart(5)}% | ${t.clusterCount.toString().padStart(4)} | ${(t.top2Ratio * 100).toFixed(1).padStart(5)}% | ${(t.megaRatio * 100).toFixed(1).padStart(5)}% | ${t.maxClusterSize.toString().padStart(6)}`);
    });
  } else {
    console.log('✓ 无高收益代币被误伤');
  }

  // 测试不使用 MegaRatio 的条件
  console.log('\n【不使用 MegaRatio 的条件效果】\n');

  console.log('条件                              | 亏损召回 | 高收益误伤 | 中收益误伤 | 低收益误伤 | F1分数');
  console.log('----------------------------------|---------|-----------|-----------|-----------|--------');

  const conditions = [
    {
      name: '簇数>=3 && Top2>0.85 (无Mega)',
      test: t => t.clusterCount >= 3 && t.top2Ratio > 0.85
    },
    {
      name: '簇数>=4 && Top2>0.85 (无Mega)',
      test: t => t.clusterCount >= 4 && t.top2Ratio > 0.85
    },
    {
      name: '簇数>=3 && Top2>0.90 (无Mega)',
      test: t => t.clusterCount >= 3 && t.top2Ratio > 0.90
    },
    {
      name: 'secondToFirstRatio < 0.2',
      test: t => t.clusterCount >= 2 && (t.secondToFirstRatio || 0) < 0.2
    },
    {
      name: '组合: 聚簇 OR secondToFirst',
      test: t => (t.clusterCount >= 3 && t.top2Ratio > 0.85) || ((t.secondToFirstRatio || 0) < 0.2)
    }
  ];

  conditions.forEach(condition => {
    const lossRejected = lossTokens.filter(condition.test).length;
    const lossRecall = lossTokens.length > 0 ? lossRejected / lossTokens.length : 0;

    const highProfitRejected = highProfit.filter(condition.test).length;
    const midProfitRejected = midProfit.filter(condition.test).length;
    const lowProfitRejected = lowProfit.filter(condition.test).length;
    const totalProfitRejected = highProfitRejected + midProfitRejected + lowProfitRejected;

    const profitPrecision = profitTokens.length > 0 ? 1 - (totalProfitRejected / profitTokens.length) : 1;

    const f1 = (lossRecall + profitPrecision > 0) ? (2 * lossRecall * profitPrecision) / (lossRecall + profitPrecision) : 0;

    console.log(`${condition.name.padEnd(33)} | ${(lossRecall * 100).toFixed(1).padStart(7)}% | ${highProfitRejected.toString().padStart(9)} | ${midProfitRejected.toString().padStart(9)} | ${lowProfitRejected.toString().padStart(9)} | ${f1.toFixed(3)}`);
  });

  // 推荐条件
  console.log('\n=== 推荐条件 ===\n');

  console.log('考虑到 MegaRatio 会误伤高收益代币，推荐以下条件：\n');
  console.log('条件1 (保守): walletClusterCount >= 4 && walletClusterTop2Ratio > 0.85');
  console.log('  - 召回率一般，但误伤较少');
  console.log('  - 适合保守策略\n');

  console.log('条件2 (平衡): walletClusterCount >= 3 && walletClusterTop2Ratio > 0.85');
  console.log('  - 召回率较高，误伤可控');
  console.log('  - 适合平衡策略\n');

  console.log('条件3 (激进): (walletClusterCount >= 3 && walletClusterTop2Ratio > 0.85) || walletClusterSecondToFirstRatio < 0.2');
  console.log('  - 召回率最高，但误伤会增加');
  console.log('  - 适合激进策略\n');

  console.log('❌ 不推荐单独使用 walletClusterMegaRatio > 0.7');
  console.log('   原因: 会误伤高收益代币（如单簇热门代币）');
}

analyzeMegaRatioImpact().catch(console.error);
