/**
 * 分析没有强势交易者参与的代币特征
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeNoStrongTraderTokens() {
  const backtestExpId = 'e9fe498e-a176-4d8f-9096-46a9c7914bd0';
  const originalExpId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 获取回测实验的所有信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', backtestExpId);

  // 获取原始实验的代币收益（从实验配置中或者直接计算）
  // 先获取原始实验的交易
  const { data: originalTrades, error } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', originalExpId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('获取原始交易失败:', error);
    return;
  }

  // 按代币统计收益
  const tokenReturns = new Map();
  for (const trade of originalTrades) {
    const addr = trade.token_address;
    if (!tokenReturns.has(addr)) {
      tokenReturns.set(addr, {
        symbol: trade.token_symbol,
        buyCost: 0,
        sellRevenue: 0,
        buyPrice: null,
        sellPrice: null,
        firstBuyTime: null,
        lastSellTime: null
      });
    }
    const stat = tokenReturns.get(addr);
    const value = (trade.amount || 0) * (trade.price_usd || 0);
    if (trade.trade_type === 'buy') {
      stat.buyCost += value;
      if (!stat.buyPrice) stat.buyPrice = trade.price_usd;
      if (!stat.firstBuyTime) stat.firstBuyTime = trade.created_at;
    } else if (trade.trade_type === 'sell') {
      stat.sellRevenue += value;
      stat.sellPrice = trade.price_usd;
      stat.lastSellTime = trade.created_at;
    }
  }

  // 计算收益率
  const returnsMap = new Map();
  for (const [addr, stat] of tokenReturns) {
    if (stat.buyCost > 0) {
      const profit = stat.sellRevenue - stat.buyCost;
      const returnRate = (profit / stat.buyCost) * 100;
      returnsMap.set(addr, {
        returnRate,
        profit,
        buyPrice: stat.buyPrice,
        sellPrice: stat.sellPrice
      });
    }
  }

  // 按 strong trader 参与度分类
  const noStrongTrader = [];
  const lowParticipation = [];
  const highParticipation = [];

  for (const sig of signals) {
    const factors = sig.metadata?.preBuyCheckFactors || {};
    const netRatio = factors.strongTraderNetPositionRatio ?? 0;
    const walletCount = factors.strongTraderWalletCount ?? 0;
    const status = sig.metadata?.execution_status;

    const returnData = returnsMap.get(sig.token_address);

    const item = {
      symbol: sig.token_symbol,
      address: sig.token_address,
      netRatio,
      walletCount,
      tradeCount: factors.strongTraderTradeCount ?? 0,
      sellIntensity: factors.strongTraderSellIntensity ?? 0,
      status,
      returnRate: returnData?.returnRate,
      profit: returnData?.profit,
      buyPrice: returnData?.buyPrice,
      sellPrice: returnData?.sellPrice,
      // 其他因子
      volumePerMin: factors.earlyTradesVolumePerMin ?? 0,
      walletsPerMin: factors.earlyTradesWalletsPerMin ?? 0,
      highValueCount: factors.earlyTradesHighValueCount ?? 0,
      countPerMin: factors.earlyTradesCountPerMin ?? 0,
      actualSpan: factors.earlyTradesActualSpan ?? 0,
      clusterCount: factors.walletClusterCount ?? 0,
      maxBlockBuyRatio: factors.walletClusterMaxBlockBuyRatio ?? 0
    };

    if (walletCount === 0) {
      noStrongTrader.push(item);
    } else if (netRatio < 5) {
      lowParticipation.push(item);
    } else {
      highParticipation.push(item);
    }
  }

  console.log('=== 无强势交易者参与 (WalletCount = 0) 的代币分析 ===');
  console.log('总数:', noStrongTrader.length);
  console.log('');

  // 统计有收益数据的代币
  const noStWithReturn = noStrongTrader.filter(t => t.returnRate !== undefined);
  console.log('有原始收益数据的代币数:', noStWithReturn.length);

  if (noStWithReturn.length > 0) {
    const avgReturn = noStWithReturn.reduce((sum, t) => sum + t.returnRate, 0) / noStWithReturn.length;
    const winning = noStWithReturn.filter(t => t.returnRate > 0);
    const losing = noStWithReturn.filter(t => t.returnRate < 0);

    console.log('平均收益率:', avgReturn.toFixed(2) + '%');
    console.log('盈利数:', winning.length, '(' + (winning.length / noStWithReturn.length * 100).toFixed(1) + '%)');
    console.log('亏损数:', losing.length, '(' + (losing.length / noStWithReturn.length * 100).toFixed(1) + '%)');

    // 显示收益最好的和最差的
    noStWithReturn.sort((a, b) => b.returnRate - a.returnRate);

    console.log('\n收益 Top 15:');
    noStWithReturn.slice(0, 15).forEach((t, i) => {
      const emoji = t.returnRate >= 50 ? '🟢' : t.returnRate >= 0 ? '🟡' : '🔴';
      console.log('  ' + (i + 1) + '. ' + emoji + ' ' + t.symbol + ': ' + t.returnRate.toFixed(2) + '% (买入$' + t.buyPrice?.toFixed(6) + ' → 卖出$' + t.sellPrice?.toFixed(6) + ')');
    });

    console.log('\n收益 Bottom 15:');
    noStWithReturn.slice(-15).reverse().forEach((t, i) => {
      console.log('  ' + (i + 1) + '. ' + t.symbol + ': ' + t.returnRate.toFixed(2) + '% (买入$' + t.buyPrice?.toFixed(6) + ' → 卖出$' + t.sellPrice?.toFixed(6) + ')');
    });
  }

  console.log('\n=== 对比分析：不同参与度的收益表现 ===');

  // 低参与度
  const lowWithReturn = lowParticipation.filter(t => t.returnRate !== undefined);
  const lowAvg = lowWithReturn.length > 0 ? lowWithReturn.reduce((sum, t) => sum + t.returnRate, 0) / lowWithReturn.length : 0;

  // 高参与度
  const highWithReturn = highParticipation.filter(t => t.returnRate !== undefined);
  const highAvg = highWithReturn.length > 0 ? highWithReturn.reduce((sum, t) => sum + t.returnRate, 0) / highWithReturn.length : 0;

  const noStAvg = noStWithReturn.length > 0 ? noStWithReturn.reduce((sum, t) => sum + t.returnRate, 0) / noStWithReturn.length : 0;

  console.log('\n无强势交易者 (Wallet=0):');
  console.log('  样本数:', noStWithReturn.length);
  console.log('  平均收益:', noStAvg.toFixed(2) + '%');

  console.log('\n低参与度 (0<NetRatio<5%):');
  console.log('  样本数:', lowWithReturn.length);
  console.log('  平均收益:', lowAvg.toFixed(2) + '%');

  console.log('\n高参与度 (NetRatio>=5%):');
  console.log('  样本数:', highWithReturn.length);
  console.log('  平均收益:', highAvg.toFixed(2) + '%');

  console.log('\n=== 收益率分布 ===');
  console.log('无强势交易者:');
  console.log('  >50%:', noStWithReturn.filter(t => t.returnRate > 50).length);
  console.log('  0-50%:', noStWithReturn.filter(t => t.returnRate >= 0 && t.returnRate <= 50).length);
  console.log('  <0%:', noStWithReturn.filter(t => t.returnRate < 0).length);

  console.log('\n低参与度:');
  console.log('  >50%:', lowWithReturn.filter(t => t.returnRate > 50).length);
  console.log('  0-50%:', lowWithReturn.filter(t => t.returnRate >= 0 && t.returnRate <= 50).length);
  console.log('  <0%:', lowWithReturn.filter(t => t.returnRate < 0).length);

  console.log('\n高参与度:');
  console.log('  >50%:', highWithReturn.filter(t => t.returnRate > 50).length);
  console.log('  0-50%:', highWithReturn.filter(t => t.returnRate >= 0 && t.returnRate <= 50).length);
  console.log('  <0%:', highWithReturn.filter(t => t.returnRate < 0).length);

  // 分析无强势交易者代币的其他特征
  console.log('\n=== 无强势交易者代币的其他早期交易特征 ===');

  const noStSignals = signals.filter(sig => {
    const factors = sig.metadata?.preBuyCheckFactors || {};
    return (factors.strongTraderWalletCount ?? 0) === 0;
  });

  const avgVolume = noStSignals.reduce((sum, sig) => sum + (sig.metadata?.preBuyCheckFactors?.earlyTradesVolumePerMin || 0), 0) / noStSignals.length;
  const avgWallets = noStSignals.reduce((sum, sig) => sum + (sig.metadata?.preBuyCheckFactors?.earlyTradesWalletsPerMin || 0), 0) / noStSignals.length;
  const avgHighValue = noStSignals.reduce((sum, sig) => sum + (sig.metadata?.preBuyCheckFactors?.earlyTradesHighValueCount || 0), 0) / noStSignals.length;
  const avgCount = noStSignals.reduce((sum, sig) => sum + (sig.metadata?.preBuyCheckFactors?.earlyTradesCountPerMin || 0), 0) / noStSignals.length;

  console.log('平均 earlyTradesVolumePerMin:', avgVolume.toFixed(0));
  console.log('平均 earlyTradesWalletsPerMin:', avgWallets.toFixed(1));
  console.log('平均 earlyTradesHighValueCount:', avgHighValue.toFixed(1));
  console.log('平均 earlyTradesCountPerMin:', avgCount.toFixed(1));

  // 与有强势交易者的代币对比
  console.log('\n=== 对比：有 vs 无强势交易者 ===');

  const withStSignals = signals.filter(sig => {
    const factors = sig.metadata?.preBuyCheckFactors || {};
    return (factors.strongTraderWalletCount ?? 0) > 0;
  });

  if (withStSignals.length > 0) {
    const withStAvgVolume = withStSignals.reduce((sum, sig) => sum + (sig.metadata?.preBuyCheckFactors?.earlyTradesVolumePerMin || 0), 0) / withStSignals.length;
    const withStAvgWallets = withStSignals.reduce((sum, sig) => sum + (sig.metadata?.preBuyCheckFactors?.earlyTradesWalletsPerMin || 0), 0) / withStSignals.length;
    const withStAvgHighValue = withStSignals.reduce((sum, sig) => sum + (sig.metadata?.preBuyCheckFactors?.earlyTradesHighValueCount || 0), 0) / withStSignals.length;
    const withStAvgCount = withStSignals.reduce((sum, sig) => sum + (sig.metadata?.preBuyCheckFactors?.earlyTradesCountPerMin || 0), 0) / withStSignals.length;

    console.log('\n无强势交易者:');
    console.log('  交易量/分钟:', avgVolume.toFixed(0));
    console.log('  钱包数/分钟:', avgWallets.toFixed(1));
    console.log('  高价值交易数:', avgHighValue.toFixed(1));
    console.log('  交易数/分钟:', avgCount.toFixed(1));

    console.log('\n有强势交易者:');
    console.log('  交易量/分钟:', withStAvgVolume.toFixed(0));
    console.log('  钱包数/分钟:', withStAvgWallets.toFixed(1));
    console.log('  高价值交易数:', withStAvgHighValue.toFixed(1));
    console.log('  交易数/分钟:', withStAvgCount.toFixed(1));
  }

  // 检查"没有强势交易者"但收益率很高的代币
  console.log('\n=== 异常案例：无强势交易者但高收益 ===');
  noStWithReturn
    .filter(t => t.returnRate > 50)
    .sort((a, b) => b.returnRate - a.returnRate)
    .slice(0, 10)
    .forEach((t, i) => {
      console.log((i + 1) + '. ' + t.symbol + ': ' + t.returnRate.toFixed(2) + '%');
      console.log('   交易量/分钟: ' + t.volumePerMin.toFixed(0));
      console.log('   钱包数/分钟: ' + t.walletsPerMin.toFixed(1));
      console.log('   高价值交易: ' + t.highValueCount);
      console.log('');
    });
}

analyzeNoStrongTraderTokens().catch(console.error);
