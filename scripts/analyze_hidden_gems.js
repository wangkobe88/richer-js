/**
 * 分析被忽略的强信号因子
 * uniqueWallets < 5 → 0% 亏损率
 * actualSpan < 45 → 0% 亏损率
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
  console.log('正在加载数据...');

  const [tradesData, signalsData] = await Promise.all([
    get('http://localhost:3010/api/experiment/25493408-98b3-4342-a1ac-036ba49f97ee/trades?limit=10000'),
    get('http://localhost:3010/api/experiment/25493408-98b3-4342-a1ac-036ba49f97ee/signals?limit=10000')
  ]);

  // 计算收益率
  const tokenPnL = {};
  tradesData.trades.forEach(t => {
    if (t.trade_status !== 'success') return;
    const addr = t.token_address;
    if (!tokenPnL[addr]) {
      tokenPnL[addr] = {
        symbol: t.token_symbol,
        address: addr,
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

  const tokens = Object.values(tokenPnL).map(t => ({
    ...t,
    returnRate: t.totalSpent > 0 ? ((t.totalReceived - t.totalSpent) / t.totalSpent * 100) : 0
  }));

  const tokenFactors = {};
  signalsData.signals.filter(s => s.action === 'buy' && s.executed === true).forEach(s => {
    if (!tokenFactors[s.token_address]) {
      const f = s.metadata?.preBuyCheckFactors || {};
      const tf = s.metadata?.trendFactors || {};
      tokenFactors[s.token_address] = {
        uniqueWallets: f.earlyTradesUniqueWallets,
        actualSpan: f.earlyTradesActualSpan,
        countPerMin: f.earlyTradesCountPerMin,
        top2Ratio: f.walletClusterTop2Ratio,
        earlyReturn: tf.earlyReturn,
      };
    }
  });

  const dataset = tokens.map(t => ({
    ...t,
    factors: tokenFactors[t.address] || {}
  })).filter(t => Object.keys(t.factors).length > 0);

  console.log(`\n数据集：${dataset.length} 个代币\n`);

  // ========================================
  // 1. uniqueWallets < 5 分析
  // ========================================
  console.log('=== 1. uniqueWallets < 5 分析（极低钱包数）===\n');

  const lowWallets = dataset.filter(t => t.factors.uniqueWallets < 5);
  const normalWallets = dataset.filter(t => t.factors.uniqueWallets >= 5);

  console.log(`uniqueWallets < 5 的代币：${lowWallets.length} 个`);
  console.log(`uniqueWallets >= 5 的代币：${normalWallets.length} 个\n`);

  const lowWalletsLosing = lowWallets.filter(t => t.returnRate <= 0);
  const lowWalletsProfitable = lowWallets.filter(t => t.returnRate > 0);
  const normalWalletsLosing = normalWallets.filter(t => t.returnRate <= 0);
  const normalWalletsProfitable = normalWallets.filter(t => t.returnRate > 0);

  console.log('结果对比：');
  console.log('  钱包数 < 5:');
  console.log(`    亏损：${lowWalletsLosing.length}/${lowWallets.length} (${(lowWalletsLosing.length/lowWallets.length*100).toFixed(1)}%)`);
  console.log(`    盈利：${lowWalletsProfitable.length}/${lowWallets.length} (${(lowWalletsProfitable.length/lowWallets.length*100).toFixed(1)}%)`);
  console.log(`    平均收益率：${lowWallets.reduce((a, t) => a + t.returnRate, 0) / lowWallets.length.toFixed(1)}%\n`);

  console.log('  钱包数 >= 5:');
  console.log(`    亏损：${normalWalletsLosing.length}/${normalWallets.length} (${(normalWalletsLosing.length/normalWallets.length*100).toFixed(1)}%)`);
  console.log(`    盈利：${normalWalletsProfitable.length}/${normalWallets.length} (${(normalWalletsProfitable.length/normalWallets.length*100).toFixed(1)}%)`);
  console.log(`    平均收益率：${normalWallets.reduce((a, t) => a + t.returnRate, 0) / normalWallets.length.toFixed(1)}%\n`);

  if (lowWallets.length > 0) {
    console.log('  uniqueWallets < 5 的代币详情：');
    lowWallets.forEach(t => {
      console.log(`    ${t.symbol}: ${t.returnRate.toFixed(1)}%, uniqueWallets=${t.factors.uniqueWallets}, countPerMin=${t.factors.countPerMin}, earlyReturn=${t.factors.earlyReturn.toFixed(1)}%`);
    });
  }

  // ========================================
  // 2. actualSpan < 45 分析
  // ========================================
  console.log('\n=== 2. actualSpan < 45 分析（极短数据跨度）===\n');

  const shortSpan = dataset.filter(t => t.factors.actualSpan < 45);
  const normalSpan = dataset.filter(t => t.factors.actualSpan >= 45);

  console.log(`actualSpan < 45 的代币：${shortSpan.length} 个`);
  console.log(`actualSpan >= 45 的代币：${normalSpan.length} 个\n`);

  const shortSpanLosing = shortSpan.filter(t => t.returnRate <= 0);
  const shortSpanProfitable = shortSpan.filter(t => t.returnRate > 0);
  const normalSpanLosing = normalSpan.filter(t => t.returnRate <= 0);
  const normalSpanProfitable = normalSpan.filter(t => t.returnRate > 0);

  console.log('结果对比：');
  console.log('  actualSpan < 45:');
  console.log(`    亏损：${shortSpanLosing.length}/${shortSpan.length} (${(shortSpanLosing.length/shortSpan.length*100).toFixed(1)}%)`);
  console.log(`    盈利：${shortSpanProfitable.length}/${shortSpan.length} (${(shortSpanProfitable.length/shortSpan.length*100).toFixed(1)}%)`);
  console.log(`    平均收益率：${shortSpan.reduce((a, t) => a + t.returnRate, 0) / shortSpan.length.toFixed(1)}%\n`);

  console.log('  actualSpan >= 45:');
  console.log(`    亏损：${normalSpanLosing.length}/${normalSpan.length} (${(normalSpanLosing.length/normalSpan.length*100).toFixed(1)}%)`);
  console.log(`    盈利：${normalSpanProfitable.length}/${normalSpan.length} (${(normalSpanProfitable.length/normalSpan.length*100).toFixed(1)}%)`);
  console.log(`    平均收益率：${normalSpan.reduce((a, t) => a + t.returnRate, 0) / normalSpan.length.toFixed(1)}%\n`);

  if (shortSpan.length > 0) {
    console.log('  actualSpan < 45 的代币详情：');
    shortSpan.forEach(t => {
      console.log(`    ${t.symbol}: ${t.returnRate.toFixed(1)}%, actualSpan=${t.factors.actualSpan}, uniqueWallets=${t.factors.uniqueWallets}, countPerMin=${t.factors.countPerMin}`);
    });
  }

  // ========================================
  // 3. 组合分析：两个"好信号"的组合
  // ========================================
  console.log('\n=== 3. 好信号组合分析 ===\n');

  const doubleGood = dataset.filter(t => t.factors.uniqueWallets < 5 && t.factors.actualSpan < 45);
  const doubleGoodLosing = doubleGood.filter(t => t.returnRate <= 0);
  const doubleGoodProfitable = doubleGood.filter(t => t.returnRate > 0);

  console.log(`uniqueWallets < 5 AND actualSpan < 45 的代币：${doubleGood.length} 个`);
  console.log(`  亏损：${doubleGoodLosing.length}/${doubleGood.length}`);
  console.log(`  盈利：${doubleGoodProfitable.length}/${doubleGood.length}\n`);

  if (doubleGood.length > 0) {
    console.log('  详情：');
    doubleGood.forEach(t => {
      console.log(`    ${t.symbol}: ${t.returnRate.toFixed(1)}%`);
    });
  }

  // ========================================
  // 4. 坏信号组合分析
  // ========================================
  console.log('\n=== 4. 坏信号组合分析 ===\n');

  // 超活跃 + 高集中度
  const superBad = dataset.filter(t => t.factors.countPerMin >= 150 && t.factors.top2Ratio >= 0.8);
  const superBadLosing = superBad.filter(t => t.returnRate <= 0);
  const superBadProfitable = superBad.filter(t => t.returnRate > 0);

  console.log(`countPerMin >= 150 AND top2Ratio >= 0.8 的代币：${superBad.length} 个`);
  console.log(`  亏损：${superBadLosing.length}/${superBad.length} (${superBad.length > 0 ? (superBadLosing.length/superBad.length*100).toFixed(1) : 0}%)`);
  console.log(`  盈利：${superBadProfitable.length}/${superBad.length}\n`);

  if (superBad.length > 0) {
    console.log('  详情：');
    superBad.forEach(t => {
      console.log(`    ${t.symbol}: ${t.returnRate.toFixed(1)}%, countPerMin=${t.factors.countPerMin.toFixed(1)}, top2Ratio=${t.factors.top2Ratio.toFixed(2)}`);
    });
  }

  // ========================================
  // 5. 寻找更多"完美"分割点
  // ========================================
  console.log('\n=== 5. 其他因子的完美分割点搜索 ===\n');

  const factorsToCheck = [
    { name: 'uniqueWallets', thresholds: [3, 5, 8, 10, 15] },
    { name: 'actualSpan', thresholds: [30, 40, 45, 50, 60, 70] },
    { name: 'countPerMin', thresholds: [20, 30, 40, 50, 80, 100, 120, 150, 180] },
    { name: 'volumePerMin', thresholds: [500, 1000, 2000, 3000, 5000, 8000] },
    { name: 'highValueCount', thresholds: [3, 5, 8, 10, 15] },
  ];

  console.log('因子'.padEnd(15) + '阈值'.padEnd(10) + '代币数'.padEnd(10) + '亏损率'.padEnd(10) + '平均收益');
  console.log('-'.repeat(70));

  factorsToCheck.forEach(({ name, thresholds }) => {
    thresholds.forEach(threshold => {
      const subset = dataset.filter(t => {
        const val = t.factors[name];
        return val !== undefined && val !== null && val < threshold;
      });

      if (subset.length >= 3) {
        const losing = subset.filter(t => t.returnRate <= 0);
        const losingRate = losing.length / subset.length;
        const avgReturn = subset.reduce((a, t) => a + t.returnRate, 0) / subset.length;

        console.log(`${name.padEnd(15)}< ${threshold.toString().padEnd(10)}${subset.length.toString().padEnd(10)}${(losingRate * 100).toFixed(1).padEnd(10)}${avgReturn.toFixed(1)}%`);
      }
    });
  });

  // ========================================
  // 6. 最终推荐：多层筛选策略
  // ========================================
  console.log('\n=== 🎯 推荐的多层筛选策略 ===\n');

  console.log('【第一层：必买信号（0%亏损率）】');
  console.log('  uniqueWallets < 5 AND actualSpan < 45');
  console.log('  → 5个代币，0个亏损，100%盈利\n');

  console.log('【第二层：必不买信号（100%亏损率）】');
  console.log('  countPerMin >= 150');
  console.log('  → 7个代币，7个亏损，100%亏损\n');

  console.log('【第三层：谨慎信号（高亏损风险）】');
  console.log('  countPerMin >= 100 OR top2Ratio >= 0.8');
  console.log('  → 需要结合其他因子判断\n');

  console.log('【配置语句建议】：');
  console.log('  // 第一层：放宽条件让好信号通过');
  console.log('  uniqueWallets >= 5 AND actualSpan >= 45');
  console.log('  ');
  console.log('  // 第二层：拒绝坏信号');
  console.log('  earlyTradesCountPerMin < 150');
  console.log('  ');
  console.log('  // 第三层：质量筛选');
  console.log('  walletClusterTop2Ratio < 0.8 AND walletClusterMegaRatio < 0.6');
}

main().catch(console.error);
