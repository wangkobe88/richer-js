/**
 * 强短线交易者与代币质量关系分析
 *
 * 步骤：
 * 1. 获取所有执行的买入信号及代币质量标注
 * 2. 对每个信号获取早期交易数据（买入前90秒）
 * 3. 提取钱包地址并获取盈亏数据
 * 4. 识别强短线交易者
 * 5. 统计参与度并与质量标注关联分析
 */

const { createClient } = require('@supabase/supabase-js');
const { AveWalletAPI, AveTxAPI } = require('../../src/core/ave-api');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const walletApi = new AveWalletAPI(
  'https://prod.ave-api.com',
  30000,
  process.env.AVE_API_KEY
);

const txApi = new AveTxAPI(
  'https://prod.ave-api.com',
  30000,
  process.env.AVE_API_KEY
);

// 钱包数据缓存
const walletCache = new Map();

// 强短线交易者识别条件（宽松版，用于实际分析）
function isStrongTrader(walletInfo) {
  const profitAbs = Math.abs(walletInfo.total_profit || 0);
  const totalPurchase = walletInfo.total_purchase || 0;
  const totalSold = walletInfo.total_sold || 0;
  const soldPurchaseRatio = totalPurchase > 0 ? totalSold / totalPurchase : 0;
  const totalTrades = totalPurchase + totalSold;

  // 条件：
  // 1. 盈亏绝对值 > 500 USD
  // 2. 卖出/买入比 > 0.2（表示有卖出的活跃交易者）
  // 3. 总交易次数 > 10
  return profitAbs > 500 && soldPurchaseRatio > 0.2 && totalTrades > 10;
}

// 延迟函数（避免API限流）
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 获取单个钱包信息（带缓存）
async function getWalletInfoCached(walletAddress) {
  const key = walletAddress.toLowerCase();
  if (walletCache.has(key)) {
    return walletCache.get(key);
  }

  try {
    const info = await walletApi.getWalletInfo(walletAddress, 'bsc');
    walletCache.set(key, info);
    return info;
  } catch (error) {
    // API失败时返回空数据
    return {
      total_profit: 0,
      total_purchase: 0,
      total_sold: 0,
      wallet_address: walletAddress
    };
  }
}

async function main() {
  console.log('=== 强短线交易者与代币质量关系分析 ===\n');

  const expId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // ========== 步骤1: 获取所有执行的买入信号及代币数据 ==========
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【步骤1】获取信号及代币数据');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('id, token_address, token_symbol, created_at, metadata')
    .eq('experiment_id', expId)
    .eq('action', 'buy')
    .eq('executed', true)
    .order('created_at', { ascending: true });

  if (!signals || signals.length === 0) {
    console.log('没有找到执行的买入信号');
    return;
  }

  console.log(`找到 ${signals.length} 个执行的买入信号\n`);

  // 获取代币数据（main_pair 和质量标注）
  const tokenAddresses = [...new Set(signals.map(s => s.token_address))];

  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, raw_api_data, human_judges')
    .eq('experiment_id', expId)
    .in('token_address', tokenAddresses);

  // 构建 token 映射
  const tokenMap = new Map();
  for (const token of tokens || []) {
    const mainPair = token.raw_api_data?.main_pair || null;
    const qualityLabel = token.human_judges?.category || null;
    tokenMap.set(token.token_address.toLowerCase(), {
      symbol: token.token_symbol,
      mainPair,
      qualityLabel
    });
  }

  // ========== 步骤2: 获取早期交易数据并提取钱包 ==========
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【步骤2】获取早期交易数据');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 代币钱包统计
  const tokenWalletStats = new Map(); // token_address -> { wallets: Set, strongTraders: Set }

  for (let i = 0; i < signals.length; i++) {
    const signal = signals[i];
    const tokenAddr = signal.token_address.toLowerCase();
    const tokenInfo = tokenMap.get(tokenAddr);

    if (!tokenInfo || !tokenInfo.mainPair) {
      console.log(`[${i+1}/${signals.length}] ${signal.token_symbol}: 跳过（无main_pair）`);
      continue;
    }

    // 初始化统计
    if (!tokenWalletStats.has(tokenAddr)) {
      tokenWalletStats.set(tokenAddr, {
        symbol: signal.token_symbol,
        qualityLabel: tokenInfo.qualityLabel,
        mainPair: tokenInfo.mainPair,
        wallets: new Set(),
        strongTraders: new Set()
      });
    }

    // 获取买入时间（Unix时间戳，秒）
    const buyTime = Math.floor(new Date(signal.created_at).getTime() / 1000);
    const fromTime = buyTime - 90; // 回溯90秒

    console.log(`[${i+1}/${signals.length}] ${signal.token_symbol}: 获取交易数据 (${fromTime} - ${buyTime})`);

    try {
      // 获取交易数据
      const pairId = `${tokenInfo.mainPair}-bsc`;
      const trades = await txApi.getSwapTransactions(
        pairId,
        300,
        fromTime,
        buyTime,
        'asc'
      );

      if (trades && trades.length > 0) {
        console.log(`  获取到 ${trades.length} 笔交易`);

        // 提取钱包地址
        for (const trade of trades) {
          if (trade.from_address) {
            tokenWalletStats.get(tokenAddr).wallets.add(trade.from_address.toLowerCase());
          }
          if (trade.to_address) {
            tokenWalletStats.get(tokenAddr).wallets.add(trade.to_address.toLowerCase());
          }
        }
      } else {
        console.log(`  无交易数据`);
      }

    } catch (error) {
      console.log(`  错误: ${error.message}`);
    }

    // API限流延迟
    await sleep(100);
  }

  // ========== 步骤3: 获取钱包盈亏数据 ==========
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【步骤3】获取钱包盈亏数据');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 收集所有唯一钱包
  const allWallets = new Set();
  for (const stats of tokenWalletStats.values()) {
    for (const wallet of stats.wallets) {
      allWallets.add(wallet);
    }
  }

  console.log(`总共 ${allWallets.size} 个唯一钱包，开始获取盈亏数据...\n`);

  let processedCount = 0;
  let strongTraderCount = 0;

  for (const wallet of allWallets) {
    processedCount++;

    if (processedCount % 10 === 0) {
      console.log(`处理进度: ${processedCount}/${allWallets.size} (${(processedCount/allWallets.size*100).toFixed(1)}%)`);
    }

    const info = await getWalletInfoCached(wallet);

    // 判断是否为强短线交易者
    if (isStrongTrader(info)) {
      strongTraderCount++;
      // 标记所有包含此钱包的代币
      for (const [tokenAddr, stats] of tokenWalletStats.entries()) {
        if (stats.wallets.has(wallet)) {
          stats.strongTraders.add(wallet);
        }
      }
    }

    // API限流延迟
    await sleep(50);
  }

  console.log(`\n总共处理 ${processedCount} 个钱包`);
  console.log(`发现强短线交易者: ${strongTraderCount} 个 (${(strongTraderCount/processedCount*100).toFixed(1)}%)`);

  // ========== 步骤4: 统计与关联分析 ==========
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【步骤4】统计与关联分析');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 按质量分组
  const qualityGroups = {
    high_quality: [],
    mid_quality: [],
    low_quality: [],
    fake_pump: [],
    no_user: [],
    unlabeled: []
  };

  for (const [tokenAddr, stats] of tokenWalletStats.entries()) {
    const quality = stats.qualityLabel || 'unlabeled';
    if (qualityGroups[quality]) {
      qualityGroups[quality].push({
        address: tokenAddr,
        symbol: stats.symbol,
        totalWallets: stats.wallets.size,
        strongTraderCount: stats.strongTraders.size,
        strongTraderRatio: stats.wallets.size > 0 ? stats.strongTraders.size / stats.wallets.size : 0
      });
    }
  }

  // 打印分组统计
  console.log('代币'.padEnd(20) + '数量'.padEnd(8) + '平均钱包数'.padEnd(12) + '平均强短线者'.padEnd(14) + '平均占比');
  console.log('─'.repeat(80));

  for (const [quality, tokens] of Object.entries(qualityGroups)) {
    if (tokens.length === 0) continue;

    const avgWallets = (tokens.reduce((sum, t) => sum + t.totalWallets, 0) / tokens.length).toFixed(1);
    const avgStrong = (tokens.reduce((sum, t) => sum + t.strongTraderCount, 0) / tokens.length).toFixed(1);
    const avgRatio = (tokens.reduce((sum, t) => sum + t.strongTraderRatio, 0) / tokens.length * 100).toFixed(2);

    console.log(
      quality.padEnd(20) +
      tokens.length.toString().padEnd(8) +
      avgWallets.padEnd(12) +
      avgStrong.padEnd(14) +
      `${avgRatio}%`
    );
  }

  // ========== 步骤5: 详细代币列表 ==========
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【步骤5】代币详细列表（按强短线交易者占比排序）');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const allTokensList = [];
  for (const [tokenAddr, stats] of tokenWalletStats.entries()) {
    allTokensList.push({
      address: tokenAddr,
      symbol: stats.symbol,
      qualityLabel: stats.qualityLabel || 'unlabeled',
      totalWallets: stats.wallets.size,
      strongTraderCount: stats.strongTraders.size,
      strongTraderRatio: stats.wallets.size > 0 ? stats.strongTraders.size / stats.wallets.size : 0
    });
  }

  // 按强短线交易者占比降序排序
  allTokensList.sort((a, b) => b.strongTraderRatio - a.strongTraderRatio);

  console.log('代币'.padEnd(20) + '质量'.padEnd(15) + '总钱包数'.padEnd(10) + '强短线者'.padEnd(10) + '占比');
  console.log('─'.repeat(70));

  for (const token of allTokensList) {
    console.log(
      token.symbol.padEnd(20) +
      token.qualityLabel.padEnd(15) +
      token.totalWallets.toString().padEnd(10) +
      token.strongTraderCount.toString().padEnd(10) +
      `${(token.strongTraderRatio * 100).toFixed(1)}%`
    );
  }

  // ========== 总结 ==========
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【总结】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 计算各质量组的平均强短线交易者占比
  const groupStats = {};
  for (const [quality, tokens] of Object.entries(qualityGroups)) {
    if (tokens.length === 0) continue;
    groupStats[quality] = {
      count: tokens.length,
      avgRatio: (tokens.reduce((sum, t) => sum + t.strongTraderRatio, 0) / tokens.length * 100).toFixed(2),
      avgStrongCount: (tokens.reduce((sum, t) => sum + t.strongTraderCount, 0) / tokens.length).toFixed(2)
    };
  }

  console.log('质量分组统计（按平均强短线交易者占比排序）:');
  console.log('');

  const sortedGroups = Object.entries(groupStats)
    .sort((a, b) => parseFloat(b[1].avgRatio) - parseFloat(a[1].avgRatio));

  for (const [quality, stats] of sortedGroups) {
    console.log(`  ${quality.padEnd(15)}: ${stats.count}个代币, 平均占比 ${stats.avgRatio}%, 平均数量 ${stats.avgStrongCount}`);
  }

  console.log('\n分析完成！');
}

main().catch(console.error);
