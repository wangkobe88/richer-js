/**
 * Twitter Service - Twitter业务逻辑封装
 * 提供代币Twitter相关功能的业务层服务
 */

const twitterValidation = require('../utils/twitter-validation');

/**
 * Twitter服务类
 */
class TwitterService {
  constructor(logger) {
    this.logger = logger || console;
  }

  /**
   * 从代币描述中提取推文链接
   * @param {string} description - 代币描述文本
   * @returns {Array} 提取到的推文信息列表
   */
  extractTweetsFromDescription(description) {
    if (!description || typeof description !== 'string') {
      return [];
    }

    const tweets = [];
    const patterns = [
      // twitter.com/xxx/status/123456
      /https?:\/\/(?:www\.)?twitter\.com\/[a-zA-Z0-9_]{1,15}\/status\/([0-9]+)/gi,
      // x.com/xxx/status/123456
      /https?:\/\/(?:www\.)?x\.com\/[a-zA-Z0-9_]{1,15}\/status\/([0-9]+)/gi,
      // 直接的推文ID（不太常见，但可能存在）
      /\b(?:tweet:?|status:?)\s*([0-9]{15,20})\b/gi
    ];

    for (const pattern of patterns) {
      const matches = [...description.matchAll(pattern)];
      for (const match of matches) {
        const tweetId = match[1] || match[0];
        if (tweetId && !tweets.find(t => t.tweetId === tweetId)) {
          tweets.push({
            tweetId: tweetId,
            url: match[0],
            source: 'description'
          });
        }
      }
    }

    this.logger.info('[TwitterService] 从代币描述提取推文链接', {
      descriptionLength: description.length,
      tweetsFound: tweets.length
    });

    return tweets;
  }

  /**
   * 从代币描述中提取推文内容
   * @param {string} description - 代币描述文本
   * @returns {Promise<Array>} 推文详情列表
   */
  async extractTweetsFromDescriptionWithDetails(description) {
    const tweetLinks = this.extractTweetsFromDescription(description);
    const results = [];

    for (const tweetInfo of tweetLinks) {
      try {
        const tweetDetail = await twitterValidation.getTweetDetail(tweetInfo.tweetId);
        results.push({
          ...tweetInfo,
          detail: tweetDetail,
          success: true
        });
        // 避免API限流，添加延迟
        await this.sleep(500);
      } catch (error) {
        this.logger.warn('[TwitterService] 获取推文详情失败', {
          tweetId: tweetInfo.tweetId,
          error: error.message
        });
        results.push({
          ...tweetInfo,
          detail: null,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * 搜索代币地址的推文
   * @param {string} tokenAddress - 代币地址
   * @param {Object} options - 配置选项
   * @returns {Promise<Object>} 搜索结果
   */
  async searchTokenAddress(tokenAddress, options = {}) {
    try {
      this.logger.info('[TwitterService] 搜索代币地址推文', {
        tokenAddress,
        options
      });

      const result = await twitterValidation.validateTokenOnTwitter(tokenAddress, options);

      return {
        success: true,
        data: result
      };
    } catch (error) {
      this.logger.error('[TwitterService] 搜索代币地址推文失败', {
        tokenAddress,
        error: error.message
      });

      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  /**
   * 提取代币的Twitter特征
   * @param {string} tokenAddress - 代币地址
   * @param {Object} options - 配置选项
   * @returns {Promise<Object>} 特征提取结果
   */
  async extractTokenTwitterFeatures(tokenAddress, options = {}) {
    try {
      this.logger.info('[TwitterService] 提取代币Twitter特征', {
        tokenAddress,
        options
      });

      const result = await twitterValidation.extractTwitterFeatures(tokenAddress, options);

      return {
        success: result.status === 'success',
        data: result,
        error: result.error || null
      };
    } catch (error) {
      this.logger.error('[TwitterService] 提取代币Twitter特征失败', {
        tokenAddress,
        error: error.message
      });

      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  /**
   * 获取推文详情
   * @param {string} tweetId - 推文ID
   * @returns {Promise<Object>} 推文详情
   */
  async getTweetDetail(tweetId) {
    try {
      this.logger.info('[TwitterService] 获取推文详情', { tweetId });

      const tweetDetail = await twitterValidation.getTweetDetail(tweetId);

      return {
        success: true,
        data: tweetDetail
      };
    } catch (error) {
      this.logger.error('[TwitterService] 获取推文详情失败', {
        tweetId,
        error: error.message
      });

      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  /**
   * 获取用户信息
   * @param {string} screenName - Twitter用户名
   * @returns {Promise<Object>} 用户信息
   */
  async getUserInfo(screenName) {
    try {
      this.logger.info('[TwitterService] 获取用户信息', { screenName });

      const userInfo = await twitterValidation.getUserByScreenName(screenName);

      return {
        success: true,
        data: userInfo
      };
    } catch (error) {
      this.logger.error('[TwitterService] 获取用户信息失败', {
        screenName,
        error: error.message
      });

      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  /**
   * 获取代币的完整Twitter信息（包含描述推文和地址搜索）
   * @param {Object} tokenData - 代币数据（包含raw_api_data）
   * @returns {Promise<Object>} 完整的Twitter信息
   */
  async getTokenTwitterInfo(tokenData) {
    const tokenAddress = tokenData.token_address || tokenData.token;
    const result = {
      tokenAddress,
      descriptionTweets: null,
      addressSearchResults: null,
      twitterFeatures: null,
      timestamp: new Date().toISOString()
    };

    // 1. 从代币描述提取推文
    if (tokenData.raw_api_data) {
      const rawData = typeof tokenData.raw_api_data === 'string'
        ? JSON.parse(tokenData.raw_api_data)
        : tokenData.raw_api_data;

      if (rawData.description) {
        try {
          result.descriptionTweets = await this.extractTweetsFromDescriptionWithDetails(rawData.description);
        } catch (error) {
          this.logger.warn('[TwitterService] 从描述提取推文失败', {
            tokenAddress,
            error: error.message
          });
          result.descriptionTweets = { error: error.message };
        }
      }
    }

    // 2. 搜索代币地址（如果请求）
    // 注意：这个操作可能耗时较长，建议由前端决定是否执行

    return result;
  }

  /**
   * 延时函数
   * @param {number} ms - 延时毫秒数
   * @returns {Promise}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { TwitterService };
