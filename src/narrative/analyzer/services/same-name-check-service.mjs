/**
 * Same Name Check Service - 同名代币检查服务（叙事分析版本）
 *
 * 功能：
 * 检测是否存在蹭热度的同名代币
 * 通过搜索相同 symbol 的代币，使用严格名称匹配规则，
 * 统计发布前的同名代币数量，判断是否为蹭热度代币
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';

// 加载环境变量
const requireDotEnv = createRequire(import.meta.url);
requireDotEnv('dotenv').config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../../../config/.env') });

// 在 ESM 中使用 CommonJS 模块
const require = createRequire(import.meta.url);
const { AveTokenAPI } = require('../../../core/ave-api/token-api.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 读取配置文件
const configPath = join(__dirname, '../../../../config/default.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));

// 获取阈值配置
const SAME_NAME_CONFIG = config.narrative?.sameNameCheck || {
  enabled: true,
  rules: {
    oneDayThreshold: 3,       // 24小时内阈值
    oneWeekThreshold: 10,     // 一周内阈值
    combinedWeekThreshold: 5, // 组合规则的一周阈值
    combinedDayThreshold: 2   // 组合规则的24小时阈值
  }
};

/**
 * 同名代币检查服务
 */
class SameNameCheckService {
  /**
   * 构造函数
   * @param {Object} logger - 日志记录器
   */
  constructor(logger) {
    this.logger = logger;

    // 初始化AVE API
    const apiKey = process.env.AVE_API_KEY || null;
    const baseURL = config.ave?.apiUrl || 'https://prod.ave-api.com';
    this.api = new AveTokenAPI(baseURL, 10000, apiKey);
  }

  /**
   * 检查是否为蹭热度代币
   * @param {string} tokenSymbol - 代币符号
   * @param {string} tokenName - 代币名称
   * @param {number} tokenCreatedAt - 代币创建时间（秒级时间戳）
   * @param {Object} targetTokenData - 目标代币的完整数据（包含 appendix）
   * @returns {Promise<Object>} 检查结果
   */
  async checkIfCopycatToken(tokenSymbol, tokenName, tokenCreatedAt, targetTokenData = null) {
    try {
      this.logger.debug('SameNameCheck', '开始检查同名代币', {
        symbol: tokenSymbol,
        name: tokenName,
        createdAt: new Date(tokenCreatedAt * 1000).toISOString()
      });

      // 搜索同名代币
      const results = await this.api.searchTokens(tokenSymbol, 'bsc', 300, 'fdv');

      this.logger.debug('SameNameCheck', '搜索完成', {
        totalResults: results.length
      });

      // 严格名称匹配
      const strictSameNameTokens = results.filter(t =>
        this._isSameName(tokenName, tokenSymbol, t.name, t.symbol)
      );

      this.logger.debug('SameNameCheck', '严格名称匹配完成', {
        strictMatchCount: strictSameNameTokens.length
      });

      // 筛选目标代币之前创建的（排除异常数据）
      const olderTokens = strictSameNameTokens.filter(t =>
        t.created_at < tokenCreatedAt && t.created_at > 0
      );

      // 解析目标代币的 appendix（用于叙事对比）
      let targetAppendix = null;
      if (targetTokenData && targetTokenData.raw_api_data) {
        const rawData = targetTokenData.raw_api_data;
        if (rawData.appendix) {
          try {
            targetAppendix = typeof rawData.appendix === 'string'
              ? JSON.parse(rawData.appendix)
              : rawData.appendix;
          } catch (e) {
            this.logger.debug('SameNameCheck', '解析目标代币appendix失败', { error: e.message });
          }
        }
      }

      // 检查每个同名代币是否与目标代币共享同一叙事（appendix字段对比）
      const duplicateNarrativeTokens = olderTokens.filter(t => {
        if (!t.appendix) return false;

        let tokenAppendix = null;
        try {
          tokenAppendix = typeof t.appendix === 'string' ? JSON.parse(t.appendix) : t.appendix;
        } catch (e) {
          return false;
        }

        // 如果没有目标代币的appendix，无法进行精确对比，使用保守策略：
        // 只要同名就认为是潜在重复
        if (!targetAppendix) {
          return true;
        }

        // 比较 appendix 所有字段，只要有任意一个相同就认为是重复
        return this._hasSameNarrative(targetAppendix, tokenAppendix);
      });

      // 分析时间窗口（只计入重复叙事的代币）
      const oneDayBefore = tokenCreatedAt - 24 * 60 * 60;
      const oneWeekBefore = tokenCreatedAt - 7 * 24 * 60 * 60;

      const withinOneDay = duplicateNarrativeTokens.filter(t => t.created_at >= oneDayBefore);
      const withinOneWeek = duplicateNarrativeTokens.filter(t => t.created_at >= oneWeekBefore);

      this.logger.debug('SameNameCheck', '时间窗口分析（仅重复叙事）', {
        totalOlder: olderTokens.length,
        duplicateNarrative: duplicateNarrativeTokens.length,
        withinOneDay: withinOneDay.length,
        withinOneWeek: withinOneWeek.length
      });

      // 判断是否为蹭热度代币
      const isCopycat = this._evaluateCopycatRules(
        withinOneDay,
        withinOneWeek,
        duplicateNarrativeTokens
      );

      const result = {
        success: true,
        isCopycat,
        details: {
          totalOlder: olderTokens.length,
          duplicateNarrativeCount: duplicateNarrativeTokens.length,
          withinOneDay: withinOneDay.length,
          withinOneWeek: withinOneWeek.length,
          targetAppendix: targetAppendix,
          withinOneDayTokens: withinOneDay.map(t => ({
            address: t.token,
            name: t.name,
            symbol: t.symbol,
            createdAt: t.created_at,
            hoursBefore: Math.round((tokenCreatedAt - t.created_at) / 3600),
            fdv: t.fdv,
            appendix: t.appendix
          }))
        }
      };

      if (isCopycat) {
        this.logger.info('SameNameCheck', '检测到蹭热度代币', result.details);
      } else {
        this.logger.debug('SameNameCheck', '未检测到蹭热度行为', result.details);
      }

      return result;

    } catch (error) {
      this.logger.error('SameNameCheck', '检查失败', { error: error.message });
      return {
        success: false,
        isCopycat: false,
        error: error.message
      };
    }
  }

  /**
   * 评估是否为蹭热度代币
   *
   * 判定规则：
   * 1. 一周内的同名代币中，是否有任何一个"起来过"
   * 2. "起来过"的判断：24h涨幅 > 阈值 或 24h交易量 > 阈值 或 24h交易笔数 > 阈值
   *
   * @param {Array} withinOneDay - 24小时内的同名代币
   * @param {Array} withinOneWeek - 一周内的同名代币
   * @param {Array} allOlder - 所有更早创建的同名代币
   * @returns {boolean} 是否为蹭热度代币
   * @private
   */
  _evaluateCopycatRules(withinOneDay, withinOneWeek, allOlder) {
    const {
      priceChangeThreshold,
      txVolumeThreshold,
      txCountThreshold
    } = SAME_NAME_CONFIG.rules;

    // 检查一周内的同名代币是否"起来过"
    const hasSuccessfulToken = this._hasSuccessfulTokenInWeek(
      withinOneWeek,
      priceChangeThreshold,
      txVolumeThreshold,
      txCountThreshold
    );

    if (hasSuccessfulToken) {
      this.logger.debug('SameNameCheck', '一周内存在已"起来过"的同名代币，判定为蹭热度', {
        withinOneWeek: withinOneWeek.length
      });
      return true;
    }

    this.logger.debug('SameNameCheck', '一周内未发现"起来过"的同名代币，新代币有机会', {
      withinOneWeek: withinOneWeek.length
    });
    return false;
  }

  /**
   * 检查一周内的同名代币是否有"起来过"的
   *
   * @param {Array} tokens - 一周内的同名代币
   * @param {number} priceChangeThreshold - 24h涨幅阈值（百分比）
   * @param {number} txVolumeThreshold - 24h交易量阈值
   * @param {number} txCountThreshold - 24h交易笔数阈值
   * @returns {boolean} 是否有"起来过"的代币
   * @private
   */
  _hasSuccessfulTokenInWeek(tokens, priceChangeThreshold, txVolumeThreshold, txCountThreshold) {
    for (const token of tokens) {
      const priceChange = parseFloat(token.price_change_24h) || 0;
      const txVolume = parseFloat(token.tx_volume_u_24h) || 0;
      const txCount = parseInt(token.tx_count_24h) || 0;

      // 只要有一个指标超过阈值，就认为"起来过"
      if (
        priceChange >= priceChangeThreshold ||
        txVolume >= txVolumeThreshold ||
        txCount >= txCountThreshold
      ) {
        this.logger.debug('SameNameCheck', '发现已"起来过"的同名代币', {
          address: token.token,
          name: token.name,
          priceChange: priceChange,
          txVolume: txVolume,
          txCount: txCount
        });
        return true;
      }
    }
    return false;
  }

  /**
   * 严格名称匹配判断
   *
   * 匹配规则：
   * 1. name 完全相同（忽略大小写和空格）
   * 2. name 互相包含（处理 "Leo" vs "Leo Token" 的情况）
   *
   * @param {string} name1 - 代币1的名称
   * @param {string} symbol1 - 代币1的符号
   * @param {string} name2 - 代币2的名称
   * @param {string} symbol2 - 代币2的符号
   * @returns {boolean} 是否认为是同名
   * @private
   */
  _isSameName(name1, symbol1, name2, symbol2) {
    if (!name1 || !name2) {
      return false;
    }

    const n1 = name1.toLowerCase().trim();
    const n2 = name2.toLowerCase().trim();
    const s1 = symbol1.toLowerCase().trim();
    const s2 = symbol2.toLowerCase().trim();

    // 规则1: name 完全相同
    if (n1 === n2) {
      return true;
    }

    // 规则2: name 互相包含（处理 "Leo" vs "Leo Token" 的情况）
    const shorter = n1.length < n2.length ? n1 : n2;
    const longer = n1.length < n2.length ? n2 : n1;

    if (longer.includes(shorter) && shorter.length >= 3) {
      return true;
    }

    return false;
  }

  /**
   * 判断两个代币是否共享同一叙事（基于appendix字段对比）
   *
   * 规则：只要任意一个非空字段相同，就认为是同一叙事
   * 比较字段包括：twitter, website, telegram, blog, discord 等
   *
   * @param {Object} appendix1 - 代币1的appendix
   * @param {Object} appendix2 - 代币2的appendix
   * @returns {boolean} 是否共享同一叙事
   * @private
   */
  _hasSameNarrative(appendix1, appendix2) {
    if (!appendix1 || !appendix2) {
      return false;
    }

    // 需要比较的字段列表（排除一些明显不相关的字段）
    const compareFields = [
      'twitter',
      'website',
      'telegram',
      'blog',
      'discord',
      'github',
      'whitepaper',
      'email',
      'reddit',
      'slack',
      'facebook',
      'linkedin',
      'wechat',
      'qq'
    ];

    // 检查每个字段，只要有任意一个相同就认为是同一叙事
    for (const field of compareFields) {
      const value1 = this._normalizeField(appendix1[field]);
      const value2 = this._normalizeField(appendix2[field]);

      // 两个都有值且相同
      if (value1 && value2 && value1 === value2) {
        this.logger.debug('SameNameCheck', '发现相同叙事字段', {
          field,
          value: value1
        });
        return true;
      }
    }

    // 特殊处理：推特URL可能格式不同，需要提取用户名或推文ID进行比较
    const twitter1 = this._extractTwitterId(appendix1.twitter);
    const twitter2 = this._extractTwitterId(appendix2.twitter);
    if (twitter1 && twitter2 && twitter1 === twitter2) {
      this.logger.debug('SameNameCheck', '发现相同推特ID', {
        twitterId: twitter1
      });
      return true;
    }

    return false;
  }

  /**
   * 标准化字段值（去除空白、转换为小写）
   * @param {*} value - 原始值
   * @returns {string|null} 标准化后的值
   * @private
   */
  _normalizeField(value) {
    if (!value || typeof value !== 'string') {
      return null;
    }
    return value.toLowerCase().trim();
  }

  /**
   * 从推特URL中提取标识符用于比较
   * 优先提取推文ID（/status/数字），同一推文视为同一叙事
   * 对于纯用户主页URL，提取用户名
   * 支持格式：
   * - https://x.com/username/status/123456 → "status:123456"
   * - https://x.com/i/status/123456 → "status:123456"
   * - https://twitter.com/username/status/123456 → "status:123456"
   * - https://x.com/username → "user:username"
   * - @username → "user:username"
   *
   * @param {string} twitterUrl - 推特URL或用户名
   * @returns {string|null} 提取的标识符（格式: "status:ID" 或 "user:NAME"）
   * @private
   */
  _extractTwitterId(twitterUrl) {
    if (!twitterUrl || typeof twitterUrl !== 'string') {
      return null;
    }

    let url = twitterUrl.toLowerCase().trim();

    // 去除前缀 @
    if (url.startsWith('@')) {
      return 'user:' + url.substring(1);
    }

    // 优先提取推文ID（/status/数字）
    const statusPatterns = [
      /x\.com\/[^\/]+\/status\/(\d+)/,
      /twitter\.com\/[^\/]+\/status\/(\d+)/,
      /mobile\.twitter\.com\/[^\/]+\/status\/(\d+)/
    ];

    for (const pattern of statusPatterns) {
      const match = url.match(pattern);
      if (match) {
        return 'status:' + match[1];
      }
    }

    // 非推文URL，提取用户名
    const userPatterns = [
      /x\.com\/([^\/]+)/,
      /twitter\.com\/([^\/]+)/,
      /mobile\.twitter\.com\/([^\/]+)/
    ];

    for (const pattern of userPatterns) {
      const match = url.match(pattern);
      if (match) {
        return 'user:' + match[1];
      }
    }

    return null;
  }
}

export { SameNameCheckService };
