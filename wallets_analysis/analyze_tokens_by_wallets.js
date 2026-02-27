/**
 * 代币分析工具 - 基于钱包画像分析代币
 * 分析目标实验中有交易记录的代币的早期交易者画像
 */

import { createClient } from '@supabase/supabase-js';
import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { EarlyTradesService } from './services/EarlyTradesService.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { glob } from 'glob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
dotenvConfig({ path: resolve(__dirname, '../config/.env') });

import config from './config.js';

// 分类映射
const CATEGORY_MAP = {
  fake_pump: { label: '流水盘', emoji: '🎭', quality: 'low', weight: -100 },
  no_user: { label: '无人玩', emoji: '👻', quality: 'low', weight: -50 },
  low_quality: { label: '低质量', emoji: '📉', quality: 'low', weight: -50 },
  mid_quality: { label: '中质量', emoji: '📊', quality: 'mid', weight: 50 },
  high_quality: { label: '高质量', emoji: '🚀', quality: 'high', weight: 200 }
};

// 目标实验ID
const TARGET_EXPERIMENT_ID = 'f6c98a91-c120-4bbf-b7e0-69d33de306cb';

/**
 * 代币分析服务
 */
class TokenAnalysisService {
  constructor() {
    // 初始化 Supabase 客户端
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('缺少 SUPABASE_URL 或 SUPABASE_ANON_KEY 环境变量');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.earlyTradesService = new EarlyTradesService();

    // 钱包画像数据
    this.walletProfiles = new Map();
  }

  /**
   * 加载钱包画像数据
   */
  async loadWalletProfiles() {
    console.log('\n📂 加载钱包画像数据...');

    // 查找最新的钱包画像文件（排除summary文件）
    const pattern = resolve(__dirname, 'output', 'wallet_profiles_*.json');
    const files = glob.sync(pattern).filter(f => !f.includes('_summary.json'));

    if (files.length === 0) {
      console.warn('   ⚠️  未找到钱包画像文件');
      return false;
    }

    // 按文件名排序，获取最新的
    files.sort().reverse();
    const latestFile = files[0];
    console.log(`   📄 读取文件: ${latestFile}`);

    try {
      const data = JSON.parse(readFileSync(latestFile, 'utf-8'));

      // 完整数据在 data.wallets 中
      const walletsData = data.wallets || {};
      for (const [wallet, profile] of Object.entries(walletsData)) {
        this.walletProfiles.set(wallet.toLowerCase(), {
          totalParticipations: profile.total_participations,
          categories: profile.categories,
          dominantCategory: profile.dominant_category,
          tokens: profile.tokens
        });
      }

      console.log(`   ✅ 成功加载 ${this.walletProfiles.size} 个钱包画像`);
      return true;

    } catch (error) {
      console.error(`   ❌ 加载钱包画像失败: ${error.message}`);
      return false;
    }
  }

  /**
   * 获取实验的交易数据
   */
  async getExperimentTrades(experimentId) {
    console.log(`\n📊 获取实验 ${experimentId.slice(0, 8)}... 的交易数据...`);

    const PAGE_SIZE = 1000;
    let allTrades = [];
    let offset = 0;

    while (true) {
      const { data, error } = await this.supabase
        .from('trades')
        .select('*')
        .eq('experiment_id', experimentId)
        .range(offset, offset + PAGE_SIZE - 1)
        .order('created_at', { ascending: false });

      if (error) {
        console.error(`   ❌ 获取交易数据失败: ${error.message}`);
        return [];
      }

      if (!data || data.length === 0) break;

      allTrades.push(...data);
      offset += PAGE_SIZE;

      if (data.length < PAGE_SIZE) break;
    }

    console.log(`   ✅ 获取到 ${allTrades.length} 条交易记录`);

    // 提取代币地址列表（有交易的代币）
    const tokenAddresses = [...new Set(allTrades.map(t => t.token_address))];
    console.log(`   📈 涉及 ${tokenAddresses.length} 个代币`);

    return {
      trades: allTrades,
      tokenAddresses
    };
  }

  /**
   * 获取代币的基本信息
   */
  async getTokensInfo(experimentId, tokenAddresses) {
    console.log('\n📋 获取代币信息...');

    const tokensInfo = new Map();

    // 批量获取代币信息
    for (const tokenAddress of tokenAddresses) {
      const { data, error } = await this.supabase
        .from('experiment_tokens')
        .select('*')
        .eq('experiment_id', experimentId)
        .eq('token_address', tokenAddress)
        .maybeSingle();

      if (!error && data) {
        // 从 raw_api_data 获取 main_pair
        const mainPair = data.raw_api_data?.main_pair || null;

        tokensInfo.set(tokenAddress, {
          address: tokenAddress,
          symbol: data.token_symbol || data.raw_api_data?.symbol || 'Unknown',
          chain: data.blockchain || 'bsc',
          platform: data.platform || 'fourmeme',
          mainPair: mainPair,
          humanJudges: data.human_judges || null
        });
      } else {
        tokensInfo.set(tokenAddress, {
          address: tokenAddress,
          symbol: 'Unknown',
          chain: 'bsc',
          platform: 'fourmeme',
          mainPair: null,
          humanJudges: null
        });
      }
    }

    console.log(`   ✅ 获取到 ${tokensInfo.size} 个代币的信息`);
    return tokensInfo;
  }

  /**
   * 获取代币的收益数据（从交易数据计算）
   */
  async getTokenReturns(experimentId) {
    console.log('\n💰 获取代币收益数据...');

    const PAGE_SIZE = 1000;
    let allTrades = [];
    let offset = 0;

    // 获取所有交易数据
    while (true) {
      const { data, error } = await this.supabase
        .from('trades')
        .select('*')
        .eq('experiment_id', experimentId)
        .range(offset, offset + PAGE_SIZE - 1)
        .order('created_at', { ascending: false });

      if (error) {
        console.error(`   ❌ 获取交易数据失败: ${error.message}`);
        return {};
      }

      if (!data || data.length === 0) break;

      allTrades.push(...data);
      offset += PAGE_SIZE;

      if (data.length < PAGE_SIZE) break;
    }

    // 按代币分组计算收益
    const tokenReturns = {};
    const tokenTrades = {};

    // 首先按代币分组交易
    for (const trade of allTrades) {
      const addr = trade.token_address;
      if (!tokenTrades[addr]) {
        tokenTrades[addr] = [];
      }
      tokenTrades[addr].push(trade);
    }

    // 计算每个代币的收益
    for (const [tokenAddress, trades] of Object.entries(tokenTrades)) {
      // 按时间排序
      trades.sort((a, b) => new Date(a.created_at || a.executed_at) - new Date(b.created_at || b.executed_at));

      // FIFO 队列
      const buyQueue = [];
      let totalRealizedPnL = 0;
      let totalBNBSpent = 0;
      let totalBNBReceived = 0;

      for (const trade of trades) {
        const direction = trade.trade_direction || trade.direction || trade.action;
        const isBuy = direction === 'buy' || direction === 'BUY';

        if (isBuy) {
          const inputAmount = parseFloat(trade.input_amount || 0);
          const outputAmount = parseFloat(trade.output_amount || 0);

          if (outputAmount > 0) {
            buyQueue.push({
              amount: outputAmount,
              cost: inputAmount
            });
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
      }

      // 计算剩余持仓成本
      let remainingCost = 0;
      for (const buy of buyQueue) {
        remainingCost += buy.cost;
      }

      // 计算收益率
      const totalCost = totalBNBSpent || 1;
      const totalValue = totalBNBReceived + remainingCost;
      const returnRate = ((totalValue - totalCost) / totalCost) * 100;

      // 获取代币符号
      const symbol = trades[0]?.token_symbol || 'Unknown';

      tokenReturns[tokenAddress] = {
        returnRate,
        realizedPnL: totalRealizedPnL,
        totalSpent: totalBNBSpent,
        totalReceived: totalBNBReceived,
        symbol
      };
    }

    console.log(`   ✅ 计算了 ${Object.keys(tokenReturns).length} 个代币的收益`);
    return tokenReturns;
  }

  /**
   * 分析代币的早期交易者
   */
  async analyzeTokenEarlyTraders(tokenAddresses, tokensInfo) {
    console.log('\n🔍 分析代币早期交易者...');

    const tokenProfiles = new Map();
    let processed = 0;

    for (const tokenAddress of tokenAddresses) {
      const tokenInfo = tokensInfo.get(tokenAddress);
      const chain = tokenInfo?.chain || 'bsc';

      // 创建空的分析结果（即使失败也保留代币）
      const emptyAnalysis = {
        tokenAddress,
        symbol: tokenInfo?.symbol || 'Unknown',
        chain,
        totalWallets: 0,
        matchedWallets: 0,
        unmatchedWallets: 0,
        categoryParticipation: {
          fake_pump: 0,
          no_user: 0,
          low_quality: 0,
          mid_quality: 0,
          high_quality: 0
        },
        wallets: [],
        error: null
      };

      try {
        // 获取早期交易者（传递代币信息以获取正确的 main_pair）
        const traders = await this.earlyTradesService.getEarlyTraders(tokenAddress, chain, tokenInfo);

        if (traders.size === 0) {
          console.log(`   ⚠️  代币 ${tokenInfo?.symbol || tokenAddress.slice(0, 10)}... 没有早期交易者`);
          emptyAnalysis.error = 'No early traders found';
          tokenProfiles.set(tokenAddress, emptyAnalysis);
          processed++;
          // 请求延迟
          if (processed < tokenAddresses.length) {
            await this._delay(config.analysis.requestDelay);
          }
          continue;
        }

        // 分析这些钱包的画像
        // 不再做钱包质量分类，直接统计钱包历史上参与各类型代币的次数
        const walletAnalysis = {
          tokenAddress,
          symbol: tokenInfo?.symbol || 'Unknown',
          chain,
          totalWallets: traders.size,
          matchedWallets: 0,
          unmatchedWallets: 0,
          // 直接统计：这些钱包历史上参与各类型代币的总次数
          categoryParticipation: {
            fake_pump: 0,    // 流水盘代币参与总次数
            no_user: 0,      // 无人玩代币参与总次数
            low_quality: 0,  // 低质量代币参与总次数
            mid_quality: 0,  // 中质量代币参与总次数
            high_quality: 0  // 高质量代币参与总次数
          },
          wallets: [],
          error: null
        };

        for (const wallet of traders) {
          const profile = this.walletProfiles.get(wallet.toLowerCase());

          if (profile) {
            walletAnalysis.matchedWallets++;

            // 直接累加该钱包历史上参与各类型代币的次数
            const categories = profile.categories || {};
            for (const [cat, count] of Object.entries(categories)) {
              if (walletAnalysis.categoryParticipation[cat] !== undefined) {
                walletAnalysis.categoryParticipation[cat] += count;
              }
            }

            // 记录钱包信息
            walletAnalysis.wallets.push({
              address: wallet,
              categories: categories
            });
          } else {
            walletAnalysis.unmatchedWallets++;
            walletAnalysis.wallets.push({
              address: wallet,
              categories: {}
            });
          }
        }

        tokenProfiles.set(tokenAddress, walletAnalysis);

        processed++;
        console.log(`   ✅ [${processed}/${tokenAddresses.length}] 代币 ${tokenInfo?.symbol || tokenAddress.slice(0, 10)}... 早期交易者: ${traders.size}, 匹配画像: ${walletAnalysis.matchedWallets}`);

        // 请求延迟
        if (processed < tokenAddresses.length) {
          await this._delay(config.analysis.requestDelay);
        }

      } catch (error) {
        console.error(`   ❌ 代币 ${tokenInfo?.symbol || tokenAddress.slice(0, 10)}... 分析失败: ${error.message}`);
        emptyAnalysis.error = error.message;
        tokenProfiles.set(tokenAddress, emptyAnalysis);
        processed++;
      }
    }

    console.log(`\n✅ 分析完成，处理了 ${tokenProfiles.size} 个代币`);
    return tokenProfiles;
  }

  /**
   * 生成统计摘要
   */
  generateSummary(tokenProfiles) {
    console.log('\n📊 生成统计摘要...');

    const summary = {
      generated_at: new Date().toISOString(),
      experiment_id: TARGET_EXPERIMENT_ID,
      total_tokens: tokenProfiles.size,
      // 各代币类型的参与总次数
      categoryParticipation: {
        fake_pump: 0,
        no_user: 0,
        low_quality: 0,
        mid_quality: 0,
        high_quality: 0
      },
      topTokens: []
    };

    const tokensByReturn = [];

    for (const [tokenAddress, profile] of tokenProfiles) {
      // 累计各代币类型的参与次数
      const categoryParticipation = profile.categoryParticipation || {
        fake_pump: 0,
        no_user: 0,
        low_quality: 0,
        mid_quality: 0,
        high_quality: 0
      };

      for (const [cat, count] of Object.entries(categoryParticipation)) {
        summary.categoryParticipation[cat] += count;
      }

      // 按收益率排序
      const returnRate = profile.returnData ? profile.returnData.returnRate : 0;
      tokensByReturn.push({
        tokenAddress,
        symbol: profile.symbol,
        ...profile,
        returnRate
      });
    }

    // 按收益率排序
    tokensByReturn.sort((a, b) => b.returnRate - a.returnRate);
    summary.topTokens = tokensByReturn.slice(0, 50);

    return summary;
  }

  /**
   * 保存结果
   */
  saveResults(tokenProfiles, summary) {
    console.log('\n💾 保存分析结果...');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const outputDir = resolve(__dirname, 'output');

    // 保存完整数据
    const fullDataPath = resolve(outputDir, `token_analysis_${timestamp}.json`);
    const fullData = {};
    for (const [tokenAddress, profile] of tokenProfiles) {
      fullData[tokenAddress] = profile;
    }
    writeFileSync(fullDataPath, JSON.stringify(fullData, null, 2));
    console.log(`   📄 完整数据: ${fullDataPath}`);

    // 保存摘要
    const summaryPath = resolve(outputDir, `token_analysis_${timestamp}_summary.json`);
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`   📄 摘要数据: ${summaryPath}`);

    // 保存 CSV
    const csvPath = resolve(outputDir, `token_analysis_${timestamp}.csv`);
    const headers = ['代币', '代币地址', '收益率(%)', '盈亏(BNB)', '早期交易者总数', '匹配画像数',
                      '流水盘代币参与次数', '无人玩代币参与次数', '低质量代币参与次数', '中质量代币参与次数', '高质量代币参与次数'];

    const rows = [[...headers]];
    for (const [tokenAddress, profile] of tokenProfiles) {
      // 收益数据
      const returnRate = profile.returnData ? profile.returnData.returnRate.toFixed(2) : 'N/A';
      const pnl = profile.returnData ? profile.returnData.realizedPnL.toFixed(4) : 'N/A';

      // 代币类型参与统计
      const catPart = profile.categoryParticipation || {
        fake_pump: 0,
        no_user: 0,
        low_quality: 0,
        mid_quality: 0,
        high_quality: 0
      };

      rows.push([
        profile.symbol,
        tokenAddress,
        returnRate,
        pnl,
        profile.totalWallets,
        profile.matchedWallets,
        catPart.fake_pump,
        catPart.no_user,
        catPart.low_quality,
        catPart.mid_quality,
        catPart.high_quality
      ]);
    }

    const csvContent = rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    writeFileSync(csvPath, '\ufeff' + csvContent, 'utf8');
    console.log(`   📄 CSV数据: ${csvPath}`);

    console.log('\n✅ 保存完成');
  }

  /**
   * 延迟函数
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 清理
   */
  cleanup() {
    this.earlyTradesService.clearCache();
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('   代币钱包画像分析工具');
  console.log('========================================');

  const service = new TokenAnalysisService();

  try {
    // 1. 加载钱包画像数据
    const loaded = await service.loadWalletProfiles();
    if (!loaded) {
      console.error('\n❌ 无法继续分析，缺少钱包画像数据');
      console.log('   请先运行钱包画像分析工具生成数据');
      return;
    }

    // 2. 获取实验的交易数据
    const { trades, tokenAddresses } = await service.getExperimentTrades(TARGET_EXPERIMENT_ID);

    if (tokenAddresses.length === 0) {
      console.log('\n⚠️  实验中没有交易记录的代币');
      return;
    }

    // 3. 获取代币信息
    const tokensInfo = await service.getTokensInfo(TARGET_EXPERIMENT_ID, tokenAddresses);

    // 4. 获取代币收益数据
    const tokenReturns = await service.getTokenReturns(TARGET_EXPERIMENT_ID);

    // 5. 分析代币的早期交易者
    const tokenProfiles = await service.analyzeTokenEarlyTraders(tokenAddresses, tokensInfo);

    // 合并收益数据到 tokenProfiles
    for (const [tokenAddress, profile] of tokenProfiles) {
      if (tokenReturns[tokenAddress]) {
        profile.returnData = tokenReturns[tokenAddress];
      }
    }

    // 6. 生成统计摘要
    const summary = service.generateSummary(tokenProfiles);

    // 7. 保存结果
    service.saveResults(tokenProfiles, summary);

    // 打印统计摘要
    console.log('\n========================================');
    console.log('   分析结果摘要');
    console.log('========================================');
    console.log(`📊 分析代币数量: ${summary.total_tokens}`);

    console.log(`\n🔗 各代币类型参与总次数 (这些钱包历史上参与各类型代币的总次数):`);
    console.log(`   流水盘代币: ${summary.categoryParticipation.fake_pump}`);
    console.log(`   无人玩代币: ${summary.categoryParticipation.no_user}`);
    console.log(`   低质量代币: ${summary.categoryParticipation.low_quality}`);
    console.log(`   中质量代币: ${summary.categoryParticipation.mid_quality}`);
    console.log(`   高质量代币: ${summary.categoryParticipation.high_quality}`);

    console.log(`\n🏆 Top 10 收益率代币:`);
    for (let i = 0; i < Math.min(10, summary.topTokens.length); i++) {
      const token = summary.topTokens[i];
      const returnRate = token.returnData ? token.returnData.returnRate.toFixed(2) : 'N/A';
      const catPart = token.categoryParticipation || {
        fake_pump: 0,
        no_user: 0,
        low_quality: 0,
        mid_quality: 0,
        high_quality: 0
      };
      console.log(`   ${i + 1}. ${token.symbol} - 收益率: ${returnRate}% | 流水盘:${catPart.fake_pump} 高质量:${catPart.high_quality}`);
    }

  } catch (error) {
    console.error('\n❌ 分析失败:', error);
  } finally {
    service.cleanup();
  }

  console.log('\n✅ 分析完成');
}

// 运行
main().catch(console.error);
