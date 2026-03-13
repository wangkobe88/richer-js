/**
 * Twitter搜索服务 - 购买前检查子模块
 *
 * 功能：
 * 1. 搜索代币地址的Twitter提及情况
 * 2. 提取Twitter相关因子
 * 3. 记录搜索耗时
 */

const twitterValidation = require('../../utils/twitter-validation');

class TwitterSearchService {
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * 执行Twitter搜索检查
   * @param {string} tokenAddress - 代币地址
   * @param {Object} options - 配置选项
   * @returns {Promise<Object>} 检查结果
   */
  async performCheck(tokenAddress, options = {}) {
    const startTime = Date.now();

    try {
      this.logger.debug(`[TwitterSearch] 开始搜索: ${tokenAddress}`);

      // 执行Twitter搜索
      const validationResult = await twitterValidation.validateTokenOnTwitter(tokenAddress, {
        minTweetCount: 0,        // 不限制最小数量
        maxRetries: 1,           // 快速失败
        timeout: 10000           // 10秒超时
      });

      const duration = Date.now() - startTime;

      // 获取所有推文（包括高质量和低质量）
      const qualityTweets = validationResult.analysis_details?.quality_tweets || [];
      const lowQualityTweets = validationResult.analysis_details?.low_quality_tweets || [];
      const allTweets = [...qualityTweets, ...lowQualityTweets];

      // 提取因子值
      const factors = this._extractFactors(validationResult, allTweets, duration);

      // 构建结果
      const result = {
        success: true,
        factors,
        rawResult: validationResult,
        duration
      };

      this.logger.debug(`[TwitterSearch] 完成: ${allTweets.length}条推文, 耗时${duration}ms`);

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`[TwitterSearch] 失败: ${error.message}`);

      return {
        success: false,
        factors: this.getEmptyFactors(duration, error.message),
        rawResult: null,
        duration,
        error: error.message
      };
    }
  }

  /**
   * 提取Twitter因子值
   * @private
   */
  _extractFactors(validationResult, allTweets, duration) {
    if (allTweets.length === 0) {
      return { ...this.getEmptyFactors(duration), twitterSearchDuration: duration, twitterSearchSuccess: true };
    }

    // 计算统计数据
    let totalLikes = 0;
    let totalRetweets = 0;
    let totalReplies = 0;
    let totalFollowers = 0;
    const verifiedUsers = new Set();
    const uniqueUsers = new Set();

    // 计算最大粉丝数（过滤黑名单后的最大粉丝用户）
    let maxFollower = 0;
    let maxFollowerUser = null;

    allTweets.forEach(tweet => {
      totalLikes += tweet.metrics?.favorite_count || 0;
      totalRetweets += tweet.metrics?.retweet_count || 0;
      totalReplies += tweet.metrics?.reply_count || 0;

      if (tweet.user) {
        const followers = tweet.user.followers_count || 0;
        totalFollowers += followers;
        uniqueUsers.add(tweet.user.screen_name);
        if (tweet.user.verified) {
          verifiedUsers.add(tweet.user.screen_name);
        }

        // 更新最大粉丝数
        if (followers > maxFollower) {
          maxFollower = followers;
          maxFollowerUser = tweet.user.screen_name;
        }
      }
    });

    const totalEngagement = totalLikes + totalRetweets + totalReplies;
    const avgEngagement = allTweets.length > 0 ? totalEngagement / allTweets : 0;
    const qualityTweetsCount = allTweets.filter(t => (t.metrics?.total_engagement || 0) > 4).length;

    return {
      // 基础统计
      twitterTotalResults: allTweets.length,
      twitterQualityTweets: qualityTweetsCount,

      // 互动指标
      twitterLikes: totalLikes,
      twitterRetweets: totalRetweets,
      twitterComments: totalReplies,
      twitterTotalEngagement: totalEngagement,
      twitterAvgEngagement: Math.round(avgEngagement),

      // 用户指标
      twitterVerifiedUsers: verifiedUsers.size,
      twitterFollowers: totalFollowers,
      twitterUniqueUsers: uniqueUsers.size,

      // 最大粉丝数指标（过滤黑名单后）
      twitterMaxFollower: maxFollower,
      twitterMaxFollowerUser: maxFollowerUser,

      // 搜索状态
      twitterSearchSuccess: true,
      twitterSearchDuration: duration,
      twitterSearchError: null
    };
  }

  /**
   * 获取空因子值（搜索失败或无结果）
   */
  getEmptyFactors(duration = 0, error = null) {
    return {
      twitterTotalResults: 0,
      twitterQualityTweets: 0,
      twitterLikes: 0,
      twitterRetweets: 0,
      twitterComments: 0,
      twitterTotalEngagement: 0,
      twitterAvgEngagement: 0,
      twitterVerifiedUsers: 0,
      twitterFollowers: 0,
      twitterUniqueUsers: 0,
      twitterMaxFollower: 0,
      twitterMaxFollowerUser: null,
      twitterSearchSuccess: false,
      twitterSearchDuration: duration,
      twitterSearchError: error
    };
  }

  /**
   * 获取因子描述（用于文档/日志）
   */
  static getFactorDescriptions() {
    return {
      twitterTotalResults: 'Twitter搜索结果总数',
      twitterQualityTweets: '高质量推文数(互动>4)',
      twitterLikes: '总点赞数',
      twitterRetweets: '总转发数',
      twitterComments: '总评论数',
      twitterTotalEngagement: '总互动数(点赞+转发+评论)',
      twitterAvgEngagement: '平均互动数',
      twitterVerifiedUsers: '认证用户数',
      twitterFollowers: '推文用户粉丝总数',
      twitterUniqueUsers: '独立用户数',
      twitterMaxFollower: '最大推文发布者粉丝数(过滤黑名单后)',
      twitterMaxFollowerUser: '最大粉丝数用户名',
      twitterSearchSuccess: 'Twitter搜索是否成功',
      twitterSearchDuration: 'Twitter搜索耗时(毫秒)',
      twitterSearchError: 'Twitter搜索错误信息'
    };
  }
}

module.exports = TwitterSearchService;
