/**
 * 分析"拉盘砸盘"代币的预检查特征
 * 对比实际交易的代币，找出盘面质量特征
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function analyzePumpDumpFeatures() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    "拉盘砸盘"代币特征分析                                  ║');
  console.log('║                    购买前检查因子深度分析                                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取交易数据
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  // 获取所有信号（包括被拒绝的）
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .order('created_at', { ascending: true });

  // 计算代币收益
  const tokenTradeGroups = new Map();
  trades.forEach(trade => {
    if (!tokenTradeGroups.has(trade.token_address)) {
      tokenTradeGroups.set(trade.token_address, []);
    }
    tokenTradeGroups.get(trade.token_address).push(trade);
  });

  const tokens = new Map();
  for (const [addr, tokenTrades] of tokenTradeGroups) {
    tokenTrades.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const buyTrades = tokenTrades.filter(t => t.trade_direction === 'buy');
    const sellTrades = tokenTrades.filter(t => t.trade_direction === 'sell');

    if (buyTrades.length === 0) continue;

    const firstBuy = buyTrades[0];
    const symbol = firstBuy.token_symbol;

    let totalBuy = 0, totalSell = 0;
    buyTrades.forEach(t => totalBuy += t.input_amount || 0);
    sellTrades.forEach(t => totalSell += t.output_amount || 0);

    const profit = totalSell - totalBuy;
    const profitPercent = (profit / totalBuy) * 100;

    // 获取预检查因子
    const metadata = firstBuy.metadata || {};
    const preBuyFactors = metadata.preBuyCheckFactors || {};
    const trendFactors = metadata.factors?.trendFactors || {};

    tokens.set(addr, {
      symbol,
      profitPercent,
      profit,
      hasSell: sellTrades.length > 0,

      // 预检查因子
      holdersCount: preBuyFactors.holdersCount || 0,
      devHoldingRatio: preBuyFactors.devHoldingRatio || 0,
      maxHoldingRatio: preBuyFactors.maxHoldingRatio || 0,
      holderBlacklistCount: preBuyFactors.holderBlacklistCount || 0,
      holderWhitelistCount: preBuyFactors.holderWhitelistCount || 0,
      holderCanBuy: preBuyFactors.holderCanBuy || false,

      // 早期交易因子
      earlyTradesChecked: preBuyFactors.earlyTradesChecked || 0,
      earlyTradesTotalCount: preBuyFactors.earlyTradesTotalCount || 0,
      earlyTradesCountPerMin: preBuyFactors.earlyTradesCountPerMin || 0,
      earlyTradesVolumePerMin: preBuyFactors.earlyTradesVolumePerMin || 0,
      earlyTradesWalletsPerMin: preBuyFactors.earlyTradesWalletsPerMin || 0,
      earlyTradesHighValueCount: preBuyFactors.earlyTradesHighValueCount || 0,
      earlyTradesHighValuePerMin: preBuyFactors.earlyTradesHighValuePerMin || 0,
      earlyTradesUniqueWallets: preBuyFactors.earlyTradesUniqueWallets || 0,
      earlyTradesActualSpan: preBuyFactors.earlyTradesActualSpan || 0,
      earlyTradesDataCoverage: preBuyFactors.earlyTradesDataCoverage || 0,

      // 常规因子
      age: trendFactors.age || 0,
      trendRiseRatio: trendFactors.trendRiseRatio || 0,
      trendCV: trendFactors.trendCV || 0
    });
  }

  const tokenList = Array.from(tokens.values());

  // 重点分析：亏损代币的盘面质量特征
  console.log('【亏损代币的盘面质量分析】\n');
  console.log('代币          收益%    Dev%    MaxHold%  Black  White  eTrade  eCnt/Min  eWal/Min');
  console.log('─'.repeat(90));

  const lossTokens = tokenList.filter(t => t.profitPercent <= 0);
  lossTokens.forEach(t => {
    const profitStr = t.profitPercent.toFixed(2).padStart(7);
    const devStr = t.devHoldingRatio.toFixed(1).padStart(6);
    const maxStr = t.maxHoldingRatio.toFixed(1).padStart(7);
    const blStr = t.holderBlacklistCount.toString().padStart(5);
    const whStr = t.holderWhitelistCount.toString().padStart(5);
    const eTradeStr = t.earlyTradesChecked === 1 ? '✓' : '✗';
    const eCntStr = t.earlyTradesCountPerMin.toFixed(1).padStart(6);
    const eWalStr = t.earlyTradesWalletsPerMin.toFixed(1).padStart(7);

    // 标记可疑特征
    const flags = [];
    if (t.devHoldingRatio > 50) flags.push('🚨Dev控盘');
    if (t.maxHoldingRatio > 50) flags.push('🚨集中持仓');
    if (t.earlyTradesChecked === 0) flags.push('⚠️无交易数据');

    const flagStr = flags.length > 0 ? flags.join(' ') : '';

    console.log(`${t.symbol.padEnd(12)} ${profitStr}% ${devStr}  ${maxStr}  ${blStr}  ${whStr}  ${eTradeStr}  ${eCntStr}  ${eWalStr}  ${flagStr}`);
  });

  console.log('');
  console.log('');

  // 对比分析
  console.log('【盈利 vs 亏损：盘面质量因子对比】\n');
  console.log('因子                              盈利平均    亏损平均    差异      分析');
  console.log('─'.repeat(85));

  const profitable = tokenList.filter(t => t.profitPercent > 0);
  const loss = tokenList.filter(t => t.profitPercent <= 0);

  const qualityFactors = [
    { key: 'devHoldingRatio', name: 'Dev持仓比例%', highBad: true },
    { key: 'maxHoldingRatio', name: '最大持仓比例%', highBad: true },
    { key: 'holderBlacklistCount', name: '黑名单持有者数', highBad: true },
    { key: 'holderWhitelistCount', name: '白名单持有者数', highBad: false },
    { key: 'holdersCount', name: '总持有者数', highBad: false },
    { key: 'earlyTradesTotalCount', name: '早期总交易数', highBad: false },
    { key: 'earlyTradesCountPerMin', name: '每分钟交易数', highBad: false },
    { key: 'earlyTradesWalletsPerMin', name: '每分钟钱包数', highBad: false },
    { key: 'earlyTradesHighValueCount', name: '高价值交易数', highBad: false }
  ];

  qualityFactors.forEach(({ key, name, highBad }) => {
    const profitAvg = profitable.length > 0
      ? profitable.reduce((sum, t) => sum + (t[key] || 0), 0) / profitable.length
      : 0;
    const lossAvg = loss.length > 0
      ? loss.reduce((sum, t) => sum + (t[key] || 0), 0) / loss.length
      : 0;
    const diff = profitAvg - lossAvg;
    const diffPercent = lossAvg !== 0 ? (diff / lossAvg * 100) : 0;

    let analysis = '';
    if (highBad && lossAvg > profitAvg * 1.2) {
      analysis = `⚠️ 亏损代币${name}偏高 ${(lossAvg / profitAvg).toFixed(1)}x`;
    } else if (!highBad && lossAvg < profitAvg * 0.7) {
      analysis = `⚠️ 亏损代币${name}偏低 ${(profitAvg / lossAvg).toFixed(1)}x`;
    }

    console.log(`${name.padEnd(34)} ${profitAvg.toFixed(2).padStart(10)} ${lossAvg.toFixed(2).padStart(10)} ${diff.toFixed(2).padStart(8)}  ${analysis}`);
  });

  console.log('');
  console.log('');

  // 识别"拉盘砸盘"特征
  console.log('【识别"拉盘砸盘"的关键特征】\n');

  // 分析Dev持仓比例
  const highDevHolding = tokenList.filter(t => t.devHoldingRatio > 50);
  if (highDevHolding.length > 0) {
    const lossInHighDev = highDevHolding.filter(t => t.profitPercent <= 0);
    console.log(`Dev持仓 > 50%: ${highDevHolding.length}个代币, 其中亏损${lossInHighDev.length}个 (${lossInHighDev.length > 0 ? (lossInHighDev.length / highDevHolding.length * 100).toFixed(1) : 0}%)`);
    if (lossInHighDev.length > 0) {
      console.log(`  疑似拉盘: ${lossInHighDev.map(t => t.symbol).join(', ')}`);
    }
    console.log('');
  }

  // 分析早期交易数据缺失
  const noEarlyTradeData = tokenList.filter(t => t.earlyTradesChecked === 0 || t.earlyTradesTotalCount === 0);
  if (noEarlyTradeData.length > 0) {
    const lossInNoData = noEarlyTradeData.filter(t => t.profitPercent <= 0);
    console.log(`无早期交易数据: ${noEarlyTradeData.length}个代币, 其中亏损${lossInNoData.length}个 (${lossInNoData.length > 0 ? (lossInNoData.length / noEarlyTradeData.length * 100).toFixed(1) : 0}%)`);
    if (lossInNoData.length > 0) {
      console.log(`  疑似问题: ${lossInNoData.map(t => t.symbol).join(', ')}`);
    }
    console.log('');
  }

  // 建议的过滤条件
  console.log('【建议的盘面质量过滤条件】\n');

  const suggestions = [];

  // 1. Dev持仓比例过滤
  const avgDevProfit = profitable.reduce((sum, t) => sum + t.devHoldingRatio, 0) / profitable.length;
  const avgDevLoss = loss.reduce((sum, t) => sum + t.devHoldingRatio, 0) / loss.length;
  if (avgDevLoss > avgDevProfit * 1.5) {
    const threshold = 50; // 使用合理的阈值
    const filteredLoss = loss.filter(t => t.devHoldingRatio > threshold);
    const filteredProfit = profitable.filter(t => t.devHoldingRatio > threshold);
    suggestions.push({
      name: 'Dev持仓比例过滤',
      condition: `devHoldingRatio < ${threshold}`,
      reason: `亏损代币平均Dev持仓(${avgDevLoss.toFixed(1)}%)远高于盈利代币(${avgDevProfit.toFixed(1)}%)`,
      wouldFilterLoss: filteredLoss.length,
      wouldLoseProfit: filteredProfit.length
    });
  }

  // 2. 早期交易活跃度过滤
  const hasEarlyTradeData = tokenList.filter(t => t.earlyTradesChecked === 1 && t.earlyTradesTotalCount > 0);
  if (hasEarlyTradeData.length > 0) {
    const avgWalletsProfit = hasEarlyTradeData.filter(t => t.profitPercent > 0)
      .reduce((sum, t) => sum + t.earlyTradesWalletsPerMin, 0) / hasEarlyTradeData.filter(t => t.profitPercent > 0).length;
    const avgWalletsLoss = hasEarlyTradeData.filter(t => t.profitPercent <= 0)
      .reduce((sum, t) => sum + t.earlyTradesWalletsPerMin, 0) / hasEarlyTradeData.filter(t => t.profitPercent <= 0).length;

    if (avgWalletsLoss < avgWalletsProfit * 0.5 && avgWalletsLoss > 0) {
      const threshold = Math.ceil(avgWalletsLoss);
      const filteredLoss = loss.filter(t => t.earlyTradesWalletsPerMin >= threshold && t.earlyTradesChecked === 1);
      const filteredProfit = profitable.filter(t => t.earlyTradesWalletsPerMin >= threshold && t.earlyTradesChecked === 1);
      suggestions.push({
        name: '早期交易活跃度过滤',
        condition: `earlyTradesWalletsPerMin >= ${threshold}`,
        reason: `亏损代币平均每分钟钱包数(${avgWalletsLoss.toFixed(1)})明显少于盈利代币(${avgWalletsProfit.toFixed(1)})`,
        wouldFilterLoss: filteredLoss.length,
        wouldLoseProfit: filteredProfit.length,
        note: '仅适用于有早期交易数据的代币'
      });
    }
  }

  // 3. 综合建议：数据可用性检查
  const noDataLoss = loss.filter(t => t.earlyTradesChecked === 0 || t.earlyTradesTotalCount === 0);
  if (noDataLoss.length > 0) {
    suggestions.push({
      name: '早期交易数据可用性检查',
      condition: `earlyTradesChecked == 1 AND earlyTradesTotalCount > 0`,
      reason: `有${noDataLoss.length}个亏损代币没有早期交易数据，可能是异常代币`,
      wouldFilterLoss: noDataLoss.length,
      wouldLoseProfit: profitable.filter(t => t.earlyTradesChecked === 0 || t.earlyTradesTotalCount === 0).length,
      note: '建议只购买有早期交易数据的代币'
    });
  }

  if (suggestions.length > 0) {
    suggestions.forEach((s, i) => {
      console.log(`${i + 1}. ${s.name}`);
      console.log(`   条件: ${s.condition}`);
      console.log(`   原因: ${s.reason}`);
      console.log(`   效果: 可过滤${s.wouldFilterLoss}个亏损代币, 可能损失${s.wouldLoseProfit}个盈利代币`);
      if (s.note) console.log(`   备注: ${s.note}`);
      console.log('');
    });
  } else {
    console.log('  未发现明显的盘面质量过滤条件');
    console.log('');
  }

  // 总结
  console.log('【总结】\n');
  console.log('✅ 关键发现:');
  console.log(`   1. ${noEarlyTradeData.length}个代币缺少早期交易数据`);
  console.log(`   2. ${highDevHolding.length}个代币Dev持仓超过50%`);
  console.log(`   3. 需要结合盘面质量因子来识别"拉盘砸盘"代币`);
  console.log('');

  console.log('💡 推荐策略:');
  console.log('   优先过滤无早期交易数据的代币');
  console.log('   对有数据的代币，检查Dev持仓和早期活跃度');
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════');
}

analyzePumpDumpFeatures().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
