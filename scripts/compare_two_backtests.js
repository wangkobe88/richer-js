/**
 * 对比两个基于同一虚拟实验的回测
 * 找出效果差距的原因
 */

const http = require('http');

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function getExperimentData(experimentId) {
  const [tradesData, signalsData] = await Promise.all([
    get(`http://localhost:3010/api/experiment/${experimentId}/trades?limit=10000`),
    get(`http://localhost:3010/api/experiment/${experimentId}/signals?limit=10000`)
  ]);

  // 计算 PnL
  const tokenPnL = {};
  tradesData.trades?.forEach(t => {
    if (t.trade_status !== 'success') return;
    const addr = t.token_address;
    if (!tokenPnL[addr]) {
      tokenPnL[addr] = {
        symbol: t.token_symbol,
        totalSpent: 0,
        totalReceived: 0
      };
    }
    if (t.direction === 'buy') {
      tokenPnL[addr].totalSpent += parseFloat(t.input_amount || 0);
    } else if (t.direction === 'sell') {
      tokenPnL[addr].totalReceived += parseFloat(t.output_amount || 0);
    }
  });

  const tokens = Object.entries(tokenPnL).map(([addr, data]) => ({
    address: addr,
    symbol: data.symbol,
    returnRate: data.totalSpent > 0 ? ((data.totalReceived - data.totalSpent) / data.totalSpent * 100) : 0,
    totalSpent: data.totalSpent,
    totalReceived: data.totalReceived,
  }));

  // 构建因子
  const buySignals = signalsData.signals?.filter(s => s.action === 'buy' && s.executed === true) || [];
  const signalFactors = {};
  buySignals.forEach(s => {
    const addr = s.token_address.toLowerCase();
    if (!signalFactors[addr]) {
      const f = s.metadata?.preBuyCheckFactors || {};
      const tf = s.metadata?.trendFactors || {};
      signalFactors[addr] = {
        countPerMin: f.earlyTradesCountPerMin,
        top2Ratio: f.walletClusterTop2Ratio,
        uniqueWallets: f.earlyTradesUniqueWallets,
        earlyReturn: tf.earlyReturn,
        buyPrice: tf.buyPrice,
      };
    }
  });

  const dataset = tokens.map(t => ({
    ...t,
    factors: signalFactors[t.address.toLowerCase()] || {}
  })).filter(t => t.factors.countPerMin !== undefined);

  // 获取实验配置
  const config = signalsData.signals?.[0]?.metadata?.experimentConfig || {};

  return {
    experimentId,
    dataset,
    config,
    tradesCount: tradesData.trades?.length || 0,
    signalsCount: signalsData.signals?.length || 0,
    buySignalsCount: buySignals.length,
  };
}

async function main() {
  console.log('=== 对比两个回测实验 ===\n');

  const exp1 = await getExperimentData('209a7796-f955-4d7a-ae21-0902fef3d7cc');
  const exp2 = await getExperimentData('2522cab9-721f-4922-86f9-7484d644e7cc');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【实验基本信息】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('实验1: 209a7796-f955-4d7a-ae21-0902fef3d7cc');
  console.log(`  Trades: ${exp1.tradesCount}, Signals: ${exp1.signalsCount}, Buy Signals: ${exp1.buySignalsCount}`);
  console.log(`  代币数: ${exp1.dataset.length}`);
  console.log('');
  console.log('实验2: 2522cab9-721f-4922-86f9-7484d644e7cc');
  console.log(`  Trades: ${exp2.tradesCount}, Signals: ${exp2.signalsCount}, Buy Signals: ${exp2.buySignalsCount}`);
  console.log(`  代币数: ${exp2.dataset.length}`);
  console.log('');

  // 对比配置
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【实验配置对比】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('配置项'.padEnd(30) + '实验1'.padEnd(30) + '实验2');
  console.log('-'.repeat(80));

  const configKeys = ['preBuyCheckCondition', 'buyCondition', 'sellCondition', 'buyTimeMinutes', 'earlyReturnMin', 'earlyReturnMax'];
  configKeys.forEach(key => {
    const v1 = exp1.config[key] || '无';
    const v2 = exp2.config[key] || '无';
    const v1Str = v1.length > 25 ? v1.substring(0, 25) + '...' : v1;
    const v2Str = v2.length > 25 ? v2.substring(0, 25) + '...' : v2;
    console.log(`${key.padEnd(30)}${v1Str.padEnd(30)}${v2Str}`);
  });
  console.log('');

  // 对比整体收益
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【整体收益对比】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const exp1Profit = exp1.dataset.filter(t => t.returnRate > 0);
  const exp1Losing = exp1.dataset.filter(t => t.returnRate <= 0);
  const exp1Avg = exp1.dataset.reduce((a, t) => a + t.returnRate, 0) / exp1.dataset.length;

  const exp2Profit = exp2.dataset.filter(t => t.returnRate > 0);
  const exp2Losing = exp2.dataset.filter(t => t.returnRate <= 0);
  const exp2Avg = exp2.dataset.reduce((a, t) => a + t.returnRate, 0) / exp2.dataset.length;

  console.log('指标'.padEnd(15) + '实验1'.padEnd(15) + '实验2'.padEnd(15) + '差异');
  console.log('-'.repeat(60));
  console.log(`代币数`.padEnd(15) + `${exp1.dataset.length}`.padEnd(15) + `${exp2.dataset.length}`.padEnd(15) + `${exp1.dataset.length - exp2.dataset.length}`);
  console.log(`盈利数`.padEnd(15) + `${exp1Profit.length}`.padEnd(15) + `${exp2Profit.length}`.padEnd(15) + `${exp1Profit.length - exp2Profit.length}`);
  console.log(`亏损数`.padEnd(15) + `${exp1Losing.length}`.padEnd(15) + `${exp2Losing.length}`.padEnd(15) + `${exp1Losing.length - exp2Losing.length}`);
  console.log(`胜率`.padEnd(15) + `${(exp1Profit.length/exp1.dataset.length*100).toFixed(0)}%`.padEnd(15) + `${(exp2Profit.length/exp2.dataset.length*100).toFixed(0)}%`.padEnd(15) + `${((exp1Profit.length/exp1.dataset.length) - (exp2Profit.length/exp2.dataset.length)*100).toFixed(0)}%`);
  console.log(`平均收益`.padEnd(15) + `${exp1Avg.toFixed(1)}%`.padEnd(15) + `${exp2Avg.toFixed(1)}%`.padEnd(15) + `${(exp1Avg - exp2Avg).toFixed(1)}%`);
  console.log('');

  // 找出差异的代币
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【代币差异分析】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const exp1Tokens = new Set(exp1.dataset.map(t => t.symbol));
  const exp2Tokens = new Set(exp2.dataset.map(t => t.symbol));

  const onlyInExp1 = exp1.dataset.filter(t => !exp2Tokens.has(t.symbol));
  const onlyInExp2 = exp2.dataset.filter(t => !exp1Tokens.has(t.symbol));
  const inBoth = exp1.dataset.filter(t => exp2Tokens.has(t.symbol));

  console.log(`仅在实验1: ${onlyInExp1.length} 个代币`);
  console.log(`仅在实验2: ${onlyInExp2.length} 个代币`);
  console.log(`两个都有: ${inBoth.length} 个代币\n`);

  // 对比相同代币的收益
  console.log('【相同代币的收益对比】\n');

  const sameTokenComparison = inBoth.map(t1 => {
    const t2 = exp2.dataset.find(t => t.symbol === t1.symbol);
    return {
      symbol: t1.symbol,
      exp1Return: t1.returnRate,
      exp2Return: t2.returnRate,
      diff: t1.returnRate - t2.returnRate,
    };
  });

  sameTokenComparison.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  console.log('代币'.padEnd(15) + '实验1收益'.padEnd(12) + '实验2收益'.padEnd(12) + '差异');
  console.log('-'.repeat(60));

  sameTokenComparison.slice(0, 15).forEach(c => {
    console.log(`${c.symbol.padEnd(15)}${c.exp1Return.toFixed(1).padEnd(12)}${c.exp2Return.toFixed(1).padEnd(12)}${c.diff >= 0 ? '+' : ''}${c.diff.toFixed(1)}%`);
  });

  // 分析仅在实验1的代币
  if (onlyInExp1.length > 0) {
    console.log(`\n【仅在实验1的 ${onlyInExp1.length} 个代币】\n`);
    onlyInExp1.forEach(t => {
      console.log(`  ${t.returnRate > 0 ? '✅' : '❌'} ${t.symbol}: ${t.returnRate.toFixed(1)}%`);
    });
  }

  // 分析仅在实验2的代币
  if (onlyInExp2.length > 0) {
    console.log(`\n【仅在实验2的 ${onlyInExp2.length} 个代币】\n`);
    onlyInExp2.forEach(t => {
      console.log(`  ${t.returnRate > 0 ? '✅' : '❌'} ${t.symbol}: ${t.returnRate.toFixed(1)}%`);
    });
  }

  // 分析因子差异
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【因子分布对比】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('countPerMin 分布:');
  console.log('范围'.padEnd(15) + '实验1'.padEnd(10) + '实验2');
  console.log('-'.repeat(40));

  const countRanges = [
    { max: 20, label: '< 20' },
    { min: 20, max: 50, label: '20-50' },
    { min: 50, max: 100, label: '50-100' },
    { min: 100, max: 150, label: '100-150' },
    { min: 150, label: '>= 150' },
  ];

  countRanges.forEach(({ min, max, label }) => {
    const subset1 = exp1.dataset.filter(t => {
      const val = t.factors.countPerMin;
      if (val === undefined) return false;
      if (min !== undefined && max !== undefined) return val >= min && val < max;
      if (min !== undefined) return val >= min;
      if (max !== undefined) return val < max;
      return true;
    });

    const subset2 = exp2.dataset.filter(t => {
      const val = t.factors.countPerMin;
      if (val === undefined) return false;
      if (min !== undefined && max !== undefined) return val >= min && val < max;
      if (min !== undefined) return val >= min;
      if (max !== undefined) return val < max;
      return true;
    });

    const avg1 = subset1.length > 0 ? subset1.reduce((a, t) => a + t.returnRate, 0) / subset1.length : 0;
    const avg2 = subset2.length > 0 ? subset2.reduce((a, t) => a + t.returnRate, 0) / subset2.length : 0;

    console.log(`${label.padEnd(15)}${subset1.length} (${avg1.toFixed(1)}%)`.padEnd(10) + `${subset2.length} (${avg2.toFixed(1)}%)`);
  });

  // 结论
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎯 差异原因分析');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (exp1.dataset.length !== exp2.dataset.length) {
    console.log(`1. 代币数量不同：实验1 ${exp1.dataset.length} 个 vs 实验2 ${exp2.dataset.length} 个`);
    console.log(`   差异：${Math.abs(exp1.dataset.length - exp2.dataset.length)} 个代币`);
  }

  if (Math.abs(exp1Avg - exp2Avg) > 5) {
    console.log(`2. 平均收益差异较大：实验1 ${exp1Avg.toFixed(1)}% vs 实验2 ${exp2Avg.toFixed(1)}%`);
    console.log(`   差异：${(exp1Avg - exp2Avg).toFixed(1)}%`);
  }

  const configDiff = [];
  if (exp1.config.preBuyCheckCondition !== exp2.config.preBuyCheckCondition) {
    configDiff.push('preBuyCheckCondition');
  }
  if (exp1.config.buyCondition !== exp2.config.buyCondition) {
    configDiff.push('buyCondition');
  }

  if (configDiff.length > 0) {
    console.log(`3. 配置差异：${configDiff.join(', ')}`);
    console.log('   这是导致效果差异的主要原因');
  }

  if (onlyInExp1.length > 0 || onlyInExp2.length > 0) {
    console.log(`4. 代币选择不同：`);
    console.log(`   实验1独有：${onlyInExp1.length} 个代币`);
    console.log(`   实验2独有：${onlyInExp2.length} 个代币`);
  }
}

main().catch(console.error);
