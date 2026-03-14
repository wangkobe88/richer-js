/**
 * 从实验中获取符合条件的代币及其早期参与者数据（带钱包缓存）
 *
 * 条件:
 * 1. 指定实验ID
 * 2. 有BUY信号且 executed = true
 * 3. 有交易记录（trades表中 success = true）
 * 4. 有人工评级（experiment_tokens.human_judges IS NOT NULL）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// 从环境变量或配置文件读取数据库连接
require('dotenv').config({ path: path.join(__dirname, '../../config/.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('错误: 缺少数据库配置。请检查 config/.env 文件');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ========== 钱包缓存系统 ==========

const CACHE_DIR = path.join(__dirname, 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'wallet_cache.json');
const SAVE_INTERVAL = 60; // 每60秒保存一次缓存

// 确保缓存目录存在
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// 钱包缓存
const walletCache = {
  wallets: {},
  stats: {
    total_cached: 0,
    cache_hits: 0,
    cache_misses: 0
  }
};

// 加载缓存
function loadWalletCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, 'utf8');
      const cached = JSON.parse(data);
      walletCache.wallets = cached.wallets || {};
      walletCache.stats = cached.stats || { total_cached: 0, cache_hits: 0, cache_misses: 0 };
      console.log(`✓ 已加载缓存: ${walletCache.stats.total_cached} 个钱包`);
    }
  } catch (error) {
    console.warn('加载缓存失败，将创建新缓存:', error.message);
  }
}

// 保存缓存
function saveWalletCache() {
  try {
    walletCache.stats.total_cached = Object.keys(walletCache.wallets).length;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(walletCache, null, 2));
  } catch (error) {
    console.error('保存缓存失败:', error.message);
  }
}

// 定时保存缓存
let saveInterval = null;

function startAutoSave() {
  if (saveInterval) clearInterval(saveInterval);
  saveInterval = setInterval(() => {
    saveWalletCache();
    console.log(`  [缓存] 已保存: ${walletCache.stats.total_cached} 个钱包, 命中: ${walletCache.stats.cache_hits}, 未命中: ${walletCache.stats.cache_misses}`);
  }, SAVE_INTERVAL * 1000);
}

function stopAutoSave() {
  if (saveInterval) {
    clearInterval(saveInterval);
    saveInterval = null;
  }
  saveWalletCache(); // 最终保存
}

// 从缓存获取钱包数据
function getWalletFromCache(walletAddress) {
  const key = walletAddress.toLowerCase();
  if (walletCache.wallets[key]) {
    walletCache.stats.cache_hits++;
    return walletCache.wallets[key];
  }
  walletCache.stats.cache_misses++;
  return null;
}

// 保存钱包到缓存
function saveWalletToCache(walletData) {
  const key = walletData.address.toLowerCase();
  walletCache.wallets[key] = {
    ...walletData,
    cached_at: new Date().toISOString()
  };
  walletCache.stats.total_cached = Object.keys(walletCache.wallets).length;
}

// HTTP请求封装
function post(url, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(url, options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 步骤1: 获取符合条件的代币
 */
async function getTargetTokens(experimentId) {
  console.log('='.repeat(80));
  console.log(`[步骤1] 获取实验 ${experimentId} 中符合条件的代币`);
  console.log('='.repeat(80));

  try {
    // 查询有BUY信号的代币
    console.log('\n  1.1 查询BUY信号...');
    const { data: buySignals, error: signalsError } = await supabase
      .from('strategy_signals')
      .select('id, token_address, token_symbol, action, executed, metadata')
      .eq('experiment_id', experimentId)
      .eq('action', 'buy')
      .eq('executed', true);

    if (signalsError) throw signalsError;

    console.log(`  找到 ${buySignals.length} 个已执行的BUY信号`);

    if (buySignals.length === 0) {
      console.log('  没有找到符合条件的BUY信号');
      return [];
    }

    // 查询有交易记录的信号
    console.log('\n  1.2 查询有交易记录的信号...');
    const signalIds = buySignals.map(s => s.id);

    const { data: trades, error: tradesError } = await supabase
      .from('trades')
      .select('id, signal_id, token_address, success')
      .eq('experiment_id', experimentId)
      .eq('success', true)
      .in('signal_id', signalIds);

    if (tradesError) throw tradesError;

    const tradedSignalIds = new Set(trades.map(t => t.signal_id));
    console.log(`  找到 ${trades.length} 条成功的交易记录，涉及 ${tradedSignalIds.size} 个信号`);

    // 筛选有交易记录的信号
    const tradedSignals = buySignals.filter(s => tradedSignalIds.has(s.id));
    const tradedTokenAddresses = new Set(tradedSignals.map(s => s.token_address));
    console.log(`  涉及 ${tradedTokenAddresses.size} 个不同的代币`);

    // 查询有人工评级的代币
    console.log('\n  1.3 查询有人工评级的代币...');
    const { data: tokens, error: tokensError } = await supabase
      .from('experiment_tokens')
      .select('id, token_address, token_symbol, human_judges, raw_api_data, status, discovered_at')
      .eq('experiment_id', experimentId)
      .in('token_address', Array.from(tradedTokenAddresses));

    if (tokensError) throw tokensError;

    // 筛选有人工评级的代币
    const tokensWithJudges = tokens.filter(t => t.human_judges && Object.keys(t.human_judges).length > 0);
    console.log(`  找到 ${tokensWithJudges.length} 个有人工评级的代币`);

    if (tokensWithJudges.length === 0) {
      console.log('  没有找到有人工评级的代币');
      return [];
    }

    // 组合结果
    const result = tokensWithJudges.map(token => {
      const signal = tradedSignals.find(s => s.token_address === token.token_address);
      const trade = trades.find(t => t.signal_id === signal?.id);

      return {
        tokenAddress: token.token_address,
        tokenSymbol: token.token_symbol || 'Unknown',
        status: token.status,
        discoveredAt: token.discovered_at,
        humanJudges: token.human_judges,
        rawApiData: token.raw_api_data,
        signalId: signal?.id,
        signalMetadata: signal?.metadata,
        tradeId: trade?.id
      };
    });

    console.log('\n  ✓ 符合条件的代币:');
    result.forEach((t, i) => {
      const judgeLabel = t.humanJudges?.label || '无标签';
      const judgeScore = t.humanJudges?.score || '无评分';
      console.log(`    ${i + 1}. ${t.tokenSymbol} (${t.tokenAddress.slice(0, 10)}...) - 评级: ${judgeLabel}, 分数: ${judgeScore}`);
    });

    return result;

  } catch (error) {
    console.error('获取目标代币失败:', error);
    return [];
  }
}

/**
 * 步骤2: 获取代币的早期参与者数据
 */
async function getTokenEarlyParticipants(tokenAddress, chain = 'bsc', timeWindowMinutes = 3) {
  try {
    const response = await post('http://localhost:3010/api/token-early-trades', {
      tokenAddress,
      chain,
      timeWindowMinutes,
      limit: 1000
    });

    if (!response.success) {
      console.error(`    获取 ${tokenAddress.slice(0, 10)}... 早期交易失败: ${response.error}`);
      return [];
    }

    const earlyTrades = response.data.earlyTrades || [];
    console.log(`    获取到 ${earlyTrades.length} 条早期交易记录`);

    // 提取唯一钱包地址
    const wallets = new Set();
    earlyTrades.forEach(trade => {
      if (trade.from_address) wallets.add(trade.from_address.toLowerCase());
      if (trade.to_address) wallets.add(trade.to_address.toLowerCase());
    });

    console.log(`    提取到 ${wallets.size} 个唯一钱包地址`);
    return Array.from(wallets);

  } catch (error) {
    console.error(`    获取 ${tokenAddress.slice(0, 10)}... 早期参与者失败: ${error.message}`);
    return [];
  }
}

/**
 * 步骤3: 获取钱包详细数据（带缓存）
 */
async function getWalletDetails(walletAddresses, chain = 'bsc') {
  const walletData = [];
  let processedCount = 0;
  let errorCount = 0;
  let fromCache = 0;

  console.log(`    获取 ${walletAddresses.length} 个钱包的详细数据...`);

  for (const wallet of walletAddresses) {
    try {
      // 先检查缓存
      const cached = getWalletFromCache(wallet);
      if (cached) {
        walletData.push(cached);
        fromCache++;
        processedCount++;

        if (processedCount % 50 === 0) {
          console.log(`      已处理 ${processedCount}/${walletAddresses.length} 个钱包 (缓存: ${fromCache}, 新查询: ${processedCount - fromCache})...`);
        }
        continue; // 跳过API查询
      }

      // 缓存中没有，查询API
      const response = await post('http://localhost:3010/api/wallet/query', {
        walletAddress: wallet,
        chain
      });

      if (response.success && response.data) {
        const info = response.data.walletInfo;

        // 计算钱包年龄（天数）：wallet_age 是时间戳，需要转换为天数
        let walletAgeDays = 0;
        if (info.wallet_age && info.wallet_age > 0) {
          // wallet_age 是第一次交易时间戳，计算距今的天数
          const now = Math.floor(Date.now() / 1000);
          walletAgeDays = Math.floor((now - info.wallet_age) / 86400);
          if (walletAgeDays < 0) walletAgeDays = 0;
        }

        const walletInfo = {
          address: wallet,
          total_balance: info.total_balance || 0,
          total_unrealized_profit: info.total_unrealized_profit || 0,
          total_realized_profit: info.total_realized_profit || 0,
          total_all_profit: (info.total_unrealized_profit || 0) + (info.total_realized_profit || 0),
          total_tokens: response.data.tokens?.length || 0,
          profitable_tokens: 0,
          losing_tokens: 0,
          total_trades: (info.total_purchase || 0) + (info.total_sold || 0),
          wallet_age_days: walletAgeDays,
          total_purchase: info.total_purchase || 0,
          total_sold: info.total_sold || 0,
          chain: chain
        };

        // 计算盈利/亏损代币数
        const tokens = response.data.tokens || [];
        tokens.forEach(t => {
          if (t.total_profit > 0) walletInfo.profitable_tokens++;
          else if (t.total_profit < 0) walletInfo.losing_tokens++;
        });

        walletData.push(walletInfo);

        // 保存到缓存
        saveWalletToCache(walletInfo);

        processedCount++;

        if (processedCount % 10 === 0) {
          console.log(`      已处理 ${processedCount}/${walletAddresses.length} 个钱包 (缓存: ${fromCache}, 新查询: ${processedCount - fromCache})...`);
        }
      }

      // 避免限流 - 只在真正查询API时等待
      await sleep(500);

    } catch (error) {
      errorCount++;
      if (errorCount <= 5) {
        console.error(`      钱包 ${wallet.slice(0, 10)}... 查询失败: ${error.message}`);
      }
    }
  }

  console.log(`    成功获取 ${walletData.length} 个钱包的数据 (缓存: ${fromCache}, 新查询: ${walletData.length - fromCache}, 失败: ${errorCount})`);
  return walletData;
}

/**
 * 主函数
 */
async function main() {
  const experimentId = process.argv[2] || '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';
  const timeWindowMinutes = parseInt(process.argv[3]) || 3;
  const chain = process.argv[4] || 'bsc';

  console.log('='.repeat(80));
  console.log('从实验中获取代币早期参与者数据（带钱包缓存）');
  console.log('='.repeat(80));
  console.log(`实验ID: ${experimentId}`);
  console.log(`时间窗口: ${timeWindowMinutes} 分钟`);
  console.log(`链: ${chain}`);
  console.log('');

  // 加载钱包缓存
  console.log('加载钱包缓存...');
  loadWalletCache();
  startAutoSave(); // 启动自动保存

  // 确保程序退出时保存缓存
  process.on('SIGINT', () => {
    console.log('\n收到中断信号，正在保存缓存...');
    stopAutoSave();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    console.log('\n收到终止信号，正在保存缓存...');
    stopAutoSave();
    process.exit(0);
  });

  // 检查web服务器是否运行
  try {
    await post('http://localhost:3010/api/health', {});
  } catch (error) {
    console.error('错误: 无法连接到 web 服务器。请先运行 `npm run web` 启动服务器');
    stopAutoSave();
    process.exit(1);
  }

  // 步骤1: 获取符合条件的代币
  const targetTokens = await getTargetTokens(experimentId);

  if (targetTokens.length === 0) {
    console.log('\n没有找到符合条件的代币，程序结束');
    stopAutoSave();
    return;
  }

  // 步骤2-4: 获取早期参与者数据
  console.log('\n' + '='.repeat(80));
  console.log('[步骤2] 获取代币早期参与者数据');
  console.log('='.repeat(80));

  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < targetTokens.length; i++) {
    const token = targetTokens[i];
    console.log(`\n[${i + 1}/${targetTokens.length}] 处理代币: ${token.tokenSymbol} (${token.tokenAddress.slice(0, 10)}...)`);

    // 获取早期参与者钱包地址
    const walletAddresses = await getTokenEarlyParticipants(token.tokenAddress, chain, timeWindowMinutes);

    if (walletAddresses.length === 0) {
      console.log(`    没有找到早期参与者，跳过`);
      continue;
    }

    // 获取钱包详细数据
    const walletDetails = await getWalletDetails(walletAddresses, chain);

    // 组装结果
    results.push({
      ...token,
      earlyParticipants: {
        totalWallets: walletAddresses.length,
        successfulQueries: walletDetails.length,
        wallets: walletDetails,
        timeWindowMinutes: timeWindowMinutes
      }
    });

    console.log(`    ✓ 完成: ${walletDetails.length}/${walletAddresses.length} 个钱包获取到数据`);
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(2);

  // 保存结果
  console.log('\n' + '='.repeat(80));
  console.log('[步骤3] 保存结果');
  console.log('='.repeat(80));

  const outputDir = path.join(__dirname, 'data');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputFile = path.join(outputDir, `experiment_${experimentId.slice(0, 8)}_${timestamp}.json`);

  const outputData = {
    experimentId: experimentId,
    chain: chain,
    timeWindowMinutes: timeWindowMinutes,
    timestamp: new Date().toISOString(),
    elapsedMinutes: elapsed,
    totalTokens: results.length,
    cacheStats: {
      totalCached: walletCache.stats.total_cached,
      cacheHits: walletCache.stats.cache_hits,
      cacheMisses: walletCache.stats.cache_misses
    },
    tokens: results
  };

  fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2));
  console.log(`\n结果已保存到: ${outputFile}`);

  // 停止自动保存并最终保存缓存
  stopAutoSave();

  // 打印统计摘要
  console.log('\n' + '='.repeat(80));
  console.log('[统计摘要]');
  console.log('='.repeat(80));

  let totalWallets = 0;
  let totalSuccessfulQueries = 0;

  results.forEach((token, i) => {
    totalWallets += token.earlyParticipants.totalWallets;
    totalSuccessfulQueries += token.earlyParticipants.successfulQueries;

    const avgBalance = token.earlyParticipants.wallets.length > 0
      ? (token.earlyParticipants.wallets.reduce((sum, w) => sum + w.total_balance, 0) / token.earlyParticipants.wallets.length).toFixed(2)
      : 0;
    const avgTrades = token.earlyParticipants.wallets.length > 0
      ? (token.earlyParticipants.wallets.reduce((sum, w) => sum + w.total_trades, 0) / token.earlyParticipants.wallets.length).toFixed(0)
      : 0;

    console.log(`\n${i + 1}. ${token.tokenSymbol} (${token.tokenAddress.slice(0, 10)}...)`);
    console.log(`   评级: ${token.humanJudges?.label || '无'} (${token.humanJudges?.score || '无'})`);
    console.log(`   钱包: ${token.earlyParticipants.successfulQueries}/${token.earlyParticipants.totalWallets}`);
    console.log(`   平均持仓: $${avgBalance}, 平均交易: ${avgTrades}次`);
  });

  console.log(`\n总计: ${results.length} 个代币, ${totalSuccessfulQueries}/${totalWallets} 个钱包获取到数据`);
  console.log(`耗时: ${elapsed} 分钟`);
  console.log(`缓存统计: 总共 ${walletCache.stats.totalCached} 个钱包, 命中 ${walletCache.stats.cache_hits} 次, 未命中 ${walletCache.stats.cache_misses} 次`);

  console.log('\n' + '='.repeat(80));
  console.log('完成！');
  console.log('='.repeat(80));
}

main().catch(error => {
  console.error('程序出错:', error);
  stopAutoSave();
  process.exit(1);
});
