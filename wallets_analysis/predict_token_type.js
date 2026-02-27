/**
 * 代币类型预测工具 - 基于钱包画像预测代币性质
 * 目标：区分流水盘（fake_pump）vs 其他类型
 */

import { createClient } from '@supabase/supabase-js';
import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { EarlyTradesService } from './services/EarlyTradesService.js';
import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
dotenvConfig({ path: resolve(__dirname, '../config/.env') });

import config from './config.js';

// 分类映射
const CATEGORY_MAP = {
  fake_pump: { label: '流水盘', emoji: '🎭' },
  no_user: { label: '无人玩', emoji: '👻' },
  low_quality: { label: '低质量', emoji: '📉' },
  mid_quality: { label: '中质量', emoji: '📊' },
  high_quality: { label: '高质量', emoji: '🚀' }
};

// 目标实验ID
const TARGET_EXPERIMENT_ID = 'f6c98a91-c120-4bbf-b7e0-69d33de306cb';

/**
 * 代币类型预测服务
 */
class TokenPredictionService {
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
   * 获取已标注的代币数据（用于训练/验证）
   */
  async getAnnotatedTokens() {
    console.log('\n📊 获取已标注代币数据...');

    const PAGE_SIZE = 500;
    let allTokens = [];
    let page = 0;

    while (true) {
      const start = page * PAGE_SIZE;
      const end = start + PAGE_SIZE - 1;

      const { data, error } = await this.supabase
        .from('experiment_tokens')
        .select('*')
        .eq('experiment_id', TARGET_EXPERIMENT_ID)
        .not('human_judges', 'is', null)
        .range(start, end);

      if (error) {
        console.error(`   ❌ 获取代币数据失败: ${error.message}`);
        if (allTokens.length > 0) {
          console.log(`   ⚠️  使用已获取的 ${allTokens.length} 个代币`);
          return allTokens;
        }
        return [];
      }

      if (!data || data.length === 0) break;

      allTokens.push(...data);
      console.log(`   📄 获取第 ${page + 1} 页: ${data.length} 个代币`);
      page++;

      if (data.length < PAGE_SIZE) break;
    }

    console.log(`   ✅ 获取到 ${allTokens.length} 个已标注代币`);
    return allTokens;
  }

  /**
   * 预测单个代币的类型
   * @param {string} tokenAddress - 代币地址
   * @param {object} tokenInfo - 代币信息
   * @returns {object} 预测结果
   */
  async predictToken(tokenAddress, tokenInfo) {
    const chain = tokenInfo?.chain || 'bsc';
    const symbol = tokenInfo?.symbol || 'Unknown';

    // 获取早期交易者
    const traders = await this.earlyTradesService.getEarlyTraders(tokenAddress, chain, tokenInfo);

    if (traders.size === 0) {
      return {
        tokenAddress,
        symbol,
        error: 'No early traders found'
      };
    }

    // 分析这些钱包的画像特征
    const features = {
      tokenAddress,
      symbol,
      trueLabel: tokenInfo?.category || null,  // 真实标签（如果有）
      totalTraders: traders.size,
      matchedWallets: 0,
      unmatchedWallets: 0,

      // 特征：流水盘相关
      fakePumpTotalParticipations: 0,      // 所有匹配钱包的流水盘参与总次数
      fakePumpAvgParticipations: 0,        // 平均每个钱包的流水盘参与次数
      fakePumpRatio: 0,                    // 流水盘参与次数占总参与次数的比例
      fakePumpWallets: 0,                  // 有流水盘参与经历的钱包数量
      fakePumpWalletRatio: 0,              // 有流水盘参与经历的钱包占比

      // 特征：其他类型
      otherCategoriesTotal: 0,             // 其他类型参与总次数
      highQualityTotalParticipations: 0,   // 高质量代币参与总次数
      lowQualityTotalParticipations: 0,    // 低质量（含无人玩）参与总次数

      // 特征：钱包画像总体情况
      totalParticipations: 0,              // 所有匹配钱包的总参与次数
      avgTotalParticipations: 0,           // 平均每个钱包的总参与次数

      // 预测相关
      prediction: null,
      confidence: 0,
      error: null
    };

    for (const wallet of traders) {
      const profile = this.walletProfiles.get(wallet.toLowerCase());

      if (profile) {
        features.matchedWallets++;
        const categories = profile.categories || {};

        // 流水盘特征
        const fakePumpCount = categories.fake_pump || 0;
        features.fakePumpTotalParticipations += fakePumpCount;
        if (fakePumpCount > 0) {
          features.fakePumpWallets++;
        }

        // 其他类型特征
        features.highQualityTotalParticipations += categories.high_quality || 0;
        features.lowQualityTotalParticipations += (categories.low_quality || 0) + (categories.no_user || 0);
        features.otherCategoriesTotal += (categories.mid_quality || 0) + (categories.high_quality || 0) +
                                          (categories.low_quality || 0) + (categories.no_user || 0);

        // 总参与次数
        features.totalParticipations += profile.totalParticipations || 0;

      } else {
        features.unmatchedWallets++;
      }
    }

    // 计算衍生特征
    if (features.matchedWallets > 0) {
      features.fakePumpAvgParticipations = features.fakePumpTotalParticipations / features.matchedWallets;
      features.fakePumpWalletRatio = features.fakePumpWallets / features.matchedWallets;
      features.avgTotalParticipations = features.totalParticipations / features.matchedWallets;
    }

    // 计算流水盘参与比例
    const totalAllParticipations = features.fakePumpTotalParticipations + features.otherCategoriesTotal;
    if (totalAllParticipations > 0) {
      features.fakePumpRatio = features.fakePumpTotalParticipations / totalAllParticipations;
    }

    // 预测逻辑（简单规则）
    // 规则1：如果有流水盘参与经历的钱包占比超过50%，预测为流水盘
    // 规则2：如果流水盘参与次数占比超过40%，预测为流水盘
    // 规则3：如果平均每个钱包的流水盘参与次数>2，预测为流水盘
    let fakePumpScore = 0;

    if (features.fakePumpWalletRatio > 0.5) fakePumpScore += 2;
    if (features.fakePumpRatio > 0.4) fakePumpScore += 2;
    if (features.fakePumpAvgParticipations > 2) fakePumpScore += 1;
    if (features.fakePumpAvgParticipations > 5) fakePumpScore += 2;

    if (fakePumpScore >= 3) {
      features.prediction = 'fake_pump';
      features.confidence = Math.min(fakePumpScore / 6, 1);
    } else {
      features.prediction = 'other';
      features.confidence = 1 - Math.min(fakePumpScore / 6, 1);
    }

    return features;
  }

  /**
   * 批量预测代币类型
   */
  async predictTokens(tokens) {
    console.log(`\n🔍 开始预测 ${tokens.length} 个代币...`);

    const results = [];
    let processed = 0;

    for (const token of tokens) {
      const tokenAddress = token.token_address;
      const tokenInfo = {
        symbol: token.token_symbol || token.raw_api_data?.symbol || 'Unknown',
        chain: token.blockchain || 'bsc',
        category: token.human_judges?.category || null  // 人工标注作为真实标签
      };

      const prediction = await this.predictToken(tokenAddress, tokenInfo);
      results.push(prediction);

      processed++;
      console.log(`   ✅ [${processed}/${tokens.length}] ${tokenInfo.symbol} - 预测: ${prediction.prediction || 'ERROR'}`);

      // 请求延迟
      if (processed < tokens.length) {
        await this._delay(config.analysis.requestDelay);
      }
    }

    return results;
  }

  /**
   * 分析预测结果
   */
  analyzePredictions(predictions) {
    console.log('\n📊 分析预测结果...');

    // 统计
    const stats = {
      total: predictions.length,
      correct: 0,
      wrong: 0,
      noLabel: 0,
      byTrueLabel: {
        fake_pump: { total: 0, correct: 0, wrong: 0 },
        other: { total: 0, correct: 0, wrong: 0 }
      },
      byPrediction: {
        fake_pump: 0,
        other: 0
      }
    };

    for (const pred of predictions) {
      if (pred.error) continue;

      // 统计预测分布
      if (pred.prediction === 'fake_pump') {
        stats.byPrediction.fake_pump++;
      } else {
        stats.byPrediction.other++;
      }

      // 如果有真实标签，计算准确率
      if (pred.trueLabel) {
        const isFakePump = pred.trueLabel === 'fake_pump';
        const predictedFakePump = pred.prediction === 'fake_pump';

        if (isFakePump) {
          stats.byTrueLabel.fake_pump.total++;
          if (predictedFakePump) {
            stats.byTrueLabel.fake_pump.correct++;
            stats.correct++;
          } else {
            stats.byTrueLabel.fake_pump.wrong++;
            stats.wrong++;
          }
        } else {
          stats.byTrueLabel.other.total++;
          if (!predictedFakePump) {
            stats.byTrueLabel.other.correct++;
            stats.correct++;
          } else {
            stats.byTrueLabel.other.wrong++;
            stats.wrong++;
          }
        }
      } else {
        stats.noLabel++;
      }
    }

    // 计算准确率
    const withLabel = stats.total - stats.noLabel;
    const accuracy = withLabel > 0 ? (stats.correct / withLabel * 100).toFixed(2) : 0;
    const fakePumpRecall = stats.byTrueLabel.fake_pump.total > 0 ?
      (stats.byTrueLabel.fake_pump.correct / stats.byTrueLabel.fake_pump.total * 100).toFixed(2) : 0;
    const fakePumpPrecision = stats.byPrediction.fake_pump > 0 ?
      (stats.byTrueLabel.fake_pump.correct / stats.byPrediction.fake_pump * 100).toFixed(2) : 0;

    return {
      stats,
      accuracy: parseFloat(accuracy),
      fakePumpRecall: parseFloat(fakePumpRecall),
      fakePumpPrecision: parseFloat(fakePumpPrecision)
    };
  }

  /**
   * 保存预测结果
   */
  savePredictions(predictions, analysis) {
    console.log('\n💾 保存预测结果...');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const outputDir = resolve(__dirname, 'output');

    // 保存完整结果 JSON
    const jsonPath = resolve(outputDir, `token_prediction_${timestamp}.json`);
    writeFileSync(jsonPath, JSON.stringify({ predictions, analysis }, null, 2));
    console.log(`   📄 JSON: ${jsonPath}`);

    // 保存 CSV
    const csvPath = resolve(outputDir, `token_prediction_${timestamp}.csv`);
    const headers = ['代币', '代币地址', '真实标签', '预测类型', '置信度',
                      '早期交易者数', '匹配画像数',
                      '流水盘参与总次数', '流水盘平均次数', '流水盘钱包数', '流水盘钱包占比',
                      '高质量参与次数', '低质量参与次数', '总参与次数', '平均总参与次数'];

    const rows = [[...headers]];
    for (const pred of predictions) {
      rows.push([
        pred.symbol,
        pred.tokenAddress,
        pred.trueLabel || 'N/A',
        pred.prediction || 'ERROR',
        pred.confidence?.toFixed(3) || 'N/A',
        pred.totalTraders,
        pred.matchedWallets,
        pred.fakePumpTotalParticipations,
        pred.fakePumpAvgParticipations?.toFixed(2) || '0',
        pred.fakePumpWallets,
        pred.fakePumpWalletRatio?.toFixed(3) || '0',
        pred.highQualityTotalParticipations,
        pred.lowQualityTotalParticipations,
        pred.totalParticipations,
        pred.avgTotalParticipations?.toFixed(2) || '0'
      ]);
    }

    const csvContent = rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    writeFileSync(csvPath, '\ufeff' + csvContent, 'utf8');
    console.log(`   📄 CSV: ${csvPath}`);

    console.log('\n✅ 保存完成');
  }

  /**
   * 打印分析结果
   */
  printAnalysis(analysis) {
    console.log('\n========================================');
    console.log('   预测结果分析');
    console.log('========================================');

    console.log(`\n📊 总体统计:`);
    console.log(`   总代币数: ${analysis.stats.total}`);
    console.log(`   有标签代币: ${analysis.stats.total - analysis.stats.noLabel}`);
    console.log(`   无标签代币: ${analysis.stats.noLabel}`);
    console.log(`   预测正确: ${analysis.stats.correct}`);
    console.log(`   预测错误: ${analysis.stats.wrong}`);
    console.log(`   准确率: ${analysis.accuracy}%`);

    console.log(`\n🎭 流水盘检测:`);
    console.log(`   流水盘召回率: ${analysis.fakePumpRecall}% (真实流水盘中被正确识别的比例)`);
    console.log(`   流水盘精确率: ${analysis.fakePumpPrecision}% (预测为流水盘中真的是流水盘的比例)`);

    console.log(`\n📈 按真实标签分类:`);
    console.log(`   真实流水盘: ${analysis.stats.byTrueLabel.fake_pump.total} 个`);
    console.log(`     - 预测正确: ${analysis.stats.byTrueLabel.fake_pump.correct}`);
    console.log(`     - 预测错误: ${analysis.stats.byTrueLabel.fake_pump.wrong}`);
    console.log(`   真实其他: ${analysis.stats.byTrueLabel.other.total} 个`);
    console.log(`     - 预测正确: ${analysis.stats.byTrueLabel.other.correct}`);
    console.log(`     - 预测错误: ${analysis.stats.byTrueLabel.other.wrong}`);

    console.log(`\n🔮 预测分布:`);
    console.log(`   预测为流水盘: ${analysis.stats.byPrediction.fake_pump} 个`);
    console.log(`   预测为其他: ${analysis.stats.byPrediction.other} 个`);
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
  console.log('   代币类型预测工具');
  console.log('   目标: 区分流水盘 vs 其他类型');
  console.log('========================================');

  const service = new TokenPredictionService();

  try {
    // 1. 加载钱包画像数据
    const loaded = await service.loadWalletProfiles();
    if (!loaded) {
      console.error('\n❌ 无法继续分析，缺少钱包画像数据');
      console.log('   请先运行钱包画像分析工具生成数据');
      return;
    }

    // 2. 获取已标注的代币数据
    const tokens = await service.getAnnotatedTokens();

    if (tokens.length === 0) {
      console.log('\n⚠️  没有已标注的代币数据');
      return;
    }

    // 3. 批量预测
    const predictions = await service.predictTokens(tokens);

    // 4. 分析结果
    const analysis = service.analyzePredictions(predictions);

    // 5. 保存结果
    service.savePredictions(predictions, analysis);

    // 6. 打印分析
    service.printAnalysis(analysis);

  } catch (error) {
    console.error('\n❌ 预测失败:', error);
  } finally {
    service.cleanup();
  }

  console.log('\n✅ 预测完成');
}

// 运行
main().catch(console.error);
