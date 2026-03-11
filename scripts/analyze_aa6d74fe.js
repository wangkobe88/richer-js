/**
 * 分析 aa6d74fe 回测实验
 * 验证 countPerMin < 150 的实际效果
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

async function main() {
  console.log('=== 分析回测实验 aa6d74fe ===\n');

  const [tradesData, signalsData] = await Promise.all([
    get('http://localhost:3010/api/experiment/aa6d74fe-61f3-4b9a-8066-3693aa3b5071/trades?limit=10000'),
    get('http://localhost:3010/api/experiment/aa6d74fe-61f3-4b9a-8066-3693aa3b5071/signals?limit=10000')
  ]);

  console.log(`Trades: ${tradesData.trades?.length || 0}`);
  console.log(`Signals: ${signalsData.signals?.length || 0}\n`);

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
    returnRate: data.totalSpent > 0 ? ((data.totalReceived - data.totalSpent) / data.totalSpent * 100) : 0
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
      };
    }
  });

  const dataset = tokens.map(t => ({
    ...t,
    factors: signalFactors[t.address.toLowerCase()] || {}
  })).filter(t => t.factors.countPerMin !== undefined);

  console.log(`有因子数据的代币: ${dataset.length}\n`);

  // 按 countPerMin 分组
  const highActivity = dataset.filter(t => t.factors.countPerMin >= 150);
  const lowActivity = dataset.filter(t => t.factors.countPerMin < 150);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【countPerMin >= 150 的代币】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (highActivity.length > 0) {
    console.log(`共 ${highActivity.length} 个代币\n`);

    highActivity.forEach(t => {
      const status = t.returnRate > 0 ? '✅' : '❌';
      console.log(`${status} ${t.symbol}: ${t.returnRate.toFixed(1)}%, countPerMin=${t.factors.countPerMin.toFixed(1)}, top2Ratio=${t.factors.top2Ratio?.toFixed(2) || 'N/A'}`);
    });

    const losing = highActivity.filter(t => t.returnRate <= 0);
    const avg = highActivity.reduce((a, t) => a + t.returnRate, 0) / highActivity.length;
    console.log(`\n统计: ${losing.length}/${highActivity.length} 亏损 (${(losing.length/highActivity.length*100).toFixed(0)}%), 平均 ${avg.toFixed(1)}%\n`);
  } else {
    console.log('无代币\n');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【countPerMin < 150 的代币（保留的）】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (lowActivity.length > 0) {
    console.log(`共 ${lowActivity.length} 个代币\n`);

    lowActivity.forEach(t => {
      const status = t.returnRate > 0 ? '✅' : '❌';
      console.log(`${status} ${t.symbol}: ${t.returnRate.toFixed(1)}%, countPerMin=${t.factors.countPerMin.toFixed(1)}, top2Ratio=${t.factors.top2Ratio?.toFixed(2) || 'N/A'}`);
    });

    const losing = lowActivity.filter(t => t.returnRate <= 0);
    const avg = lowActivity.reduce((a, t) => a + t.returnRate, 0) / lowActivity.length;
    console.log(`\n统计: ${losing.length}/${lowActivity.length} 亏损 (${(losing.length/lowActivity.length*100).toFixed(0)}%), 平均 ${avg.toFixed(1)}%\n`);
  } else {
    console.log('无代币\n');
  }

  // 对比分析
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【对比分析】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const allAvg = dataset.reduce((a, t) => a + t.returnRate, 0) / dataset.length;
  const highAvg = highActivity.length > 0 ? highActivity.reduce((a, t) => a + t.returnRate, 0) / highActivity.length : 0;
  const lowAvg = lowActivity.length > 0 ? lowActivity.reduce((a, t) => a + t.returnRate, 0) / lowActivity.length : 0;

  console.log('条件'.padEnd(25) + '代币数'.padEnd(10) + '亏损数'.padEnd(10) + '亏损率'.padEnd(10) + '平均收益');
  console.log('-'.repeat(75));
  console.log(`所有代币`.padEnd(25) + `${dataset.length}`.padEnd(10) + `${dataset.filter(t => t.returnRate <= 0).length}`.padEnd(10) + `${(dataset.filter(t => t.returnRate <= 0).length/dataset.length*100).toFixed(0)}%`.padEnd(10) + `${allAvg.toFixed(1)}%`);
  console.log(`countPerMin >= 150`.padEnd(25) + `${highActivity.length}`.padEnd(10) + `${highActivity.filter(t => t.returnRate <= 0).length}`.padEnd(10) + highActivity.length > 0 ? `${(highActivity.filter(t => t.returnRate <= 0).length/highActivity.length*100).toFixed(0)}%`.padEnd(10) : 'N/A'.padEnd(10) + `${highAvg.toFixed(1)}%`);
  console.log(`countPerMin < 150`.padEnd(25) + `${lowActivity.length}`.padEnd(10) + `${lowActivity.filter(t => t.returnRate <= 0).length}`.padEnd(10) + `${(lowActivity.filter(t => t.returnRate <= 0).length/lowActivity.length*100).toFixed(0)}%`.padEnd(10) + `${lowAvg.toFixed(1)}%`);

  // 结论
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎯 结论');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (highActivity.length > 0) {
    const highLosingRate = highActivity.filter(t => t.returnRate <= 0).length / highActivity.length;
    const improvement = lowAvg - highAvg;

    if (highLosingRate > 0.7 && highAvg < 0) {
      console.log('✅ countPerMin >= 150 在这个实验中是危险信号');
      console.log(`   过滤后收益改善: ${improvement >= 0 ? '+' : ''}${improvement.toFixed(1)}%`);
    } else if (highLosingRate > 0.5) {
      console.log('⚠️  countPerMin >= 150 有一定风险');
      console.log(`   过滤后收益改善: ${improvement >= 0 ? '+' : ''}${improvement.toFixed(1)}%`);
    } else {
      console.log('❌ countPerMin >= 150 在这个实验中不是可靠信号');
      console.log(`   过滤后收益${improvement >= 0 ? '改善' : '下降'}: ${improvement >= 0 ? '+' : ''}${improvement.toFixed(1)}%`);
    }

    console.log('');
    console.log('【错失的盈利代币】');
    const missed = highActivity.filter(t => t.returnRate > 0);
    if (missed.length > 0) {
      missed.forEach(t => {
        console.log(`  ${t.symbol}: +${t.returnRate.toFixed(1)}%, countPerMin=${t.factors.countPerMin.toFixed(1)}`);
      });
    } else {
      console.log('  无');
    }
  } else {
    console.log('⚠️  这个实验中没有 countPerMin >= 150 的代币');
    console.log('   无法验证 countPerMin < 150 的过滤效果');
  }

  // 检查配置
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【实验配置】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const experimentConfig = signalsData.signals?.[0]?.metadata?.experimentConfig;
  if (experimentConfig) {
    console.log(`preBuyCheckCondition: ${experimentConfig.preBuyCheckCondition || '无'}`);
    console.log(`buyCondition: ${experimentConfig.buyCondition || '无'}`);
  }
}

main().catch(console.error);
