/**
 * 深度分析：识别"拉盘砸盘"的早期交易模式
 * 既然早期交易因子在回测模式下也是可靠的，那就深入挖掘其特征
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function deepAnalyzeEarlyTradePatterns() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    深度分析：识别"拉盘砸盘"模式                               ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取交易信号
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .order('created_at', { ascending: true });

  // 计算收益并合并数据
  const tokenProfits = new Map();
  const tokenTradeGroups = new Map();
  trades.forEach(trade => {
    if (!tokenTradeGroups.has(trade.token_address)) {
      tokenTradeGroups.set(trade.token_address, []);
    }
    tokenTradeGroups.get(trade.token_address).push(trade);
  });

  for (const [addr, tokenTrades] of tokenTradeGroups) {
    tokenTrades.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const buyTrades = tokenTrades.filter(t => t.trade_direction === 'buy');
    const sellTrades = tokenTrades.filter(t => t.trade_direction === 'sell');

    if (buyTrades.length === 0) continue;

    let totalBuy = 0, totalSell = 0;
    buyTrades.forEach(t => totalBuy += t.input_amount || 0);
    sellTrades.forEach(t => totalSell += t.output_amount || 0);

    const profit = totalSell - totalBuy;
    const profitPercent = (profit / totalBuy) * 100;

    const trendFactors = buyTrades[0]?.metadata?.factors?.trendFactors || {};

    tokenProfits.set(addr, {
      profitPercent,
      profit,
      symbol: buyTrades[0].token_symbol,
      age: trendFactors.age || 0,
      trendRiseRatio: trendFactors.trendRiseRatio || 0,
      trendCV: trendFactors.trendCV || 0,
      earlyReturn: trendFactors.earlyReturn || 0
    });
  }

  // 分析通过预检查的代币的早期交易特征
  const passedSignals = signals.filter(s =>
    s.metadata?.execution_status !== 'failed'
  );

  const tokens = [];
  passedSignals.forEach(signal => {
    const profit = tokenProfits.get(signal.token_address);
    if (!profit) return;

    const preBuyFactors = signal.metadata?.preBuyCheckFactors || {};

    tokens.push({
      symbol: profit.symbol,
      addr: signal.token_address,
      profitPercent: profit.profitPercent,
      age: profit.age,
      trendRiseRatio: profit.trendRiseRatio,
      trendCV: profit.trendCV,
      earlyReturn: profit.earlyReturn,

      // 早期交易因子
      earlyTradesTotalCount: preBuyFactors.earlyTradesTotalCount || 0,
      earlyTradesCountPerMin: preBuyFactors.earlyTradesCountPerMin || 0,
      earlyTradesVolumePerMin: preBuyFactors.earlyTradesVolumePerMin || 0,
      earlyTradesWalletsPerMin: preBuyFactors.earlyTradesWalletsPerMin || 0,
      earlyTradesHighValueCount: preBuyFactors.earlyTradesHighValueCount || 0,
      earlyTradesHighValuePerMin: preBuyFactors.earlyTradesHighValuePerMin || 0,
      earlyTradesUniqueWallets: preBuyFactors.earlyTradesUniqueWallets || 0,
      earlyTradesFilteredCount: preBuyFactors.earlyTradesFilteredCount || 0,
      earlyTradesDataCoverage: preBuyFactors.earlyTradesDataCoverage || 0,
      earlyTradesActualSpan: preBuyFactors.earlyTradesActualSpan || 0,
      earlyTradesRateCalcWindow: preBuyFactors.earlyTradesRateCalcWindow || 0
    });
  });

  const profitable = tokens.filter(t => t.profitPercent > 0);
  const loss = tokens.filter(t => t.profitPercent <= 0);

  // 计算一些衍生指标
  const enrichedTokens = tokens.map(t => {
    // 交易集中度 = 总交易数 / 唯一钱包数
    const tradeConcentration = t.earlyTradesUniqueWallets > 0
      ? t.earlyTradesTotalCount / t.earlyTradesUniqueWallets
      : 0;

    // 高价值交易占比 = 高价值交易数 / 总交易数
    const highValueRatio = t.earlyTradesTotalCount > 0
      ? t.earlyTradesHighValueCount / t.earlyTradesTotalCount
      : 0;

    // 交易强度 = 每分钟交易数 * 每分钟钱包数
    const tradeIntensity = t.earlyTradesCountPerMin * t.earlyTradesWalletsPerMin;

    return {
      ...t,
      tradeConcentration,
      highValueRatio,
      tradeIntensity
    };
  });

  console.log('【亏损代币的早期交易模式分析】\n');
  console.log('代币          收益%    eTr/Min  eWal/Min  eUniq  集中度  高价值%  强度    Age    CV    分析');
  console.log('─'.repeat(105));

  const lossEnriched = enrichedTokens.filter(t => t.profitPercent <= 0);
  lossEnriched.forEach(t => {
    const profitStr = t.profitPercent.toFixed(2).padStart(7);
    const eCntStr = t.earlyTradesCountPerMin.toFixed(1).padStart(7);
    const eWalStr = t.earlyTradesWalletsPerMin.toFixed(1).padStart(8);
    const eUniStr = t.earlyTradesUniqueWallets.toString().padStart(6);
    const concStr = t.tradeConcentration.toFixed(1).padStart(7);
    const hvStr = (t.highValueRatio * 100).toFixed(1).padStart(7);
    const intStr = t.tradeIntensity.toFixed(0).padStart(6);
    const ageStr = t.age.toFixed(1).padStart(5);
    const cvStr = t.trendCV.toFixed(3).padStart(5);

    // 识别可疑模式
    const patterns = [];
    if (t.tradeConcentration > 3) patterns.push('🚨集中度高');
    if (t.highValueRatio < 0.3 && t.earlyTradesTotalCount > 50) patterns.push('💧高价值少');
    if (t.earlyTradesWalletsPerMin > 80 && t.profitPercent < -10) patterns.push('⚠️超活跃亏损');
    if (t.age > 3) patterns.push('⏰Age大');
    if (t.trendCV < 0.2) patterns.push('📉CV低');

    const patternStr = patterns.join(' ');

    console.log(`${t.symbol.padEnd(12)} ${profitStr}% ${eCntStr} ${eWalStr} ${eUniStr} ${concStr} ${hvStr} ${intStr} ${ageStr}m ${cvStr}  ${patternStr}`);
  });

  console.log('');
  console.log('');

  // 对比分析
  console.log('【盈利 vs 亏损：衍生指标对比】\n');
  console.log('指标                              盈利平均    亏损平均    差异      分析');
  console.log('─'.repeat(85));

  const derivedFactors = [
    { key: 'tradeConcentration', name: '交易集中度', highBad: true },
    { key: 'highValueRatio', name: '高价值交易占比', highBad: true },
    { key: 'tradeIntensity', name: '交易强度', highBad: false },
    { key: 'earlyTradesCountPerMin', name: '每分钟交易数', highBad: false },
    { key: 'earlyTradesWalletsPerMin', name: '每分钟钱包数', highBad: false },
    { key: 'earlyTradesHighValuePerMin', name: '高价值交易/分钟', highBad: false }
  ];

  const profitEnriched = enrichedTokens.filter(t => t.profitPercent > 0);

  derivedFactors.forEach(({ key, name, highBad }) => {
    const profitAvg = profitEnriched.length > 0
      ? profitEnriched.reduce((sum, t) => sum + (t[key] || 0), 0) / profitEnriched.length
      : 0;
    const lossAvg = lossEnriched.length > 0
      ? lossEnriched.reduce((sum, t) => sum + (t[key] || 0), 0) / lossEnriched.length
      : 0;
    const diff = profitAvg - lossAvg;
    const diffPercent = lossAvg !== 0 ? (diff / lossAvg * 100) : 0;

    let analysis = '';
    if (highBad && lossAvg > profitAvg * 1.2) {
      analysis = `⚠️ 亏损代币${name}偏高 ${(lossAvg / profitAvg).toFixed(1)}x`;
    } else if (!highBad && lossAvg < profitAvg * 0.8) {
      analysis = `⚠️ 亏损代币${name}偏低 ${(profitAvg / lossAvg).toFixed(1)}x`;
    }

    console.log(`${name.padEnd(34)} ${profitAvg.toFixed(2).padStart(10)} ${lossAvg.toFixed(2).padStart(10)} ${diff.toFixed(2).padStart(8)}  ${analysis}`);
  });

  console.log('');
  console.log('');

  // 寻找"拉盘砸盘"特征模式
  console.log('【识别"拉盘砸盘"的特征模式】\n');

  // 模式1: 超活跃但亏损（可能是拉盘后砸盘）
  const hyperActiveLoss = lossEnriched.filter(t =>
    t.earlyTradesWalletsPerMin > 50 &&
    t.profitPercent < -10
  );

  if (hyperActiveLoss.length > 0) {
    console.log(`模式1: 超活跃但亏损 (${hyperActiveLoss.length}个)\n`);
    console.log('  这些代币交易非常活跃，但仍然大幅亏损：');
    hyperActiveLoss.forEach(t => {
      console.log(`    ${t.symbol}: 每分钟${t.earlyTradesWalletsPerMin.toFixed(1)}个钱包, 亏损${t.profitPercent.toFixed(2)}%`);
      console.log(`      交易集中度: ${t.tradeConcentration.toFixed(1)}, 高价值占比: ${(t.highValueRatio * 100).toFixed(1)}%`);
    });
    console.log('');
  }

  // 模式2: 交易集中度高
  const highConcentration = lossEnriched.filter(t => t.tradeConcentration > 3);

  if (highConcentration.length > 0) {
    console.log(`模式2: 交易集中度高 (${highConcentration.length}个)\n`);
    console.log('  这些代币的平均每个钱包交易次数很高，可能是有大户控盘：');
    highConcentration.forEach(t => {
      console.log(`    ${t.symbol}: 集中度${t.tradeConcentration.toFixed(1)}, 总交易${t.earlyTradesTotalCount}, 唯一钱包${t.earlyTradesUniqueWallets}`);
    });
    console.log('');
  }

  // 模式3: 高价值交易占比低
  const lowHighValueRatio = lossEnriched.filter(t =>
    t.highValueRatio < 0.3 &&
    t.earlyTradesTotalCount > 50
  );

  if (lowHighValueRatio.length > 0) {
    console.log(`模式3: 高价值交易占比低 (${lowHighValueRatio.length}个)\n`);
    console.log('  这些代币交易量大，但高价值交易占比低，可能是散户交易：');
    lowHighValueRatio.forEach(t => {
      console.log(`    ${t.symbol}: 高价值占比${(t.highValueRatio * 100).toFixed(1)}%, 亏损${t.profitPercent.toFixed(2)}%`);
    });
    console.log('');
  }

  // 综合判断：哪些是"拉盘砸盘"候选
  console.log('【"拉盘砸盘"候选识别】\n');

  const pumpAndDumpCandidates = [];

  lossEnriched.forEach(t => {
    let score = 0;
    let reasons = [];

    // 特征1: 超活跃但亏损
    if (t.earlyTradesWalletsPerMin > 50 && t.profitPercent < -10) {
      score += 3;
      reasons.push('超活跃亏损');
    }

    // 特征2: 交易集中度高
    if (t.tradeConcentration > 4) {
      score += 2;
      reasons.push(`集中度高(${t.tradeConcentration.toFixed(1)})`);
    }

    // 特征3: 高价值交易占比低
    if (t.highValueRatio < 0.2 && t.earlyTradesTotalCount > 50) {
      score += 2;
      reasons.push(`高价值少(${(t.highValueRatio * 100).toFixed(0)}%)`);
    }

    // 特征4: 结合常规因子
    if (t.trendCV < 0.2) {
      score += 1;
      reasons.push(`CV低(${t.trendCV.toFixed(3)})`);
    }

    if (t.age > 3) {
      score += 1;
      reasons.push(`Age大(${t.age.toFixed(1)})`);
    }

    if (score >= 4) {
      pumpAndDumpCandidates.push({
        symbol: t.symbol,
        score,
        reasons,
        earlyTradesWalletsPerMin: t.earlyTradesWalletsPerMin,
        tradeConcentration: t.tradeConcentration,
        highValueRatio: t.highValueRatio,
        profitPercent: t.profitPercent
      });
    }
  });

  if (pumpAndDumpCandidates.length > 0) {
    console.log(`发现 ${pumpAndDumpCandidates.length} 个"拉盘砸盘"候选:\n`);
    pumpAndDumpCandidates.sort((a, b) => b.score - a.score).forEach((c, i) => {
      console.log(`${i + 1}. ${c.symbol} (得分: ${c.score})`);
      console.log(`   特征: ${c.reasons.join(', ')}`);
      console.log(`   每分钟钱包: ${c.earlyTradesWalletsPerMin.toFixed(1)}, 集中度: ${c.tradeConcentration.toFixed(1)}, 高价值占比: ${(c.highValueRatio * 100).toFixed(1)}%`);
      console.log(`   收益: ${c.profitPercent.toFixed(2)}%`);
      console.log('');
    });
  } else {
    console.log('  未发现典型的"拉盘砸盘"候选');
    console.log('');
  }

  // 总结建议
  console.log('【总结：在回测中识别"拉盘砸盘"的方法】\n');

  console.log('✅ 可用的早期交易因子:');
  console.log('   1. tradeConcentration (交易集中度)');
  console.log('      计算: earlyTradesTotalCount / earlyTradesUniqueWallets');
  console.log('      判断: >4 可能是大户控盘');
  console.log('');
  console.log('   2. highValueRatio (高价值交易占比)');
  console.log('      计算: earlyTradesHighValueCount / earlyTradesTotalCount');
  console.log('      判断: <20% 可能是散户跟风，缺乏大户支撑');
  console.log('');
  console.log('   3. tradeIntensity (交易强度)');
  console.log('      计算: earlyTradesCountPerMin * earlyTradesWalletsPerMin');
  console.log('      判断: 异常高但亏损，可能是制造假象');
  console.log('');

  console.log('💡 建议的组合策略:');
  console.log('   早期交易因子 + 常规因子 组合使用');
  console.log('');
  console.log('   条件示例:');
  console.log('   tradeConcentration < 4 &&');
  console.log('   (highValueRatio > 0.2 OR earlyTradesTotalCount < 100) &&');
  console.log('   age < 3.2 &&');
  console.log('   trendCV >= 0.2 &&');
  console.log('   trendRiseRatio >= 0.73');
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════');
}

deepAnalyzeEarlyTradePatterns().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
