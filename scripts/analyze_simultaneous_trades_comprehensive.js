/**
 * 扩大样本量分析"同时发生的交易"特征
 * 从实验中获取所有代币，进行统计分析
 */

const http = require('http');
const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

// 辅助函数：调用API
function callEarlyTradesAPI(tokenAddress, chain, timeWindowMinutes = 3) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      tokenAddress,
      chain,
      timeWindowMinutes,
      limit: 300
    });

    const options = {
      hostname: 'localhost',
      port: 3010,
      path: '/api/token-early-trades',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.success) {
            resolve(result.data);
          } else {
            reject(new Error(result.error || 'API调用失败'));
          }
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// 分析同时发生的交易
function analyzeSimultaneousTrades(trades, launchAt) {
  if (!trades || trades.length === 0) {
    return { totalTrades: 0, maxGroupSize: 0, totalSimultaneous: 0, avgGroupSize: 0 };
  }

  const threshold = 1; // 1秒内视为同时

  // 找出同时发生的交易组
  const simultaneousGroups = [];
  let currentGroup = [0];

  for (let i = 1; i < trades.length; i++) {
    const interval = trades[i].time - trades[i-1].time;
    if (interval <= threshold) {
      currentGroup.push(i);
    } else {
      if (currentGroup.length > 0) {
        simultaneousGroups.push([...currentGroup]);
      }
      currentGroup = [i];
    }
  }

  if (currentGroup.length > 0) {
    simultaneousGroups.push([...currentGroup]);
  }

  const maxGroupSize = Math.max(...simultaneousGroups.map(g => g.length), 0);
  const totalSimultaneous = simultaneousGroups.reduce((sum, g) => sum + (g.length > 1 ? g.length : 0), 0);
  const avgGroupSize = simultaneousGroups.length > 0
    ? simultaneousGroups.reduce((sum, g) => sum + g.length, 0) / simultaneousGroups.length
    : 0;

  return {
    totalTrades: trades.length,
    maxGroupSize,
    totalSimultaneous,
    avgGroupSize,
    simultaneousGroupsCount: simultaneousGroups.length
  };
}

async function comprehensiveAnalysis() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║          扩大样本量分析："同时发生的交易"特征识别拉盘砸盘                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取所有交易数据
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  // 计算代币收益
  const tokenTradeGroups = new Map();
  trades.forEach(trade => {
    if (!tokenTradeGroups.has(trade.token_address)) {
      tokenTradeGroups.set(trade.token_address, []);
    }
    tokenTradeGroups.get(trade.token_address).push(trade);
  });

  const tokenProfits = new Map();
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
      chain: buyTrades[0].chain || 'bsc',
      age: trendFactors.age || 0,
      trendRiseRatio: trendFactors.trendRiseRatio || 0,
      earlyReturn: trendFactors.earlyReturn || 0,
      hasSell: sellTrades.length > 0
    });
  }

  // 获取代币标注
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId);

  // 分类代币
  const highlyProfitable = []; // 高收益 > 100%
  const profitable = []; // 盈利 0-100%
  const breakEven = []; // 盈亏平衡 -10%到10%
  const smallLoss = []; // 小亏 -10%到-30%
  const bigLoss = []; // 大亏 < -30%

  tokenProfits.forEach((profit, addr) => {
    const tokenInfo = tokens?.find(t => t.token_address === addr);
    const humanJudges = tokenInfo?.human_judges || {};

    const tokenData = {
      addr,
      ...profit,
      category: humanJudges.category,
      qualityLabel: humanJudges.category
        ? { fake_pump: '🎭流水盘', no_user: '👻无人玩', low_quality: '📉低质量', mid_quality: '📊中质量', high_quality: '🚀高质量' }[humanJudges.category] || '❓未标注'
        : '❓未标注'
    };

    if (profit.profitPercent > 100) {
      highlyProfitable.push(tokenData);
    } else if (profit.profitPercent > 0) {
      profitable.push(tokenData);
    } else if (profit.profitPercent >= -10) {
      breakEven.push(tokenData);
    } else if (profit.profitPercent >= -30) {
      smallLoss.push(tokenData);
    } else {
      bigLoss.push(tokenData);
    }
  });

  console.log(`【代币分类统计】\n`);
  console.log(`高收益 (>100%):  ${highlyProfitable.length}个`);
  console.log(`盈利 (0-100%):   ${profitable.length}个`);
  console.log(`盈亏平衡:       ${breakEven.length}个`);
  console.log(`小亏 (-10~-30%):  ${smallLoss.length}个`);
  console.log(`大亏 (<-30%):    ${bigLoss.length}个`);
  console.log(`总计:            ${tokenProfits.size}个\n`);

  // 分析各类代币的同时交易特征
  const categories = [
    { name: '高收益', tokens: highlyProfitable, label: 'high_profit' },
    { name: '盈利', tokens: profitable, label: 'profitable' },
    { name: '小亏', tokens: smallLoss, label: 'small_loss' },
    { name: '大亏', tokens: bigLoss, label: 'big_loss' }
  ];

  const results = [];

  for (const category of categories) {
    if (category.tokens.length === 0) continue;

    console.log(`\n【${category.name}】分析 (${category.tokens.length}个代币)\n`);

    // 限制每个类别最多分析15个代币
    const tokensToAnalyze = category.tokens.slice(0, 15);

    for (let i = 0; i < tokensToAnalyze.length; i++) {
      const token = tokensToAnalyze[i];
      console.log(`  ${i + 1}. ${token.symbol} (${token.profitPercent.toFixed(1)}%)`);

      try {
        const data = await callEarlyTradesAPI(token.addr, token.chain, 3);
        const trades = data.earlyTrades || [];
        const launchAt = data.debug?.launchAt || data.tokenInfo?.token?.launch_at;

        const analysis = analyzeSimultaneousTrades(trades, launchAt);

        results.push({
          ...token,
          category: category.name,
          ...analysis
        });

        console.log(`     总交易: ${analysis.totalTrades}, 最大组: ${analysis.maxGroupSize}笔`);

      } catch (error) {
        console.error(`     ❌ 失败: ${error.message}`);
      }

      // 避免API限速
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // 统计分析
  console.log('\n\n');
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                          统计分析结果                                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 按类别统计
  console.log('【按收益类别统计】\n');
  console.log('类别          数量  最大组规模(平均)  同时交易总数(平均)  平均组规模');
  console.log('─'.repeat(80));

  const categoryStats = {};

  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat.name);
    if (catResults.length === 0) continue;

    const avgMaxGroup = catResults.reduce((sum, r) => sum + r.maxGroupSize, 0) / catResults.length;
    const avgTotalSimultaneous = catResults.reduce((sum, r) => sum + r.totalSimultaneous, 0) / catResults.length;
    const avgGroupSize = catResults.reduce((sum, r) => sum + r.avgGroupSize, 0) / catResults.length;

    categoryStats[cat.name] = {
      count: catResults.length,
      avgMaxGroup,
      avgTotalSimultaneous,
      avgGroupSize
    };

    console.log(`${cat.name.padEnd(14)} ${catResults.length.toString().padStart(6)}  ${avgMaxGroup.toFixed(1).padStart(14)}  ${avgTotalSimultaneous.toFixed(1).padStart(16)}  ${avgGroupSize.toFixed(1).padStart(12)}`);
  }

  // 详细数据
  console.log('\n\n');
  console.log('【详细数据：按最大组规模排序】\n');
  console.log('代币              类别      收益%    总交易  最大组  同时总数  平均规模');
  console.log('─'.repeat(80));

  results.sort((a, b) => b.maxGroupSize - a.maxGroupSize).forEach(r => {
    console.log(`${r.symbol.padEnd(16)} ${r.category.padEnd(10)} ${r.profitPercent.toFixed(1).padStart(7)}%  ${r.totalTrades.toString().padStart(6)}  ${r.maxGroupSize.toString().padStart(6)}  ${r.totalSimultaneous.toString().padStart(8)}  ${r.avgGroupSize.toFixed(1).padStart(8)}`);
  });

  // 寻找最佳阈值
  console.log('\n\n');
  console.log('【寻找最佳阈值】\n');

  const thresholds = [20, 30, 40, 50, 60, 80, 100, 150];

  console.log('最大组规模阈值    过滤后好票  过滤后坏票  好票保留率  坏票过滤率');
  console.log('─'.repeat(75));

  thresholds.forEach(threshold => {
    const goodTokens = results.filter(r => (r.profitPercent > 0) && (r.maxGroupSize < threshold));
    const badTokens = results.filter(r => (r.profitPercent <= 0) && (r.maxGroupSize < threshold));

    const totalGood = results.filter(r => r.profitPercent > 0).length;
    const totalBad = results.filter(r => r.profitPercent <= 0).length;

    const goodRetentionRate = totalGood > 0 ? (goodTokens.length / totalGood * 100) : 0;
    const badFilterRate = totalBad > 0 ? ((totalBad - badTokens.length) / totalBad * 100) : 0;

    console.log(`>${threshold.toString().padStart(3)}        ${goodTokens.length.toString().padStart(10)}  ${badTokens.length.toString().padStart(10)}  ${goodRetentionRate.toFixed(1).padStart(10)}%      ${badFilterRate.toFixed(1).padStart(8)}%`);
  });

  // 散点图数据
  console.log('\n\n');
  console.log('【散点图数据（用于可视化）】\n');

  results.forEach(r => {
    console.log(`${r.symbol},${r.category},${r.profitPercent.toFixed(2)},${r.maxGroupSize}`);
  });

  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

comprehensiveAnalysis().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
