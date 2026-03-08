/**
 * 列出所有代币购买信号中的trendCV
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function listAllTrendCV() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    所有代币的trendCV列表                                    ║');
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

    tokenProfits.set(addr, {
      profitPercent,
      profit,
      hasSell: sellTrades.length > 0,
      symbol: buyTrades[0].token_symbol
    });
  }

  // 获取代币标注数据
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId);

  // 提取trendCV数据 - 从交易数据中获取
  const tokensWithCV = new Map(); // 使用Map去重（一个代币可能有多个信号）

  // 先从交易中获取trendFactors
  for (const [addr, tokenTrades] of tokenTradeGroups) {
    tokenTrades.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const buyTrades = tokenTrades.filter(t => t.trade_direction === 'buy');

    if (buyTrades.length === 0) continue;

    const firstBuy = buyTrades[0];
    const profit = tokenProfits.get(addr);
    const tokenInfo = tokens?.find(t => t.token_address === addr);
    const humanJudges = tokenInfo?.human_judges || {};

    const trendFactors = firstBuy.metadata?.factors?.trendFactors || {};

    tokensWithCV.set(addr, {
      symbol: firstBuy.token_symbol,
      addr: addr,
      profitPercent: profit?.profitPercent || 0,
      hasTrades: true,
      hasSell: profit?.hasSell || false,
      qualityCategory: humanJudges.category,
      qualityLabel: humanJudges.category
        ? { fake_pump: '🎭流水盘', no_user: '👻无人玩', low_quality: '📉低质量', mid_quality: '📊中质量', high_quality: '🚀高质量' }[humanJudges.category] || '❓未标注'
        : '❓未标注',
      trendCV: trendFactors.trendCV || 0,
      trendSlope: trendFactors.trendSlope || 0,
      trendRiseRatio: trendFactors.trendRiseRatio || 0,
      age: trendFactors.age || 0,
      earlyReturn: trendFactors.earlyReturn || 0,
      buyPrice: firstBuy.unit_price || 0,
      buyTime: firstBuy.created_at
    });
  }

  // 对于没有交易的信号，使用信号数据
  signals.forEach(signal => {
    if (tokensWithCV.has(signal.token_address)) return; // 已有交易数据的跳过

    const tokenInfo = tokens?.find(t => t.token_address === signal.token_address);
    const humanJudges = tokenInfo?.human_judges || {};

    const trendFactors = signal.metadata?.factors?.trendFactors || {};

    tokensWithCV.set(signal.token_address, {
      symbol: signal.token_symbol,
      addr: signal.token_address,
      profitPercent: 0,
      hasTrades: false,
      hasSell: false,
      qualityCategory: humanJudges.category,
      qualityLabel: humanJudges.category
        ? { fake_pump: '🎭流水盘', no_user: '👻无人玩', low_quality: '📉低质量', mid_quality: '📊中质量', high_quality: '🚀高质量' }[humanJudges.category] || '❓未标注'
        : '❓未标注',
      trendCV: trendFactors.trendCV || 0,
      trendSlope: trendFactors.trendSlope || 0,
      trendRiseRatio: trendFactors.trendRiseRatio || 0,
      age: trendFactors.age || 0,
      earlyReturn: trendFactors.earlyReturn || 0,
      buyPrice: signal.metadata?.buyPrice || 0,
      buyTime: signal.created_at
    });
  });

  // 按trendCV排序
  const sortedTokens = Array.from(tokensWithCV.values()).sort((a, b) => b.trendCV - a.trendCV);

  console.log(`总计 ${sortedTokens.length} 个代币\n`);
  console.log('代币              收益%      trendCV   Slope    RiseRatio  Age(m)  EarlyRet%  质量        执行状态');
  console.log('─'.repeat(105));

  sortedTokens.forEach(t => {
    const profitStr = t.profitPercent.toFixed(2).padStart(8);
    const cvStr = t.trendCV.toFixed(3).padStart(8);
    const slopeStr = t.trendSlope.toFixed(4).padStart(7);
    const riseStr = t.trendRiseRatio.toFixed(3).padStart(8);
    const ageStr = t.age.toFixed(2).padStart(6);
    const erStr = t.earlyReturn.toFixed(1).padStart(8);
    const qualityStr = `${t.qualityLabel} (${t.qualityCategory || '未标注'})`;

    // 标记
    const flags = [];
    if (t.trendCV < 0.15) flags.push('⚠️CV<0.15');
    if (t.trendCV < 0.2 && t.trendCV >= 0.15) flags.push('⚡CV:0.15-0.20');
    if (t.trendCV >= 0.2) flags.push('✓CV≥0.20');
    if (!t.hasTrades) flags.push('📭无交易');
    if (t.profitPercent > 50) flags.push('🚀大赚');
    if (t.profitPercent < -20) flags.push('💥大亏');

    const flagStr = flags.length > 0 ? flags.join(' ') : '';

    console.log(`${t.symbol.padEnd(16)} ${profitStr}%  ${cvStr}  ${slopeStr}  ${riseStr}  ${ageStr}  ${erStr}  ${qualityStr.padEnd(20)}  ${flagStr}`);
  });

  console.log('');
  console.log('');

  // 统计不同trendCV区间的收益分布
  console.log('【trendCV区间统计】\n');
  console.log('trendCV区间      数量  盈利  亏损  盈利率  平均收益%  最大收益%    最小收益%');
  console.log('─'.repeat(80));

  const cvBuckets = [
    { min: 0, max: 0.1, label: '0.00-0.10' },
    { min: 0.1, max: 0.15, label: '0.10-0.15' },
    { min: 0.15, max: 0.2, label: '0.15-0.20' },
    { min: 0.2, max: 0.25, label: '0.20-0.25' },
    { min: 0.25, max: 0.3, label: '0.25-0.30' },
    { min: 0.3, max: Infinity, label: '≥0.30' }
  ];

  cvBuckets.forEach(bucket => {
    const inBucket = sortedTokens.filter(t => t.trendCV >= bucket.min && t.trendCV < bucket.max);
    if (inBucket.length === 0) return;

    const profit = inBucket.filter(t => t.profitPercent > 0);
    const loss = inBucket.filter(t => t.profitPercent <= 0);
    const winRate = (profit.length / inBucket.length * 100).toFixed(1);

    const avgProfit = inBucket.reduce((sum, t) => sum + t.profitPercent, 0) / inBucket.length;
    const maxProfit = Math.max(...inBucket.map(t => t.profitPercent));
    const minProfit = Math.min(...inBucket.map(t => t.profitPercent));

    console.log(`${bucket.label.padEnd(14)} ${inBucket.length.toString().padStart(4)}  ${profit.length.toString().padStart(4)}  ${loss.length.toString().padStart(4)}  ${winRate.padStart(5)}%  ${avgProfit.toFixed(2).padStart(9)}  ${maxProfit.toFixed(2).padStart(9)}  ${minProfit.toFixed(2).padStart(9)}`);
  });

  console.log('');
  console.log('');

  // 按质量分类统计trendCV
  console.log('【按质量分类的trendCV统计】\n');
  console.log('质量分类        数量  平均trendCV  平均收益%  盈利率');
  console.log('─'.repeat(55));

  const categories = [
    { key: 'high_quality', label: '🚀高质量' },
    { key: 'mid_quality', label: '📊中质量' },
    { key: 'low_quality', label: '📉低质量' },
    { key: 'fake_pump', label: '🎭流水盘' },
    { key: 'no_user', label: '👻无人玩' },
    { key: null, label: '❓未标注' }
  ];

  categories.forEach(cat => {
    const inCat = sortedTokens.filter(t => t.qualityCategory === cat.key);
    if (inCat.length === 0) return;

    const avgCV = inCat.reduce((sum, t) => sum + t.trendCV, 0) / inCat.length;
    const avgProfit = inCat.reduce((sum, t) => sum + t.profitPercent, 0) / inCat.length;
    const profit = inCat.filter(t => t.profitPercent > 0);
    const winRate = (profit.length / inCat.length * 100).toFixed(1);

    console.log(`${cat.label.padEnd(14)} ${inCat.length.toString().padStart(4)}  ${avgCV.toFixed(3).padStart(10)}  ${avgProfit.toFixed(2).padStart(9)}  ${winRate.padStart(5)}%`);
  });

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

listAllTrendCV().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
