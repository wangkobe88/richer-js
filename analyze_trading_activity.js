/**
 * 交易活跃度分析
 * 直接使用页面API获取代币收益数据
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const EXPERIMENT_ID = '842f1178-fe2e-4fd7-9bdd-5dab94515afd';
const BASE_URL = 'http://localhost:3010';
const TIME_WINDOW_SECONDS = 90; // 1.5分钟
const LOW_VALUE_THRESHOLD_USD = 10; // 低交易额过滤阈值

/**
 * 从API获取交易数据并计算代币收益
 */
async function getTokenReturns() {
  const response = await fetch(`${BASE_URL}/api/experiment/${EXPERIMENT_ID}/trades?limit=10000`);
  const data = await response.json();

  if (!data.success) {
    throw new Error('获取交易数据失败');
  }

  const trades = data.trades || [];

  // 按代币分组
  const tokenTradesMap = new Map();
  trades.forEach(t => {
    const addr = t.token_address;
    if (!tokenTradesMap.has(addr)) {
      tokenTradesMap.set(addr, []);
    }
    tokenTradesMap.get(addr).push(t);
  });

  // 计算每个代币的收益
  const tokenReturns = [];
  tokenTradesMap.forEach((trades, tokenAddress) => {
    const pnl = calculateTokenPnL(trades);
    if (pnl) {
      tokenReturns.push({
        tokenAddress,
        symbol: trades[0]?.token_symbol || 'Unknown',
        return: pnl.returnRate,
        status: pnl.status
      });
    }
  });

  return tokenReturns;
}

/**
 * 计算单个代币的盈亏（复用前端逻辑）
 */
function calculateTokenPnL(tokenTrades) {
  const sorted = tokenTrades
    .filter(t => t.status === 'success' || t.trade_status === 'success')
    .sort((a, b) => new Date(a.created_at || a.executed_at) - new Date(b.created_at || b.executed_at));

  if (sorted.length === 0) return null;

  const buyQueue = [];
  let totalRealizedPnL = 0;
  let totalBNBSpent = 0;
  let totalBNBReceived = 0;

  sorted.forEach(trade => {
    const direction = trade.trade_direction || trade.direction || trade.action;
    const isBuy = direction === 'buy' || direction === 'BUY';

    if (isBuy) {
      const inputAmount = parseFloat(trade.input_amount || 0);
      const outputAmount = parseFloat(trade.output_amount || 0);
      if (outputAmount > 0) {
        buyQueue.push({ amount: outputAmount, cost: inputAmount });
        totalBNBSpent += inputAmount;
      }
    } else {
      const inputAmount = parseFloat(trade.input_amount || 0);
      const outputAmount = parseFloat(trade.output_amount || 0);
      let remainingToSell = inputAmount;
      let costOfSold = 0;

      while (remainingToSell > 0 && buyQueue.length > 0) {
        const oldestBuy = buyQueue[0];
        const sellAmount = Math.min(remainingToSell, oldestBuy.amount);
        const unitCost = oldestBuy.cost / oldestBuy.amount;
        costOfSold += unitCost * sellAmount;
        remainingToSell -= sellAmount;
        oldestBuy.amount -= sellAmount;
        oldestBuy.cost -= unitCost * sellAmount;
        if (oldestBuy.amount <= 0.00000001) {
          buyQueue.shift();
        }
      }
      totalBNBReceived += outputAmount;
      totalRealizedPnL += (outputAmount - costOfSold);
    }
  });

  const totalCost = totalBNBSpent || 1;
  const totalValue = totalBNBReceived + buyQueue.reduce((s, b) => s + b.cost, 0);
  const returnRate = ((totalValue - totalCost) / totalCost) * 100;

  let status = 'monitoring';
  if (buyQueue.length === 0) status = 'exited';
  else if (totalBNBReceived > 0) status = 'bought';

  return { returnRate, status };
}

/**
 * 获取代币的 launch_at
 */
async function getTokensWithLaunchAt() {
  const { data, error } = await supabase
    .from('experiment_tokens')
    .select('token_address, raw_api_data')
    .eq('experiment_id', EXPERIMENT_ID)
    .limit(2000);

  if (error) throw error;

  const launchAtMap = new Map();
  data.forEach(t => {
    const launchAt = getLaunchAtFromRawApi(t.raw_api_data);
    if (launchAt) {
      launchAtMap.set(t.token_address, launchAt);
    }
  });

  return launchAtMap;
}

function getLaunchAtFromRawApi(rawApiData) {
  if (!rawApiData) return null;
  try {
    const parsed = typeof rawApiData === 'string' ? JSON.parse(rawApiData) : rawApiData;
    return parsed.token?.launch_at || parsed.launch_at || null;
  } catch (e) {
    return null;
  }
}

/**
 * 调用API获取早期交易
 */
async function fetchEarlyTrades(tokenAddress) {
  try {
    const response = await fetch(`${BASE_URL}/api/token-early-trades`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenAddress, chain: 'bsc', limit: 300 })
    });
    if (!response.ok) return [];
    const result = await response.json();
    return result.success ? (result.data.earlyTrades || []) : [];
  } catch (e) {
    return [];
  }
}

function filterTradesInTimeWindow(trades, launchAt) {
  if (!launchAt) return [];
  return trades.filter(t => t.time >= launchAt && t.time <= launchAt + TIME_WINDOW_SECONDS);
}

function analyzeTrades(trades) {
  if (!trades || trades.length === 0) return { totalTrades: 0, totalVolumeUsd: 0, uniqueWallets: 0 };
  // 使用 from_usd 或 to_usd 作为交易金额
  const totalVolumeUsd = trades.reduce((s, t) => s + (t.from_usd || t.to_usd || 0), 0);
  const uniqueWallets = new Set(trades.map(t => t.wallet_address)).size;
  return { totalTrades: trades.length, totalVolumeUsd, uniqueWallets };
}

function calculateMedian(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function printStats(label, values) {
  const valid = values.filter(v => v !== null && v !== undefined);
  if (valid.length === 0) {
    console.log(`  ${label}: 无数据`);
    return;
  }
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
  const median = calculateMedian(valid);
  console.log(`  ${label}: 平均${avg.toFixed(1)}, 中位数${median.toFixed(1)}, 最小${Math.min(...valid).toFixed(1)}, 最大${Math.max(...valid).toFixed(1)}`);
}

async function main() {
  console.log('=== 交易活跃度分析 ===\n');
  console.log(`实验: ${EXPERIMENT_ID}`);
  console.log(`时间窗口: ${TIME_WINDOW_SECONDS}秒 (1.5分钟)`);
  console.log(`低交易额阈值: $${LOW_VALUE_THRESHOLD_USD}\n`);

  // 获取代币收益
  console.log('获取代币收益数据...');
  const tokenReturns = await getTokenReturns();
  console.log(`找到 ${tokenReturns.length} 个有交易的代币\n`);

  if (tokenReturns.length === 0) {
    console.log('没有代币数据');
    return;
  }

  // 获取 launch_at
  console.log('获取 launch_at...');
  const launchAtMap = await getTokensWithLaunchAt();
  console.log(`有 launch_at 的代币: ${launchAtMap.size} 个\n`);

  // 过滤出有 launch_at 的代币
  const validTokens = tokenReturns.filter(t => launchAtMap.has(t.tokenAddress));
  console.log(`有效代币: ${validTokens.length} 个\n`);

  if (validTokens.length === 0) {
    console.log('没有有效的代币数据');
    return;
  }

  // 添加 launch_at
  validTokens.forEach(t => t.launchAt = launchAtMap.get(t.tokenAddress));

  // 计算收益中位数并分组
  const returns = validTokens.map(t => t.return);
  const medianReturn = calculateMedian(returns);
  console.log(`收益中位数: ${medianReturn.toFixed(2)}%`);
  console.log(`收益范围: ${Math.min(...returns).toFixed(2)}% ~ ${Math.max(...returns).toFixed(2)}%\n`);

  const highReturn = validTokens.filter(t => t.return >= medianReturn);
  const lowReturn = validTokens.filter(t => t.return < medianReturn);
  console.log(`高收益代币: ${highReturn.length} 个`);
  console.log(`低收益代币: ${lowReturn.length} 个\n`);

  // 分析高收益代币
  const results = { high: [], low: [] };

  console.log('=== 分析高收益代币 ===');
  const sampleHigh = Math.min(highReturn.length, 50);
  for (let i = 0; i < sampleHigh; i++) {
    const token = highReturn[i];
    process.stdout.write(`\r[${i + 1}/${sampleHigh}] ${token.symbol?.slice(0, 12)}... (${token.return.toFixed(0)}%)`);
    const trades = await fetchEarlyTrades(token.tokenAddress);
    const inWindow = filterTradesInTimeWindow(trades, token.launchAt);
    const all = analyzeTrades(inWindow);
    const filtered = analyzeTrades(inWindow.filter(t => (t.from_usd || t.to_usd || 0) >= LOW_VALUE_THRESHOLD_USD));
    results.high.push({ ...token, allTrades: all.totalTrades, filteredTrades: filtered.totalTrades, volume: all.totalVolumeUsd });
  }
  console.log('\n');

  console.log('=== 分析低收益代币 ===');
  const sampleLow = Math.min(lowReturn.length, 50);
  for (let i = 0; i < sampleLow; i++) {
    const token = lowReturn[i];
    process.stdout.write(`\r[${i + 1}/${sampleLow}] ${token.symbol?.slice(0, 12)}... (${token.return.toFixed(0)}%)`);
    const trades = await fetchEarlyTrades(token.tokenAddress);
    const inWindow = filterTradesInTimeWindow(trades, token.launchAt);
    const all = analyzeTrades(inWindow);
    const filtered = analyzeTrades(inWindow.filter(t => (t.from_usd || t.to_usd || 0) >= LOW_VALUE_THRESHOLD_USD));
    results.low.push({ ...token, allTrades: all.totalTrades, filteredTrades: filtered.totalTrades, volume: all.totalVolumeUsd });
  }
  console.log('\n');

  // 统计结果
  console.log('=== 统计结果 ===\n');
  console.log('--- 高收益代币 ---');
  printStats('全部交易次数', results.high.map(r => r.allTrades));
  printStats('过滤后交易次数', results.high.map(r => r.filteredTrades));
  printStats('交易金额(USD)', results.high.map(r => r.volume));

  console.log('\n--- 低收益代币 ---');
  printStats('全部交易次数', results.low.map(r => r.allTrades));
  printStats('过滤后交易次数', results.low.map(r => r.filteredTrades));
  printStats('交易金额(USD)', results.low.map(r => r.volume));

  // 差异分析
  console.log('\n=== 差异分析 ===');
  const hAvgAll = results.high.reduce((s, r) => s + r.allTrades, 0) / results.high.length;
  const lAvgAll = results.low.reduce((s, r) => s + r.allTrades, 0) / results.low.length;
  const hAvgFil = results.high.reduce((s, r) => s + r.filteredTrades, 0) / results.high.length;
  const lAvgFil = results.low.reduce((s, r) => s + r.filteredTrades, 0) / results.low.length;

  console.log(`\n平均交易次数:`);
  console.log(`  全部: 高${hAvgAll.toFixed(1)} vs 低${lAvgAll.toFixed(1)} (差异${(hAvgAll - lAvgAll).toFixed(1)}, ${((hAvgAll/lAvgAll-1)*100).toFixed(0)}%)`);
  console.log(`  过滤后: 高${hAvgFil.toFixed(1)} vs 低${lAvgFil.toFixed(1)} (差异${(hAvgFil - lAvgFil).toFixed(1)}, ${((hAvgFil/lAvgFil-1)*100).toFixed(0)}%)`);

  // 示例
  console.log('\n=== 高收益Top 5 ===');
  results.high.sort((a, b) => b.return - a.return).slice(0, 5).forEach(r => {
    console.log(`  ${r.symbol?.slice(0, 15)}: ${r.return.toFixed(0)}%, ${r.allTrades}次(过滤${r.filteredTrades}次), $${r.volume.toFixed(0)}`);
  });

  console.log('\n=== 低收益Bottom 5 ===');
  results.low.sort((a, b) => a.return - b.return).slice(0, 5).forEach(r => {
    console.log(`  ${r.symbol?.slice(0, 15)}: ${r.return.toFixed(0)}%, ${r.allTrades}次(过滤${r.filteredTrades}次), $${r.volume.toFixed(0)}`);
  });
}

main().catch(console.error);
