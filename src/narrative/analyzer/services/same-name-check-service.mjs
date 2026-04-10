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
   * @returns {Promise<Object>} 检查结果
   */
  async checkIfCopycatToken(tokenSymbol, tokenName, tokenCreatedAt) {
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

      // 分析时间窗口
      const oneDayBefore = tokenCreatedAt - 24 * 60 * 60;
      const oneWeekBefore = tokenCreatedAt - 7 * 24 * 60 * 60;

      const withinOneDay = olderTokens.filter(t => t.created_at >= oneDayBefore);
      const withinOneWeek = olderTokens.filter(t => t.created_at >= oneWeekBefore);

      this.logger.debug('SameNameCheck', '时间窗口分析', {
        totalOlder: olderTokens.length,
        withinOneDay: withinOneDay.length,
        withinOneWeek: withinOneWeek.length
      });

      // 判断是否为蹭热度代币
      const isCopycat = this._evaluateCopycatRules(
        withinOneDay,
        withinOneWeek,
        olderTokens
      );

      const result = {
        success: true,
        isCopycat,
        details: {
          totalOlder: olderTokens.length,
          withinOneDay: withinOneDay.length,
          withinOneWeek: withinOneWeek.length,
          withinOneDayTokens: withinOneDay.map(t => ({
            address: t.token,
            name: t.name,
            symbol: t.symbol,
            createdAt: t.created_at,
            hoursBefore: Math.round((tokenCreatedAt - t.created_at) / 3600),
            fdv: t.fdv
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
   * 判定规则（满足任一即判定为蹭热度）：
   * 1. 发布前24小时内 >= 3个同名代币 → 极度可疑
   * 2. 发布前一周内 >= 10个同名代币 → 高度可疑
   * 3. 发布前一周内 >= 5个同名代币，且24小时内 >= 2个 → 可疑
   *
   * @param {Array} withinOneDay - 24小时内的同名代币
   * @param {Array} withinOneWeek - 一周内的同名代币
   * @param {Array} allOlder - 所有更早创建的同名代币
   * @returns {boolean} 是否为蹭热度代币
   * @private
   */
  _evaluateCopycatRules(withinOneDay, withinOneWeek, allOlder) {
    const { oneDayThreshold, oneWeekThreshold, combinedWeekThreshold, combinedDayThreshold } =
      SAME_NAME_CONFIG.rules;

    // 规则1：24小时内密集发布（最明显的蹭热度信号）
    if (withinOneDay.length >= oneDayThreshold) {
      this.logger.debug('SameNameCheck', '触发规则1: 24小时内密集发布', {
        count: withinOneDay.length,
        threshold: oneDayThreshold
      });
      return true;
    }

    // 规则2：一周内大量同名代币
    if (withinOneWeek.length >= oneWeekThreshold) {
      this.logger.debug('SameNameCheck', '触发规则2: 一周内大量同名代币', {
        count: withinOneWeek.length,
        threshold: oneWeekThreshold
      });
      return true;
    }

    // 规则3：中等数量但有近期密集发布
    if (withinOneWeek.length >= combinedWeekThreshold && withinOneDay.length >= combinedDayThreshold) {
      this.logger.debug('SameNameCheck', '触发规则3: 中等数量且近期密集发布', {
        weekCount: withinOneWeek.length,
        dayCount: withinOneDay.length,
        weekThreshold: combinedWeekThreshold,
        dayThreshold: combinedDayThreshold
      });
      return true;
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
}

export { SameNameCheckService };
