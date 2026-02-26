/**
 * 钱包分析服务 - 统计分析钱包画像
 */

import { EarlyTradesService } from './EarlyTradesService.js';
import config from '../config.js';

// 分类映射
const CATEGORY_MAP = {
  fake_pump: { label: '流水盘', emoji: '🎭', quality: 'low' },
  no_user: { label: '无人玩', emoji: '👻', quality: 'low' },
  low_quality: { label: '低质量', emoji: '📉', quality: 'low' },
  mid_quality: { label: '中质量', emoji: '📊', quality: 'mid' },
  high_quality: { label: '高质量', emoji: '🚀', quality: 'high' }
};

export class WalletAnalysisService {
  constructor() {
    this.earlyTradesService = new EarlyTradesService();
  }

  /**
   * 分析所有标注代币的早期交易者
   * @param {Map} annotatedTokens - Map<tokenAddress, tokenInfo>
   * @param {Function} progressCallback - 进度回调
   * @returns {Promise<Map>} Map<walletAddress, walletProfile>
   */
  async analyze(annotatedTokens, progressCallback = null) {
    console.log(`\n🔍 开始分析 ${annotatedTokens.size} 个代币的早期交易者...`);

    const walletProfiles = new Map();
    const tokens = Array.from(annotatedTokens.entries());
    let processed = 0;

    // 并发处理代币
    for (let i = 0; i < tokens.length; i += config.analysis.concurrency) {
      const batch = tokens.slice(i, i + config.analysis.concurrency);

      const results = await Promise.all(
        batch.map(([tokenAddress, tokenInfo]) =>
          this._processToken(tokenAddress, tokenInfo)
        )
      );

      // 合并结果
      for (const result of results) {
        if (result) {
          this._mergeResult(walletProfiles, result);
        }
      }

      processed += batch.length;
      if (progressCallback) {
        progressCallback(processed, tokens.length);
      } else {
        console.log(`   进度: ${processed}/${tokens.length} (${((processed / tokens.length) * 100).toFixed(1)}%)`);
      }

      // 请求延迟
      if (i + config.analysis.concurrency < tokens.length) {
        await this._delay(config.analysis.requestDelay);
      }
    }

    console.log(`\n✅ 分析完成，涉及 ${walletProfiles.size} 个钱包`);
    return walletProfiles;
  }

  /**
   * 处理单个代币
   * @private
   */
  async _processToken(tokenAddress, tokenInfo) {
    try {
      const chain = tokenInfo.chains[0] || 'bsc';
      const traders = await this.earlyTradesService.getEarlyTraders(tokenAddress, chain);

      if (traders.size === 0) {
        return null;
      }

      return {
        traders,
        tokenAddress,
        category: tokenInfo.category,
        symbol: tokenInfo.symbol,
        note: tokenInfo.note
      };
    } catch (error) {
      console.warn(`   ⚠️  处理代币 ${tokenAddress.slice(0, 10)}... 失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 合并分析结果
   * @private
   */
  _mergeResult(walletProfiles, result) {
    const { traders, tokenAddress, category, symbol, note } = result;

    for (const wallet of traders) {
      if (!walletProfiles.has(wallet)) {
        walletProfiles.set(wallet, {
          categories: {},
          tokens: [],
          totalParticipations: 0
        });
      }

      const profile = walletProfiles.get(wallet);

      // 累计分类数量
      profile.categories[category] = (profile.categories[category] || 0) + 1;
      profile.totalParticipations++;

      // 记录参与的代币
      profile.tokens.push({
        address: tokenAddress,
        category,
        symbol
      });
    }
  }

  /**
   * 生成统计摘要
   */
  generateSummary(walletProfiles) {
    const summary = {
      totalWallets: walletProfiles.size,
      byDominantCategory: {},
      qualityDistribution: { high: 0, mid: 0, low: 0, unknown: 0 },
      topWallets: []
    };

    // 统计主导分类和质量分布
    const dominantCategoryCount = {};
    const qualityCount = { high: 0, mid: 0, low: 0, unknown: 0 };

    const walletsByScore = [];

    for (const [wallet, profile] of walletProfiles) {
      // 找出主导分类
      let maxCount = 0;
      let dominantCategory = null;
      let dominantQuality = 'unknown';

      for (const [cat, count] of Object.entries(profile.categories)) {
        if (count > maxCount) {
          maxCount = count;
          dominantCategory = cat;
          dominantQuality = CATEGORY_MAP[cat]?.quality || 'unknown';
        }
      }

      if (dominantCategory) {
        dominantCategoryCount[dominantCategory] = (dominantCategoryCount[dominantCategory] || 0) + 1;
      }

      if (dominantQuality) {
        qualityCount[dominantQuality]++;
      }

      // 计算钱包质量分数
      const score = this._calculateWalletScore(profile);
      walletsByScore.push({ wallet, profile, score, dominantCategory, dominantQuality });
    }

    // 排序获取 Top 钱包
    walletsByScore.sort((a, b) => b.score - a.score);
    summary.topWallets = walletsByScore.slice(0, 100).map(({ wallet, profile, score, dominantCategory, dominantQuality }) => ({
      address: wallet,
      score: score.toFixed(2),
      totalParticipations: profile.totalParticipations,
      categories: profile.categories,
      dominantCategory,
      dominantQuality
    }));

    summary.byDominantCategory = dominantCategoryCount;
    summary.qualityDistribution = qualityCount;

    return summary;
  }

  /**
   * 计算钱包质量分数
   * @private
   */
  _calculateWalletScore(profile) {
    let score = 0;
    let total = 0;

    const qualityWeights = {
      high: 100,
      mid: 50,
      low: -50,
      unknown: 0
    };

    for (const [cat, count] of Object.entries(profile.categories)) {
      const quality = CATEGORY_MAP[cat]?.quality || 'unknown';
      score += qualityWeights[quality] * count;
      total += count;
    }

    // 归一化分数 (按参与数量)
    return total > 0 ? score / total : 0;
  }

  /**
   * 延迟函数
   * @private
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 清理缓存
   */
  cleanup() {
    this.earlyTradesService.clearCache();
  }
}
