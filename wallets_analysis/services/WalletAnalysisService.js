/**
 * 钱包分析服务 - 统计分析钱包画像
 * 整合早期交易者和持有者两种数据
 */

import { EarlyTradesService } from './EarlyTradesService.js';
import { TokenHolderDataService } from './TokenHolderDataService.js';
import config from '../config.js';

// 分类映射
const CATEGORY_MAP = {
  fake_pump: { label: '流水盘', emoji: '🎭' },
  no_user: { label: '无人玩', emoji: '👻' },
  low_quality: { label: '低质量', emoji: '📉' },
  mid_quality: { label: '中质量', emoji: '📊' },
  high_quality: { label: '高质量', emoji: '🚀' }
};

export class WalletAnalysisService {
  constructor() {
    this.earlyTradesService = new EarlyTradesService();
    this.holderDataService = new TokenHolderDataService();
  }

  /**
   * 分析所有标注代币的早期交易者和持有者
   * @param {Map} annotatedTokens - Map<tokenAddress, tokenInfo>
   * @param {Function} progressCallback - 进度回调
   * @returns {Promise<Map>} Map<walletAddress, walletProfile>
   */
  async analyze(annotatedTokens, progressCallback = null) {
    console.log(`\n🔍 开始分析 ${annotatedTokens.size} 个代币（早期交易者 + 持有者）...`);

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
   * 处理单个代币（早期交易者 + 持有者）
   * @private
   */
  async _processToken(tokenAddress, tokenInfo) {
    try {
      const chain = tokenInfo.chains ? tokenInfo.chains[0] : (tokenInfo.chain || 'bsc');

      // 并发获取早期交易者和持有者
      const [traders, holders] = await Promise.all([
        this.earlyTradesService.getEarlyTraders(tokenAddress, chain),
        this.holderDataService.getTokenHolders(tokenAddress)
      ]);

      // 如果两者都没有数据，跳过
      if (traders.size === 0 && holders.size === 0) {
        return null;
      }

      return {
        traders,
        holders,
        tokenAddress,
        category: tokenInfo.category,
        symbol: tokenInfo.symbol || tokenInfo.token_symbol,
        note: tokenInfo.note
      };
    } catch (error) {
      console.warn(`   ⚠️  处理代币 ${tokenAddress.slice(0, 10)}... 失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 合并分析结果（早期交易者 + 持有者）
   * @private
   */
  _mergeResult(walletProfiles, result) {
    const { traders, holders, tokenAddress, category, symbol } = result;

    // 合并所有相关的钱包（早期交易者 ∪ 持有者）
    const allWallets = new Set([...traders, ...holders]);

    for (const wallet of allWallets) {
      if (!walletProfiles.has(wallet)) {
        walletProfiles.set(wallet, {
          categories: {},
          tokens: [],
          totalParticipations: 0,
          earlyTradeCount: 0,
          holderCount: 0
        });
      }

      const profile = walletProfiles.get(wallet);

      // 累计分类数量
      profile.categories[category] = (profile.categories[category] || 0) + 1;
      profile.totalParticipations++;

      // 统计参与方式
      if (traders.has(wallet)) {
        profile.earlyTradeCount++;
      }
      if (holders.has(wallet)) {
        profile.holderCount++;
      }

      // 记录参与的代币
      profile.tokens.push({
        address: tokenAddress,
        category,
        symbol,
        asEarlyTrader: traders.has(wallet),
        asHolder: holders.has(wallet)
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
      topWallets: []
    };

    // 统计主导分类
    const dominantCategoryCount = {};

    const walletsByParticipations = [];

    for (const [wallet, profile] of walletProfiles) {
      // 找出主导分类
      let maxCount = 0;
      let dominantCategory = null;

      for (const [cat, count] of Object.entries(profile.categories)) {
        if (count > maxCount) {
          maxCount = count;
          dominantCategory = cat;
        }
      }

      if (dominantCategory) {
        dominantCategoryCount[dominantCategory] = (dominantCategoryCount[dominantCategory] || 0) + 1;
      }

      // 按参与数量排序
      walletsByParticipations.push({ wallet, profile, dominantCategory });
    }

    // 排序获取 Top 钱包（按参与数量）
    walletsByParticipations.sort((a, b) => b.profile.totalParticipations - a.profile.totalParticipations);
    summary.topWallets = walletsByParticipations.slice(0, 100).map(({ wallet, profile, dominantCategory }) => ({
      address: wallet,
      totalParticipations: profile.totalParticipations,
      categories: profile.categories,
      dominantCategory
    }));

    summary.byDominantCategory = dominantCategoryCount;

    return summary;
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
