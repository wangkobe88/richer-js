/**
 * 对比分析"快速拉砸"代币和好票的早期交易原始数据
 * 修正：只观察购买决策时点之前的数据（0-1.5分钟）
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();
const { AveTokenAPI, AveTxAPI } = require('../src/core/ave-api');
const config = require('../config/default.json');

// 辅助函数：转换为北京时间
function toBeijingTime(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp * 1000);
  const beijingTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return beijingTime.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').substring(0, 19);
}

async function getEarlyTrades(tokenAddress, chain, buyTimeMinutes) {
  // 只取购买决策时点之前的数据
  const timeWindowMinutes = Math.ceil(buyTimeMinutes * 100) / 100; // 向上取整

  try {
    const tokenId = `${tokenAddress}-${chain}`;
    const tokenApi = new AveTokenAPI(config.ave?.apiUrl, config.ave?.timeout || 30000, process.env.AVE_API_KEY);
    const txApi = new AveTxAPI(config.ave?.apiUrl, config.ave?.timeout || 30000, process.env.AVE_API_KEY);

    // 获取代币详情
    const tokenDetail = await tokenApi.getTokenDetail(tokenId);
    const { token, pairs } = tokenDetail;

    // 获取platform
    let platform = null;
    const { data: tokenRecord } = await supabase
      .from('experiment_tokens')
      .select('platform')
      .eq('token_address', tokenAddress)
      .eq('chain', chain)
      .limit(1)
      .maybeSingle();

    platform = tokenRecord?.platform || token.platform || 'fourmeme';

    // 构造pair
    let innerPair;
    if (platform === 'fourmeme') {
      innerPair = `${tokenAddress}_fo`;
    } else if (platform === 'flap') {
      innerPair = `${tokenAddress}_iportal`;
    } else {
      innerPair = token.main_pair || (pairs?.[0]?.pair);
    }

    const launchAt = token.launch_at || token.created_at;
    const fromTime = launchAt;
    const toTime = launchAt + (timeWindowMinutes * 60);

    console.log(`    📊 获取早期交易: ${token.symbol || tokenAddress}`);
    console.log(`       购买时点: ${buyTimeMinutes.toFixed(2)}分`);
    console.log(`       观察窗口: 0 - ${timeWindowMinutes}分钟 (${toBeijingTime(fromTime)} - ${toBeijingTime(toTime)})`);

    // 获取交易（使用分页获取所有数据，与web-server.js的token-early-trades API相同）
    const pairId = `${innerPair}-${chain}`;
    const allTrades = [];
    let currentToTime = toTime;
    let pageCount = 0;
    const MAX_PAGES = 10;

    while (pageCount < MAX_PAGES) {
      const trades = await txApi.getSwapTransactions(
        pairId,
        300,        // limit - 每次最多300条
        fromTime,   // fromTime - 代币创建时间
        currentToTime,  // toTime - 当前查询的结束时间
        'asc'       // sort - 按时间升序
      );

      pageCount++;

      if (trades.length === 0) {
        break;
      }

      allTrades.push(...trades);

      // 如果返回少于300条，说明已经取完所有数据
      if (trades.length < 300) {
        break;
      }

      // 返回了300条，可能还有更早的数据，继续向前查询
      // 新的 toTime = 当前结果第一条交易时间 - 1（向前1秒）
      currentToTime = trades[0].time - 1;

      // 安全检查：如果 toTime 已经早于 fromTime，停止查询
      if (currentToTime < fromTime) {
        break;
      }
    }

    // 按时间排序确保顺序正确
    allTrades.sort((a, b) => a.time - b.time);

    const rawTrades = allTrades;

    console.log(`       分页查询${pageCount}次，获取${rawTrades.length}条交易`);

    // 解析交易：判断是买入还是卖出
    // 使用与web-server.js相同的逻辑
    console.log(`       调试：tokenAddress=${tokenAddress.substring(0, 10)}...`);
    console.log(`       调试：前3笔交易的from_token/to_token:`);
    rawTrades.slice(0, 3).forEach((t, i) => {
      console.log(`         ${i+1}. from_token=${t.from_token?.substring(0, 10)}... to_token=${t.to_token?.substring(0, 10)}...`);
    });

    const trades = rawTrades.map(t => {
      // 检查目标代币是否是新代币（买入）
      // 注意：AVE API的字段是 from_token 和 to_token
      const isBuy = t.to_token?.toLowerCase() === tokenAddress.toLowerCase();

      // 获取新代币的数量和价格
      let newTokenAmount, newTokenPrice, otherTokenAmount, type;

      if (isBuy) {
        // 买入：to_token是新代币
        newTokenAmount = t.to_amount;
        newTokenPrice = t.to_token_price_usd;
        otherTokenAmount = t.from_amount;
        type = 'buy';
      } else {
        // 卖出：from_token是新代币
        newTokenAmount = t.from_amount;
        newTokenPrice = t.from_token_price_usd;
        otherTokenAmount = t.to_amount;
        type = 'sell';
      }

      return {
        time: t.time,
        type,
        price: newTokenPrice || 0,
        amount: newTokenAmount || 0,
        usd_value: t.from_usd || t.to_usd || 0,
        wallet: t.wallet_address || t.from_address || '',
        tx_id: t.tx_id
      };
    });

    // 按时间排序并过滤：只保留购买时点之前的交易
    trades.sort((a, b) => a.time - b.time);
    const filteredTrades = trades.filter(t => t.time <= toTime);
    const filteredRawTrades = rawTrades.filter(t => t.time <= toTime);

    console.log(`       获取交易数: ${trades.length}, 过滤后: ${filteredTrades.length}`);

    return {
      token: tokenDetail,
      trades: filteredTrades,
      rawTrades: filteredRawTrades,
      platform,
      innerPair,
      launchAt,
      fromTime,
      toTime,
      buyTimeMinutes
    };
  } catch (error) {
    console.error(`    ❌ 获取早期交易失败: ${error.message}`);
    return null;
  }
}

function analyzeEarlyTradePatterns(earlyTradesData) {
  if (!earlyTradesData || earlyTradesData.trades.length === 0) {
    return null;
  }

  const trades = earlyTradesData.trades;
  const buyTimeMinutes = earlyTradesData.buyTimeMinutes;

  // 基本统计
  const buyTrades = trades.filter(t => t.type === 'buy');
  const sellTrades = trades.filter(t => t.type === 'sell');

  // 计算每个钱包的交易
  const walletStats = new Map();
  trades.forEach(t => {
    const wallet = t.wallet || 'unknown';
    if (!walletStats.has(wallet)) {
      walletStats.set(wallet, { buy: 0, sell: 0, volume: 0, firstTime: t.time, lastTime: t.time, usdValue: 0 });
    }
    const stat = walletStats.get(wallet);
    if (t.type === 'buy') {
      stat.buy++;
      stat.volume += t.amount;
    } else {
      stat.sell++;
      stat.volume += t.amount;
    }
    stat.usdValue += t.usd_value;
    stat.firstTime = Math.min(stat.firstTime, t.time);
    stat.lastTime = Math.max(stat.lastTime, t.time);
  });

  // 按交易量排序
  const sortedWallets = Array.from(walletStats.entries())
    .sort((a, b) => b[1].usdValue - a[1].usdValue)
    .slice(0, 20);

  // 价格序列分析
  const priceSequence = trades.filter(t => t.price > 0).map(t => ({
    time: t.time,
    price: t.price,
    type: t.type,
    amount: t.amount,
    usdValue: t.usd_value
  }));

  // 计算价格波动
  let cv = 0, priceChange = 0, avgPrice = 0, stdDev = 0;
  if (priceSequence.length > 1) {
    const prices = priceSequence.map(p => p.price);
    avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - avgPrice, 2), 0) / prices.length;
    stdDev = Math.sqrt(variance);
    cv = stdDev / avgPrice;

    // 价格走势（从开始到购买时点）
    const firstPrice = priceSequence[0].price;
    const lastPrice = priceSequence[priceSequence.length - 1].price;
    priceChange = ((lastPrice - firstPrice) / firstPrice) * 100;
  }

  // 买入vs卖出金额分析
  const buyUsdValues = trades.filter(t => t.type === 'buy').map(t => t.usd_value);
  const sellUsdValues = trades.filter(t => t.type === 'sell').map(t => t.usd_value);
  const totalBuyUsd = buyUsdValues.reduce((a, b) => a + b, 0);
  const totalSellUsd = sellUsdValues.reduce((a, b) => a + b, 0);
  const avgBuyUsd = buyUsdValues.length > 0 ? totalBuyUsd / buyUsdValues.length : 0;
  const avgSellUsd = sellUsdValues.length > 0 ? totalSellUsd / sellUsdValues.length : 0;

  // 净流入（买入USD - 卖出USD）
  const netInflow = totalBuyUsd - totalSellUsd;

  // 买卖时间分布分析
  const buyTimes = trades.filter(t => t.type === 'buy').map(t => t.time);
  const sellTimes = trades.filter(t => t.type === 'sell').map(t => t.time);

  // 首次卖出时间（相对于首次买入）
  let firstSellAfterBuy = null;
  if (buyTimes.length > 0 && sellTimes.length > 0) {
    const firstBuyTime = Math.min(...buyTimes);
    const firstSellTime = Math.min(...sellTimes);
    firstSellAfterBuy = (firstSellTime - firstBuyTime) / 60; // 分钟
  }

  // 集中度分析：前N个钱包的交易占比
  const top3WalletsUsd = sortedWallets.slice(0, Math.min(3, sortedWallets.length))
    .reduce((sum, [, stat]) => sum + stat.usdValue, 0);
  const totalUsd = trades.reduce((sum, t) => sum + t.usd_value, 0);
  const top3Concentration = totalUsd > 0 ? (top3WalletsUsd / totalUsd) : 0;

  // 计算每分钟的交易数据
  const timeSpanMinutes = buyTimeMinutes;
  const tradesPerMin = trades.length / timeSpanMinutes;
  const buysPerMin = buyTrades.length / timeSpanMinutes;
  const sellsPerMin = sellTrades.length / timeSpanMinutes;
  const usdPerMin = totalUsd / timeSpanMinutes;

  // 计算每分钟活跃钱包数
  const uniqueWalletsPerMin = walletStats.size / timeSpanMinutes;

  // 分析开头交易模式：前N笔交易的买入占比
  const firstN = 10;
  const firstNTrades = trades.slice(0, Math.min(firstN, trades.length));
  const firstNBuyCount = firstNTrades.filter(t => t.type === 'buy').length;
  const firstNBuyRatio = firstNTrades.length > 0 ? (firstNBuyCount / firstNTrades.length) : 0;

  // 前3笔交易的买入占比
  const first3Trades = trades.slice(0, Math.min(3, trades.length));
  const first3BuyCount = first3Trades.filter(t => t.type === 'buy').length;
  const first3BuyRatio = first3Trades.length > 0 ? (first3BuyCount / first3Trades.length) : 0;

  // 开头连续卖出次数
  let leadingSells = 0;
  for (const t of trades) {
    if (t.type === 'sell') {
      leadingSells++;
    } else {
      break;
    }
  }

  return {
    totalTrades: trades.length,
    buyCount: buyTrades.length,
    sellCount: sellTrades.length,
    uniqueWallets: walletStats.size,
    topWallets: sortedWallets,
    avgPrice,
    stdDev,
    cv,
    priceChange,
    avgBuyUsd,
    avgSellUsd,
    totalBuyUsd,
    totalSellUsd,
    netInflow,
    buySellRatio: sellTrades.length > 0 ? (buyTrades.length / sellTrades.length) : buyTrades.length,
    buySellUsdRatio: totalSellUsd > 0 ? (totalBuyUsd / totalSellUsd) : (totalBuyUsd > 0 ? Infinity : 0),
    firstSellAfterBuy,
    top3Concentration,
    tradesPerMin,
    buysPerMin,
    sellsPerMin,
    usdPerMin,
    uniqueWalletsPerMin,
    firstNBuyRatio,
    first3BuyRatio,
    leadingSells,
    priceSequence: priceSequence.slice(0, 50),
    buyTimeMinutes
  };
}

async function comparePumpDumpVsGoodTokens() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║     快速拉砸 vs 好票：购买决策前的早期交易原始数据对比分析                 ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取交易数据
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  // 获取信号数据（获取购买时间）
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .order('created_at', { ascending: true });

  // 计算收益
  const tokenTradeGroups = new Map();
  trades.forEach(trade => {
    if (!tokenTradeGroups.has(trade.token_address)) {
      tokenTradeGroups.set(trade.token_address, []);
    }
    tokenTradeGroups.get(trade.token_address).push(trade);
  });

  const tokenProfits = new Map();
  const tokenBuyTimes = new Map();

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
      earlyReturn: trendFactors.earlyReturn || 0
    });

    // 获取购买时间（从信号中）
    const signal = signals.find(s => s.token_address === addr);
    if (signal && signal.created_at) {
      const buyTime = new Date(signal.created_at).getTime() / 1000;
      // 从token数据获取launch_at
      const { data: tokenData } = await supabase
        .from('experiment_tokens')
        .select('launch_at, created_at')
        .eq('token_address', addr)
        .limit(1)
        .maybeSingle();

      const launchAt = tokenData?.launch_at || tokenData?.created_at;
      if (launchAt) {
        const buyTimeMinutes = (buyTime - launchAt) / 60;
        tokenBuyTimes.set(addr, buyTimeMinutes);
      }
    }
  }

  // 获取代币标注
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId);

  // 分类代币
  const pumpDumpCandidates = []; // 快速拉砸候选
  const goodTokens = []; // 好票

  tokenProfits.forEach((profit, addr) => {
    const tokenInfo = tokens?.find(t => t.token_address === addr);
    const humanJudges = tokenInfo?.human_judges || {};
    const buyTimeMinutes = tokenBuyTimes.get(addr) || profit.age;

    // 快速拉砸特征：大亏、age小、earlyReturn高（曾经涨过）
    if (profit.profitPercent < -20 && buyTimeMinutes < 3 && profit.earlyReturn > 100) {
      pumpDumpCandidates.push({
        addr,
        ...profit,
        category: humanJudges.category,
        buyTimeMinutes
      });
    }
    // 好票特征：大赚、age小
    else if (profit.profitPercent > 50 && buyTimeMinutes < 3) {
      goodTokens.push({
        addr,
        ...profit,
        category: humanJudges.category,
        buyTimeMinutes
      });
    }
  });

  // 按亏损和收益排序
  pumpDumpCandidates.sort((a, b) => a.profitPercent - b.profitPercent);
  goodTokens.sort((a, b) => b.profitPercent - a.profitPercent);

  console.log(`【快速拉砸候选】\n`);
  console.log(`找到 ${pumpDumpCandidates.length} 个候选代币\n`);

  // 获取早期交易数据并分析
  const analysisResults = {
    pumpDump: [],
    good: []
  };

  // 分析快速拉砸代币（最多3个）
  console.log('【分析快速拉砸代币】\n');
  for (let i = 0; i < Math.min(3, pumpDumpCandidates.length); i++) {
    const token = pumpDumpCandidates[i];
    console.log(`\n${i + 1}. ${token.symbol} (${token.addr.substring(0, 10)}...)`);
    console.log(`   收益: ${token.profitPercent.toFixed(2)}%, 购买时点: ${token.buyTimeMinutes.toFixed(2)}分, EarlyReturn: ${token.earlyReturn.toFixed(1)}%`);

    const earlyTradesData = await getEarlyTrades(token.addr, token.chain, token.buyTimeMinutes);
    if (earlyTradesData) {
      const patterns = analyzeEarlyTradePatterns(earlyTradesData);
      if (patterns) {
        analysisResults.pumpDump.push({
          symbol: token.symbol,
          addr: token.addr,
          profitPercent: token.profitPercent,
          patterns
        });

        console.log(`   交易统计 (购买前):`);
        console.log(`     总交易: ${patterns.totalTrades}, 买入: ${patterns.buyCount}, 卖出: ${patterns.sellCount}`);
        console.log(`     唯一钱包: ${patterns.uniqueWallets}`);
        console.log(`     前3笔买入占比: ${(patterns.first3BuyRatio * 100).toFixed(0)}%, 前10笔买入占比: ${(patterns.firstNBuyRatio * 100).toFixed(0)}%`);
        console.log(`     开头连续卖出: ${patterns.leadingSells}笔`);
        console.log(`     价格变化: ${patterns.priceChange.toFixed(2)}%, CV: ${patterns.cv.toFixed(3)}`);
        console.log(`     交易/分钟: ${patterns.tradesPerMin.toFixed(1)}, 钱包/分钟: ${patterns.uniqueWalletsPerMin.toFixed(1)}`);
        console.log(`     买卖比: ${patterns.buySellRatio.toFixed(2)} (数量), ${patterns.buySellUsdRatio.toFixed(2)} (金额)`);
        console.log(`     买入总USD: ${patterns.totalBuyUsd.toFixed(0)}, 卖出总USD: ${patterns.totalSellUsd.toFixed(0)}`);
        console.log(`     净流入: ${patterns.netInflow.toFixed(0)} USD`);
        console.log(`     USD/分钟: ${patterns.usdPerMin.toFixed(0)}`);
        console.log(`     前3钱包集中度: ${(patterns.top3Concentration * 100).toFixed(1)}%`);
        if (patterns.firstSellAfterBuy !== null) {
          console.log(`     首次卖出距买入: ${patterns.firstSellAfterBuy.toFixed(2)}分钟`);
        }

        // 显示前5个钱包
        console.log(`   Top 5 钱包:`);
        patterns.topWallets.slice(0, 5).forEach(([wallet, stat]) => {
          const walletShort = wallet.substring(0, 10);
          console.log(`     ${walletShort}...: 买入${stat.buy}, 卖出${stat.sell}, USD${stat.usdValue.toFixed(0)}`);
        });
      }
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n');
  console.log('【分析好票】\n');

  // 分析好票（最多3个）
  for (let i = 0; i < Math.min(3, goodTokens.length); i++) {
    const token = goodTokens[i];
    console.log(`\n${i + 1}. ${token.symbol} (${token.addr.substring(0, 10)}...)`);
    console.log(`   收益: ${token.profitPercent.toFixed(2)}%, 购买时点: ${token.buyTimeMinutes.toFixed(2)}分, EarlyReturn: ${token.earlyReturn.toFixed(1)}%`);

    const earlyTradesData = await getEarlyTrades(token.addr, token.chain, token.buyTimeMinutes);
    if (earlyTradesData) {
      const patterns = analyzeEarlyTradePatterns(earlyTradesData);
      if (patterns) {
        analysisResults.good.push({
          symbol: token.symbol,
          addr: token.addr,
          profitPercent: token.profitPercent,
          patterns
        });

        console.log(`   交易统计 (购买前):`);
        console.log(`     总交易: ${patterns.totalTrades}, 买入: ${patterns.buyCount}, 卖出: ${patterns.sellCount}`);
        console.log(`     唯一钱包: ${patterns.uniqueWallets}`);
        console.log(`     前3笔买入占比: ${(patterns.first3BuyRatio * 100).toFixed(0)}%, 前10笔买入占比: ${(patterns.firstNBuyRatio * 100).toFixed(0)}%`);
        console.log(`     开头连续卖出: ${patterns.leadingSells}笔`);
        console.log(`     价格变化: ${patterns.priceChange.toFixed(2)}%, CV: ${patterns.cv.toFixed(3)}`);
        console.log(`     交易/分钟: ${patterns.tradesPerMin.toFixed(1)}, 钱包/分钟: ${patterns.uniqueWalletsPerMin.toFixed(1)}`);
        console.log(`     买卖比: ${patterns.buySellRatio.toFixed(2)} (数量), ${patterns.buySellUsdRatio.toFixed(2)} (金额)`);
        console.log(`     买入总USD: ${patterns.totalBuyUsd.toFixed(0)}, 卖出总USD: ${patterns.totalSellUsd.toFixed(0)}`);
        console.log(`     净流入: ${patterns.netInflow.toFixed(0)} USD`);
        console.log(`     USD/分钟: ${patterns.usdPerMin.toFixed(0)}`);
        console.log(`     前3钱包集中度: ${(patterns.top3Concentration * 100).toFixed(1)}%`);
        if (patterns.firstSellAfterBuy !== null) {
          console.log(`     首次卖出距买入: ${patterns.firstSellAfterBuy.toFixed(2)}分钟`);
        }

        // 显示前5个钱包
        console.log(`   Top 5 钱包:`);
        patterns.topWallets.slice(0, 5).forEach(([wallet, stat]) => {
          const walletShort = wallet.substring(0, 10);
          console.log(`     ${walletShort}...: 买入${stat.buy}, 卖出${stat.sell}, USD${stat.usdValue.toFixed(0)}`);
        });
      }
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  // 对比分析
  console.log('\n\n');
  console.log('【对比分析：快速拉砸 vs 好票（购买决策前）】\n');

  const avgPumpDump = analysisResults.pumpDump.length > 0 ? {
    totalTrades: analysisResults.pumpDump.reduce((sum, t) => sum + t.patterns.totalTrades, 0) / analysisResults.pumpDump.length,
    uniqueWallets: analysisResults.pumpDump.reduce((sum, t) => sum + t.patterns.uniqueWallets, 0) / analysisResults.pumpDump.length,
    priceChange: analysisResults.pumpDump.reduce((sum, t) => sum + t.patterns.priceChange, 0) / analysisResults.pumpDump.length,
    cv: analysisResults.pumpDump.reduce((sum, t) => sum + t.patterns.cv, 0) / analysisResults.pumpDump.length,
    buySellUsdRatio: analysisResults.pumpDump.reduce((sum, t) => sum + (t.patterns.buySellUsdRatio === Infinity ? 10 : t.patterns.buySellUsdRatio), 0) / analysisResults.pumpDump.length,
    netInflow: analysisResults.pumpDump.reduce((sum, t) => sum + t.patterns.netInflow, 0) / analysisResults.pumpDump.length,
    top3Concentration: analysisResults.pumpDump.reduce((sum, t) => sum + t.patterns.top3Concentration, 0) / analysisResults.pumpDump.length,
    tradesPerMin: analysisResults.pumpDump.reduce((sum, t) => sum + t.patterns.tradesPerMin, 0) / analysisResults.pumpDump.length,
    uniqueWalletsPerMin: analysisResults.pumpDump.reduce((sum, t) => sum + t.patterns.uniqueWalletsPerMin, 0) / analysisResults.pumpDump.length,
    usdPerMin: analysisResults.pumpDump.reduce((sum, t) => sum + t.patterns.usdPerMin, 0) / analysisResults.pumpDump.length,
    first3BuyRatio: analysisResults.pumpDump.reduce((sum, t) => sum + t.patterns.first3BuyRatio, 0) / analysisResults.pumpDump.length,
    firstNBuyRatio: analysisResults.pumpDump.reduce((sum, t) => sum + t.patterns.firstNBuyRatio, 0) / analysisResults.pumpDump.length,
    leadingSells: analysisResults.pumpDump.reduce((sum, t) => sum + t.patterns.leadingSells, 0) / analysisResults.pumpDump.length
  } : null;

  const avgGood = analysisResults.good.length > 0 ? {
    totalTrades: analysisResults.good.reduce((sum, t) => sum + t.patterns.totalTrades, 0) / analysisResults.good.length,
    uniqueWallets: analysisResults.good.reduce((sum, t) => sum + t.patterns.uniqueWallets, 0) / analysisResults.good.length,
    priceChange: analysisResults.good.reduce((sum, t) => sum + t.patterns.priceChange, 0) / analysisResults.good.length,
    cv: analysisResults.good.reduce((sum, t) => sum + t.patterns.cv, 0) / analysisResults.good.length,
    buySellUsdRatio: analysisResults.good.reduce((sum, t) => sum + (t.patterns.buySellUsdRatio === Infinity ? 10 : t.patterns.buySellUsdRatio), 0) / analysisResults.good.length,
    netInflow: analysisResults.good.reduce((sum, t) => sum + t.patterns.netInflow, 0) / analysisResults.good.length,
    top3Concentration: analysisResults.good.reduce((sum, t) => sum + t.patterns.top3Concentration, 0) / analysisResults.good.length,
    tradesPerMin: analysisResults.good.reduce((sum, t) => sum + t.patterns.tradesPerMin, 0) / analysisResults.good.length,
    uniqueWalletsPerMin: analysisResults.good.reduce((sum, t) => sum + t.patterns.uniqueWalletsPerMin, 0) / analysisResults.good.length,
    usdPerMin: analysisResults.good.reduce((sum, t) => sum + t.patterns.usdPerMin, 0) / analysisResults.good.length,
    first3BuyRatio: analysisResults.good.reduce((sum, t) => sum + t.patterns.first3BuyRatio, 0) / analysisResults.good.length,
    firstNBuyRatio: analysisResults.good.reduce((sum, t) => sum + t.patterns.firstNBuyRatio, 0) / analysisResults.good.length,
    leadingSells: analysisResults.good.reduce((sum, t) => sum + t.patterns.leadingSells, 0) / analysisResults.good.length
  } : null;

  if (avgPumpDump && avgGood) {
    console.log('指标                              快速拉砸平均    好票平均      差异      分析');
    console.log('─'.repeat(95));

    const metrics = [
      { key: 'totalTrades', name: '总交易数', highBad: false },
      { key: 'uniqueWallets', name: '唯一钱包数', highBad: false },
      { key: 'priceChange', name: '价格变化%', highBad: false },
      { key: 'cv', name: '价格变异系数', highBad: false },
      { key: 'buySellUsdRatio', name: '买卖USD比例', highBad: false },
      { key: 'netInflow', name: '净流入(USD)', highBad: false },
      { key: 'top3Concentration', name: '前3钱包集中度', highBad: true },
      { key: 'tradesPerMin', name: '交易数/分钟', highBad: false },
      { key: 'uniqueWalletsPerMin', name: '钱包数/分钟', highBad: false },
      { key: 'usdPerMin', name: 'USD/分钟', highBad: false },
      { key: 'first3BuyRatio', name: '前3笔买入占比', highBad: true },
      { key: 'firstNBuyRatio', name: '前10笔买入占比', highBad: true },
      { key: 'leadingSells', name: '开头连续卖出数', highBad: true }
    ];

    metrics.forEach(({ key, name, highBad }) => {
      const pumpValue = avgPumpDump[key];
      const goodValue = avgGood[key];
      const diff = pumpValue - goodValue;
      const diffPercent = goodValue !== 0 ? (diff / goodValue * 100) : 0;

      let analysis = '';
      if (key === 'top3Concentration' && pumpValue > goodValue * 1.3) {
        analysis = '⚠️ 拉砸的集中度高（大户控盘）';
      }
      if (key === 'tradesPerMin' && pumpValue > goodValue * 1.5) {
        analysis = '⚠️ 拉砸的交易频率异常高';
      }
      if (key === 'usdPerMin' && pumpValue > goodValue * 1.5) {
        analysis = '⚠️ 拉砸的资金涌入异常快';
      }
      if (key === 'first3BuyRatio' && pumpValue < goodValue * 0.5) {
        analysis = '⚠️ 拉砸的前3笔买入占比低';
      }
      if (key === 'leadingSells' && pumpValue > goodValue + 1) {
        analysis = '⚠️ 拉砸的开头连续卖出多';
      }

      console.log(`${name.padEnd(34)} ${pumpValue.toFixed(2).padStart(12)} ${goodValue.toFixed(2).padStart(12)} ${diff.toFixed(2).padStart(10)}  ${analysis}`);
    });
  }

  console.log('\n');
  console.log('【详细价格序列分析】\n');

  // 输出价格序列
  analysisResults.pumpDump.forEach(token => {
    console.log(`${token.symbol} 价格序列 (前20笔, 购买前${token.patterns.buyTimeMinutes.toFixed(2)}分):`);
    token.patterns.priceSequence.slice(0, 20).forEach((p, i) => {
      const timeFromStart = (p.time - token.patterns.priceSequence[0].time) / 60;
      console.log(`  ${i + 1}. +${timeFromStart.toFixed(2)}分 ${p.type === 'buy' ? '买入' : '卖出 '} 价格:${p.price.toFixed(6)} 数量:${p.amount.toFixed(0)} USD:${p.usdValue.toFixed(0)}`);
    });
    console.log('');
  });

  console.log('');
  analysisResults.good.forEach(token => {
    console.log(`${token.symbol} 价格序列 (前20笔, 购买前${token.patterns.buyTimeMinutes.toFixed(2)}分):`);
    token.patterns.priceSequence.slice(0, 20).forEach((p, i) => {
      const timeFromStart = (p.time - token.patterns.priceSequence[0].time) / 60;
      console.log(`  ${i + 1}. +${timeFromStart.toFixed(2)}分 ${p.type === 'buy' ? '买入' : '卖出 '} 价格:${p.price.toFixed(6)} 数量:${p.amount.toFixed(0)} USD:${p.usdValue.toFixed(0)}`);
    });
    console.log('');
  });

  console.log('═══════════════════════════════════════════════════════════════════════════');
}

comparePumpDumpVsGoodTokens().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
