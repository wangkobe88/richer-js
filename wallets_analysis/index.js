#!/usr/bin/env node
/**
 * 钱包分析工具 - 主入口
 * 分析代币早期交易者的钱包画像
 */

// 首先加载环境变量（必须在其他导入之前）
import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 尝试从父目录的 config 目录加载 .env
const envResult = dotenvConfig({ path: resolve(__dirname, '../config/.env') });

if (!envResult.error) {
  console.log('✅ 环境变量已加载');
} else {
  console.warn('⚠️  环境变量加载失败:', envResult.error.message);
}

import { ExperimentService } from './services/ExperimentService.js';
import { WalletAnalysisService } from './services/WalletAnalysisService.js';
import { OutputService } from './services/OutputService.js';
import config from './config.js';

// 输出格式
const CATEGORY_MAP = {
  fake_pump: { label: '流水盘', emoji: '🎭', quality: 'low' },
  no_user: { label: '无人玩', emoji: '👻', quality: 'low' },
  low_quality: { label: '低质量', emoji: '📉', quality: 'low' },
  mid_quality: { label: '中质量', emoji: '📊', quality: 'mid' },
  high_quality: { label: '高质量', emoji: '🚀', quality: 'high' }
};

/**
 * 主函数
 */
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    🔍 钱包分析工具                           ║');
  console.log('║              Wallet Profile Analyzer v1.0                   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const startTime = Date.now();

  try {
    // 1. 初始化服务
    console.log('📦 初始化服务...');
    const experimentService = new ExperimentService();
    // 延迟创建 WalletAnalysisService 以避免网络资源冲突
    let analysisService = null;
    const outputService = new OutputService();

    // 2. 获取所有实验
    console.log('\n┌─────────────────────────────────────────────────────────┐');
    console.log('│ 第 1 步: 获取实验数据                                     │');
    console.log('└─────────────────────────────────────────────────────────┘\n');

    const experiments = await experimentService.getAllExperiments();

    // 3. 获取标注代币
    console.log('\n┌─────────────────────────────────────────────────────────┐');
    console.log('│ 第 2 步: 获取标注代币                                     │');
    console.log('└─────────────────────────────────────────────────────────┘\n');

    const annotatedTokens = await experimentService.getAnnotatedTokens(experiments);

    if (annotatedTokens.size === 0) {
      console.log('⚠️  没有找到已标注的代币，分析结束。');
      return;
    }

    // 显示标注分布
    console.log('\n📊 标注分布:');
    const categoryCount = {};
    for (const token of annotatedTokens.values()) {
      categoryCount[token.category] = (categoryCount[token.category] || 0) + 1;
    }
    for (const [cat, count] of Object.entries(categoryCount)) {
      const info = CATEGORY_MAP[cat];
      console.log(`   ${info?.emoji || '?'} ${info?.label || cat}: ${count} 个`);
    }

    // 4. 分析早期交易者
    console.log('\n┌─────────────────────────────────────────────────────────┐');
    console.log('│ 第 3 步: 分析早期交易者                                   │');
    console.log('└─────────────────────────────────────────────────────────┘\n');

    // 延迟创建 WalletAnalysisService 以避免网络资源冲突
    if (!analysisService) {
      console.log('   初始化分析服务...');
      analysisService = new WalletAnalysisService();
    }

    const walletProfiles = await analysisService.analyze(
      annotatedTokens,
      (current, total) => {
        const percent = ((current / total) * 100).toFixed(1);
        process.stdout.write(`\r   进度: ${current}/${total} (${percent}%)`);
      }
    );

    console.log(); // 换行

    // 5. 生成统计摘要
    console.log('\n┌─────────────────────────────────────────────────────────┐');
    console.log('│ 第 4 步: 生成统计摘要                                     │');
    console.log('└─────────────────────────────────────────────────────────┘\n');

    const summary = analysisService.generateSummary(walletProfiles);

    // 显示摘要
    console.log('📈 分析结果摘要:');
    console.log(`   总钱包数: ${summary.totalWallets}`);
    console.log(`\n   按主导分类分布:`);
    for (const [cat, count] of Object.entries(summary.byDominantCategory)) {
      const info = CATEGORY_MAP[cat];
      const percent = ((count / summary.totalWallets) * 100).toFixed(1);
      console.log(`   ${info?.emoji || '?'} ${info?.label || cat}: ${count} (${percent}%)`);
    }

    console.log(`\n   按质量等级分布:`);
    const qualityLabels = { high: '高质量', mid: '中质量', low: '低质量', unknown: '未知' };
    for (const [quality, count] of Object.entries(summary.qualityDistribution)) {
      const percent = ((count / summary.totalWallets) * 100).toFixed(1);
      console.log(`   ${qualityLabels[quality]}: ${count} (${percent}%)`);
    }

    // 显示 Top 10 钱包
    console.log(`\n   🏆 Top 10 钱包 (按质量分数):`);
    for (let i = 0; i < Math.min(10, summary.topWallets.length); i++) {
      const wallet = summary.topWallets[i];
      const catInfo = CATEGORY_MAP[wallet.dominantCategory];
      console.log(`   ${i + 1}. ${wallet.address.slice(0, 10)}...${wallet.address.slice(-6)} | 分数: ${wallet.score} | 参与: ${wallet.totalParticipations} | ${catInfo?.emoji || '?'} ${catInfo?.label || wallet.dominantCategory}`);
    }

    // 6. 输出结果
    console.log('\n┌─────────────────────────────────────────────────────────┐');
    console.log('│ 第 5 步: 输出结果                                         │');
    console.log('└─────────────────────────────────────────────────────────┘\n');

    const outputData = {
      generated_at: new Date().toISOString(),
      config: {
        earlyTradeWindow: config.analysis.earlyTradeWindow,
        minTradeAmountUSD: config.analysis.minTradeAmountUSD
      },
      summary: {
        total_wallets: summary.totalWallets,
        total_tokens_analyzed: annotatedTokens.size,
        by_dominant_category: summary.byDominantCategory,
        quality_distribution: summary.qualityDistribution,
        top_wallets: summary.topWallets
      },
      wallets: {}
    };

    // 转换 Map 为普通对象
    for (const [wallet, profile] of walletProfiles) {
      outputData.wallets[wallet] = {
        total_participations: profile.totalParticipations,
        categories: profile.categories,
        dominant_category: _getDominantCategory(profile.categories),
        dominant_quality: CATEGORY_MAP[_getDominantCategory(profile.categories)]?.quality || 'unknown',
        tokens: profile.tokens
      };
    }

    await outputService.output(outputData);

    // 清理
    analysisService.cleanup();

    // 完成
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✅ 分析完成！耗时 ${duration} 秒`);
    console.log(`📁 输出目录: ${config.output.dir}/\n`);

  } catch (error) {
    console.error('\n❌ 分析失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * 获取主导分类
 */
function _getDominantCategory(categories) {
  let maxCount = 0;
  let dominant = null;

  for (const [cat, count] of Object.entries(categories)) {
    if (count > maxCount) {
      maxCount = count;
      dominant = cat;
    }
  }

  return dominant;
}

// 运行主函数
main();
