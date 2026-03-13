/**
 * 调研实验 4c265a5b 的收益与因子关系 (修正版)
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 调研实验 4c265a5b 的收益与因子关系 ===\n');

  const expId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 1. 获取trades - 正确计算收益
  const { data: trades } = await supabase
    .from('trades')
    .select('token_address, token_symbol, trade_direction, input_amount, output_amount, executed_at, metadata')
    .eq('experiment_id', expId)
    .order('executed_at', { ascending: true });

  // 按代币汇总收益
  const tokenProfits = {};
  for (const trade of trades || []) {
    const addr = trade.token_address;
    if (!tokenProfits[addr]) {
      tokenProfits[addr] = {
        symbol: trade.token_symbol,
        address: addr,
        buys: 0,
        sells: 0,
        totalSpent: 0,   // buy.input_amount (BNB花费)
        totalReceived: 0 // sell.output_amount (BNB获得)
      };
    }

    if (trade.trade_direction === 'buy') {
      tokenProfits[addr].buys++;
      tokenProfits[addr].totalSpent += parseFloat(trade.input_amount || 0);
    } else {
      tokenProfits[addr].sells++;
      tokenProfits[addr].totalReceived += parseFloat(trade.output_amount || 0);
    }
  }

  // 计算收益率
  const profitList = Object.values(tokenProfits).map(t => {
    t.profit = t.totalSpent > 0 ? ((t.totalReceived - t.totalSpent) / t.totalSpent * 100) : 0;
    return t;
  }).sort((a, b) => b.profit - a.profit);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【代币收益分布】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const profitCount = profitList.filter(p => p.profit > 0).length;
  const lossCount = profitList.filter(p => p.profit < 0).length;
  const breakevenCount = profitList.filter(p => p.profit === 0).length;

  console.log(`总代币数: ${profitList.length}`);
  console.log(`盈利: ${profitCount} / 亏损: ${lossCount} / 盈亏平衡: ${breakevenCount}`);
  console.log(`胜率: ${(profitCount / profitList.length * 100).toFixed(2)}%`);
  console.log(`总收益: ${(profitList.reduce((sum, p) => sum + p.profit, 0) / profitList.length).toFixed(2)}%`);

  // 收益分布
  const profitRanges = [
    { label: '>50%', min: 50, count: 0, tokens: [] },
    { label: '20%-50%', min: 20, max: 50, count: 0, tokens: [] },
    { label: '0%-20%', min: 0, max: 20, count: 0, tokens: [] },
    { label: '-10%-0%', min: -10, max: 0, count: 0, tokens: [] },
    { label: '<-10%', max: -10, count: 0, tokens: [] }
  ];

  for (const p of profitList) {
    for (const range of profitRanges) {
      if (range.max !== undefined) {
        if (p.profit >= range.min && p.profit < range.max) {
          range.count++;
          range.tokens.push(p);
          break;
        }
      } else if (p.profit >= range.min) {
        range.count++;
        range.tokens.push(p);
        break;
      }
    }
  }

  console.log('\n收益分布:');
  profitRanges.forEach(r => {
    console.log(`  ${r.label.padEnd(12)}: ${r.count} 个 (${(r.count/profitList.length*100).toFixed(1)}%)`);
  });

  // 2. 获取买入信号的因子数据
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【获取因子数据】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, token_symbol, action, metadata')
    .eq('experiment_id', expId)
    .eq('action', 'buy')
    .eq('executed', true);

  // 将信号与代币收益匹配
  const signalWithProfit = (signals || []).map(s => {
    const profit = tokenProfits[s.token_address];
    return {
      address: s.token_address,
      symbol: s.token_symbol,
      trendFactors: s.metadata?.trendFactors || {},
      preBuyCheckFactors: s.metadata?.preBuyCheckFactors || {},
      profit: profit?.profit || 0,
      totalSpent: profit?.totalSpent || 0,
      totalReceived: profit?.totalReceived || 0
    };
  });

  // 3. 高收益 vs 低收益 因子对比
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【高收益 vs 低收益 代币因子对比】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const highProfit = signalWithProfit.filter(s => s.profit >= 20);
  const mediumProfit = signalWithProfit.filter(s => s.profit >= 0 && s.profit < 20);
  const smallLoss = signalWithProfit.filter(s => s.profit >= -10 && s.profit < 0);
  const bigLoss = signalWithProfit.filter(s => s.profit < -10);

  console.log(`高收益组 (>=20%): ${highProfit.length} 个`);
  console.log(`中收益组 (0-20%): ${mediumProfit.length} 个`);
  console.log(`小亏损组 (-10%-0%): ${smallLoss.length} 个`);
  console.log(`大亏损组 (<-10%): ${bigLoss.length} 个`);

  // 关键因子对比
  const keyFactors = [
    'age', 'earlyReturn', 'trendCV', 'trendSlope', 'trendStrengthScore',
    'trendTotalReturn', 'riseSpeed', 'holders', 'fdv', 'tvl',
    'drawdownFromHighest', 'trendRecentDownRatio'
  ];

  console.log('\n关键因子中位数对比:');
  console.log('因子'.padEnd(25) + '高收益'.padEnd(12) + '中收益'.padEnd(12) + '小亏损'.padEnd(12) + '大亏损');
  console.log('─'.repeat(77));

  for (const factor of keyFactors) {
    const getValues = (list) => list.map(s => s.trendFactors[factor]).filter(v => v != null && !isNaN(v));

    const highVals = getValues(highProfit);
    const medVals = getValues(mediumProfit);
    const smallLossVals = getValues(smallLoss);
    const bigLossVals = getValues(bigLoss);

    if (highVals.length === 0 && medVals.length === 0 && smallLossVals.length === 0 && bigLossVals.length === 0) continue;

    const median = (arr) => {
      if (arr.length === 0) return 'N/A';
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0 ? ((sorted[mid-1] + sorted[mid]) / 2).toFixed(2) : sorted[mid].toFixed(2);
    };

    const formatVal = (v) => typeof v === 'number' ? v.toFixed(2) : 'N/A';

    console.log(
      factor.padEnd(25) +
      formatVal(parseFloat(median(highVals) || 0)).padEnd(12) +
      formatVal(parseFloat(median(medVals) || 0)).padEnd(12) +
      formatVal(parseFloat(median(smallLossVals) || 0)).padEnd(12) +
      formatVal(parseFloat(median(bigLossVals) || 0))
    );
  }

  // 4. 早期参与者因子对比
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【早期参与者 & 钱包簇因子对比】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const earlyFactors = [
    'earlyTradesCountPerMin', 'earlyTradesVolumePerMin', 'earlyTradesWalletsPerMin',
    'walletClusterSecondToFirstRatio', 'walletClusterMegaRatio', 'walletClusterTop2Ratio',
    'walletClusterMaxBlockBuyRatio', 'earlyTradesHighValueCount', 'earlyTradesHighValuePerMin'
  ];

  console.log('因子'.padEnd(35) + '高收益'.padEnd(12) + '中收益'.padEnd(12) + '小亏损'.padEnd(12) + '大亏损');
  console.log('─'.repeat(87));

  for (const factor of earlyFactors) {
    const getValues = (list) => list.map(s => s.preBuyCheckFactors[factor]).filter(v => v != null && !isNaN(v));

    const highVals = getValues(highProfit);
    const medVals = getValues(mediumProfit);
    const smallLossVals = getValues(smallLoss);
    const bigLossVals = getValues(bigLoss);

    if (highVals.length === 0 && medVals.length === 0 && smallLossVals.length === 0 && bigLossVals.length === 0) continue;

    const median = (arr) => {
      if (arr.length === 0) return 'N/A';
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0 ? ((sorted[mid-1] + sorted[mid]) / 2).toFixed(2) : sorted[mid].toFixed(2);
    };

    const formatVal = (v) => typeof v === 'number' ? v.toFixed(2) : 'N/A';

    console.log(
      factor.padEnd(35) +
      formatVal(parseFloat(median(highVals) || 0)).padEnd(12) +
      formatVal(parseFloat(median(medVals) || 0)).padEnd(12) +
      formatVal(parseFloat(median(smallLossVals) || 0)).padEnd(12) +
      formatVal(parseFloat(median(bigLossVals) || 0))
    );
  }

  // 5. 具体低收益代币分析
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【亏损最严重的10个代币详情】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const worst10 = profitList.slice(-10).reverse();
  for (const t of worst10) {
    const signal = signalWithProfit.find(s => s.address === t.address);
    if (signal) {
      console.log(`${t.symbol}: 收益 ${t.profit.toFixed(2)}%`);
      console.log(`  earlyReturn: ${signal.trendFactors.earlyReturn?.toFixed(2)}%, age: ${signal.trendFactors.age?.toFixed(2)}min, trendStrengthScore: ${signal.trendFactors.trendStrengthScore?.toFixed(2)}`);
      console.log(`  earlyTradesCountPerMin: ${signal.preBuyCheckFactors.earlyTradesCountPerMin?.toFixed(2)}, walletClusterTop2Ratio: ${signal.preBuyCheckFactors.walletClusterTop2Ratio?.toFixed(2)}`);
      console.log('');
    }
  }

  // 6. 最好的代币
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【收益最好的10个代币详情】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const best10 = profitList.slice(-10).reverse(); // 这个是倒序的，需要重新取
  const best10Correct = profitList.slice(0, 10);

  for (const t of best10Correct) {
    const signal = signalWithProfit.find(s => s.address === t.address);
    if (signal) {
      console.log(`${t.symbol}: 收益 ${t.profit.toFixed(2)}%`);
      console.log(`  earlyReturn: ${signal.trendFactors.earlyReturn?.toFixed(2)}%, age: ${signal.trendFactors.age?.toFixed(2)}min, trendStrengthScore: ${signal.trendFactors.trendStrengthScore?.toFixed(2)}`);
      console.log(`  earlyTradesCountPerMin: ${signal.preBuyCheckFactors.earlyTradesCountPerMin?.toFixed(2)}, walletClusterTop2Ratio: ${signal.preBuyCheckFactors.walletClusterTop2Ratio?.toFixed(2)}`);
      console.log('');
    }
  }

  // 7. 关键洞察
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【关键洞察】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 分析 earlyReturn 与收益的关系
  const highEAR = signalWithProfit.filter(s => s.trendFactors.earlyReturn >= 300);
  const lowEAR = signalWithProfit.filter(s => s.trendFactors.earlyReturn < 100);

  const highEARAvgProfit = highEAR.reduce((sum, s) => sum + s.profit, 0) / (highEAR.length || 1);
  const lowEARAvgProfit = lowEAR.reduce((sum, s) => sum + s.profit, 0) / (lowEAR.length || 1);

  console.log(`earlyReturn >= 300% 的代币: ${highEAR.length} 个, 平均收益: ${highEARAvgProfit.toFixed(2)}%`);
  console.log(`earlyReturn < 100% 的代币: ${lowEAR.length} 个, 平均收益: ${lowEARAvgProfit.toFixed(2)}%`);

  // 分析 trendRecentDownRatio 与收益的关系
  const highDownRatio = signalWithProfit.filter(s => s.trendFactors.trendRecentDownRatio >= 0.5);
  const lowDownRatio = signalWithProfit.filter(s => s.trendFactors.trendRecentDownRatio < 0.3);

  const highDownAvgProfit = highDownRatio.reduce((sum, s) => sum + s.profit, 0) / (highDownRatio.length || 1);
  const lowDownAvgProfit = lowDownRatio.reduce((sum, s) => sum + s.profit, 0) / (lowDownRatio.length || 1);

  console.log(`trendRecentDownRatio >= 0.5 的代币: ${highDownRatio.length} 个, 平均收益: ${highDownAvgProfit.toFixed(2)}%`);
  console.log(`trendRecentDownRatio < 0.3 的代币: ${lowDownRatio.length} 个, 平均收益: ${lowDownAvgProfit.toFixed(2)}%`);

  // 分析 walletClusterTop2Ratio 与收益的关系
  const highCluster = signalWithProfit.filter(s => s.preBuyCheckFactors.walletClusterTop2Ratio >= 0.9);
  const lowCluster = signalWithProfit.filter(s => s.preBuyCheckFactors.walletClusterTop2Ratio < 0.7);

  const highClusterAvgProfit = highCluster.reduce((sum, s) => sum + s.profit, 0) / (highCluster.length || 1);
  const lowClusterAvgProfit = lowCluster.reduce((sum, s) => sum + s.profit, 0) / (lowCluster.length || 1);

  console.log(`walletClusterTop2Ratio >= 0.9 的代币: ${highCluster.length} 个, 平均收益: ${highClusterAvgProfit.toFixed(2)}%`);
  console.log(`walletClusterTop2Ratio < 0.7 的代币: ${lowCluster.length} 个, 平均收益: ${lowClusterAvgProfit.toFixed(2)}%`);
}

main().catch(console.error);
