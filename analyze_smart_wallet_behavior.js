/**
 * 分析特定"聪明钱包"的行为模式
 * 区分"收割流动性" vs "带单进场"
 */

const { createClient } = require('@supabase/supabase-js');
const { AveTxAPI } = require('./src/core/ave-api/tx-api');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const txApi = new AveTxAPI(
  process.env.AVE_API_BASE_URL || 'https://prod.ave-api.com',
  30000,
  process.env.AVE_API_KEY
);

// 用户提供的聪明钱包地址
const smartWallets = [
  '0xa83b73f5644cde337b61da79589f10ea15548811',
  '0x38e47fece3ea323e864c65410f6458c820eaa897',
  '0xbf004bff64725914ee36d03b87d6965b0ced4903'
];

const experiments = [
  { id: '6b17ff18-002d-4ce0-a745-b8e02676abd4', name: '实验1' },
  { id: '1dde2be5-2f4e-49fb-9520-cb032e9ef759', name: '实验2' }
];

/**
 * 分析特定钱包在代币中的行为
 */
async function analyzeSmartWalletInToken(tokenAddress, checkTime, smartWallet) {
  const targetFromTime = checkTime - 90;
  const innerPair = `${tokenAddress}_fo`;
  const pairId = `${innerPair}-bsc`;

  try {
    const allTrades = [];
    let currentToTime = checkTime;

    for (let loop = 1; loop <= 10; loop++) {
      const trades = await txApi.getSwapTransactions(
        pairId, 300, targetFromTime, currentToTime, 'asc'
      );
      if (trades.length === 0) break;
      allTrades.push(...trades);
      if (trades[0].time <= targetFromTime || trades.length < 300) break;
      currentToTime = trades[0].time - 1;
    }

    // 去重
    const uniqueTrades = [];
    const seen = new Set();
    for (const trade of allTrades.sort((a, b) => a.time - b.time)) {
      const key = trade.tx_id || `${trade.time}_${trade.from_address}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueTrades.push(trade);
      }
    }

    // 找到最早的交易时间作为基准
    const earliestTime = Math.min(...uniqueTrades.map(t => t.time));
    const windowStart = earliestTime;

    // 定义"前期交易"：前30笔交易（或前20%的交易，取较小值）
    const earlyTradeCount = Math.min(30, Math.floor(uniqueTrades.length * 0.2));
    const earlyTradeEndTime = uniqueTrades[earlyTradeCount - 1]?.time || (uniqueTrades[uniqueTrades.length - 1]?.time || windowStart);

    // 分析目标钱包的交易
    const baseCurrencies = ['WBNB', 'USDT', 'BUSD', 'USDC', 'ETH'];
    const walletTrades = uniqueTrades.filter(t =>
      t.wallet_address?.toLowerCase() === smartWallet.toLowerCase()
    );

    if (walletTrades.length === 0) {
      return null;
    }

    // 分析买入和卖出
    const buyTrades = walletTrades.filter(t => {
      const fromToken = t.from_token_symbol;
      return fromToken && baseCurrencies.includes(fromToken);
    });

    const sellTrades = walletTrades.filter(t => {
      const toToken = t.to_token_symbol;
      return toToken && baseCurrencies.includes(toToken);
    });

    if (buyTrades.length === 0) {
      return null;
    }

    const firstBuy = buyTrades[0];
    const firstBuyTime = firstBuy.time - windowStart;
    const firstBuyPrice = firstBuy.from_usd / firstBuy.to_amount; // USD per token
    const totalBuyAmount = buyTrades.reduce((sum, t) => sum + (t.from_usd || 0), 0);
    const totalBuyTokens = buyTrades.reduce((sum, t) => sum + (t.to_amount || 0), 0);

    // 判断是否是"极早期"参与（前期30笔交易内）
    const isUltraEarly = firstBuy.time <= earlyTradeEndTime;

    // 计算买入时的相对位置（第几笔交易）
    const buyTradeIndex = uniqueTrades.findIndex(t => t.tx_id === firstBuy.tx_id);
    const buyTradePosition = buyTradeIndex >= 0 ? buyTradeIndex + 1 : uniqueTrades.length;

    let sellInfo = null;
    if (sellTrades.length > 0) {
      const firstSell = sellTrades[0];
      const firstSellTime = firstSell.time - windowStart;
      const firstSellPrice = firstSell.to_amount / firstSell.from_amount; // USD per token
      const totalSellAmount = sellTrades.reduce((sum, t) => sum + (t.to_usd || 0), 0);
      const totalSellTokens = sellTrades.reduce((sum, t) => sum + (t.from_amount || 0), 0);
      const holdTime = firstSellTime - firstBuyTime;
      const priceIncrease = ((firstSellPrice - firstBuyPrice) / firstBuyPrice) * 100;
      const profit = totalSellAmount - totalBuyAmount;

      sellInfo = {
        firstSellTime: firstSellTime.toFixed(1),
        sellPrice: firstSellPrice.toFixed(8),
        totalSellAmount: totalSellAmount.toFixed(0),
        totalSellTokens: totalSellTokens.toFixed(0),
        holdTime: holdTime.toFixed(1),
        priceIncrease: priceIncrease.toFixed(1),
        profit: profit.toFixed(0),
        sellCount: sellTrades.length
      };
    }

    // 分析这个钱包进场时的市场热度
    // 计算钱包买入前的平均买入金额和买入次数
    const beforeBuyTrades = uniqueTrades.filter(t => {
      const fromToken = t.from_token_symbol;
      const isBuy = fromToken && baseCurrencies.includes(fromToken);
      const relTime = t.time - windowStart;
      return isBuy && relTime < firstBuyTime;
    });

    const beforeBuyVolume = beforeBuyTrades.length;
    const beforeBuyAvgAmount = beforeBuyTrades.length > 0
      ? beforeBuyTrades.reduce((sum, t) => sum + (t.from_usd || 0), 0) / beforeBuyTrades.length
      : 0;

    // 计算钱包买入后的市场热度（10秒内）
    const afterBuyTrades = uniqueTrades.filter(t => {
      const fromToken = t.from_token_symbol;
      const isBuy = fromToken && baseCurrencies.includes(fromToken);
      const relTime = t.time - windowStart;
      return isBuy && relTime >= firstBuyTime && relTime < firstBuyTime + 10;
    });

    const afterBuyVolume = afterBuyTrades.length;
    const afterBuyAvgAmount = afterBuyTrades.length > 0
      ? afterBuyTrades.reduce((sum, t) => sum + (t.from_usd || 0), 0) / afterBuyTrades.length
      : 0;

    // 判断是"带单"还是"收割"
    // 带单特征：买入前市场冷清，买入后交易活跃
    // 收割特征：买入价格极低，价格上涨后卖出
    const isBringingVolume = afterBuyVolume > beforeBuyVolume * 2;

    // 根据交易位置判断入场时机
    let entryPriceLevel;
    if (isUltraEarly) {
      entryPriceLevel = '极早期（前30笔交易）';
    } else if (buyTradePosition <= uniqueTrades.length * 0.3) {
      entryPriceLevel = '早期（前30%交易）';
    } else if (buyTradePosition <= uniqueTrades.length * 0.7) {
      entryPriceLevel = '中期（30%-70%交易）';
    } else {
      entryPriceLevel = '晚期（后30%交易）';
    }

    return {
      wallet: smartWallet.substring(0, 10),
      firstBuyTime: firstBuyTime.toFixed(1),
      buyPrice: firstBuyPrice.toFixed(8),
      totalBuyAmount: totalBuyAmount.toFixed(0),
      totalBuyTokens: totalBuyTokens.toFixed(0),
      buyCount: buyTrades.length,
      buyTradePosition,
      isUltraEarly,
      beforeBuyVolume,
      afterBuyVolume,
      beforeBuyAvgAmount: beforeBuyAvgAmount.toFixed(0),
      afterBuyAvgAmount: afterBuyAvgAmount.toFixed(0),
      isBringingVolume,
      entryPriceLevel,
      sellInfo,
      totalTradesInWindow: uniqueTrades.length
    };
  } catch (error) {
    return null;
  }
}

async function analyzeSmartWallets() {
  console.log('=== 分析特定"聪明钱包"的行为模式 ===\n');

  // 获取所有代币的收益数据
  const tokenReturns = {};

  for (const exp of experiments) {
    const { data: sellTrades } = await supabase
      .from('trades')
      .select('token_address, metadata')
      .eq('experiment_id', exp.id)
      .eq('trade_direction', 'sell')
      .not('metadata->>profitPercent', 'is', null);

    for (const sellTrade of sellTrades || []) {
      tokenReturns[sellTrade.token_address] = sellTrade.metadata?.profitPercent || 0;
    }
  }

  // 收集所有代币
  const allTokens = [];

  for (const exp of experiments) {
    const { data: buySignals } = await supabase
      .from('strategy_signals')
      .select('*')
      .eq('experiment_id', exp.id)
      .eq('action', 'buy')
      .order('created_at', { ascending: false });

    const executedSignals = buySignals.filter(s => s.metadata?.execution_status === 'executed');

    const seenAddresses = new Set();
    for (const signal of executedSignals) {
      if (!seenAddresses.has(signal.token_address)) {
        seenAddresses.add(signal.token_address);

        const profit = tokenReturns[signal.token_address];
        const checkTime = signal.metadata?.preBuyCheckFactors?.earlyTradesCheckTime;

        if (checkTime) {
          allTokens.push({
            tokenAddress: signal.token_address,
            symbol: signal.metadata?.symbol || signal.token_address.substring(0, 8),
            profitPercent: profit !== undefined ? profit : null,
            checkTime
          });
        }
      }
    }
  }

  console.log(`总共 ${allTokens.length} 个代币\n`);

  // 分析每个聪明钱包在哪些代币中出现过
  const walletActivities = [];

  for (const smartWallet of smartWallets) {
    console.log(`分析钱包 ${smartWallet.substring(0, 10)}...`);

    const activities = [];

    for (let i = 0; i < allTokens.length; i++) {
      const token = allTokens[i];

      const analysis = await analyzeSmartWalletInToken(token.tokenAddress, token.checkTime, smartWallet);

      if (analysis) {
        activities.push({
          ...token,
          analysis
        });
      }

      if ((i + 1) % 20 === 0) {
        console.log(`  进度: ${i + 1}/${allTokens.length}`);
      }

      await new Promise(resolve => setTimeout(resolve, 50));
    }

    walletActivities.push({
      wallet: smartWallet,
      activities
    });

    console.log(`  在 ${activities.length} 个代币中出现过\n`);
  }

  // 输出分析结果
  console.log('\n=== 聪明钱包活动分析 ===\n');

  walletActivities.forEach(({ wallet, activities }) => {
    console.log(`【钱包 ${wallet.substring(0, 10)}】`);
    console.log(`  共参与 ${activities.length} 个代币\n`);

    // 按收益分类
    const profitTokens = activities.filter(a => a.profitPercent !== null && a.profitPercent > 0);
    const lossTokens = activities.filter(a => a.profitPercent !== null && a.profitPercent <= 0);

    console.log(`  盈利代币: ${profitTokens.length}个, 亏损代币: ${lossTokens.length}个`);

    // 分析入场位置分布
    const positionDistribution = {};
    activities.forEach(a => {
      const level = a.analysis.entryPriceLevel;
      positionDistribution[level] = (positionDistribution[level] || 0) + 1;
    });

    console.log('  入场位置分布:');
    Object.entries(positionDistribution).forEach(([level, count]) => {
      console.log(`    ${level}: ${count}个`);
    });

    // 分析带单效果
    const bringingVolume = activities.filter(a => a.analysis.isBringingVolume);
    console.log(`  带单效果: ${bringingVolume.length}/${activities.length} (${(bringingVolume.length / activities.length * 100).toFixed(1)}%)`);

    // 分析卖出行为
    const withSell = activities.filter(a => a.analysis.sellInfo);
    if (withSell.length > 0) {
      const avgPriceIncrease = withSell.reduce((sum, a) => sum + parseFloat(a.analysis.sellInfo.priceIncrease), 0) / withSell.length;
      const avgProfit = withSell.reduce((sum, a) => sum + parseFloat(a.analysis.sellInfo.profit), 0) / withSell.length;
      console.log(`  卖出统计 (${withSell.length}个):`);
      console.log(`    平均价格涨幅: ${avgPriceIncrease.toFixed(1)}%`);
      console.log(`    平均利润: $${avgProfit.toFixed(0)}`);
    }

    // 显示典型例子
    console.log('\n  典型参与代币:');
    console.log('  代币        | 收益率 | 交易位置 | 入场时间 | 入场价格 | 买入金额 | 带单? | 卖出涨幅 | 利润');
    console.log('  ------------|--------|---------|---------|---------|---------|------|---------|-------');

    activities.slice(0, 10).forEach(a => {
      const profit = a.profitPercent !== null ? (a.profitPercent > 0 ? `+${a.profitPercent.toFixed(1)}%` : `${a.profitPercent.toFixed(1)}%`) : 'N/A';
      const sellInfo = a.analysis.sellInfo;
      const sellStr = sellInfo ? `+${sellInfo.priceIncrease}% / $${sellInfo.profit}` : '未卖出';
      const positionStr = `${a.analysis.buyTradePosition}/${a.analysis.totalTradesInWindow}`;

      console.log(`  ${a.symbol.substring(0, 11).padEnd(11)} | ${profit.padStart(6)} | ${positionStr.padStart(7)} | ${a.analysis.firstBuyTime.padStart(7)}s | ${a.analysis.buyPrice.padStart(9)} | $${a.analysis.totalBuyAmount.padStart(6)} | ${a.analysis.isBringingVolume ? '是' : '否'} | ${sellStr.padStart(16)}`);
    });

    console.log('\n');
  });

  // 综合分析：这些钱包的特征
  console.log('=== 综合特征分析 ===\n');

  const allActivities = walletActivities.flatMap(w => w.activities.map(a => ({ ...a, wallet: w.wallet })));

  // 1. "极早期"入场 vs 最终收益
  const ultraEarly = allActivities.filter(a => a.analysis.isUltraEarly);
  const early = allActivities.filter(a => !a.analysis.isUltraEarly && a.analysis.buyTradePosition <= a.analysis.totalTradesInWindow * 0.3);
  const middle = allActivities.filter(a => a.analysis.buyTradePosition > a.analysis.totalTradesInWindow * 0.3 && a.analysis.buyTradePosition <= a.analysis.totalTradesInWindow * 0.7);
  const late = allActivities.filter(a => a.analysis.buyTradePosition > a.analysis.totalTradesInWindow * 0.7);

  const avgProfit = (arr) => {
    const withProfit = arr.filter(a => a.profitPercent !== null);
    return withProfit.length > 0 ? withProfit.reduce((sum, a) => sum + a.profitPercent, 0) / withProfit.length : 0;
  };

  console.log('入场位置 vs 平均收益:');
  console.log(`  极早期（前30笔）: ${ultraEarly.length}个代币, 平均收益: ${avgProfit(ultraEarly).toFixed(1)}%`);
  console.log(`  早期（前30%）: ${early.length}个代币, 平均收益: ${avgProfit(early).toFixed(1)}%`);
  console.log(`  中期（30%-70%）: ${middle.length}个代币, 平均收益: ${avgProfit(middle).toFixed(1)}%`);
  console.log(`  晚期（后30%）: ${late.length}个代币, 平均收益: ${avgProfit(late).toFixed(1)}%`);

  // 2. 带单效果 vs 最终收益
  const bringingVolume = allActivities.filter(a => a.analysis.isBringingVolume);
  const notBringingVolume = allActivities.filter(a => !a.analysis.isBringingVolume);

  console.log('\n带单效果 vs 平均收益:');
  console.log(`  有带单: ${bringingVolume.length}个代币, 平均收益: ${avgProfit(bringingVolume).toFixed(1)}%`);
  console.log(`  无带单: ${notBringingVolume.length}个代币, 平均收益: ${avgProfit(notBringingVolume).toFixed(1)}%`);

  // 3. 卖出行为分析
  const withSell = allActivities.filter(a => a.analysis.sellInfo);
  if (withSell.length > 0) {
    console.log('\n卖出行为分析:');
    const harvestPattern = withSell.filter(a => parseFloat(a.analysis.sellInfo.priceIncrease) > 50);
    const normalProfit = withSell.filter(a => parseFloat(a.analysis.sellInfo.priceIncrease) <= 50);

    console.log(`  收割型(涨幅>50%): ${harvestPattern.length}个`);
    console.log(`  正常获利(涨幅<=50%): ${normalProfit.length}个`);

    if (harvestPattern.length > 0) {
      console.log('\n  典型收割型案例:');
      harvestPattern.slice(0, 5).forEach(a => {
        const sellInfo = a.analysis.sellInfo;
        console.log(`    ${a.symbol}: 收益${a.profitPercent.toFixed(1)}%, 涨幅+${sellInfo.priceIncrease}%, 利润$${sellInfo.profit}, 持仓${sellInfo.holdTime}s`);
      });
    }
  }

  // 推荐判断标准
  console.log('\n=== 推荐判断标准 ===\n');

  console.log('根据分析，区分"收割" vs "带单"的关键指标：');
  console.log('');
  console.log('1. 入场时机（基于交易位置，而非固定时间）:');
  console.log('   - 极早期（前30笔交易）: 可能是收割或带单');
  console.log('   - 早期（前30%交易）: 可能是带单');
  console.log('   - 中期/晚期: 正常跟风或追高');
  console.log('');
  console.log('2. 带单效果:');
  console.log('   - 买入后交易量 > 买入前的2倍: 真实带单');
  console.log('   - 买入后交易量无明显变化: 可能只是跟风或收割');
  console.log('');
  console.log('3. 卖出时机:');
  console.log('   - 涨幅>50%后卖出: 可能是收割');
  console.log('   - 涨幅<50%时卖出: 正常获利了结');
  console.log('');
  console.log('建议因子: walletIsSmartMoneyHarvester');
  console.log('  定义: 满足以下条件之一');
  console.log('    1. 极早期（前30笔交易）入场 且 涨幅>50%后卖出');
  console.log('    2. 极早期（前30笔交易）入场 且 没有带单效果(isBringingVolume=false)');
  console.log('  说明: 捕获"极低价拿筹码但无法带动市场"的收割者');
}

analyzeSmartWallets().catch(console.error);
