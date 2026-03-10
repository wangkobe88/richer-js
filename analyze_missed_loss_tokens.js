/**
 * 重新分析：寻找更有效的因子组合
 * 分析被遗漏的亏损代币的特征
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeMissedLossTokens() {
  console.log('=== 分析被遗漏的亏损代币 ===\n');

  // 获取所有数据
  const experiments = ['6b17ff18-002d-4ce0-a745-b8e02676abd4', '1dde2be5-2f4e-49fb-9520-cb032e9ef759'];

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
          secondToFirstRatio: factors.walletClusterSecondToFirstRatio || 0,
          maxClusterRatio: factors.walletClusterMaxClusterRatio || 0,
          maxClusterWallets: factors.walletClusterMaxClusterWallets || 0,
          intervalMean: factors.walletClusterIntervalMean || 0
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

  console.log(`总代币数: ${allTokens.length}`);
  console.log(`亏损代币: ${lossTokens.length}`);
  console.log(`盈利代币: ${profitTokens.length}\n`);

  // 测试不同的条件
  console.log('=== 测试不同条件 ===\n');

  const conditions = [
    {
      name: '簇数>=4 && Top2>0.85 (当前推荐)',
      test: t => t.clusterCount >= 4 && t.top2Ratio > 0.85
    },
    {
      name: '簇数>=3 && Top2>0.90',
      test: t => t.clusterCount >= 3 && t.top2Ratio > 0.90
    },
    {
      name: '簇数>=2 && Top2>0.95',
      test: t => t.clusterCount >= 2 && t.top2Ratio > 0.95
    },
    {
      name: '簇数>=3 && Top2>0.85',
      test: t => t.clusterCount >= 3 && t.top2Ratio > 0.85
    },
    {
      name: 'MegaRatio > 0.7',
      test: t => t.megaRatio > 0.7
    },
    {
      name: 'MegaRatio > 0.6',
      test: t => t.megaRatio > 0.6
    },
    {
      name: 'maxClusterRatio > 0.5',
      test: t => t.maxClusterRatio > 0.5
    },
    {
      name: 'secondToFirstRatio < 0.2',
      test: t => t.secondToFirstRatio < 0.2
    },
    {
      name: '组合: (簇数>=3 && Top2>0.85) OR Mega>0.7',
      test: t => (t.clusterCount >= 3 && t.top2Ratio > 0.85) || t.megaRatio > 0.7
    },
    {
      name: '组合: (簇数>=4 && Top2>0.85) OR Mega>0.7',
      test: t => (t.clusterCount >= 4 && t.top2Ratio > 0.85) || t.megaRatio > 0.7
    },
    {
      name: '组合: (簇数>=3 && Top2>0.90) OR Mega>0.7',
      test: t => (t.clusterCount >= 3 && t.top2Ratio > 0.90) || t.megaRatio > 0.7
    },
    {
      name: '组合: (簇数>=2 && Top2>0.95) OR Mega>0.7',
      test: t => (t.clusterCount >= 2 && t.top2Ratio > 0.95) || t.megaRatio > 0.7
    }
  ];

  console.log('条件                              | 亏损召回 | 盈利误伤 | F1分数');
  console.log('----------------------------------|---------|---------|--------');

  conditions.forEach(condition => {
    const lossRejected = lossTokens.filter(condition.test).length;
    const lossRecall = lossTokens.length > 0 ? lossRejected / lossTokens.length : 0;

    const profitRejected = profitTokens.filter(condition.test).length;
    const profitPrecision = profitTokens.length > 0 ? 1 - (profitRejected / profitTokens.length) : 1;

    const f1 = (lossRecall + profitPrecision > 0) ? (2 * lossRecall * profitPrecision) / (lossRecall + profitPrecision) : 0;

    console.log(`${condition.name.padEnd(33)} | ${(lossRecall * 100).toFixed(1).padStart(7)}% | ${profitRejected}/${profitTokens.length} | ${f1.toFixed(3)}`);
  });

  // 分析被遗漏的亏损代币
  console.log('\n=== 分析被遗漏的亏损代币的特征 ===\n');

  const bestCondition = t => (t.clusterCount >= 4 && t.top2Ratio > 0.85) || t.megaRatio > 0.7;
  const missedLoss = lossTokens.filter(t => !bestCondition(t));

  console.log(`被遗漏的亏损代币: ${missedLoss.length}个\n`);

  if (missedLoss.length > 0) {
    // 按簇数分组统计
    console.log('按簇数分组:');
    const clusterGroups = { 1: [], 2: [], 3: [], '4+': [] };
    missedLoss.forEach(t => {
      if (t.clusterCount === 1) clusterGroups[1].push(t);
      else if (t.clusterCount === 2) clusterGroups[2].push(t);
      else if (t.clusterCount === 3) clusterGroups[3].push(t);
      else clusterGroups['4+'].push(t);
    });

    Object.entries(clusterGroups).forEach(([key, tokens]) => {
      if (tokens.length > 0) {
        const avgTop2 = tokens.reduce((sum, t) => sum + t.top2Ratio, 0) / tokens.length;
        const avgMega = tokens.reduce((sum, t) => sum + t.megaRatio, 0) / tokens.length;
        const avgMaxCluster = tokens.reduce((sum, t) => sum + t.maxClusterSize, 0) / tokens.length;
        console.log(`  簇数=${key}: ${tokens.length}个, 平均Top2=${(avgTop2 * 100).toFixed(1)}%, 平均Mega=${(avgMega * 100).toFixed(1)}%, 平均最大簇=${avgMaxCluster.toFixed(1)}`);
      }
    });

    // 按Top2Ratio分组统计
    console.log('\n按Top2Ratio分组:');
    const top2Groups = {
      '95-100%': [],
      '90-95%': [],
      '85-90%': [],
      '80-85%': [],
      '<80%': []
    };
    missedLoss.forEach(t => {
      const top2 = t.top2Ratio * 100;
      if (top2 >= 95) top2Groups['95-100%'].push(t);
      else if (top2 >= 90) top2Groups['90-95%'].push(t);
      else if (top2 >= 85) top2Groups['85-90%'].push(t);
      else if (top2 >= 80) top2Groups['80-85%'].push(t);
      else top2Groups['<80%'].push(t);
    });

    Object.entries(top2Groups).forEach(([key, tokens]) => {
      if (tokens.length > 0) {
        const avgCluster = tokens.reduce((sum, t) => sum + t.clusterCount, 0) / tokens.length;
        const avgMega = tokens.reduce((sum, t) => sum + t.megaRatio, 0) / tokens.length;
        console.log(`  Top2 ${key}: ${tokens.length}个, 平均簇数=${avgCluster.toFixed(1)}, 平均Mega=${(avgMega * 100).toFixed(1)}%`);
      }
    });

    // 检查这些代币的maxClusterRatio
    console.log('\nmaxClusterRatio分布:');
    const maxClusterRatios = missedLoss.map(t => t.maxClusterRatio * 100);
    const avgMaxClusterRatio = maxClusterRatios.reduce((sum, r) => sum + r, 0) / maxClusterRatios.length;
    const maxMaxClusterRatio = Math.max(...maxClusterRatios);
    const minMaxClusterRatio = Math.min(...maxClusterRatios);
    console.log(`  平均: ${avgMaxClusterRatio.toFixed(1)}%`);
    console.log(`  最大: ${maxMaxClusterRatio.toFixed(1)}%`);
    console.log(`  最小: ${minMaxClusterRatio.toFixed(1)}%`);

    // 显示前10个被遗漏的代币
    console.log('\n前10个被遗漏的代币:');
    console.log('代币        | 簇数 | Top2% | Mega% | 最大簇 | maxClusterRatio');
    console.log('------------|------|-------|-------|--------|----------------');

    missedLoss.slice(0, 10).forEach(t => {
      console.log(`${t.symbol.substring(0, 11).padEnd(11)} | ${t.clusterCount.toString().padStart(4)} | ${(t.top2Ratio * 100).toFixed(1).padStart(5)}% | ${(t.megaRatio * 100).toFixed(1).padStart(5)}% | ${t.maxClusterSize.toString().padStart(6)} | ${(t.maxClusterRatio * 100).toFixed(1).padStart(6)}%`);
    });
  }
}

analyzeMissedLossTokens().catch(console.error);
