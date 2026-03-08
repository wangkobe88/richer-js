/**
 * 分析购买前检查因子
 * 对比盈利代币和亏损代币在购买前检查因子上的差异
 * 重点识别"拉盘后迅速砸盘"类型的代币
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function analyzePreBuyFactors() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    购买前检查因子分析                                      ║');
  console.log('║            识别"拉盘后迅速砸盘"类型代币的特征                            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取交易数据
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  // 获取信号数据（包含预检查因子）
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .order('created_at', { ascending: true });

  // 计算每个代币的收益
  const tokenTradeGroups = new Map();
  trades.forEach(trade => {
    if (!tokenTradeGroups.has(trade.token_address)) {
      tokenTradeGroups.set(trade.token_address, []);
    }
    tokenTradeGroups.get(trade.token_address).push(trade);
  });

  const tokens = [];
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

    // 获取对应的信号（包含预检查因子）
    const buySignal = signals.find(s => s.token_address === addr && s.action === 'buy');

    // 获取预检查因子
    const metadata = firstBuy.metadata || {};
    const factors = metadata.factors || {};
    const preBuyCheck = factors.preBuyCheck || {};

    // 常规因子
    const trendFactors = factors.trendFactors || {};

    tokens.push({
      symbol,
      addr,
      profitPercent,
      profit,
      hasSell: sellTrades.length > 0,

      // 预检查因子
      preBuyCheck: preBuyCheck,
      earlyTradesChecked: preBuyCheck.earlyTradesChecked || 0,
      earlyTradesHighValueCount: preBuyCheck.earlyTradesHighValueCount || 0,
      earlyTradesCountPerMin: preBuyCheck.earlyTradesCountPerMin || 0,
      earlyTradesVolumePerMin: preBuyCheck.earlyTradesVolumePerMin || 0,
      earlyTradesWalletsPerMin: preBuyCheck.earlyTradesWalletsPerMin || 0,
      earlyTradesTotalCount: preBuyCheck.earlyTradesTotalCount || 0,
      earlyTradesVolume: preBuyCheck.earlyTradesVolume || 0,
      earlyTradesUniqueWallets: preBuyCheck.earlyTradesUniqueWallets || 0,
      earlyTradesDataCoverage: preBuyCheck.earlyTradesDataCoverage || 0,

      // 持有者因子
      holdersCount: preBuyCheck.holdersCount || 0,
      maxHoldingRatio: preBuyCheck.maxHoldingRatio || 0,
      devHoldingRatio: preBuyCheck.devHoldingRatio || 0,
      holderBlacklistCount: preBuyCheck.holderBlacklistCount || 0,

      // 常规因子（用于对比）
      trendRiseRatio: trendFactors.trendRiseRatio || 0,
      trendCV: trendFactors.trendCV || 0,
      age: trendFactors.age || 0
    });
  }

  // 分组
  const profitable = tokens.filter(t => t.profitPercent > 0);
  const loss = tokens.filter(t => t.profitPercent <= 0);

  // 重点分析：亏损代币的预检查因子
  console.log('【亏损代币的预检查因子分析】\n');
  console.log('代币          收益%    eTrade  eHV  eCnt/Min  eVol/Min  eWal/Min  MaxHold%  BlackList');
  console.log('─'.repeat(95));

  loss.forEach(t => {
    const profitStr = t.profitPercent.toFixed(2).padStart(7);
    const eTradeStr = t.earlyTradesChecked === 1 ? '✓' : '✗';
    const eHVStr = t.earlyTradesHighValueCount.toString().padStart(4);
    const eCntStr = t.earlyTradesCountPerMin.toFixed(1).padStart(7);
    const eVolStr = (t.earlyTradesVolumePerMin / 1000).toFixed(1).padStart(8);
    const eWalStr = t.earlyTradesWalletsPerMin.toFixed(1).padStart(7);
    const maxHoldStr = t.maxHoldingRatio.toFixed(1).padStart(8);
    const blStr = t.holderBlacklistCount.toString().padStart(8);

    console.log(`${t.symbol.padEnd(12)} ${profitStr}%  ${eTradeStr}  ${eHVStr}  ${eCntStr}  ${eVolStr}K  ${eWalStr}  ${maxHoldStr}  ${blStr}`);
  });

  console.log('');
  console.log('');

  // 对比分析
  console.log('【盈利 vs 亏损代币：预检查因子对比】\n');
  console.log('因子                        盈利平均    亏损平均    差异      差异%');
  console.log('─'.repeat(75));

  const preBuyFactors = [
    { key: 'earlyTradesHighValueCount', name: '高价值交易数' },
    { key: 'earlyTradesCountPerMin', name: '每分钟交易数' },
    { key: 'earlyTradesVolumePerMin', name: '每分钟交易量(USD)' },
    { key: 'earlyTradesWalletsPerMin', name: '每分钟钱包数' },
    { key: 'earlyTradesTotalCount', name: '总交易数' },
    { key: 'earlyTradesVolume', name: '总交易量(USD)' },
    { key: 'earlyTradesUniqueWallets', name: '唯一钱包数' },
    { key: 'holdersCount', name: '持有者数' },
    { key: 'maxHoldingRatio', name: '最大持仓比例%' },
    { key: 'devHoldingRatio', name: 'Dev持仓比例%' }
  ];

  preBuyFactors.forEach(({ key, name }) => {
    const profitAvg = profitable.length > 0
      ? profitable.reduce((sum, t) => sum + (t[key] || 0), 0) / profitable.length
      : 0;
    const lossAvg = loss.length > 0
      ? loss.reduce((sum, t) => sum + (t[key] || 0), 0) / loss.length
      : 0;
    const diff = profitAvg - lossAvg;
    const diffPercent = lossAvg !== 0 ? (diff / lossAvg * 100) : 0;

    console.log(`${name.padEnd(28)} ${profitAvg.toFixed(2).padStart(10)} ${lossAvg.toFixed(2).padStart(10)} ${diff.toFixed(2).padStart(8)} ${diffPercent > 0 ? '+' : ''}${diffPercent.toFixed(1)}%`);
  });

  console.log('');
  console.log('');

  // 分析"拉盘砸盘"特征
  console.log('【识别"拉盘后迅速砸盘"的特征】\n');

  // 找出可能具有拉盘砸盘特征的代币
  const pumpAndDumpCandidates = tokens.filter(t => {
    // 特征1: 高价值交易数很少（可能是少数大户拉盘）
    const lowHighValueCount = t.earlyTradesHighValueCount < 5;

    // 特征2: 每分钟钱包数少（真实用户少）
    const lowWalletsPerMin = t.earlyTradesWalletsPerMin < 10;

    // 特征3: 最大持仓比例高（有人控盘）
    const highMaxHolding = t.maxHoldingRatio > 20;

    // 特征4: 总交易量不算低（有交易活跃度）
    const hasVolume = t.earlyTradesVolume > 1000;

    return lowHighValueCount && lowWalletsPerMin && highMaxHolding && hasVolume;
  });

  if (pumpAndDumpCandidates.length > 0) {
    console.log(`发现 ${pumpAndDumpCandidates.length} 个疑似"拉盘砸盘"代币:\n`);
    pumpAndDumpCandidates.forEach(t => {
      const reasons = [];
      if (t.earlyTradesHighValueCount < 5) reasons.push(`高价值交易少(${t.earlyTradesHighValueCount})`);
      if (t.earlyTradesWalletsPerMin < 10) reasons.push(`钱包数少(${t.earlyTradesWalletsPerMin.toFixed(1)}/min)`);
      if (t.maxHoldingRatio > 20) reasons.push(`最大持仓高(${t.maxHoldingRatio.toFixed(1)}%)`);
      if (t.profitPercent <= 0) reasons.push(`亏损${t.profitPercent.toFixed(2)}%`);

      console.log(`  ${t.symbol}:`);
      console.log(`    收益: ${t.profitPercent.toFixed(2)}%`);
      console.log(`    疑似原因: ${reasons.join(', ')}`);
      console.log('');
    });
  } else {
    console.log('  未发现明显的"拉盘砸盘"特征代币');
    console.log('');
  }

  // 建议的过滤条件
  console.log('【建议的预检查过滤条件】\n');

  // 分析哪些因子能有效过滤亏损代币
  const filterSuggestions = [];

  // 检查每分钟钱包数
  const avgWalletsProfit = profitable.reduce((sum, t) => sum + t.earlyTradesWalletsPerMin, 0) / profitable.length;
  const avgWalletsLoss = loss.reduce((sum, t) => sum + t.earlyTradesWalletsPerMin, 0) / loss.length;
  if (avgWalletsLoss < avgWalletsProfit * 0.7) {
    const threshold = Math.ceil(avgWalletsLoss);
    const filteredCount = loss.filter(t => t.earlyTradesWalletsPerMin < threshold).length;
    filterSuggestions.push({
      factor: 'earlyTradesWalletsPerMin',
      condition: `>= ${threshold}`,
      reason: `亏损代币平均每分钟钱包数(${avgWalletsLoss.toFixed(1)})明显少于盈利代币(${avgWalletsProfit.toFixed(1)})`,
      wouldFilter: filteredCount
    });
  }

  // 检查高价值交易数
  const avgHVProfit = profitable.reduce((sum, t) => sum + t.earlyTradesHighValueCount, 0) / profitable.length;
  const avgHVLoss = loss.reduce((sum, t) => sum + t.earlyTradesHighValueCount, 0) / loss.length;
  if (avgHVLoss < avgHVProfit * 0.7) {
    const threshold = Math.floor(avgHVLoss);
    const filteredCount = loss.filter(t => t.earlyTradesHighValueCount < threshold).length;
    filterSuggestions.push({
      factor: 'earlyTradesHighValueCount',
      condition: `>= ${threshold}`,
      reason: `亏损代币平均高价值交易数(${avgHVLoss.toFixed(1)})明显少于盈利代币(${avgHVProfit.toFixed(1)})`,
      wouldFilter: filteredCount
    });
  }

  // 检查最大持仓比例
  const avgMaxHoldProfit = profitable.reduce((sum, t) => sum + t.maxHoldingRatio, 0) / profitable.length;
  const avgMaxHoldLoss = loss.reduce((sum, t) => sum + t.maxHoldingRatio, 0) / loss.length;
  if (avgMaxHoldLoss > avgMaxHoldProfit * 1.2) {
    const threshold = Math.floor(avgMaxHoldLoss);
    const filteredCount = loss.filter(t => t.maxHoldingRatio > threshold).length;
    filterSuggestions.push({
      factor: 'maxHoldingRatio',
      condition: `< ${threshold}`,
      reason: `亏损代币平均最大持仓比例(${avgMaxHoldLoss.toFixed(1)}%)明显高于盈利代币(${avgMaxHoldProfit.toFixed(1)}%)`,
      wouldFilter: filteredCount
    });
  }

  if (filterSuggestions.length > 0) {
    filterSuggestions.forEach(s => {
      console.log(`  [${s.factor}]: ${s.condition}`);
      console.log(`    原因: ${s.reason}`);
      console.log(`    可过滤: ${s.wouldFilter} 个亏损代币`);
      console.log('');
    });
  } else {
    console.log('  预检查因子中没有发现明显有效的过滤条件');
    console.log('');
  }

  // 检查数据覆盖率
  console.log('【数据覆盖率分析】\n');
  const checkedTokens = tokens.filter(t => t.earlyTradesChecked === 1);
  console.log(`  有预检查数据的代币: ${checkedTokens.length} / ${tokens.length}`);

  if (checkedTokens.length > 0) {
    const avgCoverage = checkedTokens.reduce((sum, t) => sum + t.earlyTradesDataCoverage, 0) / checkedTokens.length;
    console.log(`  平均数据覆盖率: ${avgCoverage.toFixed(1)}%`);
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════════════════════');
}

analyzePreBuyFactors().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
