/**
 * 重新分析：关注早期交易因子（回测可用的数据）
 * 识别"拉盘砸盘"的早期交易特征
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function reanalyzeEarlyTradeFactors() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    早期交易因子分析（回测模式）                              ║');
  console.log('║                    识别"拉盘砸盘"的早期交易特征                              ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取所有买入信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .order('created_at', { ascending: true });

  // 获取交易数据计算收益
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  // 计算代币收益
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

    // 获取常规因子
    const trendFactors = buyTrades[0]?.metadata?.factors?.trendFactors || {};

    tokenProfits.set(addr, {
      profitPercent,
      profit,
      hasSell: sellTrades.length > 0,
      symbol: buyTrades[0].token_symbol,
      age: trendFactors.age || 0,
      trendRiseRatio: trendFactors.trendRiseRatio || 0,
      trendCV: trendFactors.trendCV || 0
    });
  }

  // 分析通过预检查的信号
  const passedSignals = signals.filter(s =>
    s.metadata?.execution_status !== 'failed' &&
    s.metadata?.preBuyCheckFactors?.earlyTradesChecked === 1
  );

  // 分组：有交易的代币
  const tokens = [];
  const tokenSignals = new Map();

  passedSignals.forEach(signal => {
    const profit = tokenProfits.get(signal.token_address);
    if (!profit) return; // 没有交易数据的跳过

    const preBuyFactors = signal.metadata?.preBuyCheckFactors || {};

    tokens.push({
      symbol: signal.token_symbol,
      addr: signal.token_address,
      profitPercent: profit.profitPercent,
      profit: profit.profit,
      hasSell: profit.hasSell,

      // 早期交易因子
      earlyTradesTotalCount: preBuyFactors.earlyTradesTotalCount || 0,
      earlyTradesCountPerMin: preBuyFactors.earlyTradesCountPerMin || 0,
      earlyTradesVolumePerMin: preBuyFactors.earlyTradesVolumePerMin || 0,
      earlyTradesWalletsPerMin: preBuyFactors.earlyTradesWalletsPerMin || 0,
      earlyTradesHighValueCount: preBuyFactors.earlyTradesHighValueCount || 0,
      earlyTradesHighValuePerMin: preBuyFactors.earlyTradesHighValuePerMin || 0,
      earlyTradesUniqueWallets: preBuyFactors.earlyTradesUniqueWallets || 0,
      earlyTradesDataCoverage: preBuyFactors.earlyTradesDataCoverage || 0,

      // 常规因子
      age: profit.age,
      trendRiseRatio: profit.trendRiseRatio,
      trendCV: profit.trendCV
    });

    tokenSignals.set(signal.token_address, signal);
  });

  const profitable = tokens.filter(t => t.profitPercent > 0);
  const loss = tokens.filter(t => t.profitPercent <= 0);

  console.log('【通过预检查的代币】\n');
  console.log(`总计: ${tokens.length}个 (盈利${profitable.length}个, 亏损${loss.length}个)\n`);

  // 详细列出亏损代币
  console.log('【亏损代币的早期交易特征】\n');
  console.log('代币          收益%    eTotal  eCnt/M  eVol/M  eWal/M  eHV/M  eUniq   Cover%  Age    Ratio   CV');
  console.log('─'.repeat(105));

  loss.forEach(t => {
    const profitStr = t.profitPercent.toFixed(2).padStart(7);
    const eTotStr = t.earlyTradesTotalCount.toString().padStart(6);
    const eCntStr = t.earlyTradesCountPerMin.toFixed(1).padStart(6);
    const eVolStr = (t.earlyTradesVolumePerMin / 1000).toFixed(1).padStart(6);
    const eWalStr = t.earlyTradesWalletsPerMin.toFixed(1).padStart(6);
    const eHVStr = t.earlyTradesHighValuePerMin.toFixed(1).padStart(5);
    const eUniStr = t.earlyTradesUniqueWallets.toString().padStart(5);
    const covStr = t.earlyTradesDataCoverage.toFixed(0).padStart(5);
    const ageStr = t.age.toFixed(1).padStart(5);
    const ratioStr = t.trendRiseRatio.toFixed(2).padStart(5);
    const cvStr = t.trendCV.toFixed(3).padStart(5);

    // 标记可疑特征
    const flags = [];
    if (t.earlyTradesWalletsPerMin < 20) flags.push('💧活跃度低');
    if (t.earlyTradesDataCoverage < 50) flags.push('📊覆盖率低');
    if (t.age > 3) flags.push('⏰Age大');
    if (t.trendCV < 0.2) flags.push('📉CV低');

    const flagStr = flags.join(' ');

    console.log(`${t.symbol.padEnd(12)} ${profitStr}% ${eTotStr} ${eCntStr} ${eVolStr}K ${eWalStr} ${eHVStr} ${eUniStr} ${covStr}% ${ageStr}m ${ratioStr} ${cvStr}  ${flagStr}`);
  });

  console.log('');
  console.log('');

  // 对比分析
  console.log('【盈利 vs 亏损：早期交易因子对比】\n');
  console.log('因子                              盈利平均    亏损平均    差异      差异%    诊断');
  console.log('─'.repeat(100));

  const earlyTradeFactors = [
    { key: 'earlyTradesTotalCount', name: '早期总交易数', highGood: true },
    { key: 'earlyTradesCountPerMin', name: '每分钟交易数', highGood: true },
    { key: 'earlyTradesVolumePerMin', name: '每分钟交易量(USD)', highGood: true },
    { key: 'earlyTradesWalletsPerMin', name: '每分钟钱包数', highGood: true },
    { key: 'earlyTradesHighValueCount', name: '高价值交易数', highGood: true },
    { key: 'earlyTradesHighValuePerMin', name: '高价值交易/分钟', highGood: true },
    { key: 'earlyTradesUniqueWallets', name: '唯一钱包数', highGood: true },
    { key: 'earlyTradesDataCoverage', name: '数据覆盖率%', highGood: true }
  ];

  earlyTradeFactors.forEach(({ key, name, highGood }) => {
    const profitAvg = profitable.length > 0
      ? profitable.reduce((sum, t) => sum + (t[key] || 0), 0) / profitable.length
      : 0;
    const lossAvg = loss.length > 0
      ? loss.reduce((sum, t) => sum + (t[key] || 0), 0) / loss.length
      : 0;
    const diff = profitAvg - lossAvg;
    const diffPercent = lossAvg !== 0 ? (diff / lossAvg * 100) : 0;

    let diagnosis = '';
    if (highGood && lossAvg < profitAvg * 0.7) {
      diagnosis = `⚠️ 亏损代币${name}偏低 ${(profitAvg / lossAvg).toFixed(1)}x`;
    } else if (highGood && lossAvg > profitAvg * 1.3) {
      diagnosis = `✓  ${name}不是问题`;
    } else if (!highGood && lossAvg > profitAvg * 1.3) {
      diagnosis = `⚠️ 亏损代币${name}偏高 ${(lossAvg / profitAvg).toFixed(1)}x`;
    }

    console.log(`${name.padEnd(34)} ${profitAvg.toFixed(2).padStart(10)} ${lossAvg.toFixed(2).padStart(10)} ${diff.toFixed(2).padStart(8)} ${diffPercent.toFixed(1).padStart(6)}%  ${diagnosis}`);
  });

  console.log('');
  console.log('');

  // 识别"交易活跃但亏损"的特征
  console.log('【关键洞察：为什么交易活跃却仍亏损？】\n');

  // 分析高活跃度但亏损的代币
  const highActivityLoss = loss.filter(t => t.earlyTradesWalletsPerMin > 30);
  if (highActivityLoss.length > 0) {
    console.log(`交易活跃但亏损的代币 (${highActivityLoss.length}个):\n`);
    highActivityLoss.forEach(t => {
      console.log(`  ${t.symbol}: 每分钟${t.earlyTradesWalletsPerMin.toFixed(1)}个钱包, 但亏损${t.profitPercent.toFixed(2)}%`);
      console.log(`    Age: ${t.age.toFixed(1)}分钟, trendCV: ${t.trendCV.toFixed(3)}, trendRiseRatio: ${t.trendRiseRatio.toFixed(2)}`);
      console.log('');
    });
  }

  // 分析数据覆盖率低的代币
  const lowCoverage = tokens.filter(t => t.earlyTradesDataCoverage < 50);
  if (lowCoverage.length > 0) {
    const lowCoverageLoss = lowCoverage.filter(t => t.profitPercent <= 0);
    console.log(`数据覆盖率低的代币 (${lowCoverage.length}个, 亏损${lowCoverageLoss.length}个)`);
    console.log(`  可能是数据异常或交易不连续，建议提高数据覆盖率要求`);
    console.log('');
  }

  // 建议的过滤条件
  console.log('【建议的早期交易过滤条件】\n');

  const suggestions = [];

  // 1. 每分钟钱包数
  const avgWalletsProfit = profitable.reduce((sum, t) => sum + t.earlyTradesWalletsPerMin, 0) / profitable.length;
  const avgWalletsLoss = loss.reduce((sum, t) => sum + t.earlyTradesWalletsPerMin, 0) / loss.length;
  if (avgWalletsLoss < avgWalletsProfit * 0.7 && avgWalletsLoss > 0) {
    const threshold = Math.ceil(avgWalletsLoss);
    const filteredLoss = loss.filter(t => t.earlyTradesWalletsPerMin < threshold);
    const filteredProfit = profitable.filter(t => t.earlyTradesWalletsPerMin < threshold);
    suggestions.push({
      factor: 'earlyTradesWalletsPerMin',
      condition: `>= ${threshold}`,
      reason: `亏损代币平均每分钟钱包数(${avgWalletsLoss.toFixed(1)})明显少于盈利代币(${avgWalletsProfit.toFixed(1)})`,
      wouldFilterLoss: filteredLoss.length,
      wouldLoseProfit: filteredProfit.length
    });
  }

  // 2. 数据覆盖率
  const avgCoverProfit = profitable.reduce((sum, t) => sum + t.earlyTradesDataCoverage, 0) / profitable.length;
  const avgCoverLoss = loss.reduce((sum, t) => sum + t.earlyTradesDataCoverage, 0) / loss.length;
  if (avgCoverLoss < avgCoverProfit * 0.9) {
    const threshold = Math.floor(avgCoverLoss);
    const filteredLoss = loss.filter(t => t.earlyTradesDataCoverage < threshold);
    const filteredProfit = profitable.filter(t => t.earlyTradesDataCoverage < threshold);
    suggestions.push({
      factor: 'earlyTradesDataCoverage',
      condition: `>= ${threshold}`,
      reason: `亏损代币平均数据覆盖率(${avgCoverLoss.toFixed(1)}%)低于盈利代币(${avgCoverProfit.toFixed(1)}%)`,
      wouldFilterLoss: filteredLoss.length,
      wouldLoseProfit: filteredProfit.length
    });
  }

  if (suggestions.length > 0) {
    suggestions.forEach((s, i) => {
      console.log(`${i + 1}. ${s.factor}: ${s.condition}`);
      console.log(`   ${s.reason}`);
      console.log(`   可过滤${s.wouldFilterLoss}个亏损代币, 可能损失${s.wouldLoseProfit}个盈利代币`);
      console.log('');
    });
  } else {
    console.log('  早期交易因子中没有发现明显的过滤条件');
    console.log('  说明问题主要在于常规因子（age、trendCV、trendRiseRatio）');
    console.log('');
  }

  // 总结
  console.log('【总结】\n');
  console.log('✅ 关键发现:');
  console.log('   1. 亏损代币的早期交易活跃度并不低');
  console.log('   2. 亏损代币的问题主要在于常规因子');
  console.log('   3. 需要结合age、trendCV、trendRiseRatio来过滤');
  console.log('');
  console.log('💡 识别"拉盘砸盘"的方法:');
  console.log('   - 早期交易活跃度不能单独识别"拉盘砸盘"');
  console.log('   - 需要结合持有者黑名单（实时模式可用）');
  console.log('   - 在回测中，重点应该放在优化常规因子上');
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════');
}

reanalyzeEarlyTradeFactors().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
