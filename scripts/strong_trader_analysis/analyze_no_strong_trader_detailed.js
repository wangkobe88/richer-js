/**
 * 详细分析无强势交易者代币的特征
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function detailedAnalysis() {
  const experimentId = 'e9fe498e-a176-4d8f-9096-46a9c7914bd0';

  // 获取所有信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId);

  // 分类
  const noStrongTrader = [];
  const withStrongTrader = [];

  for (const sig of signals) {
    const factors = sig.metadata?.preBuyCheckFactors || {};
    const walletCount = factors.strongTraderWalletCount ?? 0;
    const netRatio = factors.strongTraderNetPositionRatio ?? 0;

    const item = {
      symbol: sig.token_symbol,
      address: sig.token_address,
      walletCount,
      netRatio,
      status: sig.metadata?.execution_status,
      // 强势交易者因子
      tradeCount: factors.strongTraderTradeCount ?? 0,
      totalBuyRatio: factors.strongTraderTotalBuyRatio ?? 0,
      totalSellRatio: factors.strongTraderTotalSellRatio ?? 0,
      sellIntensity: factors.strongTraderSellIntensity ?? 0,
      // 早期交易因子
      volumePerMin: factors.earlyTradesVolumePerMin ?? 0,
      walletsPerMin: factors.earlyTradesWalletsPerMin ?? 0,
      countPerMin: factors.earlyTradesCountPerMin ?? 0,
      highValueCount: factors.earlyTradesHighValueCount ?? 0,
      actualSpan: factors.earlyTradesActualSpan ?? 0,
      // 钱包簇因子
      clusterCount: factors.walletClusterCount ?? 0,
      clusterMaxSize: factors.walletClusterMaxSize ?? 0,
      clusterTop2Ratio: factors.walletClusterTop2Ratio ?? 0,
      clusterMegaRatio: factors.walletClusterMegaRatio ?? 0,
      maxBlockBuyRatio: factors.walletClusterMaxBlockBuyRatio ?? 0,
      // 持有者因子
      holderWhitelist: factors.holderWhitelistCount ?? 0,
      holderBlacklist: factors.holderBlacklistCount ?? 0,
      devHolding: factors.devHoldingRatio ?? 0,
      maxHolding: factors.maxHoldingRatio ?? 0
    };

    if (walletCount === 0) {
      noStrongTrader.push(item);
    } else {
      withStrongTrader.push(item);
    }
  }

  console.log('=== 无强势交易者代币的详细特征分析 ===');
  console.log('总数:', noStrongTrader.length);
  console.log('');

  // 1. 基本统计
  const executedNoSt = noStrongTrader.filter(t => t.status === 'executed');
  console.log('执行成功:', executedNoSt.length);
  console.log('执行失败:', noStrongTrader.length - executedNoSt.length);

  // 2. 钱包簇特征
  console.log('\n=== 钱包簇特征 ===');

  const calcStats = (arr, key) => {
    const values = arr.map(t => t[key]).filter(v => v !== undefined && v !== null);
    if (values.length === 0) return { avg: 0, min: 0, max: 0 };
    return {
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values)
    };
  };

  const noStCluster = calcStats(noStrongTrader, 'clusterCount');
  const withStCluster = calcStats(withStrongTrader, 'clusterCount');

  console.log('无强势交易者 - 钱包簇数:');
  console.log('  平均:', noStCluster.avg.toFixed(1));
  console.log('  范围:', noStCluster.min, '-', noStCluster.max);

  console.log('\n有强势交易者 - 钱包簇数:');
  console.log('  平均:', withStCluster.avg.toFixed(1));
  console.log('  范围:', withStCluster.min, '-', withStCluster.max);

  // 3. 钱包簇大小分布
  console.log('\n=== 钱包簇大小分布 ===');

  const noStMaxSize = calcStats(noStrongTrader, 'clusterMaxSize');
  const withStMaxSize = calcStats(withStrongTrader, 'clusterMaxSize');

  console.log('无强势交易者 - 最大簇大小:');
  console.log('  平均:', noStMaxSize.avg.toFixed(1));

  console.log('\n有强势交易者 - 最大簇大小:');
  console.log('  平均:', withStMaxSize.avg.toFixed(1));

  // 4. 持有者特征
  console.log('\n=== 持有者特征 ===');

  const noStDevHolding = calcStats(noStrongTrader, 'devHolding');
  const withStDevHolding = calcStats(withStrongTrader, 'devHolding');

  console.log('无强势交易者 - Dev持仓比例:');
  console.log('  平均:', noStDevHolding.avg.toFixed(2) + '%');

  console.log('\n有强势交易者 - Dev持仓比例:');
  console.log('  平均:', withStDevHolding.avg.toFixed(2) + '%');

  const noStBlacklist = calcStats(noStrongTrader, 'holderBlacklist');
  const withStBlacklist = calcStats(withStrongTrader, 'holderBlacklist');

  console.log('\n无强势交易者 - 黑名单持有人数:');
  console.log('  平均:', noStBlacklist.avg.toFixed(1));

  console.log('\n有强势交易者 - 黑名单持有人数:');
  console.log('  平均:', withStBlacklist.avg.toFixed(1));

  // 5. 交易活跃度分组分析
  console.log('\n=== 无强势交易者代币的活跃度分组 ===');

  noStrongTrader.sort((a, b) => b.volumePerMin - a.volumePerMin);

  const veryLow = noStrongTrader.filter(t => t.volumePerMin < 5000);
  const low = noStrongTrader.filter(t => t.volumePerMin >= 5000 && t.volumePerMin < 10000);
  const medium = noStrongTrader.filter(t => t.volumePerMin >= 10000 && t.volumePerMin < 20000);
  const high = noStrongTrader.filter(t => t.volumePerMin >= 20000);

  console.log('极低活跃度 (<5000):', veryLow.length);
  console.log('低活跃度 (5000-10000):', low.length);
  console.log('中等活跃度 (10000-20000):', medium.length);
  console.log('高活跃度 (>20000):', high.length);

  console.log('\n极低活跃度样本 (可能是"死币"):');
  veryLow.slice(0, 10).forEach((t, i) => {
    console.log('  ' + (i + 1) + '. ' + t.symbol);
    console.log('     交易量: ' + t.volumePerMin.toFixed(0) + ', 钱包: ' + t.walletsPerMin.toFixed(1) + '/min');
    console.log('     钱包簇: ' + t.clusterCount + ', Dev持仓: ' + t.devHolding + '%');
  });

  console.log('\n高活跃度但无强势交易者 (可能是机会):');
  high.slice(0, 10).forEach((t, i) => {
    console.log('  ' + (i + 1) + '. ' + t.symbol);
    console.log('     交易量: ' + t.volumePerMin.toFixed(0) + ', 钱包: ' + t.walletsPerMin.toFixed(1) + '/min');
    console.log('     钱包簇: ' + t.clusterCount + ', 最大簇: ' + t.clusterMaxSize);
  });

  // 6. 综合评分
  console.log('\n=== 综合分析结论 ===');

  console.log('\n无强势交易者代币的特征:');
  console.log('✓ 交易活跃度较低 (交易量约' + (noStCluster.avg / withStCluster.avg * 100).toFixed(0) + '% of 有强势交易者的)');
  console.log('✓ 钱包参与度较低');
  console.log('✓ 钱包簇数可能较少');

  console.log('\n可能的解释:');
  console.log('1. 流动性不足 - 没有足够的交易活动');
  console.log('2. 未被发现 - 还没被"聪明钱"关注');
  console.log('3. 真实散户币 - 可能是真正的 grassroots 代币');

  console.log('\n建议的策略调整:');
  console.log('');
  console.log('【方案A】排除完全无强势交易者:');
  console.log('  strongTraderWalletCount > 0');
  console.log('  strongTraderNetPositionRatio < 5');
  console.log('');
  console.log('【方案B】排除低活跃度 + 无强势交易者:');
  console.log('  (strongTraderWalletCount > 0 OR earlyTradesVolumePerMin > 15000)');
  console.log('  AND strongTraderNetPositionRatio < 5');
  console.log('');
  console.log('【方案C】使用"适中"强势交易者参与:');
  console.log('  strongTraderWalletCount >= 2');
  console.log('  strongTraderWalletCount <= 10');
  console.log('  strongTraderNetPositionRatio < 5');

  // 7. 检查有多少代币会符合不同方案
  console.log('\n=== 不同方案的通过率对比 ===');

  const allSignals = signals.map(sig => {
    const factors = sig.metadata?.preBuyCheckFactors || {};
    return {
      walletCount: factors.strongTraderWalletCount ?? 0,
      netRatio: factors.strongTraderNetPositionRatio ?? 0,
      volume: factors.earlyTradesVolumePerMin ?? 0,
      status: sig.metadata?.execution_status
    };
  });

  const total = allSignals.length;

  // 当前方案: netRatio < 5
  const currentPass = allSignals.filter(s => s.netRatio < 5).length;
  console.log('\n当前方案 (strongTraderNetPositionRatio < 5):');
  console.log('  通过: ' + currentPass + '/' + total + ' (' + (currentPass/total*100).toFixed(1) + '%)');

  // 方案A: walletCount > 0 AND netRatio < 5
  const planAPass = allSignals.filter(s => s.walletCount > 0 && s.netRatio < 5).length;
  console.log('\n方案A (walletCount > 0 AND netRatio < 5):');
  console.log('  通过: ' + planAPass + '/' + total + ' (' + (planAPass/total*100).toFixed(1) + '%)');

  // 方案B: (walletCount > 0 OR volume > 15000) AND netRatio < 5
  const planBPass = allSignals.filter(s => (s.walletCount > 0 || s.volume > 15000) && s.netRatio < 5).length;
  console.log('\n方案B ((walletCount > 0 OR volume > 15000) AND netRatio < 5):');
  console.log('  通过: ' + planBPass + '/' + total + ' (' + (planBPass/total*100).toFixed(1) + '%)');

  // 方案C: walletCount >= 2 AND walletCount <= 10 AND netRatio < 5
  const planCPass = allSignals.filter(s => s.walletCount >= 2 && s.walletCount <= 10 && s.netRatio < 5).length;
  console.log('\n方案C (2 <= walletCount <= 10 AND netRatio < 5):');
  console.log('  通过: ' + planCPass + '/' + total + ' (' + (planCPass/total*100).toFixed(1) + '%)');
}

detailedAnalysis().catch(console.error);
