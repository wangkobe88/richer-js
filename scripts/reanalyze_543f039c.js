/**
 * 重新完整分析实验543f039c的优化策略
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function reanalyze() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    重新分析实验543f039c                                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取交易数据
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  // 按代币分组并计算收益
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

    if (buyTrades.length === 0 || sellTrades.length === 0) continue;

    const firstBuy = buyTrades[0];
    const symbol = firstBuy.token_symbol;

    let totalBuy = 0, totalSell = 0;
    buyTrades.forEach(t => totalBuy += t.input_amount || 0);
    sellTrades.forEach(t => totalSell += t.output_amount || 0);

    const profit = totalSell - totalBuy;
    const profitPercent = (profit / totalBuy) * 100;

    const trend = firstBuy.metadata?.factors?.trendFactors || {};

    tokens.push({
      symbol,
      profitPercent,
      profit,
      ratio: trend.trendRiseRatio || 0,
      earlyReturn: trend.earlyReturn || 0,
      age: trend.age || 0,
      tvl: trend.tvl || 0,
      trendStrength: trend.trendStrengthScore || 0
    });
  }

  // 打印所有代币数据
  console.log('【所有代币数据】');
  console.log('');
  console.log('序号  代币              收益%     ratio   earlyReturn   age     tvl');
  console.log('─'.repeat(70));

  tokens.sort((a, b) => b.profitPercent - a.profitPercent);
  tokens.forEach((t, i) => {
    const profitColor = t.profitPercent >= 0 ? '\x1b[32m' : '\x1b[31m';
    const resetColor = '\x1b[0m';
    console.log(
      String(i+1).padStart(4) + '. ' +
      (t.symbol.padEnd(16)) +
      profitColor + t.profitPercent.toFixed(2).padStart(8) + '%' + resetColor +
      t.ratio.toFixed(2).padStart(8) +
      t.earlyReturn.toFixed(1).padStart(12) +
      t.age.toFixed(2).padStart(8) +
      t.tvl.toFixed(0).padStart(8)
    );
  });

  console.log('');
  console.log('');

  // 当前策略统计（所有15个代币）
  const currentTotal = tokens.reduce((sum, t) => sum + t.profit, 0);
  const currentAvg = tokens.reduce((sum, t) => sum + t.profitPercent, 0) / tokens.length;
  const currentWinCount = tokens.filter(t => t.profitPercent > 0).length;

  console.log('【当前策略（所有15个代币）】');
  console.log(`  交易数: 15`);
  console.log(`  总收益: ${currentTotal.toFixed(4)} BNB`);
  console.log(`  平均收益: ${currentAvg.toFixed(2)}%`);
  console.log(`  盈利数: ${currentWinCount}`);
  console.log('');

  // 测试各种策略
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    策略对比                                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const strategies = [
    { name: 'ratio>=0.7', filter: t => t.ratio >= 0.7 },
    { name: 'ratio>=0.8', filter: t => t.ratio >= 0.8 },
    { name: 'earlyReturn>100', filter: t => t.earlyReturn > 100 },
    { name: 'earlyReturn>200', filter: t => t.earlyReturn > 200 },
    { name: 'age<=2.0', filter: t => t.age <= 2.0 },
    { name: 'age<=2.5', filter: t => t.age <= 2.5 },
    { name: 'ratio>=0.7 && age<=2.5', filter: t => t.ratio >= 0.7 && t.age <= 2.5 },
    { name: 'ratio>=0.7 && earlyReturn>100', filter: t => t.ratio >= 0.7 && t.earlyReturn > 100 },
    { name: 'ratio>=0.8 && age<=2.0', filter: t => t.ratio >= 0.8 && t.age <= 2.0 },
  ];

  console.log('策略                           交易数  总收益BNB  平均收益%  盈利数  胜率');
  console.log('─'.repeat(75));

  strategies.forEach(s => {
    const filtered = tokens.filter(s.filter);
    if (filtered.length === 0) return;

    const total = filtered.reduce((sum, t) => sum + t.profit, 0);
    const avg = filtered.reduce((sum, t) => sum + t.profitPercent, 0) / filtered.length;
    const winCount = filtered.filter(t => t.profitPercent > 0).length;
    const winRate = (winCount / filtered.length * 100);

    const totalDiff = ((total - currentTotal) / currentTotal * 100).toFixed(1);
    const totalColor = total >= currentTotal ? '\x1b[32m' : '\x1b[31m';
    const resetColor = '\x1b[0m';

    console.log(
      `${s.name.padEnd(30)} ${filtered.length.toString().padStart(4)} ${totalColor}${total.toFixed(4)}${resetColor.padStart(10)} ${avg.toFixed(2).padStart(8)} ${winCount.toString().padStart(6)} ${winRate.toFixed(1)}%  (${totalDiff}%)`
    );
  });

  console.log('');
  console.log('');

  // 详细分析每个策略保留/过滤的代币
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    策略详细分析                                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const detailStrategies = [
    { name: 'ratio>=0.7', filter: t => t.ratio >= 0.7 },
    { name: 'ratio>=0.8', filter: t => t.ratio >= 0.8 },
  ];

  detailStrategies.forEach(s => {
    const passed = tokens.filter(s.filter);
    const filteredOut = tokens.filter(t => !s.filter(t));

    console.log(`【${s.name}】`);
    console.log(`  保留 (${passed.length}个): ${passed.map(t => t.symbol).join(', ')}`);

    if (filteredOut.length > 0) {
      const totalLost = filteredOut.reduce((sum, t) => sum + t.profit, 0);
      console.log(`  过滤 (${filteredOut.length}个): ${filteredOut.map(t => `${t.symbol}(${t.profitPercent.toFixed(1)}%)`).join(', ')}`);
      console.log(`  过滤掉的总收益: ${totalLost.toFixed(4)} BNB`);
    }
    console.log('');
  });

  console.log('═══════════════════════════════════════════════════════════════════════════');
}

reanalyze().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
