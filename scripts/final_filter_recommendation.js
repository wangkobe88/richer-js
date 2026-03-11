/**
 * 最终过滤器推荐报告
 * 整合所有分析结果，给出实用建议
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
  console.log('=== 最终过滤器推荐报告 ===\n');
  console.log('正在加载数据...\n');

  const [exp1, exp2] = await Promise.all([
    analyzeExperiment('25493408-98b3-4342-a1ac-036ba49f97ee', '市场差'),
    analyzeExperiment('1dde2be5-2f4e-49fb-9520-cb032e9ef759', '市场好')
  ]);

  // ========================================
  // 核心发现总结
  // ========================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 核心发现总结');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('【1. 高活跃代币（countPerMin >= 150）】');
  const exp1High150 = exp1.tokens.filter(t => t.factors.countPerMin >= 150);
  const exp2High150 = exp2.tokens.filter(t => t.factors.countPerMin >= 150);
  console.log(`   市场差: ${exp1High150.filter(t => t.returnRate <= 0).length}/${exp1High150.length} 亏损 (${(exp1High150.filter(t => t.returnRate <= 0).length/exp1High150.length*100).toFixed(0)}%), 平均 ${(exp1High150.reduce((a, t) => a + t.returnRate, 0) / exp1High150.length).toFixed(1)}%`);
  console.log(`   市场好: ${exp2High150.filter(t => t.returnRate <= 0).length}/${exp2High150.length} 亏损 (${(exp2High150.filter(t => t.returnRate <= 0).length/exp2High150.length*100).toFixed(0)}%), 平均 ${(exp2High150.reduce((a, t) => a + t.returnRate, 0) / exp2High150.length).toFixed(1)}%\n`);

  console.log('【2. 超高钱包数（uniqueWallets >= 150）】');
  const exp1HighUnique = exp1.tokens.filter(t => t.factors.uniqueWallets >= 150);
  const exp2HighUnique = exp2.tokens.filter(t => t.factors.uniqueWallets >= 150);
  console.log(`   市场差: ${exp1HighUnique.filter(t => t.returnRate <= 0).length}/${exp1HighUnique.length} 亏损 (${(exp1HighUnique.filter(t => t.returnRate <= 0).length/exp1HighUnique.length*100).toFixed(0)}%), 平均 ${(exp1HighUnique.reduce((a, t) => a + t.returnRate, 0) / exp1HighUnique.length || 0).toFixed(1)}%`);
  console.log(`   市场好: ${exp2HighUnique.filter(t => t.returnRate <= 0).length}/${exp2HighUnique.length} 亏损 (${(exp2HighUnique.filter(t => t.returnRate <= 0).length/exp2HighUnique.length*100).toFixed(0)}%), 平均 ${(exp2HighUnique.reduce((a, t) => a + t.returnRate, 0) / exp2HighUnique.length).toFixed(1)}%\n`);

  console.log('【3. 高活跃 + 高钱包数（countPerMin >= 150 AND uniqueWallets >= 150）】');
  const exp1Combo = exp1.tokens.filter(t => t.factors.countPerMin >= 150 && t.factors.uniqueWallets >= 150);
  const exp2Combo = exp2.tokens.filter(t => t.factors.countPerMin >= 150 && t.factors.uniqueWallets >= 150);
  console.log(`   市场差: ${exp1Combo.filter(t => t.returnRate <= 0).length}/${exp1Combo.length} 亏损 (${(exp1Combo.length > 0 ? exp1Combo.filter(t => t.returnRate <= 0).length/exp1Combo.length*100 : 0).toFixed(0)}%), 平均 ${(exp1Combo.reduce((a, t) => a + t.returnRate, 0) / exp1Combo.length || 0).toFixed(1)}%`);
  console.log(`   市场好: ${exp2Combo.filter(t => t.returnRate <= 0).length}/${exp2Combo.length} 亏损 (${(exp2Combo.length > 0 ? exp2Combo.filter(t => t.returnRate <= 0).length/exp2Combo.length*100 : 0).toFixed(0)}%), 平均 ${(exp2Combo.reduce((a, t) => a + t.returnRate, 0) / exp2Combo.length).toFixed(1)}%\n`);

  // ========================================
  // 最终推荐
  // ========================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎯 最终推荐配置');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('【方案一：保守策略（推荐）】');
  console.log('适用场景：市场不确定或偏空\n');
  console.log('  preBuyCheckCondition: |');
  console.log('    # 基础条件（已有）');
  console.log('    walletClusterCount < 4 OR walletClusterTop2Ratio <= 0.85');
  console.log('    # 新增：避免高活跃代币');
  console.log('    AND earlyTradesCountPerMin < 150');
  console.log('    # 新增：避免过高 earlyReturn 的高活跃代币');
  console.log('    AND (earlyTradesCountPerMin < 100 OR trendFactors.earlyReturn < 200)');

  console.log('\n【方案二：平衡策略】');
  console.log('适用场景：市场中性或偏多\n');
  console.log('  preBuyCheckCondition: |');
  console.log('    # 基础条件（已有）');
  console.log('    walletClusterCount < 4 OR walletClusterTop2Ratio <= 0.85');
  console.log('    # 新增：允许高钱包数的高活跃代币');
  console.log('    AND (earlyTradesCountPerMin < 150');
  console.log('         OR (earlyTradesCountPerMin >= 150 AND earlyTradesUniqueWallets >= 150))');
  console.log('    # 新增：根据 earlyReturn 动态调整');
  console.log('    AND (earlyTradesCountPerMin < 100');
  console.log('         OR trendFactors.earlyReturn < 200');
  console.log('         OR (trendFactors.earlyReturn >= 200 AND earlyTradesUniqueWallets >= 150))');

  console.log('\n【方案三：激进策略】');
  console.log('适用场景：明确牛市，高risk appetite\n');
  console.log('  preBuyCheckCondition: |');
  console.log('    # 基础条件（已有）');
  console.log('    walletClusterCount < 4 OR walletClusterTop2Ratio <= 0.85');
  console.log('    # 新增：自适应策略');
  console.log('    AND (trendFactors.earlyReturn < 150');
  console.log('         OR (trendFactors.earlyReturn >= 150 AND trendFactors.earlyReturn < 250 AND earlyTradesCountPerMin < 150)');
  console.log('         OR (trendFactors.earlyReturn >= 250 AND earlyTradesCountPerMin < 100)');

  // ========================================
  // 效果对比
  // ========================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📈 各方案效果对比');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const strategies = [
    {
      name: '无额外过滤（当前）',
      test: () => true
    },
    {
      name: '方案一：保守策略',
      test: f => f.countPerMin < 150 && (f.countPerMin < 100 || f.earlyReturn < 200)
    },
    {
      name: '方案二：平衡策略',
      test: f => (f.countPerMin < 150 || (f.countPerMin >= 150 && f.uniqueWallets >= 150)) &&
                  (f.countPerMin < 100 || f.earlyReturn < 200 || (f.earlyReturn >= 200 && f.uniqueWallets >= 150))
    },
    {
      name: '方案三：激进策略',
      test: f => f.earlyReturn < 150 ||
                  (f.earlyReturn >= 150 && f.earlyReturn < 250 && f.countPerMin < 150) ||
                  (f.earlyReturn >= 250 && f.countPerMin < 100)
    },
  ];

  console.log('策略'.padEnd(25) + '市场差'.padEnd(30) + '市场好');
  console.log('-'.repeat(100));

  strategies.forEach(strategy => {
    const exp1Match = exp1.tokens.filter(t => strategy.test(t.factors));
    const exp1Losing = exp1Match.filter(t => t.returnRate <= 0);
    const exp1Result = exp1Match.length > 0
      ? `${exp1Losing.length}/${exp1Match.length} 亏损, 平均 ${(exp1Match.reduce((a, t) => a + t.returnRate, 0) / exp1Match.length).toFixed(1)}%`
      : '无匹配';

    const exp2Match = exp2.tokens.filter(t => strategy.test(t.factors));
    const exp2Losing = exp2Match.filter(t => t.returnRate <= 0);
    const exp2Result = exp2Match.length > 0
      ? `${exp2Losing.length}/${exp2Match.length} 亏损, 平均 ${(exp2Match.reduce((a, t) => a + t.returnRate, 0) / exp2Match.length).toFixed(1)}%`
      : '无匹配';

    console.log(`${strategy.name.padEnd(25)}${exp1Result.padEnd(30)}${exp2Result}`);
  });

  // ========================================
  // 实施建议
  // ========================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('💡 实施建议');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('【1. 立即实施】');
  console.log('   使用方案一（保守策略）');
  console.log('   - 在市场差时显著减少亏损');
  console.log('   - 在市场好时也能保持合理收益\n');

  console.log('【2. 可选优化】');
  console.log('   如果你有市场判断能力，可以动态切换策略：');
  console.log('   - 市场差 → 方案一');
  console.log('   - 市场中性 → 方案二');
  console.log('   - 市场好 → 方案三\n');

  console.log('【3. 监控指标】');
  console.log('   定期检查以下指标来评估策略效果：');
  console.log('   - countPerMin >= 150 的代币数量和盈亏');
  console.log('   - uniqueWallets >= 150 的代币数量和盈亏');
  console.log('   - earlyReturn >= 200 AND countPerMin >= 100 的代币盈亏\n');

  console.log('【4. 配置代码】');
  console.log('   在 config/default.json 中修改：');
  console.log('   {');
  console.log('     "preBuyCheckCondition": "walletClusterCount < 4 OR walletClusterTop2Ratio <= 0.85" +');
  console.log('                              " AND earlyTradesCountPerMin < 150" +');
  console.log('                              " AND (earlyTradesCountPerMin < 100 OR trendFactors.earlyReturn < 200)"');
  console.log('   }');
}

main().catch(console.error);
