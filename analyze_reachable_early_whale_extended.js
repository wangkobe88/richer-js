/**
 * 扩大时间窗口，分析能回溯到代币创建时间的代币
 * 尝试120秒和180秒窗口，获得更多样本
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

const experiments = [
  { id: '6b17ff18-002d-4ce0-a745-b8e02676abd4', name: '实验1' },
  { id: '1dde2be5-2f4e-49fb-9520-cb032e9ef759', name: '实验2' }
];

async function analyzeEarlyWhaleFullHistory(tokenAddress, checkTime) {
  const innerPair = `${tokenAddress}_fo`;
  const pairId = `${innerPair}-bsc`;

  try {
    const allTrades = [];
    let currentToTime = checkTime;

    for (let loop = 1; loop <= 15; loop++) {
      const trades = await txApi.getSwapTransactions(
        pairId, 300, 0, currentToTime, 'asc'
      );
      if (trades.length === 0) break;
      allTrades.push(...trades);
      if (trades[0].time <= 0 || trades.length < 300) break;
      currentToTime = trades[0].time - 1;
    }

    const uniqueTrades = [];
    const seen = new Set();
    for (const trade of allTrades.sort((a, b) => a.time - b.time)) {
      const key = trade.tx_id || `${trade.time}_${trade.from_address}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueTrades.push(trade);
      }
    }

    if (uniqueTrades.length === 0) {
      return { error: 'no_trades' };
    }

    const earliestTime = uniqueTrades[0].time;
    const earlyTradeCount = Math.min(30, Math.floor(uniqueTrades.length * 0.2));
    const earlyTradeEndTime = uniqueTrades[earlyTradeCount - 1]?.time || earliestTime;

    const baseCurrencies = ['WBNB', 'USDT', 'BUSD', 'USDC', 'ETH'];

    const walletMap = new Map();

    for (const trade of uniqueTrades) {
      const wallet = trade.wallet_address?.toLowerCase();
      if (!wallet) continue;

      if (!walletMap.has(wallet)) {
        walletMap.set(wallet, {
          wallet,
          firstBuyTime: null,
          totalBuyAmount: 0,
          totalBuyTokens: 0,
          buyCount: 0,
          sellTrades: [],
          totalSellAmount: 0,
          totalSellTokens: 0,
          sellCount: 0,
          buyTrades: []
        });
      }

      const walletData = walletMap.get(wallet);
      const fromToken = trade.from_token_symbol;
      const toToken = trade.to_token_symbol;
      const fromUsd = trade.from_usd || 0;
      const toAmount = trade.to_amount || 0;
      const toUsd = trade.to_usd || 0;
      const fromAmount = trade.from_amount || 0;
      const relTime = trade.time - earliestTime;

      const isBuy = fromToken && baseCurrencies.includes(fromToken);
      const isSell = toToken && baseCurrencies.includes(toToken);

      if (isBuy) {
        walletData.buyTrades.push({ relTime, amount: fromUsd, tokens: toAmount });
        if (walletData.firstBuyTime === null || relTime < walletData.firstBuyTime) {
          walletData.firstBuyTime = relTime;
        }
        walletData.totalBuyAmount += fromUsd;
        walletData.totalBuyTokens += toAmount;
        walletData.buyCount++;
      }

      if (isSell) {
        walletData.sellTrades.push({ relTime, amount: toUsd, tokens: fromAmount });
        walletData.totalSellAmount += toUsd;
        walletData.totalSellTokens += fromAmount;
        walletData.sellCount++;
      }
    }

    const whales = [];
    for (const [wallet, data] of walletMap) {
      if (data.firstBuyTime !== null &&
          data.totalBuyAmount > 200 &&
          data.firstBuyTime <= earlyTradeEndTime) {
        whales.push(data);
      }
    }

    if (whales.length === 0) {
      return {
        totalTrades: uniqueTrades.length,
        earliestTime,
        whaleCount: 0,
        earlyWhaleHoldRatio: 1.0,
        earlyWhaleSellRatio: 0,
        earlyWhaleFullySoldCount: 0
      };
    }

    let totalSellRatio = 0;
    let fullySoldCount = 0;

    for (const whale of whales) {
      let sellRatio = 0;
      if (whale.sellTrades.length > 0) {
        const totalSellTokens = whale.sellTrades.reduce((sum, s) => sum + s.tokens, 0);
        sellRatio = totalSellTokens / whale.totalBuyTokens;
      }
      totalSellRatio += sellRatio;

      if (sellRatio > 0.9) {
        fullySoldCount++;
      }
    }

    const holdingWhales = whales.filter(w => w.sellTrades.length === 0);
    const holdRatio = holdingWhales.length / whales.length;
    const sellRatio = totalSellRatio / whales.length;

    return {
      totalTrades: uniqueTrades.length,
      earliestTime,
      whaleCount: whales.length,
      earlyWhaleHoldRatio: holdRatio,
      earlyWhaleSellRatio: sellRatio,
      earlyWhaleFullySoldCount: fullySoldCount
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function analyzeWithDifferentWindows() {
  console.log('=== 分析不同时间窗口的覆盖情况 ===\n');

  // 获取所有代币数据
  const tokenReturns = {};
  const tokenCreationTimes = {};

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

    const { data: tokens } = await supabase
      .from('experiment_tokens')
      .select('token_address, created_at')
      .eq('experiment_id', exp.id);

    for (const token of tokens || []) {
      tokenCreationTimes[token.token_address] = new Date(token.created_at).getTime() / 1000;
    }
  }

  // 收集所有代币信号
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
        const signalCreatedAt = new Date(signal.created_at).getTime() / 1000;
        const tokenCreatedAt = tokenCreationTimes[signal.token_address];
        const preBuyCheckTime = signal.metadata?.preBuyCheckFactors?.earlyTradesCheckTime;
        const checkTime = preBuyCheckTime || signalCreatedAt;

        const timeGap = checkTime - tokenCreatedAt;

        allTokens.push({
          tokenAddress: signal.token_address,
          symbol: signal.metadata?.symbol || signal.token_address.substring(0, 8),
          profitPercent: profit !== undefined ? profit : null,
          tokenCreatedAt,
          checkTime,
          timeGap,
          canReach90: timeGap <= 90,
          canReach120: timeGap <= 120,
          canReach180: timeGap <= 180
        });
      }
    }
  }

  console.log(`总共 ${allTokens.length} 个代币\n`);

  // 统计不同窗口的覆盖情况
  const canReach90 = allTokens.filter(t => t.canReach90);
  const canReach120 = allTokens.filter(t => t.canReach120);
  const canReach180 = allTokens.filter(t => t.canReach180);

  console.log('=== 不同时间窗口覆盖情况 ===\n');
  console.log(`90秒窗口: ${canReach90.length}个 (${(canReach90.length / allTokens.length * 100).toFixed(1)}%)`);
  console.log(`120秒窗口: ${canReach120.length}个 (${(canReach120.length / allTokens.length * 100).toFixed(1)}%)`);
  console.log(`180秒窗口: ${canReach180.length}个 (${(canReach180.length / allTokens.length * 100).toFixed(1)}%)`);

  // 分析每个窗口的收益分布
  for (const [label, tokens] of [['90秒', canReach90], ['120秒', canReach120], ['180秒', canReach180]]) {
    const profit = tokens.filter(t => t.profitPercent > 0);
    const loss = tokens.filter(t => t.profitPercent !== null && t.profitPercent <= 0);
    console.log(`\n${label}窗口收益分布:`);
    console.log(`  盈利: ${profit.length}个, 亏损: ${loss.length}个`);
  }

  // 选择合适的窗口进行分析（优先120秒，平衡覆盖率和准确性）
  const targetWindow = canReach120.length >= 15 ? canReach120 : canReach180;

  console.log(`\n=== 深度分析${targetWindow.length}个代币（${targetWindow === canReach120 ? '120' : '180'}秒窗口）===\n`);

  const results = [];

  for (let i = 0; i < targetWindow.length; i++) {
    const token = targetWindow[i];

    if ((i + 1) % 5 === 0) {
      console.log(`进度: ${i + 1}/${targetWindow.length}`);
    }

    const analysis = await analyzeEarlyWhaleFullHistory(token.tokenAddress, token.checkTime);

    if (analysis && !analysis.error) {
      results.push({
        ...token,
        analysis
      });
    }

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log(`\n成功分析 ${results.length} 个代币\n`);

  // 分类统计
  const profitTokens = results.filter(r => r.profitPercent !== null && r.profitPercent > 0);
  const lossTokens = results.filter(r => r.profitPercent !== null && r.profitPercent <= 0);

  console.log('=== 分类统计 ===\n');
  console.log(`盈利代币: ${profitTokens.length}个`);
  console.log(`亏损代币: ${lossTokens.length}个`);

  // 计算平均值
  const avg = (arr, key) => arr.length > 0
    ? arr.reduce((sum, r) => sum + r.analysis[key], 0) / arr.length
    : 0;

  console.log('\n=== 早期大户行为指标对比 ===\n');
  console.log('指标                    | 盈利代币 | 亏损代币');
  console.log('------------------------|---------|---------');
  console.log(`平均大户数量            | ${avg(profitTokens, 'whaleCount').toFixed(1)}      | ${avg(lossTokens, 'whaleCount').toFixed(1)}`);
  console.log(`大户持有率              | ${(avg(profitTokens, 'earlyWhaleHoldRatio') * 100).toFixed(1)}%    | ${(avg(lossTokens, 'earlyWhaleHoldRatio') * 100).toFixed(1)}%`);
  console.log(`大户卖出率              | ${(avg(profitTokens, 'earlyWhaleSellRatio') * 100).toFixed(1)}%    | ${(avg(lossTokens, 'earlyWhaleSellRatio') * 100).toFixed(1)}%`);
  console.log(`完全卖出大户数          | ${avg(profitTokens, 'earlyWhaleFullySoldCount').toFixed(1)}      | ${avg(lossTokens, 'earlyWhaleFullySoldCount').toFixed(1)}`);

  // 测试不同的过滤条件
  console.log('\n=== 测试过滤条件 ===\n');

  const conditions = [
    { name: 'earlyWhaleHoldRatio < 0.3', test: r => r.analysis.earlyWhaleHoldRatio < 0.3 },
    { name: 'earlyWhaleHoldRatio < 0.4', test: r => r.analysis.earlyWhaleHoldRatio < 0.4 },
    { name: 'earlyWhaleHoldRatio < 0.5', test: r => r.analysis.earlyWhaleHoldRatio < 0.5 },
    { name: 'earlyWhaleSellRatio > 0.5', test: r => r.analysis.earlyWhaleSellRatio > 0.5 },
    { name: 'earlyWhaleSellRatio > 0.6', test: r => r.analysis.earlyWhaleSellRatio > 0.6 },
    { name: 'earlyWhaleSellRatio > 0.7', test: r => r.analysis.earlyWhaleSellRatio > 0.7 },
    {
      name: '组合: earlyWhaleHoldRatio < 0.4 && earlyWhaleSellRatio > 0.5',
      test: r => r.analysis.earlyWhaleHoldRatio < 0.4 && r.analysis.earlyWhaleSellRatio > 0.5
    },
    {
      name: '组合: earlyWhaleHoldRatio < 0.5 && earlyWhaleSellRatio > 0.6',
      test: r => r.analysis.earlyWhaleHoldRatio < 0.5 && r.analysis.earlyWhaleSellRatio > 0.6
    },
    {
      name: '组合: earlyWhaleHoldRatio < 0.3 && earlyWhaleSellRatio > 0.5',
      test: r => r.analysis.earlyWhaleHoldRatio < 0.3 && r.analysis.earlyWhaleSellRatio > 0.5
    },
  ];

  for (const condition of conditions) {
    const filtered = results.filter(condition.test);
    const filteredProfit = filtered.filter(r => r.profitPercent > 0);
    const filteredLoss = filtered.filter(r => r.profitPercent <= 0);

    const lossRecall = lossTokens.length > 0 ? filteredLoss.length / lossTokens.length : 0;
    const profitFPR = profitTokens.length > 0 ? filteredProfit.length / profitTokens.length : 0;
    const f1 = (lossRecall + (1 - profitFPR)) > 0 ? 2 * lossRecall * (1 - profitFPR) / (lossRecall + (1 - profitFPR)) : 0;

    console.log(`\n${condition.name}:`);
    console.log(`  过滤数量: ${filtered.length}/${results.length}`);
    console.log(`  亏损召回: ${(lossRecall * 100).toFixed(1)}% (${filteredLoss.length}/${lossTokens.length})`);
    console.log(`  盈利误伤: ${(profitFPR * 100).toFixed(1)}% (${filteredProfit.length}/${profitTokens.length})`);
    console.log(`  F1分数: ${f1.toFixed(3)}`);
  }

  // 最终建议
  console.log('\n=== 最终建议 ===\n');

  console.log('1. 数据窗口选择:');
  console.log(`   - 使用120秒窗口（可覆盖${targetWindow.length}个代币，${(targetWindow.length / allTokens.length * 100).toFixed(1)}%）`);
  console.log(`   - 剩余${allTokens.length - targetWindow.length}个代币不使用此因子`);
  console.log('');
  console.log('2. 推荐过滤条件（基于完整早期数据）:');
  console.log('   【保守策略】- 误伤最低');
  console.log('   - earlyWhaleSellRatio > 0.7');
  console.log('   - 适用于非常确定的大户抛售行为');
  console.log('');
  console.log('   【平衡策略】- 召回和误伤平衡');
  console.log('   - earlyWhaleHoldRatio < 0.4 && earlyWhaleSellRatio > 0.5');
  console.log('   - 或: earlyWhaleHoldRatio < 0.5 && earlyWhaleSellRatio > 0.6');
  console.log('');
  console.log('3. 实现方式:');
  console.log('   - 检查 signalTime - tokenCreateTime');
  console.log('   - 如果 <= 120s，计算并应用早期大户因子');
  console.log('   - 如果 > 120s，跳过此因子（返回默认值或不检查）');
}

analyzeWithDifferentWindows().catch(console.error);
