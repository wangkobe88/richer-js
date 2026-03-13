/**
 * 调研实验 4c265a5b 的收益与因子关系
 * 目标：找出高收益代币和低收益代币在因子上的差异
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

  // 1. 获取实验配置
  const { data: exp } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', expId)
    .single();

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【实验配置】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`实验名称: ${exp.experiment_name}`);
  console.log(`模式: ${exp.trading_mode}`);
  console.log(`状态: ${exp.status}`);
  console.log(`胜率: ${exp.stats?.winRate?.toFixed(2)}%`);
  console.log(`总收益: ${exp.stats?.totalReturn?.toFixed(2)}%`);
  console.log(`盈利: ${exp.stats?.profitCount} / 亏损: ${exp.stats?.lossCount}`);

  // 2. 获取代币收益数据
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【代币收益分布】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const { data: trades } = await supabase
    .from('trades')
    .select('token_symbol, token_address, trade_direction, input_amount, output_amount, executed_at, metadata')
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
        totalIn: 0,
        totalOut: 0,
        profit: 0
      };
    }

    if (trade.trade_direction === 'buy') {
      tokenProfits[addr].buys++;
      tokenProfits[addr].totalIn += parseFloat(trade.output_amount);
    } else {
      tokenProfits[addr].sells++;
      tokenProfits[addr].totalOut += parseFloat(trade.output_amount);
    }
  }

  // 计算收益率
  const profitList = Object.values(tokenProfits).map(t => {
    t.profit = t.totalIn > 0 ? ((t.totalOut - t.totalIn) / t.totalIn * 100) : 0;
    return t;
  }).sort((a, b) => b.profit - a.profit);

  console.log(`总代币数: ${profitList.length}`);
  console.log(`盈利代币: ${profitList.filter(p => p.profit > 0).length}`);
  console.log(`亏损代币: ${profitList.filter(p => p.profit < 0).length}`);

  // 收益分布
  const profitRanges = [
    { label: '>50%', min: 50, count: 0 },
    { label: '20%-50%', min: 20, max: 50, count: 0 },
    { label: '0%-20%', min: 0, max: 20, count: 0 },
    { label: '-20%-0%', min: -20, max: 0, count: 0 },
    { label: '<-20%', max: -20, count: 0 }
  ];

  for (const p of profitList) {
    for (const range of profitRanges) {
      if (range.max !== undefined) {
        if (p.profit >= range.min && p.profit < range.max) {
          range.count++;
          break;
        }
      } else if (p.profit >= range.min) {
        range.count++;
        break;
      }
    }
  }

  console.log('\n收益分布:');
  profitRanges.forEach(r => {
    console.log(`  ${r.label.padEnd(12)}: ${r.count} 个 (${(r.count/profitList.length*100).toFixed(1)}%)`);
  });

  // 3. 获取买入信号的因子数据
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
      totalIn: profit?.totalIn || 0,
      totalOut: profit?.totalOut || 0
    };
  });

  // 4. 高收益 vs 低收益 因子对比
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【高收益 vs 低收益 代币因子对比】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const highProfit = signalWithProfit.filter(s => s.profit >= 20);
  const mediumProfit = signalWithProfit.filter(s => s.profit >= 0 && s.profit < 20);
  const lowProfit = signalWithProfit.filter(s => s.profit < 0);

  console.log(`高收益组 (>=20%): ${highProfit.length} 个`);
  console.log(`中收益组 (0-20%): ${mediumProfit.length} 个`);
  console.log(`低收益组 (<0%): ${lowProfit.length} 个`);

  // 关键因子对比
  const keyFactors = [
    'age', 'earlyReturn', 'trendCV', 'trendSlope', 'trendStrengthScore',
    'trendTotalReturn', 'riseSpeed', 'holders', 'fdv', 'tvl',
    'drawdownFromHighest', 'trendRecentDownRatio'
  ];

  console.log('\n关键因子中位数对比:');
  console.log('因子'.padEnd(25) + '高收益'.padEnd(12) + '中收益'.padEnd(12) + '低收益');
  console.log('─'.repeat(65));

  for (const factor of keyFactors) {
    const getValues = (list) => list.map(s => s.trendFactors[factor]).filter(v => v != null && !isNaN(v));

    const highVals = getValues(highProfit);
    const medVals = getValues(mediumProfit);
    const lowVals = getValues(lowProfit);

    if (highVals.length === 0 && medVals.length === 0 && lowVals.length === 0) continue;

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
      formatVal(parseFloat(median(lowVals) || 0))
    );
  }

  // 5. 早期参与者因子对比
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【早期参与者 & 钱包簇因子对比】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const earlyFactors = [
    'earlyTradesCountPerMin', 'earlyTradesVolumePerMin', 'earlyTradesWalletsPerMin',
    'walletClusterSecondToFirstRatio', 'walletClusterMegaRatio', 'walletClusterTop2Ratio',
    'walletClusterMaxBlockBuyRatio'
  ];

  console.log('因子'.padEnd(35) + '高收益'.padEnd(12) + '中收益'.padEnd(12) + '低收益');
  console.log('─'.repeat(75));

  for (const factor of earlyFactors) {
    const getValues = (list) => list.map(s => s.preBuyCheckFactors[factor]).filter(v => v != null && !isNaN(v));

    const highVals = getValues(highProfit);
    const medVals = getValues(mediumProfit);
    const lowVals = getValues(lowProfit);

    if (highVals.length === 0 && medVals.length === 0 && lowVals.length === 0) continue;

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
      formatVal(parseFloat(median(lowVals) || 0))
    );
  }

  // 6. 具体低收益代币分析
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【最差的10个代币详情】');
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

  // 7. 最好的10个代币
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【最好的10个代币详情】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const best10 = profitList.slice(0, 10);
  for (const t of best10) {
    const signal = signalWithProfit.find(s => s.address === t.address);
    if (signal) {
      console.log(`${t.symbol}: 收益 ${t.profit.toFixed(2)}%`);
      console.log(`  earlyReturn: ${signal.trendFactors.earlyReturn?.toFixed(2)}%, age: ${signal.trendFactors.age?.toFixed(2)}min, trendStrengthScore: ${signal.trendFactors.trendStrengthScore?.toFixed(2)}`);
      console.log(`  earlyTradesCountPerMin: ${signal.preBuyCheckFactors.earlyTradesCountPerMin?.toFixed(2)}, walletClusterTop2Ratio: ${signal.preBuyCheckFactors.walletClusterTop2Ratio?.toFixed(2)}`);
      console.log('');
    }
  }
}

main().catch(console.error);
