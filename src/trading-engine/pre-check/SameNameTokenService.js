/**
 * 严格同名代币检查服务
 *
 * 分析目标：
 * 通过搜索相同symbol的代币，使用严格名称匹配规则，
 * 统计真正的同名代币数量，作为购买前检查的参考因子。
 *
 * 数据来源：AVE API /v2/tokens
 * 链限制：固定BSC链
 */

const { AveTokenAPI } = require('../../core/ave-api');

class SameNameTokenService {
  /**
   * 构造函数
   * @param {Object} logger - 日志记录器
   */
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * 执行严格同名代币检查
   * @param {string} tokenSymbol - 代币符号
   * @param {string} tokenName - 代币名称
   * @param {Object} options - 可选配置
   * @returns {Promise<Object>} 检查结果
   */
  async performCheck(tokenSymbol, tokenName, options = {}) {
    const { chain = 'bsc', timeout = 10000 } = options;

    this.logger.debug('开始严格同名代币检查', { symbol: tokenSymbol, name: tokenName, chain });

    try {
      // 初始化AVE API
      const apiKey = process.env.AVE_API_KEY || null;
      const { AveTokenAPI } = require('../../core/ave-api');
      const config = require('../../config/default.json');
      const baseURL = config.ave?.apiUrl || 'https://prod.ave-api.com';

      const api = new AveTokenAPI(baseURL, timeout, apiKey);

      // 搜索同名代币（固定BSC链）
      const results = await api.searchTokens(tokenSymbol, chain, 300, 'fdv');

      // 严格名称匹配过滤
      const strictSameNameTokens = results.filter(t =>
        this._isSameName(tokenName, tokenSymbol, t.name, t.symbol)
      );

      // 计算因子
      const factors = {
        strictSameNameTokenCount: strictSameNameTokens.length,
        strictSameNameSearchCount: results.length,
        strictSameNameFilteredCount: results.length - strictSameNameTokens.length,
        strictSameNameMaxFDV: this._getMaxFDV(strictSameNameTokens)
      };

      this.logger.debug('严格同名代币检查完成', {
        symbol: tokenSymbol,
        searchCount: results.length,
        strictCount: strictSameNameTokens.length,
        filteredCount: results.length - strictSameNameTokens.length
      });

      return {
        success: true,
        factors
      };

    } catch (error) {
      this.logger.error('严格同名代币检查失败', {
        symbol: tokenSymbol,
        error: error.message
      });

      return {
        success: false,
        factors: this.getEmptyFactors(error.message),
        error: error.message
      };
    }
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
   * 获取最大FDV
   *
   * 排除AVE API的虚假数据：
   * 1. TVL < $1000 的代币（缺乏实际流动性）
   * 2. 24h交易量为0的代币（无实际交易）
   * 3. FDV > 20M 的代币（明显异常值）
   *
   * @param {Array} tokens - 代币列表
   * @returns {number} 最大FDV（经过有效性过滤）
   * @private
   */
  _getMaxFDV(tokens) {
    if (!tokens || tokens.length === 0) {
      return 0;
    }

    const MIN_VALID_TVL = 1000;       // TVL至少$1000
    const MAX_VALID_FDV = 20000000;   // FDV超过20M认为是虚假数据

    const validTokens = tokens.filter(t => {
      const fdv = this._parseFDV(t.fdv);
      const tvl = this._parseFDV(t.tvl);
      const txVolume = this._parseFDV(t.tx_volume_u_24h);

      // 过滤条件：必须有合理TVL、有交易量、FDV在合理范围内
      return fdv > 0 &&
             fdv <= MAX_VALID_FDV &&
             tvl >= MIN_VALID_TVL &&
             txVolume > 0;
    });

    if (validTokens.length === 0) {
      return 0;
    }

    const fdvs = validTokens.map(t => this._parseFDV(t.fdv));
    return Math.max(...fdvs);
  }

  /**
   * 解析FDV字符串
   * @param {string} fdvStr - FDV字符串
   * @returns {number} 解析后的数值
   * @private
   */
  _parseFDV(fdvStr) {
    if (!fdvStr || fdvStr === '' || fdvStr === '0') {
      return 0;
    }

    const cleaned = String(fdvStr).replace(/,/g, '').trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  /**
   * 获取空因子值（错误时使用）
   * @param {string} error - 错误信息
   * @returns {Object} 空因子值
   */
  getEmptyFactors(error = null) {
    return {
      strictSameNameTokenCount: -1,
      strictSameNameSearchCount: 0,
      strictSameNameFilteredCount: 0,
      strictSameNameMaxFDV: 0,
      _strictSameNameError: error
    };
  }
}

module.exports = { SameNameTokenService };
