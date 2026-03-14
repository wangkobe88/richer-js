const { createClient } = require('@supabase/supabase-js');
const { AveTxAPI } = require('../../src/core/ave-api');
const config = require('../../config/default.json');
require('dotenv').config({ path: '../../config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const txApi = new AveTxAPI(
  config.ave?.apiUrl || 'https://prod.ave-api.com',
  config.ava?.timeout || 30000,
  process.env.AVE_API_KEY
);

const { STRONG_TRADERS } = require('../../src/trading-engine/pre-check/STRONG_TRADERS');
const TOTAL_SUPPLY = 1000000000;
const WINDOW_SECONDS = 90;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchTrades(pairAddress, fromTime, toTime) {
  const allTrades = [];
  let currentToTime = toTime;
  const maxLoops = 10;

  for (let i = 0; i < maxLoops; i++) {
    try {
      const trades = await txApi.getSwapTransactions(
        `${pairAddress}-bsc`,
        300,
        fromTime,
        currentToTime,
        'asc'
      );

      if (!trades || trades.length === 0) break;

      allTrades.push(...trades);

      const batchFirstTime = trades[0].time;
      if (batchFirstTime <= fromTime) break;

      if (trades.length === 300) {
        currentToTime = batchFirstTime - 1;
      } else {
        break;
      }
    } catch (error) {
      break;
    }
  }

  // 去重
  const seen = new Set();
  const unique = [];
  for (const trade of allTrades.sort((a, b) => a.time - b.time)) {
    const key = trade.tx_id || `${trade.time}_${trade.from_address}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(trade);
    }
  }
  return unique;
}

function calculateStrongTraderRatio(trades, tokenAddress) {
  let buyAmount = 0;
  let sellAmount = 0;
  const tokenAddressLower = tokenAddress.toLowerCase();

  for (const trade of trades) {
    const wallet = trade.wallet_address?.toLowerCase() || trade.from_address?.toLowerCase();
    if (!wallet) continue;

    if (!STRONG_TRADERS.has(wallet)) continue;

    const toToken = trade.to_token?.toLowerCase();
    const fromToken = trade.from_token?.toLowerCase();

    const isBuy = toToken === tokenAddressLower;
    const isSell = fromToken === tokenAddressLower;

    if (isBuy) buyAmount += parseFloat(trade.to_amount) || 0;
    if (isSell) sellAmount += parseFloat(trade.from_amount) || 0;
  }

  const netAmount = Math.abs(buyAmount - sellAmount);
  return (netAmount / TOTAL_SUPPLY * 100);
}

async function analyzeOriginalTokens() {
  // 获取原始虚拟实验买入的代币
  const { data: origSignals } = await supabase
    .from('strategy_signals')
    .select('id, token_address, token_symbol, metadata')
    .eq('experiment_id', '015db965-0b33-4d98-88b1-386203886381')
    .eq('executed', true);

  console.log(`原始虚拟实验买入代币: ${origSignals?.length || 0}`);

  // 获取这些代币的 main_pair
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, raw_api_data')
    .in('token_address', origSignals?.map(s => s.token_address) || []);

  const tokenPairMap = new Map();
  tokens?.forEach(t => {
    const mainPair = t.main_pair || t.raw_api_data?.main_pair;
    if (mainPair) {
      tokenPairMap.set(t.token_address?.toLowerCase(), mainPair);
    }
  });

  const tokensWithPair = origSignals?.filter(s => tokenPairMap.has(s.token_address?.toLowerCase())) || [];
  console.log(`有 main_pair 的代币: ${tokensWithPair.length}`);

  // 获取回测实验买入的代币
  const { data: backtestSignals } = await supabase
    .from('strategy_signals')
    .select('id, token_address, token_symbol')
    .eq('experiment_id', 'a2ee5c27-3788-48fa-8735-858cbc60fcad')
    .eq('executed', true);

  const backtestTokens = new Set(backtestSignals?.map(s => s.token_address?.toLowerCase()) || []);
  console.log(`回测实验买入代币: ${backtestTokens.size}`);

  // 计算每个代币的 strongTraderNetPositionRatio
  console.log('\n计算 strongTraderNetPositionRatio...\n');

  const results = [];
  for (let i = 0; i < tokensWithPair.length; i++) {
    const signal = tokensWithPair[i];
    const tokenAddress = signal.token_address;
    const pairAddress = tokenPairMap.get(tokenAddress?.toLowerCase());

    const checkTime = signal.metadata?.trendFactors?.checkTime || Date.now();
    const fromTime = checkTime - WINDOW_SECONDS;

    try {
      const trades = await fetchTrades(pairAddress, fromTime, checkTime);
      const ratio = calculateStrongTraderRatio(trades, tokenAddress);

      const boughtInBacktest = backtestTokens.has(tokenAddress?.toLowerCase());

      results.push({
        address: tokenAddress,
        symbol: signal.token_symbol,
        ratio: ratio,
        tradeCount: trades.length,
        boughtInBacktest: boughtInBacktest,
        pairAddress: pairAddress
      });

      const tag = boughtInBacktest ? '[BUY]' : '[FILTER]';
      console.log(`[${i+1}/${tokensWithPair.length}] ${tag} ${signal.token_symbol}: ${ratio.toFixed(2)}% (${trades.length} trades)`);

    } catch (error) {
      console.log(`[${i+1}/${tokensWithPair.length}] ${signal.token_symbol}: Error - ${error.message}`);
    }

    await sleep(500);
  }

  console.log('\n=== 结果汇总 ===');

  const validResults = results.filter(r => r.ratio !== null);
  const filtered = validResults.filter(r => !r.boughtInBacktest);
  const bought = validResults.filter(r => r.boughtInBacktest);

  console.log(`\n成功计算: ${validResults.length} 个`);
  console.log(`回测买入: ${bought.length} 个`);
  console.log(`回测未买: ${filtered.length} 个`);

  if (validResults.length > 0) {
    console.log('\n=== strongTraderNetPositionRatio 分布 ===');
    validResults.sort((a, b) => b.ratio - a.ratio);

    console.log('全部代币:');
    console.log('  最小值:', validResults[validResults.length-1].ratio.toFixed(2) + '%');
    console.log('  最大值:', validResults[0].ratio.toFixed(2) + '%');
    console.log('  平均值:', (validResults.reduce((sum, r) => sum + r.ratio, 0) / validResults.length).toFixed(2) + '%');
    console.log('  中位数:', validResults[Math.floor(validResults.length/2)].ratio.toFixed(2) + '%');

    console.log('\n回测买入的代币:');
    bought.sort((a, b) => b.ratio - a.ratio);
    console.log('  数量:', bought.length);
    console.log('  最小值:', bought.length > 0 ? bought[bought.length-1].ratio.toFixed(2) + '%' : 'N/A');
    console.log('  最大值:', bought.length > 0 ? bought[0].ratio.toFixed(2) + '%' : 'N/A');
    console.log('  平均值:', bought.length > 0 ? (bought.reduce((sum, r) => sum + r.ratio, 0) / bought.length).toFixed(2) + '%' : 'N/A');
    console.log('  中位数:', bought.length > 0 ? bought[Math.floor(bought.length/2)].ratio.toFixed(2) + '%' : 'N/A');

    console.log('\n回测未买的代币:');
    filtered.sort((a, b) => b.ratio - a.ratio);
    console.log('  数量:', filtered.length);
    console.log('  最小值:', filtered.length > 0 ? filtered[filtered.length-1].ratio.toFixed(2) + '%' : 'N/A');
    console.log('  最大值:', filtered.length > 0 ? filtered[0].ratio.toFixed(2) + '%' : 'N/A');
    console.log('  平均值:', filtered.length > 0 ? (filtered.reduce((sum, r) => sum + r.ratio, 0) / filtered.length).toFixed(2) + '%' : 'N/A');
    console.log('  中位数:', filtered.length > 0 ? filtered[Math.floor(filtered.length/2)].ratio.toFixed(2) + '%' : 'N/A');

    console.log('\n=== 阈值分析 ===');
    const thresholds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20];
    console.log('阈值 < X 会过滤掉的代币:');
    thresholds.forEach(th => {
      const wouldBeFiltered = validResults.filter(r => r.ratio >= th).length;
      console.log(`  阈值 < ${th}% (即 >= ${th}% 被过滤): ${wouldBeFiltered} 个代币`);
    });

    console.log('\n如果调整阈值，会多买入的代币:');
    thresholds.filter(th => th < 5).forEach(th => {
      const additionalBuys = filtered.filter(r => r.ratio < th).length;
      const currentBuysAtTh = validResults.filter(r => r.ratio < th).length;
      console.log(`  阈值改为 < ${th}%: +${additionalBuys} 个代币 (总计 ${currentBuysAtTh} 个买入)`);
    });

    console.log('\n=== 被过滤代币详情 (ratio 降序) ===');
    filtered.forEach(r => {
      console.log(`  ${r.symbol}: ${r.ratio.toFixed(2)}% (${r.tradeCount} trades)`);
    });

    console.log('\n=== 回测买入代币详情 (ratio 降序) ===');
    bought.forEach(r => {
      console.log(`  ${r.symbol}: ${r.ratio.toFixed(2)}% (${r.tradeCount} trades)`);
    });

    // 分析：如果阈值设为 X，结果会怎样
    console.log('\n=== 阈值建议分析 ===');
    console.log('当前阈值: < 5% (即 >= 5% 被过滤)');
    console.log(`当前结果: 买入 ${bought.length} 个, 过滤 ${filtered.filter(r => r.ratio >= 5).length} 个`);
    console.log('\n建议:');
    console.log('  需要结合回测收益数据来确定最优阈值');
    console.log('  可以尝试阈值: < 3%, < 7%, < 10% 进行对比回测');
  }

  // 保存结果到文件
  const fs = require('fs');
  fs.writeFileSync(
    'strong_trader_ratio_results.json',
    JSON.stringify({ validResults, filtered, bought }, null, 2)
  );
  console.log('\n结果已保存到 strong_trader_ratio_results.json');
}

analyzeOriginalTokens().catch(console.error);
