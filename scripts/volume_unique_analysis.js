/**
 * 分析 volumePerMin 和 uniqueWallets 的组合效果
 * 特别关注高活跃代币在市场好时如何盈利
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

async function analyzeExperiment(experimentId, label) {
  const [tradesData, signalsData] = await Promise.all([
    get(`http://localhost:3010/api/experiment/${experimentId}/trades?limit=10000`),
    get(`http://localhost:3010/api/experiment/${experimentId}/signals?limit=10000`)
  ]);

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
        countPerMin: f.earlyTradesCountPerMin,
        top2Ratio: f.walletClusterTop2Ratio,
        uniqueWallets: f.earlyTradesUniqueWallets,
        highValueCount: f.earlyTradesHighValueCount,
        volumePerMin: f.earlyTradesVolumePerMin,
        earlyReturn: tf.earlyReturn,
      };
    }
  });

  return {
    label,
    tokens: tokens.map(t => ({
      ...t,
      factors: tokenFactors[t.address] || {}
    })).filter(t => Object.keys(t.factors).length > 0)
  };
}

async function main() {
  console.log('正在加载数据...\n');

  const [exp1, exp2] = await Promise.all([
    analyzeExperiment('25493408-98b3-4342-a1ac-036ba49f97ee', '市场差'),
    analyzeExperiment('1dde2be5-2f4e-49fb-9520-cb032e9ef759', '市场好')
  ]);

  console.log('市场差：', exp1.tokens.length, '个代币');
  console.log('市场好：', exp2.tokens.length, '个代币\n');

  // ========================================
  // 1. 分析 volumePerMin 和 uniqueWallets 的关系
  // ========================================
  console.log('=== 1. volumePerMin 和 uniqueWallets 的组合分析 ===\n');

  const volumeRanges = [
    { min: 0, max: 5000, label: '< 5000' },
    { min: 5000, max: 10000, label: '5000-10000' },
    { min: 10000, max: 15000, label: '10000-15000' },
    { min: 15000, max: 20000, label: '15000-20000' },
    { min: 20000, label: '>= 20000' },
  ];

  const uniqueRanges = [
    { min: 0, max: 50, label: '< 50' },
    { min: 50, max: 100, label: '50-100' },
    { min: 100, max: 150, label: '100-150' },
    { min: 150, label: '>= 150' },
  ];

  // 对高活跃代币（countPerMin >= 100）进行细分
  [exp1, exp2].forEach(exp => {
    console.log(`--- ${exp.label}市场：countPerMin >= 100 的代币 ---\n`);

    const highActivity = exp.tokens.filter(t => t.factors.countPerMin >= 100);
    console.log(`共 ${highActivity.length} 个代币\n`);

    console.log('volumePerMin 范围'.padEnd(15) + '代币数'.padEnd(10) + '盈利数'.padEnd(10) + '亏损率'.padEnd(10) + '平均收益');
    console.log('-'.repeat(70));

    volumeRanges.forEach(({ min, max, label }) => {
      const subset = highActivity.filter(t => {
        const v = t.factors.volumePerMin;
        if (v === undefined) return false;
        if (max !== undefined) return v >= min && v < max;
        return v >= min;
      });

      if (subset.length > 0) {
        const losing = subset.filter(t => t.returnRate <= 0);
        const avgReturn = subset.reduce((a, t) => a + t.returnRate, 0) / subset.length;
        console.log(`${label.padEnd(15)}${subset.length.toString().padEnd(10)}${(subset.length - losing.length).toString().padEnd(10)}${(losing.length/subset.length*100).toFixed(0).padEnd(10)}${avgReturn.toFixed(1)}%`);
      }
    });

    console.log('\nuniqueWallets 范围'.padEnd(15) + '代币数'.padEnd(10) + '盈利数'.padEnd(10) + '亏损率'.padEnd(10) + '平均收益');
    console.log('-'.repeat(70));

    uniqueRanges.forEach(({ min, max, label }) => {
      const subset = highActivity.filter(t => {
        const v = t.factors.uniqueWallets;
        if (v === undefined) return false;
        if (max !== undefined) return v >= min && v < max;
        return v >= min;
      });

      if (subset.length > 0) {
        const losing = subset.filter(t => t.returnRate <= 0);
        const avgReturn = subset.reduce((a, t) => a + t.returnRate, 0) / subset.length;
        console.log(`${label.padEnd(15)}${subset.length.toString().padEnd(10)}${(subset.length - losing.length).toString().padEnd(10)}${(losing.length/subset.length*100).toFixed(0).padEnd(10)}${avgReturn.toFixed(1)}%`);
      }
    });

    console.log('\n');
  });

  // ========================================
  // 2. 分析 CMO 和 Dude 的特征
  // ========================================
  console.log('=== 2. CMO 和 Dude 的特征分析 ===\n');

  const cmo = exp2.tokens.find(t => t.symbol === 'CMO');
  const dude = exp2.tokens.find(t => t.symbol === 'Dude');

  console.log('CMO (盈利 +6.2%):');
  console.log(`  countPerMin: ${cmo.factors.countPerMin.toFixed(1)}`);
  console.log(`  volumePerMin: ${cmo.factors.volumePerMin.toFixed(0)} ⬅️ 最高`);
  console.log(`  uniqueWallets: ${cmo.factors.uniqueWallets}`);
  console.log(`  earlyReturn: ${cmo.factors.earlyReturn.toFixed(1)}%`);
  console.log(`  highValueCount: ${cmo.factors.highValueCount}\n`);

  console.log('Dude (盈利 +241.8%):');
  console.log(`  countPerMin: ${dude.factors.countPerMin.toFixed(1)}`);
  console.log(`  volumePerMin: ${dude.factors.volumePerMin.toFixed(0)}`);
  console.log(`  uniqueWallets: ${dude.factors.uniqueWallets} ⬅️ 最高之一`);
  console.log(`  earlyReturn: ${dude.factors.earlyReturn.toFixed(1)}% ⬅️ 相对较低`);
  console.log(`  highValueCount: ${dude.factors.highValueCount}\n`);

  // ========================================
  // 3. 测试组合规则
  // ========================================
  console.log('=== 3. 测试 volumePerMin + uniqueWallets 组合规则 ===\n');

  const combinedRules = [
    {
      name: 'countPerMin >= 150 AND volumePerMin >= 20000',
      test: f => f.countPerMin >= 150 && f.volumePerMin >= 20000
    },
    {
      name: 'countPerMin >= 150 AND uniqueWallets >= 150',
      test: f => f.countPerMin >= 150 && f.uniqueWallets >= 150
    },
    {
      name: 'countPerMin >= 150 AND (volumePerMin >= 20000 OR uniqueWallets >= 150)',
      test: f => f.countPerMin >= 150 && (f.volumePerMin >= 20000 || f.uniqueWallets >= 150)
    },
    {
      name: 'countPerMin >= 150 AND volumePerMin >= 18000 AND uniqueWallets >= 150',
      test: f => f.countPerMin >= 150 && f.volumePerMin >= 18000 && f.uniqueWallets >= 150
    },
    {
      name: 'earlyReturn >= 150 AND countPerMin >= 150 AND volumePerMin >= 18000',
      test: f => f.earlyReturn >= 150 && f.countPerMin >= 150 && f.volumePerMin >= 18000
    },
  ];

  console.log('规则'.padEnd(70) + '市场差'.padEnd(25) + '市场好');
  console.log('-'.repeat(110));

  combinedRules.forEach(rule => {
    const exp1Match = exp1.tokens.filter(t => rule.test(t.factors));
    const exp1Losing = exp1Match.filter(t => t.returnRate <= 0);
    const exp1Result = exp1Match.length > 0
      ? `${exp1Losing.length}/${exp1Match.length} 亏损, 平均 ${exp1Match.reduce((a, t) => a + t.returnRate, 0) / exp1Match.length.toFixed(1)}%`
      : '无匹配';

    const exp2Match = exp2.tokens.filter(t => rule.test(t.factors));
    const exp2Losing = exp2Match.filter(t => t.returnRate <= 0);
    const exp2Result = exp2Match.length > 0
      ? `${exp2Losing.length}/${exp2Match.length} 亏损, 平均 ${exp2Match.reduce((a, t) => a + t.returnRate, 0) / exp2Match.length.toFixed(1)}%`
      : '无匹配';

    if (exp1Match.length > 0 || exp2Match.length > 0) {
      console.log(`${rule.name.padEnd(70)}${exp1Result.padEnd(25)}${exp2Result}`);
    }
  });

  // ========================================
  // 4. 最终洞察
  // ========================================
  console.log('\n=== 🎯 最终洞察 ===\n');

  console.log('【高活跃代币在市场好时能盈利的条件】');
  console.log('1. volumePerMin >= 20000（极高的交易量）');
  console.log('2. OR uniqueWallets >= 150（极多的独立钱包）');
  console.log('3. 特别是当 earlyReturn 相对较低（< 200%）时\n');

  console.log('【市场自适应策略建议】');
  console.log('// 基础条件（避免高风险）');
  console.log('countPerMin < 150');
  console.log('OR (countPerMin >= 150 AND volumePerMin >= 20000)');
  console.log('OR (countPerMin >= 150 AND uniqueWallets >= 150)');
  console.log('');
  console.log('// 结合 earlyReturn 的完整策略');
  console.log('IF earlyReturn < 150:');
  console.log('  countPerMin 无限制（低风险）');
  console.log('ELSE IF earlyReturn < 300:');
  console.log('  countPerMin < 150');
  console.log('  OR (countPerMin >= 150 AND volumePerMin >= 20000)');
  console.log('ELSE:');
  console.log('  countPerMin < 100（高风险区域）');
}

main().catch(console.error);
